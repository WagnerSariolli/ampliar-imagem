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

// O ESRGAN só trabalha com RGB; o canal alfa é ampliado à parte por interpolação bilinear.
function upscaleAlpha(imageData, scale) {
  const { data, width, height } = imageData
  const alpha = new Uint8Array(width * height)
  let opaque = true
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = data[i * 4 + 3]
    if (alpha[i] !== 255) opaque = false
  }
  if (opaque) return null
  return tf.tidy(() =>
    tf.image
      .resizeBilinear(tf.tensor3d(alpha, [height, width, 1]), [height * scale, width * scale])
      .round()
      .clipByValue(0, 255)
      .cast('int32'),
  )
}

self.onmessage = async ({ data: { imageData, scale, quality } }) => {
  try {
    const backend = await backendReady
    self.postMessage({ type: 'backend', backend })

    const upscaler = getUpscaler(quality, scale)
    await upscaler.ready

    const input = tf.browser.fromPixels(imageData)
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
    input.dispose()

    const alpha = upscaleAlpha(imageData, scale)
    const rgba = tf.tidy(() => {
      const color = rgb.round().clipByValue(0, 255).cast('int32')
      const a = alpha ?? tf.fill([...color.shape.slice(0, 2), 1], 255, 'int32')
      return tf.concat([color, a], 2)
    })
    rgb.dispose()
    alpha?.dispose()

    const [height, width] = rgba.shape
    const pixels = new Uint8ClampedArray(await rgba.data())
    rgba.dispose()

    self.postMessage({ type: 'done', width, height, pixels }, [pixels.buffer])
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) })
  }
}
