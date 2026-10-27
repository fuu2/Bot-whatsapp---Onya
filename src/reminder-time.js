'use strict';

class ReminderError extends Error {}
const DAY = 24 * 60 * 60 * 1000;
// Zona Indonesia saat ini tidak memakai pergantian daylight saving.
const ZONES = Object.freeze({
  'Asia/Jakarta': { label: 'WIB', offset: 7 * 60 * 60 * 1000 },
  'Asia/Makassar': { label: 'WITA', offset: 8 * 60 * 60 * 1000 },
  'Asia/Jayapura': { label: 'WIT', offset: 9 * 60 * 60 * 1000 }
});

function zoneInfo(timeZone = 'Asia/Jakarta') {
  if (!Object.hasOwn(ZONES, timeZone)) throw new ReminderError('REMINDER_TIMEZONE harus Asia/Jakarta, Asia/Makassar, atau Asia/Jayapura.');
  return ZONES[timeZone];
}

function localParts(time, timeZone) {
  const date = new Date(time + zoneInfo(timeZone).offset);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function instant(year, month, day, hour, minute, timeZone) {
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(utc);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ReminderError('Tanggal tidak valid. Gunakan tanggal-bulan-tahun, misalnya 25-09-2026.');
  }
  return utc - zoneInfo(timeZone).offset;
}

function nextOccurrence(hour, minute, timeZone, now) {
  const { year, month, day } = localParts(now, timeZone);
  let due = instant(year, month, day, hour, minute, timeZone);
  if (due <= now) due += DAY;
  return due;
}

function formatReminderTime(time, timeZone) {
  const date = new Date(time + zoneInfo(timeZone).offset);
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} ${zoneInfo(timeZone).label}`;
}

function reminderHelp(timeZone = 'Asia/Jakarta') {
  return '*Pengingat Onya*\n\n' +
    '!ingatkan 07:30 presensi online\n' +
    '!ingatkan besok 07:30 presensi online\n' +
    '!ingatkan 25-09-2026 07:30 presensi online\n' +
    '!ingatkan setiap hari 07:30 presensi online\n' +
    '!ingatkan 5 menit cek presensi\n' +
    '!pengingat — Lihat pengingatmu\n' +
    '!hapus-pengingat ID — Batalkan pengingat\n\n' +
    `Waktu bawaan: ${zoneInfo(timeZone).label}; format 24 jam (19:30 = malam).\n` +
    'Jam tanpa tanggal memakai jadwal berikutnya: hari ini, atau besok jika sudah lewat.\n' +
    'Bisa juga: ingatkan saya untuk presensi online jam 07:30\n' +
    'Gunakan chat pribadi. Bot harus menyala dan terhubung agar pengingat dapat dikirim.';
}

function parseReminder(input, timeZone = 'Asia/Jakarta', now = Date.now()) {
  zoneInfo(timeZone);
  let value = String(input || '').trim().replace(/^saya\s+/i, '');
  if (!value || value.length > 700) throw new ReminderError('Format pengingat belum lengkap. Contoh: !ingatkan 07:30 presensi online. Ketik !bantuan-pengingat.');
  // Bentuk kalimat sederhana dengan waktu di belakang; bukan pemahaman bahasa bebas.
  const sentence = value.match(/^(?:untuk\s+)?(.+?)\s+(?:pada\s+)?(?:(besok|hari ini|setiap hari)\s+)?(?:jam|pukul)\s+(\d{1,2}[:.]\d{2})(?:\s+(WIB|WITA|WIT))?$/i);
  if (sentence) value = `${sentence[2] || ''} ${sentence[3]} ${sentence[4] || ''} ${sentence[1]}`.trim();
  const relative = value.match(/^(\d{1,4})\s+(menit|jam)\s+(?:lagi\s+)?(?:untuk\s+)?(.+)$/i);
  let text, dueAt, repeat = 'once', hour, minute;
  if (relative) {
    const amount = Number(relative[1]) * (relative[2].toLowerCase() === 'jam' ? 60 : 1);
    if (amount < 1 || amount > 7 * 24 * 60) throw new ReminderError('Pengingat relatif harus antara 1 menit dan 7 hari.');
    dueAt = now + amount * 60000;
    text = relative[3];
  } else {
    const match = value.match(/^(?:(besok|hari ini|setiap hari|\d{2}-\d{2}-\d{4})\s+)?(?:(?:jam|pukul)\s+)?(\d{1,2})[:.](\d{2})(?:\s+(WIB|WITA|WIT))?\s+(?:untuk\s+)?(.+)$/i);
    if (!match) throw new ReminderError('Gunakan jam dan menit 24 jam. Contoh: !ingatkan 07:30 presensi online. Ketik !bantuan-pengingat.');
    const daySpec = (match[1] || '').toLowerCase();
    hour = Number(match[2]); minute = Number(match[3]); text = match[5];
    if (hour > 23 || minute > 59) throw new ReminderError('Jam harus 00–23 dan menit 00–59. Contoh: 07:30 atau 19:30.');
    if (match[4]) timeZone = Object.keys(ZONES).find(key => ZONES[key].label === match[4].toUpperCase());
    repeat = daySpec === 'setiap hari' ? 'daily' : 'once';
    if (!daySpec || repeat === 'daily') dueAt = nextOccurrence(hour, minute, timeZone, now);
    else {
      let { year, month, day } = localParts(now + (daySpec === 'besok' ? DAY : 0), timeZone);
      if (/^\d/.test(daySpec)) [day, month, year] = daySpec.split('-').map(Number);
      dueAt = instant(year, month, day, hour, minute, timeZone);
      if (dueAt <= now) throw new ReminderError('Waktu itu sudah lewat. Pilih waktu mendatang atau gunakan besok.');
    }
  }
  text = text.trim();
  if (!text || text.length > 500 || /[\x00-\x1f\x7f]/.test(text)) throw new ReminderError('Isi pengingat harus satu baris, antara 1 dan 500 karakter.');
  if (dueAt > now + 366 * DAY) throw new ReminderError('Jadwalkan maksimal 366 hari ke depan.');
  return { text, dueAt, repeat, timeZone, ...(repeat === 'daily' ? { hour, minute } : {}) };
}

module.exports = { ReminderError, DAY, ZONES, zoneInfo, nextOccurrence, formatReminderTime, parseReminder, reminderHelp };
