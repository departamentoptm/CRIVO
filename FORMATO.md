# Formato dos dados do CRIVO (versão 2)

Cada edição de prova tem uma pasta com **dois arquivos**:

```
dados/
  indice.json                 lista do que o site mostra (gerado por ferramentas/gerar_indice.py)
  AMP/
    temas.json                catálogo de temas de todas as questões da banca (usado no histórico 2.10)
    2021/
      questoes.json           FIXO: enunciado, alternativas e gabarito oficial
      correcoes.json          EDITÁVEL: a correção de cada questão
```

Na hora de abrir uma questão, o site (`js/crivo-render.js`) junta os dois arquivos no mesmo template.

## questoes.json — feito uma vez, não muda

Criado por `importar_prova.py` (a partir da prova original em .pdf ou .txt) ou por `converter_html_para_json.py`.
As figuras ficam em `dados/<BANCA>/<ANO>/img/` e entram em `extras_html` como `<img src="dados/...">`.
**Nenhuma ferramenta de IA escreve neste arquivo.** O único campo que muda depois é o `gabarito`,
pelo `conferir_gabarito.py`, para seguir o `gabarito.json` oficial.

```json
{
  "formato": "crivo-questoes", "versao": 1, "banca": "AMP", "ano": "2021",
  "questoes": [{
    "id": "AMP-2021-Q1", "numero": 1, "disciplina": "Dermatologia",
    "enunciado_html": "Escolar de 10 anos ...",
    "extras_html": null,
    "alternativas": {"A": "ectima.", "B": "erisipela.", "C": "...", "D": "...", "E": "..."},
    "gabarito": "A",
    "imagem_pendente": false
  }]
}
```
- `gabarito`: `null` quando a questão foi anulada.
- `imagem_conferir`: `true` quando a figura foi extraída do PDF automaticamente (confira se está na questão certa).
- `anulacao` (opcional): `excluida` ou `anulada_administrativamente`, quando o `gabarito` é `null` por esses
  motivos; o site mostra o motivo.
- `transcricao_manual` (opcional): a questão estava numa página digitalizada e o texto veio de
  `provas/<BANCA>/transcricoes.json`, não do OCR. `texto_ocr: true` = ainda vem do OCR e precisa ser conferida.
- `gabarito_situacao` (no topo do arquivo, opcional): `"preliminar"` faz o site avisar que o gabarito pode mudar.
- `imagem_pendente`: `true` quando a questão cita uma figura que ainda não foi adicionada. O gerador pula
  essas questões até a imagem entrar (em `extras_html`, como `<img src="...">`) e o campo virar `false`.

## correcoes.json — gerado por IA, corrigível

```json
{
  "formato": "crivo-correcoes", "versao": 1, "banca": "AMP", "ano": "2021",
  "correcoes": {
    "AMP-2021-Q1": {
      "tema": "Dermatologia: Ectima",
      "aviso_diretriz": null,
      "gabarito_usado": "A",
      "secoes_html": {"2.1": "<p>...</p>", "...": "...", "2.15": "<p>...</p>"},
      "historico": [{"id": "AMP-2019-Q42", "ano": "2019", "numero": 42, "gabarito": "C",
                     "resumo": "...", "cobrado": "conduta inicial", "resposta": "C (texto da alternativa)",
                     "relacao": "Mesmo tema: ...", "tipo": "mesmo_tema"}],
      "historico_meta": {"questoes_da_banca_avaliadas": 2074, "candidatas_pela_triagem": 150, "relevantes": 9,
                         "anos": ["2006", "2026"], "provas_com_relacionadas": 7, "por_tipo": {"...": 0}},
      "referencias": {"livros": [{"fonte": "Nelson — Tratado de Pediatria", "secao": "Impetigo e ectima"}],
                      "busca_pubmed": "ecthyma children",
                      "artigos": [{"pmid": "...", "titulo": "...", "revista": "...", "ano": "2023", "doi": "..."}]},
      "resolucao_cega": {"alternativa": "A", "concorda_com_gabarito": true},
      "verificacao": {"aprovado": true, "problemas_leves": []},
      "origem": "api_v2", "modelo": "deepseek-flash", "gerado_em": "2026-11-20T03:11:08Z",
      "revisao": {"status": "nao_revisado", "alertas": [], "reportes": [], "reportes_atendidos": []}
    }
  }
}
```

| Campo | Quem escreve | Observação |
|---|---|---|
| `gabarito_usado` | script | Letra para a qual a correção foi escrita. Se for diferente do gabarito oficial, o site mostra o aviso vermelho e o gerador refaz a correção. |
| `historico` | script | Tabela da 2.10. Ano, número e resposta vêm do `questoes.json`; resumo e "o que foi cobrado", do catálogo; a relação, da etapa de relevância. |
| `secoes_html["2.15"]` | script | Livros da lista permitida + artigos reais encontrados no PubMed + links de consulta (UpToDate, MSD, PubMed). |
| `revisao.status` | pessoas / script | `nao_revisado`, `reportado` (será refeita), `revisado_humano` (o gerador nunca sobrescreve). |
| `revisao.reportes` | pessoas | Erros apontados pelos estudantes, ex.: `[{"texto": "a dose da 2.7 está errada: ..."}]`. Na próxima geração, eles são enviados à IA e ao revisor. |
| `revisao.alertas` | script | `ia_discorda_do_gabarito` = a IA, sem ver o gabarito, marcou outra letra; `texto_da_questao_mudou` = o enunciado foi corrigido depois que a correção foi escrita (ela será refeita). |

Correções antigas, convertidas das páginas HTML, têm `origem: "convertido_html_v1"` e não têm os campos de
verificação. Elas são refeitas só se você pedir (`--modo convertidas`) ou se forem reportadas.
