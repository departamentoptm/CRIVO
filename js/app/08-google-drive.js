/* ============================================================
   SINCRONIZAÇÃO COM O GOOGLE DRIVE (pasta "CRIVO - Progresso")
   O aluno autoriza uma vez; o site lê, mescla e grava o arquivo.
   Escopo drive.file: o site só enxerga o que ele mesmo criou.
   ============================================================ */
/* >>> COLE AQUI o "ID do cliente OAuth" criado no Google Cloud <<< */
const DRIVE_CLIENT_ID = '500615111789-t1ho7i5jaglgcb7c8ptfes0opf6gea8c.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_PASTA = 'CRIVO - Progresso';
const driveBtnHome = document.getElementById('driveBtnHome');
const driveStatusEl = document.getElementById('driveStatus');
let driveTok = null, driveTokExp = 0, driveClient = null, driveGisPromise = null;
let driveResolver = null, driveRejeitar = null;
let driveSincronizando = false, driveRepetir = false, driveAtivo = false, driveTimer = null, drivePastaId = null;
let driveArquivoId = null, driveUltimaAssinatura = '', driveTokPromise = null, driveUltimaTentativa = 0, driveSalvandoInterno = false;
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
                error_callback: (e) => driveRejeitar && driveRejeitar(new Error('auth')),
            });
        }
        driveResolver = (r) => {
            if (!r || r.error || !r.access_token) return rej(new Error('auth'));
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
    return { registro, grifados, resetados, ultimaPosicao, avaliacoes, grifosApagados,
             cartoes: mesclarCartoes(a.cartoes, b.cartoes) };
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
                           progress.cartoes || {}, progress.grifosApagados || {}]);
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
        grifosApagados: progress.grifosApagados || {}
    });
}

async function sincronizarDrive(interativo) {
    if (!currentRA) return;
    if (!driveConfigurado()) { driveMsg('Sincronização ainda não configurada: defina DRIVE_CLIENT_ID no código.', true); return; }
    if (driveSincronizando) { driveRepetir = true; return; }
    driveSincronizando = true;
    const ra = currentRA;
    try {
        driveMsg('☁️ Sincronizando com o Google Drive…');
        await driveObterToken(interativo);
        const pasta = await driveAcharOuCriarPasta();
        const nome = 'crivo_progresso.json';
        let arq = await driveAcharArquivo(pasta, nome);
        const legados = await driveProgressosAntigos(pasta);
        if (ra !== currentRA) return;
        let remoto = null;
        if (arq) {
            try { remoto = JSON.parse(await driveLer(arq.id)); } catch (e) { if (e.status) throw e; remoto = false; }
            if (remoto === false || !remoto || remoto.formato !== 'crivo-progresso') throw new Error('invalido');
        }
        for (const f of legados) {      /* arquivos da época do login por RA/apelido, na mesma conta Google */
            try {
                const x = JSON.parse(await driveLer(f.id));
                if (x && x.formato === 'crivo-progresso') remoto = remoto ? mesclarProgresso(migrarProgresso(remoto), migrarProgresso(x)) : x;
            } catch (e) { if (e.status) throw e; }
        }
        if (remoto && !remoto.formato) remoto.formato = 'crivo-progresso';
        if (ra !== currentRA) return;
        if (remoto) {
            const base = { registro: progress.registro, grifados: progress.grifados, resetados: progress.resetados, ultimaPosicao: progress.ultimaPosicao,
                           avaliacoes: progress.avaliacoes, cartoes: progress.cartoes, grifosApagados: progress.grifosApagados };
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
        driveAtivo = true;
        try { localStorage.setItem(driveFlagKey(ra), '1'); localStorage.setItem(DRIVE_DEVICE_FLAG, '1'); } catch {}
        setDirty(false);
        try { updateFabBarButtons(); } catch {}
        const hh = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        driveMsg(`☁️ Sincronizado com o Google Drive às ${hh}.`);
    } catch (e) {
        const m = String(e && e.message);
        if (m === 'auth' && !interativo) { driveUltimaTentativa = 0; driveMsg('☁️ Toque em “Sincronizar com Google Drive” (ou em qualquer lugar da tela) para continuar sincronizando.'); }
        else if (m === 'auth') driveMsg('Não foi possível entrar na conta Google (permissão negada ou janela fechada).', true);
        else if (m === 'gis') driveMsg('Não foi possível carregar o login do Google. Verifique a conexão.', true);
        else if (m === 'invalido') driveMsg('O arquivo de progresso no Drive está inválido. Nada foi sobrescrito.', true);
        else driveMsg('Falha ao sincronizar (' + m + '). Seu progresso continua salvo neste aparelho.', true);
        if (interativo) throw e;
    } finally {
        driveSincronizando = false;
        if (driveRepetir) { driveRepetir = false; agendarUploadDrive(); }
    }
}

/* envio automático (agrupado) enquanto houver autorização válida */
function agendarUploadDrive() {
    if (!currentRA || !driveAtivo || !driveConfigurado()) return;
    if (driveSincronizando) { driveRepetir = true; return; }
    if (driveAssinatura() === driveUltimaAssinatura) return;
    if (!driveTok || Date.now() > driveTokExp - 60000) {
        driveMsg('☁️ Há alterações só neste aparelho. Elas serão enviadas ao Drive no próximo toque na tela.');
        return;
    }
    clearTimeout(driveTimer);
    driveTimer = setTimeout(() => { sincronizarDrive(false).catch(() => {}); }, 8000);
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

/* envio final rápido (ao sair, trocar de aba/app ou fechar): usa o arquivo já conhecido */
function driveEnvioRapido() {
    if (!currentRA || !driveAtivo || !driveTok || Date.now() > driveTokExp || !driveArquivoId) return;
    if (driveAssinatura() === driveUltimaAssinatura) return;
    const corpo = driveDadosParaNuvem();
    const cabe = new Blob([corpo]).size < 60000;           /* limite do keepalive: 64 KB */
    driveUltimaAssinatura = driveAssinatura();
    fetch(`${DRIVE_UP}/${driveArquivoId}?uploadType=media&fields=id`, {
        method: 'PATCH', keepalive: cabe,
        headers: { Authorization: 'Bearer ' + driveTok, 'Content-Type': 'application/json; charset=UTF-8' },
        body: corpo
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
