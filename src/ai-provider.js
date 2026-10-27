'use strict';

class AIError extends Error {}

// Penyedia dipilih secara eksplisit; key tidak pernah dipinjam dari penyedia lain.
function getProvider(config = {}) {
  const id = config.aiProvider || 'gemini';
  if (id === 'groq') return {
    id, label: 'Groq', key: config.groqApiKey || '',
    model: config.groqModel || 'openai/gpt-oss-20b',
    keyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', dashboard: 'Groq Console',
    baseUrl: 'https://api.groq.com/openai/v1/'
  };
  if (id === 'gemini') return {
    id, label: 'Google Gemini', key: config.geminiApiKey || '',
    model: config.geminiModel || 'gemini-3.8-flash',
    keyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', dashboard: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/'
  };
  throw new AIError('AI_PROVIDER harus groq atau gemini.');
}

function providerProblem(provider) {
  if (!provider.key) return `AI belum siap. Isi ${provider.keyEnv} di .env lalu mulai ulang bot.`;
  if (provider.id === 'gemini' && provider.key.startsWith('gsk_')) {
    return 'Key Groq berada di GEMINI_API_KEY. Pilih AI_PROVIDER=groq, isi GROQ_API_KEY dengan key Groq baru, lalu mulai ulang bot.';
  }
  if (provider.id === 'groq' && provider.key.startsWith('AIza')) {
    return 'GROQ_API_KEY berisi key Google. Gunakan key Groq, atau pilih AI_PROVIDER=gemini dan isi GEMINI_API_KEY.';
  }
  const modelPattern = provider.id === 'groq' ? /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/ : /^[a-zA-Z0-9._-]+$/;
  if (!modelPattern.test(provider.model)) return `${provider.modelEnv} harus berisi ID model, bukan URL.`;
  return '';
}

module.exports = { AIError, getProvider, providerProblem };
