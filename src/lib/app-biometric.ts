// Fingerprint sign-in inside the customer app: the page asks first, and Settings can turn it off.
const DECLINED_KEY = 'vochus_bio_declined'

type BioWindow = {
  __vochusCanBiometric?: boolean
  __vochusBiometricEnrolled?: boolean
  __vochusCanManageBiometric?: boolean
  __vochusDeviceId?: string
  VochusBiometric?: { postMessage: (s: string) => void }
  VochusBiometricClear?: { postMessage: (s: string) => void }
}

const bioWindow = () => window as unknown as BioWindow

export function biometricState() {
  const w = bioWindow()
  return {
    canEnrol: !!(w.__vochusCanBiometric && w.VochusBiometric),
    enrolled: !!w.__vochusBiometricEnrolled,
    // Older installs can enrol but have no way to clear the token, so they don't announce this.
    canManage: !!(w.__vochusCanManageBiometric && w.VochusBiometricClear),
  }
}

export function biometricDeclined() {
  try { return localStorage.getItem(DECLINED_KEY) === '1' } catch { return false }
}

export function setBiometricDeclined(declined: boolean) {
  try {
    if (declined) localStorage.setItem(DECLINED_KEY, '1')
    else localStorage.removeItem(DECLINED_KEY)
  } catch {}
}

export async function enableBiometric() {
  const w = bioWindow()
  try {
    const r = await fetch('/api/customer/auth/biometric/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: w.__vochusDeviceId ?? '' }),
    })
    if (!r.ok || !w.VochusBiometric) return false
    const d = await r.json()
    w.VochusBiometric.postMessage(JSON.stringify({ token: d.token, identifier: d.identifier }))
    w.__vochusBiometricEnrolled = true
    setBiometricDeclined(false)
    return true
  } catch {
    return false
  }
}

export async function disableBiometric() {
  const w = bioWindow()
  // Check first: revoking the token without clearing it here would break the next fingerprint sign-in.
  if (!w.VochusBiometricClear) return false
  try {
    const r = await fetch('/api/customer/auth/biometric/issue', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: w.__vochusDeviceId ?? '' }),
    })
    if (!r.ok) return false
    w.VochusBiometricClear.postMessage('')
    w.__vochusBiometricEnrolled = false
    setBiometricDeclined(true)
    return true
  } catch {
    return false
  }
}
