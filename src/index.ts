import { gameApi } from "./api.ts";
import { config } from "./config.ts";
import { Queue } from "./queue.ts";
import { BaileysProvider } from "./providers/baileys.ts";
import { CloudApiProvider } from "./providers/cloud-api.ts";
import type { IncomingMessage, WhatsAppProvider } from "./providers/provider.ts";

const queue = new Queue();

function buildProvider(): WhatsAppProvider {
  return config.provider === "cloud-api" ? new CloudApiProvider() : new BaileysProvider();
}

async function main() {
  const provider = buildProvider();
  console.log(`[gateway] provider: ${provider.name} · api: ${config.apiBaseUrl}`);

  await provider.connect((message: IncomingMessage) => {
    queue.push(async () => {
      const result = await gameApi.sendMessage(message);
      if (result.ignored || !result.reply) return;

      const chatId = message.group?.whatsappGroupId ?? message.sender.whatsappId;
      if (result.reply.visibility === "private" && message.context === "group") {
        await provider.sendPrivate(message.sender.whatsappId, result.reply.text);
      } else {
        await provider.sendText(chatId, result.reply.text);
      }
    });
  });

  const shutdown = async () => {
    console.log("[gateway] encerrando…");
    await provider.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
