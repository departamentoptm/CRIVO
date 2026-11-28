# Como enviar uma prova para o CRIVO

Há dois caminhos. O primeiro serve para qualquer estudante; o segundo, para quem ajuda a manter o projeto.

## 1. Pelo formulário (qualquer estudante, sem GitHub)

1. No CRIVO, toque em **📨 Solicitar provas / Ajudar o CRIVO** (tela inicial).
2. Em "Qual o seu objetivo?", escolha a opção de solicitar uma prova.
3. Informe a **banca/instituição** e os **anos** (edições).
4. Envie, se tiver:
   - o **PDF da prova** (o caderno de questões);
   - o **gabarito oficial definitivo** (depois dos recursos). Sem o gabarito oficial a prova não entra: o CRIVO
     nunca usa gabarito de cursinho ou de IA;
   - o **link** de onde os arquivos foram baixados (site da banca), para a equipe conferir a origem.
5. Pronto. A equipe recebe um aviso por e-mail e coloca a prova na fila.

**Dicas:** PDFs com texto selecionável funcionam melhor que fotos ou digitalizações. Provas com figuras
(eletrocardiogramas, imagens) também servem, mas as figuras são conferidas à mão.

## 2. Do formulário ao site (equipe do projeto)

1. **Abra a resposta:** planilha do formulário (conta departamento.ptm@gmail.com) → baixe o PDF e o gabarito
   enviados (ficam no Google Drive dessa conta). Confira se o gabarito é o **oficial definitivo**.
2. **Envie o PDF ao GitHub:** no repositório, abra a pasta `provas/` → entre (ou crie, digitando o nome) na pasta
   da banca, ex.: `provas/SUS-SP/` → **Add file → Upload files** → envie com o nome do ano, ex.: `2024.pdf` →
   **Commit changes**.
3. **Gabarito:** abra `gabarito.json` (ícone de lápis) e acrescente a banca e o ano no mesmo formato das outras:
   ```json
   "SUS-SP": {
     "2024": { "1": "A", "2": "C", "3": "ANULADA" }
   }
   ```
   Use `"ANULADA"`, `"EXCLUIDA"` ou `"ANULADA_ADMINISTRATIVAMENTE"` quando for o caso. Se o gabarito ainda for o
   preliminar, marque a opção "gabarito preliminar" no passo 4.
4. **Importe:** aba **Actions → Importar prova → Run workflow** → banca (ex.: `SUS-SP`) e ano → Run. Sai um pull
   request com as questões e um relatório. Título com "[CONFERIR]" = há itens para olhar antes de aprovar.
5. **Confira e aprove o PR:** abra o relatório (`relatorios/importacao/<BANCA>_<ANO>.md`). Ele mostra palavras que
   sumiram ou apareceram, figuras para conferir e questões não separadas (as dicas de cada caso estão no
   `LEIAME.md`, seção "Adicionar provas novas"). Se estiver tudo certo, **Merge pull request**.
6. **Figuras:** questões que dependem de imagem aparecem em `relatorios/imagens_pendentes.md`, com o passo a passo.
7. **Correções:** **Actions → Gerar correções** → banca, ano, modo `pendentes`, limite e orçamento (o custo é de cerca
   de R$ 7 por prova de 100 questões). O PR das correções é aprovado sozinho e o site é publicado em seguida.
8. **Avise quem pediu** (se deixou e-mail) e marque a resposta como atendida na planilha.
