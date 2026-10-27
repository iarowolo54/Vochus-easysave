// Grey placeholders shaped like the page that's loading. They fade in after a short delay, so fast
// loads (<~0.3s) show nothing at all instead of a flash (NN/g response-time guidance).

type BoxProps = { w?: number | string; h?: number | string; round?: boolean; center?: boolean }

export function Bone({ w = '100%', h = 16, round = false, center = false }: BoxProps) {
  return (
    <span
      className="ui-bone"
      style={{ width: w, height: h, borderRadius: round ? '50%' : undefined, margin: center ? '0 auto' : undefined }}
    />
  )
}

function Rows({ count }: { count: number }) {
  return (
    <div className="ui-card ui-card--list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ui-row">
          <Bone w={40} h={40} round />
          <span className="ui-row-main ui-bone-lines"><Bone w="55%" /><Bone w="35%" h={12} /></span>
          <Bone w={64} />
        </div>
      ))}
    </div>
  )
}

export function HomeSkeleton() {
  return (
    <div className="ui-screen ui-skeleton" role="status" aria-busy="true" aria-label="Loading your savings">
      <div className="ui-topbar"><Bone w={40} h={40} round /><Bone w={160} h={18} /></div>
      <div className="ui-container">
        <div className="ui-hero">
          <Bone w={170} h={44} />
          <span style={{ height: 16 }} />
          <Bone w={180} h={40} />
          <span style={{ height: 12 }} />
          <Bone w={220} h={14} />
          <span style={{ height: 8 }} />
          <Bone w={160} h={14} />
        </div>
        <div className="ui-actions">
          {[0, 1, 2].map(i => <span key={i} className="ui-bone-action"><Bone w={56} h={56} round /><Bone w={48} h={12} /></span>)}
        </div>
        <div className="ui-card"><Bone w="40%" h={20} /><span style={{ height: 16, display: 'block' }} /><Bone h={44} /></div>
        <Rows count={2} />
      </div>
    </div>
  )
}

export function FormSkeleton({ label }: { label: string }) {
  return (
    <div className="ui-screen ui-skeleton" role="status" aria-busy="true" aria-label={label}>
      <div className="ui-topbar"><Bone w={44} h={44} round /><Bone w={120} h={18} /></div>
      <div className="ui-container">
        <div style={{ padding: '16px 0 24px' }}><Bone w="45%" h={16} /><span style={{ height: 10, display: 'block' }} /><Bone w="85%" h={32} /></div>
        <Rows count={3} />
        <span style={{ height: 12, display: 'block' }} />
        <Bone h={48} />
      </div>
    </div>
  )
}
