# Sistema de Cobrança — Instructiva

Sistema separado, próprio do financeiro, pra recuperação da base inadimplente via WhatsApp
(Cloud API oficial da Meta). Arquitetura em 4 camadas:

1. **IA SDR de Cobrança** — primeiro contato, qualifica e entende o motivo do atraso.
2. **IA Negociadora** — apresenta propostas de pagamento dentro dos limites que você configurar.
3. **Atendente humano** — entra só quando há disputa, negociação fora do limite, ou pedido explícito.
4. **Automação Pós-Acordo** — acompanha as parcelas do acordo, manda lembrete antes do vencimento
   e detecta quebra de acordo automaticamente.

React + Vite no frontend, Node/Express + banco em arquivo JSON no backend (mesmo padrão dos
outros sistemas da Instructiva).

## Login inicial
- Usuário: `financeiro`
- Senha: `admin123`

## Variáveis de ambiente (Railway → Variables)
- `DB_PATH` = `/data/cobranca.json`
- `OPENAI_API_KEY` = chave da OpenAI (as IAs usam `gpt-4o-mini`)
- `GROQ_API_KEY` = opcional, só se quiser transcrição automática de áudios recebidos

## Deploy no Railway
1. Suba estes arquivos num repositório novo no GitHub (ex: `instructiva-cobranca`).
2. No Railway: New Project → Deploy from GitHub repo.
3. Configure as variáveis acima.
4. Crie um **Volume** montado em `/data` (sem ele os dados somem a cada deploy).
5. Em Settings → Networking, clique em **Generate Domain**.
6. Configure o webhook do WhatsApp Cloud API (Meta for Developers → seu app → WhatsApp →
   Configuration) apontando pra `https://SEU-DOMINIO/api/cobranca/webhook`, usando o
   `verifyToken` que aparece em Números → (em breve na tela; por enquanto, `GET /api/cobranca/webhook-info`).

## O que já está pronto (backend 100% funcional)
- Autenticação e equipe (papéis `gerente` e `atendente`).
- Pool de números do WhatsApp Cloud API, com criação/leitura de templates aprovados pela Meta.
- Motor de IA em duas etapas (SDR → Negociadora), com handoff invisível entre elas e pro humano,
  rede de segurança por palavra-chave pra disputa/ameaça/hostilidade, e compliance LGPD/CDC fixo.
- Disparo em massa com fila persistente (sobrevive a reinício), aceitando valor/vencimento/código
  do aluno por contato.
- Funil de cobrança por conversa (não contatado → em conversa → negociando → acordo fechado →
  pago/perdido).
- Registro de acordo (proposto pela IA ou manual) virando parcelas de verdade.
- Automação pós-acordo: `tick()` roda de hora em hora, manda lembrete N dias antes do vencimento
  (via template aprovado) e marca quebra de acordo após a carência configurada — reabrindo a
  conversa pro atendente humano automaticamente.
- Respeito a horário comercial em todo envio automático (disparo e lembretes).

## O que falta no frontend (próxima etapa)
A tela de Conversas, Números e Equipe já funcionam. Faltam as telas de:
- Construtor das IAs (SDR e Negociadora) — treinar persona, playbook, regras de negociação.
- Upload de CSV pra montar a lista de disparo.
- Painel de acordos e parcelas (pós-acordo).

Essas rotas de API já existem e estão testadas — é "só" interface.
