'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Logo from '@/components/Logo'
import EmptyState from '@/components/ui/EmptyState'
import { FormError } from '@/components/ui/FormErrors'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { avatarTint } from '@/lib/avatar'
import { displayName } from '@/lib/format'

type CardInfo = {
  id: string; serial: string; status: string; batchName?: string; expiryDate?: string
  customer: { name: string; customerId: string } | null
}
type Found = { id: string; customerId: string; firstName: string; lastName: string; phone: string; photoUrl?: string | null }

const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
const initials = (f: string, l: string) => `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase()

export default function CardSetupPage() {
  const serial = decodeURIComponent(String(useParams().serial ?? ''))
  const [card, setCard] = useState<CardInfo | null>(null)
  const [loadError, setLoadError] = useState('')

  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Found[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Found | null>(null)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [justLinked, setJustLinked] = useState(false)

  useEffect(() => {
    fetch(`/api/cards/${encodeURIComponent(serial)}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(r.status === 404 ? 'There’s no card with this serial. Check it and try again.' : d.error ?? 'We couldn’t load this card.')
        setCard(d)
      })
      .catch(e => setLoadError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'No connection. Check your internet and try again.'))
  }, [serial])

  useEffect(() => {
    const q = search.trim()
    if (!q) { setResults(null); return }
    const ctrl = new AbortController()
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/customers?search=${encodeURIComponent(q)}&limit=10`, { signal: ctrl.signal })
        const d = await r.json()
        setResults(d.customers ?? [])
      } catch (e) {
        if ((e as { name?: string })?.name !== 'AbortError') setResults([])
      } finally { setSearching(false) }
    }, 300)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [search])

  async function link() {
    if (!selected) return
    setLinking(true); setLinkError('')
    try {
      const r = await fetch(`/api/cards/${encodeURIComponent(serial)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: selected.id }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setLinkError(r.status === 409 ? 'This card was just linked to someone else.' : d.error === 'Customer not found' ? 'That customer isn’t one of yours.' : d.error ?? 'The card wasn’t linked. Please try again.')
        return
      }
      setCard(c => ({ ...(c as CardInfo), ...d }))
      setJustLinked(true)
    } catch {
      setLinkError('We lost the connection. Refresh to check whether the card was linked before trying again.')
    } finally {
      setLinking(false)
    }
  }

  const back = <Link href="/dashboard/cards" className="ui-link ag-back-link"><Icons.back size={16} aria-hidden="true" /> Cards</Link>

  if (loadError) {
    return (
      <div className="ag-page ag-card-page">
        {back}
        <section className="ui-card"><EmptyState icon="card" tone="danger" title="Card not found" text={loadError}
          action={<Link href="/dashboard/cards" className="ui-btn ui-btn--primary">Try another serial</Link>} /></section>
      </div>
    )
  }
  if (!card) return <div className="ag-page ag-card-page">{back}<ListSkeleton count={3} /></div>

  const linked = card.status === 'Linked'
  const blocked = card.status === 'Blocked'
  const isExpired = !!card.expiryDate && new Date(card.expiryDate).getTime() < Date.now()
  const statusLabel = linked ? 'Linked' : blocked ? 'Blocked' : isExpired ? 'Expired' : 'Not linked'

  return (
    <div className="ag-page ag-card-page">
      {back}

      <div className={`ag-member-card${linked ? ' is-linked' : ''}${blocked || isExpired ? ' is-off' : ''}`} aria-label={`Card ${card.serial}, ${statusLabel}`}>
        <div className="ag-member-card-top">
          <span className="ag-member-card-brand"><Logo size={26} variant="mono" /> Vochus Easy Save</span>
          <span className="ag-member-card-status">{statusLabel}</span>
        </div>
        <p className="ag-member-card-serial">{card.serial}</p>
        <div className="ag-member-card-meta">
          <div><span>Batch</span><strong>{card.batchName ?? '—'}</strong></div>
          <div><span>{isExpired ? 'Expired' : 'Expires'}</span><strong>{card.expiryDate ? monthYear(card.expiryDate) : '—'}</strong></div>
          {linked && card.customer && <div><span>Customer</span><strong>{displayName(card.customer.name)}</strong></div>}
        </div>
      </div>

      {linked ? (
        <section className="ui-card ag-card-done">
          <span className="ag-verified-icon" aria-hidden="true"><Icons.check size={22} /></span>
          <h2 className="ag-card-done-title">{justLinked ? 'Card linked' : 'This card is already linked'}</h2>
          <p className="ui-row-sub">
            {card.customer ? <>It belongs to <strong>{displayName(card.customer.name)}</strong> · {card.customer.customerId}.</> : 'It belongs to a customer.'}
            {!justLinked && ' It can’t be moved to someone else in the app; contact support if it’s wrong.'}
          </p>
          <Link href="/dashboard/cards" className="ui-btn ui-btn--secondary ui-btn--block">Link another card</Link>
        </section>
      ) : blocked || isExpired ? (
        <section className="ui-card"><EmptyState icon="error" tone="danger" title={blocked ? 'This card is blocked' : 'This card has expired'}
          text={`It can’t be given to a customer. Ask your admin for a new card.`}
          action={<Link href="/dashboard/cards" className="ui-btn ui-btn--secondary">Try another card</Link>} /></section>
      ) : (
        <section className="ui-card ag-card-pick" aria-labelledby="pick-title">
          <h2 id="pick-title" className="ui-card-title ag-card-title">Who is this card for?</h2>
          {!selected ? (
            <>
              <div className="ag-search">
                <Icons.search size={20} aria-hidden="true" />
                <input className="ui-input" type="search" autoComplete="off" autoFocus placeholder="Name, phone or customer ID" aria-label="Find a customer"
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              {searching && results === null ? <ListSkeleton count={3} /> : results && (
                results.length === 0
                  ? <p className="ag-chat-none">No customers match “{search}”.</p>
                  : <div className="ag-card-results">
                      {results.map(c => (
                        <button key={c.id} type="button" className="ag-chat-thread" onClick={() => { setSelected(c); setLinkError('') }}>
                          {c.photoUrl
                            ? <img className="ui-avatar ag-av ag-chat-av" src={c.photoUrl} alt="" />
                            : <span className={`ui-avatar ag-av ag-av--${avatarTint(c.customerId)} ag-chat-av`} aria-hidden="true">{initials(c.firstName, c.lastName)}</span>}
                          <span className="ag-chat-thread-main">
                            <span className="ag-chat-thread-name">{displayName(`${c.firstName} ${c.lastName}`)}</span>
                            <span className="ag-chat-thread-last">{c.customerId} · {c.phone}</span>
                          </span>
                        </button>
                      ))}
                    </div>
              )}
              {!search && <p className="ui-note">Search for the customer you’re giving this card to.</p>}
            </>
          ) : (
            <>
              <div className="ag-who ag-card-who">
                {selected.photoUrl
                  ? <img className="ui-avatar ag-av ag-chat-av" src={selected.photoUrl} alt="" />
                  : <span className={`ui-avatar ag-av ag-av--${avatarTint(selected.customerId)} ag-chat-av`} aria-hidden="true">{initials(selected.firstName, selected.lastName)}</span>}
                <div className="ag-payee-main">
                  <p className="ui-row-title">{displayName(`${selected.firstName} ${selected.lastName}`)}</p>
                  <p className="ui-row-sub">{selected.customerId} · {selected.phone}</p>
                </div>
                <button type="button" className="ui-link" onClick={() => setSelected(null)}>Change</button>
              </div>
              <p className="ag-set-note ag-set-note--warn"><Icons.locked size={16} aria-hidden="true" /> Check it’s the right person. A linked card can’t be moved to someone else in the app.</p>
              <FormError message={linkError} />
              <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={linking} onClick={link}>
                {linking ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Linking…</> : `Link card to ${displayName(selected.firstName)}`}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  )
}
