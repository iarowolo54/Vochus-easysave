'use client'
import { useState, useEffect, useRef } from 'react'

type Bank = { code: string; name: string }

type Props = {
  banks: Bank[]
  value: string
  onChange: (code: string, name: string) => void
  placeholder?: string
}

export default function BankPicker({ banks, value, onChange, placeholder = 'Select bank…' }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selected = banks.find(b => b.code === value) ?? null
  const filtered = search
    ? banks.filter(b => b.name.toLowerCase().includes(search.toLowerCase()))
    : banks

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: 14 }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '13px 14px', fontSize: 14, fontWeight: selected ? 600 : 400,
          background: 'var(--bg)', border: '1.5px solid var(--br)', borderRadius: 12,
          cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          color: selected ? 'var(--txt)' : 'var(--mu)',
        }}
      >
        <span>{selected ? selected.name : placeholder}</span>
        <span style={{ fontSize: 11, color: 'var(--mu)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▼</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 500,
          background: 'var(--card)', border: '1.5px solid var(--br)', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,.18)', maxHeight: 280,
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--br)', background: 'var(--bg)' }}>
            <input
              autoFocus
              type="text"
              placeholder="Search banks…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', border: 'none', outline: 'none', background: 'transparent',
                fontSize: 14, color: 'var(--txt)', padding: 0,
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(b => (
              <div
                key={b.code}
                onClick={() => { onChange(b.code, b.name); setOpen(false); setSearch('') }}
                style={{
                  padding: '11px 14px', cursor: 'pointer', fontSize: 13.5,
                  borderBottom: '1px solid var(--br)',
                  color: b.code === value ? 'var(--g)' : 'var(--txt)',
                  fontWeight: b.code === value ? 700 : 400,
                  background: b.code === value ? 'var(--gl)' : 'transparent',
                }}
              >
                {b.name}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '14px', fontSize: 13, color: 'var(--mu)', textAlign: 'center' }}>No banks found</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
