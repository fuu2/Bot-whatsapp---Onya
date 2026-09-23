'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { createServer } = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { downloadVideo, runYtDlp, getYtDlpPath } = require('../src/downloader');
const { runFfmpeg } = require('../src/media');

// Opsional: jalankan pemasang dulu untuk pengujian CLI asli tanpa akses situs/akun.
test('yt-dlp asli mengunduh dan menggabungkan MP4+audio dari server uji lokal', {
  skip: !existsSync(getYtDlpPath()), timeout: 45000
}, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'onya-cli-test-'));
  let server;
  try {
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1',
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'video.mp4')]);
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:a', 'aac', path.join(folder, 'audio.m4a')]);
    const video = await fs.readFile(path.join(folder, 'video.mp4'));
    const audio = await fs.readFile(path.join(folder, 'audio.m4a'));
    server = createServer((req, res) => {
      const data = req.url === '/video.mp4' ? video : req.url === '/audio.m4a' ? audio : null;
      if (!data) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Length': data.length, 'Content-Type': req.url.endsWith('.mp4') ? 'video/mp4' : 'audio/mp4' });
      res.end(data);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const infoPath = path.join(folder, 'fixture.json');
    await fs.writeFile(infoPath, JSON.stringify({ id: 'onya-test', title: 'Onya local test',
      extractor: 'test', extractor_key: 'Test', webpage_url: 'https://www.facebook.com/reel/123/',
      duration: 1, is_live: false, formats: [
        { format_id: 'v', url: `${base}/video.mp4`, ext: 'mp4', vcodec: 'h264', acodec: 'none',
          width: 64, height: 64, filesize: video.length },
        { format_id: 'a', url: `${base}/audio.m4a`, ext: 'm4a', vcodec: 'none', acodec: 'aac', filesize: audio.length }
      ] }));
    let workFolder;
    const result = await downloadVideo('https://www.facebook.com/reel/123/', 'facebook', {}, {
      run: (args, options) => {
        workFolder = options.cwd;
        // Metadata uji menggantikan akses Facebook; opsi download produksi tetap dipakai.
        return runYtDlp([...args.slice(0, -2), '--load-info-json', infoPath], options);
      }
    });
    assert.equal(result.mimetype, 'video/mp4');
    assert.ok(result.buffer.length > video.length);
    const output = path.join(folder, 'merged.mp4');
    await fs.writeFile(output, result.buffer);
    await runFfmpeg(['-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
    await assert.rejects(fs.access(workFolder), { code: 'ENOENT' });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(folder, { recursive: true, force: true });
  }
});
