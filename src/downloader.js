'use strict';
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { getFfmpegPath } = require('./media');

const { DownloadError, validateUrl, resolveVideoUrl } = require('./download-url');
const running = new Set();
const downloads = new Set();
const downloadStop = new AbortController();
let stopping = false;

function getYtDlpPath(customPath) {
  if (customPath) return customPath;
  const bundled = path.join(__dirname, '..', 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  return existsSync(bundled) ? bundled : 'yt-dlp';
}

async function folderSize(folder) {
  let total = 0;
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    try {
      if (entry.isDirectory()) total += await folderSize(file);
      else if (entry.isFile()) total += (await fs.stat(file)).size;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return total;
}

// Hentikan seluruh proses, termasuk FFmpeg anak, sebelum menghapus file sementara.
function stopProcess(child) {
  if (!child.pid) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false });
    killer.on('error', () => { child.kill('SIGKILL'); resolve(); });
    killer.on('close', () => resolve());
  });
}

function runYtDlp(args, { executable, cwd, timeoutMs = 180000, maxDiskBytes, maxOutputBytes = 65536, tool = 'yt-dlp', conversion = 'mp3' } = {}) {
  if (stopping) return Promise.reject(new DownloadError('Downloader sedang dihentikan.'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable || getYtDlpPath(), args, {
      cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '', bytes = 0, failure, stopped, checking = false, finished = false;
    const stop = error => {
      if (failure || finished) return;
      failure = error;
      stopped = stopProcess(child);
    };
    let markFinished;
    const job = { cancel: () => stop(new DownloadError('Unduhan dihentikan karena bot ditutup.')),
      finished: new Promise(resolve => { markFinished = resolve; }) };
    running.add(job);
    const timer = setTimeout(() => stop(new DownloadError('Unduhan melewati batas waktu. Coba video lebih pendek atau ulangi nanti.')), timeoutMs);
    const monitor = maxDiskBytes && cwd ? setInterval(async () => {
      if (checking || failure) return;
      checking = true;
      try {
        if (await folderSize(cwd) > maxDiskBytes) stop(new DownloadError('File sementara terlalu besar. Coba video yang lebih kecil.'));
      } catch (error) { stop(error); }
      finally { checking = false; }
    }, 250) : null;
    const capture = target => chunk => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) return stop(new DownloadError('Respons downloader terlalu panjang. Coba tautan video lain.'));
      if (target === 'out') stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout.on('data', capture('out'));
    child.stderr.on('data', capture('err'));
    child.on('error', error => {
      failure = error.code === 'ENOENT'
        ? new DownloadError(tool === 'ffmpeg'
          ? 'FFmpeg belum ditemukan. Pemilik bot dapat memeriksanya dengan npm.cmd run doctor.'
          : 'Downloader belum terpasang. Pemilik bot perlu menjalankan: node scripts/setup-downloader.js')
        : error;
    });
    child.on('close', async code => {
      finished = true;
      clearTimeout(timer);
      if (monitor) clearInterval(monitor);
      await stopped;
      running.delete(job);
      markFinished();
      if (failure) return reject(failure);
      if (code !== 0) return reject(explainFailure(stderr, tool, conversion));
      resolve({ stdout, stderr });
    });
  });
}

function explainFailure(detail, tool = 'yt-dlp', conversion = 'mp3') {
  let message = 'Video belum bisa diunduh. Pastikan link publik dan dapat dibuka tanpa login. Jika tetap gagal, pemilik bot dapat memperbarui downloader.';
  if (tool === 'ffmpeg') {
    message = conversion === 'mp4'
      ? 'Video gagal disiapkan untuk pemutar WhatsApp. Coba video lain; pemilik bot dapat melihat detail FFmpeg di terminal.'
      : /matches no streams|does not contain any stream/i.test(detail)
      ? 'Video ini tidak memiliki suara yang bisa diubah menjadi MP3.'
      : 'Audio gagal diubah menjadi MP3. Coba video lain; pemilik bot dapat melihat detail di terminal.';
  } else if (/confirm.*(?:bot|age)|challenge|JavaScript runtime|n challenge/i.test(detail)) {
    message = 'YouTube meminta verifikasi atau pemrosesan tambahan. Pemilik bot perlu memperbarui downloader dan memakai Node.js 22 atau lebih baru; jika tetap meminta login, gunakan video publik lain.';
  } else if (/Requested format is not available/i.test(detail)) {
    message = 'Tidak tersedia format yang sesuai dengan batas unduhan. Coba video lain atau video yang lebih kecil.';
  } else if (/private|login|log in|sign in|cookies|not available|unavailable|removed/i.test(detail)) {
    message = 'Video tidak tersedia untuk akses publik, sudah dihapus, atau meminta login. Gunakan tautan video publik lain.';
  } else if (/max-filesize|larger than|too large/i.test(detail)) {
    message = 'Ukuran video melebihi batas downloader. Coba video yang lebih kecil.';
  } else if (/Unsupported URL/i.test(detail)) {
    message = 'Bentuk tautan ini belum didukung. Coba tautan video lengkap melalui Salin tautan di aplikasi.';
  } else if (/ffmpeg|ffprobe/i.test(detail)) {
    message = 'Downloader membutuhkan FFmpeg. Pemilik bot dapat memeriksanya dengan npm.cmd run doctor.';
  }
  return new DownloadError(message, { cause: new Error(String(detail).slice(-3000)) });
}

function buildArguments(url, platform, folder, config, format) {
  const max = config.maxDownloadBytes || 16 * 1024 * 1024;
  const size = `[filesize<=?${max}]`;
  const audio = format === 'mp3';
  const extractors = { tiktok: 'tiktok,vm.tiktok', facebook: 'facebook,facebook:reel', youtube: 'youtube' };
  return [
    '--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--playlist-items', '1',
    '--use-extractors', extractors[platform],
    // YouTube memakai Node yang sama dengan bot. Paket resmi yt-dlp menyertakan EJS.
    ...(platform === 'youtube' ? ['--no-js-runtimes', '--js-runtimes', `node:${process.execPath}`] : []),
    '--no-progress', '--no-colors', '--no-simulate', '--abort-on-error',
    '--socket-timeout', '20', '--retries', '1', '--fragment-retries', '1',
    '--concurrent-fragments', '1', '--limit-rate', '2M', '--max-filesize', String(max),
    '--match-filters', `!is_live & duration <=? ${config.maxDownloadSeconds || 600}`,
    // Audio TikTok bisa menempel pada video; b menjadi cadangan jika ba tidak ada.
    '--format', audio ? `ba${size}/b${size}` : `b[ext=mp4]${size}/bv[ext=mp4]${size}+ba[ext=m4a]${size}`,
    '--format-sort', audio ? 'abr:128,res:360' : 'res:720',
    ...(!audio ? ['--merge-output-format', 'mp4'] : []),
    '--ffmpeg-location', getFfmpegPath(config.ffmpegPath),
    '--output', path.join(folder, `${audio ? 'source' : 'media'}.%(ext)s`), '--print', 'after_move:filepath', '--', url
  ];
}

async function checkedFile(file, max) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > max) {
    throw new DownloadError(`Media kosong atau melebihi batas ${max / 1024 / 1024} MB. Coba video lebih kecil.`);
  }
}

async function doDownloadMedia(input, platform, config = {}, {
  format = 'mp4', run = runYtDlp, tempRoot = os.tmpdir(), onStage = () => {}
} = {}) {
  if (!['mp4', 'mp3'].includes(format)) throw new DownloadError('Pilih format MP4 atau MP3.');
  const deadline = Date.now() + (config.downloadTimeoutMs || 180000);
  const url = await resolveVideoUrl(input, platform, {
    timeoutMs: Math.min(config.downloadTimeoutMs || 180000, 30000), signal: downloadStop.signal
  });
  if (stopping) throw new DownloadError('Unduhan dihentikan karena bot ditutup.');
  const max = config.maxDownloadBytes || 16 * 1024 * 1024;
  const folder = await fs.mkdtemp(path.join(tempRoot, 'onya-download-'));
  try {
    const options = (executable, tool, conversion) => {
      if (stopping) throw new DownloadError('Unduhan dihentikan karena bot ditutup.');
      if (Date.now() >= deadline) throw new DownloadError('Unduhan melewati batas waktu. Coba video lebih pendek.');
      return { executable, tool, conversion, cwd: folder, timeoutMs: deadline - Date.now(), maxDiskBytes: max * 3 };
    };
    const report = await run(buildArguments(url, platform, folder, config, format),
      options(getYtDlpPath(config.ytDlpPath), 'yt-dlp'));
    const noOutput = () => {
      const detail = (report?.stdout || '') + (report?.stderr || '');
      if (/max-filesize|larger than/i.test(detail)) return explainFailure(detail);
      return new DownloadError(`Video tidak menghasilkan media yang sesuai. Batas ${max / 1024 / 1024} MB dan ${config.maxDownloadSeconds || 600} detik; album foto dan siaran langsung belum didukung.`);
    };
    if (format === 'mp3') {
      const sources = (await fs.readdir(folder)).filter(name => /^source\.(?:m4a|mp4|webm|opus|ogg|mp3|aac|wav|flac|mkv|mov|ts)$/i.test(name));
      if (sources.length !== 1) throw noOutput();
      const source = path.join(folder, sources[0]);
      await checkedFile(source, max);
      onStage('mengubah audio menjadi MP3');
      // Konversi langsung: tidak memerlukan ffprobe terpisah dari ffmpeg-static.
      await run(['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-protocol_whitelist', 'file,pipe', '-i', source, '-map', '0:a:0', '-vn', '-sn',
        '-c:a', 'libmp3lame', '-b:a', '128k', '-threads', '2', '-f', 'mp3', path.join(folder, 'media.mp3')],
      options(getFfmpegPath(config.ffmpegPath), 'ffmpeg'));
    }
    // Gunakan nama yang kita tentukan, jangan percaya path dari judul/keluaran situs.
    let file = path.join(folder, `media.${format}`);
    try { await checkedFile(file, max); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw noOutput();
    }
    if (format === 'mp4' && config.downloadAsDocument !== true) {
      onStage('menyiapkan video untuk pemutar WhatsApp');
      const playable = path.join(folder, 'playable.mp4');
      // Semua sumber MP4 dinormalisasi: ekstensi MP4 saja belum menjamin codec H.264.
      // Pertahankan rasio tampilan: sisi panjang <=1280, sisi pendek <=720, tanpa memotong durasi.
      const ratio = 'min(1,min(1280/max(iw*sar,ih),720/min(iw*sar,ih)))';
      const scale = `scale=w='max(2,trunc(iw*sar*${ratio}/2)*2)':h='max(2,trunc(ih*${ratio}/2)*2)',setsar=1`;
      await run(['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '2',
        '-protocol_whitelist', 'file,pipe', '-i', file, '-map', '0:v:0', '-map', '0:a:0?',
        '-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn', '-vf', scale,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-profile:v', 'main',
        '-level:v', '3.1', '-pix_fmt', 'yuv420p', '-r', '30', '-threads', '2',
        '-maxrate', '3000k', '-bufsize', '6000k',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100',
        '-movflags', '+faststart', '-f', 'mp4', playable],
      options(getFfmpegPath(config.ffmpegPath), 'ffmpeg', 'mp4'));
      await checkedFile(playable, max);
      file = playable;
    }
    const buffer = await fs.readFile(file);
    const valid = format === 'mp4'
      ? buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp'
      : buffer.length >= 4 && (buffer.toString('ascii', 0, 3) === 'ID3' || buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    if (!valid) {
      throw new DownloadError(`Hasil unduhan bukan file ${format.toUpperCase()} yang valid. Coba tautan video lain.`);
    }
    return { buffer, mimetype: format === 'mp3' ? 'audio/mpeg' : 'video/mp4', filename: `onya-${platform}.${format}` };
  } finally {
    await fs.rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function downloadMedia(...args) {
  if (stopping) return Promise.reject(new DownloadError('Downloader sedang dihentikan.'));
  const task = doDownloadMedia(...args);
  downloads.add(task);
  task.then(() => downloads.delete(task), () => downloads.delete(task));
  return task;
}

function downloadVideo(input, platform, config, options = {}) {
  return downloadMedia(input, platform, config, { ...options, format: 'mp4' });
}

async function cancelDownloads() {
  stopping = true;
  downloadStop.abort();
  for (const job of running) job.cancel();
  await Promise.allSettled([...downloads, ...[...running].map(job => job.finished)]);
}

module.exports = { DownloadError, validateUrl, resolveVideoUrl, downloadMedia, downloadVideo, getYtDlpPath, runYtDlp, cancelDownloads };
