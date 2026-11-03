'use client'

import { useState, useEffect } from 'react'
import { Field } from '../../_components/admin-ui'
import type { Perm } from '@/lib/permissions'
import RolesView from './RolesView'
import PeopleView from './PeopleView'
import { type Department, type StaffUser, sendJson } from './shared'

/**
 * One department: its lead, its roles, its people. The owner sees the lead picker and is unbounded;
 * a lead sees the same hub for their own department only and is bounded by `ceiling`.
 */
export default function DepartmentHub({ department, isOwner, ceiling, toast, onChanged }: {
  department: Department
  isOwner: boolean
  ceiling: Perm[] | null
  toast: (m: string, t?: 'success' | 'error') => void
  onChanged: () => void
}) {
  const [members, setMembers] = useState<StaffUser[]>([])
  const [leadId, setLeadId] = useState(department.lead?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [leadError, setLeadError] = useState('')

  useEffect(() => { setLeadId(department.lead?.id ?? '') }, [department.lead?.id])

  // Only Active people of this department can be appointed lead.
  useEffect(() => {
    if (!isOwner) return
    fetch('/api/admin/staff').then(r => r.ok ? r.json() : null).then(d => {
      const list: StaffUser[] = d?.staff ?? []
      setMembers(list.filter(s => s.department?.id === department.id && s.status === 'Active'))
    }).catch(() => setMembers([]))
  }, [isOwner, department.id, department.memberCount])

  async function saveLead(next: string) {
    setBusy(true); setLeadError('')
    const r = await sendJson(`/api/admin/departments/${department.id}`, 'PATCH', { leadId: next || null })
    setBusy(false)
    if (!r.ok) { setLeadError(r.error); return }
    setLeadId(next)
    toast(next ? 'Department lead updated' : 'Department lead removed', 'success')
    onChanged()
  }

  return (
    <div>
      {isOwner && (
        <section className="card cs-hub-sec" aria-label="Department lead">
          <Field id="hub-lead" label="Department lead"
            error={leadError}
            hint={members.length === 0
              ? 'Add and activate someone in this department first, then appoint them lead.'
              : 'A lead manages this department’s roles and people, but can only give access they hold themselves.'}>
            <select id="hub-lead" className="a-input" value={leadId} disabled={busy || members.length === 0 && !leadId}
              onChange={e => saveLead(e.target.value)}>
              <option value="">No lead</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        </section>
      )}

      <div className="cs-hub-sec">
        <h3 className="td-name">Roles</h3>
        <RolesView departmentId={department.id} departmentName={department.name} ceiling={ceiling} toast={toast} onChanged={onChanged} />
      </div>

      <div className="cs-hub-sec">
        <h3 className="td-name">People</h3>
        <PeopleView toast={toast} departmentId={department.id} isOwner={isOwner} ceiling={ceiling} onChanged={onChanged} />
      </div>
    </div>
  )
}
