import { NextResponse } from 'next/server'

// Bare heartbeat. No logic: the proxy slides the session cookie as this
// request passes through.
export async function GET() {
  return new NextResponse(null, { status: 204 })
}
