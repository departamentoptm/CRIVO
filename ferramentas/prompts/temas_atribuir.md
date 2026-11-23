TAREFA: ATRIBUIR_TEMAS

Você recebe a lista fixa de temas de uma disciplina (numerada) e algumas questões dessa disciplina, cada uma com
o resumo, os temas do catálogo, a resposta oficial e o início do enunciado. Para CADA questão, escolha o número
do tema da lista em que ela melhor se encaixa, pelo assunto que a questão cobra de fato (a resposta oficial
mostra o que é cobrado).

Regras:
- Uma entrada para cada questão recebida, com o id exatamente igual.
- Use os números da lista sempre que algum tema servir, mesmo que não seja perfeito.
- Só se o assunto não couber em NENHUM tema (assunto novo na disciplina), use "novo_tema" com o nome de um tema
  novo, com o mesmo nível de generalidade dos temas da lista (um grande assunto, não um detalhe). Use o mesmo
  nome para questões do mesmo assunto novo.

Responda somente com JSON:
{"atribuicoes": [{"id": "<id>", "tema": <número>}, {"id": "<id>", "novo_tema": "<nome>"}]}
