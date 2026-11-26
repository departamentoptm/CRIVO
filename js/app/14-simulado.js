/* ============================================================
   SIMULADO
   - O aluno monta o simulado: quantidade, bancas, disciplinas, só questões não feitas e o tempo total.
   - Durante o simulado: a correção e o gabarito ficam escondidos, não há pausa (o relógio corre mesmo fora
     da página) e as escolhas ficam só no simulado (não vão para o progresso antes do fim).
   - Ao finalizar (ou quando o tempo acaba): as respostas entram no progresso como respostas confirmadas, e
     por isso também na revisão espaçada; a tela de resultado mostra acerto geral e por disciplina, e cada
     questão tem Difícil/Bom/Fácil para a revisão.
   - Histórico: os simulados terminados ficam no progresso (arquivo e Google Drive).
   O simulado em andamento fica só neste navegador (localStorage, chave crivo_simulado_atual).
   ============================================================ */
const SIM_KEY = 'crivo_simulado_atual';
const simuladoScreen = document.getElementById('simuladoScreen');
const simBarra = document.getElementById('simBarra');
let simInicioQuestao = null, simChaveAtual = null, simResultadoAberto = null;

function _lerSimulado() {
    try { const s = JSON.parse(localStorage.getItem(SIM_KEY)); return s && s.id && Array.isArray(s.chaves) ? s : null; } catch { return null; }
}
function _gravarSimulado() {
    try { if (modoSimulado) localStorage.setItem(SIM_KEY, JSON.stringify(modoSimulado)); else localStorage.removeItem(SIM_KEY); } catch {}
}
const _fmtRestante = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const _chaveDaAtual = () => { const q = questoes[questaoAtualIndex]; return q ? `${q.exam}|${q.year}|${q.num}` : null; };

/* ---------- tempo por questão (somado enquanto ela está aberta) ---------- */
function _acumularTempo(ate) {
    if (!modoSimulado || !simChaveAtual || !simInicioQuestao) return;
    const fim = ate || Date.now();
    modoSimulado.tempos[simChaveAtual] = (modoSimulado.tempos[simChaveAtual] || 0) + Math.max(0, fim - simInicioQuestao);
    simInicioQuestao = Date.now();
}
/* pausa por inatividade (15-tempo-e-inatividade.js): o relógio da prova para; o tempo da questão conta só
   até a última atividade */
const _agoraSim = () => (modoSimulado && modoSimulado.pausadoEm) ? modoSimulado.pausadoEm : Date.now();
function pausarSimulado(ultimaAtividade) {
    if (!modoSimulado || modoSimulado.pausadoEm) return;
    _acumularTempo(Math.max(simInicioQuestao || 0, ultimaAtividade || Date.now()));
    simInicioQuestao = null;
    modoSimulado.pausadoEm = Date.now();
    _gravarSimulado();
}
function retomarSimulado() {
    if (!modoSimulado || !modoSimulado.pausadoEm) return;
    modoSimulado.fimPrevisto += Date.now() - modoSimulado.pausadoEm;
    delete modoSimulado.pausadoEm;
    simInicioQuestao = Date.now();
    _gravarSimulado(); atualizarBarraSimulado();
}
const _carregarQuestaoSim = carregarQuestao;
carregarQuestao = async function (index) {
    _acumularTempo();
    const r = await _carregarQuestaoSim(index);
    if (modoSimulado) { simChaveAtual = _chaveDaAtual(); simInicioQuestao = Date.now(); }
    return r;
};
/* no simulado, a página da questão não mostra o que já foi respondido antes (nem a correção) */
const _getSavedStateSim = getSavedState;
getSavedState = function (exam, year, num) { return modoSimulado ? null : _getSavedStateSim(exam, year, num); };

const CSS_SIMULADO = '#submitBtn,#viewCorrectionBtn,.btn-container,#resultContainer,.result-container,.crivo-revisao,.reset-btn{display:none!important}';
questionFrame.addEventListener('load', () => {
    if (!modoSimulado) return;
    const d = docDaQuestao();
    if (!d || !d.documentElement) return;
    const st = d.createElement('style'); st.id = 'crivoSimulado'; st.textContent = CSS_SIMULADO;
    (d.head || d.documentElement).appendChild(st);
    const k = _chaveDaAtual(), sel = k && modoSimulado.respostas[k];
    if (sel) setTimeout(() => { try { questionFrame.contentWindow.postMessage({ type: 'RESTORE_STATE', payload: { selected: sel } }, '*'); } catch {} }, 60);
});
window.addEventListener('message', (event) => {
    const data = event.data;
    if (!modoSimulado || !data || data.type !== 'OPTION_SELECTED' || event.source !== questionFrame.contentWindow) return;
    const k = _chaveDaAtual();
    if (!k || !modoSimulado.chaves.includes(k)) return;
    modoSimulado.respostas[k] = data.payload.selected;
    _gravarSimulado(); atualizarBarraSimulado();
});

/* ---------- barra do simulado na tela de resolução ---------- */
function atualizarBarraSimulado() {
    document.body.classList.toggle('modo-simulado', !!modoSimulado);
    simBarra.hidden = !modoSimulado;
    if (!modoSimulado) return;
    const n = modoSimulado.chaves.length, r = Object.keys(modoSimulado.respostas).filter(k => modoSimulado.chaves.includes(k)).length;
    document.getElementById('simRespondidas').textContent = `${r}/${n} respondidas`;
    document.getElementById('simTempo').textContent = _fmtRestante(modoSimulado.fimPrevisto - _agoraSim());
}
setInterval(() => {
    if (!modoSimulado || !currentRA) return;
    atualizarBarraSimulado();
    if (!modoSimulado.pausadoEm && Date.now() >= modoSimulado.fimPrevisto) finalizarSimulado('tempo');
    if (!authScreen.classList.contains('hidden')) atualizarBotaoSimuladoHome();
}, 1000);
document.getElementById('simFinalizarBtn').addEventListener('click', () => {
    const n = modoSimulado.chaves.length, r = Object.keys(modoSimulado.respostas).length;
    if (confirm(`Finalizar o simulado agora? ${r} de ${n} questões respondidas${r < n ? '; as em branco contam como erro' : ''}.`)) finalizarSimulado('aluno');
});

/* ---------- montar e começar ---------- */
function _poolSimulado(cfg) {
    return _questoesDoAcervo().filter(q => (!cfg.bancas.length || cfg.bancas.includes(q.b))
        && (!cfg.disciplinas.length || cfg.disciplinas.includes(disciplinaDe(q.b, q.a, q.n)))
        && (!cfg.soNovas || !isRealizada(q.b, q.a, q.n)));
}
function _lerConfigSimulado() {
    const marcados = sel => [...document.querySelectorAll(sel + ' input:checked')].map(i => i.value);
    return { qtd: Math.max(1, Math.min(300, parseInt(document.getElementById('simQtd').value) || 0)),
             minutos: Math.max(1, Math.min(600, parseInt(document.getElementById('simMin').value) || 0)),
             bancas: marcados('#simBancas'), disciplinas: marcados('#simDiscs'), soNovas: document.getElementById('simSoNovas').checked };
}
function atualizarContagemPool() {
    const cfg = _lerConfigSimulado();
    const n = _poolSimulado(cfg).length;
    document.getElementById('simPool').textContent = `${n} ${n === 1 ? 'questão disponível' : 'questões disponíveis'} com esses filtros.`;
}
async function iniciarSimulado() {
    const cfg = _lerConfigSimulado(), msg = document.getElementById('simMsg');
    if (!document.getElementById('simMin').value) { msg.textContent = 'Defina o tempo total do simulado, em minutos.'; return; }
    if (!cfg.bancas.length) { msg.textContent = 'Escolha pelo menos uma banca.'; return; }
    const pool = _poolSimulado(cfg);
    if (!pool.length) { msg.textContent = 'Nenhuma questão com esses filtros.'; return; }
    const escolhidas = embaralharComSemente(pool, (Date.now() % 2147483647) || 1).slice(0, cfg.qtd);
    const agora = Date.now();
    modoSimulado = { id: 's' + agora.toString(36), inicio: new Date(agora).toISOString(), fimPrevisto: agora + cfg.minutos * 60000,
                     duracaoMin: cfg.minutos, config: cfg, chaves: escolhidas.map(q => `${q.b}|${q.a}|${q.n}`), respostas: {}, tempos: {} };
    _gravarSimulado();
    await entrarNoSimulado(0);
}
async function entrarNoSimulado(indice) {
    garantirFiltros();
    guardarFiltrosAnteriores();
    filtros.lista = modoSimulado.chaves.slice(); filtros.listaNome = 'Simulado';
    filtros.revisao = false; filtros.revisaoDia = null;
    salvarFiltros();
    await loadDisciplinas();
    await rebuildQuestoes(false);
    renderAllFilterUI();
    atualizarBarraSimulado();
    pausarTimer();
    if (questoes.length) await carregarQuestao(Math.min(indice || 0, questoes.length - 1)); else showEmptyMessage();
    showScreen(resolvingScreen);
}
async function continuarSimulado() {
    const k = modoSimulado.ultima;
    const i = k ? Math.max(0, modoSimulado.chaves.indexOf(k)) : 0;
    await entrarNoSimulado(i);
}
/* "Iniciar resolução" com simulado em andamento volta para o simulado */
const _startExamSim = startExam;
startExam = async function () { if (modoSimulado) return continuarSimulado(); return _startExamSim(); };
const _showScreenSim = showScreen;
showScreen = function (sc) {
    if (modoSimulado && sc !== resolvingScreen && !resolvingScreen.classList.contains('hidden')) {
        _acumularTempo(); modoSimulado.ultima = _chaveDaAtual(); _gravarSimulado();
    }
    _showScreenSim(sc);
};

/* ---------- finalizar ---------- */
async function _gabaritos(chaves) {
    const out = {}, edicoes = new Map();
    for (const k of chaves) { const [b, a] = k.split('|'); edicoes.set(`${b}|${a}`, [b, a]); }
    for (const [b, a] of edicoes.values()) {
        try {
            const ed = await CrivoRender.carregarEdicao(b, a);
            for (const q of ed.questoes) out[`${b}|${a}|${q.numero}`] = typeof q.gabarito === 'string' ? q.gabarito.trim().toUpperCase() : null;
        } catch (e) { console.warn('gabarito do simulado:', e); }
    }
    return out;
}
let _finalizando = false;
async function finalizarSimulado(motivo) {
    if (!modoSimulado || _finalizando) return;
    _finalizando = true;
    try {
        _acumularTempo();
        const s = modoSimulado, gab = await _gabaritos(s.chaves);
        const fim = Math.min(Date.now(), s.fimPrevisto);
        const itens = s.chaves.map(k => ({ k, sel: s.respostas[k] || null, gab: /^[A-E]$/.test(gab[k] || '') ? gab[k] : null, tempoMs: Math.round(s.tempos[k] || 0) }));
        modoSimulado = null;                                    /* daqui em diante, salvar vai para o progresso */
        for (const it of itens) {
            if (!it.sel || !it.gab) continue;
            const [b, a, n] = it.k.split('|');
            saveProgressForQuestion(b, a, n, { selected: it.sel, correct: it.gab, tempoMs: it.tempoMs || undefined });
            if (progress.resetados?.[b]?.[a]?.[n]) delete progress.resetados[b][a][n];
        }
        const resultado = { id: s.id, inicio: s.inicio, fim: new Date(fim).toISOString(), duracaoMin: s.duracaoMin,
                            usadoMs: fim - +new Date(s.inicio), motivo, config: s.config, itens };
        if (!Array.isArray(progress.simulados)) progress.simulados = [];
        progress.simulados.push(resultado);
        setDirty(true); salvarBackup();
        _gravarSimulado();
        restaurarFiltrosAnteriores();
        atualizarBarraSimulado();
        pausarTimer();
        if (motivo === 'tempo') alert('O tempo do simulado acabou. Veja o seu resultado.');
        await abrirTelaSimulado(resultado.id);
    } finally { _finalizando = false; }
}

/* ---------- tela do simulado: montar, em andamento, resultado e histórico ---------- */
function atualizarBotaoSimuladoHome() {
    const b = document.getElementById('simuladoBtnHome');
    if (b) b.textContent = modoSimulado ? `📝 Simulado em andamento — ${_fmtRestante(modoSimulado.fimPrevisto - Date.now())}` : '📝 Simulado';
}
const _showHomeSim = showHome;
showHome = function () { _showHomeSim(); try { atualizarBotaoSimuladoHome(); } catch {} };

function _acertoDe(r) {
    const validos = r.itens.filter(i => i.gab);
    return { n: validos.length, certas: validos.filter(i => i.sel === i.gab).length, branco: validos.filter(i => !i.sel).length };
}
function renderConfigSimulado() {
    const el = document.getElementById('simConfig');
    if (modoSimulado) {
        const n = modoSimulado.chaves.length, r = Object.keys(modoSimulado.respostas).length;
        el.innerHTML = `<section class="desemp-bloco"><h2>⏳ Simulado em andamento</h2><p>${r}/${n} respondidas · tempo restante <b>${_fmtRestante(modoSimulado.fimPrevisto - Date.now())}</b>. O relógio não para.</p>`
            + '<div class="plano-botoes"><button type="button" class="auth-btn home-btn-start" id="simContinuarBtn">▶ Continuar o simulado</button>'
            + '<button type="button" class="aparencia-btn" id="simFinalizarAgoraBtn">Finalizar agora</button></div></section>';
        return;
    }
    const bancas = Object.keys(exams || {}).sort();
    const discs = DISCIPLINAS_LISTA.slice().sort((a, b) => a.localeCompare(b));
    el.innerHTML = '<section class="desemp-bloco"><h2>📝 Montar simulado</h2><div class="plano-form">'
        + '<label>Quantidade de questões <input type="number" id="simQtd" min="1" max="300" value="20"></label>'
        + '<label>Tempo total (minutos) <input type="number" id="simMin" min="1" max="600" placeholder="ex.: 60"></label>'
        + '<label class="sim-check"><input type="checkbox" id="simSoNovas" checked> Só questões que ainda não fiz</label>'
        + `<fieldset class="sim-grupo" id="simBancas"><legend>Bancas</legend>${bancas.map(b => `<label><input type="checkbox" value="${escapeHtml(b)}" checked> ${escapeHtml(b)}</label>`).join('')}</fieldset>`
        + `<fieldset class="sim-grupo sim-discs" id="simDiscs"><legend>Disciplinas <small>(nenhuma marcada = todas)</small></legend>${discs.map(d => `<label><input type="checkbox" value="${escapeHtml(d)}"> ${escapeHtml(d)}</label>`).join('')}</fieldset>`
        + '<p class="desemp-nota" id="simPool"></p>'
        + '<div class="plano-botoes centro"><button type="button" class="auth-btn home-btn-start" id="simIniciarBtn">▶ Iniciar simulado</button></div>'
        + '<p class="desemp-nota" id="simMsg"></p>'
        + '<p class="desemp-nota">Durante o simulado, a correção fica escondida e o relógio não para. No fim, as respostas entram no seu progresso e na revisão espaçada.</p>'
        + '</div></section>';
    atualizarContagemPool();
}
function renderResultadoSimulado(id) {
    const el = document.getElementById('simResultado');
    const r = (progress.simulados || []).find(x => x.id === id);
    simResultadoAberto = r ? id : null;
    el.hidden = !r;
    if (!r) { el.innerHTML = ''; return; }
    const ac = _acertoDe(r);
    const porDisc = new Map();
    r.itens.filter(i => i.gab).forEach(i => {
        const [b, a, n] = i.k.split('|'), d = disciplinaDe(b, a, n) || 'Sem disciplina';
        if (!porDisc.has(d)) porDisc.set(d, { n: 0, certas: 0 });
        const x = porDisc.get(d); x.n++; if (i.sel === i.gab) x.certas++;
    });
    const avaliadas = new Map();
    (progress.avaliacoes || []).forEach(v => { if (v.data >= r.fim) avaliadas.set(`${v.prova}|${v.ano}|${v.questao}`, +v.nota); });
    el.innerHTML = `<section class="desemp-bloco"><h2 class="sim-res-titulo">📊 Resultado — ${new Date(r.inicio).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
        + '<button type="button" class="sim-fechar" id="simFecharResultadoBtn" title="Fechar este resultado" aria-label="Fechar este resultado">✕</button></h2>'
        + `<div class="desemp-resumo"><div><b>${ac.certas}/${ac.n}</b><span>acertos</span></div><div><b>${_pct(ac.certas, ac.n)}%</b><span>de acerto</span></div>`
        + `<div><b>${_fmtRestante(r.usadoMs).replace(/^0:/, '')}</b><span>de ${r.duracaoMin} min${r.motivo === 'tempo' ? ' (tempo esgotado)' : ''}</span></div></div>`
        + (ac.branco ? `<p class="desemp-nota">${_plural(ac.branco, 'questão ficou', 'questões ficaram')} em branco e ${ac.branco === 1 ? 'conta' : 'contam'} como erro.</p>` : '')
        + '<div class="desemp-lista">' + [...porDisc.entries()].sort((a, b) => b[1].n - a[1].n).map(([d, x]) =>
            `<div class="desemp-linha"><span class="desemp-nome">${escapeHtml(d)}</span><span class="desemp-num">${x.certas}/${x.n} · ${_pct(x.certas, x.n)}%</span>${_barra(x.certas, x.n)}<span></span></div>`).join('') + '</div></section>'
        + '<section class="desemp-bloco"><h2>📋 Questões</h2><p class="desemp-nota">Classifique cada questão para a revisão espaçada (como na página da questão). Toque em "Abrir" para ver a correção.</p>'
        + '<div class="sim-itens">' + r.itens.map((i, idx) => {
            const [b, a, n] = i.k.split('|'), d = disciplinaDe(b, a, n);
            const st = !i.gab ? 'anulada' : !i.sel ? 'branco' : i.sel === i.gab ? 'certa' : 'errada';
            const rotulo = { anulada: 'anulada', branco: `em branco · gabarito ${i.gab}`, certa: `✔ ${i.sel}`, errada: `✘ ${i.sel} · gabarito ${i.gab}` }[st];
            const nota = avaliadas.get(i.k);
            return `<div class="sim-item sim-${st}"><span class="desemp-nome">${idx + 1}. ${escapeHtml(b)} ${escapeHtml(a)} - Q${escapeHtml(n)}${d ? ' <small>' + escapeHtml(d) + '</small>' : ''}</span>`
                + `<span class="sim-res">${rotulo}</span>`
                + (i.sel && i.gab ? `<span class="sim-notas">${[[2, 'Difícil'], [3, 'Bom'], [4, 'Fácil']].map(([g, t]) => `<button type="button" data-k="${escapeHtml(i.k)}" data-nota="${g}" class="${nota === g ? 'ativo' : ''}">${t}</button>`).join('')}</span>` : '<span></span>')
                + `<button type="button" class="aparencia-btn sim-abrir" data-k="${escapeHtml(i.k)}">Abrir</button></div>`;
        }).join('') + '</div></section>';
}
function renderHistoricoSimulados() {
    const el = document.getElementById('simHistorico');
    const lista = (progress.simulados || []).slice().reverse();
    el.innerHTML = '<section class="desemp-bloco"><h2>🗂️ Simulados anteriores</h2>' + (lista.length
        ? '<div class="desemp-lista">' + lista.map(r => {
            const ac = _acertoDe(r);
            return `<div class="revisao-item sim-hist" role="button" tabindex="0" data-id="${escapeHtml(r.id)}"><span>${new Date(r.inicio).toLocaleDateString('pt-BR')} · ${_plural(r.itens.length, 'questão', 'questões')} · ${r.duracaoMin} min</span>`
                + `<span class="cartao-selo ${_pct(ac.certas, ac.n) >= 60 ? 'nota-3' : 'nota-1'}">${_pct(ac.certas, ac.n)}%</span></div>`;
        }).join('') + '</div>'
        : '<p class="desemp-nota">Nenhum simulado terminado ainda.</p>') + '</section>';
}
async function abrirTelaSimulado(idResultado) {
    await garantirDadosGabarito();
    try { await carregarAnulacoes(); } catch {}
    try { await loadDisciplinas(); } catch {}
    renderConfigSimulado();
    renderResultadoSimulado(idResultado || null);
    renderHistoricoSimulados();
    showScreen(simuladoScreen);
    if (idResultado) document.getElementById('simResultado').scrollIntoView({ block: 'start' });
}
document.getElementById('simuladoBtnHome').addEventListener('click', () => abrirTelaSimulado());
document.getElementById('backFromSimuladoBtn').addEventListener('click', () => { showHome(); showScreen(authScreen); });
simuladoScreen.addEventListener('change', e => { if (e.target.closest('#simConfig') && !modoSimulado) atualizarContagemPool(); });
simuladoScreen.addEventListener('click', async e => {
    const id = e.target.id;
    if (id === 'simIniciarBtn') return iniciarSimulado();
    if (id === 'simContinuarBtn') return continuarSimulado();
    if (id === 'simFecharResultadoBtn') { renderResultadoSimulado(null); return; }
    if (id === 'simFinalizarAgoraBtn') { if (confirm('Finalizar o simulado agora? As questões em branco contam como erro.')) return finalizarSimulado('aluno'); return; }
    const nota = e.target.closest('.sim-notas button');
    if (nota) {
        const [b, a, n] = nota.dataset.k.split('|');
        progress.avaliacoes.push({ data: new Date().toISOString(), prova: b, ano: a, questao: n, nota: +nota.dataset.nota });
        setDirty(true); salvarBackup();
        nota.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('ativo', x === nota));
        return;
    }
    const abrir = e.target.closest('.sim-abrir');
    if (abrir) { const [b, a, n] = abrir.dataset.k.split('|'); return abrirQuestaoDoGabarito(b, a, n); }
    const hist = e.target.closest('.sim-hist');
    if (hist) { renderResultadoSimulado(hist.dataset.id); document.getElementById('simResultado').scrollIntoView({ block: 'start' }); }
});
simuladoScreen.addEventListener('keydown', e => {
    const hist = e.target.closest && e.target.closest('.sim-hist');
    if (hist && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); renderResultadoSimulado(hist.dataset.id); }
});

/* simulado que estava em andamento ao fechar a página: continua (e termina sozinho se o tempo acabou) */
modoSimulado = _lerSimulado();
atualizarBarraSimulado();
