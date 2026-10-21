const folder = document.getElementById("folder");
const metadata = document.getElementById("metadata");
const status = document.getElementById("status");
const path = document.getElementById("path");
const validFolder = () => {
  const value = folder.value.trim();
  const invalid = !value || value.length > 80 || /[<>:"/\\|?*\x00-\x1f]/.test(value) ||
    /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
  folder.setCustomValidity(invalid ? "Enter one valid folder name, without slashes or trailing dots." : "");
  path.textContent = `Files go to Downloads/${value || "Taste"}/`;
  return !invalid;
};
folder.addEventListener("input", () => { validFolder(); status.textContent = ""; });
chrome.storage.local.get({ folder: "Taste", metadata: true }).then(settings => {
  folder.value = settings.folder;
  metadata.checked = settings.metadata;
  validFolder();
}).catch(error => { status.textContent = `Could not load options: ${error.message}`; });
document.getElementById("options").addEventListener("submit", async event => {
  event.preventDefault();
  if (!validFolder()) { folder.reportValidity(); return; }
  try {
    await chrome.storage.local.set({ folder: folder.value.trim(), metadata: metadata.checked });
    status.textContent = "Saved.";
  } catch (error) { status.textContent = `Could not save options: ${error.message}`; }
});
