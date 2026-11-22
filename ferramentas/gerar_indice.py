#!/usr/bin/env python3
"""
Gera dados/indice.json: bancas, edições e questões que o site mostra.
Rode sempre que adicionar ou remover uma edição.  Uso: python ferramentas/gerar_indice.py --dados dados
"""
import argparse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crivo_comum import listar_edicoes, ler_questoes, ler_correcoes, gravar_json, ler_json, arq_questoes


def sincronizar_disciplinas(dados, caminho, permitidas):
    """Mantém exams/disciplinas.json (usado pelo filtro do site) e questoes.json com a mesma disciplina.
    Classificação já existente em disciplinas.json (feita por pessoas) tem prioridade; nada é apagado."""
    mapa = ler_json(caminho, {}) or {}
    novos_site, novos_json = 0, 0
    for banca, ano in listar_edicoes(dados):
        qs = ler_questoes(dados, banca, ano)
        y = mapa.setdefault(banca, {}).setdefault(str(ano), {})
        mudou = False
        for q in qs["questoes"]:
            n = str(q["numero"])
            atual = (y[int(n) - 1] if isinstance(y, list) and int(n) - 1 < len(y) else
                     y.get(n) if isinstance(y, dict) else None)
            atual = atual if atual in permitidas else None
            if atual and q.get("disciplina") != atual:
                q["disciplina"] = atual; mudou = True; novos_json += 1
            elif not atual and q.get("disciplina") in permitidas:
                if isinstance(y, list):
                    y.extend([""] * (int(n) - len(y))); y[int(n) - 1] = q["disciplina"]
                else:
                    y[n] = q["disciplina"]
                novos_site += 1
        if mudou:
            gravar_json(arq_questoes(dados, banca, ano), qs)
    gravar_json(caminho, mapa)
    print(f"disciplinas: {novos_site} adicionada(s) ao filtro do site, {novos_json} copiada(s) para questoes.json.")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dados", default="dados")
    ap.add_argument("--disciplinas", default=os.path.join("exams", "disciplinas.json"),
                    help="arquivo de disciplinas usado pelo filtro do site")
    a = ap.parse_args()
    cfg = ler_json(os.path.join(os.path.dirname(os.path.abspath(__file__)), "config_gerador.json"), {})
    sincronizar_disciplinas(a.dados, a.disciplinas, set(cfg.get("disciplinas_permitidas", [])))
    bancas, problemas = {}, []
    for banca, ano in listar_edicoes(a.dados):
        qs = ler_questoes(a.dados, banca, ano)
        if not qs or qs.get("formato") != "crivo-questoes" or qs.get("banca") != banca or str(qs.get("ano")) != ano:
            problemas.append(f"{banca}/{ano}/questoes.json: formato, banca ou ano incorretos"); continue
        cs = ler_correcoes(a.dados, banca, ano)["correcoes"]
        nums = [int(q["numero"]) for q in qs["questoes"]]
        if len(nums) != len(set(nums)):
            problemas.append(f"{banca} {ano}: número de questão repetido")
        sem, contradiz = 0, 0
        for q in qs["questoes"]:
            c = cs.get(q["id"])
            if not c: sem += 1
            elif q.get("gabarito") and c.get("gabarito_usado") and c["gabarito_usado"] != q["gabarito"]: contradiz += 1
        bancas.setdefault(banca, {})[ano] = {"questoes": sorted(nums), "sem_correcao": sem, "correcao_contradiz_gabarito": contradiz}
    gravar_json(os.path.join(a.dados, "indice.json"), {"formato": "crivo-indice", "versao": 2, "bancas": bancas})
    total = sum(len(v["questoes"]) for b in bancas.values() for v in b.values())
    sem = sum(v["sem_correcao"] for b in bancas.values() for v in b.values())
    cont = sum(v["correcao_contradiz_gabarito"] for b in bancas.values() for v in b.values())
    print(f"indice.json: {len(bancas)} banca(s), {sum(len(b) for b in bancas.values())} edição(ões), {total} questões "
          f"({sem} sem correção, {cont} com correção que contradiz o gabarito).")
    for p in problemas: print("  PROBLEMA:", p)
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
