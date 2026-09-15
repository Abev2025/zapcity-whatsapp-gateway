/**
 * Estado em memória do QR Code e da conexão WhatsApp.
 * Nunca persiste nem expõe credenciais — apenas o payload do QR e o status.
 */
let currentQr: string | null = null;
let status: "connected" | "disconnected" = "disconnected";

export function setQr(qr: string) {
  currentQr = qr;
}

export function getQr(): string | null {
  return currentQr;
}

export function setConnected() {
  status = "connected";
  currentQr = null; // limpa o QR após conectar
}

export function setDisconnected() {
  status = "disconnected";
}

export function getStatus() {
  return status;
}

export function isQrAvailable() {
  return currentQr !== null;
}
