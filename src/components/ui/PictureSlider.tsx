'use client'
import { useRef, useState } from 'react'

/** Pictures side by side that the person swipes through, with dots to show where they are. One picture has no dots. */
export default function PictureSlider({ urls, label }: { urls: string[]; label: string }) {
  const track = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [failed, setFailed] = useState<number[]>([])
  const many = urls.length > 1

  function goTo(i: number) {
    const el = track.current
    if (!el) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ left: i * el.clientWidth, behavior: still ? 'auto' : 'smooth' })
  }

  return (
    <div className="ui-slider">
      <div
        ref={track}
        className="ui-slider-track"
        tabIndex={many ? 0 : undefined}
        role={many ? 'group' : undefined}
        aria-label={many ? `${label}, pictures` : undefined}
        onScroll={e => { const t = e.currentTarget; setActive(Math.round(t.scrollLeft / t.clientWidth)) }}
      >
        {urls.map((url, i) => (
          <div className="ui-slider-slide" key={url}>
            {failed.includes(i)
              ? <p className="ui-slider-failed">This picture didn’t load.</p>
              // eslint-disable-next-line @next/next/no-img-element -- signed-in link, not something the image optimiser can fetch
              : <img src={url} alt={many ? `${label}, picture ${i + 1} of ${urls.length}` : label} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(f => [...f, i])} />}
          </div>
        ))}
      </div>
      {many && (
        <div className="ui-slider-dots">
          {urls.map((url, i) => (
            <button key={url} type="button" className={`ui-slider-dot${i === active ? ' is-active' : ''}`} onClick={() => goTo(i)} aria-label={`Picture ${i + 1} of ${urls.length}`} aria-current={i === active || undefined} />
          ))}
        </div>
      )}
    </div>
  )
}
