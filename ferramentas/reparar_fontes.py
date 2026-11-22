"""Repara PDFs em que parte das fontes Calibri não tem tabela ToUnicode (o texto sai como 'ǆĂŵĞ').
Aprende glifo->caractere nas fontes da MESMA família que têm a tabela e a acrescenta às que não têm.
Uso: python reparar_fontes.py entrada.pdf saida.pdf [--aprender]
     --aprender guarda as tabelas deste arquivo em mapas_glifos.json para reparar outros arquivos."""
import json, os, re, sys, collections
MAPAS_SALVOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mapas_glifos.json")
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, DecodedStreamObject

def familia(nome):
    return re.sub(r'^[A-Z]{6}\+', '', str(nome).lstrip('/')).replace(' ', '-').replace(',', '-')

def ler_cmap(dados):
    m = {}
    for bloco in re.findall(rb'beginbfchar(.*?)endbfchar', dados, re.S):
        for a, b in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', bloco):
            m[int(a, 16)] = bytes.fromhex(b.decode()).decode('utf-16-be', 'replace')
    for bloco in re.findall(rb'beginbfrange(.*?)endbfrange', dados, re.S):
        for a, z, b in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', bloco):
            ini = int(b, 16)
            for k in range(int(a, 16), int(z, 16) + 1):
                m[k] = chr(ini + k - int(a, 16))
    return m

def fontes(leitor):
    """Todas as fontes do arquivo, inclusive as que estão dentro de formulários (XObject)."""
    obj = lambda x: x.get_object() if hasattr(x, 'get_object') else x
    vistos, pilha = set(), [obj(pg.get('/Resources') or {}) for pg in leitor.pages]
    recursos_vistos = set()
    while pilha:
        res = obj(pilha.pop())
        if not hasattr(res, 'get') or id(res) in recursos_vistos:
            continue
        recursos_vistos.add(id(res))
        for ref in (obj(res.get('/Font') or {})).values():
            chave = (ref.idnum, ref.generation) if hasattr(ref, "idnum") else id(ref)
            if chave in vistos: continue
            vistos.add(chave); yield obj(ref)
        for xo in (obj(res.get('/XObject') or {})).values():
            x = obj(xo)
            if x.get('/Subtype') == '/Form' and '/Resources' in x:
                pilha.append(x['/Resources'])


def gerar_cmap(m):
    linhas = []
    itens = sorted(m.items())
    for k in range(0, len(itens), 100):
        grupo = itens[k:k + 100]
        linhas.append(f"{len(grupo)} beginbfchar")
        for cid, u in grupo:
            linhas.append(f"<{cid:04X}> <{u.encode('utf-16-be').hex().upper()}>")
        linhas.append("endbfchar")
    corpo = "\n".join(linhas)
    return ("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) "
            "/Ordering (UCS) /Supplement 0 >> def\n/CMapName /CRIVO-UCS def\n/CMapType 2 def\n1 begincodespacerange\n"
            "<0000> <FFFF>\nendcodespacerange\n" + corpo + "\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n")

def main(entrada, saida, aprender=False):
    leitor = PdfReader(entrada)
    mapas = collections.defaultdict(dict)
    sem = []
    for f in fontes(leitor):
        if f.get('/Subtype') != '/Type0':      # só fontes por glifo (Identity-H); fontes simples ficam como estão
            continue
        fam = familia(f.get('/BaseFont'))
        if '/ToUnicode' in f:
            for cid, u in ler_cmap(f['/ToUnicode'].get_object().get_data()).items():
                mapas[fam].setdefault(cid, u)
        else:
            sem.append((fam, f))
    # tabelas aprendidas em outras provas (ex.: Calibri do Inep) servem quando o arquivo não traz modelo
    salvos = {}
    if os.path.isfile(MAPAS_SALVOS):
        with open(MAPAS_SALVOS, encoding="utf-8") as fh:
            salvos = {fam: {int(k): v for k, v in m.items()} for fam, m in json.load(fh).items()}
    for fam, m in salvos.items():
        for cid, u in m.items():
            mapas[fam].setdefault(cid, u)
    if aprender:
        novos = {fam: {str(k): v for k, v in sorted(m.items())} for fam, m in mapas.items() if fam != "GlyphLessFont"}
        with open(MAPAS_SALVOS, "w", encoding="utf-8") as fh:
            json.dump(novos, fh, ensure_ascii=False, indent=0)
    reparadas = 0
    for fam, f in sem:
        if not mapas.get(fam):
            print(f"  aviso: fonte {fam} sem tabela e sem modelo da mesma família: não reparada"); continue
        s = DecodedStreamObject(); s.set_data(gerar_cmap(mapas[fam]).encode('ascii'))
        f[NameObject('/ToUnicode')] = leitor._add_object(s) if hasattr(leitor, '_add_object') else s
        reparadas += 1
    escritor = PdfWriter(clone_from=leitor)
    escritor.write(saida)
    try:      # conferência: nenhum glifo pode ter ficado sem caractere (seria texto perdido em silêncio)
        from pdfminer.high_level import extract_text
        sobras = sorted(set(re.findall(r"\(cid:(\d+)\)", extract_text(saida))), key=int)
        if sobras:
            print(f"  ATENÇÃO: glifos sem caractere conhecido (texto incompleto): {sobras[:30]} — "
                  f"acrescente-os em mapas_glifos.json")
    except ImportError:
        print("  (instale pdfminer.six para conferir se algum glifo ficou sem caractere)")
    print(f"fontes sem tabela: {len(sem)}; reparadas: {reparadas}; famílias com modelo: {sorted(mapas)}")

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], aprender="--aprender" in sys.argv)
