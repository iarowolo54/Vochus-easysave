import 'next-auth'
declare module 'next-auth' {
  interface Session {
    user: { id: string; name: string; agentId: string; location: string; walletBalance: number }
  }
}
