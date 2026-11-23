"""
Questões de afirmativas (I, II, III... / 1, 2, 3... / "( )" com V e F): monta, a partir do GABARITO OFICIAL, quais
afirmativas são verdadeiras e quais são falsas. Essa tabela vai para o autor, o revisor e o árbitro, e uma
conferência final confere se a correção declara cada afirmativa como a tabela. Quando a alternativa do gabarito
não permite saber com segurança (ex.: "exceto", contagens, mistura de verdadeiras e falsas), devolve None.
"""
import re

from crivo_comum import texto_puro
ROMANOS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]


def _rotulos(enunciado):
    """Rótulos das afirmativas na ordem (I, II... ou 1, 2...), exigindo a sequência completa desde o primeiro."""
    melhores = []
    for tipo, padrao, seq in (("romano", r"(?:^|[\s:;.])\(?(X|IX|VIII|VII|VI|V|IV|III|II|I)\s*[.)\-–—:]\s", ROMANOS),
                              ("numero", r"(?:^|[\s:;])\(?(\d{1,2})\s*(?:[.)\-–—]|\(\s*\))\s", [str(k) for k in range(1, 11)])):
        achados, prox = [], 0
        for m in re.finditer(padrao, enunciado):
            if prox < len(seq) and m.group(1) == seq[prox]:
                achados.append(m.group(1)); prox += 1
        if len(achados) >= 2 and len(achados) > len(melhores):
            melhores = achados
    return melhores


def tabela_afirmativas(q):
    """Para questões de afirmativas, devolve {'verdadeiras': [...], 'falsas': [...]} pelo gabarito oficial, ou None."""
    g = q.get("gabarito")
    alt = texto_puro((q.get("alternativas") or {}).get(g) or "") if g else ""
    enun = texto_puro(re.sub(r"<br\s*/?>", "\n", q.get("enunciado_html") or ""))
    if not alt:
        return None
    rot = _rotulos(enun)
    parenteses = len(re.findall(r"\(\s*\)", enun))
    if len(rot) < 2 and parenteses >= 2:
        rot = [f"{k}ª" for k in range(1, parenteses + 1)]          # itens "( )" sem número: posição na ordem
    if len(rot) < 2 or re.search(r"\bquant[ao]s\b", enun.lower()):
        return None
    # sequência V/F (ex.: "V – F – V – F")
    vf = re.findall(r"\b([VF])\b", alt.upper())
    if len(vf) == len(rot) and re.fullmatch(r"[\sVF,;.\-–—/()]+", alt.upper()):
        return {"rotulos": rot, "verdadeiras": [r for r, x in zip(rot, vf) if x == "V"],
                "falsas": [r for r, x in zip(rot, vf) if x == "F"]}
    a = alt.lower()
    if re.search(r"verdadeir|corret", a) and re.search(r"\bfals|incorret|errad", a):
        # asserção-razão: "A asserção I é verdadeira, e a II é falsa" / "a primeira ... e a segunda ..."
        m = re.search(r"\b(?:i|primeira)\b[^,;]*?\b(verdadeira|falsa|correta|incorreta)\b.*?\b(?:ii|segunda)\b[^.;]*?\b(verdadeira|falsa|correta|incorreta)\b", a)
        if m and len(rot) == 2:
            v = [x in ("verdadeira", "correta") for x in m.groups()]
            return {"rotulos": rot, "verdadeiras": [r for r, x in zip(rot, v) if x], "falsas": [r for r, x in zip(rot, v) if not x]}
        return None                                   # outra mistura: não arrisca
    if (re.search(r"\btodas\b", a) and re.search(r"verdadeir|corret|fals|incorret|errad", a)
            and not re.search(r"\b(apenas|somente|exceto)\b", a)):
        neg = bool(re.search(r"falsas|incorretas|erradas", a))
        return {"rotulos": rot, "verdadeiras": [] if neg else rot, "falsas": rot if neg else []}
    if re.search(r"\bnenhuma\b", a) and re.search(r"verdadeir|corret|fals|incorret|errad", a):
        neg = bool(re.search(r"falsa|incorreta|errada", a))
        return {"rotulos": rot, "verdadeiras": rot if neg else [], "falsas": [] if neg else rot}
    if re.search(r"\bexceto\b", a):
        return None
    if rot[0].endswith("ª"):
        return None
    tipo_num = rot[0].isdigit()
    if tipo_num:
        mencionados = re.findall(r"\b(\d{1,2})\b", alt)
    else:
        mencionados = re.findall(r"\b(X|IX|VIII|VII|VI|V|IV|III|II|I)\b", alt)
    mencionados = list(dict.fromkeys(mencionados))
    if not mencionados or any(m not in rot for m in mencionados):
        return None
    if re.search(r"\b(falsas?|incorretas?|erradas?)\b", a):
        falsas = [r for r in rot if r in mencionados]
        return {"rotulos": rot, "verdadeiras": [r for r in rot if r not in mencionados], "falsas": falsas}
    afirm = re.search(r"corret|verdadeir|afirmativ|assertiv|afirmaç|proposiç|asserç", enun.lower())
    lista_pura = re.fullmatch(r"(?:apenas|somente|só)?[\sIVX\d,e.;]+", alt, re.I)
    if lista_pura and len(mencionados) < 2 and not re.search(r"\b(apenas|somente|só)\b", a):
        lista_pura = None                              # "3" sozinho pode ser uma contagem
    if (re.search(r"(verdadeir|corret)", a) or lista_pura
            or (afirm and re.search(r"\b(apenas|somente|só)\b", a))):
        return {"rotulos": rot, "verdadeiras": [r for r in rot if r in mencionados], "falsas": [r for r in rot if r not in mencionados]}
    return None


def texto_da_tabela(t):
    if not t:
        return ""
    lista = lambda xs: ", ".join(xs) if xs else "nenhuma"
    return (f"PELO GABARITO OFICIAL, as afirmativas VERDADEIRAS são: {lista(t['verdadeiras'])}; as FALSAS são: "
            f"{lista(t['falsas'])}. A correção deve tratar cada afirmativa exatamente assim e explicar por quê.")


def confere(t, verdadeiras):
    """Compara uma lista de rótulos declarados verdadeiros com a tabela. Devolve a lista de divergências."""
    decl = {str(x).strip().upper().rstrip(".") for x in (verdadeiras or [])}
    div = []
    for r in t["rotulos"]:
        dito = r.upper() in decl
        if dito != (r in t["verdadeiras"]):
            div.append(f"{r} ({'verdadeira' if r in t['verdadeiras'] else 'falsa'} pelo gabarito)")
    return div
