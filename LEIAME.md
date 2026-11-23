# CRIVO — dados das provas e gerador de correções

## Como as peças se encaixam

```
prova .pdf/.txt ──importar_prova.py──► questoes.json  (fixo: enunciado, alternativas, gabarito, figuras)
                                              │
gabarito.json ──conferir_gabarito.py──────────┤
                                              ▼
                     gerar_correcoes.py ──► correcoes.json  (editável: só a correção)
                                              │
                         js/crivo-render.js junta os dois no template ──► site
```

## Instalar no repositório (uma vez)

1. Copie o conteúdo desta pasta para a raiz do repositório CRIVO, substituindo o que já existe.
   **Inclua a pasta oculta `.github`** (começa com ponto; no gerenciador de arquivos aperte Ctrl+H para vê-la).
   Sem ela, os botões "Gerar correções" e "Importar prova" não aparecem na aba Actions.
   Pelo terminal, isto copia tudo, inclusive os ocultos: `cp -r CRIVO/. ~/CRIVO/`
   **Apague os arquivos antigos `dados/AMP/2021.json` etc.** (agora cada edição é uma pasta):
   `rm -f ~/CRIVO/dados/*/[0-9]*.json`
2. Copie também o seu `gabarito.json` para a raiz.
3. `git add . && git commit -m "Dados em dois arquivos + gerador de correções" && git push`

Testar no computador antes: `python3 -m http.server 8000` e abrir `http://localhost:8000/previa.html`.

## Gerar correções pelo GitHub (recomendado)

Preparação (uma vez):
- Crie a chave em platform.deepseek.com, coloque crédito (pré-pago) e cadastre-a no GitHub:
  **Settings → Secrets and variables → Actions → New repository secret**, nome `DEEPSEEK_API_KEY`.
- **Settings → Actions → General → Workflow permissions**: marque
  "Allow GitHub Actions to create and approve pull requests".

Uso: aba **Actions → Gerar correções → Run workflow**. Escolha a banca, as edições/questões, o limite
de questões e o teto de custo. Ao terminar, o GitHub abre um **pull request** com as correções novas e um
relatório (quais foram publicadas, quais foram reprovadas e quanto custou). Leia, e só então aprove (Merge).

Para ver o resultado, clique na execução: a página **Summary** mostra o que foi gerado, o custo e, se houver erro,
a causa em português (chave recusada, sem saldo, nome de modelo errado...). Execução vermelha = erro;
verde = deu certo (abra a aba Pull requests). Avisos amarelos sobre "Node.js" podem ser ignorados.

Primeiro uso sugerido: banca `AMP`, questões `50`, edições `2021`, orçamento `0.20`. Confira o resultado
antes de rodar em lote.

## Gerar pelo computador

```bash
export DEEPSEEK_API_KEY=sk-...                                     # sua chave
python3 ferramentas/gerar_correcoes.py modelos                     # confere o nome dos modelos
python3 ferramentas/gerar_correcoes.py gerar --banca AMP --ano 2021 --questoes 50 --orcamento 0.20
python3 ferramentas/gerar_correcoes.py gerar --banca AMP --limite 20 --orcamento 1   # pendentes
python3 ferramentas/gerar_indice.py --dados dados
```
Teste sem gastar nada: acrescente `--simular` logo depois de `gerar_correcoes.py` (as respostas são falsas;
use em uma cópia da pasta `dados`, nunca publique).

O que entra na fila (`--modo`):
- `pendentes` (padrão): sem correção, correção que contradiz o gabarito, ou reportada por estudantes;
- `convertidas`: também as correções antigas, vindas das páginas HTML;
- `todas`: tudo, exceto as marcadas como `revisado_humano` (a não ser com `--forcar`).
Questões com `imagem_pendente` são puladas.

## Como o gerador evita erros

1. Enunciado, alternativas e gabarito vêm do `questoes.json`; a IA não pode alterá-los.
2. **Histórico (2.10) sem omissões:** todas as questões da banca (todas as provas do acervo) são catalogadas
   uma única vez em `dados/<BANCA>/temas.json`, com temas, resumo, o que foi cobrado e disciplina. Para cada
   questão, o script compara a atual com **todas** as outras da banca (temas, disciplina e vocabulário), e a IA
   classifica as relacionadas em *mesmo tema*, *tema relacionado* ou *caso semelhante*. A tabela é sempre
   montada pelo script, com os dados do catálogo e do `questoes.json`; sem questões relacionadas, a tabela
   aparece com uma linha avisando isso.
3. **Resolução às cegas:** antes de ver o gabarito, a IA resolve a questão. Se discordar, o site mostra um aviso.
4. **Validação automática:** todas as seções com tamanho mínimo, as 5 alternativas analisadas na 2.4,
   a letra do gabarito citada na 2.3, a tabela de diferenciais na 2.8 e referências só da lista permitida.
5. **Revisor independente:** outra chamada procura erros factuais. Com problema grave ou moderado, só as seções
   apontadas são reescritas (as aprovadas ficam como estão) e a correção inteira é conferida de novo, até 3
   rodadas. Se faltar só o parágrafo de alguma alternativa na 2.4, o sistema pede só esse parágrafo. O revisor
   não usa o gabarito de provas antigas do histórico como prova da conduta atual e aceita a explicação do
   raciocínio da banca quando o aviso de diretriz registra o que mudou. Se continuar reprovada, a correção **não
   é publicada**: a anterior fica, o motivo vai para `relatorios/reprovadas/` e ela entra no arquivo da ação
   `amostra`, para ser corrigida numa conversa com o Claude.
   - Da 2ª rodada em diante, o revisor recebe a lista dos problemas anteriores e confere um a um se foram
     resolvidos (sem raciocínio estendido, mais barato). Toda seção apontada é reescrita, inclusive quando o
     revisor escreve rótulos compostos como "2.4 e 2.10" ou "aviso/2.3".
   - O revisor lista todas as seções que repetem o mesmo erro, e o corretor procura a afirmação errada em todas.
     Se o mesmo erro reaparecer depois da correção por partes, a correção inteira é refeita uma vez, com a lista
     de todos os problemas como instrução. Se a última conferência resolveu algum problema (ou a correção
     inteira acabou de ser refeita), há uma rodada extra (`qualidade.rodada_extra_com_progresso`).
   - O revisor também erra. O corretor pode **contestar** uma objeção que considere falsa, citando a fonte; e o
     revisor marca `contradiz_gabarito` quando a objeção tornaria o gabarito oficial impossível. Nos dois casos,
     um **árbitro** (raciocínio estendido + busca na web sobre o ponto em disputa) decide antes de qualquer
     reescrita: objeção derrubada sai da lista; objeção confirmada é corrigida sem nova contestação. As
     decisões entram nas revisões seguintes como "pontos já decididos" (no máximo
     `qualidade.max_arbitragens` = 3 por questão; ficam em `verificacao.arbitragens`). O árbitro busca primeiro
     fontes brasileiras (2 buscas em português e 1 em inglês) e segue o gabarito oficial quando só houver fontes
     estrangeiras divergentes.
   - **Questões de afirmativas** (I, II, III… / 1, 2, 3… / "( )" com V e F): o sistema lê a alternativa do
     gabarito e monta quais afirmativas são verdadeiras e quais são falsas (ferramentas/afirmativas.py). Essa
     tabela vai para o autor, o revisor e o árbitro. Uma decisão do árbitro que a contrarie é descartada. Antes
     de aprovar, uma conferência barata (`qualidade.conferir_afirmativas`) lê as seções 2.3 e 2.4 e confere se a
     correção declara cada afirmativa como a tabela; se não, é um problema grave, corrigido como os outros.
     Alternativas com "exceto", contagens ou mistura de verdadeiras e falsas ficam sem tabela.
   - O relatório da execução (`relatorios/execucao_*.md`) traz as rodadas de cada questão com algum problema:
     os problemas apontados, as seções reescritas, as contestações e as decisões do árbitro.
   - O revisor recebe os números do histórico já contados pelo sistema (provas no acervo, provas com questões
     relacionadas, por tipo), para não apontar como erro uma contagem correta.
   - Regra de diretrizes: a IA não pode atribuir uma conduta ao Ministério da Saúde, a uma sociedade ou a um
     protocolo sem base, nem repetir números das alternativas (dose, dias) como se fossem recomendação.
5b. **Busca na web quando a IA discorda do gabarito:** se a resolução às cegas diverge, o gerador faz 2 buscas
   (versão atual e versão até o ano da prova, com `before:`) na Search API do DeepSeek (US$ 0,00075 por
   busca) e entrega os trechos à geração e ao revisor como "EVIDÊNCIAS DA WEB". As fontes de maior
   autoridade entram na 2.15. Em seguida, antes de escrever a correção, uma chamada curta diz qual diagnóstico,
   etiologia ou mecanismo leva ao gabarito, e um revisor confere essa premissa; a correção inteira é escrita
   sobre a premissa conferida. Configuração em `busca_web` no `config_gerador.json` (`"ativa": false` desliga).
5c. **Catálogo com a resposta oficial:** antes de gerar uma questão, o catálogo dela e o das questões escolhidas
   para o histórico são refeitos com o gabarito (uma vez por questão), para que o resumo da tabela 2.10 não traga
   chutes da IA. O revisor recebe o texto da resposta oficial de cada questão do histórico.
5d. **Economia:** quando a resolução às cegas concorda com o gabarito com confiança de pelo menos 0,8
   (`qualidade.confianca_para_revisao_sem_raciocinio`), a revisão completa é feita sem raciocínio estendido. Os
   mínimos de tamanho aceitam até 3% a menos (`qualidade.tolerancia_minimos`). O relatório de cada execução traz
   o custo por etapa.
6. **Referências:** a IA indica 1 ou 2 livros da lista `fontes_permitidas` e termos de busca em inglês. O script
   busca no PubMed (API oficial gratuita) 2 revisões, revisões sistemáticas ou diretrizes recentes que existem,
   com link para o artigo e o DOI, e acrescenta links de consulta ao UpToDate, ao Manual MSD e ao PubMed.
   A IA nunca escreve links, autores, PMID ou DOI. Para refazer só as referências das correções já geradas,
   sem custo: Actions > Gerar correções > ação `atualizar-referencias`.
7. **Sem pistas no topo da página:** a questão começa direto em "Questão N"; o tema e a disciplina não
   aparecem antes da resposta.

Mesmo assim, a correção é de IA e pode errar. Por isso o site mostra o selo "não revisado" e o botão
"Reportar erro".

## Temas das questões (filtro por tema, desempenho e pontos fracos)

Actions → Gerar correções → ação **temas-padrao** (o campo banca é ignorado; vale para todas as bancas):

1. refaz o catálogo de todas as questões com a resposta oficial (uma vez por questão);
2. cria uma lista fixa de temas por disciplina, a mesma para todas as bancas e anos, baseada no currículo de
   residência da disciplina, com cerca de 1 tema a cada 10 questões (mínimo 6, máximo 25). É feita uma vez
   (`--refazer-listas` refaz; um arquivo da versão 1 é refeito sozinho);
3. encaixa cada questão no tema mais próximo da lista da disciplina dela e grava `dados/temas_padrao.json`,
   usado pelo site. Nenhum tema é criado automaticamente. As questões em que nenhum tema serviu de verdade
   ficam em `relatorios/temas_sem_encaixe.md`; se um assunto se repetir, acrescente um tema no FIM da lista
   da disciplina (no `temas_padrao.json`) e rode `temas-padrao` de novo. Os temas existentes não mudam.

Custo estimado da primeira vez: cerca de US$ 0,15 a 0,30. Depois, só as questões novas ou alteradas são processadas.
Aprove o pull request para o site passar a usar os temas.

## Correções escritas na conversa com o Claude

Quando a API não consegue uma correção confiável (por exemplo, divergência entre o gabarito e a diretriz), a
correção pode ser escrita numa conversa com o Claude e entregue como `correcoes_manuais/<ID>.json`. Para gravar:

```bash
python3 ferramentas/gerar_correcoes.py inserir-manual --arquivo correcoes_manuais/AMP-2020-Q10.json
python3 ferramentas/gerar_correcoes.py inserir-manual --arquivo correcoes_manuais/AMP-2020-Q6.json
```

O comando não usa a API do DeepSeek: passa pela mesma validação, monta a tabela 2.10 com as questões listadas
no arquivo, busca os artigos do PubMed e acrescenta as fontes consultadas à 2.15. A correção fica com
`origem: "conversa"`, continua com o selo "sem revisão humana" e o gerador não a substitui (nem em
`--questoes`), a não ser que seja reportada ou que se use `--forcar`.

## Tirar do site uma correção publicada com erro

```bash
python3 ferramentas/gerar_correcoes.py remover --questao AMP-2020-Q85
python3 ferramentas/gerar_indice.py --dados dados
git add dados && git commit -m "Remove a correção da AMP-2020-Q85" && git push
```

A questão fica sem correção até ser gerada de novo (`gerar --questoes 85` ou no modo pendentes). Não usa a API.

## Quando um estudante reporta um erro

O botão "Reportar erro" de cada questão abre um Formulário Google já com o código da questão preenchido.
Para trazer os reportes ao projeto: **Actions → Importar formulários (reportes, revisões e dúvidas) → Run workflow**. Sai um pull
request: os reportes de questões com correção entram em `revisao.reportes` e a correção fica "reportado";
depois de aprovar, rode **Gerar correções** no modo pendentes e elas são refeitas levando o reporte em conta.
Reportes de questões sem correção, de correções revisadas por pessoas ou com código inválido aparecem em
`relatorios/reportes.md` para a equipe conferir à mão. Cada reporte entra uma única vez.

Configuração (uma vez):
1. Em forms.google.com, crie o formulário "CRIVO — reportar erro" com 3 perguntas: **Questão** (resposta
   curta, obrigatória), **O que está errado** (parágrafo, obrigatória) e **Fonte que confirma** (resposta curta,
   opcional). Em Configurações → Respostas, deixe "Coletar endereços de e-mail" em **Não coletar** e não exija login.
2. Menu ⋮ → **Gerar link pré-preenchido** → no campo Questão escreva `{id}` → **Gerar link** → copie o link e
   cole em `js/crivo-render.js`, na linha `urlReportarErro: ''` (entre as aspas).
3. Aba Respostas → **Vincular ao Planilhas**. Na planilha: Arquivo → Compartilhar → **Publicar na Web** →
   escolha a aba das respostas e o formato **CSV** → Publicar → copie o link.
4. No GitHub: Settings → Secrets and variables → Actions → aba **Variables** → New repository variable:
   nome `URL_REPORTES_CSV`, valor = o link do passo 3.

O CSV publicado pode ser lido por quem tiver o link: o formulário não pede dados pessoais, e o aviso no
formulário deve pedir que ninguém escreva nome, e-mail ou RA.

Também dá para editar à mão: abra `dados/<BANCA>/<ANO>/correcoes.json`, procure o id da questão (ex.: `AMP-2021-Q50`) e:
- se o erro for simples, corrija o texto direto em `secoes_html`; **ou**
- mude `"status": "nao_revisado"` para `"status": "reportado"` e acrescente em `"reportes"`
  `{"texto": "o que está errado e a fonte"}`. Na próxima execução do gerador (modo pendentes),
  a questão é refeita levando o reporte em conta.
Se um médico revisou e aprovou a correção, use `"status": "revisado_humano"`: o selo de IA some e o
gerador nunca mais a sobrescreve.

## Revisão das correções pela liga

Cada página de questão com correção de IA ganha o link **"Revisar (liga)"**, que abre um Formulário Google com
o código da questão preenchido. O mesmo workflow **Importar formulários** traz as revisões:

- **"Tem erro"**: a correção vai para "regerar" e o apontamento entra nos reportes; na próxima execução de
  **Gerar correções** (modo pendentes) ela é refeita levando o apontamento em conta.
- **Selo "Correção revisada"**: 2 estudantes diferentes **ou** 1 médico(a) com CRM conferido marcam "Correta",
  sem nenhum "Tem erro" depois da última geração. O selo mostra os nomes de quem autorizou; quem não autorizou
  aparece como "revisor(a) da liga". Revisões de uma versão anterior da correção não contam.
- **CRM**: o relatório (`relatorios/revisoes.md`) lista os CRMs a conferir. Depois de conferir no site do CFM,
  acrescente o médico em `dados/revisores.json`, em `"medicos_conferidos"`:
  `{"nome": "Dra. Fulana", "crm": "12345-PR"}`, e rode o workflow de novo (o selo é recalculado).
- Uma correção com selo não é refeita pelo gerador, a não ser que alguém aponte erro depois.

Configuração (uma vez):
1. Crie o formulário "CRIVO — revisão da liga" com estas perguntas, **com estes títulos** (o importador
   reconhece pelo começo do título):
   **Questão (código)** (resposta curta), **A correção está** (múltipla escolha: `Correta` / `Tem erro`),
   **Seção com erro** (resposta curta, opcional, ex.: 2.4), **O que está errado** (parágrafo, opcional),
   **Nome** (resposta curta), **Você é** (múltipla escolha: `Estudante` / `Médico(a)`),
   **CRM (se for médico)** (resposta curta, opcional) e
   **Autorizo que meu nome apareça no site** (múltipla escolha: `Sim` / `Não`).
2. Gere o link pré-preenchido com `{id}` na pergunta Questão e cole em `js/crivo-render.js`, em `urlRevisarLiga: ''`.
3. Vincule ao Planilhas, publique a aba de respostas como **CSV** e crie a variável `URL_REVISOES_CSV` com o link.
   Atenção: o CSV publicado pode ser lido por quem tiver o link e contém os nomes e CRMs dos revisores;
   compartilhe o link só com quem mantém o projeto.

## Dúvidas dos estudantes (respondidas pela liga)

A página da questão mostra, depois da correção, as dúvidas já respondidas e o link **"Enviar uma dúvida sobre
esta questão"**. A pergunta é anônima; a resposta aparece com o nome de quem respondeu.

Configuração (uma vez):
1. Crie o formulário "CRIVO — dúvidas" com 2 perguntas: **Questão (código)** (resposta curta) e
   **Sua dúvida** (parágrafo). Em Configurações → Respostas: **não coletar e-mail** e não exigir login.
2. Gere o link pré-preenchido com `{id}` e cole em `js/crivo-render.js`, em `urlEnviarDuvida: ''`.
3. Vincule ao Planilhas e, **na planilha**, acrescente duas colunas no fim: **Resposta** e **Respondido por**.
   A liga responde preenchendo essas colunas.
4. Publique a aba como **CSV** e crie a variável `URL_DUVIDAS_CSV`.
5. Rode **Importar formulários**: só as linhas com Resposta e Respondido por vão para `dados/duvidas.json` (e
   para o site, depois de aprovar o PR). As pendentes aparecem no relatório. Apagar a linha da planilha tira a
   dúvida do site na importação seguinte.

## Simulado

Botão **📝 Simulado** na tela inicial. O aluno escolhe quantidade, bancas, disciplinas, se quer só questões
não feitas, e o tempo total. Durante o simulado a correção e o gabarito ficam escondidos e o relógio não para
(nem fora da página). No fim (ou quando o tempo acaba), as respostas entram no progresso e na revisão espaçada,
e a tela de resultado mostra o acerto geral e por disciplina, com Difícil/Bom/Fácil para cada questão.
O histórico dos simulados vai para o arquivo de progresso e para o Google Drive.

## Custos e configuração (`ferramentas/config_gerador.json`)

- **Teto acumulado do projeto:** `dados/gastos.json` guarda quanto já foi gasto (`gasto_usd`) e o teto
  (`teto_usd`, US$ 30). Ao fim de cada execução, o workflow grava o custo dela **direto no main** (passo
  "Registrar o gasto no main"), mesmo que o pull request com as correções não seja aprovado; o PR não leva
  `gastos.json`. Se o main não aceitar o push (branch protegida), o gasto segue no PR, como antes. Nenhuma
  execução passa do que resta. Ao atingir o teto, o gerador para sem chamar a API. O arquivo foi conferido
  com o painel da DeepSeek em 23/11/2026 (entradas "ajuste").
- **Só fora do pico:** nenhuma chamada paga é feita no horário de pico; o gerador espera o pico acabar.
- **Questão começada é sempre terminada:** o orçamento (da execução e o teto acumulado) só impede começar uma
  questão nova; por isso a última questão pode passar alguns centavos do limite. Se uma etapa for cortada pelo
  limite de tamanho (`max_tokens`), ela é pedida de novo com o dobro do limite (até `max_tokens_teto`) e, se
  ainda assim for cortada, sem o raciocínio estendido. Uma correção reprovada pelo revisor é refeita até
  3 vezes (`rodadas_de_verificacao`); se continuar reprovada, não é publicada.
- **Amostra para conferência humana:** 1 de cada 50 correções geradas é marcada (`revisao.amostra =
  "pendente"`). Actions → Gerar correções → ação `amostra` gera `relatorios/amostra_<BANCA>.md` (baixe em
  Summary → Artifacts → relatorios) para enviar ao Claude numa conversa. Depois de conferidas, rode a ação
  `amostra` com os ids em "conferidas".

- `modelos`: nome do modelo usado em cada etapa. Confira com `gerar_correcoes.py modelos`.
- `precos_usd_por_milhao_fora_do_pico`: **confira na página de preços do DeepSeek e atualize**. O custo
  mostrado nos relatórios é uma estimativa baseada nesses números.
- `orcamento_usd_por_execucao`: teto padrão; a execução para quando atinge (pode passar o valor de uma
  chamada) e continua de onde parou na próxima.
- `esperar_fora_do_pico`: no horário de pico (preço dobrado), o gerador espera o fim do pico. Pico em UTC,
  dias úteis: 01:00–04:00 e 06:00–10:00 = 22:00–01:00 e 03:00–07:00 no horário da Bahia.
- `fontes_permitidas`: lista de referências aceitas; edite à vontade.
- `qualidade`: tamanhos mínimos e número de tentativas.
- As instruções enviadas à IA estão em `ferramentas/prompts/*.md` e podem ser ajustadas.

## Adicionar provas novas (PDF ou TXT) — uma única vez por edição

Coloque os originais em `provas/<BANCA>/<ANO>.pdf` (ou `.txt`), por exemplo `provas/SUS-SP/2024.pdf`.
O gabarito pode estar no próprio arquivo (bloco "Gabarito" no fim) ou no `gabarito.json`; o `gabarito.json`
tem prioridade e o relatório avisa se os dois discordarem.

**Pelo GitHub:** envie o arquivo (Add file → Upload files, na pasta `provas/<BANCA>/`), depois
**Actions → Importar prova → Run workflow** com a banca. Sai um pull request com o `questoes.json`, as figuras
e um relatório por edição. Título com "[CONFERIR]" = há itens para olhar antes de aprovar.

**Pelo computador** (precisa do poppler: `sudo apt install poppler-utils tesseract-ocr tesseract-ocr-por`):
```bash
python3 ferramentas/importar_prova.py --arquivo provas/SUS-SP/2024.pdf --banca SUS-SP --ano 2024
python3 ferramentas/importar_prova.py --pasta provas --banca SUS-SP          # todas as edições da banca
python3 ferramentas/gerar_indice.py --dados dados
```

O que o importador faz (sem IA, sem custo): lê o PDF (ou faz OCR em português se for digitalizado), desfaz as
duas colunas, tira cabeçalhos/rodapés repetidos, reconhece a numeração ("Questão 1", "QUESTÃO 01", "1.", "1)")
e as alternativas ("A)", "(A)", "a)", "A.", "A -"; 4 ou 5), monta tabelas, prende o texto compartilhado
("Leia o caso para as questões 6 e 7") às questões certas e extrai as figuras do PDF para `dados/<BANCA>/<ANO>/img/`.

**Prova de fidelidade:** para cada questão, compara palavra por palavra o texto original com o que foi gravado.
Qualquer palavra que suma ou apareça aparece no relatório (`relatorios/importacao/<BANCA>_<ANO>.md`), junto com
as linhas removidas como cabeçalho e o texto da capa. Nada some em silêncio.

Se o relatório apontar problemas:
- numeração não reconhecida: `--primeira 51` (caderno que começa na 51) ou `--paginas 3-18` (pula capa);
- cabeçalho que sobrou: `--remover "TEXTO DO CABEÇALHO"`;
- número errado de alternativas: `--alternativas 4` ou `5`;
- questões que o código não separou: `--reparar-com-ia` (só essas vão à IA, custo de centavos, e a resposta só é
  aceita se tiver exatamente as palavras do original); ou corrija o `.txt` e importe de novo.
- figura presa à questão errada: mova a tag `<img>` no `questoes.json` (as figuras vêm marcadas com
  `"imagem_conferir": true`).
- prova em 2 colunas com tabelas ou trechos de largura total (como o ENAMED): `--colunas 2` (no GitHub, campo
  "Leitura das páginas" = 2). Cada faixa da página é lida na ordem certa, e células de tabela quebradas em
  duas linhas são juntadas.
- gabarito ainda preliminar: `--gabarito-preliminar` (no GitHub, marque a caixa). O site avisa que pode mudar.
  Quando sair o definitivo, atualize o `gabarito.json` e importe a edição de novo com `--sobrescrever` e sem
  essa opção; correções escritas para uma letra que mudou são refeitas automaticamente.
- **página digitalizada** dentro de um PDF de texto: o relatório lista as questões dessa página ("texto vindo de
  OCR"). Transcreva-as em `provas/<BANCA>/transcricoes.json` (veja o do ENAMED como modelo) e importe de novo:
  o texto transcrito substitui o OCR.
- **texto ilegível ("ǆĂŵĞ")**: o PDF tem fontes sem tabela de caracteres. O importador repara sozinho, usando
  as tabelas das outras fontes do arquivo ou as guardadas em `ferramentas/mapas_glifos.json` (precisa de
  `pip install pypdf pdfminer.six`; no GitHub já é instalado). Se sobrar algum caractere desconhecido, o
  reparo avisa qual é.
- questões anuladas ou excluídas: escreva `"ANULADA"`, `"EXCLUIDA"` ou `"ANULADA_ADMINISTRATIVAMENTE"` no
  `gabarito.json`; o site mostra o motivo.

Depois de importada, a edição não é processada de novo (a não ser com `--sobrescrever`, que mantém as correções).
O gerador de correções pula questões com figura, porque o modelo de texto não enxerga a imagem.

## ENAMED

`provas/ENAMED/` tem o caderno 02 de 2025 (gabarito definitivo) e de 2026 (gabarito preliminar), 100 questões
de 4 alternativas cada. Já vêm importados; para refazer: Actions → Importar prova, banca `ENAMED`, ano `2025`
(ou `2026` com "gabarito preliminar" marcado), leitura das páginas = 2, "Refazer" marcado.

## Publicação do site

O site é publicado pelo workflow **Publicar site** só com o que o site usa (`index.html`, `sobre.html`,
`privacidade.html`, `previa.html`, `js/`, `dados/` e `exams/disciplinas.json`). Para isso, uma vez:
Settings → Pages → Build and deployment → Source: **GitHub Actions**. Ferramentas, relatórios, provas
originais e `arquivo/` (páginas antigas e scripts substituídos) ficam no repositório, mas fora do site.

O acesso é aberto e sem cadastro: o site não pede nome nem RA. O progresso fica no navegador e, se o
estudante quiser, no Google Drive dele (arquivo `crivo_progresso.json`) ou num arquivo que ele salva. Progressos
antigos, salvos por RA, são somados automaticamente na primeira vez (no navegador e no Drive).

## Outras ferramentas
- `conferir_gabarito.py`: compara `questoes.json` com o `gabarito.json` e lista correções a refazer.
- `importar_reportes.py`: traz os erros reportados pelo formulário (usado pelo workflow).
- `gerar_indice.py`: atualiza `dados/indice.json` (rode depois de qualquer mudança em `dados/`).
- `converter_html_para_json.py` e `migrar_para_dois_arquivos.py`: usados uma vez, na migração.
- O workflow **Validar dados** roda sozinho a cada envio e acusa JSON quebrado ou gabarito diferente do oficial.
