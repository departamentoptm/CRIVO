# CRIVO — questões a partir dos JSONs

## O que muda
O site deixa de abrir um `questão_N.html` por questão. Agora ele lê `dados/<BANCA>/<ANO>.json`
e monta cada questão com **um único template**, em `js/crivo-render.js`.
Cronômetros, grifos, progresso, Drive e Anki continuam funcionando como antes.

## Arquivos
| Arquivo | Para que serve |
|---|---|
| `js/crivo-render.js` | **O template.** CSS do "TAMPLATE RESOLUTOR", estrutura da página e script da questão. Mudou aqui, mudou em todas as questões. |
| `dados/indice.json` | Lista de bancas, edições e questões que o site mostra. Gerado por script, não edite à mão. |
| `dados/<BANCA>/<ANO>.json` | O conteúdo de cada prova (formato em `FORMATO.md`). |
| `previa.html` | Página para conferir qualquer questão sem login. Tem filtro "só questões com alerta". |
| `index.html` | Seu index com ~50 linhas alteradas (lista em `ferramentas/alteracoes_index.diff`). |
| `ferramentas/converter_html_para_json.py` | Converte `questão_N.html` antigos em JSON. |
| `ferramentas/conferir_gabarito.py` | Compara cada questão com o `gabarito.json` oficial. |
| `ferramentas/gerar_indice.py` | Gera o `dados/indice.json`. |

## Como instalar no repositório
1. Copie estas pastas e arquivos para a raiz do repositório, substituindo o `index.html`.
2. Envie para o GitHub (commit + push). O GitHub Pages publica sozinho.
3. Abra `https://departamentoptm.github.io/CRIVO/previa.html` para conferir.

A pasta `exams/` pode ficar: se o `dados/indice.json` sumir ou falhar, o site volta a usar os HTMLs antigos.
Quando uma edição está nos dois lugares, vale o JSON.

## Configurar o botão "Reportar erro"
No início do `js/crivo-render.js`, em `CONFIG.urlReportarErro`, cole o link de pré-preenchimento de um
Google Forms, trocando o valor do campo "ID da questão" por `{id}`. Enquanto estiver vazio, o botão abre
um e-mail para departamento.ptm@gmail.com já com o ID da questão.

## Rotina ao adicionar ou corrigir uma prova
    python ferramentas/conferir_gabarito.py --gabarito gabarito.json --dados dados --aplicar
    python ferramentas/gerar_indice.py --dados dados
Depois abra `previa.html`, marque "só questões com alerta" e confira essas questões antes de publicar.

## Comportamentos novos
- Questão **anulada**: mostra "Questão anulada pela banca" e conta como acerto qualquer alternativa confirmada, como na prova.
- Alerta **correcao_contradiz_gabarito**: aviso vermelho dizendo que a explicação será refeita (as 16 questões encontradas na conferência).
- Campo **aviso_diretriz**: quadro azul "Diretriz atual" junto do gabarito oficial.
- Selo "Correção gerada por IA, ainda sem revisão humana" + "Reportar erro nesta questão". O selo some quando `revisao.status` for `revisado_humano`.
- Todo HTML vindo do JSON passa por um filtro que remove scripts e atributos perigosos antes de entrar na página.
