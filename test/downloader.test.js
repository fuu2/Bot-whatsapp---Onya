'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { validateUrl, resolveVideoUrl, downloadVideo, runYtDlp, DownloadError } = require('../src/downloader');
const { assetFor } = require('../scripts/setup-downloader');
const tiktok = 'https://www.tiktok.com/@onya/video/1234567890';
const facebook = 'https://www.facebook.com/reel/1234567890/';
// Header MP4 sintetis; test ini menguji pengelolaan file, bukan decoder video.
const mp4 = Buffer.from([0, 0, 0, 20, ...Buffer.from('ftypisom'), 0, 0, 0, 0, 105, 115, 111, 109]);

test('URL resmi video TikTok, Reel Facebook, watch dan tautan pendek diterima', () => {
  for (const url of [tiktok, 'https://vt.tiktok.com/ZSabc/', 'https://vm.tiktok.com/ZMabc/',
    'https://www.tiktok.com/t/ZTabc/', 'https://tiktok.com/@onya/video/1234?foo=1']) {
    assert.ok(validateUrl(url, 'tiktok').startsWith('https://'));
  }
  for (const url of [facebook, 'https://fb.watch/abcDEF/', 'https://m.facebook.com/watch/?v=12345',
    'https://www.facebook.com/share/v/abcDEF/', 'https://www.facebook.com/share/r/abcDEF/',
    'https://www.facebook.com/onya/videos/123456/', 'https://www.facebook.com/video.php?v=123']) {
    assert.ok(validateUrl(url, 'facebook').startsWith('https://'));
  }
  assert.match(validateUrl('https://m.tiktok.com/@onya/video/123', 'tiktok'), /^https:\/\/www\.tiktok/);
});

test('domain palsu, URL lokal, profil, shell payload dan platform yang keliru ditolak', () => {
  for (const input of ['', 'file:///etc/passwd', 'http://localhost/a', 'https://127.0.0.1/a',
    'https://www.tiktok.com.evil.test/@x/video/123', 'https://www.tiktok.com@evil.test/a',
    'https://evil@www.tiktok.com/@x/video/123', 'https://www.tiktok.com:444/@x/video/123',
    'https://www.tiktok.com/@x', `${tiktok} --exec calc`, `${tiktok}\n--exec calc`,
    'https://www.tiktok.com\\@evil.test/a', facebook]) {
    assert.throws(() => validateUrl(input, 'tiktok'), DownloadError);
  }
  for (const input of ['https://www.facebook.com/l.php?u=http://127.0.0.1',
    'https://www.facebook.com/onya', 'https://www.facebook.com/photo.php?fbid=123']) {
    assert.throws(() => validateUrl(input, 'facebook'), DownloadError);
  }
});

test('hasil MP4 dibaca setelah batas ukuran diperiksa dan direktori kerja dibersihkan', async () => {
  let folder;
  const result = await downloadVideo(tiktok, 'tiktok', { maxDownloadBytes: 1024 }, {
    run: async (args, options) => {
      folder = options.cwd;
      assert.equal(args.at(-1), tiktok);
      assert.equal(args.at(-2), '--');
      assert.ok(args.includes('--ignore-config'));
      assert.ok(args.includes('--no-plugin-dirs'));
      assert.equal(options.maxDiskBytes, 3072);
      await fs.writeFile(path.join(folder, 'media.mp4'), mp4);
      await fs.writeFile(path.join(folder, 'media.part'), 'sisa');
      return { stdout: '/path-yang-tidak-dipercaya', stderr: '' };
    }
  });
  assert.deepEqual(result.buffer, mp4);
  assert.equal(result.filename, 'onya-tiktok.mp4');
  await assert.rejects(fs.access(folder), { code: 'ENOENT' });
});

test('tautan pendek Facebook mengikuti redirect resmi dan menghentikan redirect ke domain lain', async () => {
  let cancelled = 0, calls = 0;
  const redirect = location => ({ status: 302, headers: { get: () => location },
    body: { cancel: async () => { cancelled++; } } });
  const url = await resolveVideoUrl('https://fb.watch/abcd/', 'facebook', {
    fetchUrl: async (url, options) => {
      calls++;
      assert.equal(options.redirect, 'manual');
      return redirect(facebook);
    }
  });
  assert.equal(url, facebook);
  assert.equal(cancelled, 1);
  await assert.rejects(resolveVideoUrl('https://www.facebook.com/share/v/abcd/', 'facebook', {
    fetchUrl: async () => { calls++; return redirect('https://127.0.0.1/secret'); }
  }), /HTTPS resmi/);
  assert.equal(calls, 2);
  await assert.rejects(resolveVideoUrl('https://fb.watch/abcd/', 'facebook', {
    fetchUrl: async () => redirect('https://www.facebook.com/login/?next=video')
  }), /meminta login/);
});

test('oversize, format palsu, error proses, dan video tanpa hasil membersihkan file sementara', async () => {
  for (const scenario of ['large', 'invalid', 'failure', 'missing']) {
    let folder;
    await assert.rejects(downloadVideo(facebook, 'facebook', { maxDownloadBytes: 100 }, {
      run: async (args, options) => {
        folder = options.cwd;
        await fs.writeFile(path.join(folder, 'media.part'), 'partial');
        if (scenario === 'failure') throw new DownloadError('contoh error jaringan');
        if (scenario === 'large') await fs.writeFile(path.join(folder, 'media.mp4'), Buffer.alloc(101));
        if (scenario === 'invalid') await fs.writeFile(path.join(folder, 'media.mp4'), '<html>access denied</html>');
        return { stdout: '', stderr: '' };
      }
    }), DownloadError);
    await assert.rejects(fs.access(folder), { code: 'ENOENT' });
  }
});

test('proses eksternal memiliki batas waktu, keluaran, serta pesan instalasi jika tidak tersedia', async () => {
  const config = { executable: process.execPath, timeoutMs: 1000 };
  const result = await runYtDlp(['-e', 'console.log("OK")'], config);
  assert.equal(result.stdout.trim(), 'OK');
  await assert.rejects(runYtDlp(['-e', 'setInterval(() => {}, 1000)'], { ...config, timeoutMs: 100 }), /batas waktu/);
  await assert.rejects(runYtDlp(['-e', 'console.log("x".repeat(4096))'], { ...config, maxOutputBytes: 100 }), /terlalu panjang/);
  await assert.rejects(runYtDlp([], { executable: path.join(os.tmpdir(), 'onya-no-such-executable') }), /belum terpasang/);
});

test('proses dihentikan jika file sementara tumbuh melewati anggaran penyimpanan', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'onya-budget-test-'));
  try {
    await assert.rejects(runYtDlp(['-e', "require('fs').writeFileSync('large.part', Buffer.alloc(4096)); setInterval(() => {}, 1000)"], {
      executable: process.execPath, cwd: folder, timeoutMs: 3000, maxDiskBytes: 100
    }), /File sementara terlalu besar/);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test('error login privat diterjemahkan dan detail teknis hanya ditempatkan pada cause', async () => {
  await assert.rejects(runYtDlp(['-e', 'console.error("ERROR: private video requires login"); process.exit(1)'], {
    executable: process.execPath
  }), error => {
    assert.match(error.message, /akses publik/);
    assert.match(error.cause.message, /private video requires login/);
    return true;
  });
});

test('pemasang memilih executable resmi Windows yang sesuai arsitektur', () => {
  assert.equal(assetFor('win32', 'x64'), 'yt-dlp.exe');
  assert.equal(assetFor('win32', 'arm64'), 'yt-dlp_arm64.exe');
  assert.equal(assetFor('win32', 'ia32'), 'yt-dlp_x86.exe');
  assert.equal(assetFor('other', 'x64'), undefined);
});

test('menutup bot menghentikan proses downloader dan menunggu pembersihan file', async () => {
  const { cancelDownloads } = require('../src/downloader');
  let ready, folder;
  const started = new Promise(resolve => { ready = resolve; });
  const task = downloadVideo(tiktok, 'tiktok', {}, {
    run: (args, options) => {
      folder = options.cwd;
      const job = runYtDlp(['-e', 'setInterval(() => {}, 1000)'], { ...options, executable: process.execPath });
      ready();
      return job;
    }
  });
  const rejected = assert.rejects(task, /bot ditutup/);
  await started;
  await cancelDownloads();
  await rejected;
  await assert.rejects(fs.access(folder), { code: 'ENOENT' });
});
