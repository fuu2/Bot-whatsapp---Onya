'use strict';
const { statSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function isFile(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}

function braveCandidates(platform, env) {
  if (platform === 'win32') {
    const drive = env.SystemDrive || 'C:';
    const roots = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA,
      path.win32.join(drive, '\\Program Files'), path.win32.join(drive, '\\Program Files (x86)')];
    return [...new Set(roots.filter(Boolean).map(root =>
      path.win32.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')))];
  }
  if (platform === 'darwin') {
    const suffix = 'Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
    return [`/${suffix}`, path.posix.join(env.HOME || os.homedir(), suffix)];
  }
  return ['/usr/bin/brave-browser', '/usr/bin/brave', '/opt/brave.com/brave/brave-browser', '/snap/bin/brave'];
}

function resolveBrowserPath({ configuredPath, platform = process.platform, env = process.env, fileExists = isFile } = {}) {
  const custom = String(configuredPath || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  if (custom) {
    if (fileExists(custom)) return custom;
    throw new Error(`CHROME_PATH menunjuk file yang tidak ditemukan: ${custom}\nPerbaiki lokasinya di .env, atau kosongkan CHROME_PATH agar Brave dideteksi otomatis.`);
  }
  const detected = braveCandidates(platform, env).find(fileExists);
  if (detected) return detected;
  throw new Error('Brave tidak ditemukan di lokasi standar. Buka brave://version pada Brave, lalu salin Executable Path ke CHROME_PATH di .env.');
}

function browserLaunchOptions(options) {
  // executablePath selalu diisi supaya Puppeteer tidak mencari Chrome unduhannya.
  return { headless: true, executablePath: resolveBrowserPath(options) };
}

async function mediaPlaybackSupport(page) {
  return page.evaluate(() => {
    const video = document.createElement('video');
    const audio = document.createElement('audio');
    return {
      h264: Boolean(video.canPlayType('video/mp4; codecs="avc1.4D401F"')),
      aac: Boolean(audio.canPlayType('audio/mp4; codecs="mp4a.40.2"')),
      mp3: Boolean(audio.canPlayType('audio/mpeg'))
    };
  });
}

module.exports = { resolveBrowserPath, browserLaunchOptions, mediaPlaybackSupport };
