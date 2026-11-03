/** The temporary admin redesign previews are sign-in-free and must never be served. */
export function isDevPreviewPath(pathname: string): boolean {
  return pathname === '/dev-preview' || pathname.startsWith('/dev-preview/')
}
