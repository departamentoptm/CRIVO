/* ============================================================
   AUTENTICAÇÃO / TELAS
   ============================================================ */
function showLoginForm() {
    loginArea.style.display = 'none';
    homeArea.style.display = 'none';
    loginMsg.textContent = '';
    raInput.value = '';
}
function showHome() {
    loginArea.style.display = 'none';
    homeArea.style.display = 'block';
    welcomeName.textContent = currentUser;
    homeMsg.textContent = '';
}
loginBtn.addEventListener('click', async () => {
    loginBtn.disabled = true;
    await loginWithRA(raInput.value);
    loginBtn.disabled = false;
});
raInput.addEventListener('keypress', e => { if (e.key === 'Enter') loginBtn.click(); });
startBtnHome.addEventListener('click', () => { try { restaurarFiltrosAnteriores(); } catch {} startExam(); });

logoutBtn.addEventListener('click', () => {
    if (dirty && confirm('Você tem alterações não salvas. Deseja salvar o progresso em arquivo antes de sair?')) exportarProgresso();
    pausarTimer();
    currentUser = null; currentRA = null; currentExam = null; currentYear = null; questoes = [];
    progress = { estado: {}, registro: [], ultimaPosicao: null, grifados: [], resetados: {}, avaliacoes: [], cartoes: {}, grifosApagados: {} };
    setDirty(false);
    showLoginForm();
    showScreen(authScreen);
});

/* ============================================================
   DISCIPLINAS
   ============================================================ */
async function carregarTemasPadrao() {
    if (temasPadrao) return;
    try {
        const r = await fetch('dados/temas_padrao.json', { cache: 'no-cache' });
        if (r.ok) { const t = await r.json(); if (t && t.questoes) temasPadrao = t; }
    } catch (e) { console.warn('temas_padrao.json não carregado:', e); }
}
async function loadDisciplinas() {
    if (disciplinasLoaded) return;
    try {
        const res = await fetch('exams/disciplinas.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        disciplinas = await res.json();
        disciplinasLoaded = true;
        await carregarTemasPadrao();
    } catch (e) {
        console.warn('disciplinas.json não carregado:', e);
        if (!disciplinasFailed) {
            disciplinasFailed = true;
            alert('Arquivo de disciplinas não encontrado. Os filtros de disciplina ficarão desativados.');
        }
    }
}

/* ============================================================
   MANIFEST / PROVAS
   ============================================================ */
/* Edições publicadas no formato novo (dados/<BANCA>/<ANO>.json) têm prioridade sobre os HTMLs antigos.
   No objeto "exams", cada questão dessas aparece com o nome de arquivo "json". */
const ARQUIVO_JSON = 'json';
function urlQuestao(banca, ano, arquivo, num) {
    return arquivo === ARQUIVO_JSON
        ? `json:${encodeURIComponent(banca)}/${encodeURIComponent(ano)}/${encodeURIComponent(num)}`
        : `exams/${banca}/${ano}/${arquivo}`;
}
async function loadManifest() {
    let antigo = null, novo = null;
    try {
        const res = await fetch('exams/manifest.json', { cache: 'no-store' });
        if (res.ok) antigo = await res.json();
    } catch (e) { console.warn('exams/manifest.json não carregado:', e); }
    try {
        if (window.CrivoRender) novo = await CrivoRender.carregarIndice();
    } catch (e) { console.warn('dados/indice.json não carregado:', e); }
    try {
        if (!antigo && !novo) throw new Error('nenhum índice de provas encontrado');
        exams = antigo || {};
        if (novo && novo.bancas) {
            for (const [banca, anos] of Object.entries(novo.bancas)) {
                for (const [ano, info] of Object.entries(anos)) {
                    const mapa = {};
                    for (const n of info.questoes || []) mapa[String(n)] = ARQUIVO_JSON;
                    (exams[banca] ||= {})[ano] = mapa;
                }
            }
        }
        return true;
    } catch (e) {
        console.error('Manifest:', e);
        alert('Não foi possível carregar a lista de provas (dados/indice.json ou exams/manifest.json).\n\n' +
              'Verifique se o arquivo existe na raiz do deploy e se o formato está correto.');
        return false;
    }
}
function populateExamSelector() {
    if (!examSelector) return;
    examSelector.innerHTML = '';
    const names = Object.keys(exams).sort();
    if (!names.length) { examSelector.innerHTML = '<option value="">(sem provas)</option>'; return; }
    names.forEach(n => {
        const o = document.createElement('option');
        o.value = n; o.textContent = n;
        examSelector.appendChild(o);
    });
}
function populateYearSelector(examName) {
    if (!yearSelector) return;
    yearSelector.innerHTML = '';
    const years = Object.keys(exams[examName] || {}).sort((a, b) => b.localeCompare(a));
    years.forEach(y => {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        yearSelector.appendChild(o);
    });
}
function questoesDoManifest(prova, ano) {
    const y = exams && exams[prova] && exams[prova][ano];
    if (!y) return null;
    return Array.isArray(y) ? y.map((f, i) => ({ num: String(i + 1), filename: f }))
                            : Object.entries(y).map(([n, f]) => ({ num: String(n), filename: f }));
}

async function loadYear(examName, yearName, targetNum = null) {
    if (loadingYear) return false;
    const yearData = exams[examName]?.[yearName];
    if (!yearData) { alert(`Ano ${yearName} não encontrado na prova ${examName}.`); return false; }
    let files = [];
    if (Array.isArray(yearData)) {
        files = yearData.map((f, i) => ({ num: String(i + 1), filename: f, url: urlQuestao(examName, yearName, f, String(i + 1)) }));
    } else {
        files = Object.entries(yearData).map(([num, f]) => ({ num: String(num), filename: f, url: urlQuestao(examName, yearName, f, String(num)) }));
    }
    files.sort((a, b) => (parseInt(a.num) || 0) - (parseInt(b.num) || 0));
    if (!files.length) { alert(`Sem questões em ${examName}/${yearName}.`); return false; }
    currentExam = examName;
    currentYear = yearName;
    questoes = files;
    let idx = 0;
    if (targetNum != null) {
        const f = questoes.findIndex(q => String(q.num) === String(targetNum));
        if (f >= 0) idx = f;
    }
    return await carregarQuestao(idx);
}
if (examSelector) examSelector.addEventListener('change', async () => {
    const ex = examSelector.value;
    populateYearSelector(ex);
    const y = yearSelector.value;
    if (ex && y) await loadYear(ex, y);
});
if (yearSelector) yearSelector.addEventListener('change', async () => {
    const ex = examSelector.value, y = yearSelector.value;
    if (ex && y) await loadYear(ex, y);
});

/* ============================================================
   NOVO ESCOPO: REBUILD + FILTROS
   ============================================================ */
async function rebuildQuestoes(navigateIfLost = true) {
    const cur = questoes[questaoAtualIndex];
    const oldKey = cur ? { exam: cur.exam || currentExam, year: cur.year || currentYear, num: String(cur.num) } : null;

    if (!Object.keys(exams).length) { questoes = []; updatePositionIndicator(); return; }

    const allBancas = Object.keys(exams).sort();
    const bancasSel = filtros.bancas.length === 0 || (!filtros.bancas.includes(NENHUMA) && filtros.bancas.length === allBancas.length)
        ? allBancas : filtros.bancas.filter(b => exams[b]);

    const todas = [];
    for (const banca of bancasSel) {
        const anosDisp = Object.keys(exams[banca] || {});
        const anosSel = filtros.anos.length === 0
            ? anosDisp
            : anosDisp.filter(a => filtros.anos.includes(a));
        for (const ano of anosSel) {
            const files = questoesDoManifest(banca, ano);
            if (!files) continue;
            for (const f of files) {
                todas.push({
                    exam: banca, year: ano, num: f.num, filename: f.filename,
                    url: urlQuestao(banca, ano, f.filename, f.num)
                });
            }
        }
    }

    todas.sort((a, b) => {
        if (a.year !== b.year) return b.year.localeCompare(a.year);
        if (a.exam !== b.exam) return a.exam.localeCompare(b.exam);
        return (parseInt(a.num) || 0) - (parseInt(b.num) || 0);
    });

    let filtradas = todas;
    if (Array.isArray(filtros.lista) && filtros.lista.length) {
        /* grupo vindo do Meu gabarito: lista fixa de questões, na ordem do gabarito */
        filtradas = filtros.lista.map(k => {
            const [b, a, n] = k.split('|');
            const f = arquivoNoManifest(b, a, n);
            return f ? { exam: b, year: a, num: String(n), filename: f, url: urlQuestao(b, a, f, String(n)) } : null;
        }).filter(Boolean);
    } else {
        if (filtros.disciplina && disciplinasLoaded) {
            filtradas = filtradas.filter(q => {
                return disciplinaDe(q.exam, q.year, q.num) === filtros.disciplina;
            });
            if (filtros.tema && temasPadrao) filtradas = filtradas.filter(q => temaDe(q.exam, q.year, q.num) === filtros.tema);
        }
        if (filtros.revisao) {
            /* revisão espaçada: só as questões com revisão vencida, da mais atrasada para a mais recente */
            filtradas = filtradas.filter(q => revisaoPendente(q.exam, q.year, q.num))
                .sort((a, b) => vencimentoRevisao(a.exam, a.year, a.num) - vencimentoRevisao(b.exam, b.year, b.num));
        } else if (filtros.somenteNaoRealizadas) {
            filtradas = filtradas.filter(q => !isRealizada(q.exam, q.year, q.num));
        }
        if (filtros.embaralhar) filtradas = embaralharComSemente(filtradas, filtros.semente || 1);
        if (filtros.maxQuestoes > 0) {
            filtradas = filtradas.slice(0, filtros.maxQuestoes);
        }
    }

    questoes = filtradas;

    let idx = -1;
    if (oldKey) {
        idx = questoes.findIndex(q => q.exam === oldKey.exam && q.year === oldKey.year && String(q.num) === oldKey.num);
    }

    if (idx >= 0) {
        questaoAtualIndex = idx;
    } else if (questoes.length > 0 && navigateIfLost) {
        await carregarQuestao(0);
    } else if (questoes.length === 0) {
        pausarTimer();
        showEmptyMessage();
    }
    if (questaoAtualIndex >= questoes.length) questaoAtualIndex = 0;

    updatePositionIndicator();
    updateNavButtons();
    updateFabBarButtons();
    salvarFiltros();
}

function updatePositionIndicator() {
    if (!posIndicator) return;
    if (questoes.length === 0) posIndicator.textContent = '0/0';
    else posIndicator.textContent = `${questaoAtualIndex + 1}/${questoes.length}`;
}
function updateNavButtons() {
    if (questoes.length === 0) {
        prevBtn.disabled = true; nextBtn.disabled = true;
    } else {
        prevBtn.disabled = questaoAtualIndex === 0;
        nextBtn.disabled = questaoAtualIndex === questoes.length - 1;
    }
}
function showEmptyMessage() {
    const semLista = !(Array.isArray(filtros.lista) && filtros.lista.length);
    const nenhuma = semLista && (filtros.bancas.includes(NENHUMA) ? 'banca' : filtros.anos.includes(NENHUMA) ? 'edição' : '');
    const [tit, txt] = nenhuma ? [`Escolha pelo menos uma ${nenhuma}`, `Marque uma ou mais ${nenhuma === 'banca' ? 'bancas' : 'edições'} na barra superior.`]
        : ['Nenhuma questão corresponde aos filtros atuais', 'Ajuste os filtros para ver questões.'];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{font-family:'Segoe UI',Tahoma,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa;color:#6c757d;text-align:center;padding:20px;}
        h2{color:#495057;font-size:1.2rem;}
    </style></head><body><div><h2>${tit}</h2><p>${txt}</p></div></body></html>`;
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    questionFrame.src = currentBlobUrl;
}

/* ============================================================
   MULTI-SELECT UI
   Lista vazia = todas. Desmarcar "Todas" desmarca tudo (filtros.bancas/anos = [NENHUMA]) para o aluno
   escolher só as que quer; sem nenhuma marcada, não aparece questão e a página pede para escolher.
   ============================================================ */
const NENHUMA = '∅';
const _semNenhuma = l => l.filter(x => x !== NENHUMA);
function renderBancaMulti() {
    const bancas = Object.keys(exams).sort();
    const selected = filtros.bancas;
    const all = selected.length === 0 || (!selected.includes(NENHUMA) && selected.length === bancas.length);

    let label;
    if (selected.includes(NENHUMA)) label = 'Bancas: nenhuma';
    else if (all) label = 'Bancas: todas';
    else if (selected.length === 1) label = selected[0];
    else label = `${selected.length} bancas`;
    bancaMultiBtn.textContent = label;

    let html = `<label><input type="checkbox" id="bancaAllChk" ${all ? 'checked' : ''}> <b>Todas as bancas</b></label><hr>`;
    bancas.forEach(b => {
        const checked = all || selected.includes(b) ? 'checked' : '';
        html += `<label><input type="checkbox" data-banca-value="${escapeHtml(b)}" ${checked}> ${escapeHtml(b)}</label>`;
    });
    bancaMultiPanel.innerHTML = html;
}

function renderAnoMulti() {
    const bancas = filtros.bancas.length === 0 || (!filtros.bancas.includes(NENHUMA) && filtros.bancas.length === Object.keys(exams).length)
        ? Object.keys(exams).sort()
        : filtros.bancas.filter(b => exams[b]);
    const anosSet = new Set();
    bancas.forEach(b => Object.keys(exams[b] || {}).forEach(a => anosSet.add(a)));
    const anos = Array.from(anosSet).sort((a, b) => b.localeCompare(a));

    filtros.anos = filtros.anos.filter(a => a === NENHUMA || anos.includes(a));

    const selected = filtros.anos;
    const all = selected.length === 0 || (!selected.includes(NENHUMA) && selected.length === anos.length);

    let label;
    if (selected.includes(NENHUMA)) label = 'Edições: nenhuma';
    else if (all) label = 'Edições: todas';
    else if (selected.length === 1) label = `Edição: ${selected[0]}`;
    else label = `Edições: ${selected.length}`;
    anoMultiBtn.textContent = label;

    let html = `<label><input type="checkbox" id="anoAllChk" ${all ? 'checked' : ''}> <b>Todas as edições</b></label><hr>`;
    anos.forEach(a => {
        const checked = all || selected.includes(a) ? 'checked' : '';
        html += `<label><input type="checkbox" data-ano-value="${escapeHtml(a)}" ${checked}> ${escapeHtml(a)}</label>`;
    });
    anoMultiPanel.innerHTML = html;
}

function renderDisciplinaSelector() {
    if (!disciplinaSelector) return;
    if (!disciplinasLoaded && disciplinasFailed) {
        disciplinaSelector.innerHTML = '<option value="">Todas as disciplinas</option>';
        disciplinaSelector.disabled = true;
        return;
    }
    disciplinaSelector.disabled = false;
    let html = '<option value="">Todas as disciplinas</option>';
    DISCIPLINAS_LISTA.forEach(d => {
        html += `<option value="${escapeHtml(d)}" ${filtros.disciplina === d ? 'selected' : ''}>${escapeHtml(d)}</option>`;
    });
    disciplinaSelector.innerHTML = html;
    renderTemaSelector();
}
/* tema: aparece quando uma disciplina está escolhida e a lista de temas existe */
function renderTemaSelector() {
    const sel = document.getElementById('temaSelector');
    if (!sel) return;
    const lista = (filtros.disciplina && temasPadrao?.disciplinas?.[filtros.disciplina]) || null;
    if (!lista) { sel.hidden = true; sel.innerHTML = ''; return; }
    if (filtros.tema && !lista.includes(filtros.tema)) filtros.tema = '';
    sel.innerHTML = '<option value="">Todos os temas</option>'
        + lista.map(t => `<option value="${escapeHtml(t)}" ${filtros.tema === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
    sel.hidden = false;
}

function renderBottomFilters() {
    soNaoRealizadas.checked = filtros.somenteNaoRealizadas;
    maxQuestoesInput.value = filtros.maxQuestoes > 0 ? filtros.maxQuestoes : '';
}

function renderAllFilterUI() {
    renderBancaMulti();
    renderAnoMulti();
    renderDisciplinaSelector();
    renderBottomFilters();
}

bancaMultiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = !bancaMultiPanel.hidden;
    bancaMultiPanel.hidden = true;
    anoMultiPanel.hidden = true;
    if (!wasOpen) bancaMultiPanel.hidden = false;
});
anoMultiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = !anoMultiPanel.hidden;
    bancaMultiPanel.hidden = true;
    anoMultiPanel.hidden = true;
    if (!wasOpen) {
        renderAnoMulti();
        anoMultiPanel.hidden = false;
    }
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.multiselect')) {
        bancaMultiPanel.hidden = true;
        anoMultiPanel.hidden = true;
    }
});

bancaMultiPanel.addEventListener('change', async (e) => {
    const t = e.target;
    const allBancas = Object.keys(exams).sort();
    if (t.id === 'bancaAllChk') {
        filtros.bancas = t.checked ? [] : [NENHUMA];
    } else if (t.dataset.bancaValue) {
        const b = t.dataset.bancaValue;
        let current = filtros.bancas.length === 0 ? allBancas.slice() : _semNenhuma(filtros.bancas);
        if (t.checked) {
            if (!current.includes(b)) current.push(b);
        } else {
            current = current.filter(x => x !== b);
        }
        if (current.length === allBancas.length) filtros.bancas = [];
        else filtros.bancas = current.length ? current : [NENHUMA];
    }
    renderBancaMulti();
    renderAnoMulti();
    await rebuildQuestoes();
});

anoMultiPanel.addEventListener('change', async (e) => {
    const t = e.target;
    const bancas = filtros.bancas.length === 0 || (!filtros.bancas.includes(NENHUMA) && filtros.bancas.length === Object.keys(exams).length)
        ? Object.keys(exams).sort()
        : filtros.bancas.filter(b => exams[b]);
    const anosSet = new Set();
    bancas.forEach(b => Object.keys(exams[b] || {}).forEach(a => anosSet.add(a)));
    const allAnos = Array.from(anosSet).sort((a, b) => b.localeCompare(a));

    if (t.id === 'anoAllChk') {
        filtros.anos = t.checked ? [] : [NENHUMA];
    } else if (t.dataset.anoValue) {
        const a = t.dataset.anoValue;
        let current = filtros.anos.length === 0 ? allAnos.slice() : _semNenhuma(filtros.anos);
        if (t.checked) {
            if (!current.includes(a)) current.push(a);
        } else {
            current = current.filter(x => x !== a);
        }
        if (current.length === allAnos.length) filtros.anos = [];
        else filtros.anos = current.length ? current : [NENHUMA];
    }
    renderAnoMulti();
    await rebuildQuestoes();
});

disciplinaSelector.addEventListener('change', async () => {
    filtros.disciplina = disciplinaSelector.value;
    filtros.tema = '';
    renderTemaSelector();
    await rebuildQuestoes();
});
document.getElementById('temaSelector').addEventListener('change', async (e) => {
    filtros.tema = e.target.value;
    await rebuildQuestoes();
});

soNaoRealizadas.addEventListener('change', async () => {
    filtros.somenteNaoRealizadas = soNaoRealizadas.checked;
    await rebuildQuestoes();
});

maxQuestoesInput.addEventListener('change', async () => {
    const v = parseInt(maxQuestoesInput.value);
    filtros.maxQuestoes = (!isNaN(v) && v > 0) ? v : 0;
    await rebuildQuestoes();
});
