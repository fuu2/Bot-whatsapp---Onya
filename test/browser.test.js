'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveBrowserPath, browserLaunchOptions } = require('../src/browser');
const suffix = '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const systemPath = 'C:\\Program Files' + suffix;
const userPath = 'C:\\Users\\User\\AppData\\Local' + suffix;
const options = files => ({ platform: 'win32', env: {
  ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\User\\AppData\\Local'
}, fileExists: file => files.includes(file) });

test('CHROME_PATH kosong menghasilkan executablePath Brave, tanpa fallback Chrome', () => {
  const result = browserLaunchOptions({ ...options([systemPath]), configuredPath: '  ' });
  assert.equal(result.executablePath, systemPath);
  assert.equal(result.headless, true);
});

test('Brave per pengguna dan pemasangan x86 dikenali', () => {
  for (const file of [userPath, 'C:\\Program Files (x86)' + suffix]) {
    assert.equal(resolveBrowserPath(options([file])), file);
  }
});

test('lokasi Program Files pada drive lain dikenali dari environment', () => {
  const file = 'D:\\Apps' + suffix;
  assert.equal(resolveBrowserPath({ ...options([file]), env: { ProgramFiles: 'D:\\Apps' } }), file);
});

test('path eksplisit diprioritaskan dan menerima spasi/quote di luar path', () => {
  const custom = 'D:\\Browser Saya\\brave.exe';
  assert.equal(resolveBrowserPath({ ...options([systemPath, custom]), configuredPath: ` "${custom}" ` }), custom);
});

test('path eksplisit salah memberi petunjuk, bukan mengganti browser diam-diam', () => {
  assert.throws(() => resolveBrowserPath({ ...options([systemPath]), configuredPath: 'D:\\salah\\brave.exe' }), /CHROME_PATH menunjuk file yang tidak ditemukan/);
});

test('tanpa Brave memberi petunjuk lokasi, tanpa error Chrome unduhan Puppeteer', () => {
  assert.throws(() => resolveBrowserPath(options([])), /brave:\/\/version/);
});

test('Brave Linux dan macOS dikenali', () => {
  for (const [platform, expected] of [
    ['linux', '/usr/bin/brave-browser'],
    ['darwin', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
  ]) {
    assert.equal(resolveBrowserPath({ platform, env: {}, fileExists: file => file === expected }), expected);
  }
});
