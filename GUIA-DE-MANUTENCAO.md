# Guia de manutenção do CRIVO (para quem nunca programou)

Este guia explica, passo a passo, como manter o CRIVO funcionando. Quase tudo é feito por botões no site do
GitHub, sem escrever código. Os detalhes técnicos estão no `LEIAME.md`.

## 1. Como o CRIVO funciona, em uma página

- **O site** (https://departamentoptm.github.io/CRIVO/) é um conjunto de arquivos guardados neste repositório.
  Toda vez que algo muda na branch `main`, o GitHub publica o site sozinho em poucos minutos.
- **As questões** ficam em `dados/<BANCA>/<ANO>/questoes.json`, e as **correções** em `correcoes.json`, na mesma pasta.
- **As correções são escritas por IA** (DeepSeek), por um robô que roda no próprio GitHub (o "Actions"). Ele
  nunca muda o enunciado, as alternativas nem o gabarito oficial.
- **Cada aluno guarda o próprio progresso** no navegador e, se quiser, no Google Drive dele. O projeto não
  guarda dados dos alunos.
- **Tudo o que o robô faz vira um "pull request" (PR)**: uma proposta de mudança que alguém precisa aprovar.
  Nada entra no site sem aprovação.

## 2. Regras de ouro

1. **Nunca** coloque a chave da API (a senha do DeepSeek) em nenhum arquivo. Ela fica só em
   Settings → Secrets → `DEEPSEEK_API_KEY`.
2. **Nunca** coloque dados pessoais de alunos (nome, RA, e-mail) no repositório.
3. Antes de aprovar um PR, leia o resumo dele. Na dúvida, não aprove e pergunte.
4. Se um botão do Actions ficar **vermelho**, abra a execução e leia o resumo (Summary): as mensagens dizem o
   que ajustar. Nada é publicado quando há erro.
5. O teto de gastos com a IA está em `dados/gastos.json` (`teto_usd`). O robô para sozinho ao atingir o teto.

## 3. Onde ficam os botões

No GitHub, aba **Actions**, à esquerda:

| Botão | Para que serve | Custa? |
|---|---|---|
| **Gerar correções** | escreve correções com IA (ação `gerar`); outras ações: `temas-padrao`, `catalogar`, `atualizar-referencias`, `amostra` | sim, poucos centavos por questão |
| **Importar formulários (reportes, revisões e dúvidas)** | traz os formulários do Google para o site | não |
| **Importar prova** | transforma o PDF de uma prova nova em questões | não |
| **Validar dados** | confere tudo a cada mudança (roda sozinho) | não |
| **Publicar site** | publica o site (roda sozinho) | não |

Para rodar um botão: clique nele → **Run workflow** → preencha os campos → **Run workflow**.

## 4. Rotina semanal (15 minutos)

1. **Importar formulários** → Run workflow. Ele abre um PR com os erros reportados, as revisões da liga e as
   dúvidas respondidas. Leia e aprove (**Merge pull request**).
2. **Gerar correções**, ação `gerar`, modo `pendentes`, banca `AMP` (e depois `ENAMED`), orçamento `1.00`.
   Isso refaz as correções apontadas com erro. Aprove o PR.
3. Abra `relatorios/revisoes.md` e `relatorios/duvidas.md` (no PR ou no repositório):
   - **CRMs a conferir**: confira cada um no site do CFM; se estiver certo, acrescente o médico em
     `dados/revisores.json` (botão de lápis no GitHub para editar) e rode **Importar formulários** de novo.
   - **Dúvidas aguardando resposta**: avise a liga para responder na planilha.

## 5. Tarefas de vez em quando

**Gerar mais correções** (enquanto houver orçamento): Gerar correções → ação `gerar`, banca, edições
(ex.: `2024`), modo `pendentes`, limite `20`, orçamento `1.00`. O relatório mostra o custo; o PR é aprovado sozinho
depois da validação (se ficar aberto, leia o aviso na execução e aprove à mão).

**Prova nova** (ex.: AMP 2027): siga a seção "Adicionar provas novas" do `LEIAME.md`. Depois de aprovar,
rode **Gerar correções** → ação `temas-padrao` para classificar os temas das questões novas.

**Amostra de conferência**: a cada 50 correções, uma é sorteada para alguém conferir. Gerar correções → ação
`amostra` gera um arquivo para conferir numa conversa com o Claude.

**Correção escrita à mão ou na conversa com o Claude**: siga "Correções escritas na conversa com o Claude"
no `LEIAME.md` (comando `inserir-manual`).

## 6. Aplicar uma atualização recebida como arquivo `.patch`

No computador (Linux ou Mac), dentro da pasta do projeto:

```bash
git pull                                       # sempre primeiro, para ficar igual ao GitHub
git apply --index ~/Downloads/atualizacaoNN.patch
git commit -m "Atualização NN"
git push
```

Se o `git pull` disser "local changes would be overwritten", **pare** e peça ajuda: há mudanças no computador
que ainda não foram para o GitHub. Depois do `push`, confira em Actions se **Validar dados** ficou verde.

## 7. Configurações guardadas no GitHub

Settings → Secrets and variables → Actions:

| Nome | Tipo | O que é |
|---|---|---|
| `DEEPSEEK_API_KEY` | Secret | chave da API da IA (nunca em arquivo) |
| `URL_REPORTES_CSV` | Variable | link CSV da planilha de "reportar erro" |
| `URL_REVISOES_CSV` | Variable | link CSV da planilha de revisões da liga |
| `URL_DUVIDAS_CSV` | Variable | link CSV da planilha de dúvidas |

Os links dos formulários (para o site) ficam no começo de `js/crivo-render.js` (`urlReportarErro`,
`urlRevisarLiga`, `urlEnviarDuvida`), o formulário "Solicitar novas provas" em `js/app/10-inicio-filtros-e-grupos.js`
(`URL_SOLICITAR_PROVAS`) e o login do Google Drive em `js/app/08-google-drive.js` (`DRIVE_CLIENT_ID`; para liberar a
sincronização a todos, siga `GUIA-GOOGLE-DRIVE.md`).

## 8. Quando algo dá errado

| Sintoma | O que fazer |
|---|---|
| Site fora do ar ou sem mudanças | Actions → Publicar site: veja se a última execução ficou verde; se não, abra e leia o erro |
| "Validar dados" vermelho | o último PR quebrou algo; não aprove novos PRs e peça ajuda com o link da execução |
| Gerar correções parou em "teto" | o orçamento acabou (`dados/gastos.json`); é preciso decidir se aumenta o teto |
| Questão com erro na correção | o aluno usa "Reportar erro"; ou a liga marca "Tem erro" no formulário de revisão |
| Aluno perdeu o progresso | se ele usava o Google Drive, basta entrar de novo; se não, só o arquivo salvo por ele recupera |

## 9. Passagem de bastão

Ao sair da gestão, transfira ao próximo responsável: acesso de administrador ao repositório no GitHub, à conta
do DeepSeek (e ao saldo), aos três formulários e planilhas do Google, e a este guia. Combine uma sessão de 1 hora
para rodar juntos a rotina semanal.
