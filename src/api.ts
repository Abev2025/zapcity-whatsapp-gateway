import { createHmac } from "node:crypto";
import { config } from "./config.ts";

/**
 * Cliente server-to-server assinado.
 * O gateway nunca fala com o banco: só com /api/public/game-bot/*.
 */
async function call<T>(path: string, payload: unknown): Promise<T> {
  const body = JSON.stringify(payload ?? {});
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", config.serviceSecret).update(`${timestamp}.${body}`).digest("hex");

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bot-timestamp": timestamp,
      "x-bot-signature": signature,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`game_api_error_${response.status}`);
  }
  return (await response.json()) as T;
}

export interface BotResult {
  ok: boolean;
  ignored?: boolean;
  duplicated?: boolean;
  command: string | null;
  requestId: string;
  reply: { text: string; visibility: "public" | "private" } | null;
  errorCode?: string | null;
  executionMs?: number;
}

export const gameApi = {
  sendMessage: (message: unknown) => call<BotResult>("/api/public/game-bot/message", message),
  status: () => call<Record<string, unknown>>("/api/public/game-bot/status", {}),
};
