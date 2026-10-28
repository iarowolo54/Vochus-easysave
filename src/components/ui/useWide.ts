'use client'
import { useEffect, useState } from 'react'

/** True on desktop-width screens (≥1024px), where side panels replace bottom sheets. */
export function useWide(): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}
