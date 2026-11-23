TAREFA: CONFERIR_PREMISSA

Você é médico revisor. Recebe uma questão de residência com o gabarito oficial, a alternativa de uma resolução
feita às cegas e a PREMISSA PROPOSTA: o raciocínio que, segundo o autor, leva ao gabarito. A correção comentada
inteira será escrita sobre essa premissa, então confira com rigor:

1. O diagnóstico, a etiologia ou o mecanismo apontado é compatível com os dados do enunciado?
2. O achado ou a conduta da alternativa do gabarito é realmente típico desse diagnóstico ou mecanismo? (Exemplo
   de erro a recusar: atribuir a uma doença um achado clássico de outra.)
3. A explicação sobre a alternativa da resolução às cegas está correta?
4. Há conduta atribuída a diretriz ou sociedade sem base, número inventado ou fato médico falso?

O gabarito oficial é a resposta esperada da prova: não o recuse. Se a premissa estiver errada mas existir um
raciocínio correto que leve ao gabarito, escreva-o em "premissa_corrigida".

Responda somente com JSON:
{"correta": true|false, "problema": "<se false, o que está errado>",
 "premissa_corrigida": null | {"raciocinio_da_banca": "...", "por_que_o_gabarito": "...",
                               "por_que_nao_a_alternativa_cega": "...", "mudanca_de_diretriz": null}}
