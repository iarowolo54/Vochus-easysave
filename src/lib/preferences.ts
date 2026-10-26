// Per-device display preferences. Stored in localStorage on purpose: they belong to the phone
// (a shared family phone may want large text), and losing them is harmless.

export type TextSize = 'normal' | 'large'

const TEXT_SIZE_KEY = 'ves.textSize'
const HIDE_BALANCE_KEY = 'ves.hideBalance'

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
}

export function getTextSize(): TextSize {
  return read(TEXT_SIZE_KEY) === 'large' ? 'large' : 'normal'
}

export function setTextSize(size: TextSize) {
  write(TEXT_SIZE_KEY, size === 'large' ? 'large' : null)
  if (size === 'large') document.documentElement.dataset.textSize = 'large'
  else delete document.documentElement.dataset.textSize
}

export function getHideBalance(): boolean {
  return read(HIDE_BALANCE_KEY) === '1'
}

export function setHideBalance(hide: boolean) {
  write(HIDE_BALANCE_KEY, hide ? '1' : null)
}

/** Inlined in the root layout so large text is applied before first paint, not after a flash. */
export const TEXT_SIZE_BOOT_SCRIPT =
  `try{if(localStorage.getItem('${TEXT_SIZE_KEY}')==='large')document.documentElement.dataset.textSize='large'}catch(e){}`
