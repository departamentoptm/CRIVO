/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
let currentUser = null;
let exams = {};
let currentExam = null;
let currentYear = null;
let questoes = [];
let questaoAtualIndex = 0;
let timerInterval = null;
let expirationTimer = null;
let startTime = null;
let questaoStartTime = null;      // tempo entre início da questão e confirmação
let pausedElapsedMs = 0;
let isTimerRunning = false;
let maxTime = 1;
let modoTempo = 'questao';   // 'questao' | 'todas' | 'off'
let limiteTotalAvisado = false;
let currentBlobUrl = null;
let progressFrom = 'home';
let loadingYear = false;
let currentRA = null;
let dirty = false;
let progress = { estado: {}, registro: [], ultimaPosicao: null, grifados: [], resetados: {}, avaliacoes: [], cartoes: {}, grifosApagados: {} };

let disciplinas = {};
let disciplinasLoaded = false;
let disciplinasFailed = false;
let filtrosCarregadosPara = null;
let abrirLimpo = null;
let iframeDesatualizado = false;
let gabGrupos = {}, gabGrupoSeq = 0;

const DISCIPLINAS_LISTA = [
    'Pediatria','Medicina Preventiva','Cirurgia','Ginecologia','Obstetrícia',
    'Endocrinologia','Neurologia','Gastroenterologia','Cardiologia','Reumatologia',
    'Psiquiatria','Nefrologia','Dermatologia','Infectologia','Pneumologia',
    'Hematologia','Ortopedia','Otorrinolaringologia','Hepatologia','Oftalmologia','Urologia'
];

function disciplinaDe(banca, ano, num) {
    const y = disciplinas?.[banca]?.[ano];
    const d = String((Array.isArray(y) ? y[(parseInt(num) || 0) - 1] : y?.[num]) || '').trim();
    if (DISCIPLINAS_LISTA.includes(d)) return d;
    const t = temaInfo(banca, ano, num);                 /* questões sem disciplina na planilha: a do catálogo */
    return t && DISCIPLINAS_LISTA.includes(t.disciplina) ? t.disciplina : null;
}
/* lista fixa de temas (dados/temas_padrao.json, gerado pelo Actions > Gerar correções > temas-padrao) */
let temasPadrao = null;
function temaInfo(banca, ano, num) { return temasPadrao?.questoes?.[`${banca}-${ano}-Q${num}`] || null; }
function temaDe(banca, ano, num) { const t = temaInfo(banca, ano, num); return t && t.tema ? t.tema : null; }

let filtros = {
    bancas: [],
    anos: [],
    disciplina: '',
    tema: '',
    somenteNaoRealizadas: false,
    maxQuestoes: 0,
    revisao: false,
    embaralhar: false,
    semente: 0
};

const PALETA_CORES = [
    { h: 45,  s: 92 }, { h: 135, s: 62 }, { h: 200, s: 72 }, { h: 270, s: 62 },
    { h: 330, s: 72 }, { h: 15,  s: 85 }, { h: 180, s: 62 }, { h: 90,  s: 55 },
    { h: 240, s: 65 }, { h: 300, s: 62 }
];

/* ============================================================
   DOM
   ============================================================ */
const authScreen = document.getElementById('authScreen');
const resolvingScreen = document.getElementById('resolvingScreen');
const progressScreen = document.getElementById('progressScreen');
const loginArea = document.getElementById('loginArea');
const homeArea = document.getElementById('homeArea');
const welcomeName = document.getElementById('welcomeName');
const loginMsg = document.getElementById('loginMsg');
const loginBtn = document.getElementById('loginBtn');
const raInput = document.getElementById('raInput');
const loadBtnHome = document.getElementById('loadBtnHome');
const homeMsg = document.getElementById('homeMsg');
const saveBtn = document.getElementById('saveBtn');
const grifarBtn = document.getElementById('grifarBtn');
const ankiBtn = document.getElementById('ankiBtn');
const refazerBtn = document.getElementById('refazerBtn');
const historicoBtn = document.getElementById('historicoBtn');
const progressFile = document.getElementById('progressFile');
const startBtnHome = document.getElementById('startBtnHome');
const viewProgressBtn = document.getElementById('viewProgressBtn');
const logoutBtn = document.getElementById('logoutBtn');
const examSelector = document.getElementById('examSelector');
const yearSelector = document.getElementById('yearSelector');
const questionFrame = document.getElementById('questionFrame');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const timerDisplay = document.getElementById('timer');
const goToInput = document.getElementById('goToInput');
const goBtn = document.getElementById('goBtn');
const maxTimeInput = document.getElementById('maxTimeInput');
const homeBtn = document.getElementById('homeBtn');
const progressBtnResolving = document.getElementById('progressBtnResolving');
const backFromProgressBtn = document.getElementById('backFromProgressBtn');
const progressContent = document.getElementById('progressContent');
const bancaMultiBtn = document.getElementById('bancaMultiBtn');
const bancaMultiPanel = document.getElementById('bancaMultiPanel');
const anoMultiBtn = document.getElementById('anoMultiBtn');
const anoMultiPanel = document.getElementById('anoMultiPanel');
const disciplinaSelector = document.getElementById('disciplinaSelector');
const soNaoRealizadas = document.getElementById('soNaoRealizadas');
const maxQuestoesInput = document.getElementById('maxQuestoesInput');
const posIndicator = document.getElementById('posIndicator');

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
function showScreen(s) {
    document.querySelectorAll('body > .screen, .screen').forEach(x => x.classList.add('hidden'));     /* todas as telas */
    s.classList.remove('hidden');
}
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtTempo(ms) {
    if (ms == null || ms < 0) return '—';
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return s ? `${m}m${s}s` : `${m}m`;
    const h = Math.floor(m / 60), mm = m % 60;
    return mm ? `${h}h${mm}m` : `${h}h`;
}
