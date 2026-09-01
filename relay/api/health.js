export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      ok: true,
      service: 'fastrack-managed-relay',
      ready: Boolean(process.env.GROQ_API_KEY && process.env.CLIENT_TOKENS)
    })
  );
}
