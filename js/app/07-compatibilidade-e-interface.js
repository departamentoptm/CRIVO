/* ============================================================
   COMPATIBILIDADE ENTRE VERSÕES DO SITE
   ============================================================ */
const _nfc = t => String(t).normalize('NFC');

function arquivoNoManifest(prova, ano, num) {
    const l = questoesDoManifest(prova, ano);
    const q = l && l.find(x => x.num === String(num));
    return q ? q.filename : null;
}
function chaveCanonica(obj, nome) {
    const ks = Object.keys(obj || {});
    if (ks.includes(nome)) return nome;
    const n = _nfc(nome);
    let c = ks.filter(k => _nfc(k) === n);
    if (c.length !== 1) c = ks.filter(k => _nfc(k).toLowerCase() === n.toLowerCase());
    return c.length === 1 ? c[0] : nome;
}

function carimbarArquivos(p = progress) {
    if (!p || !Object.keys(exams || {}).length) return;
    (p.registro || []).forEach(ev => { if (!ev.arquivo) { const f = arquivoNoManifest(ev.prova, ev.ano, ev.questao); if (f) ev.arquivo = f; } });
    (p.grifados || []).forEach(g => { if (!g.arquivo) { const f = arquivoNoManifest(g.prova, g.ano, g.questao); if (f) g.arquivo = f; } });
    for (const pr of Object.keys(p.resetados || {})) for (const an of Object.keys(p.resetados[pr] || {})) for (const nm of Object.keys(p.resetados[pr][an] || {})) {
        const r = p.resetados[pr][an][nm];
        if (r && !r.arquivo) { const f = arquivoNoManifest(pr, an, nm); if (f) r.arquivo = f; }
    }
    const u = p.ultimaPosicao;
    if (u && !u.arquivo) { const f = arquivoNoManifest(u.exam, u.year, u.num); if (f) u.arquivo = f; }
}

function reconciliar(p) {
    if (!p || !Object.keys(exams || {}).length) return 0;
    const resolver = (prova, ano, num, arquivo) => {
        const pv = chaveCanonica(exams, prova);
        const an = chaveCanonica(exams[pv], ano);
        let nm = String(num);
        const lista = questoesDoManifest(pv, an);
        if (lista && arquivo) {
            const naPos = lista.find(x => x.num === nm);
            if (!naPos || naPos.filename !== arquivo) {
                const novo = lista.find(x => x.filename === arquivo);
                if (novo) nm = novo.num;
            }
        }
        return [pv, an, nm];
    };
    let mudancas = 0;
    (p.registro || []).forEach(ev => {
        const [pv, an, nm] = resolver(ev.prova, ev.ano, ev.questao, ev.arquivo);
        if (pv !== ev.prova || an !== ev.ano || nm !== String(ev.questao)) { ev.prova = pv; ev.ano = an; ev.questao = nm; mudancas++; }
    });
    (p.grifados || []).forEach(g => {
        const [pv, an, nm] = resolver(g.prova, g.ano, g.questao, g.arquivo);
        if (pv !== g.prova || an !== g.ano || nm !== String(g.questao)) { g.prova = pv; g.ano = an; g.questao = nm; mudancas++; }
    });
    const u = p.ultimaPosicao;
    if (u) {
        const [pv, an, nm] = resolver(u.exam, u.year, u.num, u.arquivo);
        if (pv !== u.exam || an !== u.year || nm !== String(u.num)) { u.exam = pv; u.year = an; u.num = nm; mudancas++; }
    }
    if (p.resetados && typeof p.resetados === 'object') {
        const novo = {};
        for (const prova of Object.keys(p.resetados)) for (const ano of Object.keys(p.resetados[prova] || {})) for (const num of Object.keys(p.resetados[prova][ano] || {})) {
            const r = p.resetados[prova][ano][num];
            const [pv, an, nm] = resolver(prova, ano, num, r && r.arquivo);
            ((novo[pv] ||= {})[an] ||= {})[nm] = r;
            if (pv !== prova || an !== ano || nm !== String(num)) mudancas++;
        }
        p.resetados = novo;
    }
    if (mudancas && p.registro && p.registro.length) {
        p.estado = {};
        p.registro.forEach(ev => aplicarEvento(p.estado, ev));
    }
    return mudancas;
}

function migrarProgresso(d) {
    const x = Object.assign({}, d);
    if (!Array.isArray(x.registro)) x.registro = [];
    if (!Array.isArray(x.grifados)) x.grifados = [];
    if (!x.resetados || typeof x.resetados !== 'object') x.resetados = {};
    if (!Array.isArray(x.avaliacoes)) x.avaliacoes = [];
    return x;
}

const _normalizarOrig = normalizar;
normalizar = function (d) {
    const dm = migrarProgresso(d);
    const p = _normalizarOrig(dm);
    p.resetados = dm.resetados || {};
    reconciliar(p); carimbarArquivos(p);
    return p;
};
const _lerBackupOrig = lerBackup;
lerBackup = function (ra) {
    const v = _lerBackupOrig(ra);
    if (v) {
        if (!v.resetados) v.resetados = {};
        reconciliar(v); carimbarArquivos(v);
    }
    return v;
};
const _salvarBackupOrig = salvarBackup;
salvarBackup = function () {
    try { carimbarArquivos(progress); } catch (e) { console.warn('carimbo:', e); }
    _salvarBackupOrig();
};
const _loadManifestOrig = loadManifest;
loadManifest = async function () {
    const ok = await _loadManifestOrig();
    if (ok && currentRA) { reconciliar(progress); carimbarArquivos(progress); }
    return ok;
};

const _aplicarEventoOrig = aplicarEvento;
aplicarEvento = function (estado, ev) {
    if (ev.acao === 'restaurou') {
        const q = ((estado[ev.prova] ||= {})[ev.ano] ||= {});
        q[ev.questao] = { selected: ev.opcao, correct: ev.correta, timestamp: ev.data };
    } else {
        _aplicarEventoOrig(estado, ev);
    }
};

const _getSavedStateOrig = getSavedState;
getSavedState = function (exam, year, num) {
    if (isResetada(exam, year, num)) return null;
    if (abrirLimpo && abrirLimpo.exam === exam && abrirLimpo.year === year && abrirLimpo.num === String(num)) return null;
    return _getSavedStateOrig(exam, year, num);
};

const _showScreenOrig = showScreen;
showScreen = function (sc) { _showScreenOrig(sc); try { updateFabBarButtons(); } catch {} };

questionFrame.addEventListener('load', () => {
    abrirLimpo = null;
    const doc = docDaQuestao();
    const q = questoes[questaoAtualIndex];
    if (!doc || !q || !currentExam) return;
    const exam = currentExam, year = currentYear, num = q.num;
    setTimeout(() => {
        if (docDaQuestao() !== doc) return;
        const saved = getSavedState(exam, year, num);
        if (!saved || !saved.correct) return;
        let oficial = null;
        try { oficial = questionFrame.contentWindow.eval("typeof correctAnswer !== 'undefined' ? correctAnswer : null"); } catch {}
        if (oficial && /^[A-E]$/.test(oficial) && oficial !== saved.correct) {
            const original = [...progress.registro].reverse().find(e => e.prova === exam && e.ano === year && String(e.questao) === String(num) && e.acao === 'confirmou');
            saveProgressForQuestion(exam, year, num, { selected: saved.selected, correct: oficial, tempoMs: original?.tempoMs });
            avisoGrifo('O gabarito oficial desta questão foi atualizado no site; o seu progresso foi ajustado.');
        }
    }, 700);
    setTimeout(() => {
        if (docDaQuestao() !== doc) return;
        const faltam = grifosDaQuestaoAtual().filter(g => !doc.querySelector(`.crivo-highlight[data-grifo-id="${g.id}"]`)).length;
        if (faltam) avisoGrifo(`${faltam} grifo(s) não puderam ser posicionados: o texto desta questão foi alterado no site. Eles continuam salvos no seu progresso.`);
    }, 1800);
});

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
window.addEventListener('DOMContentLoaded', async () => {
    showLoginForm();
    showScreen(authScreen);
    try { await loadManifest(); } catch {}
    populateExamSelector();
});
window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; return ''; }
    pausarTimer();
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
});

/* ============================================================
   MODOS DO TEMPO E VISIBILIDADE DAS BARRAS
   ============================================================ */
const tempoContainer = document.querySelector('.timer-container');
const tempoModoBtn = document.getElementById('tempoModoBtn');
const tempoMenu = document.getElementById('tempoMenu');
const toggleFiltrosBtn = document.getElementById('toggleFiltrosBtn');
const toggleTopBtn = document.getElementById('toggleTopBtn');
const toggleBottomBtn = document.getElementById('toggleBottomBtn');
const UI_KEY = 'crivo_ui';
const ROTULO_TEMPO = { todas: 'Tempo máx. total:', questao: 'Tempo máx.:', off: 'Tempo: desativado' };
let uiPrefs = { modoTempo: 'questao', filtros: false, topo: false, rodape: false, maxTodas: 60 };
try {
    const v = JSON.parse(localStorage.getItem(UI_KEY));
    if (v && typeof v === 'object') {
        if (ROTULO_TEMPO[v.modoTempo]) uiPrefs.modoTempo = v.modoTempo;
        uiPrefs.filtros = !!v.filtros; uiPrefs.topo = !!v.topo; uiPrefs.rodape = !!v.rodape;
        if (parseInt(v.maxTodas) > 0) uiPrefs.maxTodas = parseInt(v.maxTodas);
    }
} catch {}
function salvarUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(uiPrefs)); } catch {} }

function aplicarUi() {
    document.body.classList.toggle('filtros-ocultos', uiPrefs.filtros);
    document.body.classList.toggle('topo-oculto', uiPrefs.topo);
    document.body.classList.toggle('rodape-oculto', uiPrefs.rodape);
    toggleFiltrosBtn.setAttribute('aria-pressed', String(uiPrefs.filtros));
    toggleFiltrosBtn.title = uiPrefs.filtros ? 'Mostrar banca, edição e disciplina' : 'Ocultar banca, edição e disciplina';
    toggleTopBtn.textContent = uiPrefs.topo ? '▾' : '▴';
    { const t = uiPrefs.topo ? 'Mostrar barra superior' : 'Ocultar barra superior'; toggleTopBtn.title = t; toggleTopBtn.setAttribute('aria-label', t); }
    toggleBottomBtn.textContent = uiPrefs.rodape ? '▴' : '▾';
    { const t = uiPrefs.rodape ? 'Mostrar barra inferior' : 'Ocultar barra inferior'; toggleBottomBtn.title = t; toggleBottomBtn.setAttribute('aria-label', t); }
    bancaMultiPanel.hidden = true; anoMultiPanel.hidden = true; tempoMenu.hidden = true;
    tempoModoBtn.setAttribute('aria-expanded', 'false');
}
toggleFiltrosBtn.addEventListener('click', () => { uiPrefs.filtros = !uiPrefs.filtros; salvarUi(); aplicarUi(); });
toggleTopBtn.addEventListener('click', () => { uiPrefs.topo = !uiPrefs.topo; salvarUi(); aplicarUi(); });
toggleBottomBtn.addEventListener('click', () => { uiPrefs.rodape = !uiPrefs.rodape; salvarUi(); aplicarUi(); });

function aplicarModoTempo(m, semTimer) {
    if (!ROTULO_TEMPO[m]) m = 'questao';
    modoTempo = m; uiPrefs.modoTempo = m; salvarUi();
    tempoContainer.dataset.modo = m;
    tempoModoBtn.textContent = ROTULO_TEMPO[m];
    tempoMenu.querySelectorAll('button[data-modo]').forEach(b => {
        const on = b.dataset.modo === m;
        b.classList.toggle('sel', on);
        b.setAttribute('aria-checked', String(on));
    });
    if (semTimer) return;
    pausarTimer();
    pausedElapsedMs = 0; limiteTotalAvisado = false;
    timerDisplay.textContent = '00:00';
    if (m !== 'off' && questoes.length && !resolvingScreen.classList.contains('hidden')) reiniciarTimer();
}
function fecharTempoMenu() { tempoMenu.hidden = true; tempoModoBtn.setAttribute('aria-expanded', 'false'); }
tempoModoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const abrir = tempoMenu.hidden;
    bancaMultiPanel.hidden = true; anoMultiPanel.hidden = true;
    tempoMenu.hidden = !abrir;
    tempoModoBtn.setAttribute('aria-expanded', String(abrir));
});
tempoMenu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-modo]');
    if (!b) return;
    e.stopPropagation();
    fecharTempoMenu();
    aplicarModoTempo(b.dataset.modo);
});
document.addEventListener('click', (e) => { if (!e.target.closest('.timer-container')) fecharTempoMenu(); });
window.addEventListener('blur', fecharTempoMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharTempoMenu(); });

/* No modo "Todas as questões" o relógio retoma ao voltar do gabarito */
backFromProgressBtn.addEventListener('click', () => {
    if (progressFrom === 'resolving' && currentYear && modoTempo === 'todas' && !isTimerRunning && questoes.length) {
        if (timerInterval) clearInterval(timerInterval);
        isTimerRunning = true; startTime = Date.now();
        timerInterval = setInterval(() => { const el = pausedElapsedMs + (Date.now() - startTime); timerDisplay.textContent = formatTime(el); checarLimiteTotal(el); }, 500);
    }
});
/* Ao sair, zera o tempo acumulado */
logoutBtn.addEventListener('click', () => { pausedElapsedMs = 0; limiteTotalAvisado = false; timerDisplay.textContent = '00:00'; });

aplicarUi();
aplicarModoTempo(uiPrefs.modoTempo, true);

/* ============================================================
   TEMPO MÁXIMO TOTAL (modo "Todas as questões")
   ============================================================ */
const maxTimeTodasInput = document.getElementById('maxTimeTodasInput');
maxTimeTodasInput.value = uiPrefs.maxTodas;
function checarLimiteTotal(el) {
    if (modoTempo !== 'todas' || limiteTotalAvisado || !(uiPrefs.maxTodas > 0)) return;
    if (el >= uiPrefs.maxTodas * 60000) {
        limiteTotalAvisado = true;
        setTimeout(() => alert('Tempo máximo total atingido (' + uiPrefs.maxTodas + ' min).'), 0);
    }
}
maxTimeTodasInput.addEventListener('change', () => {
    const v = parseInt(maxTimeTodasInput.value);
    if (!isNaN(v) && v > 0) { uiPrefs.maxTodas = v; limiteTotalAvisado = false; salvarUi(); }
    else maxTimeTodasInput.value = uiPrefs.maxTodas;
});

/* ============================================================
   NAVEGAÇÃO PELO TECLADO (← e →)
   ============================================================ */
function navTecla(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat) return;
    if (resolvingScreen.classList.contains('hidden')) return;
    if (document.getElementById('historicoModalOverlay')) return;
    const a = e.target;
    if (a && (a.isContentEditable || /^(TEXTAREA|SELECT)$/.test(a.tagName))) return;
    if (a && a.tagName === 'INPUT' && !/^(radio|checkbox|button|submit)$/.test(a.type)) return;
    const btn = e.key === 'ArrowLeft' ? prevBtn : nextBtn;
    e.preventDefault();
    if (!btn.disabled) btn.click();
}
document.addEventListener('keydown', navTecla);
questionFrame.addEventListener('load', () => {
    const d = docDaQuestao();
    if (d && !d.__crivoKeyNav) { d.__crivoKeyNav = true; d.addEventListener('keydown', navTecla); }
});

/* ============================================================
   OCULTAR "RESPOSTA CORRETA" DO ITEM 2.10 (HISTÓRICO DO TEMA)
   Ativado por padrão; botão discreto ao lado do título da seção.
   ============================================================ */
if (typeof uiPrefs.ocultarResp === 'undefined') uiPrefs.ocultarResp = true;
try {
    const _v = JSON.parse(localStorage.getItem(UI_KEY));
    if (_v && _v.ocultarResp === false) uiPrefs.ocultarResp = false;
} catch {}

const _ocNorm = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const _OC_ICON_OFF = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9 9 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const _OC_ICON_ON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';

/* cor de fundo efetiva (linha/tabela) de uma célula */
function ocultRespFundo(el) {
    const win = el.ownerDocument.defaultView;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const c = win.getComputedStyle(n).backgroundColor;
        const m = c && c.match(/rgba?\(([^)]+)\)/);
        if (m) {
            const parts = m[1].split(',').map(x => parseFloat(x));
            const a = parts.length > 3 ? parts[3] : 1;
            if (a > 0) return c;
        }
    }
    return '#fff';
}

/* localiza a seção 2.10 e as células da coluna "Resposta correta" */
function ocultRespLocalizar(doc) {
    const achados = [];
    doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
        if (_ocNorm(h.textContent).indexOf('historico do tema nas provas anteriores') < 0) return;
        let n = h.nextElementSibling, tabela = null;
        while (n && !/^H[1-6]$/.test(n.tagName)) {
            tabela = n.matches('table') ? n : n.querySelector('table');
            if (tabela) break;
            n = n.nextElementSibling;
        }
        if (!tabela) return;
        const linhaCab = tabela.querySelector('thead tr') || tabela.querySelector('tr');
        if (!linhaCab) return;
        const idx = [...linhaCab.children].findIndex(c => {
            const t = _ocNorm(c.textContent);
            return t.indexOf('resposta correta') >= 0 || t.indexOf('respostas corretas') >= 0;
        });
        if (idx < 0) return;
        const celulas = [];
        [...tabela.rows].forEach(tr => {
            if (tr === linhaCab) return;
            const td = tr.cells[idx];
            if (td && td.tagName === 'TD') celulas.push(td);
        });
        achados.push({ titulo: h, celulas });
    });
    return achados;
}

function ocultRespAplicar(doc, ativo) {
    doc.querySelectorAll('.crivo-ans').forEach(td => {
        if (ativo) {
            td.style.setProperty('--crivo-ans-bg', ocultRespFundo(td));
            td.classList.add('crivo-ans-oculta');
        } else {
            td.classList.remove('crivo-ans-oculta');
        }
    });
}

function ocultRespCriarBotao(doc, titulo) {
    const win = doc.defaultView;
    const host = doc.createElement('div');
    host.className = 'crivo-ans-host';
    host.style.cssText = 'position:absolute;left:0;top:0;width:22px;height:22px;z-index:50;';
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML =
        '<style>' +
        '.w{position:relative;width:22px;height:22px;opacity:0;pointer-events:none;transition:opacity .2s}' +
        '.w.vis{opacity:.8;pointer-events:auto}.w.vis:hover{opacity:1}' +
        '.b{box-sizing:border-box;width:22px;height:22px;padding:0;border-radius:50%;border:1px solid #c9d1ea;' +
        'background:rgba(255,255,255,.92);color:#6a7396;display:grid;place-items:center;cursor:pointer;' +
        'transition:background .15s,color .15s,border-color .15s}' +
        '.b.on{background:#eef1fa;color:#1a2a6c;border-color:#aab6dc}' +
        '.b:hover{border-color:#8f9cca}.b:focus-visible{outline:2px solid #2b3f9a;outline-offset:2px}' +
        '.tip{position:absolute;top:28px;left:0;width:max-content;max-width:min(240px,70vw);background:#1a2a6c;color:#fff;' +
        'font:12px/1.35 "Segoe UI",Tahoma,sans-serif;padding:.45rem .6rem;border-radius:.5rem;' +
        'box-shadow:0 6px 18px rgba(0,0,0,.25)}.tip b{display:block;margin-bottom:.1rem}' +
        '</style>' +
        '<div class="w"><button type="button" class="b" aria-label="Alternar ocultação das respostas corretas" aria-pressed="true"></button>' +
        '<div class="tip" hidden></div></div>';
    host.style.display = 'none';          /* fora do layout até o título aparecer */
    doc.body.appendChild(host);
    const w = sh.querySelector('.w'), btn = sh.querySelector('.b'), tip = sh.querySelector('.tip');
    let tTip = null;

    function atualizar() {
        const on = !!uiPrefs.ocultarResp;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', String(on));
        btn.innerHTML = on ? _OC_ICON_OFF : _OC_ICON_ON;
    }
    function esconderTip() { tip.hidden = true; clearTimeout(tTip); }
    function mostrarTip() {
        const on = !!uiPrefs.ocultarResp;
        tip.innerHTML = '<b>Esconder respostas corretas</b>' +
            (on ? 'Ativado: a coluna "Resposta correta" desta tabela está oculta.'
                : 'Desativado: a coluna "Resposta correta" desta tabela está visível.');
        tip.style.left = '0'; tip.style.right = 'auto';
        tip.hidden = false;
        const r = tip.getBoundingClientRect();
        if (r.right > win.innerWidth - 4) { tip.style.left = 'auto'; tip.style.right = '0'; }
        clearTimeout(tTip);
        tTip = setTimeout(esconderTip, 4000);
    }
    function posicionar() {
        if (!w.classList.contains('vis')) return;
        const rg = doc.createRange();
        rg.selectNodeContents(titulo);
        const rects = rg.getClientRects();
        const ult = rects.length ? rects[rects.length - 1] : titulo.getBoundingClientRect();
        host.style.left = '0px'; host.style.top = '0px';
        const o = host.getBoundingClientRect();
        let x = ult.right + 8, y = ult.top + (ult.height - 22) / 2;
        if (x + 22 > win.innerWidth - 4) { x = ult.left; y = ult.bottom + 2; }
        host.style.left = (x - o.left) + 'px';
        host.style.top = (y - o.top) + 'px';
    }
    function definirVisivel(v) {
        if (v) host.style.display = '';
        w.classList.toggle('vis', v);
        if (v) posicionar();
        else { esconderTip(); host.style.display = 'none'; }   /* não estende a rolagem da página */
    }

    btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        uiPrefs.ocultarResp = !uiPrefs.ocultarResp;
        salvarUi();
        ocultRespAplicar(doc, uiPrefs.ocultarResp);
        (doc.__crivoOcultAtualizar || []).forEach(fn => fn());
        mostrarTip();
    });
    doc.addEventListener('click', (e) => { if (e.target !== host) esconderTip(); }, true);

    (doc.__crivoOcultAtualizar = doc.__crivoOcultAtualizar || []).push(atualizar);
    atualizar();

    let raf = 0;
    const reposicionar = () => { cancelAnimationFrame(raf); raf = win.requestAnimationFrame(posicionar); };
    win.addEventListener('scroll', reposicionar, { passive: true });
    win.addEventListener('resize', reposicionar);

    if ('IntersectionObserver' in win) {
        const io = new win.IntersectionObserver((entradas) => {
            entradas.forEach(en => definirVisivel(en.isIntersecting));
        }, { threshold: [0, 0.6, 1] });
        io.observe(titulo);
    } else {
        definirVisivel(true);
    }
}

function ocultRespIniciar() {
    const doc = docDaQuestao();
    if (!doc || !doc.body || doc.__crivoOcultResp) return;
    const secoes = ocultRespLocalizar(doc);
    if (!secoes.length) return;
    doc.__crivoOcultResp = true;
    if (!doc.getElementById('crivoOcultRespCss')) {
        const st = doc.createElement('style');
        st.id = 'crivoOcultRespCss';
        st.textContent = '.crivo-ans-oculta,.crivo-ans-oculta *{color:var(--crivo-ans-bg,#fff)!important;' +
            'text-shadow:none!important;-webkit-user-select:none;user-select:none}';
        (doc.head || doc.documentElement).appendChild(st);
    }
    secoes.forEach(sec => sec.celulas.forEach(td => td.classList.add('crivo-ans')));
    ocultRespAplicar(doc, uiPrefs.ocultarResp);
    secoes.forEach(sec => ocultRespCriarBotao(doc, sec.titulo));
}
questionFrame.addEventListener('load', () => {
    try { ocultRespIniciar(); } catch (e) { console.warn('ocultResp', e); }
    setTimeout(() => { try { ocultRespIniciar(); } catch {} }, 800);
});

/* ============================================================
   TEXTO DA CORREÇÃO: justificado + TABELAS SEM PALAVRAS CORTADAS
   Verifica sempre (carregamento, redimensionamento, rotação e
   quando a correção é aberta) e reduz a fonte da tabela até que
   nenhuma palavra seja cortada ao meio ou escape da célula.
   ============================================================ */
const CRIVO_TBL_FONTE_MIN = 8;
const CRIVO_TXT_CSS =
    'html body{overflow-wrap:break-word;word-break:normal}' +
    'html body table,html body th,html body td{overflow-wrap:normal;word-break:normal;-webkit-hyphens:manual;hyphens:manual}' +
    'html body .explanation,html body #correctionContent{text-align:justify;text-justify:inter-word;-webkit-hyphens:manual;hyphens:manual}' +
    'html body .explanation h1,html body .explanation h2,html body .explanation h3,html body .explanation h4,' +
    'html body .explanation h5,html body .explanation h6,html body .explanation th,html body .explanation td{text-align:left}' +
    'html body table.crivo-tbl-scroll{display:block;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}' +
    '@media (max-width:600px){' +
    'html body{padding:6px}' +
    'html body .container{width:100%;padding:10px}' +
    'html body .result-container{padding:10px 6px}' +
    'html body .explanation{padding:8px}' +
    'html body .explanation table{width:calc(100% + 28px)!important;max-width:none!important;margin-left:-14px!important;margin-right:-14px!important}' +
    'html body table th,html body table td{padding:6px 3px!important}}';

function tblLarguraDisponivel(win, t) {
    const pai = t.parentElement;
    if (!pai) return 0;
    const cs = win.getComputedStyle(pai);
    const ct = win.getComputedStyle(t);
    return pai.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
        - (parseFloat(ct.marginLeft) || 0) - (parseFloat(ct.marginRight) || 0);
}

/* há alguma palavra quebrada ao meio? (quebras em hífen/barra são naturais e ignoradas) */
function tblPalavraCortada(doc, t) {
    const rg = doc.createRange();
    for (const c of t.querySelectorAll('th,td')) {
        const tw = doc.createTreeWalker(c, 4 /* SHOW_TEXT */);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
            const re = /\S+/g; let m;
            while ((m = re.exec(n.nodeValue))) {
                if (/[-\/–—]/.test(m[0])) continue;
                rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
                if (rg.getClientRects().length > 1) return true;
            }
        }
    }
    return false;
}

function tblAjustar(win, doc, t) {
    t.classList.remove('crivo-tbl-scroll');
    t.style.removeProperty('font-size');
    let fs = parseFloat(win.getComputedStyle(t).fontSize) || 14;
    const problema = () => {
        if (t.getBoundingClientRect().width > tblLarguraDisponivel(win, t) + 1) return true;
        for (const c of t.querySelectorAll('th,td')) if (c.scrollWidth > c.clientWidth + 1) return true;
        return tblPalavraCortada(doc, t);
    };
    while (problema() && fs > CRIVO_TBL_FONTE_MIN) {
        fs = Math.max(CRIVO_TBL_FONTE_MIN, fs - 0.5);
        t.style.setProperty('font-size', fs + 'px', 'important');
    }
    /* mesmo na fonte mínima não coube: rolagem horizontal, sem cortar palavras */
    if (problema()) t.classList.add('crivo-tbl-scroll');
}

function textoCorrecaoIniciar() {
    const doc = docDaQuestao();
    if (!doc || !doc.body || doc.__crivoTxtOk) return;
    doc.__crivoTxtOk = true;
    const win = doc.defaultView;
    if (!doc.getElementById('crivoTxtCss')) {
        const st = doc.createElement('style');
        st.id = 'crivoTxtCss';
        st.textContent = CRIVO_TXT_CSS;
        (doc.head || doc.documentElement).appendChild(st);
    }
    const tabelas = [...doc.querySelectorAll('table')];
    if (!tabelas.length) return;
    const rodar = (forcar) => tabelas.forEach(t => {
        if (!t.offsetParent) return;                 /* oculta: verifica quando aparecer */
        const w = tblLarguraDisponivel(win, t);
        if (!forcar && t.__crivoW === w) return;
        t.__crivoW = w;
        try { tblAjustar(win, doc, t); } catch (e) { console.warn('tblAjustar', e); }
    });
    let tm = null;
    const agendar = (forcar, ms) => { clearTimeout(tm); tm = setTimeout(() => rodar(forcar), ms); };
    win.addEventListener('resize', () => agendar(true, 150));
    win.addEventListener('orientationchange', () => agendar(true, 300));
    doc.addEventListener('click', () => agendar(false, 80));
    if ('ResizeObserver' in win) {
        const ro = new win.ResizeObserver(() => agendar(false, 30));
        tabelas.forEach(t => ro.observe(t));
        ro.observe(doc.body);
    }
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => agendar(true, 0));
    rodar(true);
    setTimeout(() => rodar(false), 500);
}
questionFrame.addEventListener('load', () => {
    try { textoCorrecaoIniciar(); } catch (e) { console.warn('textoCorrecao', e); }
});
