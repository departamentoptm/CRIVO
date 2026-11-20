#!/usr/bin/env python3
"""
Confere dados/<BANCA>/<ANO>/questoes.json com o gabarito.json oficial.
- Questão com gabarito diferente do oficial: com --aplicar, passa a usar o oficial.
- Anulada no oficial: gabarito vira null (o site mostra "anulada" e conta acerto para todos).
- Correção escrita para outra letra (gabarito_usado diferente): listada como "para regerar".
  O site já mostra o aviso sozinho; o gerador refaz com --somente-pendentes.
Uso: python ferramentas/conferir_gabarito.py --gabarito gabarito.json --dados dados [--aplicar]
Sai com código 1 se algum questoes.json estiver diferente do oficial e --aplicar não foi usado.
"""
import argparse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crivo_comum import ler_json, listar_edicoes, ler_questoes, ler_correcoes, gravar_json, arq_questoes, LETRAS


def oficial_de(gab, banca, ano, numero):
    v = (gab.get(banca, {}).get(str(ano)) or {}).get(str(numero))
    v = v.strip().upper() if isinstance(v, str) else None
    return v if v in LETRAS else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gabarito", required=True); ap.add_argument("--dados", default="dados")
    ap.add_argument("--aplicar", action="store_true")
    a = ap.parse_args()
    gab = ler_json(a.gabarito)
    diferentes, regerar, sem_oficial = 0, [], []
    for banca, ano in listar_edicoes(a.dados):
        if str(ano) not in gab.get(banca, {}):
            sem_oficial.append(f"{banca} {ano}"); continue
        qs = ler_questoes(a.dados, banca, ano)
        cs = ler_correcoes(a.dados, banca, ano)["correcoes"]
        mudou = False
        for q in qs["questoes"]:
            of = oficial_de(gab, banca, ano, q["numero"])
            if q.get("gabarito") != of:
                diferentes += 1
                print(f"GABARITO   {q['id']}: arquivo={q.get('gabarito')} oficial={of or 'anulada'}")
                q["gabarito"] = of; mudou = True
            c = cs.get(q["id"])
            if c and of and c.get("gabarito_usado") and c["gabarito_usado"] != of:
                regerar.append(q["id"])
        if mudou and a.aplicar:
            gravar_json(arq_questoes(a.dados, banca, ano), qs)
    for e in sem_oficial: print(f"AVISO: {e} não está no gabarito.json")
    print(f"\nGabaritos diferentes do oficial: {diferentes}" + ("" if a.aplicar or not diferentes else "  (use --aplicar para gravar)"))
    print(f"Correções escritas para outra letra (para regerar): {len(regerar)}")
    if regerar: print("  " + ", ".join(regerar))
    return 1 if diferentes and not a.aplicar else 0


if __name__ == "__main__":
    sys.exit(main())
