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


def escrever_imagens_pendentes(lista, caminho=os.path.join("relatorios", "imagens_pendentes.md")):
    """lista para a liga: questões que dependem de uma imagem que ainda não está no CRIVO"""
    linhas = ["# Questões que dependem de uma imagem", "",
              "Arquivo gerado sozinho (ferramentas/gerar_indice.py). Enquanto a imagem não é adicionada, a questão mostra um aviso",
              "antes da resposta e fica fora do simulado, do plano de estudo e das estatísticas.", "",
              "## Como adicionar a imagem (pelo GitHub, sem programar)",
              "1. Encontre a imagem na prova original (PDF) e salve-a como PNG ou JPG (recorte só a figura).",
              "2. No GitHub, abra a pasta `dados/<BANCA>/<ANO>/img/` → **Add file → Upload files** → envie com o nome",
              "   `Q<NÚMERO>_1.png` (ex.: `Q11_1.png`) → **Commit changes** (crie um ramo e um pull request, se pedir).",
              "3. Abra `dados/<BANCA>/<ANO>/questoes.json` (ícone de lápis), procure `\"numero\": <NÚMERO>` e:",
              "   - troque `(VER IMAGEM)` (ou o ponto onde a figura entra) por `<img src=\\\"dados/<BANCA>/<ANO>/img/Q<NÚMERO>_1.png\\\" alt=\\\"Figura da questão\\\">`",
              "     (no arquivo, as aspas da tag levam uma barra antes: `\\\"`);",
              "   - troque `\"imagem_pendente\": true` por `\"imagem_pendente\": false`.",
              "4. Salve (Commit). Depois, rode **Actions → Gerar correções** no modo `pendentes` com essa edição, para refazer a correção.",
              "", f"## Lista ({len(lista)} questões)", ""]
    linhas += [f"- {b} {a}, questão {n}" for b, a, n in lista] or ["- nenhuma 🎉"]
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as f:
        f.write("\n".join(linhas) + "\n")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dados", default="dados")
    ap.add_argument("--disciplinas", default=os.path.join("exams", "disciplinas.json"),
                    help="arquivo de disciplinas usado pelo filtro do site")
    a = ap.parse_args()
    cfg = ler_json(os.path.join(os.path.dirname(os.path.abspath(__file__)), "config_gerador.json"), {})
    sincronizar_disciplinas(a.dados, a.disciplinas, set(cfg.get("disciplinas_permitidas", [])))
    bancas, problemas, pendentes_img = {}, [], []
    for banca, ano in listar_edicoes(a.dados):
        qs = ler_questoes(a.dados, banca, ano)
        if not qs or qs.get("formato") != "crivo-questoes" or qs.get("banca") != banca or str(qs.get("ano")) != ano:
            problemas.append(f"{banca}/{ano}/questoes.json: formato, banca ou ano incorretos"); continue
        cs = ler_correcoes(a.dados, banca, ano)["correcoes"]
        nums = [int(q["numero"]) for q in qs["questoes"]]
        if len(nums) != len(set(nums)):
            problemas.append(f"{banca} {ano}: número de questão repetido")
        sem, contradiz, sem_num = 0, 0, []
        for q in qs["questoes"]:
            c = cs.get(q["id"])
            if not c: sem += 1; sem_num.append(int(q["numero"]))
            elif q.get("gabarito") and c.get("gabarito_usado") and c["gabarito_usado"] != q["gabarito"]: contradiz += 1
        sem_gab = [int(q["numero"]) for q in qs["questoes"] if not q.get("gabarito")]
        excl = sorted(n for n, q in ((int(q["numero"]), q) for q in qs["questoes"]) if q.get("anulacao") == "excluida")
        img = sorted(int(q["numero"]) for q in qs["questoes"] if q.get("imagem_pendente"))
        for q in qs["questoes"]:
            if q.get("imagem_pendente"): pendentes_img.append((banca, ano, int(q["numero"])))
        bancas.setdefault(banca, {})[ano] = {"questoes": sorted(nums), "sem_correcao": sem, "sem_correcao_num": sorted(sem_num),
                                             "correcao_contradiz_gabarito": contradiz,
                                             "anuladas": sorted(set(sem_gab) - set(excl)), "excluidas": excl, "imagem_pendente": img}
    gravar_json(os.path.join(a.dados, "indice.json"), {"formato": "crivo-indice", "versao": 2, "bancas": bancas})
    escrever_imagens_pendentes(sorted(pendentes_img))
    total = sum(len(v["questoes"]) for b in bancas.values() for v in b.values())
    sem = sum(v["sem_correcao"] for b in bancas.values() for v in b.values())
    cont = sum(v["correcao_contradiz_gabarito"] for b in bancas.values() for v in b.values())
    print(f"indice.json: {len(bancas)} banca(s), {sum(len(b) for b in bancas.values())} edição(ões), {total} questões "
          f"({sem} sem correção, {cont} com correção que contradiz o gabarito).")
    for p in problemas: print("  PROBLEMA:", p)
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
