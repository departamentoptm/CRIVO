/* ============================================================
   TEMPO DE ESTUDO E PAUSA POR INATIVIDADE
   - Relógio de estudo: conta só enquanto a aba está visível e há tempo correndo (resolução de questões,
     simulado ou sessão de cartões). É a base do tempo de cada questão e do tempo médio do plano de estudo.
   - Tempo de uma questão = até confirmar a resposta + lendo a correção até sair dela (ir para outra
     questão ou outra tela); no máximo 20 minutos por questão. O tempo de leitura fica em progress.leituras
     (chave = data da confirmação), somado entre aparelhos na sincronização.
   - Inatividade: 20 minutos sem mexer o mouse, digitar, rolar ou tocar na tela -> o tempo para (o período
     parado não conta), o cronômetro da questão e o relógio do simulado param, a tela embaça e aparece
     "Amigo, você ainda está estudando?". O botão "Continuar estudando" retoma tudo.
   ============================================================ */
const LIMITE_INATIVIDADE_MS = 20 * 60000, MAX_TEMPO_QUESTAO_MS = 20 * 60000;
let _relogioMs = 0, _relogioTick = Date.now(), _ultimaAtividade = Date.now(), _relogioNaAtividade = 0;
let _inativo = false, _timerEstavaRodando = false;
let _inicioQuestaoAtivo = null, _leituraAberta = null, _questaoConfirmada = false;

function _haTempoCorrendo() {
    if (!currentRA) return false;
    if (!resolvingScreen.classList.contains('hidden')) return true;
    return typeof cartEmSessao !== 'undefined' && cartEmSessao && !cartoesScreen.classList.contains('hidden');
}
function _tickRelogio() {
    const agora = Date.now(), dt = Math.min(Math.max(0, agora - _relogioTick), 2000);
    _relogioTick = agora;
    if (!_inativo && document.visibilityState === 'visible' && _haTempoCorrendo()) _relogioMs += dt;
}
function relogioAtivo() { _tickRelogio(); return _relogioMs; }

function _marcarAtividade() {
    if (_inativo) return;                       /* parado: só o botão "Continuar estudando" retoma */
    _tickRelogio();
    _ultimaAtividade = Date.now(); _relogioNaAtividade = _relogioMs;
}
const EVENTOS_ATIVIDADE = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];
function _ouvirAtividade(alvo) {
    if (!alvo || alvo.__crivoAtividade) return;
    alvo.__crivoAtividade = true;
    EVENTOS_ATIVIDADE.forEach(ev => alvo.addEventListener(ev, _marcarAtividade, { capture: true, passive: true }));
}
_ouvirAtividade(window);
questionFrame.addEventListener('load', () => { try { _ouvirAtividade(questionFrame.contentWindow); } catch {} });
document.addEventListener('visibilitychange', () => { _tickRelogio(); if (document.visibilityState === 'visible') _marcarAtividade(); });

/* ---- pausa ---- */
function _sobreposicaoInatividade() {
    let el = document.getElementById('inatividade');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'inatividade'; el.className = 'inatividade'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'inatividadeTxt');
    el.innerHTML = '<div class="inatividade-caixa"><p id="inatividadeTxt">Amigo, você ainda está estudando?</p>'
        + '<p class="inatividade-nota">O tempo parou de contar enquanto você esteve fora.</p>'
        + '<button type="button" class="auth-btn home-btn-start" id="inatividadeBtn">Continuar estudando</button></div>';
    document.body.appendChild(el);
    el.querySelector('#inatividadeBtn').addEventListener('click', retomarEstudo);
    return el;
}
function pausarPorInatividade() {
    if (_inativo) return;
    _tickRelogio();
    _relogioMs = Math.min(_relogioMs, _relogioNaAtividade);   /* os 20 minutos parados não contam */
    _inativo = true;
    _timerEstavaRodando = !!isTimerRunning;
    if (_timerEstavaRodando) pausarTimer();
    if (typeof pausarSimulado === 'function') pausarSimulado(_ultimaAtividade);
    const el = _sobreposicaoInatividade();
    el.hidden = false; document.body.classList.add('inativo');
    setTimeout(() => { try { el.querySelector('#inatividadeBtn').focus(); } catch {} }, 30);
}
function retomarEstudo() {
    if (!_inativo) return;
    _inativo = false;
    _relogioTick = Date.now(); _ultimaAtividade = Date.now(); _relogioNaAtividade = _relogioMs;
    if (typeof retomarSimulado === 'function') retomarSimulado();
    if (_timerEstavaRodando) retomarTimer();
    _timerEstavaRodando = false;
    const el = document.getElementById('inatividade');
    if (el) el.hidden = true;
    document.body.classList.remove('inativo');
}
/* retoma o cronômetro da questão de onde parou (mesma lógica de reiniciarTimer, sem zerar) */
function retomarTimer() {
    if (modoTempo === 'off' || isTimerRunning) return;
    if (timerInterval) clearInterval(timerInterval);
    isTimerRunning = true; startTime = Date.now();
    timerInterval = setInterval(() => { const el = pausedElapsedMs + (Date.now() - startTime); timerDisplay.textContent = formatTime(el); checarLimiteTotal(el); }, 500);
    if (modoTempo === 'questao' && !modoSimulado && !_questaoConfirmada) {
        const resta = Math.max(1000, maxTime * 60000 - pausedElapsedMs);
        expirationTimer = setTimeout(() => {
            if (questaoAtualIndex < questoes.length - 1) { alert('Tempo máximo atingido. Pulando para a próxima.'); carregarQuestao(questaoAtualIndex + 1); }
            else alert('Tempo máximo atingido. Esta é a última questão.');
        }, resta);
    }
}
/* simulado pausado quando a página foi fechada: retoma (o período fechado não contou) */
try { if (typeof modoSimulado !== 'undefined' && modoSimulado && modoSimulado.pausadoEm) retomarSimulado(); } catch {}
setInterval(() => {
    _tickRelogio();
    if (!_inativo && _haTempoCorrendo() && Date.now() - _ultimaAtividade >= LIMITE_INATIVIDADE_MS) pausarPorInatividade();
}, 1000);

/* ---- tempo de cada questão: até confirmar + lendo a correção ---- */
function tempoAteConfirmar() {
    if (_inicioQuestaoAtivo == null) return undefined;
    return Math.min(MAX_TEMPO_QUESTAO_MS, Math.max(0, relogioAtivo() - _inicioQuestaoAtivo));
}
function fecharLeitura() {
    const l = _leituraAberta;
    _leituraAberta = null;
    if (!l || !currentRA) return;
    const ms = Math.round(Math.min(Math.max(0, relogioAtivo() - l.inicio), Math.max(0, MAX_TEMPO_QUESTAO_MS - (l.ate || 0))));
    if (ms < 1000) return;
    if (!progress.leituras || typeof progress.leituras !== 'object') progress.leituras = {};
    progress.leituras[l.chave] = ms;
    setDirty(true); salvarBackup();
}
const _carregarQuestaoTempo = carregarQuestao;
carregarQuestao = async function (index) {
    fecharLeitura();
    _questaoConfirmada = false;
    const r = await _carregarQuestaoTempo(index);
    _inicioQuestaoAtivo = relogioAtivo();
    return r;
};
const _showScreenTempo = showScreen;
showScreen = function (tela) {
    if (tela !== resolvingScreen) fecharLeitura();
    return _showScreenTempo(tela);
};
window.addEventListener('pagehide', fecharLeitura);
/* depois que 04-resolucao-e-navegacao.js gravou a confirmação, abre a contagem da leitura da correção */
window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'QUESTION_ANSWERED' || modoSimulado || event.source !== questionFrame.contentWindow) return;
    const q = questoes[questaoAtualIndex];
    if (!q) return;
    const ev = [...(progress.registro || [])].reverse().find(e => e.acao === 'confirmou' && e.prova === currentExam && e.ano === currentYear && e.questao === String(q.num));
    if (!ev) return;
    fecharLeitura();
    _leituraAberta = { chave: ev.data, inicio: relogioAtivo(), ate: ev.tempoMs || 0 };
    /* confirmou: o limite por questão não pula mais para a próxima enquanto o aluno lê a correção */
    _questaoConfirmada = true;
    if (expirationTimer) { clearTimeout(expirationTimer); expirationTimer = null; }
});

/* tempo médio por questão (minutos): mediana das últimas 300 respostas, contando refeitas; até confirmar +
   leitura da correção. Com menos de 20 respostas medidas, 3 minutos. */
function minutosPorQuestaoMedidos() {
    const lt = progress.leituras || {};
    const t = (progress.registro || []).filter(e => e.acao === 'confirmou' && e.tempoMs > 3000)
        .slice(-300).map(e => Math.min(MAX_TEMPO_QUESTAO_MS, e.tempoMs + (+lt[e.data] || 0))).sort((a, b) => a - b);
    if (t.length < 20) return { min: 3, medido: false, n: t.length };
    return { min: Math.max(0.5, Math.round(t[Math.floor(t.length / 2)] / 6000) / 10), medido: true, n: t.length };
}
