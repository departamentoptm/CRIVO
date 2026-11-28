/* ============================================================
   BUSCA E GUIA DE PRIMEIROS PASSOS
   Busca: procura palavras no enunciado, nas alternativas e (se marcado) nas correções de todas as edições.
   Na primeira busca, as edições são baixadas uma vez (com barra de progresso) e ficam guardadas na memória
   da página; depois, a procura é feita no próprio aparelho. Aparecem as questões que têm todas as palavras
   (sem diferenciar acentos e maiúsculas). Toque num resultado para abrir a questão, ou resolva todos.
   Guia: cada tela tem um ❓ que passeia por todas as funções dela; na primeira visita, o passeio da tela
   inicial aparece sozinho, e o botão "❓ Ajuda" mostra de novo.
   ============================================================ */
const buscaScreen = document.getElementById('buscaScreen');
const MAX_RESULTADOS = 200;
let _indiceBusca = null, _carregandoBusca = null, _ultimaBusca = [];

const PALAVRAS_COMUNS = new Set('de da do das dos e a o as os em na no nas nos com por para pra um uma uns umas que se ao aos ou'.split(' '));
const _inicioDePalavra = (s, j) => j === 0 || !/[a-z0-9]/.test(s[j - 1]);
const _normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function _textoPuro(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html || '').replace(/<(br|\/p|\/li|\/tr|\/h\d)>/gi, ' $&');
    return d.textContent.replace(/\s+/g, ' ').trim();
}
/* baixa as edições (uma vez) e monta o índice: um item por questão, com os textos e as versões sem acento */
async function indiceDaBusca(aoProgredir) {
    if (_indiceBusca) return _indiceBusca;
    if (_carregandoBusca) return _carregandoBusca;
    _carregandoBusca = (async () => {
        if (!Object.keys(exams || {}).length) await loadManifest();
        try { await loadDisciplinas(); } catch {}
        const edicoes = [];
        for (const b of Object.keys(exams).sort()) for (const a of Object.keys(exams[b]).sort((x, y) => y.localeCompare(x))) edicoes.push([b, a]);
        const itens = [];
        let feitas = 0;
        for (const [b, a] of edicoes) {
            try {
                const ed = await CrivoRender.carregarEdicao(b, a);
                for (const q of ed.questoes) {
                    const alts = Object.entries(q.alternativas || {}).map(([l, t]) => `${l}) ${_textoPuro(t)}`).join(' · ');
                    const sec = (q.correcao && q.correcao.secoes_html) || {};
                    const corr = Object.entries(sec).filter(([k]) => k !== '2.10' && k !== '2.15').map(([, v]) => _textoPuro(v)).join(' ');
                    const campos = [['Enunciado', _textoPuro((q.enunciado_html || '') + ' ' + (q.extras_html || ''))], ['Alternativas', alts], ['Correção', corr]];
                    itens.push({ b, a, n: String(q.numero), campos, normais: campos.map(([, t]) => _normal(t)) });
                }
            } catch (e) { console.warn('busca:', b, a, e); }
            feitas++;
            if (aoProgredir) aoProgredir(feitas, edicoes.length);
        }
        _indiceBusca = itens;
        return itens;
    })();
    try { return await _carregandoBusca; } finally { _carregandoBusca = null; }
}
/* trecho em volta da palavra mais específica (a mais longa), com todas as palavras buscadas destacadas.
   O texto sem acento tem o mesmo tamanho do original, então as posições valem para os dois. */
function _trecho(texto, normal, termos) {
    const principal = termos.find(t => normal.includes(t)) || termos[0];
    const i = normal.indexOf(principal);
    const ini = i < 0 ? 0 : Math.max(0, i - 70), fim = Math.min(texto.length, i < 0 ? 160 : i + principal.length + 90);
    const marcas = [];
    for (const t of termos) { let j = normal.indexOf(t, ini); while (j >= 0 && j < fim) { if (_inicioDePalavra(normal, j)) marcas.push([j, Math.min(fim, j + t.length)]); j = normal.indexOf(t, j + t.length); } }
    marcas.sort((a, b) => a[0] - b[0]);
    let o = ini ? '…' : '', p = ini;
    for (const [a, b] of marcas) { if (a < p) continue; o += escapeHtml(texto.slice(p, a)) + '<mark>' + escapeHtml(texto.slice(a, b)) + '</mark>'; p = b; }
    return o + escapeHtml(texto.slice(p, fim)) + (fim < texto.length ? '…' : '');
}
async function buscar() {
    const consulta = document.getElementById('buscaInput').value.trim();
    const status = document.getElementById('buscaStatus'), box = document.getElementById('buscaResultados');
    const estudar = document.getElementById('buscaEstudarBtn');
    const todos = [...new Set(_normal(consulta).split(/[\s,;.]+/).filter(t => t.length >= 2))];
    const uteis = todos.filter(t => !PALAVRAS_COMUNS.has(t));                 /* "de", "da", "com"… não contam */
    const termos = (uteis.length ? uteis : todos).sort((a, b) => b.length - a.length);
    if (!termos.length) { status.textContent = 'Digite pelo menos uma palavra com 2 letras ou mais.'; box.innerHTML = ''; estudar.hidden = true; return; }
    const comCorrecao = document.getElementById('buscaCorrecoes').checked, banca = document.getElementById('buscaBanca').value;
    if (!_indiceBusca) status.textContent = 'Preparando a busca: baixando as questões e correções (só na primeira vez)…';
    const itens = await indiceDaBusca((f, t) => { status.textContent = `Preparando a busca: ${f} de ${t} edições baixadas (só na primeira vez)…`; });
    const achados = [];
    for (const it of itens) {
        if (banca && it.b !== banca) continue;
        const ondeProcurar = comCorrecao ? [0, 1, 2] : [0, 1];
        const todo = ondeProcurar.map(i => it.normais[i]).join('\n');
        if (!termos.every(t => todo.includes(t))) continue;
        const campo = ondeProcurar.find(i => it.normais[i].includes(termos[0])) ?? ondeProcurar.find(i => termos.some(t => it.normais[i].includes(t)));
        achados.push({ it, campo });
    }
    _ultimaBusca = achados.map(x => `${x.it.b}|${x.it.a}|${x.it.n}`);
    estudar.hidden = !achados.length;
    estudar.textContent = `▶ Resolver estas questões (${achados.length})`;
    status.textContent = achados.length
        ? `${achados.length} ${achados.length === 1 ? 'questão encontrada' : 'questões encontradas'}${achados.length > MAX_RESULTADOS ? ` (mostrando as ${MAX_RESULTADOS} primeiras)` : ''}. Toque numa questão para abri-la.`
        : 'Nenhuma questão com todas essas palavras. Tente menos palavras ou outra grafia.';
    box.innerHTML = achados.slice(0, MAX_RESULTADOS).map(({ it, campo }) => {
        const disc = disciplinaDe(it.b, it.a, it.n), [rot, texto] = it.campos[campo];
        const feita = isRealizada(it.b, it.a, it.n);
        return `<button type="button" class="busca-item" data-k="${escapeHtml(`${it.b}|${it.a}|${it.n}`)}">`
            + `<span class="busca-titulo">${escapeHtml(it.b)} ${escapeHtml(it.a)} - Q${escapeHtml(it.n)}${disc ? ` · ${escapeHtml(disc)}` : ''}${feita ? ' · <span class="busca-feita">já respondida</span>' : ''}</span>`
            + `<span class="busca-trecho"><small>${rot}:</small> ${_trecho(texto, it.normais[campo], termos)}</span></button>`;
    }).join('');
}
async function abrirTelaBusca() {
    if (!Object.keys(exams || {}).length) { try { await loadManifest(); } catch {} }
    const sel = document.getElementById('buscaBanca'), v = sel.value;
    sel.innerHTML = '<option value="">Todas as bancas</option>' + Object.keys(exams || {}).sort().map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
    sel.value = v;
    showScreen(buscaScreen);
    setTimeout(() => document.getElementById('buscaInput').focus(), 50);
}
document.getElementById('buscaBtnHome').addEventListener('click', abrirTelaBusca);
document.getElementById('backFromBuscaBtn').addEventListener('click', () => { showHome(); showScreen(authScreen); });
document.getElementById('buscaForm').addEventListener('submit', e => { e.preventDefault(); buscar(); });
document.getElementById('buscaCorrecoes').addEventListener('change', () => { if (document.getElementById('buscaInput').value.trim()) buscar(); });
document.getElementById('buscaBanca').addEventListener('change', () => { if (document.getElementById('buscaInput').value.trim()) buscar(); });
document.getElementById('buscaResultados').addEventListener('click', async e => {
    const it = e.target.closest('.busca-item');
    if (!it) return;
    const [b, a, n] = it.dataset.k.split('|');
    await abrirQuestaoDoGabarito(b, a, n);
});
document.getElementById('buscaEstudarBtn').addEventListener('click', () => {
    if (_ultimaBusca.length) estudarGrupo(_ultimaBusca.slice(), `Busca: ${document.getElementById('buscaInput').value.trim()}`);
});

/* ---------- guia: um passeio por tela ----------
   Cada tela tem um ❓ que passeia pelas funções dela (só pelos elementos que estão visíveis naquele momento).
   Na primeira visita, o passeio da tela inicial aparece sozinho. "seletor <label" = o rótulo em volta do campo. */
const GUIA_KEY = 'crivo_guia_visto';
const GUIAS = {
    inicio: { tela: 'authScreen', passos: [
        ['#startBtnHome', 'Resolver questões', 'Abre as questões. Na barra de cima você escolhe banca, edição e disciplina. Dentro da resolução, o ❓ explica cada botão.'],
        ['#metaPlanoHoje', 'Meta de hoje', 'Quantas questões o seu plano de estudo pede para hoje e quantas você já fez. Toque para abrir o plano.'],
        ['#revisaoBtnHome', 'Revisão espaçada', 'As questões que você errou ou classificou como Difícil voltam no dia certo, calculado pelo FSRS (o algoritmo do Anki).'],
        ['#cartoesBtnHome', 'Cartões dos grifos', 'Os trechos que você grifa viram cartões de memorização (frente e verso ou cloze), revisados aqui no mesmo esquema do Anki.'],
        ['#viewProgressBtn', 'Meu gabarito', 'Todas as suas respostas por banca e edição, com acertos e erros. Dá para refazer grupos de questões e ver o que você fez num dia.'],
        ['#simuladoBtnHome', 'Simulado', 'Monte uma prova com a quantidade de questões e o tempo que quiser; a correção aparece só no fim.'],
        ['#desempenhoBtnHome', 'Desempenho e plano', 'Acerto por disciplina e tema, pontos fracos, mapas de calor, estatísticas dos cartões e o plano de estudo até a data da prova.'],
        ['#buscaBtnHome', 'Buscar questões', 'Procure um assunto (ex.: "Kawasaki") no enunciado, nas alternativas e nas correções.'],
        ['#saveBtnHome', 'Salvar em arquivo', 'Baixa um arquivo com todo o seu progresso, como cópia de segurança. O progresso já fica guardado neste navegador, sozinho.'],
        ['#loadBtnHome', 'Carregar arquivo', 'Traz um arquivo de progresso salvo antes. O site mostra o que há nele e pergunta se você quer somar ao atual ou substituir.'],
        ['#driveBtnHome', 'Google Drive', 'Guarda o progresso no seu Google Drive e o leva para o celular e o computador. Depois de ligado, salva sozinho.'],
        ['#solicitarProvasBtn', 'Solicitar provas / Ajudar', 'Peça uma prova que ainda não está no CRIVO ou ofereça ajuda para construir e manter a plataforma.'],
        ['#authScreen .aparencia', 'Aparência', 'Modo escuro, tamanho da letra das questões e tamanho dos ícones das barras. A letra e os ícones vão junto para o Drive.'],
        ['#ajudaBtn', 'Ajuda', 'Em cada tela há um ❓ que explica as funções dela. Este botão mostra este passeio de novo.'],
    ] },
    resolucao: { tela: 'resolvingScreen', passos: [
        ['#questionFrame', 'A questão', 'Toque numa alternativa e em "Confirmar Resposta". Aparecem o resultado e a correção comentada. Depois, classifique como Difícil, Bom ou Fácil: isso define quando a questão volta na revisão espaçada.'],
        ['#grupoAviso', 'Grupo de questões', 'Você está num grupo (plano de hoje, busca, pontos fracos, Meu gabarito…). O × volta aos filtros que você usava antes.'],
        ['#homeBtn', 'Início', 'Volta para a tela inicial. O progresso já está salvo.'],
        ['#progressBtnResolving', 'Meu gabarito', 'Abre as suas respostas por banca e edição.'],
        ['#toggleFiltrosBtn', 'Mostrar ou esconder filtros', 'Esconde banca, edição e disciplina para ganhar espaço na tela.'],
        ['#bancaMultiBtn', 'Bancas', 'Escolha uma ou mais bancas. Desmarcar "Todas as bancas" desmarca tudo, para você marcar só as que quer.'],
        ['#anoMultiBtn', 'Edições', 'Escolha uma ou mais edições (anos), do mesmo jeito que as bancas.'],
        ['#disciplinaSelector', 'Disciplina e tema', 'Ao escolher uma disciplina, aparece o filtro de tema ao lado.'],
        ['#historicoBtn', 'Histórico', 'As suas respostas anteriores nesta questão, com a data, o tempo até confirmar e o tempo lendo a correção.'],
        ['#grifarBtn', 'Grifar', 'Selecione um trecho (do enunciado ou da correção) e toque aqui (ou Ctrl+Alt). Toque duas vezes num grifo para dar um número e escolher Frente, Verso ou Cloze: assim ele vira um cartão. O 🗑️ apaga o grifo.'],
        ['#reportarBtn', 'Reportar erro', 'Abre o formulário para avisar de um erro nesta questão (banca, edição e número aparecem num aviso).'],
        ['#saveBtn', 'Salvar', 'Baixa o arquivo de progresso (cópia de segurança). O progresso já fica guardado sozinho; o botão só pisca se uma gravação falhar.'],
        ['#ankiBtn', 'Anki', 'Exporta os cartões desta questão (frente e verso e cloze) num arquivo para importar no Anki.'],
        ['#toggleTopBtn', 'Esconder a barra de cima', 'Deixa só os botões de ação; toque de novo para mostrar tudo.'],
        ['#resolvingScreen .nav-container', 'Ir para uma questão', 'Digite o número da questão (na lista atual) e toque em "Ir".'],
        ['#prevBtn', 'Anterior', 'Volta para a questão anterior da lista.'],
        ['#nuvemBarra', 'Salvamento no Drive', 'Mostra quando o progresso foi salvo no Drive. Se aparecer ⚠️, toque para reconectar.'],
        ['#toggleBottomBtn', 'Esconder a barra de baixo', 'Deixa só avançar, voltar, o contador e o relógio.'],
        ['#filtrosBtn', 'Filtros', 'Só não realizadas, revisões pendentes, questões do plano de hoje, só com correção, embaralhar e limitar a quantidade. O número ao lado mostra quantos estão ligados.'],
        ['#posIndicator', 'Posição', 'A questão atual e o total da lista com os filtros escolhidos.'],
        ['#resolvingScreen .timer-container', 'Cronômetro', 'Toque em "Tempo máx." para escolher: desativado, limite por questão ou tempo total. Com limite por questão, ao acabar o tempo o site passa para a próxima, mas nunca depois de você confirmar.'],
        ['#nextBtn', 'Próxima', 'Vai para a próxima questão da lista.'],
    ] },
    revisao: { tela: 'revisaoScreen', passos: [
        ['#revisaoScreen .revisao-data', 'Dia', 'Use as setas ou a data para ver as revisões de outro dia. As de dias futuros podem ser adiantadas.'],
        ['#revLista', 'Questões do dia', 'As questões que vencem nesse dia, das mais atrasadas para as mais recentes.'],
        ['#revIniciarBtn', 'Iniciar revisão', 'As questões abrem em branco para você responder de novo. Depois de cada uma, classifique como Difícil, Bom ou Fácil.'],
    ] },
    cartoes: { tela: 'cartoesScreen', passos: [
        ['#cartPainelBtn', 'Painel', 'Estatísticas de todos os cartões, como no Anki: classificação (novo, aprendendo, reaprendendo, recente, maduro), previsão, retenção, intervalos e a lista completa. Toque num cartão da lista para ver os dados dele.'],
        ['#cartPainel .cart-rosca-wrap', 'Classificação', 'Quantos cartões estão em cada fase. Recente: intervalo menor que 21 dias; maduro: 21 dias ou mais.'],
        ['#cartListaPainel', 'Todos os cartões', 'Filtre por banca, edição, disciplina, tema e classificação, e ordene tocando no título de uma coluna.'],
        ['#cartListaArea .revisao-data', 'Dia', 'Use as setas ou a data: hoje mostra os vencidos e os novos; dias futuros, os programados (dá para adiantar); dias passados, o que você revisou.'],
        ['#cartLista', 'Cartões do dia', 'Toque num cartão para revisar só ele.'],
        ['#cartIniciarBtn', 'Iniciar revisão', 'Revisa todos os cartões do dia, um por vez.'],
        ['#cartFrente', 'Frente', 'Pense na resposta. No cloze, a frase aparece com o trecho escondido ([...]).'],
        ['#cartMostrarBtn', 'Mostrar resposta', 'Mostra o verso (ou o trecho do cloze). Tecla: espaço.'],
        ['#cartNotas', 'Sua avaliação', 'Errei (o cartão volta no fim da sessão), Difícil, Bom ou Fácil. Teclas 1 a 4. Embaixo de cada botão aparece quando o cartão volta.'],
        ['#cartInfoBtn', 'Dados do cartão', 'Classificação, datas, intervalo, estabilidade, dificuldade, retenção, tempos e a tabela de todas as revisões.'],
        ['#cartAbrirBtn', 'Abrir a questão', 'Abre a questão de onde vieram os grifos.'],
        ['#cartApagarBtn', 'Apagar cartão', 'Apaga o cartão e o histórico dele. Os grifos continuam na questão.'],
        ['#cartoesScreen .cartoes-exportar', 'Exportar para o Anki', 'Gera um arquivo com os cartões (frente e verso e cloze), com filtros por banca, edição, disciplina e tema.'],
    ] },
    gabarito: { tela: 'progressScreen', passos: [
        ['#progressScreen .gab-filters', 'Filtros', 'Banca, edição, disciplina, forma de agrupar, só erros ou só acertos e se mostra as questões não realizadas.'],
        ['#gabPorData <label', 'Filtrar por data', 'Mostra só o que você respondeu num dia, com o resultado daquele dia.'],
        ['#progressScreen .gab-legenda', 'Questões com correção', 'O 📖 marca as questões que já têm correção comentada.'],
        ['#gabDynamic .chip', 'Cada questão', 'Verde: acertou. Vermelho: errou (com a letra certa). Cinza: ainda não feita. Toque para abrir a questão.'],
        ['#gabDynamic .refazer-grupo', 'Refazer grupo', 'Deixa as questões do grupo em branco para você refazer (o histórico continua guardado). "Restaurar" desfaz.'],
    ] },
    simulado: { tela: 'simuladoScreen', passos: [
        ['#simResultado', 'Resultado', 'Acertos por disciplina e cada questão. Classifique cada uma para a revisão espaçada ou toque em "Abrir" para ver a correção. O ✕ fecha o resultado.'],
        ['#simConfig', 'Montar o simulado', 'Escolha a quantidade de questões, o tempo, as bancas, as disciplinas e se quer só questões novas. Embaixo aparece quantas questões existem com esses filtros.'],
        ['#simIniciarBtn', 'Iniciar', 'A correção fica escondida até o fim, e o tempo aparece na barra de cima. Se você fechar a página, o simulado continua de onde parou.'],
        ['#simContinuarBtn', 'Continuar', 'Volta ao simulado que está em andamento.'],
        ['#simHistorico', 'Simulados anteriores', 'Toque num simulado para ver o resultado dele de novo.'],
    ] },
    desempenho: { tela: 'desempenhoScreen', passos: [
        ['#abaDesempenho', 'Desempenho', 'Seus números: acerto, tempos, cartões, evolução e o gráfico por disciplina e tema.'],
        ['#abaPlano', 'Plano de estudo', 'Monte um plano com a data da prova e as horas que você tem em cada dia.'],
        ['.hm-bloco[data-hm="q"]', 'Questões por dia', 'Cada quadradinho é um dia do ano; quanto mais escuro, mais questões. Toque num dia para ver o que você respondeu nele. As setas trocam o ano.'],
        ['.hm-bloco[data-hm="c"]', 'Cartões por dia', 'O mesmo para as revisões de cartões. Toque num dia para ver os cartões revisados nele.'],
        ['#painelDesempenho .desemp-resumo', 'Resumo', 'Acerto na 1ª resposta (como você foi da primeira vez) e na última (o que sabe agora), dias seguidos e tempos médios.'],
        ['#desempCartoes', 'Cartões', 'Quantos cartões há em cada fase, o tempo por cartão e a retenção.'],
        ['#estudarFracosBtn', 'Pontos fracos', 'Temas com menos de 60% de acerto na 1ª resposta. Este botão abre questões desses temas.'],
        ['#desempEvolucao', 'Evolução', 'Questões por dia nos últimos 7 ou 30 dias, ou por mês no último ano.'],
        ['#painelDesempenho .desemp-filtros', 'Filtros do gráfico', 'Banca, edição, disciplina, forma de agrupar, só erros ou acertos e filtro por data.'],
        ['.dm-btn', 'Medida do acerto', 'Troca o gráfico entre a última resposta e a 1ª resposta de cada questão.'],
        ['#desempGrafico', 'Por disciplina e tema', 'Barras das questões (acertos, erros, não respondidas) e, à esquerda, a rosca dos cartões. Toque numa disciplina para ver os temas. "Praticar" abre as questões; "🃏 Cartões" abre os cartões.'],
        ['#planoProva', 'Prova e data', 'Escolha a prova principal e a data dela.'],
        ['#painelPlano .plano-dias', 'Dias e horários', 'Marque os dias e os horários em que você pode estudar. O plano calcula quantas questões cabem pelo seu tempo médio.'],
        ['#planoLimiteChk <label', 'Limite diário', 'Opcional: um máximo de questões (revisões e novas) por dia.'],
        ['#planoSalvarBtn', 'Salvar o plano', 'Calcula o plano e mostra se o ritmo é suficiente para terminar até a prova.'],
        ['#planoComecarBtn', 'Questões de hoje', 'Abre as questões novas do plano de hoje, distribuídas pelo peso de cada disciplina.'],
    ] },
    busca: { tela: 'buscaScreen', passos: [
        ['#buscaInput', 'Palavras', 'Digite uma ou mais palavras. Aparecem as questões que têm todas elas; acentos e maiúsculas não importam.'],
        ['#buscaCorrecoes <label', 'Correções', 'Marque para procurar também no texto das correções.'],
        ['#buscaBanca', 'Banca', 'Limita a busca a uma banca.'],
        ['#buscaEstudarBtn', 'Resolver os resultados', 'Abre todas as questões encontradas como um grupo, na tela de resolução.'],
        ['#buscaResultados .busca-item', 'Resultado', 'Banca, edição, número, disciplina e um trecho com as palavras destacadas. Toque para abrir a questão.'],
    ] },
};
let _guiaPasso = -1, _guiaAtual = null;
function _alvoDoPasso(sel) {
    const [base, label] = sel.split(' <');
    let el = document.querySelector(base);
    if (el && label) el = el.closest(label) || el;
    if (!el || !el.getClientRects().length) return null;
    const st = getComputedStyle(el);
    return st.visibility === 'hidden' || st.display === 'none' ? null : el;
}
function _limparAlvo() { document.querySelectorAll('.guia-alvo').forEach(x => x.classList.remove('guia-alvo', 'guia-rel')); }
function _fecharGuia() {
    document.getElementById('guiaFundo')?.remove();
    _limparAlvo();
    _guiaPasso = -1; _guiaAtual = null;
    try { localStorage.setItem(GUIA_KEY, '1'); } catch {}
}
function _passosVisiveis() { return (_guiaAtual ? GUIAS[_guiaAtual].passos : []).map(p => [_alvoDoPasso(p[0]), p[1], p[2]]).filter(p => p[0]); }
function _mostrarPasso(i) {
    _limparAlvo();
    const passos = _passosVisiveis();
    if (i < 0) i = 0;
    if (i >= passos.length) return _fecharGuia();
    _guiaPasso = i;
    const [alvo, titulo, texto] = passos[i];
    alvo.classList.add('guia-alvo');
    if (getComputedStyle(alvo).position === 'static') alvo.classList.add('guia-rel');
    alvo.scrollIntoView({ block: 'center', inline: 'nearest' });
    let fundo = document.getElementById('guiaFundo');
    if (!fundo) {
        fundo = document.createElement('div');
        fundo.id = 'guiaFundo'; fundo.className = 'guia-fundo';
        fundo.innerHTML = '<div class="guia-balao" role="dialog" aria-modal="true" aria-labelledby="guiaTit"></div>';
        document.body.appendChild(fundo);
        fundo.addEventListener('click', e => {
            const b = e.target.closest('button[data-guia]');
            if (!b) return;
            if (b.dataset.guia === 'pular') _fecharGuia();
            else _mostrarPasso(_guiaPasso + (b.dataset.guia === 'voltar' ? -1 : 1));
        });
    }
    const balao = fundo.querySelector('.guia-balao');
    balao.innerHTML = `<div class="guia-contagem">${i + 1} de ${passos.length}</div><h3 id="guiaTit">${escapeHtml(titulo)}</h3><p>${escapeHtml(texto)}</p>`
        + `<div class="guia-botoes"><button type="button" class="aparencia-btn" data-guia="pular">${i === passos.length - 1 ? 'Fechar' : 'Pular'}</button>`
        + (i ? '<button type="button" class="aparencia-btn" data-guia="voltar">Voltar</button>' : '')
        + `<button type="button" class="auth-btn home-btn-start" data-guia="proximo">${i === passos.length - 1 ? 'Concluir' : 'Próximo'}</button></div>`;
    requestAnimationFrame(() => {                             /* abaixo do elemento, acima, ou na borda da tela se não couber */
        const r = alvo.getBoundingClientRect(), h = balao.offsetHeight, w = balao.offsetWidth;
        let top;
        if (r.bottom + 12 + h < innerHeight) top = r.bottom + 12;
        else if (r.top - h - 12 > 0) top = r.top - h - 12;
        else top = r.top + r.height / 2 > innerHeight / 2 ? 8 : innerHeight - h - 8;
        balao.style.top = Math.max(8, top) + 'px';
        balao.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
        balao.querySelector('[data-guia="proximo"]').focus();
    });
}
function iniciarGuia(nome) {
    if (!GUIAS[nome]) return;
    _guiaAtual = nome;
    _mostrarPasso(0);
}
document.getElementById('ajudaBtn').addEventListener('click', () => iniciarGuia('inicio'));
document.addEventListener('keydown', e => { if (_guiaPasso >= 0 && e.key === 'Escape') _fecharGuia(); });
/* um ❓ em cada tela: no cabeçalho das telas e na barra de cima da resolução */
for (const [nome, g] of Object.entries(GUIAS)) {
    if (nome === 'inicio') continue;
    const tela = document.getElementById(g.tela);
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.guiaTela = nome;
    b.title = 'Como usar esta tela'; b.setAttribute('aria-label', 'Ajuda: como usar esta tela');
    b.textContent = '❓';
    if (nome === 'resolucao') {
        b.className = 'icon-btn ajuda-tela-btn';
        const ref = document.getElementById('progressBtnResolving');
        ref.parentNode.insertBefore(b, ref.nextSibling);
    } else {
        b.className = 'ajuda-tela-btn ajuda-cabecalho';
        tela.querySelector('.progress-header')?.appendChild(b);
    }
    b.addEventListener('click', e => { e.stopPropagation(); iniciarGuia(nome); });
}
/* primeira visita: mostra o passeio da tela inicial */
const _showHomeGuia = showHome;
showHome = function () {
    _showHomeGuia();
    let visto = true;
    try { visto = localStorage.getItem(GUIA_KEY) === '1'; } catch {}
    if (!visto && _guiaPasso < 0) setTimeout(() => { if (!authScreen.classList.contains('hidden') && _guiaPasso < 0) iniciarGuia('inicio'); }, 600);
};
