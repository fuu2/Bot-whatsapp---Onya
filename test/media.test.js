'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { toSticker, stickerToImage, stickerToVideo, runFfmpeg } = require('../src/media');
const options = { maxStickerSeconds: 1, ffmpegPath: process.env.FFMPEG_PATH };

test('PNG menjadi stiker 512px, lalu kembali menjadi PNG dengan alpha', async () => {
  const input = await sharp({ create: { width: 320, height: 160, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const sticker = await toSticker(input, 'image/png');
  const meta = await sharp(sticker).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
  assert.ok(sticker.length < 100 * 1024);
  const png = await stickerToImage(sticker);
  const pngMeta = await sharp(png).metadata();
  assert.equal(pngMeta.format, 'png');
  assert.equal(pngMeta.hasAlpha, true);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[info.channels - 1], 0); // Sudut padding tetap transparan.
  await assert.rejects(stickerToVideo(sticker), /tidak bergerak/);
});

test('video menjadi animasi terbatas durasi, animasi kembali menjadi MP4 yang dapat dibaca', { timeout: 120000 }, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'test-bot-wa-'));
  try {
    const input = path.join(folder, 'source.mp4');
    await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=12', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '2', input], options.ffmpegPath);
    const sticker = await toSticker(await fs.readFile(input), 'video/mp4', options);
    const meta = await sharp(sticker, { animated: true }).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.pageHeight, 512);
    assert.ok(meta.pages > 1);
    assert.ok(sticker.length < 500 * 1024);
    const duration = meta.delay.reduce((sum, value) => sum + value, 0);
    assert.ok(duration >= 700 && duration <= 1200, `Durasi salah: ${duration}`);
    const firstFrame = await stickerToImage(sticker);
    assert.equal((await sharp(firstFrame).metadata()).height, 512);
    const mp4 = await stickerToVideo(sticker, options);
    assert.equal(mp4.toString('ascii', 4, 8), 'ftyp');
    const output = path.join(folder, 'roundtrip.mp4');
    await fs.writeFile(output, mp4);
    await runFfmpeg(['-i', output, '-f', 'null', '-'], options.ffmpegPath);
    // GIF masukan dan WebP animasi juga harus tetap bergerak.
    const gif = await sharp(sticker, { animated: true }).gif().toBuffer();
    const fromGif = await toSticker(gif, 'image/gif', options);
    const fromWebp = await toSticker(sticker, 'image/webp', options);
    assert.ok((await sharp(fromGif, { animated: true }).metadata()).pages > 1);
    assert.ok((await sharp(fromWebp, { animated: true }).metadata()).pages > 1);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test('file rusak, audio, dan gambar non-WebP untuk toimg ditolak', async () => {
  await assert.rejects(toSticker(Buffer.from('rusak'), 'image/png'), /tidak valid/);
  await assert.rejects(toSticker(Buffer.from('audio'), 'audio/ogg'), /Audio\/PDF/);
  await assert.rejects(toSticker(Buffer.from('rusak'), 'video/mp4', options), /gagal dikonversi/);
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#00ff00' } }).png().toBuffer();
  await assert.rejects(stickerToImage(png), /stiker WhatsApp/);
});
