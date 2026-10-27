'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { createServer } = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { downloadMedia, runYtDlp, getYtDlpPath, DownloadError } = require('../src/downloader');
const { runFfmpeg, getFfmpegPath } = require('../src/media');

// Opsional: jalankan pemasang dulu untuk pengujian CLI asli tanpa akses situs/akun.
test('yt-dlp dan FFmpeg asli memproses MP4 dan MP3 dari server uji lokal', {
  skip: !existsSync(getYtDlpPath()), timeout: 60000
}, async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'onya-cli-test-'));
  let server;
  try {
    // Sumber sengaja bukan H.264, berorientasi portrait dan 60 fps.
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=960x1440:r=60:d=1',
      '-an', '-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p', path.join(folder, 'video.mp4')]);
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:a', 'aac', path.join(folder, 'audio.m4a')]);
    await runFfmpeg(['-i', path.join(folder, 'video.mp4'), '-i', path.join(folder, 'audio.m4a'),
      '-c', 'copy', path.join(folder, 'combined.mp4')]);
    const video = await fs.readFile(path.join(folder, 'video.mp4'));
    const audio = await fs.readFile(path.join(folder, 'audio.m4a'));
    const combined = await fs.readFile(path.join(folder, 'combined.mp4'));
    server = createServer((req, res) => {
      const data = req.url === '/video.mp4' ? video : req.url === '/audio.m4a' ? audio : req.url === '/combined.mp4' ? combined : null;
      if (!data) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Length': data.length, 'Content-Type': req.url.endsWith('.mp4') ? 'video/mp4' : 'audio/mp4' });
      res.end(data);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const scenario of [
      { platform: 'facebook', format: 'mp4', url: 'https://www.facebook.com/reel/123/' },
      { platform: 'youtube', format: 'mp4', url: 'https://youtu.be/BaW_jenozKc' },
      { platform: 'youtube', format: 'mp3', url: 'https://youtu.be/BaW_jenozKc' },
      { platform: 'tiktok', format: 'mp3', url: 'https://www.tiktok.com/@onya/video/123', combined: true },
      { platform: 'tiktok', format: 'mp3', url: 'https://www.tiktok.com/@onya/video/123', silent: true }
    ]) await t.test(`${scenario.platform} ${scenario.format}${scenario.silent ? ' tanpa suara' : ''}`, async () => {
      const videoFormat = { format_id: 'v', url: `${base}/video.mp4`, ext: 'mp4', vcodec: 'mpeg4',
        acodec: 'none', width: 960, height: 1440, filesize: video.length };
      const audioFormat = { format_id: 'a', url: `${base}/audio.m4a`, ext: 'm4a', vcodec: 'none',
        acodec: 'aac', filesize: audio.length };
      const combinedFormat = { ...videoFormat, format_id: 'b', acodec: 'aac',
        url: `${base}/combined.mp4`, filesize: combined.length };
      const infoPath = path.join(folder, 'fixture.json');
      await fs.writeFile(infoPath, JSON.stringify({ id: 'onya-test', title: 'Onya local test',
        extractor: 'test', extractor_key: 'Test', webpage_url: scenario.url, duration: 1, is_live: false,
        // Metadata yang salah tentang audio menguji kegagalan konverter, bukan hanya filter yt-dlp.
        formats: scenario.silent ? [{ ...combinedFormat, url: `${base}/video.mp4`, filesize: video.length }]
          : scenario.combined ? [combinedFormat] : [videoFormat, audioFormat] }));
      let workFolder;
      const task = downloadMedia(scenario.url, scenario.platform, {}, {
        format: scenario.format,
        run: (args, options) => {
          workFolder = options.cwd;
          // Hanya akses situs diganti metadata lokal; konverter memakai argumen produksi penuh.
          if (options.tool === 'ffmpeg') return runYtDlp(args, options);
          if (scenario.platform === 'youtube') assert.ok(args.includes(`node:${process.execPath}`));
          return runYtDlp([...args.slice(0, -2), '--load-info-json', infoPath], options);
        }
      });
      if (scenario.silent) {
        await assert.rejects(task, error => error instanceof DownloadError && /tidak memiliki suara/.test(error.message));
      } else {
        const result = await task;
        assert.equal(result.mimetype, scenario.format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
        assert.equal(result.filename, `onya-${scenario.platform}.${scenario.format}`);
        const output = path.join(folder, `result.${scenario.format}`);
        await fs.writeFile(output, result.buffer);
        await runFfmpeg(['-i', output, ...(scenario.format === 'mp4' ? ['-map', '0:v:0'] : []),
          '-map', '0:a:0', '-f', 'null', '-']);
        if (scenario.format === 'mp4') {
          const inspection = await runYtDlp(['-hide_banner', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], {
            executable: getFfmpegPath(), tool: 'ffmpeg', timeoutMs: 10000
          });
          assert.match(inspection.stderr, /Video: h264 \(Main\).*yuv420p.*720x1080.*30 fps/);
          assert.match(inspection.stderr, /Audio: aac/);
          const atoms = [];
          for (let offset = 0; offset + 8 <= result.buffer.length;) {
            const size = result.buffer.readUInt32BE(offset);
            if (size < 8) break;
            atoms.push(result.buffer.toString('ascii', offset + 4, offset + 8));
            offset += size;
          }
          assert.ok(atoms.indexOf('moov') >= 0 && atoms.indexOf('moov') < atoms.indexOf('mdat'), 'faststart menaruh indeks sebelum isi video');
        }
      }
      await assert.rejects(fs.access(workFolder), { code: 'ENOENT' });
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(folder, { recursive: true, force: true });
  }
});
