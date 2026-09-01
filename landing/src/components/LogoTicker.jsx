const PROVIDERS = ['Groq', 'OpenAI', 'Anthropic', 'Google Gemini', 'Mistral']
const SETS = [0, 1, 2, 3]

export default function LogoTicker() {
  return (
    <section className="logos" aria-label="Works with Groq, OpenAI, Anthropic, Google Gemini and Mistral">
      <p className="logos-label">Routes across every major model provider</p>
      <div className="ticker">
        <div className="ticker-track" aria-hidden="true">
          {SETS.map((set) => (
            <div className="ticker-set" key={set}>
              {PROVIDERS.map((name) => (
                <span className="ticker-logo" key={name}>{name}</span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
