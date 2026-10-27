'use strict';
const { validateUrl } = require('./downloader');
const { normalizeMessageId } = require('./whatsapp-compat');
const { reminderConfirmation, reminderList } = require('./reminders');
const { reminderHelp } = require('./reminder-time');

// Tindakan fitur menerima konteks pesan; deduplikasi dan batas pekerjaan milik handler.
function createActions({ config, MessageMedia, convert, download, ai, reminders }) {
  async function replyAI({ msg, from, isGroup, command, aiCommand, args, body, send, checkpoint }) {
    if (isGroup) return await send('Percakapan AI hanya tersedia melalui chat pribadi.');
    if (!ai) return await send('Fitur AI belum siap. Salin seluruh folder src terbaru lalu mulai ulang bot.');
    if (msg.type !== 'chat' || msg.hasMedia) return await send('AI percakapan saat ini hanya membaca teks. Tulis pesanmu sebagai teks.');
    checkpoint('menjawab percakapan AI');
    const input = aiCommand ? args : body;
    return ai.handle(from, command === 'aiReset' ? 'reset' : input, { command: aiCommand, send });
  }

  async function replyReminder({ from, isGroup, command, args, id, send, checkpoint }) {
    if (isGroup) return await send('Gunakan fitur pengingat melalui chat pribadi dengan Onya.');
    if (command === 'reminderHelp' || (command === 'reminderCreate' && !args)) {
      return await send(reminderHelp(config.reminderTimeZone));
    }
    if (!reminders) return await send('Fitur pengingat belum siap. Pemilik bot perlu menyalin seluruh pembaruan src lalu mulai ulang bot.');
    if (command === 'reminderList') {
      checkpoint('membaca daftar pengingat');
      return await send(reminderList(await reminders.list(from)));
    }
    if (command === 'reminderCancel') {
      checkpoint('membatalkan pengingat');
      const row = await reminders.cancel(from, args);
      return await send(`Pengingat ${row.id} dibatalkan.`);
    }
    checkpoint('menyimpan pengingat');
    const row = await reminders.create(from, args, id || '');
    return await send(reminderConfirmation(row));
  }

  async function sendDownload({ args, downloadRequest, send, checkpoint, complete }) {
    const { platform, label, format } = downloadRequest;
    checkpoint('memeriksa URL downloader');
    const url = validateUrl(args, platform);
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
    complete();
  }

  async function convertMedia({ msg, command, send, checkpoint, complete }) {
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
    complete();
  }

  return { replyAI, replyReminder, sendDownload, convertMedia };
}

module.exports = { createActions };
