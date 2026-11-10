'use client'

import { useState } from 'react'
import { Empty } from '../../_components/admin-ui'
import { SCREENS } from '@/lib/permissions'
import { ACCESS_GROUPS } from './PermissionMatrix'
import type { StaffData } from './shared'

const ALL = 'all'

export default function AccessMatrixTab({ data, isOwner }: { data: StaffData; isOwner: boolean }) {
  const [departmentId, setDepartmentId] = useState(ALL)
  const roles = data.roles.filter(r => r.status === 'Active' && (departmentId === ALL || r.department.id === departmentId))

  return (
    <>
      {isOwner && data.departments.length > 1 && (
        <div className="um-filters">
          <select className="a-input" aria-label="Department" value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
            <option value={ALL}>All departments</option>
            {data.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}
      <section className="card" aria-label="Access matrix">
        {roles.length === 0 ? <Empty icon="staff" title="No active roles" text="Add a role to see its access here." /> : (
          <div className="tbl-wrap">
            <table className="um-access" style={{ minWidth: 190 + roles.length * 140 }}>
              <thead>
                <tr>
                  <th scope="col">Screen</th>
                  {roles.map(r => (
                    <th key={r.id} scope="col">
                      <span className="ui-block">{r.name}</span>
                      {isOwner && <span className="um-access-dept ui-block">{r.department.name}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ACCESS_GROUPS.flatMap(g => [
                  <tr key={g} className="um-access-gh"><th scope="colgroup" colSpan={roles.length + 1}><span className="um-access-gl">{g}</span></th></tr>,
                  ...SCREENS.filter(s => s.group === g).map(s => (
                    <tr key={s.key}>
                      <th scope="row">{s.label}</th>
                      {roles.map(r => (
                        <td key={r.id}>
                          {r.permissions.includes(`${s.key}:manage`) ? <span className="bdg bdg-g">Manage</span>
                            : r.permissions.includes(`${s.key}:view`) ? <span className="bdg bdg-grey">View</span>
                            : <span className="cs-muted" aria-label="No access">—</span>}
                        </td>
                      ))}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
