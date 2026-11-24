/* ============================================================
   SINCRONIZAÇÃO COM O GOOGLE DRIVE (pasta "CRIVO - Progresso")
   O aluno autoriza uma vez; o site lê, mescla e grava o arquivo.
   Escopo drive.file: o site só enxerga o que ele mesmo criou.
   ============================================================ */
/* >>> COLE AQUI o "ID do cliente OAuth" criado no Google Cloud <<< */
const DRIVE_CLIENT_ID = '500615111789-t1ho7i5jaglgcb7c8ptfes0opf6gea8c.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_PASTA = 'CRIVO - Progresso';
const DRIVE_INTERVALO_MS = 10000, DRIVE_COPIAS_MANTIDAS = 7;
const DRIVE_PREFIXO_PENDENTE = 'crivo_pendente_', DRIVE_PREFIXO_COPIA = 'crivo_copia_';
const driveBtnHome = document.getElementById('driveBtnHome');
const driveStatusEl = document.getElementById('driveStatus');
let driveTok = null, driveTokExp = 0, driveClient = null, driveGisPromise = null;
let driveResolver = null, driveRejeitar = null;
let driveSincronizando = false, driveRepetir = false, driveAtivo = false, driveTimer = null, drivePastaId = null;
let driveArquivoId = null, driveUltimaAssinatura = '', driveTokPromise = null, driveUltimaTentativa = 0, driveSalvandoInterno = false;
let driveSubstituirPendente = false, driveUltimoSalvo = 0;
/* indicador flutuante (definido em 16-drive-seguranca.js) */
function driveIndicador(estado) { try { if (typeof mostrarIndicadorDrive === 'function') mostrarIndicadorDrive(estado); } catch {} }
const DRIVE_DEVICE_FLAG = 'crivo_drive_dispositivo';
const driveFlagKey = ra => 'crivo_drive_ativo_' + ra;
const driveConfigurado = () => !/COLE_AQUI/.test(DRIVE_CLIENT_ID);

function driveMsg(texto, erro) {
    driveStatusEl.textContent = texto || '';
    driveStatusEl.classList.toggle('erro', !!erro);
}

function driveCarregarGis() {
    if (driveGisPromise) return driveGisPromise;
    driveGisPromise = new Promise((res, rej) => {
        if (window.google && google.accounts && google.accounts.oauth2) return res();
        const sc = document.createElement('script');
        sc.src = 'https://accounts.google.com/gsi/client';
        sc.async = true;
        sc.onload = () => res();
        sc.onerror = () => { driveGisPromise = null; rej(new Error('gis')); };
        document.head.appendChild(sc);
    });
    return driveGisPromise;
}

function driveObterToken(interativo) {
    if (driveTok && Date.now() < driveTokExp - 60000) return Promise.resolve(driveTok);
    if (driveTokPromise) return driveTokPromise;
    driveTokPromise = driveCarregarGis().then(() => new Promise((res, rej) => {
        if (!driveClient) {
            driveClient = google.accounts.oauth2.initTokenClient({
                client_id: DRIVE_CLIENT_ID,
                scope: DRIVE_SCOPE,
                callback: (r) => driveResolver && driveResolver(r),
                error_callback: (e) => driveRejeitar && driveRejeitar(Object.assign(new Error('auth'), { motivo: e && e.type })),
            });
        }
        driveResolver = (r) => {
            if (!r || r.error || !r.access_token) return rej(Object.assign(new Error('auth'), { motivo: r && r.error }));
            driveTok = r.access_token;
            driveTokExp = Date.now() + (parseInt(r.expires_in) || 3600) * 1000;
            res(driveTok);
        };
        driveRejeitar = rej;
        driveClient.requestAccessToken(interativo ? {} : { prompt: 'none' });
    }));
    const limpar = () => { driveTokPromise = null; };
    driveTokPromise.then(limpar, limpar);
    return driveTokPromise;
}

async function driveFetch(url, opts = {}) {
    const r = await fetch(url, Object.assign({}, opts, {
        headers: Object.assign({ Authorization: 'Bearer ' + driveTok }, opts.headers || {})
    }));
    if (r.status === 401) { driveTok = null; throw new Error('auth'); }
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r;
}
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3/files';

async function driveAcharOuCriarPasta() {
    if (drivePastaId) return drivePastaId;
    const q = `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_PASTA}' and trashed=false`;
    const r = await driveFetch(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`);
    const j = await r.json();
    if (j.files && j.files.length) return (drivePastaId = j.files[0].id);
    const c = await driveFetch(`${DRIVE_API}?fields=id`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: DRIVE_PASTA, mimeType: 'application/vnd.google-apps.folder' })
    });
    return (drivePastaId = (await c.json()).id);
}
async function driveProgressosAntigos(pastaId) {
    const q = `name contains 'crivo_progresso_' and '${pastaId}' in parents and trashed=false`;
    const r = await driveFetch(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`);
    const j = await r.json();
    return (j.files || []).filter(f => /^crivo_progresso_.+\.json$/.test(f.name));
}
async function driveAcharArquivo(pastaId, nome) {
    const q = `name='${nome}' and '${pastaId}' in parents and trashed=false`;
    const r = await driveFetch(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,modifiedTime)&spaces=drive&orderBy=modifiedTime desc`);
    const j = await r.json();
    return (j.files && j.files[0]) || null;
}
async function driveListar(pastaId, prefixo) {
    const q = `name contains '${prefixo}' and '${pastaId}' in parents and trashed=false`;
    const r = await driveFetch(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&spaces=drive&orderBy=modifiedTime desc&pageSize=100`);
    return ((await r.json()).files || []).filter(f => f.name.startsWith(prefixo));
}
/* vai para a lixeira do Drive (recuperável por 30 dias), nunca apagado direto */
async function driveLixeira(id) {
    try { await driveFetch(`${DRIVE_API}/${id}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); }
    catch (e) { if (e.status !== 404) throw e; }
}
async function driveLer(id) { return (await driveFetch(`${DRIVE_API}/${id}?alt=media`)).text(); }
async function driveGravar(pastaId, nome, existente, conteudo) {
    if (existente) {
        await driveFetch(`${DRIVE_UP}/${existente.id}?uploadType=media&fields=id`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: conteudo
        });
        return existente.id;
    }
    const b = 'crivo' + Math.random().toString(36).slice(2);
    const meta = { name: nome, parents: [pastaId], mimeType: 'application/json' };
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
                 `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${conteudo}\r\n--${b}--`;
    const r = await driveFetch(`${DRIVE_UP}?uploadType=multipart&fields=id`, {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body
    });
    return (await r.json()).id;
}

/* ---- mescla o progresso local com o da nuvem (nunca apaga respostas) ---- */
function _driveChaveEv(e) { return [e.data, e.prova, e.ano, e.questao, e.acao, e.opcao, e.correta || ''].join('|'); }
function mesclarProgresso(a, b) {
    const mapa = new Map();
    [...(a.registro || []), ...(b.registro || [])].forEach(e => { if (e && e.data) { const k = _driveChaveEv(e); if (!mapa.has(k)) mapa.set(k, e); } });
    const registro = [...mapa.values()].sort((x, y) => new Date(x.data) - new Date(y.data));

    const grifosApagados = {};
    [a.grifosApagados || {}, b.grifosApagados || {}].forEach(x => {
        for (const [id, quando] of Object.entries(x)) if (!grifosApagados[id] || quando > grifosApagados[id]) grifosApagados[id] = quando;
    });
    const gm = new Map(), grifados = [];
    [...(a.grifados || []), ...(b.grifados || [])].forEach(g => {
        if (!g || (g.id && grifosApagados[g.id])) return;
        if (!g.id) { grifados.push(g); return; }
        if (!gm.has(g.id)) { gm.set(g.id, g); grifados.push(g); }
    });

    const ultimo = {};
    registro.forEach(e => { if (e.acao === 'confirmou' || e.acao === 'restaurou') ultimo[[e.prova, e.ano, e.questao].join('|')] = e.data; });
    const resetados = {};
    [a.resetados || {}, b.resetados || {}].forEach(rs => {
        for (const pr of Object.keys(rs)) for (const an of Object.keys(rs[pr] || {})) for (const nm of Object.keys(rs[pr][an] || {})) {
            const r = rs[pr][an][nm];
            const atual = (((resetados[pr] || {})[an]) || {})[nm];
            if (atual && r && atual.quando && r.quando && new Date(atual.quando) >= new Date(r.quando)) continue;
            const u = ultimo[[pr, an, nm].join('|')];
            if (u && r && r.quando && new Date(u) > new Date(r.quando)) continue;   /* respondida depois do reset */
            ((resetados[pr] ||= {})[an] ||= {})[nm] = r;
        }
    });

    const dUlt = (p) => { const r = p.registro || []; return r.length ? Math.max(...r.map(e => +new Date(e.data) || 0)) : 0; };
    const ultimaPosicao = (dUlt(b) > dUlt(a) && b.ultimaPosicao) ? b.ultimaPosicao : (a.ultimaPosicao || b.ultimaPosicao || null);
    const am = new Map();
    [...(a.avaliacoes || []), ...(b.avaliacoes || [])].forEach(v => {
        if (v && v.data) { const k = [v.data, v.prova, v.ano, v.questao, v.nota].join('|'); if (!am.has(k)) am.set(k, v); }
    });
    const avaliacoes = [...am.values()].sort((x, y) => new Date(x.data) - new Date(y.data));
    /* plano de estudo e meta diária: vale a versão alterada por último */
    const maisNovo = (x, y) => (!x ? y || null : !y ? x : (String(y.atualizado || '') > String(x.atualizado || '') ? y : x));
    return { registro, grifados, resetados, ultimaPosicao, avaliacoes, grifosApagados,
             cartoes: mesclarCartoes(a.cartoes, b.cartoes),
             plano: maisNovo(a.plano, b.plano), metaDiaria: maisNovo(a.metaDiaria, b.metaDiaria),
             leituras: Object.assign({}, a.leituras || {}, b.leituras || {}),
             simulados: [...new Map([...(a.simulados || []), ...(b.simulados || [])].filter(s => s && s.id).map(s => [s.id, s])).values()]
                 .sort((x, y) => String(x.inicio).localeCompare(String(y.inicio))) };
}
/* cartões dos grifos: as revisões dos dois lados são somadas; "apagado" vale a data mais recente */
function mesclarCartoes(a, b) {
    const r = {};
    for (const fonte of [a || {}, b || {}]) for (const [id, c] of Object.entries(fonte)) {
        if (!c || typeof c !== 'object') continue;
        const x = r[id];
        if (!x) { r[id] = Object.assign({}, c, { revisoes: Array.isArray(c.revisoes) ? [...c.revisoes] : [] }); continue; }
        const m = new Map();
        [...x.revisoes, ...(Array.isArray(c.revisoes) ? c.revisoes : [])].forEach(v => { if (v && v.data) m.set(v.data + '|' + v.nota, v); });
        x.revisoes = [...m.values()].sort((p, q) => new Date(p.data) - new Date(q.data));
        if (c.criado && (!x.criado || c.criado < x.criado)) x.criado = c.criado;
        if (c.apagado && (!x.apagado || c.apagado > x.apagado)) x.apagado = c.apagado;
    }
    return r;
}

function driveAssinatura() {
    return JSON.stringify([progress.registro, progress.grifados || [], progress.resetados || {}, progress.ultimaPosicao, progress.avaliacoes || [],
                           progress.cartoes || {}, progress.grifosApagados || {}, progress.plano || null, progress.metaDiaria || null,
                           progress.simulados || [], progress.leituras || {}]);
}
function driveDadosParaNuvem() {
    return JSON.stringify({
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
        leituras: progress.leituras || {},
        simulados: progress.simulados || []
    });
}

/* Sincroniza: lê o arquivo do Drive (e os arquivos "pendentes" gravados por qualquer aparelho ao sair),
   JUNTA tudo com o progresso deste aparelho (nada é apagado) e grava o resultado. Com op.substituir (restaurar
   uma cópia ou substituir por um arquivo, sempre a pedido do aluno), grava o progresso deste aparelho por cima e
   manda os pendentes e os arquivos antigos para a lixeira do Drive. Uma vez por dia guarda uma cópia de segurança. */
async function sincronizarDrive(interativo, op = {}) {
    if (!currentRA) return;
    if (!driveConfigurado()) { driveMsg('Sincronização ainda não configurada: defina DRIVE_CLIENT_ID no código.', true); return; }
    if (driveSincronizando) { if (op.substituir) driveSubstituirPendente = true; driveRepetir = true; return; }
    driveSincronizando = true;
    if (driveSubstituirPendente) { op = Object.assign({}, op, { substituir: true }); driveSubstituirPendente = false; }
    const ra = currentRA;
    try {
        driveMsg('☁️ Sincronizando com o Google Drive…');
        driveIndicador('salvando');
        await driveObterToken(interativo);
        const pasta = await driveAcharOuCriarPasta();
        const nome = 'crivo_progresso.json';
        let arq = await driveAcharArquivo(pasta, nome);
        const legados = await driveProgressosAntigos(pasta);
        const pendentes = await driveListar(pasta, DRIVE_PREFIXO_PENDENTE);
        if (ra !== currentRA) return;
        let remoto = null;
        if (op.substituir) {
            for (const f of [...pendentes, ...legados]) await driveLixeira(f.id);
            driveArquivoId = await driveGravar(pasta, nome, arq, driveDadosParaNuvem());
            driveUltimaAssinatura = driveAssinatura();
            await driveCopiaDiaria(pasta);
            driveConcluido(ra);
            return;
        }
        if (arq) {
            try { remoto = JSON.parse(await driveLer(arq.id)); } catch (e) { if (e.status) throw e; remoto = false; }
            if (remoto === false || !remoto || remoto.formato !== 'crivo-progresso') throw new Error('invalido');
        }
        for (const f of [...legados, ...pendentes]) {   /* arquivos antigos (login por RA) e envios feitos ao sair */
            try {
                const x = JSON.parse(await driveLer(f.id));
                if (x && x.formato === 'crivo-progresso') remoto = remoto ? mesclarProgresso(migrarProgresso(remoto), migrarProgresso(x)) : x;
            } catch (e) { if (e.status && e.status !== 404) throw e; }
        }
        if (remoto && !remoto.formato) remoto.formato = 'crivo-progresso';
        if (ra !== currentRA) return;
        if (remoto) {
            const base = { registro: progress.registro, grifados: progress.grifados, resetados: progress.resetados, ultimaPosicao: progress.ultimaPosicao,
                           avaliacoes: progress.avaliacoes, cartoes: progress.cartoes, grifosApagados: progress.grifosApagados,
                           plano: progress.plano, metaDiaria: progress.metaDiaria, simulados: progress.simulados, leituras: progress.leituras };
            progress = normalizar(mesclarProgresso(base, migrarProgresso(remoto)));
            driveSalvandoInterno = true;
            try { salvarBackup(); } finally { driveSalvandoInterno = false; }
        }
        const _assin = driveAssinatura();
        try { driveArquivoId = await driveGravar(pasta, nome, arq, driveDadosParaNuvem()); }
        catch (e) {
            if (e.status === 404 && arq) { driveArquivoId = await driveGravar(pasta, nome, null, driveDadosParaNuvem()); }   /* arquivo apagado no Drive */
            else throw e;
        }
        driveUltimaAssinatura = _assin;
        for (const f of pendentes) await driveLixeira(f.id);           /* já estão juntos no arquivo principal */
        await driveCopiaDiaria(pasta);
        driveConcluido(ra);
    } catch (e) {
        driveIndicador(String(e && e.message) === 'auth' ? 'reconectar' : (navigator.onLine === false ? 'offline' : 'erro'));
        const m = String(e && e.message);
        if (m === 'auth' && !interativo) { driveUltimaTentativa = 0; driveMsg('☁️ Toque em “Sincronizar com Google Drive” (ou em qualquer lugar da tela) para continuar sincronizando.'); }
        else if (m === 'auth') driveMsg({
            popup_failed_to_open: 'O navegador bloqueou a janela do Google. Permita janelas (pop-ups) para este site e tente de novo.',
            popup_closed: 'A janela do Google foi fechada antes de terminar. Tente de novo.',
            access_denied: 'A permissão não foi concedida. Se apareceu "Acesso bloqueado", o CRIVO ainda está em teste no Google: avise o centro acadêmico.',
        }[e.motivo] || 'Não foi possível entrar na conta Google (permissão negada ou janela fechada).', true);
        else if (m === 'gis') driveMsg('Não foi possível carregar o login do Google. Verifique a conexão.', true);
        else if (m === 'invalido') driveMsg('O arquivo de progresso no Drive está inválido. Nada foi sobrescrito.', true);
        else driveMsg('Falha ao sincronizar (' + m + '). Seu progresso continua salvo neste aparelho.', true);
        if (interativo) throw e;
    } finally {
        driveSincronizando = false;
        if (driveRepetir) { driveRepetir = false; agendarUploadDrive(); }
    }
}

function driveConcluido(ra) {
    driveAtivo = true;
    try { localStorage.setItem(driveFlagKey(ra), '1'); localStorage.setItem(DRIVE_DEVICE_FLAG, '1'); } catch {}
    setDirty(false);
    try { updateFabBarButtons(); } catch {}
    driveUltimoSalvo = Date.now();
    const hh = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    driveMsg(`☁️ Sincronizado com o Google Drive às ${hh}.`);
    driveIndicador(driveAssinatura() === driveUltimaAssinatura ? 'salvo' : 'pendente');
}
/* cópia de segurança diária (crivo_copia_AAAA-MM-DD.json), mantendo as 7 mais recentes */
async function driveCopiaDiaria(pasta) {
    const hoje = isoDoDia(Date.now()), chave = 'crivo_drive_copia_' + currentRA;
    try { if (localStorage.getItem(chave) === hoje) return; } catch {}
    try {
        const copias = await driveListar(pasta, DRIVE_PREFIXO_COPIA);
        const nomeHoje = `${DRIVE_PREFIXO_COPIA}${hoje}.json`;
        const existente = copias.find(f => f.name === nomeHoje);
        if (!existente) await driveGravar(pasta, nomeHoje, null, driveDadosParaNuvem());
        const todas = existente ? copias : [{ name: nomeHoje }, ...copias];
        for (const f of todas.slice(DRIVE_COPIAS_MANTIDAS)) if (f.id) await driveLixeira(f.id);
        localStorage.setItem(chave, hoje);
    } catch (e) { console.warn('cópia diária:', e); }
}

/* envio automático: até 10 s depois de uma mudança (e no máximo a cada 10 s enquanto houver mudanças) */
function agendarUploadDrive() {
    if (!currentRA || !driveAtivo || !driveConfigurado()) return;
    if (driveSincronizando) { driveRepetir = true; return; }
    if (driveAssinatura() === driveUltimaAssinatura) return;
    if (!driveTok || Date.now() > driveTokExp - 60000) {
        driveMsg('☁️ Há alterações só neste aparelho. Elas serão enviadas ao Drive no próximo toque na tela.');
        driveIndicador('reconectar');
        return;
    }
    driveIndicador('pendente');
    if (driveTimer) return;
    driveTimer = setTimeout(() => { driveTimer = null; sincronizarDrive(false).catch(() => {}); }, DRIVE_INTERVALO_MS);
}
const _salvarBackupDrive = salvarBackup;
salvarBackup = function () { _salvarBackupDrive(); if (!driveSalvandoInterno) { try { agendarUploadDrive(); } catch {} } };

driveBtnHome.addEventListener('click', async () => {
    driveBtnHome.disabled = true;
    try { await sincronizarDrive(true); } catch {} finally { driveBtnHome.disabled = false; }
});

const _loginWithRADrive = loginWithRA;
loginWithRA = async function (ra) {
    const ok = await _loginWithRADrive(ra);
    if (ok) {
        let disp = false;
        try { disp = localStorage.getItem(DRIVE_DEVICE_FLAG) === '1' || localStorage.getItem(driveFlagKey(currentRA)) === '1'; } catch {}
        driveAtivo = disp; drivePastaId = null; driveArquivoId = null; driveUltimaAssinatura = '';
        if (disp && driveConfigurado()) {
            driveMsg('☁️ Sincronizando com o Google Drive…');
            sincronizarDrive(false).catch(() => {});      /* sem janela; se o Google pedir, o primeiro toque resolve */
        } else {
            driveMsg('☁️ Guarde o progresso na sua conta Google para usá-lo em outros aparelhos.');
        }
    }
    return ok;
};
/* o pedido de autorização precisa ocorrer dentro do toque/clique do aluno */
loginBtn.addEventListener('click', () => {
    try {
        if (driveConfigurado() && localStorage.getItem(DRIVE_DEVICE_FLAG) === '1') driveObterToken(true).catch(() => {});
    } catch {}
}, true);

/* envio rápido ao sair, trocar de aba/app ou fechar: não dá tempo de ler e juntar, então NÃO grava por cima do
   arquivo principal: cria um arquivo "pendente" (crivo_pendente_...), que a próxima sincronização, em qualquer
   aparelho, junta ao principal e manda para a lixeira. */
function driveDispositivo() {
    try {
        let id = localStorage.getItem('crivo_dispositivo');
        if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem('crivo_dispositivo', id); }
        return id;
    } catch { return 'x'; }
}
function driveEnvioRapido() {
    if (!currentRA || !driveAtivo || !driveTok || Date.now() > driveTokExp || !drivePastaId) return;
    if (driveAssinatura() === driveUltimaAssinatura) return;
    const corpo = driveDadosParaNuvem();
    const b = 'crivo' + Math.random().toString(36).slice(2);
    const meta = { name: `${DRIVE_PREFIXO_PENDENTE}${driveDispositivo()}_${Date.now()}.json`, parents: [drivePastaId], mimeType: 'application/json' };
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
                 `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${corpo}\r\n--${b}--`;
    const cabe = new Blob([body]).size < 60000;           /* limite do keepalive: 64 KB */
    driveUltimaAssinatura = driveAssinatura();
    fetch(`${DRIVE_UP}?uploadType=multipart&fields=id`, {
        method: 'POST', keepalive: cabe,
        headers: { Authorization: 'Bearer ' + driveTok, 'Content-Type': 'multipart/related; boundary=' + b },
        body
    }).catch(() => { driveUltimaAssinatura = ''; });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') driveEnvioRapido(); });
window.addEventListener('pagehide', driveEnvioRapido);
logoutBtn.addEventListener('click', driveEnvioRapido, true);   /* antes de o progresso ser limpo */

/* durante o uso: renova a autorização num toque do aluno e sincroniza periodicamente */
function driveRenovarSeNecessario() {
    if (!currentRA || !driveAtivo || !driveConfigurado() || driveSincronizando) return;
    const expirando = !driveTok || Date.now() > driveTokExp - 5 * 60000;
    if (!expirando || Date.now() - driveUltimaTentativa < 3 * 60000) return;
    driveUltimaTentativa = Date.now();
    sincronizarDrive(true).catch(() => {});
}
document.addEventListener('click', driveRenovarSeNecessario, true);
questionFrame.addEventListener('load', () => {
    const d = docDaQuestao();
    if (d && !d.__crivoDriveClick) { d.__crivoDriveClick = true; d.addEventListener('click', driveRenovarSeNecessario, true); }
});
setInterval(() => {
    if (currentRA && driveAtivo && driveTok && Date.now() < driveTokExp - 60000 && !driveSincronizando && document.visibilityState === 'visible') {
        sincronizarDrive(false).catch(() => {});
    }
}, 120000);
window.addEventListener('online', () => {
    if (currentRA && driveAtivo && driveTok && Date.now() < driveTokExp - 60000) sincronizarDrive(false).catch(() => {});
});
logoutBtn.addEventListener('click', () => {
    clearTimeout(driveTimer);
    driveTok = null; driveTokExp = 0; driveAtivo = false; drivePastaId = null;
    driveMsg('');
});
if (driveConfigurado()) setTimeout(() => { driveCarregarGis().catch(() => {}); }, 1500);
