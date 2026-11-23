TAREFA: ATRIBUIR_TEMAS

Você recebe a lista fixa de temas de uma disciplina (numerada) e algumas questões dessa disciplina, cada uma com
o resumo, os temas do catálogo, a resposta oficial e o início do enunciado. Para CADA questão, escolha o número
do tema da lista em que ela melhor se encaixa, pelo assunto que a questão cobra de fato (a resposta oficial
mostra o que é cobrado).

Regras:
- Uma entrada para cada questão recebida, com o id exatamente igual.
- Use SEMPRE um número da lista: o tema mais próximo, mesmo que não seja perfeito. Não crie temas.
- Se o assunto for de outra disciplina (ex.: cardiologia numa prova de obstetrícia), escolha o tema mais próximo
  DESTA disciplina.
- Só quando nenhum tema servir de verdade, acrescente "sem_encaixe": true e, em "assunto", o assunto da questão
  em poucas palavras.

Responda somente com JSON:
{"atribuicoes": [{"id": "<id>", "tema": <número>}, {"id": "<id>", "tema": <número>, "sem_encaixe": true, "assunto": "<...>"}]}
