// qr.js — QR code render & scan (MVP)
import QRCode from 'https://esm.sh/qrcode@1.5.3';
import QrScanner from 'https://esm.sh/qr-scanner@1.4.2';

export function drawQr(text, canvas) {
  QRCode.toCanvas(canvas, text, { width: 220, margin: 1 });
}

let scanner = null;
export async function startScan(videoElement, onDecode) {
  if (scanner) await scanner.stop();
  scanner = new QrScanner(videoElement, result => onDecode(result.data), { preferredCamera:'environment' });
  await scanner.start();
}
export async function stopScan() {
  if (scanner) { await scanner.stop(); scanner.destroy(); scanner = null; }
}
