#!/usr/bin/env python3
"""
Extrai enunciado e alternativas do perguntas.txt de uma prova e grava dados/<BANCA>/<ANO>/questoes.json.
NÃO usa IA: o texto oficial é copiado como está. Roda uma única vez por edição.

Formato esperado do perguntas.txt (o mesmo usado hoje):
    Questão 1
    <enunciado em uma ou mais linhas>
    A) ...
    B) ...
    ...
Linhas de cabeçalho de página ("Prova na íntegra ...") e o bloco "Gabarito AAAA" no fim são ignorados.
O gabarito vem do gabarito.json (fonte oficial), não do texto.

Uso — uma edição:
    python ferramentas/extrair_questoes.py --perguntas exams/AMP/2015/perguntas.txt --banca AMP --ano 2015 \
        --gabarito gabarito.json --dados dados
Uso — todas as edições de uma pasta exams/<BANCA>/<ANO>/perguntas.txt:
    python ferramentas/extrair_questoes.py --pasta-exams exams --banca AMP --gabarito gabarito.json --dados dados
Edições que já têm questoes.json são puladas (use --sobrescrever para refazer).
"""
import argparse, html, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crivo_comum import (ler_json, gravar_json, arq_questoes, novo_arquivo_questoes, id_questao, LETRAS)

RE_CABECALHO = re.compile(r"^\s*Prova na [ií]ntegra(?:\s+\d{4})?\s*$", re.I)
RE_QUESTAO = re.compile(r"^\s*Quest[aã]o\s+(\d{1,3})\s*$", re.I)
RE_GABARITO = re.compile(r"^\s*Gabarito(?:\s+\d{4})?\s*$", re.I)
RE_ALT = re.compile(r"^\s*([A-E])\)\s*(.*)$")
RE_ITEM = re.compile(r"^\s*(?:(?:I{1,3}|IV|V|VI{1,3}|IX|X)\s*[-–.)]|\(\s*[IVX\d]*\s*\)|\d\s*[-–.)]\s|[ivx]{1,4}\.\s)")

_IMG = (r"(?:figura|imagem|imagens|fotografia|foto|ilustra[cç][aã]o|gr[aá]fico|heredograma|esquema|mapa|"
        r"fluxograma|tra[cç]ado|eletrocardiograma|ecg|radiografia|tomografia|ultrassonografia|ecocardiograma|"
        r"dermatoscopia|rx)")
_REF = (r"(?:abaixo|a\s+seguir|ao\s+lado|acima|observ\w*|apresentad[ao]s?|mostrad[ao]s?|ilustrad[ao]s?|"
        r"representad[ao]s?|exibid[ao]s?|adicionad[ao]s?|anexad[ao]s?|an[aá]lise\s+d[oa])")
RE_IMAGEM = re.compile(rf"(?is)\b{_IMG}\b\W+(?:\w+\W+){{0,5}}?\b{_REF}\b|\b{_REF}\b\W+(?:\w+\W+){{0,5}}?\b{_IMG}\b")


def juntar_linhas(linhas):
    """Junta linhas quebradas pelo PDF; itens (I -, II -, ( ), 1-) começam linha nova; parágrafos viram <br><br>."""
    blocos, atual = [], []
    for l in linhas + [""]:
        if not l.strip():
            if atual: blocos.append(atual); atual = []
            continue
        atual.append(l.strip())
    saida = []
    for bloco in blocos:
        partes = []
        for l in bloco:
            if partes and not RE_ITEM.match(l):
                ant = partes[-1]
                if re.search(r"[A-Za-zÀ-ÿ]-$", ant) and re.match(r"[a-zà-ÿ]", l):
                    partes[-1] = ant[:-1] + l            # palavra hifenizada na quebra de linha
                else:
                    partes[-1] = ant + " " + l
            else:
                partes.append(l)
        saida.append("<br>".join(html.escape(re.sub(r"\s+", " ", p), quote=False) for p in partes))
    return "<br><br>".join(saida)


def separar_questoes(texto):
    linhas = [l for l in texto.replace("\r", "").replace("\x0c", "\n").split("\n") if not RE_CABECALHO.match(l)]
    # corta o bloco de gabarito no fim
    for i, l in enumerate(linhas):
        if RE_GABARITO.match(l):
            linhas = linhas[:i]; break
    questoes, atual, esperado = {}, None, 1
    for l in linhas:
        m = RE_QUESTAO.match(l)
        if m and int(m.group(1)) in (esperado, esperado + 1, esperado + 2):
            atual = int(m.group(1)); esperado = atual + 1
            questoes[atual] = []
            continue
        if atual is not None:
            questoes[atual].append(l)
    return questoes


def montar_questao(numero, linhas):
    enun, alts, letra_atual, problemas = [], {}, None, []
    for l in linhas:
        m = RE_ALT.match(l)
        prox = LETRAS[len(alts)] if len(alts) < 5 else None
        if m and m.group(1) == prox:
            letra_atual = m.group(1); alts[letra_atual] = [m.group(2)]
            continue
        if letra_atual:
            if l.strip() and re.fullmatch(r"\s*A\s*", l):    # letra solta que o PDF descola da linha
                continue
            alts[letra_atual].append(l)
        else:
            enun.append(l)
    if len(alts) < 4: problemas.append(f"só {len(alts)} alternativas reconhecidas")
    enunciado = juntar_linhas(enun)
    if not enunciado: problemas.append("enunciado vazio")
    alternativas = {k: juntar_linhas(v) for k, v in alts.items()}
    texto_enun = re.sub(r"<[^>]+>", " ", enunciado)
    vazias, maior = 0, 0                     # vários espaços vazios seguidos = figura que o texto perdeu
    for l in enun:
        vazias = vazias + 1 if not l.strip() else 0
        maior = max(maior, vazias)
    imagem = bool(RE_IMAGEM.search(texto_enun)) or maior >= 3
    return enunciado, alternativas, imagem, problemas


def extrair(caminho, banca, ano, gabarito, disciplinas):
    texto = open(caminho, encoding="utf-8", errors="replace").read()
    brutas = separar_questoes(texto)
    gab = (gabarito or {}).get(banca, {}).get(str(ano), {}) or {}
    disc = ((disciplinas or {}).get(banca, {}) or {}).get(str(ano), {}) or {}
    qs = novo_arquivo_questoes(banca, ano)
    problemas = []
    for n in sorted(brutas):
        enunciado, alternativas, imagem, p = montar_questao(n, brutas[n])
        of = gab.get(str(n)); of = of.strip().upper() if isinstance(of, str) else None
        qs["questoes"].append({
            "id": id_questao(banca, ano, n), "numero": n, "disciplina": disc.get(str(n)),
            "enunciado_html": enunciado, "extras_html": None, "alternativas": alternativas,
            "gabarito": of if of in LETRAS else None, "imagem_pendente": imagem,
        })
        problemas += [f"Q{n}: {x}" for x in p]
    faltando = [n for n in range(1, max(brutas or [0]) + 1) if n not in brutas]
    if faltando: problemas.append(f"números não encontrados: {faltando}")
    if gab and len(brutas) != len([k for k in gab]):
        problemas.append(f"{len(brutas)} questões no texto, {len(gab)} no gabarito.json")
    return qs, problemas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--perguntas"); ap.add_argument("--pasta-exams")
    ap.add_argument("--banca", required=True); ap.add_argument("--ano")
    ap.add_argument("--gabarito", required=True); ap.add_argument("--disciplinas")
    ap.add_argument("--dados", default="dados"); ap.add_argument("--sobrescrever", action="store_true")
    a = ap.parse_args()
    gabarito = ler_json(a.gabarito, {})
    disciplinas = ler_json(a.disciplinas, {}) if a.disciplinas else {}
    tarefas = []
    if a.perguntas:
        if not a.ano: ap.error("--ano é obrigatório com --perguntas")
        tarefas.append((a.perguntas, a.ano))
    elif a.pasta_exams:
        pb = os.path.join(a.pasta_exams, a.banca)
        for ano in sorted(os.listdir(pb)):
            p = os.path.join(pb, ano, "perguntas.txt")
            if os.path.isfile(p): tarefas.append((p, ano))
    else:
        ap.error("informe --perguntas ou --pasta-exams")
    erro = 0
    for caminho, ano in tarefas:
        destino = arq_questoes(a.dados, a.banca, ano)
        if os.path.exists(destino) and not a.sobrescrever:
            print(f"PULADO {a.banca} {ano}: já existe {destino}"); continue
        qs, problemas = extrair(caminho, a.banca, ano, gabarito, disciplinas)
        gravar_json(destino, qs)
        img = [q["numero"] for q in qs["questoes"] if q["imagem_pendente"]]
        print(f"{a.banca} {ano}: {len(qs['questoes'])} questões" + (f"; com imagem pendente: {img}" if img else ""))
        for p in problemas: print("   CONFERIR:", p)
        erro |= bool(problemas)
    print("\nAbra previa.html para conferir o texto antes de gerar correções." if tarefas else "Nada a fazer.")
    return 1 if erro else 0


if __name__ == "__main__":
    sys.exit(main())
