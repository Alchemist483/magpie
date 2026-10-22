(() => {
  if (globalThis.tasteHoveredImage) return;
  let point = null, lastPoint, check, checkTimer;
  const track = event => {
    if (event.isTrusted) {
      point = lastPoint = { x: event.clientX, y: event.clientY };
      positionCheck();
    }
  };
  window.addEventListener("pointermove", track, { capture: true, passive: true });
  window.addEventListener("pointerover", track, { capture: true, passive: true });
  window.addEventListener("pointerout", event => {
    if (event.isTrusted) point = event.relatedTarget ? { x: event.clientX, y: event.clientY } : null;
  }, { capture: true, passive: true });
  window.addEventListener("blur", () => { point = null; hideCheck(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { point = null; hideCheck(); } });
  window.addEventListener("pagehide", hideCheck);

  function hideCheck() {
    clearTimeout(checkTimer);
    check?.remove();
    check = null;
  }

  function positionCheck() {
    if (!check) return;
    const { x, y } = lastPoint || { x: innerWidth - 42, y: 10 };
    const place = (value, limit) => Math.max(4, Math.min(value + 38 <= limit - 4 ? value + 14 : value - 38, limit - 28));
    check.style.setProperty("left", `${place(x, innerWidth)}px`, "important");
    check.style.setProperty("top", `${place(y, innerHeight)}px`, "important");
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === "taste:hide-saved" || message?.type === "taste:start-snip") hideCheck();
    if (message?.type !== "taste:saved" || document.hidden) return;
    hideCheck();
    check = document.createElement("div");
    check.setAttribute("popover", "manual");
    check.setAttribute("role", "status");
    check.setAttribute("aria-label", "Saved to Magpie");
    check.style.cssText = "all:initial!important;position:fixed!important;inset:auto!important;margin:0!important;padding:0!important;border:0!important;width:24px!important;height:24px!important;max-width:none!important;max-height:none!important;background:transparent!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important;";
    const shadow = check.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>:host::backdrop { display:none; } svg { display:block; filter:drop-shadow(0 2px 3px rgb(0 0 0 / 18%)); }</style>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#16834a" stroke="white" stroke-width="2"/><path d="m7 12 3 3 7-7" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    document.documentElement.append(check);
    positionCheck();
    check.showPopover();
    checkTimer = setTimeout(hideCheck, 1200);
  });

  function imageAt(root, visited = new Set()) {
    if (visited.has(root)) return null;
    visited.add(root);
    const elements = point ? root.elementsFromPoint(point.x, point.y) : root.querySelectorAll(":hover");
    for (const element of elements) {
      // Let the frame's own script resolve its image, rather than saving one behind it.
      if (element.localName === "iframe" || element.localName === "frame") return null;
      if (element.shadowRoot) {
        const image = imageAt(element.shadowRoot, visited);
        if (image) return image;
      }
      if (element.localName === "img") return element;
    }
    return null;
  }

  // Coordinates stay in this frame; nothing is sent or fetched until the user saves.
  globalThis.tasteHoveredImage = () => !document.hidden && document.documentElement.matches(":hover") ? imageAt(document) : null;
})();
