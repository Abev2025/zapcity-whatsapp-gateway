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

const activeHeists = new Set<string>();
let heistScanRunning = false;

/**
 * Conduz um assalto: envia CADA etapa como uma mensagem nova no grupo até o
 * resultado final. Roda fora da fila e é retomado pelo scanner se cair.
 */
async function driveHeist(
  provider: WhatsAppProvider,
  heist: { robberyId: string; chatId: string; prefix: string },
  firstDelayMs = 0,
) {
  if (activeHeists.has(heist.robberyId)) return;
  activeHeists.add(heist.robberyId);
  console.log(`[gateway] assalto conduzido: ${heist.robberyId}`);
  try {
    let delay = firstDelayMs;
    let failures = 0;
    let pendingTexts: string[] = [];
    let pendingDone = false;
    for (let step = 0; step < 200; step += 1) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      try {
        if (!pendingTexts.length) {
          const tick = await gameApi.heistTick({
            action: "heist",
            robberyId: heist.robberyId,
            prefix: heist.prefix,
          });
          pendingTexts = [...(tick.texts ?? [])];
          pendingDone = Boolean(tick.done);
          // Enquanto está em formação, reconsulta em intervalos curtos para
          // /adminiciarfac acordar o fluxo. Durante uma ação, respeita a janela.
          const requestedDelay = Math.max(500, Number(tick.nextDelayMs ?? 2000));
          delay = tick.kind === "waiting" ? Math.min(2000, requestedDelay) : requestedDelay;
        }
        while (pendingTexts.length) {
          await provider.sendText(heist.chatId, pendingTexts[0] ?? "");
          pendingTexts.shift();
          await new Promise((r) => setTimeout(r, 900));
        }
        failures = 0;
        if (pendingDone) break;
      } catch (error) {
        failures += 1;
        console.error("[gateway] falha na etapa do assalto", (error as Error).message);
        if (failures >= 5) break;
        delay = 3000;
      }
    }
  } finally {
    activeHeists.delete(heist.robberyId);
  }
}

/** Procura assaltos ativos a cada 5s e garante que cada um tenha um condutor. */
function startHeistScanner(provider: WhatsAppProvider) {
  const scan = async () => {
    if (heistScanRunning) return;
    heistScanRunning = true;
    try {
      const res = await gameApi.heistScan();
      for (const rb of res.robberies ?? []) {
        if (!activeHeists.has(rb.robberyId)) void driveHeist(provider, rb, 0);
      }
    } catch (error) {
      console.error("[gateway] falha ao procurar assaltos", (error as Error).message);
    } finally {
      heistScanRunning = false;
    }
  };
  void scan();
  setInterval(() => void scan(), 5000);
}

const activeHeliDrops = new Set<string>();
let heliScanRunning = false;

/**
 * Conduz um Drop Helicóptero: anúncio (com a foto), contagem de entrada,
 * início e resultado final — cada etapa como uma mensagem nova no grupo.
 */
async function driveHelicopterDrop(
  provider: WhatsAppProvider,
  drop: { dropId: string; chatId: string; prefix: string },
) {
  if (activeHeliDrops.has(drop.dropId)) return;
  activeHeliDrops.add(drop.dropId);
  console.log(`[gateway] drop helicoptero conduzido: ${drop.dropId}`);
  try {
    let delay = 0;
    let failures = 0;
    for (let step = 0; step < 200; step += 1) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      try {
        const tick = await gameApi.heliTick({ action: "heli", dropId: drop.dropId, prefix: drop.prefix });
        delay = Math.max(1000, Number(tick.nextDelayMs ?? 3000));
        const texts = [...(tick.texts ?? [])];
        let first = true;
        while (texts.length) {
          const text = texts.shift() ?? "";
          if (first && tick.image && provider.sendImage) {
            await provider.sendImage(drop.chatId, tick.image, text);
          } else {
            await provider.sendText(drop.chatId, text);
          }
          first = false;
          if (texts.length) await new Promise((r) => setTimeout(r, 900));
        }
        failures = 0;
        if (tick.done) break;
      } catch (error) {
        failures += 1;
        console.error("[gateway] falha na etapa do drop helicoptero", (error as Error).message);
        if (failures >= 5) break;
        delay = 3000;
      }
    }
  } finally {
    activeHeliDrops.delete(drop.dropId);
  }
}

/** Faz nascer e conduzir os Drops Helicóptero (varredura a cada 20s). */
function startHelicopterScanner(provider: WhatsAppProvider) {
  const scan = async () => {
    if (heliScanRunning) return;
    heliScanRunning = true;
    try {
      const res = await gameApi.heliScan();
      for (const drop of res.drops ?? []) {
        if (!activeHeliDrops.has(drop.dropId)) void driveHelicopterDrop(provider, drop);
      }
    } catch (error) {
      console.error("[gateway] falha ao procurar drops de helicoptero", (error as Error).message);
    } finally {
      heliScanRunning = false;
    }
  };
  void scan();
  setInterval(() => void scan(), 20000);
}

async function main() {
  const provider = buildProvider();
  const http = config.provider === "cloud-api" ? null : startHttpServer();
  console.log(`[gateway] provider: ${provider.name} · api: ${config.apiBaseUrl}`);
  startHeistScanner(provider);
  startHelicopterScanner(provider);

  await provider.connect((message: IncomingMessage) => {
    queue.push(async () => {
      const result = await gameApi.sendMessage(message);
      if (result.ignored || !result.reply) return;

      const chatId = message.group?.whatsappGroupId ?? message.sender.whatsappId;
      const image = result.reply.image;
      const followUp = result.reply.followUp;
      if (result.reply.visibility === "private" && message.context === "group") {
        if (image && provider.sendImage) {
          await provider.sendImage(message.sender.whatsappId, image, result.reply.text);
        } else {
          await provider.sendPrivate(message.sender.whatsappId, result.reply.text);
        }
      } else if (provider.sendPublicReply) {
        // Grupos: metadata + retry de sessão + fallback privado ficam no provider.
        await provider.sendPublicReply(message, result.reply.text, image);
      } else if (image && provider.sendImage) {
        await provider.sendImage(chatId, image, result.reply.text);
      } else {
        await provider.sendText(chatId, result.reply.text);
      }

      // Mensagens com atraso nunca podem bloquear a fila: os jogadores precisam
      // conseguir entrar no roubo e responder às ordens enquanto a contagem corre.
      if (result.reply.sequence?.length) {
        void (async () => {
          for (const step of result.reply?.sequence ?? []) {
            try {
              if (step.delayMs > 0) await new Promise((r) => setTimeout(r, step.delayMs));
              if (result.reply?.visibility === "private" && message.context === "group") {
                await provider.sendPrivate(message.sender.whatsappId, step.text);
              } else if (provider.sendPublicReply) {
                await provider.sendPublicReply(message, step.text);
              } else {
                await provider.sendText(chatId, step.text);
              }
            } catch (error) {
              console.error("[gateway] falha ao enviar etapa da narracao", (error as Error).message);
            }
          }
        })();
      }

      // Assalto ao Banco Central: conduzido pelo scanner (independente da fila).
      if (result.reply.heist) {
        const chat = message.group?.whatsappGroupId ?? message.sender.whatsappId;
        void driveHeist(provider, {
          robberyId: result.reply.heist.robberyId,
          chatId: chat,
          prefix: result.reply.heist.prefix ?? "/",
        }, result.reply.heist.delayMs);
      }

      // Depósito/saque: espera o atraso real (dinheiro segue exposto) e conclui.
      if (followUp) {
        console.log(`[gateway] operacao bancaria agendada: ${followUp.kind} em ${followUp.delayMs}ms`);
        await new Promise((r) => setTimeout(r, followUp.delayMs));
        try {
          const done = await gameApi.finalizeBank(followUp);
          if (done.reply?.text) {
            if (provider.sendPublicReply) await provider.sendPublicReply(message, done.reply.text);
            else await provider.sendText(chatId, done.reply.text);
          }
        } catch (error) {
          console.error("[gateway] falha ao concluir operacao bancaria", (error as Error).message);
          const failure =
            followUp.kind === "deposit"
              ? "❌ *Depósito cancelado*\n\nNão foi possível concluir a operação. Seu dinheiro permaneceu na carteira."
              : "❌ *Saque cancelado*\n\nNão foi possível concluir a operação. Seu dinheiro permaneceu no banco.";
          try {
            if (provider.sendPublicReply) await provider.sendPublicReply(message, failure);
            else await provider.sendText(chatId, failure);
          } catch (sendError) {
            console.error("[gateway] falha ao avisar cancelamento bancario", (sendError as Error).message);
          }
        }
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
