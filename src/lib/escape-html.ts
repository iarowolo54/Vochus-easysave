/** Escape a string for safe interpolation into HTML, as numeric character entities. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}
