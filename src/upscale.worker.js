import * as tf from '@tensorflow/tfjs'
import '@tensorflow/tfjs-backend-webgpu'
import Upscaler from 'upscaler'
import slim2x from '@upscalerjs/esrgan-slim/2x'
import slim4x from '@upscalerjs/esrgan-slim/4x'
import medium2x from '@upscalerjs/esrgan-medium/2x'
import medium4x from '@upscalerjs/esrgan-medium/4x'

// Polyfill: o tfjs 4.11 (exigido pelo UpscalerJS) chama requestAdapterInfo(), removido no Chrome 131+.
if (self.GPUAdapter && !GPUAdapter.prototype.requestAdapterInfo) {
  GPUAdapter.prototype.requestAdapterInfo = function () {
    return Promise.resolve(this.info)
  }
}

// Pesos servidos de public/models (copiados por scripts/copy-models.mjs), sem depender de CDN.
// Resolvidos a partir do próprio worker, para funcionar em qualquer subpasta do servidor.
const modelUrl = (size, scale) => new URL(`../models/${size}/x${scale}/model.json`, self.location.href).href

// fast = esrgan-slim (~3x mais rápido), best = esrgan-medium (mais detalhe).
const MODELS = {
  fast: { 2: { ...slim2x, path: modelUrl('slim', 2) }, 4: { ...slim4x, path: modelUrl('slim', 4) } },
  best: { 2: { ...medium2x, path: modelUrl('medium', 2) }, 4: { ...medium4x, path: modelUrl('medium', 4) } },
}

// WebGPU é ~1,5–2x mais rápido que WebGL; cai para WebGL onde não houver suporte.
const backendReady = (async () => {
  for (const backend of ['webgpu', 'webgl', 'cpu']) {
    if (await tf.setBackend(backend).catch(() => false)) break
  }
  await tf.ready()
  return tf.getBackend()
})()

const upscalers = {}

function getUpscaler(quality, scale) {
  const key = `${quality}-${scale}`
  upscalers[key] ??= new Upscaler({ model: MODELS[quality][scale] })
  return upscalers[key]
}

// O ESRGAN só trabalha com RGB; o canal alfa é ampliado à parte (bilinear, em JS).
// Retorna null se a imagem for toda opaca.
function upscaleAlpha({ data, width, height }, scale) {
  let opaque = true
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break }
  if (opaque) return null

  const W = width * scale
  const H = height * scale
  const out = new Uint8ClampedArray(W * H)
  const at = (x, y) => data[(y * width + x) * 4 + 3]
  for (let y = 0; y < H; y++) {
    const sy = Math.min(Math.max((y + 0.5) / scale - 0.5, 0), height - 1)
    const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, height - 1), fy = sy - y0
    for (let x = 0; x < W; x++) {
      const sx = Math.min(Math.max((x + 0.5) / scale - 0.5, 0), width - 1)
      const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, width - 1), fx = sx - x0
      const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx
      const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx
      out[y * W + x] = top * (1 - fy) + bottom * fy
    }
  }
  return out
}

async function upscaleRGB(imageData, scale, quality) {
  const upscaler = getUpscaler(quality, scale)
  await upscaler.ready

  // float32: o WebGPU do tfjs 4.11 gera shaders inválidos para tensores int32 no Chrome atual.
  const input = tf.tidy(() => tf.browser.fromPixels(imageData).toFloat())
  try {
    const rgb = await upscaler.upscale(input, {
      output: 'tensor',
      patchSize: 96, // medido: mais rápido que 64/128 em GPU integrada, com memória baixa
      padding: 6,
      // Na GPU os blocos só são enfileirados aqui; esperar o bloco ficar pronto (data())
      // faz a barra refletir o cálculo real, em vez de saltar para 100% e travar.
      progress: (p, slice) => {
        slice.data().then(() => {
          slice.dispose()
          self.postMessage({ type: 'progress', progress: p })
        })
      },
    })
    const [height, width] = rgb.shape
    const values = await rgb.data()
    rgb.dispose()
    return { width, height, values }
  } finally {
    input.dispose()
  }
}

self.onmessage = async ({ data: { imageData, scale, quality } }) => {
  try {
    let backend = await backendReady
    self.postMessage({ type: 'backend', backend })

    let rgb
    try {
      rgb = await upscaleRGB(imageData, scale, quality)
    } catch (err) {
      if (backend !== 'webgpu') throw err
      // WebGPU ainda é instável em alguns drivers: refaz com WebGL.
      console.warn('WebGPU falhou, refazendo com WebGL:', err)
      for (const key in upscalers) delete upscalers[key]
      await tf.setBackend('webgl')
      backend = tf.getBackend()
      self.postMessage({ type: 'backend', backend })
      self.postMessage({ type: 'progress', progress: 0 })
      rgb = await upscaleRGB(imageData, scale, quality)
    }

    const { width, height, values } = rgb
    const alpha = upscaleAlpha(imageData, scale)
    // Uint8ClampedArray arredonda e limita a 0–255 na atribuição.
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      pixels[i * 4] = values[j]
      pixels[i * 4 + 1] = values[j + 1]
      pixels[i * 4 + 2] = values[j + 2]
      pixels[i * 4 + 3] = alpha ? alpha[i] : 255
    }

    self.postMessage({ type: 'done', width, height, pixels }, [pixels.buffer])
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) })
  }
}
