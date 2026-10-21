const DEFAULTS = { folder: "Taste", metadata: true };
const MIME_TYPES = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  avif: "image/avif", svg: "image/svg+xml"
};
const badgeTimers = new Map();
const finishing = new Map();
let captureQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title, contexts] of [
      ["save", "Save to Magpie", ["image"]],
      ["love", "Save to Magpie ♥ (love it)", ["image"]],
      ["snip", "Snip area to Magpie", ["page", "image"]]
    ]) chrome.contextMenus.create({ id, title, contexts });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const task = info.menuItemId === "snip" ? startSnip(tab) : saveImage(info, tab);
  task.catch(error => fail(error, tab?.id));
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "snip-area") return;
  (async () => {
    tab ||= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    await startSnip(tab);
  })().catch(error => fail(error, tab?.id));
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 ||
      !["taste:snip", "taste:cancel"].includes(message?.type)) return;
  (async () => {
    const key = `snip:${sender.tab.id}`;
    const session = (await chrome.storage.session.get(key))[key];
    if (!session || session.token !== message.token) throw new Error("Snip session expired. Start a new snip.");
    await chrome.storage.session.remove(key);
    if (message.type === "taste:snip") await saveSnip(message, sender.tab, session);
    respond({ ok: true });
  })().catch(error => {
    fail(error, sender.tab.id);
    respond({ ok: false });
  });
  return true;
});

chrome.downloads.onChanged.addListener(delta => {
  if (delta.state || delta.error) finishDownload(delta.id).catch(error => fail(error));
});

// Session storage survives service-worker suspension; promises alone do not.
chrome.storage.session.get(null).then(items => {
  for (const key of Object.keys(items)) {
    if (key.startsWith("download:")) finishDownload(Number(key.slice(9))).catch(error => fail(error));
  }
}).catch(error => fail(error));

function badge(ok, tabId) {
  const target = Number.isInteger(tabId) ? { tabId } : {};
  clearTimeout(badgeTimers.get(tabId));
  chrome.action.setBadgeBackgroundColor({ ...target, color: ok ? "#16834a" : "#c52936" }).catch(() => {});
  chrome.action.setBadgeText({ ...target, text: ok ? "✓" : "!" }).catch(() => {});
  badgeTimers.set(tabId, setTimeout(() => {
    chrome.action.setBadgeText({ ...target, text: "" }).catch(() => {});
    badgeTimers.delete(tabId);
  }, 1500));
}

function fail(error, tabId) {
  console.error("Magpie:", error?.message || error);
  badge(false, tabId);
}

function folderName(value) {
  const folder = typeof value === "string" ? value.trim() : "";
  if (!folder || folder.length > 80 || /[<>:"/\\|?*\x00-\x1f]/.test(folder) ||
      /[. ]$/.test(folder) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(folder)) {
    throw new Error("Use one valid subfolder name (1–80 characters), without slashes or trailing dots.");
  }
  return folder;
}

function localStamp(date = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(pad);
  const offset = -date.getTimezoneOffset();
  return {
    name: `${day}_${time.join("")}`,
    iso: `${day}T${time.join(":")}${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  };
}

function metadata(type, love, page, imageUrl, details = {}, rect = null, date = new Date()) {
  const stamp = localStamp(date);
  let site = "unknown-site";
  try { site = new URL(page.url).hostname.replace(/^www\./, "") || site; } catch {}
  site = site.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  return {
    base: `${stamp.name}_${site}${type === "snip" ? "_snip" : ""}${love ? "_love" : ""}`,
    meta: {
      file: "", saved_at: stamp.iso, type, love: Boolean(love), image_url: imageUrl,
      page_url: page.url || "", page_title: page.title || "", alt_text: details.alt ?? null,
      width: details.width || null, height: details.height || null, snip_rect: rect,
      tags: [], note: ""
    }
  };
}

function imageExtension(bytes, contentType = "") {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp" && /avif|avis/.test(ascii(8, Math.min(bytes.length, 64)))) return "avif";
  const text = new TextDecoder().decode(bytes.subarray(0, 4096)).replace(/^\uFEFF/, "").trimStart();
  if (/^(?:<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg(?:\s|>)/i.test(text)) return "svg";
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const extension = Object.keys(MIME_TYPES).find(ext => MIME_TYPES[ext] === mime);
  if (extension && bytes.length && !/^<(?:!doctype\s+html|html|head|body)\b/i.test(text)) return extension;
  throw new Error("The server did not return a supported image.");
}

function dataUrl(bytes, mime) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${mime};base64,${btoa(binary)}`;
}

async function imageDetails(tabId, frameId, url, readBlob) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: async (source, blob) => {
      const img = [...document.images].find(img => img.currentSrc === source || img.src === source);
      const details = { alt: img?.getAttribute("alt") || null, width: img?.naturalWidth || null, height: img?.naturalHeight || null };
      if (blob) {
        const response = await fetch(source, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        details.bytes = btoa(binary);
        details.mime = response.headers.get("content-type") || "";
      }
      return details;
    },
    args: [url, readBlob]
  });
  if (!injection?.result) throw new Error("Could not read this image in its page.");
  return injection.result;
}

async function saveImage(info, tab) {
  if (!Number.isInteger(tab?.id)) throw new Error("No image tab is available.");
  const url = info.srcUrl || "";
  if (!/^(https?:|data:|blob:)/i.test(url)) throw new Error("This image URL is not supported.");
  const date = new Date();
  const settings = await chrome.storage.local.get(DEFAULTS);
  const folder = folderName(settings.folder);
  const isBlob = url.startsWith("blob:");
  let details = {};
  try { details = await imageDetails(tab.id, info.frameId ?? 0, url, isBlob); }
  catch (error) { if (isBlob) throw error; }
  let downloadUrl, extension;
  try {
    let bytes, mime;
    if (isBlob) {
      bytes = Uint8Array.from(atob(details.bytes), char => char.charCodeAt(0));
      mime = details.mime;
    } else {
      const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
      bytes = new Uint8Array(await response.arrayBuffer());
      mime = response.headers.get("content-type") || "";
    }
    extension = imageExtension(bytes, mime);
    downloadUrl = dataUrl(bytes, MIME_TYPES[extension]);
    if (!details.width || !details.height) {
      try {
        const bitmap = await createImageBitmap(new Blob([bytes], { type: MIME_TYPES[extension] }));
        details.width = bitmap.width; details.height = bitmap.height;
        bitmap.close();
      } catch {} // SVG without intrinsic dimensions can still be saved.
    }
  } catch (error) {
    if (isBlob) throw error;
    // shortcut: unreadable servers use the requested .jpg fallback; inspect these files if decoding fails.
    downloadUrl = url;
    extension = "jpg";
  }
  const result = metadata("image", info.menuItemId === "love", tab, url, details, null, date);
  await saveCapture(downloadUrl, `${folder}/${result.base}.${extension}`, {
    tabId: tab.id, folder, meta: settings.metadata ? result.meta : null
  });
}

async function startSnip(tab) {
  if (!Number.isInteger(tab?.id)) throw new Error("No page is available to snip.");
  if (!tab.url) throw new Error("Chrome does not allow the snip overlay on this page.");
  const url = new URL(tab.url);
  if (!["http:", "https:", "file:"].includes(url.protocol) ||
      url.hostname === "chromewebstore.google.com" ||
      (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore"))) {
    throw new Error("Chrome does not allow the snip overlay on this page.");
  }
  const key = `snip:${tab.id}`;
  const token = crypto.randomUUID();
  await chrome.storage.session.set({ [key]: { token, url: tab.url, title: tab.title || "" } });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["snip.js"] });
    if ((await chrome.storage.session.get(key))[key]?.token !== token) return;
    await chrome.tabs.sendMessage(tab.id, { type: "taste:start-snip", token }, { frameId: 0 });
  } catch (error) {
    if ((await chrome.storage.session.get(key))[key]?.token === token) await chrome.storage.session.remove(key);
    throw error;
  }
}

function cropBounds(rect, viewport, width, height) {
  if (!rect || !viewport || ![rect.x, rect.y, rect.w, rect.h, viewport.w, viewport.h, viewport.dpr].every(Number.isFinite) ||
      rect.x < 0 || rect.y < 0 || rect.w < 2 || rect.h < 2 || viewport.w <= 0 || viewport.h <= 0 || viewport.dpr <= 0 ||
      rect.x + rect.w > viewport.w + 1 || rect.y + rect.h > viewport.h + 1) throw new Error("Invalid snip rectangle.");
  // Measured scale includes devicePixelRatio and browser zoom/rounding.
  const sx = width / viewport.w, sy = height / viewport.h;
  const x = Math.floor(rect.x * sx), y = Math.floor(rect.y * sy);
  return { x, y, w: Math.min(width, Math.ceil((rect.x + rect.w) * sx)) - x,
    h: Math.min(height, Math.ceil((rect.y + rect.h) * sy)) - y };
}

async function saveSnip(message, tab, session) {
  cropBounds(message.rect, message.viewport, message.viewport?.w, message.viewport?.h);
  const assertActive = async () => {
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (active?.id !== tab.id || active.url !== session.url) throw new Error("The page changed before capture. Please snip again.");
  };
  await assertActive();
  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  await assertActive();
  const bitmap = await createImageBitmap(await (await fetch(screenshot)).blob());
  let blob, crop;
  try {
    crop = cropBounds(message.rect, message.viewport, bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(crop.w, crop.h);
    canvas.getContext("2d").drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    blob = await canvas.convertToBlob({ type: "image/png" });
  } finally { bitmap.close(); }
  const settings = await chrome.storage.local.get(DEFAULTS);
  const folder = folderName(settings.folder);
  const result = metadata("snip", message.love, session, null, { width: crop.w, height: crop.h }, message.rect);
  await saveCapture(dataUrl(new Uint8Array(await blob.arrayBuffer()), "image/png"), `${folder}/${result.base}.png`, {
    tabId: tab.id, folder, meta: settings.metadata ? result.meta : null
  });
}

function saveCapture(url, filename, job) {
  const task = captureQueue.then(async () => {
    const slash = filename.lastIndexOf("/");
    const folder = filename.slice(0, slash), file = filename.slice(slash + 1);
    const dot = file.lastIndexOf("."), base = file.slice(0, dot), extension = file.slice(dot);
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const existing = await chrome.downloads.search({ filenameRegex: `${escaped}( \\(\\d+\\))?\\.[^.]+$` });
    const pending = Object.values(await chrome.storage.session.get(null)).filter(job => job.filename);
    const names = new Set([...existing, ...pending].map(item => item.filename.split(/[\\/]/).pop().replace(/\.[^.]+$/, "")));
    // Different formats can share a timestamp; their .json sidecars cannot.
    let unique = base, suffix = 0;
    while (names.has(unique)) unique = `${base} (${++suffix})`;
    await download(url, `${folder}/${unique}${extension}`, { ...job, filename: `${folder}/${unique}${extension}` });
  });
  captureQueue = task.catch(() => {});
  return task;
}

async function download(url, filename, job) {
  const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
  await chrome.storage.session.set({ [`download:${id}`]: job });
  // Covers a tiny download completing before its job was stored.
  await finishDownload(id);
}

function finishDownload(id) {
  const task = (finishing.get(id) || Promise.resolve()).then(async () => {
    const key = `download:${id}`;
    const job = (await chrome.storage.session.get(key))[key];
    if (!job) return;
    try {
      const [item] = await chrome.downloads.search({ id });
      if (item?.state === "in_progress") return;
      if (!item || item.state !== "complete") throw new Error(item?.error || "Download did not complete.");
      const file = item.filename.split(/[\\/]/).pop();
      if (job.expectedFile && file !== job.expectedFile) {
        throw new Error(`Metadata filename collision: saved as ${file}, expected ${job.expectedFile}. The image and JSON were preserved.`);
      }
      if (job.meta) {
        const meta = { ...job.meta, file };
        const json = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(meta, null, 2))}`;
        const expectedFile = `${file.replace(/\.[^.]+$/, "")}.json`;
        await download(json, `${job.folder}/meta/${expectedFile}`, { tabId: job.tabId, expectedFile });
      } else badge(true, job.tabId);
      await chrome.storage.session.remove(key);
    } catch (error) {
      await chrome.storage.session.remove(key);
      fail(error, job.tabId);
    }
  });
  finishing.set(id, task);
  task.finally(() => {
    if (finishing.get(id) === task) finishing.delete(id);
  }).catch(() => {});
  return task;
}
