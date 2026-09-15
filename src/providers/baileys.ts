import type { IncomingMessage, OutgoingImage, WhatsAppProvider } from "./provider.ts";
import { config } from "../config.ts";
import { setConnected, setDisconnected, setQr } from "../qr-state.ts";

const GROUP_META_TTL_MS = 5 * 60 * 1000;
const MAX_GROUP_SEND_ATTEMPTS = 3;

type CachedMeta = { data: any; at: number };

/** Erros de sessão Signal (LID/sender-key) são recuperáveis: metadata + retry. */
function isSessionError(error: unknown): boolean {
  const msg = String((error as Error)?.message ?? error ?? "");
  const name = String((error as Error)?.name ?? "");
  return (
    /no sessions/i.test(msg) ||
    /SessionError/i.test(name) ||
    /session/i.test(msg) && /no |missing|record/i.test(msg)
  );
}

/** Só o sufixo do JID vai para o log; nunca o número/identificador. */
function jidKind(jid?: string): string {
  if (!jid) return "none";
  if (jid.endsWith("@lid")) return "@lid";
  if (jid.endsWith("@s.whatsapp.net")) return "@s.whatsapp.net";
  if (jid.endsWith("@g.us")) return "@g.us";
  return "other";
}

/** Grupo só é logado pelo sufixo + tamanho, sem revelar o ID real. */
function safeChatRef(jid?: string): string {
  if (!jid) return "none";
  const [id, server] = jid.split("@");
  return `<${(id ?? "").length} chars>@${server ?? "?"}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Provider Baileys (WhatsApp Web, número comum).
 * Faz apenas tradução de eventos → IncomingMessage e envio de texto.
 */
export class BaileysProvider implements WhatsAppProvider {
  readonly name = "baileys";
  private socket: any = null;
  private groupMeta = new Map<string, CachedMeta>();

  private onMessage?: (message: IncomingMessage) => void;

  async connect(onMessage?: (message: IncomingMessage) => void) {
    if (onMessage) this.onMessage = onMessage;
    const baileys: any = await import("@whiskeysockets/baileys");
    const qrcodeMod: any = await import("qrcode-terminal");
    const qrcode = qrcodeMod.default ?? qrcodeMod; // mantido como fallback nos logs
    const { state, saveCreds } = await baileys.useMultiFileAuthState(config.baileysAuthPath);
    let version: any;
    try {
      ({ version } = await baileys.fetchLatestBaileysVersion());
      console.log(`[whatsapp] versão do WhatsApp Web: ${version}`);
    } catch {
      console.warn("[whatsapp] não foi possível obter a versão mais recente; usando padrão do Baileys");
    }
    this.socket = baileys.makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      // Deixa o Baileys reaproveitar o metadata em cache ao criar as sessões
      // de grupo (sender-key), evitando "No sessions" no primeiro envio.
      cachedGroupMetadata: async (jid: string) => this.getGroupMetadata(jid).catch(() => undefined),
    });

    this.socket.ev.on("creds.update", saveCreds);
    this.socket.ev.on("groups.update", (updates: any[]) => {
      for (const u of updates ?? []) if (u?.id) this.groupMeta.delete(u.id);
    });
    this.socket.ev.on("group-participants.update", (update: any) => {
      if (update?.id) this.groupMeta.delete(update.id);
    });
    this.socket.ev.on("connection.update", (update: any) => {
      const { connection, lastDisconnect, qr } = update ?? {};
      if (qr) {
        // Salva o QR em memória para a página /whatsapp/qr e também imprime
        // nos logs como fallback.
        setQr(qr);
        console.log("[whatsapp] QR disponível — abra /whatsapp/qr no navegador para escanear");
        try {
          qrcode.generate(qr, { small: true });
        } catch {
          // terminal indisponível: a página web já cobre a exibição
        }
      }
      if (connection === "open") {
        setConnected();
        console.log("[whatsapp] conectado e autenticado");
      }
      if (connection === "close") {
        setDisconnected();
        this.groupMeta.clear();
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

  /** Metadata do grupo com cache curto; força refresh quando pedido. */
  private async getGroupMetadata(groupJid: string, refresh = false): Promise<any | undefined> {
    const cached = this.groupMeta.get(groupJid);
    if (!refresh && cached && Date.now() - cached.at < GROUP_META_TTL_MS) return cached.data;
    const data = await this.socket?.groupMetadata(groupJid);
    if (data) this.groupMeta.set(groupJid, { data, at: Date.now() });
    return data;
  }

  private async toIncoming(raw: any): Promise<IncomingMessage | null> {
    if (!raw?.message || raw.key?.fromMe) return null;
    const text =
      raw.message.conversation ??
      raw.message.extendedTextMessage?.text ??
      raw.message.imageMessage?.caption ??
      "";
    if (!text) return null;

    // remoteJid é sempre o chat de origem (grupo ou privado) e é o que usamos
    // para responder. participant/participantAlt identificam o remetente e
    // podem vir em @lid ou @s.whatsapp.net — preservamos os dois sem converter.
    const remoteJid: string = raw.key.remoteJid ?? "";
    const isGroup = remoteJid.endsWith("@g.us");
    const participant: string | undefined = raw.key.participant ?? undefined;
    const participantAlt: string | undefined =
      raw.key.participantAlt ?? raw.key.participantPn ?? raw.key.participantLid ?? undefined;

    // Para o motor do jogo preferimos a identidade telefônica quando disponível
    // (participantAlt em @s.whatsapp.net), sem inventar conversões de @lid.
    const phoneJid = [participant, participantAlt].find((j) => j?.endsWith("@s.whatsapp.net"));
    const altSenderJid = [participant, participantAlt].find((j) => j?.endsWith("@lid"));
    const senderJid: string = (isGroup ? (phoneJid ?? participant) : remoteJid) ?? "";
    /** JID usado para envio privado (fallback): precisa ser endereçável. */
    const senderAddressable: string = phoneJid ?? participant ?? remoteJid;
    const contextInfo = raw.message.extendedTextMessage?.contextInfo;

    let isSenderAdmin = false;
    let groupName: string | undefined;
    const lidToPhone = new Map<string, string>();
    if (isGroup) {
      try {
        const meta = await this.getGroupMetadata(remoteJid);
        groupName = meta?.subject;
        for (const p of meta?.participants ?? []) {
          const phone = [p.jid, p.id, p.phoneNumber].find((j: string | undefined) => j?.endsWith("@s.whatsapp.net"));
          const lid = [p.lid, p.id].find((j: string | undefined) => j?.endsWith("@lid"));
          if (phone && lid) lidToPhone.set(lid, phone);
        }
        const ids = new Set([participant, participantAlt].filter(Boolean) as string[]);
        isSenderAdmin = !!meta?.participants?.find(
          (p: any) =>
            (ids.has(p.id) || ids.has(p.jid) || ids.has(p.lid)) &&
            (p.admin === "admin" || p.admin === "superadmin"),
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
        number: (phoneJid ?? senderJid).replace(/[^0-9]/g, ""),
        displayName: raw.pushName ?? undefined,
        ...(senderAddressable !== senderJid ? { addressableId: senderAddressable } : {}),
        ...(altSenderJid ? { altWhatsappId: altSenderJid } : {}),
      } as IncomingMessage["sender"],
      ...(isGroup ? { group: { whatsappGroupId: remoteJid, name: groupName, isSenderAdmin } } : {}),
      mentions: (contextInfo?.mentionedJid ?? []).map((jid: string) => {
        // Menções chegam frequentemente em @lid. Traduzimos para o JID
        // telefônico usando os participantes do grupo, sem inventar conversões.
        const resolved = jid.endsWith("@lid") ? (lidToPhone.get(jid) ?? jid) : jid;
        return {
          whatsappId: resolved,
          number: resolved.replace(/[^0-9]/g, ""),
          ...(resolved !== jid ? { altWhatsappId: jid } : {}),
        };
      }),
      // guardado para o envio (não usado pelo motor)
      ...({ _raw: { participant, participantAlt } } as any),
    };
  }

  async sendText(chatId: string, text: string) {
    await this.socket.sendMessage(chatId, { text });
  }

  async sendPrivate(whatsappId: string, text: string) {
    await this.socket.sendMessage(whatsappId, { text });
  }

  /** Envia imagem em memória (Buffer). Não depende de URL pública. */
  async sendImage(chatId: string, image: OutgoingImage, caption?: string) {
    await this.socket.sendMessage(chatId, {
      image: Buffer.from(image.base64, "base64"),
      mimetype: image.mimetype,
      caption,
    });
  }

  /**
   * Resposta pública. Em grupo, garante metadata carregado, usa sempre o
   * remoteJid original (nunca o participant) e trata "No sessions" como erro
   * recuperável, com no máximo 3 tentativas e fallback para o privado.
   */
  async sendPublicReply(message: IncomingMessage, text: string, image?: OutgoingImage) {
    const groupJid = message.group?.whatsappGroupId;
    const send = async (jid: string) => {
      if (image) {
        try {
          await this.sendImage(jid, image, text);
          return;
        } catch (error) {
          // Fallback: mantém o comando funcional só com texto.
          console.warn(`[group-send] falha ao enviar imagem, usando texto (${(error as Error).message})`);
        }
      }
      await this.socket.sendMessage(jid, { text });
    };

    if (!groupJid) {
      await send(message.sender.whatsappId);
      return;
    }

    const raw = (message as any)._raw ?? {};
    const participantType = jidKind(raw.participant);
    const hasAlt = raw.participantAlt ? "sim" : "nao";

    for (let attempt = 1; attempt <= MAX_GROUP_SEND_ATTEMPTS; attempt += 1) {
      let metaLoaded = "nao";
      try {
        const meta = await this.getGroupMetadata(groupJid, attempt > 1);
        metaLoaded = meta ? "sim" : "nao";
      } catch {
        metaLoaded = "nao";
      }
      try {
        await send(groupJid);
        console.log(
          `[group-send] remoteJid=${safeChatRef(groupJid)} participant=${participantType} participantAlt=${hasAlt} metadata=${metaLoaded} tentativa=${attempt} resultado=ok`,
        );
        return;
      } catch (error) {
        const recoverable = isSessionError(error);
        console.warn(
          `[group-send] remoteJid=${safeChatRef(groupJid)} participant=${participantType} participantAlt=${hasAlt} metadata=${metaLoaded} tentativa=${attempt} resultado=erro (${(error as Error).message}) recuperavel=${recoverable}`,
        );
        if (!recoverable || attempt === MAX_GROUP_SEND_ATTEMPTS) {
          if (!recoverable) throw error;
          break;
        }
        this.groupMeta.delete(groupJid);
        await sleep(750 * attempt);
      }
    }

    // Fallback: mantém o jogo utilizável mesmo sem sessão de grupo.
    const privateJid =
      [raw.participantAlt, raw.participant, (message.sender as any).addressableId, message.sender.whatsappId].find(
        (j: string | undefined) => j?.endsWith("@s.whatsapp.net"),
      ) ??
      (message.sender as any).addressableId ??
      message.sender.whatsappId;
    console.warn(
      `[group-send] group_send_fallback_private remoteJid=${safeChatRef(groupJid)} participant=${participantType} participantAlt=${hasAlt} destino=${jidKind(privateJid)}`,
    );
    await send(privateJid);
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
    this.groupMeta.clear();
  }
}
