import { createServer } from "node:http";
import { gameApi } from "./api.ts";
import { config } from "./config.ts";
import { Queue } from "./queue.ts";
import { BaileysProvider } from "./providers/baileys.ts";
import { CloudApiProvider } from "./providers/cloud-api.ts";
import type { IncomingMessage, WhatsAppProvider } from "./providers/provider.ts";
import { renderQrPage } from "./qr-page.ts";
import { getStatus, isQrAvailable } from "./qr-state.ts";

const queue = new Queue();

function buildProvider(): WhatsAppProvider {
  return config.provider === "cloud-api" ? new CloudApiProvider() : new BaileysProvider();
}

function startHttpServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          provider: config.provider,
          whatsapp: getStatus(),
          qrAvailable: isQrAvailable(),
          uptime: process.uptime(),
        }),
      );
      return;
    }

    if (url.pathname === "/whatsapp/qr") {
      try {
        const html = await renderQrPage();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (err) {
        console.error("[gateway] erro ao gerar QR:", err);
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("Erro ao gerar QR Code. Veja os logs.");
      }
      return;
    }

    res.writeHead(404).end();
  });
  // 0.0.0.0: obrigatório para o Railway expor a porta publicamente.
  server.listen(config.port, "0.0.0.0", () =>
    console.log(`[gateway] HTTP em 0.0.0.0:${config.port} (/health e /whatsapp/qr)`),
  );
  return server;
}

async function main() {
  const provider = buildProvider();
  const http = config.provider === "cloud-api" ? null : startHttpServer();
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
    http?.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
