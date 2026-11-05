'use client'
import { useMemo, useState } from 'react'
import BottomSheet from './BottomSheet'
import { Icons } from './icons'

type Bank = { code: string; name: string }

type Props = {
  banks: readonly Bank[]
  value: Bank | null
  onChange: (bank: Bank) => void
  loading?: boolean
  placeholder?: string
}

/** Bank field that opens a searchable list in a sheet — easier than a long dropdown on a phone. */
export default function BankSelect({ banks, value, onChange, loading, placeholder = 'Choose the customer’s bank' }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? banks.filter(b => b.name.toLowerCase().includes(s)) : banks
  }, [banks, q])

  return (
    <>
      <button type="button" className="ag-tf ag-tf-button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="ag-tf-label">Bank</span>
        <span className={`ag-tf-value${value ? '' : ' is-empty'}`}>{value ? value.name : placeholder}</span>
        <Icons.expand size={18} aria-hidden="true" className="ag-tf-chevron" />
      </button>

      <BottomSheet open={open} onClose={() => { setOpen(false); setQ('') }} title="Choose bank">
        <div className="ag-search ag-bank-search">
          <Icons.search size={20} aria-hidden="true" />
          <input className="ui-input" type="search" placeholder="Search banks" aria-label="Search banks" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="ag-bank-list" role="listbox" aria-label="Banks">
          {loading && banks.length === 0 && <p className="ui-note ui-note--center">Loading banks…</p>}
          {!loading && list.length === 0 && <p className="ui-note ui-note--center">No bank matches “{q}”.</p>}
          {list.map(b => (
            <button key={b.code} type="button" role="option" aria-selected={value?.code === b.code} className="ag-bank-item"
              onClick={() => { onChange(b); setOpen(false); setQ('') }}>
              <span className="ag-bank-mark" aria-hidden="true">{b.name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()}</span>
              <span className="ag-bank-name">{b.name}</span>
              {value?.code === b.code && <Icons.check size={18} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  )
}
