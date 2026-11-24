"""
Histórico do tema (seção 2.10) e catálogo da banca.

Economia de tokens:
  - Catálogo (dados/<BANCA>/temas.json): cada questão é catalogada UMA vez (temas, resumo, abordagem e
    disciplina, num único pedido). Questões já catalogadas nunca são reenviadas.
  - Triagem por código: compara a questão atual com TODAS as questões da banca (temas em comum, mesma
    disciplina, vocabulário em comum com peso IDF). Só as candidatas vão para a IA, em linhas curtas.
  - A IA só escolhe e classifica as relacionadas (mesmo tema, tema relacionado, caso semelhante) e escreve
    um motivo curto. A TABELA é montada pelo código com o catálogo: a IA de geração não reescreve nada disso.
"""
import math
import re
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ia_cliente import RespostaCortada
from crivo_comum import (listar_edicoes, ler_questoes, ler_json, gravar_json, arq_temas, arq_questoes, termos,
                         texto_da_questao, texto_puro, LETRAS)

PASTA_PROMPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")
ORDEM_TIPO = {"mesmo_tema": 0, "tema_relacionado": 1, "caso_semelhante": 2}
ROTULO_TIPO = {"mesmo_tema": "Mesmo tema", "tema_relacionado": "Tema relacionado", "caso_semelhante": "Caso semelhante"}


def prompt(nome, config=None):
    with open(os.path.join(PASTA_PROMPTS, nome), encoding="utf-8") as f:
        t = f.read()
    if config and "{{DISCIPLINAS}}" in t:
        t = t.replace("{{DISCIPLINAS}}", ", ".join(config.get("disciplinas_permitidas", [])))
    return t


def questoes_da_banca(dados, banca):
    """{id: questão} de todas as edições da banca, com 'ano' preenchido."""
    todas = {}
    for b, ano in listar_edicoes(dados, banca):
        for q in ler_questoes(dados, b, ano)["questoes"]:
            todas[q["id"]] = dict(q, ano=str(ano), banca=b)
    return todas


def texto_curto(q, limite=1800):
    t = texto_da_questao(q)
    return t if len(t) <= limite else t[:limite] + " [...]"


def impressao(q):
    """Impressão digital do texto da questão: muda quando o enunciado ou as alternativas mudam."""
    import hashlib
    t = re.sub(r"\s+", " ", texto_da_questao(q)).strip().lower()
    return hashlib.sha1(t.encode("utf-8")).hexdigest()[:12]


def _disciplina_valida(valor, config):
    perm = {d.lower(): d for d in config.get("disciplinas_permitidas", [])}
    return perm.get(str(valor or "").strip().lower())


# ------------------------------------------------------------------ 1. catálogo (+ disciplina)
def _checar(cliente):
    c = getattr(cliente, "contador", None)
    if c:
        c.checar()           # entre lotes do catálogo (o que já foi catalogado fica gravado)


def _em_lotes(itens, tamanho):
    for k in range(0, len(itens), tamanho):
        yield itens[k:k + tamanho]


def _pedir_dividindo(cliente, etapa, sistema, grupo, montar, log):
    """Pede um lote; se a resposta vier cortada, divide o lote ao meio e tenta de novo."""
    try:
        r = cliente.json(etapa, sistema, montar(grupo))
        return {x.get("id"): x for x in r.get("questoes", []) if isinstance(x, dict)}
    except RespostaCortada:
        if len(grupo) == 1:
            raise
        log(f"   resposta longa demais para {len(grupo)} questões; dividindo o lote")
        m = len(grupo) // 2
        return {**_pedir_dividindo(cliente, etapa, sistema, grupo[:m], montar, log),
                **_pedir_dividindo(cliente, etapa, sistema, grupo[m:], montar, log)}


def atualizar_catalogo(dados, banca, cliente, config, log=print, ids=None, com_gabarito=False):
    """Cataloga o que falta. Com com_gabarito=True (só para os ids dados), refaz com a resposta oficial as
    entradas catalogadas sem ela: o resumo e os temas passam a descrever a resposta correta, sem os chutes
    que a IA fazia quando não via o gabarito."""
    caminho = arq_temas(dados, banca)
    catalogo = ler_json(caminho, {"formato": "crivo-temas", "versao": 1, "banca": banca, "questoes": {}})
    todas = questoes_da_banca(dados, banca)

    # cataloga o que falta e REFAZ o que foi catalogado com outro texto (ou antes de existir a impressão digital)
    faltam = [i for i in (ids or todas) if i in todas and
              ((catalogo["questoes"].get(i) or {}).get("texto") != impressao(todas[i])
               or (com_gabarito and not (catalogo["questoes"].get(i) or {}).get("com_gabarito")))]
    if faltam:
        novas = sum(1 for i in faltam if i not in catalogo["questoes"])
        if com_gabarito:
            log(f"   catálogo: refazendo {len(faltam)} questão(ões) com a resposta oficial")
        else:
            log(f"Catálogo de temas de {banca}: {novas} questão(ões) novas e {len(faltam) - novas} com texto "
                f"diferente do catalogado (cada texto é catalogado uma única vez).")
        sistema = prompt("temas.md", config)
        montar = lambda g: "\n\n".join(f"### id: {i}\n{texto_curto(todas[i])}\nRESPOSTA OFICIAL: {resposta_correta(todas[i])}"
                                         for i in g)
        feitas = 0
        for grupo in _em_lotes(faltam, config.get("temas_questoes_por_chamada", 10)):
            _checar(cliente)
            recebidos = _pedir_dividindo(cliente, "temas", sistema, grupo, montar, log)
            for i in grupo:
                x = recebidos.get(i)
                if not x or not x.get("temas"):
                    log(f"   aviso: {i} veio sem temas; será tentado de novo na próxima execução")
                    continue
                catalogo["questoes"][i] = {"temas": [str(t)[:120] for t in x["temas"][:6]],
                                           "resumo": str(x.get("resumo", ""))[:300],
                                           "abordagem": str(x.get("abordagem", ""))[:60],
                                           "disciplina": _disciplina_valida(x.get("disciplina"), config),
                                           "texto": impressao(todas[i]), "com_gabarito": True}
            feitas += len(grupo)
            gravar_json(caminho, catalogo)
            if not com_gabarito:
                log(f"   catalogadas {feitas}/{len(faltam)}")

    # questões catalogadas antes de existir o campo disciplina (pedido mínimo: só id -> disciplina)
    sem_disc = [i for i, c in catalogo["questoes"].items()
                if i in todas and not c.get("disciplina") and not todas[i].get("disciplina")]
    if sem_disc:
        log(f"Disciplina: {len(sem_disc)} questão(ões) sem disciplina; classificando (pedido curto).")
        sistema = prompt("disciplina.md", config)
        montar = lambda g: "\n\n".join(f"### id: {i}\n{texto_curto(todas[i], 700)}" for i in g)
        for grupo in _em_lotes(sem_disc, config.get("disciplina_questoes_por_chamada", 30)):
            _checar(cliente)
            recebidos = _pedir_dividindo(cliente, "temas", sistema, grupo, montar, log)
            for i in grupo:
                d = _disciplina_valida((recebidos.get(i) or {}).get("disciplina"), config)
                if d:
                    catalogo["questoes"][i]["disciplina"] = d
            gravar_json(caminho, catalogo)
    aplicar_disciplinas(dados, banca, catalogo, log)
    return catalogo


def aplicar_disciplinas(dados, banca, catalogo, log=print):
    """Preenche 'disciplina' em questoes.json onde estiver vazia (a classificação feita por pessoas é mantida)."""
    total = 0
    for b, ano in listar_edicoes(dados, banca):
        qs = ler_questoes(dados, b, ano)
        mudou = False
        for q in qs["questoes"]:
            d = (catalogo["questoes"].get(q["id"]) or {}).get("disciplina")
            if not q.get("disciplina") and d:
                q["disciplina"] = d; mudou = True; total += 1
        if mudou:
            gravar_json(arq_questoes(dados, b, ano), qs)
    if total:
        log(f"Disciplina preenchida em {total} questão(ões) de {banca} (rode gerar_indice.py para o filtro do site).")


# ------------------------------------------------------------------ 2. triagem por código
def _termos_tema(t):
    return frozenset(termos(t, tamanho_prefixo=6))


def triagem(qid, todas, catalogo, config):
    n = len(todas)
    tq = {i: termos(texto_da_questao(q) + " " + " ".join(catalogo.get(i, {}).get("temas", [])))
          for i, q in todas.items()}
    df = {}
    for s in tq.values():
        for t in s:
            df[t] = df.get(t, 0) + 1
    idf = {t: math.log((n + 1) / (c + 1)) + 1 for t, c in df.items()}
    temas_q = {i: [_termos_tema(t) for t in catalogo.get(i, {}).get("temas", [])] for i in todas}
    freq_tema = {}
    for lst in temas_q.values():
        for t in set(lst):
            freq_tema[t] = freq_tema.get(t, 0) + 1
    teto = max(3, 0.05 * n)
    especificos = lambda lst: [t for t in lst if t and freq_tema.get(t, 0) <= teto]
    disc = lambda i: todas[i].get("disciplina") or catalogo.get(i, {}).get("disciplina")

    meus_temas = especificos(temas_q.get(qid, []))
    meus = tq[qid]
    soma_meus = sum(idf[t] for t in meus) or 1.0
    limiar = config["historico"]["limiar_lexico"]
    candidatas = []
    for i in todas:
        if i == qid:
            continue
        tema_comum = 0
        for a in meus_temas:
            for b in especificos(temas_q.get(i, [])):
                inter = len(a & b)
                if inter and (inter / len(a | b) >= 0.34 or a <= b or b <= a):
                    tema_comum += 1
        inter = sum(idf[t] for t in meus & tq[i])
        uniao = soma_meus + sum(idf[t] for t in tq[i]) - inter
        lex = inter / uniao if uniao else 0.0
        mesma_disc = disc(i) and disc(i) == disc(qid)
        if tema_comum or lex >= limiar or (mesma_disc and lex >= limiar * 0.6):
            candidatas.append((tema_comum, lex * (1.25 if mesma_disc else 1.0), i))
    candidatas.sort(key=lambda x: (-x[0], -x[1]))
    return candidatas, n - 1


# ------------------------------------------------------------------ 3. relevância (IA, pedido curto)
def _relevancia_dividindo(cliente, sistema, cab, grupo, linhas, log):
    try:
        r = cliente.json("relevancia", sistema, cab + "\nCANDIDATAS:\n" + "\n".join(linhas))
        return r.get("relacionadas", r.get("relevantes", [])) or []
    except RespostaCortada:
        if len(grupo) == 1:
            raise
        log(f"   resposta longa demais para {len(grupo)} candidatas; dividindo o lote")
        m = len(grupo) // 2
        return (_relevancia_dividindo(cliente, sistema, cab, grupo[:m], linhas[:m], log)
                + _relevancia_dividindo(cliente, sistema, cab, grupo[m:], linhas[m:], log))


def relacionadas(qid, todas, catalogo, cliente, config, log=print):
    candidatas, avaliadas = triagem(qid, todas, catalogo, config)
    maximo = config["historico"]["max_candidatas"]
    truncado = len(candidatas) > maximo
    if truncado:
        candidatas = candidatas[:maximo]
    q, cq = todas[qid], catalogo.get(qid, {})
    cab = (f"QUESTÃO ATUAL ({qid}, disciplina {q.get('disciplina') or cq.get('disciplina') or '?'}):\n"
           f"{texto_curto(q, 1500)}\nTemas: {'; '.join(cq.get('temas', []))}\n")
    sistema = prompt("relevancia.md", config)
    escolhidas = {}
    lote = config["historico"]["candidatas_por_chamada"]
    for k in range(0, len(candidatas), lote):
        grupo = [c[2] for c in candidatas[k:k + lote]]
        linhas = []
        for i in grupo:
            c = catalogo.get(i, {})
            linhas.append(f"{i} | {todas[i]['ano']} | {todas[i].get('disciplina') or c.get('disciplina') or '?'} | "
                          f"{'; '.join(c.get('temas', [])[:4])} | {c.get('resumo') or texto_curto(todas[i], 200)}")
        for x in _relevancia_dividindo(cliente, sistema, cab, grupo, linhas, log):
            if isinstance(x, dict) and x.get("id") in grupo:
                tipo = x.get("tipo") if x.get("tipo") in ORDEM_TIPO else "tema_relacionado"
                escolhidas[x["id"]] = {"id": x["id"], "tipo": tipo, "motivo": str(x.get("motivo", ""))[:200]}
    ordem = sorted(escolhidas.values(), key=lambda r: (ORDEM_TIPO[r["tipo"]], todas[r["id"]]["ano"], todas[r["id"]]["numero"]))
    anos = sorted({todas[i]["ano"] for i in todas})
    meta = {"metodo": "catalogo+disciplina+lexico+ia_v2", "questoes_da_banca_avaliadas": avaliadas,
            "candidatas_pela_triagem": len(candidatas), "relevantes": len(ordem), "triagem_truncada": truncado,
            "provas_no_acervo": len(anos), "anos": [anos[0], anos[-1]] if anos else None,
            "provas_com_relacionadas": len({todas[r["id"]]["ano"] for r in ordem}),
            "por_tipo": {t: sum(1 for r in ordem if r["tipo"] == t) for t in ORDEM_TIPO}}
    return ordem, meta


def resposta_correta(h):
    g = h.get("gabarito")
    if g not in LETRAS:
        return "Anulada"
    alt = texto_puro((h.get("alternativas") or {}).get(g, ""))
    return f"{g} ({alt[:90] + ('…' if len(alt) > 90 else '')})" if alt else g


def linhas_da_tabela(relevantes, todas, catalogo):
    """Linhas da tabela 2.10 montadas só com dados conferidos (questoes.json + catálogo + relevância)."""
    linhas = []
    for r in relevantes:
        h, c = todas[r["id"]], catalogo.get(r["id"], {})
        linhas.append({"id": r["id"], "ano": h["ano"], "numero": h["numero"],
                       "gabarito": h.get("gabarito") if h.get("gabarito") in LETRAS else None,
                       "resumo": c.get("resumo") or texto_puro(h.get("enunciado_html"))[:160],
                       "cobrado": c.get("abordagem", ""),
                       "resposta": resposta_correta(h),
                       "relacao": f"{ROTULO_TIPO[r['tipo']]}: {r['motivo']}", "tipo": r["tipo"]})
    return linhas


def quando(ano, ano_ref):
    """'ANTERIOR', 'POSTERIOR' ou 'MESMA PROVA' em relação à prova da questão corrigida."""
    try:
        a, b = int(str(ano)[:4]), int(str(ano_ref)[:4])
    except (TypeError, ValueError):
        return ""
    return "ANTERIOR à prova" if a < b else "POSTERIOR à prova" if a > b else "MESMA PROVA"


def bloco_para_prompt(relevantes, todas, catalogo, maximo=15, ano_ref=None):
    """Resumo compacto (não o texto inteiro) das relacionadas, para a análise da 2.10 — economiza tokens."""
    if not relevantes:
        return "(vazio: nenhuma outra questão desta banca no acervo se relaciona a esta)"
    partes = []
    for r in relevantes[:maximo]:
        h, c = todas[r["id"]], catalogo.get(r["id"], {})
        partes.append(f"- {h['banca']} {h['ano']} (questão {h['numero']}{', ' + quando(h['ano'], ano_ref) if ano_ref else ''}) | {ROTULO_TIPO[r['tipo']]} | "
                      f"{c.get('abordagem', '')} | {c.get('resumo', '')} | resposta: {resposta_correta(h)}")
    if len(relevantes) > maximo:
        partes.append(f"(+ {len(relevantes) - maximo} questões de relação mais distante, listadas na tabela)")
    return "\n".join(partes)
