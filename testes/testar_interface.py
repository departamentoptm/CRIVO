"""
Testes automáticos da interface do CRIVO (navegador real, sem internet).
Uso:  python3 testes/testar_interface.py            (sobe um servidor local na pasta do site)
      CRIVO_CHROME=/caminho/do/chrome python3 ...  (opcional: usar um Chrome já instalado)
Requer:  pip install playwright  &&  python -m playwright install chromium
Sai com código 1 se algum teste falhar. Não altera nenhum arquivo do site.
"""
import http.server
import os
import socketserver
import sys
import threading
import functools

from playwright.sync_api import sync_playwright

RAIZ = os.environ.get("CRIVO_RAIZ") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
falhas, erros_js = [], []


def servidor():
    class Silencioso(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    h = functools.partial(Silencioso, directory=RAIZ)
    s = socketserver.TCPServer(("127.0.0.1", 0), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s, f"http://127.0.0.1:{s.server_address[1]}/"


def teste(nome):
    def deco(f):
        def rodar(*a):
            try:
                f(*a)
                print(f"ok    {nome}")
            except Exception as e:  # noqa: BLE001
                falhas.append(nome)
                print(f"FALHA {nome}: {str(e).splitlines()[0][:300]}")
        return rodar
    return deco


def visivel(page, sel):
    return page.locator(sel).first.is_visible()


def quadro(page):
    page.wait_for_function("document.getElementById('questionFrame') && document.getElementById('questionFrame')"
                           ".contentDocument && document.getElementById('questionFrame').contentDocument"
                           ".getElementById('submitBtn')", timeout=20000)
    return page.frame_locator("#questionFrame")


@teste("abre a página inicial sem erros")
def t_inicio(page, url):
    page.goto(url + "index.html")
    page.wait_for_selector("#startBtnHome", state="visible", timeout=20000)
    assert visivel(page, "#authScreen"), "tela inicial não apareceu"
    assert visivel(page, "#revisaoBtnHome") and visivel(page, "#viewProgressBtn"), "botões da tela inicial ausentes"


@teste("inicia a resolução e carrega a questão no quadro")
def t_resolucao(page, url):
    page.click("#startBtnHome")
    page.wait_for_selector("#resolvingScreen:not(.hidden)", timeout=20000)
    f = quadro(page)
    assert f.locator("input[name=answer]").count() >= 4, "alternativas não apareceram"


@teste("responde, confirma e mostra a correção e a classificação")
def t_responder(page, url):
    f = quadro(page)
    f.locator("input[name=answer]").first.check()
    f.locator("#submitBtn").click()
    page.wait_for_timeout(500)
    assert f.locator("#resultContainer").is_visible(), "resultado não apareceu"
    f.locator("#viewCorrectionBtn").click()
    page.wait_for_timeout(300)
    assert f.locator("#correctionContent").is_visible(), "correção não abriu"
    rev = f.locator("#crivoRevisao")
    if rev.count():
        assert rev.is_visible(), "opções Difícil/Bom/Fácil não apareceram"
        rev.locator("button").nth(1).click()
    salvo = page.evaluate("Object.keys(localStorage).some(k => k.startsWith('crivo_backup_') && localStorage.getItem(k).includes('registro'))")
    assert salvo, "a resposta não foi salva no navegador"


@teste("grifa um trecho da correção")
def t_grifar(page, url):
    f = quadro(page)
    page.evaluate("""() => {
        const d = document.getElementById('questionFrame').contentDocument;
        const alvo = [...d.querySelectorAll('#correctionContent p, #correctionContent li')].find(e => e.textContent.trim().length > 30);
        const t = [...alvo.childNodes].find(n => n.nodeType === 3 && n.textContent.trim().length > 10) || alvo.firstChild;
        const r = d.createRange(); r.setStart(t, 0); r.setEnd(t, Math.min(10, t.textContent.length));
        const sel = d.defaultView.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }""")
    page.click("#grifarBtn")
    page.wait_for_timeout(400)
    assert f.locator(".crivo-highlight").count() >= 1, "o grifo não apareceu"
    page.keyboard.press("Escape"); page.wait_for_timeout(200)


@teste("revisão espaçada: Difícil < Bom < Fácil no primeiro intervalo")
def t_fsrs(page, url):
    d = page.evaluate("[2, 3, 4].map(g => fsrsIntervaloDias(fsrsRevisar(null, g, Date.now()).s))")
    assert d[0] <= d[1] < d[2], f"intervalos inesperados: {d}"


@teste("navega para a próxima e volta")
def t_navegar(page, url):
    antes = page.locator("#positionIndicator").inner_text() if page.locator("#positionIndicator").count() else ""
    page.click("#nextBtn")
    quadro(page); page.wait_for_timeout(400)
    depois = page.locator("#positionIndicator").inner_text() if page.locator("#positionIndicator").count() else ""
    assert antes != depois or not antes, "a posição não mudou"
    page.click("#prevBtn")
    quadro(page); page.wait_for_timeout(400)
    f = quadro(page)
    assert f.locator("#resultContainer").is_visible(), "a questão respondida não foi restaurada"


@teste("abre o painel de filtros e o menu de tempo")
def t_filtros(page, url):
    page.click("#filtrosBtn"); page.wait_for_timeout(200)
    assert page.get_attribute("#filtrosBtn", "aria-expanded") == "true", "painel de filtros não abriu"
    page.click("#filtrosBtn"); page.wait_for_timeout(200)
    page.click("#tempoModoBtn"); page.wait_for_timeout(200)
    assert page.get_attribute("#tempoModoBtn", "aria-expanded") == "true", "menu de tempo não abriu"
    page.keyboard.press("Escape"); page.mouse.click(5, 300); page.wait_for_timeout(200)


@teste("abre o Meu gabarito com a resposta registrada")
def t_gabarito(page, url):
    page.click("#homeBtn")
    page.wait_for_selector("#viewProgressBtn", state="visible")
    page.click("#viewProgressBtn")
    page.wait_for_selector("#progressScreen:not(.hidden)", timeout=10000)
    page.wait_for_timeout(500)
    txt = page.locator("#progressScreen").inner_text()
    assert len(txt.strip()) > 50, "Meu gabarito vazio"
    page.click("#backFromProgressBtn")


@teste("abre a tela prévia da revisão espaçada")
def t_revisao(page, url):
    page.wait_for_selector("#revisaoBtnHome", state="visible")
    page.click("#revisaoBtnHome")
    page.wait_for_selector("#revisaoScreen:not(.hidden)", timeout=10000)
    assert visivel(page, "#revIniciarBtn"), "botão Iniciar revisão ausente"
    page.click("#backFromRevisaoBtn")


@teste("o progresso continua depois de recarregar a página")
def t_recarregar(page, url):
    page.reload()
    page.wait_for_selector("#startBtnHome", state="visible", timeout=20000)
    page.click("#startBtnHome")
    quadro(page); page.wait_for_timeout(500)
    ok = page.evaluate("Object.keys(localStorage).some(k => k.startsWith('crivo_backup_') && localStorage.getItem(k).includes('registro'))")
    assert ok, "progresso perdido ao recarregar"


def main():
    s, url = servidor()
    with sync_playwright() as p:
        kw = {"executable_path": os.environ["CRIVO_CHROME"]} if os.environ.get("CRIVO_CHROME") else {}
        nav = p.chromium.launch(**kw)
        for largura, nome in ((1280, "computador"), (390, "celular")):
            print(f"--- {nome} ({largura}px)")
            ctx = nav.new_context(viewport={"width": largura, "height": 800})
            ctx.route("**/*", lambda r: r.abort() if not r.request.url.startswith(url) and not r.request.url.startswith(("blob:", "data:", "about:")) else r.continue_())
            page = ctx.new_page()
            page.on("pageerror", lambda e, n=nome: erros_js.append(f"[{n}] {e}"))
            page.on("dialog", lambda d: d.accept())
            for t in (t_inicio, t_resolucao, t_responder, t_grifar, t_fsrs, t_navegar, t_filtros, t_gabarito, t_revisao, t_recarregar):
                t(page, url)
            ctx.close()
        nav.close()
    s.shutdown()
    if erros_js:
        print("\nERROS DE JAVASCRIPT NA PÁGINA:"); [print("  " + e[:300]) for e in erros_js]
    print(f"\n{len(falhas)} falha(s), {len(erros_js)} erro(s) de JavaScript.")
    return 1 if falhas or erros_js else 0


if __name__ == "__main__":
    sys.exit(main())
