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
5. **Revisor independente:** outra chamada procura erros factuais. Com problema grave ou moderado, a correção é
   refeita com as observações. Se for reprovada de novo, **não é publicada**: a anterior fica, e o motivo vai
   para `relatorios/reprovadas/`.
6. **Referências:** a IA indica 1 ou 2 livros da lista `fontes_permitidas` e termos de busca em inglês. O script
   busca no PubMed (API oficial gratuita) 2 revisões, revisões sistemáticas ou diretrizes recentes que existem,
   com link para o artigo e o DOI, e acrescenta links de consulta ao UpToDate, ao Manual MSD e ao PubMed.
   A IA nunca escreve links, autores, PMID ou DOI. Para refazer só as referências das correções já geradas,
   sem custo: Actions > Gerar correções > ação `atualizar-referencias`.
7. **Sem pistas no topo da página:** a questão começa direto em "Questão N"; o tema e a disciplina não
   aparecem antes da resposta.

Mesmo assim, a correção é de IA e pode errar. Por isso o site mostra o selo "não revisado" e o botão
"Reportar erro".

## Quando um estudante reporta um erro

O botão "Reportar erro" de cada questão abre um Formulário Google já com o código da questão preenchido.
Para trazer os reportes ao projeto: **Actions → Importar erros reportados → Run workflow**. Sai um pull
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

## Custos e configuração (`ferramentas/config_gerador.json`)

- **Teto acumulado do projeto:** `dados/gastos.json` guarda quanto já foi gasto (`gasto_usd`) e o teto
  (`teto_usd`, US$ 30). Cada execução soma o seu custo nesse arquivo (pelo pull request que ela abre) e
  nenhuma execução passa do que resta. Ao atingir o teto, o gerador para sem chamar a API. Some ao
  `gasto_usd` o que já foi gasto antes desta atualização (painel do DeepSeek). Aprove o PR de uma execução
  antes de rodar a próxima, senão a próxima não vê o gasto da anterior.
- **Só fora do pico:** nenhuma chamada paga é feita no horário de pico; o gerador espera o pico acabar.
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
