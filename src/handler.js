'use strict';
const converters = require('./media');
const downloader = require('./downloader');
const { randomUUID } = require('node:crypto');
const { normalizeMessageId } = require('./whatsapp-compat');
const { ReminderError, reminderConfirmation, reminderList } = require('./reminders');
const { reminderHelp } = require('./reminder-time');
const COMMANDS = new Map([
  ['!menu', 'menu'], ['!help', 'menu'], ['!ping', 'ping'],
  ['!sticker', 'sticker'], ['!stiker', 'sticker'], ['!s', 'sticker'],
  ['!toimg', 'image'], ['!gambar', 'image'], ['!tovideo', 'video'],
  ['!downloader', 'downloadMenu'], ['!tiktok', 'tiktok'], ['!tt', 'tiktok'],
  ['!facebook', 'facebook'], ['!fb', 'facebook'],
  ['!ytmp4', 'ytmp4'], ['!youtube', 'ytmp4'], ['!yt', 'ytmp4'],
  ['!ytmp3', 'ytmp3'], ['!ytaudio', 'ytmp3'],
  ['!ttaudio', 'ttaudio'], ['!tiktokaudio', 'ttaudio'], ['!ttmp3', 'ttaudio'],
  ['!ingatkan', 'reminderCreate'], ['!remind', 'reminderCreate'],
  ['!pengingat', 'reminderList'], ['!reminders', 'reminderList'],
  ['!hapus-pengingat', 'reminderCancel'], ['!batal-pengingat', 'reminderCancel'],
  ['!bantuan-pengingat', 'reminderHelp']
]);
const DOWNLOADS = {
  tiktok: { platform: 'tiktok', label: 'TikTok', format: 'mp4' },
  facebook: { platform: 'facebook', label: 'Facebook', format: 'mp4' },
  ytmp4: { platform: 'youtube', label: 'YouTube', format: 'mp4' },
  ytmp3: { platform: 'youtube', label: 'YouTube', format: 'mp3' },
  ttaudio: { platform: 'tiktok', label: 'TikTok', format: 'mp3' }
};

function downloadMenu(config) {
  return `*Downloader ${config.name}*\n\n` +
    '!tiktok <url> / !tt <url> — Unduh video TikTok\n' +
    '!facebook <url> / !fb <url> — Unduh video atau Reel Facebook\n' +
    '!ytmp4 <url> / !yt <url> — YouTube menjadi MP4\n' +
    '!ytmp3 <url> — Audio YouTube menjadi MP3\n' +
    '!ttaudio <url> / !ttmp3 <url> — Audio video TikTok menjadi MP3\n\n' +
    'Kirim satu tautan video publik setelah perintah.\n' +
    (config.downloadAsDocument === true ? 'Hasil dikirim sebagai dokumen MP4 atau MP3.\n'
      : 'Hasil berupa video atau audio dengan tombol putar di WhatsApp.\n') +
    `File sumber dan hasil maksimal ${(config.maxDownloadBytes || 16 * 1024 * 1024) / 1024 / 1024} MB masing-masing.\n` +
    `Batas durasi ${config.maxDownloadSeconds || 600} detik jika durasi tersedia. Satu unduhan sekaligus.\n` +
    'Gunakan link satu video, termasuk YouTube Shorts. Link channel, playlist, privat, album foto, dan siaran langsung belum didukung.';
}

function menu(config) {
  return `*${config.name}*\n\n` +
    '!menu — Daftar perintah\n!ping — Cek bot\n' +
    '!sticker / !s — Foto, GIF, atau video menjadi stiker\n' +
    '!toimg — Stiker menjadi gambar PNG\n!tovideo — Stiker bergerak menjadi MP4\n' +
    '!downloader — Panduan unduh dari URL\n!tiktok <url> — Unduh video TikTok\n!facebook <url> — Unduh video Facebook\n' +
    '!ytmp4 <url> — Unduh video YouTube\n!ytmp3 <url> — Unduh audio YouTube\n!ttaudio <url> — Unduh audio video TikTok\n' +
    '!ingatkan 07:30 presensi online — Buat pengingat\n!pengingat — Lihat jadwalmu\n' +
    '!hapus-pengingat ID — Batalkan jadwal\n!bantuan-pengingat — Contoh jadwal harian/tanggal\n\n' +
    'Kirim foto/video dengan caption !sticker, atau balas media dengan perintah.\n' +
    `Video: ${config.maxStickerSeconds} detik pertama, tanpa suara. Maksimal media ${config.maxMediaBytes / 1024 / 1024} MB.\n` +
    'Untuk mengubah stiker, balas stikernya dengan !toimg atau !tovideo.';
}

function autoReply(body, config) {
  if (/\b(ass?alamu['’]?alaikum|salam)\b/i.test(body)) {
    return `Waalaikumsalam! Saya ${config.name}. Ketik !menu untuk melihat fitur.`;
  }
  if (/\b(hai|halo|hello|hi|pagi|siang|sore|malam)\b/i.test(body)) {
    return `Halo! Saya ${config.name}. Saya bisa membuat stiker, mengunduh media, dan mengingatkan jadwalmu. Ketik !menu untuk melihat perintah.`;
  }
  if (/\b(terima kasih|makasih|thanks)\b/i.test(body)) return 'Sama-sama!';
  return `Pesanmu sudah diterima oleh ${config.name}. Ini balasan otomatis. Ketik !menu untuk melihat perintah.`;
}

// Diagnosis lokal: tidak mencetak objek pesan, base64, atau URL unduhan media.
function errorDetails(error) {
  const detail = error?.stack || error?.message || String(error);
  return String(detail)
    .replace(/https?:\/\/[^\s)]+/gi, '[URL]')
    .replace(/\b\d+(?:[-:]\d+)*@(?:c\.us|g\.us|lid)\b/g, '[CHAT]')
    .replace(/[A-Za-z0-9+/=_-]{160,}/g, '[DATA]')
    .slice(0, 5000);
}

// Client, MessageMedia, dan konverter dapat diganti dengan simulasi saat pengujian.
function createHandler({ client, MessageMedia, config, convert = converters, download = downloader.downloadMedia, reminders, now = Date.now, log = console }) {
  const seen = new Map();
  const lastReply = new Map();
  const busyChats = new Set();
  const startedAt = now();
  let activeJobs = 0;
  let activeDownloads = 0;

  function prune(map, age) {
    const time = now();
    for (const [key, value] of map) if (time - value > age) map.delete(key);
    while (map.size > 5000) map.delete(map.keys().next().value);
  }

  return async function handleMessage(msg) {
    const from = msg.from || '';
    const isGroup = from.endsWith('@g.us');
    if (msg.fromMe || msg.isStatus || msg.broadcast || from === 'status@broadcast') return;
    if (!/@(c\.us|lid|g\.us)$/.test(from)) return;
    if (isGroup && !config.allowGroups) return;
    // Pesan lama saat sinkronisasi tidak dibalas lagi.
    if (msg.timestamp && msg.timestamp * 1000 < startedAt - 5000) return;
    if (!['chat', 'image', 'video', 'sticker', 'document', 'audio', 'ptt'].includes(msg.type)) return;

    normalizeMessageId(msg);
    prune(seen, 10 * 60 * 1000);
    const id = msg.id?._serialized;
    if (id && seen.has(id)) return;
    if (id) seen.set(id, now());
    const body = (msg.body || '').trim();
    const firstWord = body.split(/\s+/)[0].toLowerCase();
    const naturalReminder = body.match(/^(?:tolong\s+)?ingatkan(?:\s+|$)/i);
    const command = naturalReminder ? 'reminderCreate' : COMMANDS.get(firstWord);
    const reminderInput = naturalReminder ? body.slice(naturalReminder[0].length).trim() : body.slice(firstWord.length).trim();
    if (isGroup && !command) return;
    if (!command && !config.autoReply) return;
    prune(lastReply, 10 * 60 * 1000);
    const sender = isGroup ? `${from}:${msg.author || ''}` : from;
    if (lastReply.has(sender) && now() - lastReply.get(sender) < config.cooldownMs) return;
    lastReply.set(sender, now());

    // Semua balasan ditujukan hanya ke chat yang mengirim pesan tersebut.
    const send = (content, options = {}) => client.sendMessage(from, content, { sendSeen: false, ...options });
    let acquired = false;
    let acquiredDownload = false;
    let stage = 'membalas pesan';
    const trace = randomUUID().slice(0, 8);
    const checkpoint = (nextStage, details = '') => {
      stage = nextStage;
      log.info?.(`[BOT-DIAG ${trace}] ${stage}${details ? ` | ${details}` : ''}`);
    };
    try {
      if (command === 'menu') return await send(menu(config));
      if (command === 'downloadMenu') return await send(downloadMenu(config));
      if (command === 'ping') return await send('Pong! Bot aktif.');
      if (command?.startsWith('reminder')) {
        if (isGroup) return await send('Gunakan fitur pengingat melalui chat pribadi dengan Onya.');
        if (command === 'reminderHelp' || command === 'reminderCreate' && !reminderInput) {
          return await send(reminderHelp(config.reminderTimeZone));
        }
        if (!reminders) return await send('Fitur pengingat belum siap. Pemilik bot perlu menyalin seluruh pembaruan src lalu mulai ulang bot.');
        if (command === 'reminderList') {
          checkpoint('membaca daftar pengingat');
          return await send(reminderList(await reminders.list(from)));
        }
        if (command === 'reminderCancel') {
          checkpoint('membatalkan pengingat');
          const row = await reminders.cancel(from, reminderInput);
          return await send(`Pengingat ${row.id} dibatalkan.`);
        }
        checkpoint('menyimpan pengingat');
        const row = await reminders.create(from, reminderInput, id || '');
        return await send(reminderConfirmation(row));
      }
      if (!command) {
        if (firstWord.startsWith('!')) return await send('Perintah belum dikenali. Ketik !menu.');
        return await send(autoReply(body, config));
      }
      if (busyChats.has(from) || activeJobs >= 2) return await send('Masih memproses media. Coba lagi setelah beberapa detik ya.');
      const downloadRequest = DOWNLOADS[command];
      const isDownload = Boolean(downloadRequest);
      if (isDownload && activeDownloads >= 1) return await send('Sedang mengunduh video lain. Coba lagi setelah unduhan selesai.');
      busyChats.add(from);
      activeJobs++;
      acquired = true;

      if (isDownload) {
        const { platform, label, format } = downloadRequest;
        checkpoint('memeriksa URL downloader');
        const url = downloader.validateUrl(body.slice(firstWord.length).trim(), platform);
        activeDownloads++;
        acquiredDownload = true;
        const type = format === 'mp3' ? 'audio' : 'video';
        await send(`Sedang mengunduh ${type} ${label} sebagai ${format.toUpperCase()}. Tunggu sampai hasil atau pemberitahuan berikutnya.`);
        checkpoint(`mengunduh ${type} ${label}`);
        const result = await download(url, platform, config, { format, onStage: checkpoint });
        const asDocument = config.downloadAsDocument === true;
        checkpoint('mengirim hasil downloader ke WhatsApp', `jenis=${asDocument ? 'dokumen' : type}; ukuran=${result.buffer.length} byte`);
        await send(new MessageMedia(result.mimetype, result.buffer.toString('base64'), result.filename), {
          sendMediaAsDocument: asDocument,
          sendAudioAsVoice: false,
          sendVideoAsGif: false,
          // Audio biasa memakai pemutar audio; caption hanya untuk video/dokumen.
          ...(format === 'mp4' || asDocument ? { caption: `${format === 'mp3' ? 'Audio MP3' : 'Video'} dari ${label}.` } : {})
        });
        log.info?.(`[BOT-DIAG ${trace}] Permintaan kirim selesai; konfirmasi penerimaan melalui WhatsApp.`);
        return;
      }

      // Media yang menempel pada pesan diprioritaskan, lalu pesan yang dibalas.
      checkpoint('mengambil pesan media', `ID pesan tersedia=${Boolean(msg.id?._serialized)}`);
      const source = msg.hasMedia ? msg : msg.hasQuotedMsg ? await msg.getQuotedMessage() : null;
      normalizeMessageId(source);
      if (!source?.hasMedia) return await send('Media belum ditemukan. Kirim foto/video dengan caption !sticker, atau balas media/stiker dengan perintahnya.');
      if (['image', 'video'].includes(command) && source.type !== 'sticker' && source.type !== 'document') {
        return await send('Balas stiker WhatsApp, atau kirim file WebP, dengan perintah tersebut.');
      }
      checkpoint('mengunduh media dari WhatsApp');
      const media = await source.downloadMedia();
      if (!media?.data) return await send('Media tidak bisa diunduh. Kirim ulang media lalu coba lagi.');
      checkpoint('memeriksa media');
      // Perkiraan panjang dicek sebelum membuat salinan buffer.
      if (media.data.length > Math.ceil(config.maxMediaBytes / 3) * 4) {
        return await send(`Media terlalu besar. Maksimal ${config.maxMediaBytes / 1024 / 1024} MB.`);
      }
      const buffer = Buffer.from(media.data, 'base64');
      if (!buffer.length || buffer.length > config.maxMediaBytes) return await send('Media kosong atau melebihi batas ukuran.');
      let result;
      if (command === 'sticker') {
        checkpoint('mengubah media menjadi WebP', `MIME=${media.mimetype}; ukuran=${buffer.length} byte`);
        result = await convert.toSticker(buffer, media.mimetype, config);
        checkpoint('mengirim stiker ke WhatsApp', `WebP=${result.length} byte`);
        await send(new MessageMedia('image/webp', result.toString('base64'), 'sticker.webp'), {
          sendMediaAsSticker: true, stickerName: config.stickerPack, stickerAuthor: config.stickerAuthor
        });
      } else if (command === 'image') {
        checkpoint('mengubah stiker menjadi PNG');
        result = await convert.stickerToImage(buffer);
        // Dokumen PNG mempertahankan transparansi dan tidak dikompres ulang sebagai foto.
        checkpoint('mengirim gambar ke WhatsApp');
        await send(new MessageMedia('image/png', result.toString('base64'), 'sticker.png'), {
          sendMediaAsDocument: true, caption: 'Gambar PNG dari stiker. Stiker bergerak diambil frame pertamanya.'
        });
      } else {
        checkpoint('mengubah stiker menjadi MP4');
        result = await convert.stickerToVideo(buffer, config);
        checkpoint('mengirim video ke WhatsApp');
        await send(new MessageMedia('video/mp4', result.toString('base64'), 'sticker.mp4'), {
          sendMediaAsDocument: config.videoAsDocument, caption: 'Video dari stiker bergerak (tanpa suara).'
        });
      }
      log.info?.(`[BOT-DIAG ${trace}] Permintaan kirim selesai; konfirmasi penerimaan melalui WhatsApp.`);
    } catch (error) {
      log.error(`[BOT-DIAG ${trace}] GAGAL saat ${stage}\n${errorDetails(error)}`);
      if (error?.cause) log.error(`[BOT-DIAG ${trace}] Penyebab tambahan:\n${errorDetails(error.cause)}`);
      const response = error instanceof converters.MediaError || error instanceof downloader.DownloadError || error instanceof ReminderError
        ? `${error.message}\nKode pemeriksaan: ${trace}.`
        : `Proses gagal saat ${stage}. Kode pemeriksaan: ${trace}. Pemilik bot dapat melihat detail di terminal.`;
      try { await send(response); } catch (replyError) {
        log.error(`[BOT-DIAG ${trace}] Balasan error gagal dikirim:\n${errorDetails(replyError)}`);
      }
    } finally {
      if (acquiredDownload) activeDownloads--;
      if (acquired) { busyChats.delete(from); activeJobs--; }
    }
  };
}

module.exports = { createHandler, menu, autoReply, downloadMenu };
