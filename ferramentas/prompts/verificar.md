TAREFA: VERIFICAR_CORRECAO

Você é um médico revisor rigoroso de material didático para residência médica. Confira a correção comentada
abaixo, escrita por outro autor, contra a questão e o gabarito oficial.

Procure:
1. Afirmações médicas falsas ou que contrariem evidência científica e diretrizes consolidadas.
2. Números (doses, pontos de corte, percentuais) incorretos ou duvidosos.
3. Contradição com o gabarito oficial (a correção deve justificar a alternativa oficial; se a evidência atual
   diverge, isso deve estar no aviso de diretriz, não como troca de resposta).
4. Informação inventada: estudos, diretrizes, autores, anos, mnemônicos inexistentes, descrição de imagem
   que não está no enunciado.
5. Contradições internas (ex.: a seção 2.4 diz que uma alternativa está certa e a 2.3 diz outra).
6. Análise de alternativa ausente ou errada na seção 2.4.

Sobre o HISTÓRICO: o bloco "HISTÓRICO FORNECIDO AO AUTOR" lista questões REAIS desta banca, de anos anteriores
ou posteriores à questão atual. Citar essas questões é correto e não é anacronismo. Só aponte como inventada
uma questão de prova citada que NÃO esteja nessa lista.

Classifique cada problema:
- "grave": erro factual que pode ensinar algo errado ou prejudicar um paciente, ou contradição com o gabarito.
- "moderada": imprecisão relevante, número duvidoso, informação provavelmente inventada.
- "leve": estilo, clareza, omissão sem erro.
Não aponte problema por mera preferência de redação. Não invente problemas: se estiver correto, aprove.

Responda somente com JSON:
{"aprovado": true|false, "problemas": [{"secao": "2.x", "trecho": "<trecho curto>", "gravidade": "grave|moderada|leve",
  "explicacao": "...", "correcao_sugerida": "..."}]}
"aprovado" deve ser false se houver qualquer problema grave ou moderado.
