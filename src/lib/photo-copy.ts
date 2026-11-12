// The words and colour of every photo-deadline warning, in one place so the pop-ups, banners and Save screens agree.
// DB-free, so client components can import it.
import type { PhotoPhase, PhotoStatus } from '@/lib/photo-deadline'

export type CustomerPhoto = {
  status: PhotoStatus; rejectReason: string | null; deadline: string | null; lastDay: string | null
  phase: PhotoPhase; canTakeOwn: boolean; agentName: string
}
export type Tone = 'green' | 'yellow' | 'red'
export type PhotoCopy = { tone: Tone; title: string; text: string; camera: boolean }

const toneOf = (p: PhotoPhase): Tone => (p === 'green' ? 'green' : p === 'yellow' ? 'yellow' : 'red')

/** What the customer app says about their photo, or null when there's nothing to say. */
export function customerPhotoCopy(p: CustomerPhoto): PhotoCopy | null {
  if (p.status === 'ok' || p.phase === 'none') return null
  const tone = toneOf(p.phase)
  const paused = p.phase === 'paused'
  if (p.status === 'pending' && !p.canTakeOwn) {
    return { tone, title: paused ? 'Saving is paused' : 'Your photo is being checked', text: paused ? 'Your photo is being checked. Saving stays paused until it’s approved.' : 'Your photo is being checked.', camera: false }
  }
  const ask = `Ask your agent, ${p.agentName}, to take ${paused ? 'your photo' : 'it for you'}.`
  if (paused) return { tone, title: 'Saving is paused', text: p.canTakeOwn ? 'Add your photo to save again.' : ask, camera: p.canTakeOwn }
  const title = `Add your photo by ${p.lastDay ?? 'the deadline'}`
  const text = 'After that you won’t be able to save until you do.'
  return { tone, title, text: p.canTakeOwn ? text : `${text} ${ask}`, camera: p.canTakeOwn }
}

/** The agent's sign-in pop-up heading, or null when none of their customers needs a photo. */
export function agentReminderCopy(o: { phase: PhotoPhase; lastDay: string | null; count: number }): { tone: Tone; title: string; text: string } | null {
  if (o.phase === 'none' || o.count === 0) return null
  const who = o.count === 1 ? '1 customer' : `${o.count} customers`
  if (o.phase === 'paused') return { tone: 'red', title: `Saving is paused for ${who}`, text: 'Take their photos. Saving starts again when each one is approved.' }
  return { tone: toneOf(o.phase), title: `${who} ${o.count === 1 ? 'needs' : 'need'} a photo by ${o.lastDay ?? 'the deadline'}`, text: 'After that, you can’t record savings for them until their photo is approved.' }
}
