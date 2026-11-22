#!/usr/bin/env python3
"""
Traz os erros reportados pelos estudantes (Formulário Google -> planilha publicada como CSV) para o
correcoes.json. Não usa IA e não custa nada.

  - reporte de uma questão COM correção: entra em revisao.reportes e a correção passa a "reportado";
    na próxima execução do gerador (modo pendentes) ela é refeita levando o reporte em conta.
    Correções "revisado_humano" não são marcadas para refazer: o reporte fica guardado e aparece no relatório.
  - reporte de questão SEM correção, ou com código que não existe: só aparece no relatório, para a equipe.
  - cada linha da planilha entra uma única vez (pelo carimbo de data/hora + texto).

Uso: python ferramentas/importar_reportes.py --csv "<link do CSV publicado>" --dados dados
"""
import argparse
import csv
import io
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crivo_comum import ler_correcoes, ler_questoes, gravar_json, arq_correcoes, listar_edicoes

RE_ID = re.compile(r"\b([A-Z][A-Z0-9-]*?)-((?:19|20)\d{2}[A-Za-z0-9_]*)-Q(\d{1,3})\b")


def baixar_csv(origem):
    if os.path.isfile(origem):
        with open(origem, encoding="utf-8-sig") as f:
            return f.read()
    req = urllib.request.Request(origem, headers={"User-Agent": "CRIVO/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8-sig")


def coluna(cabecalho, *palavras):
    for i, c in enumerate(cabecalho):
        if any(p in c.lower() for p in palavras):
            return i
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="link do CSV publicado da planilha de respostas (ou arquivo local)")
    ap.add_argument("--dados", default="dados")
    ap.add_argument("--relatorio", default="relatorios/reportes.md")
    a = ap.parse_args()

    linhas = list(csv.reader(io.StringIO(baixar_csv(a.csv))))
    if not linhas:
        print("Planilha vazia."); return 0
    cab = linhas[0]
    c_data = coluna(cab, "carimbo", "timestamp", "data")
    c_id = coluna(cab, "questão", "questao", "código", "codigo", "id")
    c_txt = coluna(cab, "errado", "erro", "descri", "problema")
    c_fonte = coluna(cab, "fonte", "referência", "referencia")
    if c_id is None or c_txt is None:
        print(f"ERRO: não achei as colunas da questão e do texto do erro no cabeçalho: {cab}"); return 1

    edicoes = {(b, str(ano)) for b, ano in listar_edicoes(a.dados)}
    cache, mudou = {}, set()
    novos, guardados, sem_correcao, invalidos, ja = [], [], [], [], 0
    for ln in linhas[1:]:
        if len(ln) <= max(c_id, c_txt) or not ln[c_txt].strip():
            continue
        texto = ln[c_txt].strip()[:2000]
        quando = ln[c_data].strip() if c_data is not None and c_data < len(ln) else ""
        fonte = ln[c_fonte].strip()[:500] if c_fonte is not None and c_fonte < len(ln) else ""
        m = RE_ID.search(ln[c_id].strip().upper())
        if not m or (m.group(1), m.group(2)) not in edicoes:
            invalidos.append((ln[c_id].strip(), texto)); continue
        banca, ano, num = m.group(1), m.group(2), int(m.group(3))
        qid = f"{banca}-{ano}-Q{num}"
        if (banca, ano) not in cache:
            cache[(banca, ano)] = ler_correcoes(a.dados, banca, ano)
        cs = cache[(banca, ano)]
        c = cs["correcoes"].get(qid)
        if not c:
            existe = any(q["numero"] == num for q in ler_questoes(a.dados, banca, ano)["questoes"])
            (sem_correcao if existe else invalidos).append((qid, texto)); continue
        rev = c.setdefault("revisao", {})
        reps = rev.setdefault("reportes", [])
        chave = (quando, texto)
        if any((r.get("recebido_em", ""), r.get("texto", "")) == chave for r in reps + rev.get("reportes_atendidos", [])):
            ja += 1; continue
        item = {"texto": texto, "recebido_em": quando}
        if fonte:
            item["fonte"] = fonte
        reps.append(item)
        if rev.get("status") == "revisado_humano":
            guardados.append((qid, texto))
        else:
            rev["status"] = "reportado"
            novos.append((qid, texto))
        mudou.add((banca, ano))
    for banca, ano in mudou:
        gravar_json(arq_correcoes(a.dados, banca, ano), cache[(banca, ano)])

    rel = ["# Erros reportados pelos estudantes", "",
           f"- novos, marcados para refazer: {len(novos)}",
           f"- novos em correções revisadas por pessoas (conferir à mão): {len(guardados)}",
           f"- questões ainda sem correção (conferir o enunciado à mão): {len(sem_correcao)}",
           f"- código de questão inválido: {len(invalidos)}",
           f"- já importados antes: {ja}", ""]
    for titulo, lista in (("Marcados para refazer", novos), ("Revisadas por pessoas — conferir", guardados),
                          ("Sem correção — conferir", sem_correcao), ("Código inválido", invalidos)):
        if lista:
            rel += [f"## {titulo}", *[f"- **{i}**: {t[:300]}" for i, t in lista], ""]
    os.makedirs(os.path.dirname(a.relatorio) or ".", exist_ok=True)
    with open(a.relatorio, "w", encoding="utf-8") as f:
        f.write("\n".join(rel) + "\n")
    print("\n".join(rel[:8]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
