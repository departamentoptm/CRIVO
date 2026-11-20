#!/usr/bin/env python3
"""
Converte as páginas questão_N.html já geradas em um JSON por edição:
    dados/<BANCA>/<ANO>/questoes.json e correcoes.json
Não usa IA e não altera os HTMLs originais.

Uso:
    python ferramentas/converter_html_para_json.py --repo /caminho/do/CRIVO --saida dados
"""
import argparse, html, json, os, re, sys
from html.parser import HTMLParser
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crivo_comum import gravar_json, arq_questoes, arq_correcoes
from migrar_para_dois_arquivos import separar

VERSAO_FORMATO = 1
TAGS_PERMITIDAS = {"p", "strong", "b", "em", "i", "u", "br", "ul", "ol", "li", "table", "thead",
                   "tbody", "tr", "th", "td", "sub", "sup", "span", "div", "img", "h5"}
ATRIBUTOS_PERMITIDOS = {"img": {"src", "alt"}, "table": {"class"}, "div": {"class"},
                        "span": {"class"}, "td": {"colspan", "rowspan"}, "th": {"colspan", "rowspan"}}


class Limpador(HTMLParser):
    """Mantém só tags/atributos seguros (sem script, onclick, style)."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.pular = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.pular += 1; return
        if self.pular or tag not in TAGS_PERMITIDAS:
            return
        ok = ATRIBUTOS_PERMITIDOS.get(tag, set())
        a = "".join(f' {k}="{html.escape(v or "", quote=True)}"' for k, v in attrs
                    if k in ok and not (v or "").lower().startswith("javascript:"))
        self.out.append(f"<{tag}{a}>")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.pular = max(0, self.pular - 1); return
        if not self.pular and tag in TAGS_PERMITIDAS and tag not in ("br", "img"):
            self.out.append(f"</{tag}>")

    def handle_data(self, d):
        if not self.pular:
            self.out.append(html.escape(d, quote=False))


def limpar(frag):
    p = Limpador(); p.feed(frag or ""); p.close()
    return re.sub(r"\s+", " ", "".join(p.out)).strip()


def texto(frag):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", frag or ""))).strip()


def entre(h, ini_rx, fim_rx):
    m = re.search(ini_rx, h, re.S)
    if not m: return None
    n = re.search(fim_rx, h[m.end():], re.S)
    return h[m.end(): m.end() + n.start()] if n else None


def converter_pagina(h, numero):
    erros = []
    tema = texto(entre(h, r'<div class="theme">', r"</div>") or "")
    h = re.sub(r"(?m)^[ \t]*```[a-zA-Z]*[ \t]*$", "", h)   # cercas de markdown soltas (bug do gerador antigo)
    enunciado = limpar(entre(h, r'<div class="question-text">', r"</div>") or "")
    # trecho entre o enunciado e as alternativas (tabelas/afirmativas, se houver)
    meio = entre(h, r'<div class="question-text">.*?</div>', r'<div class="options">') or ""
    extras = limpar(re.sub(r"<!--.*?-->", "", meio, flags=re.S))
    alternativas = {}
    for letra, rotulo in re.findall(r'<label for="option([A-E])">(.*?)</label>', h, re.S):
        t = re.sub(r"^\s*<strong>\s*[A-E]\s*</strong>\s*[-–]\s*", "", rotulo.strip())
        alternativas[letra] = limpar(t)
    m = re.search(r"const\s+correctAnswer\s*=\s*['\"]([A-E])['\"]", h)
    gabarito = m.group(1) if m else None
    corr = entre(h, r'id="correctionContent"[^>]*>', r'</div>\s*<button class="reset-btn"') or ""
    secoes = {}
    partes = re.split(r"<h4>\s*(2\.\d{1,2})\b[^<]*</h4>", corr)
    numeros = [partes[i] for i in range(1, len(partes), 2)]
    if len(numeros) == 15 and len(set(numeros)) < 15:
        numeros = [f"2.{k}" for k in range(1, 16)]      # título numerado errado: usa a ordem
    for n, i in zip(numeros, range(1, len(partes), 2)):
        secoes[n] = limpar(partes[i + 1])
    if not enunciado: erros.append("enunciado vazio")
    if len(alternativas) < 4: erros.append(f"só {len(alternativas)} alternativas")
    if not gabarito: erros.append("sem correctAnswer")
    faltando = [f"2.{k}" for k in range(1, 16) if f"2.{k}" not in secoes]
    if faltando: erros.append("seções ausentes: " + ", ".join(faltando))
    q = {
        "numero": numero,
        "tema": tema,
        "enunciado_html": enunciado,
        "extras_html": extras or None,
        "alternativas": alternativas,
        "gabarito": gabarito,
        "correcao": {"secoes_html": secoes},
        "origem": "convertido_html_v1",
        "revisao": {"status": "nao_revisado", "alertas": []},
    }
    return q, erros


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--saida", default="dados")
    ap.add_argument("--sobrescrever", action="store_true")
    a = ap.parse_args()
    manifest = json.load(open(os.path.join(a.repo, "exams", "manifest.json"), encoding="utf-8"))
    disc_path = os.path.join(a.repo, "exams", "disciplinas.json")
    disciplinas = json.load(open(disc_path, encoding="utf-8")) if os.path.isfile(disc_path) else {}
    total, problemas = 0, []
    for banca, anos in manifest.items():
        for ano, questoes in anos.items():
            edicao = {"formato": "crivo-edicao", "versao": VERSAO_FORMATO, "banca": banca,
                      "ano": str(ano), "questoes": []}
            for num, arq in sorted(questoes.items(), key=lambda kv: int(kv[0])):
                caminho = os.path.join(a.repo, "exams", banca, str(ano), arq)
                if not os.path.isfile(caminho):
                    problemas.append(f"{banca} {ano} Q{num}: arquivo ausente"); continue
                q, erros = converter_pagina(open(caminho, encoding="utf-8").read(), int(num))
                q["id"] = f"{banca}-{ano}-Q{int(num)}"
                q["disciplina"] = (disciplinas.get(banca, {}).get(str(ano), {}) or {}).get(str(num))
                if erros:
                    q["revisao"]["alertas"].append("conversao: " + "; ".join(erros))
                    problemas.append(f"{q['id']}: " + "; ".join(erros))
                edicao["questoes"].append(q); total += 1
            qs, cs = separar(edicao)   # grava no formato atual: questoes.json + correcoes.json
            if os.path.exists(arq_questoes(a.saida, banca, str(ano))) and not a.sobrescrever:
                print(f"PULADO {banca} {ano}: questoes.json já existe (use --sobrescrever)"); continue
            gravar_json(arq_questoes(a.saida, banca, str(ano)), qs)
            gravar_json(arq_correcoes(a.saida, banca, str(ano)), cs)
    print(f"{total} questões convertidas; {len(problemas)} com alerta.")
    for p in problemas: print("  -", p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
