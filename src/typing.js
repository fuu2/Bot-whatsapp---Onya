'use strict';

// WhatsApp mempertahankan status typing sekitar 25 detik; perbarui sebelum habis.
// Operasi presence tidak menunda permintaan AI atau pengiriman pesan.
function createTypingIndicator({ client, refreshMs = 15000,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  const queues = new Map();

  function enqueue(chatId, operation) {
    const previous = queues.get(chatId) || Promise.resolve();
    // Serial per chat: clear lama selesai sebelum typing untuk balasan berikutnya.
    const task = previous.then(operation).catch(() => {});
    queues.set(chatId, task);
    void task.then(() => {
      if (queues.get(chatId) === task) queues.delete(chatId);
    });
    return task;
  }

  return function startTyping(chatId, { signal } = {}) {
    if (signal?.aborted || typeof client.getChatById !== 'function') return () => Promise.resolve();
    let chat, timer, stopTask;
    let stopped = false;
    let refreshing = false;

    function refresh() {
      if (stopped || refreshing) return;
      refreshing = true;
      void enqueue(chatId, async () => {
        if (stopped) return;
        chat ||= await client.getChatById(chatId);
        // Jika lookup terlambat selesai, jangan menyalakan typing sesudah balasan selesai.
        if (!stopped) await chat?.sendStateTyping?.();
      }).finally(() => { refreshing = false; });
    }

    function stop() {
      if (stopTask) return stopTask;
      stopped = true;
      clearIntervalFn(timer);
      signal?.removeEventListener('abort', stop);
      stopTask = enqueue(chatId, async () => { await chat?.clearState?.(); });
      return stopTask;
    }

    refresh();
    timer = setIntervalFn(refresh, refreshMs);
    timer?.unref?.();
    signal?.addEventListener('abort', stop, { once: true });
    return stop;
  };
}

module.exports = { createTypingIndicator };
