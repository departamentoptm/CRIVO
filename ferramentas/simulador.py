"""
Cliente FALSO da API, para testar o fluxo do gerador sem chave e sem custo (opção --simular).
As respostas são textos de teste, não correções reais: nunca publique o resultado de uma simulação.
Variável CRIVO_SIMULAR_REPROVAR=1 faz o "revisor" reprovar tudo (testa o caminho de reprovação);
=uma faz reprovar só a primeira verificação de cada questão (testa a correção só das seções apontadas).
CRIVO_SIMULAR_REPETIR=1 faz a conferência achar o mesmo erro em outra seção (testa refazer a correção inteira).
CRIVO_SIMULAR_PREMISSA=recusar faz o revisor recusar a premissa (testa a premissa corrigida).
CRIVO_SIMULAR_SEM_CORRETA=1 faz a geração esquecer a alternativa correta na 2.4 (testa o pedido só do parágrafo).
CRIVO_SIMULAR_CONTESTAR=autor|revisor faz o autor contestar a 1ª objeção e o árbitro dar razão a quem foi indicado
(use com CRIVO_SIMULAR_REPROVAR=uma). CRIVO_SIMULAR_CONTRADIZ=autor|revisor faz o revisor apontar uma objeção que
contradiz o gabarito, decidida pelo árbitro a favor de quem foi indicado.
CRIVO_SIMULAR_ARBITRO_QUEBRA=1 faz o árbitro decidir contra a tabela de afirmativas do gabarito (deve ser descartado).
CRIVO_SIMULAR_MUDA=1 faz o revisor apontar uma objeção que mudaria uma afirmativa (deve ir ao árbitro).
CRIVO_SIMULAR_AFIRMATIVAS=errada faz a conferência final das afirmativas achar divergência uma vez.
"""
import os
import re

PREENCHIMENTO = ("Texto de teste gerado pelo simulador, sem valor médico. " * 12).strip()


class ClienteSimulado:
    def __init__(self, config, contador):
        self.config, self.contador = config, contador

    def _uso(self, etapa, usuario, saida):
        uso = {"prompt_cache_hit_tokens": 800, "prompt_cache_miss_tokens": len(usuario) // 3,
               "completion_tokens": len(saida) // 3}
        self.contador.registrar(self.config["modelos"][etapa], uso, etapa)

    def json(self, etapa, sistema, usuario, raciocinio=None):
        m = re.search(r"VERDADEIRAS são: ([^;]+);", usuario)
        if m:
            self._verdadeiras = [] if m.group(1).strip() == "nenhuma" else [x.strip() for x in m.group(1).split(",")]
        if "TAREFA: CONFERIR_AFIRMATIVAS" in sistema:
            certas = list(getattr(self, "_verdadeiras", []))
            if os.environ.get("CRIVO_SIMULAR_AFIRMATIVAS") == "errada" and not getattr(self, "_afirm_errou", False):
                self._afirm_errou = True
                certas = certas[:-1]
            r = {"verdadeiras": certas, "contraditorias": []}
            self._uso(etapa, usuario, str(r))
            return r
        if "TAREFA: CONSULTAS_DE_BUSCA" in sistema:
            r = {"consultas": ["conduta simulada diretriz Ministério da Saúde", "conduta simulada sociedade brasileira"]}
        elif "TAREFA: LISTA_DE_TEMAS" in sistema:
            r = {"temas": [f"Tema simulado {k}" for k in range(1, 7)]}
        elif "TAREFA: ATRIBUIR_TEMAS" in sistema:
            ids = re.findall(r"^### (\S+)$", usuario, re.M)
            r = {"atribuicoes": [{"id": i, "tema": 1, "sem_encaixe": True, "assunto": "assunto simulado"} if k == 0 else {"id": i, "tema": k % 6 + 1}
                                for k, i in enumerate(ids)]}
        elif "TAREFA: PREMISSA_DO_GABARITO" in sistema:
            r = {"raciocinio_da_banca": "premissa simulada", "por_que_o_gabarito": "simulado",
                 "por_que_nao_a_alternativa_cega": "simulado", "mudanca_de_diretriz": None}
        elif "TAREFA: CONSULTAS_DE_DISPUTA" in sistema:
            r = {"consultas": ["ponto em disputa simulado definição", "simulated dispute definition"]}
        elif "TAREFA: ARBITRAR" in sistema:
            quem = os.environ.get("CRIVO_SIMULAR_CONTESTAR") or os.environ.get("CRIVO_SIMULAR_CONTRADIZ") or "revisor"
            certas = list(getattr(self, "_verdadeiras", []))
            if os.environ.get("CRIVO_SIMULAR_ARBITRO_QUEBRA") == "1":
                certas = certas[:-1]
            r = {"vencedor": quem, "decisao": f"decisão simulada a favor do {quem} [W1]", "afirmativas_verdadeiras": certas}
        elif "TAREFA: CONFERIR_PREMISSA" in sistema:
            recusar = os.environ.get("CRIVO_SIMULAR_PREMISSA") == "recusar"
            r = {"correta": not recusar, "problema": "premissa simulada recusada" if recusar else "",
                 "premissa_corrigida": {"raciocinio_da_banca": "premissa corrigida simulada"} if recusar else None}
        else:
            r = getattr(self, "_" + etapa)(usuario)
        self._uso(etapa, usuario, str(r))
        return r

    def _temas(self, u):
        out = []
        for qid, corpo in re.findall(r"### id: (\S+)\n(.*?)(?=\n### id: |\Z)", u, re.S):
            palavras = [w.lower() for w in re.findall(r"[A-Za-zÀ-ÿ]{9,}", corpo)][:3] or ["geral"]
            out.append({"id": qid, "temas": palavras, "resumo": "resumo simulado: " + " ".join(palavras),
                        "abordagem": "outro", "disciplina": "Pediatria"})
        return {"questoes": out}

    def _relevancia(self, u):
        ids = re.findall(r"^(\S+-\d{4}-Q\d+) \|", u, re.M)
        tipos = ["mesmo_tema", "tema_relacionado", "caso_semelhante"]
        return {"relacionadas": [{"id": i, "tipo": tipos[k % 3], "motivo": "relação simulada"} for k, i in enumerate(ids[:5])]}

    def _resolver_as_cegas(self, u):
        return {"alternativa": "A", "confianca": 0.9, "justificativa": "simulação"}

    def _gerar(self, u):
        g = re.search(r"GABARITO OFICIAL: alternativa ([A-E])", u)
        g = g.group(1) if g else "A"
        falta = re.search(r"ALTERNATIVAS QUE FALTAM NA SEÇÃO 2\.4: ([A-E, ]+)", u)
        if falta:
            return {"paragrafos": {l: f"<p><strong>Alternativa {l} — {'Correta' if l == g else 'Errada'}.</strong> {PREENCHIMENTO}</p>"
                                   for l in re.findall(r"[A-E]", falta.group(1))}}
        if "PROBLEMAS APONTADOS PELO REVISOR" in u:
            r = {"secoes": {"2.3": f"<p>A alternativa {g} é a correta (seção corrigida). {PREENCHIMENTO}</p>"}}
            if (os.environ.get("CRIVO_SIMULAR_CONTESTAR") and "CONFIRMADOS POR UM ÁRBITRO" not in u
                    and "PONTOS JÁ DECIDIDOS" not in u):
                r = {"secoes": {}, "contestacoes": [{"indice": 0, "justificativa": "contestação simulada (livro-texto X)"}]}
            return r
        letras = re.findall(r"^([A-E])\) ", u, re.M) or list("ABCDE")
        p = f"<p>{PREENCHIMENTO}</p>"
        secoes = {f"2.{k}": p for k in range(1, 15)}
        secoes["2.3"] = f"<p>A alternativa {g} é a correta. {PREENCHIMENTO}</p>"
        sem = os.environ.get("CRIVO_SIMULAR_SEM_CORRETA") == "1"
        secoes["2.4"] = "".join(f"<p><strong>Alternativa {l}</strong> - {PREENCHIMENTO}</p>" for l in letras if not (sem and l == g))
        secoes["2.8"] = ("<table class=\"data-table\"><thead><tr><th>Condição</th><th>Sinais</th><th>Exame</th>"
                         f"<th>Conduta</th></tr></thead><tbody><tr><td>X</td><td>{PREENCHIMENTO}</td><td>y</td>"
                         "<td>z</td></tr></tbody></table>")
        return {"tema": "Pediatria: tema simulado", "aviso_diretriz": None, "secoes": secoes,
                "referencias": {"livros": [{"fonte": "Nelson — Tratado de Pediatria", "secao": "Capítulo 45, p. 300 — tema"},
                                           {"fonte": "Livro inventado", "secao": "deve ser descartado"}],
                                "busca_pubmed": "hemophilia children"},
                "afirmacoes_criticas": ["afirmação simulada"]}

    def _reparar(self, u):
        corpo = u.split("\n\n", 1)[1] if "\n\n" in u else u
        enun, alts, atual = [], {}, None
        for l in corpo.split("\n"):
            m = re.match(r"\s*(?:alternativa\s+)?\(?([A-E])\)?\s*[:).\-]\s*(.*)$", l, re.I)
            if m and len(alts) < 5 and m.group(1).upper() == "ABCDE"[len(alts)]:
                atual = m.group(1).upper(); alts[atual] = m.group(2); continue
            if atual: alts[atual] += " " + l
            else: enun.append(l)
        if os.environ.get("CRIVO_SIMULAR_ALTERAR") == "1":
            alts["A"] = alts.get("A", "") + " palavra inventada"
        return {"enunciado": "\n".join(enun), "alternativas": alts}

    def buscar(self, consulta, quantidade=5):
        self.contador.registrar_busca()
        epoca = "before:" in consulta
        return [{"titulo": f"Documento simulado {'antigo' if epoca else 'atual'} {k}", "url": f"https://exemplo.gov.br/{abs(hash(consulta)) % 9999}/{k}",
                 "site": "exemplo.gov.br", "data": "2019-05-01" if epoca else "2024-03-01",
                 "resumo": "Resumo simulado de diretriz, sem valor médico.", "autoridade": 4 - k, "relevancia": 2.0}
                for k in range(min(quantidade, 3))]

    def _conferir(self, u):
        n = len(re.findall(r"^\[\d+\] seção", u, re.M))
        if os.environ.get("CRIVO_SIMULAR_REPETIR") == "1" and not getattr(self, "_repetiu", False):
            self._repetiu = True        # testa: o mesmo erro reaparece em outra seção -> refaz a correção inteira
            return {"resolvidos": [{"indice": k, "resolvido": True, "comentario": "simulado"} for k in range(n)],
                    "problemas": [{"secao": "2.7", "secoes_com_o_mesmo_erro": ["2.8"], "mesmo_erro_de": 0, "trecho": "x",
                                   "gravidade": "moderada", "explicacao": "mesmo erro simulado em outra seção"}]}
        return {"resolvidos": [{"indice": k, "resolvido": True, "comentario": "simulado"} for k in range(n)], "problemas": []}

    def _verificar(self, u):
        modo = os.environ.get("CRIVO_SIMULAR_REPROVAR")
        if modo == "uma":
            qid = re.search(r"^Questão (\d+) — (\S+) (\S+)", u, re.M)
            chave = qid.group(0) if qid else u[:80]
            self._ja_reprovou = getattr(self, "_ja_reprovou", set())
            if chave not in self._ja_reprovou:
                self._ja_reprovou.add(chave)
                modo = "1"
        if modo == "1":
            return {"aprovado": False, "problemas": [{"secao": "2.3", "trecho": "x", "gravidade": "grave",
                                                      "explicacao": "erro simulado", "correcao_sugerida": "y"}]}
        if os.environ.get("CRIVO_SIMULAR_MUDA") == "1" and "PONTOS JÁ DECIDIDOS" not in u:
            return {"aprovado": False, "problemas": [{"secao": "2.3", "trecho": "x", "gravidade": "grave", "afirmativas_que_mudam": ["3"],
                                                      "explicacao": "objeção simulada que muda a afirmativa 3", "correcao_sugerida": "y"}]}
        if os.environ.get("CRIVO_SIMULAR_CONTRADIZ") and "PONTOS JÁ DECIDIDOS" not in u:
            return {"aprovado": False, "problemas": [{"secao": "2.4", "trecho": "x", "gravidade": "grave", "contradiz_gabarito": True,
                                                      "explicacao": "objeção simulada contrária ao gabarito", "correcao_sugerida": "y"}]}
        return {"aprovado": True, "problemas": [{"secao": "2.5", "trecho": "x", "gravidade": "leve",
                                                 "explicacao": "observação simulada", "correcao_sugerida": ""}]}
