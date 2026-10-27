'use strict';
const { generateReply } = require('../src/ai');
const { AIError, requestAI } = require('../src/ai-http');
const { getProvider, providerProblem } = require('../src/ai-provider');

async function checkAI(config, { modelsOnly = false, request = requestAI, generate = generateReply, log = console } = {}) {
  const provider = getProvider(config);
  const problem = providerProblem(provider);
  if (problem) {
    log.error(`GAGAL: ${problem} Nilai key tidak dicetak.`);
    return false;
  }
  log.info(`Penyedia: ${provider.label}; model di .env: ${provider.model}`);
  const options = { onRetry: ({ status, attempt, delayMs }) => {
    log.info(`Layanan sementara gagal (${status}); percobaan ${attempt} setelah ${(delayMs / 1000).toFixed(1)} detik.`);
  } };
  try {
    if (modelsOnly) {
      const names = new Set();
      if (provider.id === 'groq') {
        const data = await request(config, 'models', options);
        for (const model of data.data || []) {
          if (model.active !== false && /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(model.id || '')) names.add(model.id);
        }
      } else {
        let token = '', page = 0;
        do {
          const query = new URLSearchParams({ pageSize: '1000', ...(token ? { pageToken: token } : {}) });
          const data = await request(config, `models?${query}`, options);
          for (const model of data.models || []) {
            const name = model.name?.replace(/^models\//, '');
            if (model.supportedGenerationMethods?.includes('generateContent') && /^[a-zA-Z0-9._-]+$/.test(name || '')) names.add(name);
          }
          token = data.nextPageToken || '';
        } while (token && ++page < 10);
        if (token) log.info('Daftar dipotong setelah 10 halaman. Periksa daftar lengkap di AI Studio.');
      }
      log.info(provider.id === 'groq' ? 'Model aktif yang dilaporkan Groq:' : 'Model yang dilaporkan mendukung generateContent:');
      for (const name of [...names].sort()) log.info(`  ${name}${name === provider.model ? ' [dipilih]' : ''}`);
      if (!names.has(provider.model)) log.info(`Model pilihan tidak ditemukan pada daftar ini. Periksa ${provider.modelEnv} di .env.`);
      log.info(`Daftar model tidak menjamin kuota, kapasitas, atau dukungan keluaran teks. Pilih model chat teks di ${provider.dashboard}, lalu jalankan pemeriksaan tanpa --models.`);
      return true;
    }
    log.info(`Mengirim satu pesan uji ke ${provider.label}, dengan percobaan ulang terbatas. Pemeriksaan memakai kuota API; tidak login atau mengirim pesan WhatsApp.`);
    await generate(config, [{ role: 'user', parts: [{ text: 'Jawab singkat dengan kata OK saja.' }] }], options);
    log.info(`BERHASIL: ${provider.label} mengembalikan jawaban teks. Jalankan ulang bot lalu coba chat biasa dari nomor lain.`);
    return true;
  } catch (error) {
    log.error(`GAGAL: ${error instanceof AIError ? error.message : 'Pemeriksaan tidak berhasil. Periksa konfigurasi dan koneksi.'}`);
    log.info('Jika HTTP 503 berulang, coba lagi nanti atau periksa model lain melalui node scripts/check-ai.js --models.');
    return false;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.some(arg => arg !== '--models')) {
    console.log('node scripts/check-ai.js          Uji jawaban model (memakai kuota API)');
    console.log('node scripts/check-ai.js --models Lihat model yang dilaporkan API, tanpa membuat jawaban');
  } else {
    const config = require('../src/config');
    checkAI(config, { modelsOnly: args.includes('--models') }).then(ok => { process.exitCode = ok ? 0 : 1; });
  }
}

module.exports = { checkAI };
