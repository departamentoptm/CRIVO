#!/usr/bin/env python3
"""
Migra o formato antigo (dados/<BANCA>/<ANO>.json, tudo junto) para o formato atual:
    dados/<BANCA>/<ANO>/questoes.json   (enunciado, alternativas, gabarito — fixo)
    dados/<BANCA>/<ANO>/correcoes.json  (correção — editável)
Uso: python ferramentas/migrar_para_dois_arquivos.py --dados dados
Roda uma vez. Os arquivos antigos são apagados só depois que os novos forem gravados.
"""
import argparse, glob, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crivo_comum import (ler_json, gravar_json, arq_questoes, arq_correcoes, novo_arquivo_questoes,
                         id_questao)

DERIVADOS = {"anulada", "correcao_contradiz_gabarito"}   # hoje o site calcula esses sozinho


def separar(ed):
    banca, ano = ed["banca"], str(ed["ano"])
    qs = novo_arquivo_questoes(banca, ano)
    cs = {"formato": "crivo-correcoes", "versao": 1, "banca": banca, "ano": ano, "correcoes": {}}
    for q in ed["questoes"]:
        qid = q.get("id") or id_questao(banca, ano, q["numero"])
        qs["questoes"].append({
            "id": qid, "numero": int(q["numero"]), "disciplina": q.get("disciplina"),
            "enunciado_html": q.get("enunciado_html", ""), "extras_html": q.get("extras_html"),
            "alternativas": q.get("alternativas", {}), "gabarito": q.get("gabarito"),
            "imagem_pendente": False,
        })
        corr = q.get("correcao") or {}
        if not corr.get("secoes_html"):
            continue
        rev = q.get("revisao") or {}
        alertas = [a for a in rev.get("alertas", []) if a not in DERIVADOS and not a.startswith("conversao")]
        cs["correcoes"][qid] = {
            "tema": q.get("tema"),
            "aviso_diretriz": q.get("aviso_diretriz"),
            "gabarito_usado": q.get("gabarito_pagina_antiga", q.get("gabarito")),
            "secoes_html": corr["secoes_html"],
            "historico": corr.get("historico"),
            "origem": q.get("origem", "convertido_html_v1"),
            "revisao": {"status": "nao_revisado", "alertas": alertas},
        }
    return qs, cs


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dados", default="dados"); a = ap.parse_args()
    antigos = sorted(glob.glob(os.path.join(a.dados, "*", "*.json")))
    antigos = [p for p in antigos if os.path.basename(p) != "temas.json"]
    if not antigos:
        print("Nada a migrar (nenhum dados/<BANCA>/<ANO>.json no formato antigo)."); return 0
    for p in antigos:
        ed = ler_json(p)
        if not ed or ed.get("formato") != "crivo-edicao":
            continue
        qs, cs = separar(ed)
        if os.path.exists(arq_questoes(a.dados, qs["banca"], qs["ano"])):
            print(f"PULADO {p}: já existe {arq_questoes(a.dados, qs['banca'], qs['ano'])}"); continue
        gravar_json(arq_questoes(a.dados, qs["banca"], qs["ano"]), qs)
        gravar_json(arq_correcoes(a.dados, qs["banca"], qs["ano"]), cs)
        os.remove(p)
        print(f"{qs['banca']} {qs['ano']}: {len(qs['questoes'])} questões, {len(cs['correcoes'])} correções")
    return 0


if __name__ == "__main__":
    sys.exit(main())
