# Magpie

Magpie is a small browser extension for saving images you find beautiful, with one click and no save dialogs. Everything lands in a single folder, so over time you build a personal library of your own taste. Later, AI can look through that library and work out which colours, shapes and styles you keep coming back to, and use them as the starting point for your own design system.

The name is a nod to Eagle, the paid image organiser it replaces. A magpie is the small bird that collects shiny things it likes.

## What it does

- **Save an image:** right-click it and choose **Save to Magpie**. For the ones you really love, choose **Save to Magpie ♥**.
- **Snip part of a page:** press **Ctrl+Shift+Y** (or right-click and choose **Snip area to Magpie**) and drag a box. A small preview shows what you captured and its pixel size. Choose **Save**, **♥ Save**, or **Discard**. Nothing is saved until you approve it.
- **Keep the context:** every save gets a small notes file with the page it came from, its title, the date, and whether you loved it.

In the preview, **Enter** saves normally, **Shift+Enter** or **L** saves as loved, and **Esc** discards. Holding Shift as you finish dragging highlights and focuses **♥ Save**, but still waits for your approval. Click that button or use the love shortcut to keep it loved; Enter always means normal Save.

Previews disappear without saving after 60 seconds, when you leave the page or switch tabs, or when you start another snip. Image right-click saves still happen immediately. For very large snips, Magpie saves directly to avoid filling its temporary storage.

To return to immediate snip saving, open Magpie's **Options** and turn off **Preview snips before saving**. Preview is on by default.

## Install (Chrome or Brave)

1. Download this repository (Code › Download ZIP) and unzip it somewhere permanent.
2. Open `chrome://extensions` (in Brave: `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.
4. In your browser's download settings (`chrome://settings/downloads` or `brave://settings/downloads`), turn **off** "Ask where to save each file before downloading". Otherwise the browser still shows a save dialog. This setting applies to all downloads, not just Magpie.

If Ctrl+Shift+Y does nothing, another app may already use it. (Avoid Alt+Shift combos on Windows, which uses Alt+Shift to switch keyboard language.) You can change the shortcut at `chrome://extensions/shortcuts` (or `brave://extensions/shortcuts`).

## Where files go

Browsers only let extensions save inside the Downloads folder, so Magpie saves to `Downloads/Taste/`:

```
Downloads/Taste/
  2026-10-21_161502_pinterest.com_love.jpg
  2026-10-21_161730_example.com_snip.png
  meta/
    2026-10-21_161502_pinterest.com_love.json
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
