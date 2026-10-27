'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHandler } = require('../src/handler');
const { ReminderService } = require('../src/reminders');

async function bot(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onya-reminder-handler-'));
  const file = path.join(directory, 'reminders.json');
  let now = Date.parse('2026-09-24T00:00:00Z'), sequence = 0;
  const sent = [], logs = [];
  const client = { sendMessage: async (chat, content, options) => { sent.push({ chat, content, options }); } };
  const reminders = new ReminderService({ file, now: () => now,
    send: (chat, text) => client.sendMessage(chat, text, { sendSeen: false }),
    log: { info() {}, warn() {}, error() {} } });
  await reminders.init();
  const handle = createHandler({ client, MessageMedia: class {}, reminders,
    now: () => now, config: { name: 'Onya', cooldownMs: 0, allowGroups: true, autoReply: false,
      maxMediaBytes: 1024, maxStickerSeconds: 6 }, log: { info() {}, error: value => logs.push(value) }, ...overrides });
  const incoming = (body, from = '111@lid') => handle({ id: { _serialized: `msg-${++sequence}` }, body, from, type: 'chat' });
  t.after(async () => { await reminders.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return { incoming, reminders, sent, logs, file, advance: ms => { now += ms; } };
}

test('chat menjadi jadwal tersimpan, konfirmasi WIB, lalu pengingat hanya ke peminta', async t => {
  const b = await bot(t);
  await b.incoming('!ingatkan 07:30 presensi online');
  assert.match(b.sent[0].content, /Pengingat tersimpan/);
  assert.match(b.sent[0].content, /24-09-2026 07:30 WIB/);
  assert.equal(JSON.parse(await fs.readFile(b.file, 'utf8')).reminders.length, 1);
  await b.incoming('!pengingat', '222@c.us');
  assert.match(b.sent.at(-1).content, /Belum ada pengingat/);
  b.reminders.start();
  await b.reminders.tick();
  assert.equal(b.sent.length, 2);
  b.advance(30 * 60000);
  await b.reminders.tick();
  assert.equal(b.sent.length, 3);
  assert.equal(b.sent[2].chat, '111@lid');
  assert.equal(b.sent[2].options.sendSeen, false);
  assert.match(b.sent[2].content, /^\*Pengingat Onya\*\npresensi online/);
});

test('kalimat biasa, daftar, dan pembatalan bekerja meski auto reply dimatikan', async t => {
  const b = await bot(t);
  await b.incoming('tolong ingatkan saya untuk presensi online setiap hari jam 07:30');
  assert.match(b.sent.at(-1).content, /setiap hari/);
  const id = (await b.reminders.list('111@lid'))[0].id;
  await b.incoming('!pengingat');
  assert.match(b.sent.at(-1).content, new RegExp(id));
  await b.incoming(`!hapus-pengingat ${id}`, '222@c.us');
  assert.match(b.sent.at(-1).content, /tidak ditemukan di chat ini/);
  await b.incoming(`!hapus-pengingat ${id}`);
  assert.match(b.sent.at(-1).content, /dibatalkan/);
  assert.equal((await b.reminders.list('111@lid')).length, 0);
});

test('grup diarahkan ke chat pribadi dan input keliru diberi petunjuk tanpa menyimpan', async t => {
  const b = await bot(t);
  await b.incoming('!ingatkan 07:30 presensi', '123@g.us');
  assert.match(b.sent.at(-1).content, /chat pribadi/);
  await b.incoming('!ingatkan 25:80 presensi');
  assert.match(b.sent.at(-1).content, /Jam harus/);
  await b.incoming('!ingatkan');
  assert.match(b.sent.at(-1).content, /!ingatkan besok/);
  assert.equal((await b.reminders.list('111@lid')).length, 0);
});

test('gagal menyimpan tidak dibalas sebagai pengingat tersimpan', async t => {
  const b = await bot(t);
  b.reminders._save = async () => { throw new Error('penyimpanan tidak tersedia'); };
  await b.incoming('!ingatkan 07:30 presensi');
  assert.match(b.sent.at(-1).content, /gagal saat menyimpan pengingat/);
  assert.doesNotMatch(b.sent.at(-1).content, /Pengingat tersimpan/);
});

test('pengingat masih dapat dibuat saat downloader di chat yang sama sibuk', async t => {
  let finish, began;
  const started = new Promise(resolve => { began = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  const b = await bot(t, { download: async () => {
    began(); await pending;
    return { buffer: Buffer.from('video'), mimetype: 'video/mp4', filename: 'video.mp4' };
  } });
  const downloading = b.incoming('!tt https://vt.tiktok.com/ZSabc/');
  await started;
  try {
    await b.incoming('!ingatkan 07:30 presensi');
    assert.match(b.sent.at(-1).content, /Pengingat tersimpan/);
  } finally { finish(); }
  await downloading;
});
