# CRIVO — dados das provas e gerador de correções

## Como as peças se encaixam

```
perguntas.txt ──extrair_questoes.py──► questoes.json  (fixo: enunciado, alternativas, gabarito)
                                              │
gabarito.json ──conferir_gabarito.py──────────┤
                                              ▼
                     gerar_correcoes.py ──► correcoes.json  (editável: só a correção)
                                              │
                         js/crivo-render.js junta os dois no template ──► site
```

## Instalar no repositório (uma vez)

1. Copie o conteúdo desta pasta para a raiz do repositório CRIVO, substituindo o que já existe.
   **Apague as pastas antigas `dados/AMP/2021.json` etc., se ainda existirem** (agora cada edição é uma pasta).
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
2. **Histórico (2.10) sem omissões:** todas as questões da banca são catalogadas por tema (uma única vez,
   em `dados/<BANCA>/temas.json`). Para cada questão, o script compara a atual com **todas** as outras da banca
   por tema e por vocabulário, e a IA confirma quais tratam do mesmo assunto (na dúvida, inclui).
   Ano, número e gabarito da tabela são preenchidos pelo script. Se a IA esquecer alguma questão
   relacionada, o script a acrescenta.
3. **Resolução às cegas:** antes de ver o gabarito, a IA resolve a questão. Se discordar, o site mostra um aviso.
4. **Validação automática:** todas as seções com tamanho mínimo, as 5 alternativas analisadas na 2.4,
   a letra do gabarito citada na 2.3, a tabela de diferenciais na 2.8 e referências só da lista permitida.
5. **Revisor independente:** outra chamada procura erros factuais. Com problema grave ou moderado, a correção é
   refeita com as observações. Se for reprovada de novo, **não é publicada**: a anterior fica, e o motivo vai
   para `relatorios/reprovadas/`.
6. Referências: só fontes da lista em `config_gerador.json`; links são pesquisas no PubMed (nunca PMID ou URL
   escritos pela IA).

Mesmo assim, a correção é de IA e pode errar. Por isso o site mostra o selo "não revisado" e o botão
"Reportar erro".

## Quando um estudante reporta um erro

Abra `dados/<BANCA>/<ANO>/correcoes.json`, procure o id da questão (ex.: `AMP-2021-Q50`) e:
- se o erro for simples, corrija o texto direto em `secoes_html`; **ou**
- mude `"status": "nao_revisado"` para `"status": "reportado"` e acrescente em `"reportes"`
  `{"texto": "o que está errado e a fonte"}`. Na próxima execução do gerador (modo pendentes),
  a questão é refeita levando o reporte em conta.
Se um médico revisou e aprovou a correção, use `"status": "revisado_humano"`: o selo de IA some e o
gerador nunca mais a sobrescreve.

## Custos e configuração (`ferramentas/config_gerador.json`)

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

## Adicionar uma edição nova

```bash
python3 ferramentas/extrair_questoes.py --perguntas exams/AMP/2015/perguntas.txt --banca AMP --ano 2015 \
    --gabarito gabarito.json --disciplinas exams/disciplinas.json --dados dados
python3 ferramentas/gerar_indice.py --dados dados
```
Confira o texto em `previa.html` (filtro "só questões com alerta") antes de gerar correções.
Ou todas as edições de uma vez: `--pasta-exams exams --banca AMP` no lugar de `--perguntas ... --ano ...`.

## Outras ferramentas
- `conferir_gabarito.py`: compara `questoes.json` com o `gabarito.json` e lista correções a refazer.
- `gerar_indice.py`: atualiza `dados/indice.json` (rode depois de qualquer mudança em `dados/`).
- `converter_html_para_json.py` e `migrar_para_dois_arquivos.py`: usados uma vez, na migração.
- O workflow **Validar dados** roda sozinho a cada envio e acusa JSON quebrado ou gabarito diferente do oficial.
