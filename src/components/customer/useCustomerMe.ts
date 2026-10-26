'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/** Loads /api/customer/me; on 401/404 clears the stale cookie and sends the customer to login. */
export function useCustomerMe<T>() {
  const router = useRouter()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    setFailed(false)
    fetch('/api/customer/me')
      .then(async r => {
        if (r.status === 401 || r.status === 404) {
          await fetch('/api/customer/auth/login', { method: 'DELETE' }).catch(() => {})
          router.push('/customer/login')
          return null
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<T>
      })
      .then(d => { if (d) setData(d) })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [router])

  useEffect(() => { reload() }, [reload])

  return { data, loading, failed, reload }
}
