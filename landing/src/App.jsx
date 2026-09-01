import Header from './components/Header.jsx'
import TypewriterHeading from './components/TypewriterHeading.jsx'
import OrbitVisual from './components/OrbitVisual.jsx'
import LogoTicker from './components/LogoTicker.jsx'
import CopyCommandButton from './components/CopyCommandButton.jsx'
import TerminalDemo from './components/TerminalDemo.jsx'
import useCountUp from './hooks/useCountUp.js'
import { useEffect, useRef, useState } from 'react'

function LogoMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="11" y="11" width="15" height="15" rx="2" fill="#2563EB" />
      <rect x="6" y="6" width="15" height="15" rx="2" fill="#FF6B00" />
    </svg>
  )
}

const STEPS = [
  { n: '01', t: 'Sentence → plan', d: 'The model reads your intent and extracts the steps, the tools, and the order they run in.' },
  { n: '02', t: 'Plan → workflow', d: 'The plan becomes a named workflow, saved to SQLite on your machine. It survives restarts.' },
  { n: '03', t: 'Workflow → tools', d: 'Each step hits a real connector — GitHub, Notion, Slack — with your credentials, from your machine.' },
  { n: '04', t: 'Fail → self-heal', d: 'A step fails, the model reads the error and corrects the parameters. Up to three retries, then an honest failure.' },
  { n: '05', t: 'Runs → insight', d: 'After every third success it studies your last ten runs and offers an optimization. You apply it or not.' }
]

export default function App() {
  const count = useCountUp(10, 2000, 1200)
  const [showCta, setShowCta] = useState(false)
  const [showBadge, setShowBadge] = useState(false)
  const [cursorLive, setCursorLive] = useState(false)
  const followRef = useRef(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShowCta(true)
      setShowBadge(true)
      return
    }
    const t1 = setTimeout(() => setShowCta(true), 3200)
    const t2 = setTimeout(() => setShowBadge(true), 3600)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const el = followRef.current
    if (!el) return
    setCursorLive(true)
    const target = { x: window.innerWidth * 0.62, y: window.innerHeight * 0.55 }
    const pos = { ...target }
    const onMove = (e) => { target.x = e.clientX; target.y = e.clientY }
    let raf
    const loop = () => {
      pos.x += (target.x - pos.x) * 0.16
      pos.y += (target.y - pos.y) * 0.16
      el.style.transform = `translate3d(${pos.x - 4}px, ${pos.y - 4}px, 0)`
      raf = requestAnimationFrame(loop)
    }
    window.addEventListener('mousemove', onMove)
    raf = requestAnimationFrame(loop)
    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className={`app${cursorLive ? ' cursor-live' : ''}`}>
      <Header />

      <main className="hero">
        <section className="hero-left">
          <TypewriterHeading
            pre="Plain English in. Workflows out"
            post=" — built, run, and self-healed right in your terminal."
          />
          <div className={`hero-cta-row${showCta ? ' in' : ''}`}>
            <CopyCommandButton large />
            <code className="install-chip">npm install -g fastrack-cli</code>
          </div>
        </section>
        <OrbitVisual count={count} />
      </main>

      <div className={`cursor-badge${showBadge ? ' in' : ''}`} aria-hidden="true">
        <div className="cursor-follow" ref={followRef}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 2l16 8.5-7 1.5-3.5 6.5L4 2z" fill="#FF6B00" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <span className="cursor-name">you</span>
        </div>
      </div>

      <LogoTicker />

      <section className="section" id="how">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">THE PIPELINE</p>
            <h2>What happens when you press enter.</h2>
            <p className="section-sub">Every command walks the same path. No configuration, no YAML, no clicking.</p>
          </div>
          <div className="steps">
            {STEPS.map((s) => (
              <article className="step" key={s.n}>
                <p className="step-n">{s.n}</p>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="mcp">
        <div className="wrap">
          <div className="mcp">
            <div>
              <p className="eyebrow">MCP SERVER</p>
              <h2>Inside Claude Code and Cursor too.</h2>
              <p className="section-sub">Every command is exposed as an MCP tool, so your editor can run workflows, pull reports, and connect tools without leaving the chat.</p>
              <div className="mcp-tools">
                <code>fastrack_run</code>
                <code>fastrack_workflow_run</code>
                <code>fastrack_report</code>
                <code>fastrack_note</code>
                <code>fastrack_connect</code>
                <code>fastrack_model_compare</code>
              </div>
            </div>
            <pre className="mcp-config">{`// .mcp.json — Claude Code / Cursor
{
  `}<span className="j-k">"mcpServers"</span>{`: {
    `}<span className="j-k">"fastrack"</span>{`: {
      `}<span className="j-k">"command"</span>{`: `}<span className="j-s">"fastrack"</span>{`,
      `}<span className="j-k">"args"</span>{`: [`}<span className="j-s">"mcp"</span>{`, `}<span className="j-s">"start"</span>{`]
    }
  }
}`}</pre>
          </div>
        </div>
      </section>

      <section className="section" id="demo">
        <div className="wrap">
          <div className="section-head center">
            <p className="eyebrow">LIVE DEMO</p>
            <h2>Watch a sentence become a workflow.</h2>
            <p className="section-sub">Real commands, real self-healing — exactly how it runs on your machine.</p>
          </div>
          <TerminalDemo />
        </div>
      </section>

      <section className="section cta" id="get-started">
        <div className="wrap">
          <div className="section-head center">
            <p className="eyebrow">GET STARTED</p>
            <h2>Stop clicking. Start saying.</h2>
            <p className="section-sub">One install, one API key, and your terminal understands sentences. No accounts, no cloud state, no lock-in.</p>
          </div>
          <div className="cta-actions">
            <CopyCommandButton large />
            <div className="cta-links">
              <a href="https://github.com/aabxtract/fastrack" target="_blank" rel="noopener">GitHub</a>
              <span>·</span>
              <a href="https://www.npmjs.com/package/fastrack-cli" target="_blank" rel="noopener">npm</a>
              <span>·</span>
              <span>MIT license</span>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap footer-row">
          <span className="footer-brand"><LogoMark size={14} /> FASTRACK</span>
          <span>Plain English workflows — in your terminal, on your machine.</span>
        </div>
      </footer>
    </div>
  )
}
