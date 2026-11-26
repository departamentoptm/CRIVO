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
import json
import re
import time
import urllib.parse

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
    # histórico: uma revisão programada para ontem e não feita aparece em vermelho; uma feita, em verde
    page.evaluate("""() => {
        const t = Date.now() - 6 * 86400000;
        const reg = progress.registro;
        reg.push({ acao: 'confirmou', prova: 'AMP', ano: '2026', questao: '3', opcao: 'B', correta: 'A', data: new Date(t).toISOString() });
        progress = normalizar(progress); _cartoesCache = null;
    }""")
    dia = page.evaluate("""() => { const h = historicoRevisoes(); return [...h.keys()].sort().pop() || null; }""")
    assert dia, "o histórico não encontrou a revisão programada"
    page.evaluate(f"revDiaSel = '{dia}'; renderTelaRevisao()")
    assert page.locator("#revLista .rev-perdida, #revLista .rev-feita").count() > 0, "o dia passado não mostra as revisões programadas"
    assert not visivel(page, "#revIniciarBtn"), "num dia passado não se inicia revisão"
    assert not page.locator("#revDiaAnt").is_disabled(), "deve ser possível voltar aos dias anteriores"
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
    for sel in ("#cartExpBanca", "#cartExpAno", "#cartExpDisc", "#cartExpTema"):
        assert page.locator(sel).count() == 1, f"falta o filtro {sel} na exportação"
    assert page.locator("#cartExpAno option").count() >= 2, "o filtro de edição não tem opções"
    assert page.locator("#cartNotas kbd.tecla").count() == 4, "os botões dos cartões devem mostrar as teclas 1 a 4"


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
    assert "questões respondidas" in txt and "Evolução" in txt, "painel de desempenho incompleto"
    assert "Tema teste 2" in page.inner_text("#painelDesempenho .desemp-bloco:has(h2:text('Pontos fracos'))"), "o ponto fraco não apareceu"
    # gráfico por disciplina e tema: barras divididas, lado a lado e filtros como no Meu gabarito
    assert page.locator("#desempGrafico .graf-dividida .seg.erro").count() > 0, "as barras divididas não mostram os erros"
    page.select_option("#dfDisc", "Pediatria"); page.wait_for_timeout(200)
    assert page.locator("#desempGrafico details.desemp-disc").count() == 1, "o filtro de disciplina não filtrou o gráfico"
    page.click("#dvLado"); page.wait_for_timeout(200)
    assert page.locator("#desempGrafico .graf-lado").count() > 0, "a vista lado a lado não apareceu"
    assert "Disponíveis" in page.inner_text("#desempGrafico"), "a vista lado a lado deve comparar com o total disponível"
    page.click("#dvDividida"); page.select_option("#dfDisc", "")
    page.click("#estudarFracosBtn")
    page.wait_for_selector("#resolvingScreen:not(.hidden)")
    assert "Pontos fracos" in page.inner_text("#grupoAviso"), "o grupo dos pontos fracos não abriu"
    page.click("#grupoSairBtn"); page.wait_for_timeout(300)


@teste("plano de estudo: cria o plano e começa as questões de hoje")
def t_plano(page, url):
    page.click("#homeBtn"); page.wait_for_selector("#desempenhoBtnHome", state="visible")
    page.click("#desempenhoBtnHome"); page.click("#abaPlano")
    page.fill("#planoData", page.evaluate("somarDias(isoDoDia(Date.now()), 60)"))
    page.select_option("#planoProva", "AMP")
    hoje = page.evaluate("new Date().getDay()")
    linha = f'.plano-dia[data-dia="{hoje}"]'
    if not page.locator(f"{linha} input[data-acao=dia]").is_checked():
        page.check(f"{linha} input[data-acao=dia]"); page.wait_for_timeout(100)
    page.click(f"{linha} [data-acao=add]"); page.wait_for_timeout(100)      # segundo horário no dia de hoje
    assert page.locator(f"{linha} .plano-horario").count() == 2, "não acrescentou o segundo horário"
    page.click("#planoSalvarBtn")
    txt = page.inner_text("#painelPlano")
    assert "Faltam 60 dias" in txt and "Questões novas para hoje" in txt, "o plano não foi calculado: " + txt[:200]
    assert "Ritmo" in txt or "Todas as questões" in txt, "faltou a situação do plano (ritmo)"
    assert "No ritmo do plano" not in txt, "a frase antiga do ritmo deveria ter saído"
    assert page.evaluate(f"!!progress.plano && progress.plano.disponibilidade[{hoje}].length === 2"), "o plano não foi salvo com os horários"
    assert page.locator("#metaValor").count() == 0, "a meta diária não deve ser escolhida à mão"
    assert "cabem" in page.inner_text(".plano-capacidade"), "faltou quantas questões cabem hoje"
    page.check("#planoLimiteChk"); page.fill("#planoLimite", "4"); page.click("#planoSalvarBtn")
    assert page.evaluate("progress.plano.limiteDiario") == 4, "o limite diário não foi salvo"
    txt = page.inner_text(".plano-capacidade")
    assert "limite de 4" in txt and "min por questão" in txt, "faltou o tempo por questão com o limite: " + txt
    assert page.evaluate("calcularPlano(planoAtivo()).metaHoje") <= 4, "a meta do dia deve respeitar o limite"
    page.uncheck("#planoLimiteChk"); page.click("#planoSalvarBtn")
    assert not page.evaluate("progress.plano.limiteDiario"), "o limite deveria ter sido desligado"
    page.click("#planoComecarBtn")
    page.wait_for_selector("#resolvingScreen:not(.hidden)")
    assert "Plano de hoje" in page.inner_text("#grupoAviso"), "as questões do plano não abriram"
    page.click("#grupoSairBtn"); page.wait_for_timeout(300)


@teste("meta do dia calculada pelo plano (tela inicial) e sequência no desempenho")
def t_meta(page, url):
    page.click("#homeBtn") if page.locator("#homeBtn").is_visible() else None
    page.evaluate("abrirTelaDesempenho()"); page.click("#abaDesempenho"); page.wait_for_selector("#painelDesempenho", state="visible")
    assert "dias seguidos" in page.inner_text("#painelDesempenho"), "a sequência deveria estar na aba Desempenho"
    page.click("#backFromDesempenhoBtn"); page.wait_for_timeout(200)
    page.wait_for_selector("#metaPlanoHoje", state="visible")
    assert "Plano de hoje" in page.inner_text("#metaPlanoHoje"), "a meta do plano deveria aparecer na tela inicial"
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
    page.click("#simFecharResultadoBtn")
    assert not page.locator("#simResultado").is_visible(), "o ✕ deveria fechar o resultado do simulado"
    page.click("#simHistorico .sim-hist >> nth=0")
    assert page.locator("#simResultado").is_visible(), "tocar num simulado anterior deveria abrir o resultado"
    page.click("#simFecharResultadoBtn")
    page.click("#backFromSimuladoBtn")


@teste("pausa por inatividade: o tempo para, a tela embaça e 'Continuar estudando' retoma")
def t_inatividade(page, url):
    page.click("#homeBtn") if page.locator("#homeBtn").is_visible() else None
    page.click("#startBtnHome"); page.wait_for_selector("#resolvingScreen:not(.hidden)")
    page.wait_for_timeout(1500)
    antes = page.evaluate("relogioAtivo()")
    page.evaluate("_ultimaAtividade = Date.now() - LIMITE_INATIVIDADE_MS - 1000")
    page.wait_for_selector("#inatividade:not([hidden])", timeout=5000)
    assert "você ainda está estudando" in page.inner_text("#inatividade"), "a mensagem de inatividade não apareceu"
    parado = page.evaluate("relogioAtivo()"); page.wait_for_timeout(1500)
    assert page.evaluate("relogioAtivo()") == parado, "o tempo deveria ficar parado"
    assert parado <= antes + 1500, "o período parado não deveria contar"
    page.click("#inatividadeBtn"); page.wait_for_timeout(1300)
    assert page.locator("#inatividade").is_hidden(), "a tela não voltou"
    assert page.evaluate("relogioAtivo()") > parado, "o tempo deveria voltar a contar"
    assert page.locator("#refazerBtn").count() == 0, "o botão Refazer da barra superior deveria ter saído"


class DriveFalso:
    """Google Drive de mentira (só o que o CRIVO usa), servido pelo Playwright no lugar de googleapis.com."""
    def __init__(self):
        self.arq, self.n = {}, 0

    def _novo(self, nome, pai=None, conteudo="", pasta=False):
        self.n += 1
        fid = f"f{self.n}"
        self.arq[fid] = {"id": fid, "name": nome, "parents": [pai] if pai else [], "conteudo": conteudo,
                         "pasta": pasta, "trashed": False, "modifiedTime": f"2026-01-01T00:00:{self.n:02d}Z", "t": self.n}
        return fid

    def ativos(self, prefixo=""):
        return [a for a in self.arq.values() if not a["trashed"] and a["name"].startswith(prefixo)]

    def rota(self, route):
        r = route.request
        u = urllib.parse.urlparse(r.url); qs = urllib.parse.parse_qs(u.query); m = r.method
        resp = lambda obj: route.fulfill(status=200, content_type="application/json", body=json.dumps(obj))
        if m == "GET" and u.path == "/drive/v3/files":
            q = qs.get("q", [""])[0]
            res = [a for a in self.arq.values() if not a["trashed"]]
            if "mimeType='application/vnd.google-apps.folder'" in q: res = [a for a in res if a["pasta"]]
            nm = re.search(r"name='([^']+)'", q); ct = re.search(r"name contains '([^']+)'", q); pai = re.search(r"'([^']+)' in parents", q)
            if nm: res = [a for a in res if a["name"] == nm.group(1)]
            if ct: res = [a for a in res if ct.group(1) in a["name"]]
            if pai: res = [a for a in res if pai.group(1) in a["parents"]]
            res.sort(key=lambda a: -a["t"])
            return resp({"files": [{k: a[k] for k in ("id", "name", "modifiedTime")} for a in res]})
        if m == "POST" and u.path == "/drive/v3/files":
            meta = json.loads(r.post_data or "{}")
            return resp({"id": self._novo(meta["name"], pasta=True)})
        mm = re.match(r"^/drive/v3/files/([^/]+)$", u.path)
        if mm and m == "GET":
            a = self.arq.get(mm.group(1))
            return route.fulfill(status=200 if a else 404, body=a["conteudo"] if a else "")
        if mm and m == "PATCH":
            a = self.arq.get(mm.group(1))
            if a: a.update(json.loads(r.post_data or "{}")); self.n += 1; a["t"] = self.n
            return resp({"id": mm.group(1)})
        mu = re.match(r"^/upload/drive/v3/files/([^/]+)$", u.path)
        if mu and m == "PATCH":
            a = self.arq[mu.group(1)]; a["conteudo"] = r.post_data; self.n += 1; a["t"] = self.n
            return resp({"id": a["id"]})
        if u.path == "/upload/drive/v3/files" and m == "POST":
            partes = (r.post_data or "").split("\r\n\r\n")
            meta = json.loads(partes[1].split("\r\n")[0])
            conteudo = partes[2].rsplit("\r\n--", 1)[0]
            return resp({"id": self._novo(meta["name"], meta["parents"][0], conteudo)})
        return route.fulfill(status=404, body="")


@teste("Drive: salva sozinho em 10 s, junta com outro aparelho, envio ao sair sem sobrescrever, cópias e restauração")
def t_drive(page, url):
    fd = DriveFalso()
    page.route("https://www.googleapis.com/**", fd.rota)
    page.route("https://accounts.google.com/**", lambda r: r.fulfill(status=200, content_type="text/javascript", body=""))
    page.evaluate("showHome(); showScreen(authScreen)")
    page.evaluate("driveTok = 'falso'; driveTokExp = Date.now() + 3600e3; driveAtivo = true; void sincronizarDrive(false)")
    page.wait_for_function("driveUltimaAssinatura !== '' && !driveSincronizando", timeout=10000)
    assert len(fd.ativos("crivo_progresso.json")) == 1, "não criou o arquivo de progresso no Drive"
    hoje = page.evaluate("isoDoDia(Date.now())")
    assert len(fd.ativos(f"crivo_copia_{hoje}")) == 1, "não criou a cópia de segurança do dia"
    assert "Salvo" in page.inner_text("#nuvemBarra"), "o indicador da barra inferior não mostra o salvamento"
    # outro aparelho gravou uma resposta no Drive
    principal = fd.ativos("crivo_progresso.json")[0]
    d = json.loads(principal["conteudo"])
    d["registro"].append({"data": "2026-01-02T10:00:00.000Z", "prova": "AMP", "ano": "2026", "questao": "96", "acao": "confirmou", "opcao": "B", "correta": "A"})
    principal["conteudo"] = json.dumps(d)
    # mudança aqui: deve ir sozinha ao Drive em até ~10 s, juntando com a do outro aparelho
    page.evaluate("saveProgressForQuestion('AMP', '2026', 97, { selected: 'C', correct: 'C' })")
    t0 = time.time()
    while time.time() - t0 < 16:
        regs = json.loads(fd.ativos("crivo_progresso.json")[0]["conteudo"])["registro"]
        if any(e["questao"] == "97" for e in regs): break
        page.wait_for_timeout(500)
    regs = json.loads(fd.ativos("crivo_progresso.json")[0]["conteudo"])["registro"]
    assert any(e["questao"] == "97" for e in regs), "a mudança não foi salva sozinha no Drive"
    assert any(e["questao"] == "96" for e in regs), "a resposta do outro aparelho foi perdida"
    for _ in range(20):
        if page.evaluate("progress.registro.some(e => e.questao === '96' && e.ano === '2026')"): break
        page.wait_for_timeout(300)
    assert page.evaluate("progress.registro.some(e => e.questao === '96' && e.ano === '2026')"), (
        "a resposta do outro aparelho não veio para cá: local=" + page.evaluate("progress.registro.map(e => e.ano + '/' + e.questao).join(',')")
        + " drive=" + ",".join(e["ano"] + "/" + e["questao"] for e in regs))
    # envio ao sair: não grava por cima do principal, cria um pendente
    antes = fd.ativos("crivo_progresso.json")[0]["conteudo"]
    page.evaluate("clearTimeout(driveTimer); driveTimer = 1; saveProgressForQuestion('AMP', '2026', 98, { selected: 'D', correct: 'D' }); driveEnvioRapido()")
    page.wait_for_timeout(800)
    assert fd.ativos("crivo_progresso.json")[0]["conteudo"] == antes, "o envio ao sair gravou por cima do arquivo principal"
    assert len(fd.ativos("crivo_pendente_")) == 1, "o envio ao sair não criou o arquivo pendente"
    page.evaluate("driveTimer = null; driveUltimaAssinatura = ''; void sincronizarDrive(false)")
    page.wait_for_function("!driveSincronizando", timeout=10000); page.wait_for_timeout(300)
    assert len(fd.ativos("crivo_pendente_")) == 0, "o pendente não foi juntado e mandado para a lixeira"
    regs = json.loads(fd.ativos("crivo_progresso.json")[0]["conteudo"])["registro"]
    assert any(e["questao"] == "98" for e in regs), "a mudança do pendente não entrou no arquivo principal"
    # restaurar a cópia do dia (que não tem as questões 96, 97 e 98)
    page.evaluate("void abrirRestaurarCopia()")
    page.wait_for_selector(".modal .escolha-botoes button[data-i='0']", timeout=10000)
    page.click(".modal .escolha-botoes button[data-i='0']")
    page.wait_for_selector("text=Sim, restaurar"); page.click("text=Sim, restaurar")
    page.wait_for_function("!driveSincronizando && !document.querySelector('.modal')", timeout=10000); page.wait_for_timeout(300)
    assert not page.evaluate("progress.registro.some(e => e.questao === '98')"), "a cópia não foi restaurada"
    regs = json.loads(fd.ativos("crivo_progresso.json")[0]["conteudo"])["registro"]
    assert not any(e["questao"] == "98" for e in regs), "o Drive não ficou com a cópia restaurada"
    assert len(fd.ativos("crivo_copia_antes-de-restaurar")) == 1, "não guardou a cópia antes de restaurar"
    page.evaluate("driveAtivo = false; driveTok = null; mostrarIndicadorDrive()")
    page.unroute("https://www.googleapis.com/**"); page.unroute("https://accounts.google.com/**")


@teste("carregar arquivo: compara, avisa e pergunta (somar, substituir ou cancelar)")
def t_carregar_arquivo(page, url):
    page.evaluate("showHome(); showScreen(authScreen)")
    outro = {"formato": "crivo-progresso", "versao": 2, "registro": [
        {"data": "2020-01-01T10:00:00.000Z", "prova": "AMP", "ano": "2026", "questao": "50", "acao": "confirmou", "opcao": "A", "correta": "A"}]}
    caminho = os.path.join(os.environ.get("TMPDIR", "/tmp"), "progresso_teste.json")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(outro, f)
    page.set_input_files("#progressFile", caminho)
    page.wait_for_selector(".modal >> text=Carregar arquivo de progresso")
    txt = page.inner_text(".modal")
    assert "mais antigo" in txt and "Somar ao meu progresso" in txt and "Substituir" in txt, "a comparação não apareceu: " + txt[:200]
    page.click("text=Cancelar")
    assert not page.evaluate("progress.registro.some(e => e.questao === '50')"), "cancelar não deveria carregar"
    page.set_input_files("#progressFile", caminho)
    page.wait_for_selector(".modal >> text=Somar ao meu progresso"); page.click("text=Somar ao meu progresso")
    page.wait_for_timeout(200)
    assert page.evaluate("progress.registro.some(e => e.questao === '50')"), "somar não juntou o arquivo"


@teste("formulários: Solicitar provas / Ajudar, ⚠️ Reportar e o link da página da questão")
def t_solicitar(page, url):
    page.evaluate("showHome(); showScreen(authScreen)")
    page.evaluate("window._abertos = []; window.open = (u) => { window._abertos.push(u); return null; }")
    page.click("#solicitarProvasBtn")
    assert "forms" in (page.evaluate("window._abertos")[-1:] or [""])[0], "o botão deveria abrir o formulário de solicitar provas"
    assert "Ajudar o CRIVO" in page.inner_text("#solicitarProvasBtn"), "o botão deveria se chamar Solicitar provas / Ajudar o CRIVO"
    page.click("#startBtnHome"); quadro(page)
    page.click("#reportarBtn")
    assert "1FAIpQLSeIwZE2" in page.evaluate("window._abertos")[-1], "o ⚠️ Reportar deveria abrir o formulário de reporte"
    q = page.evaluate("[currentExam, currentYear, String(questoes[questaoAtualIndex].num)]")
    assert all(x in page.inner_text("body") for x in q), "o aviso deveria lembrar banca, edição e número"
    html = page.evaluate("CrivoRender.montarPagina({ banca: 'AMP', ano: '2020', questoes: [{ id: 'AMP-2020-Q1', numero: 1, enunciado_html: 'E', alternativas: { A: 'a', B: 'b' }, gabarito: 'A', correcao: { secoes_html: {} }, revisao: { status: 'nao_revisado', alertas: [], revisores: [] }, duvidas: [] }] }, 1)")
    assert "1FAIpQLSeIwZE2" in html and "mailto:" not in html, "o link Reportar erro da página da questão deveria abrir o formulário"
    page.click("#homeBtn")


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


@teste("barra superior: desmarcar 'Todas' desmarca tudo; sem nenhuma, pede para escolher")
def t_todas(page, url):
    page.click("#bancaMultiBtn")
    page.uncheck("#bancaAllChk"); page.wait_for_timeout(300)
    assert page.locator("#bancaMultiPanel input[data-banca-value]:checked").count() == 0, "desmarcar Todas deveria desmarcar as bancas"
    assert page.evaluate("questoes.length") == 0 and "nenhuma" in page.inner_text("#bancaMultiBtn"), "sem banca, não deveria haver questões"
    page.wait_for_function("document.getElementById('questionFrame').contentDocument?.body?.innerText.includes('Escolha pelo menos uma banca')", timeout=5000)
    page.check("#bancaMultiPanel input[data-banca-value='AMP']"); page.wait_for_timeout(300)
    assert page.evaluate("filtros.bancas.join()") == "AMP" and page.evaluate("questoes.length") > 0, "marcar uma banca deveria mostrar só ela"
    page.check("#bancaAllChk"); page.wait_for_timeout(300)
    assert page.evaluate("filtros.bancas.length") == 0, "marcar Todas deveria voltar para todas"
    page.click("#anoMultiBtn")
    page.uncheck("#anoAllChk"); page.wait_for_timeout(300)
    assert page.locator("#anoMultiPanel input[data-ano-value]:checked").count() == 0 and page.evaluate("questoes.length") == 0, "edições: desmarcar Todas"
    page.check("#anoMultiPanel input[data-ano-value] >> nth=0"); page.wait_for_timeout(300)
    assert page.evaluate("filtros.anos.length") == 1 and page.evaluate("questoes.length") > 0, "marcar uma edição"
    page.check("#anoAllChk"); page.wait_for_timeout(300)
    page.mouse.click(5, 300); page.wait_for_timeout(200)
    quadro(page)


@teste("cartão continua quando o texto dos grifos muda e cartões antigos são juntados")
def t_cartao_texto(page, url):
    r = page.evaluate("""() => {
        const g = progress.grifados.find(x => x.id === 'gteste1');
        progress.grifados.push(Object.assign({}, g, { id: 'gteste3', texto: 'Frente extra', startOffset: 5 }));
        const l = listarCartoes();
        const c = l.find(x => x.c.numero == 7 && x.c.dir === 'fv');
        const r = [l.filter(x => x.orfao).length, c.c.frente.length, c.c.revisoes.length > 0];
        progress.grifados = progress.grifados.filter(x => x.id !== 'gteste3');
        const base = `${c.c.prova}|${c.c.ano}|${c.c.questao}|7|vf`;
        progress.cartoes[base + '|antigo'] = Object.assign({}, c.c, { dir: 'vf', revisoes: [{ data: '2025-01-01T00:00:00.000Z', nota: 2 }] });
        const antes = progress.cartoes[base].revisoes.length;
        listarCartoes();
        r.push(!progress.cartoes[base + '|antigo'], progress.cartoes[base].revisoes.length === antes + 1);
        return r;
    }""")
    assert r == [0, 2, True, True, True], f"cartões com texto mudado ou ids antigos: {r}"


@teste("Desempenho: tempo médio até confirmar, na correção e total")
def t_tempos(page, url):
    r = page.evaluate("""() => { progress.leituras = Object.assign({}, progress.leituras, { 'x1': 30000 });
        renderDesempenho(); return [document.getElementById('painelDesempenho').innerText, temposMedios()]; }""")
    txt, t = r
    for rot in ("até confirmar (média)", "na correção (média)", "total por questão"):
        assert rot in txt, f"faltou '{rot}' no Desempenho"
    assert t["nConf"] > 0 and t["leit"] > 0, f"tempos não calculados: {t}"


@teste("filtro 'Questões do plano de hoje' no painel Filtros")
def t_filtro_plano(page, url):
    page.evaluate("showScreen(resolvingScreen)")
    page.click("#filtrosBtn"); page.check("#soPlanoHoje"); page.wait_for_timeout(500)
    esperado = page.evaluate("questoesDoPlanoDeHoje(planoAtivo(), calcularPlano(planoAtivo()).dist).length")
    if esperado:
        assert page.evaluate("filtros.listaNome") == "Plano de hoje" and page.evaluate("questoes.length") == esperado, "o filtro do plano não abriu as questões de hoje"
        assert page.is_checked("#soPlanoHoje"), "o filtro do plano deveria ficar marcado"
        if not page.is_visible("#soPlanoHoje"): page.click("#filtrosBtn")
        page.uncheck("#soPlanoHoje"); page.wait_for_timeout(400)
        assert not page.evaluate("filtros.lista"), "desmarcar deveria voltar aos filtros anteriores"
    else:
        assert not page.is_checked("#soPlanoHoje"), "sem questões no plano, o filtro não deveria ficar marcado"
    page.mouse.click(5, 300); page.wait_for_timeout(200)


@teste("tamanho dos ícones e preferências de letra/ícones no progresso (Drive)")
def t_icones(page, url):
    page.evaluate("showHome(); showScreen(authScreen)")
    page.click("#iconeMaisBtn")
    assert page.inner_text("#iconeValor") == "110%", "tamanho dos ícones não mudou"
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--crivo-icones').trim()") == "1.1"
    assert page.evaluate("progress.preferencias && progress.preferencias.icones") == 1.1, "os ícones não foram para o progresso"
    r = page.evaluate("""() => { progress.preferencias = mesclarProgresso({ registro: [], preferencias: progress.preferencias },
            { registro: [], preferencias: { escala: 1.2, icones: 1.5, atualizado: '2099-01-01T00:00:00.000Z' } }).preferencias;
        aplicarPrefsDoProgresso(); const r = [uiPrefs.escala, uiPrefs.icones];
        uiPrefs.prefsEm = ''; progress.preferencias = { escala: 1, icones: 1, atualizado: new Date().toISOString() };
        aplicarPrefsDoProgresso(); return r; }""")
    assert r == [1.2, 1.5], f"as preferências mais novas do Drive não foram aplicadas: {r}"
    assert page.inner_text("#iconeValor") == "100%", "não voltou para 100%"


@teste("salvamento: indicador na barra inferior (sem cobrir Anterior) e aviso arrastável só sem autorização")
def t_indicador(page, url):
    page.evaluate("showScreen(resolvingScreen); driveAtivo = true; mostrarIndicadorDrive('salvo')")
    assert page.evaluate("document.querySelector('.bottom-center').firstElementChild.id") == "nuvemBarra", "o indicador deve ficar antes do ▾"
    a = page.locator("#nuvemBarra").bounding_box(); b = page.locator("#prevBtn").bounding_box()
    sobrepoe = a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"] and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]
    assert not sobrepoe, "o indicador cobre o botão Anterior"
    assert not page.is_visible("#nuvemAviso"), "o aviso flutuante não deve aparecer quando está salvo"
    page.evaluate("mostrarIndicadorDrive('reconectar')")
    assert page.is_visible("#nuvemAviso") and "reconectar" in page.inner_text("#nuvemAviso"), "o aviso de autorização expirada não apareceu"
    caixa = page.locator("#nuvemAviso").bounding_box()
    page.evaluate("window._recon = 0; window._sd = sincronizarDrive; sincronizarDrive = async () => { window._recon++; window._pilha = new Error().stack; }; 0")
    page.mouse.move(caixa["x"] + 20, caixa["y"] + 15); page.mouse.down()
    page.mouse.move(caixa["x"] - 60, caixa["y"] + 120, steps=5); page.mouse.up()
    pos = page.evaluate("JSON.parse(localStorage.getItem('crivo_aviso_pos'))")
    assert pos and abs(pos["y"] - (caixa["y"] + 105)) < 8, f"o aviso não foi arrastado/lembrado: {pos}"
    assert page.evaluate("window._recon") == 0, "arrastar não deve abrir o login: " + str(page.evaluate("window._pilha")).replace(chr(10), " | ")
    page.click("#nuvemAviso")
    assert page.evaluate("window._recon") == 1, "tocar no aviso deveria reconectar"
    page.evaluate("sincronizarDrive = window._sd; mostrarIndicadorDrive('offline')")
    assert "Sem internet" in page.inner_text("#nuvemAviso"), "aviso de sem internet"
    page.evaluate("document.body.classList.add('rodape-oculto'); mostrarIndicadorDrive('salvo')")
    assert not page.is_visible("#nuvemAviso"), "salvo: o aviso deveria sumir"
    assert page.is_visible("#nuvemBarra") and not page.is_visible("#nuvemBarra .nuvem-txt"), "barra minimizada: só o ícone"
    page.evaluate("document.body.classList.remove('rodape-oculto'); localStorage.removeItem('crivo_aviso_pos'); driveAtivo = false; mostrarIndicadorDrive()")


@teste("página da questão: banca - edição - disciplina abaixo do número; histórico com os três tempos")
def t_cabecalho_historico(page, url):
    page.evaluate("showScreen(resolvingScreen)")
    quadro(page)
    q = page.evaluate("[currentExam, currentYear, String(questoes[questaoAtualIndex].num), disciplinaDe(currentExam, currentYear, questoes[questaoAtualIndex].num)]")
    sub = page.frame_locator("#questionFrame").locator(".crivo-origem").inner_text()
    assert sub == " - ".join(x for x in q[:2] + [q[3]] if x), f"subtítulo errado: {sub!r} {q}"
    page.evaluate("""() => { const [b, a, n] = [currentExam, currentYear, String(questoes[questaoAtualIndex].num)];
        const d = new Date(Date.now() - 5000).toISOString();
        progress.registro.push({ data: d, prova: b, ano: a, questao: n, acao: 'confirmou', opcao: 'A', correta: 'B', tempoMs: 65000 });
        progress.leituras = Object.assign({}, progress.leituras, { [d]: 30000 }); openHistoricoModal(b, a, n); }""")
    txt = page.inner_text("#historicoList")
    assert "até confirmar" in txt and "na correção" in txt and "total" in txt, "o histórico não mostra os tempos: " + txt[:200]
    assert "1m35s" in txt and "1m5s" in txt and "30s" in txt, "o total (65 s + 30 s) não aparece: " + txt[:300]
    page.click("#closeHistoricoBtn")


@teste("cartões: classificação como no Anki, painel com gráficos e lista, e dados de um cartão")
def t_painel_cartoes(page, url):
    r = page.evaluate("""() => { const d = Date.now() - 400 * DIA_MS, rev = l => l.map(([dia, nota]) => ({ data: new Date(d + dia * DIA_MS).toISOString(), nota }));
        const cl = l => historicoCartao({ revisoes: rev(l) }).classe;
        return [cl([]), cl([[0, 1]]), cl([[0, 3]]), cl([[0, 3], [3, 1]]), cl([[0, 3], [3, 3], [12, 3], [40, 3], [120, 3]])]; }""")
    assert r == ["novo", "aprendendo", "recente", "reaprendendo", "maduro"], f"classificação errada: {r}"
    assert page.evaluate("Object.values(progress.cartoes).some(c => (c.revisoes || []).some(v => v.tempoMs > 0))"), "o tempo dos cartões não foi gravado"
    page.click("#cartPainelBtn")
    assert page.is_visible("#cartPainel") and not page.is_visible("#cartListaArea"), "o painel não abriu"
    txt = page.inner_text("#cartPainel")
    for t in ("Quantidade por classificação", "Previsão de revisões", "Revisões por dia", "True retention", "Botões de resposta",
              "Intervalos", "Estabilidade", "Dificuldade", "Retenção atual", "Horários", "Todos os cartões"):
        assert t in txt, f"faltou '{t}' no painel"
    n = page.evaluate("listarCartoes().length")
    assert page.locator("#cartPainel .cart-linha").count() == n, "a lista do painel não tem todos os cartões"
    page.select_option("#cpClasse", "novo"); page.wait_for_timeout(100)
    novos = page.evaluate("dadosDosCartoes().filter(x => x.classe === 'novo').length")
    assert page.locator("#cartPainel .cart-linha").count() == novos, "o filtro de classificação não filtrou"
    page.select_option("#cpClasse", "")
    page.click("#cartPainel .cart-ordem[data-ordem='revs']"); page.click("#cartPainel .cart-ordem[data-ordem='revs']")
    page.click("#cartPainel .cart-linha >> nth=0")
    page.wait_for_selector(".cart-info")
    info = page.inner_text(".cart-info")
    for t in ("Classificação", "Próxima revisão", "Estabilidade", "Dificuldade", "Retenção atual", "Tempo médio", "Frente", "Abrir a questão de origem"):
        assert t in info, f"faltou '{t}' nos dados do cartão"
    assert page.locator(".cart-info tbody tr").count() >= 1, "a tabela de revisões do cartão está vazia"
    page.click(".cart-info button[data-acao='fechar']")
    page.click("#backFromCartoesBtn")
    assert page.is_visible("#cartListaArea") and not page.is_visible("#cartPainel"), "Voltar deveria fechar o painel"
    page.evaluate("iniciarSessaoCartoes([listarCartoes()[0].id])")
    page.click("#cartInfoBtn"); page.wait_for_selector(".cart-info")
    page.click(".cart-info button[data-acao='fechar']")
    page.evaluate("mostrarListaCartoes()")


@teste("Desempenho: mapas de calor, cartões, evolução semanal/mensal/anual e cartões por disciplina")
def t_desempenho_cartoes(page, url):
    page.evaluate("abrirTelaDesempenho()"); page.click("#abaDesempenho"); page.wait_for_selector("#painelDesempenho", state="visible")
    assert page.locator("#painelDesempenho .hm-bloco").count() == 2, "faltam os dois mapas de calor"
    txt = page.inner_text("#desempCartoes")
    assert "Cartões" in txt and "tempo médio por cartão" in txt and "Maduros" in txt, "o bloco dos cartões está incompleto: " + txt[:200]
    assert page.locator("#desempEvolucao .desemp-semana").count() == 7, "semanal: 7 dias"
    page.click("#desempEvolucao [data-evo='mensal']")
    assert page.locator("#desempEvolucao .desemp-semana").count() == 30, "mensal: 30 dias"
    page.click("#desempEvolucao [data-evo='anual']")
    assert page.locator("#desempEvolucao .desemp-semana").count() == 12, "anual: 12 meses"
    page.click("#desempEvolucao [data-evo='semanal']")
    tem = page.evaluate("[...cartoesPorGrupo().values()].reduce((t, z) => t + z.tot, 0)")
    if tem:
        assert page.locator("#desempGrafico .graf-cartoes").count() > 0, "os cartões não aparecem ao lado das disciplinas"
    ano = page.evaluate("new Date().getFullYear()")
    dias = page.evaluate("[...document.querySelectorAll('.hm-q .hm-dia[data-dia], .hm-q .hm-dia.futuro')].length")
    assert page.get_attribute(".hm-q .hm-dia[data-dia] >> nth=0", "data-dia") == f"{ano}-01-01", "o mapa deveria começar em 1º de janeiro"
    assert dias in (365, 366), f"o mapa deveria ir até 31 de dezembro ({dias} dias)"
    assert page.locator(".hm-q .hm-meses span").count() == 12, "faltam os nomes dos meses"
    cor_q = page.evaluate("getComputedStyle(document.querySelector('.hm-q .hm-dia.n4, .hm-q .hm-dia.n3, .hm-q .hm-dia.n2, .hm-q .hm-dia.n1')).backgroundColor")
    cor_c = page.evaluate("(() => { const e = document.querySelector('.hm-c .hm-dia.n4, .hm-c .hm-dia.n3, .hm-c .hm-dia.n2, .hm-c .hm-dia.n1'); return e ? getComputedStyle(e).backgroundColor : 'nenhum'; })()")
    assert cor_q != cor_c, "as cores dos mapas de questões e de cartões deveriam ser diferentes"
    assert page.locator(".hm-q .hm-mover[data-passo='1']").is_disabled(), "não deveria avançar além do ano atual"
    if tem:
        txt = page.inner_text("#desempGrafico")
        assert "Retenção" in txt and "True retention" not in txt, "no gráfico deve aparecer Retenção"
        assert page.locator("#desempGrafico .rosca-mini").count() > 0, "faltou a rosca dos cartões"
        page.click("#desempGrafico .desemp-cartoes:not([disabled]) >> nth=0")
        page.wait_for_selector("#cartoesScreen:not(.hidden)")
        assert page.is_visible("#cartSessao"), "o botão 🃏 Cartões deveria abrir a revisão dos cartões do grupo"
        page.evaluate("mostrarListaCartoes()")
        page.evaluate("abrirTelaDesempenho()"); page.click("#abaDesempenho"); page.wait_for_selector("#painelDesempenho", state="visible")
    dia = page.evaluate("isoDoDia(Date.now() - 3 * DIA_MS)")
    page.click(f".hm-dia[data-tipo='q'][data-dia='{dia}']")
    page.wait_for_selector("#progressScreen:not(.hidden)")
    assert page.is_checked("#gabPorData") and page.input_value("#gabDataInput") == dia, "tocar num dia deveria abrir o Meu gabarito naquela data"
    page.click("#backFromProgressBtn")
    page.evaluate("showScreen(resolvingScreen)")


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
            for t in (t_inicio, t_resolucao, t_responder, t_grifar, t_fsrs, t_navegar, t_filtros, t_todas, t_gabarito, t_revisao, t_cartoes, t_cartoes_dias,
                      t_exportar_cartoes, t_painel_cartoes, t_cartao_texto, t_orfao, t_mescla, t_aparencia, t_icones, t_temas, t_desempenho, t_tempos, t_desempenho_cartoes, t_plano, t_meta,
                      t_filtro_plano, t_simulado, t_inatividade, t_solicitar, t_drive, t_indicador, t_carregar_arquivo, t_selo_duvidas, t_cabecalho_historico, t_recarregar):
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
