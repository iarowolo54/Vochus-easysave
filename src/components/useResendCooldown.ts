'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

const COOLDOWN_SECONDS = 60
const CODE_LIFETIME_MS = 10 * 60_000

/** Counts down after a code is requested. It runs the same for every request, so it reveals nothing about the account. */
export function useResendCooldown() {
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setTimeout(() => setSecondsLeft(s => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  const start = useCallback((seconds: number = COOLDOWN_SECONDS) => setSecondsLeft(seconds), [])
  return { secondsLeft, start }
}

export const waitMessage = (seconds: number) => `Please wait ${seconds} second${seconds === 1 ? '' : 's'} before asking for another code.`
export const RESENT_MESSAGE = 'If this account can get a code, a new one is on its way. Use the newest code.'

type SentCode = { id: string; account: string; at: number }

/**
 * Remembers the resetId of the code on its way. A resend inside the server's cooldown returns a throwaway
 * id and sends nothing, so that id mustn't replace the real one. Kept in sessionStorage so a reload
 * doesn't lose it: onRestore gets the account and the cooldown still to run. An admin-sent link (?r=)
 * supplies the id directly, and nothing replaces it.
 */
export function useResetId(scope: string, onRestore?: (account: string, cooldownLeft: number) => void) {
  const key = `vochus_reset_${scope}`
  const sent = useRef<SentCode | null>(null)
  const [fromLink, setFromLink] = useState(false)

  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get('r')
    if (linked) {
      sent.current = { id: linked, account: '', at: 0 }
      setFromLink(true)
      return
    }
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
      const code = saved as Partial<SentCode> | null
      if (typeof code?.id === 'string' && typeof code.account === 'string' && typeof code.at === 'number' && Date.now() - code.at < CODE_LIFETIME_MS) {
        sent.current = { id: code.id, account: code.account, at: code.at }
        onRestore?.(code.account, Math.max(0, Math.ceil((code.at + COOLDOWN_SECONDS * 1000 - Date.now()) / 1000)))
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  function remember(id: unknown, account: string) {
    if (typeof id !== 'string' || fromLink) return
    const current = sent.current
    if (current && current.account === account && Date.now() - current.at < COOLDOWN_SECONDS * 1000) return
    sent.current = { id, account, at: Date.now() }
    try { sessionStorage.setItem(key, JSON.stringify(sent.current)) } catch {}
  }

  function idFor(account: string) {
    const current = sent.current
    return current && (current.account === account || current.account === '') ? current.id : undefined
  }

  function forget() {
    sent.current = null
    try { sessionStorage.removeItem(key) } catch {}
  }

  /** The account is changing, so its code no longer applies. A link's id stays: it names the account itself. */
  function changeAccount() {
    if (!fromLink) forget()
  }

  return { remember, idFor, forget, changeAccount, fromLink }
}
