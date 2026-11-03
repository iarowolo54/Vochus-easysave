import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toStaffResponse, staffSelect } from '../src/lib/staff-response'

const row = {
  id: 's1', name: 'Sam', email: 'sam@x.com', status: 'Invited', lastActiveAt: null, createdAt: new Date('2026-11-01'),
  approvalPin: 'pinhash', departmentId: 'd1',
  department: { id: 'd1', name: 'Ops' },
  roleRef: { id: 'r1', name: 'Clerk' },
  ledDepartments: [{ id: 'd1' }],
}

test('response carries department, role, status and lead flag, and no secrets', () => {
  const r = toStaffResponse(row)
  assert.deepEqual(r.department, { id: 'd1', name: 'Ops' })
  assert.deepEqual(r.role, { id: 'r1', name: 'Clerk' })
  assert.equal(r.status, 'Invited')
  assert.equal(r.isLead, true)
  assert.equal(r.hasApprovalPin, true)
  const json = JSON.stringify(r)
  for (const secret of ['pinhash', 'password', 'inviteTokenHash', 'approvalPin']) assert.ok(!json.includes(secret), secret)
})

test('isLead only when the staffer leads their own department', () => {
  assert.equal(toStaffResponse({ ...row, ledDepartments: [] }).isLead, false)
  assert.equal(toStaffResponse({ ...row, ledDepartments: [{ id: 'other' }] }).isLead, false)
  assert.equal(toStaffResponse({ ...row, department: null, departmentId: null, roleRef: null }).department, null)
})

test('the select never asks for password or invite fields', () => {
  assert.ok(!('password' in staffSelect))
  assert.ok(!('inviteTokenHash' in staffSelect))
})
