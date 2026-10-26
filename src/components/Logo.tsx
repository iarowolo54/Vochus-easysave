import type { CSSProperties } from 'react'

// Brand assets live in public/brand/. logo-original.png is the source artwork; don't use it in the UI.
const SRC = {
  mark: '/brand/logo-mark.svg',
  icon: '/brand/logo-icon.svg',
  mono: '/brand/logo-mark-mono.svg',
} as const

const ASPECT = 216 / 248 // viewBox height / width

type Props = {
  /** Width in px (the tile is size × size). */
  size?: number
  variant?: keyof typeof SRC
  /** White rounded tile behind the mark — use on dark or busy backgrounds. */
  tile?: boolean
  style?: CSSProperties
}

export default function Logo({ size = 40, variant = 'mark', tile = false, style }: Props) {
  // The full mark's banknotes and clasp blur at small sizes; swap to the simplified icon.
  const src = SRC[variant === 'mark' && size <= 32 ? 'icon' : variant]
  const w = Math.round(tile ? size * 0.72 : size)
  const img = <img src={src} alt="Vochus Easy Save" width={w} height={Math.round(w * ASPECT)} />

  if (!tile) return <span className="ui-logo" style={style}>{img}</span>
  return (
    <span
      className="ui-logo ui-logo--tile"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), ...style }}
    >
      {img}
    </span>
  )
}
