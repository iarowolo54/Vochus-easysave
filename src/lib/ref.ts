// Collision-resistant transaction reference. The old `${PREFIX}-${count()+1}`
// scheme (e.g. ENR-) collides when two rows are created at once, which 500s if
// Transaction.ref is unique. Use crypto randomness instead of a running count.
import { randomBytes } from 'node:crypto'

export function genTxnRef(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex').toUpperCase()}`
}
