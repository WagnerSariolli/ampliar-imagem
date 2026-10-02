let worker = null

function getWorker() {
  worker ??= new Worker(new URL('./upscale.worker.js', import.meta.url), { type: 'module' })
  return worker
}

async function fileToImageData(url) {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob())
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

async function pixelsToPngUrl({ width, height, pixels }) {
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0)
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }))
}

/** Amplia a imagem num Web Worker e devolve uma URL de objeto (PNG). */
export async function upscaleImage(url, scale, quality, onProgress, onBackend) {
  const imageData = await fileToImageData(url)
  const w = getWorker()

  const result = await new Promise((resolve, reject) => {
    w.onmessage = ({ data }) => {
      if (data.type === 'backend') onBackend?.(data.backend)
      else if (data.type === 'progress') onProgress?.(data.progress)
      else if (data.type === 'done') resolve(data)
      else reject(new Error(data.message))
    }
    w.onerror = (e) => reject(new Error(e.message))
    // Cancelar = encerrar o worker; o próximo upscale cria outro.
    w.cancel = () => reject(new DOMException('Cancelado', 'AbortError'))
    w.postMessage({ imageData, scale, quality }, [imageData.data.buffer])
  })

  return pixelsToPngUrl(result)
}

export function abortUpscale() {
  if (!worker) return
  worker.terminate()
  worker.cancel?.()
  worker = null
}
