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
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=Inter:wght@300;400;500;600&display=swap"
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
