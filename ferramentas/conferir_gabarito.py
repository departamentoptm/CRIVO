#!/usr/bin/env python3
"""
Confere o gabarito de cada questão em dados/<BANCA>/<ANO>.json com o gabarito.json oficial.
- Divergência  -> gabarito passa a ser o oficial e a questão recebe alerta "correcao_contradiz_gabarito"
                  (a correção antiga foi escrita para outra letra: precisa ser regerada).
- Anulada      -> gabarito = null e alerta "anulada" (o site mostra o aviso em vez de uma "resposta certa").
Uso: python ferramentas/conferir_gabarito.py --gabarito gabarito.json --dados dados [--aplicar]
Sem --aplicar, só mostra o relatório. Sai com código 1 se houver divergência (útil no GitHub Actions).
"""
import argparse, glob, json, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gabarito", required=True); ap.add_argument("--dados", default="dados")
    ap.add_argument("--aplicar", action="store_true")
    a = ap.parse_args()
    oficial = json.load(open(a.gabarito, encoding="utf-8"))
    divergentes = anuladas = conferidas = 0
    for arq in sorted(glob.glob(os.path.join(a.dados, "*", "*.json"))):
        ed = json.load(open(arq, encoding="utf-8"))
        gab_ed = oficial.get(ed["banca"], {}).get(str(ed["ano"]))
        if gab_ed is None:
            print(f"AVISO: {ed['banca']} {ed['ano']} não está no gabarito.json"); continue
        mudou = False
        for q in ed["questoes"]:
            o = gab_ed.get(str(q["numero"]))
            o = o.strip().upper() if isinstance(o, str) else None
            alertas = q.setdefault("revisao", {}).setdefault("alertas", [])
            if o not in ("A", "B", "C", "D", "E"):
                anuladas += 1
                if q.get("gabarito") is not None or "anulada" not in alertas:
                    print(f"ANULADA     {q['id']}: página dizia {q.get('gabarito')}")
                    q["gabarito_pagina_antiga"] = q.get("gabarito"); q["gabarito"] = None
                    if "anulada" not in alertas: alertas.append("anulada")
                    mudou = True
            elif q.get("gabarito") != o:
                divergentes += 1
                print(f"DIVERGENTE  {q['id']}: oficial {o}, correção escrita para {q.get('gabarito')}")
                q["gabarito_pagina_antiga"] = q.get("gabarito"); q["gabarito"] = o
                if "correcao_contradiz_gabarito" not in alertas: alertas.append("correcao_contradiz_gabarito")
                q["revisao"]["status"] = "regerar"
                mudou = True
            else:
                conferidas += 1
        if mudou and a.aplicar:
            json.dump(ed, open(arq, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\nConferidas: {conferidas} | divergentes: {divergentes} | anuladas: {anuladas}"
          + ("" if a.aplicar else "  (relatório apenas; use --aplicar para gravar)"))
    return 1 if divergentes and not a.aplicar else 0

if __name__ == "__main__":
    sys.exit(main())
