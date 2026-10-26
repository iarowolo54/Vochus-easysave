const API_URL = 'https://my.kudisms.net/api'

export async function sendSMS(to: string, body: string) {
  if (process.env.NODE_ENV !== 'production') {
    return { success: true }
  }

  const TOKEN = process.env.KUDISMS_API_TOKEN
  const SENDER_ID = process.env.KUDISMS_SENDER_ID || 'zipwaves'
  const form = new FormData()
  form.append('token', TOKEN!)
  form.append('senderID', SENDER_ID)
  form.append('recipients', to)
  form.append('message', body)

  try {
    const res = await fetch(`${API_URL}/corporate`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(9000),
    })
    const data = await res.json()
    return data.status === 'success' && data.error_code === '000'
      ? { success: true }
      : { success: false, error: data.msg || 'SMS send failed' }
  } catch (err: any) {
    const msg = err?.code === 'UND_ERR_CONNECT_TIMEOUT' || err?.name === 'TimeoutError'
      ? 'SMS gateway timeout — try again'
      : 'Failed to reach SMS gateway'
    return { success: false, error: msg }
  }
}
