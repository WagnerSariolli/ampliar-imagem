// Copia os pesos do ESRGAN do node_modules para public/, para o modelo ser servido localmente (sem CDN).
import { cpSync, existsSync } from 'node:fs'

const dest = 'public/models'

for (const size of ['slim', 'medium']) {
  for (const scale of ['x2', 'x4']) {
    if (!existsSync(`${dest}/${size}/${scale}/model.json`)) {
      cpSync(`node_modules/@upscalerjs/esrgan-${size}/models/${scale}`, `${dest}/${size}/${scale}`, { recursive: true })
    }
  }
}
