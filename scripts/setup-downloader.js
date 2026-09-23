'use strict';
// Pemasangan dilakukan oleh pemilik bot, bukan oleh perintah WhatsApp.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

function assetFor(platform, arch) {
  if (platform === 'win32') return { x64: 'yt-dlp.exe', ia32: 'yt-dlp_x86.exe', arm64: 'yt-dlp_arm64.exe' }[arch];
  if (platform === 'linux') return { x64: 'yt-dlp_linux', arm64: 'yt-dlp_linux_aarch64' }[arch];
  if (platform === 'darwin') return 'yt-dlp_macos';
}

async function response(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Onya-Downloader-Setup',
      Accept: new URL(url).hostname === 'api.github.com' ? 'application/vnd.github+json' : 'application/octet-stream' },
    signal: AbortSignal.timeout(180000)
  });
  if (!res.ok) throw new Error(`Unduhan resmi gagal (HTTP ${res.status}). Coba ulangi nanti.`);
  return res;
}

async function smallText(url) {
  const res = await response(url);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Metadata rilis terlalu besar.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const asset = assetFor(process.platform, process.arch);
  if (!asset) throw new Error('Platform belum didukung pemasang ini. Pasang yt-dlp resmi, lalu isi YTDLP_PATH di .env.');
  console.log('Memeriksa rilis yt-dlp resmi...');
  // Gunakan satu tag agar executable dan checksum berasal dari rilis yang sama.
  const release = JSON.parse(await smallText('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'));
  if (!/^[A-Za-z0-9._-]+$/.test(release.tag_name || '')) throw new Error('Tag rilis tidak valid.');
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${release.tag_name}`;
  const sums = await smallText(`${base}/SHA2-256SUMS`);
  const row = sums.split(/\r?\n/).map(line => line.trim().split(/\s+/))
    .find(parts => parts[1]?.replace(/^\*/, '') === asset);
  if (!row || !/^[a-f0-9]{64}$/i.test(row[0])) throw new Error('Checksum resmi tidak ditemukan.');
  const folder = path.join(__dirname, '..', 'tools');
  await fs.mkdir(folder, { recursive: true });
  const target = path.join(folder, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const temporary = path.join(folder, `yt-dlp-${randomUUID()}.part`);
  try {
    console.log(`Mengunduh yt-dlp ${release.tag_name} (${asset})...`);
    const res = await response(`${base}/${asset}`);
    const file = await fs.open(temporary, 'wx');
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for await (const chunk of res.body) {
        bytes += chunk.length;
        if (bytes > 120 * 1024 * 1024) throw new Error('Executable melebihi batas pemasang.');
        hash.update(chunk);
        await file.writeFile(chunk);
      }
    } finally { await file.close(); }
    if (hash.digest('hex') !== row[0].toLowerCase()) throw new Error('Checksum tidak cocok. File tidak dipasang; jalankan pemasang kembali.');
    await fs.chmod(temporary, 0o755);
    await fs.rename(temporary, target);
    console.log(`Selesai. yt-dlp ${release.tag_name} terpasang dan checksum cocok.`);
    console.log('Jalankan npm.cmd run doctor, lalu npm.cmd start.');
  } finally { await fs.rm(temporary, { force: true }); }
}

if (require.main === module) main().catch(error => {
  console.error(`Pemasangan gagal: ${error.message}`);
  console.error('Alternatif: unduh executable dari https://github.com/yt-dlp/yt-dlp/releases/latest dan tempatkan di folder tools.');
  process.exitCode = 1;
});
module.exports = { assetFor };
