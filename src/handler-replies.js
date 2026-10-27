'use strict';

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
    (config.aiAutoReply === false ? '!ai on — Mulai percakapan AI di chat pribadi\n' : 'Langsung kirim teks di chat pribadi untuk mengobrol dengan AI.\n!ai on — Lanjutkan AI yang dijeda\n') +
    '!ai <pesan> — Tanya AI\n' +
    '!ai off / !ai reset — Matikan / hapus konteks AI\n' +
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
    return `Waalaikumsalam, gw ${config.name}. Mau lihat fiturnya? Ketik !menu aja.`;
  }
  if (/\b(hai|halo|hello|hi|pagi|siang|sore|malam)\b/i.test(body)) {
    return `Halo, gw ${config.name}! Mau bikin stiker, download, atau pasang pengingat? Ketik !menu aja.`;
  }
  if (/\b(terima kasih|makasih|thanks)\b/i.test(body)) return 'Sama-sama, santai aja!';
  return `Pesan lu udah gw terima. Ini balasan otomatis dari ${config.name}. Ketik !menu buat lihat fiturnya.`;
}

module.exports = { menu, downloadMenu, autoReply };
