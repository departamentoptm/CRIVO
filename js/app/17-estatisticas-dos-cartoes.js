/* ============================================================
   ESTATÍSTICAS DOS CARTÕES (como no Anki: https://docs.ankiweb.net/stats.html)
   Classificação de cada cartão (o agendamento continua o do FSRS, sem passos de aprendizagem):
     - Novo: nunca revisado;
     - Aprendendo: já visto, mas ainda sem acerto (só "Errei") ou com intervalo menor que 1 dia;
     - Reaprendendo: errado ("Errei") depois de já ter acertado, até o próximo acerto;
     - Recente: intervalo menor que 21 dias; Maduro: intervalo de 21 dias ou mais.
   Tipo de cada revisão (pelo estado antes dela): Aprendizado (novo/aprendendo), Revisão (recente/maduro) e
   Reaprendizado. Retenção (no Anki, "True retention") = % de revisões do tipo Revisão respondidas com Difícil, Bom ou Fácil.
   Tempo de cada cartão: da frente aparecer até a nota, no máximo 60 s (medido desde a atualização 30).
   - Tela dos cartões: botão "📊 Painel" (gráficos e lista de todos os cartões) e "ℹ️ Dados do cartão".
   - Desempenho: mapas de calor (questões e cartões), bloco dos cartões e cartões por disciplina e tema.
   ============================================================ */
const CLASSES_CARTAO = [['novo', 'Novos', '#3b82f6'], ['aprendendo', 'Aprendendo', '#f59e0b'], ['reaprendendo', 'Reaprendendo', '#ef4444'],
                        ['recente', 'Recentes', '#4ade80'], ['maduro', 'Maduros', '#15803d']];
const ROTULO_CLASSE = { novo: 'Novo', aprendendo: 'Aprendendo', reaprendendo: 'Reaprendendo', recente: 'Recente', maduro: 'Maduro' };
const DIAS_MADURO = 21;
const NOTAS_CARTAO = { 1: 'Errei', 2: 'Difícil', 3: 'Bom', 4: 'Fácil' };
const _ivlDias = s => s ? (s.proxima - s.ultima) / DIA_MS : 0;

function _classeDe(s, teveAcerto, ultimaNota) {
    if (!s) return 'novo';
    if (ultimaNota === 1) return teveAcerto ? 'reaprendendo' : 'aprendendo';
    const i = _ivlDias(s);
    if (i < 1) return 'aprendendo';
    return i < DIAS_MADURO ? 'recente' : 'maduro';
}
const _tipoRevisao = antes => antes === 'recente' || antes === 'maduro' ? 'Revisão' : antes === 'reaprendendo' ? 'Reaprendizado' : 'Aprendizado';

/* histórico de um cartão: cada revisão com o estado antes, o intervalo, a estabilidade, a dificuldade e o tempo */
function historicoCartao(c) {
    const desde = c.reativado && c.apagado ? c.reativado : '';
    const revs = (c.revisoes || []).filter(v => v && !(desde && String(v.data) < desde))
        .slice().sort((a, b) => new Date(a.data) - new Date(b.data));
    let s = null, acerto = false, ult = 0;
    const log = [];
    for (const v of revs) {
        const t = +new Date(v.data), g = +v.nota;
        if (!t || g < 1 || g > 4) continue;
        const antes = _classeDe(s, acerto, ult);
        s = fsrsRevisar(s ? { ...s } : null, g, t);
        if (g > 1) acerto = true;
        ult = g;
        log.push({ t, nota: g, antes, ivl: _ivlDias(s), s: s.s, d: s.d, tempoMs: Math.min(60000, +v.tempoMs || 0) });
    }
    return { log, estado: s, classe: _classeDe(s, acerto, ult) };
}
/* todos os cartões ativos, com o histórico e a classificação */
function dadosDosCartoes() {
    return listarCartoes().map(x => Object.assign(x, historicoCartao(x.c)));
}
function contarClasses(itens) {
    const cont = { novo: 0, aprendendo: 0, reaprendendo: 0, recente: 0, maduro: 0 };
    itens.forEach(x => { cont[x.classe]++; });
    return cont;
}
/* retenção (True retention do Anki) entre ini e fim (ms): revisões de cartões recentes e maduros */
function retencaoVerdadeira(itens, ini = 0, fim = Infinity) {
    const r = { recente: { ok: 0, n: 0 }, maduro: { ok: 0, n: 0 } };
    for (const x of itens) for (const l of x.log) {
        if (l.t < ini || l.t >= fim || !r[l.antes]) continue;
        r[l.antes].n++; if (l.nota > 1) r[l.antes].ok++;
    }
    r.total = { ok: r.recente.ok + r.maduro.ok, n: r.recente.n + r.maduro.n };
    return r;
}
const _pctTxt = z => z.n ? `${_pct(z.ok, z.n)}%` : '—';
function _fmtDias(d) {
    if (d == null || !isFinite(d)) return '—';
    if (d < 1) return 'menos de 1 dia';
    if (d < 31) return `${Math.round(d)} ${Math.round(d) === 1 ? 'dia' : 'dias'}`;
    if (d < 365) return `${(d / 30).toFixed(1).replace('.', ',')} meses`;
    return `${(d / 365).toFixed(1).replace('.', ',')} anos`;
}
const _fmtSeg = ms => ms ? (ms < 60000 ? `${Math.round(ms / 1000)} s` : _tempoCurto(ms)) : '—';
const _dataCurta = t => new Date(t).toLocaleDateString('pt-BR');
const _dataHora = t => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const _difPct = d => Math.round((d - 1) / 9 * 100);

/* ---------- gráficos simples (HTML) ---------- */
function _colunas(itens, cor) {
    const max = Math.max(1, ...itens.map(i => i.n));
    return `<div class="cart-colunas" style="grid-template-columns: repeat(${itens.length}, 1fr)">` + itens.map(i =>
        `<div class="cart-col" title="${escapeHtml(i.tit || `${i.rot}: ${i.n}`)}"><span class="cart-col-n">${i.n && itens.length <= 12 ? i.n : ''}</span>`
        + `<span class="cart-col-barra"><span style="height:${Math.round(100 * i.n / max)}%${cor ? `;background:${cor}` : ''}"></span></span>`
        + `<span class="cart-col-rot">${escapeHtml(i.mostrar === false ? '' : (i.rot || ''))}</span></div>`).join('') + '</div>';
}
function rosca(cont) {
    const total = Object.values(cont).reduce((a, b) => a + b, 0);
    let acc = 0;
    const partes = CLASSES_CARTAO.map(([k, , cor]) => { const p = total ? 100 * cont[k] / total : 0; const seg = `${cor} ${acc.toFixed(2)}% ${(acc + p).toFixed(2)}%`; acc += p; return seg; });
    return `<div class="cart-rosca-wrap"><div class="cart-rosca" style="background:${total ? `conic-gradient(${partes.join(', ')})` : '#e5e7eb'}">`
        + `<span><b>${total}</b><small>${total === 1 ? 'cartão' : 'cartões'}</small></span></div><div class="cart-legenda">`
        + CLASSES_CARTAO.map(([k, r, cor]) => `<div><i style="background:${cor}"></i><span>${r}</span><b>${cont[k]}</b><small>${_pct(cont[k], total)}%</small></div>`).join('')
        + '</div></div>';
}
function _faixas(valores, limites) {
    return limites.map(([a, b, rot]) => ({ rot, n: valores.filter(v => v >= a && v < b).length }));
}
const FAIXAS_DIAS = [[0, 1.5, '1d'], [1.5, 2.5, '2d'], [2.5, 6.5, '3–6d'], [6.5, 13.5, '1–2 sem'], [13.5, 20.5, '2–3 sem'], [20.5, 44.5, '3–6 sem'],
                     [44.5, 89.5, '1,5–3 m'], [89.5, 179.5, '3–6 m'], [179.5, 364.5, '6–12 m'], [364.5, Infinity, '1 ano+']];

/* ---------- painel (tela dos cartões) ---------- */
const painelCartoes = { banca: '', ano: '', disc: '', tema: '', classe: '', ordem: 'vence', desc: false };
function _secao(titulo, corpo, nota) {
    return `<section class="desemp-bloco"><h2>${titulo}</h2>${corpo}${nota ? `<p class="desemp-nota">${nota}</p>` : ''}</section>`;
}
function _tabelaRetencao(itens) {
    const h0 = new Date(); h0.setHours(0, 0, 0, 0);
    const t0 = +h0, agora = Date.now() + 1;
    const periodos = [['Hoje', t0, agora], ['Ontem', t0 - DIA_MS, t0], ['Última semana', t0 - 6 * DIA_MS, agora],
                      ['Último mês', t0 - 29 * DIA_MS, agora], ['Último ano', t0 - 364 * DIA_MS, agora]];
    const cel = z => `<td title="${z.ok} de ${z.n} acertos">${_pctTxt(z)}<small>${z.n ? ` (${z.ok}/${z.n})` : ''}</small></td>`;
    return '<div class="cart-tabela-wrap"><table class="cart-tabela"><thead><tr><th></th><th>Recentes</th><th>Maduros</th><th>Total</th></tr></thead><tbody>'
        + periodos.map(([rot, a, b]) => { const r = retencaoVerdadeira(itens, a, b); return `<tr><th>${rot}</th>${cel(r.recente)}${cel(r.maduro)}${cel(r.total)}</tr>`; }).join('')
        + '</tbody></table></div>';
}
function _botoesResposta(itens, ini) {
    const grupos = [['Aprendizado', l => l.antes === 'novo' || l.antes === 'aprendendo' || l.antes === 'reaprendendo'],
                    ['Recentes', l => l.antes === 'recente'], ['Maduros', l => l.antes === 'maduro']];
    return '<div class="cart-tabela-wrap"><table class="cart-tabela"><thead><tr><th></th>' + [1, 2, 3, 4].map(g => `<th>${NOTAS_CARTAO[g]}</th>`).join('') + '<th>Acerto</th></tr></thead><tbody>'
        + grupos.map(([rot, f]) => {
            const c = { 1: 0, 2: 0, 3: 0, 4: 0 };
            itens.forEach(x => x.log.forEach(l => { if (l.t >= ini && f(l)) c[l.nota]++; }));
            const n = c[1] + c[2] + c[3] + c[4];
            return `<tr><th>${rot}</th>${[1, 2, 3, 4].map(g => `<td>${c[g]}</td>`).join('')}<td>${n ? _pct(n - c[1], n) + '%' : '—'}</td></tr>`;
        }).join('') + '</tbody></table></div>';
}
function renderPainelCartoes() {
    const el = document.getElementById('cartPainel');
    const itens = dadosDosCartoes();
    if (!itens.length) { el.innerHTML = '<div class="revisao-vazia">Você ainda não tem cartões. Grife trechos da correção e marque, com o mesmo número, um trecho como "Frente" e outro como "Verso", ou marque um trecho como "Cloze". 🖍️</div>'; return; }
    const cont = contarClasses(itens), h0 = new Date(); h0.setHours(0, 0, 0, 0);
    const ini30 = +h0 - 29 * DIA_MS;
    /* previsão: cartões que vencem em cada um dos próximos 30 dias (os atrasados contam em hoje) */
    const prev = Array.from({ length: 30 }, (_, i) => ({ rot: i === 0 ? 'hoje' : `+${i}`, n: 0, mostrar: i % 5 === 0 }));
    itens.forEach(x => { if (!x.estado) return; const i = Math.max(0, Math.floor((x.estado.proxima - h0) / DIA_MS)); if (i < 30) prev[i].n++; });
    prev.forEach((p, i) => { p.tit = `${i === 0 ? 'Hoje (com os atrasados)' : _dataCurta(+h0 + i * DIA_MS)}: ${p.n}`; });
    /* revisões por dia (últimos 30 dias) */
    const porDia = Array.from({ length: 30 }, (_, i) => ({ t: ini30 + i * DIA_MS, n: 0, ok: 0 }));
    const porHora = Array.from({ length: 24 }, (_, h) => ({ rot: String(h), n: 0, ok: 0, mostrar: h % 3 === 0 }));
    let tempoTot = 0, tempoN = 0;
    itens.forEach(x => x.log.forEach(l => {
        if (l.tempoMs) { tempoTot += l.tempoMs; tempoN++; }
        if (l.t < ini30) return;
        const i = Math.floor((l.t - ini30) / DIA_MS);
        if (porDia[i]) { porDia[i].n++; if (l.nota > 1) porDia[i].ok++; }
        const hr = porHora[new Date(l.t).getHours()]; hr.n++; if (l.nota > 1) hr.ok++;
    }));
    const dias = porDia.map((d, i) => ({ rot: new Date(d.t).getDate() + '', n: d.n, mostrar: i % 5 === 4, tit: `${_dataCurta(d.t)}: ${d.n} revisões, ${_pct(d.ok, d.n)}% de acerto` }));
    porHora.forEach(h => { h.tit = `${h.rot} h: ${h.n} revisões, ${_pct(h.ok, h.n)}% de acerto`; });
    const comEstado = itens.filter(x => x.estado);
    const agora = Date.now();
    const ret = retencaoVerdadeira(itens);
    let h = '<div class="desemp-resumo">'
        + `<div><b>${itens.length}</b><span>cartões</span></div>`
        + `<div><b>${_pctTxt(ret.total)}</b><span>Retenção (total)</span></div>`
        + `<div><b>${_fmtSeg(tempoN ? tempoTot / tempoN : 0)}</b><span>tempo médio por cartão</span></div></div>`;
    h += _secao('🧮 Quantidade por classificação', rosca(cont),
        'Novo: nunca revisado. Aprendendo: visto, ainda sem acerto. Reaprendendo: errado depois de já ter acertado, até o próximo acerto. Recente: intervalo menor que 21 dias. Maduro: 21 dias ou mais.');
    h += _secao('🔮 Previsão de revisões (próximos 30 dias)', _colunas(prev, '#6f42c1'), 'Cartões que vencem em cada dia; os atrasados contam em hoje.');
    h += _secao('📆 Revisões por dia (últimos 30 dias)', _colunas(dias), 'Toque numa barra para ver o número e o acerto do dia.');
    h += _secao('✅ Retenção', _tabelaRetencao(itens),
        'Retenção (no Anki, “True retention”): porcentagem de revisões de cartões recentes e maduros respondidas com Difícil, Bom ou Fácil (sem contar o aprendizado). O FSRS do CRIVO mira 90%.');
    h += _secao('🔘 Botões de resposta (últimos 30 dias)', _botoesResposta(itens, ini30));
    h += _secao('⏳ Intervalos', _colunas(_faixas(comEstado.map(x => _ivlDias(x.estado)), FAIXAS_DIAS), '#2b3f9a'), 'Intervalo atual de cada cartão já revisado.');
    h += _secao('📈 Estabilidade', _colunas(_faixas(comEstado.map(x => x.estado.s), FAIXAS_DIAS), '#0e93ac'),
        'Estabilidade (FSRS): em quantos dias a chance de lembrar cai para 90%.');
    h += _secao('🎚️ Dificuldade', _colunas(Array.from({ length: 10 }, (_, i) => ({ rot: `${i * 10}%`, mostrar: i % 2 === 0,
        n: comEstado.filter(x => Math.min(9, Math.floor(_difPct(x.estado.d) / 10)) === i).length })), '#ea8a0c'), 'Dificuldade (FSRS), de 0% (fácil) a 100% (difícil).');
    h += _secao('🧠 Retenção atual (chance de lembrar hoje)', _colunas([[0, 50, '<50%'], [50, 60, '50%'], [60, 70, '60%'], [70, 80, '70%'], [80, 90, '80%'], [90, 101, '90%+']].map(([a, b, rot]) =>
        ({ rot, n: comEstado.filter(x => { const r = 100 * fsrsR(Math.max(0, (agora - x.estado.ultima) / DIA_MS), x.estado.s); return r >= a && r < b; }).length })), '#16a34a'),
        'Retrievability (FSRS) de cada cartão agora.');
    h += _secao('🕐 Horários (últimos 30 dias)', _colunas(porHora, '#a63268'), 'Revisões em cada hora do dia; toque numa barra para ver o acerto.');
    h += '<section class="desemp-bloco"><h2>🗂️ Todos os cartões</h2><div id="cartListaPainel"></div></section>';
    el.innerHTML = h;
    el._itens = itens;
    renderListaPainel();
}
function renderListaPainel() {
    const el = document.getElementById('cartPainel'), box = document.getElementById('cartListaPainel');
    if (!box) return;
    const f = painelCartoes, itens = el._itens || [];
    const info = itens.map(x => Object.assign(x, { disc: disciplinaDe(x.c.prova, x.c.ano, x.c.questao) || '', tema: temaDe(x.c.prova, x.c.ano, x.c.questao) || '' }));
    const opc = (lista, rot, sel) => `<option value="">${rot}</option>` + lista.map(v => `<option value="${escapeHtml(v)}" ${v === sel ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
    const uniq = fn => [...new Set(info.map(fn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
    const lista = info.filter(x => (!f.banca || x.c.prova === f.banca) && (!f.ano || String(x.c.ano) === f.ano) && (!f.disc || x.disc === f.disc)
        && (!f.tema || x.tema === f.tema) && (!f.classe || x.classe === f.classe));
    const chave = {
        cartao: x => `${x.c.prova} ${x.c.ano} ${String(x.c.questao).padStart(4, '0')} ${String(x.c.numero).padStart(4, '0')} ${x.c.dir}`,
        classe: x => CLASSES_CARTAO.findIndex(([k]) => k === x.classe),
        vence: x => x.estado ? x.estado.proxima : -1, ivl: x => _ivlDias(x.estado), dif: x => x.estado ? x.estado.d : -1,
        revs: x => x.log.length, erros: x => x.log.filter(l => l.nota === 1).length,
    }[f.ordem] || (x => 0);
    lista.sort((a, b) => { const p = chave(a), q = chave(b); const r = p < q ? -1 : p > q ? 1 : 0; return f.desc ? -r : r; });
    const col = (k, t) => `<th><button type="button" class="cart-ordem" data-ordem="${k}">${t}${f.ordem === k ? (f.desc ? ' ▾' : ' ▴') : ''}</button></th>`;
    box.innerHTML = '<div class="gab-filters cart-filtros">'
        + `<select id="cpBanca" aria-label="Banca">${opc(uniq(x => x.c.prova), 'Todas as bancas', f.banca)}</select>`
        + `<select id="cpAno" aria-label="Edição">${opc(uniq(x => String(x.c.ano)).reverse(), 'Todas as edições', f.ano)}</select>`
        + `<select id="cpDisc" aria-label="Disciplina">${opc(uniq(x => x.disc), 'Todas as disciplinas', f.disc)}</select>`
        + `<select id="cpTema" aria-label="Tema">${opc(uniq(x => (!f.disc || x.disc === f.disc) ? x.tema : ''), 'Todos os temas', f.tema)}</select>`
        + `<select id="cpClasse" aria-label="Classificação"><option value="">Todas as classificações</option>${CLASSES_CARTAO.map(([k, r]) => `<option value="${k}" ${k === f.classe ? 'selected' : ''}>${r}</option>`).join('')}</select>`
        + `</div><p class="desemp-nota">${_plural(lista.length, 'cartão', 'cartões')}. Toque num cartão para ver os dados dele; toque no título de uma coluna para ordenar.</p>`
        + '<div class="cart-tabela-wrap"><table class="cart-tabela cart-lista"><thead><tr>' + col('cartao', 'Cartão') + col('classe', 'Classificação') + col('vence', 'Vence')
        + col('ivl', 'Intervalo') + col('dif', 'Dificuldade') + col('revs', 'Revisões') + col('erros', 'Erros') + '</tr></thead><tbody>'
        + lista.map(x => `<tr class="cart-linha" data-id="${escapeHtml(x.id)}" tabindex="0" role="button">`
            + `<td>${escapeHtml(`${x.c.prova} ${x.c.ano} Q${x.c.questao} · nº ${x.c.numero} · ${x.c.dir === 'cz' ? 'Cloze' : x.c.dir === 'vf' ? 'V→F' : 'F→V'}`)}${x.orfao ? ' ⚠️' : ''}</td>`
            + `<td><span class="cart-classe ${x.classe}">${ROTULO_CLASSE[x.classe]}</span></td>`
            + `<td>${x.estado ? _dataCurta(x.estado.proxima) : '—'}</td><td>${x.estado ? _fmtDias(_ivlDias(x.estado)) : '—'}</td>`
            + `<td>${x.estado ? _difPct(x.estado.d) + '%' : '—'}</td><td>${x.log.length}</td><td>${x.log.filter(l => l.nota === 1).length}</td></tr>`).join('')
        + '</tbody></table></div>';
}
function abrirPainelCartoes(abrir) {
    const p = document.getElementById('cartPainel'), btn = document.getElementById('cartPainelBtn');
    p.hidden = !abrir;
    btn.setAttribute('aria-expanded', String(abrir));
    btn.textContent = abrir ? '← Voltar aos cartões' : '📊 Painel';
    document.getElementById('cartListaArea').hidden = abrir || cartEmSessao;
    document.getElementById('cartSessao').hidden = abrir || !cartEmSessao;
    const exp = document.querySelector('.cartoes-exportar'); if (exp) exp.hidden = abrir;
    if (abrir) renderPainelCartoes(); else if (!cartEmSessao) renderListaCartoes();
}
document.getElementById('cartPainelBtn').addEventListener('click', () => abrirPainelCartoes(document.getElementById('cartPainel').hidden));
document.getElementById('cartPainel').addEventListener('change', e => {
    const m = { cpBanca: 'banca', cpAno: 'ano', cpDisc: 'disc', cpTema: 'tema', cpClasse: 'classe' }[e.target.id];
    if (!m) return;
    painelCartoes[m] = e.target.value;
    if (m === 'disc') painelCartoes.tema = '';
    renderListaPainel();
});
document.getElementById('cartPainel').addEventListener('click', e => {
    const o = e.target.closest('.cart-ordem');
    if (o) { if (painelCartoes.ordem === o.dataset.ordem) painelCartoes.desc = !painelCartoes.desc; else { painelCartoes.ordem = o.dataset.ordem; painelCartoes.desc = false; } return renderListaPainel(); }
    const l = e.target.closest('.cart-linha');
    if (l) abrirDadosCartao(l.dataset.id);
});
document.getElementById('cartPainel').addEventListener('keydown', e => {
    const l = e.target.closest && e.target.closest('.cart-linha');
    if (l && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirDadosCartao(l.dataset.id); }
});
/* voltar: fecha o painel antes de sair da tela */
document.getElementById('backFromCartoesBtn').addEventListener('click', e => {
    if (document.getElementById('cartPainel').hidden) return;
    e.stopImmediatePropagation();
    abrirPainelCartoes(false);
}, true);
const _abrirTelaCartoesPainel = abrirTelaCartoes;
abrirTelaCartoes = async function (...a) { document.getElementById('cartPainel').hidden = true; abrirPainelCartoes(false); return _abrirTelaCartoesPainel(...a); };
cartoesBtnHome.addEventListener('click', () => { if (!document.getElementById('cartPainel').hidden) abrirPainelCartoes(false); });

/* ---------- dados de um cartão (como o "Card Info" do Anki) ---------- */
function abrirDadosCartao(id) {
    const c = progress.cartoes[id];
    if (!c) return;
    const { log, estado, classe } = historicoCartao(c);
    const agora = Date.now(), tempos = log.filter(l => l.tempoMs), tot = tempos.reduce((a, l) => a + l.tempoMs, 0);
    const lin = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    const ov = document.createElement('div');
    ov.className = 'modal-overlay'; ov.id = 'cartInfoOverlay';
    ov.innerHTML = '<div class="modal cart-info" role="dialog" aria-modal="true" aria-labelledby="cartInfoTit">'
        + `<h3 id="cartInfoTit">ℹ️ ${_rotuloCartao(c)}</h3>`
        + (c.dir === 'cz' ? `<div class="cart-info-faces cloze"><div><small>Cloze</small>${clozeHtml(c, true)}</div></div>`
            : `<div class="cart-info-faces"><div><small>Frente</small>${_paraHtml(c.frente || [])}</div><div><small>Verso</small>${_paraHtml(c.verso || [])}</div></div>`)
        + '<div class="cart-info-grade">'
        + lin('Classificação', `<span class="cart-classe ${classe}">${ROTULO_CLASSE[classe]}</span>`)
        + lin('Criado em', c.criado ? _dataCurta(c.criado) : '—')
        + lin('Primeira revisão', log.length ? _dataCurta(log[0].t) : '—')
        + lin('Última revisão', log.length ? _dataCurta(log[log.length - 1].t) : '—')
        + lin('Próxima revisão', estado ? _dataCurta(estado.proxima) : 'nova')
        + lin('Intervalo', estado ? _fmtDias(_ivlDias(estado)) : '—')
        + lin('Estabilidade', estado ? _fmtDias(estado.s) : '—')
        + lin('Dificuldade', estado ? _difPct(estado.d) + '%' : '—')
        + lin('Retenção atual', estado ? Math.round(100 * fsrsR(Math.max(0, (agora - estado.ultima) / DIA_MS), estado.s)) + '%' : '—')
        + lin('Revisões', log.length) + lin('Erros (lapsos)', log.filter(l => l.nota === 1 && (l.antes === 'recente' || l.antes === 'maduro')).length)
        + lin('Tempo médio', _fmtSeg(tempos.length ? tot / tempos.length : 0)) + lin('Tempo total', _fmtSeg(tot))
        + '</div>'
        + (log.length ? '<div class="cart-tabela-wrap"><table class="cart-tabela"><thead><tr><th>Data</th><th>Tipo</th><th>Nota</th><th>Intervalo</th><th>Dificuldade</th><th>Tempo</th></tr></thead><tbody>'
            + log.slice().reverse().map(l => `<tr><td>${_dataHora(l.t)}</td><td>${_tipoRevisao(l.antes)}</td><td class="nota-${l.nota}">${NOTAS_CARTAO[l.nota]}</td>`
                + `<td>${_fmtDias(l.ivl)}</td><td>${_difPct(l.d)}%</td><td>${l.tempoMs ? _fmtSeg(l.tempoMs) : '—'}</td></tr>`).join('')
            + '</tbody></table></div>' : '<p class="desemp-nota">Este cartão ainda não foi revisado.</p>')
        + '<div class="escolha-botoes cart-info-botoes"><button type="button" class="aparencia-btn" data-acao="questao">📄 Abrir a questão de origem</button>'
        + '<button type="button" class="aparencia-btn" data-acao="fechar">Fechar</button></div></div>';
    const fechar = () => { ov.remove(); document.removeEventListener('keydown', esc, true); };
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); } };
    ov.addEventListener('click', async e => {
        if (e.target === ov) return fechar();
        const b = e.target.closest('button[data-acao]');
        if (!b) return;
        fechar();
        if (b.dataset.acao === 'questao') await abrirQuestaoDoGabarito(c.prova, c.ano, c.questao);
    });
    document.addEventListener('keydown', esc, true);
    document.body.appendChild(ov);
    setTimeout(() => ov.querySelector('button[data-acao="fechar"]')?.focus(), 30);
}
document.getElementById('cartInfoBtn').addEventListener('click', () => { if (cartFila[0]) abrirDadosCartao(cartFila[0]); });

/* ---------- Desempenho: mapas de calor ---------- */
const _hmAno = { q: new Date().getFullYear(), c: new Date().getFullYear() };     /* ano mostrado em cada mapa */
function _contagemPorDia(tipo) {
    const m = new Map(), soma = t => { const d = isoDoDia(+new Date(t)); m.set(d, (m.get(d) || 0) + 1); };
    if (tipo === 'q') (progress.registro || []).forEach(e => { if (e.acao === 'confirmou') soma(e.data); });
    else Object.values(progress.cartoes || {}).forEach(c => ((c && c.revisoes) || []).forEach(v => soma(v.data)));
    return m;
}
const _MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/* mapa de calor de um ano (1º de janeiro a 31 de dezembro), uma coluna por semana, como no Anki */
function mapaDeCalor(tipo) {
    const m = _contagemPorDia(tipo), ano = _hmAno[tipo], hojeIso = isoDoDia(Date.now()), anoAtual = new Date().getFullYear();
    const anos = [...m.keys()].map(d => +d.slice(0, 4)), primeiro = Math.min(anoAtual, ...anos);
    const vals = []; for (const [d, n] of m) if (d.startsWith(ano + '-')) vals.push(n);
    const max = Math.max(1, ...vals), nivel = n => !n ? 0 : Math.min(4, Math.ceil(4 * n / max));
    const nome = tipo === 'q' ? ['questão', 'questões'] : ['revisão de cartão', 'revisões de cartões'];
    const ini = new Date(ano, 0, 1, 12), recuo = ini.getDay();          /* a 1ª coluna começa no domingo */
    const cel = Array.from({ length: recuo }, () => '<span class="hm-dia fora"></span>'), meses = [];
    for (const d = new Date(ini); d.getFullYear() === ano; d.setDate(d.getDate() + 1)) {
        const iso = isoDoDia(+d), n = m.get(iso) || 0, col = Math.floor((cel.length) / 7) + 1;
        if (d.getDate() === 1) meses.push(`<span style="grid-column:${col}">${_MESES[d.getMonth()]}</span>`);
        const quando = `${d.toLocaleDateString('pt-BR')}: ${n} ${n === 1 ? nome[0] : nome[1]}`;
        cel.push(iso > hojeIso ? `<span class="hm-dia futuro" title="${d.toLocaleDateString('pt-BR')}"></span>`
            : `<span class="hm-dia n${nivel(n)}${iso === hojeIso ? ' hoje' : ''}" data-dia="${iso}" data-tipo="${tipo}" role="button" title="${quando}"></span>`);
    }
    const colunas = Math.ceil(cel.length / 7);
    const total = vals.reduce((a, b) => a + b, 0), diasCom = vals.filter(Boolean).length;
    return `<section class="desemp-bloco hm-bloco hm-${tipo}" data-hm="${tipo}"><h2>${tipo === 'q' ? '🗓️ Questões por dia' : '🗓️ Cartões por dia'}</h2>`
        + `<div class="hm-nav"><button type="button" class="dia-btn hm-mover" data-tipo="${tipo}" data-passo="-1" aria-label="Ano anterior" ${ano <= primeiro ? 'disabled' : ''}>‹</button>`
        + `<b>${ano}</b><button type="button" class="dia-btn hm-mover" data-tipo="${tipo}" data-passo="1" aria-label="Próximo ano" ${ano >= anoAtual ? 'disabled' : ''}>›</button></div>`
        + '<div class="hm-corpo"><div class="hm-semana"><span></span><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div>'
        + `<div class="hm-rolar"><div class="hm-meses" style="grid-template-columns: repeat(${colunas}, 11px)">${meses.join('')}</div>`
        + `<div class="hm-grade">${cel.join('')}</div></div></div>`
        + `<p class="desemp-nota">${total} ${total === 1 ? nome[0] : nome[1]} em ${_plural(diasCom, 'dia', 'dias')} de estudo em ${ano}`
        + `${diasCom ? ` (média de ${Math.round(total / diasCom)} por dia de estudo)` : ''}. Toque num dia para ver o que foi feito nele.</p></section>`;
}
async function abrirGabaritoNoDia(dia) {
    progressFrom = 'home';
    await garantirDadosGabarito();
    renderProgressV2();
    const chk = document.getElementById('gabPorData'), inp = document.getElementById('gabDataInput'), box = document.getElementById('gabDataBox');
    if (chk && inp) { chk.checked = true; if (box) box.hidden = false; inp.value = dia; updateProgressDynamic(); }
    showScreen(progressScreen);
}
async function abrirCartoesNoDia(dia) {
    await abrirTelaCartoes();
    cartDiaSel = dia;
    renderListaCartoes();
}

/* ---------- Desempenho: bloco dos cartões ---------- */
function blocoCartoesDesempenho() {
    const itens = dadosDosCartoes();
    if (!itens.length) return _secao('🃏 Cartões', '<p class="desemp-nota">Você ainda não tem cartões dos grifos.</p>');
    const cont = contarClasses(itens), ret = retencaoVerdadeira(itens);
    let tot = 0, n = 0;
    itens.forEach(x => x.log.forEach(l => { if (l.tempoMs) { tot += l.tempoMs; n++; } }));
    return _secao('🃏 Cartões', rosca(cont) + '<div class="desemp-resumo cart-resumo">'
        + `<div><b>${_fmtSeg(n ? tot / n : 0)}</b><span>tempo médio por cartão</span></div>`
        + `<div><b>${_fmtSeg(tot)}</b><span>tempo total nos cartões</span></div>`
        + `<div><b>${_pctTxt(ret.total)}</b><span>Retenção</span></div></div>`,
        'Tempo de cada cartão: da frente aparecer até a nota, no máximo 60 s (medido desde a atualização 30). Retenção: revisões de cartões recentes e maduros respondidas com Difícil, Bom ou Fácil.');
}
/* cartões por grupo (os mesmos grupos e filtros do gráfico "Por disciplina e tema") */
function cartoesPorGrupo() {
    const f = desempFiltros, grupos = new Map();
    const pega = (mapa, k) => { if (!mapa.has(k)) mapa.set(k, { cont: { novo: 0, aprendendo: 0, reaprendendo: 0, recente: 0, maduro: 0 }, tot: 0, ok: 0, n: 0, sub: new Map() }); return mapa.get(k); };
    for (const x of dadosDosCartoes()) {
        const { prova: b, ano: a, questao: q } = x.c;
        if (f.banca && b !== f.banca) continue;
        if (f.ano && String(a) !== f.ano) continue;
        const d = disciplinaDe(b, a, q) || 'Sem disciplina';
        if (f.disciplina && d !== f.disciplina) continue;
        const [g1, g2] = f.modo === 'banca' ? [b, String(a)] : f.modo === 'banca-disciplina' ? [b, d] : [d, temaDe(b, a, q) || null];
        const r = retencaoVerdadeira([x]).total;
        for (const z of [pega(grupos, g1), g2 ? pega(pega(grupos, g1).sub, g2) : null]) {
            if (!z) continue;
            z.cont[x.classe]++; z.tot++; z.ok += r.ok; z.n += r.n;
        }
    }
    return grupos;
}
function miniCartoes(z) {
    const tot = z ? z.tot : 0;
    let acc = 0;
    const fundo = tot ? 'conic-gradient(' + CLASSES_CARTAO.map(([k, , cor]) => { const p = 100 * z.cont[k] / tot, seg = `${cor} ${acc.toFixed(2)}% ${(acc + p).toFixed(2)}%`; acc += p; return seg; }).join(', ') + ')' : '#e5e7eb';
    const tit = tot ? CLASSES_CARTAO.map(([k, r]) => `${r}: ${z.cont[k]}`).join(', ') : 'Nenhum cartão';
    return `<span class="graf-cartoes" title="${tit}"><span class="rosca-mini" style="background:${fundo}"></span>`
        + `<small>🃏 ${tot}<br>Retenção ${tot && z.n ? _pct(z.ok, z.n) + '%' : '—'}</small></span>`;
}
/* "🃏 Cartões" de um tema ou disciplina: todos os cartões dele (os que vencem primeiro), mesmo os que ainda não venceram */
async function abrirCartoesDoGrupo(disc, tema) {
    const ids = dadosDosCartoes().filter(x => (disciplinaDe(x.c.prova, x.c.ano, x.c.questao) || 'Sem disciplina') === disc
            && (!tema || temaDe(x.c.prova, x.c.ano, x.c.questao) === tema))
        .sort((a, b) => (a.estado ? a.estado.proxima : 0) - (b.estado ? b.estado.proxima : 0))
        .map(x => x.id);
    if (!ids.length) { alert('Não há cartões neste grupo.'); return; }
    await abrirTelaCartoes();
    iniciarSessaoCartoes(ids);
}
const _renderDesempenhoCartoes = renderDesempenho;
renderDesempenho = function () {
    _renderDesempenhoCartoes();
    const el = document.getElementById('painelDesempenho');
    if (!el) return;
    el.insertAdjacentHTML('afterbegin', `<div class="hm-area">${mapaDeCalor('q')}${mapaDeCalor('c')}</div>`);
    const nota = el.querySelector('.desemp-resumo + .desemp-nota');
    (nota || el.querySelector('.hm-area')).insertAdjacentHTML('afterend', `<div id="desempCartoes">${blocoCartoesDesempenho()}</div>`);
    _rolarMapas(el);
};
/* o mapa abre nos dias mais recentes (à direita) */
function _rolarMapas(raiz) {
    requestAnimationFrame(() => raiz.querySelectorAll('.hm-rolar').forEach(r => {
        const h = r.querySelector('.hm-dia.hoje');                 /* mostra o dia de hoje (no ano atual) */
        r.scrollLeft = h ? Math.max(0, h.offsetLeft - r.clientWidth + 40) : 0;
    }));
}
document.getElementById('painelDesempenho').addEventListener('click', e => {
    const mv = e.target.closest('.hm-mover');
    if (mv) {
        const t = mv.dataset.tipo;
        _hmAno[t] = Math.min(new Date().getFullYear(), _hmAno[t] + +mv.dataset.passo);
        mv.closest('.hm-bloco').outerHTML = mapaDeCalor(t);
        _rolarMapas(document.getElementById('painelDesempenho'));
        return;
    }
    const dia = e.target.closest('.hm-dia[data-dia]');
    if (!dia) return;
    if (dia.dataset.tipo === 'q') abrirGabaritoNoDia(dia.dataset.dia);
    else abrirCartoesNoDia(dia.dataset.dia);
});
