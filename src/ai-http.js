'use strict';
const { setTimeout: sleep } = require('node:timers/promises');
const { AIError, getProvider, providerProblem } = require('./ai-provider');

function httpError(code, attempts, provider) {
  if (code === 401 || code === 403) return new AIError(`Akses ${provider.label} ditolak. Pemilik bot perlu memeriksa ${provider.keyEnv} dan izin akun.`);
  if (code === 429) return new AIError(`Kuota atau batas permintaan AI sedang tercapai. Coba lagi nanti; pemilik bot dapat memeriksa kuota di ${provider.dashboard}.`);
  if (code === 404) return new AIError(`Model AI tidak tersedia untuk akun ini. Jalankan node scripts/check-ai.js --models lalu periksa ${provider.modelEnv} di .env.`);
  if (code === 400 || code === 422) return new AIError('Konfigurasi permintaan AI ditolak. Pemilik bot perlu memeriksa API key, model, dan pengaturan AI.');
  if (code === 503) return new AIError(`${provider.label} sedang sibuk atau tidak tersedia (HTTP 503). Sudah dicoba ${attempts} kali. Coba lagi nanti; jika berulang, jalankan node scripts/check-ai.js.`);
  return new AIError(`Layanan AI belum bisa menjawab (HTTP ${code}, ${attempts} percobaan). Coba lagi nanti.`);
}

// Satu tenggat mencakup semua percobaan. Tidak pernah mencetak key atau tubuh error.
async function requestAI(config, resource, { method = 'GET', body, fetchImpl = globalThis.fetch,
  signal, sleepImpl = sleep, random = Math.random, now = Date.now, onRetry } = {}) {
  const provider = getProvider(config);
  const problem = providerProblem(provider);
  if (problem) throw new AIError(problem);
  const auth = provider.id === 'groq' ? { Authorization: `Bearer ${provider.key}` } : { 'x-goog-api-key': provider.key };
  const timeoutMs = config.aiTimeoutMs || 60000;
  const deadline = now() + timeoutMs;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
  const retries = config.aiRetryCount ?? 2;
  const transientHttp = new Set([500, 502, 503, 504]);
  const transientNetwork = new Set(['EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);
  const diagnosticCodes = new Set([...transientNetwork, 'ENOTFOUND', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT']);
  let lastError;
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      combined.throwIfAborted();
      let response, retryable = false, status = '', retryAfterMs = 0;
      try {
        response = await fetchImpl(`${provider.baseUrl}${resource}`, {
          method, headers: { 'Content-Type': 'application/json', ...auth }, redirect: 'error',
          signal: combined, ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
      } catch (error) {
        combined.throwIfAborted();
        const code = error?.cause?.code || error?.code;
        status = diagnosticCodes.has(code) ? code : 'NETWORK_ERROR';
        retryable = transientNetwork.has(code);
        lastError = new AIError(`Koneksi ke ${provider.label} gagal (${status}). Periksa koneksi internet, DNS, atau proxy pada komputer bot.`);
      }
      if (response?.ok) {
        try { return await response.json(); }
        catch {
          combined.throwIfAborted();
          throw new AIError(`Respons ${provider.label} tidak berupa JSON yang valid. Coba lagi nanti atau jalankan node scripts/check-ai.js.`);
        }
      }
      if (response) {
        status = response.status;
        retryable = transientHttp.has(status);
        lastError = httpError(status, attempt + 1, provider);
        const retryAfter = response.headers?.get('retry-after');
        if (retryAfter) {
          const seconds = Number(retryAfter);
          retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retryAfter) - now()) || 0;
        }
        // Error saat membuang badan respons tidak boleh menyamarkan status HTTP.
        try { await response.body?.cancel(); } catch { /* Tidak menyimpan tubuh error. */ }
      }
      if (!retryable || attempt === retries) throw lastError;
      const delayMs = Math.max(1000 * 2 ** attempt + Math.floor(random() * 250), retryAfterMs);
      if (delayMs >= deadline - now() || delayMs > 10000) throw lastError;
      onRetry?.({ status, attempt: attempt + 2, delayMs });
      await sleepImpl(delayMs, undefined, { signal: combined });
    }
  } catch (error) {
    if (error instanceof AIError) throw error;
    if (signal?.aborted) throw new AIError('Permintaan AI dibatalkan karena bot dihentikan.');
    if (timeout.aborted || error?.name === 'TimeoutError') throw new AIError('AI terlalu lama merespons. Silakan coba lagi.');
    throw new AIError(`Koneksi ke ${provider.label} terganggu. Coba lagi nanti atau jalankan node scripts/check-ai.js.`);
  }
}

// Ekspor kompatibel untuk pemanggil Gemini lama.
function requestGemini(config, resource, options) {
  return requestAI({ ...config, aiProvider: 'gemini' }, resource, options);
}

module.exports = { AIError, requestAI, requestGemini };
