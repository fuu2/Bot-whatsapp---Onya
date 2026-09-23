'use strict';
const config = require('../src/config');
const { resolveBrowserPath } = require('../src/browser');
const { runFfmpeg, getFfmpegPath } = require('../src/media');
const { runYtDlp, getYtDlpPath } = require('../src/downloader');

async function main() {
  let failures = 0;
  const check = (label, ok, fix = '') => {
    console.log(`${ok ? 'OK' : 'GAGAL'}: ${label}`);
    if (!ok) { failures++; console.log(`  ${fix}`); }
  };
  check(`Node.js ${process.version}`, Number(process.versions.node.split('.')[0]) >= 22, 'Pasang Node.js 24 LTS dari https://nodejs.org/.');
  check('Sharp tersedia', Boolean(require('sharp').versions.webp), 'Jalankan npm install.');
  check('whatsapp-web.js tersedia', Boolean(require('whatsapp-web.js').Client), 'Jalankan npm install.');
  try {
    await runFfmpeg(['-version'], config.ffmpegPath, 10000);
    check(`FFmpeg tersedia (${getFfmpegPath(config.ffmpegPath)})`, true);
  } catch {
    check('FFmpeg tersedia', false, 'Jalankan npm rebuild ffmpeg-static, atau isi FFMPEG_PATH di .env dengan lokasi ffmpeg.exe.');
  }
  try {
    const result = await runYtDlp(['--ignore-config', '--no-plugin-dirs', '--version'], {
      executable: getYtDlpPath(config.ytDlpPath), timeoutMs: 10000
    });
    check(`yt-dlp tersedia (${result.stdout.trim()})`, true);
  } catch {
    check('yt-dlp tersedia untuk downloader', false, 'Jalankan node scripts/setup-downloader.js. Fitur stiker tetap dapat digunakan tanpa yt-dlp.');
  }
  try {
    const browserPath = resolveBrowserPath({ configuredPath: config.chromePath });
    check(`File browser tersedia (${browserPath})`, true);
  } catch (error) {
    check('File browser tersedia', false, error.message);
  }
  console.log('\nPemeriksaan ini tidak login atau mengirim pesan. Koneksi WhatsApp diuji lewat npm start.');
  process.exitCode = failures ? 1 : 0;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
