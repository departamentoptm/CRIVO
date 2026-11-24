/* ============================================================
   SALVAMENTO NA NUVEM: INDICADOR, CÓPIAS DE SEGURANÇA E CARREGAR ARQUIVO COM CONFIRMAÇÃO
   - Indicador na barra inferior ("Salvo 14:32", "Salvando…", "A salvar…", "Não salvo", "Sem internet") e um
     aviso flutuante arrastável só quando a autorização do Google expirou ou falta internet.
   - Cópias de segurança no Drive (uma por dia, as 7 mais recentes; feitas em 08-google-drive.js) e o botão
     "Restaurar uma cópia do Drive", que mostra a data e o resumo de cada cópia.
   - Carregar arquivo de progresso: mostra o resumo do arquivo e do progresso atual, avisa se o arquivo é
     mais antigo ou parece de outra pessoa e pergunta: somar, substituir ou cancelar. Antes de substituir,
     guarda uma cópia de segurança (no Drive, se ligado; senão, baixa o arquivo do progresso atual).
   ============================================================ */

/* ---------- resumo de um progresso ---------- */
function resumoProgresso(p) {
    const reg = (p && p.registro) || [];
    const qs = new Set();
    let ultima = 0;
    for (const e of reg) {
        if (e.acao === 'confirmou') qs.add(`${e.prova}|${e.ano}|${e.questao}`);
        const t = +new Date(e.data) || 0; if (t > ultima) ultima = t;
    }
    for (const c of Object.values((p && p.cartoes) || {})) for (const v of (c && c.revisoes) || []) { const t = +new Date(v.data) || 0; if (t > ultima) ultima = t; }
    return { questoes: qs, nQuestoes: qs.size, acoes: reg.length, grifos: ((p && p.grifados) || []).length,
             cartoes: Object.keys((p && p.cartoes) || {}).length, ultima };
}
const _quando = t => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
function _linhaResumo(r) {
    return `${r.nQuestoes} questões feitas · ${r.acoes} ações · ${r.grifos} grifos · ${r.cartoes} cartões · última atividade: ${_quando(r.ultima)}`;
}

/* ---------- caixa de escolha (modal) ---------- */
function escolherOpcao(titulo, html, botoes) {
    return new Promise(res => {
        const ov = document.createElement('div');
        ov.className = 'modal-overlay';
        ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="escolhaTit"><h3 id="escolhaTit">${escapeHtml(titulo)}</h3>`
            + `<div class="escolha-corpo">${html}</div><div class="escolha-botoes">`
            + botoes.map((b, i) => `<button type="button" class="${b.classe || 'aparencia-btn'}" data-i="${i}">${escapeHtml(b.texto)}</button>`).join('')
            + '</div></div>';
        const fim = v => { ov.remove(); document.removeEventListener('keydown', esc, true); res(v); };
        const esc = e => { if (e.key === 'Escape') { e.preventDefault(); fim(null); } };
        ov.addEventListener('click', e => {
            if (e.target === ov) return fim(null);
            const b = e.target.closest('button[data-i]');
            if (b) fim(botoes[+b.dataset.i].valor);
        });
        document.addEventListener('keydown', esc, true);
        document.body.appendChild(ov);
        setTimeout(() => ov.querySelector('button[data-i]')?.focus(), 30);
    });
}

/* ---------- indicador na barra inferior e aviso arrastável ----------
   O estado do salvamento aparece só na barra inferior da resolução, entre "Anterior" e o botão ▾ (com a barra
   minimizada, só o ícone, ao lado do contador). O aviso flutuante aparece só quando a autorização do Google
   expirou ou falta internet; pode ser arrastado, e o site lembra onde ele ficou. */
let _indicadorEstado = '', _avisoArrastado = false;
/* o clique no aviso é tratado aqui, antes dos outros ouvintes: depois de arrastar, não faz nada; senão, reconecta */
window.addEventListener('click', e => {
    if (!e.target || !e.target.closest || !e.target.closest('#nuvemAviso')) return;
    e.stopPropagation(); e.preventDefault();
    const arrastou = _avisoArrastado; _avisoArrastado = false;
    if (!arrastou && _indicadorEstado === 'reconectar') sincronizarDrive(true).catch(() => {});
}, true);
const AVISO_POS_KEY = 'crivo_aviso_pos';
function _elIndicadorBarra() {
    let el = document.getElementById('nuvemBarra');
    if (el) return el;
    const centro = document.querySelector('.bottom-center');
    if (!centro) return null;
    el = document.createElement('button');
    el.type = 'button'; el.id = 'nuvemBarra'; el.className = 'nuvem-barra'; el.hidden = true;
    el.setAttribute('aria-live', 'polite');
    el.addEventListener('click', () => {
        if (['reconectar', 'erro', 'pendente'].includes(_indicadorEstado)) sincronizarDrive(true).catch(() => {});
    });
    centro.insertBefore(el, centro.firstChild);
    return el;
}
function _posicionarAviso(el) {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(AVISO_POS_KEY)); } catch {}
    if (!p || !isFinite(p.x) || !isFinite(p.y)) { el.style.left = ''; el.style.top = ''; el.style.right = ''; return; }
    const w = el.offsetWidth || 260, h = el.offsetHeight || 60;
    el.style.right = 'auto';
    el.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, p.x)) + 'px';
    el.style.top = Math.max(4, Math.min(window.innerHeight - h - 4, p.y)) + 'px';
}
function _elAviso() {
    let el = document.getElementById('nuvemAviso');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'nuvemAviso'; el.className = 'nuvem-aviso'; el.hidden = true;
    el.setAttribute('role', 'alert'); el.tabIndex = 0;
    document.body.appendChild(el);
    let ini = null, moveu = false;
    el.addEventListener('pointerdown', e => {
        if (e.button) return;
        const r = el.getBoundingClientRect();
        ini = { x: e.clientX, y: e.clientY, l: r.left, t: r.top }; moveu = false;
        try { el.setPointerCapture(e.pointerId); } catch {}
    });
    el.addEventListener('pointermove', e => {
        if (!ini) return;
        const dx = e.clientX - ini.x, dy = e.clientY - ini.y;
        if (!moveu && Math.hypot(dx, dy) < 6) return;
        moveu = true;
        el.classList.add('arrastando');
        el.style.right = 'auto';
        el.style.left = Math.max(4, Math.min(window.innerWidth - el.offsetWidth - 4, ini.l + dx)) + 'px';
        el.style.top = Math.max(4, Math.min(window.innerHeight - el.offsetHeight - 4, ini.t + dy)) + 'px';
    });
    const soltar = () => {
        if (!ini) return;
        ini = null; el.classList.remove('arrastando');
        if (moveu) { try { localStorage.setItem(AVISO_POS_KEY, JSON.stringify({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) })); } catch {} }
        _avisoArrastado = moveu;
    };
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', () => { ini = null; el.classList.remove('arrastando'); });
    el.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && _indicadorEstado === 'reconectar') { e.preventDefault(); sincronizarDrive(true).catch(() => {}); }
    });
    return el;
}
function mostrarIndicadorDrive(estado) {
    if (estado) _indicadorEstado = estado;
    const barra = _elIndicadorBarra(), aviso = _elAviso();
    const ligado = !!(currentRA && driveAtivo);
    const hh = driveUltimoSalvo ? new Date(driveUltimoSalvo).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
    const textos = {
        salvando: ['☁️', 'Salvando…', 'Salvando no Drive…'],
        salvo: ['☁️', hh ? `Salvo ${hh}` : 'Salvo', hh ? `Salvo no Drive às ${hh}` : 'Salvo no Drive'],
        pendente: ['☁️', 'A salvar…', 'Alterações a salvar no Drive'],
        reconectar: ['⚠️', 'Não salvo', `Não salvo na nuvem${hh ? ` (último: ${hh})` : ''} — toque para reconectar`],
        offline: ['📴', 'Sem internet', 'Sem internet — salvo neste aparelho'],
        erro: ['⚠️', 'Falha', 'Falha ao salvar no Drive — toque para tentar de novo'],
    };
    const [ico, curto, longo] = textos[_indicadorEstado] || textos.salvo;
    if (barra) {
        barra.hidden = !ligado;
        barra.innerHTML = `<span aria-hidden="true">${ico}</span><span class="nuvem-txt">${escapeHtml(curto)}</span>`;
        barra.className = 'nuvem-barra' + (_indicadorEstado === 'reconectar' || _indicadorEstado === 'erro' ? ' alerta' : _indicadorEstado === 'offline' ? ' offline' : '');
        barra.title = longo; barra.setAttribute('aria-label', longo);
    }
    const problema = ligado && (_indicadorEstado === 'reconectar' || _indicadorEstado === 'offline');
    if (!problema) { aviso.hidden = true; return; }
    aviso.className = 'nuvem-aviso ' + (_indicadorEstado === 'offline' ? 'offline' : 'alerta');
    aviso.innerHTML = _indicadorEstado === 'offline'
        ? '<b>📴 Sem internet</b><span>Seu progresso está salvo neste aparelho e vai para o Drive quando a conexão voltar.</span>'
        : `<b>⚠️ Não salvo na nuvem</b><span>A autorização do Google expirou${hh ? ` (último salvamento: ${hh})` : ''}. Seu progresso está salvo neste aparelho. Toque aqui para reconectar.</span>`;
    const estavaOculto = aviso.hidden;
    aviso.hidden = false;
    if (estavaOculto) _posicionarAviso(aviso);
}
window.addEventListener('resize', () => { const a = document.getElementById('nuvemAviso'); if (a && !a.hidden) _posicionarAviso(a); });
setInterval(() => { try { mostrarIndicadorDrive(); } catch {} }, 30000);
window.addEventListener('offline', () => mostrarIndicadorDrive('offline'));
window.addEventListener('online', () => {
    if (_indicadorEstado === 'offline') mostrarIndicadorDrive(driveTok && Date.now() < driveTokExp - 60000 ? 'pendente' : 'reconectar');
});
const _loginIndicador = loginWithRA;
loginWithRA = async function (ra) { const ok = await _loginIndicador(ra); setTimeout(() => mostrarIndicadorDrive(), 0); return ok; };
logoutBtn.addEventListener('click', () => setTimeout(() => mostrarIndicadorDrive(), 0));

/* ---------- salvar em arquivo também salva no Drive ---------- */
document.getElementById('saveBtnHome').addEventListener('click', () => {
    if (currentRA && driveAtivo && driveTok && Date.now() < driveTokExp - 60000) sincronizarDrive(false).catch(() => {});
});

/* ---------- cópia de segurança antes de substituir ---------- */
async function guardarCopiaAntesDeSubstituir(motivo) {
    if (driveAtivo) {
        try {
            await driveObterToken(true);
            const pasta = await driveAcharOuCriarPasta();
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            await driveGravar(pasta, `${DRIVE_PREFIXO_COPIA}antes-de-${motivo}_${stamp}.json`, null, driveDadosParaNuvem());
            return 'drive';
        } catch (e) { console.warn('cópia antes de substituir:', e); }
    }
    exportarProgresso();                         /* sem Drive (ou falhou): baixa o arquivo do progresso atual */
    return 'arquivo';
}
function _substituirProgresso(novo) {
    progress = normalizar(migrarProgresso(novo));
    setDirty(false); salvarBackup();
    try { if (currentExam && currentYear && questoes.length) carregarQuestao(questaoAtualIndex); } catch {}
}

/* ---------- carregar arquivo: comparar e perguntar ---------- */
carregarArquivo = async function (file) {
    if (!currentRA) { info('Entre primeiro (nome, apelido ou RA) para carregar um arquivo de progresso.'); return; }
    let d;
    try { d = JSON.parse(await file.text()); } catch { info('Arquivo inválido (não é um JSON).'); return; }
    if (d.formato !== 'crivo-progresso') { info('Este não é um arquivo de progresso do CRIVO.'); return; }
    const arq = resumoProgresso(migrarProgresso(d)), atual = resumoProgresso(progress);
    const comuns = [...arq.questoes].filter(k => atual.questoes.has(k)).length;
    const avisos = [];
    if (arq.ultima && atual.ultima && arq.ultima < atual.ultima) avisos.push('O arquivo é <b>mais antigo</b> que o progresso deste aparelho.');
    if (arq.nQuestoes >= 20 && atual.nQuestoes >= 20 && comuns < 0.1 * Math.min(arq.nQuestoes, atual.nQuestoes))
        avisos.push('Os dois têm <b>poucas questões em comum</b>: o arquivo pode ser de outra pessoa.');
    if (arq.nQuestoes < atual.nQuestoes) avisos.push('O arquivo tem <b>menos questões feitas</b> que o progresso atual.');
    const html = `<p><b>Arquivo</b> (${escapeHtml(file.name)}):<br>${_linhaResumo(arq)}</p>`
        + `<p><b>Progresso atual</b>${driveAtivo ? ' (deste aparelho, sincronizado com o Drive)' : ''}:<br>${_linhaResumo(atual)}</p>`
        + `<p>${comuns} questões aparecem nos dois.</p>`
        + (avisos.length ? `<p class="escolha-aviso">⚠️ ${avisos.join('<br>⚠️ ')}</p>` : '')
        + '<p class="desemp-nota"><b>Somar</b> junta os dois sem apagar nada (recomendado). <b>Substituir</b> troca o progresso atual pelo do arquivo'
        + (driveAtivo ? ', inclusive no Drive; antes, uma cópia de segurança do progresso atual é guardada no Drive.' : '; antes, o progresso atual é baixado num arquivo de segurança.') + '</p>';
    const escolha = await escolherOpcao('Carregar arquivo de progresso', html, [
        { texto: 'Somar ao meu progresso', valor: 'somar', classe: 'auth-btn home-btn-start' },
        { texto: 'Substituir o meu progresso', valor: 'substituir' },
        { texto: 'Cancelar', valor: null },
    ]);
    if (!escolha) return;
    if (escolha === 'somar') {
        progress = normalizar(mesclarProgresso(progress, migrarProgresso(d)));
        setDirty(false); salvarBackup();
        const pos = progress.ultimaPosicao;
        info(`Progresso carregado e somado ao deste aparelho: ${progress.registro.length} ação(ões) registradas.` + (pos ? ` Você parou em ${pos.exam} ${pos.year}, questão ${pos.num}.` : ''), true);
        try { if (currentExam && currentYear && questoes.length) carregarQuestao(questaoAtualIndex); } catch {}
        return;
    }
    const ok = await escolherOpcao('Substituir o progresso?', '<p>O progresso atual será trocado pelo do arquivo. '
        + (driveAtivo ? 'Outros aparelhos ainda sincronizados podem trazer de volta respostas que não estão no arquivo; se for o caso, use “Sair” neles antes. ' : '')
        + 'Deseja continuar?</p>', [{ texto: 'Sim, substituir', valor: true, classe: 'auth-btn home-btn-danger' }, { texto: 'Cancelar', valor: false }]);
    if (!ok) return;
    const onde = await guardarCopiaAntesDeSubstituir('substituir');
    _substituirProgresso(d);
    if (driveAtivo) await sincronizarDrive(false, { substituir: true }).catch(() => {});
    info(`Progresso substituído pelo do arquivo. Cópia de segurança do progresso anterior: ${onde === 'drive' ? 'no Drive (Restaurar uma cópia)' : 'arquivo baixado'}.`, true);
};

/* ---------- restaurar uma cópia do Drive ---------- */
async function abrirRestaurarCopia() {
    if (!currentRA) return;
    try {
        driveMsg('☁️ Buscando as cópias no Drive…');
        await driveObterToken(true);
        const pasta = await driveAcharOuCriarPasta();
        const copias = (await driveListar(pasta, DRIVE_PREFIXO_COPIA)).slice(0, 12);
        if (!copias.length) { driveMsg('Ainda não há cópias de segurança no Drive (a primeira é feita na sincronização de hoje).'); return; }
        const dados = [];
        for (const f of copias) {
            try { const x = JSON.parse(await driveLer(f.id)); dados.push({ f, x, r: resumoProgresso(migrarProgresso(x)) }); } catch {}
        }
        driveMsg('');
        const nomeCopia = f => { const m = /antes-de-(\w+)_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/.exec(f.name);
            return m ? `antes de ${m[1] === 'restaurar' ? 'restaurar' : 'substituir'} (${m[2].split('-').reverse().join('/')} ${m[3]}:${m[4]})`
                     : `cópia de ${f.name.slice(DRIVE_PREFIXO_COPIA.length, -5).split('-').reverse().join('/')}`; };
        const escolha = await escolherOpcao('Restaurar uma cópia do Drive',
            `<p>Progresso atual: ${_linhaResumo(resumoProgresso(progress))}</p><p>Escolha a cópia:</p>`,
            [...dados.map(d => ({ texto: `${nomeCopia(d.f)} — ${d.r.nQuestoes} questões, última atividade ${_quando(d.r.ultima)}`, valor: d })), { texto: 'Cancelar', valor: null }]);
        if (!escolha) return;
        const ok = await escolherOpcao('Restaurar esta cópia?', `<p>${_linhaResumo(escolha.r)}</p><p>O progresso atual será trocado por esta cópia `
            + '(antes, ele é guardado como mais uma cópia no Drive). Outros aparelhos ainda sincronizados podem trazer de volta respostas que não estão na cópia; '
            + 'se for o caso, use “Sair” neles antes.</p>', [{ texto: 'Sim, restaurar', valor: true, classe: 'auth-btn home-btn-danger' }, { texto: 'Cancelar', valor: false }]);
        if (!ok) return;
        await guardarCopiaAntesDeSubstituir('restaurar');
        _substituirProgresso(escolha.x);
        await sincronizarDrive(false, { substituir: true });
        info('Cópia restaurada.', true);
    } catch (e) {
        driveMsg('Não foi possível abrir as cópias do Drive. Tente de novo.', true);
    }
}
(function () {
    const st = document.getElementById('driveStatus');
    if (!st) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'restaurarCopiaBtn'; b.className = 'aparencia-btn restaurar-copia'; b.hidden = true;
    b.textContent = '🗂️ Restaurar uma cópia do Drive';
    b.addEventListener('click', abrirRestaurarCopia);
    st.insertAdjacentElement('afterend', b);
    const atualizar = () => { b.hidden = !(currentRA && driveAtivo); };
    const _sh = showHome;
    showHome = function () { _sh(); atualizar(); };
    setInterval(atualizar, 5000);
})();
