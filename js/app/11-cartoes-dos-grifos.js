/* ============================================================
   CARTÕES DOS GRIFOS (revisão dentro do CRIVO, sem precisar do Anki)
   Cada par de grifos com o mesmo número numa questão (um ou mais trechos "frente" e um ou mais "verso")
   vira um cartão nos dois sentidos: frente → verso e verso → frente, como o tipo "Basic (and reversed card)"
   do Anki. Os cartões têm fila própria ("Cartões de hoje") e usam o mesmo FSRS-6 das questões, com as notas
   Errei, Difícil, Bom e Fácil.
   O cartão é identificado pela questão, pelo número e pelo sentido. Se o texto dos grifos daquele número mudar
   (um grifo novo, um grifo apagado, grifos juntados de outro aparelho), o cartão continua o mesmo, com o texto
   atualizado e o histórico de revisões mantido. Só fica "sem grifo de origem" se não sobrar par frente/verso
   com aquele número. Cartões antigos (identificados também pelo texto) são juntados no cartão da questão e
   número, somando as revisões. Um cartão apagado volta, sem o histórico, se o texto dos grifos mudar.
   As revisões ficam em progress.cartoes e são somadas entre aparelhos na sincronização com o Drive.
   ============================================================ */
/* pares completos dos grifos atuais: id do cartão -> dados (um id por sentido) */
function paresDosGrifos() {
    const porNumero = new Map();
    for (const g of progress.grifados || []) {
        if (!g || !g.numero || (g.lado !== 'frente' && g.lado !== 'verso')) continue;
        const k = `${g.prova}|${g.ano}|${g.questao}|${g.numero}`;
        if (!porNumero.has(k)) porNumero.set(k, { frente: [], verso: [] });
        porNumero.get(k)[g.lado].push(g);
    }
    /* em ordem no texto; o mesmo trecho grifado em dois aparelhos conta uma vez */
    const ordenar = lista => [...new Map(lista.map(x => [`${x.startOffset || 0}|${x.texto}`, x])).values()]
        .sort((a, b) => (a.startOffset || 0) - (b.startOffset || 0)).map(x => x.texto);
    const pares = new Map();
    for (const [k, p] of porNumero) {
        if (!p.frente.length || !p.verso.length) continue;
        const frente = ordenar(p.frente), verso = ordenar(p.verso);
        const [prova, ano, questao, numero] = k.split('|');
        for (const dir of ['fv', 'vf']) pares.set(`${k}|${dir}`, { prova, ano, questao, numero, dir, frente, verso });
    }
    return pares;
}
const _baseCartao = id => String(id).replace(/\|(fv|vf)(\|[^|]*)?$/, '');
function cartaoApagado(c) { return !!(c && c.apagado && !(c.reativado && c.reativado > c.apagado)); }
/* ids antigos "prova|ano|questão|número|sentido|texto" -> "prova|ano|questão|número|sentido", somando as revisões */
function migrarIdsCartoes() {
    const grupos = {};
    let mudou = false;
    for (const [id, c] of Object.entries(progress.cartoes || {})) {
        if (!c || typeof c !== 'object') continue;
        const m = id.match(/^(.*\|(?:fv|vf))\|[^|]*$/);
        const novo = m ? m[1] : id;
        if (novo !== id) mudou = true;
        (grupos[novo] ||= []).push(c);
    }
    if (!mudou) return false;
    const r = {};
    for (const [id, lista] of Object.entries(grupos)) {
        if (lista.length === 1) { r[id] = lista[0]; continue; }
        const vivos = lista.filter(c => !cartaoApagado(c)), fonte = vivos.length ? vivos : lista;
        const revs = new Map();
        fonte.forEach(c => (c.revisoes || []).forEach(v => { if (v && v.data) revs.set(v.data + '|' + v.nota, v); }));
        const x = Object.assign({}, fonte.reduce((a, b) => String(b.criado || '') > String(a.criado || '') ? b : a));
        x.revisoes = [...revs.values()].sort((p, q) => new Date(p.data) - new Date(q.data));
        x.criado = fonte.map(c => c.criado).filter(Boolean).sort()[0] || x.criado;
        if (vivos.length) { delete x.apagado; delete x.reativado; }
        else x.apagado = lista.map(c => c.apagado).filter(Boolean).sort().pop();
        r[id] = x;
    }
    progress.cartoes = r;
    return true;
}
/* cria no progresso os cartões dos pares novos e atualiza o texto dos que mudaram; devolve os pares atuais */
function sincronizarCartoes() {
    const pares = paresDosGrifos();
    if (!progress.cartoes || typeof progress.cartoes !== 'object') progress.cartoes = {};
    let mudou = migrarIdsCartoes();
    const agora = new Date().toISOString();
    const mesmo = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
    for (const [id, p] of pares) {
        const c = progress.cartoes[id];
        if (!c) { progress.cartoes[id] = Object.assign({}, p, { criado: agora, revisoes: [] }); mudou = true; continue; }
        if (mesmo(c.frente, p.frente) && mesmo(c.verso, p.verso)) continue;
        if (cartaoApagado(c)) c.reativado = agora;          /* apagado e o texto mudou: volta como cartão novo */
        c.frente = p.frente; c.verso = p.verso; mudou = true;
    }
    if (mudou) { setDirty(true); salvarBackup(); }
    return pares;
}
function estadoCartao(c) {
    let s = null;
    const desde = c.reativado && c.apagado ? c.reativado : '';
    for (const v of c.revisoes || []) {
        if (desde && String(v.data) < desde) continue;
        const t = +new Date(v.data), g = +v.nota;
        if (t && g >= 1 && g <= 4) s = fsrsRevisar(s ? { ...s } : null, g, t);
    }
    return s;
}
function listarCartoes() {
    const atuais = sincronizarCartoes();
    return Object.entries(progress.cartoes || {})
        .filter(([, c]) => c && !cartaoApagado(c))
        .map(([id, c]) => ({ id, c, orfao: !atuais.has(id), estado: estadoCartao(c) }));
}
/* vencidos (os mais atrasados primeiro) e depois os novos, na ordem em que foram criados */
function cartoesDeHoje() {
    const fim = fimDeHoje();
    return listarCartoes().filter(x => !x.estado || x.estado.proxima <= fim).sort((a, b) => {
        if (!!a.estado !== !!b.estado) return a.estado ? -1 : 1;
        if (a.estado) return a.estado.proxima - b.estado.proxima;
        return String(a.c.criado).localeCompare(String(b.c.criado)) || a.id.localeCompare(b.id);
    });
}

const cartoesScreen = document.getElementById('cartoesScreen');
const cartoesBtnHome = document.getElementById('cartoesBtnHome');
const cartDataInput = document.getElementById('cartDataInput');
let cartDiaSel = null, cartFila = [], cartFeitos = 0, cartMostrando = false, cartEmSessao = false;

function atualizarContagemCartoes() {
    if (!cartoesBtnHome || !currentRA) return;
    const n = cartoesDeHoje().length;
    cartoesBtnHome.textContent = `🃏 Cartões dos grifos${n ? ` — ${n} para hoje` : ''}`;
}
const _showHomeCartoes = showHome;
showHome = function () { _showHomeCartoes(); try { atualizarContagemCartoes(); } catch (e) { console.warn('cartões:', e); } };

/* cartões de um dia: hoje = vencidos e novos; dia futuro = os programados para ele; dia passado = os revisados nele */
function listarCartoesDoDia(dia) {
    const hoje = isoDoDia(Date.now());
    if (dia === hoje) return cartoesDeHoje();
    const todos = listarCartoes();
    if (dia > hoje) return todos.filter(x => x.estado && isoDoDia(x.estado.proxima) === dia)
        .sort((a, b) => a.estado.proxima - b.estado.proxima);
    const out = [];
    for (const x of todos) {
        const doDia = (x.c.revisoes || []).filter(v => isoDoDia(+new Date(v.data)) === dia);
        if (doDia.length) out.push(Object.assign({}, x, { notaDoDia: +doDia[doDia.length - 1].nota, quando: doDia[doDia.length - 1].data }));
    }
    return out.sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
}

const _paraHtml = linhas => linhas.map(t => escapeHtml(t)).join('<br><br>');
function _rotuloCartao(c) {
    const disc = disciplinaDe(c.prova, c.ano, c.questao);
    return `${escapeHtml(c.prova)} ${escapeHtml(c.ano)} - Q${escapeHtml(c.questao)}${disc ? ' - ' + escapeHtml(disc) : ''}`
        + ` · cartão nº ${escapeHtml(c.numero)} · ${c.dir === 'vf' ? 'verso → frente' : 'frente → verso'}`;
}
function _textoProximo(estado, g) {
    if (g === 1) return 'de novo agora';
    return textoIntervalo(fsrsRevisar(estado ? { ...estado } : null, g, Date.now()));
}

/* ---- lista do dia (como na tela da revisão espaçada) ---- */
function renderListaCartoes() {
    const hoje = isoDoDia(Date.now());
    if (!cartDiaSel) cartDiaSel = hoje;
    cartDataInput.value = cartDiaSel;
    document.getElementById('cartDataTexto').textContent = dataPorExtenso(cartDiaSel) + (cartDiaSel === hoje ? ' (hoje)' : '');
    const lista = listarCartoesDoDia(cartDiaSel);
    const passado = cartDiaSel < hoje, futuro = cartDiaSel > hoje;
    const fim0 = +new Date(hoje + 'T00:00:00');
    const atrasados = passado ? 0 : lista.filter(x => x.estado && x.estado.proxima < fim0).length;
    const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
    let resumo = '';
    if (lista.length) {
        if (passado) resumo = plural(lista.length, 'cartão revisado', 'cartões revisados') + ' neste dia.';
        else resumo = plural(lista.length, 'cartão programado', 'cartões programados') + (atrasados ? ` (${plural(atrasados, 'atrasado', 'atrasados')})` : '')
            + (futuro ? ' para este dia. Você pode adiantá-los, mas os intervalos ficam um pouco menores.' : '');
    }
    document.getElementById('cartResumo').textContent = resumo;
    document.getElementById('cartLista').innerHTML = lista.length
        ? lista.map(x => {
            let selo = '';
            if (passado) selo = `<span class="cartao-selo nota-${x.notaDoDia}">${escapeHtml(NOTAS[x.notaDoDia] || '')}</span>`;
            else if (!x.estado) selo = '<span class="cartao-selo novo">novo</span>';
            else if (x.estado.proxima < fim0) selo = `<span class="atraso">atrasado desde ${new Date(x.estado.proxima).toLocaleDateString('pt-BR')}</span>`;
            return `<div class="revisao-item cartao-item" role="button" tabindex="0" data-id="${escapeHtml(x.id)}" title="Revisar só este cartão">`
                + `<span>${_rotuloCartao(x.c)}${x.orfao ? ' · ⚠️ sem grifo de origem' : ''}</span>${selo}</div>`;
        }).join('')
        : `<div class="revisao-vazia">${passado ? 'Nenhum cartão revisado neste dia.'
            : `Nenhum cartão programado para ${cartDiaSel === hoje ? 'hoje' : 'este dia'}.`
              + (Object.keys(progress.cartoes || {}).length ? ' 🎉' : ' Para criar cartões, grife trechos da correção e marque, com o mesmo número, um trecho como "Frente" e outro como "Verso". 🖍️')}</div>`;
    const btn = document.getElementById('cartIniciarBtn');
    btn.hidden = passado;
    btn.disabled = !lista.length;
    btn.textContent = lista.length ? `▶ Iniciar revisão (${lista.length})` : '▶ Iniciar revisão';
}
function mostrarListaCartoes() {
    cartEmSessao = false;
    document.getElementById('cartListaArea').hidden = false;
    document.getElementById('cartSessao').hidden = true;
    renderListaCartoes();
}

/* ---- sessão de revisão ---- */
function iniciarSessaoCartoes(ids) {
    cartFila = ids.slice(); cartFeitos = 0; cartMostrando = false; cartEmSessao = true;
    document.getElementById('cartListaArea').hidden = true;
    document.getElementById('cartSessao').hidden = false;
    renderCartao();
}
let _cartInicioMs = 0;                                      /* tempo do cartão: da frente aparecer até a nota */
function renderCartao() {
    const id = cartFila[0], atual = id && progress.cartoes[id];
    if (!atual) { mostrarListaCartoes(); return; }          /* terminou: volta para a lista do dia */
    if (!cartMostrando) _cartInicioMs = Date.now();
    const restantes = cartFila.length;
    document.getElementById('cartSessaoResumo').textContent = `${restantes} ${restantes === 1 ? 'cartão restante' : 'cartões restantes'}`
        + (cartFeitos ? ` · ${cartFeitos} revisado${cartFeitos === 1 ? '' : 's'} nesta sessão` : '');
    document.getElementById('cartOrigem').innerHTML = _rotuloCartao(atual);
    document.getElementById('cartOrfao').hidden = paresDosGrifos().has(id);
    const [ladoA, ladoB] = atual.dir === 'vf' ? [atual.verso, atual.frente] : [atual.frente, atual.verso];
    document.getElementById('cartFrente').innerHTML = _paraHtml(ladoA || []);
    document.getElementById('cartVerso').innerHTML = _paraHtml(ladoB || []);
    document.getElementById('cartVerso').hidden = !cartMostrando;
    document.getElementById('cartMostrarBtn').hidden = cartMostrando;
    const notas = document.getElementById('cartNotas');
    notas.hidden = !cartMostrando;
    if (cartMostrando) {
        const estado = estadoCartao(atual);
        notas.querySelectorAll('button[data-nota]').forEach(b => {
            b.querySelector('.cartao-quando').textContent = _textoProximo(estado, +b.dataset.nota);
        });
    }
}
function avaliarCartao(g) {
    const id = cartFila[0], c = id && progress.cartoes[id];
    if (!c) return;
    if (!Array.isArray(c.revisoes)) c.revisoes = [];
    const tempoMs = _cartInicioMs ? Math.min(60000, Math.max(0, Date.now() - _cartInicioMs)) : 0;   /* no máximo 60 s, como no Anki */
    c.revisoes.push(Object.assign({ data: new Date().toISOString(), nota: g }, tempoMs ? { tempoMs } : {}));
    setDirty(true); salvarBackup();
    cartFila.shift();
    if (g === 1) cartFila.push(id);               /* Errei: volta no fim da sessão */
    cartFeitos++; cartMostrando = false;
    renderCartao();
}

async function abrirTelaCartoes() {
    try { await loadDisciplinas(); } catch {}
    cartDiaSel = isoDoDia(Date.now());
    preencherFiltrosExportacao();
    mostrarListaCartoes();
    showScreen(cartoesScreen);
}
cartoesBtnHome.addEventListener('click', abrirTelaCartoes);
document.getElementById('backFromCartoesBtn').addEventListener('click', () => {
    if (cartEmSessao) { mostrarListaCartoes(); return; }
    showHome(); showScreen(authScreen);
});
document.getElementById('cartDiaAnt').addEventListener('click', () => { cartDiaSel = somarDias(cartDiaSel, -1); renderListaCartoes(); });
document.getElementById('cartDiaProx').addEventListener('click', () => { cartDiaSel = somarDias(cartDiaSel, 1); renderListaCartoes(); });
cartDataInput.addEventListener('change', () => { if (cartDataInput.value) { cartDiaSel = cartDataInput.value; renderListaCartoes(); } });
document.getElementById('cartIniciarBtn').addEventListener('click', () => {
    const lista = listarCartoesDoDia(cartDiaSel);
    if (lista.length && cartDiaSel >= isoDoDia(Date.now())) iniciarSessaoCartoes(lista.map(x => x.id));
});
const _abrirItem = e => {
    const it = e.target.closest('.cartao-item');
    if (it && progress.cartoes[it.dataset.id]) iniciarSessaoCartoes([it.dataset.id]);
};
document.getElementById('cartLista').addEventListener('click', _abrirItem);
document.getElementById('cartLista').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _abrirItem(e); } });
document.getElementById('cartMostrarBtn').addEventListener('click', () => { cartMostrando = true; renderCartao(); });
document.getElementById('cartNotas').addEventListener('click', e => {
    const b = e.target.closest('button[data-nota]');
    if (b) avaliarCartao(+b.dataset.nota);
});
document.getElementById('cartApagarBtn').addEventListener('click', () => {
    const id = cartFila[0], c = id && progress.cartoes[id];
    if (!c) return;
    /* apaga os dois sentidos do mesmo par (mesma questão e número) */
    const irmaos = ['fv', 'vf'].map(d => `${_baseCartao(id)}|${d}`).filter(x => progress.cartoes[x]);
    const ativo = paresDosGrifos().has(id);
    if (!confirm('Apagar este cartão (nos dois sentidos) e o histórico de revisões dele?'
        + (ativo ? '\n\nOs grifos continuam na questão; o cartão só volta se você mudar o texto ou o número desses grifos.' : ''))) return;
    const agora = new Date().toISOString();
    irmaos.forEach(x => { progress.cartoes[x].apagado = agora; delete progress.cartoes[x].reativado; });
    setDirty(true); salvarBackup();
    cartFila = cartFila.filter(x => !irmaos.includes(x));
    cartMostrando = false;
    renderCartao();
});
document.getElementById('cartAbrirBtn').addEventListener('click', async () => {
    const c = cartFila[0] && progress.cartoes[cartFila[0]];
    if (c) await abrirQuestaoDoGabarito(c.prova, c.ano, c.questao);
});
document.addEventListener('keydown', e => {
    if (cartoesScreen.classList.contains('hidden') || !cartEmSessao || e.repeat || e.ctrlKey || e.metaKey || e.altKey
        || e.target.closest('input, select, textarea')) return;
    if (!cartMostrando && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (cartFila.length) { cartMostrando = true; renderCartao(); } }
    else if (cartMostrando && /^[1-4]$/.test(e.key)) { e.preventDefault(); avaliarCartao(+e.key); }
});

/* ---- exportar todos os cartões para o Anki (uma nota por par; o tipo do Anki cria os dois sentidos) ---- */
function preencherFiltrosExportacao() {
    const todos = Object.values(progress.cartoes || {}).filter(c => c && !cartaoApagado(c));
    const bancas = [...new Set(todos.map(c => c.prova))].sort();
    const discs = [...new Set(todos.map(c => disciplinaDe(c.prova, c.ano, c.questao)).filter(Boolean))].sort();
    const opc = (lista, rotulo) => `<option value="">${rotulo}</option>` + lista.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    const anos = [...new Set(todos.map(c => String(c.ano)))].sort((a, b) => b.localeCompare(a));
    const temas = [...new Set(todos.map(c => temaDe(c.prova, c.ano, c.questao)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const manter = (id, html) => { const el = document.getElementById(id), v = el.value; el.innerHTML = html; if ([...el.options].some(o => o.value === v)) el.value = v; };
    manter('cartExpBanca', opc(bancas, 'Todas as bancas'));
    manter('cartExpAno', opc(anos, 'Todas as edições'));
    manter('cartExpDisc', opc(discs, 'Todas as disciplinas'));
    manter('cartExpTema', opc(temas, 'Todos os temas'));
}
function exportarTodosCartoes() {
    const banca = document.getElementById('cartExpBanca').value, disc = document.getElementById('cartExpDisc').value;
    const ano = document.getElementById('cartExpAno').value, tema = document.getElementById('cartExpTema').value;
    const comOrfaos = document.getElementById('cartExpOrfaos').checked;
    const atuais = paresDosGrifos();
    const notas = new Map();
    for (const [id, c] of Object.entries(progress.cartoes || {})) {
        if (!c || cartaoApagado(c) || c.dir !== 'fv') continue;
        if (!comOrfaos && !atuais.has(id)) continue;
        if (banca && c.prova !== banca) continue;
        if (ano && String(c.ano) !== ano) continue;
        const d = disciplinaDe(c.prova, c.ano, c.questao);
        if (disc && d !== disc) continue;
        if (tema && temaDe(c.prova, c.ano, c.questao) !== tema) continue;
        notas.set(id, { c, d });
    }
    if (!notas.size) { alert('Nenhum cartão com esses filtros.'); return; }
    const linhas = ['#separator:tab', '#html:true', '#notetype:Basic (and reversed card)', '#tags column:3', '#deck column:4'];
    for (const { c, d } of notas.values()) {
        const tag = [String(c.prova).trim().replace(/\s+/g, '_'), d ? d.replace(/\s+/g, '_') : ''].filter(Boolean).join(' ');
        const deck = `${c.prova}_${c.ano}_Q_${c.questao}`.replace(/[\t\n]/g, ' ');
        linhas.push([(c.frente || []).map(escAnki).join('<br><br>'), (c.verso || []).map(escAnki).join('<br><br>'), tag, deck].join('\t'));
    }
    const nome = ['CRIVO_cartoes', banca, ano, disc, tema].filter(Boolean).join('_').replace(/[\\/:*?"<>|\s]+/g, '-') + '.txt';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([linhas.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
    a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    document.getElementById('cartExpMsg').textContent = `${notas.size} cartão(ões) exportado(s). No Anki: Arquivo → Importar.`;
}
document.getElementById('cartExpBtn').addEventListener('click', exportarTodosCartoes);
