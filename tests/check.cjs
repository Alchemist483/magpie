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
let now = Date.now();
let timerId = 0;
const timers = new Map();
const preferences = {};
let storageUsed;
let activeTab = { id: 7, windowId: 9, url: 'https://example.com/', title: 'Test' };
let cropBytes = fs.readFileSync(path.join(root, 'icons/16.png'));
class ClockDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const chrome = {
  runtime: { id: 'test', onInstalled: listener('installed'), onMessage: listener('message') },
  contextMenus: { onClicked: listener('context'), removeAll: cb => cb(), create() {} },
  commands: { onCommand: listener('command') },
  tabs: {
    onActivated: listener('activated'), onUpdated: listener('updated'), onRemoved: listener('removed'),
    query: async () => [activeTab],
    sendMessage: async () => ({ ok: true }),
    captureVisibleTab: async () => `data:image/png;base64,${cropBytes.toString('base64')}`
  },
  scripting: { executeScript: async () => [{ documentId: 'doc-7' }] },
  storage: {
    local: { get: async defaults => ({ ...defaults, ...preferences }) },
    session: {
      get: async key => key === null ? { ...session } : { [key]: session[key] },
      set: async values => Object.assign(session, values),
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete session[key]; },
      getBytesInUse: async () => storageUsed ?? JSON.stringify(session).length * 2
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
  TextDecoder, Uint8Array, Blob, URL, Date: ClockDate, Map, Promise, AbortSignal,
  createImageBitmap: async () => ({ width: 1600, height: 1200, close() {} }),
  OffscreenCanvas: class {
    getContext() { return { drawImage() {} }; }
    async convertToBlob() { return new Blob([cropBytes], { type: 'image/png' }); }
  },
  btoa, atob, fetch, crypto: webcrypto,
  setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
  clearTimeout: id => timers.delete(id) });
vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
const call = (name, ...args) => context[name](...args);

(async () => {
  await call('snipState', async () => {});
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.1.0');
  assert.equal(manifest.commands['snip-area'].suggested_key.default, 'Ctrl+Shift+Y');
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
  chrome.scripting.executeScript = async () => { if (++injectionCount === 1) await firstInjection; return [{ documentId: 'doc-7' }]; };
  chrome.tabs.sendMessage = async (tabId, message) => { if (message.type === 'taste:start-snip') sent.push(message.token); };
  const tab = activeTab;
  const firstSnip = call('startSnip', tab);
  while (injectionCount < 1) await Promise.resolve();
  await call('startSnip', tab);
  const currentToken = session['snip:7'].token;
  releaseFirst(); await firstSnip;
  assert.deepEqual(sent, [currentToken]);

  const sender = { id: 'test', tab, frameId: 0, documentId: 'doc-7' };
  const snip = { type: 'taste:snip', rect: { x: 10, y: 20, w: 100, h: 80 }, viewport: { w: 800, h: 600, dpr: 2 }, love: false };
  const message = (type, token, love = false) => call('handleSnipMessage', { type, token, love }, sender);
  const flush = async () => { await new Promise(setImmediate); await call('snipState', async () => {}); };
  const advance = async ms => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    await flush();
  };
  const beginPreview = async (love = false) => {
    await call('startSnip', tab);
    const token = session['snip:7'].token;
    const before = downloads.length;
    const response = await call('handleSnipMessage', { ...snip, token, love }, sender);
    assert.equal(response.ok, true);
    assert.ok(response.preview);
    assert.equal(downloads.length, before, 'release must not download');
    assert.ok(session[`preview:${token}`].dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(response.preview.width, 200);
    assert.equal(response.preview.height, 160);
    return { token, response };
  };
  const latestMetadata = () => JSON.parse(decodeURIComponent(downloads.at(-1).options.url.split(',')[1]));
  let preview = await beginPreview();
  let before = downloads.length;
  await message('taste:confirm', preview.token);
  assert.equal(downloads.length, before + 2);
  assert.equal(latestMetadata().love, false);
  assert.equal(latestMetadata().type, 'snip');
  assert.equal(session[`preview:${preview.token}`], undefined);
  assert.equal(session['snip:7'], undefined);

  preview = await beginPreview(true);
  assert.equal(preview.response.preview.love, true);
  before = downloads.length;
  await Promise.all([message('taste:confirm', preview.token, true), message('taste:confirm', preview.token, true)]);
  assert.equal(downloads.length, before + 2, 'double confirm downloads once');
  assert.equal(latestMetadata().love, true);
  assert.ok(latestMetadata().file.includes('_snip_love'));

  preview = await beginPreview(true);
  await message('taste:confirm', preview.token, false);
  assert.equal(latestMetadata().love, false, 'plain Save overrides the Shift release preference');

  preview = await beginPreview(); before = downloads.length;
  await message('taste:cancel', preview.token);
  assert.equal(downloads.length, before);
  assert.equal(session[`preview:${preview.token}`], undefined);

  preview = await beginPreview();
  await advance(60_001);
  assert.equal(session['snip:7'], undefined);
  assert.equal(session[`preview:${preview.token}`], undefined);
  assert.equal((await message('taste:confirm', preview.token)).ok, false);
  assert.equal(downloads.length, before);

  const stale = await beginPreview();
  preview = await beginPreview(); before = downloads.length;
  assert.equal(session[`preview:${stale.token}`], undefined);
  assert.equal((await message('taste:confirm', stale.token)).ok, false);
  assert.equal((await message('taste:cancel', stale.token)).ok, false);
  assert.equal(session['snip:7'].token, preview.token);
  assert.equal(downloads.length, before);
  assert.equal((await call('handleSnipMessage', { type: 'taste:confirm', token: preview.token }, { ...sender, documentId: 'old-document' })).ok, false);
  await message('taste:cancel', preview.token);

  preview = await beginPreview();
  events.activated({ tabId: 8, windowId: 9 }); await flush();
  assert.equal(session[`preview:${preview.token}`], undefined);
  assert.equal((await message('taste:confirm', preview.token)).ok, false);
  preview = await beginPreview();
  events.updated(tab.id, { status: 'loading' }); await flush();
  assert.equal(session[`preview:${preview.token}`], undefined);

  preview = await beginPreview(); before = downloads.length;
  activeTab = { ...tab, id: 8 };
  assert.equal((await message('taste:confirm', preview.token)).ok, false);
  assert.equal(downloads.length, before);
  assert.equal(session[`preview:${preview.token}`], undefined);
  activeTab = tab;

  let releaseCapture, captureStarted = false;
  const captureGate = new Promise(resolve => { releaseCapture = resolve; });
  const originalCapture = chrome.tabs.captureVisibleTab;
  chrome.tabs.captureVisibleTab = async () => { captureStarted = true; await captureGate; return originalCapture(); };
  await call('startSnip', tab);
  const oldToken = session['snip:7'].token;
  const delayedCapture = call('handleSnipMessage', { ...snip, token: oldToken }, sender);
  while (!captureStarted) await new Promise(setImmediate);
  await call('startSnip', tab);
  const replacementToken = session['snip:7'].token;
  releaseCapture();
  assert.equal((await delayedCapture).ok, false);
  assert.equal(session['snip:7'].token, replacementToken);
  assert.equal(session[`preview:${oldToken}`], undefined);
  await message('taste:cancel', replacementToken);
  chrome.tabs.captureVisibleTab = originalCapture;

  preferences.previewSnips = false;
  await call('startSnip', tab); before = downloads.length;
  const direct = await call('handleSnipMessage', { ...snip, token: session['snip:7'].token }, sender);
  assert.equal(direct.preview, undefined);
  assert.equal(downloads.length, before + 2);
  assert.equal(session['snip:7'], undefined);
  delete preferences.previewSnips;
  storageUsed = 9 * 1024 * 1024;
  await call('startSnip', tab); before = downloads.length;
  const overBudget = await call('handleSnipMessage', { ...snip, token: session['snip:7'].token }, sender);
  assert.equal(overBudget.preview, undefined);
  assert.equal(downloads.length, before + 2);
  storageUsed = undefined;

  preview = await beginPreview(); before = downloads.length;
  timers.clear(); now += 60_001;
  assert.equal((await message('taste:confirm', preview.token)).ok, false, 'persisted expiry applies even without a live timer');
  assert.equal(downloads.length, before);
  assert.equal(session[`preview:${preview.token}`], undefined);

  // A suspended worker loses its timers/locals, but the stored crop can still be confirmed.
  preview = await beginPreview(); before = downloads.length;
  timers.clear();
  const restarted = vm.createContext({ ...context });
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), restarted);
  await restarted.snipState(async () => {});
  await restarted.handleSnipMessage({ type: 'taste:confirm', token: preview.token, love: true }, sender);
  assert.equal(downloads.length, before + 2);
  assert.equal(latestMetadata().love, true);
  assert.equal(Object.keys(session).length, 0);
  assert.equal(errors.length, 2, 'stale/expired/discard messages stay quiet');
  console.log('PASS: existing capture checks; preview release/confirm/love/discard/timeout/stale token/double confirm/document/tab/navigation/off/budget/worker restart.');
})().catch(error => { console.error(error); process.exitCode = 1; });
