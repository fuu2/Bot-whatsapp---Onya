'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../src/handler');

function setup(overrides = {}, convert = {}, download) {
  const sent = [];
  const logs = [];
  const config = {
    name: 'Bot Uji', stickerPack: 'Uji', stickerAuthor: 'Uji', autoReply: true,
    allowGroups: false, cooldownMs: 0, maxMediaBytes: 1024, maxStickerSeconds: 6,
    videoAsDocument: true, ...overrides
  };
  class MessageMedia {
    constructor(mimetype, data, filename) { Object.assign(this, { mimetype, data, filename }); }
  }
  const handle = createHandler({
    client: { sendMessage: async (...args) => { sent.push(args); } },
    MessageMedia, config, convert, download, log: {
      error: (...args) => logs.push(args.join(' ')), info: (...args) => logs.push(args.join(' '))
    }
  });
  return { sent, handle, logs };
}
let sequence = 0;
function message(fields = {}) {
  return { id: { _serialized: String(++sequence) }, from: '111@c.us', type: 'chat', body: 'halo', ...fields };
}
const photo = { hasMedia: true, type: 'image', downloadMedia: async () => ({ data: Buffer.from('photo').toString('base64'), mimetype: 'image/png' }) };

test('membalas chat masuk dan pesan tidak dikenal ke pengirimnya', async () => {
  const { sent, handle } = setup();
  await handle(message());
  await handle(message({ body: 'pesan bebas', from: '222@lid' }));
  assert.equal(sent.length, 2);
  assert.equal(sent[0][0], '111@c.us');
  assert.match(sent[0][1], /Halo/);
  assert.equal(sent[1][0], '222@lid');
  assert.match(sent[1][1], /balasan otomatis/);
});

test('mengabaikan pesan sendiri, status, grup default, channel, dan sinkronisasi lama', async () => {
  const { sent, handle } = setup();
  for (const fields of [{ fromMe: true }, { isStatus: true }, { broadcast: true },
    { from: '111@g.us' }, { from: '111@newsletter' }, { timestamp: 1 }]) {
    await handle(message(fields));
  }
  assert.equal(sent.length, 0);
});

test('pesan yang dikirim ulang oleh event tidak dibalas dua kali', async () => {
  const { sent, handle } = setup();
  const msg = message();
  await handle(msg);
  await handle(msg);
  assert.equal(sent.length, 1);
});

test('cooldown membatasi balasan beruntun tetapi tidak memblokir orang lain', async () => {
  const { sent, handle } = setup({ cooldownMs: 2000 });
  await handle(message());
  await handle(message());
  await handle(message({ from: '222@c.us' }));
  assert.equal(sent.length, 2);
});

test('grup yang diaktifkan hanya menjawab perintah; auto reply dapat dimatikan', async () => {
  const { sent, handle } = setup({ allowGroups: true, autoReply: false });
  await handle(message());
  await handle(message({ from: '111@g.us' }));
  await handle(message({ from: '111@g.us', body: '!menu' }));
  assert.equal(sent.length, 1);
  assert.match(sent[0][1], /!sticker/);
});

test('caption dan quoted media sama-sama menghasilkan stiker', async () => {
  let calls = 0;
  const { sent, handle } = setup({}, { toSticker: async (buffer, mime) => {
    assert.equal(buffer.toString(), 'photo');
    assert.equal(mime, 'image/png');
    calls++;
    return Buffer.from('webp');
  } });
  await handle(message({ ...photo, body: '!sticker' }));
  await handle(message({ body: '!s', hasQuotedMsg: true, getQuotedMessage: async () => photo }));
  assert.equal(calls, 2);
  assert.equal(sent[0][1].mimetype, 'image/webp');
  assert.equal(sent[1][2].sendMediaAsSticker, true);
});

test('toimg/tovideo menggunakan stiker yang dibalas dan mengirim MIME yang sesuai', async () => {
  const sticker = { ...photo, type: 'sticker' };
  const { sent, handle } = setup({}, {
    stickerToImage: async () => Buffer.from('png'), stickerToVideo: async () => Buffer.from('mp4')
  });
  for (const body of ['!toimg', '!tovideo']) {
    await handle(message({ body, hasQuotedMsg: true, getQuotedMessage: async () => sticker }));
  }
  assert.equal(sent[0][1].mimetype, 'image/png');
  assert.equal(sent[1][1].mimetype, 'video/mp4');
  assert.equal(sent[0][2].sendMediaAsDocument, true);
  assert.equal(sent[1][2].sendMediaAsDocument, true);
});

test('media hilang dan file terlalu besar memberi arahan tanpa konversi', async () => {
  const { sent, handle } = setup({ maxMediaBytes: 2 });
  await handle(message({ body: '!sticker' }));
  await handle(message({ ...photo, body: '!sticker' }));
  assert.match(sent[0][1], /Media belum ditemukan/);
  assert.match(sent[1][1], /terlalu besar/);
});

test('kegagalan download melepas slot sehingga perintah berikutnya tetap diproses', async () => {
  const { sent, handle } = setup({}, { toSticker: async () => Buffer.from('webp') });
  await handle(message({ ...photo, body: '!s', downloadMedia: async () => { throw new Error('offline'); } }));
  await handle(message({ ...photo, body: '!s' }));
  assert.match(sent[0][1], /Proses gagal/);
  assert.equal(sent[1][2].sendMediaAsSticker, true);
});

test('konversi bersamaan pada chat yang sama tidak menumpuk', async () => {
  let finish;
  let started;
  const processing = new Promise(resolve => { started = resolve; });
  const conversion = new Promise(resolve => { finish = resolve; });
  const { sent, handle } = setup({}, { toSticker: async () => { started(); return conversion; } });
  const first = handle(message({ ...photo, body: '!s' }));
  await processing;
  await handle(message({ ...photo, body: '!s' }));
  assert.match(sent[0][1], /Masih memproses/);
  finish(Buffer.from('webp'));
  await first;
  assert.equal(sent[1][2].sendMediaAsSticker, true);
});

test('diagnosis mengidentifikasi kegagalan download dan menyamarkan URL/JID', async () => {
  const { sent, handle, logs } = setup();
  await handle(message({ ...photo, body: '!sticker', downloadMedia: async () => {
    throw new Error('download failed https://example.test/media?token=secret for 628123456789@c.us');
  } }));
  assert.match(sent[0][1], /gagal saat mengunduh media/);
  assert.match(logs.join('\n'), /download failed \[URL\] for \[CHAT\]/);
  assert.doesNotMatch(logs.join('\n'), /token=secret|628123456789/);
});

test('diagnosis konversi mencatat message, stack, cause, dan kode yang sama dengan balasan', async () => {
  const { sent, handle, logs } = setup({}, { toSticker: async () => {
    throw new Error('decoder failed', { cause: new Error('decoder detail') });
  } });
  await handle(message({ ...photo, body: '!sticker' }));
  const code = sent[0][1].match(/Kode pemeriksaan: ([a-f0-9]{8})/)[1];
  assert.match(sent[0][1], /mengubah media menjadi WebP/);
  assert.ok(logs.some(line => line.includes(`[BOT-DIAG ${code}] GAGAL`)));
  assert.match(logs.join('\n'), /decoder failed/);
  assert.match(logs.join('\n'), /decoder detail/);
  assert.doesNotMatch(sent[0][1], /decoder failed|decoder detail/);
});

test('diagnosis memisahkan error pengiriman setelah konversi sukses', async () => {
  const logs = [];
  const responses = [];
  class MessageMedia { constructor(mimetype) { this.mimetype = mimetype; } }
  const handle = createHandler({
    config: { autoReply: true, allowGroups: false, cooldownMs: 0, maxMediaBytes: 1024 },
    MessageMedia,
    convert: { toSticker: async () => Buffer.from('webp') },
    client: { sendMessage: async (from, content) => {
      if (typeof content !== 'string') throw new Error('Evaluation failed: upload failure');
      responses.push(content);
    } },
    log: { error: value => logs.push(value), info() {} }
  });
  await handle(message({ ...photo, body: '!sticker' }));
  assert.match(responses[0], /gagal saat mengirim stiker ke WhatsApp/);
  assert.match(logs.join('\n'), /Evaluation failed: upload failure/);
});

test('menu Onya memuat downloader dan petunjuk URL tanpa emoji', async () => {
  const { sent, handle } = setup({ name: 'Onya' });
  await handle(message({ body: '!menu' }));
  await handle(message({ body: '!downloader' }));
  assert.match(sent[0][1], /Onya/);
  assert.match(sent[0][1], /!tiktok/);
  assert.match(sent[0][1], /!facebook/);
  assert.match(sent[1][1], /16 MB/);
  assert.doesNotMatch(sent.map(item => item[1]).join(''), /\p{Extended_Pictographic}/u);
});

test('perintah dan alias downloader mengirim MP4 hanya ke chat peminta', async () => {
  const calls = [];
  const { sent, handle } = setup({}, {}, async (url, platform) => {
    calls.push({ url, platform });
    return { buffer: Buffer.from('mp4'), mimetype: 'video/mp4', filename: `onya-${platform}.mp4` };
  });
  for (const command of ['!tiktok', '!tt', '!facebook', '!fb']) {
    const url = command === '!tiktok' || command === '!tt'
      ? 'https://vt.tiktok.com/ZSabc/' : 'https://www.facebook.com/reel/123/';
    await handle(message({ body: `${command} ${url}`, from: '222@lid' }));
  }
  assert.deepEqual(calls.map(call => call.platform), ['tiktok', 'tiktok', 'facebook', 'facebook']);
  assert.equal(sent.length, 8);
  assert.ok(sent.every(item => item[0] === '222@lid'));
  for (const item of sent.filter(item => typeof item[1] !== 'string')) {
    assert.equal(item[1].mimetype, 'video/mp4');
    assert.equal(item[2].sendMediaAsDocument, true);
    assert.equal(item[2].sendSeen, false);
  }
});

test('URL kosong atau domain keliru memberi petunjuk tanpa menjalankan downloader', async () => {
  const { sent, handle } = setup({}, {}, async () => { assert.fail('Downloader tidak boleh dijalankan'); });
  await handle(message({ body: '!tiktok' }));
  await handle(message({ body: '!fb https://example.test/video' }));
  assert.equal(sent.length, 2);
  assert.match(sent[0][1], /satu URL/);
  assert.match(sent[1][1], /HTTPS resmi/);
});

test('hanya satu unduhan berjalan dan slot dilepas sesudah error', async () => {
  const { DownloadError } = require('../src/downloader');
  let started, fail, count = 0;
  const running = new Promise(resolve => { started = resolve; });
  const blocked = new Promise((resolve, reject) => { fail = reject; });
  const { sent, handle } = setup({}, {}, async () => {
    count++;
    if (count === 1) { started(); return blocked; }
    return { buffer: Buffer.from('mp4'), mimetype: 'video/mp4', filename: 'onya-tiktok.mp4' };
  });
  const body = '!tt https://vt.tiktok.com/ZSabc/';
  const first = handle(message({ body }));
  await running;
  await handle(message({ body, from: '222@lid' }));
  assert.match(sent.at(-1)[1], /Sedang mengunduh video lain/);
  assert.equal(count, 1);
  fail(new DownloadError('Situs meminta login.'));
  await first;
  assert.match(sent.at(-1)[1], /meminta login/);
  await handle(message({ body }));
  assert.equal(count, 2);
  assert.equal(sent.at(-1)[1].filename, 'onya-tiktok.mp4');
});

test('gagal mengirim hasil downloader dicatat sebagai error pengiriman tanpa unduh ulang', async () => {
  const responses = [], logs = [];
  let downloads = 0;
  const handle = createHandler({
    config: { name: 'Onya', cooldownMs: 0 },
    MessageMedia: class { constructor() {} },
    download: async () => {
      downloads++;
      return { buffer: Buffer.from('mp4'), mimetype: 'video/mp4', filename: 'video.mp4' };
    },
    client: { sendMessage: async (from, content) => {
      if (typeof content !== 'string') throw new Error('upload failed');
      responses.push(content);
    } }, log: { info() {}, error: value => logs.push(value) }
  });
  await handle(message({ body: '!tt https://vt.tiktok.com/ZSabc/' }));
  assert.equal(downloads, 1);
  assert.match(responses.at(-1), /mengirim hasil downloader ke WhatsApp/);
  assert.match(logs.join('\n'), /upload failed/);
});
