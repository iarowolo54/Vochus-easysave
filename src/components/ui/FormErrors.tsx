'use client'
import { useEffect, useRef } from 'react'
import { Icons } from './icons'

/**
 * Form-level error. When it appears it takes focus, which closes the phone keyboard and scrolls
 * it into view — otherwise the keyboard can hide it and the form looks like it did nothing.
 */
export function FormError({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!message || !ref.current) return
    ref.current.focus({ preventScroll: true })
    ref.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [message])
  if (!message) return null
  return (
    <div ref={ref} tabIndex={-1} className="ui-banner ui-banner--danger" role="alert">
      <Icons.error size={18} aria-hidden="true" />
      <div>{message}</div>
    </div>
  )
}

/** Message under one field. Pair the input with aria-invalid and aria-describedby={id}. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="ui-field-error">
      <Icons.error size={16} aria-hidden="true" /> {message}
    </p>
  )
}
