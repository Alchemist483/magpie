// Run with Node.js: node tests/check.cjs (no packages required).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const events = {};
const listener = name => ({ addListener: fn => { events[name] = fn; } });
const session = {};
const downloads = [];
const errors = [];
const badges = [];
let renameNextSidecar = false;
const chrome = {
  runtime: { id: 'test', onInstalled: listener('installed'), onMessage: listener('message') },
  contextMenus: { onClicked: listener('context'), removeAll: cb => cb(), create() {} },
  commands: { onCommand: listener('command') },
  tabs: {}, scripting: {},
  storage: {
    local: { get: async defaults => defaults },
    session: {
      get: async key => key === null ? { ...session } : { [key]: session[key] },
      set: async values => Object.assign(session, values),
      remove: async key => { delete session[key]; }
    }
  },
  action: {
    setBadgeBackgroundColor: async () => {},
    setBadgeText: async value => badges.push(value.text)
  },
  downloads: {
    onChanged: listener('changed'),
    download: async options => {
      const id = downloads.length + 1;
      let filename = options.filename.replace(/\//g, '\\').replace('test.webp', 'test (1).webp');
      if (renameNextSidecar && filename.endsWith('.json')) {
        filename = filename.replace('.json', ' (1).json'); renameNextSidecar = false;
      }
      downloads.push({ id, options, state: 'complete', filename: `C:\\Downloads\\${filename}` });
      return id;
    },
    search: async ({ id, filenameRegex }) => downloads.filter(item => id ? item.id === id : new RegExp(filenameRegex).test(item.filename))
  }
};
const context = vm.createContext({ chrome, console: { error: (...args) => errors.push(args) },
  TextDecoder, Uint8Array, Blob, URL, Date, Map, Promise, AbortSignal,
  btoa, atob, fetch, crypto: webcrypto, setTimeout: () => 1, clearTimeout() {} });
vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
const call = (name, ...args) => context[name](...args);

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.commands['snip-area'].suggested_key.default, 'Alt+Shift+S');
  for (const size of [16, 48, 128]) {
    const png = fs.readFileSync(path.join(root, `icons/${size}.png`));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  for (const [hex, expected] of [
    ['ffd8ff00', 'jpg'], ['89504e470d0a1a0a', 'png'], ['474946383961', 'gif'],
    ['524946460000000057454250', 'webp'], ['000000186674797061766966', 'avif']
  ]) assert.equal(call('imageExtension', new Uint8Array(Buffer.from(hex, 'hex')), 'image/jpeg'), expected);
  assert.equal(call('imageExtension', new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.throws(() => call('imageExtension', new TextEncoder().encode('<html>Access denied</html>'), 'image/jpeg'));
  assert.throws(() => call('imageExtension', new Uint8Array()));
  for (const bad of ['../outside', 'A/B', 'A\\B', 'CON', 'nul.txt', 'bad.', '', 'C:drive', '\u0001']) assert.throws(() => call('folderName', bad));
  assert.equal(call('folderName', ' Taste '), 'Taste');
  const date = new Date(2026, 9, 21, 16, 15, 2);
  const result = call('metadata', 'image', true, { url: 'https://www.pinterest.com/pin/1', title: 'Pin' }, 'data:image/png;base64,AA==', {}, null, date);
  assert.equal(result.base, '2026-10-21_161502_pinterest.com_love');
  assert.match(result.meta.saved_at, /^2026-10-21T16:15:02[+-]\d{2}:\d{2}$/);
  date.getTimezoneOffset = () => 330;
  assert.ok(call('localStamp', date).iso.endsWith('-05:30'));
  assert.deepEqual(Object.keys(result.meta), ['file', 'saved_at', 'type', 'love', 'image_url', 'page_url', 'page_title', 'alt_text', 'width', 'height', 'snip_rect', 'tags', 'note']);
  assert.equal(result.meta.alt_text, null);
  assert.equal(result.meta.width, null);
  const rect = { x: 10, y: 20, w: 100, h: 80 };
  const crop = call('cropBounds', rect, { w: 800, h: 600, dpr: 2 }, 1600, 1200);
  assert.deepEqual(JSON.parse(JSON.stringify(crop)), { x: 20, y: 40, w: 200, h: 160 });
  assert.throws(() => call('cropBounds', { ...rect, x: -1 }, { w: 800, h: 600, dpr: 1 }, 800, 600));
  await call('download', 'data:image/webp;base64,AA==', 'Taste/test.webp', { folder: 'Taste', meta: result.meta, tabId: 7 });
  assert.equal(downloads.length, 2);
  for (const { options } of downloads) {
    assert.equal(options.saveAs, false);
    assert.equal(options.conflictAction, 'uniquify');
  }
  assert.equal(downloads[1].options.filename, 'Taste/meta/test (1).json');
  assert.equal(JSON.parse(decodeURIComponent(downloads[1].options.url.split(',')[1])).file, 'test (1).webp');
  assert.equal(Object.keys(session).length, 0);
  assert.ok(badges.includes('✓'));
  await Promise.all([
    call('saveCapture', 'data:image/png;base64,AA==', 'Taste/collision.png', { folder: 'Taste', meta: result.meta, tabId: 7 }),
    call('saveCapture', 'data:image/webp;base64,AA==', 'Taste/collision.webp', { folder: 'Taste', meta: result.meta, tabId: 7 })
  ]);
  assert.ok(downloads.some(item => item.options.filename === 'Taste/collision.png'));
  assert.ok(downloads.some(item => item.options.filename === 'Taste/collision (1).webp'));
  assert.ok(downloads.some(item => item.options.filename === 'Taste/meta/collision (1).json'));
  renameNextSidecar = true;
  const badgeCount = badges.length;
  await call('download', 'data:image/png;base64,AA==', 'Taste/orphan.png', { folder: 'Taste', meta: result.meta, tabId: 7 });
  assert.equal(errors.length, 1);
  assert.match(errors[0].join(' '), /Metadata filename collision/);
  assert.deepEqual(badges.slice(badgeCount), ['!']);
  // Completing before the session record exists must still be processed later.
  const failedId = downloads.length + 1;
  await call('finishDownload', failedId);
  downloads.push({ id: failedId, state: 'interrupted', error: 'NETWORK_FAILED' });
  session[`download:${failedId}`] = { tabId: 7 };
  await Promise.all([call('finishDownload', failedId), call('finishDownload', failedId)]);
  assert.equal(errors.length, 2);
  assert.ok(badges.includes('!'));
  assert.equal(Object.keys(session).length, 0);
  let releaseFirst;
  const firstInjection = new Promise(resolve => { releaseFirst = resolve; });
  let injectionCount = 0;
  const sent = [];
  chrome.scripting.executeScript = async () => { if (++injectionCount === 1) await firstInjection; };
  chrome.tabs.sendMessage = async (tabId, message) => sent.push(message.token);
  const tab = { id: 7, url: 'https://example.com/', title: 'Test' };
  const firstSnip = call('startSnip', tab);
  while (injectionCount < 1) await Promise.resolve();
  await call('startSnip', tab);
  const currentToken = session['snip:7'].token;
  releaseFirst(); await firstSnip;
  assert.deepEqual(sent, [currentToken]);
  console.log('PASS: manifest/icons, seven image types, HTML rejection, folder safety, local naming and offsets, stable schema, DPR crop, quiet downloads, duplicate and cross-format sidecars, early completion, interrupted download.');
})().catch(error => { console.error(error); process.exitCode = 1; });
