import { useEffect, useRef, useState } from 'react'

const SCENARIOS = [
  {
    cmd: 'fastrack "summarize my open PRs and add the summary to Notion"',
    lines: [
      { cls: 't-step', text: '  parse   intent → 3 steps', d: 500 },
      { cls: 't-step', text: '  build   workflow saved · "pr-digest" (#4)', d: 450 },
      { cls: 't-step', text: '  run     github → 3 open PRs found', d: 550 },
      { cls: 't-step', text: '  run     model  → summary written', d: 500 },
      { cls: 't-step', text: '  run     notion → page created', d: 500 },
      { cls: 't-ok', text: '  ✔ done in 6.2s · 3/3 steps ok', d: 700 }
    ]
  },
  {
    cmd: "fastrack \"send yesterday's report to #gtm on slack\"",
    lines: [
      { cls: 't-step', text: '  parse   intent → 2 steps', d: 450 },
      { cls: 't-err', text: '  run     slack → channel_not_found', d: 600 },
      { cls: 't-fix', text: '  fix     step 2 · channel renamed → params corrected', d: 750 },
      { cls: 't-step', text: '  run     slack → message delivered', d: 550 },
      { cls: 't-ok', text: '  ✔ done in 4.8s · self-healed once', d: 800 }
    ]
  },
  {
    cmd: 'fastrack "every morning at 9am summarize open PRs and add to Notion"',
    lines: [
      { cls: 't-step', text: '  parse   trigger → cron 0 9 * * *', d: 550 },
      { cls: 't-step', text: '  build   workflow saved · "morning-digest" (#5)', d: 500 },
      { cls: 't-ok', text: '  ✔ scheduled · runs daily at 09:00 (fastrack daemon)', d: 900 }
    ]
  }
]

export default function TerminalDemo() {
  const [typed, setTyped] = useState('')
  const [lines, setLines] = useState([])
  const [idle, setIdle] = useState(false)
  const stateRef = useRef(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const s = SCENARIOS[0]
      setTyped(s.cmd)
      setLines(s.lines)
      setIdle(true)
      return
    }

    stateRef.current = { alive: true, timers: [], idx: 0 }
    const st = stateRef.current
    const later = (fn, ms) => st.timers.push(setTimeout(fn, ms))

    const runScenario = () => {
      if (!st.alive) return
      const s = SCENARIOS[st.idx % SCENARIOS.length]
      setTyped('')
      setLines([])
      setIdle(false)
      let i = 0
      const type = () => {
        if (!st.alive) return
        i += 1
        setTyped(s.cmd.slice(0, i))
        if (i < s.cmd.length) {
          later(type, 26)
        } else {
          let t = 350
          s.lines.forEach((line) => {
            t += line.d
            later(() => { if (st.alive) setLines((prev) => [...prev, line]) }, t)
          })
          later(() => {
            if (!st.alive) return
            setIdle(true)
            later(() => { st.idx += 1; runScenario() }, 3200)
          }, t + 100)
        }
      }
      later(type, 500)
    }

    runScenario()
    return () => { st.alive = false; st.timers.forEach(clearTimeout) }
  }, [])

  return (
    <div className="terminal" role="img" aria-label="Animated terminal demonstrating FASTRACK commands">
      <div className="term-bar">
        <span className="dot dot-orange" />
        <span className="dot dot-blue" />
        <span className="dot" />
        <span className="term-title">fastrack — ~/.fastrack</span>
      </div>
      <div className="term-body">
        <p className="t-cmd">
          <span className="t-dollar">~ $ </span>
          {typed}
          {!idle && <span className="term-cursor" aria-hidden="true" />}
        </p>
        {lines.map((line, i) => (
          <p key={`${i}-${line.text.slice(0, 8)}`} className={line.cls}>{line.text}</p>
        ))}
        {idle && (
          <p className="t-cmd">
            <span className="t-dollar">~ $ </span>
            <span className="term-cursor" aria-hidden="true" />
          </p>
        )}
      </div>
    </div>
  )
}
