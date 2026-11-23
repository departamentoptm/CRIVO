#!/usr/bin/env python3
"""
Publica no site as dúvidas dos estudantes respondidas pela liga (Formulário Google -> planilha publicada como
CSV). Não usa IA e não custa nada.

  - O estudante envia a dúvida pelo formulário (anônimo: o formulário NÃO deve coletar e-mail nem nome).
  - A liga responde na própria planilha de respostas, preenchendo as colunas "Resposta" e "Respondido por".
  - Só as linhas com resposta e com "Respondido por" vão para dados/duvidas.json e aparecem na página da
    questão, depois da correção. As outras aparecem no relatório como pendentes.
  - A planilha é a fonte: o arquivo é refeito a cada importação (apagar a linha na planilha tira do site).

Uso: python ferramentas/importar_duvidas.py --csv "<link do CSV publicado>" --dados dados
"""
import argparse
import csv
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crivo_comum import gravar_json, listar_edicoes, ler_questoes
from importar_reportes import baixar_csv, RE_ID
from importar_revisoes import coluna_inicio, quando_iso


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="link do CSV publicado da planilha de respostas (ou arquivo local)")
    ap.add_argument("--dados", default="dados")
    ap.add_argument("--relatorio", default="relatorios/duvidas.md")
    a = ap.parse_args()

    linhas = list(csv.reader(io.StringIO(baixar_csv(a.csv))))
    if not linhas:
        print("Planilha vazia."); return 0
    cab = linhas[0]
    col = {"data": coluna_inicio(cab, "carimbo", "timestamp", "data"),
           "id": coluna_inicio(cab, "questao", "codigo", "id"),
           "duvida": coluna_inicio(cab, "duvida", "sua duvida", "pergunta"),
           "resposta": coluna_inicio(cab, "resposta"),
           "quem": coluna_inicio(cab, "respondido por", "respondida por")}
    if col["id"] is None or col["duvida"] is None:
        print(f"ERRO: não achei as colunas da questão e da dúvida no cabeçalho: {cab}"); return 1
    pega = lambda ln, k: ln[col[k]].strip() if col[k] is not None and col[k] < len(ln) else ""

    existentes = set()
    for b, ano in listar_edicoes(a.dados):
        existentes |= {q["id"] for q in ler_questoes(a.dados, b, ano)["questoes"]}
    publicadas, pendentes, invalidas = {}, [], []
    for ln in linhas[1:]:
        pergunta = pega(ln, "duvida")
        if not pergunta:
            continue
        m = RE_ID.search(pega(ln, "id").upper())
        qid = f"{m.group(1)}-{m.group(2)}-Q{int(m.group(3))}" if m else ""
        if qid not in existentes:
            invalidas.append((pega(ln, "id"), pergunta)); continue
        resposta, quem = pega(ln, "resposta"), pega(ln, "quem")
        if not resposta or not quem:
            pendentes.append((qid, pergunta)); continue
        publicadas.setdefault(qid, []).append({"pergunta": pergunta[:2000], "resposta": resposta[:4000],
                                               "respondido_por": quem[:100], "data": quando_iso(pega(ln, "data"))})
    gravar_json(os.path.join(a.dados, "duvidas.json"), {"formato": "crivo-duvidas", "versao": 1, "duvidas": publicadas})

    total = sum(len(v) for v in publicadas.values())
    rel = ["# Dúvidas dos estudantes", "",
           f"- respondidas e publicadas: {total} (em {len(publicadas)} questões)",
           f"- aguardando resposta da liga: {len(pendentes)}",
           f"- código de questão inválido: {len(invalidas)}", ""]
    if pendentes:
        rel += ["## Aguardando resposta (responda na planilha: colunas \"Resposta\" e \"Respondido por\")",
                *[f"- **{q}**: {p[:300]}" for q, p in pendentes], ""]
    if invalidas:
        rel += ["## Código inválido", *[f"- {i}: {p[:200]}" for i, p in invalidas], ""]
    os.makedirs(os.path.dirname(a.relatorio) or ".", exist_ok=True)
    with open(a.relatorio, "w", encoding="utf-8") as f:
        f.write("\n".join(rel) + "\n")
    print("\n".join(rel[:5]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
