#!/usr/bin/env python3
"""
Traz o registro PÚBLICO de doações para dados/doacoes.json (só data e valor; nenhum nome, e-mail ou comprovante).
A planilha de respostas do formulário "Solicitar provas / Fornecer ajuda" NÃO é publicada (tem dados pessoais).
Em vez disso, a equipe mantém uma aba separada (ex.: "doacoes_publicas") só com três colunas, e publica
apenas essa aba como CSV (veja o LEIAME, seção "Doações"):

    Data | Valor (R$) | Confirmado

Só entram as linhas com "Confirmado" = sim (a equipe confere o valor no extrato antes de marcar).
Cada linha entra uma única vez (pela data + valor + posição). Não usa IA e não custa nada.

Uso: python ferramentas/importar_doacoes.py --csv "<link do CSV publicado da aba pública>" --dados dados
"""
import argparse
import csv
import datetime
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crivo_comum import gravar_json, ler_json
from importar_reportes import baixar_csv, coluna


def data_iso(texto):
    """aceita 28/11/2026, 28/11/2026 14:03:00 ou 2026-11-28"""
    t = str(texto or "").strip()
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", t)
    if m:
        return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat()
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", t)
    return m.group(0) if m else None


def valor_reais(texto):
    """aceita 10, 10,50, R$ 1.234,56 e 10.50"""
    t = re.sub(r"[^\d,.\-]", "", str(texto or ""))
    if not t:
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        v = round(float(t), 2)
    except ValueError:
        return None
    return v if v > 0 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="link do CSV publicado da aba pública de doações (ou arquivo local)")
    ap.add_argument("--dados", default="dados")
    ap.add_argument("--relatorio", default="relatorios/doacoes.md")
    a = ap.parse_args()

    linhas = list(csv.reader(io.StringIO(baixar_csv(a.csv))))
    if not linhas:
        print("Planilha vazia."); return 0
    cab = linhas[0]
    c_data, c_valor, c_ok = coluna(cab, "data", "carimbo"), coluna(cab, "valor"), coluna(cab, "confirm")
    if None in (c_data, c_valor, c_ok):
        print(f"ERRO: a aba pública precisa das colunas Data, Valor e Confirmado. Cabeçalho encontrado: {cab}"); return 1
    doacoes, ignoradas = [], []
    for i, ln in enumerate(linhas[1:], 2):
        cel = lambda c: ln[c].strip() if c < len(ln) else ""
        if not cel(c_ok).lower().startswith(("s", "y", "x")):
            continue
        d, v = data_iso(cel(c_data)), valor_reais(cel(c_valor))
        if not d or v is None:
            ignoradas.append(f"linha {i}: data '{cel(c_data)}' ou valor '{cel(c_valor)}' não reconhecidos"); continue
        doacoes.append({"data": d, "valor": v})
    doacoes.sort(key=lambda x: x["data"])
    caminho = os.path.join(a.dados, "doacoes.json")
    antigo = ler_json(caminho, {}) or {}
    novo = {"formato": "crivo-doacoes", "moeda": "BRL",
            "observacao": "Só data e valor, conferidos pela equipe no extrato. Nenhum dado de quem doou é publicado.",
            "total": round(sum(x["valor"] for x in doacoes), 2), "doacoes": doacoes}
    if antigo.get("doacoes") != doacoes:
        gravar_json(caminho, novo)
    rel = ["# Doações (registro público)", "", f"- doações confirmadas: {len(doacoes)}",
           f"- total: R$ {novo['total']:.2f}".replace(".", ","), f"- linhas ignoradas: {len(ignoradas)}", ""]
    rel += [f"- {x}" for x in ignoradas]
    os.makedirs(os.path.dirname(a.relatorio) or ".", exist_ok=True)
    with open(a.relatorio, "w", encoding="utf-8") as f:
        f.write("\n".join(rel) + "\n")
    print("\n".join(rel[:5]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
