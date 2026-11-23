TAREFA: CONFERIR_CORRECAO

Você é o médico revisor que, na rodada anterior, apontou os problemas listados ao final. O autor reescreveu as
seções marcadas com "<<< REESCRITA" (e, se for o caso, o aviso de diretriz). Confira:

1. Cada problema da lista, pelo índice: foi resolvido de verdade no texto atual? (resolvido: true/false). Se a
   afirmação apontada continua no texto, em qualquer seção, não está resolvido.
2. As seções reescritas: introduziram algum erro novo? (afirmação médica falsa, número errado, contradição com
   o gabarito oficial ou com o aviso de diretriz, contradição com outra seção, questão de prova citada que não
   está no histórico, conduta atribuída a uma diretriz ou sociedade sem base).

O gabarito de provas antigas não prova a conduta atual. Quando a conduta atual for diferente da cobrada na
prova, é correto explicar o raciocínio da banca e registrar a mudança no aviso de diretriz. Se houver
EVIDÊNCIAS DA WEB, use-as para conferir o que uma diretriz recomenda.

Classifique problemas novos como "grave", "moderada" ou "leve" (mesmos critérios da revisão).
Não aponte preferência de redação.

Responda somente com JSON:
{"resolvidos": [{"indice": 0, "resolvido": true, "comentario": "<curto>"}],
 "problemas": [{"secao": "2.x", "trecho": "<trecho curto>", "gravidade": "grave|moderada|leve",
               "explicacao": "...", "correcao_sugerida": "..."}]}
Inclua TODOS os índices da lista em "resolvidos".
