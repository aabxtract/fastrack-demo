function LogoMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="11" y="11" width="15" height="15" rx="2" fill="#2563EB" />
      <rect x="6" y="6" width="15" height="15" rx="2" fill="#FF6B00" />
    </svg>
  )
}

export default function Header() {
  return (
    <header className="header">
      <div className="header-left">
        <a className="logo" href="#">
          <LogoMark size={23} />
          FASTRACK
        </a>
        <nav className="nav" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#mcp">MCP</a>
          <a href="#demo">Demo</a>
          <a href="https://github.com/aabxtract/fastrack" target="_blank" rel="noopener">GitHub</a>
        </nav>
      </div>
      <div className="header-right">
        <span className="btn-border-wrap">
          <a className="btn" href="https://github.com/aabxtract/fastrack#readme" target="_blank" rel="noopener">Docs</a>
        </span>
      </div>
    </header>
  )
}
