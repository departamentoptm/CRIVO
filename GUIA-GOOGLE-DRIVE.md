# Liberar a sincronização com o Google Drive para todos os alunos

Hoje o app do CRIVO no Google está **em teste**: só as contas cadastradas como "usuários de teste" conseguem
sincronizar. Para qualquer aluno usar, são duas etapas:

1. **Publicar o app** (Parte A, cerca de 10 minutos). Depois disso, qualquer conta Google já consegue sincronizar.
   A tela de permissão do Google mostra o endereço do site, sem o nome e o logo do CRIVO.
2. Verificar a marca (opcional, não feito por enquanto; veja o fim deste guia).

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

## Verificação de marca (opcional, não feita)

Sem ela, a tela de permissão do Google mostra o endereço do site no lugar do nome e do logo do CRIVO; a
sincronização funciona do mesmo jeito para qualquer conta. Decidimos não fazê-la por enquanto. Se um dia for
retomada: o Google exige a página inicial na raiz verificada (`https://departamentoptm.github.io/`, num
repositório `departamentoptm.github.io`), com o mesmo nome do app, sem login, explicando a finalidade, e uma
política de privacidade detalhada; depois de verificar o site no Search Console, é preciso esperar 24 horas.

## Se algo der errado

| O que aparece | O que fazer |
|---|---|
| "Acesso bloqueado: o app não concluiu o processo de verificação" | O app ainda está "Em teste" (Parte A, passo 5). |
| "Erro 400: redirect_uri_mismatch" ou "origin_mismatch" | Corrija as Origens JavaScript autorizadas (Parte A, passo 2). |
| A janela do Google não abre | O navegador bloqueou pop-ups: permita janelas para o site. O CRIVO agora avisa isso. |
| A verificação de marca diz que a página inicial não é sua | Confira a Parte B (a raiz `https://departamentoptm.github.io/` precisa estar verificada pela mesma conta). |
