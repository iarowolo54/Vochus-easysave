// The logo as a loading animation: the V draws together and the wallet settles in (once), then the
// banknotes rise out of the wallet and tuck back in, on a slow loop — money being saved.
// Shapes are the same paths as public/brand/logo-mark.svg, in flat logo colours.
// With reduced motion it is simply the still logo.

type Props = {
  size?: number
  /** Read by screen readers; also shown under the mark when `caption` is true. */
  label?: string
  caption?: boolean
  /** Fade in after ~0.25s so fast loads never flash the loader. */
  delayed?: boolean
}

export default function LogoLoader({ size = 72, label = 'Loading', caption = false, delayed = false }: Props) {
  return (
    <div className={`ui-logo-loader${delayed ? ' ui-logo-loader--delayed' : ''}`} role="status" aria-label={label}>
      <svg width={size} height={Math.round(size * (216 / 248))} viewBox="0 0 248 216" aria-hidden="true">
        <g className="ll-notes">
          <path className="ll-note ll-note-1" fill="#8ccb4a" d="M176 84 L199 52 Q203 47 211 48 L212 58 L185 83 Z" />
          <path className="ll-note ll-note-2" fill="#79bd45" d="M173 94 L214 63 Q220 59 226 61 L225 75 L196 89 L180 95 Z" />
          <path className="ll-note ll-note-3" fill="#66ae3f" d="M171 98 L222 81 Q232 77 238 80 L238 97 Z" />
        </g>
        <path className="ll-green" fill="#5db043" d="M133 36 Q140 20 160 20 L198 20 L127 197 Q123 206 110 206 L97 206 Q85 206 81 195 L72 167 Q70 160 77 158 L86 154 L107 100 Z" />
        <path className="ll-blue" fill="#24407c" d="M6 9 L42 9 Q67 11 77 30 L107 100 L86 154 Q78 166 69 156 Z" />
        <g className="ll-wallet">
          <path fill="#17783a" d="M171 101 L231 101 Q238 101 238 108 L238 192 Q238 210 220 210 L139 210 Q125 210 129 199 Z" />
          <path fill="#ffffff" d="M214 134 L240 134 L240 172 L214 172 Q196 172 196 153 Q196 134 214 134 Z" />
          <path fill="#1d8c43" d="M214 139 L238 139 L238 167 L214 167 Q201 167 201 153 Q201 139 214 139 Z" />
          <circle cx="213" cy="153" r="5.5" fill="#ffffff" />
        </g>
      </svg>
      {caption && <p className="ui-logo-loader-caption">{label}</p>}
    </div>
  )
}
