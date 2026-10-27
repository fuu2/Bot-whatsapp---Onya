'use strict';

const COMMANDS = new Map([
  ['!menu', 'menu'], ['!help', 'menu'], ['!ping', 'ping'],
  ['!ai', 'ai'], ['!resetai', 'aiReset'],
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

// Hanya permintaan menu yang berdiri sendiri; obrolan seperti "menu makan" tetap ke AI.
const MENU_REQUESTS = new Set([
  'menu', 'menunya', 'menu nya', 'mana menu', 'mana menunya', 'mana menu nya',
  'lihat menu', 'tampilkan menu', 'buka menu', 'minta menu', 'menu dong'
]);

// Alias, pengingat bahasa sehari-hari, dan argumen dibaca di satu tempat.
function parseMessage(text = '') {
  const body = text.trim();
  const firstWord = body.split(/\s+/)[0].toLowerCase();
  const naturalReminder = body.match(/^(?:tolong\s+)?ingatkan(?:\s+|$)/i);
  const menuRequest = body.toLowerCase().replace(/[?!.]+$/, '').trim().replace(/\s+/g, ' ');
  const command = naturalReminder ? 'reminderCreate'
    : MENU_REQUESTS.has(menuRequest) ? 'menu' : COMMANDS.get(firstWord);
  const prefixLength = naturalReminder ? naturalReminder[0].length : firstWord.length;
  return {
    body, firstWord, command,
    args: body.slice(prefixLength).trim(),
    aiCommand: command === 'ai' || command === 'aiReset'
  };
}

module.exports = { parseMessage, DOWNLOADS };
