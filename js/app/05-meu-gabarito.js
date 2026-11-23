/* ============================================================
   GABARITO V2
   ============================================================ */
async function garantirDadosGabarito() {
    if (!Object.keys(exams).length) await loadManifest();
    if (!disciplinasLoaded) await loadDisciplinas();
}
/* Gabarito original (sem filtros); os botões usam renderProgressV2(). */
function renderProgress() {
    let html = '';
    for (const exam of Object.keys(progress.estado || {}).sort()) {
        let anos = '';
        for (const year of Object.keys(progress.estado[exam]).sort((a, b) => b.localeCompare(a))) {
            let chips = '';
            for (const n of Object.keys(progress.estado[exam][year]).sort((a, b) => a - b)) {
                const e = progress.estado[exam][year][n];
                if (!e.selected) continue;
                const ok = e.correct && e.selected === e.correct, bad = e.correct && !ok;
                chips += `<button class="chip ${ok ? 'ok' : bad ? 'bad' : ''}" data-exam="${escapeHtml(exam)}" data-year="${escapeHtml(year)}" data-num="${escapeHtml(n)}"><span class="qn">Q${escapeHtml(n)}</span><span class="ans">${escapeHtml(e.selected)}</span><span class="fix">${ok ? '✓' : bad ? '✗ ' + escapeHtml(e.correct) : ''}</span></button>`;
            }
            if (chips) anos += `<div class="year-block"><div class="year-head"><h3>${escapeHtml(year)}</h3></div><div class="gabarito">${chips}</div></div>`;
        }
        if (anos) html += `<div class="exam-block"><h2 class="exam-title">${escapeHtml(exam)}</h2>${anos}</div>`;
    }
    progressContent.innerHTML = html || '<div class="empty-msg">Nenhuma questão marcada ainda.</div>';
}

function getGabFilters() {
    return {
        banca: document.getElementById('gabBancaFilter')?.value || '',
        disciplina: document.getElementById('gabDisciplinaFilter')?.value || '',
        modo: document.getElementById('gabModoFilter')?.value || 'banca',
        mostrar: document.getElementById('gabMostrarFilter')?.value || 'tudo',
        mostrarNaoRealizadas: document.getElementById('gabMostrarNaoRealizadas')?.checked === true,
        ano: document.getElementById('gabAnoFilter')?.value || '',
        data: document.getElementById('gabPorData')?.checked ? (document.getElementById('gabDataInput')?.value || '') : ''
    };
}

function renderProgressV2() {
    if (!Object.keys(exams).length) {
        progressContent.innerHTML = '<div class="empty-msg">Carregue o manifest para ver o gabarito.</div>';
        return;
    }
    let html = '<div class="gab-filters">';
    html += `<select id="gabBancaFilter"><option value="">Todas as bancas</option>`;
    Object.keys(exams).sort().forEach(b => { html += `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`; });
    html += `</select>`;
    html += `<select id="gabAnoFilter"><option value="">Todas as edições</option>`;
    [...new Set(Object.values(exams).flatMap(b => Object.keys(b || {})))].sort((a, b) => b.localeCompare(a))
        .forEach(a => { html += `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`; });
    html += `</select>`;
    html += `<select id="gabDisciplinaFilter"><option value="">Todas as disciplinas</option>`;
    DISCIPLINAS_LISTA.forEach(d => { html += `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`; });
    html += `</select>`;
    html += `<select id="gabModoFilter">
        <option value="banca" selected>Por banca</option>
        <option value="disciplina">Por disciplina</option>
        <option value="banca-disciplina">Disciplinas por banca</option>
    </select>`;
    html += `<select id="gabMostrarFilter">
        <option value="tudo" selected>Tudo</option>
        <option value="erros">Só erros</option>
        <option value="acertos">Só acertos</option>
    </select>`;
    html += `<label><input type="checkbox" id="gabMostrarNaoRealizadas"> Exibir questões não realizadas</label>`;
    html += `<label title="Mostrar só as questões respondidas num dia, com o resultado daquele dia"><input type="checkbox" id="gabPorData"> 📅 Filtrar por data</label>`;
    html += `<span class="gab-data" id="gabDataBox" hidden><button type="button" id="gabDataAnt" aria-label="Dia anterior">‹</button><input type="date" id="gabDataInput" aria-label="Data"><button type="button" id="gabDataProx" aria-label="Próximo dia">›</button></span>`;
    html += '</div><div id="gabDynamic"></div>';
    progressContent.innerHTML = html;
    if (!disciplinasLoaded) {
        document.getElementById('gabDisciplinaFilter').disabled = true;
        document.querySelectorAll('#gabModoFilter option:not([value="banca"])').forEach(o => { o.disabled = true; });
    }

    ligarFiltrosDeDataDoGabarito();
    ['gabBancaFilter','gabAnoFilter','gabDisciplinaFilter','gabModoFilter','gabMostrarFilter','gabMostrarNaoRealizadas'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => updateProgressDynamic());
    });
    updateProgressDynamic();
}

/* Calcula média e desvio padrão do tempo de confirmação por grupo. */
function tempoStatsGrupo(qs) {
    const key = q => `${q.banca}|${q.ano}|${q.num}`;
    const qSet = new Set(qs.map(key));
    const latest = {};
    for (const ev of progress.registro || []) {
        if (ev.acao !== 'confirmou' || ev.tempoMs == null) continue;
        const k = `${ev.prova}|${ev.ano}|${ev.questao}`;
        if (!qSet.has(k)) continue;
        latest[k] = ev.tempoMs;
    }
    const vals = Object.values(latest);
    if (!vals.length) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    return { mean, std: Math.sqrt(variance), n: vals.length };
}

function updateProgressDynamic() {
    const el = document.getElementById('gabDynamic');
    if (!el) return;
    const filters = getGabFilters();
    gabGrupos = {}; gabGrupoSeq = 0;

    // Estatísticas globais (no modo por data: só as respostas daquele dia)
    let answered = 0, confirmed = 0, hits = 0;
    const doDia = filters.data ? respostasDoDia(filters.data) : null;
    if (doDia) for (const ev of doDia.values()) {
        if (filters.banca && ev.prova !== filters.banca) continue;
        if (filters.ano && ev.ano !== filters.ano) continue;
        answered++; confirmed++; if (ev.opcao === ev.correta) hits++;
    }
    if (!doDia) for (const exam in progress.estado) {
        for (const year in progress.estado[exam]) {
            for (const num in progress.estado[exam][year]) {
                if (isResetada(exam, year, num)) continue;
                const q = progress.estado[exam][year][num];
                if (!q.selected) continue;
                answered++;
                if (q.correct) {
                    confirmed++;
                    if (q.selected === q.correct) hits++;
                }
            }
        }
    }
    let html = '<div class="summary-stats">';
    html += `<div class="stat-card"><div class="stat-number">${answered}</div><div class="stat-label">Marcadas</div></div>`;
    html += `<div class="stat-card"><div class="stat-number">${hits}</div><div class="stat-label">Acertos</div></div>`;
    html += `<div class="stat-card"><div class="stat-number">${confirmed ? Math.round(100*hits/confirmed) : 0}%</div><div class="stat-label">Aproveitamento</div></div></div>`;
    html += '<div class="legend">Verde = acerto, vermelho = erro, cinza = não realizada. Clique para abrir. Botão direito/long-press para mais opções.</div>';

    // Coleta todas as questões
    const allQ = [];
    const bancasAll = Object.keys(exams).sort();
    for (const banca of bancasAll) {
        if (filters.banca && banca !== filters.banca) continue;
        const anos = Object.keys(exams[banca] || {}).sort((a, b) => b.localeCompare(a));
        for (const ano of anos) {
            if (filters.ano && ano !== filters.ano) continue;
            const files = questoesDoManifest(banca, ano);
            if (!files) continue;
            for (const f of files) {
                const num = f.num;
                const d = disciplinaDe(banca, ano, num);
                const reset = isResetada(banca, ano, num);
                const e = progress.estado?.[banca]?.[ano]?.[num];
                let status = 'gray', selected = null, correctAnswer = null;
                if (doDia) {
                    const ev = doDia.get(`${banca}|${ano}|${num}`);
                    if (!ev) continue;                      /* não respondida naquele dia */
                    status = ev.opcao === ev.correta ? 'ok' : 'bad'; selected = ev.opcao; correctAnswer = ev.correta;
                } else if (e && e.correct && !reset) {
                    status = e.selected === e.correct ? 'ok' : 'bad';
                    selected = e.selected;
                    correctAnswer = e.correct;
                }
                allQ.push({ banca, ano, num, disciplina: d, status, selected, correctAnswer });
            }
        }
    }

    let discQ = filters.disciplina
        ? allQ.filter(q => q.disciplina === filters.disciplina)
        : allQ;

    for (const q of discQ) {
        q.visible = true;
        if (filters.mostrar === 'erros') q.visible = q.status === 'bad';
        else if (filters.mostrar === 'acertos') q.visible = q.status === 'ok';
        else if (q.status === 'gray' && !filters.mostrarNaoRealizadas) q.visible = false;
    }

    if (discQ.length === 0) {
        el.innerHTML = html + '<div class="empty-msg">Nenhuma questão corresponde aos filtros.</div>';
        return;
    }

    let groupsHtml = '';
    if (filters.modo === 'disciplina') {
        groupsHtml = renderHierarchy(discQ, ['disciplina', 'banca', 'ano']);
    } else if (filters.modo === 'banca-disciplina') {
        groupsHtml = renderHierarchy(discQ, ['banca', 'disciplina', 'ano']);
    } else {
        groupsHtml = renderHierarchy(discQ, ['banca', 'ano']);
    }
    if (!groupsHtml) groupsHtml = '<div class="empty-msg">Nenhuma questão corresponde aos filtros.</div>';
    el.innerHTML = html + groupsHtml;
}

function hasVisibleDeep(qs) { return qs.some(q => q.visible); }

function renderHierarchy(questions, keys, depth = 0) {
    const key = keys[0], folha = keys.length === 1;
    const groups = {};
    for (const q of questions) {
        const v = q[key];
        if (v == null) continue;
        (groups[v] ||= []).push(q);
    }
    const vals = Object.keys(groups).sort((a, b) =>
        key === 'ano' ? b.localeCompare(a)
        : key === 'disciplina' ? DISCIPLINAS_LISTA.indexOf(a) - DISCIPLINAS_LISTA.indexOf(b)
        : a.localeCompare(b));
    let html = '';
    for (const v of vals) {
        const qs = groups[v];
        if (!hasVisibleDeep(qs)) continue;
        const conf = qs.filter(q => q.status !== 'gray').length;
        const hits = qs.filter(q => q.status === 'ok').length;
        const tempoStats = tempoStatsGrupo(qs);
        const icon = key === 'banca' ? '📚' : key === 'disciplina' ? '📖' : '📅';
        const tag = depth === 0 ? 'h2' : 'h3';
        const wrap = depth === 0 ? 'exam-block' : folha ? 'year-block' : 'sub-block';
        let tempoHtml = '';
        if (tempoStats) {
            tempoHtml = `<span class="tempo-counts" title="Média ± variação (desvio padrão), com base em ${tempoStats.n} confirmação(ões)">⏱ Tempo médio por questão: ${fmtTempo(tempoStats.mean)} ± ${fmtTempo(tempoStats.std)}</span>`;
        }
        const erros = qs.filter(q => q.status === 'bad').length;
        let btn = '';
        if (depth === 0) {
            const gid = 'g' + (++gabGrupoSeq);
            gabGrupos[gid] = qs;
            btn = `<div class="grupo-acoes">
                <button class="refazer-grupo" data-grupo-id="${gid}" data-grupo-acao="refazer" data-grupo-nome="${escapeHtml(v)}">🔄 Refazer grupo</button>
                <button class="refazer-grupo restaurar-grupo" data-grupo-id="${gid}" data-grupo-acao="restaurar" data-grupo-nome="${escapeHtml(v)}">↩️ Restaurar</button>
            </div>`;
        }
        const inner = folha ? renderChipsBlock(qs) : renderHierarchy(qs, keys.slice(1), depth + 1);
        html += `<div class="${wrap}"><div class="group-header"><${tag} class="${depth === 0 ? 'exam-title' : 'sub-title'}">${icon} ${escapeHtml(v)}</${tag}><span class="counts c-total">Total realizado: ${conf}</span><span class="counts c-ok">Nº de acertos: ${hits}</span><span class="counts c-bad">Nº de erros: ${erros}</span>${tempoHtml}${btn}</div>${inner}</div>`;
    }
    return html;
}

function renderChipsBlock(qs) {
    const visible = qs.filter(q => q.visible).sort((a, b) => (parseInt(a.num) || 0) - (parseInt(b.num) || 0));
    if (!visible.length) return '';
    let chips = '';
    for (const q of visible) chips += renderChipHtml(q);
    return `<div class="gabarito">${chips}</div>`;
}

function renderChipHtml(q) {
    const { banca, ano, num, status, selected, correctAnswer } = q;
    const ts = progress.estado?.[banca]?.[ano]?.[num]?.timestamp;
    const dateStr = ts ? new Date(ts).toLocaleString('pt-BR') : '';
    const dataAttr = `data-exam="${escapeHtml(banca)}" data-year="${escapeHtml(ano)}" data-num="${escapeHtml(num)}"`;
    if (status === 'ok') {
        return `<button class="chip ok" ${dataAttr} title="Acertou${dateStr ? ' · ' + dateStr : ''}">
            <span class="qn">Q${num}</span><span class="ans">${escapeHtml(selected || '')}</span><span class="fix">✓</span></button>`;
    }
    if (status === 'bad') {
        return `<button class="chip bad" ${dataAttr} title="Errou — correta: ${escapeHtml(correctAnswer || '')}${dateStr ? ' · ' + dateStr : ''}">
            <span class="qn">Q${num}</span><span class="ans">${escapeHtml(selected || '')}</span><span class="fix">✗ ${escapeHtml(correctAnswer || '')}</span></button>`;
    }
    return `<button class="chip gray" ${dataAttr} title="Não realizada"><span class="qn">Q${num}</span></button>`;
}

function handleGrupoBtn(btn) {
    const acao = btn.dataset.grupoAcao || 'refazer';
    const qs = gabGrupos[btn.dataset.grupoId] || [];
    if (acao === 'restaurar') handleRestaurarGrupo(btn, qs);
    else handleRefazerGrupo(btn, qs);
}
let handleRefazerGrupo = _refazerGrupoBase;
function _refazerGrupoBase(btn, qs) {
    const alvo = qs.filter(q => isRealizada(q.banca, q.ano, q.num));
    if (!alvo.length) { avisoGrifo('Nenhuma questão confirmada neste grupo.'); return; }
    if (!confirm(`Refazer ${alvo.length} questão(ões) confirmada(s) de ${btn.dataset.grupoNome}? Grifos e histórico são mantidos.`)) return;
    alvo.forEach(q => _marcarReset(q.banca, q.ano, q.num));
    setDirty(true);
    salvarBackup();
    alvo.forEach(q => sincronizarQuestaoAtual(q.banca, q.ano, q.num));
    updateProgressDynamic();
    updateFabBarButtons();
    avisoGrifo(`${alvo.length} questão(ões) marcada(s) para refazer.`);
}
const _refazerGrupoOriginal = (...x) => _refazerGrupoBase(...x);
function handleRestaurarGrupo(btn, qs) {
    const alvo = qs.filter(q => isResetada(q.banca, q.ano, q.num));
    if (!alvo.length) { avisoGrifo('Nenhuma questão refeita neste grupo.'); return; }
    if (!confirm(`Restaurar ${alvo.length} questão(ões) de ${btn.dataset.grupoNome}? O último estado antes de refazer será recuperado.`)) return;
    alvo.forEach(q => restaurarDoReset(q.banca, q.ano, q.num));
    alvo.forEach(q => sincronizarQuestaoAtual(q.banca, q.ano, q.num));
    updateProgressDynamic();
    updateFabBarButtons();
    avisoGrifo(`${alvo.length} questão(ões) restaurada(s).`);
}

/* ============================================================
   CHIP MENU / LONG-PRESS / CONTEXT MENU
   ============================================================ */
let lpTimer = null;
let lpJustOpened = false;

function openChipMenu(chip, x, y) {
    closeChipMenu();
    const banca = chip.dataset.exam, ano = chip.dataset.year, num = chip.dataset.num;
    const e = progress.estado?.[banca]?.[ano]?.[num];
    const isConf = !!(e && e.correct) && !isResetada(banca, ano, num);
    const isReset = isResetada(banca, ano, num);
    const hasHist = respostasAnteriores(banca, ano, num).length > 0;

    const menu = document.createElement('div');
    menu.className = 'chip-menu';
    menu.id = 'chipMenu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    let html = '';
    if (isConf) html += `<button data-action="refazer">🔄 Refazer questão</button>`;
    if (isReset) html += `<button data-action="restaurar">↩️ Restaurar questão</button>`;
    if (hasHist) html += `<button data-action="historico">📜 Histórico</button>`;
    if (!html) html = '<div style="padding:.55rem 1rem;color:#888;font-size:.85rem;">Sem ações disponíveis</div>';
    menu.innerHTML = html;
    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight - 8) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

    menu.addEventListener('click', (ev) => {
        const b = ev.target.closest('button[data-action]');
        if (!b) return;
        const action = b.dataset.action;
        closeChipMenu();
        if (action === 'refazer') {
            refazerQuestao(banca, ano, num);
            salvarBackup();
            updateProgressDynamic();
            updateFabBarButtons();
            sincronizarQuestaoAtual(banca, ano, num);
        } else if (action === 'restaurar') {
            restaurarDoReset(banca, ano, num);
            updateProgressDynamic();
            updateFabBarButtons();
            sincronizarQuestaoAtual(banca, ano, num);
        } else if (action === 'historico') {
            openHistoricoModal(banca, ano, num);
        }
    });

    setTimeout(() => {
        document.addEventListener('click', _closeChipMenuOutside, { once: true });
    }, 10);
}
function _closeChipMenuOutside(e) {
    if (!e.target.closest('#chipMenu')) closeChipMenu();
}
function closeChipMenu() {
    const m = document.getElementById('chipMenu');
    if (m) m.remove();
}

progressContent.addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    e.preventDefault();
    openChipMenu(chip, e.clientX, e.clientY);
});

progressContent.addEventListener('touchstart', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (lpTimer) clearTimeout(lpTimer);
    const t = e.touches[0];
    lpTimer = setTimeout(() => {
        lpJustOpened = true;
        setTimeout(() => { lpJustOpened = false; }, 600);
        openChipMenu(chip, t.clientX, t.clientY);
        lpTimer = null;
    }, 500);
}, { passive: true });
progressContent.addEventListener('touchend', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
});
progressContent.addEventListener('touchmove', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
});

async function abrirQuestaoDoGabarito(banca, ano, num, limpar) {
    if (!Object.keys(exams).length && !(await loadManifest())) return;
    if (!disciplinasLoaded) await loadDisciplinas();
    garantirFiltros();
    const achar = () => questoes.findIndex(q => q.exam === banca && q.year === ano && String(q.num) === String(num));
    await rebuildQuestoes(false);
    let idx = achar(), relaxou = false;
    const passos = [() => { filtros.maxQuestoes = 0; }, () => { filtros.somenteNaoRealizadas = false; },
                    () => { filtros.disciplina = ''; }, () => { filtros.anos = []; }, () => { filtros.bancas = []; }];
    for (const passo of passos) {
        if (idx >= 0) break;
        passo(); relaxou = true;
        await rebuildQuestoes(false);
        idx = achar();
    }
    if (idx < 0) { await loadYear(banca, ano, num); showScreen(resolvingScreen); return; }
    if (limpar) abrirLimpo = { exam: banca, year: ano, num: String(num) };
    renderAllFilterUI();
    await carregarQuestao(idx);
    showScreen(resolvingScreen);
    if (relaxou) avisoGrifo('Alguns filtros foram removidos para abrir esta questão.');
}

progressContent.addEventListener('click', async (e) => {
    if (lpJustOpened) { lpJustOpened = false; return; }

    const grupoBtn = e.target.closest('.refazer-grupo');
    if (grupoBtn) { handleGrupoBtn(grupoBtn); return; }

    const chip = e.target.closest('.chip');
    if (!chip) return;
    await abrirQuestaoDoGabarito(chip.dataset.exam, chip.dataset.year, chip.dataset.num, chip.classList.contains('gray'));
});

viewProgressBtn.addEventListener('click', async () => {
    progressFrom = 'home';
    pausarTimer();
    await garantirDadosGabarito();
    renderProgressV2();
    showScreen(progressScreen);
});
backFromProgressBtn.addEventListener('click', () => {
    if (progressFrom === 'resolving' && currentYear) showScreen(resolvingScreen);
    else { showHome(); showScreen(authScreen); }
});
backFromProgressBtn.addEventListener('click', () => {
    if (iframeDesatualizado && !resolvingScreen.classList.contains('hidden')) { iframeDesatualizado = false; carregarQuestao(questaoAtualIndex); }
});
