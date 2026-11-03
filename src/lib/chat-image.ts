// What a chat bubble may show as a picture and link. New messages are checked on the server, but older rows were stored
// unchecked, and this value goes straight into an href.
export function isChatImage(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(url)
}
