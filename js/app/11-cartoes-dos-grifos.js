/* ============================================================
   CARTÕES DOS GRIFOS (revisão dentro do CRIVO, sem precisar do Anki)
   Cada par de grifos com o mesmo número numa questão (um ou mais trechos "frente" e um ou mais "verso")
   vira um cartão nos dois sentidos: frente → verso e verso → frente, como o tipo "Basic (and reversed card)"
   do Anki. Os cartões têm fila própria ("Cartões de hoje") e usam o mesmo FSRS-6 das questões, com as notas
   Errei, Difícil, Bom e Fácil.
   O texto do cartão é guardado no progresso. Se o aluno apagar ou mudar um grifo, o cartão antigo continua
   (marcado como "sem grifo de origem") até o aluno apagá-lo; o par novo vira um cartão novo.
   As revisões ficam em progress.cartoes e são somadas entre aparelhos na sincronização com o Drive.
   ============================================================ */
function _hashTexto(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
}
/* pares completos dos grifos atuais: id do cartão -> dados (um id por sentido) */
function paresDosGrifos() {
    const porNumero = new Map();
    for (const g of progress.grifados || []) {
        if (!g || !g.numero || (g.lado !== 'frente' && g.lado !== 'verso')) continue;
        const k = `${g.prova}|${g.ano}|${g.questao}|${g.numero}`;
        if (!porNumero.has(k)) porNumero.set(k, { frente: [], verso: [] });
        porNumero.get(k)[g.lado].push(g);
    }
    const ordenar = lista => lista.slice().sort((a, b) => (a.startOffset || 0) - (b.startOffset || 0)).map(x => x.texto);
    const pares = new Map();
    for (const [k, p] of porNumero) {
        if (!p.frente.length || !p.verso.length) continue;
        const frente = ordenar(p.frente), verso = ordenar(p.verso);
        const h = _hashTexto(frente.join('\n') + '\u0000' + verso.join('\n'));
        const [prova, ano, questao, numero] = k.split('|');
        for (const dir of ['fv', 'vf']) pares.set(`${k}|${dir}|${h}`, { prova, ano, questao, numero, dir, frente, verso });
    }
    return pares;
}
/* cria no progresso os cartões dos pares novos; devolve os ids dos pares atuais */
function sincronizarCartoes() {
    const pares = paresDosGrifos();
    if (!progress.cartoes || typeof progress.cartoes !== 'object') progress.cartoes = {};
    const agora = new Date().toISOString();
    let novos = 0;
    for (const [id, p] of pares) {
        if (!progress.cartoes[id]) { progress.cartoes[id] = Object.assign({}, p, { criado: agora, revisoes: [] }); novos++; }
    }
    if (novos) { setDirty(true); salvarBackup(); }
    return pares;
}
function estadoCartao(c) {
    let s = null;
    for (const v of c.revisoes || []) {
        const t = +new Date(v.data), g = +v.nota;
        if (t && g >= 1 && g <= 4) s = fsrsRevisar(s ? { ...s } : null, g, t);
    }
    return s;
}
function listarCartoes() {
    const atuais = sincronizarCartoes();
    return Object.entries(progress.cartoes || {})
        .filter(([, c]) => c && !c.apagado)
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
let cartFila = [], cartFeitos = 0, cartMostrando = false;

function atualizarContagemCartoes() {
    if (!cartoesBtnHome || !currentRA) return;
    const n = cartoesDeHoje().length;
    cartoesBtnHome.textContent = `🃏 Cartões dos grifos${n ? ` — ${n} para hoje` : ''}`;
}
const _showHomeCartoes = showHome;
showHome = function () { _showHomeCartoes(); try { atualizarContagemCartoes(); } catch (e) { console.warn('cartões:', e); } };

const _paraHtml = linhas => linhas.map(t => escapeHtml(t)).join('<br><br>');
function _origemCartao(c) {
    const disc = disciplinaDe(c.prova, c.ano, c.questao);
    return `${escapeHtml(c.prova)} ${escapeHtml(c.ano)} - Q${escapeHtml(c.questao)}${disc ? ' - ' + escapeHtml(disc) : ''}`
        + ` · cartão nº ${escapeHtml(c.numero)} · ${c.dir === 'vf' ? 'verso → frente' : 'frente → verso'}`;
}
function _textoProximo(estado, g) {
    if (g === 1) return 'de novo agora';
    return textoIntervalo(fsrsRevisar(estado ? { ...estado } : null, g, Date.now()));
}
function renderCartao() {
    const caixa = document.getElementById('cartao'), vazio = document.getElementById('cartVazio');
    const resumo = document.getElementById('cartResumo');
    const atual = cartFila[0] && progress.cartoes[cartFila[0]];
    const restantes = cartFila.length;
    resumo.textContent = restantes ? `${restantes} ${restantes === 1 ? 'cartão' : 'cartões'} para hoje` + (cartFeitos ? ` · ${cartFeitos} revisado${cartFeitos === 1 ? '' : 's'} nesta sessão` : '') : '';
    if (!atual) {
        caixa.hidden = true; vazio.hidden = false;
        vazio.innerHTML = cartFeitos ? 'Você terminou os cartões de hoje. 🎉'
            : 'Nenhum cartão para hoje. Para criar cartões, grife trechos da correção e marque, com o mesmo número, um trecho como "Frente" e outro como "Verso". 🖍️';
        return;
    }
    const ativo = paresDosGrifos().has(cartFila[0]);
    caixa.hidden = false; vazio.hidden = true;
    document.getElementById('cartOrigem').innerHTML = _origemCartao(atual);
    document.getElementById('cartOrfao').hidden = ativo;
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
            const g = +b.dataset.nota;
            b.querySelector('.cartao-quando').textContent = _textoProximo(estado, g);
        });
    }
}
async function abrirTelaCartoes() {
    try { await loadDisciplinas(); } catch {}
    cartFila = cartoesDeHoje().map(x => x.id);
    cartFeitos = 0; cartMostrando = false;
    preencherFiltrosExportacao();
    renderCartao();
    showScreen(cartoesScreen);
}
function avaliarCartao(g) {
    const id = cartFila[0], c = id && progress.cartoes[id];
    if (!c) return;
    if (!Array.isArray(c.revisoes)) c.revisoes = [];
    c.revisoes.push({ data: new Date().toISOString(), nota: g });
    setDirty(true); salvarBackup();
    cartFila.shift();
    if (g === 1) cartFila.push(id);               /* Errei: volta no fim da sessão de hoje */
    cartFeitos++; cartMostrando = false;
    renderCartao();
}
cartoesBtnHome.addEventListener('click', abrirTelaCartoes);
document.getElementById('backFromCartoesBtn').addEventListener('click', () => { showHome(); showScreen(authScreen); });
document.getElementById('cartMostrarBtn').addEventListener('click', () => { cartMostrando = true; renderCartao(); });
document.getElementById('cartNotas').addEventListener('click', e => {
    const b = e.target.closest('button[data-nota]');
    if (b) avaliarCartao(+b.dataset.nota);
});
document.getElementById('cartApagarBtn').addEventListener('click', () => {
    const id = cartFila[0], c = id && progress.cartoes[id];
    if (!c) return;
    /* apaga os dois sentidos do mesmo par (mesma questão, número e texto) */
    const partes = id.split('|'), h = partes.pop(); partes.pop();
    const irmaos = ['fv', 'vf'].map(d => [...partes, d, h].join('|')).filter(x => progress.cartoes[x]);
    const ativo = paresDosGrifos().has(id);
    if (!confirm('Apagar este cartão (nos dois sentidos) e o histórico de revisões dele?'
        + (ativo ? '\n\nOs grifos continuam na questão; o cartão só volta se você mudar o texto ou o número desses grifos.' : ''))) return;
    const agora = new Date().toISOString();
    irmaos.forEach(x => { progress.cartoes[x].apagado = agora; });
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
    if (cartoesScreen.classList.contains('hidden') || e.target.closest('input, select, textarea')) return;
    if (!cartMostrando && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (cartFila.length) { cartMostrando = true; renderCartao(); } }
    else if (cartMostrando && /^[1-4]$/.test(e.key)) { e.preventDefault(); avaliarCartao(+e.key); }
});

/* ---- exportar todos os cartões para o Anki (uma nota por par; o tipo do Anki cria os dois sentidos) ---- */
function preencherFiltrosExportacao() {
    const todos = Object.values(progress.cartoes || {}).filter(c => c && !c.apagado);
    const bancas = [...new Set(todos.map(c => c.prova))].sort();
    const discs = [...new Set(todos.map(c => disciplinaDe(c.prova, c.ano, c.questao)).filter(Boolean))].sort();
    const opc = (lista, rotulo) => `<option value="">${rotulo}</option>` + lista.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    document.getElementById('cartExpBanca').innerHTML = opc(bancas, 'Todas as bancas');
    document.getElementById('cartExpDisc').innerHTML = opc(discs, 'Todas as disciplinas');
}
function exportarTodosCartoes() {
    const banca = document.getElementById('cartExpBanca').value, disc = document.getElementById('cartExpDisc').value;
    const comOrfaos = document.getElementById('cartExpOrfaos').checked;
    const atuais = paresDosGrifos();
    const notas = new Map();
    for (const [id, c] of Object.entries(progress.cartoes || {})) {
        if (!c || c.apagado || c.dir !== 'fv') continue;
        if (!comOrfaos && !atuais.has(id)) continue;
        if (banca && c.prova !== banca) continue;
        const d = disciplinaDe(c.prova, c.ano, c.questao);
        if (disc && d !== disc) continue;
        notas.set(id, { c, d });
    }
    if (!notas.size) { alert('Nenhum cartão com esses filtros.'); return; }
    const linhas = ['#separator:tab', '#html:true', '#notetype:Basic (and reversed card)', '#tags column:3', '#deck column:4'];
    for (const { c, d } of notas.values()) {
        const tag = [String(c.prova).trim().replace(/\s+/g, '_'), d ? d.replace(/\s+/g, '_') : ''].filter(Boolean).join(' ');
        const deck = `${c.prova}_${c.ano}_Q_${c.questao}`.replace(/[\t\n]/g, ' ');
        linhas.push([(c.frente || []).map(escAnki).join('<br><br>'), (c.verso || []).map(escAnki).join('<br><br>'), tag, deck].join('\t'));
    }
    const nome = ['CRIVO_cartoes', banca, disc].filter(Boolean).join('_').replace(/[\\/:*?"<>|\s]+/g, '-') + '.txt';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([linhas.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
    a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    document.getElementById('cartExpMsg').textContent = `${notas.size} cartão(ões) exportado(s). No Anki: Arquivo → Importar.`;
}
document.getElementById('cartExpBtn').addEventListener('click', exportarTodosCartoes);
