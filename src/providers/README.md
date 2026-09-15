# Zap City — Gateway de WhatsApp (Fase 5)

Serviço **independente** do painel. Ele só:

1. escuta mensagens do WhatsApp (Baileys ou Cloud API);
2. traduz para um formato padrão;
3. chama a API assinada do jogo (`/api/public/game-bot/message`);
4. devolve a resposta formatada ao grupo ou ao privado.

Nenhuma regra de dinheiro, XP, inventário, crime, missão, cooldown ou prisão vive aqui.
Tudo isso continua nas funções `game_*` do banco.

## Variáveis de ambiente

| Variável | Descrição |
| --- | --- |
| `GAME_API_BASE_URL` | URL do app (ex.: `https://project--<id>.lovable.app`) |
| `BOT_SERVICE_SECRET` | mesmo segredo guardado no backend do jogo |
| `WHATSAPP_PROVIDER` | `baileys` (padrão) ou `cloud-api` |
| `WHATSAPP_CLOUD_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_VERIFY_TOKEN` | só para Cloud API |
| `BOT_QUEUE_CONCURRENCY` / `BOT_MAX_RETRIES` / `BOT_RETRY_DELAY_MS` | fila e retentativas |

## Segurança

- Autenticação **server-to-server** por HMAC-SHA256 sobre `timestamp.body`,
  com janela de 5 minutos; nunca usa sessão do painel.
- O gateway não tem acesso ao banco nem à chave de serviço do Supabase.
- Cada mensagem carrega `messageId`; o backend grava em `processed_messages`,
  então reenvio/timeout **não** executa a ação duas vezes.

## Rodando

```bash
cd whatsapp-gateway
npm install
GAME_API_BASE_URL=... BOT_SERVICE_SECRET=... npm start
```
