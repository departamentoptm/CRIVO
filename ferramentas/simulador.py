"""
Cliente FALSO da API, para testar o fluxo do gerador sem chave e sem custo (opção --simular).
As respostas são textos de teste, não correções reais: nunca publique o resultado de uma simulação.
Variável CRIVO_SIMULAR_REPROVAR=1 faz o "revisor" reprovar tudo (testa o caminho de reprovação).
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
        self.contador.registrar(self.config["modelos"][etapa], uso)

    def json(self, etapa, sistema, usuario):
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
        return {"alternativa": "A", "confianca": 0.5, "justificativa": "simulação"}

    def _gerar(self, u):
        g = re.search(r"GABARITO OFICIAL: alternativa ([A-E])", u)
        g = g.group(1) if g else "A"
        letras = re.findall(r"^([A-E])\) ", u, re.M) or list("ABCDE")
        p = f"<p>{PREENCHIMENTO}</p>"
        secoes = {f"2.{k}": p for k in range(1, 15)}
        secoes["2.3"] = f"<p>A alternativa {g} é a correta. {PREENCHIMENTO}</p>"
        secoes["2.4"] = "".join(f"<p><strong>Alternativa {l}</strong> - {PREENCHIMENTO}</p>" for l in letras)
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

    def _verificar(self, u):
        if os.environ.get("CRIVO_SIMULAR_REPROVAR") == "1":
            return {"aprovado": False, "problemas": [{"secao": "2.3", "trecho": "x", "gravidade": "grave",
                                                      "explicacao": "erro simulado", "correcao_sugerida": "y"}]}
        return {"aprovado": True, "problemas": [{"secao": "2.5", "trecho": "x", "gravidade": "leve",
                                                 "explicacao": "observação simulada", "correcao_sugerida": ""}]}
