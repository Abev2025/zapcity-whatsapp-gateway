import type { IncomingMessage, WhatsAppProvider } from "./provider.ts";
import { config } from "../config.ts";

/**
 * Provider Baileys (WhatsApp Web, número comum).
 * Faz apenas tradução de eventos → IncomingMessage e envio de texto.
 */
export class BaileysProvider implements WhatsAppProvider {
  readonly name = "baileys";
  private socket: any = null;

  private onMessage?: (message: IncomingMessage) => void;

  async connect(onMessage?: (message: IncomingMessage) => void) {
    if (onMessage) this.onMessage = onMessage;
    const baileys: any = await import("@whiskeysockets/baileys");
    const qrcodeMod: any = await import("qrcode-terminal");
    const qrcode = qrcodeMod.default ?? qrcodeMod;
    const { state, saveCreds } = await baileys.useMultiFileAuthState(config.baileysAuthPath);
    let version: any;
    try {
      ({ version } = await baileys.fetchLatestBaileysVersion());
      console.log(`[whatsapp] versão do WhatsApp Web: ${version}`);
    } catch {
      console.warn("[whatsapp] não foi possível obter a versão mais recente; usando padrão do Baileys");
    }
    this.socket = baileys.makeWASocket({ auth: state, ...(version ? { version } : {}) });

    this.socket.ev.on("creds.update", saveCreds);
    this.socket.ev.on("connection.update", (update: any) => {
      const { connection, lastDisconnect, qr } = update ?? {};
      if (qr) {
        console.log("[whatsapp] QR code recebido — escaneie com o app do WhatsApp:");
        qrcode.generate(qr, { small: true });
      }
      if (connection === "open") {
        console.log("[whatsapp] conectado e autenticado");
      }
      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== baileys.DisconnectReason?.loggedOut;
        console.log(`[whatsapp] conexão fechada (code ${statusCode ?? "?"}), reconectar: ${shouldReconnect}`);
        if (shouldReconnect) {
          void this.connect(undefined);
        } else {
          console.error("[whatsapp] sessão encerrada (logged out) — apague o diretório de sessão e faça novo scan.");
        }
      }
    });
    this.socket.ev.on("messages.upsert", async (event: any) => {
      for (const raw of event.messages ?? []) {
        const parsed = await this.toIncoming(raw);
        if (parsed) this.onMessage?.(parsed);
      }
    });
  }

  private async toIncoming(raw: any): Promise<IncomingMessage | null> {
    if (!raw?.message || raw.key?.fromMe) return null;
    const text =
      raw.message.conversation ??
      raw.message.extendedTextMessage?.text ??
      raw.message.imageMessage?.caption ??
      "";
    if (!text) return null;

    const remoteJid: string = raw.key.remoteJid ?? "";
    const isGroup = remoteJid.endsWith("@g.us");
    const senderJid: string = (isGroup ? raw.key.participant : remoteJid) ?? "";
    const contextInfo = raw.message.extendedTextMessage?.contextInfo;

    let isSenderAdmin = false;
    let groupName: string | undefined;
    if (isGroup) {
      try {
        const meta = await this.socket.groupMetadata(remoteJid);
        groupName = meta?.subject;
        isSenderAdmin = !!meta?.participants?.find(
          (p: any) => p.id === senderJid && (p.admin === "admin" || p.admin === "superadmin"),
        );
      } catch {
        // metadados indisponíveis: trata como membro comum
      }
    }

    return {
      provider: this.name,
      messageId: raw.key.id,
      text,
      context: isGroup ? "group" : "private",
      sender: {
        whatsappId: senderJid,
        number: senderJid.replace(/[^0-9]/g, ""),
        displayName: raw.pushName ?? undefined,
      },
      ...(isGroup ? { group: { whatsappGroupId: remoteJid, name: groupName, isSenderAdmin } } : {}),
      mentions: (contextInfo?.mentionedJid ?? []).map((jid: string) => ({
        whatsappId: jid,
        number: jid.replace(/[^0-9]/g, ""),
      })),
    };
  }

  async sendText(chatId: string, text: string) {
    await this.socket.sendMessage(chatId, { text });
  }

  async sendPrivate(whatsappId: string, text: string) {
    await this.socket.sendMessage(whatsappId, { text });
  }

  async disconnect() {
    // NÃO usar logout(): ele invalida a sessão no WhatsApp e exigiria novo scan
    // a cada restart/deploy. Apenas fecha a conexão; as credenciais ficam salvas
    // em BAILEYS_AUTH_PATH (volume persistente).
    try {
      this.socket?.end?.(undefined);
    } catch {
      // ignora erros ao encerrar
    }
    this.socket = null;
  }
}
