// Prompt 27: shared by the file-picker upload (ShapeLibraryPanel) and OS
// clipboard image paste (useKeyboardShortcuts) — both need the exact same
// "decode this File into a data URL + know its true pixel dimensions"
// step before an image item can be created. Explicitly local-only: the
// data URL is held in memory (eventually inside the item itself), never
// uploaded anywhere — real cloud storage is deliberately deferred to the
// actual backend integration phase.
export function loadImageFile(file, onLoaded) {
  if (!file || !file.type?.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const img = new Image();
    img.onload = () => onLoaded(dataUrl, img.naturalWidth, img.naturalHeight);
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}
