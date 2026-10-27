'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ReminderError, DAY, zoneInfo, nextOccurrence, formatReminderTime, parseReminder } = require('./reminder-time');

const PRIVATE_CHAT = /^\d+@(?:c\.us|lid)$/;
const MAX_RECORDS = 1000;
const MAX_PER_CHAT = 20;
const STATUS = new Set(['pending', 'delivering', 'uncertain', 'failed']);

function validRecord(row) {
  if (!row || typeof row !== 'object' || !/^[a-f0-9]{8}$/.test(row.id || '') || !PRIVATE_CHAT.test(row.chatId || '')) return false;
  if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > 500 || /[\x00-\x1f\x7f]/.test(row.text)) return false;
  if (!Number.isSafeInteger(row.dueAt) || row.dueAt <= 0 || row.dueAt > 8640000000000000
    || !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0 || row.createdAt > 8640000000000000 || !STATUS.has(row.status)) return false;
  if (!Number.isSafeInteger(row.retryAt) || row.retryAt < 0 || !Number.isInteger(row.attempts) || row.attempts < 0 || row.attempts > 3) return false;
  if (!['once', 'daily'].includes(row.repeat) || typeof row.requestId !== 'string' || row.requestId.length > 512) return false;
  if (typeof row.timeZone !== 'string') return false;
  try { zoneInfo(row.timeZone); } catch { return false; }
  return row.repeat !== 'daily' || (Number.isInteger(row.hour) && row.hour >= 0 && row.hour <= 23
    && Number.isInteger(row.minute) && row.minute >= 0 && row.minute <= 59);
}

class ReminderService {
  constructor({ file, send, timeZone = 'Asia/Jakarta', name = 'Onya', now = Date.now, log = console }) {
    zoneInfo(timeZone);
    this.file = file;
    this.send = send;
    this.timeZone = timeZone;
    this.name = name;
    this.now = now;
    this.log = log;
    this.rows = [];
    this.queue = Promise.resolve();
    this.loaded = false;
    this.ready = false;
    this.closed = false;
    this.timer = null;
    this.task = null;
  }

  async init() {
    if (this.loaded) return;
    let rows = [];
    try {
      const stat = await fs.stat(this.file);
      if (stat.size > 2 * 1024 * 1024) throw new Error('File pengingat melebihi 2 MB.');
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.reminders) || saved.reminders.length > MAX_RECORDS
        || !saved.reminders.every(validRecord) || new Set(saved.reminders.map(row => row.id)).size !== saved.reminders.length) {
        throw new Error('Struktur file pengingat tidak valid.');
      }
      rows = saved.reminders;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new ReminderError('Data pengingat tidak bisa dibaca. Periksa data/reminders.json; file lama tidak ditimpa.', { cause: error });
    }
    // Proses mungkin berhenti setelah WhatsApp menerima pesan, sebelum hasil tercatat.
    // Tampilkan status untuk diperiksa pengguna, jangan kirim ulang secara membabi buta.
    const interrupted = rows.filter(row => row.status === 'delivering');
    for (const row of interrupted) row.status = 'uncertain';
    if (interrupted.length) await this._save(rows);
    this.rows = rows;
    this.loaded = true;
    if (interrupted.length) this.log.warn?.(`[BOT-REMINDER] ${interrupted.length} pengiriman terputus perlu diperiksa lewat !pengingat.`);
  }

  async _save(rows) {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ version: 1, reminders: rows }, null, 2) + '\n');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, this.file);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  _change(action) {
    const task = this.queue.then(async () => {
      const next = structuredClone(this.rows);
      const result = action(next);
      await this._save(next);
      this.rows = next;
      return structuredClone(result);
    });
    this.queue = task.catch(() => {});
    return task;
  }

  _check(chatId) {
    if (!this.loaded || this.closed) throw new ReminderError('Fitur pengingat belum siap. Tunggu bot aktif lalu coba lagi.');
    if (!PRIVATE_CHAT.test(chatId)) throw new ReminderError('Buat dan kelola pengingat melalui chat pribadi dengan Onya.');
  }

  async create(chatId, input, requestId = '') {
    this._check(chatId);
    const schedule = parseReminder(input, this.timeZone, this.now());
    return this._change(rows => {
      const existing = requestId && rows.find(row => row.chatId === chatId && row.requestId === requestId);
      if (existing) return existing;
      if (rows.filter(row => row.chatId === chatId).length >= MAX_PER_CHAT) throw new ReminderError('Maksimal 20 pengingat per chat. Hapus pengingat yang tidak diperlukan melalui !hapus-pengingat ID.');
      if (rows.length >= MAX_RECORDS) throw new ReminderError('Daftar pengingat bot penuh. Coba lagi setelah ada jadwal yang selesai.');
      let id;
      do { id = randomUUID().slice(0, 8); } while (rows.some(row => row.id === id));
      const row = { id, chatId, ...schedule, createdAt: this.now(), requestId: String(requestId).slice(0, 512),
        status: 'pending', retryAt: 0, attempts: 0 };
      rows.push(row);
      return row;
    });
  }

  async list(chatId) {
    this._check(chatId);
    await this.queue;
    return structuredClone(this.rows.filter(row => row.chatId === chatId).sort((a, b) => a.dueAt - b.dueAt));
  }

  async cancel(chatId, id) {
    this._check(chatId);
    if (!/^[a-f0-9]{8}$/i.test(id || '')) throw new ReminderError('Tulis !hapus-pengingat diikuti ID dari !pengingat.');
    return this._change(rows => {
      const index = rows.findIndex(row => row.chatId === chatId && row.id === id.toLowerCase());
      if (index < 0) throw new ReminderError('ID pengingat tidak ditemukan di chat ini. Lihat !pengingat.');
      if (rows[index].status === 'delivering') throw new ReminderError('Pengingat ini sedang dikirim. Tunggu beberapa saat, lalu periksa !pengingat.');
      return rows.splice(index, 1)[0];
    });
  }

  start() {
    if (!this.loaded || this.closed) return;
    this.ready = true;
    if (!this.timer) {
      this.timer = setInterval(() => this._runTick(), 1000);
      this.timer.unref?.();
    }
    this._runTick();
  }

  _runTick() {
    void this.tick().catch(error => this.log.error?.(`[BOT-REMINDER] Penjadwal gagal (${error.code || error.name}); periksa penyimpanan pengingat.`));
  }

  pause() {
    this.ready = false;
    clearInterval(this.timer);
    this.timer = null;
  }

  async stop() {
    this.pause();
    this.closed = true;
    await this.task?.catch(() => {});
    await this.queue;
  }

  tick() {
    if (this.task) return this.task;
    if (!this.loaded || !this.ready || this.closed) return Promise.resolve();
    this.task = this._deliverDue().finally(() => { this.task = null; });
    return this.task;
  }

  async _deliverDue() {
    await this.queue;
    const due = this.rows.filter(row => row.status === 'pending' && row.dueAt <= this.now() && row.retryAt <= this.now())
      .sort((a, b) => a.dueAt - b.dueAt).slice(0, 10).map(row => row.id);
    for (const id of due) {
      if (!this.ready || this.closed) break;
      const row = await this._change(rows => {
        const item = rows.find(item => item.id === id && item.status === 'pending');
        if (!item || item.dueAt > this.now() || item.retryAt > this.now()) return null;
        if (item.repeat === 'daily' && item.attempts === 0) {
          // Jika bot mati beberapa hari, satu kejadian terakhir saja dikirim.
          item.dueAt += Math.floor((this.now() - item.dueAt) / DAY) * DAY;
        }
        item.status = 'delivering';
        item.attempts++;
        return item;
      });
      if (!row) continue;
      const delayed = this.now() - row.dueAt >= 60000;
      const text = `*Pengingat ${this.name}*\n${row.text}\n\nJadwal: ${formatReminderTime(row.dueAt, row.timeZone)}\nID: ${row.id}`
        + (delayed ? '\nPengingat ini terlambat karena jadwal sebelumnya belum berhasil dikirim.' : '')
        + (row.repeat === 'daily' ? `\nBerulang setiap hari. Batalkan: !hapus-pengingat ${row.id}` : '');
      let failed = false;
      try { await this.send(row.chatId, text); }
      catch (error) {
        failed = true;
        this.log.warn?.(`[BOT-REMINDER ${id}] Gagal mengirim (${error.name || 'Error'}), percobaan ${row.attempts}/3.`);
      }
      try {
        await this._change(rows => {
          const index = rows.findIndex(item => item.id === id);
          if (index < 0) return;
          const item = rows[index];
          if (failed && item.attempts < 3) {
            item.status = 'pending'; item.retryAt = this.now() + 60000;
          } else if (item.repeat === 'daily') {
            item.dueAt = nextOccurrence(item.hour, item.minute, item.timeZone, this.now());
            item.status = 'pending'; item.attempts = 0; item.retryAt = 0;
            if (failed) item.lastFailureAt = this.now(); else delete item.lastFailureAt;
          } else if (failed) item.status = 'failed';
          else rows.splice(index, 1);
        });
      } catch (error) {
        // Status di disk masih delivering. Setelah restart akan menjadi uncertain.
        this.pause();
        this.log.error?.(`[BOT-REMINDER ${id}] Hasil kirim belum tersimpan (${error.code || error.name}). Penjadwal dijeda; periksa disk lalu mulai ulang bot.`);
        throw error;
      }
      if (!failed) this.log.info?.(`[BOT-REMINDER ${id}] Permintaan kirim selesai.`);
    }
  }
}

function reminderConfirmation(row) {
  return `Pengingat tersimpan.\n${row.text}\n\nWaktu: ${formatReminderTime(row.dueAt, row.timeZone)}`
    + `\nUlang: ${row.repeat === 'daily' ? 'setiap hari' : 'sekali'}\nID: ${row.id}`
    + `\nBatalkan: !hapus-pengingat ${row.id}\nBot perlu menyala dan terhubung pada waktunya.`;
}

function reminderList(rows) {
  if (!rows.length) return 'Belum ada pengingat. Contoh: !ingatkan 07:30 presensi online. Ketik !bantuan-pengingat.';
  const state = { pending: 'menunggu', delivering: 'sedang dikirim', failed: 'gagal setelah 3 percobaan; buat ulang',
    uncertain: 'pengiriman terputus; periksa chat, lalu hapus dan buat ulang jika perlu' };
  return '*Pengingatmu*\n\n' + rows.map(row =>
    `${row.id} — ${formatReminderTime(row.dueAt, row.timeZone)}${row.repeat === 'daily' ? ' (harian)' : ''}`
    + `\n${row.text.slice(0, 100)}${row.text.length > 100 ? '...' : ''}\nStatus: ${state[row.status]}`
    + (row.lastFailureAt ? '\nPengiriman harian sebelumnya gagal.' : '')).join('\n\n')
    + '\n\nBatalkan: !hapus-pengingat ID';
}

module.exports = { ReminderService, ReminderError, reminderConfirmation, reminderList };
