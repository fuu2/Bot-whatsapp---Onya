'use strict';
const path = require('node:path');
const { zoneInfo } = require('./reminder-time');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function number(name, fallback, min, max) {
  const value = process.env[name]?.trim();
  const result = value ? Number(value) : fallback;
  if (!Number.isFinite(result) || result < min || result > max) {
    throw new Error(`${name} harus berupa angka antara ${min} dan ${max}.`);
  }
  return result;
}

function boolean(name, fallback) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (!['true', 'false'].includes(value)) throw new Error(`${name}: gunakan true atau false.`);
  return value === 'true';
}

const reminderTimeZone = process.env.REMINDER_TIMEZONE?.trim() || 'Asia/Jakarta';
zoneInfo(reminderTimeZone);

module.exports = Object.freeze({
  name: process.env.BOT_NAME || 'Onya',
  stickerPack: (process.env.STICKER_PACK || 'Stiker Onya').slice(0, 64),
  stickerAuthor: (process.env.STICKER_AUTHOR || 'Destian').slice(0, 64),
  autoReply: boolean('AUTO_REPLY', true),
  allowGroups: boolean('ALLOW_GROUPS', false),
  cooldownMs: number('COOLDOWN_SECONDS', 2, 0, 60) * 1000,
  maxMediaBytes: number('MAX_MEDIA_MB', 16, 1, 32) * 1024 * 1024,
  maxStickerSeconds: number('MAX_STICKER_SECONDS', 6, 1, 10),
  videoAsDocument: boolean('VIDEO_AS_DOCUMENT', true),
  downloadAsDocument: boolean('DOWNLOAD_AS_DOCUMENT', false),
  reminderTimeZone,
  reminderPath: path.join(__dirname, '..', 'data', 'reminders.json'),
  maxDownloadBytes: number('MAX_DOWNLOAD_MB', 16, 1, 32) * 1024 * 1024,
  downloadTimeoutMs: number('DOWNLOAD_TIMEOUT_SECONDS', 180, 30, 300) * 1000,
  maxDownloadSeconds: number('MAX_DOWNLOAD_SECONDS', 600, 10, 1800),
  ytDlpPath: process.env.YTDLP_PATH || undefined,
  chromePath: process.env.CHROME_PATH || undefined,
  ffmpegPath: process.env.FFMPEG_PATH || undefined,
  authPath: path.join(__dirname, '..', '.wwebjs_auth'),
  cachePath: path.join(__dirname, '..', '.wwebjs_cache')
});
