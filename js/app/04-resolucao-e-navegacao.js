/* ============================================================
   OVERRIDE startExam
   ============================================================ */
async function startExam() {
    if (!Object.keys(exams).length) {
        if (!(await loadManifest())) return;
    }
    await loadDisciplinas();
    garantirFiltros();

    const last = getLastPos();
    await rebuildQuestoes(false);

    if (questoes.length === 0) {
        showEmptyMessage();
    } else if (last) {
        const idx = questoes.findIndex(q =>
            q.exam === last.exam && q.year === last.year && String(q.num) === String(last.num));
        await carregarQuestao(idx >= 0 ? idx : 0);
    } else {
        await carregarQuestao(0);
    }
    renderAllFilterUI();
    showScreen(resolvingScreen);
}

/* ============================================================
   PONTE PARA O IFRAME
   ============================================================ */
const BRIDGE_SCRIPT = `<script>
(function(){
  var ce = document.getElementById('correctionContent');
  if (ce) ce.style.display = 'none';
  if (window.parent === window) return;
  var legacy = !window.__bridgeNative;
  if (!legacy) return;
  var _sel = window.selectOption, _chk = window.checkAnswer, restoring = false;
  function send(t, p){ try { window.parent.postMessage({ type: t, payload: p }, '*'); } catch(e){} }
  window.selectOption = function(o){
    _sel(o);
    var i = document.querySelector('.option input[value="' + o + '"]');
    if (i) i.checked = true;
    if (!restoring) send('OPTION_SELECTED', { selected: o });
  };
  window.checkAnswer = function(){
    if (!selectedOption) { if (!restoring) alert('Por favor, selecione uma opção antes de confirmar.'); return; }
    _chk();
    if (!restoring) send('QUESTION_ANSWERED', { selected: selectedOption, correct: correctAnswer });
  };
  window.addEventListener('message', function(ev){
    if (ev.source !== window.parent || !ev.data || ev.data.type !== 'RESTORE_STATE') return;
    var p = ev.data.payload || {};
    if (!p.selected) return;
    restoring = true;
    try { window.selectOption(p.selected); if (p.correct) window.checkAnswer(); } finally { restoring = false; }
  });
})();
<\/script>`;

async function carregarQuestao(index) {
    if (index < 0 || index >= questoes.length) return false;
    pausarTimer();
    questaoAtualIndex = index;
    questaoStartTime = Date.now();
    const q = questoes[index];
    if (q.exam) currentExam = q.exam;
    if (q.year) currentYear = q.year;
    try {
        let html;
        if (q.url.startsWith('json:')) {
            const [b, a, n] = q.url.slice(5).split('/').map(decodeURIComponent);
            html = await CrivoRender.paginaDaQuestao(b, a, n);
        } else {
            const res = await fetch(q.url, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status} em ${q.url}`);
            html = await res.text();
        }
        const nativa = html.includes('RESTORE_STATE');
        const bridge = nativa
            ? BRIDGE_SCRIPT.replace('window.__bridgeNative', 'true')
            : BRIDGE_SCRIPT.replace('!window.__bridgeNative', 'true');
        const pos = html.lastIndexOf('</body>');
        html = pos >= 0 ? html.slice(0, pos) + bridge + html.slice(pos) : html + bridge;
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = url;
        questionFrame.src = url;
        prevBtn.disabled = index === 0;
        nextBtn.disabled = index === questoes.length - 1;
        setLastPos(currentExam, currentYear, q.num);
        reiniciarTimer();
        updatePositionIndicator();
        updateFabBarButtons();
        return true;
    } catch (e) {
        console.error(e);
        alert(`Erro ao carregar a questão ${q.num}:\n${e.message}`);
        return false;
    }
}

/* ============================================================
   TIMER
   ============================================================ */
function formatTime(ms) {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
function reiniciarTimer() {
    if (timerInterval) clearInterval(timerInterval);
    if (expirationTimer) clearTimeout(expirationTimer);
    timerInterval = null; expirationTimer = null;
    if (modoTempo === 'off') { pausedElapsedMs = 0; isTimerRunning = false; return; }
    if (modoTempo !== 'todas') pausedElapsedMs = 0;
    isTimerRunning = true; startTime = Date.now();
    timerDisplay.textContent = formatTime(pausedElapsedMs);
    timerInterval = setInterval(() => {
        const el = pausedElapsedMs + (Date.now() - startTime);
        timerDisplay.textContent = formatTime(el);
        checarLimiteTotal(el);
    }, 500);
    if (modoTempo === 'questao' && !modoSimulado) expirationTimer = setTimeout(() => {
        if (questaoAtualIndex < questoes.length - 1) {
            alert('Tempo máximo atingido. Pulando para a próxima.');
            carregarQuestao(questaoAtualIndex + 1);
        } else {
            alert('Tempo máximo atingido. Esta é a última questão.');
        }
    }, maxTime * 60 * 1000);
}
function pausarTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (expirationTimer) { clearTimeout(expirationTimer); expirationTimer = null; }
    if (isTimerRunning && startTime) {
        pausedElapsedMs += Date.now() - startTime;
        isTimerRunning = false;
    }
}

/* ============================================================
   MENSAGENS DO IFRAME
   ============================================================ */
window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || !data.type) return;
    const q = questoes[questaoAtualIndex];
    if (!q || !currentExam || !currentYear) return;
    if (modoSimulado) return;                 /* no simulado, a escolha fica no simulado (14-simulado.js) */
    if (data.type === 'OPTION_SELECTED') {
        saveProgressForQuestion(currentExam, currentYear, q.num, { selected: data.payload.selected });
    } else if (data.type === 'QUESTION_ANSWERED') {
        const tempoMs = typeof tempoAteConfirmar === 'function' ? tempoAteConfirmar()
            : (questaoStartTime ? (Date.now() - questaoStartTime) : undefined);
        saveProgressForQuestion(currentExam, currentYear, q.num, {
            selected: data.payload.selected,
            correct: data.payload.correct,
            tempoMs
        });
        // Timer continua rodando (não pausa ao confirmar, conforme requisito)
        if (progress.resetados?.[currentExam]?.[currentYear]?.[q.num]) {
            delete progress.resetados[currentExam][currentYear][q.num];
            salvarBackup();
        }
        updateFabBarButtons();
    }
});

questionFrame.addEventListener('load', () => {
    if (!currentExam || !currentYear || !questoes.length) return;
    const q = questoes[questaoAtualIndex];
    if (!q) return;
    const saved = getSavedState(currentExam, currentYear, q.num);
    if (saved) {
        try {
            questionFrame.contentWindow.postMessage({
                type: 'RESTORE_STATE',
                payload: { selected: saved.selected, correct: saved.correct }
            }, '*');
        } catch (e) { console.warn(e); }
    }
    aplicarGrifosDaQuestaoAtual();
    attachIframeListeners();
});

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
function navegarParaQuestao() {
    const n = parseInt(goToInput.value);
    if (isNaN(n) || n < 1) { alert('Número de questão inválido.'); return; }
    const idx = questoes.findIndex(q => parseInt(q.num) === n);
    if (idx === -1) { alert(`Questão ${n} não encontrada no escopo atual.`); return; }
    carregarQuestao(idx);
}
goBtn.addEventListener('click', navegarParaQuestao);
goToInput.addEventListener('keypress', e => { if (e.key === 'Enter') navegarParaQuestao(); });
prevBtn.addEventListener('click', () => { if (questaoAtualIndex > 0) carregarQuestao(questaoAtualIndex - 1); });
nextBtn.addEventListener('click', () => { if (questaoAtualIndex < questoes.length - 1) carregarQuestao(questaoAtualIndex + 1); });
maxTimeInput.addEventListener('change', () => {
    const v = parseInt(maxTimeInput.value);
    if (!isNaN(v) && v > 0) { maxTime = v; uiPrefs.maxQuestao = v; salvarUi(); if (questaoAtualIndex < questoes.length) reiniciarTimer(); }
    else maxTimeInput.value = maxTime;
});
homeBtn.addEventListener('click', () => {
    pausarTimer();
    showHome();
    showScreen(authScreen);
});
progressBtnResolving.addEventListener('click', async () => {
    progressFrom = 'resolving';
    pausarTimer();
    await garantirDadosGabarito();
    renderProgressV2();
    showScreen(progressScreen);
});

/* ============================================================
   FAB-BAR: Histórico (refazer fica nos botões da própria questão)
   ============================================================ */
function updateFabBarButtons() {
    const q = questoes[questaoAtualIndex];
    if (!q || !currentExam || !currentYear || resolvingScreen.classList.contains('hidden')) {
        historicoBtn.hidden = true;
        return;
    }
    historicoBtn.hidden = respostasAnteriores(currentExam, currentYear, q.num).length === 0;
}


historicoBtn.addEventListener('click', () => {
    const q = questoes[questaoAtualIndex];
    if (!q) return;
    openHistoricoModal(currentExam, currentYear, q.num);
});

/* Modal de histórico: apenas visualização (sem restaurar) */
function openHistoricoModal(banca, ano, num) {
    const events = respostasAnteriores(banca, ano, num);
    if (!events.length) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'historicoModalOverlay';
    overlay.innerHTML = `
        <div class="modal">
            <h3>📜 Histórico — ${escapeHtml(banca)} ${escapeHtml(ano)} Q${escapeHtml(num)}</h3>
            <div id="historicoList"></div>
            <button class="back-btn" style="margin-top:1rem;background:#6c757d;color:white;width:100%;" id="closeHistoricoBtn">Fechar</button>
        </div>`;
    document.body.appendChild(overlay);
    const list = overlay.querySelector('#historicoList');
    events.forEach(ev => {
        const item = document.createElement('div');
        item.className = 'modal-item';
        const dataStr = fmtDataHora(ev.data);
        const label = ev.acao === 'confirmou' ? 'Confirmou' : 'Restaurou';
        const corretaTxt = ev.correta ? ` (correta: ${escapeHtml(ev.correta)})` : '';
        const conf = ev.tempoMs != null ? +ev.tempoMs : null, leit = (progress.leituras || {})[ev.data];
        const fmt = ms => ms == null ? '—' : fmtTempo(ms);
        const tempoTxt = ev.acao === 'confirmou'
            ? `<span class="hist-tempos">⏱ até confirmar: <b>${fmt(conf)}</b> · na correção: <b>${fmt(leit != null ? +leit : null)}</b>`
              + ` · total: <b>${conf == null && leit == null ? '—' : fmtTempo((conf || 0) + (+leit || 0))}</b></span>` : '';
        item.innerHTML = `<span style="font-size:.9rem;">${label} <b>${escapeHtml(ev.opcao || '?')}</b>${corretaTxt} em ${dataStr}</span>${tempoTxt}`;
        list.appendChild(item);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeHistoricoModal(); });
    overlay.querySelector('#closeHistoricoBtn').addEventListener('click', closeHistoricoModal);
}
function fmtDataHora(iso) {
    const d = new Date(iso), p = n => String(n).padStart(2, '0');
    return isNaN(d) ? String(iso || '') : `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function sincronizarQuestaoAtual(banca, ano, num) {
    const q = questoes[questaoAtualIndex];
    if (!q || (q.exam || currentExam) !== banca || (q.year || currentYear) !== ano || String(q.num) !== String(num)) return;
    if (resolvingScreen.classList.contains('hidden')) iframeDesatualizado = true;
    else await carregarQuestao(questaoAtualIndex);
}
function closeHistoricoModal() {
    const m = document.getElementById('historicoModalOverlay');
    if (m) m.remove();
}

/* subtítulo da página da questão: banca - edição - disciplina */
window.crivoSubtitulo = (banca, ano, num) => [banca, ano, disciplinaDe(banca, ano, num)].filter(Boolean).join(' - ');
