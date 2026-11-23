/* ============================================================
   APARÊNCIA: MODO ESCURO E TAMANHO DA LETRA
   Modo escuro por inversão de cores (o mesmo método do modo "filtro" do Dark Reader): vale para todo o
   site e para a página da questão, sem reescrever o estilo de cada elemento. Imagens, vídeos e grifos são
   invertidos de volta, para manter as cores originais (radiografias, fotos, cores dos grifos).
   Tamanho da letra: aumenta ou diminui o texto da questão e da correção (e dos cartões).
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

const CSS_QUADRO_ESCURO = 'html{background:#e4e7ef!important}'
    + 'img,video,canvas,picture,.crivo-highlight,.submit-btn,.view-correction-btn{filter:invert(1) hue-rotate(180deg)}';
function aplicarAparenciaNoQuadro() {
    const d = docDaQuestao();
    if (!d || !d.documentElement) return;
    let st = d.getElementById('crivoAparencia');
    if (!st) {
        st = d.createElement('style'); st.id = 'crivoAparencia';
        (d.head || d.documentElement).appendChild(st);
    }
    st.textContent = uiPrefs.tema === 'escuro' ? CSS_QUADRO_ESCURO : '';
    if (d.body) d.body.style.zoom = uiPrefs.escala === 1 ? '' : String(uiPrefs.escala);
}
function aplicarAparencia() {
    document.documentElement.classList.toggle('tema-escuro', uiPrefs.tema === 'escuro');
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
    try { aplicarAparenciaNoQuadro(); } catch {}
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
    try { aplicarAparenciaNoQuadro(); } catch {}
    setTimeout(() => { try { aplicarAparenciaNoQuadro(); } catch {} }, 300);
});
aplicarAparencia();
