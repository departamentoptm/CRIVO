"""
Leva para outro dados/gastos.json (o do main) as execuções que esta execução acrescentou, para o teto acumulado
contar o gasto mesmo que o pull request com as correções não seja aprovado.

  python ferramentas/somar_gastos.py --antes gastos_antes.json --depois dados/gastos.json --destino ../principal/dados/gastos.json
Sai com código 0 e imprime o número de execuções levadas (0 = nada a fazer).
"""
import argparse
import json


def ler(caminho):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--antes", required=True); ap.add_argument("--depois", required=True); ap.add_argument("--destino", required=True)
    a = ap.parse_args()
    antes, depois, destino = ler(a.antes), ler(a.depois), ler(a.destino)
    chave = lambda e: (e.get("data"), e.get("acao"), e.get("custo_usd"))
    ja = {chave(e) for e in antes.get("execucoes", [])}
    novas = [e for e in depois.get("execucoes", []) if chave(e) not in ja]
    no_destino = {chave(e) for e in destino.get("execucoes", [])}
    novas = [e for e in novas if chave(e) not in no_destino]
    if not novas or not destino:
        print(0); return 0
    destino.setdefault("execucoes", []).extend(novas)
    destino["gasto_usd"] = round(float(destino.get("gasto_usd", 0)) + sum(float(e.get("custo_usd") or 0) for e in novas), 4)
    destino["correcoes_geradas"] = int(destino.get("correcoes_geradas", 0)) + max(
        0, int(depois.get("correcoes_geradas", 0)) - int(antes.get("correcoes_geradas", 0)))
    with open(a.destino, "w", encoding="utf-8") as f:
        json.dump(destino, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(len(novas))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
