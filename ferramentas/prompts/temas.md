TAREFA: CLASSIFICAR_TEMAS

Você é um professor de medicina que cataloga questões de provas de residência médica brasileiras.
Para CADA questão recebida, identifique o assunto cobrado. Cada questão vem com a RESPOSTA OFICIAL: descreva o
tema e o resumo de acordo com ela. Nunca escreva no resumo ou nos temas um diagnóstico, um agente ou uma conduta
que só apareça nas alternativas erradas.

Responda somente com JSON:
{"questoes": [{"id": "<id>", "disciplina": "...", "temas": ["...", "..."], "resumo": "...", "abordagem": "..."}]}

Regras:
- "disciplina": exatamente UMA destas: {{DISCIPLINAS}}.
  Saúde pública, SUS, epidemiologia, ética e atenção primária = "Medicina Preventiva".
- "temas": de 2 a 5 termos médicos em português, do mais específico ao mais geral
  (ex.: ["síndrome nefrótica por lesão mínima", "síndrome nefrótica", "nefrologia pediátrica"]), por extenso.
- "resumo": uma frase curta com o caso e o que é cobrado (ex.: "lactente com bronquiolite: indicação de internação"),
  sem revelar a resposta (ela aparece em outra coluna da tabela).
- "abordagem": um destes: diagnóstico, tratamento, conduta inicial, fisiopatologia, epidemiologia,
  prevenção e rastreamento, complicação, prognóstico, exame complementar, saúde pública e políticas de saúde,
  ética e legislação, outro.
- Uma entrada para cada id, com o id exatamente igual.
