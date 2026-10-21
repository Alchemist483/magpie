(() => {
  if (globalThis.tasteSnipInstalled) return;
  globalThis.tasteSnipInstalled = true;
  let cancelCurrent;

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "taste:start-snip") return;
    cancelCurrent?.(false);
    showOverlay(message.token);
    respond({ ok: true });
  });

  function showOverlay(token) {
    const previousFocus = document.activeElement;
    const host = document.createElement("div");
    host.setAttribute("popover", "manual");
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;margin:0!important;padding:0!important;border:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;background:transparent!important;overflow:hidden!important;z-index:2147483647!important;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host::backdrop { background: transparent; }
        #surface { position:absolute; inset:0; cursor:crosshair; touch-action:none;
          background:rgb(0 0 0 / 15%); outline:none; user-select:none; }
        #box { position:absolute; display:none; border:1px solid #fff; box-sizing:border-box;
          box-shadow:0 0 0 1px #16834a; background:rgb(255 255 255 / 8%); pointer-events:none; }
        #hint { position:absolute; left:50%; top:20px; transform:translateX(-50%); padding:10px 16px;
          background:#15231d; color:#fff; border-radius:8px; font:14px/1.4 system-ui; pointer-events:none; }
      </style>
      <div id="surface" tabindex="-1" role="dialog" aria-label="Drag to snip. Hold Shift to love. Escape cancels.">
        <div id="hint">Drag to snip · Shift to love · Esc to cancel</div><div id="box"></div>
      </div>`;
    const surface = shadow.getElementById("surface");
    const box = shadow.getElementById("box");
    const controller = new AbortController();
    const signal = controller.signal;
    let start, pointerId, done = false;
    const viewport = { w: innerWidth, h: innerHeight, dpr: devicePixelRatio };
    const clamp = event => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
    const rectAt = event => {
      const end = clamp(event);
      return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
    };
    const remove = () => {
      done = true;
      controller.abort();
      host.remove();
      cancelCurrent = null;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    const send = message => chrome.runtime.sendMessage({ ...message, token }).catch(() => {});
    cancelCurrent = (notify = true) => {
      if (done) return;
      remove();
      if (notify) send({ type: "taste:cancel" });
    };
    surface.addEventListener("pointerdown", event => {
      if (event.button !== 0 || start) return;
      event.preventDefault();
      start = clamp(event); pointerId = event.pointerId;
      surface.setPointerCapture(pointerId);
      shadow.getElementById("hint").hidden = true;
    }, { signal });
    surface.addEventListener("pointermove", event => {
      if (!start || event.pointerId !== pointerId) return;
      const rect = rectAt(event);
      Object.assign(box.style, { display: "block", left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    }, { signal });
    surface.addEventListener("pointerup", async event => {
      if (!start || event.pointerId !== pointerId || done) return;
      const rect = rectAt(event), love = event.shiftKey;
      if (rect.w < 2 || rect.h < 2) { cancelCurrent(); return; }
      remove();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      send({ type: "taste:snip", rect, love, viewport });
    }, { signal });
    surface.addEventListener("pointercancel", () => cancelCurrent?.(), { signal });
    window.addEventListener("keydown", event => {
      event.stopImmediatePropagation();
      if (event.key === "Escape") { event.preventDefault(); cancelCurrent?.(); }
      else if ([" ", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End", "Tab"].includes(event.key)) event.preventDefault();
    }, { capture: true, signal });
    window.addEventListener("wheel", event => event.preventDefault(), { passive: false, capture: true, signal });
    window.addEventListener("touchmove", event => event.preventDefault(), { passive: false, capture: true, signal });
    window.addEventListener("blur", () => cancelCurrent?.(), { signal });
    window.addEventListener("resize", () => cancelCurrent?.(), { signal });
    document.documentElement.append(host);
    host.showPopover();
    surface.focus({ preventScroll: true });
  }
})();
