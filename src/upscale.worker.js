import * as tf from '@tensorflow/tfjs'
import Upscaler from 'upscaler'
import x2 from '@upscalerjs/esrgan-medium/2x'
import x4 from '@upscalerjs/esrgan-medium/4x'

// Pesos servidos de public/models (copiados por scripts/copy-models.mjs), sem depender de CDN.
// Resolvidos a partir do próprio worker, para funcionar em qualquer subpasta do servidor.
const modelUrl = (scale) => new URL(`../models/${scale}/model.json`, self.location.href).href

const MODELS = {
  2: { ...x2, path: modelUrl('x2') },
  4: { ...x4, path: modelUrl('x4') },
}

const upscalers = {}

function getUpscaler(scale) {
  upscalers[scale] ??= new Upscaler({ model: MODELS[scale] })
  return upscalers[scale]
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

self.onmessage = async ({ data: { imageData, scale } }) => {
  try {
    const upscaler = getUpscaler(scale)
    await upscaler.ready

    const input = tf.browser.fromPixels(imageData)
    // Patches pequenos mantêm o uso de memória da GPU baixo e permitem reportar progresso.
    const rgb = await upscaler.upscale(input, {
      output: 'tensor',
      patchSize: 64,
      padding: 6,
      progress: (p) => self.postMessage({ type: 'progress', progress: p }),
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
