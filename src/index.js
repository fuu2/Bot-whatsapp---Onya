'use strict';
const { installMessageIdCompatibility } = require('./whatsapp-compat');
installMessageIdCompatibility();
console.log('[BOT-COMPAT v2] Perbaikan ID pesan dan kirim media aktif.');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const { createHandler } = require('./handler');
const { cancelDownloads } = require('./downloader');
const { browserLaunchOptions, mediaPlaybackSupport } = require('./browser');
console.log(`[BOT-DOWNLOADER v3] Pengiriman hasil: ${config.downloadAsDocument ? 'dokumen' : 'pemutar video/audio WhatsApp'}.`);

let browserOptions;
try {
  browserOptions = browserLaunchOptions({ configuredPath: config.chromePath });
  console.log(`[BOT-BROWSER] Menggunakan: ${browserOptions.executablePath}`);
} catch (error) {
  console.error(`Bot gagal dimulai: ${error.message}`);
  console.error('Jalankan npm.cmd run doctor untuk memeriksa konfigurasi.');
  process.exit(1);
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'bot-destian', dataPath: config.authPath }),
  webVersionCache: { type: 'local', path: config.cachePath },
  puppeteer: browserOptions
});

let closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(code), 10000);
  deadline.unref();
  await cancelDownloads();
  try { await client.destroy(); } catch { /* Browser mungkin sudah tertutup. */ }
  process.exit(code);
}

client.on('qr', qr => {
  console.log('\nPindai QR ini lewat WhatsApp > Perangkat tertaut > Tautkan perangkat.\n');
  qrcode.generate(qr, { small: true });
});
client.on('authenticated', () => console.log('Login berhasil. Menyiapkan WhatsApp...'));
client.on('ready', async () => {
  console.log(`${config.name} aktif! Kirim !menu dari nomor WhatsApp lain.`);
  try {
    const support = await mediaPlaybackSupport(client.pupPage);
    console.log(`[BOT-CODEC] Browser melaporkan H264=${support.h264}; AAC=${support.aac}; MP3=${support.mp3}.`);
    if (!support.h264 || !support.aac || !support.mp3) {
      console.warn('[BOT-CODEC] Ada codec yang tidak didukung browser ini. Jika pengiriman media gagal, sertakan baris ini dalam laporan.');
    }
  } catch {
    console.warn('[BOT-CODEC] Dukungan codec browser belum bisa diperiksa.');
  }
});
client.on('auth_failure', () => {
  console.error('Login gagal. Periksa Perangkat tertaut lalu jalankan kembali npm start.');
  void shutdown(1);
});
client.on('disconnected', () => {
  console.error('WhatsApp terputus. Periksa internet, lalu jalankan kembali npm start.');
  void shutdown(1);
});
const handler = createHandler({ client, MessageMedia, config });
client.on('message', msg => {
  if (!closing) void handler(msg).catch(error => console.error('Handler gagal:', error.name));
});
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

console.log(`Memulai ${config.name}...`);
client.initialize().catch(error => {
  console.error('Bot gagal dimulai:', error.message);
  console.error('Jalankan npm.cmd run doctor untuk memeriksa Node.js, browser, dan FFmpeg.');
  void shutdown(1);
});
