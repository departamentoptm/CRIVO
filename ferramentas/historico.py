"""
Histórico do tema (seção 2.10): encontra TODAS as questões da banca relacionadas à questão atual.

Como garante que nada fica de fora:
  1. Catálogo de temas: cada questão da banca (todas as edições) recebe, uma única vez, uma lista de temas
     feita pela IA (dados/<BANCA>/temas.json). Questões novas são catalogadas automaticamente.
  2. Triagem de TODAS as questões da banca contra a atual, por dois critérios independentes:
       - tema em comum (comparando os termos dos temas, ignorando os genéricos demais, como "pediatria");
       - vocabulário em comum no texto (Jaccard ponderado por IDF).
     Basta um dos dois para virar candidata. A triagem é generosa de propósito.
  3. A IA lê o resumo e os temas de cada candidata e decide se é do mesmo tema (na dúvida, inclui).
  4. O resultado registra quantas questões foram avaliadas, quantas viraram candidatas e quantas entraram.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ia_cliente import RespostaCortada
from crivo_comum import (listar_edicoes, ler_questoes, ler_json, gravar_json, arq_temas, termos,
                         texto_da_questao, LETRAS)

PASTA_PROMPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")


def prompt(nome):
    with open(os.path.join(PASTA_PROMPTS, nome), encoding="utf-8") as f:
        return f.read()


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


# ------------------------------------------------------------------ 1. catálogo de temas
def atualizar_catalogo(dados, banca, cliente, config, log=print, ids=None):
    caminho = arq_temas(dados, banca)
    catalogo = ler_json(caminho, {"formato": "crivo-temas", "versao": 1, "banca": banca, "questoes": {}})
    todas = questoes_da_banca(dados, banca)
    faltam = [i for i in (ids or todas) if i in todas and i not in catalogo["questoes"]]
    if not faltam:
        return catalogo
    lote = config.get("temas_questoes_por_chamada", 10)
    log(f"Catálogo de temas de {banca}: {len(faltam)} questão(ões) a catalogar (feito uma única vez).")
    sistema = prompt("temas.md")

    def pedir(grupo):
        """Pede os temas de um grupo; se a resposta vier cortada, divide o grupo ao meio e tenta de novo."""
        usuario = "\n\n".join(f"### id: {i}\n{texto_curto(todas[i])}" for i in grupo)
        try:
            r = cliente.json("temas", sistema, usuario)
            return {x.get("id"): x for x in r.get("questoes", []) if isinstance(x, dict)}
        except RespostaCortada:
            if len(grupo) == 1:
                raise
            log(f"   resposta longa demais para {len(grupo)} questões; dividindo o lote")
            meio = len(grupo) // 2
            return {**pedir(grupo[:meio]), **pedir(grupo[meio:])}

    for k in range(0, len(faltam), lote):
        grupo = faltam[k:k + lote]
        recebidos = pedir(grupo)
        for i in grupo:
            x = recebidos.get(i)
            if not x or not x.get("temas"):
                log(f"   aviso: {i} veio sem temas; será tentado de novo na próxima execução")
                continue
            catalogo["questoes"][i] = {"temas": [str(t)[:120] for t in x["temas"][:6]],
                                       "resumo": str(x.get("resumo", ""))[:300],
                                       "abordagem": str(x.get("abordagem", ""))[:60]}
        gravar_json(caminho, catalogo)
        log(f"   catalogadas {min(k + lote, len(faltam))}/{len(faltam)}")
    return catalogo


# ------------------------------------------------------------------ 2. triagem
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

    # temas genéricos demais (presentes em mais de 5% das questões) não servem para casar tema
    temas_q = {i: [_termos_tema(t) for t in catalogo.get(i, {}).get("temas", [])] for i in todas}
    freq_tema = {}
    for lst in temas_q.values():
        for t in set(lst):
            freq_tema[t] = freq_tema.get(t, 0) + 1
    teto = max(3, 0.05 * n)
    especificos = lambda lst: [t for t in lst if t and freq_tema.get(t, 0) <= teto]

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
                if inter and (inter / len(a | b) >= 0.5 or a <= b or b <= a):
                    tema_comum += 1
        inter = sum(idf[t] for t in meus & tq[i])
        uniao = soma_meus + sum(idf[t] for t in tq[i]) - inter
        lex = inter / uniao if uniao else 0.0
        if tema_comum or lex >= limiar:
            candidatas.append((tema_comum, lex, i))
    candidatas.sort(key=lambda x: (-x[0], -x[1]))
    return candidatas, n - 1


# ------------------------------------------------------------------ 3. relevância (IA)
def relacionadas(qid, todas, catalogo, cliente, config, log=print):
    candidatas, avaliadas = triagem(qid, todas, catalogo, config)
    maximo = config["historico"]["max_candidatas"]
    truncado = len(candidatas) > maximo
    if truncado:
        log(f"   aviso: {len(candidatas)} candidatas; avaliando as {maximo} mais parecidas (ajuste historico.max_candidatas)")
        candidatas = candidatas[:maximo]
    q = todas[qid]
    cab = (f"QUESTÃO ATUAL ({qid}):\n{texto_curto(q, 3000)}\n"
           f"Temas: {'; '.join(catalogo.get(qid, {}).get('temas', []))}\n")
    sistema = prompt("relevancia.md")
    escolhidas = {}
    lote = config["historico"]["candidatas_por_chamada"]
    for k in range(0, len(candidatas), lote):
        grupo = [c[2] for c in candidatas[k:k + lote]]
        linhas = []
        for i in grupo:
            c = catalogo.get(i, {})
            linhas.append(f"- id: {i} | ano: {todas[i]['ano']} | temas: {'; '.join(c.get('temas', []))} | "
                          f"resumo: {c.get('resumo') or texto_curto(todas[i], 300)}")
        for x in _relevancia_dividindo(cliente, sistema, cab, grupo, linhas, log):
            if isinstance(x, dict) and x.get("id") in grupo:
                escolhidas[x["id"]] = str(x.get("motivo", ""))[:300]
    ordem = sorted(escolhidas, key=lambda i: (todas[i]["ano"], todas[i]["numero"]))
    meta = {"metodo": "catalogo_de_temas+lexico+ia_v1", "questoes_da_banca_avaliadas": avaliadas,
            "candidatas_pela_triagem": len(candidatas), "relevantes": len(ordem), "triagem_truncada": truncado}
    return [{"id": i, "motivo": escolhidas[i]} for i in ordem], meta


def _relevancia_dividindo(cliente, sistema, cab, grupo, linhas, log):
    try:
        r = cliente.json("relevancia", sistema, cab + "\nCANDIDATAS:\n" + "\n".join(linhas))
        return r.get("relevantes", []) or []
    except RespostaCortada:
        if len(grupo) == 1:
            raise
        log(f"   resposta longa demais para {len(grupo)} candidatas; dividindo o lote")
        m = len(grupo) // 2
        return (_relevancia_dividindo(cliente, sistema, cab, grupo[:m], linhas[:m], log)
                + _relevancia_dividindo(cliente, sistema, cab, grupo[m:], linhas[m:], log))


def bloco_para_prompt(relevantes, todas):
    """Texto completo das questões relacionadas, com gabarito, para a etapa de geração."""
    if not relevantes:
        return "(vazio: nenhuma outra questão desta banca no acervo trata do mesmo tema)"
    partes = []
    for r in relevantes:
        q = todas[r["id"]]
        gab = q.get("gabarito") if q.get("gabarito") in LETRAS else "anulada"
        partes.append(f"### id: {r['id']} | ano {q['ano']} | questão {q['numero']} | gabarito: {gab}\n"
                      f"Relação identificada: {r['motivo']}\n{texto_curto(q, 2500)}")
    return "\n\n".join(partes)
