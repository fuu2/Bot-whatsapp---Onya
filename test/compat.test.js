'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { Message } = require('whatsapp-web.js');
const { LoadUtils } = require('whatsapp-web.js/src/util/Injected/Utils');
const { normalizeMessageId, buildCompatibleLoadUtils } = require('../src/whatsapp-compat');

function fixture(patched, oldIds = false) {
  const models = new Map();
  const lookups = [];
  const sid = name => `false_123456@lid_${name}`;
  const makeKey = name => ({ fromMe: false, remote: '123456@lid', id: name,
    [oldIds ? '_serialized' : '$1']: sid(name) });
  const model = (name, type) => {
    const data = { id: makeKey(name), from: '123456@lid', to: '654321@c.us', type,
      t: Math.floor(Date.now() / 1000), body: '!sticker', caption: '!sticker',
      ...(type === 'image' ? { directPath: '/media', mimetype: 'image/png', mediaKey: 'test-key' } : { quotedMsg: {} }) };
    const item = { ...data, serialize: () => ({ ...data, id: { ...data.id } }), mediaData: { mediaStage: 'RESOLVED' } };
    models.set(sid(name), item);
    return item;
  };
  const quote = model('PICTURE', 'image');
  const command = model('COMMAND', 'chat');
  const get = id => {
    lookups.push(id);
    if (!id) throw new Error('No key or key range specified');
    return models.get(id);
  };
  class MsgKey {
    static async newId() { return 'OUT'; }
    constructor() {
      this.fromMe = true;
      this.remote = '123456@lid';
      this.id = 'OUT';
      this[oldIds ? '_serialized' : '$1'] = 'true_123456@lid_OUT';
    }
  }
  const modules = {
    WALinkify: { findLinks: () => [], findLink: () => undefined },
    WAWebCollections: { Msg: { get, getMessagesById: async ids => ({ messages: ids.map(get).filter(Boolean) }) } },
    WAWebQuotedMsgModelUtils: { getQuotedMsgObj: msg => {
      assert.equal(msg, command);
      return quote;
    } },
    WAWebDownloadManager: { downloadManager: { downloadAndMaybeDecrypt: async () => new Uint8Array([1, 2, 3]).buffer } },
    WAWebChatGetters: { getIsNewsletter: () => false, getIsBroadcast: () => false },
    WAWebUserPrefsMeUser: { getMaybeMeLidUser: () => '654321@lid', getMaybeMePnUser: () => '654321@c.us' },
    WAWebMsgKey: MsgKey,
    WAWebGetEphemeralFieldsMsgActionsUtils: { getEphemeralFields: () => ({}) },
    WAWebSendMsgChatAction: { addAndSendMsgToChat: (chat, msg) => {
      // Simulasi inisialisasi Msg di WA Web yang menganggap __x_id sebagai
      // backing field id. Jika tertimpa ID media, sender tidak bisa dibaca.
      const effectiveId = Object.hasOwn(msg, '__x_id') ? msg.__x_id : msg.id;
      if (!effectiveId?.remote) {
        throw new Error("Data passed to getter must include an id property (it's how we memoize) but got undefined");
      }
      models.set(msg.id._serialized || msg.id.$1, msg);
      return [Promise.resolve(msg), Promise.resolve('OK')];
    } },
    WAWebSendMessageEditAction: { sendMessageEdit: async () => undefined }
  };
  const context = vm.createContext({ window: { require: name => {
    if (!(name in modules)) throw new Error(`Missing mock module: ${name}`);
    return modules[name];
  } }, AbortController });
  const loader = patched ? buildCompatibleLoadUtils(LoadUtils) : LoadUtils;
  vm.runInContext(`(${loader.toString()})()`, context);
  context.window.WWebJS.arrayBufferToBase64Async = async buffer => Buffer.from(buffer).toString('base64');
  const client = { pupPage: { evaluate: async (fn, ...args) => {
    context.argsForTest = args;
    return vm.runInContext(`(${fn.toString()})(...argsForTest)`, context);
  } } };
  return { context, client, command, quote, lookups, sid,
    message: () => new Message(client, context.window.WWebJS.getMessageModel(command)) };
}

test('reproduksi: library asli gagal getQuotedMessage ketika ID hanya memiliki $1', async () => {
  const f = fixture(false);
  await assert.rejects(f.message().getQuotedMessage(), /No key or key range/);
  assert.equal(f.lookups[0], undefined);
});

test('perbaikan memakai metode getQuotedMessage dan downloadMedia asli tanpa ID undefined', async () => {
  const f = fixture(true);
  const msg = f.message();
  assert.equal(msg.id._serialized, f.sid('COMMAND'));
  const quoted = await msg.getQuotedMessage();
  assert.equal(quoted.id._serialized, f.sid('PICTURE'));
  const media = await quoted.downloadMedia();
  assert.equal(media.mimetype, 'image/png');
  assert.equal(media.data, 'AQID');
  assert.deepEqual(f.lookups, [f.sid('COMMAND'), f.sid('PICTURE')]);
});

test('ID _serialized lama tetap bekerja untuk kutipan dan download', async () => {
  const f = fixture(true, true);
  const quote = await f.message().getQuotedMessage();
  assert.equal((await quote.downloadMedia()).data, 'AQID');
});

test('normalisasi Node memulihkan ID baru tanpa menimpa ID lama atau mengarang ID', () => {
  const modern = { id: { $1: 'false_123@lid_ABC' } };
  assert.equal(normalizeMessageId(modern), true);
  assert.equal(modern.id._serialized, modern.id.$1);
  const old = { id: { _serialized: 'old', $1: 'different' } };
  assert.equal(normalizeMessageId(old), false);
  assert.equal(old.id._serialized, 'old');
  const incomplete = { id: { id: 'ABC' } };
  assert.equal(normalizeMessageId(incomplete), false);
  assert.equal(incomplete.id._serialized, undefined);
  assert.equal(normalizeMessageId(null), false);
});

test('lookup hasil kirim asli memakai ID baru; sebelum patch gagal', async () => {
  const chat = { id: { isLid: () => true } };
  await assert.rejects(fixture(false).context.window.WWebJS.sendMessage(chat, 'uji'), /No key or key range/);
  const f = fixture(true);
  const sent = await f.context.window.WWebJS.sendMessage(chat, 'uji');
  assert.equal(sent.id.$1, 'true_123456@lid_OUT');
  assert.equal(f.lookups.at(-1), 'true_123456@lid_OUT');
});

test('lookup hasil edit dan pesan terakhir menerima format ID baru', async () => {
  const f = fixture(true);
  assert.equal(await f.context.window.WWebJS.editMessage(f.quote, 'uji'), f.quote);
  const chat = { serialize: () => ({ msgs: [1] }), lastReceivedKey: f.quote.id };
  const model = await f.context.window.WWebJS.getChatModel(chat);
  assert.equal(model.lastMessage.id._serialized, f.sid('PICTURE'));
  // Data tanpa key sama sekali tidak boleh diteruskan ke IndexedDB.
  const blank = await f.context.window.WWebJS.getChatModel({ serialize: () => ({ msgs: [1] }), lastReceivedKey: {} });
  assert.equal(blank.lastMessage, null);
  assert.ok(f.lookups.every(Boolean));
});

test('struktur library yang berbeda ditolak sebelum perubahan diterapkan', () => {
  assert.throws(() => buildCompatibleLoadUtils(() => {}), /Struktur whatsapp-web.js berbeda/);
});

function prepareMedia(f, mimetype, document, collision = true) {
  const media = {
    ...(collision ? { __x_id: 'internal-media-id' } : {}),
    type: document ? 'document' : mimetype.split('/')[0],
    mimetype, filename: mimetype === 'image/png' ? 'sticker.png' : 'sticker.mp4',
    filehash: 'test-hash', mediaKey: 'test-media-key', directPath: '/test-media',
    toJSON() {
      return { type: this.type, mimetype: this.mimetype, filename: this.filename,
        filehash: this.filehash, mediaKey: this.mediaKey, directPath: this.directPath };
    }
  };
  f.context.window.WWebJS.processMediaData = async (input, options) => {
    assert.equal(input.mimetype, mimetype);
    assert.equal(options.forceDocument, document);
    return media;
  };
  return { media, options: { media: { mimetype, data: 'AQID' },
    sendMediaAsDocument: document, caption: 'Hasil konversi' } };
}

test('reproduksi: ID internal media merusak pengiriman meski ID pesan memakai format lama', async () => {
  const f = fixture(false, true);
  const { options } = prepareMedia(f, 'image/png', true);
  await assert.rejects(f.context.window.WWebJS.sendMessage(
    { id: { isLid: () => true } }, '', options
  ), /Data passed to getter must include an id property/);
});

for (const [mimetype, document, oldIds] of [
  ['image/png', true, false], ['video/mp4', true, false],
  ['video/mp4', false, false], ['audio/mpeg', false, false], ['image/png', true, true]
]) {
  test(`kirim ${mimetype}, dokumen=${document}, ID lama=${oldIds}: ID dan metadata media terjaga`, async () => {
    const f = fixture(true, oldIds);
    const { media, options } = prepareMedia(f, mimetype, document);
    const sent = await f.context.window.WWebJS.sendMessage(
      { id: { isLid: () => true } }, '', options
    );
    assert.equal(sent.id._serialized || sent.id.$1, 'true_123456@lid_OUT');
    assert.equal(Object.hasOwn(sent, '__x_id'), false);
    assert.equal(sent.type, document ? 'document' : mimetype.split('/')[0]);
    assert.equal(sent.mimetype, mimetype);
    assert.equal(sent.filename, media.filename);
    assert.equal(sent.caption, 'Hasil konversi');
    assert.equal(sent.mediaKey, 'test-media-key');
    assert.equal(sent.directPath, '/test-media');
    // Model sumber tetap utuh, patch hanya membersihkan payload pesan baru.
    assert.equal(media.__x_id, 'internal-media-id');
  });
}

test('media tanpa ID internal dan stiker tetap memakai jalur pengiriman asli', async () => {
  const f = fixture(true);
  const chat = { id: { isLid: () => true } };
  const { options } = prepareMedia(f, 'image/png', true, false);
  assert.equal((await f.context.window.WWebJS.sendMessage(chat, '', options)).type, 'document');
  f.context.window.WWebJS.processStickerData = async () => ({ type: 'sticker', mimetype: 'image/webp' });
  const sent = await f.context.window.WWebJS.sendMessage(chat, '', {
    media: { mimetype: 'image/webp', data: 'AQID' }, sendMediaAsSticker: true
  });
  assert.equal(sent.type, 'sticker');
  assert.equal(sent.mimetype, 'image/webp');
  assert.equal(sent.id.$1, 'true_123456@lid_OUT');
});
