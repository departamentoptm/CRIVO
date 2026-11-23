"""
Referências da seção 2.15 — montadas por CÓDIGO, sem tokens e sem links inventados.

  1. Livros-texto: escolhidos pela IA apenas dentro da lista `fontes_permitidas` (config), com a seção/tema.
  2. Artigos: buscados no PubMed pela API oficial gratuita (NCBI E-utilities) com os termos em inglês que a IA
     sugeriu, filtrando revisões, revisões sistemáticas, meta-análises e diretrizes dos últimos N anos.
     Só entram artigos que EXISTEM (título, revista, ano e PMID vêm do próprio PubMed); o link leva ao artigo.
  3. Links de consulta: UpToDate, Manual MSD (versão profissional, em português) e PubMed, abertos já com a
     pesquisa do tema.
Sem internet (ou se o PubMed não responder), os artigos ficam de fora e o relatório avisa; o resto continua.
"""
import html
import json
import re
import time
import urllib.parse
import urllib.request

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
FILTRO_TIPO = ('(review[pt] OR systematic review[pt] OR meta-analysis[pt] OR practice guideline[pt] '
               'OR guideline[pt])')
_ultima = [0.0]


def _get_json(url, intervalo):
    espera = intervalo - (time.time() - _ultima[0])
    if espera > 0:
        time.sleep(espera)                       # NCBI: no máximo 3 pedidos por segundo sem chave
    _ultima[0] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "CRIVO/1.0 (banco de questoes academico)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def limpar_busca(t):
    t = re.sub(r"[^\w\s\-\"()]", " ", str(t or ""), flags=re.UNICODE)
    return re.sub(r"\s+", " ", t).strip()[:200]


def _termos(busca):
    """Separa a busca em termos (frases entre aspas ficam juntas)."""
    return [t.strip('"') for t in re.findall(r'"[^"]+"|\S+', busca) if t.strip('"') and t.upper() not in ("AND", "OR", "NOT")]


def _buscar_ids(termo, quantidade, intervalo):
    r = _get_json(f"{EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax={quantidade * 3}&term="
                  + urllib.parse.quote(termo), intervalo)
    return (r.get("esearchresult") or {}).get("idlist") or []


def buscar_artigos(busca, quantidade=2, anos=10, intervalo=0.4, log=print):
    """Devolve [{pmid, titulo, revista, ano, doi, autores}] ou [] (e nunca inventa nada).
    Se a busca não achar nada, amplia aos poucos: sem o limite de anos, depois com termos mais gerais."""
    busca = limpar_busca(busca)
    if not busca or quantidade <= 0:
        return []
    termos = _termos(busca)
    geral = " ".join(f'"{t}"' if " " in t else t for t in termos[:max(1, (len(termos) + 1) // 2)])
    tentativas = [
        (busca, f"({busca}) AND {FILTRO_TIPO} AND hasabstract AND english[lang] AND (\"last {anos} years\"[dp])"),
        (busca, f"({busca}) AND {FILTRO_TIPO} AND hasabstract"),
        (geral, f"({geral}) AND {FILTRO_TIPO} AND hasabstract AND (\"last {anos} years\"[dp])"),
        (geral, f"({geral}) AND review[pt]"),
    ]
    artigos, vistos = [], set()
    try:
        for base, termo in tentativas:
            if len(artigos) >= quantidade:
                break
            ids = [i for i in _buscar_ids(termo, quantidade, intervalo) if i not in vistos]
            if not ids:
                continue
            s = _get_json(f"{EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=" + ",".join(ids), intervalo)
            for a in _filtrar(s, ids, base):
                if a["pmid"] not in vistos and len(artigos) < quantidade:
                    vistos.add(a["pmid"]); artigos.append(a)
    except Exception as e:                          # sem internet, NCBI fora do ar etc.
        log(f"   aviso: PubMed indisponível ({str(e)[:80]}); {len(artigos)} artigo(s) incluído(s)")
    return artigos


def _filtrar(s, ids, busca):
    res = s.get("result") or {}
    palavras_busca = {w.lower() for w in re.findall(r"[A-Za-z]{4,}", busca)}
    artigos = []
    for pmid in ids:
        d = res.get(pmid) or {}
        titulo = re.sub(r"<[^>]+>", "", d.get("title", "")).strip().rstrip(".")
        if not titulo:
            continue
        # o título precisa ter ao menos uma palavra da busca (evita resultado fora do tema)
        if palavras_busca and not (palavras_busca & {w.lower() for w in re.findall(r"[A-Za-z]{4,}", titulo)}):
            continue
        doi = next((a.get("value") for a in d.get("articleids", []) if a.get("idtype") == "doi"), None)
        autores = [a.get("name") for a in d.get("authors", []) if a.get("name")]
        artigos.append({"pmid": pmid, "titulo": titulo, "revista": d.get("source", ""),
                        "ano": (d.get("pubdate") or "")[:4], "doi": doi,
                        "autores": (autores[0] + (" et al." if len(autores) > 1 else "")) if autores else ""})
    return artigos


def links_de_consulta(busca_en, tema_pt):
    q_en = urllib.parse.quote(limpar_busca(busca_en))
    q_pt = urllib.parse.quote(limpar_busca(tema_pt))
    return [
        ("UpToDate", f"https://www.uptodate.com/contents/search?search={q_en}"),
        ("Manual MSD (busca no site)", "https://www.google.com/search?q="
         + urllib.parse.quote(f"site:msdmanuals.com/pt/profissional {limpar_busca(tema_pt)}")),
        ("PubMed", f"https://pubmed.ncbi.nlm.nih.gov/?term={q_en}"),
    ] if (q_en or q_pt) else []


def montar_html(livros, artigos, busca_en, tema_pt, consultadas=()):
    """HTML da seção 2.15 no formato do template: <p>1. Referência</p>."""
    e = lambda t: html.escape(str(t or ""), quote=True)
    itens = []
    for l in livros:
        sec = f" — {e(l['secao'])}" if l.get("secao") else ""
        itens.append(f"<strong>{e(l['fonte'])}</strong>{sec}.")
    for a in artigos:
        url = f"https://pubmed.ncbi.nlm.nih.gov/{a['pmid']}/"
        doi = f' DOI: <a href="https://doi.org/{e(a["doi"])}">{e(a["doi"])}</a>.' if a.get("doi") else ""
        itens.append(f'{e(a["autores"])} <a href="{url}">{e(a["titulo"])}</a>. <em>{e(a["revista"])}</em>, {e(a["ano"])}. '
                     f'PMID {e(a["pmid"])}.{doi}')
    for f in consultadas:          # diretrizes e documentos achados na busca na web (páginas reais)
        quando = f" ({e(f['data'][:4])})" if f.get("data") else ""
        itens.append(f'<a href="{e(f["url"])}">{e(f["titulo"])}</a>. {e(f.get("site") or "")}{quando}.')
    links = links_de_consulta(busca_en, tema_pt)
    if links:
        itens.append("Consulta do tema: " + " · ".join(f'<a href="{u}">{e(n)}</a>' for n, u in links)
                     + " <em>(UpToDate exige assinatura institucional)</em>.")
    return "".join(f"<p>{k}. {t}</p>" for k, t in enumerate(itens, 1))
