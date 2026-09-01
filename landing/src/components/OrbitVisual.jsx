const GRADIENTS = {
  blue: 'linear-gradient(180deg, rgba(37,99,235,0) 0%, rgba(37,99,235,0.9) 43%, rgba(37,99,235,0) 100%)',
  orange: 'linear-gradient(180deg, rgba(255,107,0,0) 0%, rgba(255,107,0,0.85) 43%, rgba(255,107,0,0) 100%)'
}

const GLOWS = {
  blue: 'rgba(37,99,235,0.30)',
  orange: 'rgba(255,107,0,0.28)'
}

const ORBITS = [
  {
    size: 280, dir: 'L', dur: 30, grad: 'blue',
    items: [
      { slug: 'github', name: 'GitHub', angle: 270, r: 140, shape: 'sq20', size: 58, glow: 'blue', d: 0.6 }
    ]
  },
  {
    size: 400, dir: 'R', dur: 40, grad: 'orange',
    items: [
      { slug: 'slack', name: 'Slack', angle: 60, r: 200, shape: 'round', size: 58, glow: 'orange', d: 0.9 },
      { slug: 'notion', name: 'Notion', angle: 180, r: 200, shape: 'sq20', size: 78, glow: 'blue', d: 1.1 },
      { slug: 'discord', name: 'Discord', angle: 300, r: 200, shape: 'sq20', size: 58, glow: 'orange', d: 1.3 }
    ]
  },
  {
    size: 520, dir: 'R', dur: 50, grad: 'blue',
    items: [
      { slug: 'telegram', name: 'Telegram', angle: 130, r: 260, shape: 'round', size: 88, glow: 'orange', d: 1.5 },
      { slug: 'linear', name: 'Linear', angle: 250, r: 260, shape: 'round', size: 58, glow: 'blue', d: 1.7 }
    ]
  },
  {
    size: 640, dir: 'L', dur: 60, grad: 'orange',
    items: [
      { slug: 'airtable', name: 'Airtable', angle: 30, r: 320, shape: 'sq20', size: 58, glow: 'blue', d: 1.9 },
      { slug: 'jira', name: 'Jira', angle: 95, r: 320, shape: 'sq24', size: 88, glow: 'orange', d: 2.0 },
      { slug: 'gmail', name: 'Email', angle: 220, r: 320, shape: 'sq24', size: 88, glow: 'blue', d: 2.2 },
      { slug: 'webhook', name: 'Webhooks', angle: 320, r: 320, shape: 'sq20', size: 58, glow: 'orange', d: 2.3 }
    ]
  }
]

function WebhookGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#FF6B00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 L3 14 h7 l-1 8 L19 10 h-7 l1 -8 z" fill="#FF6B00" stroke="none" />
    </svg>
  )
}

function Chip({ item, counterAnim }) {
  const style = {
    width: item.size,
    height: item.size,
    boxShadow: `0 10px 30px rgba(10,10,10,0.08), 0 0 34px ${GLOWS[item.glow]}`
  }
  return (
    <div
      className="orb-item"
      style={{ transform: `translate(-50%, -50%) rotate(${item.angle}deg) translate(${item.r}px) rotate(${-item.angle}deg)` }}
    >
      <div className="orb-fly" style={{ animationDelay: `${item.d}s` }}>
        <div className="orb-counter" style={counterAnim}>
          <div className={`chip ${item.shape}`} style={style} title={item.name}>
            {item.slug === 'webhook'
              ? <WebhookGlyph />
              : <img src={item.slug === 'slack' ? '/logos/slack.svg' : `https://cdn.simpleicons.org/${item.slug}`} alt={item.name} width={Math.round(item.size * 0.54)} height={Math.round(item.size * 0.54)} />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function OrbitVisual({ count }) {
  return (
    <div className="circles-wrap" role="img" aria-label="Ten tool connectors orbiting a center counter">
      <div className="circles-inner">
        {ORBITS.map((orbit) => {
          const counterName = orbit.dir === 'L' ? 'spinR' : 'spinL'
          const counterAnim = { animation: `${counterName} ${orbit.dur}s linear infinite` }
          return (
            <div
              key={orbit.size}
              className={`orbit orbit-${orbit.size}`}
              style={{ '--orbit-grad': GRADIENTS[orbit.grad], width: orbit.size, height: orbit.size }}
            >
              {orbit.size === 280 && (
                <div className="center-content" style={counterAnim}>
                  <div className="center-num">{count}</div>
                  <div className="center-label">connectors</div>
                </div>
              )}
              {orbit.items.map((item) => (
                <Chip key={item.slug} item={item} counterAnim={counterAnim} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
