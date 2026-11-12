#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
deepseek_automation.py  —  geração em massa de questao_N.html via DeepSeek Chat
(versão para operação contínua, sem supervisão, com progressão automática entre edições)

Novidades desta versão:
  * O menu "M" foi redefinido: ele agora lista as BANCAS encontradas em EXAMS_DIR e
    inicia o processamento automático de todas as edições daquela banca, em ordem
    decrescente de ano (2026 → 2025 → 2024 → ...), carregando o perguntas.txt (ou .pdf)
    de cada edição em uma nova conversa. Ao terminar uma edição, a próxima começa
    sozinha. Em caso de erro/interrupção, a retomada é automática por edição (cada
    edição tem seu próprio progresso.json e sua própria pasta de saída).

  * As demais funções foram preservadas: detecção de "servidor ocupado"/rate-limit,
    backoff exponencial com jitter, ritmo adaptativo, validação das respostas,
    retomada por progresso.json, supervisão do Chrome, modos T/P para arquivo único.

Estrutura esperada:
    EXAMS_DIR/<Banca>/<Ano>/perguntas.txt    (ou perguntas.pdf)
    Saída: PASTA_SAIDA/<Banca>/<Ano>/questão_N.html
"""
from __future__ import annotations

import argparse
import json
import logging
import logging.handlers
import os
import random
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import unicodedata
import urllib.request
import zipfile

from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys


# ---------------------------------------------------------------------------
# Configuração (tudo pode ser sobrescrito por variável de ambiente)
# ---------------------------------------------------------------------------
def _env_int(nome, padrao):
    try:
        return int(os.environ.get(nome, padrao))
    except ValueError:
        return padrao


def _env_str(nome, padrao):
    return os.environ.get(nome, padrao)


URL_DEEPSEEK = "https://chat.deepseek.com/"
BASE = _env_str("DEEPSEEK_BASE", "/home/filipi-araujo/qwan_automation")
EXAMS_DIR = _env_str("DEEPSEEK_EXAMS_DIR",
                     "/home/filipi-araujo/Documentos/AUTOMATION 2.0/CRIVO_V1/exams")
PERFIL_PERSISTENTE = f"{BASE}/perfil_chromium"
PASTA_SAIDA = f"{BASE}/questoes_geradas"
PASTA_DOWNLOADS = f"{BASE}/downloads"
PASTA_DRIVER = f"{BASE}/chromedriver_local"
PASTA_DIAG = f"{PASTA_SAIDA}/diagnostico_export"
PASTA_REJEITADAS = f"{PASTA_SAIDA}/rejeitadas"
PASTA_LOGS = f"{BASE}/logs"
ARQ_ESTADO = os.path.join(PASTA_SAIDA, "progresso.json")
ARQ_PARAR = os.path.join(BASE, "PARAR")
ESTADO_VERSAO = 1

# --- Contexto dinâmico por banca/ano ---
_PASTA_SAIDA_ANO = PASTA_SAIDA
_ARQ_ESTADO_ANO = ARQ_ESTADO
_PASTA_REJEITADAS_ANO = PASTA_REJEITADAS
_CURRENT_BANCA = ""
_CURRENT_ANO = ""

# --- Bloqueios do servidor ---
BACKOFF_BASE_S = _env_int("BACKOFF_BASE_S", 60)
BACKOFF_MAX_S = _env_int("BACKOFF_MAX_S", 3600)
RATE_BASE_S = _env_int("RATE_BASE_S", 600)
RATE_MAX_S = _env_int("RATE_MAX_S", 3 * 3600)
BLOQ_RECARREGAR_APOS = 3
BLOQ_REINICIAR_APOS = 12

# --- Falhas de qualidade (não contam bloqueios do servidor) ---
MAX_FALHAS_POR_QUESTAO = _env_int("MAX_FALHAS_POR_QUESTAO", 8)
COOLDOWN_RODADA_S = _env_int("COOLDOWN_RODADA_S", 1800)
MAX_RODADAS = _env_int("MAX_RODADAS", 0)

# --- Provas / edições ---
# Número máximo de questões consideradas por prova (edição). Normalmente 100.
# Pode ser alterado por: variável MAX_QUESTOES_POR_PROVA, argumento --max-questoes
# ou pergunta interativa ao escolher a banca no modo M. 0 = sem limite (usa tudo
# o que houver em perguntas.txt/pdf).
MAX_QUESTOES_POR_PROVA = _env_int("MAX_QUESTOES_POR_PROVA", 100)
# Ao retomar, só considera "já gerada" a questão cujo HTML existente é válido.
VALIDAR_HTML_EXISTENTES = _env_int("VALIDAR_HTML_EXISTENTES", 1) != 0

# --- Ritmo ---
PAUSA_MIN_S = _env_int("PAUSA_MIN_S", 20)
PAUSA_MAX_S = _env_int("PAUSA_MAX_S", 60)
PAUSA_ADAPTATIVA_TETO_S = _env_int("PAUSA_ADAPTATIVA_TETO_S", 900)
LOTE_ANTES_DE_DESCANSO = _env_int("LOTE_ANTES_DE_DESCANSO", 15)
DESCANSO_LOTE_S = _env_int("DESCANSO_LOTE_S", 600)
MAX_RESPOSTAS_POR_HORA = _env_int("MAX_RESPOSTAS_POR_HORA", 0)

# --- Conversa / export ---
NOVA_CONVERSA_CADA = _env_int("NOVA_CONVERSA_CADA", 10)
EXPORTAR_MD_AO_FINALIZAR_CHAT = True
MAX_TENTATIVAS_EXPORT = 10
MIN_CHARS_RESPOSTA = 1500

# --- Tempos da espera pela resposta ---
TEMPO_ESTAVEL_SEG = 10
ESPERA_INICIAL_S = 15
TIMEOUT_RESPOSTA_S = 900
TRAVA_STREAM_S = 180

ARQUIVOS_ANEXAR = [
    "Comando resolução_ RESIDÊNCIA_AUTOMAÇÃO.txt",
    "perguntas.pdf",
    "provas_anteriores.pdf",
    "TAMPLATE RESOLUTOR DE QUESTÕES.html",
]

AUTO = False
FORCAR = False
TAM_TEMPLATE = 0
_STDIN_THREAD_STARTED = False


class NavegadorMorto(Exception):
    """O Chrome parou de responder (ou precisa ser reiniciado)."""


# ---------------------------------------------------------------------------
# Contexto por banca/ano (usado por TODAS as funções que gravam em PASTA_SAIDA
# ou leem progresso; por padrão, aponta para os caminhos-base).
# ---------------------------------------------------------------------------
def configurar_ano(banca=None, ano=None):
    global _PASTA_SAIDA_ANO, _ARQ_ESTADO_ANO, _PASTA_REJEITADAS_ANO, _CURRENT_BANCA, _CURRENT_ANO
    if banca is None:
        _PASTA_SAIDA_ANO = PASTA_SAIDA
        _ARQ_ESTADO_ANO = ARQ_ESTADO
        _PASTA_REJEITADAS_ANO = PASTA_REJEITADAS
        _CURRENT_BANCA = ""
        _CURRENT_ANO = ""
    else:
        _PASTA_SAIDA_ANO = os.path.join(PASTA_SAIDA, banca, ano)
        _ARQ_ESTADO_ANO = os.path.join(_PASTA_SAIDA_ANO, "progresso.json")
        _PASTA_REJEITADAS_ANO = os.path.join(_PASTA_SAIDA_ANO, "rejeitadas")
        _CURRENT_BANCA = banca
        _CURRENT_ANO = ano
    os.makedirs(_PASTA_SAIDA_ANO, exist_ok=True)
    os.makedirs(_PASTA_REJEITADAS_ANO, exist_ok=True)


# ---------------------------------------------------------------------------
# Parada limpa
# ---------------------------------------------------------------------------
_PARAR = threading.Event()
_ultimo_check_arquivo = [0.0]


def checar_comando_parada():
    if _PARAR.is_set():
        return True
    agora = time.time()
    if agora - _ultimo_check_arquivo[0] >= 1.0:
        _ultimo_check_arquivo[0] = agora
        if os.path.exists(ARQ_PARAR):
            logging.info(f"Arquivo {ARQ_PARAR} detectado. Parando com segurança...")
            _PARAR.set()
    return _PARAR.is_set()


def _thread_stdin():
    try:
        for linha in sys.stdin:
            if linha.strip().upper() == "S":
                logging.info("Comando S recebido. Parando com segurança...")
                _PARAR.set()
                return
    except Exception:
        pass


def iniciar_thread_stdin():
    global _STDIN_THREAD_STARTED
    if _STDIN_THREAD_STARTED:
        return
    if sys.stdin and sys.stdin.isatty():
        threading.Thread(target=_thread_stdin, daemon=True).start()
        _STDIN_THREAD_STARTED = True


def _handler_sinal(signum, _frame):
    if _PARAR.is_set():
        raise KeyboardInterrupt
    logging.info(f"Sinal {signum} recebido. Parando com segurança (repita para forçar)...")
    _PARAR.set()


def dormir(segundos, heartbeat=300):
    fim = time.time() + segundos
    proximo_log = time.time() + heartbeat
    while True:
        if checar_comando_parada():
            return False
        resto = fim - time.time()
        if resto <= 0:
            return True
        if heartbeat and time.time() >= proximo_log:
            logging.info(f"  ...aguardando, faltam ~{int(resto)}s")
            proximo_log = time.time() + heartbeat
        time.sleep(min(1.0, resto))


def sair(codigo=1):
    if not AUTO and sys.stdin and sys.stdin.isatty():
        try:
            input("Pressione Enter para fechar...")
        except EOFError:
            pass
    sys.exit(codigo)


def notificar(titulo, msg):
    logging.warning(f"[ALERTA] {titulo}: {msg}")
    try:
        sys.stderr.write("\a")
        sys.stderr.flush()
    except Exception:
        pass
    if shutil.which("notify-send"):
        try:
            subprocess.run(["notify-send", titulo, msg], timeout=5)
        except Exception:
            pass


def configurar_log():
    os.makedirs(PASTA_LOGS, exist_ok=True)
    fmt = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    raiz = logging.getLogger()
    raiz.setLevel(logging.INFO)
    for h in list(raiz.handlers):
        raiz.removeHandler(h)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    raiz.addHandler(sh)
    fh = logging.handlers.RotatingFileHandler(
        os.path.join(PASTA_LOGS, "automacao.log"), maxBytes=5_000_000, backupCount=5, encoding="utf-8")
    fh.setFormatter(fmt)
    raiz.addHandler(fh)


# ---------------------------------------------------------------------------
# Localização tolerante dos arquivos de entrada (mantido)
# ---------------------------------------------------------------------------
def normalizar(texto):
    t = unicodedata.normalize("NFKD", texto)
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]', '', t.lower())


def achar_arquivo(pasta, nome_exato, predicado, descricao):
    exato = os.path.join(pasta, nome_exato)
    if os.path.isfile(exato):
        return exato
    candidatos = []
    for nome in sorted(os.listdir(pasta)):
        caminho = os.path.join(pasta, nome)
        if os.path.isfile(caminho) and predicado(normalizar(nome)):
            candidatos.append(caminho)
    if candidatos:
        logging.info(f"{descricao}: usando '{os.path.basename(candidatos[0])}'")
        if len(candidatos) > 1:
            logging.warning(f"{descricao}: mais de um candidato, usando o primeiro: "
                            f"{[os.path.basename(c) for c in candidatos]}")
        return candidatos[0]
    return None


def resolver_lista_anexos(nomes):
    resultado = []
    for nome in nomes:
        n_norm = normalizar(nome)
        if n_norm.startswith("perguntas"):
            pred = lambda n: n.startswith("perguntas")
        elif "comando" in n_norm and "resolu" in n_norm:
            pred = lambda n: "comando" in n and "resolu" in n
        elif "template" in n_norm or "tamplate" in n_norm:
            pred = lambda n: ("template" in n or "tamplate" in n) and not n.startswith("comando")
        elif "provas" in n_norm or "anteriores" in n_norm:
            pred = lambda n: "provas" in n or "anteriores" in n
        else:
            pred = lambda n, alvo=n_norm: n == alvo
        caminho = achar_arquivo(BASE, nome, pred, f"Anexo: {nome}")
        if caminho and caminho not in resultado:
            resultado.append(caminho)
        elif not caminho:
            logging.error(f"Arquivo da lista não encontrado em {BASE}: {nome!r}")
    return resultado


# ---------------------------------------------------------------------------
# Descoberta de bancas e edições
# ---------------------------------------------------------------------------
def listar_bancas():
    """Nomes das pastas de bancas, ordenadas alfabeticamente."""
    if not os.path.isdir(EXAMS_DIR):
        return []
    return sorted([d for d in os.listdir(EXAMS_DIR)
                   if os.path.isdir(os.path.join(EXAMS_DIR, d))])


def listar_anos(banca):
    """Anos (strings numéricas) existentes na banca, em ordem DECRESCENTE (2026 → 2025 → ...)."""
    pasta_banca = os.path.join(EXAMS_DIR, banca)
    if not os.path.isdir(pasta_banca):
        return []
    anos = [d for d in os.listdir(pasta_banca)
            if os.path.isdir(os.path.join(pasta_banca, d)) and d.isdigit()]
    return sorted(anos, reverse=True)


def encontrar_perguntas_do_ano(ano_dir):
    """Procura perguntas.txt ou perguntas.pdf (case-insensitive) na pasta do ano."""
    if not os.path.isdir(ano_dir):
        return None
    alvos = {"perguntas.txt", "perguntas.pdf"}
    for f in os.listdir(ano_dir):
        if f.lower() in alvos:
            return os.path.join(ano_dir, f)
    for f in os.listdir(ano_dir):
        if normalizar(f).startswith("perguntas"):
            return os.path.join(ano_dir, f)
    return None


# ---------------------------------------------------------------------------
# Leitura de perguntas (mantido)
# ---------------------------------------------------------------------------
def extrair_texto_pdf(caminho):
    try:
        import pypdf
        reader = pypdf.PdfReader(caminho)
        return "\n\n".join((p.extract_text() or "") for p in reader.pages)
    except ImportError:
        pass
    except Exception as e:
        logging.warning(f"pypdf falhou: {e}")
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(caminho)
        return "\n\n".join((p.extract_text() or "") for p in reader.pages)
    except ImportError:
        pass
    except Exception as e:
        logging.warning(f"PyPDF2 falhou: {e}")
    try:
        import pdfplumber
        with pdfplumber.open(caminho) as pdf:
            return "\n\n".join((pg.extract_text() or "") for pg in pdf.pages)
    except ImportError:
        pass
    except Exception as e:
        logging.warning(f"pdfplumber falhou: {e}")
    try:
        r = subprocess.run(["pdftotext", "-layout", caminho, "-"],
                           capture_output=True, text=True, timeout=180)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout
    except Exception as e:
        logging.warning(f"pdftotext falhou: {e}")
    return None


def dividir_perguntas(texto):
    texto = texto.replace('\r\n', '\n').replace('\r', '\n')
    blocos_vazios = re.split(r'\n\s*\n+', texto)
    blocos_vazios = [b.strip() for b in blocos_vazios if b.strip()]
    partes = re.split(r'(?m)^\s*(?:Quest[ãa]o\s*)?(\d{1,3})\s*[\.\)\-]\s*', texto)
    blocos_marcadores = []
    if len(partes) >= 3:
        for i in range(1, len(partes), 2):
            if i + 1 < len(partes):
                num = partes[i].strip()
                corpo = partes[i + 1].strip()
                if corpo:
                    blocos_marcadores.append(f"Questão {num}: {corpo}")
    if len(blocos_marcadores) >= 2 and len(blocos_marcadores) >= len(blocos_vazios):
        return blocos_marcadores
    if len(blocos_vazios) >= 2:
        return blocos_vazios
    if blocos_marcadores:
        return blocos_marcadores
    if blocos_vazios:
        return blocos_vazios
    t = texto.strip()
    return [t] if t else []


def carregar_perguntas(caminho):
    ext = os.path.splitext(caminho)[1].lower()
    if ext == ".pdf":
        logging.info(f"Extraindo perguntas do PDF: {os.path.basename(caminho)}")
        texto = extrair_texto_pdf(caminho)
        if texto is None:
            logging.error(f"Não foi possível extrair texto de '{caminho}'.")
            return []
        perguntas_extraidas = dividir_perguntas(texto)
        logging.info(f"PDF: {len(perguntas_extraidas)} bloco(s).")
        return perguntas_extraidas
    logging.info(f"Lendo perguntas do arquivo de texto: {os.path.basename(caminho)}")
    with open(caminho, "r", encoding="utf-8", errors="replace") as f:
        return [p.strip() for p in f.readlines() if p.strip()]


# ---------------------------------------------------------------------------
# Estado persistente (por banca/ano)
# ---------------------------------------------------------------------------
def _agora_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def salvar_estado(estado):
    estado["ultima_atualizacao"] = _agora_iso()
    tmp = _ARQ_ESTADO_ANO + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(estado, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _ARQ_ESTADO_ANO)
    except Exception as e:
        logging.warning(f"Não consegui salvar estado: {e}")


def carregar_estado():
    if not os.path.isfile(_ARQ_ESTADO_ANO):
        return None
    try:
        with open(_ARQ_ESTADO_ANO, encoding="utf-8") as f:
            estado = json.load(f)
        if estado.get("versao") != ESTADO_VERSAO:
            logging.warning(f"Estado com versão incompatível ({estado.get('versao')}). Ignorando.")
            return None
        return estado
    except Exception as e:
        logging.warning(f"Não consegui ler estado: {e}")
        return None


def novo_estado(opcao, indices, banca="", ano=""):
    return {
        "versao": ESTADO_VERSAO,
        "opcao": opcao,
        "banca": banca,
        "ano": ano,
        "forcar": FORCAR,
        "indices_a_processar": list(indices),
        "indices_concluidos": [],
        "indices_falhados": [],
        "pendentes_export": [],
        "tentativas": {},
        "estatisticas": {"busy": 0, "rate": 0, "length": 0, "invalida": 0,
                         "curta": 0, "truncada": 0, "timeout": 0, "reinicios_chrome": 0},
    }


def caminho_html(numero):
    return os.path.join(_PASTA_SAIDA_ANO, f"questão_{numero}.html")


_INVALIDOS_AVISADOS = set()


def obter_indices_ja_feitos(validar=None):
    """Índices (base 0) das questões da edição atual que já têm HTML (válido) em disco."""
    if validar is None:
        validar = VALIDAR_HTML_EXISTENTES
    feitos = set()
    try:
        nomes = os.listdir(_PASTA_SAIDA_ANO)
    except Exception:
        return feitos
    for f in nomes:
        m = re.match(r"quest.o_(\d+)\.html$", f, re.IGNORECASE)
        if not m:
            continue
        numero = int(m.group(1))
        if validar:
            caminho = os.path.join(_PASTA_SAIDA_ANO, f)
            try:
                with open(caminho, "r", encoding="utf-8", errors="replace") as fh:
                    html = fh.read()
            except Exception:
                continue
            ok, motivo = validar_html(html, numero)
            if not ok:
                if caminho not in _INVALIDOS_AVISADOS:
                    _INVALIDOS_AVISADOS.add(caminho)
                    logging.warning(f"HTML existente inválido ({f}: {motivo}); será regerado.")
                continue
        feitos.add(numero - 1)
    return feitos


def resumo_edicao(total):
    """(quantidade gerada, última questão gerada [base 1] ou 0, primeira pendente ou None)."""
    feitos = {i for i in obter_indices_ja_feitos() if 0 <= i < total}
    ultima = (max(feitos) + 1) if feitos else 0
    pendentes = [i + 1 for i in range(total) if i not in feitos]
    return len(feitos), ultima, (pendentes[0] if pendentes else None)


# ---------------------------------------------------------------------------
# Validação do HTML gerado (mantido)
# ---------------------------------------------------------------------------
PLACEHOLDERS = ["[Theme]", "[QuestionNumber]", "[QuestionText]", "[DataTableSection]",
                "[StatementsSection]", "[OptionsSection]", "[CorrectAnswer]", "[CorrectionDetails]"]
RE_HTML = re.compile(r'<!DOCTYPE html>.*?</html>', re.DOTALL | re.IGNORECASE)


def validar_html(html, numero):
    h = (html or "").strip()
    minimo = max(6000, int(TAM_TEMPLATE * 0.35))
    if not h.lower().startswith("<!doctype html"):
        return False, "não começa com <!DOCTYPE html>"
    if not h.lower().rstrip().endswith("</html>"):
        return False, "não termina com </html> (truncado?)"
    if len(h) < minimo:
        return False, f"muito curto ({len(h)} < {minimo} chars)"
    sobras = [p for p in PLACEHOLDERS if p in h]
    if sobras:
        return False, f"placeholders não substituídos: {sobras}"
    if "```" in h:
        return False, "contém cercas de markdown (```)"
    if not re.search(r"const\s+correctAnswer\s*=\s*['\"][A-E]['\"]", h):
        return False, "correctAnswer ausente ou inválido"
    if 'id="correctionContent"' not in h and "id='correctionContent'" not in h:
        return False, "div correctionContent ausente"
    n = int(numero)
    if not (re.search(rf"<title>[^<]*Quest[ãa]o\s*0*{n}\b", h, re.IGNORECASE)
            or re.search(rf"<h1>\s*Quest[ãa]o\s*0*{n}\s*</h1>", h, re.IGNORECASE)):
        return False, f"não identifica 'Questão {n}' no título/h1"
    return True, ""


RE_CERCA = re.compile(r'(?m)^[ \t]*```[a-zA-Z]*[ \t]*\r?\n?')


def sanitizar_html(html):
    return RE_CERCA.sub("", html or "").strip()


def salvar_html(numero, html, sobrescrever=True):
    destino = caminho_html(numero)
    if not sobrescrever and os.path.isfile(destino):
        return None
    tmp = destino + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(html.strip())
    os.replace(tmp, destino)
    logging.info(f"Salvo: {destino} ({len(html)} caracteres)")
    return destino


def guardar_rejeitada(numero, html, motivo):
    try:
        os.makedirs(_PASTA_REJEITADAS_ANO, exist_ok=True)
        p = os.path.join(_PASTA_REJEITADAS_ANO, f"questão_{numero}_{int(time.time())}.html")
        with open(p, "w", encoding="utf-8") as f:
            f.write(f"<!-- rejeitada: {motivo} -->\n{html}")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Classificação de mensagens do servidor
# ---------------------------------------------------------------------------
def norm_txt(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


_KW = {
    "length": [
        "length limit", "conversation is too long", "maximum length", "context length",
        "reached the maximum", "start a new chat", "start a new conversation",
        "limite de tamanho", "conversa muito longa", "limite de contexto",
        "inicie uma nova conversa", "comece uma nova conversa", "对话长度", "对话过长", "开启新对话",
    ],
    "rate": [
        "too many requests", "muitas solicitacoes", "muitas requisicoes", "too frequently",
        "too frequent", "muito frequentemente", "com muita frequencia", "rate limit",
        "limite de taxa", "limite de requisicoes", "limit reached", "limite atingido",
        "daily limit", "limite diario", "quota exceeded", "cota excedida", "exceeded your",
        "excedeu o limite", "slow down", "mais devagar", "请求过于频繁", "发送消息过于频繁", "频繁",
    ],
    "busy": [
        "server is busy", "server busy", "servidor ocupado", "servidor esta ocupado",
        "servidor sobrecarregado", "system is busy", "sistema ocupado", "service unavailable",
        "servico indisponivel", "temporarily unavailable", "temporariamente indisponivel",
        "overloaded", "high traffic", "trafego alto", "alto trafego", "try again later",
        "tente novamente mais tarde", "tente mais tarde", "tente novamente em instantes",
        "please wait", "por favor aguarde", "something went wrong", "algo deu errado",
        "an error occurred", "ocorreu um erro", "network error", "erro de rede",
        "connection error", "erro de conexao", "failed to fetch", "bad gateway",
        "gateway timeout", "服务器繁忙", "请稍后再试", "稍后再试", "网络错误",
    ],
}
_KW = {c: [norm_txt(k) for k in ks] for c, ks in _KW.items()}
KW_TODAS = [k for ks in _KW.values() for k in ks]
PRIORIDADE_BLOQUEIO = ["length", "rate", "busy"]


def classificar_texto(txt):
    n = norm_txt(txt)
    if not n.strip():
        return None
    for classe in PRIORIDADE_BLOQUEIO:
        if any(k in n for k in _KW[classe]):
            return classe
    return None


# ---------------------------------------------------------------------------
# JavaScript injetado (mantido)
# ---------------------------------------------------------------------------
JS_VIGIA_INSTALAR = r"""
const kws = arguments[0];
if (window.__vigia && window.__vigia.ativo) return true;
const V = window.__vigia = {ativo: true, hits: []};
const IGN = 'pre, code, .ds-markdown, [class*="markdown"], textarea, #chat-input';
const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const obs = new MutationObserver(muts => {
  for (const m of muts) {
    for (const n of m.addedNodes) {
      try {
        const el = n.nodeType === 1 ? n : n.parentElement;
        if (!el || (el.closest && el.closest(IGN))) continue;
        const txt = ((n.nodeType === 1 ? (n.innerText || n.textContent) : n.textContent) || '').trim();
        if (!txt || txt.length > 300) continue;
        const t = norm(txt);
        if (kws.some(k => t.includes(k))) {
          V.hits.push({t: Date.now(), txt: txt});
          if (V.hits.length > 50) V.hits.shift();
        }
      } catch (e) {}
    }
  }
});
obs.observe(document.body, {childList: true, subtree: true, characterData: true});
return true;
"""

JS_LER_VIGIA = r"""
const desde = arguments[0];
return (window.__vigia ? window.__vigia.hits : []).filter(h => h.t >= desde).map(h => h.txt);
"""

JS_SCAN_ALERTAS = r"""
const kws = arguments[0];
const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const IGN = 'pre, code, .ds-markdown, [class*="markdown"], textarea, #chat-input';
const sels = ['[role="alert"]','[role="dialog"]','[class*="toast"]','[class*="Toast"]',
  '[class*="notification"]','[class*="snackbar"]','[class*="banner"]','[class*="error"]',
  '[class*="warning"]','[class*="busy"]','[class*="modal"]','[class*="popup"]'];
const achados = [];
for (const sel of sels) {
  let els; try { els = document.querySelectorAll(sel); } catch (e) { continue; }
  for (const el of els) {
    try {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      if (el.closest(IGN)) continue;
      const txt = (el.innerText || '').trim();
      if (!txt || txt.length > 300) continue;
      const n = norm(txt);
      if (kws.some(k => n.includes(k))) achados.push(txt);
    } catch (e) {}
  }
}
return achados;
"""

JS_RESPOSTA_EM_ANDAMENTO = r"""
const signals = [
  '[aria-label*="Stop"]', '[aria-label*="stop"]', '[aria-label*="Parar"]', '[aria-label*="parar"]',
  '[class*="stop-button"]', '[class*="streaming"]', '[class*="generating"]',
  '[data-state="streaming"]', '[data-state="loading"]',
];
for (const sel of signals) {
  try {
    for (const el of document.querySelectorAll(sel)) { if (el.offsetParent !== null) return true; }
  } catch (e) {}
}
return false;
"""

JS_ULTIMA_RESPOSTA = r"""
const seletores = ['.ds-markdown', '[data-role="assistant"]', '[class*="markdown"]'];
for (const sel of seletores) {
  let els; try { els = Array.from(document.querySelectorAll(sel)); } catch (e) { continue; }
  els = els.filter(e => !e.closest('[class*="think"]') && !e.closest('[data-role="user"]'));
  if (!els.length) continue;
  const alvo = els[els.length - 1];
  const pres = Array.from(alvo.querySelectorAll('pre')).map(p => p.innerText || p.textContent || '');
  return {n: els.length, texto: alvo.innerText || '', pres: pres};
}
return {n: 0, texto: '', pres: []};
"""

JS_ESTADO_PAGINA = r"""
const t = (document.body ? document.body.innerText : '').slice(0, 3000).toLowerCase();
return {
  url: location.href, title: (document.title || '').toLowerCase(),
  ta: !!document.querySelector('textarea'),
  pw: !!document.querySelector('input[type=password]'),
  neterror: !!document.querySelector('#main-frame-error, .neterror'),
  txt: t
};
"""

JS_OBSERVER_DOM = """
if (window.__dsObserver) { window.__dsObserver.disconnect(); }
window.__lastMutation = Date.now();
window.__dsObserver = new MutationObserver(function() { window.__lastMutation = Date.now(); });
window.__dsObserver.observe(document.body, {childList: true, subtree: true, characterData: true});
"""

JS_BUSCAR_BOTAO = """
const alvo = arguments[0].toLowerCase();
function norm(s) { return (s || '').replace(/\\s+/g, ' ').trim().toLowerCase(); }
function confere(el) {
    const tag = el.tagName;
    if (tag !== 'BUTTON' && el.getAttribute('role') !== 'button' && tag !== 'A' && tag !== 'DIV' && tag !== 'LI') return false;
    if (norm(el.getAttribute('aria-label')) === alvo) return true;
    const txt = norm(el.textContent);
    return txt === alvo;
}
const pilha = [document];
let melhor = null;
while (pilha.length) {
    const no = pilha.pop();
    if (no.nodeType === 1) {
        if (confere(no)) {
            if (!melhor || no.tagName === 'BUTTON') melhor = no;
            if (no.tagName === 'BUTTON') return no;
        }
        if (no.shadowRoot) pilha.push(no.shadowRoot);
    }
    const filhos = no.children || [];
    for (let i = filhos.length - 1; i >= 0; i--) pilha.push(filhos[i]);
}
return melhor;
"""

JS_CONTAR_EXTENSAO = """
let n = 0;
const pilha = [document];
while (pilha.length) {
    const no = pilha.pop();
    if (no.nodeType === 1) {
        const c = (no.getAttribute('class') || '');
        if (/(^|\\s)(ce-|ce_)/.test(c) || c.indexOf('ce-nav-trigger') >= 0) n++;
        if (no.shadowRoot) pilha.push(no.shadowRoot);
    }
    const filhos = no.children || [];
    for (let i = 0; i < filhos.length; i++) pilha.push(filhos[i]);
}
return n;
"""


# ---------------------------------------------------------------------------
# Chrome + chromedriver (mantido)
# ---------------------------------------------------------------------------
def localizar_chrome():
    candidatos = [
        "/opt/google/chrome/chrome", "/opt/google/chrome/google-chrome",
        shutil.which("google-chrome-stable"), "/usr/bin/google-chrome-stable",
        shutil.which("google-chrome"), "/usr/bin/google-chrome",
        shutil.which("chromium-browser"), shutil.which("chromium"),
    ]
    for c in candidatos:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def versao_do_chrome(binario):
    try:
        saida = subprocess.run([binario, "--version"], capture_output=True,
                               text=True, timeout=20).stdout
        m = re.search(r'(\d+\.\d+\.\d+\.\d+)', saida)
        if m:
            return m.group(1)
    except Exception as e:
        logging.warning(f"Versão do Chrome: {e}")
    return None


def _baixar_zip(url, destino_zip):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=180) as resp, open(destino_zip, "wb") as out:
        shutil.copyfileobj(resp, out)


def obter_chromedriver(versao_chrome):
    destino = os.path.join(PASTA_DRIVER, f"chromedriver_{versao_chrome}", "chromedriver")
    if os.path.isfile(destino) and os.access(destino, os.X_OK):
        logging.info(f"Chromedriver local já existe: {destino}")
        return destino
    urls = [f"https://storage.googleapis.com/chrome-for-testing-public/{versao_chrome}/linux64/chromedriver-linux64.zip"]
    try:
        build = ".".join(versao_chrome.split(".")[:3])
        api = "https://googlechromelabs.github.io/chrome-for-testing/latest-patch-versions-per-build-with-downloads.json"
        req = urllib.request.Request(api, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            dados = json.load(resp)
        for d in dados.get("builds", {}).get(build, {}).get("downloads", {}).get("chromedriver", []):
            if d.get("platform") == "linux64":
                urls.append(d["url"])
    except Exception as e:
        logging.warning(f"API de versões: {e}")
    for url in urls:
        try:
            logging.info(f"Baixando chromedriver: {url}")
            with tempfile.TemporaryDirectory() as tmp:
                zip_path = os.path.join(tmp, "driver.zip")
                _baixar_zip(url, zip_path)
                with zipfile.ZipFile(zip_path) as z:
                    membro = next((n for n in z.namelist() if n.endswith("/chromedriver")), None)
                    if not membro:
                        continue
                    os.makedirs(os.path.dirname(destino), exist_ok=True)
                    with z.open(membro) as src, open(destino, "wb") as dst:
                        shutil.copyfileobj(src, dst)
            os.chmod(destino, os.stat(destino).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            logging.info(f"Chromedriver instalado em: {destino}")
            return destino
        except Exception as e:
            logging.warning(f"Falha de {url}: {e}")
    return None


def matar_chrome_do_perfil(perfil):
    try:
        subprocess.run(["pkill", "-f", f"user-data-dir={perfil}"], timeout=15)
        time.sleep(2)
    except Exception:
        pass


def preparar_perfil(perfil, matar_se_ocupado=False):
    try:
        r = subprocess.run(["pgrep", "-f", f"user-data-dir={perfil}"], capture_output=True, text=True)
        pids = [p for p in r.stdout.split() if p.strip() and int(p) != os.getpid()]
    except Exception:
        pids = []
    if pids:
        if matar_se_ocupado:
            logging.warning("Chrome antigo ainda usa o perfil; encerrando-o.")
            matar_chrome_do_perfil(perfil)
        else:
            logging.error("Já existe um Chrome usando o perfil de automação.")
            logging.error("Feche essa janela (ou pkill -f chrome) e rode de novo.")
            sair()
    for trava in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        caminho = os.path.join(perfil, trava)
        if os.path.lexists(caminho):
            try:
                os.remove(caminho)
                logging.info(f"Trava antiga removida: {trava}")
            except Exception:
                pass


def criar_driver(headless=False, reinicio=False):
    binario = localizar_chrome()
    if not binario:
        logging.error("Google Chrome não encontrado.")
        sair()
    logging.info(f"Usando navegador em: {binario}")
    versao = versao_do_chrome(binario)
    if not versao:
        logging.error("Não consegui descobrir a versão do Chrome.")
        sair()
    logging.info(f"Versão do Chrome: {versao}")
    caminho_driver = obter_chromedriver(versao)
    if not caminho_driver:
        logging.error("Não foi possível baixar o chromedriver.")
        sair()

    preparar_perfil(PERFIL_PERSISTENTE, matar_se_ocupado=(AUTO or reinicio))

    options = webdriver.ChromeOptions()
    options.binary_location = binario
    for arg in ("--no-sandbox", "--disable-dev-shm-usage", "--no-first-run",
                "--no-default-browser-check", "--start-maximized", "--window-size=1600,1000",
                "--disable-blink-features=AutomationControlled",
                "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
                f"--user-data-dir={PERFIL_PERSISTENTE}", "--profile-directory=Default"):
        options.add_argument(arg)
    if headless:
        options.add_argument("--headless=new")
    options.add_experimental_option("excludeSwitches", ["enable-automation", "disable-extensions"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_experimental_option("prefs", {
        "download.default_directory": PASTA_DOWNLOADS,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
    })
    driver = webdriver.Chrome(service=Service(executable_path=caminho_driver), options=options)
    driver.set_page_load_timeout(120)
    try:
        driver.execute_cdp_cmd("Browser.setDownloadBehavior",
                               {"behavior": "allow", "downloadPath": PASTA_DOWNLOADS})
    except Exception as e:
        logging.warning(f"CDP download: {e}")
    return driver


def fechar_driver(driver):
    try:
        driver.quit()
    except Exception:
        pass
    matar_chrome_do_perfil(PERFIL_PERSISTENTE)


def driver_vivo(driver):
    try:
        driver.execute_script("return 1")
        return True
    except Exception:
        return False


def internet_ok(host="chat.deepseek.com", porta=443, timeout=8):
    try:
        socket.create_connection((host, porta), timeout=timeout).close()
        return True
    except OSError:
        return False


def aguardar_internet():
    n = 0
    while not internet_ok():
        n += 1
        espera = min(15 * n, 300)
        logging.warning(f"Sem conexão com o DeepSeek. Nova checagem em {espera}s...")
        if not dormir(espera):
            return False
    return True


# ---------------------------------------------------------------------------
# Contexto da conversa
# ---------------------------------------------------------------------------
class Ctx:
    def __init__(self, driver, estado, arquivos, nome_comando, nome_perguntas, headless=False):
        self.driver = driver
        self.estado = estado
        self.arquivos = arquivos
        self.nome_comando = nome_comando
        self.nome_perguntas = nome_perguntas
        self.headless = headless
        self.bloq_consec = 0
        self.pausa_extra = 0.0
        self.ok_sessao = 0
        self.ok_desde_descanso = 0
        self.ts_respostas = []
        self.resetar_chat()

    def resetar_chat(self):
        self.arquivos_ja_enviados = False
        self.anexos_no_rascunho = False
        self.forcar_novo_chat = False
        self.respostas_no_chat = 0
        self.indices_no_chat = []
        self.pendentes_export_chat = []

    def estat(self, chave):
        e = self.estado.setdefault("estatisticas", {})
        e[chave] = e.get(chave, 0) + 1


def checar_vivo(ctx):
    if not driver_vivo(ctx.driver):
        raise NavegadorMorto("Chrome não responde")


# ---------------------------------------------------------------------------
# Página: navegação, login, captcha, rede
# ---------------------------------------------------------------------------
def instalar_vigia(driver):
    try:
        driver.execute_script(JS_VIGIA_INSTALAR, KW_TODAS)
    except Exception as e:
        logging.debug(f"Vigia não instalado: {e}")


def navegar(ctx, url):
    ctx.anexos_no_rascunho = False
    try:
        ctx.driver.get(url)
    except WebDriverException as e:
        checar_vivo(ctx)
        logging.warning(f"Falha ao abrir {url}: {str(e).splitlines()[0]}")
        if not internet_ok():
            aguardar_internet()


def recarregar(ctx):
    logging.info("Recarregando a página para limpar o estado...")
    ctx.anexos_no_rascunho = False
    try:
        ctx.driver.refresh()
    except WebDriverException:
        checar_vivo(ctx)
    time.sleep(5)


def estado_pagina(driver):
    try:
        e = driver.execute_script(JS_ESTADO_PAGINA)
    except Exception:
        return {"situacao": "carregando"}
    url = (e.get("url") or "").lower()
    txt = norm_txt(e.get("txt", ""))
    titulo = norm_txt(e.get("title", ""))
    if e.get("neterror"):
        return {"situacao": "rede"}
    if not e.get("ta"):
        if ("just a moment" in titulo or "verify you are human" in txt
                or "verificando se voce e humano" in txt or "cloudflare" in txt):
            return {"situacao": "captcha"}
        if e.get("pw") or "sign_in" in url or "login" in url:
            return {"situacao": "login"}
        return {"situacao": "carregando"}
    if e.get("pw") or "sign_in" in url:
        return {"situacao": "login"}
    return {"situacao": "ok"}


def encontrar_campo_texto(driver, timeout=30):
    seletores = [
        (By.ID, "chat-input"),
        (By.CSS_SELECTOR, "textarea[placeholder*='DeepSeek']"),
        (By.CSS_SELECTOR, "textarea[name='search']"),
        (By.CSS_SELECTOR, "textarea"),
    ]
    fim = time.time() + timeout
    while time.time() < fim:
        for by, sel in seletores:
            try:
                for el in driver.find_elements(by, sel):
                    if el.is_displayed():
                        return el
            except Exception:
                continue
        time.sleep(0.5)
    raise TimeoutError("Campo de texto do chat não encontrado.")


def garantir_pronto(ctx, timeout_carregar=90):
    driver = ctx.driver
    ultimo_aviso = 0.0
    desde = time.time()
    while True:
        if checar_comando_parada():
            return False
        checar_vivo(ctx)
        situacao = estado_pagina(driver)["situacao"]
        if situacao == "ok":
            instalar_vigia(driver)
            return True
        if situacao == "rede":
            if not aguardar_internet():
                return False
            navegar(ctx, URL_DEEPSEEK)
            desde = time.time()
        elif situacao in ("login", "captcha"):
            if time.time() - ultimo_aviso > 600:
                notificar("DeepSeek", f"Precisa de ação manual na janela do Chrome: {situacao}. "
                                      f"A automação continua sozinha assim que for resolvido.")
                ultimo_aviso = time.time()
            if not dormir(15, heartbeat=0):
                return False
            desde = time.time()
        else:
            if time.time() - desde > timeout_carregar:
                logging.warning("Chat não carregou a tempo; recarregando.")
                navegar(ctx, URL_DEEPSEEK)
                desde = time.time()
            else:
                time.sleep(2)


# ---------------------------------------------------------------------------
# Detecção de bloqueio do servidor
# ---------------------------------------------------------------------------
def bloqueio_detectado(driver, t0_ms):
    textos = []
    try:
        textos += driver.execute_script(JS_LER_VIGIA, t0_ms) or []
    except Exception:
        pass
    try:
        textos += driver.execute_script(JS_SCAN_ALERTAS, KW_TODAS) or []
    except Exception:
        pass
    achadas = {}
    for t in textos:
        c = classificar_texto(t)
        if c and c not in achadas:
            achadas[c] = t[:120]
    for c in PRIORIDADE_BLOQUEIO:
        if c in achadas:
            return c, achadas[c]
    return None, ""


def resposta_em_andamento(driver):
    try:
        return bool(driver.execute_script(JS_RESPOSTA_EM_ANDAMENTO))
    except Exception:
        return False


def extrair_resposta_dom(driver):
    try:
        r = driver.execute_script(JS_ULTIMA_RESPOSTA)
        if isinstance(r, dict):
            return r
    except Exception:
        pass
    return {"n": 0, "texto": "", "pres": []}


def achar_html(candidatos):
    melhor, truncado = None, False
    for c in candidatos:
        if not c:
            continue
        achou = False
        for m in RE_HTML.finditer(c):
            achou = True
            h = m.group(0).strip()
            if melhor is None or len(h) > len(melhor):
                melhor = h
        if not achou and re.search(r'<!DOCTYPE html', c, re.IGNORECASE):
            truncado = True
    return melhor, (truncado and melhor is None)


def avaliar_resposta(ctx, numero, n_antes):
    r = extrair_resposta_dom(ctx.driver)
    texto = (r.get("texto") or "").strip()
    pres = list(r.get("pres") or [])
    fontes = pres + (["\n".join(pres)] if len(pres) > 1 else []) + [texto]
    candidatos, truncado = [], False
    for f in fontes:
        h, tr = achar_html([f])
        truncado = truncado or tr
        if h:
            candidatos.append(sanitizar_html(h))
    if candidatos:
        motivos = []
        for h in candidatos:
            ok, motivo = validar_html(h, numero)
            if ok:
                return "ok", h, ""
            motivos.append((len(h), h, motivo))
        _, h, motivo = max(motivos)
        return "invalida", h, motivo
    if truncado:
        return "truncada", None, "HTML sem </html>"
    if len(texto) <= 400:
        classe = classificar_texto(texto)
        if classe:
            return classe, None, texto[:120]
    if r.get("n", 0) == 0 and not texto:
        return "pendente_export", None, "DOM não expõe a resposta (usarei o export)"
    if r.get("n", 0) <= n_antes:
        return "sem_resposta", None, "nenhuma mensagem nova do assistente"
    if len(texto) < MIN_CHARS_RESPOSTA:
        return "curta", None, f"resposta curta ({len(texto)} chars)"
    return "pendente_export", None, "resposta longa sem HTML extraível pelo DOM"


# ---------------------------------------------------------------------------
# Interação com o chat
# ---------------------------------------------------------------------------
def digitar_no_campo(driver, campo, texto):
    campo.click()
    campo.send_keys(Keys.CONTROL, "a")
    campo.send_keys(Keys.DELETE)
    campo.send_keys(texto)
    time.sleep(0.5)
    atual = campo.get_attribute("value") or ""
    if not atual.strip():
        driver.execute_script("""
            const el = arguments[0], txt = arguments[1];
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(el, txt);
            el.dispatchEvent(new Event('input', {bubbles: true}));
        """, campo, texto)


def anexar_arquivos(driver, caminhos):
    enviados = 0
    for caminho in caminhos:
        inputs = driver.find_elements(By.XPATH, "//input[@type='file']")
        if not inputs:
            logging.error("Nenhum <input type='file'> encontrado.")
            break
        try:
            inputs[0].send_keys(caminho)
            enviados += 1
            logging.info(f"Anexado: {os.path.basename(caminho)}")
            time.sleep(3)
        except Exception as e:
            logging.error(f"Erro ao anexar {os.path.basename(caminho)}: {e}")
    return enviados


def botao_enviar_habilitado(driver):
    for el in driver.find_elements(By.CSS_SELECTOR, "div[role='button'].ds-button--circle.ds-button--primary"):
        try:
            classes = el.get_attribute("class") or ""
            if el.is_displayed() and "ds-button--disabled" not in classes:
                return el
        except Exception:
            continue
    return None


def enviar_mensagem(driver, campo, timeout=180):
    logging.info("Aguardando o botão de enviar ficar ativo...")
    fim = time.time() + timeout
    while time.time() < fim:
        if checar_comando_parada():
            logging.info("Parada solicitada; abortando envio desta mensagem.")
            return False
        botao = botao_enviar_habilitado(driver)
        if botao:
            time.sleep(1)
            botao = botao_enviar_habilitado(driver) or botao
            try:
                botao.click()
            except Exception:
                driver.execute_script("arguments[0].click();", botao)
            logging.info("Botão de enviar clicado.")
            return True
        time.sleep(1)
    logging.warning("Botão de enviar não ficou ativo. Tentando Enter.")
    campo.click()
    campo.send_keys(Keys.RETURN)
    return True


def montar_instrucao(ctx, idx):
    if not ctx.arquivos_ja_enviados:
        return (
            f"Responda a questão {idx + 1} presente no arquivo '{ctx.nome_perguntas}' com base "
            f"nas instruções do arquivo '{ctx.nome_comando}', utilizando o template e as provas "
            f"anteriores anexados como referência. "
            f"Entregue APENAS o código HTML completo, sem explicações."
        )
    return (
        f"Agora responda a questão {idx + 1} do arquivo '{ctx.nome_perguntas}', "
        f"seguindo as mesmas instruções, template e provas anteriores já anexados "
        f"nesta conversa. Entregue APENAS o código HTML completo, sem explicações."
    )


def enviar_questao(ctx, idx, n_antes, t0_ms):
    driver = ctx.driver
    campo = encontrar_campo_texto(driver)
    instrucao = montar_instrucao(ctx, idx)
    digitar_no_campo(driver, campo, instrucao)
    logging.info(f"Instrução digitada: {instrucao[:80]}...")

    primeira_com_anexos = not ctx.arquivos_ja_enviados
    if primeira_com_anexos and not ctx.anexos_no_rascunho:
        logging.info("Primeira questão desta conversa: anexando arquivos...")
        if anexar_arquivos(driver, ctx.arquivos) == 0:
            return "nao_enviada", None, "nenhum anexo aceito"
        ctx.anexos_no_rascunho = True

    if not enviar_mensagem(driver, campo, timeout=300 if primeira_com_anexos else 180):
        return "parada", None, ""

    fim = time.time() + 25
    saiu = False
    while time.time() < fim:
        try:
            saiu = not (campo.get_attribute("value") or "").strip()
        except Exception:
            saiu = True
        classe, motivo = bloqueio_detectado(driver, t0_ms)
        if classe:
            if saiu and primeira_com_anexos:
                ctx.forcar_novo_chat = True
            return "bloqueio", classe, motivo
        if saiu or resposta_em_andamento(driver):
            ctx.arquivos_ja_enviados = True
            ctx.anexos_no_rascunho = False
            logging.info("Mensagem enviada")
            return "enviada", None, ""
        time.sleep(1)
    return "nao_enviada", None, "campo não esvaziou após o envio"


def aguardar_resposta_completa(ctx, t0_ms, timeout=TIMEOUT_RESPOSTA_S,
                               tempo_estavel_seg=TEMPO_ESTAVEL_SEG, espera_inicial=ESPERA_INICIAL_S):
    driver = ctx.driver
    logging.info(f"Aguardando {espera_inicial}s para a resposta começar...")
    for s in range(espera_inicial):
        if checar_comando_parada():
            return "abortado", None
        time.sleep(1)
        if s % 3 == 2:
            classe, _ = bloqueio_detectado(driver, t0_ms)
            if classe and not resposta_em_andamento(driver):
                return "bloqueio", classe

    driver.execute_script(JS_OBSERVER_DOM)
    logging.info("Monitorando estabilização do DOM...")
    inicio = time.time()
    ultimo_log = 0
    ciclo = 0
    while time.time() - inicio < timeout:
        if checar_comando_parada():
            return "abortado", None
        time.sleep(1)
        ciclo += 1
        try:
            seg = driver.execute_script("return Math.floor((Date.now() - window.__lastMutation) / 1000);")
        except Exception:
            checar_vivo(ctx)
            continue
        if ciclo % 3 == 0:
            gerando = resposta_em_andamento(driver)
            if not gerando:
                classe, _ = bloqueio_detectado(driver, t0_ms)
                if classe:
                    return "bloqueio", classe
        else:
            gerando = None
        if seg >= tempo_estavel_seg:
            if gerando is None:
                gerando = resposta_em_andamento(driver)
            if not gerando or seg >= TRAVA_STREAM_S:
                logging.info(f"Resposta estabilizada após {int(time.time() - inicio)}s")
                return "estavel", None
        decorrido = int(time.time() - inicio)
        if decorrido - ultimo_log >= 30:
            logging.info(f"  ...aguardando ({decorrido}s, {seg}s sem mutação)")
            ultimo_log = decorrido
    logging.warning("Timeout aguardando estabilização.")
    return "timeout", None


# ---------------------------------------------------------------------------
# Backoff e ritmo
# ---------------------------------------------------------------------------
def _backoff(tentativa, base=BACKOFF_BASE_S, teto=BACKOFF_MAX_S):
    espera = min(base * (2 ** max(0, tentativa - 1)), teto)
    return int(espera * (0.8 + 0.4 * random.random()))


def esperar_bloqueio(ctx, classe, motivo):
    ctx.bloq_consec += 1
    ctx.estat(classe)
    salvar_estado(ctx.estado)
    base, teto = (RATE_BASE_S, RATE_MAX_S) if classe == "rate" else (BACKOFF_BASE_S, BACKOFF_MAX_S)
    espera = _backoff(ctx.bloq_consec, base, teto)
    ctx.pausa_extra = min(PAUSA_ADAPTATIVA_TETO_S, max(PAUSA_MIN_S, ctx.pausa_extra * 1.5))
    rotulo = "Limite de mensagens" if classe == "rate" else "Servidor ocupado"
    logging.warning(f"{rotulo} ({motivo or 'sem detalhe'}). Bloqueio nº {ctx.bloq_consec} seguido; "
                    f"aguardando {espera}s. Pausa entre questões agora: ~{int(ctx.pausa_extra)}s extra.")
    if not dormir(espera):
        return False
    if ctx.bloq_consec >= BLOQ_REINICIAR_APOS:
        ctx.estat("reinicios_chrome")
        raise NavegadorMorto("bloqueios persistentes; reinício preventivo do Chrome")
    if espera >= 600 or ctx.bloq_consec >= BLOQ_RECARREGAR_APOS:
        recarregar(ctx)
    if ctx.forcar_novo_chat:
        return nova_conversa(ctx)
    return garantir_pronto(ctx)


def registrar_sucesso(ctx, idx, via_dom):
    est = ctx.estado
    if idx not in est["indices_concluidos"]:
        est["indices_concluidos"].append(idx)
    if idx in est["indices_falhados"]:
        est["indices_falhados"].remove(idx)
    if not via_dom and idx not in est["pendentes_export"]:
        est["pendentes_export"].append(idx)
        ctx.pendentes_export_chat.append(idx)
    ctx.indices_no_chat.append(idx)
    ctx.respostas_no_chat += 1
    ctx.ok_sessao += 1
    ctx.ok_desde_descanso += 1
    ctx.ts_respostas.append(time.time())
    ctx.bloq_consec //= 2
    ctx.pausa_extra = 0 if ctx.pausa_extra < 5 else ctx.pausa_extra * 0.7
    salvar_estado(est)


def respeitar_limite_horario(ctx):
    if MAX_RESPOSTAS_POR_HORA <= 0:
        return True
    while True:
        agora = time.time()
        ctx.ts_respostas = [t for t in ctx.ts_respostas if agora - t < 3600]
        if len(ctx.ts_respostas) < MAX_RESPOSTAS_POR_HORA:
            return True
        espera = int(3600 - (agora - ctx.ts_respostas[0])) + 5
        logging.info(f"Limite de {MAX_RESPOSTAS_POR_HORA} respostas/hora atingido; aguardando {espera}s.")
        if not dormir(espera):
            return False


def pausa_entre_questoes(ctx):
    if LOTE_ANTES_DE_DESCANSO and ctx.ok_desde_descanso >= LOTE_ANTES_DE_DESCANSO:
        ctx.ok_desde_descanso = 0
        espera = int(DESCANSO_LOTE_S * (0.8 + 0.4 * random.random()))
        logging.info(f"Descanso periódico de {espera}s para não disparar limites de uso.")
        return dormir(espera)
    espera = random.uniform(PAUSA_MIN_S, PAUSA_MAX_S) + ctx.pausa_extra
    logging.info(f"Pausa de {int(espera)}s antes da próxima questão.")
    return dormir(espera, heartbeat=0)


# ---------------------------------------------------------------------------
# Export e extração (mantidos)
# ---------------------------------------------------------------------------
def _buscar_botao_no_contexto(driver, texto):
    try:
        return driver.execute_script(JS_BUSCAR_BOTAO, texto)
    except Exception:
        return None


def buscar_botao(driver, texto, timeout=60):
    fim = time.time() + timeout
    while time.time() < fim:
        driver.switch_to.default_content()
        el = _buscar_botao_no_contexto(driver, texto)
        if el:
            return el
        try:
            frames = driver.find_elements(By.CSS_SELECTOR, "iframe, frame")
        except Exception:
            frames = []
        for fr in frames:
            try:
                driver.switch_to.default_content()
                driver.switch_to.frame(fr)
                el = _buscar_botao_no_contexto(driver, texto)
                if el:
                    return el
            except Exception:
                continue
        driver.switch_to.default_content()
        time.sleep(1)
    return None


def _clicar(driver, elemento):
    try:
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", elemento)
    except Exception:
        pass
    time.sleep(0.5)
    try:
        elemento.click()
        return
    except Exception:
        pass
    try:
        ActionChains(driver).move_to_element(elemento).pause(0.3).click().perform()
        return
    except Exception:
        pass
    driver.execute_script("arguments[0].click();", elemento)


def salvar_diagnostico(driver, nome):
    try:
        driver.switch_to.default_content()
        png = os.path.join(PASTA_DIAG, f"{nome}.png")
        html = os.path.join(PASTA_DIAG, f"{nome}.html")
        driver.save_screenshot(png)
        with open(html, "w", encoding="utf-8") as f:
            f.write(driver.page_source)
        try:
            logging.info(f"Elementos da extensão: {driver.execute_script(JS_CONTAR_EXTENSAO)}")
        except Exception:
            pass
        logging.info(f"Diagnóstico salvo em: {png} e {html}")
    except Exception as e:
        logging.warning(f"Diagnóstico: {e}")


def aguardar_download_md(pasta_downloads, antes, timeout=120):
    inicio = time.time()
    while time.time() - inicio < timeout:
        atuais = set(os.listdir(pasta_downloads))
        novos = atuais - antes
        parciais = [f for f in atuais if f.endswith('.crdownload')]
        mds = [f for f in novos if f.endswith('.md')]
        if mds and not parciais:
            arq = os.path.join(pasta_downloads,
                               max(mds, key=lambda f: os.path.getmtime(os.path.join(pasta_downloads, f))))
            t1 = os.path.getsize(arq)
            time.sleep(2)
            if t1 == os.path.getsize(arq) and t1 > 0:
                logging.info(f"Markdown baixado: {arq}")
                return arq
        time.sleep(1)
    raise TimeoutError("Não foi possível confirmar o download do .md")


def exportar_automatico(driver, pasta_downloads):
    antes = set(os.listdir(pasta_downloads))
    driver.switch_to.default_content()
    try:
        driver.execute_script("window.scrollTo(0, 0);")
    except Exception:
        pass
    logging.info("Procurando botão 'Export'...")
    export_btn = buscar_botao(driver, "Export", timeout=60)
    if not export_btn:
        raise RuntimeError("Botão 'Export' não encontrado.")
    _clicar(driver, export_btn)
    logging.info("Botão 'Export' clicado")
    time.sleep(2)
    logging.info("Procurando opção 'Markdown'...")
    md_btn = buscar_botao(driver, "Markdown", timeout=30)
    if not md_btn:
        logging.info("Menu não abriu. Tentando de novo...")
        export_btn = buscar_botao(driver, "Export", timeout=10)
        if export_btn:
            _clicar(driver, export_btn)
            time.sleep(2)
        md_btn = buscar_botao(driver, "Markdown", timeout=30)
    if not md_btn:
        raise RuntimeError("Opção 'Markdown' não encontrada.")
    _clicar(driver, md_btn)
    logging.info("Opção 'Markdown' clicada")
    driver.switch_to.default_content()
    logging.info("Aguardando download do .md...")
    return aguardar_download_md(pasta_downloads, antes, timeout=120)


def exportar_conversa_markdown_com_retry(driver, pasta_downloads, max_tentativas=MAX_TENTATIVAS_EXPORT):
    for tentativa in range(1, max_tentativas + 1):
        try:
            return exportar_automatico(driver, pasta_downloads)
        except Exception as e:
            logging.warning(f"Tentativa {tentativa} de exportação falhou: {e}")
            if tentativa < max_tentativas:
                espera = min(60 * tentativa, 600) if not _PARAR.is_set() else 5
                logging.info(f"Aguardando {espera}s antes de tentar de novo...")
                time.sleep(espera)
            else:
                salvar_diagnostico(driver, "falha_export_final")
                raise
    raise RuntimeError("Export falhou após todas as tentativas.")


def extrair_htmls_do_markdown(caminho_md, pasta_saida, numeros_esperados, sobrescrever=True):
    with open(caminho_md, "r", encoding="utf-8") as f:
        conteudo = f.read()
    padrao_usuario = r'^#{1,6}[ \t]*(?:You|Você|Voce|User|Usuário|Usuario)[ \t]*:?[ \t]*\r?$'
    partes = re.split(padrao_usuario, conteudo, flags=re.MULTILINE | re.IGNORECASE)
    gerados = []

    def _gravar(numero, html):
        html = sanitizar_html(html)
        ok, motivo = validar_html(html, numero)
        if not ok:
            logging.warning(f"Questão {numero}: HTML do markdown reprovado ({motivo}).")
            guardar_rejeitada(numero, html, motivo)
            return
        destino = salvar_html(numero, html, sobrescrever=sobrescrever)
        if destino:
            gerados.append(destino)

    if len(partes) < 2:
        logging.warning("Nenhuma seção de usuário encontrada. Extraindo por ordem.")
        blocos = re.findall(r'<!DOCTYPE html>.*?</html>', conteudo, re.DOTALL | re.IGNORECASE)
        for i, html in enumerate(blocos):
            numero = numeros_esperados[i] if i < len(numeros_esperados) else i + 1
            _gravar(numero, html.strip())
        return gerados
    for i, parte in enumerate(partes[1:]):
        m_q = re.search(r'quest[ãa]o\s+(\d+)', parte[:600], re.IGNORECASE)
        if m_q:
            numero = str(int(m_q.group(1)))
        elif i < len(numeros_esperados):
            numero = str(numeros_esperados[i])
            logging.warning(f"Número não identificado no bloco {i + 1}; usando {numero}.")
        else:
            continue
        m_html = RE_HTML.search(parte)
        if not m_html:
            logging.warning(f"HTML completo não encontrado para a questão {numero}")
            continue
        _gravar(numero, m_html.group(0).strip())
    return gerados


def finalizar_chat(ctx):
    est = ctx.estado
    pend = list(ctx.pendentes_export_chat)
    if not ctx.indices_no_chat and not pend:
        return
    if not pend and not EXPORTAR_MD_AO_FINALIZAR_CHAT:
        return
    numeros = [i + 1 for i in ctx.indices_no_chat]
    md = None
    try:
        md = exportar_conversa_markdown_com_retry(
            ctx.driver, PASTA_DOWNLOADS, max_tentativas=MAX_TENTATIVAS_EXPORT if pend else 3)
    except Exception as e:
        logging.warning(f"Export da conversa falhou ({e}). "
                        f"{'Questões dependentes dele serão regeradas.' if pend else 'Não é fatal.'}")
    if md:
        destino = os.path.join(_PASTA_SAIDA_ANO, f"conversa_{time.strftime('%Y%m%d_%H%M%S')}.md")
        try:
            shutil.move(md, destino)
        except Exception:
            destino = md
        try:
            gerados = extrair_htmls_do_markdown(destino, _PASTA_SAIDA_ANO, numeros, sobrescrever=False)
            logging.info(f"Export: {len(gerados)} HTML(s) novo(s) extraído(s).")
        except Exception as e:
            logging.warning(f"Extração do markdown falhou: {e}")
    for i in pend:
        if i in est["pendentes_export"]:
            est["pendentes_export"].remove(i)
        if not os.path.isfile(caminho_html(i + 1)):
            logging.warning(f"Questão {i + 1} não pôde ser resgatada; voltará para a fila.")
            if i in est["indices_concluidos"]:
                est["indices_concluidos"].remove(i)
            if i not in est["indices_falhados"]:
                est["indices_falhados"].append(i)
    ctx.pendentes_export_chat = []
    salvar_estado(est)


def nova_conversa(ctx, finalizar=True):
    if finalizar:
        try:
            finalizar_chat(ctx)
        except NavegadorMorto:
            raise
        except Exception as e:
            logging.warning(f"Erro ao finalizar conversa: {e}")
    logging.info("Abrindo nova conversa (anexos serão reenviados na próxima questão).")
    ctx.resetar_chat()
    navegar(ctx, URL_DEEPSEEK)
    return garantir_pronto(ctx)


# ---------------------------------------------------------------------------
# Processamento de uma questão
# ---------------------------------------------------------------------------
def tratar_bloqueio(ctx, classe, motivo):
    if classe == "length":
        logging.warning(f"Limite de tamanho da conversa ({motivo}). Iniciando nova conversa.")
        ctx.estat("length")
        return nova_conversa(ctx)
    return esperar_bloqueio(ctx, classe, motivo)


def processar_questao(ctx, idx):
    numero = idx + 1
    falhas = 0
    eventos_length = 0
    while True:
        if checar_comando_parada():
            return "parada"
        if falhas >= MAX_FALHAS_POR_QUESTAO:
            return "falhou"
        if not garantir_pronto(ctx):
            return "parada"
        if not respeitar_limite_horario(ctx):
            return "parada"

        n_antes = extrair_resposta_dom(ctx.driver).get("n", 0)
        t0 = int(time.time() * 1000)
        try:
            env, classe, motivo = enviar_questao(ctx, idx, n_antes, t0)
        except NavegadorMorto:
            raise
        except Exception as e:
            checar_vivo(ctx)
            logging.warning(f"Questão {numero}: erro no envio ({e}).")
            falhas += 1
            if not dormir(30, heartbeat=0):
                return "parada"
            continue

        if env == "parada":
            return "parada"
        if env == "bloqueio":
            if classe == "length":
                eventos_length += 1
                if eventos_length > 3:
                    falhas += 1
            if not tratar_bloqueio(ctx, classe, motivo):
                return "parada"
            continue
        if env == "nao_enviada":
            falhas += 1
            logging.warning(f"Questão {numero}: mensagem não enviada ({motivo}).")
            if not dormir(min(30 * falhas, 300), heartbeat=0):
                return "parada"
            continue

        status, classe = aguardar_resposta_completa(ctx, t0)
        if status == "abortado":
            return "parada"
        if status == "bloqueio":
            if not tratar_bloqueio(ctx, classe, "durante a geração"):
                return "parada"
            continue
        if status == "timeout":
            ctx.estat("timeout")
            falhas += 1
            logging.warning(f"Questão {numero}: timeout de resposta ({falhas}/{MAX_FALHAS_POR_QUESTAO}).")
            if not nova_conversa(ctx, finalizar=False):
                return "parada"
            continue

        time.sleep(2)
        veredito, html, motivo = avaliar_resposta(ctx, numero, n_antes)
        if veredito == "ok":
            salvar_html(numero, html)
            registrar_sucesso(ctx, idx, via_dom=True)
            logging.info(f"Questão {numero} concluída com sucesso.")
            return "ok"
        if veredito == "pendente_export":
            logging.warning(f"Questão {numero}: {motivo}.")
            registrar_sucesso(ctx, idx, via_dom=False)
            return "pendente_export"
        if veredito in ("busy", "rate", "length"):
            if not tratar_bloqueio(ctx, veredito, motivo):
                return "parada"
            continue

        falhas += 1
        ctx.estat(veredito if veredito in ("invalida", "truncada", "curta") else "curta")
        logging.warning(f"Questão {numero}: resposta rejeitada ({veredito}: {motivo}). "
                        f"Tentativa {falhas}/{MAX_FALHAS_POR_QUESTAO}.")
        if html:
            guardar_rejeitada(numero, html, motivo)
        salvar_estado(ctx.estado)
        if not dormir(min(30 * falhas, 300) * (0.8 + 0.4 * random.random()), heartbeat=0):
            return "parada"
        if falhas % 3 == 0:
            if not nova_conversa(ctx, finalizar=False):
                return "parada"


# ---------------------------------------------------------------------------
# Sessão / fila
# ---------------------------------------------------------------------------
def abrir_sessao(estado, arquivos, nome_comando, nome_perguntas, headless, reinicio=False):
    driver = criar_driver(headless=headless, reinicio=reinicio)
    ctx = Ctx(driver, estado, arquivos, nome_comando, nome_perguntas, headless)
    logging.info("Acessando o site DeepSeek Chat")
    navegar(ctx, URL_DEEPSEEK)
    logging.info("Se necessário, faça login na janela do Chrome (a automação detecta sozinha).")
    if not garantir_pronto(ctx):
        return ctx
    logging.info("Chat pronto.")
    return ctx


def processar_fila(fila, estado, arquivos, nome_comando, nome_perguntas, headless):
    ctx = None
    pos = 0
    falhados = []
    quedas_seguidas = 0
    quedas_da_questao = 0
    try:
        while pos < len(fila) and not checar_comando_parada():
            idx = fila[pos]
            try:
                if ctx is None:
                    ctx = abrir_sessao(estado, arquivos, nome_comando, nome_perguntas,
                                       headless, reinicio=quedas_seguidas > 0)
                    if checar_comando_parada():
                        break
                logging.info(f"\n{'=' * 60}\nProcessando questão {idx + 1} "
                             f"({pos + 1}/{len(fila)})\n{'=' * 60}")
                res = processar_questao(ctx, idx)
                quedas_seguidas = quedas_da_questao = 0
            except NavegadorMorto as e:
                quedas_seguidas += 1
                quedas_da_questao += 1
                logging.error(f"Navegador precisa ser reiniciado: {e}")
                if ctx:
                    fechar_driver(ctx.driver)
                    ctx = None
                estado.setdefault("estatisticas", {})
                estado["estatisticas"]["reinicios_chrome"] = estado["estatisticas"].get("reinicios_chrome", 0) + 1
                salvar_estado(estado)
                if quedas_da_questao >= 5:
                    logging.error(f"Questão {idx + 1}: 5 quedas seguidas; marcando como falha.")
                    falhados.append(idx)
                    pos += 1
                    quedas_da_questao = 0
                if not dormir(min(30 * quedas_seguidas, 600), heartbeat=0):
                    break
                continue
            except Exception as e:
                quedas_seguidas += 1
                quedas_da_questao += 1
                logging.error(f"Erro inesperado na questão {idx + 1}: {e}\n{traceback.format_exc()}")
                if ctx and not driver_vivo(ctx.driver):
                    fechar_driver(ctx.driver)
                    ctx = None
                if quedas_da_questao >= 5:
                    falhados.append(idx)
                    pos += 1
                    quedas_da_questao = 0
                if not dormir(min(30 * quedas_seguidas, 600), heartbeat=0):
                    break
                continue

            if res == "parada":
                break
            if res == "falhou":
                logging.warning(f"Questão {idx + 1} falhou após {MAX_FALHAS_POR_QUESTAO} tentativas.")
                if idx not in estado["indices_falhados"]:
                    estado["indices_falhados"].append(idx)
                salvar_estado(estado)
                falhados.append(idx)
            pos += 1

            if pos >= len(fila):
                break
            try:
                if NOVA_CONVERSA_CADA and ctx.respostas_no_chat >= NOVA_CONVERSA_CADA:
                    logging.info(f"{ctx.respostas_no_chat} respostas nesta conversa; rotacionando.")
                    if not nova_conversa(ctx):
                        break
                if not pausa_entre_questoes(ctx):
                    break
            except NavegadorMorto as e:
                logging.error(f"Navegador precisa ser reiniciado: {e}")
                fechar_driver(ctx.driver)
                ctx = None
    finally:
        if ctx is not None:
            try:
                if driver_vivo(ctx.driver):
                    logging.info("Fechando a conversa atual (export final)...")
                    finalizar_chat(ctx)
            except Exception as e:
                logging.warning(f"Export final: {e}")
            fechar_driver(ctx.driver)
            logging.info("Navegador fechado")
    return falhados


def _executar_para_arquivos(indices_solicitados, opcao, arquivos,
                            nome_comando, nome_perguntas, headless):
    """Núcleo do laço de geração para UM ano (ou, no modo T/P, para o arquivo global).
    Usa os caminhos definidos em _PASTA_SAIDA_ANO / _ARQ_ESTADO_ANO (configurar_ano)."""
    estado = carregar_estado()
    if (estado and estado.get("opcao") == opcao and estado.get("forcar", False) == FORCAR
            and estado.get("indices_a_processar") == indices_solicitados
            and estado.get("banca", "") == _CURRENT_BANCA
            and estado.get("ano", "") == _CURRENT_ANO):
        logging.info(f"Retomando execução anterior: {len(estado['indices_concluidos'])} já concluídas.")
        estado.setdefault("pendentes_export", [])
    else:
        estado = novo_estado(opcao, indices_solicitados, _CURRENT_BANCA, _CURRENT_ANO)
        salvar_estado(estado)

    def pendentes():
        feitos = set(estado["indices_concluidos"])
        if not FORCAR:
            feitos |= obter_indices_ja_feitos()
        return [i for i in indices_solicitados if i not in feitos]

    fila = pendentes()
    if not fila:
        logging.info("Nada a fazer. Tudo já foi gerado. Use --forcar para regerar.")
        return 0

    logging.info(f"{len(fila)} questão(ões) na fila.")
    rodada = 0
    falhados = []
    while fila and not checar_comando_parada():
        rodada += 1
        logging.info(f"\n{'#' * 60}\nRODADA {rodada}: {len(fila)} questão(ões)\n{'#' * 60}")
        falhados = processar_fila(fila, estado, arquivos, nome_comando, nome_perguntas, headless)
        fila = [i for i in pendentes() if i in set(falhados) | set(estado["indices_falhados"])]
        if not fila or checar_comando_parada():
            break
        if MAX_RODADAS and rodada >= MAX_RODADAS:
            logging.warning("MAX_RODADAS atingido.")
            break
        logging.info(f"{len(fila)} questão(ões) falharam. Nova rodada em {COOLDOWN_RODADA_S}s.")
        estado["indices_falhados"] = []
        salvar_estado(estado)
        if not dormir(COOLDOWN_RODADA_S):
            break

    restantes = pendentes()
    print("\n" + "=" * 50)
    print("Execução encerrada" + (f" [{_CURRENT_BANCA} {_CURRENT_ANO}]" if _CURRENT_BANCA else ""))
    print(f"Concluídas: {len(estado['indices_concluidos'])}")
    print(f"Pendentes: {[i + 1 for i in restantes]}")
    print(f"Estatísticas: {estado.get('estatisticas')}")
    print("=" * 50)
    if not restantes:
        logging.info("Todas as questões foram concluídas. Limpando estado.")
        try:
            os.remove(_ARQ_ESTADO_ANO)
        except Exception:
            pass
        return 0
    return 130 if checar_comando_parada() else 2


def executar(indices, opcao, headless):
    """Wrapper para os modos T/P (usa o perguntas global em BASE)."""
    configurar_ano(None)
    arquivos = resolver_lista_anexos(ARQUIVOS_ANEXAR)
    if not arquivos:
        logging.error("Nenhum arquivo anexado. Verifique ARQUIVOS_ANEXAR.")
        sair()
    arquivo_comando = next((f for f in arquivos if "comando" in normalizar(os.path.basename(f))
                            and "resolu" in normalizar(os.path.basename(f))), None)
    arquivo_perguntas = next((f for f in arquivos
                              if os.path.basename(f).lower().startswith("perguntas")), None)
    if not arquivo_comando or not arquivo_perguntas:
        logging.error("Arquivo de comando ou de perguntas não encontrado.")
        sair()
    return _executar_para_arquivos(indices, opcao, arquivos,
                                   os.path.basename(arquivo_comando),
                                   os.path.basename(arquivo_perguntas),
                                   headless)


# ---------------------------------------------------------------------------
# MODO M — seleção de banca e progressão automática entre edições
# ---------------------------------------------------------------------------
def processar_edicao(banca, ano, headless):
    """Processa uma edição (banca + ano) do começo ao fim, retomando se houver progresso.
    Retorna True se todas as questões terminaram com HTML válido, False caso contrário."""
    ano_dir = os.path.join(EXAMS_DIR, banca, ano)
    if not os.path.isdir(ano_dir):
        logging.error(f"Pasta não encontrada: {ano_dir}")
        return False
    arquivo_perguntas = encontrar_perguntas_do_ano(ano_dir)
    if not arquivo_perguntas:
        logging.error(f"perguntas.txt ou perguntas.pdf não encontrado em {ano_dir}")
        return False

    configurar_ano(banca, ano)
    logging.info(f"Saída desta edição: {_PASTA_SAIDA_ANO}")

    arquivos_sem_perguntas = [f for f in ARQUIVOS_ANEXAR
                              if not normalizar(f).startswith("perguntas")]
    arquivos = resolver_lista_anexos(arquivos_sem_perguntas)
    if arquivo_perguntas not in arquivos:
        arquivos.append(arquivo_perguntas)

    arquivo_comando = next(
        (f for f in arquivos if "comando" in normalizar(os.path.basename(f))
         and "resolu" in normalizar(os.path.basename(f))), None)
    if not arquivo_comando:
        logging.error("Arquivo de comando não encontrado em BASE.")
        return False

    nome_comando = os.path.basename(arquivo_comando)
    nome_perguntas = os.path.basename(arquivo_perguntas)

    perguntas = carregar_perguntas(arquivo_perguntas)
    total_arquivo = len(perguntas)
    if total_arquivo == 0:
        logging.error(f"Nenhuma questão em {arquivo_perguntas}")
        return False
    total = total_arquivo
    if MAX_QUESTOES_POR_PROVA and total > MAX_QUESTOES_POR_PROVA:
        logging.warning(f"{banca} {ano}: o arquivo tem {total_arquivo} blocos; "
                        f"limitando às {MAX_QUESTOES_POR_PROVA} primeiras questões.")
        total = MAX_QUESTOES_POR_PROVA

    n_feitas, ultima, primeira_pend = resumo_edicao(total)
    if not FORCAR and n_feitas >= total:
        logging.info(f"Edição {banca} {ano} já finalizada: {n_feitas}/{total} questões geradas. "
                     f"Passando para a próxima.")
        return True

    logging.info(f"{banca} {ano}: {total} questão(ões) na prova; {n_feitas} já geradas "
                 f"(última gerada: {ultima or 'nenhuma'}); {total - n_feitas} pendentes"
                 + (f"; primeira pendente: {primeira_pend}." if primeira_pend else "."))
    logging.info("Anexos desta edição:")
    for f in arquivos:
        logging.info(f"   - {os.path.basename(f)}")

    indices = list(range(total))
    resultado = _executar_para_arquivos(indices, "M", arquivos, nome_comando, nome_perguntas, headless)

    n_feitas, ultima, primeira_pend = resumo_edicao(total)
    if n_feitas >= total:
        logging.info(f"Edição {banca} {ano} FINALIZADA: {n_feitas}/{total} questões geradas. "
                     f"Carregando a próxima edição...")
        return True
    logging.warning(f"Edição {banca} {ano} incompleta: {n_feitas}/{total} geradas "
                    f"(última: {ultima or 'nenhuma'}; primeira pendente: {primeira_pend}).")
    return resultado == 0


def modo_m_bancas(headless, banca_arg=None, max_arg=None):
    """Lista as bancas, o usuário escolhe uma, e o script percorre os anos em ordem
    decrescente (2026 → 2025 → 2024 …) processando cada edição até o fim."""
    bancas = listar_bancas()
    if not bancas:
        logging.error(f"Nenhuma banca encontrada em {EXAMS_DIR}.")
        sair()

    print("\nBancas disponíveis:")
    for i, b in enumerate(bancas, start=1):
        anos = listar_anos(b)
        preview = ", ".join(anos[:6]) + ("..." if len(anos) > 6 else "")
        print(f"  {i:2d}. {b}  ({len(anos)} edição(ões): {preview})")

    banca = None
    if banca_arg:
        if banca_arg not in bancas:
            logging.error(f"Banca '{banca_arg}' não existe. Disponíveis: {bancas}")
            sair()
        banca = banca_arg
    else:
        if not sys.stdin or not sys.stdin.isatty():
            logging.error(f"Informe --banca em modo não interativo. Bancas: {bancas}")
            sair()
        while True:
            try:
                entrada = input(f"\nEscolha a banca (1-{len(bancas)}): ").strip()
                if not entrada:
                    logging.info("Nada escolhido; saindo.")
                    return 1
                idx = int(entrada) - 1
                if 0 <= idx < len(bancas):
                    banca = bancas[idx]
                    break
                print(f"Digite um número entre 1 e {len(bancas)}.")
            except ValueError:
                print("Digite apenas números.")

    anos = listar_anos(banca)
    if not anos:
        logging.error(f"Nenhuma edição encontrada em {banca}.")
        sair()

    global MAX_QUESTOES_POR_PROVA
    if max_arg is not None:
        MAX_QUESTOES_POR_PROVA = max(0, max_arg)
    elif not AUTO and sys.stdin and sys.stdin.isatty():
        while True:
            entrada = input(f"Máximo de questões por prova [Enter = {MAX_QUESTOES_POR_PROVA}; 0 = sem limite]: ").strip()
            if not entrada:
                break
            try:
                MAX_QUESTOES_POR_PROVA = max(0, int(entrada))
                break
            except ValueError:
                print("Digite apenas números inteiros.")
    logging.info(f"Máximo de questões por prova: "
                 f"{MAX_QUESTOES_POR_PROVA if MAX_QUESTOES_POR_PROVA else 'sem limite'}")

    # Só agora (depois de todos os input()) a thread de stdin pode começar a ouvir o "S".
    iniciar_thread_stdin()

    logging.info(f"Banca selecionada: {banca}")
    logging.info(f"Edições a processar (ordem decrescente): {anos}")

    resultados = {}
    for ano in anos:
        if checar_comando_parada():
            logging.info("Parada solicitada; encerrando a progressão entre edições.")
            break
        logging.info(f"\n{'#' * 70}\nBANCA {banca} — EDIÇÃO {ano}\n{'#' * 70}")
        try:
            ok = processar_edicao(banca, ano, headless)
            resultados[ano] = ok
        except KeyboardInterrupt:
            logging.warning(f"Interrompido em {banca} {ano}.")
            break
        except NavegadorMorto as e:
            logging.error(f"Navegador caiu em {banca} {ano}: {e}")
            resultados[ano] = False
        except Exception as e:
            logging.error(f"Erro em {banca} {ano}: {e}\n{traceback.format_exc()}")
            resultados[ano] = False

    print("\n" + "=" * 60)
    print(f"Resultado para a banca {banca}:")
    for ano in anos:
        if ano in resultados:
            print(f"  {ano}: {'OK' if resultados[ano] else 'INCOMPLETO'}")
        else:
            print(f"  {ano}: NÃO PROCESSADO")
    print("=" * 60)
    return 0 if all(resultados.values()) and len(resultados) == len(anos) else 2


# ---------------------------------------------------------------------------
# CLI / main
# ---------------------------------------------------------------------------
def parse_args():
    p = argparse.ArgumentParser(description="Gera questao_N.html via DeepSeek, sem supervisão.")
    p.add_argument("--modo", choices=["T", "P", "M", "t", "p", "m"],
                   help="T=intervalo, P=específicas, M=banca (progressão automática entre edições)")
    p.add_argument("--inicio", type=int, help="(T) questão inicial")
    p.add_argument("--fim", type=int, help="(T) questão final")
    p.add_argument("--questoes", help="(P) números separados por vírgula")
    p.add_argument("--banca", help="(M) nome da banca (ex.: AMP); se omitido, pergunta")
    p.add_argument("--max-questoes", type=int, default=None,
                   help="(M) máximo de questões por prova (padrão 100; 0 = sem limite)")
    p.add_argument("--forcar", action="store_true", help="regerar questões que já têm HTML")
    p.add_argument("--auto", action="store_true", help="nunca bloquear em input()")
    p.add_argument("--headless", action="store_true", help="Chrome sem janela (só após o 1º login manual)")
    return p.parse_args()


def main():
    global AUTO, FORCAR, TAM_TEMPLATE
    args = parse_args()
    for pasta in (BASE, PASTA_SAIDA, PASTA_DOWNLOADS, PERFIL_PERSISTENTE,
                  PASTA_DRIVER, PASTA_DIAG, PASTA_REJEITADAS):
        os.makedirs(pasta, exist_ok=True)
    configurar_log()
    AUTO = args.auto or args.modo is not None or not sys.stdin.isatty()
    FORCAR = args.forcar
    signal.signal(signal.SIGINT, _handler_sinal)
    signal.signal(signal.SIGTERM, _handler_sinal)
    if os.path.exists(ARQ_PARAR):
        os.remove(ARQ_PARAR)

    for f in os.listdir(PASTA_DOWNLOADS):
        if f.endswith('.md') or f.endswith('.crdownload'):
            try:
                os.remove(os.path.join(PASTA_DOWNLOADS, f))
            except Exception:
                pass

    arquivos_base = resolver_lista_anexos(ARQUIVOS_ANEXAR)
    arquivo_perguntas_base = next(
        (f for f in arquivos_base if os.path.basename(f).lower().startswith("perguntas")), None)
    arquivo_template = next((f for f in arquivos_base
                             if "templ" in normalizar(os.path.basename(f))
                             or "tampl" in normalizar(os.path.basename(f))), None)
    if arquivo_template:
        TAM_TEMPLATE = os.path.getsize(arquivo_template)

    opcao = (args.modo or "").upper()
    if not opcao and not sys.stdin.isatty():
        logging.error("Sem terminal interativo: use --modo T --inicio N --fim M | --modo P --questoes … "
                      "| --modo M --banca AMP.")
        return 1
    if not opcao:
        print("=" * 60)
        print("OPÇÕES DE EXECUÇÃO DO SCRIPT")
        print("=" * 60)
        print("T - Resolver um intervalo de questões (arquivo perguntas global em BASE)")
        print("P - Resolver questões específicas (arquivo perguntas global em BASE)")
        print("M - Escolher uma BANCA (por número) e processar todas as edições em ordem decrescente")
        print("    (2026 → 2025 → 2024 …) — ao concluir a prova (máx. 100 questões, ajustável),")
        print("    abre nova conversa com o perguntas.txt/pdf do ano seguinte; retoma de onde parou")
        print("-" * 60)
        print("Durante o processamento, digite  S + Enter  para salvar e encerrar com segurança")
        print(f"(ou crie o arquivo {ARQ_PARAR}). Use --forcar para REGERAR questões existentes.")
        print("Para rodar sem menu: --modo M --banca AMP --auto")
        print("=" * 60)
        opcao = input("Escolha uma opção (T/P/M): ").strip().upper()

    if opcao == "M":
        return modo_m_bancas(args.headless, args.banca, args.max_questoes)

    if not arquivo_perguntas_base:
        logging.error("perguntas (qualquer extensão) não encontrada em BASE para T/P.")
        sair()

    perguntas = carregar_perguntas(arquivo_perguntas_base)
    total = len(perguntas)
    if total == 0:
        logging.error(f"Nenhuma questão em '{arquivo_perguntas_base}'.")
        sair()

    if opcao == "T":
        if args.modo:
            qi, qf = args.inicio, args.fim
        else:
            while True:
                try:
                    qi = int(input("Número da questão inicial: ").strip())
                    qf = int(input("Número da questão final: ").strip())
                except ValueError:
                    print("Digite apenas números inteiros.")
                    continue
                if not (1 <= qi <= total and 1 <= qf <= total):
                    print(f"As questões devem estar entre 1 e {total}.")
                    continue
                if qi > qf:
                    print("A inicial não pode ser maior que a final.")
                    continue
                break
        if qi is None or qf is None or not (1 <= qi <= qf <= total):
            logging.error(f"Intervalo inválido (use --inicio e --fim entre 1 e {total}).")
            sair()
        indices = list(range(qi - 1, qf))
        logging.info(f"Opção T: processando da questão {qi} até a {qf}.")
    elif opcao == "P":
        if args.modo:
            try:
                qs = [int(x.strip()) for x in (args.questoes or "").split(",") if x.strip()]
            except ValueError:
                qs = []
        else:
            while True:
                try:
                    qs = [int(x.strip()) for x in input("Números separados por vírgula: ").split(",") if x.strip()]
                    if qs and all(1 <= q <= total for q in qs):
                        break
                    print(f"Questões devem estar entre 1 e {total}.")
                except ValueError:
                    print("Digite apenas números inteiros.")
        if not qs or not all(1 <= q <= total for q in qs):
            logging.error(f"--questoes inválido (valores entre 1 e {total}).")
            sair()
        indices = sorted(set(q - 1 for q in qs))
        logging.info(f"Processando: {[i + 1 for i in indices]}")
    else:
        logging.error("Opção inválida. Use T, P ou M.")
        sair()

    iniciar_thread_stdin()
    try:
        return executar(indices, opcao, args.headless)
    except KeyboardInterrupt:
        logging.warning("Interrompido à força. O progresso está em progresso.json; rode de novo para retomar.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
