'use client'
import { useEffect, useRef, useState } from 'react'
import { formatNaira, nairaParts } from '@/lib/format'

type Props = {
  value: number
  size?: 'hero' | 'row'
  /** Prefix "+" and colour green — for money coming in. */
  incoming?: boolean
  /** Count up to the value (and between values when it changes). Use for headline balances only. */
  animate?: boolean
}

const DURATION_MS = 800

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function useCountUp(target: number, enabled: boolean): number {
  const start = () => (enabled && !prefersReducedMotion() ? 0 : target)
  const [shown, setShown] = useState(start)
  const current = useRef(shown)

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      current.current = target
      setShown(target)
      return
    }
    const from = current.current
    if (from === target) return
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION_MS)
      const eased = 1 - Math.pow(1 - t, 3)
      // Continue from wherever we are if the target changes mid-count.
      current.current = from + (target - from) * eased
      // Tick whole naira; land on the exact kobo at the end so decimals don't flicker.
      setShown(t < 1 ? Math.trunc(current.current) : target)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, enabled])

  return shown
}

export default function Amount({ value, size = 'row', incoming = false, animate = false }: Props) {
  const shown = useCountUp(value, animate)
  const { whole, minor } = nairaParts(shown)
  const cls = ['ui-amount', size === 'hero' && 'ui-amount--hero', incoming && 'ui-amount--positive']
    .filter(Boolean).join(' ')
  const visual = <>{incoming && '+'}{whole}<span className="ui-amount-minor">{minor}</span></>

  if (!animate) return <span className={cls}>{visual}</span>
  // Screen readers get the final figure once, not every intermediate frame.
  return (
    <span className={cls}>
      <span aria-hidden="true">{visual}</span>
      <span className="ui-sr-only">{incoming && '+'}{formatNaira(value)}</span>
    </span>
  )
}
