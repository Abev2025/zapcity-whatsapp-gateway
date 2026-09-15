import type { IncomingMessage, WhatsAppProvider } from "./provider.ts";

/**
 * Provider Baileys (WhatsApp Web, número comum).
 * Faz apenas tradução de eventos → IncomingMessage e envio de texto.
 */
export class BaileysProvider implements WhatsAppProvider {
  readonly name = "baileys";
  private socket: any = null;

  async connect(onMessage: (message: IncomingMessage) => void) {
    const baileys: any = await import("@whiskeysockets/baileys");
    const { state, saveCreds } = await baileys.useMultiFileAuthState("./.wa-session");
    this.socket = baileys.makeWASocket({ auth: state, printQRInTerminal: true });

    this.socket.ev.on("creds.update", saveCreds);
    this.socket.ev.on("messages.upsert", async (event: any) => {
      for (const raw of event.messages ?? []) {
        const parsed = await this.toIncoming(raw);
        if (parsed) onMessage(parsed);
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
    await this.socket?.logout?.();
    this.socket = null;
  }
}
