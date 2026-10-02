import { useCallback, useEffect, useState } from 'react'
import Compare from './Compare.jsx'
// TensorFlow (~1 MB) só é carregado quando o usuário pede a ampliação.
const loadEngine = () => import('./upscale.js')

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif']
const MAX_OUTPUT_SIDE = 16384 // limite de canvas dos navegadores
const SLOW_PIXELS = 1_000_000

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não foi possível ler essa imagem.'))
    }
    img.src = url
  })
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function App() {
  const [source, setSource] = useState(null) // { file, url, width, height }
  const [scale, setScale] = useState(2)
  const [quality, setQuality] = useState('fast') // fast (esrgan-slim) | best (esrgan-medium)
  const [status, setStatus] = useState('idle') // idle | processing | done | error
  const [progress, setProgress] = useState(0)
  const [eta, setEta] = useState(null) // segundos restantes estimados
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  // Libera a URL de objeto do resultado anterior quando ele é substituído.
  useEffect(() => () => result && URL.revokeObjectURL(result.src), [result])

  const reset = useCallback(() => {
    if (source) URL.revokeObjectURL(source.url)
    setSource(null)
    setResult(null)
    setStatus('idle')
    setProgress(0)
    setError('')
  }, [source])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      setError('Formato não suportado. Use JPG, PNG, WEBP, BMP ou GIF.')
      return
    }
    try {
      const img = await loadImage(file)
      setSource((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return { file, ...img }
      })
      setResult(null)
      setStatus('idle')
      setProgress(0)
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // Colar imagem com Ctrl+V
  useEffect(() => {
    const onPaste = (e) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) handleFile(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleFile])

  const outW = source ? source.width * scale : 0
  const outH = source ? source.height * scale : 0
  const tooBig = outW > MAX_OUTPUT_SIDE || outH > MAX_OUTPUT_SIDE
  const slow = source && source.width * source.height > SLOW_PIXELS

  async function runUpscale() {
    setStatus('processing')
    setProgress(0)
    setEta(null)
    setResult(null)
    setError('')
    try {
      const { upscaleImage } = await loadEngine()
      // Estima pelo ritmo dos últimos segundos: os primeiros blocos chegam em rajada
      // (compilação dos shaders) e distorceriam uma média desde o início.
      const samples = []
      const data = await upscaleImage(source.url, scale, quality, (p) => {
        setProgress(p)
        const now = performance.now()
        samples.push({ now, p })
        while (now - samples[0].now > 5000) samples.shift()
        const first = samples[0]
        if (now - first.now > 3000 && p > first.p) {
          setEta(Math.ceil((((1 - p) * (now - first.now)) / (p - first.p)) / 1000))
        }
      })
      setResult({ src: data, scale, quality })
      setStatus('done')
    } catch (e) {
      if (e?.name === 'AbortError') {
        setStatus('idle')
        return
      }
      console.error(e)
      setError('Falha ao ampliar a imagem. Tente uma imagem menor ou a escala 2x.')
      setStatus('error')
    }
  }

  function download() {
    const base = source.file.name.replace(/\.[^.]+$/, '')
    const a = document.createElement('a')
    a.href = result.src
    a.download = `${base}_ampliada_${result.scale}x.png`
    a.click()
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-10 sm:px-6">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Ampliar imagem</h1>
        <p className="mt-2 text-white/60">
          Aumente a resolução com IA (ESRGAN) mantendo a nitidez. Tudo roda no seu navegador — a imagem não sai do seu computador.
        </p>
      </header>

      {!source && (
        <label
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            handleFile(e.dataTransfer.files[0])
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-20 text-center transition ${
            dragging ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-accent/60'
          }`}
        >
          <span className="rounded-xl bg-accent px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-accent/30">
            Selecionar imagem
          </span>
          <span className="text-white/60">ou arraste e solte aqui · Ctrl+V para colar</span>
          <span className="text-xs text-white/40">JPG, PNG, WEBP, BMP ou GIF</span>
          <input
            type="file"
            accept={ACCEPTED.join(',')}
            className="hidden"
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </label>
      )}

      {error && <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      {source && (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-3">
            <Compare before={source.url} after={result?.src} width={source.width} height={source.height} />
            {result && <p className="text-center text-xs text-white/50">Arraste sobre a imagem para comparar</p>}
          </div>

          <aside className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5">
            <div>
              <p className="truncate text-sm font-medium" title={source.file.name}>{source.file.name}</p>
              <p className="text-xs text-white/50">
                {source.width} × {source.height}px · {formatBytes(source.file.size)}
              </p>
            </div>

            <div>
              <p className="mb-2 text-sm text-white/70">Ampliar em</p>
              <div className="grid grid-cols-2 gap-2">
                {[2, 4].map((s) => (
                  <button
                    key={s}
                    disabled={status === 'processing'}
                    onClick={() => setScale(s)}
                    className={`rounded-lg border py-3 text-lg font-semibold transition disabled:opacity-50 ${
                      scale === s ? 'border-accent bg-accent text-white' : 'border-line hover:border-accent/60'
                    }`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/50">
                Resultado: {outW} × {outH}px
              </p>
            </div>

            <div>
              <p className="mb-2 text-sm text-white/70">Qualidade</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['fast', 'Rápida', '~3× mais veloz'],
                  ['best', 'Máxima', 'mais detalhe'],
                ].map(([q, label, hint]) => (
                  <button
                    key={q}
                    disabled={status === 'processing'}
                    onClick={() => setQuality(q)}
                    className={`rounded-lg border px-2 py-2 transition disabled:opacity-50 ${
                      quality === q ? 'border-accent bg-accent text-white' : 'border-line hover:border-accent/60'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="block text-[11px] opacity-70">{hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {tooBig && (
              <p className="text-xs text-red-300">
                O resultado passaria de {MAX_OUTPUT_SIDE}px. Use 2× ou uma imagem menor.
              </p>
            )}
            {!tooBig && slow && status !== 'done' && (
              <p className="text-xs text-amber-300">
                Imagem grande: pode levar alguns minutos.{quality === 'best' && ' A qualidade Rápida é ~3× mais veloz.'}
              </p>
            )}

            {status === 'processing' ? (
              <div className="space-y-3">
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <p className="text-center text-sm text-white/70">
                  {progress === 0 ? 'Preparando a IA…' : `Ampliando… ${Math.round(progress * 100)}%`}
                  {eta !== null && progress < 1 && (
                    <span className="block text-xs text-white/50">
                      ~{eta < 60 ? `${eta}s` : `${Math.floor(eta / 60)}min ${eta % 60}s`} restantes
                    </span>
                  )}
                </p>
                <button
                  onClick={() => loadEngine().then((m) => m.abortUpscale())}
                  className="w-full rounded-lg border border-line py-2 text-sm hover:bg-white/5"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={runUpscale}
                disabled={tooBig}
                className="rounded-xl bg-accent py-3.5 font-semibold text-white shadow-lg shadow-accent/30 transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                {result ? `Ampliar novamente (${scale}×)` : `Ampliar imagem ${scale}×`}
              </button>
            )}

            {result && status === 'done' && (
              <button
                onClick={download}
                className="rounded-xl border border-accent py-3.5 font-semibold text-white transition hover:bg-accent/20"
              >
                Baixar PNG ({source.width * result.scale} × {source.height * result.scale})
              </button>
            )}

            <button
              onClick={reset}
              disabled={status === 'processing'}
              className="mt-auto text-sm text-white/50 hover:text-white disabled:opacity-40"
            >
              Escolher outra imagem
            </button>
          </aside>
        </div>
      )}
    </div>
  )
}
