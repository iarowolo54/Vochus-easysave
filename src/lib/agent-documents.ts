/** The onboarding documents an agent can have on file. Safe to import from client components. */
export const AGENT_DOCS = [
  { id: 'id', label: 'Government-issued ID' },
  { id: 'addr', label: 'Proof of address' },
  { id: 'guar', label: 'Signed guarantor form' },
  { id: 'agree', label: 'Signed agent agreement' },
  { id: 'bank', label: 'Bank statement' },
] as const

export const agentDocLabel = (docType: string): string => AGENT_DOCS.find(d => d.id === docType)?.label ?? docType

/** Agent.requiredDocs is a JSON array in a text column; anything else counts as none. */
export function parseRequiredDocs(raw: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : []
  } catch {
    return []
  }
}

/** Staff may only store a document this agent can have: a standard one, one required of them, or one already on file. */
export function canStoreAgentDoc(docType: string, required: string[], alreadyOnFile: boolean): boolean {
  return alreadyOnFile || required.includes(docType) || AGENT_DOCS.some(d => d.id === docType)
}

/**
 * The review status after staff put a file in place. An approved document stays approved, because sign-in needs every
 * required document approved and a correction must not lock out a working agent. Anything else goes for review, so
 * uploading a file can't skip the approval step.
 */
export function statusAfterStaffUpload(previous: string | null | undefined): 'approved' | 'pending' {
  return previous === 'approved' ? 'approved' : 'pending'
}
