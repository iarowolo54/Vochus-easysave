// Email clients don't render SVG, so emails use a hosted PNG of the logo.
// Returns '' when NEXTAUTH_URL isn't set rather than pointing at a guessed host.
export function emailLogo(width = 48): string {
  const base = process.env.NEXTAUTH_URL
  if (!base) return ''
  const height = Math.round(width * (220 / 247))
  return `<img src="${base.replace(/\/$/, '')}/brand/logo-email.png" width="${width}" height="${height}" alt="Vochus Easy Save" style="display:inline-block;border:0">`
}

// A button to a real page on the site. No button when NEXTAUTH_URL isn't set, rather than a broken link.
export function emailAction(label: string, path: string): { label: string; url: string } | undefined {
  const base = process.env.NEXTAUTH_URL
  return base ? { label, url: `${base.replace(/\/$/, '')}${path}` } : undefined
}
