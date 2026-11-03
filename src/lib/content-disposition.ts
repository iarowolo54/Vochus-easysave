// A Content-Disposition value for a user-supplied filename. Headers can only carry Latin-1, so a name outside that
// range would throw and fail the whole response. RFC 6266: an ASCII fallback, plus the real name in filename*.

export function contentDisposition(disposition: 'inline' | 'attachment', fileName: string): string {
  const name = fileName.toWellFormed()
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').trim() || 'document'
  const encoded = encodeURIComponent(name.replace(/[\r\n]/g, ' ') || 'document')
    .replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
