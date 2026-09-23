'use strict';
const vm = require('node:vm');

// Kompatibilitas khusus whatsapp-web.js 1.34.7 untuk ID WA Web yang berubah
// dari _serialized menjadi $1. Dasar diagnosis upstream:
// https://github.com/wwebjs/whatsapp-web.js/issues/201830
// https://github.com/wwebjs/whatsapp-web.js/pull/201850
// Pengiriman media: hindari benturan ID internal MediaData dengan Msg.
// https://github.com/wwebjs/whatsapp-web.js/issues/201922
// Hanya mengubah fungsi library di memori; tidak menulis node_modules.

function normalizeMessageId(message) {
  const id = message?.id;
  if (!id || typeof id !== 'object' || id._serialized || typeof id.$1 !== 'string' || !id.$1) return false;
  message.id = { ...id, _serialized: id.$1 };
  return true;
}

function buildCompatibleLoadUtils(original) {
  let source = original.toString();
  const replaceChecked = (needle, replacement, expected = 1) => {
    const parts = source.split(needle);
    if (parts.length - 1 !== expected) {
      throw new Error('Struktur whatsapp-web.js berbeda dari 1.34.7 yang diuji. Patch kompatibilitas tidak diterapkan.');
    }
    source = parts.join(replacement);
  };

  // ID pesan saat mengirim, mengedit, dan membaca pesan terakhir.
  for (const [expression, count] of [['newMsgKey', 1], ['msg.id', 1], ['chat.lastReceivedKey', 2]]) {
    replaceChecked(`${expression}._serialized`, `(${expression}._serialized ?? ${expression}.$1)`, count);
  }
  replaceChecked('const lastMessage = chat.lastReceivedKey',
    'const lastMessage = (chat.lastReceivedKey?._serialized ?? chat.lastReceivedKey?.$1)');

  // getMessageModel dipakai untuk pesan masuk, pesan kutipan, dan hasil kirim.
  // Alias harus dipulihkan sebelum data masuk ke struktur Message di Node.js.
  replaceChecked('delete msg.pendingAckUpdate;', `
        if (msg.id && typeof msg.id === 'object' && msg.id._serialized == null
            && typeof msg.id.$1 === 'string' && msg.id.$1) {
            msg.id = Object.assign({}, msg.id, { _serialized: msg.id.$1 });
        }
        delete msg.pendingAckUpdate;`);

  // MediaData membawa __x_id saat di-spread ke payload pesan. Msg dapat
  // memakai nilai tersebut menggantikan newMsgKey, sehingga getSender gagal.
  // Hapus hanya dari payload baru, bukan dari model media yang masih dipakai.
  const sendAnchor = "// Bot's won't reply if canonicalUrl is set (linking)";
  replaceChecked(sendAnchor, `delete message.__x_id;

        ${sendAnchor}`);

  // Sumbernya fungsi paket lokal yang sudah terpasang, bukan input pengguna/jaringan.
  return vm.runInThisContext(`(${source})`, { filename: 'bot-wa-id-media-compat.js' });
}

function installMessageIdCompatibility() {
  const version = require('whatsapp-web.js/package.json').version;
  if (version !== '1.34.7') {
    throw new Error(`Patch ini diuji untuk whatsapp-web.js 1.34.7; terpasang ${version}. Perlu menyesuaikan patch sebelum bot dijalankan.`);
  }
  const utils = require('whatsapp-web.js/src/util/Injected/Utils');
  if (utils.LoadUtils.botMessageIdCompat) return;
  if (require.cache[require.resolve('whatsapp-web.js/src/Client')]) {
    throw new Error('Muat whatsapp-compat sebelum require whatsapp-web.js, lalu jalankan ulang bot.');
  }
  const patched = buildCompatibleLoadUtils(utils.LoadUtils);
  patched.botMessageIdCompat = true;
  utils.LoadUtils = patched;
}

module.exports = { normalizeMessageId, buildCompatibleLoadUtils, installMessageIdCompatibility };
