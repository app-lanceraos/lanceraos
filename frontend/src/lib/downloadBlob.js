// src/lib/downloadBlob.js
//
// Saves a Blob as a file through a temporary <a download>, and reads a Blob as text. A download that can be refused with a
// sentence is fetched as a blob (responseType: 'blob'), so its error body is itself a Blob: blobToText turns it back into
// text (STANDARDS.md). The object URL is revoked after a short delay, not at once: Safari reads it asynchronously.
const REVOKE_DELAY_MS = 10000

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}

// blob.text() where it exists; a FileReader otherwise (jsdom's Blob has no text()).
export function blobToText(blob) {
  if (!blob) return Promise.resolve('')
  if (typeof blob.text === 'function') return blob.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}
