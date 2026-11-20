# Formato dos dados do CRIVO (versão 1)

Cada edição de prova vira um arquivo: `dados/<BANCA>/<ANO>.json` (ex.: `dados/AMP/2021.json`).
O site lê esse arquivo e desenha a questão com **uma única página fixa**. O modelo de IA não escreve
mais HTML, CSS nem JavaScript: ele preenche apenas o conteúdo.

## Estrutura

```json
{
  "formato": "crivo-edicao",
  "versao": 1,
  "banca": "AMP",
  "ano": "2021",
  "questoes": [
    {
      "id": "AMP-2021-Q1",
      "numero": 1,
      "disciplina": "Dermatologia",
      "tema": "Dermatologia: Ectima",
      "enunciado_html": "Escolar de 10 anos ...",
      "extras_html": null,
      "alternativas": { "A": "ectima.", "B": "erisipela.", "C": "...", "D": "...", "E": "..." },
      "gabarito": "A",
      "aviso_diretriz": null,
      "correcao": {
        "secoes_html": { "2.1": "<p>...</p>", "2.2": "...", "...": "...", "2.15": "..." },
        "historico": [
          { "id": "AMP-2019-Q42", "resumo": "...", "cobrado": "conduta inicial", "relacao": "..." }
        ]
      },
      "origem": "convertido_html_v1",
      "revisao": { "status": "nao_revisado", "alertas": [] }
    }
  ]
}
```

## Regras de cada campo

| Campo | Quem preenche | Regra |
|---|---|---|
| `id`, `numero`, `banca`, `ano` | script | Nunca o modelo. |
| `gabarito` | script, a partir do `gabarito.json` | `null` quando anulada. O modelo nunca define. |
| `enunciado_html`, `alternativas` | script, a partir do `perguntas.txt` | Texto oficial, sem reescrita. |
| `extras_html` | script | Tabelas/afirmativas do enunciado, quando existirem. |
| `aviso_diretriz` | modelo | Texto curto quando a conduta atual difere do gabarito oficial; senão `null`. O site mostra o gabarito **e** o aviso. |
| `correcao.secoes_html` | modelo | Seções 2.1 a 2.15. Só tags simples: `p strong em ul ol li table thead tbody tr th td br sub sup`. |
| `correcao.historico` | modelo escreve `resumo/cobrado/relacao`; script preenche ano, número e gabarito pelo `id` | `id` precisa existir no acervo; senão a linha é descartada. |
| `revisao.status` | script / mantenedores | `nao_revisado`, `regerar`, `reportado`, `corrigido`. |
| `revisao.alertas` | script | Ex.: `anulada`, `correcao_contradiz_gabarito`, `ia_discorda_do_gabarito`, `conversao: ...`. |

Questões convertidas das páginas antigas têm `origem: "convertido_html_v1"` e a seção 2.10 em HTML
(sem `historico` estruturado). As geradas pelo novo pipeline terão `origem: "api_v1"`.
