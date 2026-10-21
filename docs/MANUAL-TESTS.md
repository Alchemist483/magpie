# Magpie: five-minute manual check

Load the extension and pin its icon. Keep `Downloads/Taste/` visible. Use a normal site with images, or the included fixture page: run `python -m http.server 8765` in the Magpie folder and open `http://localhost:8765/tests/fixtures.html`.

**Known platform limit:** Chrome for Testing 151 still prompts with “Ask where to save” on despite `saveAs: false`. First try one save with that setting on to check your Chrome version. For the remaining dialog-free tests, switch it off at `chrome://settings/downloads`. The requested guarantee with the setting on is unfulfilled.

- [ ] **Normal image:** on a normal site, right-click an image → **Save to Magpie**. One file and one matching `meta/<base>.json`; green ✓; no file picker with the preference off.
- [ ] **WebP:** save a WebP (the fixture includes one). File ends in `.webp` and opens correctly.
- [ ] **Data URL:** save the fixture's **Data URL PNG**. File opens and its sidecar includes the original `data:` URL.
- [ ] **Love:** choose **Save to Magpie ♥ (love it)**. `_love` in the filename and `"love": true` in JSON.
- [ ] **Snip:** press **Alt+Shift+S**, drag an area, release. PNG contains only the selected area; no dark tint, selection border, or hint text. `type` is `snip`, `image_url` is `null`, and `snip_rect` is populated. Repeat through **Snip area to Magpie**; hold Shift on release and check `_snip_love`.
- [ ] **Cancel:** invoke a snip and press Esc; invoke again and click without dragging. Overlay disappears and no files are added.
- [ ] **Restricted page:** open `chrome://extensions` and press the shortcut. Red !, no overlay or file. One descriptive service-worker console error is expected for this intentional failure.
- [ ] **Duplicate:** save the same image rapidly twice in the same second. Both survive, with ` (1)` on one name, and each JSON's `file` matches its image. If necessary, repeat until the timestamp is the same.

If time allows: save the fixture's Blob PNG; change the options folder and disable metadata, then save again; verify the new folder has only the image. Restore your preferred options. Inspect the service worker: normal successful actions should have no errors.
