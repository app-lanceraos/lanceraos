// src/pages/profileCropUtils.js

/** Crops an image (data URL) to the given pixel area and returns a JPEG Blob. */
export async function getCroppedImageBlob(imageSrc, pixelCrop) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = pixelCrop.width
      canvas.height = pixelCrop.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(
        image,
        pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
        0, 0, pixelCrop.width, pixelCrop.height,
      )
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas is empty'))), 'image/jpeg', 0.92)
    }
    image.onerror = reject
    image.src = imageSrc
  })
}