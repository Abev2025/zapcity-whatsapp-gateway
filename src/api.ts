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
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`game_api_error_${response.status}:${detail || "empty_response"}`);
  }
  return (await response.json()) as T;
}

export interface BankFollowUp {
  action: "bank";
  kind: "deposit" | "withdraw";
  delayMs: number;
  playerId: string;
  amount: number;
  requestId: string;
  currencySymbol: string;
  senderName: string;
}

export interface HeistFollowUp {
  action: "heist";
  robberyId: string;
  delayMs: number;
  prefix?: string;
}

export interface HeistTickResult {
  ok: boolean;
  texts?: string[];
  done?: boolean;
  robberyId?: string;
  nextDelayMs?: number;
  kind?: string;
}

export interface BotResult {
  ok: boolean;
  ignored?: boolean;
  duplicated?: boolean;
  command: string | null;
  requestId: string;
  reply: {
    text: string;
    visibility: "public" | "private";
    image?: { base64: string; mimetype: string; filename?: string };
    followUp?: BankFollowUp;
    sequence?: { text: string; delayMs: number }[];
    heist?: HeistFollowUp;
  } | null;
  errorCode?: string | null;
  executionMs?: number;
}

export const gameApi = {
  sendMessage: (message: unknown) => call<BotResult>("/api/public/game-bot/message", message),
  /** Segunda etapa do depósito/saque, chamada após o atraso real. */
  finalizeBank: (followUp: BankFollowUp) =>
    call<{ ok: boolean; reply: { text: string; visibility: "public" | "private" } | null }>(
      "/api/public/game-bot/bank-finalize",
      followUp,
    ),
  /** Avança uma etapa do assalto ao Banco Central. */
  heistTick: (input: { action: "heist"; robberyId: string; prefix?: string }) =>
    // Usa o mesmo endpoint das mensagens, já validado continuamente pelo bot.
    // Isso evita que uma regra de publicação/autorização diferente silencie o assalto.
    call<HeistTickResult>("/api/public/game-bot/message", input),
  /** Assaltos ativos, usado pelo condutor da narração. */
  heistScan: () =>
    call<{ ok: boolean; robberies?: { robberyId: string; chatId: string; prefix: string }[] }>(
      "/api/public/game-bot/message",
      { action: "heist-scan" },
    ),
  status: () => call<Record<string, unknown>>("/api/public/game-bot/status", {}),
};
