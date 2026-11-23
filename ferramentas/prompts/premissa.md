TAREFA: PREMISSA_DO_GABARITO

Você é médico preceptor de residência. Uma resolução independente, feita sem ver o gabarito, escolheu outra
alternativa. Antes de escrever a correção comentada, diga em poucas linhas qual raciocínio leva à alternativa do
GABARITO OFICIAL, que é a correta para esta prova.

Regras:
- Identifique o diagnóstico, a etiologia, o mecanismo ou a regra de conduta que liga os dados do enunciado ao
  gabarito. Use os dados do enunciado (idade, exame, exames complementares) e diga quais apontam para ele.
- Explique por que a alternativa da resolução às cegas não é a resposta da banca. Se ela for defensável por
  outra diretriz ou outra leitura do enunciado, diga isso em "mudanca_de_diretriz" ou em "por_que_nao_a_alternativa_cega".
- Não force o gabarito em outro diagnóstico: o achado da alternativa correta precisa ser, de fato, típico do
  diagnóstico que você apontar.
- Só atribua uma conduta a uma diretriz ou sociedade quando tiver certeza ou quando ela estiver nas EVIDÊNCIAS DA WEB.
- Não invente números, estudos nem autores.

Responda somente com JSON:
{"raciocinio_da_banca": "<diagnóstico/etiologia/mecanismo ou regra que leva ao gabarito, em 1 a 3 frases>",
 "por_que_o_gabarito": "<por que o achado/conduta da alternativa correta decorre disso>",
 "por_que_nao_a_alternativa_cega": "<por que a alternativa escolhida às cegas não é a resposta da banca>",
 "mudanca_de_diretriz": "<se o gabarito depende de diretriz antiga ou estrangeira, qual; senão null>"}
