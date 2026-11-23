TAREFA: ATRIBUIR_TEMAS

Você recebe a lista fixa de temas de uma disciplina (numerada) e algumas questões dessa disciplina, cada uma com
o resumo, os temas do catálogo, a resposta oficial e o início do enunciado. Para CADA questão, escolha o número
do tema da lista em que ela melhor se encaixa, pelo assunto que a questão cobra de fato (a resposta oficial
mostra o que é cobrado).

Regras:
- Uma entrada para cada questão recebida, com o id exatamente igual.
- Use só números da lista. Use o tema "Outros…" apenas se nenhum outro servir.

Responda somente com JSON: {"atribuicoes": [{"id": "<id>", "tema": <número>}]}
