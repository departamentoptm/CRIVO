#!/usr/bin/env python3
"""
Traz as revisões feitas pela liga (Formulário Google -> planilha publicada como CSV) para o correcoes.json.
Não usa IA e não custa nada.

Regras (definidas pelo centro acadêmico):
  - "Tem erro": a correção vai para "regerar" e o apontamento do revisor entra nos reportes, para a IA
    corrigir na próxima geração (modo pendentes).
  - Selo "revisada por humano": 2 estudantes diferentes OU 1 médico(a) com CRM conferido marcam "Correta",
    sem nenhum "Tem erro" depois da última geração da correção.
  - CRM: só vale depois de conferido à mão e incluído em dados/revisores.json (o relatório lista os CRMs a conferir).
  - O nome do revisor aparece no selo só se ele autorizou no formulário; sem autorização, aparece
    "revisor(a) da liga".
  - Revisões anteriores à última geração da correção não contam (eram de outra versão do texto).
  - Cada linha da planilha entra uma única vez.

Uso: python ferramentas/importar_revisoes.py --csv "<link do CSV publicado>" --dados dados
"""
import argparse
import csv
import datetime as dt
import io
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crivo_comum import ler_correcoes, gravar_json, arq_correcoes, listar_edicoes, ler_json
from importar_reportes import baixar_csv, RE_ID

MINIMO_ESTUDANTES = 2


def _norm(t):
    t = unicodedata.normalize("NFD", str(t or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", t).strip()


def normalizar_crm(t):
    t = str(t or "").upper()
    num = "".join(re.findall(r"\d", t))
    uf = re.findall(r"\b([A-Z]{2})\b", re.sub(r"CRM", " ", t))
    return f"{num}-{uf[-1]}" if num and uf else num


def quando_iso(texto):
    """Carimbo do Google Forms (dd/mm/aaaa hh:mm:ss, horário de Brasília) -> ISO UTC; vazio se não entender."""
    t = str(texto or "").strip()
    for f in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            d = dt.datetime.strptime(t, f).replace(tzinfo=dt.timezone(dt.timedelta(hours=-3)))
            return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            continue
    return ""


def eh_medico(funcao):
    return _norm(funcao).startswith(("medic", "residente", "preceptor", "professor"))


def coluna_inicio(cabecalho, *inicios):
    """Coluna cujo título COMEÇA com um dos textos (sem acento e sem maiúsculas); evita confundir "Nome" com
    "Autorizo que meu nome apareça"."""
    norm = [_norm(c) for c in cabecalho]
    for ini in inicios:
        for i, c in enumerate(norm):
            if c.startswith(ini):
                return i
    return None


def recalcular_selo(c, conferidos):
    """Aplica as regras do selo a uma correção. Devolve (status_novo ou None, lista de CRMs a conferir)."""
    rev = c.setdefault("revisao", {})
    desde = c.get("gerado_em") or ""
    validas = [r for r in rev.get("revisoes", []) if (r.get("quando") or "") >= desde]
    a_conferir = []
    if any(r.get("veredito") == "erro" for r in validas):
        return None, a_conferir
    estudantes, medicos, publicos = set(), [], []
    for r in validas:
        if r.get("veredito") != "correta":
            continue
        nome_pub = r.get("nome") if r.get("consentiu") else "revisor(a) da liga"
        if eh_medico(r.get("funcao")):
            if normalizar_crm(r.get("crm")) in conferidos:
                medicos.append(r)
                publicos.append({"nome": nome_pub, "funcao": "médico(a)"})
            else:
                a_conferir.append(r)
        elif _norm(r.get("nome")):
            if _norm(r.get("nome")) not in estudantes:
                estudantes.add(_norm(r.get("nome")))
                publicos.append({"nome": nome_pub, "funcao": "estudante"})
    if medicos or len(estudantes) >= MINIMO_ESTUDANTES:
        rev["revisores_publicos"] = publicos
        return "revisado_humano", a_conferir
    rev.pop("revisores_publicos", None)
    return None, a_conferir


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="link do CSV publicado da planilha de respostas (ou arquivo local)")
    ap.add_argument("--dados", default="dados")
    ap.add_argument("--relatorio", default="relatorios/revisoes.md")
    a = ap.parse_args()

    linhas = list(csv.reader(io.StringIO(baixar_csv(a.csv))))
    if not linhas:
        print("Planilha vazia."); return 0
    cab = linhas[0]
    col = {
        "data": coluna_inicio(cab, "carimbo", "timestamp", "data"),
        "id": coluna_inicio(cab, "questao", "codigo", "id"),
        "veredito": coluna_inicio(cab, "a correcao esta", "veredito", "avaliacao"),
        "secao": coluna_inicio(cab, "secao"),
        "explicacao": coluna_inicio(cab, "o que esta errado", "explica", "comentario"),
        "nome": coluna_inicio(cab, "nome", "seu nome"),
        "funcao": coluna_inicio(cab, "voce e", "funcao"),
        "crm": coluna_inicio(cab, "crm"),
        "consentiu": coluna_inicio(cab, "autorizo", "consentimento"),
    }
    if col["id"] is None or col["veredito"] is None or col["nome"] is None:
        print(f"ERRO: não achei as colunas da questão, do veredito ou do nome no cabeçalho: {cab}"); return 1
    pega = lambda ln, k: ln[col[k]].strip() if col[k] is not None and col[k] < len(ln) else ""

    conferidos = {normalizar_crm(m.get("crm")) for m in ler_json(os.path.join(a.dados, "revisores.json"), {}).get("medicos_conferidos", [])}
    edicoes = {(b, str(ano)) for b, ano in listar_edicoes(a.dados)}
    cache, mudou = {}, set()
    novas, erros, invalidas, antigas, ja = [], [], [], [], 0
    for ln in linhas[1:]:
        if not any(x.strip() for x in ln):
            continue
        m = RE_ID.search(pega(ln, "id").upper())
        if not m or (m.group(1), m.group(2)) not in edicoes:
            invalidas.append((pega(ln, "id"), pega(ln, "nome"))); continue
        banca, ano, num = m.group(1), m.group(2), int(m.group(3))
        qid = f"{banca}-{ano}-Q{num}"
        if (banca, ano) not in cache:
            cache[(banca, ano)] = ler_correcoes(a.dados, banca, ano)
        c = cache[(banca, ano)]["correcoes"].get(qid)
        if not c:
            invalidas.append((qid, "questão sem correção")); continue
        vtxt = _norm(pega(ln, "veredito"))
        veredito = "erro" if ("erro" in vtxt or "incorret" in vtxt or vtxt.startswith("nao")) else "correta"
        r = {"quando": quando_iso(pega(ln, "data")) or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "carimbo": pega(ln, "data"), "nome": pega(ln, "nome")[:80], "funcao": pega(ln, "funcao")[:40],
             "crm": pega(ln, "crm")[:20], "veredito": veredito, "secao": pega(ln, "secao")[:40],
             "explicacao": pega(ln, "explicacao")[:2000], "consentiu": _norm(pega(ln, "consentiu")).startswith("sim")}
        rev = c.setdefault("revisao", {})
        lista = rev.setdefault("revisoes", [])
        if any((x.get("carimbo"), _norm(x.get("nome"))) == (r["carimbo"], _norm(r["nome"])) for x in lista):
            ja += 1; continue
        if r["quando"] < (c.get("gerado_em") or ""):
            antigas.append((qid, r["nome"])); continue
        lista.append(r)
        mudou.add((banca, ano))
        if veredito == "erro":
            rev["status"] = "regerar"
            rev.setdefault("reportes", []).append({
                "texto": f"[Revisão da liga] seção {r['secao'] or '?'}: {r['explicacao'] or '(sem explicação)'}",
                "recebido_em": r["carimbo"]})
            erros.append((qid, r["nome"], r["secao"], r["explicacao"]))
        else:
            novas.append((qid, r["nome"], r["funcao"]))

    # selo: recalculado em todas as correções com revisões (um CRM conferido depois também vale)
    for b, ano in sorted(edicoes):
        if (b, ano) not in cache:
            cache[(b, ano)] = ler_correcoes(a.dados, b, ano)
    selados, crms = [], []
    for (b, ano), arq in cache.items():
        for qid, c in arq["correcoes"].items():
            rev = c.get("revisao") or {}
            if not rev.get("revisoes"):
                continue
            antes = rev.get("status")
            status, pendentes = recalcular_selo(c, conferidos)
            crms += [(qid, p.get("nome"), p.get("crm")) for p in pendentes]
            if status == "revisado_humano" and antes != "revisado_humano":
                rev["status"] = "revisado_humano"; selados.append(qid); mudou.add((b, ano))
            elif status is None and antes == "revisado_humano":
                rev["status"] = "regerar" if any(x.get("veredito") == "erro" for x in rev["revisoes"]) else "nao_revisado"
                mudou.add((b, ano))
    for b, ano in mudou:
        gravar_json(arq_correcoes(a.dados, b, ano), cache[(b, ano)])

    rel = ["# Revisões da liga", "",
           f"- revisões novas \"Correta\": {len(novas)}",
           f"- revisões novas \"Tem erro\" (marcadas para refazer): {len(erros)}",
           f"- correções que ganharam o selo de revisão humana: {len(selados)}",
           f"- CRMs a conferir (inclua em dados/revisores.json depois de conferir): {len(set((x[1], x[2]) for x in crms))}",
           f"- revisões de uma versão anterior da correção (ignoradas): {len(antigas)}",
           f"- código de questão inválido ou sem correção: {len(invalidas)}",
           f"- já importadas antes: {ja}", ""]
    if erros:
        rel += ["## Apontadas com erro (serão refeitas)", *[f"- **{q}** ({n}), seção {s or '?'}: {e[:300]}" for q, n, s, e in erros], ""]
    if selados:
        rel += ["## Selo de revisão humana", *[f"- {q}" for q in selados], ""]
    if crms:
        rel += ["## CRMs a conferir", *sorted({f"- {n} — CRM {c} (questão {q})" for q, n, c in crms}), ""]
    if invalidas:
        rel += ["## Código inválido", *[f"- {i} ({n})" for i, n in invalidas], ""]
    os.makedirs(os.path.dirname(a.relatorio) or ".", exist_ok=True)
    with open(a.relatorio, "w", encoding="utf-8") as f:
        f.write("\n".join(rel) + "\n")
    print("\n".join(rel[:9]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
