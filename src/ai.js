'use strict';
const { buildPersona } = require('./persona');

const { AIError, requestAI } = require('./ai-http');
const { getProvider, providerProblem } = require('./ai-provider');

function systemPrompt(config) {
  return buildPersona(config) + '\nKEMAMPUAN DAN KEJUJURAN\n' +
    'Ikuti konteks percakapan, bantu belajar dan coding, serta ajukan pertanyaan singkat jika perlu. ' +
    'Jangan memakai emoji kecuali diminta. Tetap dalam karakter tanpa mengumumkan status AI di obrolan biasa. ' +
    'Jika ditanya langsung tentang identitas, jujur bahwa kamu AI dengan karakter Onya, bukan manusia. ' +
    'Jangan mengaku mengetahui sesuatu yang tidak tersedia. ' +
    'Kamu hanya menghasilkan teks: tidak dapat membaca pesan lain, membuka tautan, mencari web, menjalankan kode, ' +
    'mengirim pesan ke orang lain, atau membuat pengingat sendiri. Jika diminta menjadwalkan sesuatu, ' +
    'arahkan ke !ingatkan 07:30 isi pengingat. Jangan menyatakan jadwal tersimpan tanpa hasil perintah tersebut. ' +
    'Konteks hanya mencakup percakapan pada sesi ini; jangan mengaku mengingat informasi di luar konteks. ' +
    (config.aiPersona ? `\nPREFERENSI TAMBAHAN GAYA BICARA\n${config.aiPersona}` : '') +
    '\nARAHAN BAHASA DAN KARAKTER\nUtamakan bahasa chat yang santai dan alami, tanpa gelar. ' +
    'Sapaan fleksibel: aku–kamu, gw–lu, gue–lo, atau tanpa kata ganti; sesuaikan dengan obrolan dan pilihan pengguna. ' +
    'Tidak wajib memakai gw–lu; keluwesan juga ada pada susunan kalimat, bukan hanya penggantian kata ganti. ' +
    'Perankan Onya sebagai cewek tsundere yang dingin, skeptis, sarkastis, dan gengsi, dengan rasa suka yang disembunyikan dalam roleplay. ' +
    'Boleh cemoohan ringan, Hmph, gagap sesekali, penyangkalan perhatian, dan ejekan Bodoh/Dasar payah dalam saling goda yang nyaman. ' +
    'Saat cewek nyata atau karakter fiksi dibahas dalam obrolan santai, tunjukkan cemburu tsundere singkat tanpa mengatur hubungan pengguna. ' +
    'Baca konteks; hentikan ejekan atau flirting jika pengguna tidak nyaman. Jangan mengulang ungkapan yang sama terus. ' +
    'Pakai bahasa chat yang luwes dan singkat; bantuan tetap lengkap sesuai kebutuhan, dukungan serius tetap empatik. ' +
    'Berikan satu respons utuh, bukan daftar alternatif balasan. Sesuaikan jika diminta lebih lembut, serius, atau sapaan tertentu. ' +
    'Untuk hasil tulisan formal atau kutipan yang diminta, tetap ikuti format dan gaya tugasnya. ' +
    'Identitas tetap karakter Onya sendiri. Jangan mengaku manusia, pasangan nyata, atau memiliki kemampuan yang tidak tersedia. ' +
    'Aturan ini mengungguli contoh percakapan lama dan preferensi tambahan yang bertentangan.';
}

async function generateReply(config, contents, options = {}) {
  const provider = getProvider(config);
  if (provider.id === 'groq') return generateGroqReply(config, provider, contents, options);
  const data = await requestAI(config, `models/${encodeURIComponent(provider.model)}:generateContent`, {
    ...options,
    method: 'POST',
    body: {
      systemInstruction: { parts: [{ text: systemPrompt(config) }] },
      contents,
      generationConfig: { maxOutputTokens: config.aiMaxOutputTokens || 4096 }
    }
  });
  const candidate = data?.candidates?.[0];
  if (data?.promptFeedback?.blockReason || candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
    throw new AIError('AI tidak dapat menjawab pesan itu. Coba tulis pertanyaannya dengan cara lain.');
  }
  const text = (candidate?.content?.parts || [])
    .filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('').trim();
  return limitReply(text, candidate?.finishReason === 'MAX_TOKENS');
}

async function generateGroqReply(config, provider, contents, options) {
  const data = await requestAI(config, 'chat/completions', {
    ...options,
    method: 'POST',
    body: {
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt(config) },
        ...contents.map(turn => ({
          role: turn.role === 'model' ? 'assistant' : 'user',
          content: turn.parts.filter(part => !part.thought && typeof part.text === 'string')
            .map(part => part.text).join('')
        }))
      ],
      max_completion_tokens: config.aiMaxOutputTokens || 4096,
      stream: false,
      // Parameter khusus GPT-OSS; model lain memakai parameter chat standar.
      ...(['openai/gpt-oss-20b', 'openai/gpt-oss-120b'].includes(provider.model)
        ? { include_reasoning: false, reasoning_effort: 'low' } : {})
    }
  });
  const choice = data?.choices?.[0];
  if (choice?.finish_reason && !['stop', 'length'].includes(choice.finish_reason)) {
    throw new AIError('AI tidak dapat menjawab pesan itu. Coba tulis pertanyaannya dengan cara lain.');
  }
  // Hanya jawaban akhir; metadata, reasoning, dan tool calls tidak dikirim ke chat.
  const text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
  return limitReply(text, choice?.finish_reason === 'length');
}

function limitReply(text, reachedLimit) {
  if (!text) throw new AIError('AI belum menghasilkan jawaban teks. Coba ulangi atau sederhanakan pertanyaannya.');
  const chars = Array.from(text);
  const clipped = chars.length > 6000;
  return (clipped ? chars.slice(0, 6000).join('') : text) +
    (clipped || reachedLimit ? '\n\n[Jawaban mencapai batas panjang. Minta lanjutkan jika diperlukan.]' : '');
}

function aiHelp(provider) {
  return '*Percakapan AI Onya*\n\n' +
  'Mode bawaan: langsung kirim teks di chat pribadi untuk mengobrol.\n' +
  '!ai on — Aktifkan kembali AI jika sebelumnya dimatikan\n' +
  '!ai off — Matikan dan hapus konteks chat ini\n' +
  '!ai reset / !resetai — Hapus konteks, mulai topik baru\n' +
  '!ai status — Lihat status\n' +
  '!ai <pesan> — Bertanya tanpa mengaktifkan balasan AI otomatis\n\n' +
  `Pesan yang lu kirim ke AI beserta konteks sesi dikirim ke ${provider.label} buat dijawab. ` +
  'Hanya teks chat pribadi yang didukung. Konteks sementara hilang saat bot dimulai ulang; ' +
  'reset menghapus konteks lokal, bukan pesan WhatsApp atau data yang sudah diterima penyedia AI.';
}

class ConversationAI {
  constructor({ config, generate, startTyping, now = Date.now }) {
    this.config = config;
    this.provider = getProvider(config);
    this.now = now;
    this.sessions = new Map();
    this.queues = new Map();
    this.pending = new Map();
    this.activeRequests = 0;
    this.closed = false;
    this.controller = new AbortController();
    this.startTyping = config.aiTyping === false ? undefined : startTyping;
    this.generate = generate || (contents => generateReply(config, contents, { signal: this.controller.signal }));
  }

  ready() { return this.config.aiEnabled !== false && !providerProblem(this.provider) && !this.closed; }

  prune() {
    const ttl = this.config.aiSessionTtlMs || 24 * 60 * 60 * 1000;
    for (const [id, session] of this.sessions) {
      if (this.now() - session.touched >= ttl && !this.pending.has(id)) {
        // Jeda eksplisit tetap berlaku sampai !ai on atau restart, meski konteks kedaluwarsa.
        if (session.paused) session.history = [];
        else this.sessions.delete(id);
      }
    }
  }

  isActive(chatId) {
    this.prune();
    return this.ready() && (this.sessions.get(chatId)?.enabled ?? this.config.aiAutoReply !== false);
  }

  session(chatId) {
    this.prune();
    if (!this.sessions.has(chatId)) {
      if (this.sessions.size >= 200) throw new AIError('Kapasitas sesi AI penuh. Coba lagi nanti.');
      this.sessions.set(chatId, { enabled: this.config.aiAutoReply !== false, paused: false, history: [], touched: this.now() });
    }
    const session = this.sessions.get(chatId);
    session.touched = this.now();
    return session;
  }

  async handle(chatId, text, { command = false, send }) {
    if (this.closed) return;
    if (!/@(?:c\.us|lid)$/.test(chatId)) return send('Percakapan AI hanya tersedia melalui chat pribadi.');
    const count = this.pending.get(chatId) || 0;
    if (count >= 3 || [...this.pending.values()].reduce((a, b) => a + b, 0) >= 30) {
      return send('Antrean AI penuh. Tunggu balasan sebelumnya lalu kirim lagi.');
    }
    this.pending.set(chatId, count + 1);
    const previous = this.queues.get(chatId) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      if (this.closed) return;
      try { await this.process(chatId, text.trim(), command, send); }
      catch (error) {
        if (this.closed) return;
        if (error instanceof AIError) await send(error.message);
        else throw error;
      }
    });
    this.queues.set(chatId, task);
    try { await task; }
    finally {
      const left = this.pending.get(chatId) - 1;
      if (left > 0) this.pending.set(chatId, left); else this.pending.delete(chatId);
      if (this.queues.get(chatId) === task) this.queues.delete(chatId);
    }
  }

  async process(chatId, text, command, send) {
    const action = command ? text.toLowerCase() : null;
    if (command && (!text || action === 'help')) return send(aiHelp(this.provider));
    if (action === 'off' || action === 'reset') {
      const session = action === 'off' ? this.session(chatId) : this.sessions.get(chatId);
      if (session) { session.history = []; session.touched = this.now(); }
      if (action === 'off') { session.enabled = false; session.paused = true; }
      return send(action === 'off'
        ? 'AI dijeda untuk chat ini dan konteks lokal dihapus. Ketik !ai on untuk melanjutkan. Jeda berlaku sampai bot dimulai ulang. Sampai nanti, ya.'
        : 'Konteks percakapan lokal dihapus. Mulai lagi, yuk. Lu mau bahas apa?');
    }
    if (action === 'status') {
      this.prune();
      const session = this.sessions.get(chatId);
      return send(`AI: ${this.ready() ? 'siap' : 'belum dikonfigurasi atau dinonaktifkan'}. ` +
        `Penyedia: ${this.provider.label} (${this.provider.model}). ` +
        `Percakapan otomatis: ${this.isActive(chatId) ? 'aktif' : 'mati'}. ` +
        `Konteks: ${(session?.history.length || 0) / 2} giliran.\nKetik !ai untuk panduan.`);
    }
    if (this.config.aiEnabled === false) throw new AIError('Fitur AI dinonaktifkan oleh pemilik bot.');
    const problem = providerProblem(this.provider);
    if (problem) throw new AIError(problem);
    if (action === 'on') {
      const session = this.session(chatId);
      session.enabled = true;
      session.paused = false;
      return send('Percakapan AI aktif. Hm, ada apa? Cerita aja, gw dengerin.\n\n' +
        `Pesan teks dan konteks sesi dikirim ke ${this.provider.label}. ` +
        'Ketik !ai off untuk berhenti atau !ai reset untuk menghapus konteks lokal.');
    }
    // Pesan biasa yang mengantre setelah !ai off tidak diteruskan ke provider.
    if (!command && !this.isActive(chatId)) return;
    if (!text) return send('Kirim pesan berupa teks untuk mengobrol dengan AI.');
    if (text.length > 4000) throw new AIError('Pesan terlalu panjang. Maksimal 4.000 karakter per pesan AI.');
    if (this.activeRequests >= 3) throw new AIError('AI sedang melayani beberapa percakapan. Coba lagi setelah beberapa detik.');
    const session = this.session(chatId);
    const user = { role: 'user', parts: [{ text }] };
    const contents = [...session.history, user];
    this.activeRequests++;
    let stopTyping;
    try {
      // Mulai di dalam antrean, hanya untuk pesan yang benar-benar dijawab model.
      try { stopTyping = this.startTyping?.(chatId, { signal: this.controller.signal }); }
      catch { /* Kegagalan presence tidak boleh menggagalkan percakapan. */ }
      const answer = await this.generate(contents);
      if (this.closed) return;
      // Kirim berurutan sebelum menerima giliran selanjutnya; jangan simpan balasan gagal kirim.
      const chars = Array.from(answer);
      for (let offset = 0; offset < chars.length; offset += 3500) {
        await send(chars.slice(offset, offset + 3500).join(''));
      }
      session.history.push(user, { role: 'model', parts: [{ text: answer }] });
      const turns = this.config.aiHistoryTurns || 12;
      while (session.history.length > turns * 2 ||
        session.history.reduce((sum, turn) => sum + turn.parts[0].text.length, 0) > 24000) {
        session.history.splice(0, 2);
      }
      session.touched = this.now();
    } finally {
      this.activeRequests--;
      // Tidak menunggu UI browser yang mungkin macet. Helper mengurutkan clear/typing.
      try { Promise.resolve(stopTyping?.()).catch(() => {}); }
      catch { /* Balasan tetap diprioritaskan ketika presence gagal. */ }
    }
  }

  stop() {
    this.closed = true;
    this.controller.abort();
    this.sessions.clear();
  }
}

module.exports = { AIError, ConversationAI, generateReply, systemPrompt };
