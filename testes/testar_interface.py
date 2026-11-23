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


@teste("cartões dos grifos: lista do dia, revisão nos dois sentidos e repetição do Errei")
def t_cartoes(page, url):
    page.evaluate("""() => {
        const q = questoes[questaoAtualIndex];
        const base = { prova: currentExam, ano: currentYear, questao: String(q.num), numero: 7 };
        progress.grifados.push(Object.assign({ id: 'gteste1', texto: 'Frente de teste', lado: 'frente', startOffset: 1 }, base),
                               Object.assign({ id: 'gteste2', texto: 'Verso de teste', lado: 'verso', startOffset: 2 }, base));
        salvarBackup();
        showHome(); showScreen(authScreen);
    }""")
    page.wait_for_selector("#cartoesBtnHome", state="visible")
    assert "2 para hoje" in page.inner_text("#cartoesBtnHome"), "contagem de cartões errada: " + page.inner_text("#cartoesBtnHome")
    page.click("#cartoesBtnHome")
    page.wait_for_selector("#cartoesScreen:not(.hidden)", timeout=10000)
    assert "(hoje)" in page.inner_text("#cartDataTexto"), "a data de hoje não aparece"
    assert page.locator("#cartLista .cartao-item").count() == 2, "a lista de hoje não tem os 2 cartões"
    assert "2 cartões programados" in page.inner_text("#cartResumo"), "resumo do dia"
    page.click("#cartIniciarBtn")
    assert "Frente de teste" in page.inner_text("#cartFrente"), "frente do 1º cartão"
    page.click("#cartMostrarBtn")
    assert "Verso de teste" in page.inner_text("#cartVerso"), "verso do 1º cartão"
    assert page.locator("#cartNotas button").count() == 4, "faltam as 4 notas"
    page.click("#cartNotas button[data-nota='3']")
    assert "Verso de teste" in page.inner_text("#cartFrente"), "o 2º cartão (verso → frente) não apareceu"
    page.keyboard.press(" ")
    page.keyboard.press("1")                                  # Errei: volta no fim da sessão
    assert "Verso de teste" in page.inner_text("#cartFrente"), "o cartão do Errei não voltou"
    page.click("#cartMostrarBtn"); page.click("#cartNotas button[data-nota='4']")
    assert page.locator("#cartListaArea").is_visible(), "ao terminar, não voltou para a lista"
    assert page.locator("#cartLista .cartao-item").count() == 0, "ainda há cartões para hoje"
    n = page.evaluate("Object.values(progress.cartoes).reduce((t, c) => t + c.revisoes.length, 0)")
    assert n == 3, f"esperava 3 revisões, encontrei {n}"


@teste("cartões: dias futuros (adiantar um cartão) e histórico de dias passados")
def t_cartoes_dias(page, url):
    page.click("#cartDiaProx"); page.click("#cartDiaProx")           # 'Bom' do 1º cartão: em 2 dias
    assert page.locator("#cartLista .cartao-item").count() >= 1, "o cartão programado para daqui a 2 dias não aparece"
    assert "adiantá-los" in page.inner_text("#cartResumo"), "falta o aviso de adiantar"
    page.click("#cartLista .cartao-item >> nth=0")                   # abre só esse cartão
    assert page.locator("#cartSessao").is_visible(), "o cartão escolhido não abriu"
    page.click("#cartMostrarBtn"); page.click("#cartNotas button[data-nota='3']")
    assert page.locator("#cartListaArea").is_visible(), "não voltou para a lista depois do cartão único"
    page.fill("#cartDataInput", page.evaluate("isoDoDia(Date.now())")); page.dispatch_event("#cartDataInput", "change")
    page.click("#cartDiaAnt")                                        # ontem: nada revisado
    assert not page.locator("#cartIniciarBtn").is_visible(), "dia passado não deve ter botão de iniciar"
    assert "Nenhum cartão revisado" in page.inner_text("#cartLista"), "histórico de ontem deveria estar vazio"
    page.click("#cartDiaProx")                                       # hoje
    hoje = page.evaluate("listarCartoesDoDia(somarDias(isoDoDia(Date.now()), -0)).length")
    assert hoje == 0, "hoje deveria estar vazio"
    hist = page.evaluate("listarCartoesDoDia(isoDoDia(Date.now())).length + listarCartoes().filter(x => (x.c.revisoes || []).length).length")
    assert hist >= 2, "revisões de hoje não registradas"


@teste("exporta todos os cartões para o Anki")
def t_exportar_cartoes(page, url):
    page.click(".cartoes-exportar summary")
    with page.expect_download() as d:
        page.click("#cartExpBtn")
    txt = open(d.value.path(), encoding="utf-8").read()
    assert "#deck column:4" in txt and "Frente de teste\tVerso de teste" in txt, "arquivo do Anki incompleto"
    assert txt.count("Frente de teste") == 1, "o par foi exportado mais de uma vez"


@teste("cartão sem grifo de origem continua e é marcado")
def t_orfao(page, url):
    o = page.evaluate("""() => {
        progress.grifados = progress.grifados.filter(g => g.id !== 'gteste2'); salvarBackup();
        return listarCartoes().filter(x => x.orfao).length;
    }""")
    assert o == 2, f"esperava 2 cartões órfãos, encontrei {o}"
    page.click("#backFromCartoesBtn")


@teste("sincronização: grifo apagado não volta e revisões de cartões são somadas")
def t_mescla(page, url):
    r = page.evaluate("""() => {
        const g = { id: 'gx', prova: 'AMP', ano: '2020', questao: '1', texto: 't' };
        const a = { registro: [], grifados: [], grifosApagados: { gx: '2026-01-02T00:00:00Z' },
                    cartoes: { c1: { criado: '2026-01-01', revisoes: [{ data: '2026-01-03T00:00:00Z', nota: 3 }] } } };
        const b = { registro: [], grifados: [g], grifosApagados: {},
                    cartoes: { c1: { criado: '2026-01-01', revisoes: [{ data: '2026-01-05T00:00:00Z', nota: 4 }] } } };
        const m = mesclarProgresso(a, b);
        return [m.grifados.length, m.cartoes.c1.revisoes.length, !!m.grifosApagados.gx];
    }""")
    assert r == [0, 2, True], f"mescla inesperada: {r}"


@teste("modo escuro e tamanho da letra")
def t_aparencia(page, url):
    page.wait_for_selector("#temaBtn", state="visible")
    page.click("#temaBtn")
    assert page.evaluate("document.documentElement.classList.contains('tema-escuro')"), "modo escuro não ligou"
    page.click("#letraMaisBtn")
    assert page.inner_text("#letraValor") == "110%", "tamanho da letra não mudou"
    page.click("#startBtnHome")
    page.wait_for_selector("#resolvingScreen:not(.hidden)", timeout=20000)
    quadro(page); page.wait_for_timeout(700)
    zoom, escuro, cor = page.evaluate("""() => { const d = document.getElementById('questionFrame').contentDocument;
        const p = [...d.querySelectorAll('.question-text, .question-text *')].find(e => [...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim().length > 20));
        return [d.body.style.zoom, d.documentElement.classList.contains('tema-escuro') && !!d.getElementById('crivoEscuro'),
                getComputedStyle(p).color]; }""")
    assert zoom == "1.1" and escuro, f"aparência não chegou à questão: {zoom!r} {escuro!r}"
    rgb = [int(x) for x in cor[cor.index("(") + 1:cor.index(")")].split(",")[:3]]
    assert sum(rgb) / 3 > 150, f"o texto da questão não ficou claro no modo escuro: {cor}"
    filtro = page.evaluate("getComputedStyle(document.documentElement).filter")
    assert filtro in ("none", ""), "o modo escuro não deve inverter as cores"
    page.click("#homeBtn")
    page.wait_for_selector("#temaBtn", state="visible")
    page.click("#temaBtn"); page.click("#letraMenosBtn")
    assert not page.evaluate("document.documentElement.classList.contains('tema-escuro')"), "modo escuro não desligou"
    assert page.evaluate("document.querySelectorAll('[data-crivo-escuro]').length") == 0, "sobraram cores do modo escuro"


def temas_de_teste():
    """dados/temas_padrao.json falso (o real é gerado pelo Actions): AMP 2026, ímpares = Tema teste 1, pares = Tema teste 2."""
    import json
    disc = json.load(open(os.path.join(RAIZ, "exams", "disciplinas.json"), encoding="utf-8")).get("AMP", {}).get("2026", {})
    itens = disc.items() if isinstance(disc, dict) else ((str(i + 1), d) for i, d in enumerate(disc))
    q, ds = {}, set()
    for n, d in itens:
        if d:
            q[f"AMP-2026-Q{n}"] = {"disciplina": d, "tema": "Tema teste 1" if int(n) % 2 else "Tema teste 2"}
            ds.add(d)
    return json.dumps({"formato": "crivo-temas-padrao", "versao": 1, "disciplinas": {d: ["Tema teste 1", "Tema teste 2"] for d in ds}, "questoes": q})


@teste("filtro por tema (aparece ao escolher a disciplina)")
def t_temas(page, url):
    page.click("#homeBtn") if page.locator("#homeBtn").is_visible() else None
    page.wait_for_selector("#startBtnHome", state="visible"); page.click("#startBtnHome")
    page.wait_for_selector("#resolvingScreen:not(.hidden)")
    if not page.locator("#disciplinaSelector").is_visible():
        page.click("#toggleFiltrosBtn")
    assert not page.locator("#temaSelector").is_visible(), "o tema não deve aparecer sem disciplina"
    page.select_option("#disciplinaSelector", "Pediatria"); page.wait_for_timeout(400)
    assert page.locator("#temaSelector").is_visible(), "o seletor de tema não apareceu"
    assert page.locator("#temaSelector option").count() == 3, "esperava 'Todos os temas' + 2 temas"
    page.select_option("#temaSelector", "Tema teste 2"); page.wait_for_timeout(400)
    ok = page.evaluate("questoes.length > 0 && questoes.every(q => temaDe(q.exam, q.year, q.num) === 'Tema teste 2')")
    assert ok, "o filtro por tema não filtrou as questões"
    page.select_option("#disciplinaSelector", ""); page.wait_for_timeout(300)
    assert not page.locator("#temaSelector").is_visible(), "o tema deve sumir ao voltar para todas as disciplinas"


@teste("desempenho: pontos fracos e estudar os pontos fracos")
def t_desempenho(page, url):
    page.evaluate("""() => {
        const pares = Object.keys(temasPadrao.questoes).filter(k => temasPadrao.questoes[k].tema === 'Tema teste 2'
            && temasPadrao.questoes[k].disciplina === 'Pediatria').slice(0, 6);
        const t0 = Date.now() - 3 * 86400000;
        pares.forEach((k, i) => { const n = k.split('-Q')[1];
            progress.registro.push({ acao: 'confirmou', prova: 'AMP', ano: '2026', questao: n, opcao: 'X', correta: 'A',
                                     data: new Date(t0 + i * 1000).toISOString(), tempoMs: 60000 }); });
        progress = normalizar(progress); salvarBackup(); showHome(); showScreen(authScreen);
    }""")
    page.click("#desempenhoBtnHome")
    page.wait_for_selector("#desempenhoScreen:not(.hidden)")
    txt = page.inner_text("#painelDesempenho")
    assert "questões respondidas" in txt and "Evolução semanal" in txt, "painel de desempenho incompleto"
    assert "Tema teste 2" in page.inner_text("#painelDesempenho .desemp-bloco >> nth=0"), "o ponto fraco não apareceu"
    page.click("#estudarFracosBtn")
    page.wait_for_selector("#resolvingScreen:not(.hidden)")
    assert "Pontos fracos" in page.inner_text("#grupoAviso"), "o grupo dos pontos fracos não abriu"
    page.click("#grupoSairBtn"); page.wait_for_timeout(300)


@teste("plano de estudo: cria o plano e começa as questões de hoje")
def t_plano(page, url):
    page.click("#homeBtn"); page.wait_for_selector("#desempenhoBtnHome", state="visible")
    page.click("#desempenhoBtnHome"); page.click("#abaPlano")
    page.fill("#planoData", page.evaluate("somarDias(isoDoDia(Date.now()), 60)"))
    page.fill("#planoHoras", "12"); page.select_option("#planoProva", "AMP")
    page.click("#planoSalvarBtn")
    txt = page.inner_text("#painelPlano")
    assert "Faltam 60 dias" in txt and "Questões novas para hoje" in txt, "o plano não foi calculado: " + txt[:200]
    assert page.evaluate("!!progress.plano && progress.plano.horasSemana === 12"), "o plano não foi salvo"
    page.click("#planoComecarBtn")
    page.wait_for_selector("#resolvingScreen:not(.hidden)")
    assert "Plano de hoje" in page.inner_text("#grupoAviso"), "as questões do plano não abriram"
    page.click("#grupoSairBtn"); page.wait_for_timeout(300)


@teste("meta diária no plano de estudo e sequência no desempenho")
def t_meta(page, url):
    page.click("#homeBtn") if page.locator("#homeBtn").is_visible() else None
    assert page.locator("#metaHoje").count() == 0, "a meta diária não deveria estar na tela inicial"
    page.evaluate("abrirTelaDesempenho()"); page.click("#abaDesempenho"); page.wait_for_selector("#painelDesempenho", state="visible")
    assert "dias seguidos" in page.inner_text("#painelDesempenho"), "a sequência deveria estar na aba Desempenho"
    page.click("#abaPlano"); page.wait_for_selector("#metaValor", state="visible")
    page.fill("#metaValor", "5"); page.click("#metaSalvarBtn"); page.wait_for_timeout(200)
    assert page.evaluate("progress.metaDiaria && progress.metaDiaria.valor") == 5, "a meta não foi salva"
    txt = page.inner_text("#metaProgresso")
    assert "/5 questões" in txt, f"o progresso da meta não aparece: {txt}"
    page.click("#abaDesempenho"); page.click("#backFromDesempenhoBtn")
    html = page.evaluate("document.body.innerHTML")
    assert "🔥" not in html and "👏" not in html, "ainda há emojis de fogo ou palmas"
    m = page.evaluate("mesclarProgresso({ registro: [], metaDiaria: { valor: 3, atualizado: '2026-01-01' } }, { registro: [], metaDiaria: { valor: 9, atualizado: '2026-02-01' } }).metaDiaria.valor")
    assert m == 9, "a sincronização deveria ficar com a meta mais recente"


@teste("simulado: correção escondida, finalização, resultado e histórico")
def t_simulado(page, url):
    page.click("#homeBtn") if page.locator("#homeBtn").is_visible() else None
    page.wait_for_selector("#simuladoBtnHome", state="visible")
    antes = page.evaluate("progress.registro.filter(e => e.acao === 'confirmou').length")
    page.click("#simuladoBtnHome")
    page.wait_for_selector("#simuladoScreen:not(.hidden)")
    page.fill("#simQtd", "3"); page.fill("#simMin", "30")
    page.click("#simIniciarBtn")
    page.wait_for_selector("#resolvingScreen:not(.hidden)")
    f = quadro(page); page.wait_for_timeout(400)
    assert page.locator("#simBarra").is_visible(), "a barra do simulado não apareceu"
    assert not f.locator("#submitBtn").is_visible(), "o botão de confirmar deveria estar escondido no simulado"
    f.locator(".option").first.click(); page.wait_for_timeout(300)
    assert "1/3" in page.inner_text("#simRespondidas"), "a resposta não foi contada no simulado"
    depois = page.evaluate("progress.registro.filter(e => e.acao === 'confirmou').length")
    assert depois == antes, "durante o simulado, nada deve ir para o progresso"
    page.click("#nextBtn"); f = quadro(page); page.wait_for_timeout(400)
    f.locator(".option").nth(1).click(); page.wait_for_timeout(300)
    page.click("#prevBtn"); f = quadro(page); page.wait_for_timeout(500)
    assert f.locator(".option.selected").count() == 1, "a escolha não foi restaurada ao voltar"
    page.click("#simFinalizarBtn")
    page.wait_for_selector("#simuladoScreen:not(.hidden)", timeout=15000)
    assert page.locator("#simResultado").is_visible() and "acertos" in page.inner_text("#simResultado"), "resultado não apareceu"
    n = page.evaluate("progress.registro.filter(e => e.acao === 'confirmou').length") - antes
    assert n == 2, f"esperava 2 respostas no progresso depois do simulado, vieram {n}"
    assert page.evaluate("progress.simulados.length") == 1, "o simulado não foi para o histórico"
    assert page.evaluate("!localStorage.getItem('crivo_simulado_atual')"), "o simulado em andamento não foi apagado"
    av = page.evaluate("progress.avaliacoes.length")
    page.click(".sim-notas button[data-nota='3'] >> nth=0")
    assert page.evaluate("progress.avaliacoes.length") == av + 1, "a classificação não foi salva"
    assert page.locator("#simHistorico .sim-hist").count() == 1, "o histórico não mostra o simulado"
    assert not page.locator("#simBarra").is_visible(), "a barra do simulado deveria sumir"
    page.click("#backFromSimuladoBtn")


@teste("página da questão: selo de revisão da liga e dúvidas respondidas")
def t_selo_duvidas(page, url):
    html = page.evaluate("""() => CrivoRender.montarPagina({ banca: 'AMP', ano: '2020', questoes: [{ id: 'AMP-2020-Q1', numero: 1,
        enunciado_html: 'Enunciado', alternativas: { A: 'a', B: 'b' }, gabarito: 'A', correcao: { secoes_html: { '2.1': '<p>x</p>' } },
        revisao: { status: 'revisado_humano', alertas: [], revisores: [{ nome: 'Ana Souza', funcao: 'estudante' }] },
        duvidas: [{ pergunta: 'Por que A?', resposta: 'Porque sim.', respondido_por: 'Liga de Pediatria' }] }] }, 1)""")
    assert "Correção revisada por Ana Souza (estudante)" in html, "o selo de revisão não apareceu"
    assert "Dúvidas sobre esta questão" in html and "Liga de Pediatria" in html, "as dúvidas não apareceram"
    html2 = page.evaluate("""() => CrivoRender.montarPagina({ banca: 'AMP', ano: '2020', questoes: [{ id: 'AMP-2020-Q2', numero: 2,
        enunciado_html: 'E', alternativas: { A: 'a', B: 'b' }, gabarito: 'B', correcao: { secoes_html: {} },
        revisao: { status: 'nao_revisado', alertas: [], revisores: [] }, duvidas: [] }] }, 2)""")
    assert "gerada por IA" in html2 and "Dúvidas sobre" not in html2, "selo de IA ou bloco de dúvidas vazio errado"


def main():
    s, url = servidor()
    with sync_playwright() as p:
        kw = {"executable_path": os.environ["CRIVO_CHROME"]} if os.environ.get("CRIVO_CHROME") else {}
        nav = p.chromium.launch(**kw)
        for largura, nome in ((1280, "computador"), (390, "celular")):
            print(f"--- {nome} ({largura}px)")
            ctx = nav.new_context(viewport={"width": largura, "height": 800})
            ctx.route("**/*", lambda r: r.abort() if not r.request.url.startswith(url) and not r.request.url.startswith(("blob:", "data:", "about:")) else r.continue_())
            fake = temas_de_teste()
            ctx.route("**/dados/temas_padrao.json", lambda r: r.fulfill(status=200, content_type="application/json", body=fake))
            page = ctx.new_page()
            page.on("pageerror", lambda e, n=nome: erros_js.append(f"[{n}] {e}"))
            page.on("dialog", lambda d: d.accept())
            for t in (t_inicio, t_resolucao, t_responder, t_grifar, t_fsrs, t_navegar, t_filtros, t_gabarito, t_revisao, t_cartoes, t_cartoes_dias, t_exportar_cartoes,
                      t_orfao, t_mescla, t_aparencia, t_temas, t_desempenho, t_plano, t_meta,
                      t_simulado, t_selo_duvidas, t_recarregar):
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
