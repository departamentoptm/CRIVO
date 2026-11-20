"""
Funções compartilhadas pelas ferramentas do CRIVO.

Organização dos dados (uma pasta por edição):
    dados/<BANCA>/<ANO>/questoes.json   -> enunciado, alternativas, gabarito oficial (FIXO; nunca gerado por IA)
    dados/<BANCA>/<ANO>/correcoes.json  -> correção de cada questão (gerada por IA, corrigível pelos usuários)
    dados/<BANCA>/temas.json            -> temas de cada questão da banca (usado para achar o histórico)
    dados/indice.json                   -> lista do que o site mostra (gerado por gerar_indice.py)
"""
import html
import json
import os
import re
import tempfile
import unicodedata
from html.parser import HTMLParser

LETRAS = ("A", "B", "C", "D", "E")
SECOES = [f"2.{k}" for k in range(1, 16)]


# ----------------------------------------------------------------- caminhos
def pasta_edicao(dados, banca, ano):
    return os.path.join(dados, banca, str(ano))


def arq_questoes(dados, banca, ano):
    return os.path.join(pasta_edicao(dados, banca, ano), "questoes.json")


def arq_correcoes(dados, banca, ano):
    return os.path.join(pasta_edicao(dados, banca, ano), "correcoes.json")


def arq_temas(dados, banca):
    return os.path.join(dados, banca, "temas.json")


def listar_edicoes(dados, banca=None):
    """[(banca, ano)] de todas as edições que têm questoes.json."""
    out = []
    if not os.path.isdir(dados):
        return out
    for b in sorted(os.listdir(dados)):
        if banca and b != banca:
            continue
        pb = os.path.join(dados, b)
        if not os.path.isdir(pb):
            continue
        for a in sorted(os.listdir(pb)):
            if os.path.isfile(arq_questoes(dados, b, a)):
                out.append((b, a))
    return out


# ----------------------------------------------------------------- leitura/gravação
def ler_json(caminho, padrao=None):
    if not os.path.isfile(caminho):
        return padrao
    with open(caminho, encoding="utf-8") as f:
        return json.load(f)


def gravar_json(caminho, dados):
    """Grava de forma atômica: nunca deixa um arquivo pela metade se o processo cair."""
    os.makedirs(os.path.dirname(caminho) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(caminho) or ".", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, caminho)


def ler_questoes(dados, banca, ano):
    return ler_json(arq_questoes(dados, banca, ano))


def ler_correcoes(dados, banca, ano):
    c = ler_json(arq_correcoes(dados, banca, ano))
    if c is None:
        c = {"formato": "crivo-correcoes", "versao": 1, "banca": banca, "ano": str(ano), "correcoes": {}}
    return c


def novo_arquivo_questoes(banca, ano):
    return {"formato": "crivo-questoes", "versao": 1, "banca": banca, "ano": str(ano), "questoes": []}


def id_questao(banca, ano, numero):
    return f"{banca}-{ano}-Q{int(numero)}"


# ----------------------------------------------------------------- HTML seguro
TAGS_OK = {"p", "strong", "b", "em", "i", "u", "br", "ul", "ol", "li", "table", "thead", "tbody",
           "tr", "th", "td", "sub", "sup", "span", "div", "img", "h5", "a"}
ATRIBUTOS_OK = {"img": {"src", "alt"}, "table": {"class"}, "div": {"class"}, "span": {"class"},
                "td": {"colspan", "rowspan"}, "th": {"colspan", "rowspan"}, "a": {"href"}}


class _Limpador(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.pular = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "iframe", "object", "embed"):
            self.pular += 1
            return
        if self.pular or tag not in TAGS_OK:
            return
        ok = ATRIBUTOS_OK.get(tag, set())
        partes = []
        for k, v in attrs:
            v = v or ""
            if k not in ok:
                continue
            if tag == "a" and k == "href" and not re.match(r"^https?://", v.strip(), re.I):
                continue
            if v.strip().lower().startswith(("javascript:", "data:text")):
                continue
            partes.append(f' {k}="{html.escape(v, quote=True)}"')
        if tag == "a":
            partes.append(' target="_blank" rel="noopener"')
        self.out.append(f"<{tag}{''.join(partes)}>")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "iframe", "object", "embed"):
            self.pular = max(0, self.pular - 1)
            return
        if not self.pular and tag in TAGS_OK and tag not in ("br", "img"):
            self.out.append(f"</{tag}>")

    def handle_data(self, d):
        if not self.pular:
            self.out.append(html.escape(d, quote=False))


def limpar_html(frag):
    p = _Limpador()
    p.feed(frag or "")
    p.close()
    return re.sub(r"\s+", " ", "".join(p.out)).strip()


def texto_puro(frag):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", frag or ""))).strip()


# ----------------------------------------------------------------- texto
def sem_acento(t):
    t = unicodedata.normalize("NFD", (t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


STOP = set("""a o e é as os um uma uns umas de da do das dos em na no nas nos por para pela pelo pelas pelos com sem
que qual quais quando onde como mais menos muito pouco se ser ter estar foi são sao tem ao aos à às ou nao não
este esta estes estas esse essa isso aquilo sobre entre apos após cada outro outra outros outras todos todas
nenhum nenhuma apenas somente alem além assim entao então porem porém seu sua seus suas paciente anos ano
assinale alternativa alternativas correta correto incorreta incorreto afirmativa afirmativas assertiva assertivas
asserção asserções proposição proposições verdadeira verdadeiras falsa falsas seguinte seguintes abaixo acima
respeito considerando acordo segundo resposta opção opcao item itens analise análise relação relacao quadro
afirmar indicada indicado melhor adequada adequado conduta justificativa estão estao corretas apenas""".split())
STOP = {sem_acento(w) for w in STOP}


def termos(texto, tamanho_prefixo=7):
    """Conjunto de termos normalizados (sem acento, sem palavras vazias, prefixo de 7 letras)."""
    out = set()
    for w in re.findall(r"[a-z0-9]{3,}", sem_acento(texto_puro(texto))):
        if w.isdigit() or w in STOP:
            continue
        out.add(w[:tamanho_prefixo])
    return out


def texto_da_questao(q):
    alts = " ".join(f"{k}) {texto_puro(v)}" for k, v in (q.get("alternativas") or {}).items())
    return f"{texto_puro(q.get('enunciado_html'))} {texto_puro(q.get('extras_html') or '')} {alts}".strip()
