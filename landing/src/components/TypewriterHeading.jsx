import { useEffect, useState } from 'react'

export default function TypewriterHeading({ pre, post, speed = 35, startDelay = 400 }) {
  const full = pre + post
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(full.length)
      return
    }
    let i = 0
    let interval
    const timer = setTimeout(() => {
      interval = setInterval(() => {
        i += 1
        setCount(i)
        if (i >= full.length) clearInterval(interval)
      }, speed)
    }, startDelay)
    return () => {
      clearTimeout(timer)
      clearInterval(interval)
    }
  }, [full, speed, startDelay])

  const done = count >= full.length

  return (
    <h1 className="headline">
      <span className="hl-black">{full.slice(0, Math.min(count, pre.length))}</span>
      <span className="hl-blue">{count > pre.length ? full.slice(pre.length, count) : ''}</span>
      {!done && <span className="type-cursor" aria-hidden="true" />}
    </h1>
  )
}
