# Questões que dependem de uma imagem

Arquivo gerado sozinho (ferramentas/gerar_indice.py). Enquanto a imagem não é adicionada, a questão mostra um aviso
antes da resposta e fica fora do simulado, do plano de estudo e das estatísticas.

## Como adicionar a imagem (pelo GitHub, sem programar)
1. Encontre a imagem na prova original (PDF) e salve-a como PNG ou JPG (recorte só a figura).
2. No GitHub, abra a pasta `dados/<BANCA>/<ANO>/img/` → **Add file → Upload files** → envie com o nome
   `Q<NÚMERO>_1.png` (ex.: `Q11_1.png`) → **Commit changes** (crie um ramo e um pull request, se pedir).
3. Abra `dados/<BANCA>/<ANO>/questoes.json` (ícone de lápis), procure `"numero": <NÚMERO>` e:
   - troque `(VER IMAGEM)` (ou o ponto onde a figura entra) por `<img src=\"dados/<BANCA>/<ANO>/img/Q<NÚMERO>_1.png\" alt=\"Figura da questão\">`
     (no arquivo, as aspas da tag levam uma barra antes: `\"`);
   - troque `"imagem_pendente": true` por `"imagem_pendente": false`.
4. Salve (Commit). Depois, rode **Actions → Gerar correções** no modo `pendentes` com essa edição, para refazer a correção.

## Lista (29 questões)

- AMP 2007, questão 6
- AMP 2007, questão 12
- AMP 2007, questão 26
- AMP 2007, questão 74
- AMP 2009, questão 3
- AMP 2010, questão 90
- AMP 2014, questão 11
- AMP 2014, questão 20
- AMP 2014, questão 50
- AMP 2014, questão 51
- AMP 2015, questão 19
- AMP 2015, questão 40
- AMP 2015, questão 90
- AMP 2016, questão 83
- AMP 2017, questão 91
- AMP 2017, questão 95
- AMP 2018, questão 11
- AMP 2018, questão 74
- AMP 2021, questão 18
- AMP 2021, questão 85
- AMP 2022, questão 89
- AMP 2023, questão 38
- AMP 2023, questão 49
- AMP 2023, questão 65
- AMP 2025, questão 29
- AMP 2026, questão 48
- AMP 2026, questão 71
- ENAMED 2025, questão 5
- ENAMED 2026, questão 64
