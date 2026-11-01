import Link from 'next/link'
import { Icons } from '@/components/ui/icons'

/** Shown instead of a page the signed-in staffer's role doesn't cover. Cosmetic: the API still enforces. */
export default function NoAccess({ area }: { area?: string }) {
  return (
    <div className="card">
      <div className="a-empty">
        <span className="a-empty-ic is-danger"><Icons.error size={22} aria-hidden="true" /></span>
        <h4>You don’t have access to this area</h4>
        <p>{area ? `Your role doesn’t include ${area}. ` : ''}Ask the account owner if you need it.</p>
        <Link href="/superadmin" className="btn btn-outline">Back to home</Link>
      </div>
    </div>
  )
}
