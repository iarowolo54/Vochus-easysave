'use client'
import { useCallback, useEffect, useState } from 'react'

const COOLDOWN_SECONDS = 60

/** Counts down after a code is requested. It runs the same for every request, so it reveals nothing about the account. */
export function useResendCooldown() {
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setTimeout(() => setSecondsLeft(s => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  const start = useCallback(() => setSecondsLeft(COOLDOWN_SECONDS), [])
  return { secondsLeft, start }
}

export const waitMessage = (seconds: number) => `Please wait ${seconds} second${seconds === 1 ? '' : 's'} before asking for another code.`
export const RESENT_MESSAGE = 'If this account can get a code, a new one is on its way.'
