import { createServer } from "node:http";
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

function startHealthServer() {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", provider: config.provider, uptime: process.uptime() }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(config.port, () => console.log(`[gateway] /health ouvindo na porta ${config.port}`));
  return server;
}

async function main() {
  const provider = buildProvider();
  const health = config.provider === "cloud-api" ? null : startHealthServer();
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
    health?.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
