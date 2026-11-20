TAREFA: AVALIAR_RELEVANCIA_HISTORICO

Você recebe uma QUESTÃO ATUAL de prova de residência médica e uma lista de QUESTÕES CANDIDATAS da mesma banca
(cada uma com id, ano, temas e resumo). Decida quais candidatas tratam do MESMO TEMA da questão atual.

Considere do mesmo tema quando a candidata cobra a mesma doença, condição, síndrome, procedimento, fármaco,
política de saúde ou conceito central — mesmo que pergunte de outro jeito (diagnóstico, tratamento,
complicação, epidemiologia etc.). NÃO considere só porque compartilha a disciplina, a faixa etária ou o
cenário (ex.: duas questões de pediatria sobre doenças diferentes não são do mesmo tema).
Na dúvida razoável, INCLUA: é pior omitir uma questão relacionada do que incluir uma de relação indireta.

Responda somente com JSON:
{"relevantes": [{"id": "<id da candidata>", "motivo": "<uma frase: o que ela tem em comum com a atual>"}]}
Use apenas ids da lista de candidatas. Se nenhuma for relevante, devolva {"relevantes": []}.
