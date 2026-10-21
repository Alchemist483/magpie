# Verification — 2026-10-21

## Version 1.1.0: snip preview

`node tests/check.cjs` passes the existing checks plus release-without-download, plain and love confirmation, Shift-release preference overridden by plain Save, repeated confirmation saving only once, discard, 60-second timeout, persisted expiry without a running timer, stale/replaced tokens, document mismatch, tab switching, navigation, inactive-tab confirmation, delayed capture superseded by a new snip, preview disabled, storage-budget direct-save fallback, and confirmation after a simulated worker restart.

Browser integration passed in isolated Chrome for Testing **151.0.7922.34**, with normal download handling and native **2× device scale**. Seven confirmed/direct snips produced seven PNGs and seven matching sidecars. Verified:

- Release shows a closed-shadow-DOM popover and downloads nothing.
- A 200 × 160 CSS-pixel selection shows **400 x 320**, with the preview image bounded to 360 CSS pixels and the page's layout unchanged.
- The preview's exact source pixel confirms the selection overlay was absent from capture.
- Save, ♥ Save, and Discard buttons; Enter, Shift+Enter, L, and Esc; Shift-release focus.
- Source-page synthetic Enter/L/Esc events cannot approve or discard a preview; real keypresses still work.
- Silent cleanup on discard, replacement snip, switching tabs, navigation, and 60 seconds (using an accelerated renderer clock).
- Confirmation after stopping the actual service-worker target and letting the message wake a new worker.
- Preview disabled restores immediate snip saving.
- **Zero service-worker errors** during the run.

A fresh quick adversarial review found that page-generated key events could trigger confirmation. The handler now accepts only trusted keyboard input; a browser regression check dispatches synthetic Enter, L, and Esc while the card is open and confirms nothing is saved or dismissed.

Native command/context-menu dispatch, very large real screenshots, and other browser versions remain manual checks. The sections below record the original 1.0 capture validation.

## Automated checks: passed

`node tests/check.cjs` uses no third-party packages. It checks manifest settings, PNG icon dimensions, signatures for JPEG/PNG/WebP/GIF/AVIF/SVG, MIME fallback, rejection of an HTML error body, folder validation, local timestamps and offset formatting, all 13 metadata keys, pixel-scaled crop bounds, explicit `saveAs: false`, duplicate and cross-format sidecar naming, independent sidecar-renaming failure feedback, early completion, interrupted-download feedback, and stale snip injection after overlapping starts.

## Browser integration: passed with download-location prompting off

Ran the unpacked extension in an isolated Chrome for Testing **151.0.7922.34** profile on Windows, using Chrome's own download handling with no DevTools download-behavior override. Native device scale was **2×**. Used a local HTTP fixture and real image/download/screenshot APIs.

- Nine captures in `Taste/` and nine matching JSON sidecars, plus one image in a custom folder with sidecars disabled.
- PNG bytes at a `.jpg` URL with the wrong Content-Type: saved as PNG.
- WebP, data URL, and page-owned blob image: saved successfully.
- Love image: filename and boolean matched.
- Concurrent duplicate names: both preserved with matching JSON filenames.
- HTTP 403 during image fetch: direct-download fallback succeeded.
- A 200 × 160 CSS-pixel snip became a **400 × 320 PNG**. Its central pixel exactly matched the source color, confirming the overlay was absent. Shift on release marked it loved.
- Escape and click-only cancellation produced no files.
- Options validation, saving, custom folder, and disabled metadata worked.
- Restricted `chrome://` snip produced a red badge and one expected descriptive error.
- **Zero service-worker errors during successful actions.**

The browser harness invoked image-save functions and snip startup directly in the worker; it performed the drag, Shift release, and cancellation in the actual page. A human still needs to check native context-menu selection and keyboard-command dispatch using `MANUAL-TESTS.md`.

## Required behavior that failed platform validation

With Chrome's **“Ask where to save each file before downloading” enabled**, a normal browser process left the download awaiting a location prompt despite `saveAs: false`. This requirement is **unfulfilled** under the specified APIs and permissions. Turning the browser preference off made the tested downloads dialog-free. Magpie does not change this global preference.

Optional `downloads.ui` bubble suppression was intentionally skipped; the download bubble may appear.

## Fresh adversarial subagent review

The reviewer independently inspected the code and reproduced two edge cases with isolated VM harnesses:

- A delayed first snip injection could replace a newer overlay with an expired token. Fixed by discarding stale injection completions and preserving newer sessions during failure cleanup. A regression check delays the first injection and confirms only the current token reaches the page.
- Old files absent from download history can cause Chrome to uniquify a sidecar separately. Added final filename validation and red failure feedback. This detects the mismatch and preserves both files; it cannot automatically rename them through the Downloads API. Recovery is documented in REFERENCE.md.

The review did not perform native context-menu or keyboard-command dispatch.

## Not verified

Google Drive desktop syncing, enterprise policies, other Chrome versions, every website's hotlink protection, worker interruption during an actual browser shutdown, and very large images beyond Chrome's memory/message limits. GIF/AVIF/SVG detection was checked with signatures/source fixtures rather than live site downloads.
