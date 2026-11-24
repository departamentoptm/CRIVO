/* ============================================================
   SEM IDENTIFICAÇÃO: o site abre direto no início. O progresso fica neste navegador e, se o aluno quiser,
   no Google Drive dele (a conta Google é a identificação). Progressos antigos, salvos por RA ou apelido,
   são somados ao progresso único deste aparelho na primeira vez.
   ============================================================ */
const CHAVE_LOCAL = 'aluno';
function migrarBackupsAntigos() {
    try {
        if (localStorage.getItem(bkKey(CHAVE_LOCAL))) return;
        const antigos = Object.keys(localStorage).filter(k => k.startsWith('crivo_backup_') && k !== bkKey(CHAVE_LOCAL));
        let soma = null;
        for (const k of antigos) {
            const v = JSON.parse(localStorage.getItem(k));
            if (v && (v.registro || v.estado)) soma = soma ? mesclarProgresso(migrarProgresso(soma), migrarProgresso(v)) : migrarProgresso(v);
        }
        if (soma) localStorage.setItem(bkKey(CHAVE_LOCAL), JSON.stringify(normalizar(soma)));
        const filtrosAntigos = antigos.map(k => localStorage.getItem(filtrosKey(k.slice('crivo_backup_'.length)))).find(Boolean);
        if (filtrosAntigos && !localStorage.getItem(filtrosKey(CHAVE_LOCAL))) localStorage.setItem(filtrosKey(CHAVE_LOCAL), filtrosAntigos);
    } catch (e) { console.warn('migração do progresso local:', e); }
}
window.addEventListener('DOMContentLoaded', async () => {
    migrarBackupsAntigos();
    await loginWithRA(CHAVE_LOCAL);
    currentUser = 'CRIVO';
});
document.getElementById('saveBtnHome').addEventListener('click', exportarProgresso);

/* ============================================================
   FILTROS ANTERIORES (revisão espaçada e grupo do Meu gabarito)
   Ao entrar na revisão ou num grupo, os filtros em uso são guardados; ao sair, voltam.
   ============================================================ */
function guardarFiltrosAnteriores() {
    if (filtros.antes) return;
    const { antes, ...resto } = filtros;
    filtros.antes = JSON.parse(JSON.stringify(resto));
}
function restaurarFiltrosAnteriores() {
    if (!filtros.antes) {
        if (filtros.revisao || (filtros.lista && filtros.lista.length)) {
            filtros.revisao = false; filtros.lista = null; filtros.listaNome = null; filtros.revisaoDia = null;
            salvarFiltros(); atualizarAvisoGrupo(); return true;
        }
        return false;
    }
    filtros = Object.assign({ bancas: [], anos: [], disciplina: '', tema: '', somenteNaoRealizadas: false, maxQuestoes: 0,
                              revisao: false, embaralhar: false, semente: 0 },
                            filtros.antes, { revisao: false, lista: null, listaNome: null, revisaoDia: null, antes: null });
    salvarFiltros(); atualizarAvisoGrupo();
    return true;
}

/* ---- painel "Filtros" da barra inferior ---- */
const filtrosBtn = document.getElementById('filtrosBtn');
const filtrosPainel = document.getElementById('filtrosPainel');
const filtrosAtivos = document.getElementById('filtrosAtivos');
function atualizarFiltrosAtivos() {
    const n = [filtros.somenteNaoRealizadas && !filtros.revisao, filtros.revisao, filtros.embaralhar, filtros.maxQuestoes > 0].filter(Boolean).length;
    filtrosAtivos.textContent = n ? String(n) : '';
    filtrosBtn.title = n ? `${n} filtro(s) ativo(s): toque para ver` : 'Apenas não realizadas, revisões pendentes, embaralhar e limitar';
}
filtrosBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const abrir = filtrosPainel.hidden;
    filtrosPainel.hidden = !abrir;
    filtrosBtn.setAttribute('aria-expanded', String(abrir));
});
filtrosPainel.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => {
    if (!filtrosPainel.hidden) { filtrosPainel.hidden = true; filtrosBtn.setAttribute('aria-expanded', 'false'); }
});
const _renderBottomFilters8 = renderBottomFilters;
renderBottomFilters = function () { _renderBottomFilters8(); atualizarFiltrosAtivos(); atualizarAvisoGrupo(); };
const _rebuildQuestoes8 = rebuildQuestoes;
rebuildQuestoes = async function (...a) {
    const r = await _rebuildQuestoes8(...a);
    try { atualizarFiltrosAtivos(); atualizarAvisoGrupo(); soRevisao.checked = !!filtros.revisao; maxQuestoesInput.value = filtros.maxQuestoes > 0 ? filtros.maxQuestoes : ''; } catch {}
    return r;
};

/* ---- grupo do Meu gabarito na página de resolução ---- */
const grupoAviso = document.getElementById('grupoAviso');
const grupoAvisoTxt = document.getElementById('grupoAvisoTxt');
function atualizarAvisoGrupo() {
    const on = Array.isArray(filtros.lista) && filtros.lista.length > 0;
    grupoAviso.hidden = !on;
    if (on) grupoAvisoTxt.textContent = `${filtros.listaNome || 'Grupo do Meu Gabarito'} (${filtros.lista.length} ${filtros.lista.length === 1 ? 'questão' : 'questões'})`;
}
document.getElementById('grupoSairBtn').addEventListener('click', async () => {
    restaurarFiltrosAnteriores();
    renderAllFilterUI();
    await rebuildQuestoes();
});

/* ============================================================
   TELA PRÉVIA DA REVISÃO ESPAÇADA
   ============================================================ */
const revisaoScreen = document.getElementById('revisaoScreen');
const revDataInput = document.getElementById('revDataInput');
let revDiaSel = null;
function dataPorExtenso(iso) {
    return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function somarDias(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDoDia(+d); }
function listarRevisoes(diaISO) {
    const [ini, fim] = janelaRevisao(diaISO);
    const hoje0 = +new Date(isoDoDia(Date.now()) + 'T00:00:00');
    const out = [];
    for (const [k, c] of cartoesRevisao()) {
        const [b, a, n] = k.split('|');
        if (!exams?.[b]?.[a]?.[n]) continue;
        if (c.proxima < ini || c.proxima > fim) continue;
        out.push({ b, a, n, proxima: c.proxima, atrasada: c.proxima < hoje0, disc: disciplinaDe(b, a, n) });
    }
    return out.sort((x, y) => x.b.localeCompare(y.b) || y.a.localeCompare(x.a) || (parseInt(x.n) || 0) - (parseInt(y.n) || 0));
}
/* Histórico dos dias passados: refaz a sequência de revisões de cada questão (a mesma do FSRS) e, para cada
   data programada que já passou, diz se a questão foi revisada naquele dia (verde) ou não (vermelho, mesmo que
   tenha sido feita depois). Revisões adiantadas não contam para o dia original. */
let _histRevCache = null, _histRevAssin = '';
function historicoRevisoes() {
    const reg = progress.registro || [], av = progress.avaliacoes || [];
    const assin = reg.length + '|' + av.length + '|' + (reg.length ? reg[reg.length - 1].data : '') + '|' + (av.length ? av[av.length - 1].data : '') + '|' + isoDoDia(Date.now());
    if (_histRevCache && assin === _histRevAssin) return _histRevCache;
    const eventos = [];
    reg.forEach(e => { if (e.acao === 'confirmou' && e.correta) eventos.push({ t: +new Date(e.data), k: `${e.prova}|${e.ano}|${e.questao}`, certa: e.opcao === e.correta }); });
    av.forEach(v => eventos.push({ t: +new Date(v.data), k: `${v.prova}|${v.ano}|${v.questao}`, nota: +v.nota }));
    eventos.sort((x, y) => x.t - y.t);
    const estado = new Map(), ultimo = new Map(), linha = new Map();       /* linha: k -> [{t, proxima}] */
    for (const ev of eventos) {
        if (!ev.t || semGabarito.has(ev.k)) continue;
        const u = ultimo.get(ev.k), lista = linha.get(ev.k) || [];
        if (ev.nota) {
            if (!u) continue;
            const s = fsrsRevisar(u.antes ? { ...u.antes } : null, notaFsrs(ev.nota, u.certa), u.t);
            estado.set(ev.k, s);
            if (lista.length && lista[lista.length - 1].t === u.t) lista[lista.length - 1].proxima = s.proxima;
            else lista.push({ t: u.t, proxima: s.proxima });
            linha.set(ev.k, lista);
            continue;
        }
        if (u && _diaLocal(u.t) === _diaLocal(ev.t)) continue;
        const atual = estado.get(ev.k);
        ultimo.set(ev.k, { t: ev.t, certa: ev.certa, antes: atual ? { ...atual } : null });
        let s = null;
        if (!ev.certa) s = fsrsRevisar(atual, 1, ev.t);
        else if (atual) s = fsrsRevisar(atual, 3, ev.t);
        if (s) { estado.set(ev.k, s); lista.push({ t: ev.t, proxima: s.proxima }); linha.set(ev.k, lista); }
        else if (lista.length) { lista.push({ t: ev.t, proxima: null }); linha.set(ev.k, lista); }
    }
    const hoje = isoDoDia(Date.now()), porDia = new Map();
    for (const [k, lista] of linha) {
        for (let i = 0; i < lista.length; i++) {
            if (!lista[i].proxima) continue;
            const dia = isoDoDia(lista[i].proxima);
            if (dia >= hoje) continue;
            const prox = lista[i + 1] ? lista[i + 1].t : null;
            if (prox && isoDoDia(prox) < dia) continue;                 /* adiantada: saiu daquele dia */
            if (!porDia.has(dia)) porDia.set(dia, []);
            porDia.get(dia).push({ k, feita: !!prox && isoDoDia(prox) === dia, depois: prox && isoDoDia(prox) > dia ? prox : null });
        }
    }
    _histRevCache = porDia; _histRevAssin = assin;
    return porDia;
}
function renderHistoricoRevisao(dia) {
    const lista = (historicoRevisoes().get(dia) || []).map(x => { const [b, a, n] = x.k.split('|'); return Object.assign({ b, a, n, disc: disciplinaDe(b, a, n) }, x); })
        .filter(x => exams?.[x.b]?.[x.a]?.[x.n])
        .sort((x, y) => (x.feita === y.feita ? 0 : x.feita ? 1 : -1) || x.b.localeCompare(y.b) || y.a.localeCompare(x.a) || (parseInt(x.n) || 0) - (parseInt(y.n) || 0));
    const feitas = lista.filter(x => x.feita).length;
    document.getElementById('revResumo').textContent = lista.length
        ? `${feitas} de ${lista.length} ${lista.length === 1 ? 'revisão programada feita' : 'revisões programadas feitas'} neste dia.` : '';
    document.getElementById('revLista').innerHTML = lista.length
        ? lista.map(x => `<div class="revisao-item ${x.feita ? 'rev-feita' : 'rev-perdida'}"><span>${x.feita ? '✓' : '✗'} ${escapeHtml(x.b)} ${escapeHtml(x.a)} - Q${escapeHtml(x.n)}${x.disc ? ' - ' + escapeHtml(x.disc) : ''}</span>`
            + `<span class="atraso">${x.feita ? 'feita no dia' : x.depois ? 'feita depois, em ' + new Date(x.depois).toLocaleDateString('pt-BR') : 'não feita'}</span></div>`).join('')
        : '<div class="revisao-vazia">Nenhuma revisão estava programada para este dia.</div>';
    const btn = document.getElementById('revIniciarBtn');
    btn.hidden = true;
}
function renderTelaRevisao() {
    const hoje = isoDoDia(Date.now());
    if (!revDiaSel) revDiaSel = hoje;
    revDataInput.removeAttribute('min'); revDataInput.value = revDiaSel;
    document.getElementById('revDiaAnt').disabled = false;
    document.getElementById('revDataTexto').textContent = dataPorExtenso(revDiaSel) + (revDiaSel === hoje ? ' (hoje)' : '');
    document.getElementById('revIniciarBtn').hidden = false;
    if (revDiaSel < hoje) return renderHistoricoRevisao(revDiaSel);
    const lista = listarRevisoes(revDiaSel);
    const atrasadas = lista.filter(x => x.atrasada).length;
    document.getElementById('revResumo').textContent = lista.length
        ? `${lista.length} ${lista.length === 1 ? 'questão programada' : 'questões programadas'}` + (atrasadas ? ` (${atrasadas} atrasada${atrasadas === 1 ? '' : 's'})` : '')
          + (revDiaSel !== hoje ? ' para este dia. Você pode adiantá-las, mas os intervalos ficam um pouco menores.' : '')
        : '';
    document.getElementById('revLista').innerHTML = lista.length
        ? lista.map(x => `<div class="revisao-item"><span>${escapeHtml(x.b)} ${escapeHtml(x.a)} - Q${escapeHtml(x.n)}${x.disc ? ' - ' + escapeHtml(x.disc) : ''}</span>`
            + (x.atrasada ? `<span class="atraso">atrasada desde ${new Date(x.proxima).toLocaleDateString('pt-BR')}</span>` : '') + `</div>`).join('')
        : `<div class="revisao-vazia">Nenhuma revisão programada para ${revDiaSel === hoje ? 'hoje' : 'este dia'}. 🎉</div>`;
    const btn = document.getElementById('revIniciarBtn');
    btn.disabled = !lista.length;
    btn.textContent = lista.length ? `▶ Iniciar revisão (${lista.length})` : '▶ Iniciar revisão';
}
async function abrirTelaRevisao() {
    await garantirDadosGabarito();
    garantirFiltros();
    revDiaSel = isoDoDia(Date.now());
    renderTelaRevisao();
    showScreen(revisaoScreen);
}
document.getElementById('revDiaAnt').addEventListener('click', () => { revDiaSel = somarDias(revDiaSel, -1); renderTelaRevisao(); });
document.getElementById('revDiaProx').addEventListener('click', () => { revDiaSel = somarDias(revDiaSel, 1); renderTelaRevisao(); });
revDataInput.addEventListener('change', () => { if (revDataInput.value) { revDiaSel = revDataInput.value; renderTelaRevisao(); } });
document.getElementById('backFromRevisaoBtn').addEventListener('click', () => { showHome(); showScreen(authScreen); });
document.getElementById('revIniciarBtn').addEventListener('click', async () => {
    const lista = listarRevisoes(revDiaSel);
    if (!lista.length) return;
    garantirFiltros();
    guardarFiltrosAnteriores();
    filtros.lista = null;
    filtros.bancas = [...new Set(lista.map(x => x.b))];
    filtros.anos = [...new Set(lista.map(x => x.a))];
    filtros.disciplina = '';
    filtros.revisao = true;
    filtros.revisaoDia = revDiaSel > isoDoDia(Date.now()) ? revDiaSel : null;
    filtros.maxQuestoes = lista.length;
    salvarFiltros();
    revisadasNaSessao.clear();
    await startExam();
});

/* ============================================================
   MEU GABARITO: FILTRO POR DATA E "REFAZER GRUPO"
   ============================================================ */
function respostasDoDia(diaISO) {
    const m = new Map();
    for (const ev of progress.registro || []) {
        if (ev.acao !== 'confirmou' || !ev.correta) continue;
        if (isoDoDia(+new Date(ev.data)) !== diaISO) continue;
        if (ehExcluida(ev.prova, ev.ano, ev.questao)) continue;
        m.set(`${ev.prova}|${ev.ano}|${ev.questao}`, ev);      /* vale o resultado do fim daquele dia */
    }
    return m;
}
function ligarFiltrosDeDataDoGabarito() {
    const chk = document.getElementById('gabPorData'), box = document.getElementById('gabDataBox');
    const inp = document.getElementById('gabDataInput'), banca = document.getElementById('gabBancaFilter');
    const ano = document.getElementById('gabAnoFilter');
    if (!chk || !inp) return;
    const hoje = isoDoDia(Date.now());
    inp.value = hoje; inp.max = hoje;
    const mudar = () => updateProgressDynamic();
    chk.addEventListener('change', () => { box.hidden = !chk.checked; mudar(); });
    inp.addEventListener('change', mudar);
    const passo = n => { inp.value = somarDias(inp.value || hoje, n); if (inp.value > hoje) inp.value = hoje; mudar(); };
    document.getElementById('gabDataAnt').addEventListener('click', () => passo(-1));
    document.getElementById('gabDataProx').addEventListener('click', () => passo(1));
    /* edições disponíveis acompanham a banca escolhida */
    banca.addEventListener('change', () => {
        const atual = ano.value;
        const anos = [...new Set((banca.value ? [exams[banca.value] || {}] : Object.values(exams)).flatMap(b => Object.keys(b || {})))]
            .sort((a, b) => b.localeCompare(a));
        ano.innerHTML = '<option value="">Todas as edições</option>' + anos.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
        ano.value = anos.includes(atual) ? atual : '';
    }, true);
}

function fecharMenuGrupo() { const m = document.getElementById('grupoMenu'); if (m) m.remove(); }
handleRefazerGrupo = function (btn, qs) {
    fecharMenuGrupo();
    const r = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'grupo-menu'; menu.id = 'grupoMenu';
    menu.innerHTML = `<button type="button" data-op="resetar">🔄 Apenas resetar</button>
        <button type="button" data-op="resolver">▶ Refazer na página de resolução</button>`;
    document.body.appendChild(menu);
    const mr = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mr.width - 8)) + 'px';
    menu.style.top = (r.bottom + mr.height + 8 > window.innerHeight ? Math.max(8, r.top - mr.height - 6) : r.bottom + 6) + 'px';
    menu.addEventListener('click', async (ev) => {
        const b = ev.target.closest('button[data-op]');
        if (!b) return;
        ev.stopPropagation();
        fecharMenuGrupo();
        if (b.dataset.op === 'resetar') _refazerGrupoOriginal(btn, qs);
        else await refazerGrupoNaResolucao(btn);
    });
    setTimeout(() => document.addEventListener('click', (e) => { if (!e.target.closest('#grupoMenu')) fecharMenuGrupo(); }, { once: true }), 10);
};
async function refazerGrupoNaResolucao(btn) {
    /* as questões exatamente como aparecem no grupo, com os filtros atuais do Meu gabarito, na mesma ordem */
    const bloco = btn.closest('.exam-block');
    const vistos = new Set(), lista = [];
    (bloco ? [...bloco.querySelectorAll('.chip')] : []).forEach(c => {
        const k = `${c.dataset.exam}|${c.dataset.year}|${c.dataset.num}`;
        if (!vistos.has(k)) { vistos.add(k); lista.push(k); }
    });
    if (!lista.length) { avisoGrifo('Nenhuma questão visível neste grupo com os filtros atuais.'); return; }
    const resetar = lista.map(k => k.split('|')).filter(([b, a, n]) => isRealizada(b, a, n));
    if (!confirm(`Refazer na página de resolução as ${lista.length} questão(ões) mostradas em ${btn.dataset.grupoNome}?`
        + (resetar.length ? ` As respostas de ${resetar.length} delas serão resetadas (grifos e histórico são mantidos).` : ''))) return;
    resetar.forEach(([b, a, n]) => _marcarReset(b, a, n));
    if (resetar.length) { setDirty(true); salvarBackup(); }
    garantirFiltros();
    guardarFiltrosAnteriores();
    filtros.lista = lista;
    filtros.revisao = false; filtros.revisaoDia = null;
    salvarFiltros();
    await loadDisciplinas();
    await rebuildQuestoes(false);
    renderAllFilterUI();
    if (questoes.length) await carregarQuestao(0); else showEmptyMessage();
    showScreen(resolvingScreen);
}

/* ---- botão "Solicitar novas provas": abre o Formulário Google (endereço em URL_SOLICITAR_PROVAS) ---- */
/* Cole aqui o link do formulário (Formulários Google > Enviar > link). Vazio = o botão avisa que falta configurar. */
const URL_SOLICITAR_PROVAS = '';
document.getElementById('solicitarProvasBtn').addEventListener('click', () => {
    if (!/^https:\/\//.test(URL_SOLICITAR_PROVAS)) {
        homeMsg.textContent = 'O formulário para solicitar novas provas ainda não foi configurado. Avise o centro acadêmico.';
        return;
    }
    window.open(URL_SOLICITAR_PROVAS, '_blank', 'noopener');
});
