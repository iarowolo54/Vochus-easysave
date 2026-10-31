// Optional ?page (1-based) / ?limit parsing for admin list endpoints.
// Invalid or missing values fall back to defaults; limit is clamped to [1, MAX_LIMIT].
export const DEFAULT_LIMIT = 200
export const MAX_LIMIT = 200

function posInt(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw.trim())) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export function parsePaging(params: URLSearchParams): { page: number; limit: number; skip: number } {
  const page = posInt(params.get('page')) ?? 1
  const limit = Math.min(posInt(params.get('limit')) ?? DEFAULT_LIMIT, MAX_LIMIT)
  return { page, limit, skip: (page - 1) * limit }
}
