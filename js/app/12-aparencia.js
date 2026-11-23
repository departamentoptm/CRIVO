/* ============================================================
   APARÊNCIA: MODO ESCURO E TAMANHO DA LETRA
   Modo escuro: só os fundos brancos e quase brancos viram escuros, e as letras pretas e cinza-escuras viram
   claras. As outras cores (barras, botões coloridos, verde/vermelho, grifos, imagens) ficam como estão.
   Como funciona (vale para o site e para a página da questão):
     1. as regras de estilo com fundo ou borda quase branca ganham uma versão escura (mantém :hover etc.);
     2. cada texto é conferido contra o fundo que realmente está atrás dele: letra escura sobre fundo escuro
        vira clara; letra clara sobre fundo claro (ex.: dentro de um grifo) vira escura.
   Desligar o modo escuro desfaz tudo, sem recarregar a página.
   Tamanho da letra: aumenta ou diminui o texto da questão, da correção e dos cartões.
   As escolhas ficam neste navegador (localStorage, chave crivo_ui).
   ============================================================ */
const ESCALAS_LETRA = [0.85, 0.9, 1, 1.1, 1.2, 1.35, 1.5];
if (uiPrefs.tema !== 'escuro') uiPrefs.tema = 'claro';
if (!ESCALAS_LETRA.includes(uiPrefs.escala)) uiPrefs.escala = 1;
try {
    const v = JSON.parse(localStorage.getItem(UI_KEY));
    if (v && v.tema === 'escuro') uiPrefs.tema = 'escuro';
    if (v && ESCALAS_LETRA.includes(+v.escala)) uiPrefs.escala = +v.escala;
} catch {}

/* ---------- cores ---------- */
const _RE_COR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\bwhite\b/gi;
const _semUrl = v => String(v || '').replace(/url\([^)]*\)/g, '');      /* ícones em SVG não são cor de fundo */
function _hslParaRgb(h, s, l) {
    if (!s) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
function _cor(txt) {
    if (!txt) return null;
    const t = String(txt).trim().toLowerCase();
    if (t === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (t === 'white') return { r: 255, g: 255, b: 255, a: 1 };
    if (t === 'black') return { r: 0, g: 0, b: 0, a: 1 };
    let m = t.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
        let h = m[1];
        if (h.length <= 4) h = h.split('').map(c => c + c).join('');
        const n = parseInt(h.slice(0, 6), 16);
        return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
    }
    const alfa = x => x === undefined ? 1 : (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x));
    m = t.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: alfa(m[4]) };
    m = t.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
    if (m) { const [r, g, b] = _hslParaRgb(+m[1] / 360, +m[2] / 100, +m[3] / 100); return { r, g, b, a: alfa(m[4]) }; }
    return null;
}
function _hsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : mx === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
    return [h, s, l];
}
const _lum = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
function _rgb(h, s, l, a) {
    const [r, g, b] = _hslParaRgb(h, s, Math.min(1, Math.max(0, l))).map(Math.round);
    return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;
}
const _croma = ({ r, g, b }) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
/* quase branco = muito claro e quase sem cor (os tons pastel, como o verde da resposta correta, ficam) */
const _quaseBranco = c => !!c && c.a >= 0.5 && _lum(c) >= 0.85 && _croma(c) <= 0.08;
const _bordaClara = c => !!c && c.a >= 0.3 && _lum(c) >= 0.72 && _croma(c) <= 0.12;
const _fundoEscuro = c => { const [h, s, l] = _hsl(c); return _rgb(h, Math.min(s, 0.25), 0.10 + (1 - l) * 0.8, c.a); };
const _bordaEscura = c => { const [h, s] = _hsl(c); return _rgb(h, Math.min(s, 0.25), 0.26, c.a); };
const _textoClaro = c => { const [h, s, l] = _hsl(c); return _rgb(h, Math.min(s, 0.7), 0.93 - l * 0.35, 1); };
const _TEXTO_ESCURO = '#16181d';
const _FUNDO_PAGINA = '#14161c';

/* ---------- 1. versões escuras das regras de estilo ---------- */
function _regrasEscuras(doc) {
    const out = [];
    const prefixar = sel => sel.split(',').map(s => {
        s = s.trim();
        if (/^(html|:root)(?![\w-])/.test(s)) return s.replace(/^(html|:root)/, 'html.tema-escuro');
        return 'html.tema-escuro ' + s;
    }).join(', ');
    const trocarCores = (valor, fn) => valor.replace(_RE_COR, x => { const c = _cor(x); return c && c.a >= 0.05 ? fn(c) : x; });
    const visitar = (regras, embrulho) => {
        for (const r of regras) {
            const tipo = r.constructor && r.constructor.name;
            if (tipo === 'CSSMediaRule' || tipo === 'CSSSupportsRule') {
                const at = tipo === 'CSSMediaRule' ? '@media' : '@supports';
                visitar(r.cssRules, t => embrulho(`${at} ${r.conditionText} {${t}}`));
                continue;
            }
            if (tipo === 'CSSContainerRule') { visitar(r.cssRules, t => embrulho(`@container ${r.conditionText} {${t}}`)); continue; }
            if (r.type !== 1 || !r.selectorText) continue;
            const st = r.style, decl = [];
            const bg = _cor(st.getPropertyValue('background-color'));
            if (_quaseBranco(bg)) decl.push(`background-color: ${_fundoEscuro(bg)} !important`);
            const bi = st.getPropertyValue('background-image');
            if (bi && bi.includes('gradient') && !bi.includes('url(')) {
                const cores = (_semUrl(bi).match(_RE_COR) || []).map(_cor).filter(Boolean);
                if (cores.length && cores.every(c => c.a < 0.05 || _quaseBranco(c))) decl.push(`background-image: ${trocarCores(bi, _fundoEscuro)} !important`);
            }
            for (const lado of ['top', 'right', 'bottom', 'left']) {
                const bc = _cor(st.getPropertyValue(`border-${lado}-color`));
                if (_bordaClara(bc)) decl.push(`border-${lado}-color: ${_bordaEscura(bc)} !important`);
            }
            for (let i = 0; i < st.length; i++) {
                const p = st[i];
                if (!p.startsWith('--')) continue;
                const c = _cor(st.getPropertyValue(p));
                if (/^--line/.test(p) ? _bordaClara(c) : _quaseBranco(c)) decl.push(`${p}: ${/^--line/.test(p) ? _bordaEscura(c) : _fundoEscuro(c)}`);
            }
            if (decl.length) out.push(embrulho(`${prefixar(r.selectorText)} {${decl.join('; ')}}`));
        }
    };
    for (const folha of doc.styleSheets) {
        if (folha.ownerNode && folha.ownerNode.id === 'crivoEscuro') continue;
        let regras;
        try { regras = folha.cssRules; } catch { continue; }
        visitar(regras, t => t);
    }
    return out.join('\n');
}

/* ---------- 2. contraste de cada texto com o fundo que está atrás dele ---------- */
const _SEM_TEXTO = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'svg', 'SVG', 'IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'BR', 'HR']);
const _CONTROLES = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);
function _fundoAtras(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const cs = e.ownerDocument.defaultView.getComputedStyle(e);
        const c = _cor(cs.backgroundColor);
        if (c && c.a > 0.5) return _lum(c);
        if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) {
            const cores = (_semUrl(cs.backgroundImage).match(_RE_COR) || []).map(_cor).filter(x => x && x.a > 0.5);
            if (cores.length) return cores.reduce((t, x) => t + _lum(x), 0) / cores.length;
        }
    }
    return _lum(_cor(_FUNDO_PAGINA));
}
function _marcar(el, prop, valor) {
    const chave = prop === 'color' ? 'crivoCor' : 'crivoFundo';
    if (!(chave in el.dataset)) el.dataset[chave] = el.style.getPropertyValue(prop) + '|' + el.style.getPropertyPriority(prop);
    el.style.setProperty(prop, valor, 'important');
    el.setAttribute('data-crivo-escuro', '');
}
function _ajustarSubarvore(raiz) {
    if (!raiz || raiz.nodeType !== 1 || !raiz.ownerDocument.documentElement.classList.contains('tema-escuro')) return;
    const win = raiz.ownerDocument.defaultView;
    for (const el of [raiz, ...raiz.querySelectorAll('*')]) {
        if (_SEM_TEXTO.has(el.tagName) || (el.closest && el.closest('svg'))) continue;
        const bg = _cor(win.getComputedStyle(el).backgroundColor);
        if (_quaseBranco(bg) && !el.classList.contains('crivo-highlight')) _marcar(el, 'background-color', _fundoEscuro(bg));
        const csEl = win.getComputedStyle(el);
        if ((csEl.webkitBackgroundClip === 'text' || csEl.backgroundClip === 'text') && csEl.backgroundImage.includes('gradient')) {
            const cores = (_semUrl(csEl.backgroundImage).match(_RE_COR) || []).map(_cor).filter(x => x && x.a > 0.3);
            if (cores.length && cores.reduce((t, x) => t + _lum(x), 0) / cores.length < 0.3) {
                if (!('crivoDegrade' in el.dataset)) el.dataset.crivoDegrade = el.style.getPropertyValue('background-image');
                el.style.setProperty('background-image', csEl.backgroundImage.replace(_RE_COR, x => { const c = _cor(x); return c && c.a > 0.3 ? _textoClaro(c) : x; }), 'important');
                el.setAttribute('data-crivo-escuro', '');
            }
            continue;
        }
        const temTexto = _CONTROLES.has(el.tagName) || [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
        if (!temTexto) continue;
        const fg = _cor(win.getComputedStyle(el).color);
        if (!fg || fg.a < 0.3) continue;
        const yFundo = _fundoAtras(el), yTexto = _lum(fg);
        if (yFundo < 0.25 && yTexto < 0.3) _marcar(el, 'color', _textoClaro(fg));
        else if (yFundo > 0.55 && yTexto > 0.6) _marcar(el, 'color', _TEXTO_ESCURO);
    }
}
function _desfazer(doc) {
    doc.querySelectorAll('[data-crivo-escuro]').forEach(el => {
        for (const [chave, prop] of [['crivoCor', 'color'], ['crivoFundo', 'background-color']]) {
            if (!(chave in el.dataset)) continue;
            const [v, pr] = el.dataset[chave].split('|');
            if (v) el.style.setProperty(prop, v, pr || ''); else el.style.removeProperty(prop);
            delete el.dataset[chave];
        }
        if ('crivoDegrade' in el.dataset) {
            if (el.dataset.crivoDegrade) el.style.setProperty('background-image', el.dataset.crivoDegrade); else el.style.removeProperty('background-image');
            delete el.dataset.crivoDegrade;
        }
        el.removeAttribute('data-crivo-escuro');
    });
}

/* ---------- liga/desliga num documento (o site ou a página da questão) ---------- */
const _observadores = new WeakMap();
function _temaNoDocumento(doc, extraCss) {
    if (!doc || !doc.documentElement) return;
    const escuro = uiPrefs.tema === 'escuro';
    const antigo = _observadores.get(doc);
    if (antigo) { antigo.disconnect(); _observadores.delete(doc); }
    let st = doc.getElementById('crivoEscuro');
    if (!escuro) {
        if (st) st.remove();
        doc.documentElement.classList.remove('tema-escuro');
        _desfazer(doc);
        return;
    }
    doc.documentElement.classList.add('tema-escuro');
    if (!st) { st = doc.createElement('style'); st.id = 'crivoEscuro'; (doc.head || doc.documentElement).appendChild(st); }
    st.textContent = (extraCss || '') + '\n' + _regrasEscuras(doc);
    if (doc.body) _ajustarSubarvore(doc.body);
    /* conteúdo novo (telas redesenhadas, grifos, correção) e troca de classes são ajustados logo depois */
    let pendentes = new Set(), timer = null;
    const obs = new doc.defaultView.MutationObserver(muts => {
        for (const m of muts) {
            if (m.type === 'childList') m.addedNodes.forEach(n => { if (n.nodeType === 1) pendentes.add(n); else if (n.parentElement) pendentes.add(n.parentElement); });
            else if (m.target.nodeType === 1) pendentes.add(m.target);
        }
        clearTimeout(timer);
        timer = setTimeout(() => { const p = pendentes; pendentes = new Set(); p.forEach(n => { if (n.isConnected) _ajustarSubarvore(n); }); }, 40);
    });
    if (doc.body) obs.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
    _observadores.set(doc, obs);
}
const CSS_QUADRO_ESCURO = `html.tema-escuro { background: ${_FUNDO_PAGINA} !important; color-scheme: dark; }`;
function aplicarAparenciaNoQuadro() {
    const d = docDaQuestao();
    if (!d || !d.documentElement) return;
    _temaNoDocumento(d, CSS_QUADRO_ESCURO);
    if (d.body) d.body.style.zoom = uiPrefs.escala === 1 ? '' : String(uiPrefs.escala);
}
function aplicarAparencia() {
    _temaNoDocumento(document, '');
    document.documentElement.style.setProperty('--crivo-escala', String(uiPrefs.escala));
    const tb = document.getElementById('temaBtn');
    if (tb) {
        tb.textContent = uiPrefs.tema === 'escuro' ? '☀️ Modo claro' : '🌙 Modo escuro';
        tb.setAttribute('aria-pressed', String(uiPrefs.tema === 'escuro'));
    }
    const lv = document.getElementById('letraValor');
    if (lv) lv.textContent = Math.round(uiPrefs.escala * 100) + '%';
    const i = ESCALAS_LETRA.indexOf(uiPrefs.escala);
    const menos = document.getElementById('letraMenosBtn'), mais = document.getElementById('letraMaisBtn');
    if (menos) menos.disabled = i <= 0;
    if (mais) mais.disabled = i >= ESCALAS_LETRA.length - 1;
    try { aplicarAparenciaNoQuadro(); } catch (e) { console.warn('aparência na questão:', e); }
}
function mudarLetra(passo) {
    const i = ESCALAS_LETRA.indexOf(uiPrefs.escala);
    uiPrefs.escala = ESCALAS_LETRA[Math.min(ESCALAS_LETRA.length - 1, Math.max(0, i + passo))];
    salvarUi(); aplicarAparencia();
}
document.getElementById('temaBtn').addEventListener('click', () => {
    uiPrefs.tema = uiPrefs.tema === 'escuro' ? 'claro' : 'escuro';
    salvarUi(); aplicarAparencia();
});
document.getElementById('letraMenosBtn').addEventListener('click', () => mudarLetra(-1));
document.getElementById('letraMaisBtn').addEventListener('click', () => mudarLetra(1));
questionFrame.addEventListener('load', () => {
    try { aplicarAparenciaNoQuadro(); } catch (e) { console.warn('aparência na questão:', e); }
    setTimeout(() => { try { aplicarAparenciaNoQuadro(); } catch {} }, 300);
});
aplicarAparencia();
