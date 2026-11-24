/* ============================================================
   DESEMPENHO E PLANO DE ESTUDO
   - Desempenho: acerto pela ÚLTIMA resposta de cada questão (anuladas e excluídas ficam de fora), com os
     filtros do Meu gabarito; gráfico por disciplina e tema (barras divididas em acertos, erros e não
     respondidas, ou barras lado a lado: disponíveis, acertos e erros); evolução semanal; pontos fracos
     (temas com pelo menos 5 questões respondidas e menos de 60% de acerto) e sequência de dias.
   - Plano de estudo: prova principal (priorizada ou não), data da prova e horários disponíveis em cada dia
     da semana. O tempo do dia vai primeiro para as revisões (questões e cartões) e o resto para questões
     novas, que o aluno ainda não fez, distribuídas pelo peso das disciplinas. O tempo por questão é medido
     (15-tempo-e-inatividade.js). Uma simulação dia a dia (com as revisões que o FSRS vai gerar) diz se o
     tempo até a prova basta para terminar as questões. A meta do dia é calculada pelo plano.
   Plano fica no progresso (arquivo e Google Drive).
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
/* primeira resposta confirmada de cada questão (usada para saber quais questões novas foram feitas hoje) */
function primeirasRespostas() {
    const m = new Map();
    for (const e of progress.registro || []) {
        if (e.acao !== 'confirmou' || !e.correta) continue;
        const k = _chaveQ(e.prova, e.ano, e.questao);
        if (!m.has(k) && !semGabarito.has(k)) m.set(k, { certa: e.opcao === e.correta, data: e.data });
    }
    return m;
}
/* última resposta confirmada de cada questão (o que o aluno sabe agora); com dia, a última daquele dia */
function ultimasRespostas(dia) {
    const m = new Map();
    for (const e of progress.registro || []) {
        if (e.acao !== 'confirmou' || !e.correta) continue;
        if (dia && isoDoDia(+new Date(e.data)) !== dia) continue;
        const k = _chaveQ(e.prova, e.ano, e.questao);
        if (!semGabarito.has(k)) m.set(k, { certa: e.opcao === e.correta, data: e.data });
    }
    return m;
}
function estatisticas() {
    const pr = ultimasRespostas();
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

/* filtros (os mesmos do Meu gabarito) e forma do gráfico */
const desempFiltros = { banca: '', ano: '', disciplina: '', modo: 'disciplina', mostrar: 'tudo', naoRealizadas: true, data: '' };
let desempVista = 'dividida';                     /* 'dividida' (acertos/erros/não respondidas) ou 'lado' */
function _filtrosDesempenhoHtml() {
    const f = desempFiltros, opc = (v, t, sel) => `<option value="${escapeHtml(v)}" ${v === sel ? 'selected' : ''}>${escapeHtml(t)}</option>`;
    const bancas = Object.keys(exams || {}).sort();
    const anos = [...new Set(Object.values(exams || {}).flatMap(b => Object.keys(b || {})))].sort((a, b) => b.localeCompare(a));
    return '<div class="gab-filters desemp-filtros">'
        + `<select id="dfBanca" aria-label="Banca">${opc('', 'Todas as bancas', f.banca)}${bancas.map(b => opc(b, b, f.banca)).join('')}</select>`
        + `<select id="dfAno" aria-label="Edição">${opc('', 'Todas as edições', f.ano)}${anos.map(a => opc(a, a, f.ano)).join('')}</select>`
        + `<select id="dfDisc" aria-label="Disciplina">${opc('', 'Todas as disciplinas', f.disciplina)}${(DISCIPLINAS_LISTA || []).map(d => opc(d, d, f.disciplina)).join('')}</select>`
        + `<select id="dfModo" aria-label="Agrupar">${opc('disciplina', 'Por disciplina', f.modo)}${opc('banca', 'Por banca', f.modo)}${opc('banca-disciplina', 'Disciplinas por banca', f.modo)}</select>`
        + `<select id="dfMostrar" aria-label="Mostrar">${opc('tudo', 'Tudo', f.mostrar)}${opc('erros', 'Só erros', f.mostrar)}${opc('acertos', 'Só acertos', f.mostrar)}</select>`
        + `<label><input type="checkbox" id="dfNaoRealizadas" ${f.naoRealizadas ? 'checked' : ''}> Exibir questões não realizadas</label>`
        + `<label title="Mostrar só as questões respondidas num dia, com o resultado daquele dia"><input type="checkbox" id="dfPorData" ${f.data ? 'checked' : ''}> 📅 Filtrar por data</label>`
        + `<span class="gab-data" ${f.data ? '' : 'hidden'}><input type="date" id="dfData" value="${escapeHtml(f.data || isoDoDia(Date.now()))}" aria-label="Data"></span>`
        + '</div>'
        + '<div class="desemp-vista" role="group" aria-label="Forma do gráfico">'
        + `<button type="button" class="aparencia-btn" id="dvDividida" aria-pressed="${desempVista === 'dividida'}">Barras divididas</button>`
        + `<button type="button" class="aparencia-btn" id="dvLado" aria-pressed="${desempVista === 'lado'}">Barras lado a lado</button></div>`;
}
/* contagem por grupo: disponíveis (acervo com os filtros), acertos e erros (última resposta) */
function contagensDesempenho() {
    const f = desempFiltros, resp = ultimasRespostas(f.data || null);
    const grupos = new Map();
    const pega = (mapa, chave) => { if (!mapa.has(chave)) mapa.set(chave, { tot: 0, a: 0, e: 0, sub: new Map() }); return mapa.get(chave); };
    for (const q of _questoesDoAcervo()) {
        if (f.banca && q.b !== f.banca) continue;
        if (f.ano && q.a !== f.ano) continue;
        if (typeof ehExcluida === 'function' && ehExcluida(q.b, q.a, q.n)) continue;
        const d = disciplinaDe(q.b, q.a, q.n) || 'Sem disciplina';
        if (f.disciplina && d !== f.disciplina) continue;
        const r = resp.get(_chaveQ(q.b, q.a, q.n));
        if (f.data && !r) continue;                                  /* por data: só as respondidas no dia */
        const [g1, g2] = f.modo === 'banca' ? [q.b, q.a] : f.modo === 'banca-disciplina' ? [q.b, d] : [d, temaDe(q.b, q.a, q.n) || null];
        const x = pega(grupos, g1), y = g2 ? pega(x.sub, g2) : null;
        for (const z of [x, y]) {
            if (!z) continue;
            z.tot++;
            if (r) { if (r.certa) z.a++; else z.e++; }
        }
    }
    return grupos;
}
function _grafico(z, maxTot) {
    const f = desempFiltros, nao = Math.max(0, z.tot - z.a - z.e);
    const a = f.mostrar === 'erros' ? 0 : z.a, e = f.mostrar === 'acertos' ? 0 : z.e, n = f.naoRealizadas ? nao : 0;
    const base = Math.max(1, a + e + n);
    const tit = `${z.a} acertos, ${z.e} erros, ${nao} não respondidas, ${z.tot} disponíveis`;
    if (desempVista === 'lado') {
        const m = Math.max(1, maxTot), w = v => Math.round(100 * v / m);
        return `<span class="graf-lado" title="${tit}">`
            + (f.naoRealizadas ? `<span class="graf-linha"><span class="graf-rot">Disponíveis</span><span class="graf-trilho"><span class="seg tot" style="width:${w(z.tot)}%"></span></span><b>${z.tot}</b></span>` : '')
            + (f.mostrar !== 'erros' ? `<span class="graf-linha"><span class="graf-rot">Acertos</span><span class="graf-trilho"><span class="seg ok" style="width:${w(z.a)}%"></span></span><b>${z.a}</b></span>` : '')
            + (f.mostrar !== 'acertos' ? `<span class="graf-linha"><span class="graf-rot">Erros</span><span class="graf-trilho"><span class="seg erro" style="width:${w(z.e)}%"></span></span><b>${z.e}</b></span>` : '')
            + '</span>';
    }
    const p = v => (100 * v / base).toFixed(2);
    return `<span class="graf-dividida" title="${tit}"><span class="graf-trilho">`
        + (a ? `<span class="seg ok" style="width:${p(a)}%"></span>` : '') + (e ? `<span class="seg erro" style="width:${p(e)}%"></span>` : '')
        + (n ? `<span class="seg nao" style="width:${p(n)}%"></span>` : '') + '</span>'
        + `<span class="graf-legenda">${f.mostrar !== 'erros' ? `<span class="ok">✓ ${z.a}</span>` : ''}${f.mostrar !== 'acertos' ? `<span class="erro">✗ ${z.e}</span>` : ''}`
        + `${f.naoRealizadas ? `<span class="nao">○ ${nao}</span>` : ''}<span class="tot">de ${z.tot}</span></span></span>`;
}
function _blocoGrafico() {
    const grupos = contagensDesempenho(), f = desempFiltros;
    const ordenar = m => [...m.entries()].sort((x, y) => (f.modo === 'banca' && m === grupos) ? x[0].localeCompare(y[0])
        : (y[1].a + y[1].e) - (x[1].a + x[1].e) || y[1].tot - x[1].tot || String(x[0]).localeCompare(String(y[0]), 'pt-BR'));
    const visivel = z => f.naoRealizadas ? z.tot > 0 : (z.a + z.e) > 0;
    const lista = ordenar(grupos).filter(([, z]) => visivel(z));
    const titulo = f.modo === 'banca' ? 'Por banca e edição' : f.modo === 'banca-disciplina' ? 'Disciplinas por banca' : 'Por disciplina e tema';
    if (!lista.length) return `<section class="desemp-bloco"><h2>📚 ${titulo}</h2><p class="desemp-nota">Nada com esses filtros.</p></section>`;
    const maxTot = Math.max(1, ...lista.map(([, z]) => f.naoRealizadas ? z.tot : Math.max(z.a, z.e)));
    const praticar = f.modo === 'disciplina';
    return `<section class="desemp-bloco"><h2>📚 ${titulo}</h2>` + lista.map(([g, z]) => {
        const subs = ordenar(z.sub).filter(([, y]) => visivel(y));
        const maxSub = Math.max(1, ...subs.map(([, y]) => f.naoRealizadas ? y.tot : Math.max(y.a, y.e)));
        return `<details class="desemp-disc"><summary><span class="desemp-nome">${escapeHtml(g)}</span>${_grafico(z, maxTot)}</summary>`
            + (subs.length ? subs.map(([t, y]) => `<div class="desemp-linha graf"><span class="desemp-nome">${escapeHtml(t)}</span>${_grafico(y, maxSub)}`
                + (praticar ? `<button type="button" class="aparencia-btn desemp-praticar" data-d="${escapeHtml(g)}" data-t="${escapeHtml(t)}">Praticar</button>` : '<span></span>') + '</div>').join('')
                : '<p class="desemp-nota">Temas ainda não classificados para estas questões.</p>')
            + '</details>';
    }).join('') + '<p class="desemp-nota graf-legenda-geral"><span class="ok">■ acertos</span> <span class="erro">■ erros</span> <span class="nao">■ não respondidas</span> · '
        + 'Acerto e erro pela última resposta de cada questão.</p></section>';
}
/* tempos médios: até confirmar (todas as respostas com tempo medido) e lendo a correção (as leituras medidas) */
function temposMedios() {
    const lim = typeof MAX_TEMPO_QUESTAO_MS === 'number' ? MAX_TEMPO_QUESTAO_MS : 20 * 60000;
    const conf = (progress.registro || []).filter(e => e.acao === 'confirmou' && +e.tempoMs > 0).map(e => Math.min(lim, +e.tempoMs));
    const leit = Object.values(progress.leituras || {}).map(Number).filter(v => v > 0).map(v => Math.min(lim, v));
    const media = l => l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0;
    return { conf: media(conf), nConf: conf.length, leit: media(leit), nLeit: leit.length };
}
function _tempoCurto(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60), r = s % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
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
    let h = `<div class="desemp-resumo"><div><b>${est.n}</b><span>questões respondidas</span></div><div><b>${_pct(est.certas, est.n)}%</b><span>de acerto</span></div>`
        + `<div><b>${sequenciaDeDias()}</b><span>dias seguidos</span></div>`
        + (() => { const t = temposMedios(); const f = ms => t.nConf ? _tempoCurto(ms) : '—';
            return `<div title="Média de ${t.nConf} respostas"><b>${f(t.conf)}</b><span>até confirmar (média)</span></div>`
                + `<div title="Média de ${t.nLeit} leituras"><b>${t.nLeit ? _tempoCurto(t.leit) : '—'}</b><span>na correção (média)</span></div>`
                + `<div><b>${t.nConf ? _tempoCurto(t.conf + t.leit) : '—'}</b><span>total por questão</span></div>`; })()
        + '</div>'
        + '<p class="desemp-nota">Acerto: considera a última resposta de cada questão; anuladas e excluídas ficam de fora. '
        + 'Tempos: média de todas as respostas (refeitas e revisões incluídas), até 20 min por questão; o total soma as duas médias.</p>';
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
    h += _filtrosDesempenhoHtml() + '<div id="desempGrafico">' + _blocoGrafico() + '</div>';
    el.innerHTML = h;
    el._fracos = fracos;
}
function _atualizarGraficoDesempenho() {
    const g = document.getElementById('desempGrafico');
    if (g) g.innerHTML = _blocoGrafico();
    document.getElementById('dvDividida')?.setAttribute('aria-pressed', String(desempVista === 'dividida'));
    document.getElementById('dvLado')?.setAttribute('aria-pressed', String(desempVista === 'lado'));
}
document.getElementById('painelDesempenho').addEventListener('change', e => {
    const f = desempFiltros, id = e.target.id;
    if (id === 'dfBanca') f.banca = e.target.value;
    else if (id === 'dfAno') f.ano = e.target.value;
    else if (id === 'dfDisc') f.disciplina = e.target.value;
    else if (id === 'dfModo') f.modo = e.target.value;
    else if (id === 'dfMostrar') f.mostrar = e.target.value;
    else if (id === 'dfNaoRealizadas') f.naoRealizadas = e.target.checked;
    else if (id === 'dfPorData') {
        const box = e.target.closest('.desemp-filtros').querySelector('.gab-data');
        box.hidden = !e.target.checked;
        f.data = e.target.checked ? (document.getElementById('dfData').value || isoDoDia(Date.now())) : '';
    } else if (id === 'dfData') f.data = e.target.value || '';
    else return;
    _atualizarGraficoDesempenho();
});
document.getElementById('painelDesempenho').addEventListener('click', async e => {
    const el = e.currentTarget;
    if (e.target.id === 'dvDividida' || e.target.id === 'dvLado') { desempVista = e.target.id === 'dvLado' ? 'lado' : 'dividida'; return _atualizarGraficoDesempenho(); }
    if (e.target.id === 'estudarFracosBtn') return estudarGrupo(questoesDosTemas(el._fracos || []), 'Pontos fracos');
    const b = e.target.closest('.desemp-praticar');
    if (!b) return;
    const par = b.dataset.fraco != null ? (el._fracos || [])[+b.dataset.fraco] : { d: b.dataset.d, t: b.dataset.t };
    if (par) await estudarGrupo(questoesDosTemas([par]), par.t);
});

/* ---------- plano de estudo ---------- */
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];
const _min = hhmm => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
function minutosDoDia(disp, dow) {
    return ((disp && disp[dow]) || []).reduce((t, x) => { const a = _min(x.ini), b = _min(x.fim); return t + (a != null && b != null && b > a ? b - a : 0); }, 0);
}
/* plano antigo (horas e dias por semana) vira horários: os dias a partir de segunda, a partir das 19h */
function disponibilidadeDoPlano(pl) {
    if (pl && pl.disponibilidade) return pl.disponibilidade;
    const d = {}; ORDEM_DIAS.forEach(x => { d[x] = []; });
    if (pl && pl.horasSemana && pl.diasSemana) {
        const por = Math.round(60 * pl.horasSemana / pl.diasSemana), fim = 19 * 60 + Math.min(por, 4 * 60 + 59);
        ORDEM_DIAS.slice(0, pl.diasSemana).forEach(x => { d[x] = [{ ini: '19:00', fim: `${String(Math.floor(fim / 60)).padStart(2, '0')}:${String(fim % 60).padStart(2, '0')}` }]; });
    }
    return d;
}
function pesosDaProva(banca) {
    const bancas = banca ? [banca] : Object.keys(exams || {});
    const c = new Map(); let total = 0, anosTodos = [];
    for (const b of bancas) {
        const anos = Object.keys(exams?.[b] || {}).sort().reverse().slice(0, banca ? 5 : 999);
        anosTodos = anosTodos.concat(anos);
        for (const a of anos) for (const f of questoesDoManifest(b, a) || []) {
            const d = disciplinaDe(b, a, f.num);
            if (!d) continue;
            c.set(d, (c.get(d) || 0) + 1); total++;
        }
    }
    anosTodos = [...new Set(anosTodos)].sort().reverse();
    return { anos: anosTodos, pesos: [...c.entries()].map(([d, n]) => ({ d, p: n / Math.max(1, total) })).sort((x, y) => y.p - x.p) };
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
const _priorizar = pl => pl.priorizar !== false;

/* revisões que o FSRS vai gerar: dias depois da primeira resposta em que uma questão "Bom" volta */
function _deslocamentosTipicos(horizonteDias) {
    const t0 = +new Date(isoDoDia(Date.now()) + 'T12:00:00'), out = [];
    let s = fsrsRevisar(null, 3, t0);
    for (let i = 0; i < 30 && s; i++) {
        const d = Math.round((s.proxima - t0) / DIA_MS);
        if (d > horizonteDias) break;
        out.push(d);
        s = fsrsRevisar({ ...s }, 3, s.proxima);
    }
    return out;
}
/* simulação dia a dia até a véspera da prova: tempo do dia -> revisões (já programadas + geradas pelas
   questões novas, com atraso acumulado) -> o que sobra vira questões novas. Devolve quantas questões novas
   cabem e quando acabariam as que faltam. */
function simularPlano(pl, faltam, minQ, fator) {
    const disp = disponibilidadeDoPlano(pl), hoje = isoDoDia(Date.now());
    const dias = Math.round((+new Date(pl.data + 'T12:00:00') - +new Date(hoje + 'T12:00:00')) / DIA_MS);
    const H = Math.max(0, Math.min(dias, 1100));
    const devidas = new Array(H + 400).fill(0);              /* revisões já programadas (questões + cartões em minutos de questão) */
    const ini0 = +new Date(hoje + 'T00:00:00');
    for (const [, c] of cartoesRevisao()) { const i = Math.max(0, Math.floor((c.proxima - ini0) / DIA_MS)); if (i < devidas.length) devidas[i] += 1; }
    const cartMin = SEGUNDOS_POR_CARTAO / 60 / minQ;
    for (const x of listarCartoes()) { if (!x.estado) { devidas[0] += cartMin; continue; } const i = Math.max(0, Math.floor((x.estado.proxima - ini0) / DIA_MS)); if (i < devidas.length) devidas[i] += cartMin; }
    const respondidas = Math.max(1, primeirasRespostas().size), naRevisao = cartoesRevisao().size;
    const pInclui = Math.min(1, Math.max(0.2, naRevisao / respondidas));
    const desl = _deslocamentosTipicos(H + 1);
    let resta = faltam, backlog = 0, fim = null, novasTotal = 0;
    const feitasHoje = primeirasRespostas(), hojeFeitas = [...feitasHoje.values()].filter(r => isoDoDia(+new Date(r.data)) === hoje).length;
    for (let t = 0; t < H && resta > 0; t++) {
        const dow = new Date(+new Date(hoje + 'T12:00:00') + t * DIA_MS).getDay();
        let livre = minutosDoDia(disp, dow) * fator;
        const rev = backlog + devidas[t];
        const usado = Math.min(livre, rev * minQ);
        backlog = rev - usado / minQ; livre -= usado;
        let novas = Math.min(resta, Math.floor(livre / minQ));
        if (t === 0) novas = Math.max(0, novas - hojeFeitas);       /* as de hoje já feitas saíram de "faltam" */
        for (const d of desl) if (t + d < devidas.length) devidas[t + d] += novas * pInclui;
        resta -= novas; novasTotal += novas;
        if (resta <= 0) fim = somarDias(hoje, t);
    }
    return { dias, novasTotal, resta: Math.max(0, resta), fim };
}
function _faltamDoPlano(pl) {
    const nao = _questoesDoAcervo().filter(q => !isRealizada(q.b, q.a, q.n) && !(typeof ehExcluida === 'function' && ehExcluida(q.b, q.a, q.n)));
    return { prova: nao.filter(q => q.b === pl.prova).length, todas: nao.length };
}
function calcularPlano(pl, leve) {
    const hoje = isoDoDia(Date.now()), dow = new Date().getDay();
    const disp = disponibilidadeDoPlano(pl);
    const dias = Math.round((+new Date(pl.data + 'T12:00:00') - +new Date(hoje + 'T12:00:00')) / DIA_MS);
    const mq = minutosPorQuestaoMedidos(), minQ = mq.min;
    const minSemana = ORDEM_DIAS.reduce((t, d) => t + minutosDoDia(disp, d), 0);
    const minDia = minutosDoDia(disp, dow);
    const revQ = contarRevisoesPendentes(), revC = cartoesDeHoje().length;
    const minRev = revQ * minQ + revC * SEGUNDOS_POR_CARTAO / 60;
    const novasPeloTempo = Math.max(0, Math.floor((minDia - minRev) / minQ));
    /* quantas questões cabem hoje pelo tempo médio (descontados os cartões) e o limite diário, se houver:
       o limite conta revisões + novas; o tempo que sobra vira mais tempo por questão (a previsão do plano
       continua usando o tempo medido) */
    const minCartoes = revC * SEGUNDOS_POR_CARTAO / 60;
    const cabem = Math.max(0, Math.floor((minDia - minCartoes) / minQ));
    const limite = +pl.limiteDiario > 0 ? +pl.limiteDiario : 0;
    const novas = limite ? Math.max(0, Math.min(novasPeloTempo, limite - revQ)) : novasPeloTempo;
    const minPorQuestaoNoLimite = limite ? Math.max(0, minDia - minCartoes) / limite : null;
    const { anos, pesos } = pesosDaProva(_priorizar(pl) ? pl.prova : null);
    const feitas = _novasDeHojePorDisciplina();
    const dist = _distribuir(novas, pesos).map(x => Object.assign(x, { feitas: feitas.get(x.d) || 0 }));
    const falt = _faltamDoPlano(pl);
    const alvo = _priorizar(pl) ? falt.prova : falt.todas;
    const sim = dias > 0 && !leve ? simularPlano(pl, alvo, minQ, 1) : { novasTotal: 0, resta: alvo, fim: null };
    let horasExtra = 0;
    if (!leve && dias > 0 && sim.resta > 0 && minSemana > 0) {
        let lo = 1, hi = 1;
        while (hi < 16 && simularPlano(pl, alvo, minQ, hi).resta > 0) hi *= 2;
        if (hi < 16) { for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (simularPlano(pl, alvo, minQ, m).resta > 0) lo = m; else hi = m; } horasExtra = Math.ceil(minSemana * (hi - 1) / 60); }
        else horasExtra = null;
    }
    const metaHoje = limite ? Math.min(limite, novas + revQ) : novas + revQ;
    return { dias, minDia, minSemana, dow, minQ, mq, revQ, revC, minRev, novas, anos, dist, falt, alvo, sim, horasExtra, metaHoje,
             cabem, limite, minPorQuestaoNoLimite };
}
function questoesDoPlanoDeHoje(pl, dist, so) {
    let naoFeitas = _questoesDoAcervo().filter(q => !isRealizada(q.b, q.a, q.n));
    if (_priorizar(pl)) naoFeitas.sort((x, y) => (x.b === pl.prova ? 0 : 1) - (y.b === pl.prova ? 0 : 1) || y.a.localeCompare(x.a) || (+x.n) - (+y.n));
    else naoFeitas = embaralharComSemente(naoFeitas, +isoDoDia(Date.now()).replace(/-/g, ''));     /* mistas, iguais no dia todo */
    const out = [];
    for (const x of dist) {
        if (so && x.d !== so) continue;
        const resta = Math.max(0, x.q - x.feitas);
        if (!resta) continue;
        out.push(...naoFeitas.filter(q => disciplinaDe(q.b, q.a, q.n) === x.d).slice(0, resta).map(q => _chaveQ(q.b, q.a, q.n)));
    }
    return out;
}
const _hm = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + Math.round(m % 60) + ' min' : ''}` : `${Math.round(m)} min`;
const _dataBr = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR');

/* rascunho do formulário (horários são editados antes de salvar) */
function _rascunhoPlano(el) {
    if (el._rasc) return el._rasc;
    const pl = planoAtivo(), bancas = Object.keys(exams || {}).sort();
    const disp = JSON.parse(JSON.stringify(disponibilidadeDoPlano(pl)));
    ORDEM_DIAS.forEach(d => { if (!Array.isArray(disp[d])) disp[d] = []; });
    if (!pl) [1, 2, 3, 4, 5].forEach(d => { disp[d] = [{ ini: '19:00', fim: '21:00' }]; });
    el._rasc = { prova: pl ? pl.prova : (bancas[0] || ''), data: pl ? pl.data : '', priorizar: pl ? _priorizar(pl) : true, disponibilidade: disp,
                 limiteDiario: pl && +pl.limiteDiario > 0 ? +pl.limiteDiario : 0 };
    return el._rasc;
}
function _formPlanoHtml(r, pl) {
    const bancas = Object.keys(exams || {}).sort();
    const minSem = ORDEM_DIAS.reduce((t, d) => t + minutosDoDia(r.disponibilidade, d), 0);
    const mq = minutosPorQuestaoMedidos();
    return '<section class="desemp-bloco"><h2>⚙️ Meu plano</h2><div class="plano-form">'
        + `<label>Prova principal <select id="planoProva">${bancas.map(b => `<option ${b === r.prova ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('')}</select></label>`
        + `<label>Data da prova <input type="date" id="planoData" value="${escapeHtml(r.data || '')}" min="${isoDoDia(Date.now())}"></label>`
        + `<label class="plano-check"><span><input type="checkbox" id="planoPriorizar" ${r.priorizar ? 'checked' : ''}> Priorizar a prova principal</span>`
        + '<small>Desmarcado: as questões novas vêm misturadas de todas as bancas.</small></label>'
        + `<label class="plano-check"><span><input type="checkbox" id="planoLimiteChk" ${r.limiteDiario ? 'checked' : ''}> Limitar as questões por dia</span>`
        + `<span class="plano-limite" ${r.limiteDiario ? '' : 'hidden'}><input type="number" id="planoLimite" min="1" max="500" value="${r.limiteDiario || ''}" aria-label="Máximo de questões por dia"> questões no máximo (revisões + novas)</span></label>`
        + '<div class="plano-dias"><div class="plano-dias-tit">Dias e horários disponíveis</div>'
        + ORDEM_DIAS.map(d => {
            const lista = r.disponibilidade[d] || [], on = lista.length > 0;
            return `<div class="plano-dia" data-dia="${d}"><label class="plano-dia-nome"><input type="checkbox" data-acao="dia" ${on ? 'checked' : ''}> ${DIAS_SEMANA[d]}</label>`
                + `<div class="plano-horarios">${lista.map((x, i) => `<span class="plano-horario"><input type="time" data-campo="ini" data-i="${i}" value="${escapeHtml(x.ini)}" aria-label="${DIAS_SEMANA[d]}: início">`
                    + `<span>às</span><input type="time" data-campo="fim" data-i="${i}" value="${escapeHtml(x.fim)}" aria-label="${DIAS_SEMANA[d]}: fim">`
                    + `<button type="button" class="dia-btn" data-acao="del" data-i="${i}" aria-label="Remover horário">×</button></span>`).join('')}`
                + (on ? '<button type="button" class="aparencia-btn plano-add" data-acao="add">+ horário</button>' : '<span class="desemp-nota">sem estudo</span>')
                + `</div><span class="desemp-num">${on ? _hm(minutosDoDia(r.disponibilidade, d)) : ''}</span></div>`;
        }).join('') + '</div>'
        + `<p class="desemp-nota plano-total">Total: <b>${_hm(minSem)} por semana</b>. Tempo por questão: <b>${String(mq.min).replace('.', ',')} min</b>`
        + (mq.medido ? ` (medido nas suas últimas ${mq.n} respostas, até confirmar e lendo a correção).` : ` (valor inicial; passa a ser medido depois de 20 respostas — você tem ${mq.n}).`) + '</p>'
        + `<div class="plano-botoes"><button type="button" class="auth-btn home-btn-start" id="planoSalvarBtn">${pl ? 'Atualizar plano' : 'Criar plano'}</button>`
        + (pl ? '<button type="button" class="aparencia-btn" id="planoRemoverBtn">Remover plano</button>' : '') + '</div>'
        + '<p class="desemp-nota" id="planoMsg"></p></div></section>';
}
function renderPlano() {
    const el = document.getElementById('painelPlano');
    const pl = planoAtivo(), r = _rascunhoPlano(el);
    let h = _formPlanoHtml(r, pl);
    el._calc = null;
    if (pl && pl.data) {
        const c = calcularPlano(pl);
        if (c.dias < 0) h += '<section class="desemp-bloco"><p class="desemp-nota">A data da prova já passou. Atualize o plano com a próxima prova.</p></section>';
        else {
            const prov = escapeHtml(pl.prova);
            h += `<section class="desemp-bloco"><h2>📆 Hoje</h2><p class="plano-destaque">Faltam <b>${_plural(c.dias, 'dia', 'dias')}</b> para a prova ${prov} (${_dataBr(pl.data)}).</p>`
                + `<p>Tempo de estudo hoje (${DIAS_SEMANA[c.dow].toLowerCase()}): <b>${c.minDia ? _hm(c.minDia) : 'nenhum'}</b> · na semana: <b>${_hm(c.minSemana)}</b>.</p>`
                + `<p>Revisões de hoje: ${_plural(c.revQ, 'questão', 'questões')} e ${_plural(c.revC, 'cartão', 'cartões')} (≈ ${_hm(c.minRev)}).</p>`
                + (c.minDia ? `<p class="plano-capacidade">Pelo seu tempo médio (${String(c.minQ).replace('.', ',')} min por questão), cabem <b>${_plural(c.cabem, 'questão', 'questões')}</b> hoje.`
                    + (c.limite ? ` Com o seu limite de <b>${c.limite}</b>, você tem <b>${_hm(c.minDia)}</b> hoje e cerca de <b>${String(Math.round(c.minPorQuestaoNoLimite * 10) / 10).replace('.', ',')} min por questão</b>`
                        + (c.minPorQuestaoNoLimite < c.minQ ? ' — menos que o seu tempo médio: talvez não dê para fazer todas.' : '.')
                        + (c.revQ >= c.limite ? ' As revisões já ocupam o limite: hoje não entram questões novas.' : '') : '') + '</p>' : '')
                + '<div class="plano-botoes"><button type="button" class="aparencia-btn" id="planoRevisaoBtn">🔁 Revisão espaçada</button><button type="button" class="aparencia-btn" id="planoCartoesBtn">🃏 Cartões</button></div>'
                + (c.minDia ? `<p>Questões novas para hoje: <b>${c.novas}</b>${c.novas ? (_priorizar(pl) ? `, distribuídas pelo peso de cada disciplina na ${prov} (${escapeHtml(c.anos.slice(-1)[0] || '')}–${escapeHtml(c.anos[0] || '')}):` : ', misturadas de todas as bancas, pelo peso de cada disciplina no acervo:') : '. As revisões ocupam todo o tempo de hoje.'}</p>`
                    : '<p>Hoje não é um dia de estudo no seu plano: sem questões novas. Se quiser, faça as revisões.</p>');
            const linhas = c.dist.filter(x => x.q > 0);
            if (c.minDia && linhas.length) {
                h += '<div class="desemp-lista">' + linhas.map(x => `<div class="desemp-linha"><span class="desemp-nome">${escapeHtml(x.d)} <small>${Math.round(x.p * 100)}%</small></span>`
                    + `<span class="desemp-num">${Math.min(x.feitas, x.q)}/${x.q}${x.feitas >= x.q ? ' ✅' : ''}</span>${_barra(Math.min(x.feitas, x.q), x.q)}`
                    + `<button type="button" class="aparencia-btn plano-praticar" data-d="${escapeHtml(x.d)}" ${x.feitas >= x.q ? 'disabled' : ''}>Praticar</button></div>`).join('') + '</div>'
                    + '<button type="button" class="auth-btn home-btn-start revisao-iniciar" id="planoComecarBtn">▶ Começar as questões de hoje</button>';
            }
            h += '</section>';
            const qual = _priorizar(pl) ? `da ${prov}` : 'do acervo';
            let sit;
            if (!c.alvo) sit = `<p class="plano-ok"><b>Todas as questões ${qual} já foram feitas.</b> ${_priorizar(pl) && c.falt.todas ? `As questões novas passam a vir das outras bancas (${c.falt.todas} por fazer).` : ''}</p>`;
            else if (!c.minSemana) sit = '<p class="plano-alerta">Marque pelo menos um dia e um horário para calcular o ritmo.</p>';
            else if (!c.sim.resta) sit = `<p class="plano-ok"><b>Ritmo adequado:</b> você deve terminar a tempo as ${c.alvo} questões ${qual}, por volta de ${_dataBr(c.sim.fim)}.</p>`;
            else sit = `<p class="plano-alerta"><b>Ritmo insuficiente:</b> até a prova, você deve resolver cerca de ${c.sim.novasTotal} das ${c.alvo} questões ${qual}`
                + (c.horasExtra ? `. Para terminar a tempo, seriam necessárias cerca de <b>${c.horasExtra} h a mais por semana</b>.` : c.horasExtra === null ? '. Nem com o dobro de horas daria tempo: priorize as disciplinas de maior peso.' : '.') + '</p>';
            h += `<section class="desemp-bloco"><h2>🧭 Situação do plano</h2>${sit}`
                + `<p class="desemp-nota">Faltam ${c.falt.prova} questões da ${prov} e ${c.falt.todas} no acervo inteiro. A previsão considera os seus horários, `
                + `${String(c.minQ).replace('.', ',')} min por questão e as revisões que o FSRS vai programar.</p></section>`;
            el._calc = c;
        }
    }
    el.innerHTML = h;
}
function _lerRascunho(el) {
    const r = _rascunhoPlano(el);
    r.prova = document.getElementById('planoProva')?.value || r.prova;
    r.data = document.getElementById('planoData')?.value || '';
    r.priorizar = !!document.getElementById('planoPriorizar')?.checked;
    const lim = parseInt(document.getElementById('planoLimite')?.value);
    r.limiteDiario = document.getElementById('planoLimiteChk')?.checked && lim > 0 ? Math.min(500, lim) : 0;
    el.querySelectorAll('.plano-dia').forEach(linha => {
        const d = +linha.dataset.dia;
        linha.querySelectorAll('input[type=time]').forEach(inp => { const x = r.disponibilidade[d][+inp.dataset.i]; if (x) x[inp.dataset.campo] = inp.value; });
    });
    return r;
}
document.getElementById('painelPlano').addEventListener('change', e => {
    const el = e.currentTarget, r = _lerRascunho(el), linha = e.target.closest('.plano-dia');
    if (e.target.id === 'planoLimiteChk') {
        const box = el.querySelector('.plano-limite'); box.hidden = !e.target.checked;
        if (e.target.checked) { const i = document.getElementById('planoLimite'); if (!i.value) i.value = 30; i.focus(); }
    } else if (linha && e.target.dataset.acao === 'dia') {
        const d = +linha.dataset.dia;
        r.disponibilidade[d] = e.target.checked ? [{ ini: '19:00', fim: '21:00' }] : [];
        renderPlano();
    } else if (e.target.type === 'time') {
        const tot = el.querySelector('.plano-total b'); if (tot) tot.textContent = `${_hm(ORDEM_DIAS.reduce((t, d) => t + minutosDoDia(r.disponibilidade, d), 0))} por semana`;
        if (linha) linha.querySelector(':scope > .desemp-num').textContent = _hm(minutosDoDia(r.disponibilidade, +linha.dataset.dia));
    }
});
document.getElementById('painelPlano').addEventListener('click', async e => {
    const el = e.currentTarget, id = e.target.id, linha = e.target.closest('.plano-dia');
    if (linha && (e.target.dataset.acao === 'add' || e.target.dataset.acao === 'del')) {
        const r = _lerRascunho(el), d = +linha.dataset.dia, lista = r.disponibilidade[d];
        if (e.target.dataset.acao === 'add') { const ult = lista[lista.length - 1]; lista.push({ ini: ult ? ult.fim : '07:00', fim: ult ? (_min(ult.fim) + 60 < 1440 ? `${String(Math.floor((_min(ult.fim) + 60) / 60)).padStart(2, '0')}:${ult.fim.slice(3)}` : '23:59') : '08:00' }); }
        else lista.splice(+e.target.dataset.i, 1);
        return renderPlano();
    }
    if (id === 'planoSalvarBtn') {
        const r = _lerRascunho(el);
        const msg = t => { document.getElementById('planoMsg').textContent = t; };
        if (!r.data) return msg('Escolha a data da prova.');
        for (const d of ORDEM_DIAS) for (const x of r.disponibilidade[d]) {
            if (_min(x.ini) == null || _min(x.fim) == null || _min(x.fim) <= _min(x.ini)) return msg(`${DIAS_SEMANA[d]}: o fim de cada horário deve ser depois do início.`);
        }
        if (!ORDEM_DIAS.some(d => r.disponibilidade[d].length)) return msg('Marque pelo menos um dia de estudo.');
        if (document.getElementById('planoLimiteChk')?.checked && !r.limiteDiario) return msg('Informe o número máximo de questões por dia.');
        progress.plano = { prova: r.prova, data: r.data, priorizar: r.priorizar, disponibilidade: JSON.parse(JSON.stringify(r.disponibilidade)),
                           limiteDiario: r.limiteDiario || null, atualizado: new Date().toISOString() };
        el._rasc = null;
        setDirty(true); salvarBackup(); renderPlano();
    } else if (id === 'planoRemoverBtn') {
        if (!confirm('Remover o plano de estudo?')) return;
        progress.plano = { removido: true, atualizado: new Date().toISOString() };
        el._rasc = null;
        setDirty(true); salvarBackup(); renderPlano();
    } else if (id === 'planoRevisaoBtn') abrirTelaRevisao();
    else if (id === 'planoCartoesBtn') abrirTelaCartoes();
    else if (id === 'planoComecarBtn' && el._calc) await estudarGrupo(questoesDoPlanoDeHoje(planoAtivo(), el._calc.dist), 'Plano de hoje');
    else if (e.target.closest('.plano-praticar') && el._calc) {
        const d = e.target.closest('.plano-praticar').dataset.d;
        await estudarGrupo(questoesDoPlanoDeHoje(planoAtivo(), el._calc.dist, d), `Plano de hoje — ${d}`);
    }
});

/* ---------- meta do dia na tela inicial (calculada pelo plano) ---------- */
function atualizarMetaDoPlano() {
    const el = document.getElementById('metaPlanoHoje');
    if (!el) return;
    const pl = planoAtivo();
    if (!currentRA || !pl || !pl.data || !Object.keys(exams || {}).length) { el.hidden = true; return; }
    try {
        const c = calcularPlano(pl, true);
        if (c.dias < 0) { el.hidden = true; return; }
        const feitas = questoesDeHoje();
        el.textContent = c.metaHoje ? `🎯 Plano de hoje: ${Math.min(feitas, c.metaHoje)}/${c.metaHoje} questões${feitas >= c.metaHoje ? ' ✅' : ''}`
            : '🎯 Plano de hoje: sem questões programadas';
        el.hidden = false;
    } catch (e) { el.hidden = true; console.warn('plano:', e); }
}
document.getElementById('metaPlanoHoje')?.addEventListener('click', () => abrirTelaDesempenho('plano'));
const _showHomePlano = showHome;
showHome = function () { _showHomePlano(); setTimeout(atualizarMetaDoPlano, 0); };

/* ---------- filtro "Questões do plano de hoje" (painel Filtros da barra inferior) ---------- */
const soPlanoHoje = document.getElementById('soPlanoHoje');
const _ehPlanoHoje = () => !!(Array.isArray(filtros.lista) && filtros.lista.length && /^Plano de hoje/.test(filtros.listaNome || ''));
const _atualizarFiltrosAtivosPlano = atualizarFiltrosAtivos;
atualizarFiltrosAtivos = function () {
    _atualizarFiltrosAtivosPlano();
    const on = _ehPlanoHoje();
    soPlanoHoje.checked = on;
    if (on) filtrosAtivos.textContent = String((parseInt(filtrosAtivos.textContent) || 0) + 1);
};
soPlanoHoje.addEventListener('change', async () => {
    if (!soPlanoHoje.checked) {
        restaurarFiltrosAnteriores(); renderAllFilterUI(); await rebuildQuestoes();
        return;
    }
    const pl = planoAtivo();
    if (!pl || !pl.data) { soPlanoHoje.checked = false; alert('Você ainda não tem um plano de estudo. Crie o seu em Desempenho → Plano.'); return; }
    const c = calcularPlano(pl);
    const lista = c.dias < 0 ? [] : questoesDoPlanoDeHoje(pl, c.dist);
    if (!lista.length) { soPlanoHoje.checked = false; alert('Não há questões novas do plano para hoje.'); return; }
    await estudarGrupo(lista, 'Plano de hoje');
});
