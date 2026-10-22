(() => {
  if (globalThis.tasteHoveredImage) return;
  let point = null;
  const track = event => {
    if (event.isTrusted) point = { x: event.clientX, y: event.clientY };
  };
  window.addEventListener("pointermove", track, { capture: true, passive: true });
  window.addEventListener("pointerover", track, { capture: true, passive: true });
  window.addEventListener("pointerout", event => {
    if (event.isTrusted) point = event.relatedTarget ? { x: event.clientX, y: event.clientY } : null;
  }, { capture: true, passive: true });
  window.addEventListener("blur", () => { point = null; });
  document.addEventListener("visibilitychange", () => { if (document.hidden) point = null; });

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
