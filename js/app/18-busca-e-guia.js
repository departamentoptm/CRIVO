/* ============================================================
   BUSCA E GUIA DE PRIMEIROS PASSOS
   Busca: procura palavras no enunciado, nas alternativas e (se marcado) nas correções de todas as edições.
   Na primeira busca, as edições são baixadas uma vez (com barra de progresso) e ficam guardadas na memória
   da página; depois, a procura é feita no próprio aparelho. Aparecem as questões que têm todas as palavras
   (sem diferenciar acentos e maiúsculas). Toque num resultado para abrir a questão, ou resolva todos.
   Guia: na primeira visita, um passeio de 6 balões pelas funções principais, com "Pular"; o botão
   "❓ Ajuda" na tela inicial mostra de novo.
   ============================================================ */
const buscaScreen = document.getElementById('buscaScreen');
const MAX_RESULTADOS = 200;
let _indiceBusca = null, _carregandoBusca = null, _ultimaBusca = [];

const PALAVRAS_COMUNS = new Set('de da do das dos e a o as os em na no nas nos com por para pra um uma uns umas que se ao aos ou'.split(' '));
const _inicioDePalavra = (s, j) => j === 0 || !/[a-z0-9]/.test(s[j - 1]);
const _normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function _textoPuro(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html || '').replace(/<(br|\/p|\/li|\/tr|\/h\d)>/gi, ' $&');
    return d.textContent.replace(/\s+/g, ' ').trim();
}
/* baixa as edições (uma vez) e monta o índice: um item por questão, com os textos e as versões sem acento */
async function indiceDaBusca(aoProgredir) {
    if (_indiceBusca) return _indiceBusca;
    if (_carregandoBusca) return _carregandoBusca;
    _carregandoBusca = (async () => {
        if (!Object.keys(exams || {}).length) await loadManifest();
        try { await loadDisciplinas(); } catch {}
        const edicoes = [];
        for (const b of Object.keys(exams).sort()) for (const a of Object.keys(exams[b]).sort((x, y) => y.localeCompare(x))) edicoes.push([b, a]);
        const itens = [];
        let feitas = 0;
        for (const [b, a] of edicoes) {
            try {
                const ed = await CrivoRender.carregarEdicao(b, a);
                for (const q of ed.questoes) {
                    const alts = Object.entries(q.alternativas || {}).map(([l, t]) => `${l}) ${_textoPuro(t)}`).join(' · ');
                    const sec = (q.correcao && q.correcao.secoes_html) || {};
                    const corr = Object.entries(sec).filter(([k]) => k !== '2.10' && k !== '2.15').map(([, v]) => _textoPuro(v)).join(' ');
                    const campos = [['Enunciado', _textoPuro((q.enunciado_html || '') + ' ' + (q.extras_html || ''))], ['Alternativas', alts], ['Correção', corr]];
                    itens.push({ b, a, n: String(q.numero), campos, normais: campos.map(([, t]) => _normal(t)) });
                }
            } catch (e) { console.warn('busca:', b, a, e); }
            feitas++;
            if (aoProgredir) aoProgredir(feitas, edicoes.length);
        }
        _indiceBusca = itens;
        return itens;
    })();
    try { return await _carregandoBusca; } finally { _carregandoBusca = null; }
}
/* trecho em volta da palavra mais específica (a mais longa), com todas as palavras buscadas destacadas.
   O texto sem acento tem o mesmo tamanho do original, então as posições valem para os dois. */
function _trecho(texto, normal, termos) {
    const principal = termos.find(t => normal.includes(t)) || termos[0];
    const i = normal.indexOf(principal);
    const ini = i < 0 ? 0 : Math.max(0, i - 70), fim = Math.min(texto.length, i < 0 ? 160 : i + principal.length + 90);
    const marcas = [];
    for (const t of termos) { let j = normal.indexOf(t, ini); while (j >= 0 && j < fim) { if (_inicioDePalavra(normal, j)) marcas.push([j, Math.min(fim, j + t.length)]); j = normal.indexOf(t, j + t.length); } }
    marcas.sort((a, b) => a[0] - b[0]);
    let o = ini ? '…' : '', p = ini;
    for (const [a, b] of marcas) { if (a < p) continue; o += escapeHtml(texto.slice(p, a)) + '<mark>' + escapeHtml(texto.slice(a, b)) + '</mark>'; p = b; }
    return o + escapeHtml(texto.slice(p, fim)) + (fim < texto.length ? '…' : '');
}
async function buscar() {
    const consulta = document.getElementById('buscaInput').value.trim();
    const status = document.getElementById('buscaStatus'), box = document.getElementById('buscaResultados');
    const estudar = document.getElementById('buscaEstudarBtn');
    const todos = [...new Set(_normal(consulta).split(/[\s,;.]+/).filter(t => t.length >= 2))];
    const uteis = todos.filter(t => !PALAVRAS_COMUNS.has(t));                 /* "de", "da", "com"… não contam */
    const termos = (uteis.length ? uteis : todos).sort((a, b) => b.length - a.length);
    if (!termos.length) { status.textContent = 'Digite pelo menos uma palavra com 2 letras ou mais.'; box.innerHTML = ''; estudar.hidden = true; return; }
    const comCorrecao = document.getElementById('buscaCorrecoes').checked, banca = document.getElementById('buscaBanca').value;
    if (!_indiceBusca) status.textContent = 'Preparando a busca: baixando as questões e correções (só na primeira vez)…';
    const itens = await indiceDaBusca((f, t) => { status.textContent = `Preparando a busca: ${f} de ${t} edições baixadas (só na primeira vez)…`; });
    const achados = [];
    for (const it of itens) {
        if (banca && it.b !== banca) continue;
        const ondeProcurar = comCorrecao ? [0, 1, 2] : [0, 1];
        const todo = ondeProcurar.map(i => it.normais[i]).join('\n');
        if (!termos.every(t => todo.includes(t))) continue;
        const campo = ondeProcurar.find(i => it.normais[i].includes(termos[0])) ?? ondeProcurar.find(i => termos.some(t => it.normais[i].includes(t)));
        achados.push({ it, campo });
    }
    _ultimaBusca = achados.map(x => `${x.it.b}|${x.it.a}|${x.it.n}`);
    estudar.hidden = !achados.length;
    estudar.textContent = `▶ Resolver estas questões (${achados.length})`;
    status.textContent = achados.length
        ? `${achados.length} ${achados.length === 1 ? 'questão encontrada' : 'questões encontradas'}${achados.length > MAX_RESULTADOS ? ` (mostrando as ${MAX_RESULTADOS} primeiras)` : ''}. Toque numa questão para abri-la.`
        : 'Nenhuma questão com todas essas palavras. Tente menos palavras ou outra grafia.';
    box.innerHTML = achados.slice(0, MAX_RESULTADOS).map(({ it, campo }) => {
        const disc = disciplinaDe(it.b, it.a, it.n), [rot, texto] = it.campos[campo];
        const feita = isRealizada(it.b, it.a, it.n);
        return `<button type="button" class="busca-item" data-k="${escapeHtml(`${it.b}|${it.a}|${it.n}`)}">`
            + `<span class="busca-titulo">${escapeHtml(it.b)} ${escapeHtml(it.a)} - Q${escapeHtml(it.n)}${disc ? ` · ${escapeHtml(disc)}` : ''}${feita ? ' · <span class="busca-feita">já respondida</span>' : ''}</span>`
            + `<span class="busca-trecho"><small>${rot}:</small> ${_trecho(texto, it.normais[campo], termos)}</span></button>`;
    }).join('');
}
async function abrirTelaBusca() {
    if (!Object.keys(exams || {}).length) { try { await loadManifest(); } catch {} }
    const sel = document.getElementById('buscaBanca'), v = sel.value;
    sel.innerHTML = '<option value="">Todas as bancas</option>' + Object.keys(exams || {}).sort().map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
    sel.value = v;
    showScreen(buscaScreen);
    setTimeout(() => document.getElementById('buscaInput').focus(), 50);
}
document.getElementById('buscaBtnHome').addEventListener('click', abrirTelaBusca);
document.getElementById('backFromBuscaBtn').addEventListener('click', () => { showHome(); showScreen(authScreen); });
document.getElementById('buscaForm').addEventListener('submit', e => { e.preventDefault(); buscar(); });
document.getElementById('buscaCorrecoes').addEventListener('change', () => { if (document.getElementById('buscaInput').value.trim()) buscar(); });
document.getElementById('buscaBanca').addEventListener('change', () => { if (document.getElementById('buscaInput').value.trim()) buscar(); });
document.getElementById('buscaResultados').addEventListener('click', async e => {
    const it = e.target.closest('.busca-item');
    if (!it) return;
    const [b, a, n] = it.dataset.k.split('|');
    await abrirQuestaoDoGabarito(b, a, n);
});
document.getElementById('buscaEstudarBtn').addEventListener('click', () => {
    if (_ultimaBusca.length) estudarGrupo(_ultimaBusca.slice(), `Busca: ${document.getElementById('buscaInput').value.trim()}`);
});

/* ---------- guia de primeiros passos ---------- */
const GUIA_KEY = 'crivo_guia_visto';
const PASSOS_GUIA = [
    ['#startBtnHome', 'Resolver questões', 'Escolha banca, edição e disciplina na barra de cima e responda. Depois de confirmar, veja a correção comentada. Selecione um trecho e toque em 🖍️ Grifar para destacá-lo.'],
    ['#revisaoBtnHome', 'Revisão espaçada', 'As questões que você errou (ou classificou como difíceis) voltam no dia certo, como no Anki. Faça as revisões de hoje aqui.'],
    ['#cartoesBtnHome', 'Cartões dos grifos', 'Toque duas vezes num grifo e dê a ele um número e um lado (Frente, Verso ou Cloze): ele vira um cartão de memorização, revisado aqui.'],
    ['#desempenhoBtnHome', 'Desempenho e plano', 'Veja seu acerto por disciplina e tema, seus pontos fracos e monte um plano com a data da prova e as horas que você tem.'],
    ['#buscaBtnHome', 'Buscar questões', 'Procure um assunto (ex.: "Kawasaki") no enunciado, nas alternativas e nas correções.'],
    ['#driveBtnHome', 'Seu progresso em qualquer aparelho', 'O progresso fica neste navegador. Para usá-lo no celular e no computador, sincronize com o seu Google Drive.'],
];
let _guiaPasso = -1;
function _fecharGuia() {
    document.getElementById('guiaFundo')?.remove();
    document.querySelectorAll('.guia-alvo').forEach(x => x.classList.remove('guia-alvo'));
    _guiaPasso = -1;
    try { localStorage.setItem(GUIA_KEY, '1'); } catch {}
}
function _mostrarPasso(i) {
    document.querySelectorAll('.guia-alvo').forEach(x => x.classList.remove('guia-alvo'));
    const passos = PASSOS_GUIA.filter(([sel]) => { const el = document.querySelector(sel); return el && el.offsetParent; });
    if (i >= passos.length) return _fecharGuia();
    _guiaPasso = i;
    const [sel, titulo, texto] = passos[i], alvo = document.querySelector(sel);
    alvo.classList.add('guia-alvo');
    alvo.scrollIntoView({ block: 'center' });
    let fundo = document.getElementById('guiaFundo');
    if (!fundo) {
        fundo = document.createElement('div');
        fundo.id = 'guiaFundo'; fundo.className = 'guia-fundo';
        fundo.innerHTML = '<div class="guia-balao" role="dialog" aria-modal="true" aria-labelledby="guiaTit"></div>';
        document.body.appendChild(fundo);
        fundo.addEventListener('click', e => {
            const b = e.target.closest('button[data-guia]');
            if (!b) return;
            if (b.dataset.guia === 'pular') _fecharGuia();
            else _mostrarPasso(_guiaPasso + (b.dataset.guia === 'voltar' ? -1 : 1));
        });
    }
    const balao = fundo.querySelector('.guia-balao');
    balao.innerHTML = `<div class="guia-contagem">${i + 1} de ${passos.length}</div><h3 id="guiaTit">${escapeHtml(titulo)}</h3><p>${escapeHtml(texto)}</p>`
        + '<div class="guia-botoes"><button type="button" class="aparencia-btn" data-guia="pular">Pular</button>'
        + (i ? '<button type="button" class="aparencia-btn" data-guia="voltar">Voltar</button>' : '')
        + `<button type="button" class="auth-btn home-btn-start" data-guia="proximo">${i === passos.length - 1 ? 'Começar' : 'Próximo'}</button></div>`;
    requestAnimationFrame(() => {                             /* abaixo do botão, ou acima se não couber */
        const r = alvo.getBoundingClientRect(), h = balao.offsetHeight, w = balao.offsetWidth;
        const top = r.bottom + 12 + h < innerHeight ? r.bottom + 12 : Math.max(8, r.top - h - 12);
        balao.style.top = top + 'px';
        balao.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
        balao.querySelector('[data-guia="proximo"]').focus();
    });
}
function iniciarGuia() { if (!authScreen.classList.contains('hidden')) _mostrarPasso(0); }
document.getElementById('ajudaBtn').addEventListener('click', iniciarGuia);
document.addEventListener('keydown', e => { if (_guiaPasso >= 0 && e.key === 'Escape') _fecharGuia(); });
/* primeira visita: mostra o guia quando a tela inicial aparecer */
const _showHomeGuia = showHome;
showHome = function () {
    _showHomeGuia();
    let visto = true;
    try { visto = localStorage.getItem(GUIA_KEY) === '1'; } catch {}
    if (!visto && _guiaPasso < 0) setTimeout(() => { if (!authScreen.classList.contains('hidden') && _guiaPasso < 0) iniciarGuia(); }, 600);
};
