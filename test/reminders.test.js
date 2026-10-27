'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ReminderService, ReminderError, reminderList } = require('../src/reminders');
const { parseReminder, formatReminderTime } = require('../src/reminder-time');
const WIB = 'Asia/Jakarta';
const base = Date.parse('2026-09-24T00:00:00.000Z'); // 07:00 WIB, server bebas memakai zona lain.
const owner = '111@lid', other = '222@c.us';

async function fixture(t, sendOverride) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onya-reminder-test-'));
  const file = path.join(directory, 'data', 'reminders.json');
  let now = base;
  const sent = [], logs = [], services = [];
  const make = async (extra = {}) => {
    const service = new ReminderService({ file, now: () => now, timeZone: WIB,
      send: sendOverride || (async (chat, text) => { sent.push({ chat, text }); }),
      log: { info: line => logs.push(line), warn: line => logs.push(line), error: line => logs.push(line) }, ...extra });
    services.push(service);
    await service.init();
    return service;
  };
  t.after(async () => {
    for (const service of services) await service.stop();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { file, sent, logs, make, setTime: value => { now = typeof value === 'number' ? value : Date.parse(value); } };
}

test('parser menentukan WIB, rollover besok, dan tanggal eksplisit melewati batas timer 24 hari', () => {
  assert.equal(parseReminder('07:30 presensi online', WIB, base).dueAt, base + 30 * 60000);
  assert.equal(parseReminder('07:00 presensi online', WIB, base).dueAt, base + 86400000);
  assert.equal(parseReminder('besok 07:30 presensi online', WIB, base).dueAt, base + 86400000 + 30 * 60000);
  assert.equal(parseReminder('01-01-2027 00:00 tahun baru', WIB, base).dueAt, Date.parse('2026-12-31T17:00:00Z'));
  assert.equal(formatReminderTime(base + 30 * 60000, WIB), '24-09-2026 07:30 WIB');
});

test('format jam, menit relatif, dan kalimat sederhana menghasilkan waktu serta isi yang benar', () => {
  for (const text of ['saya jam 07:30 untuk presensi online', 'saya untuk presensi online jam 07:30', '07.30 presensi online']) {
    const result = parseReminder(text, WIB, base);
    assert.equal(result.dueAt, base + 30 * 60000);
    assert.equal(result.text, 'presensi online');
  }
  assert.equal(parseReminder('5 menit cek presensi', WIB, base).dueAt, base + 5 * 60000);
  assert.equal(parseReminder('2 jam lagi untuk belajar', WIB, base).text, 'belajar');
  const daily = parseReminder('saya presensi online setiap hari jam 07:30', WIB, base);
  assert.equal(daily.repeat, 'daily');
  assert.equal(daily.hour, 7);
  assert.equal(daily.minute, 30);
});

test('zona WITA/WIT bekerja tanpa bergantung zona waktu komputer', () => {
  assert.equal(parseReminder('08:30 cek jadwal', 'Asia/Makassar', base).dueAt, base + 30 * 60000);
  assert.equal(parseReminder('09:30 WIT cek jadwal', WIB, base).dueAt, base + 30 * 60000);
  assert.equal(formatReminderTime(base, 'Asia/Jayapura'), '24-09-2026 09:00 WIT');
  assert.throws(() => parseReminder('10:00 test', 'Europe/London', base), ReminderError);
});

test('tanggal tidak ada, jam keliru, waktu lampau, isi kosong dan durasi berlebihan ditolak', () => {
  for (const text of ['', '24:00 presensi', '07:60 presensi', '07:30', '31-09-2026 07:30 presensi',
    '29-02-2027 07:30 presensi', '24-09-2026 06:30 presensi', 'hari ini 07:00 presensi',
    '31-12-2030 07:00 presensi', '0 menit presensi', '200 jam presensi', `07:30 ${'x'.repeat(501)}`]) {
    assert.throws(() => parseReminder(text, WIB, base), ReminderError, text);
  }
});

test('pengingat disimpan, bertahan restart, dikirim ke peminta saat ready, dan selesai hanya sekali', async t => {
  const f = await fixture(t);
  const first = await f.make();
  const row = await first.create(owner, '07:30 presensi online', 'message-1');
  assert.equal(JSON.parse(await fs.readFile(f.file, 'utf8')).reminders[0].id, row.id);
  await first.stop();
  const second = await f.make();
  second.start();
  await second.tick();
  assert.equal(f.sent.length, 0);
  f.setTime(base + 30 * 60000);
  await Promise.all([second.tick(), second.tick(), second.tick()]);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].chat, owner);
  assert.match(f.sent[0].text, /presensi online/);
  assert.match(f.sent[0].text, /24-09-2026 07:30 WIB/);
  assert.equal((await second.list(owner)).length, 0);
  await second.stop();
  const third = await f.make();
  third.start();
  await third.tick();
  assert.equal(f.sent.length, 1);
});

test('offline tidak mengirim; pengingat sekali yang terlewat dikirim dengan keterangan terlambat', async t => {
  const f = await fixture(t);
  const service = await f.make();
  await service.create(owner, '07:30 presensi online');
  f.setTime(base + 2 * 86400000);
  await service.tick();
  assert.equal(f.sent.length, 0);
  service.start();
  await service.tick();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].text, /terlambat/);
});

test('pengingat harian melewati beberapa hari offline tanpa mengirim tumpukan jadwal lama', async t => {
  const f = await fixture(t);
  const service = await f.make();
  await service.create(owner, 'setiap hari 07:30 presensi online');
  f.setTime('2026-09-27T01:00:00Z');
  service.start();
  await service.tick();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].text, /27-09-2026 07:30 WIB/);
  assert.equal((await service.list(owner))[0].dueAt, Date.parse('2026-09-28T00:30:00Z'));
  await service.tick();
  assert.equal(f.sent.length, 1);
  await service.stop();
  const restarted = await f.make({ timeZone: 'Asia/Makassar' });
  f.setTime('2026-09-28T00:30:00Z');
  restarted.start();
  await restarted.tick();
  assert.equal(f.sent.length, 2);
  assert.match(f.sent[1].text, /28-09-2026 07:30 WIB/);
});

test('hanya pemilik dapat melihat/membatalkan jadwal dan permintaan duplikat tidak menambah jadwal', async t => {
  const f = await fixture(t);
  const service = await f.make();
  const row = await service.create(owner, '5 menit rahasia peminta', 'same-message');
  const duplicate = await service.create(owner, '5 menit rahasia peminta', 'same-message');
  assert.equal(row.id, duplicate.id);
  assert.equal((await service.list(owner)).length, 1);
  assert.deepEqual(await service.list(other), []);
  await assert.rejects(service.cancel(other, row.id), /tidak ditemukan di chat ini/);
  await assert.rejects(service.create('123@g.us', '5 menit test'), /chat pribadi/);
  await service.cancel(owner, row.id);
  f.setTime(base + 10 * 60000);
  service.start();
  await service.tick();
  assert.equal(f.sent.length, 0);
});

test('penulisan serentak tidak kehilangan jadwal dan batas 20 per chat diterapkan', async t => {
  const f = await fixture(t);
  const service = await f.make();
  await Promise.all(Array.from({ length: 20 }, (_, index) => service.create(owner, `5 menit tugas ${index}`, `msg-${index}`)));
  assert.equal((await service.list(owner)).length, 20);
  await assert.rejects(service.create(owner, '10 menit kelebihan'), /Maksimal 20/);
  assert.equal(JSON.parse(await fs.readFile(f.file, 'utf8')).reminders.length, 20);
});

test('data rusak tidak ditimpa dan kegagalan simpan tidak dianggap berhasil', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.file), { recursive: true });
  await fs.writeFile(f.file, '{data rusak');
  await assert.rejects(f.make(), /tidak bisa dibaca/);
  assert.equal(await fs.readFile(f.file, 'utf8'), '{data rusak');
  await fs.rm(f.file);
  const service = await f.make();
  service._save = async () => { throw Object.assign(new Error('Disk penuh'), { code: 'ENOSPC' }); };
  await assert.rejects(service.create(owner, '5 menit test'), { code: 'ENOSPC' });
  assert.equal((await service.list(owner)).length, 0);
});

test('gagal kirim dijadwalkan ulang setelah satu menit dan berhenti setelah tiga percobaan', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; throw new Error('offline'); });
  const service = await f.make();
  await service.create(owner, '1 menit presensi');
  f.setTime(base + 60000);
  service.start();
  await service.tick();
  assert.equal(calls, 1);
  await service.tick();
  assert.equal(calls, 1);
  for (const minute of [2, 3, 4]) { f.setTime(base + minute * 60000); await service.tick(); }
  assert.equal(calls, 3);
  assert.equal((await service.list(owner))[0].status, 'failed');
});

test('kegagalan mencatat hasil kirim tidak memicu kirim ganda saat restart', async t => {
  const f = await fixture(t);
  const service = await f.make();
  const row = await service.create(owner, '1 menit presensi');
  const save = service._save.bind(service);
  let writes = 0;
  service._save = async rows => {
    if (++writes === 2) throw Object.assign(new Error('Disk penuh'), { code: 'ENOSPC' });
    await save(rows);
  };
  f.setTime(base + 60000);
  service.start();
  await assert.rejects(service.tick(), { code: 'ENOSPC' });
  assert.equal(f.sent.length, 1);
  assert.equal(service.ready, false);
  await service.stop();
  const restarted = await f.make();
  restarted.start();
  await restarted.tick();
  assert.equal(f.sent.length, 1);
  const list = await restarted.list(owner);
  assert.equal(list[0].status, 'uncertain');
  assert.match(reminderList(list), /periksa chat/);
  await restarted.cancel(owner, row.id);
});

test('tick serentak tidak menggandakan kirim dan pembatalan saat pengiriman tidak mengaku berhasil', async t => {
  let finish, began, calls = 0;
  const started = new Promise(resolve => { began = resolve; });
  const sending = new Promise(resolve => { finish = resolve; });
  const f = await fixture(t, async () => { calls++; began(); await sending; });
  const service = await f.make();
  const row = await service.create(owner, '1 menit presensi');
  f.setTime(base + 60000);
  service.start();
  const pending = service.tick();
  await started;
  try {
    assert.equal(service.tick(), pending);
    await assert.rejects(service.cancel(owner, row.id), /sedang dikirim/);
    service.pause();
  } finally { finish(); }
  await pending;
  assert.equal(calls, 1);
  assert.equal((await service.list(owner)).length, 0);
});
