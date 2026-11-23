/* ============================================================
   REVISÃO ESPAÇADA (FSRS-6) E EMBARALHAR
   Algoritmo FSRS-6 (o padrão do Anki desde a versão 25.07), com os parâmetros padrão e retenção desejada
   de 90%. O estado de cada questão é recalculado a partir do histórico de respostas (progress.registro) e
   das avaliações (progress.avaliacoes): por isso funciona igual em todos os aparelhos depois de sincronizar.
   Entram na revisão: questões erradas e questões que o aluno marcou (Difícil/Bom/Fácil) depois de acertar.
   Questões anuladas ou excluídas não entram.
   ============================================================ */
const FSRS_W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
                1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
const FSRS_RETENCAO = 0.9, FSRS_MAX_DIAS = 3650, DIA_MS = 86400000;
const FSRS_DECAY = -FSRS_W[20], FSRS_FACTOR = Math.pow(0.9, 1 / FSRS_DECAY) - 1;
const NOTAS = { 1: 'Errei', 2: 'Difícil', 3: 'Bom', 4: 'Fácil' };
const _lim = (x, a, b) => Math.min(b, Math.max(a, x));
const fsrsD0bruto = g => FSRS_W[4] - Math.exp(FSRS_W[5] * (g - 1)) + 1;
const fsrsD0 = g => _lim(fsrsD0bruto(g), 1, 10);
function fsrsR(t, s) { return Math.pow(1 + FSRS_FACTOR * t / s, FSRS_DECAY); }
function fsrsIntervaloDias(s) {
    const i = s / FSRS_FACTOR * (Math.pow(FSRS_RETENCAO, 1 / FSRS_DECAY) - 1);
    return _lim(Math.round(i), 1, FSRS_MAX_DIAS);
}
/* aplica uma revisão com nota g (1-4) no instante t (ms) a um cartão (ou cria o cartão) */
function fsrsRevisar(c, g, t) {
    if (!c) {
        c = { s: Math.max(0.001, FSRS_W[g - 1]), d: fsrsD0(g), ultima: t, reps: 1, lapsos: g === 1 ? 1 : 0 };
    } else {
        const dias = Math.max(0, (t - c.ultima) / DIA_MS);
        let s;
        if (dias < 1) {                                   /* mesma sessão/dia */
            let inc = Math.exp(FSRS_W[17] * (g - 3 + FSRS_W[18])) * Math.pow(c.s, -FSRS_W[19]);
            if (g >= 3) inc = Math.max(inc, 1);
            s = c.s * inc;
        } else {
            const r = fsrsR(dias, c.s);
            if (g === 1) {
                s = FSRS_W[11] * Math.pow(c.d, -FSRS_W[12]) * (Math.pow(c.s + 1, FSRS_W[13]) - 1) * Math.exp(FSRS_W[14] * (1 - r));
                s = Math.min(s, c.s / Math.exp(FSRS_W[17] * FSRS_W[18]));
            } else {
                s = c.s * (1 + Math.exp(FSRS_W[8]) * (11 - c.d) * Math.pow(c.s, -FSRS_W[9]) * (Math.exp(FSRS_W[10] * (1 - r)) - 1)
                    * (g === 2 ? FSRS_W[15] : 1) * (g === 4 ? FSRS_W[16] : 1));
            }
        }
        const dl = -FSRS_W[6] * (g - 3);
        const d1 = c.d + dl * (10 - c.d) / 9;
        c = { s: Math.max(0.001, s), d: _lim(FSRS_W[7] * fsrsD0bruto(4) + (1 - FSRS_W[7]) * d1, 1, 10),   /* reversão à média: alvo sem limite, como no FSRS-6 */
              ultima: t, reps: c.reps + 1, lapsos: c.lapsos + (g === 1 ? 1 : 0) };
    }
    c.proxima = c.ultima + fsrsIntervaloDias(c.s) * DIA_MS;
    return c;
}

let semGabarito = new Set();       /* "BANCA|ANO|N" anuladas ou excluídas: fora da revisão */
let excluidas = new Set();         /* "BANCA|ANO|N" excluídas do cálculo: fora das estatísticas */
async function carregarAnulacoes() {
    try {
        const ind = await CrivoRender.carregarIndice();
        const sg = new Set(), ex = new Set();
        for (const [b, anos] of Object.entries(ind.bancas || {})) for (const [a, info] of Object.entries(anos)) {
            (info.anuladas || []).forEach(n => sg.add(`${b}|${a}|${n}`));
            (info.excluidas || []).forEach(n => { sg.add(`${b}|${a}|${n}`); ex.add(`${b}|${a}|${n}`); });
        }
        semGabarito = sg; excluidas = ex;
    } catch (e) { console.warn('anulações:', e); }
}
const ehExcluida = (b, a, n) => excluidas.has(`${b}|${a}|${n}`);

/* recalcula todos os cartões a partir do histórico (cache invalidado a cada mudança do progresso).
   Regra para questões: só a PRIMEIRA resposta de cada dia conta como revisão. Responder de novo no mesmo dia
   (refazer logo depois de ler a correção) não é lembrar, e no FSRS jogaria todos os intervalos para "amanhã".
   A classificação (Difícil/Bom/Fácil) vale para a revisão do dia. */
let _cartoesCache = null, _cartoesAssin = '', _respDoDia = new Map();
const _diaLocal = t => new Date(t).toDateString();
function cartoesRevisao() {
    const reg = progress.registro || [], av = progress.avaliacoes || [];
    const assin = reg.length + '|' + av.length + '|' + (reg.length ? reg[reg.length - 1].data : '') + '|' + (av.length ? av[av.length - 1].data : '') + '|' + semGabarito.size;
    if (_cartoesCache && assin === _cartoesAssin) return _cartoesCache;
    const eventos = [];
    reg.forEach(e => { if (e.acao === 'confirmou' && e.correta) eventos.push({ t: +new Date(e.data), k: `${e.prova}|${e.ano}|${e.questao}`, certa: e.opcao === e.correta }); });
    av.forEach(v => eventos.push({ t: +new Date(v.data), k: `${v.prova}|${v.ano}|${v.questao}`, nota: +v.nota }));
    eventos.sort((x, y) => x.t - y.t);
    const cartoes = new Map(), respDoDia = new Map();
    for (const ev of eventos) {
        if (!ev.t || semGabarito.has(ev.k)) continue;
        const u = respDoDia.get(ev.k);
        if (ev.nota) {
            /* a classificação refaz a revisão do dia a partir do estado anterior a ela */
            if (!u) continue;
            u.nota = ev.nota;
            cartoes.set(ev.k, fsrsRevisar(u.antes ? { ...u.antes } : null, notaFsrs(ev.nota, u.certa), u.t));
            continue;
        }
        if (u && _diaLocal(u.t) === _diaLocal(ev.t)) continue;      /* mesma questão de novo no mesmo dia */
        const atual = cartoes.get(ev.k);
        respDoDia.set(ev.k, { t: ev.t, certa: ev.certa, antes: atual ? { ...atual } : null, nota: null });
        if (!ev.certa) cartoes.set(ev.k, fsrsRevisar(atual, 1, ev.t));
        else if (atual) cartoes.set(ev.k, fsrsRevisar(atual, 3, ev.t));
    }
    _cartoesCache = cartoes; _cartoesAssin = assin; _respDoDia = respDoDia;
    return cartoes;
}
/* Sem classificação: acerto = Bom (3) se a questão já está na revisão; erro = Errei (1).
   A classificação do aluno (Difícil/Bom/Fácil = notas 2/3/4 do FSRS) substitui a nota automática, também
   depois de um erro (ex.: erro por desatenção num tema que ele domina). */
function notaFsrs(nota) { return _lim(nota, 2, 4); }
function fimDeHoje() { const d = new Date(); d.setHours(23, 59, 59, 999); return +d; }
function vencimentoRevisao(b, a, n) { const c = cartoesRevisao().get(`${b}|${a}|${n}`); return c ? c.proxima : Infinity; }
/* janela de vencimento: hoje (ou data já passada) = atrasadas + hoje; data futura = só aquele dia */
const isoDoDia = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function janelaRevisao(diaISO) {
    if (!diaISO || diaISO <= isoDoDia(Date.now())) return [-Infinity, fimDeHoje()];
    const ini = +new Date(diaISO + 'T00:00:00');
    return [ini, ini + DIA_MS - 1];
}
function revisaoPendente(b, a, n) {
    const v = vencimentoRevisao(b, a, n), [ini, fim] = janelaRevisao(filtros.revisaoDia);
    return v >= ini && v <= fim;
}
function contarRevisoesPendentes() {
    const fim = fimDeHoje(); let n = 0;
    for (const [k, c] of cartoesRevisao()) {
        const [b, a, q] = k.split('|');
        if (c.proxima <= fim && exams?.[b]?.[a]?.[q]) n++;
    }
    return n;
}
function textoIntervalo(c) {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const alvo = new Date(c.proxima); alvo.setHours(0, 0, 0, 0);
    const dias = Math.round((alvo - hoje) / DIA_MS);          /* dias de calendário até a revisão */
    if (dias <= 0) return 'hoje';
    if (dias === 1) return 'amanhã';
    if (dias < 31) return `em ${dias} dias`;
    if (dias < 365) return `em ${Math.round(dias / 30)} ${Math.round(dias / 30) === 1 ? 'mês' : 'meses'}`;
    return `em ${(dias / 365).toFixed(1).replace('.', ',')} anos`;
}

function embaralharComSemente(lista, semente) {
    let x = (semente >>> 0) || 1;
    const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
    const out = lista.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
}

/* ---- interface ---- */
const soRevisao = document.getElementById('soRevisao');
const embaralharChk = document.getElementById('embaralharChk');
const revisaoConta = document.getElementById('revisaoConta');
const revisaoBtnHome = document.getElementById('revisaoBtnHome');

function atualizarContagemRevisao() {
    const n = contarRevisoesPendentes();
    if (revisaoConta) revisaoConta.textContent = n ? `(${n})` : '';
    if (revisaoBtnHome) revisaoBtnHome.textContent = `🔁 Revisão espaçada${n ? ` — ${n} para hoje` : ''}`;
}
const _renderBottomFiltersRev = renderBottomFilters;
renderBottomFilters = function () {
    _renderBottomFiltersRev();
    soRevisao.checked = !!filtros.revisao;
    embaralharChk.checked = !!filtros.embaralhar;
    soNaoRealizadas.disabled = !!filtros.revisao;
    atualizarContagemRevisao();
};
soRevisao.addEventListener('change', async () => {
    if (!soRevisao.checked) {                     /* sair da revisão: voltam os filtros de antes */
        filtros.revisao = false;
        if (restaurarFiltrosAnteriores()) { renderAllFilterUI(); revisadasNaSessao.clear(); await rebuildQuestoes(); return; }
    } else {
        guardarFiltrosAnteriores();
        filtros.revisaoDia = null;
    }
    filtros.revisao = soRevisao.checked;
    soNaoRealizadas.disabled = filtros.revisao;
    revisadasNaSessao.clear();
    await rebuildQuestoes();
    if (filtros.revisao && !questoes.length) avisoGrifo('Nenhuma revisão pendente para hoje com os filtros atuais. 🎉');
});
embaralharChk.addEventListener('change', async () => {
    filtros.embaralhar = embaralharChk.checked;
    if (filtros.embaralhar) filtros.semente = (Math.random() * 4294967295) >>> 0;
    await rebuildQuestoes();
});
revisaoBtnHome.addEventListener('click', () => abrirTelaRevisao());
const _showHomeRev = showHome;
showHome = function () { _showHomeRev(); try { atualizarContagemRevisao(); } catch {} };

/* na revisão, a questão abre em branco para ser respondida de novo (o histórico continua guardado) */
const revisadasNaSessao = new Set();
const _getSavedStateRev = getSavedState;
getSavedState = function (exam, year, num) {
    if (filtros.revisao && !revisadasNaSessao.has(`${exam}|${year}|${num}`)) return null;
    return _getSavedStateRev(exam, year, num);
};

/* opções Difícil/Bom/Fácil mostradas na página da questão, logo abaixo dos botões */
function opcoesRevisao(exam, year, num) {
    const k = `${exam}|${year}|${num}`;
    if (semGabarito.has(k)) return null;
    const c = cartoesRevisao().get(k);
    const u = _respDoDia.get(k);
    if (!u) return null;
    const intervalos = {};
    [2, 3, 4].forEach(n => { intervalos[n] = textoIntervalo(fsrsRevisar(u.antes ? { ...u.antes } : null, notaFsrs(n, u.certa), u.t)); });
    let mensagem;
    if (u.nota) mensagem = `${NOTAS[u.nota]}: próxima revisão ${c ? textoIntervalo(c) : '—'}. Você pode mudar a escolha.`;
    else if (!u.certa) mensagem = `Você errou: sem escolha, a questão volta ${c ? textoIntervalo(c) : 'amanhã'}. Se foi só desatenção, classifique.`;
    else if (c) mensagem = `Você acertou: sem escolha, conta como Bom (próxima revisão ${textoIntervalo(c)}).`;
    else mensagem = 'Você acertou. Classifique para incluir esta questão na revisão espaçada.';
    if (_diaLocal(u.t) !== _diaLocal(Date.now())) mensagem = `Última revisão em ${new Date(u.t).toLocaleDateString('pt-BR')}. ` + mensagem;
    const ultima = [...(progress.registro || [])].reverse().find(e => e.acao === 'confirmou' && `${e.prova}|${e.ano}|${e.questao}` === k);
    if (ultima && +new Date(ultima.data) > u.t && _diaLocal(+new Date(ultima.data)) === _diaLocal(u.t))
        mensagem += ' Respostas repetidas no mesmo dia não mudam a revisão: vale a primeira do dia.';
    return { intervalos, escolhida: u.nota, mensagem };
}
function enviarOpcoesRevisao() {
    const q = questoes[questaoAtualIndex];
    if (!q || !currentExam || !currentYear) return;
    const op = opcoesRevisao(currentExam, currentYear, q.num);
    if (!op) return;
    try { questionFrame.contentWindow.postMessage({ type: 'REVIEW_OPTIONS', payload: op }, '*'); } catch {}
}
window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || !data.type || event.source !== questionFrame.contentWindow) return;
    const q = questoes[questaoAtualIndex];
    if (!q || !currentExam || !currentYear) return;
    if (data.type === 'QUESTION_ANSWERED') {
        revisadasNaSessao.add(`${currentExam}|${currentYear}|${q.num}`);
        _cartoesCache = null;
        setTimeout(() => { enviarOpcoesRevisao(); atualizarContagemRevisao(); }, 30);
    } else if (data.type === 'REVIEW_RATED') {
        const nota = +(data.payload && data.payload.nota);
        if (![2, 3, 4].includes(nota)) return;
        progress.avaliacoes.push({ data: new Date().toISOString(), prova: currentExam, ano: currentYear, questao: String(q.num), nota });
        _cartoesCache = null; setDirty(true); salvarBackup();
        enviarOpcoesRevisao(); atualizarContagemRevisao();
    }
});
/* ao reabrir uma questão já respondida, mostra de novo as opções (com a escolha feita) */
questionFrame.addEventListener('load', () => {
    setTimeout(() => {
        const q = questoes[questaoAtualIndex];
        const st = q && currentExam ? getSavedState(currentExam, currentYear, q.num) : null;
        if (st && st.correct) enviarOpcoesRevisao();
    }, 400);
});

/* ---- questões excluídas do cálculo não entram nas estatísticas ---- */
const _updateProgressDynamicExcl = updateProgressDynamic;
updateProgressDynamic = function () {
    if (!excluidas.size) return _updateProgressDynamicExcl();
    const est = progress.estado, copia = {};
    for (const b in est) for (const a in est[b]) for (const n in est[b][a]) {
        if (ehExcluida(b, a, n)) continue;
        ((copia[b] ||= {})[a] ||= {})[n] = est[b][a][n];
    }
    progress.estado = copia;
    try { _updateProgressDynamicExcl(); } finally { progress.estado = est; }
};

const _loadManifestRev = loadManifest;
loadManifest = async function () {
    const ok = await _loadManifestRev();
    await carregarAnulacoes();
    _cartoesCache = null;
    try { atualizarContagemRevisao(); } catch {}
    return ok;
};
const _loginRev = loginWithRA;
loginWithRA = async function (ra) {
    const ok = await _loginRev(ra);
    _cartoesCache = null; revisadasNaSessao.clear();
    if (ok) { try { atualizarContagemRevisao(); } catch {} }
    return ok;
};
