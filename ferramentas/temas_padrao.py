"""
Lista fixa de temas por disciplina e o tema de cada questão (dados/temas_padrao.json), usada pelo site no
filtro por tema, no painel de desempenho e nos pontos fracos.

Passos (comando: gerar_correcoes.py temas-padrao):
  1. Refaz o catálogo de todas as questões de todas as bancas com a resposta oficial (uma vez por questão).
  2. Para cada disciplina sem lista, pede à IA uma lista de temas baseada no currículo de residência da
     disciplina, com cerca de 1 tema a cada 10 questões (mínimo 6, máximo 25); o acervo só confere a cobertura.
     Uma lista já criada é mantida (use --refazer-listas para refazer; arquivos da versão 1 são refeitos sozinhos).
  3. Encaixa cada questão sem tema num dos temas da lista da disciplina dela (lotes de questões por chamada).
     Nenhum tema é criado automaticamente: cada questão vai para o tema mais próximo da lista da disciplina dela
     (mesmo quando o assunto é de outra disciplina). As questões em que nenhum tema serviu de verdade são
     listadas em relatorios/temas_sem_encaixe.md, para o mantenedor decidir se acrescenta um tema à mão.
A disciplina de cada questão é a mesma do site (exams/disciplinas.json); sem ela, a do questoes.json; sem ela,
a do catálogo.
"""
import datetime as dt
import os
from collections import Counter

VERSAO = 2


def tamanho_da_lista(n_questoes):
    return max(6, min(25, round(n_questoes / 10)))

from crivo_comum import gravar_json, ler_json, listar_edicoes
from historico import prompt, questoes_da_banca, atualizar_catalogo, texto_curto, resposta_correta, impressao


def arq_temas_padrao(dados):
    return os.path.join(dados, "temas_padrao.json")


def bancas_do_acervo(dados):
    return sorted({b for b, _ in listar_edicoes(dados)})


def disciplinas_do_site(dados):
    caminho = os.path.join(os.path.dirname(os.path.abspath(dados)), "exams", "disciplinas.json")
    return ler_json(caminho, {})


def disciplina_de(q, catalogo, site, permitidas):
    y = (site.get(q["banca"]) or {}).get(str(q["ano"]))
    d = None
    if isinstance(y, list):
        n = int(q["numero"]) - 1
        d = y[n] if 0 <= n < len(y) else None
    elif isinstance(y, dict):
        d = y.get(str(q["numero"]))
    for cand in (d, q.get("disciplina"), (catalogo.get(q["id"]) or {}).get("disciplina")):
        if cand and cand in permitidas:
            return cand
    return None


def gerar(dados, cliente, config, log=print, refazer_listas=False):
    permitidas = config.get("disciplinas_permitidas") or []
    site = disciplinas_do_site(dados)
    saida = ler_json(arq_temas_padrao(dados), {"formato": "crivo-temas-padrao", "versao": VERSAO, "disciplinas": {}, "questoes": {}})
    if int(saida.get("versao") or 1) < VERSAO:
        log(f"temas_padrao.json da versão {saida.get('versao') or 1}: refazendo as listas pelo currículo (versão {VERSAO})")
        refazer_listas = True
    if refazer_listas:
        saida["disciplinas"], saida["questoes"] = {}, {}
    saida["versao"] = VERSAO

    # 1. catálogo com a resposta oficial, banca por banca
    todas, catalogo = {}, {}
    for b in bancas_do_acervo(dados):
        tb = questoes_da_banca(dados, b)
        log(f"Catálogo de {b}: conferindo {len(tb)} questões")
        cat = atualizar_catalogo(dados, b, cliente, config, log, ids=list(tb), com_gabarito=True)["questoes"]
        todas.update(tb); catalogo.update(cat)

    # disciplina de cada questão
    por_disc = {}
    for qid, q in todas.items():
        if not (catalogo.get(qid) or {}).get("temas"):
            continue
        d = disciplina_de(q, catalogo, site, permitidas)
        if d:
            por_disc.setdefault(d, []).append(qid)

    # 2. lista de temas de cada disciplina (uma vez)
    sistema_lista = prompt("temas_lista.md", config)
    for d in sorted(por_disc):
        if saida["disciplinas"].get(d):
            continue
        contagem = Counter()
        for qid in por_disc[d]:
            for t in (catalogo[qid].get("temas") or [])[:2]:
                contagem[str(t).strip().lower()] += 1
        frequentes = "\n".join(f"- {t} ({n})" for t, n in contagem.most_common(300))
        alvo = tamanho_da_lista(len(por_disc[d]))
        r = cliente.json("temas", sistema_lista,
                         f"DISCIPLINA: {d}\nQUESTÕES NO ACERVO: {len(por_disc[d])}\nTAMANHO DA LISTA: {alvo} temas "
                         f"(aceitável de {max(6, alvo - 2)} a {min(25, alvo + 2)})\n\n"
                         f"TEMAS DO ACERVO (frequência; só para conferir a cobertura):\n{frequentes}")
        lista = []
        for t in r.get("temas") or []:
            t = " ".join(str(t).split())[:70]
            if t and t.lower() not in [x.lower() for x in lista]:
                lista.append(t)
        if len(lista) < 3:
            log(f"   aviso: a lista de {d} veio vazia ou curta; será tentada de novo na próxima execução")
            continue
        saida["disciplinas"][d] = lista[:min(25, alvo + 2)]
        log(f"   {d}: {len(saida['disciplinas'][d])} temas")
        gravar_json(arq_temas_padrao(dados), saida)

    # 3. tema de cada questão (só as que ainda não têm, ou cujo texto mudou)
    sistema_atrib = prompt("temas_atribuir.md", config)
    sem_encaixe = []
    lote = int(config.get("temas_padrao_por_chamada", 40))
    for d in sorted(por_disc):
        lista = saida["disciplinas"].get(d)
        if not lista:
            continue
        faltam = [qid for qid in por_disc[d]
                  if (saida["questoes"].get(qid) or {}).get("texto") != impressao(todas[qid])
                  or (saida["questoes"].get(qid) or {}).get("disciplina") != d
                  or (saida["questoes"].get(qid) or {}).get("tema") not in lista]
        if not faltam:
            continue
        log(f"   {d}: encaixando {len(faltam)} questão(ões) nos temas")
        numerada = "\n".join(f"{k}. {t}" for k, t in enumerate(lista, 1))
        for i in range(0, len(faltam), lote):
            grupo = faltam[i:i + lote]
            for tentativa in (1, 2):
                linhas = []
                for qid in grupo:
                    c = catalogo.get(qid) or {}
                    linhas.append(f"### {qid}\nResumo: {c.get('resumo', '')}\nTemas: {'; '.join(c.get('temas', [])[:4])}\n"
                                  f"Resposta oficial: {resposta_correta(todas[qid])}\n{texto_curto(todas[qid], 500)}")
                r = cliente.json("temas", sistema_atrib, f"DISCIPLINA: {d}\n\nTEMAS (use o número):\n{numerada}\n\nQUESTÕES:\n"
                                 + "\n\n".join(linhas))
                recebidas = {}
                for x in r.get("atribuicoes") or []:
                    if not isinstance(x, dict) or x.get("id") not in grupo:
                        continue
                    try:
                        n = int(x.get("tema"))
                    except (TypeError, ValueError):
                        continue
                    if 1 <= n <= len(lista):
                        recebidas[x["id"]] = lista[n - 1]
                        if x.get("sem_encaixe") is True:
                            sem_encaixe.append((d, x["id"], lista[n - 1], str(x.get("assunto") or "")[:120]))
                for qid, t in recebidas.items():
                    saida["questoes"][qid] = {"disciplina": d, "tema": t, "texto": impressao(todas[qid])}
                grupo = [qid for qid in grupo if qid not in recebidas]
                if not grupo:
                    break
            if grupo:
                log(f"   aviso: {len(grupo)} questão(ões) de {d} ficaram sem tema; serão tentadas de novo na próxima execução")
            gravar_json(arq_temas_padrao(dados), saida)

    if sem_encaixe:
        pasta = os.path.join(os.path.dirname(os.path.abspath(dados)), "relatorios")
        os.makedirs(pasta, exist_ok=True)
        caminho = os.path.join(pasta, "temas_sem_encaixe.md")
        with open(caminho, "w", encoding="utf-8") as f:
            f.write(f"# Questões sem um tema adequado — {dt.datetime.now(dt.timezone.utc):%d/%m/%Y %H:%M} UTC\n\n"
                    "Cada uma foi colocada no tema mais próximo da lista. Se um assunto se repetir, acrescente um tema à\n"
                    "lista da disciplina em dados/temas_padrao.json (no fim) e rode temas-padrao de novo.\n\n"
                    "| Disciplina | Questão | Tema usado | Assunto da questão |\n|---|---|---|---|\n")
            for d, qid, t, assunto in sorted(sem_encaixe):
                f.write(f"| {d} | {qid} | {t} | {assunto} |\n")
        log(f"   {len(sem_encaixe)} questão(ões) sem um tema adequado: veja {caminho}")
    com_tema = sum(1 for x in saida["questoes"].values() if x.get("tema"))
    log(f"Temas prontos: {len(saida['disciplinas'])} disciplinas, {com_tema} questões com tema "
        f"(de {len(todas)} no acervo). Arquivo: {arq_temas_padrao(dados)}")
    return saida
