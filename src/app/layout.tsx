import type { Metadata } from 'next'
import './globals.css'
import Providers from './providers'
import DownloadAppBanner from '@/components/DownloadAppBanner'
import { TEXT_SIZE_BOOT_SCRIPT } from '@/lib/preferences'

export const metadata: Metadata = {
  title: 'Vochus Easy Save — Agent Portal',
  description: 'Vochus Easy Save Agent Portal v2.1',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEXT_SIZE_BOOT_SCRIPT }} />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <DownloadAppBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
