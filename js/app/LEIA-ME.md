# Código do site (js/app)

O `index.html` contém só a estrutura da página. O estilo está em `css/crivo-app.css` e o código, nestes
arquivos, carregados **nesta ordem** pelo `index.html`:

| Arquivo | O que faz |
|---|---|
| `01-estado-dom-utilitarios.js` | variáveis globais, referências aos elementos da página e funções utilitárias |
| `02-progresso-e-identificacao.js` | progresso no navegador, filtros salvos, refazer/resetar, salvar em arquivo, identificação local |
| `03-telas-provas-e-filtros.js` | telas, disciplinas, lista de provas, montagem da lista de questões e seletores de banca/edição/disciplina |
| `04-resolucao-e-navegacao.js` | início da resolução, ponte com a página da questão (iframe), cronômetro, mensagens, navegação, Refazer/Histórico |
| `05-meu-gabarito.js` | tela "Meu gabarito", estatísticas e menu dos grupos |
| `06-grifos-e-anki.js` | grifos e exportação para o Anki |
| `07-compatibilidade-e-interface.js` | compatibilidade com versões antigas do progresso, inicialização, modos do tempo, teclado, ajustes do texto da correção |
| `08-google-drive.js` | sincronização com o Google Drive |
| `09-revisao-espacada-fsrs.js` | revisão espaçada (FSRS-6) e embaralhar |
| `10-inicio-filtros-e-grupos.js` | abertura sem identificação, filtros anteriores, painel "Filtros", tela prévia da revisão, filtro por data e "Refazer grupo" |
| `11-cartoes-dos-grifos.js` | cartões criados a partir dos grifos (frente/verso com o mesmo número): tela com data e calendário (hoje, dias futuros e histórico), revisão com FSRS e exportação de todos para o Anki |
| `13-desempenho-e-plano.js` | tela "Desempenho e plano": gráficos por disciplina e tema com os filtros do Meu gabarito, pontos fracos, evolução semanal e dias seguidos; plano por dias e horários, ritmo até a prova e meta do dia (também na tela inicial) |
| `14-simulado.js` | simulado montado pelo aluno (correção escondida; o relógio só para na pausa por inatividade), resultado com classificação para a revisão e histórico |
| `15-tempo-e-inatividade.js` | relógio de estudo (só com a aba visível), tempo de cada questão (até confirmar + leitura da correção, máx. 20 min), média para o plano e pausa por inatividade (20 min) com a tela embaçada |
| `16-drive-seguranca.js` | aviso flutuante do salvamento na nuvem, restaurar uma cópia do Drive e "Carregar arquivo" com comparação e confirmação (somar, substituir ou cancelar) |
| `17-estatisticas-dos-cartoes.js` | classificação dos cartões como no Anki (novo, aprendendo, reaprendendo, recente, maduro), painel dos cartões (gráficos, True retention e lista), dados de cada cartão e, no Desempenho, mapas de calor, bloco dos cartões e cartões por disciplina e tema |
| `12-aparencia.js` | modo escuro (fundos brancos viram escuros e letras pretas viram claras; as outras cores ficam) e tamanho da letra |

Dados no progresso (`progress`, salvo no navegador, no arquivo e no Drive): `registro` (respostas), `avaliacoes`
(Difícil/Bom/Fácil das questões), `grifados` (grifos), `grifosApagados` (grifos apagados, para não voltarem ao
sincronizar), `cartoes` (texto e revisões de cada cartão), `plano` (plano de estudo), `metaDiaria`, `simulados` (histórico) e `resetados`. O simulado em andamento fica só no navegador (`crivo_simulado_atual`).

Temas: o filtro por tema e o desempenho por tema usam `dados/temas_padrao.json` (lista fixa de temas por
disciplina e o tema de cada questão), gerado pelo Actions > Gerar correções > ação `temas-padrao`. Sem esse
arquivo, o site funciona normalmente, só sem os temas.

## Regras para quem for mexer

- São scripts comuns (não módulos): todos compartilham as mesmas variáveis e funções globais, como se fossem um
  arquivo só. Não há compilação: basta editar e enviar.
- **A ordem importa.** Código que roda no carregamento (fora de funções) só pode usar funções e variáveis dos
  arquivos anteriores ou do próprio arquivo. Dentro de funções chamadas por cliques e eventos, pode usar qualquer
  arquivo.
- Alguns arquivos substituem funções de arquivos anteriores (por exemplo, `salvarBackup = function () {...}`) para
  acrescentar comportamento. Ao mudar uma função, procure (`grep`) se ela é substituída mais adiante.
- Arquivo novo: crie com o próximo número e acrescente a linha `<script src="js/app/NN-nome.js?v=dev"></script>`
  no fim do `index.html`. O `?v=dev` é trocado pelo número do commit na publicação, para os navegadores não
  usarem uma versão velha guardada.

## Testes

`testes/testar_interface.py` abre o site num navegador de verdade (computador e celular) e confere: página inicial,
resolução, resposta e correção, classificação Difícil/Bom/Fácil, grifo, intervalos do FSRS, navegação, painel de
filtros, menu do tempo, Meu gabarito, tela da revisão, cartões dos grifos (revisão nos dois sentidos, Errei,
exportação, cartão sem grifo de origem), mescla da sincronização, modo escuro, tamanho da letra e progresso após
recarregar. Ele roda sozinho no GitHub
(Actions > Validar dados) a cada mudança no site. No computador:

```bash
pip install playwright && python3 -m playwright install chromium
python3 testes/testar_interface.py
```
