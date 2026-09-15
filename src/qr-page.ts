import QRCode from "qrcode";
import { getQr, getStatus } from "./qr-state.ts";

/**
 * Renderiza a página pública /whatsapp/qr.
 * Não expõe auth state, credenciais, tokens ou secrets — apenas o QR (payload
 * efêmero do WhatsApp) ou mensagens de status.
 */
export async function renderQrPage(): Promise<string> {
  const status = getStatus();

  if (status === "connected") {
    return page(`
      <div class="ok">WhatsApp conectado com sucesso ✅</div>
      <p class="sub">Esta sessão fica salva no servidor. Você pode fechar esta página.</p>
    `);
  }

  const qr = getQr();
  if (!qr) {
    return page(`
      <div class="waiting">Aguardando QR Code...</div>
      <p class="sub">A página atualiza automaticamente a cada 10 segundos.</p>
    `);
  }

  const dataUrl = await QRCode.toDataURL(qr, { width: 360, margin: 2 });
  return page(`
    <img src="${dataUrl}" alt="QR Code do WhatsApp" width="360" height="360" />
    <p class="hint">Abra o WhatsApp → Aparelhos conectados → Conectar aparelho</p>
    <p class="sub">A página atualiza automaticamente a cada 10 segundos.</p>
  `);
}

function page(body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="10" />
<title>Conectar WhatsApp — Zap City</title>
<style>
  body { margin:0; min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;
         background:#0b0f1a; color:#e5e9f0; font-family:system-ui, -apple-system, sans-serif; text-align:center; padding:24px; }
  h1 { font-size:1.4rem; margin:0 0 24px; }
  img { background:#fff; border-radius:12px; padding:12px; }
  .hint { font-size:1.1rem; font-weight:600; margin:20px 0 4px; }
  .sub { color:#8b93a5; font-size:.9rem; margin:8px 0 0; }
  .ok { font-size:1.5rem; font-weight:700; color:#34d399; }
  .waiting { font-size:1.3rem; font-weight:600; color:#fbbf24; animation:pulse 1.5s infinite; }
  @keyframes pulse { 50% { opacity:.5; } }
</style>
</head>
<body>
  <h1>Conectar WhatsApp — Zap City</h1>
  ${body}
</body>
</html>`;
}
