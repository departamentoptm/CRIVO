/* ============================================================
   DESEMPENHO, PLANO DE ESTUDO, META DIÁRIA E SEQUÊNCIA DE DIAS
   - Desempenho: acerto geral, por disciplina e por tema (primeira resposta de cada questão; anuladas e
     excluídas ficam de fora), evolução semanal e pontos fracos (temas com pelo menos 5 questões respondidas
     e menos de 60% de acerto), com o botão "Estudar meus pontos fracos".
   - Plano de estudo: prova alvo, data, horas por semana e dias de estudo. Calcula o tempo do dia, desconta
     as revisões pendentes (questões e cartões) e distribui as questões novas por disciplina conforme o peso
     de cada uma nas últimas edições da prova alvo.
   - Meta diária (definida pelo aluno, independente do plano) e sequência de dias: um dia conta quando o
     aluno resolve pelo menos 1 questão ou revisa 1 cartão.
   Plano e meta ficam no progresso (arquivo e Google Drive).
   ============================================================ */
const desempenhoScreen = document.getElementById('desempenhoScreen');
const LIMITE_PONTO_FRACO = 0.6, MINIMO_PONTO_FRACO = 5, SEGUNDOS_POR_CARTAO = 30;
const _chaveQ = (b, a, n) => `${b}|${a}|${n}`;
const _pct = (c, n) => n ? Math.round(100 * c / n) : 0;
const _plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

function _questoesDoAcervo() {
    const out = [];
    for (const b of Object.keys(exams || {}).sort()) for (const a of Object.keys(exams[b] || {})) {
        for (const f of questoesDoManifest(b, a) || []) {
            const n = String(f.num);
            if (!semGabarito.has(_chaveQ(b, a, n))) out.push({ b, a, n });
        }
    }
    return out;
}
/* primeira resposta confirmada de cada questão (o que mede o conhecimento antes de ler a correção) */
function primeirasRespostas() {
    const m = new Map();
    for (const e of progress.registro || []) {
        if (e.acao !== 'confirmou' || !e.correta) continue;
        const k = _chaveQ(e.prova, e.ano, e.questao);
        if (!m.has(k) && !semGabarito.has(k)) m.set(k, { certa: e.opcao === e.correta, data: e.data });
    }
    return m;
}
function estatisticas() {
    const pr = primeirasRespostas();
    const porDisc = new Map();
    let n = 0, certas = 0;
    for (const [k, r] of pr) {
        const [b, a, q] = k.split('|');
        const d = disciplinaDe(b, a, q) || 'Sem disciplina', t = temaDe(b, a, q);
        n++; certas += r.certa ? 1 : 0;
        if (!porDisc.has(d)) porDisc.set(d, { n: 0, certas: 0, temas: new Map() });
        const x = porDisc.get(d); x.n++; x.certas += r.certa ? 1 : 0;
        if (t) {
            if (!x.temas.has(t)) x.temas.set(t, { n: 0, certas: 0 });
            const y = x.temas.get(t); y.n++; y.certas += r.certa ? 1 : 0;
        }
    }
    return { n, certas, porDisc };
}
function pontosFracos(est) {
    const out = [];
    for (const [d, x] of est.porDisc) for (const [t, y] of x.temas) {
        if (y.n >= MINIMO_PONTO_FRACO && y.certas / y.n < LIMITE_PONTO_FRACO) out.push({ d, t, n: y.n, certas: y.certas });
    }
    return out.sort((p, q) => p.certas / p.n - q.certas / q.n || q.n - p.n);
}
/* questões de um conjunto de temas para praticar: primeiro as não feitas (edições recentes antes); sem
   nenhuma, as que o aluno errou na última resposta */
function questoesDosTemas(pares) {
    const alvo = new Set(pares.map(p => p.d + '|' + p.t));
    const doTema = _questoesDoAcervo().filter(q => alvo.has((disciplinaDe(q.b, q.a, q.n) || '') + '|' + (temaDe(q.b, q.a, q.n) || '')))
        .sort((x, y) => y.a.localeCompare(x.a) || x.b.localeCompare(y.b) || (+x.n) - (+y.n));
    let lista = doTema.filter(q => !isRealizada(q.b, q.a, q.n));
    if (!lista.length) lista = doTema.filter(q => { const e = progress.estado?.[q.b]?.[q.a]?.[q.n]; return e && e.correct && e.selected !== e.correct; });
    return lista.map(q => _chaveQ(q.b, q.a, q.n));
}
async function estudarGrupo(chaves, nome) {
    if (!chaves.length) { alert('Não há questões para estudar neste grupo agora.'); return; }
    garantirFiltros();
    guardarFiltrosAnteriores();
    filtros.lista = chaves; filtros.listaNome = nome;
    filtros.revisao = false; filtros.revisaoDia = null;
    salvarFiltros();
    await loadDisciplinas();
    await rebuildQuestoes(false);
    renderAllFilterUI();
    if (questoes.length) await carregarQuestao(0); else showEmptyMessage();
    showScreen(resolvingScreen);
}

/* ---------- dias com estudo, sequência e meta ---------- */
function diasComEstudo() {
    const dias = new Set();
    (progress.registro || []).forEach(e => { if (e.acao === 'confirmou') dias.add(isoDoDia(+new Date(e.data))); });
    Object.values(progress.cartoes || {}).forEach(c => (c && c.revisoes || []).forEach(v => dias.add(isoDoDia(+new Date(v.data)))));
    return dias;
}
function sequenciaDeDias() {
    const dias = diasComEstudo();
    let d = isoDoDia(Date.now());
    if (!dias.has(d)) d = somarDias(d, -1);            /* hoje ainda sem estudo: a sequência vem até ontem */
    let n = 0;
    while (dias.has(d)) { n++; d = somarDias(d, -1); }
    return n;
}
function questoesDeHoje() {
    const hoje = isoDoDia(Date.now()), s = new Set();
    (progress.registro || []).forEach(e => { if (e.acao === 'confirmou' && isoDoDia(+new Date(e.data)) === hoje) s.add(_chaveQ(e.prova, e.ano, e.questao)); });
    return s.size;
}
function metaDiariaAtual() {
    return progress.metaDiaria && +progress.metaDiaria.valor > 0 ? +progress.metaDiaria.valor : 0;
}
function blocoMetaDiaria() {
    const meta = metaDiariaAtual(), feitas = questoesDeHoje();
    return '<section class="desemp-bloco"><h2>🎯 Meta diária</h2><div class="plano-form">'
        + `<label>Questões por dia (0 desliga) <input type="number" id="metaValor" min="0" max="500" value="${meta}"></label>`
        + '<div class="plano-botoes"><button type="button" class="aparencia-btn" id="metaSalvarBtn">Salvar meta</button></div></div>'
        + `<p class="plano-destaque" id="metaProgresso">${meta ? `Hoje: <b>${feitas}/${meta}</b> ${meta === 1 ? 'questão' : 'questões'}${feitas >= meta ? ' ✅ meta cumprida' : ''}`
                                                      : `Sem meta definida. Hoje: ${_plural(feitas, 'questão', 'questões')}.`}</p></section>`;
}

/* ---------- tela: abas ---------- */
let abaAtual = 'desempenho';
function mostrarAba(aba) {
    abaAtual = aba;
    document.getElementById('abaDesempenho').setAttribute('aria-selected', String(aba === 'desempenho'));
    document.getElementById('abaPlano').setAttribute('aria-selected', String(aba === 'plano'));
    document.getElementById('painelDesempenho').hidden = aba !== 'desempenho';
    document.getElementById('painelPlano').hidden = aba !== 'plano';
    if (aba === 'desempenho') renderDesempenho(); else renderPlano();
}
async function abrirTelaDesempenho(aba) {
    await garantirDadosGabarito();
    try { await carregarAnulacoes(); } catch {}
    try { await loadDisciplinas(); } catch {}
    showScreen(desempenhoScreen);
    mostrarAba(aba || abaAtual);
}
document.getElementById('desempenhoBtnHome').addEventListener('click', () => abrirTelaDesempenho());
document.getElementById('backFromDesempenhoBtn').addEventListener('click', () => { showHome(); showScreen(authScreen); });
document.getElementById('abaDesempenho').addEventListener('click', () => mostrarAba('desempenho'));
document.getElementById('abaPlano').addEventListener('click', () => mostrarAba('plano'));

/* ---------- desempenho ---------- */
function _barra(c, n) {
    const p = _pct(c, n);
    return `<span class="desemp-barra" aria-hidden="true"><span style="width:${p}%" class="${p < LIMITE_PONTO_FRACO * 100 ? 'fraco' : 'bom'}"></span></span>`;
}
function _semanas(qtd) {
    const seg = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
    const ini = seg(Date.now()); ini.setDate(ini.getDate() - 7 * (qtd - 1));
    const sem = Array.from({ length: qtd }, (_, i) => { const d = new Date(ini); d.setDate(d.getDate() + 7 * i); return { ini: d, n: 0, certas: 0 }; });
    const vistos = new Set();
    for (const e of progress.registro || []) {
        if (e.acao !== 'confirmou' || !e.correta) continue;
        const k = _chaveQ(e.prova, e.ano, e.questao);
        if (semGabarito.has(k)) continue;
        const t = new Date(e.data), i = Math.floor((seg(t) - ini) / (7 * DIA_MS) + 0.01);
        if (i < 0 || i >= qtd || vistos.has(k + '|' + isoDoDia(+t))) continue;
        vistos.add(k + '|' + isoDoDia(+t));
        sem[i].n++; sem[i].certas += e.opcao === e.correta ? 1 : 0;
    }
    return sem;
}
function renderDesempenho() {
    const el = document.getElementById('painelDesempenho');
    const est = estatisticas();
    if (!est.n) {
        el.innerHTML = '<div class="revisao-vazia">Você ainda não respondeu questões. Resolva algumas e volte aqui para ver o seu desempenho. 📈</div>';
        return;
    }
    const fracos = temasPadrao ? pontosFracos(est) : [];
    const semanas = _semanas(8), maxN = Math.max(1, ...semanas.map(s => s.n));
    const discs = [...est.porDisc.entries()].sort((a, b) => b[1].n - a[1].n);
    let h = `<div class="desemp-resumo"><div><b>${est.n}</b><span>questões respondidas</span></div><div><b>${_pct(est.certas, est.n)}%</b><span>de acerto</span></div>`
        + `<div><b>${sequenciaDeDias()}</b><span>dias seguidos</span></div></div>`
        + '<p class="desemp-nota">Considera a primeira resposta de cada questão (antes de ver a correção). Anuladas e excluídas ficam de fora.</p>';
    h += '<section class="desemp-bloco"><h2>🎯 Pontos fracos</h2>';
    if (!temasPadrao) h += '<p class="desemp-nota">Os temas das questões ainda não foram classificados. Rode Actions → Gerar correções → ação <b>temas-padrao</b>.</p>';
    else if (!fracos.length) h += `<p class="desemp-nota">Nenhum tema com menos de ${LIMITE_PONTO_FRACO * 100}% de acerto entre os que têm pelo menos ${MINIMO_PONTO_FRACO} questões respondidas.</p>`;
    else {
        h += '<div class="desemp-lista">' + fracos.map((f, i) => `<div class="desemp-linha"><span class="desemp-nome">${escapeHtml(f.t)} <small>${escapeHtml(f.d)}</small></span>`
            + `<span class="desemp-num">${f.certas}/${f.n} · ${_pct(f.certas, f.n)}%</span>${_barra(f.certas, f.n)}`
            + `<button type="button" class="aparencia-btn desemp-praticar" data-fraco="${i}">Praticar</button></div>`).join('') + '</div>'
            + `<button type="button" class="auth-btn home-btn-review revisao-iniciar" id="estudarFracosBtn">▶ Estudar meus pontos fracos (${_plural(fracos.length, 'tema', 'temas')})</button>`;
    }
    h += '</section><section class="desemp-bloco"><h2>📅 Evolução semanal</h2><div class="desemp-semanas">'
        + semanas.map(s => `<div class="desemp-semana" title="${s.n} questões, ${_pct(s.certas, s.n)}% de acerto">`
            + `<span class="desemp-semana-pct">${s.n ? _pct(s.certas, s.n) + '%' : ''}</span>`
            + `<span class="desemp-semana-col"><span style="height:${Math.round(100 * s.n / maxN)}%"></span></span>`
            + `<span class="desemp-semana-n">${s.n}</span><span class="desemp-semana-data">${s.ini.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span></div>`).join('')
        + '</div><p class="desemp-nota">Barras: questões respondidas por semana (a partir da segunda-feira indicada). Acima: % de acerto.</p></section>';
    h += '<section class="desemp-bloco"><h2>📚 Por disciplina e tema</h2>' + discs.map(([d, x]) => {
        const temas = [...x.temas.entries()].sort((a, b) => b[1].n - a[1].n);
        return `<details class="desemp-disc"><summary><span class="desemp-nome">${escapeHtml(d)}</span><span class="desemp-num">${x.certas}/${x.n} · ${_pct(x.certas, x.n)}%</span>${_barra(x.certas, x.n)}</summary>`
            + (temas.length ? temas.map(([t, y]) => `<div class="desemp-linha"><span class="desemp-nome">${escapeHtml(t)}</span><span class="desemp-num">${y.certas}/${y.n} · ${_pct(y.certas, y.n)}%</span>${_barra(y.certas, y.n)}`
                + `<button type="button" class="aparencia-btn desemp-praticar" data-d="${escapeHtml(d)}" data-t="${escapeHtml(t)}">Praticar</button></div>`).join('')
                : '<p class="desemp-nota">Temas ainda não classificados para estas questões.</p>')
            + '</details>';
    }).join('') + '</section>';
    el.innerHTML = h;
    el._fracos = fracos;
}
document.getElementById('painelDesempenho').addEventListener('click', async e => {
    const el = e.currentTarget;
    if (e.target.id === 'estudarFracosBtn') return estudarGrupo(questoesDosTemas(el._fracos || []), 'Pontos fracos');
    const b = e.target.closest('.desemp-praticar');
    if (!b) return;
    const par = b.dataset.fraco != null ? (el._fracos || [])[+b.dataset.fraco] : { d: b.dataset.d, t: b.dataset.t };
    if (par) await estudarGrupo(questoesDosTemas([par]), par.t);
});

/* ---------- plano de estudo ---------- */
function _minutosPorQuestaoDoAluno() {
    const t = (progress.registro || []).filter(e => e.acao === 'confirmou' && e.tempoMs > 5000 && e.tempoMs < 30 * 60000).map(e => e.tempoMs).sort((a, b) => a - b);
    if (t.length < 10) return 3;
    return Math.max(1, Math.min(10, Math.round(t[Math.floor(t.length / 2)] / 30000) / 2));      /* mediana, de meio em meio minuto */
}
function pesosDaProva(banca) {
    const anos = Object.keys(exams?.[banca] || {}).sort().reverse().slice(0, 5);
    const c = new Map(); let total = 0;
    for (const a of anos) for (const f of questoesDoManifest(banca, a) || []) {
        const d = disciplinaDe(banca, a, f.num);
        if (!d) continue;
        c.set(d, (c.get(d) || 0) + 1); total++;
    }
    return { anos, pesos: [...c.entries()].map(([d, n]) => ({ d, p: n / total })).sort((x, y) => y.p - x.p) };
}
function _distribuir(n, pesos) {
    const base = pesos.map(x => ({ d: x.d, p: x.p, q: Math.floor(n * x.p), r: n * x.p - Math.floor(n * x.p) }));
    let falta = n - base.reduce((t, x) => t + x.q, 0);
    [...base].sort((a, b) => b.r - a.r).forEach(x => { if (falta > 0) { x.q++; falta--; } });
    return base;
}
function _novasDeHojePorDisciplina() {
    const hoje = isoDoDia(Date.now()), m = new Map();
    for (const [k, r] of primeirasRespostas()) {
        if (isoDoDia(+new Date(r.data)) !== hoje) continue;
        const [b, a, q] = k.split('|'), d = disciplinaDe(b, a, q);
        if (d) m.set(d, (m.get(d) || 0) + 1);
    }
    return m;
}
function planoAtivo() { return progress.plano && !progress.plano.removido && progress.plano.prova ? progress.plano : null; }
function calcularPlano(pl) {
    const hoje = isoDoDia(Date.now());
    const dias = Math.round((+new Date(pl.data + 'T12:00:00') - +new Date(hoje + 'T12:00:00')) / DIA_MS);
    const minDia = (pl.horasSemana * 60) / pl.diasSemana;
    const revQ = contarRevisoesPendentes(), revC = cartoesDeHoje().length;
    const minRev = revQ * pl.minPorQuestao + revC * SEGUNDOS_POR_CARTAO / 60;
    const novas = Math.max(0, Math.floor((minDia - minRev) / pl.minPorQuestao));
    const { anos, pesos } = pesosDaProva(pl.prova);
    const feitas = _novasDeHojePorDisciplina();
    const dist = _distribuir(novas, pesos).map(x => Object.assign(x, { feitas: feitas.get(x.d) || 0 }));
    const faltamNaProva = _questoesDoAcervo().filter(q => q.b === pl.prova && !isRealizada(q.b, q.a, q.n)).length;
    const previstas = Math.max(0, dias) * novas * pl.diasSemana / 7;
    return { dias, minDia, revQ, revC, minRev, novas, anos, dist, faltamNaProva, previstas };
}
function questoesDoPlanoDeHoje(pl, dist, so) {
    const naoFeitas = _questoesDoAcervo().filter(q => !isRealizada(q.b, q.a, q.n))
        .sort((x, y) => (x.b === pl.prova ? 0 : 1) - (y.b === pl.prova ? 0 : 1) || y.a.localeCompare(x.a) || (+x.n) - (+y.n));
    const out = [];
    for (const x of dist) {
        if (so && x.d !== so) continue;
        const resta = Math.max(0, x.q - x.feitas);
        if (!resta) continue;
        out.push(...naoFeitas.filter(q => disciplinaDe(q.b, q.a, q.n) === x.d).slice(0, resta).map(q => _chaveQ(q.b, q.a, q.n)));
    }
    return out;
}
function renderPlano() {
    const el = document.getElementById('painelPlano');
    const pl = planoAtivo();
    const bancas = Object.keys(exams || {}).sort();
    const v = pl || { prova: bancas[0] || '', data: '', horasSemana: 10, diasSemana: 6, minPorQuestao: _minutosPorQuestaoDoAluno() };
    let h = blocoMetaDiaria() + '<section class="desemp-bloco"><h2>⚙️ Meu plano</h2><div class="plano-form">'
        + `<label>Prova alvo <select id="planoProva">${bancas.map(b => `<option ${b === v.prova ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('')}</select></label>`
        + `<label>Data da prova <input type="date" id="planoData" value="${escapeHtml(v.data || '')}" min="${isoDoDia(Date.now())}"></label>`
        + `<label>Horas de estudo por semana <input type="number" id="planoHoras" min="1" max="100" value="${v.horasSemana}"></label>`
        + `<label>Dias de estudo por semana <input type="number" id="planoDias" min="1" max="7" value="${v.diasSemana}"></label>`
        + `<label>Minutos por questão <input type="number" id="planoMin" min="1" max="10" step="0.5" value="${v.minPorQuestao}"></label>`
        + `<div class="plano-botoes"><button type="button" class="auth-btn home-btn-start" id="planoSalvarBtn">${pl ? 'Atualizar plano' : 'Criar plano'}</button>`
        + (pl ? '<button type="button" class="aparencia-btn" id="planoRemoverBtn">Remover plano</button>' : '') + '</div>'
        + '<p class="desemp-nota" id="planoMsg"></p></div></section>';
    if (pl && pl.data) {
        const r = calcularPlano(pl);
        if (r.dias < 0) h += '<section class="desemp-bloco"><p class="desemp-nota">A data da prova já passou. Atualize o plano com a próxima prova.</p></section>';
        else {
            h += `<section class="desemp-bloco"><h2>📆 Hoje</h2><p class="plano-destaque">Faltam <b>${_plural(r.dias, 'dia', 'dias')}</b> para a prova ${escapeHtml(pl.prova)} (${new Date(pl.data + 'T12:00:00').toLocaleDateString('pt-BR')}).</p>`
                + `<p>Tempo de estudo por dia: <b>${Math.round(r.minDia)} min</b>. Revisões de hoje: ${_plural(r.revQ, 'questão', 'questões')} e ${_plural(r.revC, 'cartão', 'cartões')} (≈ ${Math.round(r.minRev)} min).</p>`
                + '<div class="plano-botoes"><button type="button" class="aparencia-btn" id="planoRevisaoBtn">🔁 Revisão espaçada</button><button type="button" class="aparencia-btn" id="planoCartoesBtn">🃏 Cartões</button></div>'
                + `<p>Questões novas para hoje: <b>${r.novas}</b>${r.novas ? ', distribuídas pelo peso de cada disciplina na ' + escapeHtml(pl.prova) + ' (' + escapeHtml(r.anos.slice(-1)[0] || '') + '–' + escapeHtml(r.anos[0] || '') + '):' : '. As revisões ocupam todo o tempo do dia.'}</p>`;
            const linhas = r.dist.filter(x => x.q > 0);
            if (linhas.length) {
                h += '<div class="desemp-lista">' + linhas.map(x => `<div class="desemp-linha"><span class="desemp-nome">${escapeHtml(x.d)} <small>${Math.round(x.p * 100)}% da prova</small></span>`
                    + `<span class="desemp-num">${Math.min(x.feitas, x.q)}/${x.q}${x.feitas >= x.q ? ' ✅' : ''}</span>${_barra(Math.min(x.feitas, x.q), x.q)}`
                    + `<button type="button" class="aparencia-btn plano-praticar" data-d="${escapeHtml(x.d)}" ${x.feitas >= x.q ? 'disabled' : ''}>Praticar</button></div>`).join('') + '</div>'
                    + '<button type="button" class="auth-btn home-btn-start revisao-iniciar" id="planoComecarBtn">▶ Começar as questões de hoje</button>';
            }
            h += `<p class="desemp-nota">No ritmo do plano, você resolve cerca de ${Math.round(r.previstas)} questões novas até a prova; faltam ${r.faltamNaProva} questões da ${escapeHtml(pl.prova)} por resolver`
                + `${r.faltamNaProva ? ` (${Math.min(100, _pct(r.previstas, r.faltamNaProva))}% delas)` : ''}.</p></section>`;
            el._calc = r;
        }
    }
    el.innerHTML = h;
}
document.getElementById('painelPlano').addEventListener('click', async e => {
    const el = e.currentTarget, id = e.target.id;
    if (id === 'metaSalvarBtn') {
        const v = Math.max(0, Math.min(500, parseInt(document.getElementById('metaValor').value) || 0));
        progress.metaDiaria = { valor: v, atualizado: new Date().toISOString() };
        setDirty(true); salvarBackup(); renderPlano();
    } else if (id === 'planoSalvarBtn') {
        const val = x => document.getElementById(x).value;
        const p = { prova: val('planoProva'), data: val('planoData'), horasSemana: Math.max(1, Math.min(100, +val('planoHoras') || 0)),
                    diasSemana: Math.max(1, Math.min(7, parseInt(val('planoDias')) || 0)), minPorQuestao: Math.max(1, Math.min(10, +val('planoMin') || 3)),
                    atualizado: new Date().toISOString() };
        if (!p.data) { document.getElementById('planoMsg').textContent = 'Escolha a data da prova.'; return; }
        progress.plano = p; setDirty(true); salvarBackup(); renderPlano();
    } else if (id === 'planoRemoverBtn') {
        if (!confirm('Remover o plano de estudo?')) return;
        progress.plano = { removido: true, atualizado: new Date().toISOString() };
        setDirty(true); salvarBackup(); renderPlano();
    } else if (id === 'planoRevisaoBtn') abrirTelaRevisao();
    else if (id === 'planoCartoesBtn') abrirTelaCartoes();
    else if (id === 'planoComecarBtn' && el._calc) await estudarGrupo(questoesDoPlanoDeHoje(planoAtivo(), el._calc.dist), 'Plano de hoje');
    else if (e.target.closest('.plano-praticar') && el._calc) {
        const d = e.target.closest('.plano-praticar').dataset.d;
        await estudarGrupo(questoesDoPlanoDeHoje(planoAtivo(), el._calc.dist, d), `Plano de hoje — ${d}`);
    }
});
