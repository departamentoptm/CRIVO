#!/usr/bin/env python3
"""
Gera dados/indice.json: a lista de bancas, edições e números de questão que o site deve mostrar.
Rode sempre que adicionar ou remover um arquivo em dados/<BANCA>/<ANO>.json.
Uso: python ferramentas/gerar_indice.py --dados dados
"""
import argparse, glob, json, os, sys

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dados", default="dados"); a = ap.parse_args()
    bancas, problemas = {}, []
    for arq in sorted(glob.glob(os.path.join(a.dados, "*", "*.json"))):
        try:
            ed = json.load(open(arq, encoding="utf-8"))
        except Exception as e:
            problemas.append(f"{arq}: JSON inválido ({e})"); continue
        if ed.get("formato") != "crivo-edicao":
            problemas.append(f"{arq}: não é um arquivo de edição do CRIVO"); continue
        banca, ano = ed["banca"], str(ed["ano"])
        esperado = os.path.join(a.dados, banca, f"{ano}.json")
        if os.path.normpath(arq) != os.path.normpath(esperado):
            problemas.append(f"{arq}: banca/ano internos ({banca}/{ano}) não batem com o nome do arquivo")
            continue
        nums = sorted(int(q["numero"]) for q in ed["questoes"])
        if len(nums) != len(set(nums)):
            problemas.append(f"{arq}: número de questão repetido")
        bancas.setdefault(banca, {})[ano] = {
            "questoes": nums,
            "regerar": sum(1 for q in ed["questoes"] if (q.get("revisao") or {}).get("status") == "regerar"),
        }
    json.dump({"formato": "crivo-indice", "versao": 1, "bancas": bancas},
              open(os.path.join(a.dados, "indice.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    total = sum(len(v["questoes"]) for b in bancas.values() for v in b.values())
    print(f"indice.json: {len(bancas)} banca(s), {sum(len(b) for b in bancas.values())} edição(ões), {total} questões.")
    for p in problemas: print("  PROBLEMA:", p)
    return 1 if problemas else 0

if __name__ == "__main__":
    sys.exit(main())
