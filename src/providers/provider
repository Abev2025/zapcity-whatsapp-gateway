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

export interface WhatsAppProvider {
  readonly name: string;
  connect(onMessage: (message: IncomingMessage) => void): Promise<void>;
  disconnect(): Promise<void>;
  sendText(chatId: string, text: string): Promise<void>;
  sendPrivate(whatsappId: string, text: string): Promise<void>;
}
