import { useState } from 'react'

export default function Compare({ before, after, width, height }) {
  const [pos, setPos] = useState(50)

  return (
    <div
      className="relative mx-auto w-full select-none overflow-hidden rounded-xl border border-line bg-black/40"
      style={{ aspectRatio: `${width} / ${height}`, maxHeight: '60vh', maxWidth: `calc(60vh * ${width / height})` }}
    >
      <img src={before} alt="Original" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      {after && (
        <img
          src={after}
          alt="Ampliada"
          className="absolute inset-0 h-full w-full object-contain"
          style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
          draggable={false}
        />
      )}

      {after && (
        <>
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,.6)]" style={{ left: `${pos}%` }}>
            <div className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-sm font-bold text-[#050031] shadow-lg">
              ⇔
            </div>
          </div>
          <span className="pointer-events-none absolute top-3 left-3 rounded-md bg-black/60 px-2 py-1 text-xs">Original</span>
          <span className="pointer-events-none absolute top-3 right-3 rounded-md bg-accent px-2 py-1 text-xs">Ampliada</span>
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            aria-label="Comparar original e ampliada"
            className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
          />
        </>
      )}
    </div>
  )
}
