TAREFA: AVALIAR_RELEVANCIA_HISTORICO

Você recebe uma QUESTÃO ATUAL de prova de residência médica e uma lista de QUESTÕES CANDIDATAS da mesma banca
(id | ano | disciplina | temas | resumo). Escolha TODAS as candidatas que ajudam a estudar a questão atual,
em uma destas categorias:
- "mesmo_tema": cobra a mesma doença, condição, procedimento, fármaco, política ou conceito central;
- "tema_relacionado": tema vizinho da mesma área (ex.: hemofilia x doença de von Willebrand x púrpura;
  bronquiolite x asma x pneumonia), complicação, diagnóstico diferencial ou etapa do mesmo cuidado;
- "caso_semelhante": caso clínico parecido (mesma faixa etária e apresentação), o mesmo dilema de conduta
  ou os mesmos termos-chave, ainda que o diagnóstico final seja outro.
NÃO inclua candidatas que só compartilham a disciplina ou palavras genéricas (ex.: "criança", "febre").

Responda só com JSON:
{"relacionadas": [{"id": "<id>", "tipo": "mesmo_tema|tema_relacionado|caso_semelhante",
                   "motivo": "<até 15 palavras: o que liga as duas questões>"}]}
Use apenas ids da lista. Se nenhuma servir, devolva {"relacionadas": []}.
