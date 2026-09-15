/** Contrato de provider. Trocar Baileys por Cloud API não afeta o motor do jogo. */
export interface IncomingMessage {
  provider: string;
  messageId: string;
  text: string;
  context: "group" | "private";
  sender: { whatsappId: string; number: string; displayName?: string };
  group?: { whatsappGroupId: string; name?: string; isSenderAdmin?: boolean };
  mentions?: { whatsappId: string; number?: string; displayName?: string }[];
  timestamp?: string;
}

export interface OutgoingImage {
  /** PNG/JPEG em base64, gerado pela API do jogo (nunca salvo em disco). */
  base64: string;
  mimetype: string;
  filename?: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  connect(onMessage: (message: IncomingMessage) => void): Promise<void>;
  disconnect(): Promise<void>;
  sendText(chatId: string, text: string): Promise<void>;
  sendPrivate(whatsappId: string, text: string): Promise<void>;
  /**
   * Resposta pública considerando o contexto original da mensagem.
   * Providers podem tratar aqui particularidades de sessão de grupo.
   */
  sendPublicReply?(message: IncomingMessage, text: string, image?: OutgoingImage): Promise<void>;
  /** Envia imagem (Buffer em memória) com legenda. Sem URL pública. */
  sendImage?(chatId: string, image: OutgoingImage, caption?: string): Promise<void>;
}
