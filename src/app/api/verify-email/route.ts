import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/verify-email?error=missing', req.url))

  const agent = await prisma.agent.findFirst({ where: { emailVerifyToken: token } })
  if (!agent) return NextResponse.redirect(new URL('/verify-email?error=invalid', req.url))

  await prisma.agent.update({
    where: { id: agent.id },
    data: { emailVerified: true, emailVerifyToken: null },
  })

  return NextResponse.redirect(new URL('/verify-email?success=1', req.url))
}
