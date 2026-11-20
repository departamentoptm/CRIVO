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
import urllib.parse

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from crivo_comum import (gravar_json, ler_questoes, ler_correcoes, arq_correcoes, limpar_html,
                         texto_puro, listar_edicoes, LETRAS)
from historico import (prompt, questoes_da_banca, atualizar_catalogo, relacionadas, bloco_para_prompt)
from ia_cliente import (ClienteAPI, Contador, OrcamentoEsgotado, ErroAPI, esperar_fora_do_pico,
                        em_horario_de_pico)

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
    if q.get("imagem_pendente"):
        partes.append("[Esta questão depende de uma imagem que não está disponível. Não descreva a imagem.]")
    if com_gabarito:
        g = q.get("gabarito")
        partes.append(f"GABARITO OFICIAL: {'alternativa ' + g if g in LETRAS else 'QUESTÃO ANULADA pela banca'}")
    return "\n".join(partes)


# ------------------------------------------------------------------ validação
def _sem_links(h):
    return re.sub(r"</?a\b[^>]*>", "", h or "")


def validar(r, q, relevantes, todas, catalogo, config):
    """Devolve (correcao_normalizada, problemas). Problemas fazem a geração ser refeita."""
    problemas = []
    qual = config["qualidade"]
    secoes_in = r.get("secoes") if isinstance(r.get("secoes"), dict) else {}
    secoes, total = {}, 0
    for s in SECOES_IA:
        h = _sem_links(limpar_html(str(secoes_in.get(s) or "")))
        n = len(texto_puro(h))
        total += n
        minimo = qual["min_caracteres_por_secao"].get(s, 100)
        if n < minimo:
            problemas.append(f"seção {s} curta ou ausente ({n} caracteres; mínimo {minimo})")
        secoes[s] = h
    if total < qual["min_caracteres_total"]:
        problemas.append(f"correção curta no total ({total} caracteres; mínimo {qual['min_caracteres_total']})")
    g = q.get("gabarito")
    t23, t24 = texto_puro(secoes["2.3"]), texto_puro(secoes["2.4"])
    if g in LETRAS and not re.search(rf"\b{g}\b", t23):
        problemas.append(f"a seção 2.3 não cita a alternativa do gabarito ({g})")
    for l in (q.get("alternativas") or {}):
        if not re.search(rf"Alternativa\s+{l}\b", t24):
            problemas.append(f"a seção 2.4 não analisa a alternativa {l}")
    if "<table" not in secoes["2.8"]:
        problemas.append("a seção 2.8 deve conter a tabela de diagnósticos diferenciais")
    if "<table" in secoes["2.10"]:
        secoes["2.10"] = re.sub(r"<table.*?</table>", "", secoes["2.10"], flags=re.S)  # a tabela é do script

    # histórico: só ids reais e relevantes; os que a IA esquecer entram pelos dados do catálogo
    rel = {x["id"]: x["motivo"] for x in relevantes}
    linhas, vistos = [], set()
    for h in r.get("historico") or []:
        if not isinstance(h, dict) or h.get("id") not in rel or h["id"] in vistos:
            continue
        vistos.add(h["id"])
        linhas.append((h["id"], str(h.get("resumo", ""))[:400], str(h.get("cobrado", ""))[:120], str(h.get("relacao", ""))[:400]))
    for i in rel:
        if i not in vistos:
            c = catalogo.get(i, {})
            linhas.append((i, c.get("resumo", ""), c.get("abordagem", ""), rel[i]))
    historico = []
    for i, resumo, cobrado, relacao in sorted(linhas, key=lambda x: (todas[x[0]]["ano"], todas[x[0]]["numero"])):
        hq = todas[i]
        historico.append({"id": i, "ano": hq["ano"], "numero": hq["numero"],
                          "gabarito": hq.get("gabarito") if hq.get("gabarito") in LETRAS else None,
                          "resumo": resumo, "cobrado": cobrado, "relacao": relacao})

    # referências: só fontes permitidas; links de PESQUISA montados pelo script (nunca links da IA)
    permitidas = {f.lower(): f for f in config["fontes_permitidas"]}
    refs = []
    for x in r.get("referencias") or []:
        if not isinstance(x, dict):
            continue
        fonte = permitidas.get(str(x.get("fonte", "")).strip().lower())
        if fonte:
            refs.append({"fonte": fonte, "detalhe": str(x.get("detalhe", ""))[:200],
                         "busca": re.sub(r"[^\w\s\-\"()]", " ", str(x.get("busca", "")))[:150].strip()})
    if not refs:
        problemas.append("nenhuma referência da lista de fontes permitidas")

    tema = str(r.get("tema") or "").strip()[:150]
    if not tema:
        problemas.append("campo 'tema' vazio")
    aviso = r.get("aviso_diretriz")
    aviso = limpar_html(str(aviso))[:800] if aviso not in (None, "", "null") else None
    afirm = [str(a)[:400] for a in (r.get("afirmacoes_criticas") or []) if a][:10]
    return {"tema": tema, "aviso_diretriz": aviso, "secoes": secoes, "historico": historico,
            "referencias": refs, "afirmacoes_criticas": afirm}, problemas


def html_referencias(refs):
    out = []
    for n, x in enumerate(refs, 1):
        termo = x["busca"]
        link = ""
        if termo:
            if x["fonte"] == "Cochrane Library":
                termo = f'({termo}) AND "Cochrane Database Syst Rev"[Journal]'
            url = "https://pubmed.ncbi.nlm.nih.gov/?term=" + urllib.parse.quote(termo)
            link = f' <a href="{url}">Pesquisar o tema no PubMed</a>'
        det = f" — {limpar_html(x['detalhe'])}" if x["detalhe"] else ""
        out.append(f"<p>{n}. <strong>{limpar_html(x['fonte'])}</strong>{det}.{link}</p>")
    out.append("<p><em>Os links abrem uma pesquisa sobre o tema no PubMed, não um artigo específico. "
               "Confira sempre a edição mais recente da fonte.</em></p>")
    return "".join(out)


def texto_para_verificar(c, q):
    partes = [texto_para_ia(q, com_gabarito=True), "", f"TEMA: {c['tema']}"]
    if c["aviso_diretriz"]:
        partes.append(f"AVISO DE DIRETRIZ: {texto_puro(c['aviso_diretriz'])}")
    for s in SECOES_IA:
        partes.append(f"\n[{s}]\n{texto_puro(re.sub(r'</(p|li|tr)>', ' / ', c['secoes'][s]))}")
    if c["afirmacoes_criticas"]:
        partes.append("\nAFIRMAÇÕES CENTRAIS DECLARADAS PELO AUTOR:\n- " + "\n- ".join(c["afirmacoes_criticas"]))
    return "\n".join(partes)


# ------------------------------------------------------------------ uma questão
def gerar_uma(q, todas, catalogo, cliente, config, reportes):
    relevantes, meta_hist = relacionadas(q["id"], todas, catalogo, cliente, config, log)
    log(f"   histórico: {meta_hist['questoes_da_banca_avaliadas']} questões avaliadas, "
        f"{meta_hist['candidatas_pela_triagem']} candidatas, {meta_hist['relevantes']} do mesmo tema")

    cega = cliente.json("resolver_as_cegas", prompt("resolver_as_cegas.md"), texto_para_ia(q, com_gabarito=False))
    alt_cega = str(cega.get("alternativa", "")).strip().upper()[:1]
    discorda = q.get("gabarito") in LETRAS and alt_cega in LETRAS and alt_cega != q["gabarito"]
    log(f"   resolução às cegas: {alt_cega or '?'} (gabarito {q.get('gabarito') or 'anulada'})" + ("  -> DIVERGE" if discorda else ""))

    fontes = "\n".join(f"- {f}" for f in config["fontes_permitidas"])
    base = [texto_para_ia(q, com_gabarito=True)]
    if discorda:
        base.append(f"\nOBSERVAÇÃO: uma resolução independente, sem ver o gabarito, escolheu a alternativa {alt_cega} "
                    f"({str(cega.get('justificativa', ''))[:400]}). Explique com cuidado por que a banca considera "
                    f"{q['gabarito']} correta. Se a divergência se deve a mudança de diretriz, use 'aviso_diretriz'.")
    if reportes:
        base.append("\nERROS APONTADOS POR ESTUDANTES NA CORREÇÃO ANTERIOR (verifique e corrija se procederem):\n- "
                    + "\n- ".join(str(x.get("texto", x))[:500] for x in reportes))
    base.append(f"\nHISTÓRICO (questões desta banca sobre o mesmo tema; avaliadas "
                f"{meta_hist['questoes_da_banca_avaliadas']} questões):\n{bloco_para_prompt(relevantes, todas)}")
    base.append(f"\nFONTES PERMITIDAS:\n{fontes}")
    usuario_base = "\n".join(base)

    sistema = prompt("gerar_correcao.md")
    qual = config["qualidade"]
    observacoes, verificacao, c = "", None, None
    for rodada in range(1, qual["rodadas_de_verificacao"] + 1):
        problemas = ["(ainda não gerada)"]
        for tentativa in range(1, qual["tentativas_de_geracao"] + 1):
            r = cliente.json("gerar", sistema, usuario_base + observacoes)
            c, problemas = validar(r, q, relevantes, todas, catalogo, config)
            if not problemas:
                break
            log(f"   validação reprovou (tentativa {tentativa}): " + "; ".join(problemas[:4]))
            observacoes = ("\n\nSUA RESPOSTA ANTERIOR FOI RECUSADA PELA VALIDAÇÃO AUTOMÁTICA. Corrija:\n- "
                           + "\n- ".join(problemas))
        if problemas:
            return None, {"motivo": "validacao", "problemas": problemas}, meta_hist
        v = cliente.json("verificar", prompt("verificar.md"), texto_para_verificar(c, q))
        probs = [p for p in (v.get("problemas") or []) if isinstance(p, dict)]
        serios = [p for p in probs if str(p.get("gravidade", "")).lower() in ("grave", "moderada")]
        verificacao = {"aprovado": not serios, "rodada": rodada, "modelo": config["modelos"]["verificar"],
                       "problemas_leves": [p for p in probs if p not in serios][:10]}
        if not serios:
            log(f"   verificação: aprovada (rodada {rodada}, {len(probs)} observação(ões) leve(s))")
            break
        log(f"   verificação: {len(serios)} problema(s) grave(s)/moderado(s) — refazendo")
        for p in serios[:5]:
            log(f"      [{p.get('gravidade')}] {p.get('secao', '?')}: {str(p.get('explicacao', ''))[:150]}")
        observacoes = ("\n\nUM REVISOR MÉDICO REPROVOU SUA VERSÃO ANTERIOR. Corrija TODOS estes problemas:\n"
                       + json.dumps(serios, ensure_ascii=False, indent=1))
        verificacao["problemas_serios"] = serios
    if not verificacao or not verificacao["aprovado"]:
        return None, {"motivo": "verificacao", "correcao": c, "verificacao": verificacao}, meta_hist

    secoes = dict(c["secoes"])
    secoes["2.10"] = (f"<p><em>Busca no acervo: {meta_hist['questoes_da_banca_avaliadas']} questões da banca "
                      f"{q['banca']} avaliadas; {meta_hist['relevantes']} tratam do mesmo tema "
                      f"(listadas na tabela acima).</em></p>" + secoes["2.10"])
    secoes["2.15"] = html_referencias(c["referencias"])
    alertas = ["ia_discorda_do_gabarito"] if discorda else []
    entrada = {
        "tema": c["tema"], "aviso_diretriz": c["aviso_diretriz"],
        "gabarito_usado": q.get("gabarito") if q.get("gabarito") in LETRAS else None,
        "secoes_html": secoes, "historico": c["historico"], "historico_meta": meta_hist,
        "referencias": c["referencias"], "afirmacoes_criticas": c["afirmacoes_criticas"],
        "resolucao_cega": {"alternativa": alt_cega or None, "confianca": cega.get("confianca"),
                           "concorda_com_gabarito": None if q.get("gabarito") not in LETRAS else not discorda},
        "verificacao": verificacao,
        "origem": "api_v1", "modelo": config["modelos"]["gerar"],
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
    if modo == "todas":
        return True, "modo todas"
    if not c:
        return True, "sem correção"
    if q.get("gabarito") in LETRAS and c.get("gabarito_usado") and c["gabarito_usado"] != q["gabarito"]:
        return True, "correção contradiz o gabarito"
    if c.get("revisao", {}).get("status") in ("reportado", "regerar"):
        return True, "reportada por usuários"
    if modo == "convertidas" and c.get("origem") != "api_v1":
        return True, "correção antiga (convertida)"
    return False, "já tem correção"


def escrever_relatorio(pasta, linhas, contador, inicio):
    os.makedirs(pasta, exist_ok=True)
    nome = os.path.join(pasta, f"execucao_{inicio:%Y%m%d_%H%M%S}.md")
    with open(nome, "w", encoding="utf-8") as f:
        f.write(f"# Geração de correções — {inicio:%d/%m/%Y %H:%M} UTC\n\n{contador.resumo()}\n\n")
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


def cmd_modelos(args, config):
    c = ClienteAPI(config, Contador(config, 0), log)
    log("Modelos disponíveis na sua conta:")
    for m in c.listar_modelos():
        log(f"  - {m}")
    log("Ajuste os nomes em ferramentas/config_gerador.json -> \"modelos\" e \"precos_usd_por_milhao_fora_do_pico\".")


def cmd_catalogar(args, config):
    contador = Contador(config, args.orcamento if args.orcamento is not None else config["orcamento_usd_por_execucao"])
    cliente = criar_cliente(args, config, contador)
    try:
        atualizar_catalogo(args.dados, args.banca, cliente, config, log)
    finally:
        log(contador.resumo())


def cmd_gerar(args, config):
    inicio = dt.datetime.now(dt.timezone.utc)
    if args.nao_esperar_pico:
        config["esperar_fora_do_pico"] = False
    contador = Contador(config, args.orcamento if args.orcamento is not None else config["orcamento_usd_por_execucao"])
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
            if q.get("imagem_pendente") and not args.incluir_com_imagem:
                log(f"PULADA {q['id']}: imagem pendente (adicione a imagem ou use --incluir-com-imagem)"); continue
            ok, motivo = precisa(q, cs.get(q["id"]), "todas" if nums else args.modo, args.forcar)
            if ok:
                fila.append((ano, q["id"], motivo))
    if args.limite:
        fila = fila[:args.limite]
    log(f"{len(fila)} questão(ões) na fila. Orçamento desta execução: US$ {contador.orcamento:.2f}.")
    if not fila:
        return 0
    if not args.simular:
        pico, _ = em_horario_de_pico(config)
        if pico:
            esperar_fora_do_pico(config, log)

    todas = questoes_da_banca(args.dados, args.banca)
    linhas, saida = [], 0
    try:
        catalogo = atualizar_catalogo(args.dados, args.banca, cliente, config, log)["questoes"]
        for k, (ano, qid, motivo) in enumerate(fila, 1):
            q = todas[qid]
            log(f"\n[{k}/{len(fila)}] {qid} ({motivo}) — custo até agora US$ {contador.custo:.4f}")
            cs_arq = ler_correcoes(args.dados, args.banca, ano)
            antiga = cs_arq["correcoes"].get(qid)
            reportes = (antiga or {}).get("revisao", {}).get("reportes", []) if antiga else []
            try:
                entrada, falha, _ = gerar_uma(q, todas, catalogo, cliente, config, reportes)
            except ErroAPI as e:
                log(f"   ERRO: {e}"); linhas.append((qid, "erro", str(e)[:120])); saida = 2; continue
            if entrada:
                cs_arq = ler_correcoes(args.dados, args.banca, ano)   # relê: outra etapa pode ter gravado
                cs_arq["correcoes"][qid] = entrada
                gravar_json(arq_correcoes(args.dados, args.banca, ano), cs_arq)
                linhas.append((qid, "publicada", f"{entrada['historico_meta']['relevantes']} no histórico"
                               + ("; IA discordou do gabarito" if entrada["revisao"]["alertas"] else "")))
                log("   GRAVADA em correcoes.json")
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
        if args.cmd == "catalogar":
            return cmd_catalogar(args, config) or 0
        return cmd_gerar(args, config)
    except ErroAPI as e:
        log(f"ERRO: {e}"); return 2


if __name__ == "__main__":
    sys.exit(main())
