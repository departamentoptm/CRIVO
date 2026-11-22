/* ============================================================
   CRIVO — Renderizador de questões a partir dos JSONs de prova
   ------------------------------------------------------------
   Lê  dados/indice.json                      (quais bancas/edições existem)
       dados/<BANCA>/<ANO>/questoes.json      (enunciado, alternativas, gabarito — fixo)
       dados/<BANCA>/<ANO>/correcoes.json     (correções — geradas por IA e corrigíveis)
   junta os dois e monta, para cada questão, a MESMA página do template
   (mesmo CSS, mesmos IDs, mesmas funções selectOption/checkAnswer
   e o mesmo protocolo postMessage usado pelo index.html).

   Para mudar o visual de TODAS as questões, edite só este arquivo.
   O bloco CSS abaixo é copiado do "TAMPLATE RESOLUTOR DE QUESTÕES.html".
   ============================================================ */
(function (global) {
    'use strict';

    /* ---------- Configurações (podem ser alteradas sem mexer no resto) ---------- */
    const CONFIG = {
        pastaDados: 'dados',
        // Link do Google Forms para "Reportar erro". Use {id} onde deve entrar o ID da questão
        // (ex.: '...viewform?usp=pp_url&entry.123456={id}'). Vazio = usa e-mail.
        urlReportarErro: '',
        emailContato: 'departamento.ptm@gmail.com',
    };

    const TITULOS_SECOES = {
        '2.1': 'Tema Central e Contextualização',
        '2.2': 'Conceito-Chave e Fisiopatologia',
        '2.3': 'Justificativa da Resposta Correta',
        '2.4': 'Análise dos Distratores',
        '2.5': 'Palavras-Chave e "Pistas" no Enunciado',
        '2.6': 'Algoritmo de Decisão (Raciocínio Clínico Passo a Passo)',
        '2.7': 'Dados para Memorizar (com Contexto)',
        '2.8': 'Near-Neighbours e Diagnósticos Diferenciais',
        '2.9': 'Variações de Abordagem em Provas',
        '2.10': 'Histórico do Tema nas Provas Anteriores',
        '2.11': 'Conexão com Outros Temas',
        '2.12': 'Erro do Usuário e Estratégia de Correção',
        '2.13': 'Conexão com a Prática',
        '2.14': 'Conceitos Relacionados para Revisar',
        '2.15': 'Listagem das Referências',
    };

    const AVISOS_ALERTA = {
        correcao_contradiz_gabarito: 'A explicação abaixo foi escrita para outra alternativa e não corresponde ao gabarito oficial. Ela está na fila para ser refeita: considere apenas o gabarito oficial.',
        ia_discorda_do_gabarito: 'Ao resolver esta questão sem ver o gabarito, a IA chegou a outra alternativa. Pode haver ambiguidade no enunciado ou mudança de conduta desde a prova. Confira com cuidado e reporte se encontrar erro.',
        texto_da_questao_mudou: 'O texto desta questão foi corrigido para ficar igual à prova oficial, e a explicação abaixo foi escrita para a versão antiga. Ela está na fila para ser refeita.',
        aguardando_imagem: 'Esta questão depende de uma imagem que ainda não foi adicionada. A correção pode estar incompleta.',
    };

    /* ---------- Higienização: só tags simples entram na página ---------- */
    const TAGS_OK = new Set(['P', 'STRONG', 'B', 'EM', 'I', 'U', 'BR', 'UL', 'OL', 'LI', 'TABLE', 'THEAD',
        'TBODY', 'TR', 'TH', 'TD', 'SUB', 'SUP', 'SPAN', 'DIV', 'IMG', 'H5', 'A']);
    const ATRIBUTOS_OK = { IMG: ['src', 'alt'], TABLE: ['class'], DIV: ['class'], SPAN: ['class'],
        TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'], A: ['href'] };

    function higienizar(html) {
        if (!html) return '';
        const doc = new DOMParser().parseFromString('<div>' + String(html) + '</div>', 'text/html');
        const raiz = doc.body.firstChild;
        (function limpar(no) {
            for (const filho of Array.from(no.childNodes)) {
                if (filho.nodeType === 3) continue;                       // texto
                if (filho.nodeType !== 1) { filho.remove(); continue; }   // comentários etc.
                if (!TAGS_OK.has(filho.tagName)) {
                    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED'].includes(filho.tagName)) { filho.remove(); continue; }
                    limpar(filho);
                    filho.replaceWith(...Array.from(filho.childNodes));   // mantém o texto, tira a tag
                    continue;
                }
                const ok = ATRIBUTOS_OK[filho.tagName] || [];
                for (const a of Array.from(filho.attributes)) {
                    const v = (a.value || '').trim().toLowerCase();
                    if (!ok.includes(a.name) || v.startsWith('javascript:') || v.startsWith('data:text')) filho.removeAttribute(a.name);
                }
                if (filho.tagName === 'IMG') filho.setAttribute('style', 'max-width:100%; height:auto;');
                if (filho.tagName === 'A') {
                    if (!/^https?:\/\//i.test(filho.getAttribute('href') || '')) filho.removeAttribute('href');
                    filho.setAttribute('target', '_blank'); filho.setAttribute('rel', 'noopener');
                }
                limpar(filho);
            }
        })(raiz);
        return raiz.innerHTML;
    }

    function esc(t) {
        return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /* ---------- Carregamento dos dados (com cache por edição) ---------- */
    const cacheEdicoes = new Map();

    async function carregarIndice() {
        const r = await fetch(`${CONFIG.pastaDados}/indice.json`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status} em ${CONFIG.pastaDados}/indice.json`);
        return r.json();
    }

    async function carregarEdicao(banca, ano) {
        const chave = `${banca}/${ano}`;
        if (!cacheEdicoes.has(chave)) {
            const base = `${CONFIG.pastaDados}/${encodeURIComponent(banca)}/${encodeURIComponent(ano)}`;
            const p = Promise.all([
                fetch(`${base}/questoes.json`, { cache: 'no-cache' })
                    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} em ${chave}/questoes.json`); return r.json(); }),
                // correções são opcionais: sem o arquivo, as questões abrem sem correção
                fetch(`${base}/correcoes.json`, { cache: 'no-cache' })
                    .then(r => r.ok ? r.json() : null).catch(() => null),
            ]).then(([qs, cs]) => juntar(qs, cs));
            cacheEdicoes.set(chave, p);
            p.catch(() => cacheEdicoes.delete(chave));   // erro de rede não fica guardado
        }
        return cacheEdicoes.get(chave);
    }

    /* Junta questão (fixa) + correção (editável) no objeto que a página usa. */
    function juntar(qs, cs) {
        if (!qs || qs.formato !== 'crivo-questoes') throw new Error('questoes.json não está no formato do CRIVO');
        const corr = (cs && cs.formato === 'crivo-correcoes' && cs.correcoes) || {};
        const questoes = qs.questoes.map(q => {
            const c = corr[q.id];
            const alertas = [...((c && c.revisao && c.revisao.alertas) || [])];
            const gab = typeof q.gabarito === 'string' ? q.gabarito : null;
            if (c && gab && c.gabarito_usado && c.gabarito_usado !== gab && !alertas.includes('correcao_contradiz_gabarito'))
                alertas.push('correcao_contradiz_gabarito');
            if (q.imagem_pendente && !alertas.includes('aguardando_imagem')) alertas.push('aguardando_imagem');
            return Object.assign({}, q, {
                tema: (c && c.tema) || q.disciplina || '',
                aviso_diretriz: c ? c.aviso_diretriz : null,
                correcao: c ? { secoes_html: c.secoes_html || {}, historico: c.historico || null, historico_meta: c.historico_meta || null } : null,
                revisao: { status: (c && c.revisao && c.revisao.status) || (c ? 'nao_revisado' : 'sem_correcao'), alertas },
            });
        });
        const ed = { banca: qs.banca, ano: String(qs.ano), questoes };
        ed._porNumero = new Map(questoes.map(q => [String(q.numero), q]));
        return ed;
    }

    /* ---------- Partes da página ---------- */
    function blocoAlternativas(q) {
        return ['A', 'B', 'C', 'D', 'E'].filter(l => q.alternativas && q.alternativas[l] != null).map(l => `
            <div class="option" onclick="selectOption('${l}')">
                <input type="radio" name="answer" id="option${l}" value="${l}">
                <label for="option${l}"><strong>${l}</strong> - ${higienizar(q.alternativas[l])}</label>
            </div>`).join('');
    }

    /* 2.10 no formato exato do template: frase de abertura + tabela (sempre) + parágrafos de análise */
    function tabelaHistorico(linhas, meta) {
        const anos = meta && Array.isArray(meta.anos) && meta.anos.length === 2 ? `${meta.anos[0]}–${meta.anos[1]}` : 'anteriores';
        const tr = (Array.isArray(linhas) && linhas.length) ? linhas.map(h => `
            <tr>
                <td>${esc(h.ano || '')} – Q${esc(h.numero || '')}</td>
                <td>${esc(h.resumo || '')}</td>
                <td>${esc(h.cobrado || '')}</td>
                <td>${esc(h.resposta || (h.gabarito ? h.gabarito : 'Anulada'))}</td>
                <td>${esc(h.relacao || '')}</td>
            </tr>`).join('')
            : '<tr><td colspan="5">Nenhuma outra questão desta banca no acervo foi identificada sobre este tema.</td></tr>';
        return `<p><strong>Questões das provas de ${esc(anos)} que abordaram o mesmo tema:</strong></p>
            <table class="data-table"><thead><tr><th>Ano/Questão</th><th>Enunciado resumido</th>
            <th>O que foi cobrado</th><th>Resposta correta</th><th>Relação com a questão atual</th></tr></thead>
            <tbody>${tr}</tbody></table>`;
    }

    function blocoCorrecao(q) {
        if (!q.correcao) return '<p><em>A correção desta questão ainda está sendo preparada.</em></p>';
        const sec = q.correcao.secoes_html || {};
        let out = '';
        for (let k = 1; k <= 15; k++) {
            const n = `2.${k}`;
            let corpo = higienizar(sec[n] || '');
            if (n === '2.10' && corpo && !/<table/i.test(corpo)) {
                corpo = corpo.replace(/^\s*<p>\s*<strong>\s*Quest[õo]es das provas[^<]*<\/strong>\s*<\/p>/i, '');
                corpo = corpo.replace(/<p>\s*<em>\s*Busca no acervo:[\s\S]*?<\/p>/i, '');
                corpo = tabelaHistorico(q.correcao.historico, q.correcao.historico_meta) + corpo;
            }
            if (!corpo) corpo = '<p><em>Seção ainda não disponível para esta questão.</em></p>';
            out += `<h4>${n} ${esc(TITULOS_SECOES[n])}</h4>\n${corpo}\n`;
        }
        return out;
    }

    function linkReportar(id, banca, ano, numero) {
        if (CONFIG.urlReportarErro) return CONFIG.urlReportarErro.replace('{id}', encodeURIComponent(id));
        const assunto = `CRIVO - erro na questão ${id}`;
        const corpo = `Questão: ${banca} ${ano}, nº ${numero} (${id})\n\nO que está errado:\n\nFonte que confirma (se tiver):\n`;
        return `mailto:${CONFIG.emailContato}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
    }

    function avisosDaQuestao(q, anulada) {
        const alertas = (q.revisao && q.revisao.alertas) || [];
        const itens = [];
        if (anulada) itens.push(['anulada', 'Questão anulada pela banca. Como na prova, a pontuação conta para todos: qualquer alternativa confirmada é registrada como acerto.']);
        for (const a of alertas) if (AVISOS_ALERTA[a]) itens.push([a, AVISOS_ALERTA[a]]);
        return itens.map(([cls, txt]) => `<div class="crivo-aviso crivo-aviso-${esc(cls)}"><strong>Atenção:</strong> ${esc(txt)}</div>`).join('');
    }

    /* ---------- Script que roda dentro da página da questão ---------- */
    function scriptDaPagina(gabarito, anulada) {
        // gabarito vai como JSON para nunca quebrar o JavaScript.
        return `
    let selectedOption = null;
    const correctAnswer = ${JSON.stringify(anulada ? null : gabarito)};
    const questaoAnulada = ${anulada ? 'true' : 'false'};
    const isInIframe = window.parent !== window;

    function notifyParent(type, payload, silent) {
        if (silent || !isInIframe) return;
        try { window.parent.postMessage({ type, payload }, '*'); } catch (e) { }
    }

    function selectOption(option, silent = false) {
        document.querySelectorAll('.option').forEach(opt => opt.classList.remove('selected'));
        const input = document.querySelector('.option input[value="' + option + '"]');
        if (!input) return;
        input.parentElement.classList.add('selected');
        input.checked = true;
        selectedOption = option;
        notifyParent('OPTION_SELECTED', { selected: option }, silent);
    }

    function checkAnswer(silent = false) {
        if (!selectedOption) {
            if (!silent) alert('Por favor, selecione uma opção antes de confirmar.');
            return;
        }
        const submitBtn = document.getElementById('submitBtn');
        const viewCorrectionBtn = document.getElementById('viewCorrectionBtn');
        /* Anulada: como na prova, o ponto vale para todos -> a resposta dada conta como certa. */
        const certa = questaoAnulada ? selectedOption : correctAnswer;
        document.getElementById('correctAnswer').textContent = questaoAnulada ? 'Questão anulada pela banca' : 'Alternativa ' + correctAnswer;
        document.getElementById('userAnswer').textContent = 'Alternativa ' + selectedOption;
        const resultContainer = document.getElementById('resultContainer');
        resultContainer.style.display = 'block';
        if (selectedOption === certa) {
            submitBtn.textContent = 'Resposta Correta!';
            submitBtn.classList.add('correct');
        } else {
            submitBtn.textContent = 'Confirmar Resposta';
            submitBtn.classList.remove('correct');
        }
        viewCorrectionBtn.style.display = 'inline-block';
        viewCorrectionBtn.textContent = 'Visualizar Correção Completa';
        notifyParent('QUESTION_ANSWERED', { selected: selectedOption, correct: certa }, silent);
        resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function showCorrection() {
        const c = document.getElementById('correctionContent');
        const b = document.getElementById('viewCorrectionBtn');
        if (c.style.display === 'none' || c.style.display === '') {
            c.style.display = 'block'; b.textContent = 'Ocultar Correção Completa';
        } else {
            c.style.display = 'none'; b.textContent = 'Visualizar Correção Completa';
        }
    }

    function resetQuiz() {
        selectedOption = null;
        document.querySelectorAll('.option').forEach(opt => opt.classList.remove('selected'));
        document.querySelectorAll('input[name="answer"]').forEach(r => r.checked = false);
        const submitBtn = document.getElementById('submitBtn');
        submitBtn.textContent = 'Confirmar Resposta';
        submitBtn.classList.remove('correct');
        document.getElementById('viewCorrectionBtn').style.display = 'none';
        document.getElementById('resultContainer').style.display = 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    window.addEventListener('message', (event) => {
        if (!isInIframe || event.source !== window.parent) return;
        if (!event.data || event.data.type !== 'RESTORE_STATE') return;
        const { selected, correct } = event.data.payload || {};
        if (selected) {
            selectOption(selected, true);
            if (correct) checkAnswer(true);
        }
    });`;
    }

    const CSS_EXTRA = `
        .crivo-selo { margin: 0 0 15px; padding: 10px 14px; border-radius: 8px; background: #f3eef6;
            color: #4C2D59; font-size: 13px; display: flex; flex-wrap: wrap; gap: 8px 14px;
            align-items: center; justify-content: space-between; }
        .crivo-selo a { color: #A63268; font-weight: 600; text-decoration: none; white-space: nowrap; }
        .crivo-selo a:hover { text-decoration: underline; }
        .crivo-aviso { margin: 15px 0; padding: 12px 15px; border-radius: 0 5px 5px 0;
            background: #fff3cd; border-left: 5px solid #e0a800; color: #5c4400; line-height: 1.5; }
        .crivo-aviso-anulada { background: #e2e3e5; border-left-color: #6c757d; color: #383d41; }
        .crivo-aviso-correcao_contradiz_gabarito { background: #f8d7da; border-left-color: #dc3545; color: #721c24; }
        .crivo-diretriz { margin: 15px 0; padding: 12px 15px; border-radius: 0 5px 5px 0;
            background: #e7f1ff; border-left: 5px solid #007bff; color: #0b3d75; line-height: 1.5; }
        .crivo-aviso-texto_da_questao_mudou { background: #f8d7da; border-left-color: #dc3545; color: #721c24; }`;

    /* ---------- Página completa ---------- */
    function montarPagina(edicao, numero) {
        const q = edicao._porNumero ? edicao._porNumero.get(String(numero))
                                    : edicao.questoes.find(x => String(x.numero) === String(numero));
        if (!q) throw new Error(`Questão ${numero} não existe em ${edicao.banca} ${edicao.ano}.`);
        const gab = typeof q.gabarito === 'string' ? q.gabarito.trim().toUpperCase() : null;
        const anulada = !['A', 'B', 'C', 'D', 'E'].includes(gab);
        const id = q.id || `${edicao.banca}-${edicao.ano}-Q${q.numero}`;
        const diretriz = q.aviso_diretriz
            ? `<div class="crivo-diretriz"><strong>Diretriz atual:</strong> ${higienizar(q.aviso_diretriz)}</div>` : '';
        const origemIA = !!q.correcao && (!q.revisao || q.revisao.status !== 'revisado_humano');

        return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <base href="${esc(document.baseURI)}">
    <title>Questão ${esc(q.numero)}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        html {
            min-height: 100%;
            background: linear-gradient(135deg, #4C2D59, #A63268, #513873) no-repeat center center;
            background-size: 100% 100%;
        }
        body {
            min-height: 100vh;
            background: transparent;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            width: 90%;
            max-width: 800px;
            padding: 30px;
            position: relative;
            overflow: hidden;
        }
        .container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 5px;
            background: linear-gradient(90deg, #4C2D59, #A63268, #513873);
        }
        h1 {
            color: #1a2a6c;
            text-align: center;
            margin-bottom: 10px;
            font-size: 25px;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.1);
        }
        .theme {
            text-align: center;
            color: #6c757d;
            font-size: 16px;
            margin-bottom: 5px;
            font-weight: 600;
        }
        .question-number {
            text-align: center;
            background: #1a2a6c;
            color: white;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 14px;
            display: inline-block;
            margin: 0 auto 20px;
        }
        .question-text {
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 25px;
            color: #333;
        }
        .data-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            background: #f8f9fa;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .data-table th {
            background: #1a2a6c;
            color: white;
            padding: 12px;
            text-align: left;
        }
        .data-table td {
            padding: 12px;
            border-bottom: 1px solid #ddd;
        }
        .data-table tr:nth-child(even) {
            background: #e9ecef;
        }
        .statements {
            margin: 25px 0;
        }
        .statement {
            margin: 15px 0;
            padding: 15px;
            border-left: 4px solid #1a2a6c;
            background: #f8f9fa;
            border-radius: 0 8px 8px 0;
        }
        .options {
            margin: 30px 0;
        }
        .option {
            display: flex;
            align-items: center;
            margin: 15px 0;
            padding: 15px;
            border: 2px solid #e9ecef;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .option:hover {
            border-color: #1a2a6c;
            background: #f0f4ff;
        }
        .option input {
            margin-right: 15px;
            width: 20px;
            height: 20px;
            cursor: pointer;
        }
        .option label {
            cursor: pointer;
            font-size: 16px;
            flex: 1;
        }
        .option.selected {
            border-color: #1a2a6c;
            background: #e6eeff;
            box-shadow: 0 0 10px rgba(26, 42, 108, 0.2);
        }
        .btn-container {
            text-align: center;
            margin: 30px 0;
        }
        .submit-btn {
            background: linear-gradient(90deg, #4C2D59, #A63268, #513873);
            color: white;
            border: none;
            padding: 15px 40px;
            font-size: 18px;
            border-radius: 50px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        }
        .submit-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
        }
        .submit-btn:active {
            transform: translateY(0);
        }
        .submit-btn.correct {
            background: linear-gradient(90deg, #28a745, #20c997);
        }
        .view-correction-btn {
            background: linear-gradient(90deg, #007bff, #6f42c1);
            color: white;
            border: none;
            padding: 15px 40px;
            font-size: 18px;
            border-radius: 50px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
            margin-top: 15px;
            display: none;
        }
        .view-correction-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
        }
        .result-container {
            display: none;
            margin-top: 30px;
            padding: 25px;
            border-radius: 10px;
            background: #f8f9fa;
            border-left: 5px solid #1a2a6c;
        }
        .result-title {
            color: #1a2a6c;
            margin-bottom: 15px;
            font-size: 22px;
        }
        .correct-answer {
            background: #d4edda;
            border-left: 5px solid #28a745;
            padding: 15px;
            margin: 15px 0;
            border-radius: 0 5px 5px 0;
        }
        .user-answer {
            background: #f8d7da;
            border-left: 5px solid #dc3545;
            padding: 15px;
            margin: 15px 0;
            border-radius: 0 5px 5px 0;
        }
        .explanation {
            background: #e9ecef;
            padding: 20px;
            border-radius: 10px;
            margin-top: 20px;
        }
        .explanation h3 {
            color: #1a2a6c;
            margin-bottom: 15px;
        }
        .explanation h4 {
            color: #1a2a6c;
            margin: 20px 0 10px;
            font-size: 17px;
            border-bottom: 1px solid #d0d7e6;
            padding-bottom: 5px;
        }
        .explanation p {
            margin: 10px 0;
            line-height: 1.6;
        }
        .explanation ul {
            margin: 15px 0;
            padding-left: 20px;
        }
        .explanation li {
            margin: 10px 0;
            line-height: 1.6;
        }
        .explanation ol {
            margin: 15px 0;
            padding-left: 20px;
        }
        .explanation table.data-table {
            margin: 15px 0;
            font-size: 14px;
        }
        .reset-btn {
            background: #6c757d;
            color: white;
            border: none;
            padding: 10px 25px;
            border-radius: 5px;
            cursor: pointer;
            margin-top: 15px;
        }
        .reset-btn:hover {
            background: #5a6268;
        }
        @media (max-width: 600px) {
            .container {
                padding: 20px;
                width: 95%;
            }
            h1 {
                font-size: 22px;
            }
            .question-text {
                font-size: 14px;
            }
            .option label {
                font-size: 14px;
            }
        }
    
${CSS_EXTRA}
    </style>
</head>
<body>
    <div class="container" data-questao-id="${esc(id)}">
        <h1>Questão ${esc(q.numero)}</h1>
        <div class="question-text">
            ${higienizar(q.enunciado_html)}
        </div>
        ${higienizar(q.extras_html || '')}
        <div class="options">
            ${blocoAlternativas(q)}
        </div>

        <div class="btn-container">
            <button class="submit-btn" id="submitBtn" onclick="checkAnswer()">Confirmar Resposta</button>
            <button class="view-correction-btn" id="viewCorrectionBtn" onclick="showCorrection()">Visualizar Correção Completa</button>
        </div>

        <div class="result-container" id="resultContainer">
            <h2 class="result-title">Resultado da Questão</h2>
            <div class="correct-answer">
                <strong>Resposta Correta:</strong> <span id="correctAnswer"></span>
            </div>
            <div class="user-answer">
                <strong>Sua Resposta:</strong> <span id="userAnswer"></span>
            </div>
            ${diretriz}
            ${avisosDaQuestao(q, anulada)}
            <div class="explanation" id="correctionContent">
                <h3>Correção da Questão</h3>
                ${origemIA ? `<div class="crivo-selo"><span>Correção gerada por IA, ainda sem revisão humana.</span>
                    <a href="${esc(linkReportar(id, edicao.banca, edicao.ano, q.numero))}" target="_blank" rel="noopener">Reportar erro nesta questão</a></div>` : ''}
                ${blocoCorrecao(q)}
            </div>
            <button class="reset-btn" onclick="resetQuiz()">Refazer Questão</button>
        </div>
    </div>
<script>${scriptDaPagina(gab, anulada)}
</script>
</body>
</html>`;
    }

    async function paginaDaQuestao(banca, ano, numero) {
        return montarPagina(await carregarEdicao(banca, ano), numero);
    }

    global.CrivoRender = { CONFIG, carregarIndice, carregarEdicao, montarPagina, paginaDaQuestao, higienizar };
})(window);
