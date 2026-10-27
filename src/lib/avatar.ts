/** A stable tint (0–4) per customer code, so the same person looks the same on every screen. See `.ag-av--N`. */
export function avatarTint(code: string): number {
  let h = 0
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 5
}
