import { redirect } from 'next/navigation'

// Wallet accounts was folded into Treasury (Wallets and Agent balances tabs). Old links land there.
export default function WalletAccountsRedirect() {
  redirect('/superadmin/treasury')
}
