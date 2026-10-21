# Magpie

Save images and area snips into a personal taste library. Plain JavaScript, Chrome Manifest V3, no build step, dependencies, accounts, analytics, or AI calls.

## Install

1. Extract `Magpie.zip` into a permanent folder.
2. Open `chrome://extensions` in Chrome 120 or newer.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the extracted **Magpie** folder containing `manifest.json`.
5. Pin Magpie from Chrome's Extensions menu to see its feedback badge.

The extension is named Magpie; the default library folder remains `Downloads/Taste/`. Chrome uses its configured default download directory, which may differ from Windows' standard Downloads folder.

## File-dialog limitation — read before use

Every image, snip, and JSON download explicitly uses `saveAs: false`, a relative filename, and `conflictAction: "uniquify"`.

**The requested guarantee with “Ask where to save each file before downloading” enabled is not met.** Testing in a normal Chrome for Testing 151 process, without automation download overrides, found that Chrome still waited for a location prompt with that preference enabled. `saveAs: false` does not reliably override it. For dialog-free captures, turn that preference **off** at `chrome://settings/downloads`. Magpie does not change your browser preferences. The specified APIs and permissions provide no supported way to enforce that preference per extension.

See Chrome's [Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads) and Chromium's [download confirmation logic](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/download/download_target_determiner.cc). Browser policies, an unwritable destination, and security checks can also interrupt a download.

## Capture

- **Image:** right-click an image and choose **Save to Magpie**. The menu action immediately starts the save.
- **Love:** choose **Save to Magpie ♥ (love it)** for a `_love` filename and `love: true` metadata.
- **Snip:** press **Ctrl+Shift+Y**, or right-click the page and choose **Snip area to Magpie**. Drag a rectangle and release to save it as PNG. Hold **Shift when releasing** to mark it as loved.
- **Cancel:** press **Esc**, or click without dragging. Switching away or resizing during selection also cancels.
- A green **✓** badge means the image and, if enabled, its sidecar finished downloading. A red **!** means a capture or download failed. Badges clear after about 1.5 seconds. Error details appear in Magpie's service-worker console, accessible from `chrome://extensions`.

If the shortcut is already taken, assign it at `chrome://extensions/shortcuts`. Chrome blocks overlay injection on `chrome://` pages, the Chrome Web Store, other extension pages, and some built-in viewers; snipping there reports failure. HTTP(S) and local files with extension file access enabled support the overlay. Image saving can still work where reading the page's alt text is blocked.

No preview, confirmation, or save dialog is added by Magpie. Snipping inherently involves invoking the tool and dragging the area.

## Files and metadata

Examples, using your computer's local clock and UTC offset:

```text
Downloads/Taste/2026-10-21_161502_pinterest.com_love.jpg
Downloads/Taste/meta/2026-10-21_161502_pinterest.com_love.json
Downloads/Taste/2026-10-21_161510_pinterest.com_snip.png
```

The page hostname loses its leading `www.`. IPv6 punctuation and filename-unsafe characters become underscores. Existing files are preserved. Repeated captures may gain ` (1)`, ` (2)`, etc. Magpie also avoids a shared base name across different image formats, so a PNG and WebP captured in the same second do not compete for one JSON filename. Sidecars use the image's final filename after Chrome's duplicate handling.

Every sidecar contains all 13 keys:

```json
{
  "file": "2026-10-21_161502_pinterest.com_love.jpg",
  "saved_at": "2026-10-21T16:15:02+02:00",
  "type": "image",
  "love": true,
  "image_url": "https://example.com/photo",
  "page_url": "https://www.pinterest.com/pin/example/",
  "page_title": "Example pin",
  "alt_text": null,
  "width": 1200,
  "height": 1600,
  "snip_rect": null,
  "tags": [],
  "note": ""
}
```

`type` is `image` or `snip`. Snips have `image_url: null`, `alt_text: null`, and `snip_rect: { "x": 10, "y": 20, "w": 300, "h": 200 }` in viewport CSS pixels. Snip `width` and `height` describe the cropped PNG's actual pixels, accounting for screen scale and browser zoom. Image dimensions use the page's natural size when available, then decoded image dimensions; unknown values stay `null`. Unavailable alt text stays `null`. When several page images share the same source, metadata comes from the first matching image.

Images use Chrome's `srcUrl` exactly: the image resource behind the right-clicked element, at its native resource resolution. Magpie does not guess a different original behind a site's thumbnail URL. JPEG, PNG, WebP, GIF, AVIF, and SVG bytes are preserved; magic bytes take priority over MIME type, and URL suffixes are ignored. Blob images are read inside their page/frame and returned as bytes. Animated image files stay animated.

If reading a non-blob image fails, the requested fallback downloads its original URL with a `.jpg` suggestion. Chrome may adjust the extension based on its own MIME checks. This fallback cannot guarantee the server returns an image, or that `.jpg` reflects its bytes; the sidecar records the actual final filename. Hotlink protection can also reject the direct download, producing a red badge. A failed sidecar leaves the already-saved image intact and reports failure.

Pending download records survive worker suspension in session storage. Closing Chrome during an unfinished save can prevent its sidecar from being written. Very large images also depend on Chrome's available memory and extension message limits.

If old files remain after download history is cleared, Chrome can independently uniquify a sidecar. Magpie detects a sidecar filename mismatch and reports a red badge; both files stay intact, and the JSON's `file` still identifies the correct image. Rename that JSON to the image's base name once the conflicting old sidecar is relocated. The Downloads API cannot rename an existing file automatically.

## Options

Right-click Magpie's toolbar icon and select **Options**, or open its details in `chrome://extensions` and choose **Extension options**.

- **Subfolder inside Downloads:** defaults to `Taste`. One folder name, up to 80 characters; absolute paths, separators, and Windows reserved names are rejected.
- **Write metadata sidecars:** on by default. Turning it off saves only images/snips.

Click **Save options**. Existing files stay in their original folder.

## Permissions and privacy

| Permission | Why it is needed |
| --- | --- |
| `contextMenus` | Adds the image-save and page-snip commands. |
| `downloads` | Writes captures/sidecars to relative paths under Chrome's default download directory, monitors completion, and checks filenames to avoid collisions. |
| `activeTab` | Grants access when you invoke a capture; used by screenshot capture and script injection. |
| `scripting` | Injects the area overlay and reads image alt text, dimensions, and blob bytes from the image's frame. No persistent page content script runs. |
| `storage` | Stores the two options locally and pending jobs/snipping tokens in session storage so worker suspension does not lose download bookkeeping. |
| Host permission `<all_urls>` | Lets the worker fetch image resources on arbitrary hosts without page CORS restrictions and access the source page/frame on demand. Chrome displays a broad site-access warning for this permission. |

No `tabs`, notifications, clipboard, native-messaging, or `downloads.ui` permission. Optional bubble suppression was skipped because it controls download UI across the entire Chrome profile and requires another permission. Chrome's normal download bubble remains.

The extension contacts only the image URLs you explicitly save, including redirects and a direct-download fallback when needed. Cookies may accompany image requests. Screenshots, metadata, and options remain local. No remote code, libraries, uploads, or telemetry. Google Drive sync, if you configure it separately, uploads the library through Google's desktop app.

## Back up with Google Drive for desktop

1. Install Google Drive for desktop and sign in.
2. Open its system-tray icon, then **Settings → Preferences**.
3. Select **My Computer** (also called **Folders from your computer** in newer layouts), then **Add folder**.
4. Select your actual `Downloads/Taste` folder, or the custom folder selected in Magpie.
5. Enable **Sync with Google Drive**, then choose **Done / Save**. Include the entire folder so `meta/` JSON files sync alongside images.
6. Wait for sync to finish, then verify the folder under **Computers** in Google Drive on the web.

This is folder sync: deletions can propagate. Keep another copy if you need independent historical backups. See Google's [Drive for desktop guide](https://support.google.com/drive/answer/10838124?hl=en).

## Checks

Run the [five-minute checklist](MANUAL-TESTS.md). A convenient local fixture page is included in `tests/`. With Python installed, run `python -m http.server 8765` from this extension folder and open `http://localhost:8765/tests/fixtures.html`. This local server is only a testing convenience; the extension itself needs no server or runtime installation.

Developers can run `node tests/check.cjs` with Node.js; it uses only Node's standard library. See `TEST-RESULTS.md` for verified behavior and remaining manual checks.

## Ponytail

Built using the [Ponytail skill](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md), installed separately in Codex. Ponytail is a development instruction skill; it is not a dependency bundled into Magpie.
