const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function testWithTimeout(
  name: string,
  fn: () => Promise<{ ok: boolean; detail: string }>
): Promise<{ name: string; status: 'ok' | 'fail' | 'missing'; detail: string; ms: number }> {
  const start = Date.now()
  try {
    const result = await Promise.race([
      fn(),
      new Promise<{ ok: boolean; detail: string }>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out after 10s')), 10000)
      ),
    ])
    return { name, status: result.ok ? 'ok' : 'fail', detail: result.detail, ms: Date.now() - start }
  } catch (e: any) {
    return { name, status: 'fail', detail: e.message ?? String(e), ms: Date.now() - start }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
  const SERPER_API_KEY = Deno.env.get('SERPER_API_KEY') ?? ''
  const EVENTBRITE_API_KEY = Deno.env.get('EVENTBRITE_API_KEY') ?? ''
  const TAVILY_API_KEY = Deno.env.get('TAVILY_API_KEY') ?? ''
  const PREDICTHQ_API_KEY = Deno.env.get('PREDICTHQ_API_KEY') ?? ''
  const LOCATIONIQ_API_KEY = Deno.env.get('LOCATIONIQ_API_KEY') ?? ''
  const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? ''
  const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY') ?? ''
  const GOOGLE_CSE_ID = Deno.env.get('GOOGLE_CSE_ID') ?? ''

  const tests = await Promise.all([

    testWithTimeout('GEMINI_API_KEY', async () => {
      if (!GEMINI_API_KEY) return { ok: false, detail: 'Key not set' }
      // Test primary model (gemini-2.5-flash) — free-tier 2.0-flash quota often exhausted
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say "ok"' }] }], generationConfig: { maxOutputTokens: 5 } }),
        }
      )
      const body = await res.text()
      if (res.ok) return { ok: true, detail: `HTTP ${res.status} — model responded` }
      return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }),

    testWithTimeout('GROQ_API_KEY', async () => {
      if (!GROQ_API_KEY) return { ok: false, detail: 'Key not set' }
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'Say ok' }], max_tokens: 5 }),
      })
      const body = await res.text()
      if (res.ok) return { ok: true, detail: `HTTP ${res.status} — model responded` }
      return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }),

    testWithTimeout('TAVILY_API_KEY', async () => {
      if (!TAVILY_API_KEY) return { ok: false, detail: 'Key not set' }
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: TAVILY_API_KEY, query: 'test', max_results: 1 }),
      })
      const body = await res.text()
      if (res.ok) return { ok: true, detail: `HTTP ${res.status} — search responded` }
      return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }),

    testWithTimeout('SERPER_API_KEY', async () => {
      if (!SERPER_API_KEY) return { ok: false, detail: 'Key not set' }
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_API_KEY },
        body: JSON.stringify({ q: 'test', num: 1 }),
      })
      const body = await res.text()
      if (res.ok) return { ok: true, detail: `HTTP ${res.status} — search responded` }
      return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }),

    testWithTimeout('GOOGLE_API_KEY + GOOGLE_CSE_ID', async () => {
      if (!GOOGLE_API_KEY) return { ok: false, detail: 'GOOGLE_API_KEY not set' }
      if (!GOOGLE_CSE_ID) return { ok: false, detail: 'GOOGLE_CSE_ID not set' }
      const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=test&num=1`
      const res = await fetch(url)
      const body = await res.text()
      if (res.ok) return { ok: true, detail: `HTTP ${res.status} — custom search responded` }
      return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }),

    testWithTimeout('PREDICTHQ_API_KEY', async () => {
      if (!PREDICTHQ_API_KEY) return { ok: false, detail: 'Key not set' }
      const res = await fetch('https://api.predicthq.com/v1/events/?limit=1', {
        headers: { Authorization: `Bearer ${PREDICTHQ_API_KEY}`, Accept: 'application/json' },
      })
      const body = await res.text()
      if (res.ok) return { ok: true, detail: `HTTP ${res.status} — events API responded` }
      return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }),

    testWithTimeout('LOCATIONIQ_API_KEY', async () => {
      if (!LOCATIONIQ_API_KEY) return { ok: false, detail: 'Key not set' }
      const res = await fetch(
        `https://us1.locationiq.com/v1/search?key=${LOCATIONIQ_API_KEY}&q=Lusaka&format=json&limit=1`
      )
      const body = await res.text()
      if (res.ok) return { ok: true, detail: `HTTP ${res.status} — geocoding responded` }
      return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }),

    testWithTimeout('EVENTBRITE_API_KEY', async () => {
      if (!EVENTBRITE_API_KEY) return { ok: false, detail: 'Key not set' }
      const res = await fetch('https://www.eventbriteapi.com/v3/users/me/', {
        headers: { Authorization: `Bearer ${EVENTBRITE_API_KEY}` },
      })
      const body = await res.text()
      if (res.ok) return { ok: true, detail: `HTTP ${res.status} — Eventbrite auth OK` }
      return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }),

  ])

  const summary = {
    timestamp: new Date().toISOString(),
    passed: tests.filter((t) => t.status === 'ok').length,
    failed: tests.filter((t) => t.status === 'fail').length,
    total: tests.length,
    results: tests,
  }

  return json(summary)
})
