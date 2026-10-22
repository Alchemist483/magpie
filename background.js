const DEFAULTS = { folder: "Taste", metadata: true, previewSnips: true, quietDownloads: true };
const PREVIEW_TTL = 60_000;
const PREVIEW_BUDGET = 8 * 1024 * 1024;
const MIME_TYPES = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  avif: "image/avif", svg: "image/svg+xml"
};
const badgeTimers = new Map();
const finishing = new Map();
let captureQueue = Promise.resolve();
let snipQueue = Promise.resolve();
let downloadUiQueue = Promise.resolve();
const previewTimers = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title, contexts] of [
      ["save", "Save to Magpie", ["image"]],
      ["snip", "Snip area to Magpie", ["page", "image"]]
    ]) chrome.contextMenus.create({ id, title, contexts });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const task = info.menuItemId === "snip" ? startSnip(tab) : saveImage(info, tab);
  task.catch(error => fail(error, tab?.id));
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!["snip-area", "save-hovered"].includes(command)) return;
  (async () => {
    tab ||= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (command === "snip-area") await startSnip(tab);
    else await saveHoveredImage(tab);
  })().catch(error => fail(error, tab?.id));
});

async function saveHoveredImage(tab) {
  if (!Number.isInteger(tab?.id)) throw new Error("No image tab is available.");
  const frames = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => {
      const image = globalThis.tasteHoveredImage ? globalThis.tasteHoveredImage() : document.querySelector("img:hover");
      if (!image) return null;
      return { srcUrl: image.currentSrc || image.src, details: { alt: image.getAttribute("alt") || null,
        width: image.naturalWidth || null, height: image.naturalHeight || null } };
    }
  });
  const hovered = frames.filter(frame => frame.result?.srcUrl);
  if (hovered.length !== 1) throw new Error("Move your pointer over one image, then press the save shortcut.");
  const { frameId, documentId, result } = hovered[0];
  await saveImage({ srcUrl: result.srcUrl, frameId, documentId }, tab, result.details);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 ||
      !["taste:snip", "taste:cancel", "taste:confirm"].includes(message?.type)) return;
  handleSnipMessage(message, sender).then(respond).catch(async error => {
    await discardSnip(sender.tab.id, message.token).catch(() => {});
    fail(error, sender.tab.id);
    respond({ ok: false });
  });
  return true;
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  chrome.storage.session.get(null).then(items => Promise.all(Object.entries(items)
    .filter(([key, session]) => key.startsWith("snip:") && session.windowId === windowId && key !== `snip:${tabId}`)
    .map(([key, session]) => discardSnip(Number(key.slice(5)), session.token)))).catch(error => fail(error));
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" || change.url) discardSnip(tabId).catch(error => fail(error));
});
chrome.tabs.onRemoved.addListener(tabId => { discardSnip(tabId).catch(error => fail(error)); });

chrome.downloads.onChanged.addListener(delta => {
  if (delta.state || delta.error) finishDownload(delta.id).catch(error => fail(error));
});

// Session storage survives service-worker suspension; promises alone do not.
chrome.storage.session.get(null).then(items => {
  for (const key of Object.keys(items)) {
    if (key.startsWith("download:")) finishDownload(Number(key.slice(9))).catch(error => fail(error));
  }
  updateDownloadUi(() => restoreDownloadUi()).catch(error => fail(error));
}).catch(error => fail(error));

function updateDownloadUi(task) {
  const next = downloadUiQueue.then(task);
  downloadUiQueue = next.catch(() => {});
  return next;
}

async function restoreDownloadUi() {
  const jobs = await chrome.storage.session.get(null);
  if (!jobs.downloadUiHidden || Object.keys(jobs).some(key => key.startsWith("download:"))) return;
  // Releasing our request must not fight another extension that still hides the UI.
  await chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});
  await chrome.storage.session.remove("downloadUiHidden");
}
snipState(async () => {
  const items = await chrome.storage.session.get(null);
  for (const [key, session] of Object.entries(items)) {
    if (key.startsWith("snip:") && session.expiresAt) {
      if (session.expiresAt <= Date.now()) await removeSnip(Number(key.slice(5)), session);
      else armPreviewTimeout(Number(key.slice(5)), session);
    }
  }
}).catch(error => fail(error));

// Serialize only state transitions: a second confirm must never download twice.
function snipState(task) {
  const next = snipQueue.then(task);
  snipQueue = next.catch(() => {});
  return next;
}

async function removeSnip(tabId, session) {
  if (!session) return;
  clearTimeout(previewTimers.get(session.token));
  previewTimers.delete(session.token);
  await chrome.storage.session.remove([`snip:${tabId}`, `preview:${session.token}`]);
}

function discardSnip(tabId, token) {
  return snipState(async () => {
    const session = (await chrome.storage.session.get(`snip:${tabId}`))[`snip:${tabId}`];
    if (!session || (token && session.token !== token)) return;
    await removeSnip(tabId, session);
    chrome.tabs.sendMessage(tabId, { type: "taste:discard-snip", token: session.token }, { frameId: 0 }).catch(() => {});
  });
}

function armPreviewTimeout(tabId, session) {
  clearTimeout(previewTimers.get(session.token));
  previewTimers.set(session.token, setTimeout(() => {
    discardSnip(tabId, session.token).catch(error => fail(error));
  }, Math.max(0, session.expiresAt - Date.now())));
}

async function isSnipActive(tab, session) {
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  return active?.id === tab.id && active.url === session.url;
}

async function handleSnipMessage(message, sender) {
  const tab = sender.tab;
  const claimed = await snipState(async () => {
    const key = `snip:${tab.id}`;
    const session = (await chrome.storage.session.get(key))[key];
    if (!session || session.token !== message.token ||
        (session.documentId && session.documentId !== sender.documentId)) return null;
    if (message.type === "taste:cancel" || (session.expiresAt && session.expiresAt <= Date.now())) {
      await removeSnip(tab.id, session);
      return null;
    }
    if (message.type === "taste:confirm") {
      if (session.stage !== "preview") return null;
      const pending = (await chrome.storage.session.get(`preview:${session.token}`))[`preview:${session.token}`];
      if (!pending) { await removeSnip(tab.id, session); return null; }
      if (!await isSnipActive(tab, session)) { await removeSnip(tab.id, session); return null; }
      await removeSnip(tab.id, session);
      return { session, pending };
    }
    if (session.stage !== "selecting") return null;
    await chrome.storage.session.set({ [key]: { ...session, stage: "capturing" } });
    return { session };
  });
  if (!claimed) return { ok: false };
  if (claimed.pending) {
    await writeSnip(claimed.pending, tab, claimed.session);
    return { ok: true };
  }
  const crop = await captureSnip(message, tab, claimed.session);
  if (!crop) { await discardSnip(tab.id, message.token); return { ok: false }; }
  const settings = await chrome.storage.local.get(DEFAULTS);
  const outcome = await snipState(async () => {
    const key = `snip:${tab.id}`;
    const current = (await chrome.storage.session.get(key))[key];
    if (current?.token !== message.token || current.stage !== "capturing") return null;
    if (!await isSnipActive(tab, current)) { await removeSnip(tab.id, current); return null; }
    const used = await chrome.storage.session.getBytesInUse(null);
    // Budget for UTF-16 strings and job bookkeeping, below session's 10 MB quota.
    if (!settings.previewSnips || crop.dataUrl.length > PREVIEW_BUDGET || used + crop.dataUrl.length * 2 + 4096 > PREVIEW_BUDGET) {
      await removeSnip(tab.id, current);
      return { direct: true };
    }
    const session = { ...current, stage: "preview", expiresAt: Date.now() + PREVIEW_TTL };
    await chrome.storage.session.set({ [key]: session, [`preview:${session.token}`]: crop });
    armPreviewTimeout(tab.id, session);
    return { preview: { ...crop, token: session.token, expiresAt: session.expiresAt } };
  });
  if (!outcome) return { ok: false };
  if (outcome.direct) await writeSnip(crop, tab, claimed.session);
  return { ok: true, ...(outcome.preview ? { preview: outcome.preview } : {}) };
}

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

async function saved(job) {
  badge(true, job.tabId);
  if (!Number.isInteger(job.tabId) || !job.documentId) return;
  const target = { tabId: job.tabId, documentIds: [job.documentId] };
  const show = () => {
    if (!globalThis.tasteShowSaved) return false;
    globalThis.tasteShowSaved();
    return true;
  };
  try {
    const [result] = await chrome.scripting.executeScript({ target, func: show });
    if (!result?.result) {
      // Existing tabs may lack the current content script after an extension update.
      await chrome.scripting.executeScript({ target, files: ["hover.js"] });
      await chrome.scripting.executeScript({ target, func: show });
    }
  } catch {} // A closed/navigated/restricted page must not turn a completed download into failure.
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

function metadata(type, page, imageUrl, details = {}, rect = null, date = new Date()) {
  const stamp = localStamp(date);
  let site = "unknown-site";
  try { site = new URL(page.url).hostname.replace(/^www\./, "") || site; } catch {}
  site = site.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  return {
    base: `${stamp.name}_${site}${type === "snip" ? "_snip" : ""}`,
    meta: {
      file: "", saved_at: stamp.iso, type, image_url: imageUrl,
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
  return { ...injection.result, documentId: injection.documentId };
}

async function saveImage(info, tab, hoveredDetails) {
  if (!Number.isInteger(tab?.id)) throw new Error("No image tab is available.");
  const url = info.srcUrl || "";
  if (!/^(https?:|data:|blob:)/i.test(url)) throw new Error("This image URL is not supported.");
  const date = new Date();
  const settings = await chrome.storage.local.get(DEFAULTS);
  const folder = folderName(settings.folder);
  const isBlob = url.startsWith("blob:");
  let details = hoveredDetails || {};
  try { if (isBlob || !hoveredDetails) details = { ...await imageDetails(tab.id, info.frameId ?? 0, url, isBlob), ...hoveredDetails }; }
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
  const result = metadata("image", tab, url, details, null, date);
  await saveCapture(downloadUrl, `${folder}/${result.base}.${extension}`, {
    tabId: tab.id, documentId: info.documentId || details.documentId,
    folder, meta: settings.metadata ? result.meta : null
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
  await snipState(async () => {
    await removeSnip(tab.id, (await chrome.storage.session.get(key))[key]);
    await chrome.storage.session.set({ [key]: { token, url: tab.url, title: tab.title || "", windowId: tab.windowId, stage: "selecting" } });
  });
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["snip.js"] });
    const current = await snipState(async () => {
      const session = (await chrome.storage.session.get(key))[key];
      if (session?.token !== token) return false;
      if (injection?.documentId) await chrome.storage.session.set({ [key]: { ...session, documentId: injection.documentId } });
      return true;
    });
    if (!current) return;
    await chrome.tabs.sendMessage(tab.id, { type: "taste:start-snip", token }, { frameId: 0 });
  } catch (error) {
    await discardSnip(tab.id, token);
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

async function captureSnip(message, tab, session) {
  cropBounds(message.rect, message.viewport, message.viewport?.w, message.viewport?.h);
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true },
    func: () => globalThis.tasteHideSaved?.() }).catch(() => {});
  if (!await isSnipActive(tab, session)) return null;
  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  if (!await isSnipActive(tab, session)) return null;
  const bitmap = await createImageBitmap(await (await fetch(screenshot)).blob());
  let blob, crop;
  try {
    crop = cropBounds(message.rect, message.viewport, bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(crop.w, crop.h);
    canvas.getContext("2d").drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    blob = await canvas.convertToBlob({ type: "image/png" });
  } finally { bitmap.close(); }
  return { dataUrl: dataUrl(new Uint8Array(await blob.arrayBuffer()), "image/png"), width: crop.w, height: crop.h,
    rect: message.rect };
}

async function writeSnip(crop, tab, session) {
  const settings = await chrome.storage.local.get(DEFAULTS);
  const folder = folderName(settings.folder);
  const result = metadata("snip", session, null, { width: crop.width, height: crop.height }, crop.rect);
  await saveCapture(crop.dataUrl, `${folder}/${result.base}.png`, {
    tabId: tab.id, documentId: session.documentId,
    folder, meta: settings.metadata ? result.meta : null
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
  const id = await updateDownloadUi(async () => {
    try {
      const { quietDownloads } = await chrome.storage.local.get(DEFAULTS);
      if (quietDownloads) {
        await chrome.storage.session.set({ downloadUiHidden: true });
        await chrome.downloads.setUiOptions({ enabled: false });
      }
      const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
      await chrome.storage.session.set({ [`download:${id}`]: job });
      return id;
    } catch (error) { await restoreDownloadUi(); throw error; }
  });
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
        await download(json, `${job.folder}/meta/${expectedFile}`, {
          tabId: job.tabId, documentId: job.documentId, expectedFile
        });
      } else await saved(job);
      await chrome.storage.session.remove(key);
      await updateDownloadUi(() => restoreDownloadUi());
    } catch (error) {
      await chrome.storage.session.remove(key);
      await updateDownloadUi(() => restoreDownloadUi());
      fail(error, job.tabId);
    }
  });
  finishing.set(id, task);
  task.finally(() => {
    if (finishing.get(id) === task) finishing.delete(id);
  }).catch(() => {});
  return task;
}
