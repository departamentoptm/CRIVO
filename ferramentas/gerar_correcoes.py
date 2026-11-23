#!/usr/bin/env python3
"""
Gerador de correções do CRIVO (via API).

Escreve SOMENTE em dados/<BANCA>/<ANO>/correcoes.json (e no catálogo de temas da banca).
Nunca altera enunciado, alternativas ou gabarito (questoes.json).

Etapas por questão:
  1. Histórico: avalia todas as questões da banca e seleciona as do mesmo tema (historico.py).
  2. Resolução às cegas: a IA resolve sem ver o gabarito; se discordar do oficial, a questão ganha um alerta.
  3. Geração: correção completa (seções 2.1–2.14) em JSON, com o gabarito oficial fixado pelo script.
  4. Validação automática: seções presentes e com tamanho mínimo, todas as alternativas analisadas,
     histórico só com questões reais, referências só da lista permitida.
  5. Verificação independente: outra chamada, como revisor, procura erros factuais. Problema grave ou
     moderado -> a correção é refeita com as observações. Se continuar reprovada, NÃO é publicada
     (fica em relatorios/reprovadas/ para análise) e a correção anterior é mantida.

Exemplos:
  python ferramentas/gerar_correcoes.py modelos
  python ferramentas/gerar_correcoes.py catalogar --banca AMP
  python ferramentas/gerar_correcoes.py gerar --banca AMP --ano 2021 --questoes 50
  python ferramentas/gerar_correcoes.py gerar --banca AMP --modo pendentes --orcamento 2
  python ferramentas/gerar_correcoes.py gerar --banca AMP --ano 2021 --questoes 1-3 --simular   (teste sem API)
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from crivo_comum import (gravar_json, ler_json, ler_questoes, ler_correcoes, arq_correcoes, limpar_html,
                         texto_puro, listar_edicoes, LETRAS)
from historico import (prompt, questoes_da_banca, atualizar_catalogo, relacionadas, bloco_para_prompt,
                       linhas_da_tabela, ROTULO_TIPO, ORDEM_TIPO, resposta_correta)
from crivo_comum import arq_temas
import referencias as refs_mod
from ia_cliente import ClienteAPI, Contador, OrcamentoEsgotado, ErroAPI

SECOES_IA = [f"2.{k}" for k in range(1, 15)]          # 2.15 (referências) é montada pelo script


def log(msg=""):
    print(msg, flush=True)


# ------------------------------------------------------------------ texto da questão para a IA
def texto_para_ia(q, com_gabarito):
    enun = re.sub(r"<br\s*/?>", "\n", q.get("enunciado_html") or "")
    partes = [f"Questão {q['numero']} — {q['banca']} {q['ano']}" + (f" — disciplina: {q['disciplina']}" if q.get("disciplina") else ""),
              texto_puro(enun.replace("\n", " ⏎ ")).replace(" ⏎ ", "\n").replace("⏎", "\n")]
    if q.get("extras_html"):
        partes.append(texto_puro(q["extras_html"]))
    for l in LETRAS:
        if l in (q.get("alternativas") or {}):
            partes.append(f"{l}) {texto_puro(q['alternativas'][l])}")
    if q.get("imagem_pendente") or "<img" in (q.get("extras_html") or ""):
        partes.append("[Esta questão tem uma figura que você NÃO pode ver. Não descreva nem presuma o conteúdo da figura; "
                      "se a resposta depender dela, diga isso explicitamente.]")
    if com_gabarito:
        g = q.get("gabarito")
        motivo = {"excluida": "QUESTÃO EXCLUÍDA pela banca do cálculo do resultado (desajuste estatístico), sem gabarito",
                  "anulada_administrativamente": "QUESTÃO ANULADA ADMINISTRATIVAMENTE pela banca"}.get(
                      q.get("anulacao"), "QUESTÃO ANULADA pela banca")
        partes.append(f"GABARITO OFICIAL: {'alternativa ' + g if g in LETRAS else motivo}")
    return "\n".join(partes)


# ------------------------------------------------------------------ validação
def _sem_links(h):
    return re.sub(r"</?a\b[^>]*>", "", h or "")


def validar(r, q, relevantes, todas, catalogo, config):
    """Devolve (correcao_normalizada, problemas). Problemas fazem a geração ser refeita."""
    problemas = []
    qual = config["qualidade"]
    tol = 1 - float(qual.get("tolerancia_minimos", 0.03))      # aceita até 3% abaixo do mínimo
    secoes_in = r.get("secoes") if isinstance(r.get("secoes"), dict) else {}
    secoes, total = {}, 0
    for s in SECOES_IA:
        h = _sem_links(limpar_html(str(secoes_in.get(s) or "")))
        n = len(texto_puro(h))
        total += n
        minimo = qual["min_caracteres_por_secao"].get(s, 100)
        if n < minimo * tol:
            problemas.append(f"seção {s} curta ou ausente ({n} caracteres; mínimo {minimo})")
        secoes[s] = h
    if total < qual["min_caracteres_total"] * tol:
        problemas.append(f"correção curta no total ({total} caracteres; mínimo {qual['min_caracteres_total']})")
    g = q.get("gabarito")
    t23, t24 = texto_puro(secoes["2.3"]), texto_puro(secoes["2.4"])
    if g in LETRAS and not re.search(rf"\b{g}\b", t23):
        problemas.append(f"a seção 2.3 não cita a alternativa do gabarito ({g})")
    h24 = secoes["2.4"]
    for l in (q.get("alternativas") or {}):
        if not (re.search(rf"(?:Alternativa|Letra|Opção|Opcao)\s*\(?{l}\)?(?![\wÀ-ÿ])", t24)
                or re.search(rf"<strong>\s*(?:Alternativa\s*)?\(?{l}\)?\s*[)\-–:.]?\s*</strong>", h24)):
            problemas.append(f"a seção 2.4 não analisa a alternativa {l}")
    rel_ids = {x["id"] for x in relevantes}
    for s_ in SECOES_IA:
        def legivel(m):
            i = m.group(0)
            if i not in rel_ids:
                problemas.append(f"a seção {s_} cita {i}, que não está no bloco HISTÓRICO")
                return i
            h = todas[i]
            return f"{h['banca']} {h['ano']} (questão {h['numero']})"
        secoes[s_] = re.sub(r"\b[A-Z][A-Z0-9-]*?-\d{4}-Q\d{1,3}\b", legivel, secoes[s_])
    if "<table" not in secoes["2.8"]:
        problemas.append("a seção 2.8 deve conter a tabela de diagnósticos diferenciais")
    if "<table" in secoes["2.10"]:
        secoes["2.10"] = re.sub(r"<table.*?</table>", "", secoes["2.10"], flags=re.S)  # a tabela é do script

    # referências: livros só da lista permitida (sem nº de capítulo/página, que a IA poderia inventar)
    # + termos em inglês para o código buscar artigos reais no PubMed
    bruto = r.get("referencias") or {}
    if isinstance(bruto, list):                      # formato antigo: [{"fonte","detalhe","busca"}]
        bruto = {"livros": [{"fonte": x.get("fonte"), "secao": x.get("detalhe")} for x in bruto if isinstance(x, dict)],
                 "busca_pubmed": next((x.get("busca") for x in bruto if isinstance(x, dict) and x.get("busca")), "")}
    permitidas = {f.lower(): f for f in config["fontes_permitidas"]}
    livros = []
    for x in bruto.get("livros") or []:
        if not isinstance(x, dict):
            continue
        fonte = permitidas.get(str(x.get("fonte", "")).strip().lower())
        if fonte and fonte not in [l["fonte"] for l in livros]:
            secao = re.sub(r"(?i)\b(cap[ií]tulo|cap\.|p[aá]ginas?|p[aá]gs?\.?|pp?\.)\s*[\d\-–, ]+", "", str(x.get("secao", "")))
            livros.append({"fonte": fonte, "secao": limpar_html(secao).strip(" ,;-–—")[:160]})
    if not livros:
        problemas.append("nenhum livro da lista FONTES PERMITIDAS em referencias.livros")
    busca = refs_mod.limpar_busca(bruto.get("busca_pubmed") or r.get("busca_pubmed") or "")
    if not busca:
        problemas.append("referencias.busca_pubmed vazio (termos em inglês para o PubMed)")

    tema = str(r.get("tema") or "").strip()[:150]
    if not tema:
        problemas.append("campo 'tema' vazio")
    aviso = r.get("aviso_diretriz")
    aviso = limpar_html(str(aviso))[:800] if aviso not in (None, "", "null") else None
    afirm = [str(a)[:400] for a in (r.get("afirmacoes_criticas") or []) if a][:10]
    return {"tema": tema, "aviso_diretriz": aviso, "secoes": secoes, "livros": livros, "busca": busca,
            "afirmacoes_criticas": afirm}, problemas


RE_FALTA_ALT = re.compile(r"a seção 2\.4 não analisa a alternativa ([A-E])$")


def _ordenar_alternativas(h):
    """Põe os parágrafos da 2.4 na ordem A, B, C... (só quando a seção é feita apenas de parágrafos
    que começam com a letra da alternativa; senão, deixa como está)."""
    blocos = re.findall(r"<p\b.*?</p>", h, re.S)
    if not blocos or re.sub(r"\s+", "", "".join(blocos)) != re.sub(r"\s+", "", h):
        return h
    def letra(b):
        m = re.search(r"(?:Alternativa|Letra|Opção)\s*\(?([A-E])\b", texto_puro(b)[:40])
        return m.group(1) if m else None
    if not all(letra(b) for b in blocos):
        return h
    return "".join(sorted(blocos, key=letra))


def completar_alternativas(r, q, faltam, cliente, config):
    """Pede só os parágrafos que faltam na 2.4 e os encaixa na seção (sem refazer a correção)."""
    secoes = dict(r.get("secoes") or {})
    pedido = (texto_para_ia(q, com_gabarito=True) + "\n\nALTERNATIVAS QUE FALTAM NA SEÇÃO 2.4: " + ", ".join(faltam)
              + "\n\nSEÇÃO 2.4 ATUAL:\n" + texto_puro(re.sub(r"</p>", "\n", secoes.get("2.4", "")))[:6000])
    x = cliente.json("gerar", prompt("completar_alternativas.md", config), pedido)
    novos = x.get("paragrafos") if isinstance(x.get("paragrafos"), dict) else {}
    add = "".join(str(novos[l]) for l in faltam if novos.get(l))
    if add:
        secoes["2.4"] = _ordenar_alternativas(str(secoes.get("2.4", "")) + add)
    return dict(r, secoes=secoes)


def secoes_apontadas(serios):
    """Seções citadas pelo revisor, inclusive em rótulos compostos ("2.4 e 2.10", "aviso/2.3")."""
    secs, aviso = set(), False
    for p in serios:
        mesmo = p.get("secoes_com_o_mesmo_erro") or []
        rot = str(p.get("secao", "")) + " " + " ".join(str(x) for x in (mesmo if isinstance(mesmo, list) else [mesmo]))
        for a, b in re.findall(r"2\.(1[0-4]|[1-9])\s*(?:[-–—]|\ba\b|\baté\b)\s*(?:2\.)?(1[0-4]|[1-9])(?!\d)", rot):
            if int(a) < int(b):
                secs |= {f"2.{n}" for n in range(int(a), int(b) + 1)}      # "2.2–2.4" = 2.2, 2.3 e 2.4
        secs |= {f"2.{n}" for n in re.findall(r"2\.(1[0-4]|[1-9])(?!\d)", rot)}
        aviso = aviso or bool(re.search(r"aviso|diretriz", rot, re.I))
    return sorted(secs, key=lambda x: int(x.split(".")[1])), aviso


def corrigir_secoes(r, serios, q, usuario_base, cliente, config):
    """Reescreve as seções apontadas pelo revisor (todas elas, obrigatoriamente) e devolve a correção com
    elas substituídas. As demais seções ficam como estão. Devolve (correção, seções reescritas)."""
    secoes = dict(r.get("secoes") or {})
    apontadas, aviso_apontado = secoes_apontadas(serios)
    if not apontadas and not aviso_apontado:
        apontadas = ["2.3", "2.4"]                         # rótulo irreconhecível: as seções centrais
    atual = "\n".join(f"[{s}]\n{secoes.get(s, '')}" for s in SECOES_IA)
    obrig = ", ".join(apontadas + (["aviso_diretriz"] if aviso_apontado else []))
    pedido = (usuario_base + f"\n\nAVISO DE DIRETRIZ ATUAL: {r.get('aviso_diretriz') or '(nenhum)'}"
              + "\n\nCORREÇÃO ATUAL (HTML de todas as seções):\n" + atual
              + "\n\nPROBLEMAS APONTADOS PELO REVISOR (corrija todos):\n" + json.dumps(serios, ensure_ascii=False, indent=1)
              + f"\n\nDEVOLVA OBRIGATORIAMENTE, reescritas: {obrig}. A mesma afirmação errada costuma se repetir em outras "
                "seções: procure-a em TODAS (2.1 a 2.14 e aviso) e reescreva também as que a repetem.")
    sistema = prompt("corrigir_secoes.md", config)
    trocadas, novo_aviso = [], None
    for tentativa in (1, 2):
        x = cliente.json("gerar", sistema, pedido)
        novas = x.get("secoes") if isinstance(x.get("secoes"), dict) else {}
        for s_ in SECOES_IA:
            if novas.get(s_) and str(novas[s_]).strip() != str(secoes.get(s_, "")).strip():
                secoes[s_] = str(novas[s_]); trocadas.append(s_)
        if "aviso_diretriz" in x and x.get("aviso_diretriz") != r.get("aviso_diretriz"):
            novo_aviso = x.get("aviso_diretriz")
        if isinstance(x.get("afirmacoes_criticas"), list) and x["afirmacoes_criticas"]:
            r = dict(r, afirmacoes_criticas=x["afirmacoes_criticas"])
        faltam = [s_ for s_ in apontadas if s_ not in trocadas] + (["aviso_diretriz"] if aviso_apontado and novo_aviso is None else [])
        if not faltam:
            break
        log(f"   seção(ões) apontada(s) não reescrita(s): {', '.join(faltam)}; pedindo de novo")
        pedido += (f"\n\nVOCÊ NÃO REESCREVEU: {', '.join(faltam)}. Devolva essas seções reescritas, corrigindo os "
                   "problemas apontados nelas.")
    log(f"   seções reescritas: {', '.join(sorted(set(trocadas), key=lambda x: int(x.split('.')[1]))) or 'nenhuma'}"
        + (" + aviso de diretriz" if novo_aviso is not None else ""))
    novo = dict(r, secoes=secoes)
    if novo_aviso is not None:
        novo["aviso_diretriz"] = novo_aviso
    return novo, sorted(set(trocadas) | ({"aviso"} if novo_aviso is not None else set()))


def texto_para_verificar(c, q, relevantes, todas, catalogo, evidencias=""):
    partes = [texto_para_ia(q, com_gabarito=True), "", f"TEMA: {c['tema']}"]
    if c["aviso_diretriz"]:
        partes.append(f"AVISO DE DIRETRIZ: {texto_puro(c['aviso_diretriz'])}")
    for s in SECOES_IA:
        partes.append(f"\n[{s}]\n{texto_puro(re.sub(r'</(p|li|tr)>', ' / ', c['secoes'][s]))}")
    if c["afirmacoes_criticas"]:
        partes.append("\nAFIRMAÇÕES CENTRAIS DECLARADAS PELO AUTOR:\n- " + "\n- ".join(c["afirmacoes_criticas"]))
    linhas = []
    for r in relevantes:
        h = todas[r["id"]]
        res = catalogo.get(r["id"], {}).get("resumo") or texto_puro(h.get("enunciado_html"))[:200]
        linhas.append(f"- {h['banca']} {h['ano']}, questão {h['numero']} ({ROTULO_TIPO[r['tipo']]}): {res} | "
                      f"RESPOSTA OFICIAL: {resposta_correta(h)}")
    partes.append("\nHISTÓRICO FORNECIDO AO AUTOR (questões REAIS do acervo desta banca, de anos anteriores ou "
                  "posteriores; citá-las é correto):\n" + ("\n".join(linhas) if linhas else "(nenhuma)"))
    if evidencias:
        partes.append("\n" + evidencias)
    return "\n".join(partes)


def texto_para_conferir(c, q, problemas_anteriores, reescritas, evidencias=""):
    """Conferência das rodadas 2 e 3: a lista de problemas anteriores (um a um) + as seções reescritas,
    com a correção inteira como contexto."""
    partes = [texto_para_ia(q, com_gabarito=True), "", f"TEMA: {c['tema']}"]
    if c["aviso_diretriz"]:
        partes.append(f"AVISO DE DIRETRIZ: {texto_puro(c['aviso_diretriz'])}")
    for s_ in SECOES_IA:
        marca = "  <<< REESCRITA" if s_ in reescritas else ""
        partes.append(f"\n[{s_}]{marca}\n{texto_puro(re.sub(r'</(p|li|tr)>', ' / ', c['secoes'][s_]))}")
    partes.append("\nPROBLEMAS APONTADOS NA RODADA ANTERIOR (confira um a um, pelo índice):\n"
                  + "\n".join(f"[{k}] seção {p.get('secao', '?')} — {p.get('explicacao', '')}"
                               + (f" (sugestão: {p['correcao_sugerida']})" if p.get("correcao_sugerida") else "")
                               for k, p in enumerate(problemas_anteriores)))
    if evidencias:
        partes.append("\n" + evidencias)
    return "\n".join(partes)


def evidencias_da_web(q, cega, cliente, config):
    """Para questões em que o gabarito oficial diverge da resolução às cegas: busca na web (API de busca do
    DeepSeek) o que as diretrizes dizem hoje e na época da prova. Devolve (bloco de texto, fontes)."""
    bw = config.get("busca_web", {})
    if not bw.get("ativa", True) or not hasattr(cliente, "buscar"):
        return "", []
    x = cliente.json("temas", prompt("consultas_busca.md", config),
                     texto_para_ia(q, com_gabarito=True) + f"\n\nRESOLUÇÃO ÀS CEGAS: {cega.get('alternativa')} — "
                     + str(cega.get("justificativa", ""))[:400])
    consultas = [str(c_)[:110] for c_ in (x.get("consultas") or []) if str(c_).strip()][:bw.get("consultas", 2)]
    vistos, itens = set(), []
    for c_ in consultas:
        for variante in (c_, f"{c_} before:{int(q['ano'][:4])}-12-31" if bw.get("buscar_epoca_da_prova", True) else None):
            if not variante:
                continue
            for it in cliente.buscar(variante, bw.get("resultados_por_busca", 5)):
                if it["url"] in vistos or (it["autoridade"] != -1 and it["autoridade"] < bw.get("autoridade_minima", 2)):
                    continue
                vistos.add(it["url"]); it["epoca"] = "before:" in variante; itens.append(it)
    itens = sorted(itens, key=lambda i: (-i["autoridade"], -float(i["relevancia"] or 0)))[:bw.get("max_fontes", 6)]
    if not itens:
        log("   busca na web: nenhuma fonte confiável encontrada")
        return "", []
    log(f"   busca na web: {len(itens)} fonte(s) para conferir a diretriz ({', '.join(consultas)})")
    linhas = [f"[W{k}] {i['titulo']} — {i['site'] or i['url']} — {i['data'] or 'data desconhecida'}"
              + (f" (publicada até {q['ano'][:4]}: vale para a época da prova)" if i["epoca"] else "")
              + f"\n     {i['url']}\n     {i['resumo'][:700]}" for k, i in enumerate(itens, 1)]
    bloco = ("EVIDÊNCIAS DA WEB sobre a diretriz (resumos de páginas reais; use-as para afirmar o que uma diretriz "
             "recomenda, hoje ou na época da prova; o que não estiver aqui nem for consenso consolidado, não atribua a "
             "nenhuma diretriz):\n" + "\n".join(linhas))
    return bloco, itens





# ------------------------------------------------------------------ uma questão
def premissa_conferida(q, cega, evidencias, cliente, config):
    """Quando o gabarito diverge da resolução às cegas: antes de escrever a correção, uma chamada curta diz qual
    diagnóstico/etiologia/mecanismo leva ao gabarito, e um revisor confere essa premissa. Devolve o texto da
    premissa aprovada (ou None)."""
    txt = (texto_para_ia(q, com_gabarito=True) + f"\n\nRESOLUÇÃO ÀS CEGAS (sem ver o gabarito): {cega.get('alternativa')} — "
           + str(cega.get("justificativa", ""))[:500] + (("\n\n" + evidencias) if evidencias else ""))
    campos = ("raciocinio_da_banca", "por_que_o_gabarito", "por_que_nao_a_alternativa_cega", "mudanca_de_diretriz")
    def texto(p):
        return "\n".join(f"- {k}: {str(p.get(k))[:700]}" for k in campos if p.get(k) not in (None, "", "null"))
    obs, recusa = "", None
    for tentativa in (1, 2):
        p = cliente.json("premissa", prompt("premissa.md", config), txt + obs)
        if not isinstance(p, dict) or not p.get("raciocinio_da_banca"):
            continue
        v = cliente.json("conferir_premissa", prompt("conferir_premissa.md", config), txt + "\n\nPREMISSA PROPOSTA:\n" + texto(p))
        if v.get("correta") is True:
            log(f"   premissa conferida: {str(p['raciocinio_da_banca'])[:140]}")
            return texto(p)
        recusa = v
        log(f"   premissa recusada pelo revisor (tentativa {tentativa}): {str(v.get('problema', ''))[:150]}")
        obs = f"\n\nUM REVISOR RECUSOU SUA PREMISSA ANTERIOR ({texto(p)[:600]}). Motivo: {str(v.get('problema', ''))[:600]}"
    pc = (recusa or {}).get("premissa_corrigida")
    if isinstance(pc, dict) and pc.get("raciocinio_da_banca"):
        log(f"   premissa corrigida pelo revisor: {str(pc['raciocinio_da_banca'])[:140]}")
        return texto(pc)
    log("   premissa não confirmada: a correção será gerada sem ela")
    return None


def gerar_uma(q, todas, catalogo, cliente, config, reportes, recatalogar=None):
    relevantes, meta_hist = relacionadas(q["id"], todas, catalogo, cliente, config, log)
    if recatalogar and relevantes:
        recatalogar([r_["id"] for r_ in relevantes])          # resumo da tabela 2.10 com a resposta oficial
    pt = meta_hist["por_tipo"]
    log(f"   histórico: {meta_hist['questoes_da_banca_avaliadas']} questões avaliadas, "
        f"{meta_hist['candidatas_pela_triagem']} candidatas, {meta_hist['relevantes']} relacionadas "
        f"({pt['mesmo_tema']} mesmo tema, {pt['tema_relacionado']} tema relacionado, {pt['caso_semelhante']} caso semelhante)")

    cega = cliente.json("resolver_as_cegas", prompt("resolver_as_cegas.md", config), texto_para_ia(q, com_gabarito=False))
    alt_cega = str(cega.get("alternativa", "")).strip().upper()[:1]
    discorda = q.get("gabarito") in LETRAS and alt_cega in LETRAS and alt_cega != q["gabarito"]
    log(f"   resolução às cegas: {alt_cega or '?'} (gabarito {q.get('gabarito') or 'anulada'})" + ("  -> DIVERGE" if discorda else ""))

    fontes = "\n".join(f"- {f}" for f in config["fontes_permitidas"])
    base = [texto_para_ia(q, com_gabarito=True)]
    if discorda:
        base.append(f"\nOBSERVAÇÃO: uma resolução independente, sem ver o gabarito, escolheu a alternativa {alt_cega} "
                    f"({str(cega.get('justificativa', ''))[:400]}). Explique com cuidado por que a banca considera "
                    f"{q['gabarito']} correta. Se a divergência se deve a mudança de diretriz, use 'aviso_diretriz'.")
    evidencias, fontes_web = evidencias_da_web(q, cega, cliente, config) if discorda else ("", [])
    if evidencias:
        base.append("\n" + evidencias)
    premissa = premissa_conferida(q, cega, evidencias, cliente, config) if discorda else None
    contexto_revisor = evidencias
    if premissa:
        bloco_p = ("PREMISSA CONFERIDA POR UM REVISOR (o raciocínio que leva ao gabarito). Construa TODA a correção sobre "
                   "ela: não use outro diagnóstico, etiologia ou mecanismo para justificar o gabarito em nenhuma seção.\n" + premissa)
        base.append("\n" + bloco_p)
        contexto_revisor = (evidencias + "\n\n" if evidencias else "") + bloco_p
    if reportes:
        base.append("\nERROS APONTADOS POR ESTUDANTES NA CORREÇÃO ANTERIOR (verifique e corrija se procederem):\n- "
                    + "\n- ".join((str(x.get("texto", x))[:500] + (f" (fonte indicada: {str(x['fonte'])[:200]})" if isinstance(x, dict) and x.get("fonte") else ""))
                                         if isinstance(x, dict) else str(x)[:500] for x in reportes))
    anos = meta_hist.get("anos") or ["?", "?"]
    base.append(f"\nHISTÓRICO — fatos já contados pelo sistema (use estes números, não conte de novo): acervo de "
                f"{meta_hist['provas_no_acervo']} provas da banca ({anos[0]}–{anos[1]}); {meta_hist['relevantes']} questões "
                f"relacionadas, em {meta_hist['provas_com_relacionadas']} provas diferentes "
                f"({pt['mesmo_tema']} do mesmo tema, {pt['tema_relacionado']} de tema relacionado, "
                f"{pt['caso_semelhante']} com caso semelhante). Resumo das principais:\n"
                f"{bloco_para_prompt(relevantes, todas, catalogo, config['historico'].get('max_no_pedido_de_geracao', 15))}")
    base.append(f"\nFONTES PERMITIDAS:\n{fontes}")
    usuario_base = "\n".join(base)

    sistema = prompt("gerar_correcao.md", config)
    qual = config["qualidade"]
    try:
        conf_cega = float(cega.get("confianca") or 0)
    except (TypeError, ValueError):
        conf_cega = 0.0
    lim_conf = qual.get("confianca_para_revisao_sem_raciocinio")
    rev_leve = (not discorda and q.get("gabarito") in LETRAS and alt_cega == q["gabarito"]
                and lim_conf is not None and conf_cega >= float(lim_conf))
    if rev_leve:
        log(f"   revisão sem raciocínio estendido (resolução às cegas concorda, confiança {conf_cega:.2f})")

    def validar_e_completar(r):
        """Valida; se só faltar o parágrafo de alguma alternativa na 2.4, pede SÓ esse parágrafo (barato)."""
        c, problemas = validar(r, q, relevantes, todas, catalogo, config)
        faltam = [m.group(1) for p in problemas for m in [RE_FALTA_ALT.match(p)] if m]
        if faltam and len(faltam) == len(problemas):
            log(f"   2.4 sem a(s) alternativa(s) {', '.join(faltam)}: pedindo só esse(s) parágrafo(s)")
            r = completar_alternativas(r, q, faltam, cliente, config)
            c, problemas = validar(r, q, relevantes, todas, catalogo, config)
        return r, c, problemas

    def gerar_completa(observacoes):
        r, c, problemas = None, None, ["(ainda não gerada)"]
        for tentativa in range(1, qual["tentativas_de_geracao"] + 1):
            r = cliente.json("gerar", sistema, usuario_base + observacoes)
            r, c, problemas = validar_e_completar(r)
            if not problemas:
                break
            log(f"   validação reprovou (tentativa {tentativa}): " + "; ".join(problemas[:4]))
            observacoes = ("\n\nSUA RESPOSTA ANTERIOR FOI RECUSADA PELA VALIDAÇÃO AUTOMÁTICA. Corrija:\n- "
                           + "\n- ".join(problemas))
        return r, c, problemas

    verificacao, c, r, serios = None, None, None, []
    limite, rodada, acumulados = qual["rodadas_de_verificacao"], 0, []
    refazer_tudo, ja_refez = False, False
    while rodada < limite:
        rodada += 1
        conferencia, reescritas, progresso, repetiu = False, [], 0, False
        if r is None:
            r, c, problemas = gerar_completa("")
        elif refazer_tudo:
            log("   o mesmo erro reapareceu depois da correção parcial: refazendo a correção inteira")
            r, c, problemas = gerar_completa("\n\nUM REVISOR MÉDICO REPROVOU AS VERSÕES ANTERIORES. A nova correção não pode "
                                             "conter NENHUM destes erros, em nenhuma seção:\n"
                                             + json.dumps(acumulados[-12:], ensure_ascii=False, indent=1))
            refazer_tudo, ja_refez = False, True
        else:
            # reescreve SÓ as seções apontadas pelo revisor; as aprovadas ficam como estão
            r2, reescritas = corrigir_secoes(r, serios, q, usuario_base, cliente, config)
            r2, c2, problemas = validar_e_completar(r2)
            if problemas:
                log("   correção parcial recusada pela validação (" + "; ".join(problemas[:3]) + "); refazendo a correção inteira")
                r, c, problemas = gerar_completa("\n\nUM REVISOR MÉDICO REPROVOU SUA VERSÃO ANTERIOR. Corrija TODOS estes problemas:\n"
                                                 + json.dumps(serios, ensure_ascii=False, indent=1))
            else:
                r, c, conferencia = r2, c2, True
        if problemas:
            return None, {"motivo": "validacao", "problemas": problemas}, meta_hist
        if conferencia:
            # rodadas 2 e 3: conferência da lista de problemas + seções reescritas (sem raciocínio estendido)
            v = cliente.json("conferir", prompt("conferir_correcao.md", config),
                             texto_para_conferir(c, q, serios, reescritas, contexto_revisor))
            nao_resolvidos = []
            for item in v.get("resolvidos") or []:
                try:
                    k = int(item.get("indice"))
                except (TypeError, ValueError):
                    continue
                if 0 <= k < len(serios) and item.get("resolvido") is True:
                    progresso += 1
                if 0 <= k < len(serios) and item.get("resolvido") is False:
                    p_ = dict(serios[k]); p_["explicacao"] = "NÃO RESOLVIDO: " + str(item.get("comentario") or p_.get("explicacao", ""))
                    nao_resolvidos.append(p_)
            conferidos = {int(i.get("indice")) for i in (v.get("resolvidos") or []) if str(i.get("indice", "")).isdigit()}
            sem_resposta = [dict(serios[k], explicacao="NÃO CONFERIDO: " + str(serios[k].get("explicacao", "")))
                            for k in range(len(serios)) if k not in conferidos]
            novos = [p for p in (v.get("problemas") or []) if isinstance(p, dict)]
            repetiu = bool(nao_resolvidos) or any(p.get("mesmo_erro_de") not in (None, "", "null") for p in novos)
            probs = nao_resolvidos + sem_resposta + novos
        else:
            v = cliente.json("verificar", prompt("verificar.md", config),
                             texto_para_verificar(c, q, relevantes, todas, catalogo, contexto_revisor),
                             raciocinio=False if rev_leve else None)
            probs = [p for p in (v.get("problemas") or []) if isinstance(p, dict)]
        serios = [p for p in probs if str(p.get("gravidade", "")).lower() in ("grave", "moderada")]
        verificacao = {"aprovado": not serios, "rodada": rodada, "modelo": config["modelos"]["verificar"],
                       "tipo": "conferencia" if conferencia else "completa",
                       "problemas_leves": [p for p in probs if p not in serios][:10]}
        if not serios:
            log(f"   verificação: aprovada (rodada {rodada}, {len(probs)} observação(ões) leve(s))")
            break
        acumulados += [p for p in serios if p.get("explicacao") not in {a.get("explicacao") for a in acumulados}]
        if conferencia and repetiu and not ja_refez:
            refazer_tudo = True
        if (rodada == limite and conferencia and (progresso > 0 or refazer_tudo) and limite == qual["rodadas_de_verificacao"]
                and qual.get("rodada_extra_com_progresso", True)):
            limite += 1                                  # só uma rodada extra por questão
            log("   rodada extra: " + ("a correção inteira será refeita e conferida" if refazer_tudo
                                         else f"a última conferência resolveu {progresso} problema(s)"))
        secs = sorted({str(p.get("secao", "?")) for p in serios})
        log(f"   verificação: {len(serios)} problema(s) grave(s)/moderado(s) na última rodada" if rodada >= limite else
            f"   verificação: {len(serios)} problema(s) grave(s)/moderado(s) — " + ("o mesmo erro reapareceu" if refazer_tudo
            else f"corrigindo só a(s) seção(ões) {', '.join(secs)}"))
        for p in serios[:5]:
            log(f"      [{p.get('gravidade')}] {p.get('secao', '?')}: {str(p.get('explicacao', ''))[:150]}")
        verificacao["problemas_serios"] = serios
    if not verificacao or not verificacao["aprovado"]:
        return None, {"motivo": "verificacao", "correcao": c, "verificacao": verificacao}, meta_hist

    secoes = dict(c["secoes"])
    rc = config.get("referencias", {})
    artigos = refs_mod.buscar_artigos(c["busca"], rc.get("artigos_pubmed", 2), rc.get("anos_artigos", 10),
                                      rc.get("intervalo_entre_buscas_s", 0.4), log)
    log(f"   referências: {len(c['livros'])} livro(s), {len(artigos)} artigo(s) do PubMed")
    consultadas = [f for f in fontes_web if f.get("autoridade", -1) >= config.get("busca_web", {}).get("autoridade_para_referencia", 3)][:3]
    secoes["2.15"] = refs_mod.montar_html(c["livros"], artigos, c["busca"], c["tema"].split(":")[-1], consultadas)
    alertas = ["ia_discorda_do_gabarito"] if discorda else []
    entrada = {
        "tema": c["tema"], "aviso_diretriz": c["aviso_diretriz"],
        "gabarito_usado": q.get("gabarito") if q.get("gabarito") in LETRAS else None,
        "secoes_html": secoes, "historico": linhas_da_tabela(relevantes, todas, catalogo), "historico_meta": meta_hist,
        "referencias": {"livros": c["livros"], "busca_pubmed": c["busca"], "artigos": artigos,
                        "fontes_web": [{k: f.get(k) for k in ("titulo", "url", "site", "data", "autoridade")} for f in fontes_web]},
        "afirmacoes_criticas": c["afirmacoes_criticas"],
        "resolucao_cega": {"alternativa": alt_cega or None, "confianca": cega.get("confianca"),
                           "concorda_com_gabarito": None if q.get("gabarito") not in LETRAS else not discorda},
        "verificacao": verificacao,
        "origem": "api_v2", "modelo": config["modelos"]["gerar"],
        "gerado_em": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "revisao": {"status": "nao_revisado", "alertas": alertas, "reportes": [],
                    "reportes_atendidos": list(reportes)},
    }
    return entrada, None, meta_hist


# ------------------------------------------------------------------ seleção de questões
def intervalo(txt):
    nums = set()
    for parte in (txt or "").split(","):
        parte = parte.strip()
        if "-" in parte:
            a, b = parte.split("-", 1); nums.update(range(int(a), int(b) + 1))
        elif parte:
            nums.add(int(parte))
    return nums


def precisa(q, c, modo, forcar):
    if c and c.get("revisao", {}).get("status") == "revisado_humano" and not forcar:
        return False, "revisada por humano (use --forcar)"
    if c and c.get("origem") == "conversa" and c.get("revisao", {}).get("status") not in ("reportado", "regerar") and not forcar:
        return False, "escrita na conversa com o Claude (use --forcar)"
    if modo == "todas":
        return True, "modo todas"
    if not c:
        return True, "sem correção"
    if q.get("gabarito") in LETRAS and c.get("gabarito_usado") and c["gabarito_usado"] != q["gabarito"]:
        return True, "correção contradiz o gabarito"
    if c.get("revisao", {}).get("status") in ("reportado", "regerar"):
        return True, "reportada por usuários"
    if modo == "convertidas" and not str(c.get("origem", "")).startswith("api_"):
        return True, "correção antiga (convertida)"
    return False, "já tem correção"


def escrever_relatorio(pasta, linhas, contador, inicio):
    os.makedirs(pasta, exist_ok=True)
    nome = os.path.join(pasta, f"execucao_{inicio:%Y%m%d_%H%M%S}.md")
    with open(nome, "w", encoding="utf-8") as f:
        f.write(f"# Geração de correções — {inicio:%d/%m/%Y %H:%M} UTC\n\n{contador.resumo()}\n\n")
        if getattr(contador, "por_etapa", None):
            f.write("## Custo por etapa\n\n" + contador.resumo_por_etapa() + "\n\n")
        f.write("| Questão | Resultado | Detalhe |\n|---|---|---|\n")
        for l in linhas:
            f.write(f"| {l[0]} | {l[1]} | {l[2]} |\n")
    return nome


# ------------------------------------------------------------------ comandos
def carregar_config(caminho):
    with open(caminho, encoding="utf-8") as f:
        return json.load(f)


def criar_cliente(args, config, contador):
    if args.simular:
        from simulador import ClienteSimulado
        return ClienteSimulado(config, contador)
    return ClienteAPI(config, contador, log)


# ------------------------------------------------------------------ teto acumulado (dados/gastos.json)
def arq_gastos(dados):
    return os.path.join(dados, "gastos.json")


def ler_gastos(dados, config):
    g = ler_json(arq_gastos(dados), None) or {}
    g.setdefault("formato", "crivo-gastos")
    g.setdefault("teto_usd", config.get("teto_acumulado_usd", 30.0))
    g.setdefault("gasto_usd", 0.0)
    g.setdefault("correcoes_geradas", 0)
    g.setdefault("execucoes", [])
    return g


def orcamento_da_execucao(args, config):
    """Menor valor entre o pedido para esta execução e o que resta do teto acumulado do projeto."""
    pedido = args.orcamento if getattr(args, "orcamento", None) is not None else config["orcamento_usd_por_execucao"]
    if args.simular:
        return pedido
    g = ler_gastos(args.dados, config)
    resta = round(g["teto_usd"] - g["gasto_usd"], 4)
    if resta <= 0.01:
        raise SystemExit(f"ERRO: teto acumulado do projeto atingido (US$ {g['gasto_usd']:.2f} de US$ {g['teto_usd']:.2f}, "
                         f"em {arq_gastos(args.dados)}). Nada foi chamado. Para continuar, aumente 'teto_usd' nesse arquivo.")
    if resta < pedido:
        log(f"Teto acumulado: restam US$ {resta:.2f} de US$ {g['teto_usd']:.2f}; esta execução fica limitada a esse valor.")
    return min(pedido, resta)


def registrar_gasto(args, config, contador, descricao, geradas=0):
    if args.simular or (contador.custo <= 0 and not geradas):
        return
    g = ler_gastos(args.dados, config)
    g["gasto_usd"] = round(g["gasto_usd"] + contador.custo, 4)
    g["correcoes_geradas"] += geradas
    g["execucoes"].append({"data": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
                           "acao": descricao, "custo_usd": round(contador.custo, 4), "chamadas": contador.chamadas})
    gravar_json(arq_gastos(args.dados), g)
    log(f"Gasto acumulado do projeto: US$ {g['gasto_usd']:.2f} de US$ {g['teto_usd']:.2f}.")


def cmd_modelos(args, config):
    c = ClienteAPI(config, Contador(config, 0), log)
    log("Modelos disponíveis na sua conta:")
    for m in c.listar_modelos():
        log(f"  - {m}")
    log("Ajuste os nomes em ferramentas/config_gerador.json -> \"modelos\" e \"precos_usd_por_milhao_fora_do_pico\".")


def cmd_catalogar(args, config):
    contador = Contador(config, orcamento_da_execucao(args, config))
    cliente = criar_cliente(args, config, contador)
    try:
        atualizar_catalogo(args.dados, args.banca, cliente, config, log)
    except OrcamentoEsgotado as e:
        log(f"\nPARADO: {e}. O que já foi catalogado está gravado; rode de novo para continuar."); return 3
    finally:
        log(contador.resumo())
        registrar_gasto(args, config, contador, f"catalogar {args.banca}")


def cmd_temas_padrao(args, config):
    """Catálogo com a resposta oficial (todas as bancas) + lista fixa de temas por disciplina + tema de cada
    questão, em dados/temas_padrao.json (usado pelo site: filtro por tema, desempenho e pontos fracos)."""
    import temas_padrao
    contador = Contador(config, orcamento_da_execucao(args, config))
    cliente = criar_cliente(args, config, contador)
    try:
        temas_padrao.gerar(args.dados, cliente, config, log, refazer_listas=args.refazer_listas)
    except OrcamentoEsgotado as e:
        log(f"\nPARADO: {e}. O que já foi feito está gravado; rode de novo para continuar."); return 3
    finally:
        log(contador.resumo())
        if contador.por_etapa:
            log("Custo por etapa:\n" + contador.resumo_por_etapa())
        registrar_gasto(args, config, contador, "temas-padrao")
    return 0


def cmd_atualizar_referencias(args, config):
    """Refaz só a seção 2.15 das correções já geradas pela API, com artigos reais do PubMed. Não usa a IA."""
    rc = config.get("referencias", {})
    permitidas = {f.lower(): f for f in config["fontes_permitidas"]}
    total = 0
    for b, ano in listar_edicoes(args.dados, args.banca):
        cs = ler_correcoes(args.dados, b, ano)
        mudou = False
        for qid, c in cs["correcoes"].items():
            if not str(c.get("origem", "")).startswith("api_"):
                continue
            r = c.get("referencias") or {}
            if isinstance(r, list):          # formato da primeira versão
                livros = [{"fonte": permitidas[x["fonte"].lower()], "secao": x.get("detalhe", "")}
                          for x in r if isinstance(x, dict) and str(x.get("fonte", "")).lower() in permitidas]
                busca = next((x.get("busca") for x in r if isinstance(x, dict) and x.get("busca")), "")
            else:
                livros, busca = r.get("livros", []), r.get("busca_pubmed", "")
            if not busca:
                busca = c.get("tema", "").split(":")[-1]
            artigos = refs_mod.buscar_artigos(busca, rc.get("artigos_pubmed", 2), rc.get("anos_artigos", 10),
                                              rc.get("intervalo_entre_buscas_s", 0.4), log)
            c["referencias"] = {"livros": livros, "busca_pubmed": busca, "artigos": artigos}
            c["secoes_html"]["2.15"] = refs_mod.montar_html(livros, artigos, busca, c.get("tema", "").split(":")[-1])
            mudou = True; total += 1
            log(f"{qid}: {len(livros)} livro(s), {len(artigos)} artigo(s)")
        if mudou:
            gravar_json(arq_correcoes(args.dados, b, ano), cs)
    log(f"Referências refeitas em {total} correção(ões), sem custo de API.")
    return 0


def cmd_inserir_manual(args, config):
    """Grava uma correção escrita na conversa com o Claude (arquivo em correcoes_manuais/). Passa pela mesma
    validação das correções da API; o histórico (2.10) é montado com as questões listadas no arquivo e a 2.15
    com os livros, os artigos reais do PubMed e as fontes consultadas. Não usa a API do DeepSeek."""
    m = ler_json(args.arquivo, None)
    if not isinstance(m, dict) or not m.get("id"):
        log(f"ERRO: {args.arquivo} não é um arquivo de correção manual válido."); return 1
    todas = questoes_da_banca(args.dados, m["id"].split("-")[0])
    q = todas.get(m["id"])
    if not q:
        log(f"ERRO: {m['id']} não existe em questoes.json."); return 1
    if m.get("gabarito_conferido") != q.get("gabarito"):
        log(f"ERRO: o arquivo foi escrito para o gabarito {m.get('gabarito_conferido')}, mas questoes.json diz {q.get('gabarito')}."); return 1
    catalogo = ler_json(arq_temas(args.dados, q["banca"]), {"questoes": {}}).get("questoes", {})
    relevantes = []
    for x in m.get("historico") or []:
        if x.get("id") not in todas or x.get("tipo") not in ORDEM_TIPO:
            log(f"ERRO: questão do histórico inválida: {x}"); return 1
        relevantes.append({"id": x["id"], "tipo": x["tipo"], "motivo": str(x.get("motivo", ""))[:200]})
    relevantes.sort(key=lambda r: (ORDEM_TIPO[r["tipo"]], todas[r["id"]]["ano"], todas[r["id"]]["numero"]))
    c, problemas = validar(m, q, relevantes, todas, catalogo, config)
    if problemas:
        log("ERRO: a correção não passou na validação:\n- " + "\n- ".join(problemas)); return 1
    anos = sorted({todas[i]["ano"] for i in todas if todas[i]["banca"] == q["banca"]})
    meta = {"metodo": "escolhidas_na_conversa", "questoes_da_banca_avaliadas": None, "candidatas_pela_triagem": None,
            "relevantes": len(relevantes), "triagem_truncada": False, "provas_no_acervo": len(anos),
            "anos": [anos[0], anos[-1]] if anos else None,
            "provas_com_relacionadas": len({todas[r["id"]]["ano"] for r in relevantes}),
            "por_tipo": {t: sum(1 for r in relevantes if r["tipo"] == t) for t in ORDEM_TIPO}}
    rc = config.get("referencias", {})
    artigos = refs_mod.buscar_artigos(c["busca"], rc.get("artigos_pubmed", 2), rc.get("anos_artigos", 10),
                                      rc.get("intervalo_entre_buscas_s", 0.4), log)
    fontes = [{k: f.get(k) for k in ("titulo", "url", "site", "data")} for f in (m.get("fontes_consultadas") or [])
              if isinstance(f, dict) and str(f.get("url", "")).startswith("https://") and f.get("titulo")]
    secoes = dict(c["secoes"])
    secoes["2.15"] = refs_mod.montar_html(c["livros"], artigos, c["busca"], c["tema"].split(":")[-1], fontes)
    resumos = {x["id"]: str(x["resumo"])[:300] for x in m.get("historico") or [] if x.get("resumo")}
    linhas = linhas_da_tabela(relevantes, todas, catalogo)
    for l in linhas:                        # resumo escrito na conversa tem prioridade sobre o do catálogo
        l["resumo"] = resumos.get(l["id"], l["resumo"])
    entrada = {
        "tema": c["tema"], "aviso_diretriz": c["aviso_diretriz"], "gabarito_usado": q.get("gabarito"),
        "secoes_html": secoes, "historico": linhas, "historico_meta": meta,
        "referencias": {"livros": c["livros"], "busca_pubmed": c["busca"], "artigos": artigos, "fontes_web": fontes},
        "afirmacoes_criticas": c["afirmacoes_criticas"],
        "resolucao_cega": None, "verificacao": {"aprovado": True, "tipo": "conversa", "observacao": m.get("observacao", "")},
        "origem": "conversa", "modelo": str(m.get("modelo") or "claude (conversa)"),
        "gerado_em": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "revisao": {"status": "nao_revisado", "alertas": [], "reportes": [], "reportes_atendidos": []},
    }
    cs = ler_correcoes(args.dados, q["banca"], q["ano"])
    cs["correcoes"][q["id"]] = entrada
    gravar_json(arq_correcoes(args.dados, q["banca"], q["ano"]), cs)
    reprovada = os.path.join(args.relatorios, "reprovadas", f"{q['id']}.json")
    if os.path.isfile(reprovada):
        os.remove(reprovada)
    log(f"{q['id']} gravada em correcoes.json ({len(relevantes)} questões no histórico, {len(artigos)} artigo(s) do PubMed, "
        f"{len(fontes)} fonte(s) consultada(s)). Sem custo de API.")
    return 0


def cmd_amostra(args, config):
    """Junta num arquivo as correções sorteadas para conferência humana (1 a cada 50), para enviar ao Claude
    numa conversa. Com --conferidas ID ..., marca essas como conferidas."""
    pendentes, marcadas = [], 0
    for b, ano in listar_edicoes(args.dados, args.banca):
        cs = ler_correcoes(args.dados, b, ano)
        qs = {q["id"]: dict(q, banca=b, ano=str(ano)) for q in ler_questoes(args.dados, b, ano)["questoes"]}
        mudou = False
        for qid, c in cs["correcoes"].items():
            rev = c.get("revisao") or {}
            if rev.get("amostra") != "pendente":
                continue
            if args.conferidas and qid in args.conferidas:
                rev["amostra"] = "conferida"; mudou = True; marcadas += 1
                continue
            pendentes.append((qs[qid], c))
        if mudou:
            gravar_json(arq_correcoes(args.dados, b, ano), cs)
    if marcadas:
        log(f"{marcadas} correção(ões) marcadas como conferidas.")
    os.makedirs(args.relatorios, exist_ok=True)
    caminho = os.path.join(args.relatorios, f"amostra_{args.banca}.md")
    partes = [f"# Amostra para conferência — {args.banca}", "",
              "Envie este arquivo ao Claude numa conversa e peça: \"confira estas correções do CRIVO; aponte erros "
              "factuais e devolva o texto corrigido de cada seção com problema\".", ""]
    for q, c in pendentes:
        partes += [f"## {q['id']} (gabarito oficial: {q.get('gabarito') or 'anulada'})", "",
                   texto_para_ia(q, com_gabarito=True), ""]
        for n in sorted(c.get("secoes_html", {}), key=lambda x: int(x.split(".")[1])):
            partes += [f"**{n}**", texto_puro(re.sub(r"</(p|li|tr)>", "\n", c["secoes_html"][n])), ""]
    # questões reprovadas pelo revisor em todas as rodadas: para corrigir na conversa
    pasta_rep = os.path.join(args.relatorios, "reprovadas")
    reprovadas = sorted(f for f in (os.listdir(pasta_rep) if os.path.isdir(pasta_rep) else [])
                        if f.startswith(args.banca + "-") and f.endswith(".json"))
    if reprovadas:
        partes += ["", "# Reprovadas pelo revisor (não publicadas)", "",
                   "Para cada uma: corrija os problemas apontados e devolva a correção completa (seções 2.1 a 2.14).", ""]
    todas_q = questoes_da_banca(args.dados, args.banca)
    for f in reprovadas:
        qid = f[:-5]
        rep = ler_json(os.path.join(pasta_rep, f), {}) or {}
        q = todas_q.get(qid)
        if not q:
            continue
        partes += [f"## {qid} — reprovada na {rep.get('motivo', '?')} (gabarito oficial: {q.get('gabarito') or 'anulada'})", "",
                   texto_para_ia(q, com_gabarito=True), ""]
        probs = ((rep.get("verificacao") or {}).get("problemas_serios")) or [{"explicacao": p} for p in rep.get("problemas", [])]
        partes += ["**Problemas apontados:**", *[f"- [{p.get('gravidade', '')}] {p.get('secao', '')}: {p.get('explicacao', '')}"
                                                 + (f" Sugestão: {p['correcao_sugerida']}" if p.get("correcao_sugerida") else "")
                                                 for p in probs], ""]
        cr = rep.get("correcao") or {}
        if cr.get("aviso_diretriz"):
            partes += [f"**Aviso de diretriz:** {texto_puro(cr['aviso_diretriz'])}", ""]
        for n in sorted(cr.get("secoes", {}), key=lambda x: int(x.split(".")[1])):
            partes += [f"**{n}**", texto_puro(re.sub(r"</(p|li|tr)>", "\n", cr["secoes"][n])), ""]
    with open(caminho, "w", encoding="utf-8") as f:
        f.write("\n".join(partes) + "\n")
    log(f"{len(pendentes)} correção(ões) da amostra e {len(reprovadas)} reprovada(s) em {caminho}")
    return 0


def cmd_gerar(args, config):
    inicio = dt.datetime.now(dt.timezone.utc)
    if args.nao_esperar_pico and args.simular:
        config["esperar_fora_do_pico"] = False
    contador = Contador(config, orcamento_da_execucao(args, config))
    cliente = criar_cliente(args, config, contador)
    edicoes = [a for b, a in listar_edicoes(args.dados, args.banca) if not args.ano or a in args.ano]
    if not edicoes:
        log("Nenhuma edição encontrada com esses filtros."); return 1
    nums = intervalo(args.questoes)
    fila = []
    for ano in edicoes:
        qs = ler_questoes(args.dados, args.banca, ano)
        cs = ler_correcoes(args.dados, args.banca, ano)["correcoes"]
        for q in qs["questoes"]:
            if nums and q["numero"] not in nums:
                continue
            tem_figura = "<img" in (q.get("extras_html") or "") + (q.get("enunciado_html") or "")
            if (q.get("imagem_pendente") or tem_figura) and not args.incluir_com_imagem:
                motivo_img = "imagem pendente" if q.get("imagem_pendente") else "tem figura que o modelo de texto não vê"
                log(f"PULADA {q['id']}: {motivo_img} (use --incluir-com-imagem para gerar mesmo assim)"); continue
            ok, motivo = precisa(q, cs.get(q["id"]), "todas" if nums else args.modo, args.forcar)
            if ok:
                fila.append((ano, q["id"], motivo))
    if args.limite:
        fila = fila[:args.limite]
    log(f"{len(fila)} questão(ões) na fila. Orçamento desta execução: US$ {contador.orcamento:.2f}.")
    if not fila:
        return 0
    if not args.simular:
        cliente.testar(["temas", "relevancia", "resolver_as_cegas", "gerar", "verificar"])
    todas = questoes_da_banca(args.dados, args.banca)
    linhas, saida, geradas = [], 0, 0
    ja_geradas = ler_gastos(args.dados, config)["correcoes_geradas"]
    try:
        catalogo = atualizar_catalogo(args.dados, args.banca, cliente, config, log)["questoes"]
        log(f"Catálogo de temas pronto: {len(catalogo)} questões.")
        for k, (ano, qid, motivo) in enumerate(fila, 1):
            contador.checar()          # o orçamento só impede COMEÇAR uma questão; a começada vai até o fim
            q = todas[qid]
            log(f"\n[{k}/{len(fila)}] {qid} ({motivo}) — custo até agora US$ {contador.custo:.4f}")
            cs_arq = ler_correcoes(args.dados, args.banca, ano)
            antiga = cs_arq["correcoes"].get(qid)
            reportes = (antiga or {}).get("revisao", {}).get("reportes", []) if antiga else []
            def recatalogar(ids):
                catalogo.update(atualizar_catalogo(args.dados, args.banca, cliente, config, log, ids=ids,
                                                   com_gabarito=True)["questoes"])
            try:
                recatalogar([qid])                 # temas da questão atual descritos pela resposta oficial
                entrada, falha, _ = gerar_uma(q, todas, catalogo, cliente, config, reportes, recatalogar)
            except ErroAPI as e:
                log(f"   ERRO: {e}"); linhas.append((qid, "erro", str(e)[:120])); saida = 2; continue
            if entrada:
                geradas += 1
                if (ja_geradas + geradas) % config.get("amostra_a_cada", 50) == 1:
                    entrada["revisao"]["amostra"] = "pendente"      # 1 a cada 50: conferida na conversa
                    log("   (escolhida para a amostra de conferência humana)")
                cs_arq = ler_correcoes(args.dados, args.banca, ano)   # relê: outra etapa pode ter gravado
                cs_arq["correcoes"][qid] = entrada
                gravar_json(arq_correcoes(args.dados, args.banca, ano), cs_arq)
                linhas.append((qid, "publicada", f"{entrada['historico_meta']['relevantes']} relacionadas no histórico"
                               + ("; IA discordou do gabarito" if entrada["revisao"]["alertas"] else "")))
                log("   GRAVADA em correcoes.json")
                antiga_reprovada = os.path.join(args.relatorios, "reprovadas", f"{qid}.json")
                if os.path.isfile(antiga_reprovada):
                    os.remove(antiga_reprovada)                    # foi publicada: sai da lista de reprovadas
            else:
                pasta = os.path.join(args.relatorios, "reprovadas"); os.makedirs(pasta, exist_ok=True)
                gravar_json(os.path.join(pasta, f"{qid}.json"), falha)
                linhas.append((qid, "NÃO publicada", f"reprovada na {falha['motivo']}; ver relatorios/reprovadas/{qid}.json"))
                log("   NÃO publicada (correção anterior mantida). Detalhes em relatorios/reprovadas/")
                saida = 2
    except OrcamentoEsgotado as e:
        log(f"\nPARADO: {e}. Rode de novo para continuar de onde parou."); saida = 3
    finally:
        log("\n" + contador.resumo())
        if contador.por_etapa:
            log("Custo por etapa:\n" + contador.resumo_por_etapa())
        registrar_gasto(args, config, contador, f"gerar {args.banca} {' '.join(args.ano or [])} {args.questoes or args.modo}".strip(),
                        geradas)
        if linhas:
            log(f"Relatório: {escrever_relatorio(args.relatorios, linhas, contador, inicio)}")
    return saida


def main():
    ap = argparse.ArgumentParser(description="Gerador de correções do CRIVO")
    ap.add_argument("--dados", default="dados")
    ap.add_argument("--config", default=os.path.join(AQUI, "config_gerador.json"))
    ap.add_argument("--relatorios", default="relatorios")
    ap.add_argument("--simular", action="store_true", help="não chama a API (teste do fluxo)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("modelos", help="lista os modelos disponíveis na sua conta")
    ar = sub.add_parser("atualizar-referencias", help="refaz a seção 2.15 com artigos reais do PubMed (sem IA)")
    ar.add_argument("--banca", required=True)
    am = sub.add_parser("amostra", help="arquivo com as correções sorteadas para conferência humana")
    am.add_argument("--banca", required=True); am.add_argument("--conferidas", nargs="*", default=[])
    im = sub.add_parser("inserir-manual", help="grava uma correção escrita na conversa (correcoes_manuais/*.json)")
    im.add_argument("--arquivo", required=True)
    tp = sub.add_parser("temas-padrao", help="catálogo com gabarito + lista fixa de temas + tema de cada questão (todas as bancas)")
    tp.add_argument("--orcamento", type=float); tp.add_argument("--refazer-listas", action="store_true")
    c = sub.add_parser("catalogar", help="cataloga os temas de todas as questões da banca")
    c.add_argument("--banca", required=True); c.add_argument("--orcamento", type=float)
    g = sub.add_parser("gerar", help="gera correções")
    g.add_argument("--banca", required=True)
    g.add_argument("--ano", nargs="*", help="uma ou mais edições (padrão: todas)")
    g.add_argument("--questoes", help="ex.: 50  ou  1-10,15  (ignora --modo: gera essas questões)")
    g.add_argument("--modo", choices=["pendentes", "convertidas", "todas"], default="pendentes",
                   help="pendentes = sem correção, contradiz gabarito ou reportada; convertidas = também as antigas")
    g.add_argument("--limite", type=int, help="no máximo N questões nesta execução")
    g.add_argument("--orcamento", type=float, help="teto de custo em US$ desta execução")
    g.add_argument("--forcar", action="store_true", help="também refaz correções revisadas por humanos")
    g.add_argument("--incluir-com-imagem", action="store_true")
    g.add_argument("--nao-esperar-pico", action="store_true")
    args = ap.parse_args()
    config = carregar_config(args.config)
    try:
        if args.cmd == "modelos":
            return cmd_modelos(args, config) or 0
        if args.cmd == "temas-padrao":
            return cmd_temas_padrao(args, config)
        if args.cmd == "catalogar":
            return cmd_catalogar(args, config) or 0
        if args.cmd == "amostra":
            return cmd_amostra(args, config)
        if args.cmd == "inserir-manual":
            return cmd_inserir_manual(args, config)
        if args.cmd == "atualizar-referencias":
            return cmd_atualizar_referencias(args, config)
        return cmd_gerar(args, config)
    except ErroAPI as e:
        log(f"ERRO: {e}"); return 2


if __name__ == "__main__":
    sys.exit(main())
