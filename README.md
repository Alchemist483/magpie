# Magpie

Magpie is a small browser extension for saving images you find beautiful, with one shortcut and no save dialogs. Everything lands in a single folder, so over time you build a personal library of your own taste. Later, AI can look through that library and work out which colours, shapes and styles you keep coming back to, and use them as the starting point for your own design system.

The name is a nod to Eagle, the paid image organiser it replaces. A magpie is the small bird that collects shiny things it likes.

## What it does

- **Save an image instantly:** hover over it and press **Ctrl+Shift+E**. No menu or preview appears. You can still right-click and choose **Save to Magpie**.
- **Snip part of a page:** press **Ctrl+Shift+Y** (or right-click and choose **Snip area to Magpie**) and drag a box. A small preview shows what you captured and its pixel size. Choose **Save** or **Discard**. Nothing is saved until you approve it.
- **Keep the context:** every save gets a small notes file with the page it came from, its title, and the date.

In the preview, **Enter** saves and **Esc** discards. The preview has just two buttons: **Save** and **Discard**.

Previews disappear without saving after 60 seconds, when you leave the page or switch tabs, or when you start another snip. Image right-click saves still happen immediately. For very large snips, Magpie saves directly to avoid filling its temporary storage.

To return to immediate snip saving, open Magpie's **Options** and turn off **Preview snips before saving**. Preview is on by default.

Magpie hides Chrome's download bubble while saving, so it doesn't pop open after every capture. This is on by default; turn off **Hide Chrome's download bubble during saves** in Options if you prefer the usual feedback. Chrome applies this briefly to all downloads in the same browser profile, including any unrelated download happening at the same time. Your files still appear in download history.

## Install (Chrome or Brave)

1. Download this repository (Code › Download ZIP) and unzip it somewhere permanent.
2. Open `chrome://extensions` (in Brave: `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.
4. In your browser's download settings (`chrome://settings/downloads` or `brave://settings/downloads`), turn **off** "Ask where to save each file before downloading". Otherwise the browser still shows a save dialog. This setting applies to all downloads, not just Magpie.

Change either shortcut at `chrome://extensions/shortcuts` (or `brave://extensions/shortcuts`). If a shortcut does nothing, it may already be taken. On macOS, Chrome uses Command in place of Ctrl. Avoid Alt+Shift combos on Windows, which uses Alt+Shift to switch keyboard language.

After updating, reload Magpie at `chrome://extensions` and refresh your open image pages once so hover capture works through page overlays and frames. Hover saving works with image elements; use a snip for backgrounds, canvases or other artwork that isn't an image element.

## Where files go

Browsers only let extensions save inside the Downloads folder, so Magpie saves to `Downloads/Taste/`:

```
Downloads/Taste/
  2026-10-21_161502_pinterest.com.jpg
  2026-10-21_161730_example.com_snip.png
  meta/
    2026-10-21_161502_pinterest.com.json
    2026-10-21_161730_example.com_snip.json
```

You can change the folder name in Magpie's options. To keep the library somewhere else, for example `Pictures\Taste` on Windows, link it with a folder junction (run this once in Command Prompt, before `Downloads\Taste` exists):

```
mklink /J "%USERPROFILE%\Downloads\Taste" "%USERPROFILE%\Pictures\Taste"
```

Back up the real folder with Google Drive for desktop or any other sync tool.

## More detail

- [Full reference](docs/REFERENCE.md): metadata format, permissions, edge cases
- [Five-minute manual test](docs/MANUAL-TESTS.md)
- [Test results](docs/TEST-RESULTS.md)

Developers can run `node tests/check.cjs` (Node.js, no packages needed).

## License

MIT. Free to use, change and share. See [LICENSE](LICENSE).
