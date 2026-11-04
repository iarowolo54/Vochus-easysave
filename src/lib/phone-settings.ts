/** The flags the Android apps put on `window`, as far as the printer and fingerprint controls care. */
export interface PhoneFlags {
  __vochusApp?: string
  /** Set by the newer agent app: it can connect a printer and switch fingerprint on and off from the Settings page. */
  __vochusCanManagePhone?: boolean
  /** Set by every agent app: it can open the older pop-up sheet. */
  __vochusCanOpenSettings?: boolean
  __vochusCanBiometric?: boolean
  __vochusBiometricEnrolled?: boolean
  __vochusPrinterName?: string
}

/** 'manage' = controls on the Settings page; 'legacy' = an older agent app with the pop-up sheet only; 'none' = not the agent app. */
export function phoneSettingsMode(w: PhoneFlags): 'manage' | 'legacy' | 'none' {
  if (w.__vochusApp !== 'agent') return 'none'
  if (w.__vochusCanManagePhone) return 'manage'
  return w.__vochusCanOpenSettings ? 'legacy' : 'none'
}

export function phoneState(w: PhoneFlags): { printerName: string | null; fingerprintOn: boolean; canFingerprint: boolean } {
  return {
    printerName: w.__vochusPrinterName ? w.__vochusPrinterName : null,
    fingerprintOn: !!w.__vochusBiometricEnrolled,
    canFingerprint: !!w.__vochusCanBiometric,
  }
}

/** Older agent apps switched fingerprint on by themselves after sign-in. The newer app leaves it to the Enable button. */
export function shouldAutoEnrollFingerprint(w: PhoneFlags): boolean {
  return !!w.__vochusCanBiometric && !w.__vochusBiometricEnrolled && phoneSettingsMode(w) !== 'manage'
}
