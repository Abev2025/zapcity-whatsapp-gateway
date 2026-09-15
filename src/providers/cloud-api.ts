import { createServer } from "node:http";
import { config } from "../config.ts";
import type { IncomingMessage, WhatsAppProvider } from "./provider.ts";

/**
 * Provider oficial (WhatsApp Cloud API).
 * Recebe webhooks da Meta e envia mensagens pela Graph API.
 */
export class CloudApiProvider implements WhatsAppProvider {
  readonly name = "cloud-api";
  private server: ReturnType<typeof createServer> | null = null;

  async connect(onMessage: (message: IncomingMessage) => void) {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.searchParams.get("hub.verify_token") === config.cloudApi.verifyToken) {
        res.writeHead(200).end(url.searchParams.get("hub.challenge") ?? "");
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }

      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          for (const message of this.parseWebhook(JSON.parse(body))) onMessage(message);
        } catch (error) {
          console.error("[cloud-api] webhook inválido", (error as Error).message);
        }
        res.writeHead(200).end("ok");
      });
    });

    this.server.listen(config.port, () => console.log(`[cloud-api] webhook ouvindo na porta ${config.port}`));
  }

  private *parseWebhook(payload: any): Generator<IncomingMessage> {
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const msg of change?.value?.messages ?? []) {
          const text = msg?.text?.body ?? msg?.image?.caption ?? "";
          if (!text) continue;
          yield {
            provider: this.name,
            messageId: msg.id,
            text,
            context: "private",
            sender: {
              whatsappId: msg.from,
              number: String(msg.from).replace(/[^0-9]/g, ""),
              displayName: change.value?.contacts?.[0]?.profile?.name,
            },
          };
        }
      }
    }
  }

  private async send(to: string, text: string) {
    await fetch(`https://graph.facebook.com/v20.0/${config.cloudApi.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.cloudApi.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    });
  }

  sendText(chatId: string, text: string) {
    return this.send(chatId, text);
  }

  sendPrivate(whatsappId: string, text: string) {
    return this.send(whatsappId, text);
  }

  async disconnect() {
    this.server?.close();
    this.server = null;
  }
}
