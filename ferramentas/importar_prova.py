#!/usr/bin/env python3
"""
Importa uma prova original (.pdf ou .txt) para dados/<BANCA>/<ANO>/questoes.json — uma única vez, sem IA.

O que faz, em ordem:
  1. Lê o texto. PDF: pdftotext (mantém o layout). PDF sem texto (digitalizado): OCR em português (tesseract).
  2. Desfaz páginas em duas colunas (lê a coluna da esquerda inteira, depois a da direita).
  3. Remove cabeçalhos e rodapés que se repetem em muitas páginas (listados no relatório).
  4. Separa o bloco de gabarito, se houver, e lê as letras.
  5. Separa as questões ("Questão 1", "QUESTÃO 01", "1.", "1)", "01 -"...) e as alternativas
     ("A)", "(A)", "A.", "A -", "a)"...), com 4 ou 5 alternativas.
  6. PDF: extrai as figuras e prende cada uma à questão em que aparece (pela posição na página).
  7. PROVA DE FIDELIDADE: compara, palavra por palavra, o texto original de cada questão com o que foi gravado.
     Qualquer palavra que suma aparece no relatório. Nada é perdido em silêncio.
  8. Opcional (--reparar-com-ia): só nas questões que o código não conseguiu separar, pede à IA a separação,
     e só aceita se a resposta usar exatamente as palavras do original.

Uso:
  python ferramentas/importar_prova.py --arquivo provas/AMP/2015.pdf --banca AMP --ano 2015 --gabarito gabarito.json
  python ferramentas/importar_prova.py --pasta provas --banca SUS-SP --gabarito gabarito.json      (todas as edições)
Organização sugerida dos originais: provas/<BANCA>/<ANO>.pdf  (ou .txt)
"""
import argparse
import collections
import difflib
import hashlib
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from crivo_comum import (ler_json, gravar_json, arq_questoes, pasta_edicao, novo_arquivo_questoes, id_questao,
                         sem_acento, texto_puro, LETRAS)

# ======================================================================= 1. leitura
def tem(cmd):
    return shutil.which(cmd) is not None


GLIFO_SEM_TABELA = re.compile(r"[\u0100-\u02af\u0370-\u03ff]")


def reparar_se_preciso(caminho, log):
    """Algumas provas (ex.: ENAMED 2025) têm fontes sem tabela de caracteres: o texto sai como 'ǆĂŵĞ'.
    O reparo acrescenta a tabela aprendida das fontes da mesma família (sem OCR, sem perda)."""
    r = subprocess.run(["pdftotext", "-enc", "UTF-8", caminho, "-"], capture_output=True, text=True)
    estranhos = len(GLIFO_SEM_TABELA.findall(r.stdout))
    if estranhos < 50:
        return caminho
    import reparar_fontes
    saida = os.path.join(tempfile.mkdtemp(), "reparado.pdf")
    reparar_fontes.main(caminho, saida)
    r2 = subprocess.run(["pdftotext", "-enc", "UTF-8", saida, "-"], capture_output=True, text=True)
    resto = len(GLIFO_SEM_TABELA.findall(r2.stdout))
    log(f"   Fontes sem tabela de caracteres reparadas: {estranhos} caracteres ilegíveis -> {resto}")
    return saida


def paginas_digitalizadas(caminho):
    """Páginas cujo único texto é a camada invisível de OCR (fonte GlyphLessFont): o texto pode ter erros."""
    r = subprocess.run(["pdfinfo", caminho], capture_output=True, text=True)
    n = int((re.search(r"Pages:\s+(\d+)", r.stdout) or [0, 0])[1])
    out = []
    for p in range(1, n + 1):
        f = subprocess.run(["pdffonts", "-f", str(p), "-l", str(p), caminho], capture_output=True, text=True).stdout
        nomes = {l.split()[0] for l in f.splitlines()[2:] if l.strip()}
        if nomes and all("GlyphLess" in x for x in nomes):
            out.append(p)
    return out


def faixas_da_pagina(linhas, larg, alt):
    """Divide a página em faixas horizontais: 'larga' onde há texto atravessando o meio da página
    (enunciado, tabela ou figura de largura total) e 'colunas' no resto. Devolve [(tipo, y0, y1)]."""
    meio = larg / 2
    cruza = sorted((y0, y1) for x0, y0, x1, y1 in linhas if x0 < meio - 4 and x1 > meio + 4)
    faixas, y = [], 0.0
    for y0, y1 in cruza:
        if faixas and faixas[-1][0] == "larga" and y0 - faixas[-1][2] < 2 * (y1 - y0) + 2:
            faixas[-1] = ("larga", faixas[-1][1], y1)          # junta linhas largas vizinhas
            continue
        if y0 - 1 > y:
            faixas.append(("colunas", y, y0 - 1))
        faixas.append(("larga", y0 - 1, y1 + 1))
        y = y1 + 1
    ultimo = faixas[-1][2] if faixas else 0.0
    if ultimo < alt:
        faixas.append(("colunas", ultimo, alt))
    # ajusta: cada faixa começa onde a anterior termina
    out, y = [], 0.0
    for tipo, y0, y1 in faixas:
        out.append((tipo, y, max(y, y1))); y = max(y, y1)
    return out


def paginas_em_faixas(caminho):
    """Provas em 2 colunas com trechos de largura total (ENAMED): lê cada faixa na ordem certa —
    faixa larga inteira; faixa em colunas = metade esquerda e depois a direita."""
    r = subprocess.run(["pdftotext", "-bbox-layout", "-enc", "UTF-8", caminho, "-"], capture_output=True, text=True)
    paginas = []
    for k, pg in enumerate(re.findall(r"<page\b(.*?)</page>", r.stdout, re.S), 1):
        larg = float(re.search(r'width="([\d.]+)"', pg).group(1)); alt = float(re.search(r'height="([\d.]+)"', pg).group(1))
        linhas = [tuple(map(float, m)) for m in re.findall(
            r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"', pg)]
        partes = []
        for tipo, y0, y1 in faixas_da_pagina(linhas, larg, alt):
            if y1 - y0 < 1:
                continue
            if tipo == "larga":
                partes.append(_pdftotext_faixa(caminho, k, 0, y0, larg, y1 - y0))
            else:
                partes.append(_pdftotext_faixa(caminho, k, 0, y0, larg / 2, y1 - y0))
                partes.append(_pdftotext_faixa(caminho, k, larg / 2, y0, larg / 2, y1 - y0))
        paginas.append("\n\n".join(p for p in partes if p.strip()))
    return paginas


def _pdftotext_faixa(caminho, p, x, y, w, h):
    # -x/-y/-W/-H em pixels da resolução -r; com -r 72, 1 pixel = 1 ponto do PDF
    cmd = ["pdftotext", "-layout", "-enc", "UTF-8", "-r", "72", "-f", str(p), "-l", str(p),
           "-x", str(int(x)), "-y", str(int(y)), "-W", str(int(w + 0.999)), "-H", str(int(h + 0.999)), caminho, "-"]
    return subprocess.run(cmd, capture_output=True, text=True).stdout.replace("\f", "")


def texto_do_pdf(caminho, log, colunas=1):
    if not tem("pdftotext"):
        raise SystemExit("Instale o poppler: sudo apt install poppler-utils  (no Windows, use o WSL)")
    if colunas == 2:
        paginas = paginas_em_faixas(caminho)
    else:
        r = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", caminho, "-"], capture_output=True, text=True)
        paginas = r.stdout.split("\f")
    if paginas and not paginas[-1].strip():
        paginas = paginas[:-1]
    letras = sum(len(re.findall(r"[A-Za-zÀ-ÿ]", p)) for p in paginas)
    if letras > 200 * max(1, len(paginas)) * 0.2:
        return paginas, "pdf"
    log("   O PDF não tem texto (provavelmente digitalizado). Usando OCR em português — confira com atenção.")
    if not (tem("pdftoppm") and tem("tesseract")):
        raise SystemExit("Para PDF digitalizado, instale: sudo apt install poppler-utils tesseract-ocr tesseract-ocr-por")
    paginas = []
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-r", "300", "-png", caminho, os.path.join(tmp, "p")], check=True)
        for img in sorted(f for f in os.listdir(tmp) if f.endswith(".png")):
            r = subprocess.run(["tesseract", os.path.join(tmp, img), "-", "-l", "por", "--psm", "4"],
                               capture_output=True, text=True)
            paginas.append(r.stdout)
    return paginas, "ocr"


def texto_do_txt(caminho):
    with open(caminho, encoding="utf-8", errors="replace") as f:
        t = f.read().replace("\r\n", "\n").replace("\r", "\n")
    return t.split("\f"), "txt"


# ======================================================================= 2. colunas
def inicio_coluna_direita(linhas):
    c = collections.Counter()
    for l in linhas:
        for m in re.finditer(r"(?<=\S) {3,}(?=\S)", l):
            if m.end() >= 30:
                c[m.end()] += 1
                break
    if not c:
        return None
    # agrupa posições vizinhas (±2), porque o pdftotext não alinha perfeitamente
    melhor, total = None, 0
    for pos in c:
        s = sum(v for p, v in c.items() if abs(p - pos) <= 2)
        if s > total:
            melhor, total = pos, s
    uteis = [l for l in linhas if l.strip()]
    if total < max(8, 0.35 * len(uteis)):
        return None
    return min(p for p in c if abs(p - melhor) <= 2)


def desdobrar(pagina):
    linhas = pagina.split("\n")
    x = inicio_coluna_direita(linhas)
    if x is None:
        return linhas, None
    esq = [l[:x].rstrip() for l in linhas]
    dir_ = [l[x:].strip() if len(l) > x else "" for l in linhas]
    return esq + [""] + dir_, x


# ======================================================================= 3. cabeçalhos e rodapés
RUIDO_PADRAO = [r"^\s*Prova na [ií]ntegra(\s+\d{4})?\s*$", r"^\s*CADERNO\s+\d{1,2}\s*$", r"^\s*[ÁA]REA LIVRE\s*$", r"^\s*P[aá]gina\s+\d+(\s+de\s+\d+)?\s*$",
                r"^\s*\d{1,3}\s*/\s*\d{1,3}\s*$"]
RE_NUMERO_SOZINHO = re.compile(r"^\s*[-–]?\s*\d{1,3}\s*[-–]?\s*$")
BORDA = 3          # cabeçalho/rodapé = até 3 linhas não vazias no topo ou no pé da página


def assinatura(l):
    return re.sub(r"\d+", "#", re.sub(r"\s+", " ", l.strip().lower()))


def _indices_borda(linhas):
    cheias = [i for i, l in enumerate(linhas) if l.strip()]
    return set(cheias[:BORDA] + cheias[-BORDA:])


def remover_ruido(paginas_linhas, extras_regex):
    """Remove cabeçalhos/rodapés SEM tocar no conteúdo:
       - linha no topo/pé da página que se repete (no topo/pé) em >= 40% das páginas;
       - número sozinho no topo/pé (número de página);
       - padrões conhecidos ("Prova na íntegra", "Página 3 de 20") e os passados em --remover.
       Linhas que parecem início de questão ou de alternativa nunca são removidas."""
    n = len(paginas_linhas)
    cont = collections.Counter()
    for linhas in paginas_linhas:
        for a in {assinatura(linhas[i]) for i in _indices_borda(linhas)}:
            cont[a] += 1
    repetidas = {a for a, c in cont.items() if n >= 3 and c >= max(3, 0.4 * n) and len(a) <= 120}
    padroes = [re.compile(p, re.I) for p in RUIDO_PADRAO + list(extras_regex or [])]
    protegida = lambda l: bool(re.match(r"^\s*(quest[aã]o\b|\(?[A-Ea-e]\s*[).]\s)", l, re.I))
    removidas = collections.Counter()
    saida = []
    for linhas in paginas_linhas:
        borda = _indices_borda(linhas) if n >= 2 else set()
        nova = []
        for i, l in enumerate(linhas):
            s = l.strip()
            if s and not protegida(l) and (
                    any(p.match(l) for p in padroes)
                    or (i in borda and (assinatura(l) in repetidas or RE_NUMERO_SOZINHO.match(l)))):
                removidas[s[:100]] += 1
                continue
            nova.append(l)
        saida.append(nova)
    return saida, removidas


# ======================================================================= 4. gabarito no próprio arquivo
RE_TITULO_GAB = re.compile(r"^\s*(gabarito|respostas)\b.*$", re.I)
RE_PAR_GAB = re.compile(r"(?:quest[aã]o\s*)?(?<![\w/])(\d{1,3})\s*[-–:.)]?\s+([A-E])(?![\wÀ-ÿ])", re.I)
RE_PAR_VAZIO = re.compile(r"quest[aã]o\s*(\d{1,3})\s*[-–:]\s*$", re.I)


def separar_gabarito(linhas):
    """Procura um bloco 'Gabarito' na parte final e devolve (linhas_sem_gabarito, {num: letra|None})."""
    inicio = int(len(linhas) * 0.5)
    for i in range(len(linhas) - 1, inicio - 1, -1):
        if RE_TITULO_GAB.match(linhas[i]):
            gab = {}
            for l in linhas[i + 1:]:
                for m in RE_PAR_GAB.finditer(l):
                    gab.setdefault(int(m.group(1)), m.group(2).upper())
                m = RE_PAR_VAZIO.search(l)
                if m:
                    gab.setdefault(int(m.group(1)), None)       # sem letra = anulada
            if len(gab) >= 3:
                return linhas[:i], gab, linhas[i:]
    return linhas, {}, []


# ======================================================================= 5. questões e alternativas
ESTILOS_QUESTAO = [
    ("Questão N", re.compile(r"^\s*quest[aã]o\s*(?:n[ºo°.]\s*)?0*(\d{1,3})\s*[:.\-–)]?\s*(.*)$", re.I)),
    ("N) / N. / N -", re.compile(r"^\s*0*(\d{1,3})\s*[).\-–]\s+(\S.*)$")),
    ("N sozinho", re.compile(r"^\s*0*(\d{1,3})\s*[).\-–]?\s*$")),
]
ESTILOS_ALT = [
    ("A)", r"^\s*({L})\s*\)\s*(.*)$"),
    ("(A)", r"^\s*\(\s*({L})\s*\)\s*(.*)$"),
    ("A.", r"^\s*({L})\s*\.\s+(.*)$"),
    ("A -", r"^\s*({L})\s*[-–]\s+(.*)$"),
]


def separar_questoes(linhas, primeira=1):
    melhor = None
    for nome, rx in ESTILOS_QUESTAO:
        # cadeia mais longa de números consecutivos (saltos de até 2 tolerados) que começa em `primeira`:
        # instruções numeradas da capa e listas internas ("1) Carvedilol 2) ...") formam cadeias curtas e ficam de fora
        achados = []
        for i, l in enumerate(linhas):
            m = rx.match(l)
            if m:
                achados.append((i, int(m.group(1)), m.group(2) if m.lastindex >= 2 else ""))
        tam, ant = [0] * len(achados), [-1] * len(achados)
        ultimo_por_numero = {}          # número -> (tamanho da melhor cadeia que termina nele, índice)
        for k, (i, n, _) in enumerate(achados):
            melhor_k = (1, -1) if n == primeira else (0, -1)
            for d in (1, 2, 3):
                t = ultimo_por_numero.get(n - d)
                if t and t[0] + 1 > melhor_k[0]:
                    melhor_k = (t[0] + 1, t[1])
            tam[k], ant[k] = melhor_k
            if tam[k] and (n not in ultimo_por_numero or tam[k] >= ultimo_por_numero[n][0]):
                ultimo_por_numero[n] = (tam[k], k)
        marcas = []
        if achados and max(tam) > 0:
            k = max(range(len(achados)), key=lambda x: (tam[x], -x))
            while k != -1:
                marcas.append(achados[k]); k = ant[k]
            marcas.reverse()
        if not melhor or len(marcas) > len(melhor[1]):
            melhor = (nome, marcas)
    nome, marcas = melhor
    blocos = {}
    for k, (i, n, resto) in enumerate(marcas):
        fim = marcas[k + 1][0] if k + 1 < len(marcas) else len(linhas)
        blocos[n] = ([resto] if resto.strip() else []) + linhas[i + 1:fim]
    antes = linhas[:marcas[0][0]] if marcas else linhas
    return nome, blocos, antes


def separar_alternativas(bloco, n_alt):
    letras = LETRAS[:n_alt]
    melhor = None
    for nome, modelo in ESTILOS_ALT:
        for maiusc in (True, False):
            rx = re.compile(modelo.format(L="[A-E]" if maiusc else "[a-e]"))
            achadas, prox = [], 0
            for i, l in enumerate(bloco):
                m = rx.match(l)
                if m and prox < n_alt and m.group(1).upper() == letras[prox]:
                    achadas.append((i, m.group(1).upper(), m.group(2)))
                    prox += 1
            if not melhor or len(achadas) > len(melhor[1]):
                melhor = (nome, achadas)
    nome, achadas = melhor
    if len(achadas) < n_alt:
        # alternativas na mesma linha: "A) xxx  B) yyy"
        corrido = "\n".join(bloco)
        rx = re.compile(r"(?:(?<=\s)|^)\(?([A-E])\)\s+")
        pos = [m for m in rx.finditer(corrido)]
        seq, prox = [], 0
        for m in pos:
            if prox < n_alt and m.group(1) == letras[prox]:
                seq.append(m); prox += 1
        if len(seq) == n_alt:
            enun = corrido[:seq[0].start()].split("\n")
            alts = {}
            for k, m in enumerate(seq):
                fim = seq[k + 1].start() if k + 1 < len(seq) else len(corrido)
                alts[m.group(1)] = corrido[m.end():fim].split("\n")
            return "mesma linha", enun, alts
    if not achadas:
        return nome, bloco, {}
    enun = bloco[:achadas[0][0]]
    alts = {}
    for k, (i, letra, resto) in enumerate(achadas):
        fim = achadas[k + 1][0] if k + 1 < len(achadas) else len(bloco)
        alts[letra] = [resto] + bloco[i + 1:fim]
    return nome, enun, alts


RE_ITEM = re.compile(r"^\s*(?:(?:I{1,3}|IV|V|VI{1,3}|IX|X)\s*[-–.)]|\(\s*[IVX\d]*\s*\)|\d\s*[-–.)]\s|[ivx]{1,4}\.\s|[•▪●\-–]\s)")


def eh_linha_de_tabela(l):
    l = re.sub(r"\(\s*[VFvf]?\s*\)", "()", l.strip())          # "(    )" de verdadeiro/falso não é tabela
    return len(re.findall(r"\S(?: {3,})(?=\S)", l)) >= 1 and len(l) > 10


def _celulas(l):
    """[(início, texto)] das células de uma linha de tabela (células separadas por 3+ espaços).
    Expoente solto ("261.000/mm    3") volta para a célula ("261.000/mm3")."""
    cel = [(m.start(), m.group(0)) for m in re.finditer(r"\S+(?: {1,2}\S+)*", l)]
    out = []
    for c, t in cel:
        if out and re.fullmatch(r"[23]", t) and re.search(r"(?:mm|cm|m|dm)$", out[-1][1]):
            out[-1] = (out[-1][0], out[-1][1] + t)
        else:
            out.append((c, t))
    return out


def _montar_linha(cel):
    linha = ""
    for c, t in sorted(cel):
        linha = (linha + " " * max(3 if linha else 0, c - len(linha))) + t
    return linha


def fundir_celulas_quebradas(linhas):
    """Célula de tabela que ocupa 2 ou 3 linhas no PDF ("0,2 mg/dL a" / "1,20 mg/dL" acima e abaixo da linha
    "Bilirrubina total   6,2 mg/dL") vira uma célula só, na linha certa. As colunas são achadas pelos
    espaços verticais livres (vale para células centralizadas)."""
    tab = [eh_linha_de_tabela(l) for l in linhas]
    if not any(tab):
        return linhas
    linhas, apagar = list(linhas), set()
    for i in range(len(linhas)):
        if tab[i]:
            linhas[i] = _montar_linha(_celulas(linhas[i]))
    largura = max(len(l) for i, l in enumerate(linhas) if tab[i])
    ocup = [False] * (largura + 1)
    for i, l in enumerate(linhas):
        if tab[i]:
            for c, t in _celulas(l):
                for k in range(c, c + len(t)):
                    ocup[k] = True
    # intervalos ocupados = colunas
    colunas, k = [], 0
    while k <= largura:
        if ocup[k]:
            j = k
            while j <= largura and ocup[j]:
                j += 1
            colunas.append((k, j)); k = j
        else:
            k += 1
    def coluna_de(c, t):
        meio = c + len(t) / 2
        return min(range(len(colunas)), key=lambda n: 0 if colunas[n][0] <= meio < colunas[n][1]
                   else min(abs(meio - colunas[n][0]), abs(meio - colunas[n][1])))
    cheias = [i for i, l in enumerate(linhas) if l.strip()]
    for pos, i in enumerate(cheias):
        l = linhas[i]
        if tab[i] or len(l) - len(l.lstrip()) < 8 or len(l.strip()) > 40:
            continue
        ant = next((cheias[k] for k in range(pos - 1, -1, -1) if cheias[k] not in apagar), None)
        prox = cheias[pos + 1] if pos + 1 < len(cheias) else None
        if ant is None or prox is None or not tab[ant] or not tab[prox]:
            continue
        ini = len(l) - len(l.lstrip()); frag = l.strip()
        col = coluna_de(ini, frag)
        def celula(j):
            return next(((c, t) for c, t in _celulas(linhas[j]) if coluna_de(c, t) == col), None)
        def colocar(j, texto):
            cel = _celulas(linhas[j]); alvo = celula(j)
            if alvo:
                cel.remove(alvo)
                cel.append((alvo[0], alvo[1] + ("" if alvo[1].endswith(("/", "-")) else " ") + texto))
            else:
                cel.append((colunas[col][0], texto))
            linhas[j] = _montar_linha(cel)
        if not celula(ant):
            colocar(ant, frag)
        elif not celula(prox):
            colocar(prox, frag)
        else:
            colocar(ant, frag)
        apagar.add(i)
    return [l for i, l in enumerate(linhas) if i not in apagar]


# ---- hífen no fim da linha: separação de sílabas ("larin-gotraqueal") ou hífen de verdade ("apresenta-se")
CLITICOS = {"se", "lo", "la", "los", "las", "lhe", "lhes", "me", "te", "nos", "vos", "o", "a", "os", "as"}
PREFIXOS_COM_HIFEN = {"pré", "pós", "pró", "recém", "além", "aquém", "ex", "vice", "sem", "bem", "pronto", "tônico",
                      "herpes", "ântero", "póstero", "látero", "súpero", "ínfero", "médio", "infanto", "sócio", "mal"}
VOCAB = {"palavras": set(), "hifenizadas": set()}


def preparar_vocabulario(texto):
    """Palavras do próprio arquivo (fora das quebras de linha) para decidir cada hífen de fim de linha."""
    t = re.sub(r"-[ \t]*\n", "\n", texto.lower())          # ignora os hífens de fim de linha
    VOCAB["palavras"] |= set(re.findall(r"[a-zà-ÿ]+", t))
    VOCAB["hifenizadas"] |= set(re.findall(r"\b[a-zà-ÿ]+-[a-zà-ÿ]+\b", t))


def vocabulario_do_acervo(dados, ignorar=()):
    """Soma ao vocabulário as palavras das provas já importadas (todas as bancas), exceto as que serão refeitas."""
    import glob
    for f in glob.glob(os.path.join(dados, "*", "*", "questoes.json")):
        partes = os.path.normpath(f).split(os.sep)
        if (partes[-3], partes[-2]) in ignorar:
            continue
        for q in (ler_json(f, {}) or {}).get("questoes", []):
            t = texto_puro((q.get("enunciado_html") or "") + " " + " ".join((q.get("alternativas") or {}).values()))
            preparar_vocabulario(t)


def unir_hifen(ant, prox):
    """ant termina com 'xxx-'; prox começa com minúscula. Devolve a junção, com ou sem o hífen."""
    a = re.search(r"([A-Za-zÀ-ÿ]+)-$", ant).group(1).lower()
    b = re.match(r"([a-zà-ÿ]+)", prox).group(1)
    junto, com = a + b, f"{a}-{b}"
    if com in VOCAB["hifenizadas"] and junto not in VOCAB["palavras"]:
        sep = "-"
    elif junto in VOCAB["palavras"] and com not in VOCAB["hifenizadas"]:
        sep = ""
    elif b in CLITICOS and len(a) >= 3 and a[-1] in "aeiouáéíóúâêôãõr" and junto not in VOCAB["palavras"]:
        sep = "-"                                   # apresenta-se, fazê-lo, encontra-se
    elif a in PREFIXOS_COM_HIFEN and not (a == "mal" and b[0] not in "aeiouhàáéíóú"):
        sep = "-"                                   # pré-natal, pronto-socorro, tônico-clônica
    else:
        sep = ""                                    # separação de sílabas
    return ant[:-1] + sep + prox


def juntar_linhas(linhas):
    """Texto -> HTML simples. Junta linhas quebradas, preserva itens, parágrafos e tabelas (colunas alinhadas)."""
    # palavra hifenizada no fim da linha, inclusive na troca de página/coluna (com até 3 linhas vazias no meio):
    # "larin-" + "gotraqueal" -> "laringotraqueal". Junta na linha de cima, sem deixar linha vazia no lugar.
    juntas, vazias = [], []
    for l in linhas:
        if not l.strip():
            vazias.append(l); continue
        if juntas and len(vazias) <= 3 and re.search(r"[A-Za-zÀ-ÿ]-$", juntas[-1].rstrip()) and re.match(r"\s*[a-zà-ÿ]", l):
            juntas[-1] = unir_hifen(juntas[-1].rstrip(), l.strip())
        else:
            juntas.extend(vazias); juntas.append(l)
        vazias = []
    linhas = fundir_celulas_quebradas(juntas + vazias)
    # linha em branco entre duas linhas de tabela não separa a tabela
    linhas = [l for i, l in enumerate(linhas)
              if l.strip() or not (0 < i < len(linhas) - 1 and eh_linha_de_tabela(linhas[i - 1]) and eh_linha_de_tabela(linhas[i + 1]))]
    blocos, atual = [], []
    for l in linhas + [""]:
        if not l.strip():
            if atual: blocos.append(atual); atual = []
        else:
            if atual and eh_linha_de_tabela(atual[-1]) != eh_linha_de_tabela(l):   # texto <-> tabela
                blocos.append(atual); atual = []
            atual.append(l.rstrip())
    saida, tabelas = [], 0
    for bloco in blocos:
        if len(bloco) >= 2 and sum(eh_linha_de_tabela(l) for l in bloco) >= max(2, 0.7 * len(bloco)):
            linhas_tab = [re.split(r" {3,}", l.strip()) for l in bloco]
            cab, *corpo = linhas_tab
            h = "<table class=\"data-table\"><thead><tr>" + "".join(f"<th>{html.escape(c)}</th>" for c in cab) + "</tr></thead><tbody>"
            h += "".join("<tr>" + "".join(f"<td>{html.escape(c)}</td>" for c in r) + "</tr>" for r in corpo) + "</tbody></table>"
            saida.append(h); tabelas += 1
            continue
        partes = []
        for l in (x.strip() for x in bloco):
            if partes and not RE_ITEM.match(l):
                ant = partes[-1]
                if re.search(r"[A-Za-zÀ-ÿ]-$", ant) and re.match(r"[a-zà-ÿ]", l):
                    partes[-1] = unir_hifen(ant, l)
                else:
                    partes[-1] = ant + " " + l
            else:
                partes.append(l)
        saida.append("<br>".join(html.escape(re.sub(r"\s+", " ", p), quote=False) for p in partes))
    return "<br><br>".join(saida), tabelas


# texto compartilhado ("Leia o caso a seguir para responder às questões 31 e 32")
RE_COMPARTILHADO = re.compile(r"quest(?:ões|oes|ão|ao)\s+(\d{1,3})\s*(?:,|e|a|até|-|–)\s*(\d{1,3})", re.I)


def recolocar_letra_solta(linhas):
    """PDF às vezes desloca a 1ª palavra de uma linha ('A', 'O') para uma linha sozinha no meio do texto.
    Se a alternativa começa com minúscula e há uma linha só com 'A'/'O'/'E'/'As'/'Os', a palavra volta ao início."""
    if not linhas or not linhas[0].strip() or not re.match(r"[a-zà-ÿ]", linhas[0].strip()):
        return linhas, False
    for i in range(1, len(linhas)):
        if re.fullmatch(r"\s*(A|O|E|As|Os|Um|Uma)\s*", linhas[i]):
            return [linhas[i].strip() + " " + linhas[0].strip()] + linhas[1:i] + linhas[i + 1:], True
    return linhas, False


def separar_compartilhado(alts):
    """Se a última alternativa termina com um parágrafo que anuncia texto para outras questões, separa-o."""
    if not alts:
        return alts, None
    ultima = list(alts)[-1]
    linhas = alts[ultima]
    guia = re.compile(r"\b(leia|considere|utilize|baseando|com base|responda|responder|texto|caso|enunciado)\b", re.I)
    for i in range(1, len(linhas)):
        trecho = " ".join(l.strip() for l in linhas[i:i + 3])
        comeca = not linhas[i - 1].strip() or re.match(r"\s*[A-ZÀ-Ý]", linhas[i])
        m = RE_COMPARTILHADO.search(trecho[:300])
        if comeca and linhas[i].strip() and m and guia.search(trecho[:m.end()]):
            return dict(alts, **{ultima: linhas[:i]}), (int(m.group(1)), int(m.group(2)), linhas[i:])
    return alts, None


# ======================================================================= 6. imagens do PDF
_IMG = (r"(?:figura|imagem|imagens|fotografia|foto|ilustra[cç][aã]o|gr[aá]fico|heredograma|esquema|mapa|"
        r"fluxograma|tra[cç]ado|eletrocardiograma|ecg|radiografia|tomografia|ultrassonografia|ecocardiograma|"
        r"dermatoscopia|rx)")
_REF = (r"(?:abaixo|a\s+seguir|ao\s+lado|acima|observ\w*|apresentad[ao]s?|mostrad[ao]s?|ilustrad[ao]s?|"
        r"representad[ao]s?|exibid[ao]s?|adicionad[ao]s?|anexad[ao]s?|an[aá]lise\s+d[oa])")
RE_CITA_IMAGEM = re.compile(rf"(?is)\b{_IMG}\b\W+(?:\w+\W+){{0,5}}?\b{_REF}\b|\b{_REF}\b\W+(?:\w+\W+){{0,5}}?\b{_IMG}\b")


def imagens_do_pdf(caminho, destino, primeira, log):
    """Extrai figuras com pdftohtml -xml e associa cada uma à questão cujo início vem antes dela na leitura.
    Devolve {numero_questao: [arquivo, ...]} e uma lista de avisos."""
    if not tem("pdftohtml"):
        return {}, ["pdftohtml indisponível: figuras não extraídas"]
    avisos, por_questao = [], collections.defaultdict(list)
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, "p")
        subprocess.run(["pdftohtml", "-xml", "-q", "-nodrm", "-fmt", "png", caminho, base],
                       capture_output=True)
        xml = base + ".xml"
        if not os.path.isfile(xml):
            return {}, ["pdftohtml não gerou XML: figuras não extraídas"]
        raiz = ET.parse(xml).getroot()
        rx_q = [rx for _, rx in ESTILOS_QUESTAO]
        marcas, imgs, hashes = [], [], collections.Counter()
        for pag in raiz.iter("page"):
            pn, larg, alt_pag = int(pag.get("number")), float(pag.get("width")), float(pag.get("height"))
            textos = [(float(t.get("top")), float(t.get("left")), "".join(t.itertext()).strip()) for t in pag.iter("text")]
            # duas colunas se houver bastante texto começando depois do meio da página
            direita = sum(1 for _, x, s in textos if x > larg * 0.45 and s)
            duas = direita >= max(8, 0.25 * len(textos))
            col = lambda x: 1 if duas and x > larg * 0.45 else 0
            for top, left, s in textos:
                for rx in rx_q[:2]:
                    m = rx.match(s)
                    if m:
                        marcas.append(((pn, col(left), top), int(m.group(1)), s)); break
            for im in pag.iter("image"):
                arq = os.path.join(tmp, os.path.basename(im.get("src")))
                w, h = float(im.get("width")), float(im.get("height"))
                if not os.path.isfile(arq) or w * h < 2500:      # ícones e marcas muito pequenas
                    continue
                if w * h >= 0.5 * larg * alt_pag:                 # página digitalizada inteira, não é figura
                    avisos.append(f"página {pn}: imagem do tamanho da página (página digitalizada) — não usada como figura")
                    continue
                dig = hashlib.sha1(open(arq, "rb").read()).hexdigest()
                hashes[dig] += 1
                imgs.append(((pn, col(float(im.get("left"))), float(im.get("top"))), arq, dig))
        # numeração sequencial das marcas (descarta números soltos que não são questões)
        # cadeia crescente mais longa (saltos de até 5: páginas digitalizadas podem não ter o cabeçalho legível)
        marcas.sort()
        tam, ant = [0] * len(marcas), [-1] * len(marcas)
        for k, (_, n, _) in enumerate(marcas):
            tam[k] = 1 if primeira <= n <= primeira + 5 else 0
            for j in range(k):
                nj = marcas[j][1]
                if tam[j] and nj < n <= nj + 5 and tam[j] + 1 > tam[k]:
                    tam[k], ant[k] = tam[j] + 1, j
        seq = []
        k = max(range(len(marcas)), key=lambda i: tam[i]) if marcas else -1
        while k >= 0 and tam[k]:
            seq.append((marcas[k][0], marcas[k][1])); k = ant[k]
        seq.reverse()
        repetidas = {d for d, c in hashes.items() if c >= 3}       # logotipo em todas as páginas
        os.makedirs(destino, exist_ok=True)
        cont = collections.Counter()
        for chave, arq, dig in sorted(imgs):
            if dig in repetidas:
                continue
            dono = None
            for ch, n in seq:
                if ch <= chave:
                    dono = n
            if dono is None:
                aviso = f"figura(s) na página {chave[0]} antes da primeira questão (capa?) — ignorada(s)"
                if aviso not in avisos:
                    avisos.append(aviso)
                continue
            cont[dono] += 1
            nome = f"Q{dono}_{cont[dono]}{os.path.splitext(arq)[1]}"
            shutil.copy(arq, os.path.join(destino, nome))
            por_questao[dono].append(nome)
    return dict(por_questao), avisos


# ======================================================================= 7. fidelidade
def palavras(t):
    t = re.sub(r"([A-Za-zÀ-ÿ])-\s*\n\s*([a-zà-ÿ])", r"\1\2", t)          # hifenização de fim de linha
    t = re.sub(r"([A-Za-zÀ-ÿ]{2})-([A-Za-zÀ-ÿ])", r"\1\2", t)           # "pré-natal" = "prénatal" na comparação
    t = re.sub(r"\b(mm|cm|dm|m)\s+([23])\b", r"\1\2", t)                 # expoente solto: "mm 3" = "mm3"
    return [w for w in re.findall(r"[0-9A-Za-zÀ-ÿ%]+", sem_acento(t))]


def conferir_fidelidade(linhas_originais, q, compartilhado_html=""):
    """Compara as palavras do trecho original com as gravadas. Ignora só a numeração e as letras das alternativas.
    O texto compartilhado com outras questões é conferido à parte (fica em outra posição no resultado)."""
    # rótulos das alternativas ("A)", "(B)", "Alternativa C:") não são conteúdo: saem antes de comparar
    sem_rotulo = [re.sub(r"^\s*(?:alternativa\s+)?\(?[A-Ea-e]\)?\s*[:).\-–]\s*", "", l, flags=re.I) for l in linhas_originais]
    orig = palavras("\n".join(sem_rotulo))
    extras = (q.get("extras_html") or "").replace(compartilhado_html, "") if compartilhado_html else (q.get("extras_html") or "")
    grav_txt = " ".join([texto_puro(q["enunciado_html"].replace("<br>", "\n")), texto_puro(extras)]
                        + [texto_puro(v) for v in q["alternativas"].values()])
    grav = palavras(grav_txt)
    rotulos = {"questao", "quest", "alternativa", str(q["numero"]), f"{q['numero']:02d}"} | {l.lower() for l in LETRAS}
    sm = difflib.SequenceMatcher(None, orig, grav, autojunk=False)
    faltando, sobrando = [], []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op in ("delete", "replace"):
            trecho = [w for w in orig[i1:i2] if w not in rotulos]
            if trecho:
                faltando.append(" ".join(orig[i1:i2]))
        if op in ("insert", "replace"):
            trecho = [w for w in grav[j1:j2] if w not in rotulos]
            if trecho:
                sobrando.append(" ".join(grav[j1:j2]))
    if collections.Counter(" ".join(faltando).split()) == collections.Counter(" ".join(sobrando).split()):
        return 1.0, [], []          # mesmas palavras, só reposicionadas (ex.: letra deslocada pelo PDF)
    total = len([w for w in orig if w not in rotulos]) or 1
    perdidas = sum(len(s.split()) for s in faltando)
    return 1 - perdidas / total, faltando, sobrando


# ======================================================================= 8. reparo por IA (opcional)
PROMPT_REPARO = """TAREFA: SEPARAR_QUESTAO
Você recebe o texto bruto de UMA questão de prova extraído de um PDF. Separe o enunciado e as alternativas.
REGRAS: copie o texto EXATAMENTE como está, palavra por palavra, sem corrigir, resumir, traduzir ou completar.
Não acrescente nenhuma palavra. Não inclua o número da questão nem as letras das alternativas.
Responda só com JSON: {"enunciado": "...", "alternativas": {"A": "...", "B": "...", ...}}"""


def reparar_com_ia(cliente, numero, linhas, n_alt):
    bruto = "\n".join(linhas)
    r = cliente.json("reparar", PROMPT_REPARO, f"Número de alternativas esperado: {n_alt}\n\n{bruto}")
    alts = {k.upper(): str(v) for k, v in (r.get("alternativas") or {}).items() if k.upper() in LETRAS[:n_alt]}
    enun = str(r.get("enunciado") or "")
    if len(alts) != n_alt or not enun.strip():
        return None, "a IA não devolveu todas as partes"
    # aceita só se as palavras, na ordem, forem exatamente as do original (sem rótulos)
    rot = {"questao", str(numero), f"{numero:02d}"} | {l.lower() for l in LETRAS}
    sem_rotulo = lambda t: re.sub(r"(?im)^\s*(?:alternativa\s+)?\(?[A-Ea-e]\)?\s*[:).\-–]\s*", "", t)
    orig = [w for w in palavras(sem_rotulo(bruto)) if w not in rot]
    novo = [w for w in palavras(enun + "\n" + "\n".join(alts[l] for l in LETRAS[:n_alt])) if w not in rot]
    if orig != novo:
        return None, "a IA alterou o texto (rejeitado)"
    return (enun.split("\n"), {l: alts[l].split("\n") for l in LETRAS[:n_alt]}), None


# ======================================================================= importação de uma edição
def importar(arquivo, banca, ano, args, gabarito_oficial, disciplinas, log, cliente=None):
    transcricoes = {}
    caminho_t = os.path.join(os.path.dirname(os.path.abspath(arquivo)), "transcricoes.json")
    if os.path.isfile(caminho_t):
        transcricoes = (ler_json(caminho_t, {}) or {}).get(str(ano), {})
    rel = [f"# Importação {banca} {ano}", "", f"Arquivo: `{arquivo}`"]
    ext = os.path.splitext(arquivo)[1].lower()
    digitalizadas = []
    if ext == ".pdf":
        arquivo = reparar_se_preciso(arquivo, log)
        digitalizadas = paginas_digitalizadas(arquivo)
        paginas, metodo = texto_do_pdf(arquivo, log, args.colunas)
    else:
        paginas, metodo = texto_do_txt(arquivo)
    preparar_vocabulario("\n".join(paginas))
    em_pagina_digitalizada = sorted({int(m) for p in digitalizadas if p - 1 < len(paginas)
                                     for m in re.findall(r"QUEST[AÃ]O\s*0*(\d{1,3})\b", paginas[p - 1], re.I)})
    if args.paginas:
        a, _, b = args.paginas.partition("-")
        paginas = paginas[int(a) - 1:int(b or len(paginas))]
    # cabeçalho/rodapé saem ANTES de separar as colunas (senão a linha larga seria cortada ao meio)
    pag_brutas, removidas = remover_ruido([p.split("\n") for p in paginas], args.remover)
    pag_linhas, colunas = [], 0
    for linhas_p in pag_brutas:
        linhas, x = (linhas_p, None) if args.colunas == 2 else desdobrar("\n".join(linhas_p))
        colunas += x is not None
        pag_linhas.append(linhas)
    linhas = [l for pl in pag_linhas for l in pl + [""]]
    linhas, gab_texto, linhas_gab = separar_gabarito(linhas)
    estilo_q, blocos, antes = separar_questoes(linhas, args.primeira)
    rel += [f"Método: {metodo} | páginas: {len(paginas)} | " + ("cada página lida por metades (--colunas 2)" if args.colunas == 2
                                                               else f"páginas em 2 colunas: {colunas}"),
            f"Numeração reconhecida: {estilo_q} | questões encontradas: {len(blocos)}"]

    # gabarito: oficial (gabarito.json) > bloco do próprio arquivo
    avisos_gab = []
    gab_of = (gabarito_oficial.get(banca, {}) or {}).get(str(ano))
    motivo_anulacao = {}
    for k, v in (gab_of or {}).items():
        v = sem_acento(str(v or "")).strip().lower()
        if v.startswith("exclu"):
            motivo_anulacao[int(k)] = "excluida"
        elif "administrativ" in v:
            motivo_anulacao[int(k)] = "anulada_administrativamente"
    if gab_of:
        gab = {int(k): (v.strip().upper() if isinstance(v, str) and v.strip().upper() in LETRAS else None)
               for k, v in gab_of.items()}
        origem_gab = "gabarito.json"
        if gab_texto:
            dif = [n for n in gab_texto if n in gab and gab_texto[n] and gab[n] and gab_texto[n] != gab[n]]
            if dif:
                rel.append(f"**ATENÇÃO:** gabarito do arquivo difere do gabarito.json nas questões {dif}")
                avisos_gab = [f"Q{n}: gabarito impresso no arquivo = {gab_texto[n]}, gabarito.json = {gab[n]} "
                              f"(foi usado o gabarito.json; confirme qual é o definitivo)" for n in dif]
    else:
        gab, origem_gab = gab_texto, ("bloco 'Gabarito' do próprio arquivo" if gab_texto else "nenhum")
    rel.append(f"Gabarito: {origem_gab} ({len(gab)} questões)")

    letras_gab = {v for v in gab.values() if v}
    n_alt = args.alternativas or (5 if "E" in letras_gab else 4 if letras_gab else 5)
    if not args.alternativas and not letras_gab:
        cont = collections.Counter(len(separar_alternativas(b, 5)[2]) for b in blocos.values())
        n_alt = 4 if cont.get(4, 0) > cont.get(5, 0) else 5
    rel.append(f"Alternativas por questão: {n_alt}")

    # figuras
    destino_img = os.path.join(pasta_edicao(args.dados, banca, ano), "img")
    figuras, avisos_img = ({}, [])
    if metodo in ("pdf", "ocr") and not args.sem_imagens:
        if os.path.isdir(destino_img):
            shutil.rmtree(destino_img)
        figuras, avisos_img = imagens_do_pdf(arquivo, destino_img, args.primeira, log)

    disc = ((disciplinas or {}).get(banca, {}) or {}).get(str(ano), {}) or {}
    qs = novo_arquivo_questoes(banca, ano)
    if args.gabarito_preliminar:
        qs["gabarito_situacao"] = "preliminar"
    problemas, fidelidade, compartilhados, notas = list(avisos_gab), [], {}, []
    for n in sorted(blocos):
        bloco = blocos[n]
        estilo_a, enun, alts = separar_alternativas(bloco, n_alt)
        alts, comp = separar_compartilhado(alts)
        if comp:
            a, b, linhas_comp = comp
            for k in range(a, b + 1):
                compartilhados.setdefault(k, []).append(linhas_comp)
            bloco = bloco[:len(bloco) - len(linhas_comp)]
        reparo = ""
        if len(alts) != n_alt and cliente:
            res, erro = reparar_com_ia(cliente, n, bloco, n_alt)
            if res:
                enun, alts = res; reparo = " (separada pela IA, texto conferido)"
            else:
                reparo = f" (IA: {erro})"
        enun_html, tab1 = juntar_linhas(enun)
        extras, comp_html = [], ""
        for linhas_comp in compartilhados.get(n, []):
            comp_html += "<p><em>Texto para esta questão:</em></p><p>" + juntar_linhas(linhas_comp)[0] + "</p>"
            ok, falt, sobr = conferir_fidelidade(linhas_comp, {"numero": n, "enunciado_html": juntar_linhas(linhas_comp)[0],
                                                             "alternativas": {}})
            if falt or sobr:
                problemas.append(f"Q{n}: texto compartilhado com perda: {' | '.join(falt[:2])}")
        if comp_html:
            extras.append(comp_html)
        rel_img = os.path.relpath(destino_img, os.path.dirname(os.path.abspath(args.dados))).replace(os.sep, "/")
        for f in figuras.get(n, []):
            extras.append(f'<img src="{rel_img}/{f}" alt="Figura da questão {n}">')
        alternativas = {}
        for l, v in alts.items():
            v, mudou = recolocar_letra_solta(v)
            if mudou:
                notas.append(f"Q{n}{l}: palavra deslocada pelo PDF devolvida ao início da alternativa")
            alternativas[l] = juntar_linhas(v)[0]
        cita = bool(RE_CITA_IMAGEM.search(texto_puro(enun_html)))
        q = {"id": id_questao(banca, ano, n), "numero": n, "disciplina": disc.get(str(n)),
             "enunciado_html": enun_html, "extras_html": "".join(extras) or None, "alternativas": alternativas,
             "gabarito": gab.get(n), "imagem_pendente": cita and not figuras.get(n)}
        if figuras.get(n):
            q["imagem_conferir"] = True
        if n in motivo_anulacao:
            q["anulacao"] = motivo_anulacao[n]
        t = (transcricoes or {}).get(str(n))
        if t:
            # questão de página digitalizada, transcrita da imagem da página e conferida
            for campo in ("enunciado_html", "extras_html", "alternativas", "imagem_pendente"):
                if campo in t:
                    q[campo] = t[campo]
            q["transcricao_manual"] = t.get("fonte", "transcrita da imagem da página")
            notas.append(f"Q{n}: texto substituído pela transcrição manual ({q['transcricao_manual']})")
        elif n in em_pagina_digitalizada:
            q["texto_ocr"] = True
            problemas.append(f"Q{n}: está em página digitalizada (texto vindo de OCR, pode ter erros) — "
                             f"transcreva em provas/<BANCA>/transcricoes.json")
        qs["questoes"].append(q)
        if len(alternativas) != n_alt:
            problemas.append(f"Q{n}: {len(alternativas)} de {n_alt} alternativas reconhecidas{reparo}")
        elif reparo:
            problemas.append(f"Q{n}: alternativas{reparo}")
        if not enun_html.strip():
            problemas.append(f"Q{n}: enunciado vazio")
        if n not in gab:
            problemas.append(f"Q{n}: sem gabarito")
        if q.get("transcricao_manual"):
            continue
        cobertura, faltando, sobrando = conferir_fidelidade(bloco, q, comp_html)
        fidelidade.append(cobertura)
        if faltando or sobrando:
            problemas.append(f"Q{n}: fidelidade {cobertura:.1%}" +
                             (f" — FALTANDO: {' | '.join(s[:120] for s in faltando[:3])}" if faltando else "") +
                             (f" — A MAIS: {' | '.join(s[:120] for s in sobrando[:3])}" if sobrando else ""))
    numeros = sorted(blocos)
    if not numeros:
        problemas.append("nenhuma questão reconhecida (tente --primeira, --paginas ou --remover)")
    if numeros:
        buracos = [k for k in range(numeros[0], numeros[-1] + 1) if k not in blocos]
        if buracos:
            problemas.append(f"números de questão não encontrados: {buracos}")
    if gab and len(gab) != len(blocos):
        problemas.append(f"{len(blocos)} questões no texto e {len(gab)} no gabarito")
    texto_antes = " ".join(l.strip() for l in antes if l.strip())
    rel += [f"Fidelidade média: {sum(fidelidade) / max(1, len(fidelidade)):.2%} das palavras do original "
            f"(mínima: {min(fidelidade or [1]):.2%})",
            f"Figuras: {sum(len(v) for v in figuras.values())} em {len(figuras)} questões"
            + (f" — {figuras}" if figuras else ""),
            "", "## Problemas a conferir", *([f"- {p}" for p in problemas] or ["- nenhum"]),
            *[f"- {a}" for a in avisos_img],
            "", "## Ajustes automáticos", *([f"- {x}" for x in notas] or ["- nenhum"]),
            "", "## Linhas removidas como cabeçalho/rodapé (confira se nenhuma era conteúdo)",
            *([f"- `{l}` ({c}x)" for l, c in removidas.most_common(30)] or ["- nenhuma"]),
            "", "## Texto antes da primeira questão (capa/instruções — não entra nas questões)",
            (texto_antes[:1500] + (" [...]" if len(texto_antes) > 1500 else "")) or "(nenhum)"]
    return qs, problemas, rel


# ======================================================================= troca de texto
def _palavras_q(q):
    t = texto_puro((q.get("enunciado_html") or "") + " " + (q.get("extras_html") or "")) + " " + \
        " ".join(texto_puro(v) for v in (q.get("alternativas") or {}).values())
    return re.findall(r"[0-9a-z%]+", sem_acento(t))


def marcar_correcoes_de_texto_mudado(dados, banca, ano, velhos, novas, rel, limiar=0.85):
    """Ao substituir o texto de uma edição, a correção de uma questão cujo texto mudou muito foi escrita
    para outra questão: ela é marcada para ser refeita (status 'regerar') e o site mostra o aviso."""
    from crivo_comum import ler_correcoes, arq_correcoes
    cs = ler_correcoes(dados, banca, ano)
    marcadas = []
    for q in novas:
        v, c = velhos.get(q["id"]), cs["correcoes"].get(q["id"])
        if not v or not c:
            continue
        sim = difflib.SequenceMatcher(None, _palavras_q(v), _palavras_q(q), autojunk=False).ratio()
        if sim < limiar:
            rev = c.setdefault("revisao", {})
            rev["status"] = "regerar"
            al = rev.setdefault("alertas", [])
            if "texto_da_questao_mudou" not in al:
                al.append("texto_da_questao_mudou")
            marcadas.append(f"Q{q['numero']} ({sim:.0%})")
    if marcadas:
        gravar_json(arq_correcoes(dados, banca, ano), cs)
        rel += ["", "## Correções marcadas para refazer (o texto antigo era outro)",
                f"- {', '.join(marcadas)} — semelhança entre o texto antigo e o oficial entre parênteses"]
        print(f"   {len(marcadas)} correção(ões) marcadas para refazer: texto antigo diferente do oficial")


# ======================================================================= acervo (todas as provas num arquivo)
RE_INICIO_PROVA = re.compile(r"^\s*Prova na [ií]ntegra\s+((?:19|20)\d{2})\s*$", re.M)
RE_OUTRA_PROVA = re.compile(r"^\s*PROVA GERAL\s*[-–]\s*(?:19|20)\d{2}\s*$", re.M)


def dividir_acervo(caminho, pasta_tmp):
    """Arquivo com várias provas ('Prova na íntegra AAAA' ... 'Gabarito AAAA') -> um .txt por ano.
    O que vier depois do gabarito da última prova (ex.: caderno de outro ano colado) fica de fora e é relatado."""
    with open(caminho, encoding="utf-8", errors="replace") as f:
        t = f.read().replace("\r\n", "\n").replace("\r", "\n")
    marcas = list(RE_INICIO_PROVA.finditer(t))
    saida = []
    for k, m in enumerate(marcas):
        fim = marcas[k + 1].start() if k + 1 < len(marcas) else len(t)
        trecho = t[m.start():fim]
        resto = RE_OUTRA_PROVA.search(trecho)
        if resto:
            print(f"   {m.group(1)}: {len(trecho) - resto.start()} caracteres depois do gabarito "
                  f"('{resto.group(0).strip()}') não pertencem a esta prova e foram deixados de fora")
            trecho = trecho[:resto.start()]
        arq = os.path.join(pasta_tmp, f"{m.group(1)}.txt")
        with open(arq, "w", encoding="utf-8") as f:
            f.write(trecho)
        saida.append((m.group(1), arq))
    return saida


# ======================================================================= linha de comando
def achar_arquivos(pasta, banca):
    """provas/<BANCA>/<ANO>.pdf|.txt  ou  provas/<BANCA>/<ANO>/<qualquer>.pdf|.txt (PDF tem preferência)."""
    pb = os.path.join(pasta, banca)
    achados = {}
    for nome in sorted(os.listdir(pb)):
        p = os.path.join(pb, nome)
        ano = re.match(r"(\d{4})", nome)
        if not ano:
            continue
        if os.path.isdir(p):
            cands = [os.path.join(p, f) for f in sorted(os.listdir(p)) if f.lower().endswith((".pdf", ".txt"))
                     and "gabarito" not in f.lower()]
        else:
            cands = [p] if nome.lower().endswith((".pdf", ".txt")) else []
        for c in cands:
            if ano.group(1) not in achados or (c.lower().endswith(".pdf") and not achados[ano.group(1)].lower().endswith(".pdf")):
                achados[ano.group(1)] = c
    return sorted(achados.items())


def main():
    ap = argparse.ArgumentParser(description="Importa provas originais (.pdf/.txt) para questoes.json")
    ap.add_argument("--arquivo"); ap.add_argument("--pasta", help="pasta com <BANCA>/<ANO>.pdf|.txt")
    ap.add_argument("--acervo", help="um .txt com várias provas ('Prova na íntegra AAAA' ... 'Gabarito AAAA')")
    ap.add_argument("--banca", required=True); ap.add_argument("--ano")
    ap.add_argument("--gabarito", default="gabarito.json"); ap.add_argument("--disciplinas")
    ap.add_argument("--dados", default="dados"); ap.add_argument("--relatorios", default="relatorios/importacao")
    ap.add_argument("--alternativas", type=int, choices=[4, 5], help="força 4 ou 5 alternativas (padrão: automático)")
    ap.add_argument("--gabarito-preliminar", action="store_true",
                    help="o gabarito ainda é o preliminar: o site avisa que pode mudar após os recursos")
    ap.add_argument("--colunas", type=int, choices=[1, 2], default=1,
                    help="2 = lê cada metade da página separadamente (provas em 2 colunas, como o ENAMED)")
    ap.add_argument("--primeira", type=int, default=1, help="número da primeira questão do caderno")
    ap.add_argument("--paginas", help="só estas páginas do arquivo, ex.: 3-18 (pula capa e gabarito)")
    ap.add_argument("--remover", nargs="*", help="expressões regulares de linhas a remover (cabeçalhos teimosos)")
    ap.add_argument("--sem-imagens", action="store_true")
    ap.add_argument("--reparar-com-ia", action="store_true", help="só para questões que o código não separou")
    ap.add_argument("--simular", action="store_true", help="com --reparar-com-ia: não chama a API")
    ap.add_argument("--sobrescrever", action="store_true", help="refaz questoes.json existente (correções são mantidas)")
    a = ap.parse_args()

    if a.arquivo:
        if not a.ano:
            m = re.search(r"(19|20)\d{2}", os.path.basename(a.arquivo))
            if not m: ap.error("informe --ano")
            a.ano = m.group(0)
        tarefas = [(a.ano, a.arquivo)]
    elif a.pasta:
        tarefas = [t for t in achar_arquivos(a.pasta, a.banca) if not a.ano or t[0] in a.ano.split()]
    elif a.acervo:
        tmp_acervo = tempfile.mkdtemp(prefix="acervo_")
        tarefas = [t for t in dividir_acervo(a.acervo, tmp_acervo) if not a.ano or t[0] in a.ano.split()]
    else:
        ap.error("informe --arquivo, --pasta ou --acervo")
    gabarito = ler_json(a.gabarito, {}) or {}
    disciplinas = ler_json(a.disciplinas, {}) if a.disciplinas else {}
    vocabulario_do_acervo(a.dados, {(a.banca, str(ano)) for ano, _ in tarefas})

    cliente, contador = None, None
    if a.reparar_com_ia:
        import json
        from ia_cliente import ClienteAPI, Contador
        config = json.load(open(os.path.join(AQUI, "config_gerador.json"), encoding="utf-8"))
        contador = Contador(config, config["orcamento_usd_por_execucao"])
        if a.simular:
            from simulador import ClienteSimulado
            cliente = ClienteSimulado(config, contador)
        else:
            cliente = ClienteAPI(config, contador, print)

    os.makedirs(a.relatorios, exist_ok=True)
    codigo = 0
    for ano, arquivo in tarefas:
        destino = arq_questoes(a.dados, a.banca, ano)
        if os.path.exists(destino) and not a.sobrescrever:
            print(f"PULADO {a.banca} {ano}: já existe {destino} (use --sobrescrever)"); continue
        print(f"\n{a.banca} {ano} <- {arquivo}")
        qs, problemas, rel = importar(arquivo, a.banca, ano, a, gabarito, disciplinas, print, cliente)
        if not qs["questoes"]:
            print("   NENHUMA questão reconhecida. Veja o relatório e use --primeira/--paginas/--remover.")
            codigo = 1
        else:
            antigos = ler_json(destino)
            if antigos:   # mantém dados preenchidos à mão que o arquivo original não tem
                velhos = {q["id"]: q for q in antigos.get("questoes", [])}
                for q in qs["questoes"]:
                    v = velhos.get(q["id"], {})
                    if not q.get("disciplina") and v.get("disciplina"):
                        q["disciplina"] = v["disciplina"]
                marcar_correcoes_de_texto_mudado(a.dados, a.banca, ano, velhos, qs["questoes"], rel)
            gravar_json(destino, qs)
        nome_rel = os.path.join(a.relatorios, f"{a.banca}_{ano}.md")
        with open(nome_rel, "w", encoding="utf-8") as f:
            f.write("\n".join(rel) + "\n")
        for l in rel[3:6]:
            print("   " + l)
        if problemas:
            codigo = 1
            print(f"   {len(problemas)} ponto(s) a conferir — veja {nome_rel}")
            for p in problemas[:8]:
                print("    - " + p)
        else:
            print(f"   OK, nada a conferir. Relatório: {nome_rel}")
    if contador:
        print("\n" + contador.resumo())
    print("\nDepois: python3 ferramentas/gerar_indice.py --dados dados  e confira em previa.html")
    return codigo


if __name__ == "__main__":
    sys.exit(main())
