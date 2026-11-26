/* ============================================================
   GRIFOS
   ============================================================ */
function corDoGrifo(h) {
    if (!h.numero) return '#FFEB3B';
    const num = parseInt(h.numero) || 0;
    const idx = ((num - 1) % PALETA_CORES.length + PALETA_CORES.length) % PALETA_CORES.length;
    const cor = PALETA_CORES[idx];
    let lightness = 76;
    if (h.lado === 'frente') lightness = 86;
    else if (h.lado === 'verso') lightness = 62;
    else if (h.lado === 'cloze') lightness = 66;
    return `hsl(${cor.h}, ${cor.s}%, ${lightness}%)`;
}

const _GRIFO_SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);

function avisoGrifo(msg) {
    let t = document.getElementById('crivoToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'crivoToast';
        t.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:18px;font-size:13px;z-index:3000;box-shadow:0 3px 12px rgba(0,0,0,.3);max-width:90vw;text-align:center;';
        document.body.appendChild(t);
    }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, 3200);
}

function docDaQuestao() { try { return questionFrame.contentDocument || null; } catch { return null; } }

function textosDoDoc(doc) {
    const nodes = []; let pos = 0;
    const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
            const p = n.parentElement;
            if (!p || _GRIFO_SKIP.has(p.tagName) || p.closest('#crivoEditor')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    let n;
    while ((n = w.nextNode())) {
        const len = n.data.length;
        const sp = n.parentElement.closest('.crivo-highlight');
        nodes.push({ n, start: pos, len, gid: sp ? sp.dataset.grifoId : null });
        pos += len;
    }
    return { nodes, texto: nodes.map(x => x.n.data).join('') };
}
function rangesVivos(nodes) {
    const m = {};
    for (const x of nodes) {
        if (!x.gid) continue;
        const r = m[x.gid] || (m[x.gid] = [x.start, x.start + x.len]);
        r[0] = Math.min(r[0], x.start); r[1] = Math.max(r[1], x.start + x.len);
    }
    return m;
}
function offsetDoPonto(doc, T, c, o) {
    if (c.nodeType === 3) { const x = T.nodes.find(y => y.n === c); if (x) return x.start + o; }
    const r = doc.createRange();
    try { r.setStart(c, o); } catch { return -1; }
    r.collapse(true);
    for (const x of T.nodes) {
        const t = doc.createRange(); t.setStart(x.n, 0); t.collapse(true);
        if (r.compareBoundaryPoints(0, t) <= 0) return x.start;
    }
    return T.texto.length;
}

function envolverIntervalo(doc, T, s, e, h) {
    const cor = corDoGrifo(h);
    for (const x of T.nodes) {
        const a = Math.max(s, x.start), b = Math.min(e, x.start + x.len);
        if (b <= a) continue;
        const lo = a - x.start, hi = b - x.start;
        const fatia = x.n.data.slice(lo, hi);
        if (!fatia.trim() && /\n/.test(fatia)) continue;
        let alvo = x.n;
        if (hi < alvo.data.length) alvo.splitText(hi);
        if (lo > 0) alvo = alvo.splitText(lo);
        const sp = doc.createElement('span');
        sp.className = 'crivo-highlight';
        sp.dataset.grifoId = h.id;
        sp.style.cssText = `background-color:${cor};cursor:pointer;border-radius:2px;padding:1px 0;`;
        alvo.parentNode.insertBefore(sp, alvo);
        sp.appendChild(alvo);
    }
}

function localizarGrifo(h, T, vivos) {
    const alvo = h.bruto || h.texto;
    if (!alvo) return null;
    const ocupado = (a, b) => Object.values(vivos).some(r => a < r[1] && b > r[0]);
    let melhor = null, ms = -1, md = Infinity, i = -1;
    while ((i = T.texto.indexOf(alvo, i + 1)) !== -1) {
        const j = i + alvo.length;
        if (ocupado(i, j)) continue;
        let sc = 0;
        if (h.antes && T.texto.slice(Math.max(0, i - h.antes.length), i) === h.antes) sc += 2;
        if (h.depois && T.texto.substr(j, h.depois.length) === h.depois) sc += 2;
        const d = Math.abs(i - (h.startOffset || 0));
        if (sc > ms || (sc === ms && d < md)) { melhor = i; ms = sc; md = d; }
    }
    return melhor === null ? null : [melhor, melhor + alvo.length];
}

function aplicarGrifo(doc, h) {
    if (doc.querySelector(`.crivo-highlight[data-grifo-id="${h.id}"]`)) return true;
    const T = textosDoDoc(doc);
    const r = localizarGrifo(h, T, rangesVivos(T.nodes));
    if (!r) return false;
    envolverIntervalo(doc, T, r[0], r[1], h);
    h.startOffset = r[0]; h.endOffset = r[1];
    return true;
}

/* ---- cloze: a frase em volta do grifo ----
   A frase termina em ponto final, exclamação ou interrogação (seguidos de espaço e letra maiúscula, número ou
   fim do texto) ou no fim do parágrafo/item de lista. Abreviações ("Dr.", "p. ex.") e decimais ("3.5") não contam. */
const _ABREV_FRASE = /(?:^|[\s(])(?:dr|dra|drs|sr|sra|srs|prof|profa|ex|pág|fig|figs|cap|art|vs|etc|aprox|obs|nº|máx|mín|séc|tab|ref|ed|vol|cf|ie|eg|min|seg|cols|al)$/i;
function _fimDeFrase(t, i) {
    if (t[i] === '.') {
        if (t[i + 1] && !/\s/.test(t[i + 1])) return false;                     /* 3.5, p.ex., e-mail */
        const antes = t.slice(Math.max(0, i - 8), i);
        if (_ABREV_FRASE.test(antes) || /(?:^|[\s(.])[A-Za-zÀ-ÿ]$/.test(antes)) return false;   /* abreviação ou inicial ("p.", "A.") */
    }
    const m = /^\s*(\S)/.exec(t.slice(i + 1));
    return !m || /[A-ZÀ-Ý0-9"“'(•\-–—]/.test(m[1]);
}
function fraseDoTexto(t, ini, fim) {
    let a = 0, b = t.length;
    for (let i = ini - 1; i >= 0; i--) if (/[.!?]/.test(t[i]) && _fimDeFrase(t, i)) { a = i + 1; break; }
    for (let i = Math.max(ini, fim - 1); i < t.length; i++) if (/[.!?]/.test(t[i]) && _fimDeFrase(t, i)) { b = i + 1; break; }
    /* junta espaços repetidos e tira os das pontas, mantendo a posição do trecho */
    let out = '', nIni = 0, nFim = 0, esp = false;
    for (let i = a; i <= b; i++) {
        if (i === ini) nIni = out.length;
        if (i === fim) nFim = out.length;
        if (i === b) break;
        if (/\s/.test(t[i])) { if (!esp && out.length) out += ' '; esp = true; } else { out += t[i]; esp = false; }
    }
    out = out.trimEnd();
    return { texto: out, ini: Math.min(nIni, out.length), fim: Math.min(Math.max(nFim, nIni), out.length) || out.length };
}
function fraseDoGrifo(doc, h) {
    const spans = [...doc.querySelectorAll(`.crivo-highlight[data-grifo-id="${h.id}"]`)];
    if (!spans.length) return null;
    const win = doc.defaultView;
    let bloco = spans[0].parentElement;
    while (bloco && bloco !== doc.body && /^(inline|inline-block|contents)$/.test(win.getComputedStyle(bloco).display)) bloco = bloco.parentElement;
    bloco = bloco || doc.body;
    const r = doc.createRange();
    r.setStart(bloco, 0); r.setEndBefore(spans[0]);
    const ini = r.toString().length;
    r.setEndAfter(spans[spans.length - 1]);
    const fim = r.toString().length;
    const f = fraseDoTexto(bloco.textContent, ini, fim);
    return { texto: f.texto, ini: f.ini, fim: f.fim };
}
function atualizarFraseCloze(doc, h) {
    if (h.lado !== 'cloze') return false;
    const f = fraseDoGrifo(doc, h);
    if (!f || (h.frase && h.frase.texto === f.texto && h.frase.ini === f.ini && h.frase.fim === f.fim)) return false;
    h.frase = f;
    return true;
}

function grifosDaQuestaoAtual() {
    const q = questoes[questaoAtualIndex];
    if (!q) return [];
    return (progress.grifados || []).filter(g =>
        g.prova === currentExam && g.ano === currentYear && g.questao === String(q.num));
}

function aplicarGrifosDaQuestaoAtual() {
    const doc = docDaQuestao();
    if (!doc || !doc.body) return;
    const rodar = () => {
        if (docDaQuestao() !== doc) return;
        let mudou = false;
        grifosDaQuestaoAtual().forEach(g => {
            try { if (aplicarGrifo(doc, g) && g.lado === 'cloze' && !g.frase) mudou = atualizarFraseCloze(doc, g) || mudou; }
            catch (e) { console.warn('Grifo:', e); }
        });
        if (mudou) { setDirty(true); salvarBackup(); }
    };
    rodar();
    setTimeout(rodar, 350);
    setTimeout(rodar, 1200);
}

function criarGrifoDaSelecao() {
    if (!currentRA || !currentExam || !currentYear || !questoes[questaoAtualIndex] || resolvingScreen.classList.contains('hidden')) {
        avisoGrifo('Abra uma questão para grifar.'); return;
    }
    const doc = docDaQuestao();
    if (!doc || !doc.body) { avisoGrifo('Grifar exige o site aberto por http/https (não por arquivo local).'); return; }
    const sel = questionFrame.contentWindow.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { avisoGrifo('Selecione um trecho do texto e clique em Grifar (ou Ctrl+Alt).'); return; }
    const range = sel.getRangeAt(0);
    const T = textosDoDoc(doc);
    let s = offsetDoPonto(doc, T, range.startContainer, range.startOffset);
    let e = offsetDoPonto(doc, T, range.endContainer, range.endOffset);
    while (s >= 0 && s < e && /\s/.test(T.texto[s])) s++;
    while (e > s && /\s/.test(T.texto[e - 1])) e--;
    if (s < 0 || e <= s) { avisoGrifo('Não foi possível grifar essa seleção.'); return; }
    if (Object.values(rangesVivos(T.nodes)).some(r => s < r[1] && e > r[0])) {
        avisoGrifo('Esse trecho já está grifado. Selecione apenas texto ainda sem grifo.'); return;
    }
    const h = {
        id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        prova: currentExam, ano: currentYear, questao: String(questoes[questaoAtualIndex].num),
        texto: sel.toString().replace(/\s+/g, ' ').trim(),
        bruto: T.texto.slice(s, e),
        antes: T.texto.slice(Math.max(0, s - 30), s),
        depois: T.texto.slice(e, e + 30),
        startOffset: s, endOffset: e,
        numero: null, lado: null,
        criadoEm: new Date().toISOString()
    };
    if (!Array.isArray(progress.grifados)) progress.grifados = [];
    progress.grifados.push(h);
    envolverIntervalo(doc, T, s, e, h);
    sel.removeAllRanges();
    setDirty(true);
    salvarBackup();
}

function atualizarCorGrifos() {
    const doc = docDaQuestao();
    if (!doc) return;
    doc.querySelectorAll('.crivo-highlight').forEach(span => {
        const h = (progress.grifados || []).find(g => g.id === span.dataset.grifoId);
        if (h) span.style.backgroundColor = corDoGrifo(h);
    });
}

function removerGrifo(doc, id) {
    progress.grifados = (progress.grifados || []).filter(g => g.id !== id);
    (progress.grifosApagados ||= {})[id] = new Date().toISOString();      /* para não voltar ao sincronizar */
    doc.querySelectorAll(`.crivo-highlight[data-grifo-id="${id}"]`).forEach(sp => {
        const p = sp.parentNode;
        while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
        p.removeChild(sp);
        p.normalize();
    });
    setDirty(true);
    salvarBackup();
}

function fecharEditorGrifo(doc) {
    const box = doc && doc.getElementById('crivoEditor');
    if (box) { if (box._off) box._off(); box.remove(); }
}

function abrirEditorGrifo(spanEl) {
    const doc = docDaQuestao();
    if (!doc) return;
    const id = spanEl.dataset.grifoId;
    const h = (progress.grifados || []).find(g => g.id === id);
    if (!h) return;
    fecharEditorGrifo(doc);

    const win = questionFrame.contentWindow;
    const rect = spanEl.getBoundingClientRect();
    const boxW = 280, boxH = 108;
    const sx = win.scrollX || 0, sy = win.scrollY || 0;
    const left = Math.min(Math.max(8, rect.left + sx), Math.max(8, doc.documentElement.scrollWidth - boxW - 8));
    let top = rect.top + sy - boxH - 6;
    if (top < sy + 8) top = rect.bottom + sy + 6;

    const box = doc.createElement('div');
    box.id = 'crivoEditor';
    box.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${boxW}px;background:#fff;color:#222;` +
        'border:2px solid #1a2a6c;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);z-index:99999;' +
        'font:13px Arial,sans-serif;line-height:1.2;';
    box.innerHTML =
        '<div style="padding:8px 10px;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:6px;">' +
            '<b>Cartão nº</b>' +
            `<input type="number" id="crivoNum" min="1" max="999" value="${h.numero ?? ''}" ` +
                'style="width:70px;padding:6px;border:1px solid #bbb;border-radius:6px;font-size:16px;">' +
            '<button id="crivoRemover" title="Remover grifo" style="margin-left:auto;border:none;background:none;cursor:pointer;font-size:22px;padding:2px 6px;">🗑️</button>' +
        '</div>' +
        '<div style="padding:8px 10px;display:flex;gap:12px;font-size:15px;">' +
            '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="radio" name="crivoLado" value="frente" style="width:20px;height:20px;margin:0"> Frente</label>' +
            '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="radio" name="crivoLado" value="verso" style="width:20px;height:20px;margin:0"> Verso</label>' +
            '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;" title="Lacuna: a frase aparece com este trecho escondido. Trechos com o mesmo número formam um só cartão."><input type="radio" name="crivoLado" value="cloze" style="width:20px;height:20px;margin:0"> Cloze</label>' +
        '</div>';
    doc.documentElement.appendChild(box);

    const num = box.querySelector('#crivoNum');
    const radios = box.querySelectorAll('input[name="crivoLado"]');
    const marcarRadio = () => radios.forEach(r => { r.checked = (r.value === h.lado); });
    marcarRadio();
    const aplicar = () => { atualizarCorGrifos(); setDirty(true); salvarBackup(); };

    num.addEventListener('input', () => {
        const v = parseInt(num.value, 10);
        h.numero = (v >= 1 && v <= 999) ? v : null;
        if (h.numero && !h.lado) { h.lado = 'frente'; marcarRadio(); }
        aplicar();
    });
    radios.forEach(r => r.addEventListener('change', () => { h.lado = r.value; atualizarFraseCloze(doc, h); aplicar(); }));
    if (atualizarFraseCloze(doc, h)) { setDirty(true); salvarBackup(); }
    box.querySelector('#crivoRemover').addEventListener('click', () => { fecharEditorGrifo(doc); removerGrifo(doc, id); });

    const fora = ev => { if (!box.contains(ev.target)) fecharEditorGrifo(doc); };
    const tecla = ev => { if (ev.key === 'Escape') fecharEditorGrifo(doc); };
    doc.addEventListener('mousedown', fora, true);
    doc.addEventListener('touchstart', fora, true);
    doc.addEventListener('keydown', tecla, true);
    box._off = () => {
        doc.removeEventListener('mousedown', fora, true);
        doc.removeEventListener('touchstart', fora, true);
        doc.removeEventListener('keydown', tecla, true);
    };
}

const _ehCtrlAlt = e => !e.repeat && ((e.key === 'Control' && e.altKey) || (e.key === 'Alt' && e.ctrlKey));

function attachIframeListeners() {
    const doc = docDaQuestao();
    if (!doc || doc.__crivoListenersAttached) return;
    doc.__crivoListenersAttached = true;

    if (!doc.getElementById('crivoRespCss')) {
        const st = doc.createElement('style');
        st.id = 'crivoRespCss';
        st.textContent = 'html{-webkit-text-size-adjust:100%;touch-action:manipulation}' +
            'img,video,svg,canvas,table,pre,iframe{max-width:100%}body{overflow-wrap:anywhere}' +
            '@media (max-width:600px){.container{width:100%;max-width:100%;padding:16px}' +
            '.btn-container{flex-wrap:wrap}.submit-btn,.view-correction-btn{padding-left:20px;padding-right:20px}}';
        (doc.head || doc.documentElement).appendChild(st);
    }
    let ultimoToque = { t: 0, alvo: null };
    doc.addEventListener('touchend', (e) => {
        const alvo = e.target.closest && e.target.closest('.crivo-highlight');
        if (!alvo) { ultimoToque = { t: 0, alvo: null }; return; }
        const agora = Date.now();
        if (ultimoToque.alvo === alvo && agora - ultimoToque.t < 450) {
            e.preventDefault();
            ultimoToque = { t: 0, alvo: null };
            abrirEditorGrifo(alvo);
        } else ultimoToque = { t: agora, alvo };
    }, { passive: false });

    doc.addEventListener('keydown', (e) => {
        if (!_ehCtrlAlt(e)) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test((doc.activeElement || {}).tagName || '')) return;
        e.preventDefault();
        criarGrifoDaSelecao();
    });
    doc.addEventListener('dblclick', (e) => {
        const alvo = e.target.closest && e.target.closest('.crivo-highlight');
        if (!alvo) return;
        e.preventDefault(); e.stopPropagation();
        abrirEditorGrifo(alvo);
        const sel = questionFrame.contentWindow.getSelection();
        if (sel) sel.removeAllRanges();
    });
    doc.addEventListener('click', (e) => {
        const t = e.target;
        if (!t || !t.closest || t.closest('#crivoEditor')) return;
        const naMarca = !!t.closest('.crivo-highlight');
        const sel = questionFrame.contentWindow.getSelection();
        const arrastou = sel && !sel.isCollapsed && sel.toString().trim() &&
            sel.containsNode(t, true) && !t.closest('button, input, a, select, textarea');
        if (naMarca || arrastou) { e.stopPropagation(); e.preventDefault(); }
    }, true);
}

document.addEventListener('keydown', (e) => {
    if (!_ehCtrlAlt(e) || resolvingScreen.classList.contains('hidden')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return;
    e.preventDefault();
    criarGrifoDaSelecao();
});
grifarBtn.addEventListener('mousedown', e => e.preventDefault());
grifarBtn.addEventListener('pointerdown', e => e.preventDefault());
grifarBtn.addEventListener('click', criarGrifoDaSelecao);

/* ============================================================
   EXPORTAR ANKI (.txt)
   ============================================================ */
function escAnki(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/\r?\n/g, '<br>').replace(/\t/g, ' ');
}

function exportarAnki() {
    if (!currentRA) { avisoGrifo('Faça login primeiro.'); return; }
    const q = questoes[questaoAtualIndex];
    if (!currentExam || !currentYear || !q || resolvingScreen.classList.contains('hidden')) {
        avisoGrifo('Abra uma questão para exportar os cartões dela.'); return;
    }
    const prefixo = `${currentExam}|${currentYear}|${q.num}|`;
    const cartoes = [...paresDosGrifos().entries()].filter(([id, c]) => id.startsWith(prefixo) && (c.dir === 'fv' || c.dir === 'cz')).map(([, c]) => c);
    if (!cartoes.length) {
        alert('Nenhum cartão completo nesta questão.\n\nCada cartão precisa de um trecho grifado como "frente" e outro como "verso" com o mesmo número, ou de um trecho marcado como "cloze".');
        return;
    }
    const base = `${currentExam}_${currentYear}_Q_${q.num}`;
    const linhas = linhasAnki(cartoes);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([linhas.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
    a.download = base.replace(/[\\/:*?"<>|]/g, '-') + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    avisoGrifo(`${cartoes.length} cartão(ões) exportado(s) em ${a.download}`);
}
ankiBtn.addEventListener('click', exportarAnki);
