/** Configuração do gateway. Todos os segredos vêm do ambiente do servidor do bot. */
export const config = {
  /** URL base da API do jogo (preview ou produção). */
  apiBaseUrl: process.env["GAME_API_BASE_URL"] ?? "http://localhost:8080",
  /** Mesmo valor de BOT_SERVICE_SECRET guardado no backend do jogo. */
  serviceSecret: process.env["BOT_SERVICE_SECRET"] ?? "",
  /** "baileys" | "cloud-api" */
  provider: process.env["WHATSAPP_PROVIDER"] ?? "baileys",
  /** Diretório onde o Baileys salva a sessão (use um volume em produção). */
  baileysAuthPath: process.env["BAILEYS_AUTH_PATH"] ?? "./.wa-session",
  /** Porta do servidor HTTP (/health e webhooks da Cloud API). */
  port: Number(process.env["PORT"] ?? 8787),
  /** Cloud API (só usado quando provider = cloud-api) */
  cloudApi: {
    token: process.env["WHATSAPP_CLOUD_TOKEN"] ?? "",
    phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"] ?? "",
    verifyToken: process.env["WHATSAPP_VERIFY_TOKEN"] ?? "",
  },
  queue: {
    concurrency: Number(process.env["BOT_QUEUE_CONCURRENCY"] ?? 3),
    maxRetries: Number(process.env["BOT_MAX_RETRIES"] ?? 2),
    retryDelayMs: Number(process.env["BOT_RETRY_DELAY_MS"] ?? 1500),
  },
};

if (!config.serviceSecret) {
  console.warn("[gateway] BOT_SERVICE_SECRET não definido: a API do jogo vai recusar as chamadas.");
}
