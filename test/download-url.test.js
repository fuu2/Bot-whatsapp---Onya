'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUrl, resolveVideoUrl, DownloadError } = require('../src/download-url');

test('Facebook menerima variasi bagikan dan postingan video tanpa mengganti host mobile', () => {
  const urls = [
    'https://www.facebook.com/share/1AbcDEF/',
    'https://www.facebook.com/share/p/1AbcDEF/',
    'https://m.facebook.com/onya/posts/pfbid02AbcDEF',
    'https://www.facebook.com/groups/onya/permalink/12345/',
    'https://web.facebook.com/permalink.php?story_fbid=pfbid02Abc&id=123',
    'https://www.facebook.com/onya/videos/judul-video/12345/'
  ];
  for (const url of urls) assert.equal(validateUrl(url, 'facebook'), url);
  assert.equal(validateUrl('https://m.facebook.com/watch/?v=123', 'facebook'), 'https://m.facebook.com/watch/?v=123');
  assert.equal(validateUrl('https://www.facebook.com/videos/123/', 'facebook'), 'https://www.facebook.com/watch/?v=123');
});

test('YouTube watch, Shorts, youtu.be dan Music dinormalisasi ke satu video', () => {
  const id = 'BaW_jenozKc';
  const result = `https://www.youtube.com/watch?v=${id}`;
  for (const url of [`https://youtu.be/${id}?si=abc`, `https://www.youtube.com/shorts/${id}`,
    `https://music.youtube.com/watch?v=${id}&list=PL123`, `https://m.youtube.com/watch?v=${id}&t=20`,
    `https://youtube.com/live/${id}`]) assert.equal(validateUrl(url, 'youtube'), result);
  for (const url of ['https://youtube.com/playlist?list=PL123', 'https://youtube.com/@onya',
    'https://youtu.be/too-short', 'https://youtu.be/BaW_jenozKc/extra',
    'https://youtube.com.evil.test/watch?v=BaW_jenozKc', 'https://youtube.com/redirect?q=http://localhost']) {
    assert.throws(() => validateUrl(url, 'youtube'), DownloadError);
  }
});

test('Facebook bagikan dapat dialihkan ke mobile dan menemukan canonical dari HTML 200', async () => {
  const addresses = [];
  const resolved = await resolveVideoUrl('https://www.facebook.com/share/1Abc/', 'facebook', {
    fetchUrl: async address => {
      addresses.push(address);
      if (addresses.length === 1) return new Response(null, { status: 302,
        headers: { location: 'https://m.facebook.com/share/1Abc/' } });
      return new Response('<link href="https://m.facebook.com/watch/?v=12345&amp;ref=share" rel="canonical">');
    }
  });
  assert.deepEqual(addresses, ['https://www.facebook.com/share/1Abc/', 'https://m.facebook.com/share/1Abc/']);
  assert.equal(resolved, 'https://m.facebook.com/watch/?v=12345&ref=share');
});

test('cookie pengunjung mencegah pengulangan redirect dan hanya berlaku dalam satu resolusi', async () => {
  const start = 'https://www.facebook.com/share/v/1Abc/';
  let calls = 0;
  const fetchUrl = async (address, options) => {
    calls++;
    if (calls % 2 === 1) {
      assert.equal(options.headers.Cookie, undefined);
      return new Response(null, { status: 302, headers: {
        location: start, 'set-cookie': 'guest=abc; Domain=.facebook.com; Path=/; Secure'
      } });
    }
    assert.equal(options.headers.Cookie, 'guest=abc');
    return new Response(null, { status: 302, headers: { location: '/reel/12345/' } });
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(await resolveVideoUrl(start, 'facebook', { fetchUrl }), 'https://www.facebook.com/reel/12345/');
  }
  assert.equal(calls, 4);
});

test('redirect berulang, login, dan canonical ke domain luar berhenti dengan pesan jelas', async () => {
  const start = 'https://fb.watch/abcd/';
  let calls = 0;
  await assert.rejects(resolveVideoUrl(start, 'facebook', { fetchUrl: async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: start } });
  } }), /mengulang pengalihan/);
  assert.equal(calls, 1);
  await assert.rejects(resolveVideoUrl(start, 'facebook', { fetchUrl: async () => new Response(
    '<meta property="og:url" content="http://127.0.0.1/private">') }), /tidak memuat alamat/);
  await assert.rejects(resolveVideoUrl(start, 'facebook', { fetchUrl: async () => new Response(null, {
    status: 302, headers: { location: 'https://www.facebook.com/checkpoint/' }
  }) }), /meminta login/);
});

test('resolver membaca permalink JSON dan tidak menyembunyikan kode error jaringan', async () => {
  const start = 'https://fb.watch/abcd/';
  const url = 'https://www.facebook.com/onya/videos/12345/';
  assert.equal(await resolveVideoUrl(start, 'facebook', { fetchUrl: async () => new Response(
    `<script>{"video_permalink_url":${JSON.stringify(url).replaceAll('/', '\\/')}}</script>`) }), url);
  await assert.rejects(resolveVideoUrl(start, 'facebook', { fetchUrl: async () => {
    throw new Error('fetch failed', { cause: { code: 'ECONNRESET' } });
  } }), error => error instanceof DownloadError && /ECONNRESET/.test(error.cause.message));
});
