import { redirect } from 'next/navigation'

export default async function CardRedirectPage({
  params,
}: {
  params: Promise<{ serial: string }>
}) {
  const { serial } = await params
  redirect(`/dashboard/cards/${serial}`)
}
