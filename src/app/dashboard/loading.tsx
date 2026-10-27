import LogoLoader from '@/components/ui/LogoLoader'

// Shown in the agent content area while a server-rendered page (e.g. Home) loads its data.
export default function AgentLoading() {
  return (
    <div className="ag-loading">
      <LogoLoader delayed label="Loading" />
    </div>
  )
}
