// Copia os pesos do ESRGAN do node_modules para public/, para o modelo ser servido localmente (sem CDN).
import { cpSync, existsSync } from 'node:fs'

const src = 'node_modules/@upscalerjs/esrgan-medium/models'
const dest = 'public/models'

for (const scale of ['x2', 'x4']) {
  if (!existsSync(`${dest}/${scale}/model.json`)) {
    cpSync(`${src}/${scale}`, `${dest}/${scale}`, { recursive: true })
  }
}
