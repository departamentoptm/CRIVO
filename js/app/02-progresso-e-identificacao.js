/* ============================================================
   PROGRESSO
   ============================================================ */
function aplicarEvento(estado, ev) {
    const q = ((estado[ev.prova] ||= {})[ev.ano] ||= {});
    q[ev.questao] = { selected: ev.opcao, correct: ev.acao === 'confirmou' ? ev.correta : undefined, timestamp: ev.data };
}
function saveProgressForQuestion(exam, year, num, data) {
    if (!currentRA) return;
    if (!data || !data.correct) return;            /* toques nas alternativas antes de confirmar não são guardados */
    const agora = new Date();
    const ev = { data: agora.toISOString(),
                 prova: exam, ano: year, questao: String(num),
                 acao: data.correct ? 'confirmou' : 'selecionou', opcao: data.selected };
    if (data.correct) {
        ev.correta = data.correct;
        if (data.tempoMs != null) ev.tempoMs = data.tempoMs;
    }
    for (let i = progress.registro.length - 1; i >= 0; i--) {
        const u = progress.registro[i];
        if (u.prova === ev.prova && u.ano === ev.ano && u.questao === ev.questao) {
            if (u.acao === ev.acao && u.opcao === ev.opcao && u.correta === ev.correta) return;
            break;
        }
    }
    progress.registro.push(ev);
    aplicarEvento(progress.estado, ev);
    setDirty(true);
    salvarBackup();
}
function getSavedState(exam, year, num) { return progress.estado?.[exam]?.[year]?.[num] || null; }
function getLastPos() { return progress.ultimaPosicao; }
function setLastPos(exam, year, num) {
    if (!currentRA) return;
    progress.ultimaPosicao = { exam, year, num };
    salvarBackup();
}
function setDirty(v) {
    dirty = v;
    /* o progresso já fica no navegador: o botão só chama atenção se a gravação falhou */
    const alerta = typeof gravacaoFalhou !== 'undefined' && gravacaoFalhou;
    saveBtn.classList.toggle('unsaved', alerta);
    saveBtn.innerHTML = '<span class="ico">💾</span><span class="lbl"> Salvar</span>' + (alerta ? '<span class="dot"> •</span>' : '');
}

const bkKey = ra => 'crivo_backup_' + ra;
const filtrosKey = ra => 'crivo_filtros_' + ra;
/* ============================================================
   ARMAZENAMENTO DO PROGRESSO
   O progresso fica no banco de dados do navegador (IndexedDB), que comporta centenas de MB; o localStorage
   (limite de ~5 MB, cerca de 15 mil questões) só é usado se o IndexedDB não estiver disponível. Na primeira
   vez, o progresso que estava no localStorage é copiado para o IndexedDB e só então apagado de lá.
   Registro compacto: só confirmações (não os toques nas alternativas) e sem campos repetidos.
   ============================================================ */
const ARMAZEM = { db: null, cache: new Map(), gravando: false, pendente: false };
function compactarRegistro(reg) {
    return reg.filter(e => e && e.prova && e.ano && e.questao && e.opcao && e.acao !== 'selecionou')
        .map(e => { if (!('dataHora' in e)) return e; const { dataHora, ...r } = e; return r; });
}
function _abrirIdb() {
    return new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('sem IndexedDB'));
        const r = indexedDB.open('crivo', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('dados');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('IndexedDB bloqueado'));
    });
}
function _idb(modo, fn) {
    return new Promise((res, rej) => {
        const tx = ARMAZEM.db.transaction('dados', modo), req = fn(tx.objectStore('dados'));
        tx.oncomplete = () => res(req ? req.result : undefined);
        tx.onerror = tx.onabort = () => rej(tx.error || new Error('falha no IndexedDB'));
    });
}
/* abre o banco e traz o progresso guardado (copiando do localStorage na primeira vez) */
async function prepararArmazenamento(ra) {
    try { ARMAZEM.db = ARMAZEM.db || await _abrirIdb(); } catch (e) { console.warn('IndexedDB indisponível, usando localStorage:', e); ARMAZEM.db = null; return; }
    const chave = bkKey(ra);
    let v = null;
    try { v = await _idb('readonly', st => st.get(chave)); } catch (e) { console.warn('leitura do IndexedDB:', e); }
    if (!v) {
        try {
            const t = localStorage.getItem(chave);
            if (t) { v = JSON.parse(t); await _idb('readwrite', st => st.put(v, chave)); localStorage.removeItem(chave); }
        } catch (e) { console.warn('cópia do localStorage para o IndexedDB:', e); }
    }
    if (v) ARMAZEM.cache.set(chave, v);
}
let gravacaoFalhou = false;
function _falhaAoGravar() {
    if (!gravacaoFalhou) setTimeout(() => alert('⚠️ Não foi possível guardar o seu progresso neste navegador.\n\n'
        + 'Para não perder o que você fez: toque em "Salvar progresso em arquivo" ou ligue a sincronização com o Google Drive.'), 0);
    gravacaoFalhou = true;
    try { saveBtn.classList.add('unsaved'); } catch {}
}
function _gravouBem() {
    if (!gravacaoFalhou) return;
    gravacaoFalhou = false;
    try { setDirty(dirty); } catch {}
}
/* grava a versão mais recente; mudanças feitas durante uma gravação entram na seguinte */
function _gravarIdb() {
    ARMAZEM.pendente = true;
    if (ARMAZEM.gravando) return;
    ARMAZEM.gravando = true;
    (async () => {
        while (ARMAZEM.pendente) {
            ARMAZEM.pendente = false;
            const chave = bkKey(currentRA), valor = progress;
            try { await _idb('readwrite', st => st.put(valor, chave)); ARMAZEM.cache.set(chave, valor); _gravouBem(); }
            catch (e) { console.warn('gravação no IndexedDB:', e); _falhaAoGravar(); }
        }
        ARMAZEM.gravando = false;
    })();
}
function salvarBackup() {
    if (!currentRA) return;
    if (ARMAZEM.db) { _gravarIdb(); return; }
    try { localStorage.setItem(bkKey(currentRA), JSON.stringify(progress)); _gravouBem(); }
    catch (e) { _falhaAoGravar(); }
}
function lerBackup(ra) {
    try {
        const guardado = ARMAZEM.db ? ARMAZEM.cache.get(bkKey(ra)) : null;
        const v = guardado ? Object.assign({}, guardado, { registro: compactarRegistro(guardado.registro || []) })
            : JSON.parse(localStorage.getItem(bkKey(ra)));
        /* estado vazio com registro (arquivo antigo): refaz o estado a partir das respostas */
        if (v && Array.isArray(v.registro) && v.registro.length && (!v.estado || !Object.keys(v.estado).length)) {
            v.estado = {}; v.registro.forEach(ev => aplicarEvento(v.estado, ev));
        }
        if (v && v.estado) {
            if (!Array.isArray(v.grifados)) v.grifados = [];
            if (!v.resetados || typeof v.resetados !== 'object') v.resetados = {};
            if (!Array.isArray(v.avaliacoes)) v.avaliacoes = [];
            if (!v.cartoes || typeof v.cartoes !== 'object') v.cartoes = {};
            if (!v.grifosApagados || typeof v.grifosApagados !== 'object') v.grifosApagados = {};
            return v;
        }
        return null;
    } catch { return null; }
}

function normalizar(d) {
    const p = { estado: {}, ultimaPosicao: d.ultimaPosicao || null,
                registro: compactarRegistro(Array.isArray(d.registro) ? d.registro : []),
                grifados: Array.isArray(d.grifados) ? d.grifados : [],
                resetados: (d.resetados && typeof d.resetados === 'object') ? d.resetados : {},
                avaliacoes: Array.isArray(d.avaliacoes) ? d.avaliacoes.filter(a => a && a.data && a.prova && a.ano && a.questao && a.nota) : [],
                cartoes: (d.cartoes && typeof d.cartoes === 'object') ? d.cartoes : {},
                grifosApagados: (d.grifosApagados && typeof d.grifosApagados === 'object') ? d.grifosApagados : {},
                plano: (d.plano && typeof d.plano === 'object') ? d.plano : null,
                metaDiaria: (d.metaDiaria && typeof d.metaDiaria === 'object') ? d.metaDiaria : null,
                preferencias: (d.preferencias && typeof d.preferencias === 'object') ? d.preferencias : null,
                leituras: (d.leituras && typeof d.leituras === 'object') ? d.leituras : {},
                simulados: Array.isArray(d.simulados) ? d.simulados : [] };
    p.grifados = p.grifados.filter(g => !(g && g.id && p.grifosApagados[g.id]));   /* grifo apagado em outro aparelho */
    if (p.registro.length) p.registro.forEach(ev => aplicarEvento(p.estado, ev));
    else if (d.estado) p.estado = d.estado;
    return p;
}

/* ---- filtros persistidos ---- */
function salvarFiltros() {
    if (!currentRA) return;
    try { localStorage.setItem(filtrosKey(currentRA), JSON.stringify(filtros)); } catch {}
}
function garantirFiltros() { if (filtrosCarregadosPara !== currentRA) { lerFiltros(); filtrosCarregadosPara = currentRA; } }
function lerFiltros() {
    if (!currentRA) return;
    filtros = { bancas: [], anos: [], disciplina: '', tema: '', somenteNaoRealizadas: false, maxQuestoes: 0, revisao: false, embaralhar: false, semente: 0 };
    try {
        const v = JSON.parse(localStorage.getItem(filtrosKey(currentRA)));
        if (v && typeof v === 'object') {
            filtros = {
                bancas: Array.isArray(v.bancas) ? v.bancas : [],
                anos: Array.isArray(v.anos) ? v.anos : [],
                disciplina: v.disciplina || '',
                tema: typeof v.tema === 'string' ? v.tema : '',
                listaNome: typeof v.listaNome === 'string' ? v.listaNome : null,
                somenteNaoRealizadas: !!v.somenteNaoRealizadas,
                comCorrecao: !!v.comCorrecao,
                maxQuestoes: parseInt(v.maxQuestoes) || 0,
                revisao: !!v.revisao,
                embaralhar: !!v.embaralhar,
                semente: parseInt(v.semente) || 0,
                revisaoDia: typeof v.revisaoDia === 'string' ? v.revisaoDia : null,
                lista: Array.isArray(v.lista) ? v.lista : null,
                antes: (v.antes && typeof v.antes === 'object') ? v.antes : null
            };
        }
    } catch {}
}

/* ---- reset/refazer ---- */
function isResetada(banca, ano, num) {
    return !!(progress.resetados?.[banca]?.[ano]?.[num]);
}
function isRealizada(banca, ano, num) {
    const e = progress.estado?.[banca]?.[ano]?.[num];
    return !!(e && e.correct) && !isResetada(banca, ano, num);
}
function _marcarReset(banca, ano, num) {
    if (!progress.resetados) progress.resetados = {};
    const est = progress.estado?.[banca]?.[ano]?.[num] || null;
    (progress.resetados[banca] ||= {});
    (progress.resetados[banca][ano] ||= {});
    progress.resetados[banca][ano][num] = {
        quando: new Date().toISOString(),
        arquivo: arquivoNoManifest(banca, ano, num) || undefined,
        estadoAnterior: est ? { selected: est.selected, correct: est.correct, timestamp: est.timestamp } : null
    };
}
function refazerQuestao(banca, ano, num) {
    if (!currentRA) return;
    _marcarReset(banca, ano, num);
    setDirty(true);
    salvarBackup();
}
function restaurarResposta(banca, ano, num, evento) {
    if (!currentRA) return;
    if (!progress.estado[banca]) progress.estado[banca] = {};
    if (!progress.estado[banca][ano]) progress.estado[banca][ano] = {};
    progress.estado[banca][ano][num] = {
        selected: evento.opcao,
        correct: evento.correta,
        timestamp: evento.data
    };
    const agora = new Date();
    progress.registro.push({
        data: agora.toISOString(),
        prova: banca, ano, questao: String(num),
        acao: 'restaurou',
        opcao: evento.opcao,
        correta: evento.correta,
        restauradoDe: evento.data
    });
    if (progress.resetados?.[banca]?.[ano]?.[num]) {
        delete progress.resetados[banca][ano][num];
    }
    setDirty(true);
    salvarBackup();
}
function restaurarDoReset(banca, ano, num) {
    const snap = progress.resetados?.[banca]?.[ano]?.[num];
    if (snap && snap.estadoAnterior) {
        restaurarResposta(banca, ano, num, {
            opcao: snap.estadoAnterior.selected,
            correta: snap.estadoAnterior.correct,
            data: snap.estadoAnterior.timestamp
        });
    } else {
        delete progress.resetados[banca][ano][num];
        setDirty(true);
        salvarBackup();
    }
}
function respostasAnteriores(banca, ano, num) {
    return (progress.registro || [])
        .filter(e => e.prova === banca && e.ano === ano && String(e.questao) === String(num)
                  && (e.acao === 'confirmou' || e.acao === 'restaurou'))
        .sort((a, b) => new Date(b.data) - new Date(a.data));
}

/* ---- exportar progresso ---- */
function nomeArquivo() {
    const nome = currentUser.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    return `Progresso_${nome}_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.json`;
}
function exportarProgresso() {
    if (!currentRA) return;
    const dados = {
        formato: 'crivo-progresso', versao: 2,
        exportadoEm: new Date().toISOString(),
        ultimaPosicao: progress.ultimaPosicao,
        estado: progress.estado,
        registro: progress.registro,
        grifados: progress.grifados || [],
        resetados: progress.resetados || {},
        avaliacoes: progress.avaliacoes || [],
        cartoes: progress.cartoes || {},
        grifosApagados: progress.grifosApagados || {},
        plano: progress.plano || null,
        metaDiaria: progress.metaDiaria || null,
        preferencias: progress.preferencias || null,
        leituras: progress.leituras || {},
        simulados: progress.simulados || []
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
    a.download = nomeArquivo();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setDirty(false);
}
saveBtn.addEventListener('click', exportarProgresso);

/* ============================================================
   LISTA DE ALUNOS E LOGIN POR RA
   ============================================================ */
/* Identificador do aluno: RA (só números) ou nome/apelido normalizado. Não há lista de alunos:
   o site é aberto a qualquer estudante e o progresso fica no navegador e no Google Drive de cada um. */
function chaveAluno(texto) {
    const t = String(texto || '').trim();
    if (/^[\d.\-\/\s]+$/.test(t)) return t.replace(/\D/g, '');
    return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function info(texto, ok = false) {
    const el = currentRA ? homeMsg : loginMsg;
    el.style.color = ok ? '#28a745' : '#dc3545';
    el.textContent = texto;
}
async function loginWithRA(raBruto) {
    const ra = chaveAluno(raBruto);
    if (!ra) { info('Digite um nome, apelido ou RA.'); return false; }
    const nome = String(raBruto).trim().replace(/\s+/g, ' ');
    currentRA = ra; currentUser = /^\d+$/.test(ra) ? `RA ${ra}` : nome;
    const bk = lerBackup(ra);
    progress = bk || { estado: {}, registro: [], ultimaPosicao: null, grifados: [], resetados: {}, avaliacoes: [], cartoes: {}, grifosApagados: {} };
    if (!Array.isArray(progress.grifados)) progress.grifados = [];
    if (!progress.resetados) progress.resetados = {};
    if (!Array.isArray(progress.avaliacoes)) progress.avaliacoes = [];
    if (!progress.cartoes || typeof progress.cartoes !== 'object') progress.cartoes = {};
    if (!progress.grifosApagados || typeof progress.grifosApagados !== 'object') progress.grifosApagados = {};
    setDirty(!!(bk && bk.registro && bk.registro.length));
    showHome();
    showScreen(authScreen);
    return true;
}

async function carregarArquivo(file) {
    if (!currentRA) { info('Entre primeiro (nome, apelido ou RA) para carregar um arquivo de progresso.'); return; }
    let d;
    try { d = JSON.parse(await file.text()); } catch { info('Arquivo inválido (não é um JSON).'); return; }
    if (d.formato !== 'crivo-progresso') { info('Este não é um arquivo de progresso do CRIVO.'); return; }
    /* o arquivo é somado ao progresso deste aparelho: nenhuma resposta, grifo ou revisão é apagada */
    progress = normalizar(mesclarProgresso(progress, migrarProgresso(d)));
    setDirty(false);
    salvarBackup();
    const n = progress.registro.length;
    const pos = progress.ultimaPosicao;
    info(`Progresso carregado e somado ao deste aparelho: ${n} ação(ões) registradas.` + (pos ? ` Você parou em ${pos.exam} ${pos.year}, questão ${pos.num}.` : ''), true);
    if (currentExam && currentYear && questoes.length > 0) {
        carregarQuestao(questaoAtualIndex);
    }
}
progressFile.addEventListener('change', () => {
    const f = progressFile.files[0];
    progressFile.value = '';
    if (f) carregarArquivo(f);
});
loadBtnHome.addEventListener('click', () => progressFile.click());
