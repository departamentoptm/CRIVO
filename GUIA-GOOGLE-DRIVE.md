# Liberar a sincronização com o Google Drive para todos os alunos

Hoje o app do CRIVO no Google está **em teste**: só as contas cadastradas como "usuários de teste" conseguem
sincronizar. Para qualquer aluno usar, são duas etapas:

1. **Publicar o app** (Parte A, cerca de 10 minutos). Depois disso, qualquer conta Google já consegue sincronizar.
   A tela de permissão do Google mostra o endereço do site, sem o nome e o logo do CRIVO.
2. **Verificar a marca** (Partes B e C). A tela passa a mostrar "CRIVO - UNIOESTE" com o logo. O Google pode
   levar de alguns minutos a 2 ou 3 dias úteis para aprovar.

O CRIVO usa só a permissão `drive.file` (o site enxerga apenas a pasta "CRIVO - Progresso" que ele mesmo cria).
O Google classifica essa permissão como **não sensível**: por isso não é preciso passar pela verificação
completa de app, só pela verificação de marca, se quiser o nome e o logo.

Faça tudo com a conta Google que é **proprietária** do projeto no Google Cloud (o projeto do ID de cliente
`500615111789-…apps.googleusercontent.com`, que está em `js/app/08-google-drive.js`).

## Parte A — Publicar o app

1. Abra <https://console.cloud.google.com>, escolha o projeto do CRIVO e entre em **Google Auth Platform**
   (ou "APIs e serviços → Tela de permissão OAuth", no menu antigo).
2. **Clientes** → abra o cliente "Aplicativo da Web" do CRIVO → em **Origens JavaScript autorizadas** deve
   estar exatamente `https://departamentoptm.github.io` (sem `/CRIVO` e sem barra no fim). Salve.
3. **Acesso a dados** (Data access) → a lista de escopos deve ter **só**
   `https://www.googleapis.com/auth/drive.file`. Se houver outros, remova.
4. **Branding** (Informações da marca):
   - Nome do app: `CRIVO - UNIOESTE`
   - E-mail de suporte do usuário: `departamento.ptm@gmail.com`
   - Logo: envie `img/crivo-logo-120.png` (120 × 120 pixels, deste repositório)
   - Página inicial do app: `https://departamentoptm.github.io/CRIVO/sobre.html`
     (o Google não aceita como página inicial uma página que seja só de login; a "Sobre" descreve o CRIVO)
   - Política de privacidade: `https://departamentoptm.github.io/CRIVO/privacidade.html`
   - Termos de serviço: deixe em branco
   - Domínios autorizados: `departamentoptm.github.io`
   - E-mail do desenvolvedor: `departamento.ptm@gmail.com`
   - Salve.
5. **Público-alvo** (Audience) → Tipo de usuário: **Externo** → Status de publicação: clique em
   **Publicar app** e confirme. O status passa de "Em teste" para **"Em produção"**.
6. Teste com uma conta Google que **não** está na lista de usuários de teste: abra o CRIVO, toque em
   "Sincronizar com Google Drive" e autorize. Deve funcionar.

## Parte B — Comprovar que o site é do CRIVO (Search Console)

O Google pede a verificação do "domínio privado de nível mais alto", que no GitHub Pages é
`departamentoptm.github.io` (a raiz do endereço, não só a pasta `/CRIVO/`). As páginas do CRIVO já têm uma
etiqueta de verificação, mas ela fica em `/CRIVO/`. Para verificar a raiz:

1. No GitHub, crie um repositório **público** na organização `departamentoptm` com o nome exato
   **`departamentoptm.github.io`**.
2. Abra <https://search.google.com/search-console> com a mesma conta do Google Cloud → **Adicionar
   propriedade** → **Prefixo do URL** → `https://departamentoptm.github.io/` → método **Tag HTML** → copie a
   etiqueta `<meta name="google-site-verification" …>` que aparecer.
3. No repositório novo, crie o arquivo `index.html` com o conteúdo abaixo, trocando a linha da etiqueta pela
   que você copiou:

   ```html
   <!DOCTYPE html>
   <html lang="pt-BR">
   <head>
   <meta charset="UTF-8">
   <meta name="google-site-verification" content="COLE_AQUI_O_CODIGO" />
   <meta http-equiv="refresh" content="0; url=/CRIVO/">
   <title>CRIVO - UNIOESTE</title>
   </head>
   <body><p><a href="/CRIVO/">CRIVO - UNIOESTE: banco de questões de residência médica</a></p></body>
   </html>
   ```

4. No repositório novo: **Settings → Pages → Branch: main / (root) → Save**. Espere 1 ou 2 minutos e abra
   `https://departamentoptm.github.io/`: ele deve levar ao CRIVO.
5. Volte ao Search Console e clique em **Verificar**.

## Parte C — Pedir a verificação de marca

1. No Google Cloud → Google Auth Platform → **Central de verificação** (Verification Center) → **Verificar
   marca** (Verify branding).
2. Se o Google pedir explicações, diga que o app usa só `drive.file` para salvar o progresso de estudo do
   próprio aluno numa pasta criada pelo site, e mande o link da política de privacidade.
3. Acompanhe o status na mesma página. Quando aprovado, a tela de permissão mostra o nome e o logo.

## Se algo der errado

| O que aparece | O que fazer |
|---|---|
| "Acesso bloqueado: o app não concluiu o processo de verificação" | O app ainda está "Em teste" (Parte A, passo 5). |
| "Erro 400: redirect_uri_mismatch" ou "origin_mismatch" | Corrija as Origens JavaScript autorizadas (Parte A, passo 2). |
| A janela do Google não abre | O navegador bloqueou pop-ups: permita janelas para o site. O CRIVO agora avisa isso. |
| A verificação de marca diz que a página inicial não é sua | Confira a Parte B (a raiz `https://departamentoptm.github.io/` precisa estar verificada pela mesma conta). |
