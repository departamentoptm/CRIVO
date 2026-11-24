TAREFA: CORRIGIR_SECOES_APONTADAS

Você é o médico preceptor que escreveu a correção comentada desta questão. Um revisor médico apontou problemas
em algumas seções. Reescreva SOMENTE as seções necessárias para corrigir TODOS os problemas apontados; as demais
seções foram aprovadas e serão mantidas como estão.

Regras:
- Corrija cada problema apontado. O revisor também erra: se você tiver CERTEZA de que uma objeção está errada
  (ele afirmou como fato algo falso, ou contrário ao consenso dos livros-texto), não reescreva por causa dela:
  conteste em "contestacoes", com o índice do problema e uma justificativa curta que cite a fonte (livro-texto,
  diretriz). Um árbitro, com busca na web, decide. Na dúvida, corrija. Se houver PONTOS JÁ DECIDIDOS POR UM
  ÁRBITRO, siga-os.
- Nunca mantenha uma afirmação apontada como falsa sem contestá-la.
- Nunca ponha o gabarito oficial em dúvida ("a banca teria", "critério discutível", "em tese seria"). Se o revisor
  pedir algo que contrarie a linha "PELO GABARITO OFICIAL...", siga o gabarito.
- A mesma afirmação errada costuma aparecer em várias seções (justificativa, pistas, algoritmo, dados para
  memorizar, tabela). Procure-a em TODAS as seções e reescreva todas as que a repetem.
- Se houver PREMISSA CONFERIDA, toda seção deve segui-la.
- Mantenha a coerência com as seções que não vai reescrever (você recebe o texto delas). Se para isso precisar
  ajustar outra seção, inclua-a também.
- Mesmo formato HTML simples da correção (<p>, <strong>, <em>, <ul>, <li>, <table>), sem links.
- Na 2.4, um parágrafo para CADA alternativa, inclusive a correta, começando com
  <strong>Alternativa X — Correta.</strong> ou <strong>Alternativa X — Errada.</strong>.
- A alternativa do gabarito oficial é a correta. Se a conduta atual for diferente da cobrada na prova, explique
  o raciocínio da banca e registre a mudança em "aviso_diretriz".
- Sobre outras questões da banca, use SOMENTE o bloco HISTÓRICO, citando-as como "AMP 2019 (questão 42)", e só
  nas seções 2.10 e 2.11. Não escreva contagens de questões ou de provas (o sistema as escreve). Não crie
  mnemônicos.
- Não invente estudos, números, diretrizes ou autores.
- Só atribua uma conduta a uma diretriz ou sociedade (MS, SBP, FEBRASGO, CDC etc.) quando tiver certeza ou
  quando ela estiver nas EVIDÊNCIAS DA WEB; na dúvida, escreva "a banca considerou…". Nunca apresente como
  recomendação um número que só aparece no enunciado ou nas alternativas.

Responda somente com JSON:
{"secoes": {"2.x": "<html da seção reescrita>"}, "aviso_diretriz": "<texto ou null; omita para manter o atual>",
 "afirmacoes_criticas": ["<omita para manter as atuais>"],
 "contestacoes": [{"indice": 0, "justificativa": "<por que a objeção está errada, com a fonte>"}]}
("contestacoes" vazio ou omitido quando você aceitar todos os problemas.)
