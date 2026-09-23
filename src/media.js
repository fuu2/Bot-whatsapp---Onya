'use strict';
const sharp = require('sharp');
const { spawn } = require('node:child_process');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sisa ruang disediakan untuk metadata nama paket dari whatsapp-web.js.
const STATIC_LIMIT = 100 * 1024 - 2048;
const ANIMATED_LIMIT = 500 * 1024 - 2048;
const PIXEL_LIMIT = 64 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

class MediaError extends Error {}

function getFfmpegPath(customPath) {
  if (customPath) return customPath;
  try {
    const bundledPath = require('ffmpeg-static');
    if (bundledPath && existsSync(bundledPath)) return bundledPath;
  } catch { /* FFmpeg sistem menjadi alternatif. */ }
  return 'ffmpeg';
}

function runFfmpeg(args, customPath, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(customPath), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], {
      windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-3000); });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error.code === 'ENOENT'
        ? new MediaError('FFmpeg belum tersedia. Pemilik bot perlu menjalankan npm run doctor.')
        : error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new MediaError('Konversi terlalu lama. Coba media yang lebih kecil.'));
      if (code !== 0) {
        const error = new MediaError('Media gagal dikonversi. Coba file JPG, PNG, GIF, atau MP4 yang valid.');
        error.cause = new Error(stderr);
        return reject(error);
      }
      resolve();
    });
  });
}

async function inTempFolder(task) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'bot-wa-'));
  try { return await task(folder); }
  finally { await rm(folder, { recursive: true, force: true }); }
}

function image(buffer, animated = false) {
  return sharp(buffer, { animated, limitInputPixels: PIXEL_LIMIT });
}

async function imageMetadata(buffer) {
  let meta;
  try { meta = await image(buffer, true).metadata(); }
  catch { throw new MediaError('Gambar atau stiker tidak valid, terlalu besar, atau rusak.'); }
  if (!['jpeg', 'png', 'webp', 'gif'].includes(meta.format)) {
    throw new MediaError('Format gambar yang didukung: JPG, PNG, WebP, dan GIF.');
  }
  const pages = meta.pages || 1;
  if (pages > 200 || meta.width * (meta.pageHeight || meta.height) * pages > PIXEL_LIMIT) {
    throw new MediaError('Resolusi atau jumlah frame terlalu besar. Gunakan media yang lebih kecil.');
  }
  return meta;
}

async function staticSticker(buffer) {
  for (const quality of [85, 70, 55, 40, 25, 10]) {
    const output = await image(buffer).rotate()
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality, effort: 4 }).toBuffer();
    if (output.length <= STATIC_LIMIT) return output;
  }
  throw new MediaError('Gambar masih terlalu besar untuk stiker. Coba gambar dengan detail lebih sederhana.');
}

async function animatedSticker(buffer, options) {
  return inTempFolder(async folder => {
    const input = path.join(folder, 'input');
    const output = path.join(folder, 'sticker.webp');
    await writeFile(input, buffer);
    // Adaptasi kualitas dan fps agar ukuran animasi tetap kecil.
    for (const [fps, quality] of [[12, 70], [10, 50], [8, 30], [6, 15]]) {
      const filter = `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,setsar=1`;
      await runFfmpeg([
        '-threads', '2', '-protocol_whitelist', 'file,pipe', '-i', input,
        '-t', String(options.maxStickerSeconds || 6), '-map', '0:v:0', '-an', '-sn',
        '-vf', filter, '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(quality),
        '-compression_level', '4', '-loop', '0', '-threads', '2', '-f', 'webp', output
      ], options.ffmpegPath);
      const result = await readFile(output);
      const meta = await imageMetadata(result);
      if (result.length <= ((meta.pages || 1) > 1 ? ANIMATED_LIMIT : STATIC_LIMIT)) return result;
    }
    throw new MediaError('Animasi masih terlalu besar. Coba video lebih pendek atau gerakan lebih sederhana.');
  });
}

async function toSticker(buffer, mimetype, options = {}) {
  const mime = mimetype.toLowerCase().split(';')[0];
  if (mime.startsWith('video/')) return animatedSticker(buffer, options);
  if (!IMAGE_TYPES.has(mime)) throw new MediaError('Kirim foto, video, atau GIF. Audio/PDF tidak dapat dijadikan stiker.');
  const meta = await imageMetadata(buffer);
  if ((meta.pages || 1) === 1) return staticSticker(buffer);
  // Sharp membaca WebP animasi; tidak semua build FFmpeg dapat membacanya langsung.
  const gif = await image(buffer, true).resize(512, 512, { fit: 'inside' }).gif().toBuffer();
  return animatedSticker(gif, options);
}

async function stickerToImage(buffer) {
  const meta = await imageMetadata(buffer);
  if (meta.format !== 'webp') throw new MediaError('Balas sebuah stiker WhatsApp atau file WebP.');
  return image(buffer).png().toBuffer(); // Frame pertama jika stikernya bergerak.
}

async function stickerToVideo(buffer, options = {}) {
  const meta = await imageMetadata(buffer);
  if (meta.format !== 'webp') throw new MediaError('Balas sebuah stiker WhatsApp atau file WebP.');
  if ((meta.pages || 1) < 2) throw new MediaError('Stiker ini tidak bergerak. Gunakan !toimg.');
  return inTempFolder(async folder => {
    const input = path.join(folder, 'animation.gif');
    const output = path.join(folder, 'sticker.mp4');
    // MP4 tidak menyimpan transparansi; latar transparan diubah menjadi putih.
    await image(buffer, true).resize(512, 512, { fit: 'inside' })
      .flatten({ background: '#ffffff' }).gif().toFile(input);
    await runFfmpeg([
      '-threads', '2', '-protocol_whitelist', 'file,pipe', '-ignore_loop', '1', '-i', input,
      '-t', '10', '-map', '0:v:0', '-an', '-sn', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2:color=white',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-threads', '2', output
    ], options.ffmpegPath);
    return readFile(output);
  });
}

module.exports = { MediaError, toSticker, stickerToImage, stickerToVideo, getFfmpegPath, runFfmpeg };
