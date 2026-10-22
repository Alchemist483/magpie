(() => {
  if (globalThis.tasteSnipInstalled) return;
  globalThis.tasteSnipInstalled = true;
  let cancelCurrent, currentToken;

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === "taste:discard-snip") {
      if (message.token === currentToken) cancelCurrent?.(false);
    } else if (message?.type === "taste:start-snip") {
      cancelCurrent?.();
      showSnip(message.token);
      respond({ ok: true });
    }
  });

  function showSnip(token) {
    globalThis.tasteHideSaved?.();
    currentToken = token;
    const previousFocus = document.activeElement;
    const controller = new AbortController();
    const signal = controller.signal;
    let host, phaseController, timeout, done = false, mode = "selection", buttons;
    const send = message => chrome.runtime.sendMessage({ ...message, token }).catch(() => ({ ok: false }));
    const restoreFocus = () => {
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    const removeCard = () => { phaseController?.abort(); host?.remove(); restoreFocus(); };
    const finish = (notify = true) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      controller.abort();
      removeCard();
      if (currentToken === token) { cancelCurrent = null; currentToken = null; }
      if (notify) send({ type: "taste:cancel" });
    };
    cancelCurrent = finish;

    function mount(markup) {
      host = document.createElement("div");
      host.setAttribute("popover", "manual");
      host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;margin:0!important;padding:0!important;border:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;background:transparent!important;overflow:hidden!important;z-index:2147483647!important;";
      const shadow = host.attachShadow({ mode: "closed" });
      shadow.innerHTML = markup;
      phaseController = new AbortController();
      document.documentElement.append(host);
      host.showPopover();
      return shadow;
    }

    window.addEventListener("keydown", event => {
      if (!event.isTrusted) return;
      event.stopImmediatePropagation();
      if (event.key === "Escape") { event.preventDefault(); finish(); }
      else if (mode === "preview") {
        if (event.key === "Enter") {
          event.preventDefault();
          confirm();
        } else if (event.key === "Tab") {
          event.preventDefault();
          const focused = buttons.findIndex(button => button.matches(":focus"));
          buttons[(Math.max(focused, 0) + 1) % buttons.length].focus({ preventScroll: true });
        }
      } else if ([" ", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End", "Tab"].includes(event.key)) event.preventDefault();
    }, { capture: true, signal });
    window.addEventListener("blur", () => finish(), { signal });
    window.addEventListener("resize", () => finish(), { signal });
    window.addEventListener("pagehide", () => finish(), { signal });
    document.addEventListener("visibilitychange", () => { if (document.hidden) finish(); }, { signal });

    function confirm() {
      if (done || mode !== "preview") return;
      finish(false);
      send({ type: "taste:confirm" });
    }

    async function showPreview(preview) {
      if (done || preview.token !== token) return;
      mode = "preview";
      const shadow = mount(`
        <style>
          :host::backdrop { background:transparent; }
          #card { position:absolute; visibility:hidden; box-sizing:border-box; max-width:calc(100vw - 32px);
            padding:16px; border:1px solid #c7d7ce; border-radius:12px; background:#fff; color:#15231d;
            box-shadow:0 12px 48px rgb(0 0 0 / 25%); font:14px/1.4 system-ui; }
          h2 { font-size:16px; margin:0 0 12px; }
          img { display:block; width:auto; height:auto; max-width:min(360px, calc(100vw - 66px));
            max-height:min(360px, calc(100vh - 210px)); object-fit:contain; margin:auto; border-radius:4px; }
          #size { margin:8px 0 12px; text-align:center; color:#53645b; }
          #actions { display:flex; gap:8px; flex-wrap:wrap; }
          button { font:inherit; padding:8px 14px; border:1px solid #a4b7ac; border-radius:6px;
            background:#fff; color:#15231d; cursor:pointer; }
          #save { background:#16834a; color:white; border-color:#16834a; }
          button:focus-visible { outline:3px solid #73bc90; outline-offset:3px; }
          #keys { margin:14px 0 0; max-width:360px; font-size:12px; color:#53645b; }
        </style>
        <section id="card" role="dialog" aria-modal="true" aria-labelledby="heading" aria-describedby="size keys">
          <h2 id="heading">Save this snip?</h2>
          <img alt="Preview of your snip">
          <p id="size"></p>
          <div id="actions"><button id="save" type="button">Save</button><button id="discard" type="button">Discard</button></div>
          <p id="keys">Enter: Save · Esc: Discard</p>
        </section>`);
      const card = shadow.getElementById("card"), image = shadow.querySelector("img");
      image.src = preview.dataUrl;
      shadow.getElementById("size").textContent = `${preview.width} x ${preview.height}`;
      buttons = ["save", "discard"].map(id => shadow.getElementById(id));
      buttons[0].addEventListener("click", confirm, { signal: phaseController.signal });
      buttons[1].addEventListener("click", () => finish(), { signal: phaseController.signal });
      timeout = setTimeout(() => finish(), Math.max(0, preview.expiresAt - Date.now()));
      await image.decode();
      if (done) return;
      const { width, height } = card.getBoundingClientRect(), rect = preview.rect;
      const margin = 16, gap = 12;
      const clamp = (value, max) => Math.max(margin, Math.min(value, max - margin));
      let x = (innerWidth - width) / 2, y = (innerHeight - height) / 2;
      if (rect.x + rect.w + gap + width <= innerWidth - margin) {
        x = rect.x + rect.w + gap; y = clamp(rect.y, innerHeight - height);
      } else if (rect.x - gap - width >= margin) {
        x = rect.x - gap - width; y = clamp(rect.y, innerHeight - height);
      } else if (rect.y + rect.h + gap + height <= innerHeight - margin) {
        x = clamp(rect.x, innerWidth - width); y = rect.y + rect.h + gap;
      } else if (rect.y - gap - height >= margin) {
        x = clamp(rect.x, innerWidth - width); y = rect.y - gap - height;
      }
      Object.assign(card.style, { left: `${Math.max(margin, x)}px`, top: `${Math.max(margin, y)}px`, visibility: "visible" });
      buttons[0].focus({ preventScroll: true });
    }

    const shadow = mount(`
      <style>
        :host::backdrop { background:transparent; }
        #surface { position:absolute; inset:0; cursor:crosshair; touch-action:none;
          background:rgb(0 0 0 / 15%); outline:none; user-select:none; }
        #box { position:absolute; display:none; border:1px solid #fff; box-sizing:border-box;
          box-shadow:0 0 0 1px #16834a; background:rgb(255 255 255 / 8%); pointer-events:none; }
        #hint { position:absolute; left:50%; top:20px; transform:translateX(-50%); padding:10px 16px;
          background:#15231d; color:#fff; border-radius:8px; font:14px/1.4 system-ui; pointer-events:none; }
      </style>
      <div id="surface" tabindex="-1" role="dialog" aria-label="Drag to snip. Escape cancels.">
        <div id="hint">Drag to snip · Esc to cancel</div><div id="box"></div>
      </div>`);
    const surface = shadow.getElementById("surface"), box = shadow.getElementById("box");
    const phaseSignal = phaseController.signal;
    let start, pointerId;
    const viewport = { w: innerWidth, h: innerHeight, dpr: devicePixelRatio };
    const clampPoint = event => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
    const rectAt = event => {
      const end = clampPoint(event);
      return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
    };
    surface.addEventListener("pointerdown", event => {
      if (event.button !== 0 || start) return;
      event.preventDefault();
      start = clampPoint(event); pointerId = event.pointerId;
      surface.setPointerCapture(pointerId);
      shadow.getElementById("hint").hidden = true;
    }, { signal: phaseSignal });
    surface.addEventListener("pointermove", event => {
      if (!start || event.pointerId !== pointerId) return;
      const rect = rectAt(event);
      Object.assign(box.style, { display: "block", left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    }, { signal: phaseSignal });
    surface.addEventListener("pointerup", async event => {
      if (!start || event.pointerId !== pointerId || done || mode !== "selection") return;
      const rect = rectAt(event);
      if (rect.w < 2 || rect.h < 2) { finish(); return; }
      mode = "capturing";
      removeCard();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      if (done) return;
      if (innerWidth !== viewport.w || innerHeight !== viewport.h || devicePixelRatio !== viewport.dpr) { finish(); return; }
      const response = await send({ type: "taste:snip", rect, viewport });
      if (done) return;
      if (response?.preview) showPreview(response.preview).catch(() => finish());
      else finish(false);
    }, { signal: phaseSignal });
    surface.addEventListener("pointercancel", () => finish(), { signal: phaseSignal });
    window.addEventListener("wheel", event => event.preventDefault(), { passive: false, capture: true, signal: phaseSignal });
    window.addEventListener("touchmove", event => event.preventDefault(), { passive: false, capture: true, signal: phaseSignal });
    surface.focus({ preventScroll: true });
  }
})();
