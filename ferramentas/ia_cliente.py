"""
Cliente da API de IA (formato OpenAI /chat/completions, usado pelo DeepSeek) com:
  - novas tentativas automáticas em erro de rede, 429 e 5xx;
  - leitura robusta de JSON na resposta;
  - contagem de custo por chamada e teto de orçamento por execução;
  - detecção do horário de pico (preço dobrado) e espera opcional.
Só usa a biblioteca padrão do Python (nada para instalar).
"""
import datetime as dt
import json
import os
import random
import re
import time
import urllib.error
import urllib.request


class OrcamentoEsgotado(Exception):
    pass


class ErroAPI(Exception):
    pass


class RespostaCortada(ErroAPI):
    """A resposta passou do limite de tamanho (max_tokens). Quem chamou pode dividir o pedido."""
    pass


def _minutos(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def em_horario_de_pico(config, agora=None):
    agora = agora or dt.datetime.now(dt.timezone.utc)
    if agora.weekday() >= 5:
        return False, None
    m = agora.hour * 60 + agora.minute
    for ini, fim in config.get("pico_utc_dias_uteis", []):
        if _minutos(ini) <= m < _minutos(fim):
            return True, agora.replace(hour=_minutos(fim) // 60, minute=_minutos(fim) % 60, second=0, microsecond=0)
    return False, None


def esperar_fora_do_pico(config, log=print):
    pico, fim = em_horario_de_pico(config)
    if pico and config.get("esperar_fora_do_pico", True):
        espera = max(0, (fim - dt.datetime.now(dt.timezone.utc)).total_seconds()) + 30
        log(f"Horário de pico da API (preço dobrado). Aguardando até {fim:%H:%M} UTC "
            f"(~{int(espera // 60)} min); as chamadas só são feitas fora do pico.")
        time.sleep(espera)


def extrair_json(texto):
    """Aceita JSON puro ou cercado por ```json ... ```; devolve dict ou levanta ValueError."""
    t = (texto or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        i, j = t.find("{"), t.rfind("}")
        if i >= 0 and j > i:
            return json.loads(t[i:j + 1])
        raise ValueError("a resposta não contém um objeto JSON")


def explicar_http(codigo, detalhe):
    dicas = {
        401: "a chave da API foi recusada. Confira o secret DEEPSEEK_API_KEY (sem espaços, começando com sk-).",
        402: "a conta da API está sem saldo. Coloque crédito em platform.deepseek.com.",
        403: "a chave não tem permissão para este recurso.",
        404: "endereço ou modelo inexistente. Rode 'gerar_correcoes.py modelos' e ajuste config_gerador.json.",
        400: "pedido recusado (muitas vezes, nome de modelo ou parâmetro inválido em config_gerador.json).",
        422: "parâmetro inválido em config_gerador.json.",
    }
    return f"HTTP {codigo}: {dicas.get(codigo, '')} Resposta da API: {detalhe}"


class Contador:
    """Soma tokens e custo de todas as chamadas da execução."""
    def __init__(self, config, orcamento_usd):
        self.config, self.orcamento = config, orcamento_usd
        self.custo, self.chamadas = 0.0, 0
        self.tokens = {"entrada_cache": 0, "entrada": 0, "saida": 0}

    def registrar(self, modelo, uso):
        precos = self.config.get("precos_usd_por_milhao_fora_do_pico", {}).get(modelo)
        hit = uso.get("prompt_cache_hit_tokens", 0) or 0
        miss = uso.get("prompt_cache_miss_tokens")
        if miss is None:
            miss = max(0, (uso.get("prompt_tokens", 0) or 0) - hit)
        out = uso.get("completion_tokens", 0) or 0
        self.tokens["entrada_cache"] += hit; self.tokens["entrada"] += miss; self.tokens["saida"] += out
        self.chamadas += 1
        if precos:
            mult = self.config.get("multiplicador_no_pico", 2.0) if em_horario_de_pico(self.config)[0] else 1.0
            self.custo += mult * (hit * precos["entrada_cache"] + miss * precos["entrada"] + out * precos["saida"]) / 1e6
        return self.custo

    def checar(self):
        if self.orcamento and self.custo >= self.orcamento:
            raise OrcamentoEsgotado(f"orçamento da execução atingido (US$ {self.custo:.4f} de US$ {self.orcamento:.2f})")

    def resumo(self):
        t = self.tokens
        return (f"{self.chamadas} chamadas | tokens: {t['entrada']:,} entrada + {t['entrada_cache']:,} em cache + "
                f"{t['saida']:,} saída | custo estimado: US$ {self.custo:.4f}").replace(",", ".")


class ClienteAPI:
    def __init__(self, config, contador, log=print):
        api = config["api"]
        self.url = api["url_base"].rstrip("/") + "/chat/completions"
        self.url_modelos = api["url_base"].rstrip("/") + "/models"
        self.chave = os.environ.get(api.get("variavel_da_chave", "DEEPSEEK_API_KEY"), "").strip()
        if not self.chave:
            raise ErroAPI(f"defina a chave da API na variável de ambiente {api.get('variavel_da_chave')}")
        self.timeout, self.tentativas = api.get("tempo_limite_s", 600), api.get("tentativas", 5)
        self.config, self.contador, self.log = config, contador, log

    def _post(self, corpo):
        req = urllib.request.Request(self.url, data=json.dumps(corpo).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json",
                                              "Authorization": f"Bearer {self.chave}"})
        ultimo = None
        for n in range(1, self.tentativas + 1):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                detalhe = e.read().decode("utf-8", "replace")[:300]
                if e.code in (400, 401, 402, 403, 404, 422):
                    raise ErroAPI(explicar_http(e.code, detalhe))   # erro de configuração: não adianta repetir
                ultimo = f"HTTP {e.code}: {detalhe}"
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                ultimo = str(e)
            espera = min(300, 10 * 2 ** (n - 1)) * (0.8 + 0.4 * random.random())
            self.log(f"   API falhou ({ultimo}); nova tentativa {n + 1}/{self.tentativas} em {int(espera)} s")
            time.sleep(espera)
        raise ErroAPI(f"API indisponível após {self.tentativas} tentativas: {ultimo}")

    def json(self, etapa, sistema, usuario):
        """Chama o modelo da etapa e devolve o JSON da resposta (com uma nova tentativa se vier inválido).
        O orçamento NÃO é conferido aqui: ele só impede começar uma questão nova (o gerador confere entre
        questões); uma questão começada é sempre terminada. Resposta cortada pelo limite de tamanho é pedida de
        novo com um limite maior e, se ainda assim for cortada, sem o raciocínio estendido."""
        base = self.config.get("max_tokens", {}).get(etapa, 4000)
        teto = self.config.get("max_tokens_teto", 32000)
        planos = [(base, None)]
        if min(base * 2, teto) > base:
            planos.append((min(base * 2, teto), None))
        if self.config.get("raciocinio_por_etapa", {}).get(etapa):
            planos.append((min(base * 2, teto), False))          # sem raciocínio estendido
        ultimo = None
        for n, (limite, raciocinio) in enumerate(planos):
            try:
                return self._json_uma_vez(etapa, sistema, usuario, limite, raciocinio)
            except RespostaCortada as e:
                ultimo = e
                if n + 1 < len(planos):
                    prox = planos[n + 1]
                    self.log(f"   aviso: resposta cortada na etapa '{etapa}' ({limite} tokens); repetindo com "
                             f"{prox[0]} tokens" + (" e sem raciocínio estendido" if prox[1] is False else ""))
            except ErroAPI as e:
                if limite != base and ("HTTP 400" in str(e) or "HTTP 422" in str(e)):
                    self.log(f"   aviso: a API não aceitou {limite} tokens na etapa '{etapa}'; tentando outra forma")
                    ultimo = e; continue
                raise
        raise ultimo

    def _json_uma_vez(self, etapa, sistema, usuario, limite, raciocinio_forcado=None):
        esperar_fora_do_pico(self.config, self.log)      # nenhuma chamada paga é feita no horário de pico
        modelo = self.config["modelos"][etapa]
        corpo = {"model": modelo, "temperature": 0.2,
                 "max_tokens": limite,
                 "response_format": {"type": "json_object"},
                 "messages": [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}]}
        corpo.update(self.config.get("parametros_extras_por_modelo", {}).get(modelo, {}))
        raciocinio = self.config.get("raciocinio_por_etapa", {}).get(etapa)
        if raciocinio_forcado is not None:
            raciocinio = raciocinio_forcado
        extra_rac = {}
        if raciocinio is not None and modelo not in getattr(self, "_sem_param_raciocinio", set()):
            extra_rac = self.config.get("parametro_raciocinio", {}).get("ligado" if raciocinio else "desligado", {})
            corpo.update(extra_rac)
        for tentativa in (1, 2):
            try:
                r = self._post(corpo)
            except ErroAPI as e:
                # a API não reconheceu o parâmetro de raciocínio: repete sem ele (e não usa mais nesta execução)
                if extra_rac and "HTTP 400" in str(e) or (extra_rac and "HTTP 422" in str(e)):
                    self.log(f"   aviso: a API recusou o parâmetro de raciocínio ({list(extra_rac)}); seguindo sem ele")
                    self._sem_param_raciocinio = getattr(self, "_sem_param_raciocinio", set()) | {modelo}
                    for k in extra_rac:
                        corpo.pop(k, None)
                    extra_rac = {}
                    r = self._post(corpo)
                else:
                    raise
            self.contador.registrar(modelo, r.get("usage", {}) or {})
            escolha = (r.get("choices") or [{}])[0]
            texto = (escolha.get("message") or {}).get("content", "")
            if escolha.get("finish_reason") == "length":
                det = (r.get("usage") or {}).get("completion_tokens_details") or {}
                rac = f"; {det.get('reasoning_tokens')} deles de raciocínio" if det.get("reasoning_tokens") else ""
                raise RespostaCortada(f"resposta cortada por limite de tamanho na etapa '{etapa}' "
                                      f"({corpo['max_tokens']} tokens{rac}). Aumente max_tokens.{etapa} em config_gerador.json")
            try:
                return extrair_json(texto)
            except ValueError:
                if tentativa == 2:
                    raise ErroAPI(f"a IA não devolveu JSON válido na etapa '{etapa}'")
                corpo["messages"].append({"role": "assistant", "content": texto[:2000]})
                corpo["messages"].append({"role": "user", "content": "Responda novamente APENAS com o objeto JSON válido."})

    def listar_modelos(self):
        req = urllib.request.Request(self.url_modelos, headers={"Authorization": f"Bearer {self.chave}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return [m.get("id") for m in json.loads(r.read().decode("utf-8")).get("data", [])]
        except urllib.error.HTTPError as e:
            raise ErroAPI(explicar_http(e.code, e.read().decode("utf-8", "replace")[:300]))
        except (urllib.error.URLError, TimeoutError) as e:
            raise ErroAPI(f"sem conexão com a API ({e})")

    def testar(self, etapas):
        """Confere chave e nomes de modelo antes de gastar qualquer coisa."""
        disponiveis = self.listar_modelos()
        usados = sorted({self.config["modelos"][e] for e in etapas})
        faltam = [m for m in usados if m not in disponiveis]
        if faltam:
            raise ErroAPI(f"o(s) modelo(s) {faltam} de config_gerador.json não existe(m) na sua conta. "
                          f"Disponíveis: {disponiveis}. Troque em ferramentas/config_gerador.json "
                          f"(seções \"modelos\" e \"precos_usd_por_milhao_fora_do_pico\").")
        semprecos = [m for m in usados if m not in self.config.get("precos_usd_por_milhao_fora_do_pico", {})]
        if semprecos:
            self.log(f"AVISO: sem preço cadastrado para {semprecos}; o custo e o teto de orçamento não funcionam "
                     f"para eles. Cadastre em precos_usd_por_milhao_fora_do_pico.")
        self.log(f"Conexão com a API OK. Modelos usados: {usados}.")
