import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { decodeBase64 } from 'jsr:@std/encoding/base64'
import mammoth from 'npm:mammoth'
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js'


// ===== CONSTANTS & CONFIG =====
const MODELS = {
  generation: {
    primary: 'gemini-2.5-flash',
    // Fallback to 2.5-pro because 2.0-flash free-tier quota is often exhausted
    fallback: 'gemini-2.5-pro',
  },
  embedding: {
    primary: 'gemini-embedding-001',
    fallback: 'gemini-embedding-2',
  },
}

const API_ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  jina: 'https://r.jina.ai',
  googleCustomSearch: 'https://www.googleapis.com/customsearch/v1',
  tavily: 'https://api.tavily.com/search',
  predicthq: 'https://api.predicthq.com/v1/events/',
  locationiq: 'https://us1.locationiq.com/v1/search',
}

const TIMEOUTS = {
  gemini: 60000,
  tavily: 15000,
}

// ===== CORPUS LOADER (few-shot training data) =====
// Cached at module level so edge function cold starts read files once.

let _corpusCache: { letters: any[]; interviews: any[]; guide: string } | null = null

async function loadCorpus(): Promise<{ letters: any[]; interviews: any[]; guide: string }> {
  if (_corpusCache) return _corpusCache
  const letters: any[] = []
  const interviews: any[] = []
  let guide = ''
  try {
    const idxText = await Deno.readTextFile(new URL('./research/corpus-index.json', import.meta.url))
    const idx = JSON.parse(idxText)
    for (const f of idx.letterFiles || []) {
      try {
        const text = await Deno.readTextFile(new URL(`./research/letters/${f}`, import.meta.url))
        const data = JSON.parse(text)
        if (data.examples) letters.push(...data.examples)
      } catch { /* skip unreadable files */ }
    }
    for (const f of idx.interviewFiles || []) {
      try {
        const text = await Deno.readTextFile(new URL(`./research/interviews/${f}`, import.meta.url))
        const data = JSON.parse(text)
        if (data.examples) interviews.push(...data.examples)
      } catch { /* skip unreadable files */ }
    }
    if (idx.styleAnalysisFile) {
      try {
        guide = await Deno.readTextFile(new URL(`./research/${idx.styleAnalysisFile}`, import.meta.url))
      } catch { /* skip unreadable guide */ }
    }
  } catch {
    // Corpus missing or malformed — proceed without few-shot data
  }
  _corpusCache = { letters, interviews, guide }
  return _corpusCache
}

function pickLetterExamples(corpusLetters: any[], letterType: string, count = 2): string {
  const typeMap: Record<string, string[]> = {
    'attachment': ['attachment-specific', 'internship-specific'],
    'internship': ['internship-specific', 'attachment-specific'],
    'graduate': ['graduate-programme', 'recent-graduate'],
    'job': ['formal-professional', 'confident-assertive', 'detailed-technical'],
    'general': ['formal-professional', 'warm-personal'],
    'cover': ['formal-professional', 'warm-personal', 'confident-assertive'],
    'motivation': ['confident-assertive', 'formal-professional'],
    'recommendation': ['formal-professional'],
    'thank-you': ['warm-personal'],
  }
  const keys = typeMap[letterType] || ['formal-professional']
  const matched = corpusLetters.filter((ex: any) => keys.some((k: string) => ex._styleLabel?.includes(k) || false))
  const pool = matched.length >= count ? matched : corpusLetters
  const picked = pool.sort(() => 0.5 - Math.random()).slice(0, count)
  return picked.map((ex: any, i: number) => `EXAMPLE ${i + 1} (${ex._styleLabel || 'reference'}):\n${ex.body || ex.title || ''}`).join('\n\n---\n\n')
}

function pickInterviewExamples(corpusInterviews: any[], count = 3): string {
  const behavioral = corpusInterviews.filter((ex: any) => ex.category === 'behavioral')
  const technical = corpusInterviews.filter((ex: any) => ex.category?.startsWith('technical'))
  const situational = corpusInterviews.filter((ex: any) => ex.category === 'situational')
  const picked = [...behavioral.slice(0, 1), ...technical.slice(0, 1), ...situational.slice(0, 1)]
    .filter(Boolean)
  if (picked.length < count) {
    const rest = corpusInterviews.filter((ex: any) => !picked.includes(ex))
    picked.push(...rest.slice(0, count - picked.length))
  }
  return picked.map((ex: any, i: number) => {
    if (ex.question && ex.expectedAnswer) {
      return `EXAMPLE ${i + 1} (${ex.category || 'general'}):\nQ: ${ex.question}\nA: ${ex.expectedAnswer.slice(0, 600)}`
    }
    if (ex.question && ex.situation) {
      return `EXAMPLE ${i + 1} (behavioral - STAR):\nQ: ${ex.question}\nS: ${ex.situation.slice(0, 200)}\nT: ${ex.task.slice(0, 150)}\nA: ${ex.action.slice(0, 300)}\nR: ${ex.result.slice(0, 200)}`
    }
    return ''
  }).filter(Boolean).join('\n\n---\n\n')
}

// ===== ERROR CLASSES =====
class AIServiceError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AIServiceError'
  }
}

class ValidationError extends AIServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', 400, message, details)
    this.name = 'ValidationError'
  }
}

class APIError extends AIServiceError {
  constructor(message: string, statusCode: number = 503, details?: Record<string, unknown>) {
    super('API_ERROR', statusCode, message, details)
    this.name = 'APIError'
  }
}

class TimeoutError extends AIServiceError {
  constructor(service: string) {
    super('TIMEOUT_ERROR', 504, `${service} request timed out`)
    this.name = 'TimeoutError'
  }
}

// ===== LOGGER =====
class Logger {
  private timers = new Map<string, number>()

  debug(action: string, message: string, metadata?: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'debug', action, message, metadata, timestamp: new Date().toISOString() }))
  }

  info(action: string, message: string, metadata?: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'info', action, message, metadata, timestamp: new Date().toISOString() }))
  }

  warn(action: string, message: string, metadata?: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'warn', action, message, metadata, timestamp: new Date().toISOString() }))
  }

  error(action: string, message: string, metadata?: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'error', action, message, metadata, timestamp: new Date().toISOString() }))
  }

  startTimer(label: string) {
    this.timers.set(label, Date.now())
  }

  endTimer(label: string, action: string, metadata?: Record<string, unknown>) {
    const startTime = this.timers.get(label)
    if (startTime) {
      const duration = Date.now() - startTime
      this.info(action, `Completed in ${duration}ms`, { ...metadata, duration })
      this.timers.delete(label)
    }
  }
}

const logger = new Logger()

// ===== UTILITY FUNCTIONS =====
function extractJSON<T>(text: string, defaultValue?: T): T | null {
  try {
    return JSON.parse(text)
  } catch {
    const jsonMatch = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1])
    }
    const objectMatch = text.match(/\{[\s\S]*\}/)
    if (objectMatch) {
      return JSON.parse(objectMatch[0])
    }
    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0])
    }
    return defaultValue ?? null
  }
}

function extractPartialProfile(text: string): Record<string, unknown> | null {
  const marker = 'PARTIAL_PROFILE:'
  const idx = text.indexOf(marker)
  if (idx === -1) return null

  const jsonStart = idx + marker.length
  const jsonEnd = text.indexOf('\n', jsonStart)
  const jsonStr = text.substring(jsonStart, jsonEnd === -1 ? undefined : jsonEnd).trim()

  try {
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}

function extractProfileComplete(text: string): {
  reply: string
  profile: Record<string, unknown> | null
} {
  const marker = 'PROFILE_COMPLETE:'
  const idx = text.indexOf(marker)

  if (idx === -1) {
    return { reply: text, profile: null }
  }

  const reply = text.substring(0, idx).trim()
  const jsonStart = idx + marker.length
  const jsonEnd = text.indexOf('\n', jsonStart)
  const jsonStr = text.substring(jsonStart, jsonEnd === -1 ? undefined : jsonEnd).trim()

  try {
    const profile = JSON.parse(jsonStr)
    return { reply, profile }
  } catch {
    return { reply, profile: null }
  }
}

function extractProfileFields(text: string): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {}

  const patterns: Record<string, RegExp> = {
    displayName: /(?:name|full name):\s*([^\n.]+)/i,
    email: /(?:email):\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
    phone: /(?:phone|mobile):\s*(\+?[\d\s-()]+)/i,
    currentDegree: /(?:degree|studying|pursuing):\s*([^\n.]+)/i,
    institution: /(?:university|institution|college):\s*([^\n.]+)/i,
    yearOfStudy: /(?:year of study|year):\s*([^\n.,]+)/i,
    city: /(?:city|location|based in):\s*([^\n.]+)/i,
    preferredIndustries: /(?:interested in|industries?|sectors?):\s*([^\n.]+)/i,
    careerGoals: /(?:goals?|career goals|aspiring to):\s*([^\n.]+)/i,
    portfolioUrl: /(?:portfolio|website|github):\s*(https?:\/\/[^\s\n]+)/i,
  }

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern)
    if (match) {
      const value = match[1].trim()
      if (key === 'preferredIndustries') {
        fields[key] = value.split(',').map((s) => s.trim())
      } else {
        fields[key] = value
      }
    }
  }

  // Fallback: catch natural-language year mentions like "4th year student", "final year", "second year"
  if (!fields.yearOfStudy) {
    const yearMatch = text.match(
      /\b((?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|final|last|graduating)\s*year(?:\s+student)?)\b/i
    )
    if (yearMatch) {
      fields.yearOfStudy = yearMatch[1].trim()
    }
  }

  return fields
}

function cleanMarkdown(text: string): string {
  return (
    text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .replace(/^#+\s+/gm, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\n\n+/g, '\n\n')
      .trim()
  )
}

function buildStudentProfileString(profile: any): string {
  const parts: string[] = []
  if (profile.displayName) parts.push(`Name: ${profile.displayName}`)
  if (profile.currentDegree) parts.push(`Degree: ${profile.currentDegree}`)
  if (profile.institution) parts.push(`Institution: ${profile.institution}`)
  if (profile.yearOfStudy) parts.push(`Year of Study: ${profile.yearOfStudy}`)
  if (profile.city) parts.push(`City: ${profile.city}`)
  if (profile.preferredIndustries?.length)
    parts.push(`Industries: ${profile.preferredIndustries.join(', ')}`)
  if (profile.careerGoals) parts.push(`Goals: ${profile.careerGoals}`)
  if (profile.profileFields?.length) {
    const jobs = profile.profileFields.filter((f: any) => f.category === 'job')
    const skills = profile.profileFields.filter((f: any) => f.category === 'skill')
    if (jobs.length) parts.push(`Experience: ${jobs.map((j: any) => j.value).join('; ')}`)
    if (skills.length) parts.push(`Skills: ${skills.map((s: any) => s.value).join(', ')}`)
  }
  return parts.join('\n')
}

function buildDocumentContextString(documents: any[]): string {
  if (!documents.length) return ''
  return documents
    .map((doc) => `[${doc.name}]\n${doc.extractedText.slice(0, 2000)}`)
    .join('\n\n---\n\n')
}

function getZambianContextParagraph(): string {
  return `You are providing advice in the Zambian context. Consider:
- Major Zambian universities: UNZA, CBU, Mulungushi University
- Professional bodies: EIZ, ZICA, ICTAZ, LAZ
- Industries: Mining, Agriculture, Energy, Finance, Telecom, Healthcare
- Job types: Industrial Attachment, Internship, Graduate Programme
- Languages: English, Nyanja, Bemba, Tonga, Lozi
- Relevant qualifications: TEVETA certifications, professional certifications

Mention Zambian-specific context when relevant and use local terminology.`
}

/** Levenshtein edit distance for fuzzy matching */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const prev = new Array(n + 1)
  const curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]
  }
  return prev[n]
}

function normalizeLocation(location: string): string {
  if (!location || !location.trim()) return ''
  const trimmed = location.trim()
  
  // If it's just a country name without city, append common city
  const countryNames = ['zambia', 'zimbabwe', 'botswana', 'malawi', 'tanzania', 'kenya', 'uganda', 'south africa']
  const isCountryOnly = countryNames.some(c => trimmed.toLowerCase() === c)
  if (isCountryOnly) {
    return trimmed.includes('Zambia') || trimmed.toLowerCase() === 'zambia' 
      ? 'Lusaka, Zambia' 
      : trimmed
  }
  
  // If location doesn't have a country, add Zambia for context
  const zambianCities = [
    'lusaka', 'kitwe', 'ndola', 'livingstone', 'kabwe', 'chingola',
    'copperbelt', 'northern province'
  ]
  const isZambian = zambianCities.some((city) => trimmed.toLowerCase().includes(city))
  if (isZambian && !trimmed.includes(',')) {
    return `${trimmed}, Zambia`
  }
  
  return trimmed
}

// ===== FILE PARSING UTILITIES =====
function isBase64(str: string): boolean {
  if (!str || str.length < 8) return false
  // Base64 strings only contain A-Z a-z 0-9 + / = characters
  // A plain text document will contain spaces, newlines, punctuation etc.
  const cleaned = str.replace(/[\r\n\s]/g, '')
  if (cleaned.length < 8) return false
  const base64Chars = /^[A-Za-z0-9+/]+=*$/
  return base64Chars.test(cleaned)
}

// Use Gemini multimodal (inline_data) to extract text from any file type.
// This avoids native PDF/DOCX parsers that are unreliable in Deno.
async function extractTextViaGemini(base64Content: string, contentType: string): Promise<string> {
  // Collect keys and models to try — key pool enables round-robin across Gemini accounts
  // NOTE: getGeminiKeysForRequest is defined after the CONFIGURATION section but this
  // function is only ever called at request time (after module init), so it is safe.
  const keysToTry = GEMINI_KEY_POOL.length > 0
    ? await getGeminiKeysForRequest()
    : (GEMINI_API_KEY ? [GEMINI_API_KEY] : [])

  if (keysToTry.length === 0) return ''

  const visionModels = [MODELS.generation.primary, MODELS.generation.fallback]

  for (const apiKey of keysToTry) {
    for (const model of visionModels) {
      try {
        const url = `${API_ENDPOINTS.gemini}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 45000)
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                {
                  inline_data: {
                    mime_type: contentType || 'application/octet-stream',
                    data: base64Content,
                  },
                },
                {
                  text: 'Extract ALL text from this document exactly as written. Return only the raw extracted text content with no commentary, headings, or formatting markers.',
                },
              ],
            }],
            generationConfig: { temperature: 0, maxOutputTokens: 8192 },
          }),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        if (res.ok) {
          const data = extractJSON<any>(await res.text())
          const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
          if (text.trim()) {
            logger.info('file-parsing', `Extracted via Gemini multimodal (${model})`, { contentType, size: text.length })
            return text
          }
        } else if (res.status === 429) {
          logger.warn('file-parsing', `Gemini multimodal key[…] ${model} rate-limited (429), trying next`)
          await new Promise(r => setTimeout(r, 1000))
          // break inner loop to try the next key
          break
        } else {
          logger.warn('file-parsing', `Gemini multimodal ${model} returned ${res.status}`)
        }
      } catch (err: any) {
        logger.warn('file-parsing', `Gemini multimodal ${model} failed: ${err.message}`)
      }
    }
  }
  return ''
}

async function extractTextFromFile(
  base64Content: string,
  contentType: string
): Promise<string> {
  try {
    logger.info('file-parsing', 'Starting extraction', { contentType })

    // ── Plain text — decode directly, no AI needed ──────────────────────────
    if (contentType.startsWith('text/')) {
      try {
        const fileBytes = decodeBase64(base64Content)
        const text = new TextDecoder('utf-8', { fatal: false }).decode(fileBytes)
        logger.info('file-parsing', 'Text decoded directly', { size: text.length })
        if (text.trim()) return text
      } catch (err: any) {
        logger.warn('file-parsing', `Text decoding failed: ${err.message}`)
      }
    }

    // ── DOCX — try mammoth first (pure JS, reliable in Deno) ────────────────
    if (
      contentType.includes('wordprocessingml') ||
      contentType === 'application/msword' ||
      contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      try {
        const fileBytes = decodeBase64(base64Content)
        const result = await mammoth.extractRawText({ arrayBuffer: fileBytes.buffer })
        if (result.value?.trim()) {
          logger.info('file-parsing', 'DOCX extracted via mammoth', { size: result.value.length })
          return result.value
        }
      } catch (err: any) {
        logger.warn('file-parsing', `mammoth failed: ${err.message}, trying Gemini multimodal`)
      }
    }

    // ── PDF, images, and everything else — use Gemini multimodal ────────────
    // Gemini natively understands PDF, JPEG, PNG, GIF, WebP, DOCX, and more.
    const geminiText = await extractTextViaGemini(base64Content, contentType)
    if (geminiText) return geminiText

    // ── Last resort: attempt raw UTF-8 decode (catches .txt/.rtf/etc.) ──────
    try {
      const fileBytes = decodeBase64(base64Content)
      const raw = new TextDecoder('utf-8', { fatal: false }).decode(fileBytes)
      // Strip non-printable control characters; keep newlines/tabs
      const readable = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim()
      if (readable.length > 50) {
        logger.info('file-parsing', 'Raw text fallback succeeded', { size: readable.length })
        return readable
      }
    } catch { /* ignore */ }

    logger.warn('file-parsing', `Could not extract text from: ${contentType}`)
    return ''
  } catch (err: any) {
    logger.error('file-parsing', `Extraction failed: ${err.message}`)
    return ''
  }
}

// ===== CONFIGURATION =====
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
// Sanitize CSE ID: strip HTML tags and keep only the CX value
const rawCse = Deno.env.get('GOOGLE_CSE_ID') ?? ''
const GOOGLE_CSE_ID = (() => {
  // If it looks like HTML, extract the cx=... part
  const cxMatch = rawCse.match(/cx=([a-zA-Z0-9_-]+)/)
  if (cxMatch) return cxMatch[1]
  // Otherwise strip non-alphanumeric and return if > 8 chars
  const cleaned = rawCse.replace(/[^a-zA-Z0-9_-]/g, '')
  return cleaned.length > 8 ? cleaned : ''
})()

// ===== MULTI-KEY ROUND-ROBIN POOLS =====
// Each service supports up to 4 keys named SERVICE_NAME_1 … SERVICE_NAME_4.
// Falls back to the plain SERVICE_NAME for single-key setups.
// Round-robin counter resets on cold start — good enough for secondary APIs;
// Gemini uses KV-backed rotation (further below) for precise distribution.
function buildPool(baseName: string, max = 4): string[] {
  const pool: string[] = []
  for (let i = 1; i <= max; i++) {
    const k = Deno.env.get(`${baseName}_${i}`) ?? ''
    if (k) pool.push(k)
  }
  if (pool.length === 0) {
    const single = Deno.env.get(baseName) ?? ''
    if (single) pool.push(single)
  }
  return pool
}

const GROQ_KEY_POOL      = buildPool('GROQ_API_KEY')
const GOOGLE_KEY_POOL    = buildPool('GOOGLE_API_KEY')
const TAVILY_KEY_POOL    = buildPool('TAVILY_API_KEY')
const PREDICTHQ_KEY_POOL = buildPool('PREDICTHQ_API_KEY')
const LOCATIONIQ_KEY_POOL = buildPool('LOCATIONIQ_API_KEY')

const _rrCounters: Record<string, number> = {}
function pickKey(name: string, pool: string[]): string {
  if (pool.length === 0) return ''
  if (pool.length === 1) return pool[0]
  const idx = (_rrCounters[name] ?? 0) % pool.length
  _rrCounters[name] = idx + 1
  return pool[idx]
}

function getGroqKey():         string { return pickKey('groq',       GROQ_KEY_POOL) }
function getGoogleApiKey():    string { return pickKey('google',     GOOGLE_KEY_POOL) }
function getTavilyKey():       string { return pickKey('tavily',     TAVILY_KEY_POOL) }
function getPredictHQToken():  string { return pickKey('predicthq',  PREDICTHQ_KEY_POOL) }
function getLocationIQToken(): string { return pickKey('locationiq', LOCATIONIQ_KEY_POOL) }

// ===== GEMINI KEY POOL (round-robin rotation) =====
// Set GEMINI_API_KEY_1, GEMINI_API_KEY_2, … in Supabase secrets to spread
// requests across multiple API keys and avoid per-key rate limits.
// Falls back to the bare GEMINI_API_KEY for single-key deployments.
const GEMINI_KEY_POOL: string[] = (() => {
  const pool: string[] = []
  for (let i = 1; i <= 20; i++) {
    const k = Deno.env.get(`GEMINI_API_KEY_${i}`) ?? ''
    if (k) pool.push(k)
  }
  // No numbered keys found — fall back to the legacy single key
  if (pool.length === 0 && GEMINI_API_KEY) pool.push(GEMINI_API_KEY)
  return pool
})()

// Lazy Deno KV handle — persists round-robin index across edge-function invocations
let _kv: Deno.Kv | null = null
async function getKv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv()
  return _kv
}
const KV_GEMINI_IDX = ['gemini_rr_index']

/**
 * Returns the full Gemini key pool ordered starting from the current round-robin
 * position, advancing the persistent index by one so the next request starts on a
 * different key.  Caller should iterate the returned array on 429 to try other keys.
 */
async function getGeminiKeysForRequest(): Promise<string[]> {
  if (GEMINI_KEY_POOL.length === 0) return GEMINI_API_KEY ? [GEMINI_API_KEY] : []
  if (GEMINI_KEY_POOL.length === 1) return [GEMINI_KEY_POOL[0]]

  let startIdx = 0
  try {
    const kv = await getKv()
    for (let attempt = 0; attempt < 5; attempt++) {
      const entry = await kv.get<number>(KV_GEMINI_IDX)
      startIdx = (entry.value ?? 0) % GEMINI_KEY_POOL.length
      const next = (startIdx + 1) % GEMINI_KEY_POOL.length
      const { ok } = await kv.atomic().check(entry).set(KV_GEMINI_IDX, next).commit()
      if (ok) break
    }
  } catch {
    // KV unavailable — start from index 0, key pool still works
  }

  const keys: string[] = []
  for (let i = 0; i < GEMINI_KEY_POOL.length; i++) {
    keys.push(GEMINI_KEY_POOL[(startIdx + i) % GEMINI_KEY_POOL.length])
  }
  return keys
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ===== FREE PROVIDER: GROQ (llama-3.3-70b-versatile — free tier) =====
async function callGroq(
  systemPrompt: string,
  userMessage: string
): Promise<{ reply: string; model: string; isComplete: boolean }> {
  if (!GROQ_KEY_POOL.length) throw new APIError('No GROQ_API_KEY configured — add GROQ_API_KEY_1…4 to Supabase secrets')
  if (!userMessage?.trim()) throw new ValidationError('Empty user message')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 55000)

  try {
    const res = await fetch(API_ENDPOINTS.groq, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getGroqKey()}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 4096,
        temperature: 0.7,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new APIError(`Groq returned ${res.status}: ${errText.slice(0, 200)}`, res.status)
    }

    const data = await res.json()
    const reply: string = data?.choices?.[0]?.message?.content ?? ''
    if (!reply.trim()) throw new APIError('Groq returned empty response')

    logger.info('groq', 'Groq response received successfully')
    return { reply: reply.trim(), model: 'groq:llama-3.3-70b-versatile', isComplete: false }
  } catch (err: any) {
    clearTimeout(timeoutId)
    throw err.name === 'AbortError' ? new TimeoutError('groq') : err
  }
}

// ===== GROQ WITH CONVERSATION HISTORY =====
async function callGroqWithHistory(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<{ reply: string; model: string; isComplete: boolean }> {
  if (!messages.length) throw new ValidationError('Empty messages')

  // ── Primary: Groq ──
  if (GROQ_KEY_POOL.length > 0) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 55000)
    try {
      const res = await fetch(API_ENDPOINTS.groq, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getGroqKey()}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          max_tokens: 1024,
          temperature: 0.7,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (res.ok) {
        const data = await res.json()
        const reply: string = data?.choices?.[0]?.message?.content ?? ''
        if (reply.trim()) {
          return { reply: reply.trim(), model: 'groq:llama-3.3-70b-versatile', isComplete: false }
        }
        logger.warn('groq-history', 'Groq returned empty response — falling back to Gemini')
      } else {
        const errText = await res.text().catch(() => '')
        logger.warn('groq-history', `Groq returned ${res.status} — falling back to Gemini: ${errText.slice(0, 100)}`)
      }
    } catch (err: any) {
      clearTimeout(timeoutId)
      logger.warn('groq-history', `Groq error — falling back to Gemini: ${err.message}`)
    }
  } else {
    logger.info('groq-history', 'No Groq keys configured — trying Gemini directly')
  }

  // ── Fallback: Gemini key pool with multi-turn history ──
  // Gemini uses "model" for assistant turns; map accordingly.
  const geminiKeys = await getGeminiKeysForRequest()
  if (geminiKeys.length === 0) {
    throw new APIError('No AI provider available. Add GROQ_API_KEY and/or GEMINI_API_KEY to Supabase secrets.')
  }

  const geminiContents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const genModels = [MODELS.generation.primary, MODELS.generation.fallback]
  let lastErr = ''

  for (const apiKey of geminiKeys) {
    for (const model of genModels) {
      try {
        const url = `${API_ENDPOINTS.gemini}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.gemini)
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: geminiContents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
          }),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        if (res.ok) {
          const data = extractJSON<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(await res.text())
          const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
          if (reply.trim()) {
            logger.info('gemini-history', `Responded with ${model}`)
            return { reply: reply.trim(), model, isComplete: true }
          }
          lastErr = `${model} empty response`
        } else if (res.status === 429) {
          lastErr = `${model} 429`
          logger.warn('gemini-history', `${model} rate-limited — trying next key`)
          break // try next key
        } else {
          lastErr = `${model} ${res.status}`
          logger.warn('gemini-history', lastErr)
        }
      } catch (err: any) {
        lastErr = err.message
        logger.warn('gemini-history', `${model} error: ${err.message}`)
      }
    }
  }

  throw new APIError(`All AI providers failed for conversation. Last error: ${lastErr}`)
}

// ===== FREE WEB READER: JINA AI (r.jina.ai — no API key needed) =====
// Converts any public URL into clean, readable markdown text.
async function jinaRead(url: string, timeoutMs = 20000): Promise<string> {
  try {
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(`${API_ENDPOINTS.jina}/${url}`, {
      headers: { 'Accept': 'text/plain', 'X-No-Cache': 'true' },
      signal: controller.signal,
    })
    clearTimeout(tid)
    return res.ok ? await res.text() : ''
  } catch {
    return ''
  }
}

// ===== TEXT GENERATION WITH FALLBACK =====
// Priority: Gemini (if key set) → Groq (if key set) → error
async function callGeminiWithFallback(
  systemPrompt: string,
  userMessage: string,
  context?: { profile?: any; documents?: any[] }
): Promise<{ reply: string; model: string; isComplete: boolean }> {
  logger.startTimer('gemini-call')

  if (!userMessage?.trim()) {
    throw new ValidationError('Empty user message')
  }

  let enrichedPrompt = systemPrompt
  if (context?.profile) {
    enrichedPrompt += '\n\n' + buildStudentProfileString(context.profile)
  }
  if (context?.documents) {
    enrichedPrompt += '\n\nDocument Context:\n' + buildDocumentContextString(context.documents)
  }
  enrichedPrompt += '\n\n' + getZambianContextParagraph()

  let lastGeminiError: AIServiceError | null = null

  // ── Try Gemini key pool (round-robin across GEMINI_API_KEY_1 … GEMINI_API_KEY_N) ──
  // getGeminiKeysForRequest() advances the persistent KV index so each request starts
  // on a different key, distributing load. On 429 we move to the next key immediately
  // instead of sleeping — this keeps p99 latency low when keys are rate-limited.
  const geminiKeys = await getGeminiKeysForRequest()

  if (geminiKeys.length > 0) {
    const models = [MODELS.generation.primary, MODELS.generation.fallback]

    for (const apiKey of geminiKeys) {
      let keyRateLimited = true

      for (const model of models) {
        try {
          logger.info('gemini-text', `Attempting with ${model}`)

          const url = `${API_ENDPOINTS.gemini}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.gemini)

          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: enrichedPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userMessage }] }],
                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: 2048,
                },
              }),
              signal: controller.signal,
            })

            clearTimeout(timeoutId)
            const text = await res.text().catch(() => '')

            if (!res.ok) {
              if (res.status !== 429) keyRateLimited = false
              if (res.status === 429) {
                logger.warn('gemini-text', `${model} rate limited (429) — trying next key`)
              }
              lastGeminiError = new APIError(
                `${model} returned ${res.status}`,
                res.status,
                { response: text.slice(0, 200) }
              )
              logger.warn('gemini-text', `${model} failed: ${res.status}`, { error: lastGeminiError.message })
              continue
            }

            const data = extractJSON<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(text)
            const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

            if (!reply?.trim()) {
              lastGeminiError = new APIError(`${model} returned empty response`)
              logger.warn('gemini-text', `${model} empty response`)
              keyRateLimited = false
              continue
            }

            logger.endTimer('gemini-call', 'gemini-text', { model, success: true })
            return { reply: reply.trim(), model, isComplete: true }
          } catch (err: any) {
            clearTimeout(timeoutId)
            keyRateLimited = false
            if (err.name === 'AbortError') {
              lastGeminiError = new TimeoutError(model)
            } else {
              lastGeminiError = new APIError(err.message)
            }
            logger.error('gemini-text', `${model} error`, { error: err.message })
          }
        } catch (err: any) {
          keyRateLimited = false
          lastGeminiError = new APIError(err.message)
        }
      }

      if (keyRateLimited) {
        // All models on this key are rate-limited — move to next key immediately
        logger.warn('gemini-text', `Key exhausted (429 on all models), rotating to next key in pool`)
        continue
      }
    }

    logger.warn('gemini-text', `All ${geminiKeys.length} Gemini key(s) failed, falling back to Groq`)
  } else {
    logger.info('ai-fallback', 'No Gemini keys configured, trying Groq directly')
  }

  // ── Fallback: Groq (free tier, llama-3.3-70b-versatile) ──
  if (GROQ_KEY_POOL.length > 0) {
    try {
      const result = await callGroq(enrichedPrompt, userMessage)
      logger.endTimer('gemini-call', 'groq-fallback', { success: true })
      return result
    } catch (groqErr: any) {
      logger.error('groq', `Groq fallback failed: ${groqErr.message}`)
    }
  }

  const detail = GEMINI_KEY_POOL.length === 0 && !GROQ_KEY_POOL.length
    ? 'No AI provider configured. Add GEMINI_API_KEY_1…4 and/or GROQ_API_KEY_1…4 to Supabase Edge Function secrets.'
    : `All AI providers failed. Gemini pool: ${GEMINI_KEY_POOL.length} keys. Groq pool: ${GROQ_KEY_POOL.length} keys. Last Gemini error: ${lastGeminiError?.message ?? 'none'}`
  throw new APIError(detail)
}

// ===== EMBEDDINGS WITH FALLBACK =====
async function getEmbeddingWithFallback(text: string): Promise<{ embedding: number[]; model: string; dimensions: number }> {
  if (!GEMINI_API_KEY) throw new ValidationError('Missing GEMINI_API_KEY secret')
  if (!text?.trim()) throw new ValidationError('Empty text for embedding')

  const models = [MODELS.embedding.primary, MODELS.embedding.fallback]
  let lastError = ''

  for (const model of models) {
    try {
      logger.info('embedding', `Attempting with ${model}`)

      const url = `${API_ENDPOINTS.gemini}/${model}:embedContent?key=${encodeURIComponent(GEMINI_API_KEY)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text }] },
        }),
      })

      const responseText = await res.text().catch(() => '')

      if (!res.ok) {
        lastError = `${model} ${res.status}: ${responseText.slice(0, 300)}`
        logger.warn('embedding', `Failed with ${model}`, { status: res.status })
        continue
      }

      const data = extractJSON<{ embedding?: { values?: number[] } }>(responseText)
      const embedding = data?.embedding?.values ?? []

      if (!Array.isArray(embedding) || embedding.length === 0) {
        lastError = `${model} returned invalid embedding`
        logger.warn('embedding', lastError)
        continue
      }

      logger.info('embedding', `Success with ${model} (${embedding.length} dimensions)`)
      return {
        embedding,
        model,
        dimensions: embedding.length,
      }
    } catch (err: any) {
      lastError = err.message
      logger.error('embedding', `Error with ${model}`, { error: err.message })
    }
  }

  throw new APIError(`All embedding models failed. Last error: ${lastError}`)
}

// ===== HANDLERS: PROFILE CHAT =====
async function handleProfileChat(body: any): Promise<Response> {
  try {
    // ===== STRICT INPUT VALIDATION =====
    const messages = Array.isArray(body.messages) ? body.messages : []
    const userMessage = (body.message ?? (messages[messages.length - 1]?.content ?? '')).toString().trim()
    const isInitialGreeting = !userMessage && messages.length === 0

    // Allow empty-message initial greeting calls (onboarding screen requests opening question)
    if (!userMessage && !isInitialGreeting) {
      return json({ error: 'No user message provided' }, 400)
    }

    if (userMessage.length > 5000) {
      return json({ error: 'Message too long (max 5000 characters)' }, 400)
    }

    // Safely parse existing profile
    let existingProfile: Record<string, any> = {}
    try {
      if (body.existingProfile && typeof body.existingProfile === 'object') {
        existingProfile = {
          displayName: body.existingProfile.displayName?.toString() || '',
          email: body.existingProfile.email?.toString() || '',
          currentDegree: body.existingProfile.currentDegree?.toString() || '',
          institution: body.existingProfile.institution?.toString() || '',
          yearOfStudy: body.existingProfile.yearOfStudy?.toString() || '',
          city: body.existingProfile.city?.toString() || '',
          careerGoals: body.existingProfile.careerGoals?.toString() || '',
          preferredIndustries: Array.isArray(body.existingProfile.preferredIndustries)
            ? body.existingProfile.preferredIndustries.map((i: any) => i?.toString()).filter(Boolean)
            : [],
        }
      }
    } catch (err: any) {
      logger.warn('profile-chat', `Error parsing profile: ${err.message}`)
      existingProfile = {}
    }

    // Safely truncate CV content to prevent token limit issues
    let cvContent = ''
    try {
      if (body.cvContent && typeof body.cvContent === 'string') {
        cvContent = body.cvContent.trim().slice(0, 1500) // Reduced from 2000
      }
    } catch (err: any) {
      logger.warn('profile-chat', `Error processing CV content: ${err.message}`)
      cvContent = ''
    }

    const exchangeCount = Math.floor(messages.length / 2) + 1
    const hasCv = !!cvContent
    const hasPartialProfile = Object.keys(existingProfile).some((k) => existingProfile[k])
    const hasName = !!existingProfile.displayName

    // ===== BUILD SYSTEM PROMPT =====
    let openingStrategy = ''
    try {
      if (hasCv && exchangeCount === 1) {
        openingStrategy = `CV UPLOADED: Read this CV carefully, then greet warmly and mention something specific you learned from it. Ask ONE follow-up question about something missing or to dig deeper.`
      } else if (hasPartialProfile && exchangeCount === 1) {
        const safeName = (existingProfile.displayName ?? 'there').toString().slice(0, 50)
        const safeDegree = (existingProfile.currentDegree ?? '').toString().slice(0, 50)
        const safeInstitution = (existingProfile.institution ?? '').toString().slice(0, 50)
        openingStrategy = `PARTIAL PROFILE EXISTS: You already know their name "${safeName}"${safeDegree ? `, degree "${safeDegree}"` : ''}${safeInstitution ? `, institution "${safeInstitution}"` : ''}. Skip these topics. Greet warmly and ask ONE focused question about important missing info.`
      } else if (exchangeCount === 1) {
        openingStrategy = `NEW CONVERSATION: Introduce yourself warmly and ask for their full name as the first question.`
      } else {
        openingStrategy = `CONTINUE CONVERSATION: Exchange #${exchangeCount}. Keep deepening the conversation. Ask ONE follow-up question that builds directly on their last answer.`
      }
    } catch (err: any) {
      logger.warn('profile-chat', `Error building strategy: ${err.message}`)
      openingStrategy = 'CONTINUE CONVERSATION: Keep asking follow-up questions.'
    }

    const systemPrompt = `You are Career Compass AI, a warm, deeply curious career advisor building comprehensive student profiles.

YOUR CORE MISSION:
Build the most complete picture of this person's background, skills, experience, and aspirations through natural conversation.

OPENING STRATEGY FOR THIS EXCHANGE:
${openingStrategy}

CRITICAL CONVERSATION RULES (FOLLOW THESE STRICTLY):
1. ONE QUESTION PER TURN - Never ask multiple questions.
2. NEVER NUMBER QUESTIONS - Don't write "1) Question? 2) Question?" - that's robotic. Write naturally.
3. BUILD ON THEIR ANSWERS - Always reference what they just said.
4. DEEP FOLLOW-UPS - If they give short answers, dig deeper.
5. WARM AND ENCOURAGING - Sound human. Use their name naturally. Show genuine interest.
6. EXTRACT SPECIFIC DETAILS - When they mention a skill, ask for proof of it.
7. NEVER WRAP UP EARLY - Keep going indefinitely. The profile is never "complete" until the user explicitly says so.
8. USE ZAMBIAN CONTEXT - Know about UNZA, CBU, EIZ, ZICA, ICTAZ, TEVETA.
9. ASK ABOUT EVERYTHING - Dig into: name, degree, institution, year, city, skills, projects, work experience, languages, extracurriculars, awards, goals, passions.
10. LISTEN AND REMEMBER - Reference specific things they've told you earlier.

RESPONSE FORMAT:
Write your warm, conversational message normally. At the END, always append a PARTIAL_PROFILE block with EVERY field you have learned so far:
PARTIAL_PROFILE: { "displayName": "full name if mentioned", "currentDegree": "degree if mentioned", "institution": "university/college if mentioned", "yearOfStudy": "e.g. 4th year, final year, 2nd year — capture from ANY mention", "city": "city/location if mentioned", "skills": "comma-separated skills mentioned", "careerGoals": "goals/aspirations if mentioned", "preferredIndustries": ["industry1", "industry2"], "portfolioUrl": "URL if mentioned", "profileFields": [{"label": "Any extra detail the user shared", "value": "the value"}] }

IMPORTANT for yearOfStudy: capture it from ANY phrasing — "I'm a 4th year student", "in my final year", "second year at UNZA", "graduating this year" etc.

IMPORTANT for profileFields: use this array to capture ANYTHING the user shares that doesn't fit a standard field — languages spoken, GPA, awards, clubs, projects, work history, hobbies, etc. Be generous. The more the better.

If conversation is very deep (18+ exchanges), instead add:
PROFILE_COMPLETE: { "displayName": "...", "email": "...", "currentDegree": "...", "institution": "...", "yearOfStudy": "...", "city": "...", "careerGoals": "...", "preferredIndustries": [...], "phone": "...", "skills": "...", "profileFields": [{"label": "...", "value": "..."}] }

Default to PARTIAL_PROFILE. Keep conversations going.${
      hasCv
        ? `\n\nCV SUMMARY (for context only):\n${cvContent}\n\nDo NOT ask questions the CV already answers. Instead, ask for deeper context or clarification.`
        : ''
    }${
      hasPartialProfile
        ? `\n\nEXISTING PROFILE DATA:\n${buildStudentProfileString(existingProfile)}\n\nDo NOT re-ask fields they've already provided. Build on what you know.`
        : ''
    }`

    // ===== CALL GEMINI API =====
    let result: { reply: string; model: string; isComplete: boolean }
    try {
      result = await callGeminiWithFallback(systemPrompt, userMessage || 'begin', {
        profile: existingProfile,
        documents: cvContent ? [{ name: 'CV', extractedText: cvContent }] : undefined,
      })
    } catch (apiError: any) {
      logger.error('profile-chat', `Gemini API error: ${apiError.message}`)
      // Return more helpful error messages for API issues
      if (apiError.message?.includes('quota') || apiError.message?.includes('high demand')) {
        return json(
          { error: 'AI service temporarily busy. Please try again in a moment.' },
          503
        )
      }
      throw apiError
    }

    // ===== EXTRACT PROFILE DATA =====
    let cleanedReply = result.reply
    let completeProfile = null
    try {
      const extracted = extractProfileComplete(result.reply)
      cleanedReply = extracted.reply
      completeProfile = extracted.profile
    } catch (err: any) {
      logger.warn('profile-chat', `Error extracting complete profile: ${err.message}`)
    }

    let partialProfile: Record<string, any> = {}
    try {
      partialProfile =
        extractPartialProfile(result.reply) ||
        extractProfileFields(cleanedReply) ||
        {}
    } catch (err: any) {
      logger.warn('profile-chat', `Error extracting partial profile: ${err.message}`)
    }

    const response = {
      reply: cleanMarkdown(cleanedReply),
      isComplete: !!completeProfile,
      model: result.model,
      profileData: completeProfile || existingProfile || {},
      partialProfile: partialProfile || {},
    }

    logger.info('profile-chat', 'Response generated successfully', {
      exchange: exchangeCount,
      isComplete: response.isComplete,
      hasCv,
      hasProfile: hasPartialProfile,
    })

    return json(response, 200)
  } catch (error: any) {
    const errorMessage = error?.message || 'Failed to generate response'
    const statusCode = error?.statusCode || 500

    logger.error('profile-chat', errorMessage, {
      code: error?.code,
      details: error?.details,
    })

    return json(
      {
        error: errorMessage,
        code: error?.code,
      },
      statusCode
    )
  }
}

// ===== HANDLERS: HYBRID CHAT =====
async function handleHybridChat(body: any): Promise<Response> {
  const messages = body.messages ?? []
  const userMessage =
    body.message ??
    [...messages].reverse().find((m: any) => m.role === 'user')?.content ??
    messages[messages.length - 1]?.content ??
    ''

  if (!userMessage?.trim()) {
    return json(
      {
        error: 'No user message provided',
        status: 'failed',
      },
      400
    )
  }

  const response: any = {
    status: 'failed',
    errors: {},
  }

  const systemPrompt = `You are Career Compass AI, a professional career advisor.
Provide helpful, actionable, personalized advice on job search, interviews, career development, and networking.
Be encouraging and professional.`

  try {
    const textResult = await callGeminiWithFallback(systemPrompt, userMessage)
    response.reply = textResult.reply
    response.text_model = textResult.model
  } catch (err: any) {
    logger.error('hybrid-chat', `Text generation failed: ${err.message}`)
    response.errors!.text_generation = err.message
  }

  try {
    const embeddingResult = await getEmbeddingWithFallback(userMessage)
    response.embedding = embeddingResult.embedding
    response.embedding_model = embeddingResult.model
  } catch (err: any) {
    logger.error('hybrid-chat', `Embedding failed: ${err.message}`)
    response.errors!.embedding = err.message
  }

  if (response.reply && response.embedding) {
    response.status = 'full'
  } else if (response.reply) {
    response.status = 'text_only'
  } else if (response.embedding) {
    response.status = 'embedding_only'
  } else {
    response.status = 'failed'
  }

  if (response.status === 'failed') {
    return json(response, 500)
  }

  return json(response, 200)
}

// ===== HANDLERS: EMBEDDINGS =====
async function handleEmbedding(body: any): Promise<Response> {
  const text = body.text ?? ''

  if (!text?.trim()) {
    return json({ error: 'No text provided for embedding' }, 400)
  }

  try {
    const result = await getEmbeddingWithFallback(text)
    return json({
      embedding: result.embedding,
      model: result.model,
      dimensions: result.dimensions,
    })
  } catch (error: any) {
    logger.error('embedding', `Error: ${error.message}`)
    return json({ error: error?.message || 'Embedding failed' }, 500)
  }
}

// ===== HANDLERS: SIMILARITY SEARCH =====
async function handleSimilaritySearch(body: any): Promise<Response> {
  const query = body.query ?? ''
  const candidates = body.candidates ?? []

  if (!query?.trim()) {
    return json({ error: 'No query provided' }, 400)
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return json({ error: 'No candidates provided' }, 400)
  }

  try {
    const queryEmbedding = await getEmbeddingWithFallback(query)

    const candidateResults = await Promise.all(
      candidates.map(async (candidate: string) => {
        try {
          const embedding = await getEmbeddingWithFallback(candidate)
          return {
            text: candidate,
            embedding: embedding.embedding,
            error: null,
          }
        } catch (err: any) {
          return {
            text: candidate,
            embedding: null,
            error: err.message,
          }
        }
      })
    )

    function cosineSimilarity(a: number[], b: number[]): number {
      const dotProduct = a.reduce((sum, x, i) => sum + x * b[i], 0)
      const magnitudeA = Math.sqrt(a.reduce((sum, x) => sum + x * x, 0))
      const magnitudeB = Math.sqrt(b.reduce((sum, x) => sum + x * x, 0))
      return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0
    }

    const scores = candidateResults
      .map((result) => ({
        text: result.text,
        similarity: result.embedding ? cosineSimilarity(queryEmbedding.embedding, result.embedding) : -1,
        error: result.error,
      }))
      .filter((item) => item.similarity >= 0)
      .sort((a, b) => b.similarity - a.similarity)

    return json({
      query,
      query_model: queryEmbedding.model,
      results: scores.slice(0, 10),
      total_candidates: candidates.length,
      successfully_scored: scores.length,
    })
  } catch (error: any) {
    logger.error('similarity-search', `Error: ${error.message}`)
    return json({ error: error?.message || 'Similarity search failed' }, 500)
  }
}

// ===== HANDLERS: STAR FEEDBACK =====
async function handleStarFeedback(body: any): Promise<Response> {
  try {
    const { question, situation, task, actionTaken, result, companyContext, cvContent } = body

    if (!question?.trim() || !situation?.trim() || !task?.trim() || !actionTaken?.trim() || !result?.trim()) {
      throw new ValidationError('Missing STAR components')
    }

    const systemPrompt = `You are an experienced HR interview coach. Evaluate STAR-format interview answers.

EVALUATION DIMENSIONS:
1. Clarity - Is the story easy to follow?
2. Relevance - Does it directly answer the question?
3. Specificity - Concrete details, numbers, outcomes?
4. Action Ownership - Did they take action?
5. Result Impact - What was the measurable outcome?
6. Learning - Does it show growth?

FEEDBACK STRUCTURE:
- Opening impression (1-2 sentences)
- Strengths (2-3 specific positives)
- Areas for improvement (2-3 suggestions)
- Reframed answer (show how to improve)
- Score out of 10

Be encouraging but honest.

${companyContext ? `\n\nCompany Context:\n${companyContext}` : ''}
${cvContent ? `\n\nCandidate CV:\n${cvContent.slice(0, 1500)}` : ''}`

    const userMessage = `Interview Question: "${question}"

SITUATION: ${situation}
TASK: ${task}
ACTION: ${actionTaken}
RESULT: ${result}

Please evaluate this STAR answer with specific, actionable feedback.`

    const result_obj = await callGeminiWithFallback(systemPrompt, userMessage)

    const scoreMatch = result_obj.reply.match(/Score[:\s]*(\d+)\s*\/\s*10/i)
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 7

    const response = {
      feedback: cleanMarkdown(result_obj.reply),
      score: Math.min(10, Math.max(0, score)),
      model: result_obj.model,
    }

    logger.info('star-feedback', 'Feedback generated', { score: response.score })
    return json(response, 200)
  } catch (error: any) {
    logger.error('star-feedback', `Error: ${error.message}`)
    return json({ error: error?.message || 'Failed to evaluate STAR answer' }, 500)
  }
}

// ===== HANDLERS: INTERVIEW VERDICT =====
async function handleInterviewVerdict(body: any): Promise<Response> {
  try {
    const { companyName, interviewAnswers, companyResearch, cvContent } = body

    if (!companyName?.trim()) {
      throw new ValidationError('Company name is required')
    }

    if (!Array.isArray(interviewAnswers) || interviewAnswers.length === 0) {
      throw new ValidationError('No interview answers provided')
    }

    const qaTranscript = interviewAnswers
      .map((qa: any, i: number) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`)
      .join('\n\n')

    const systemPrompt = `You are a strict HR recruitment panel evaluating a mock interview at ${companyName}.

EVALUATION CRITERIA:
1. Relevance - Answers address questions
2. Depth - Specific examples
3. Communication - Clear, organized, confident
4. Technical Fit - Skills match
5. Cultural Fit - Company understanding
6. Potential - Can grow into role
7. Authenticity - Genuine vs rehearsed

VERDICT OPTIONS:
- accepted (overall_score 8-10): Impressive, strong hire
- shortlisted (overall_score 6-7): Good effort, needs improvement
- rejected (overall_score 1-5): Significant gaps

${companyResearch ? `\nCompany Profile:\n${companyResearch}` : ''}
${cvContent ? `\nCandidate CV:\n${cvContent.slice(0, 2000)}` : ''}

Return ONLY valid JSON in this exact structure — no markdown, no explanation:
{
  "verdict": "accepted|shortlisted|rejected",
  "overall_score": <number 1-10>,
  "overall_feedback": "<2-3 sentence overall assessment>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "top_improvements": ["<improvement 1>", "<improvement 2>", "<improvement 3>"],
  "recommendation": "<personalised 1-2 sentence recommendation>",
  "answer_feedback": [
    { "question": "<question text>", "answer": "<their answer>", "feedback": "<specific feedback>", "score": <1-10> }
  ]
}`

    const userMessage = `Evaluate these interview answers:\n\n${qaTranscript}\n\nReturn complete verdict as JSON.`

    const result = await callGeminiWithFallback(systemPrompt, userMessage)

    const verdictJSON = extractJSON<any>(result.reply, {})

    const verdictValue = (verdictJSON?.verdict ?? '').toLowerCase()
    const overallScore = verdictJSON?.overall_score ?? verdictJSON?.score ?? 6

    const answerFeedback = Array.isArray(verdictJSON?.answer_feedback)
      ? verdictJSON.answer_feedback.map((af: any) => ({
          question: af.question || '',
          answer:   af.answer   || '',
          feedback: af.feedback || af.weakness || af.improvement || '',
          score:    typeof af.score === 'number' ? af.score : 6,
        }))
      : interviewAnswers.map((qa: any) => ({
          question: qa.question,
          answer:   qa.answer,
          feedback: '',
          score:    6,
        }))

    const response = {
      verdict: ['accepted', 'shortlisted', 'rejected'].includes(verdictValue) ? verdictValue : 'shortlisted',
      overallScore: Math.min(10, Math.max(1, overallScore)),
      overallFeedback: verdictJSON?.overall_feedback || cleanMarkdown(result.reply).slice(0, 600),
      strengths: Array.isArray(verdictJSON?.strengths) ? verdictJSON.strengths : [],
      areasToImprove: Array.isArray(verdictJSON?.top_improvements) ? verdictJSON.top_improvements : [],
      answerFeedback,
      recommendation: verdictJSON?.recommendation ?? '',
      model: result.model,
    }

    logger.info('interview-verdict', 'Verdict generated', { verdict: response.verdict })
    return json(response, 200)
  } catch (error: any) {
    logger.error('interview-verdict', `Error: ${error.message}`)
    return json({ error: error?.message || 'Failed to evaluate interview' }, 500)
  }
}

// ===== HANDLERS: PARSE PROFILE FROM CV =====
async function handleParseProfileFromCv(body: any): Promise<Response> {
  try {
    const { cvContent } = body

    if (!cvContent?.trim()) {
      throw new ValidationError('CV content is required')
    }

    const systemPrompt = `You are an expert CV parser. Extract structured profile information from the CV below. Return ONLY valid JSON with no markdown, no explanation, no code fences.

{
  "displayName": "Full name exactly as written",
  "email": "email@example.com or null",
  "phone": "Phone number or null",
  "currentDegree": "Full degree title e.g. BSc Computer Science",
  "institution": "University or college name",
  "yearOfStudy": "e.g. Year 4 or 2022-2027",
  "city": "City, Country",
  "preferredIndustries": ["Mining", "Engineering"],
  "careerGoals": "Career objective or professional profile text",
  "portfolioUrl": "https://... or null",
  "profileFields": [
    { "label": "Technical Skills", "value": "MATLAB, Python, Arduino, SolidWorks" },
    { "label": "Project", "value": "Project name and description" },
    { "label": "Certification", "value": "Certification name" },
    { "label": "Leadership", "value": "Role and organization" },
    { "label": "Work Experience", "value": "Job title at Company (dates)" }
  ]
}

RULES:
- Extract EXACTLY what is in the CV — do not invent or assume
- Every field you see in the CV should appear somewhere in the output
- profileFields must use human-readable labels (not "skill", "job" — use "Technical Skills", "Work Experience", etc.)
- If a field is not present in the CV, set to null or empty array
- Return ONLY the raw JSON object, nothing else

CV:
${cvContent.slice(0, 6000)}`

    const result = await callGeminiWithFallback(
      'You are an expert CV parser. Return ONLY valid JSON matching the schema provided — no explanation, no markdown.',
      `${systemPrompt}`
    )

    const parsed = extractJSON<any>(result.reply)

    if (!parsed) {
      throw new APIError('Could not parse CV. Ensure it is clear text.')
    }

    const response = {
      displayName: parsed.displayName || '',
      email: parsed.email || undefined,
      phone: parsed.phone || undefined,
      currentDegree: parsed.currentDegree || undefined,
      institution: parsed.institution || undefined,
      yearOfStudy: parsed.yearOfStudy || undefined,
      city: parsed.city || undefined,
      preferredIndustries: parsed.preferredIndustries || undefined,
      careerGoals: parsed.careerGoals || undefined,
      portfolioUrl: parsed.portfolioUrl || undefined,
      profileFields: parsed.profileFields || [],
      model: result.model,
    }

    logger.info('parse-profile-from-cv', 'Profile parsed', { name: response.displayName })
    return json(response, 200)
  } catch (error: any) {
    logger.error('parse-profile-from-cv', `Error: ${error.message}`)
    return json({ error: error?.message || 'Failed to parse CV' }, 500)
  }
}

// ===== HANDLERS: DRAFT LETTER =====
async function handleDraftLetter(body: any): Promise<Response> {
  const companyName = body.companyName ?? ''
  const role = body.role ?? ''
  const degree = body.degree ?? ''
  const letterType = body.letterType ?? 'Cover Letter'
  const studentName = body.studentName ?? ''
  const institution = body.institution ?? ''
  const skills = body.skills ?? ''
  const goals = body.goals ?? ''
  const portfolioUrl = body.portfolioUrl ?? ''
  const cvContent = body.cvContent ?? ''
  const companyResearch = body.companyResearch ?? ''
  const yearOfStudy = body.yearOfStudy ?? ''
  const studentCity = body.studentCity ?? ''
  const userDraft = body.userDraft ?? ''
  const styleExamples = body.styleExamples ?? ''

  if (!companyName?.trim()) {
    return json({ error: 'Company name required' }, 400)
  }

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  // Load corpus few-shot examples
  const corpus = await loadCorpus()
  const corpusExamples = pickLetterExamples(corpus.letters, letterType, 2)
  const styleGuide = corpus.guide ? `\nSTYLE PRIORITY RULES:\n${corpus.guide.slice(0, 2000)}\n` : ''

  const styleSection = styleExamples
    ? `
WRITING STYLE GUIDANCE (Priority 1 — from the student's own uploaded letters):
${styleExamples.slice(0, 2400)}

Study the samples above to identify the student's natural writing style — things like:
- How they open and close letters
- Their preferred sentence length and rhythm
- Level of formality and vocabulary choices
- How they describe their experiences and motivations
- Any personal phrases or expressions they favour

Adopt a SIMILAR style in the new letter so it sounds authentically like the student.
IMPORTANT: Do NOT copy errors, grammatical mistakes, or weak phrasing from the samples. Where the samples deviate from professional letter-writing standards (British English, correct grammar, clear structure), use the correct form instead. The goal is to capture the student's voice while producing a polished, correct letter.
`
    : ''

  const corpusSection = corpusExamples
    ? `
REFERENCE EXAMPLES (Priority 3 — professional standards for ${letterType} letters):
${corpusExamples.slice(0, 2400)}

Use these only as structural and tone references. Do NOT copy specific names, experiences, or facts. Adapt the format to the student's own background.
`
    : ''

  const systemPrompt = `You are a professional letter writer helping Zambian students write compelling application letters for WIL placements, internships, and graduate programmes.

Write in a formal, professional tone appropriate for Zambian business culture. Always include a proper date, salutation, body, and sign-off. Use British English spelling.${styleExamples ? ' When style samples are provided, mirror the student\'s authentic voice while maintaining correctness.' : ''}`

  const prompt = `Write a professional ${letterType} letter for:

Student: ${studentName || 'the applicant'}
${studentCity ? `Location: ${studentCity}, Zambia` : ''}
Degree: ${degree}${yearOfStudy ? `, Year ${yearOfStudy}` : ''}
Institution: ${institution || 'a Zambian university'}
Skills: ${skills || 'relevant technical and soft skills'}
Career Goals: ${goals || 'to gain practical industry experience'}
${portfolioUrl ? `Portfolio: ${portfolioUrl}` : ''}

Applying to: ${companyName}
Position: ${role || 'WIL Placement / Industrial Attachment'}
Letter Type: ${letterType}
Date: ${today}

${cvContent ? `CV Summary:\n${cvContent.slice(0, 1500)}\n` : ''}
${companyResearch ? `Company Research:\n${companyResearch.slice(0, 600)}\nUse at least one specific company detail to personalise the letter.\n` : ''}
${userDraft ? `Student's own notes to incorporate:\n${userDraft}\n` : ''}
${styleGuide}
${styleSection}
${corpusSection}
Write a complete, ready-to-send letter (300-420 words). Include date, salutation (Dear Hiring Manager / Dear [Title]), body paragraphs, and a professional closing with the student's name. Do NOT use placeholder brackets like [Name] — use the actual values provided.`

  try {
    let result: { reply: string; model: string; isComplete: boolean }
    try {
      result = await callGroq(systemPrompt, prompt)
    } catch {
      result = await callGeminiWithFallback(systemPrompt, prompt)
    }
    return json({ letter: result.reply, model: result.model })
  } catch (error: any) {
    logger.error('draft-letter', `Error: ${error.message}`)
    return json({ error: error?.message || 'Failed to generate letter' }, 500)
  }
}

async function handleDiscoverCompanies(body: any): Promise<Response> {
  const location = (body.location ?? body.locationText ?? body.city ?? body.profile?.city ?? '').trim()
  const industry = body.industry ?? body.preferredIndustries ?? body.profile?.preferredIndustries ?? ''
  const skills = body.skills ?? body.profile?.skills ?? ''
  const degree = body.degree ?? body.profile?.currentDegree ?? ''
  const institution = body.institution ?? body.profile?.institution ?? ''
  const goals = body.goals ?? body.careerGoals ?? body.profile?.careerGoals ?? ''
  const userIntent = body.userIntent ?? body.message ?? ''

  if (!location) {
    return json({ error: 'Location is required to search for companies' }, 400)
  }

  const profile = { degree, institution, skills, industry, goals, location }

  logger.info('discover-companies', 'Multi-source discovery started', { location, degree, industry })

  // ═══════════════════════════════════════════════════════
  // WEB SEARCH + AI EXTRACTION — real results only
  // Static DB fallback removed — user wants web results only.
  // ═══════════════════════════════════════════════════════
  let webCompanies: any[] = []
  let suggestedSearches: string[] = []
  let searchQueries: SearchQuery[] = []

  try {
    logger.startTimer('generate-queries')
    searchQueries = await generateSearchQueries(profile, location, userIntent)
    logger.endTimer('generate-queries', 'groq', { count: searchQueries.length, queries: searchQueries.map(q => q.query) })

    logger.startTimer('fetch-sources')
    const allSources = await fetchAllSourcesParallel(searchQueries, location)
    logger.endTimer('fetch-sources', 'parallel', {
      google: allSources.google.length,
      tavily: allSources.tavily.length,
      scraper: allSources.scraper.length,
      browsed: allSources.browsed.length,
    })

    logger.startTimer('extract-rank')
    try {
      const result = await extractAndRankWithGemini(allSources, profile, 15)
      webCompanies = result.companies
      suggestedSearches = result.suggestedSearches
      logger.endTimer('extract-rank', 'gemini', { count: webCompanies.length })
    } catch (err: any) {
      logger.warn('discover-companies', `AI extraction failed: ${err.message} — using raw search fallback`)
      const rawNames = new Set<string>()
      for (const r of [...allSources.tavily, ...allSources.google, ...allSources.browsed].slice(0, 15)) {
        const title = (r.title || r.name || '').replace(/\s*[-|]\s*.*$/, '').trim()
        if (title && title.length > 2 && !title.toLowerCase().includes('jobs in')) rawNames.add(title)
      }
      webCompanies = Array.from(rawNames).slice(0, 8).map(name => ({
        name,
        industry: profile.industry || 'Various',
        whyGoodFit: `Web search found this company in ${location} — may offer opportunities.`,
        typesOfRoles: ['intern', 'attachment', 'graduate'],
        size: 'Unknown',
        website: null,
        address: location,
        phone: null,
        email: null,
        fitScore: 50,
        source: 'web-search',
        verified: false,
      }))
      suggestedSearches = [`${profile.degree || ''} companies ${location}`, `${profile.industry || 'career'} jobs Zambia 2026`]
    }
  } catch (webErr: any) {
    logger.warn('discover-companies', `Web search pipeline failed entirely: ${webErr.message} — using DB only`)
  }

  // Merge web results (deduplicated by name)
  const seen = new Set<string>()
  const merged: any[] = []

  // WEB results first (more specific, fresher)
  for (const c of webCompanies) {
    const key = (c.name || '').toLowerCase().trim()
    if (key && !seen.has(key)) {
      seen.add(key)
      merged.push({
        name: c.name || 'Unknown',
        industry: c.industry || industry || 'Various',
        whyGoodFit: c.whyGoodFit || `Web search found this company in ${location}.`,
        typesOfRoles: Array.isArray(c.typesOfRoles) ? c.typesOfRoles : ['intern', 'attachment', 'graduate'],
        size: c.size || 'Unknown',
        website: c.website || null,
        address: c.address || location,
        phone: c.phone || null,
        email: c.email || null,
        fitScore: c.fitScore ?? 50,
        source: c.source || 'web-search',
        verified: c.verified ?? false,
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // DATABASE FALLBACK: query local zambian_companies table
  // ═══════════════════════════════════════════════════════════════
  let dbCompanies: any[] = []
  try {
    const dbUrl = Deno.env.get('SUPABASE_DB_URL')
    if (dbUrl) {
      const sql = postgres(dbUrl, { prepare: false })
      const loc = location.toUpperCase()
      const ind = (industry || '').toLowerCase()
      // Build fuzzy list of possible town spellings (Levenshtein distance <= 2 or exact prefix)
      const allTowns = [
        'LUSAKA','KAFUE','CHONGWE','CHILANGA','RUFUNSA','LUANGWA','CHIRUNDU',
        'KITWE','NDOLA','CHINGOLA','MUFULIRA','KALULUSHI','LUANSHYA','CHAMBISHI',
        'SOLWEZI','LIVINGSTONE','CHIPATA','KABWE','KASAMA','MONGU','CHOMA',
        'MAZABUKA','SESHKE','KAOMA','SINAZONGWE','MONZE','SAMFYA','MANSA',
        'MWANSABOMBWE','KAWAMBWA','MPIKA','NAKONDE','CHINSALI','ISOKA','MBALA',
        'MWINILUNGA','ZAMBEZI','KASEMPA','KABOMPO','SENANGA','KALABO','LUKULU',
        'SIAVONGA','NAMWALA','ITEZHI TEZHI','KAPIRI MPOSHI','MKUSHI','SERENJE',
        'PETAUKE','LUNDAZI','KATETE','NYIMBA','CHILILABOMBWE','MAAMBA','KANSANSHI',
        'MUNGWI','MPULUNGU','KAPUTA','LUWINGU','CHAMA','MUMBWA','SHIBUYUNJI','MASAITI',
        'COPPERBELT','LUSAKA','WESTERN','NORTHERN','NORTHWESTERN','EASTERN',
        'CENTRAL','SOUTHERN','MUCHINGA','LUAPULA',
      ]
      // Map user-friendly aliases to the town used in the DB
      const ALIAS_TO_TOWN: Record<string, string> = {
        'MAAMBA': 'SINAZONGWE',
      }
      const fuzzyTowns = allTowns.filter(t => {
        const d = levenshtein(loc, t)
        return d <= 2 || d <= Math.floor(t.length * 0.35)
      })
      // Resolve aliases: e.g. MAAMBA -> SINAZONGWE
      const resolved = fuzzyTowns.map(t => ALIAS_TO_TOWN[t] || t)
      const towns = resolved.length > 0 ? resolved : [loc]
      // Build query: match town OR province ONLY — do NOT include nationwide
      // companies because they pollute local results with unrelated locations.
      const degree = (body.degree ?? body.profile?.currentDegree ?? '').toLowerCase()
      const skills = (body.skills ?? body.profile?.skills ?? '').toLowerCase()
      const keywords = [degree, skills, ind].filter(Boolean)
      let rows: any[]
      if (ind || keywords.length > 0) {
        rows = await sql`
          SELECT name, town, province, address, phone, email, website, sector, category, subcategory, industry, description, professions, is_nationwide
          FROM public.zambian_companies
          WHERE (
            UPPER(town) IN (${towns})
            OR UPPER(province) IN (${towns})
          )
          AND (
            LOWER(industry) = ${ind}
            OR LOWER(category) LIKE ${'%' + ind + '%'}
            OR LOWER(subcategory) LIKE ${'%' + ind + '%'}
            OR LOWER(professions) LIKE ${'%' + keywords[0] + '%'}
          )
          ORDER BY is_nationwide DESC, name
        `
      } else {
        rows = await sql`
          SELECT name, town, province, address, phone, email, website, sector, category, subcategory, industry, description, professions, is_nationwide
          FROM public.zambian_companies
          WHERE UPPER(town) IN (${towns})
             OR UPPER(province) IN (${towns})
          ORDER BY is_nationwide DESC, name
        `
      }
      await sql.end()
      dbCompanies = rows.map(r => {
        const professionMatch = keywords.length > 0 && r.professions
          ? keywords.some(k => r.professions.toLowerCase().includes(k))
          : false
        const fitScore = professionMatch ? 95 : (r.professions ? 75 : 50)
        return {
          name: r.name,
          industry: r.industry || r.sector || 'Various',
          whyGoodFit: professionMatch
            ? `${r.name} — hires ${r.professions.split(',').slice(0, 5).join(', ')}. Great match for your profile!`
            : `${r.name} — ${r.subcategory || r.category || r.sector || 'company'} in ${r.town}${r.is_nationwide ? ' (nationwide presence)' : ''}. ${r.professions ? `Professions: ${r.professions.substring(0, 80)}${r.professions.length > 80 ? '...' : ''}.` : ''}`,
          typesOfRoles: r.professions ? r.professions.split(',').map((r: string) => r.trim()).slice(0, 8) : ['intern', 'attachment', 'graduate'],
          size: 'Unknown',
          website: r.website || null,
          address: r.address || r.town,
          phone: r.phone || null,
          email: r.email || null,
          fitScore,
          source: 'zambian-companies-db',
          verified: true,
          town: r.town,
          province: r.province,
          professionsMatch: professionMatch,
        }
      })
      logger.info('discover-companies', `DB query returned ${dbCompanies.length} companies for ${location}`, { industry: ind || 'any' })
    }
  } catch (dbErr: any) {
    logger.warn('discover-companies', `DB query failed: ${dbErr.message}`)
  }

  // Merge DB results (deduplicated by name)
  for (const c of dbCompanies) {
    const key = (c.name || '').toLowerCase().trim()
    if (key && !seen.has(key)) {
      seen.add(key)
      merged.push(c)
    }
  }

  // If we still have very few results, fall back to all nationwide companies
  if (merged.length < 5 && dbCompanies.length === 0) {
    try {
      const dbUrl = Deno.env.get('SUPABASE_DB_URL')
      if (dbUrl) {
        const sql = postgres(dbUrl, { prepare: false })
        const rows = await sql`
          SELECT name, town, category, subcategory, industry
          FROM public.zambian_companies
          WHERE is_nationwide = true
          ORDER BY name
          LIMIT 10
        `
        await sql.end()
        for (const r of rows) {
          const key = (r.name || '').toLowerCase().trim()
          if (!seen.has(key)) {
            seen.add(key)
            merged.push({
              name: r.name,
              industry: r.industry || 'Various',
              whyGoodFit: `${r.name} is a ${r.subcategory || r.category || 'company'} with nationwide presence in Zambia.`,
              typesOfRoles: ['intern', 'attachment', 'graduate'],
              size: 'Unknown',
              website: null,
              address: 'Nationwide',
              phone: null,
              email: null,
              fitScore: 55,
              source: 'zambian-companies-db',
              verified: true,
            })
          }
        }
      }
    } catch {}
  }

  logger.info('discover-companies', 'Discovery complete', {
    total: merged.length,
    fromWeb: webCompanies.length,
    fromDb: dbCompanies.length,
  })

  return json({
    companies: merged.slice(0, 20),
    totalFound: merged.length,
    sources: ['web-search', 'zambian-companies-db'],
    suggestedSearches,
    queries: searchQueries.map(q => q.query),
    model: 'multi-source:web-search+db-directory',
  })
}

// ─────────────────────────────────────────────────────────────
// STEP 1 HELPER: Groq generates search queries from profile
// ─────────────────────────────────────────────────────────────
interface SearchQuery {
  query: string
  intent: string
  priority: number
}

async function generateSearchQueries(
  profile: Record<string, string>,
  location: string,
  userIntent?: string
): Promise<SearchQuery[]> {
  if (!GROQ_KEY_POOL.length) {
    return [
      { query: `companies hiring interns graduates ${location} Zambia 2026`, intent: 'general', priority: 1 },
      { query: `${profile.industry || ''} companies ${location} jobs 2026`, intent: 'industry', priority: 2 },
      { query: `${profile.degree || ''} graduate programme ${location} Zambia`, intent: 'graduate', priority: 3 },
    ]
  }

  const systemPrompt = `You are a career search strategist. Given a student profile, generate 4-6 distinct web search queries that will find REAL companies hiring students.

RULES:
- Each query targets a different angle (direct hiring, industry-specific, broader opportunities, hidden gems)
- Include year 2026 for recency
- Mix specific and broad queries
- Consider: degree, skills, industry interest, institution, career goals
- Suggest broader angles user might not think of (remote, NGOs, startups, government, international orgs)

OUTPUT: Return ONLY a JSON object with a "queries" array. No markdown, no explanation.`

  const userPrompt = `Student Profile:
- Location: ${location}
- Degree: ${profile.degree || 'Not specified'}
- Institution: ${profile.institution || 'Not specified'}
- Skills: ${profile.skills || 'Not specified'}
- Industry interest: ${profile.industry || 'Not specified'}
- Career goals: ${profile.goals || 'Not specified'}
${userIntent ? `- User specifically wants: ${userIntent}` : ''}

Generate search queries as JSON:
{"queries":[
  {"query":"...","intent":"...","priority":1},
  ...
]}`

  try {
    const res = await fetch(API_ENDPOINTS.groq, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getGroqKey()}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 1024,
        temperature: 0.5,
      }),
    })

    if (!res.ok) throw new APIError(`Groq returned ${res.status}`, res.status)

    const data = await res.json()
    const reply: string = data?.choices?.[0]?.message?.content ?? ''

    // Extract JSON from Groq response
    const jsonMatch = reply.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(reply)
    const queries = Array.isArray(parsed.queries) ? parsed.queries : Array.isArray(parsed) ? parsed : []

    return queries
      .filter((q: any) => q.query && typeof q.query === 'string')
      .map((q: any) => ({
        query: q.query,
        intent: q.intent || 'general',
        priority: q.priority || 1,
      }))
      .slice(0, 6)
  } catch (err: any) {
    logger.warn('discover-queries', `Groq query generation failed: ${err.message}`)
    return [
      { query: `companies hiring interns graduates ${location} Zambia 2026`, intent: 'general', priority: 1 },
      { query: `${profile.industry || ''} companies ${location} jobs 2026`, intent: 'industry', priority: 2 },
      { query: `${profile.degree || ''} graduate programme ${location} Zambia`, intent: 'graduate', priority: 3 },
      { query: `NGOs startups ${location} Zambia hiring students 2026`, intent: 'hidden-gems', priority: 4 },
    ]
  }
}

// ─────────────────────────────────────────────────────────────
// STEP 2 HELPER: All sources fetch in parallel
// ─────────────────────────────────────────────────────────────
async function fetchAllSourcesParallel(
  queries: SearchQuery[],
  location: string
): Promise<{ google: any[]; tavily: any[]; scraper: any[]; browsed: any[] }> {
  // Google CSE — run top 2 queries only (fast)
  const googlePromise = (async () => {
    if (!GOOGLE_KEY_POOL.length || !GOOGLE_CSE_ID) return []
    const allResults: any[] = []
    for (const q of queries.slice(0, 2)) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 8000)
        const searchUrl = `${API_ENDPOINTS.googleCustomSearch}?key=${encodeURIComponent(getGoogleApiKey())}&cx=${encodeURIComponent(GOOGLE_CSE_ID)}&q=${encodeURIComponent(q.query)}&gl=zm&hl=en&num=8`
        const res = await fetch(searchUrl, { signal: controller.signal })
        clearTimeout(timeoutId)
        if (!res.ok) continue
        const data = await res.json()
        const items = (data.items || []).map((item: any) => ({
          ...item,
          _query: q.query,
          _intent: q.intent,
        }))
        allResults.push(...items)
      } catch { /* ignore single query failure */ }
    }
    return allResults
  })()

  // Tavily — run top 2 queries only (fast)
  const tavilyPromise = (async () => {
    if (!TAVILY_KEY_POOL.length) return []
    const allResults: any[] = []
    for (const q of queries.slice(0, 2)) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)
        const res = await fetch(API_ENDPOINTS.tavily, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: getTavilyKey(),
            query: q.query,
            search_depth: 'basic',
            max_results: 5,
            include_answer: false,
          }),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        if (!res.ok) continue
        const data = await res.json()
        const items = (data.results || []).map((r: any) => ({
          ...r,
          _query: q.query,
          _intent: q.intent,
        }))
        allResults.push(...items)
      } catch { /* ignore single query failure */ }
    }
    return allResults
  })()

  // Scraper — fast single-board fetch
  const scraperPromise = (async () => {
    const isZambia = /zambia|lusaka|ndola|kitwe|livingstone|copperbelt/i.test(location)
    const boardUrl = isZambia ? 'https://gozambiajobs.com/' : 'https://gozambiajobs.com/'

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)
      const txt = await jinaRead(boardUrl, 15000)
      clearTimeout(timeoutId)
      if (txt && txt.length > 300) {
        return [{
          source: boardUrl,
          content: txt.slice(0, 2500),
          _query: 'job-board',
          _intent: 'scraped',
        }]
      }
    } catch { /* ignore */ }
    return []
  })()

  // Run all three in parallel first
  const [google, tavily, scraper] = await Promise.all([googlePromise, tavilyPromise, scraperPromise])

  // ── Deep web browsing: visit each result URL and read full page content ──
  // Collect unique URLs from Google CSE and Tavily results, skip social/noise
  const skipDomains = /facebook\.com|linkedin\.com|twitter\.com|instagram\.com|youtube\.com|wikipedia\.org/i
  const seen = new Set<string>()
  const urlsToBrowse: string[] = []

  for (const r of [...google, ...tavily]) {
    const url: string = r.link || r.url || ''
    if (url && !seen.has(url) && !skipDomains.test(url)) {
      seen.add(url)
      urlsToBrowse.push(url)
    }
  }

  // Browse top 3 URLs in parallel — 5 s each, 600 chars kept per page
  // (keeps total corpus size manageable for Gemini; all 3 run at the same time)
  const browseResults = await Promise.allSettled(
    urlsToBrowse.slice(0, 3).map(async (url) => {
      const content = await jinaRead(url, 5000)
      if (!content || content.length < 150) return null
      return {
        source: url,
        content: content.slice(0, 600),
        _query: 'browsed',
        _intent: 'full-page',
      }
    })
  )

  const browsed = browseResults
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)

  return { google, tavily, scraper, browsed }
}

// ─────────────────────────────────────────────────────────────
// STEP 3 HELPER: Groq parses raw results into structured companies
// ─────────────────────────────────────────────────────────────
async function extractAndRankWithGemini(
  rawResults: { google: any[]; tavily: any[]; scraper: any[]; browsed: any[] },
  profile: Record<string, string>,
  maxResults: number = 25
): Promise<{ companies: any[]; suggestedSearches: string[] }> {
  if (!GEMINI_API_KEY) {
    return { companies: [], suggestedSearches: [] }
  }

  // Build a clean corpus — browsed full-page content first (richest signal), then snippets
  const lines: string[] = []

  for (const r of (rawResults.browsed || []).slice(0, 3)) {
    const source = (r.source || '').replace(/^https?:\/\//, '').slice(0, 60)
    const content = (r.content || '').slice(0, 600)
    lines.push(`PAGE | ${source} | ${content}`)
  }
  for (const r of rawResults.tavily.slice(0, 8)) {
    lines.push(`TAVILY | ${(r.title || '').slice(0, 80)} | ${(r.content || '').slice(0, 200)}`)
  }
  for (const r of rawResults.google.slice(0, 8)) {
    lines.push(`GOOGLE | ${(r.title || '').slice(0, 80)} | ${(r.snippet || '').slice(0, 200)}`)
  }
  for (const r of rawResults.scraper.slice(0, 1)) {
    lines.push(`SCRAPER | ${(r.content || '').slice(0, 500)}`)
  }

  const corpus = lines.join('\n')
  const profileSummary = [
    profile.degree ? `Degree: ${profile.degree}` : null,
    profile.institution ? `Institution: ${profile.institution}` : null,
    profile.skills ? `Skills: ${profile.skills}` : null,
    profile.industry ? `Industry: ${profile.industry}` : null,
    profile.goals ? `Goals: ${profile.goals}` : null,
    profile.location ? `Location: ${profile.location}` : null,
  ].filter(Boolean).join(' | ')

  const systemPrompt = `You extract REAL company names from web pages and search results, then rank them for a student.

SOURCE TYPES:
- PAGE — full text from a visited website (richest; trust company names here most)
- TAVILY / GOOGLE — search result snippets (may contain noise)
- SCRAPER — job board content

RULES:
- Extract ONLY specific company/organization names (e.g., "MTN Zambia", "Stanbic Bank", "Zesco")
- From PAGE sources you may also pull website URL, address, phone, email if clearly present
- NEVER extract: page headings, categories, generic phrases, navigation text
- NEVER extract: "Jobs in", "Employers", "Latest", "Facebook", "Computer Science", "Vacancies"
- NEVER extract: partial names, descriptions, or job titles without a company name
- If a snippet mentions a job but NOT the company name, SKIP it
- CRITICAL: Only return companies that are physically located in or near ${profile.location}. Do NOT include companies from other towns, provinces, or regions just because they have a nationwide presence.
- Output ONLY the JSON format below. No markdown, no explanation.`

  const userPrompt = `STUDENT: ${profileSummary || 'General student in Zambia'}

WEB CONTENT AND SEARCH RESULTS:
${corpus}

Return ONLY this JSON (max 10 companies, best fit first):
{
  "companies": [
    {"name":"Company Name","industry":"Sector","fitScore":75,"whyGoodFit":"1-2 sentence reason","typesOfRoles":["intern","graduate"],"size":"Large/Medium/Small","website":null,"address":null,"phone":null,"email":null}
  ],
  "suggestedSearches": ["alternative search 1", "alternative search 2"]
}`

  // Try Groq first (faster, higher rate limits, 128k context), fall back to Gemini
  const callAIForExtract = async (): Promise<string> => {
    if (GROQ_KEY_POOL.length > 0) {
      try {
        const result = await callGroq(systemPrompt, userPrompt)
        return result.reply
      } catch (groqErr: any) {
        logger.warn('discover-extract-rank', `Groq failed, falling back to Gemini: ${groqErr.message}`)
      }
    }
    if (!GEMINI_KEY_POOL.length) throw new APIError('No AI provider available')
    // Try primary then fallback models
    const models = [MODELS.generation.primary, MODELS.generation.fallback]
    let lastErr: any = null
    for (const model of models) {
      try {
        const geminiUrl = `${API_ENDPOINTS.gemini}/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30000)
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
          }),
        })
        clearTimeout(timeoutId)
        if (res.status === 429) {
          logger.warn('discover-extract-rank', `${model} rate limited (429), trying next`)
          lastErr = new APIError(`${model} rate limited (429)`, 429)
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
        if (!res.ok) {
          lastErr = new APIError(`${model} returned ${res.status}`, res.status)
          continue
        }
        const text = await res.text()
        const data = extractJSON<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(text)
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        if (reply.trim()) return reply
      } catch (err: any) {
        lastErr = err
        logger.warn('discover-extract-rank', `${model} failed: ${err.message}`)
      }
    }
    throw lastErr ?? new APIError('All Gemini models failed for extract-and-rank')
  }

  try {
    const reply = await callAIForExtract()

    const jsonMatch = reply.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in AI response')

    const parsed = JSON.parse(jsonMatch[0])
    const companies: any[] = Array.isArray(parsed.companies) ? parsed.companies : []
    const suggestedSearches: string[] = Array.isArray(parsed.suggestedSearches) ? parsed.suggestedSearches : []

    // Deduplicate and validate
    const seen = new Set<string>()
    const valid: any[] = []
    for (const c of companies) {
      const name = (c.name || '').trim()
      const key = name.toLowerCase()
      if (!name || seen.has(key)) continue
      if (name.length < 3 || name.length > 60) continue
      const lower = name.toLowerCase()
      if (/^jobs?\b|^employers?\b|^latest\b|^facebook\b|^vacanc|^recruitment|^see\s+|^share\s|^free\s|^test\s|^in\s+line\s+with|^official\b|^computer\s+science\b|^software\s+eng|^full[-\s]?time\b|^part[-\s]?time\b|^time\d*\s+job\b|^legitimate$|^typing\b|^online\s+job\b|^ngo\s+job\b|^un\s+job\b|^embassy\s+job\b|^accounting\s+job\b|^it\s+job\b|^telecom\s+job\b|^job\s+vacanc\b|^job\s+prospects\b|^teacher\s+recruit\b|^web\s*design\b|^career\s+expo\b/.test(lower)) continue
      if (/<\/?[a-z]|\bclick\b|\bhere\b|\bread\s+more\b/i.test(name)) continue
      seen.add(key)
      valid.push({
        name,
        industry: c.industry || 'Various',
        whyGoodFit: c.whyGoodFit || `${name} may offer opportunities matching your profile.`,
        fitScore: typeof c.fitScore === 'number' ? Math.min(100, Math.max(1, c.fitScore)) : 50,
        typesOfRoles: Array.isArray(c.typesOfRoles) ? c.typesOfRoles : ['intern', 'graduate'],
        size: c.size || 'Unknown',
        website: c.website || null,
        address: c.address || profile.location || 'Zambia',
        phone: c.phone || null,
        email: c.email || null,
        source: 'ai-extracted',
        verified: true,
      })
    }

    valid.sort((a, b) => b.fitScore - a.fitScore)
    return { companies: valid.slice(0, maxResults), suggestedSearches }
  } catch (err: any) {
    logger.warn('discover-extract-rank', `Gemini extract+rank failed: ${err.message}`)
    return { companies: [], suggestedSearches: [] }
  }
}


async function rankWithGemini(
  companies: any[],
  profile: Record<string, string>,
  maxResults: number = 25
): Promise<any[]> {
  if (!GEMINI_API_KEY || companies.length === 0) {
    return companies.slice(0, maxResults).map(c => ({
      ...c,
      fitScore: 50,
      whyGoodFit: `${c.name} may offer roles matching your profile.`,
      suggestedSearches: [],
    }))
  }

  // Pre-deduplicate by name
  const unique = new Map<string, any>()
  for (const c of companies) {
    const key = c.name.toLowerCase().trim()
    if (!unique.has(key)) {
      unique.set(key, c)
    } else {
      const existing = unique.get(key)
      // Merge: keep richer context
      if ((c.rawContext?.length || 0) > (existing.rawContext?.length || 0)) {
        unique.set(key, { ...c, source: `${existing.source},${c.source}` })
      }
    }
  }
  const deduped = Array.from(unique.values())

  const profileSummary = [
    profile.degree ? `Degree: ${profile.degree}` : null,
    profile.institution ? `Institution: ${profile.institution}` : null,
    profile.skills ? `Skills: ${profile.skills}` : null,
    profile.industry ? `Industry: ${profile.industry}` : null,
    profile.goals ? `Goals: ${profile.goals}` : null,
  ].filter(Boolean).join('\n')

  const systemPrompt = `You are a senior career advisor. Review companies for a student and provide final rankings.

TASKS:
1. DEDUPLICATE: Same company twice → keep one
2. RANK: Score 1-100 based on profile match
3. ENRICH: Write compelling 1-2 sentence "whyGoodFit" for each
4. SUGGEST: Add 3-5 search ideas the student might not have thought of

Return ONLY JSON. No markdown.`

  const userPrompt = `Student Profile:
${profileSummary || 'General student'}

Companies (${deduped.length}):
${JSON.stringify(deduped.slice(0, 40).map(c => ({
  name: c.name,
  industry: c.industry,
  typesOfRoles: c.typesOfRoles,
  location: c.location,
  source: c.source,
  rawContext: c.rawContext?.slice(0, 150),
})))}

Return JSON:
{
  "companies": [
    {"name":"...","fitScore":85,"whyGoodFit":"...","size":"Large/Small/Unknown","industry":"..."}
  ],
  "suggestedSearches": ["remote software jobs Zambia", "NGOs hiring developers Lusaka", "..."]
}`

  // Try Groq first, fall back to Gemini
  const callAIForRank = async (): Promise<string> => {
    if (GROQ_KEY_POOL.length > 0) {
      try {
        const result = await callGroq(systemPrompt, userPrompt)
        return result.reply
      } catch (groqErr: any) {
        logger.warn('discover-rank', `Groq failed, falling back to Gemini: ${groqErr.message}`)
      }
    }
    if (!GEMINI_KEY_POOL.length) throw new APIError('No AI provider available for ranking')
    const url = `${API_ENDPOINTS.gemini}/${MODELS.generation.primary}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      }),
    })
    if (!res.ok) throw new APIError(`Gemini returned ${res.status}`, res.status)
    const text = await res.text()
    const data = extractJSON<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(text)
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }

  try {
    const reply = await callAIForRank()

    const jsonMatch = reply.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON object in AI response')

    const parsed = JSON.parse(jsonMatch[0])
    const ranked = Array.isArray(parsed.companies) ? parsed.companies : []
    const suggestedSearches = Array.isArray(parsed.suggestedSearches) ? parsed.suggestedSearches : []

    const rankedMap = new Map(ranked.map((r: any) => [r.name?.toLowerCase()?.trim(), r]))

    const final = deduped.map(c => {
      const r = rankedMap.get(c.name.toLowerCase().trim())
      return {
        ...c,
        fitScore: r?.fitScore ?? 50,
        whyGoodFit: r?.whyGoodFit ?? `${c.name} is active in ${c.industry} and may offer roles matching your profile.`,
        size: r?.size ?? 'Unknown',
        industry: r?.industry ?? c.industry,
        typesOfRoles: r?.typesOfRoles ?? c.typesOfRoles,
        suggestedSearches,
      }
    }).sort((a, b) => (b.fitScore ?? 50) - (a.fitScore ?? 50))

    return final.slice(0, maxResults)
  } catch (err: any) {
    logger.warn('discover-rank', `Gemini ranking failed: ${err.message}`)
    return deduped.slice(0, maxResults).map(c => ({
      ...c,
      fitScore: 50,
      whyGoodFit: `${c.name} may offer opportunities matching your profile.`,
      suggestedSearches: [],
    }))
  }
}

async function handleInterviewQuestions(body: any): Promise<Response> {
  const role = body.role ?? ''
  const company = (body.company ?? body.companyName ?? '').trim()
  const skills = body.skills ?? ''
  const degree = body.degree ?? ''
  const goals = body.goals ?? ''
  const institution = body.institution ?? ''
  const yearOfStudy = body.yearOfStudy ?? ''
  const researchSummary = body.researchSummary ?? ''
  const cvContent = body.cvContent ?? ''

  const corpus = await loadCorpus()
  const interviewExamples = pickInterviewExamples(corpus.interviews, 3)

  const systemPrompt = `You are an expert interview coach specialising in Zambian job market WIL placements, internships, and graduate programmes. Generate realistic, targeted interview questions.`

  const prompt = `Generate 15 interview questions for:
- Company: ${company || 'a Zambian organisation'}
- Role: ${role || 'WIL/Internship Placement'}
- Degree: ${degree || 'Not specified'}${yearOfStudy ? `, Year ${yearOfStudy}` : ''}
- Institution: ${institution || 'Not specified'}
- Skills: ${skills || 'Not specified'}
- Goals: ${goals || 'Not specified'}
${researchSummary ? `\nCompany Research:\n${researchSummary.slice(0, 400)}\n` : ''}
${cvContent ? `\nCV Highlights:\n${cvContent.slice(0, 500)}\n` : ''}

${interviewExamples ? `REFERENCE INTERVIEW EXAMPLES (use as quality and tone references, do not copy verbatim):\n${interviewExamples.slice(0, 3000)}\n\n` : ''}

Return ONLY a valid JSON object in this exact format — no markdown, no extra text:
{
  "personal": ["question1", "question2", "question3", "question4", "question5"],
  "company": ["question1", "question2", "question3", "question4", "question5"],
  "experience": ["question1", "question2", "question3", "question4", "question5"]
}

personal = motivational & behavioural questions
company = questions specific to ${company || 'the company'} and its industry
experience = questions about the student's skills, degree, and past experience`

  try {
    let result: { reply: string; model: string; isComplete: boolean }
    try {
      result = await callGroq(systemPrompt, prompt)
    } catch {
      result = await callGeminiWithFallback(systemPrompt, prompt)
    }

    const parsed = extractJSON<{ personal?: any[]; company?: any[]; experience?: any[] }>(result.reply)

    const toStrings = (arr: any[] | undefined): string[] => {
      if (!Array.isArray(arr)) return []
      return arr.map(item => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') return item.question || item.text || JSON.stringify(item)
        return String(item)
      }).filter(Boolean)
    }

    if (parsed && (parsed.personal || parsed.company || parsed.experience)) {
      return json({
        personal: toStrings(parsed.personal),
        company: toStrings(parsed.company),
        experience: toStrings(parsed.experience),
        model: result.model,
      })
    }

    return json({ personal: [], company: [], experience: [], model: result.model })
  } catch (error: any) {
    logger.error('interview-questions', `Error: ${error.message}`)
    return json({ error: error?.message || 'Failed to generate questions' }, 500)
  }
}

async function handleExtractContent(body: any): Promise<Response> {
  const fileContent = body.fileContent ?? ''
  const category = body.category ?? 'Other'
  const contentType = body.contentType ?? 'text/plain'

  if (!fileContent?.trim()) {
    return json({ error: 'No file content provided' }, 400)
  }

  try {
    let textContent = fileContent

    // Check if content is base64-encoded (from mobile app file upload)
    if (isBase64(fileContent)) {
      logger.info('extract-content', 'Detected base64 content, decoding file', { contentType })
      textContent = await extractTextFromFile(fileContent, contentType)

      if (!textContent?.trim()) {
        // Image-only files (scanned certificates, image PDFs) cannot yield text
        // even with vision AI when rate-limited. Return a partial-success 200 so
        // the client doesn't mark the document as "Extraction failed" — it simply
        // won't be AI-indexed until retried when rate limits clear.
        logger.warn('extract-content', 'No text extracted — likely image-only file or all AI providers rate-limited', { contentType, category })
        return json({
          extractedText: '',
          parsedData: null,
          model: 'none',
          rawText: '',
          imageOnly: true,
        }, 200)
      }
    }

    // Category-aware extraction prompt
    const CATEGORY_PROMPTS: Record<string, string> = {
      'CV / Resume': `You are an expert CV parser. Read this CV and return ONLY valid JSON matching this schema. Do NOT add markdown, explanations, or commentary outside the JSON.

CV TEXT:
${textContent.slice(0, 8000)}

Return JSON with these exact keys (set missing ones to null or empty string):
{
  "displayName": string,
  "email": string | null,
  "phone": string | null,
  "currentDegree": string,
  "institution": string,
  "yearOfStudy": string,
  "city": string | null,
  "skills": string,
  "preferredIndustries": string | null,
  "careerGoals": string | null,
  "portfolioUrl": string | null,
  "linkedInUrl": string | null,
  "githubUrl": string | null,
  "experience": [{ "role": string, "company": string, "period": string, "highlights": string }],
  "education": [{ "degree": string, "institution": string, "period": string }],
  "certifications": [string],
  "projects": [{ "name": string, "description": string, "technologies": string }],
  "languages": [string],
  "summary": string
}`,
      'Cover Letter': `You are an expert cover-letter analyst. Read this cover letter and return ONLY valid JSON matching this schema. Do NOT add markdown, explanations, or commentary outside the JSON.

LETTER TEXT:
${textContent.slice(0, 8000)}

Return JSON with these exact keys:
{
  "recipient": string,
  "position": string,
  "company": string,
  "motivation": string,
  "skillsHighlighted": string,
  "tone": string,
  "closing": string,
  "keyPoints": [string],
  "salutation": string,
  "date": string | null
}`,
      'Certificate': `You are an expert credential verifier. Read this certificate and return ONLY valid JSON matching this schema. Do NOT add markdown, explanations, or commentary outside the JSON.

CERTIFICATE TEXT:
${textContent.slice(0, 8000)}

Return JSON with these exact keys:
{
  "title": string,
  "issuer": string,
  "date": string,
  "credentialId": string | null,
  "skillsCertified": string,
  "level": string | null,
  "description": string,
  "validUntil": string | null
}`,
      'Academic Transcript': `You are an academic records specialist. Read this transcript and return ONLY valid JSON matching this schema. Do NOT add markdown, explanations, or commentary outside the JSON.

TRANSCRIPT TEXT:
${textContent.slice(0, 8000)}

Return JSON with these exact keys:
{
  "institution": string,
  "program": string,
  "gpa": string | null,
  "courses": [{ "name": string, "grade": string, "credits": string | null }],
  "dates": string,
  "degree": string,
  "honors": string | null,
  "totalCredits": string | null
}`,
      'Reference Letter': `You are a professional recommendation analyst. Read this reference letter and return ONLY valid JSON matching this schema. Do NOT add markdown, explanations, or commentary outside the JSON.

LETTER TEXT:
${textContent.slice(0, 8000)}

Return JSON with these exact keys:
{
  "referee": string,
  "relationship": string,
  "keyPoints": [string],
  "contact": string | null,
  "institution": string,
  "date": string | null,
  "strengths": [string],
  "position": string
}`,
      'Portfolio': `You are a portfolio analyst. Read this portfolio and return ONLY valid JSON matching this schema. Do NOT add markdown, explanations, or commentary outside the JSON.

PORTFOLIO TEXT:
${textContent.slice(0, 8000)}

Return JSON with these exact keys:
{
  "projects": [
    { "name": string, "technologies": string, "description": string, "link": string | null, "role": string }
  ],
  "skills": string,
  "summary": string,
  "contact": string | null
}`,
      'Other': `You are a document analysis expert. Read this document and return ONLY valid JSON matching this schema. Do NOT add markdown, explanations, or commentary outside the JSON.

DOCUMENT TEXT:
${textContent.slice(0, 8000)}

Return JSON with these exact keys:
{
  "summary": string,
  "keyPoints": [string],
  "dates": string | null,
  "peopleMentioned": [string],
  "topics": [string],
  "type": string
}`
    }

    const prompt = CATEGORY_PROMPTS[category] || CATEGORY_PROMPTS['Other']

    // ── AI structured analysis — best-effort only ────────────────────────────
    // If Gemini / Groq are rate-limited or unavailable we still return the
    // extracted raw text so the mobile app can display it. A failed analysis
    // must never surface as a 500 to the client.
    let parsedData: Record<string, unknown> | null = null
    let model = 'none'

    try {
      const result = await callGeminiWithFallback(
        'You are a document analysis expert. Return ONLY valid JSON. No markdown, no explanations, no prose outside the JSON object.',
        prompt
      )
      model = result.model
      try {
        const jsonMatch = result.reply.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          parsedData = JSON.parse(jsonMatch[0])
        }
      } catch {
        parsedData = null
      }
    } catch (aiErr: any) {
      // Analysis failed — but extraction succeeded. Return raw text with 200.
      logger.warn('extract-content', `AI analysis failed (returning raw text): ${aiErr.message}`)
    }

    return json({
      extractedText: textContent.slice(0, 2000),
      parsedData,
      model,
      rawText: textContent.slice(0, 2000),
    })
  } catch (error: any) {
    logger.error('extract-content', `Error: ${error.message}`)
    return json({ error: error?.message || 'Failed to extract content' }, 500)
  }
}

async function handleResearchCompany(body: any): Promise<Response> {
  const company = (body.company ?? body.companyName ?? '').trim()
  const degree = body.degree ?? ''
  const goals = body.goals ?? ''

  if (!company?.trim()) {
    return json({ error: 'Company name required' }, 400)
  }

  // Step 1: Google CSE — get fresh web context about the company
  let searchContext = ''
  if (GOOGLE_KEY_POOL.length && GOOGLE_CSE_ID) {
    try {
      const q = `${company} Zambia jobs internship career 2026`
      const url = `${API_ENDPOINTS.googleCustomSearch}?key=${encodeURIComponent(getGoogleApiKey())}&cx=${encodeURIComponent(GOOGLE_CSE_ID)}&q=${encodeURIComponent(q)}&num=5&gl=zm`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json() as any
        const snippets = (data.items ?? [])
          .map((item: any, i: number) => `[${i + 1}] ${item.title}\n${item.snippet}`)
          .join('\n\n')
        if (snippets) searchContext = `Recent web search results:\n${snippets}`
      }
    } catch {
      // ignore — proceed without search context
    }
  }

  const systemPrompt = `You are a career research specialist helping Zambian students prepare for WIL placements, internships, and graduate applications. Be specific, practical, and concise.`

  const prompt = `Research ${company} for a ${degree || 'Zambian'} student${goals ? ` with career goals: ${goals}` : ''}.

${searchContext || ''}

Write a structured research summary (350-480 words) with these sections:

**Company Overview** — what they do, their sector, Zambian footprint, approximate size

**Recent News & Achievements** — use search results above for anything current; otherwise mention known milestones

**Culture & Values** — work environment, mission, what employees say

**Career & WIL Opportunities** — types of placements, internships, or graduate roles; typical intake periods

**Application Tips** — what this company looks for, how to stand out

**Interview Focus Areas** — topics or competencies they typically assess

Be specific to ${company}. If any section is uncertain, say so briefly rather than fabricating.`

  try {
    let result: { reply: string; model: string; isComplete: boolean }
    try {
      result = await callGroq(systemPrompt, prompt)
    } catch {
      result = await callGeminiWithFallback(systemPrompt, prompt)
    }
    return json({ summary: result.reply, model: result.model })
  } catch (error: any) {
    logger.error('research-company', `Error: ${error.message}`)
    return json({ error: error?.message || 'Failed to research company' }, 500)
  }
}

// ===== LETTER CHAT (scoped to a single letter) =====
async function handleLetterChat(body: any): Promise<Response> {
  const letterContent = (body.letterContent ?? '').slice(0, 3000)
  const message = (body.message ?? '').trim()
  const company = (body.company ?? '').trim()
  const role = (body.role ?? '').trim()
  const letterType = (body.letterType ?? '').trim()
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = body.history ?? []

  if (!letterContent) return json({ error: 'Letter content required' }, 400)
  if (!message) return json({ error: 'Message required' }, 400)

  const systemPrompt = `You are a professional letter-writing assistant helping a Zambian student refine their application letter.

Your ONLY job is to help improve THIS specific letter. You may NOT discuss:
- general career advice
- jobs outside this letter
- unrelated topics
- the user's profile beyond what's needed for this letter

RESPONSE FORMAT RULES — follow exactly:

If the user asks a question or wants feedback without changes → reply conversationally in 1-3 sentences. No separator.

If the user asks for ANY edit, rewrite, or improvement:
1. First, write 1-2 sentences explaining what you are changing and why.
2. Then output exactly this separator on its own line: ---REVISED---
3. Then output the COMPLETE revised letter (not just a section — the full letter).

The client will show the user your explanation and an "Apply" button. Only include one ---REVISED--- block per response. Never put the separator in a question-only reply.

Current letter details:
${company ? `Company: ${company}` : ''}
${role ? `Role: ${role}` : ''}
${letterType ? `Type: ${letterType}` : ''}

Use British English. Be direct and practical.`

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: `Here is the letter I need help with:\n\n${letterContent}` },
    ...history.slice(-6),
    { role: 'user', content: message },
  ]

  try {
    const result = await callGroqWithHistory(systemPrompt, messages)
    return json({ reply: result.reply, model: result.model })
  } catch (error: any) {
    logger.error('letter-chat', `Error: ${error.message}`)
    return json({ error: error?.message || 'Chat failed' }, 500)
  }
}

// ===== HANDLERS: COMPANY CHAT =====
async function handleCompanyChat(body: any): Promise<Response> {
  const company = (body.companyName ?? '').trim()
  const message = (body.message ?? '').trim()
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = body.history ?? []
  const researchContext = (body.researchContext ?? '').slice(0, 800)

  if (!company) return json({ error: 'Company name required' }, 400)
  if (!message) return json({ error: 'Message required' }, 400)

  // Fetch fresh web context when question likely needs current info
  let searchContext = ''
  const needsFresh = /recent|latest|news|current|2024|2025|2026|hire|hiring|open|position|deadline|salary|pay|culture|review|glassdoor/i.test(message)
  if (needsFresh && GOOGLE_KEY_POOL.length && GOOGLE_CSE_ID) {
    try {
      const q = `${company} ${message.slice(0, 60)}`
      const url = `${API_ENDPOINTS.googleCustomSearch}?key=${encodeURIComponent(getGoogleApiKey())}&cx=${encodeURIComponent(GOOGLE_CSE_ID)}&q=${encodeURIComponent(q)}&num=3&gl=zm`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json() as any
        searchContext = (data.items ?? [])
          .map((item: any) => `${item.title}: ${item.snippet}`)
          .join('\n')
      }
    } catch {
      // ignore
    }
  }

  const systemPrompt = `You are a career advisor helping a Zambian student research ${company} for a job application or WIL placement.
${researchContext ? `\nExisting research:\n${researchContext}` : ''}
${searchContext ? `\nFresh web context:\n${searchContext}` : ''}

Be concise and practical. Give 2-4 sentence answers unless more detail is needed. Always tie advice to the Zambian context when relevant.`

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...history.slice(-6),
    { role: 'user', content: message },
  ]

  try {
    const result = await callGroqWithHistory(systemPrompt, messages)
    return json({ reply: result.reply, model: result.model })
  } catch (error: any) {
    logger.error('company-chat', `Error: ${error.message}`)
    return json({ error: error?.message || 'Chat failed' }, 500)
  }
}

// ===== EVENT CHAT =====
async function handleEventChat(body: any): Promise<Response> {
  try {
    const userMessage = (body.message ?? '').toString().trim()
    if (!userMessage) return json({ error: 'No message provided' }, 400)

    const event = body.event ?? {}
    const eventTitle = (event.title ?? '').toString().slice(0, 200)
    const eventOrganizer = (event.organizer ?? '').toString().slice(0, 100)
    const eventDate = (event.dateLabel ?? '').toString()
    const eventLocation = (event.location ?? '').toString()
    const eventDescription = (event.description ?? '').toString().slice(0, 600)
    const eventUrl = (event.url ?? '').toString()
    const eventTags = Array.isArray(event.tags) ? event.tags.join(', ') : ''
    const eventType = (event.eventType ?? '').toString()
    const history: Array<{ role: 'user' | 'assistant'; content: string }> =
      Array.isArray(body.history) ? body.history.slice(-8) : []
    const userProfileStr = body.userProfile
      ? JSON.stringify(body.userProfile).slice(0, 400)
      : ''

    // Search Tavily for real-time info about this event
    let researchContext = ''
    if (TAVILY_KEY_POOL.length && eventTitle) {
      try {
        const controller = new AbortController()
        const tid = setTimeout(() => controller.abort(), 8000)
        const res = await fetch(API_ENDPOINTS.tavily, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: getTavilyKey(),
            query: `${eventTitle} ${eventOrganizer} ${new Date().getFullYear()}`,
            search_depth: 'basic',
            max_results: 4,
            include_answer: true,
          }),
          signal: controller.signal,
        })
        clearTimeout(tid)
        if (res.ok) {
          const data = await res.json()
          if (data.answer) researchContext += `WEB ANSWER: ${data.answer}\n\n`
          const snippets = (data.results ?? [])
            .map((r: any) => `• ${r.title}: ${(r.content ?? '').slice(0, 250)}`)
            .join('\n')
          if (snippets) researchContext += `SOURCES:\n${snippets}`
        }
      } catch { /* ignore */ }
    }

    // Also read the event page if a URL was provided
    if (eventUrl) {
      try {
        const pageContent = await jinaRead(eventUrl, 6000)
        if (pageContent && pageContent.length > 200) {
          researchContext += `\n\nEVENT WEBSITE:\n${pageContent.slice(0, 1200)}`
        }
      } catch { /* ignore */ }
    }

    const systemPrompt = `You are an expert event advisor for Career Campus. Your SOLE focus is helping the user understand and prepare for this specific event.

EVENT DETAILS:
Title: ${eventTitle}
Organizer: ${eventOrganizer}
Date: ${eventDate}
Location: ${eventLocation}
Type: ${eventType}
${eventDescription ? `About: ${eventDescription}` : ''}
${eventTags ? `Tags: ${eventTags}` : ''}
${userProfileStr ? `USER BACKGROUND: ${userProfileStr}` : ''}
${researchContext ? `\nREAL-TIME RESEARCH (use this for accurate answers):\n${researchContext}` : ''}

RULES:
- ONLY answer questions about this event — preparation, what to expect, networking, follow-up, career fit
- Use the real-time research data to give specific, accurate answers
- Be concise and actionable (2-4 sentences per point)
- Do NOT output PARTIAL_PROFILE, PROFILE_COMPLETE, or any profile signals
- Do NOT try to build or update the user's profile
- If asked about unrelated topics, politely redirect to the event`

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history,
      { role: 'user', content: userMessage },
    ]

    const result = await callGroqWithHistory(systemPrompt, messages)
    return json({ reply: result.reply })
  } catch (error: any) {
    logger.error('event-chat', `Error: ${error.message}`)
    return json({ error: error?.message || 'Event chat failed' }, 500)
  }
}

// ===== PROFILE MERGE (extract-to-profile with conflict resolution) =====
async function handleProfileMerge(body: any): Promise<Response> {
  try {
    const extractedFields: Array<{ label: string; value: string }> =
      Array.isArray(body.extractedFields) ? body.extractedFields : []
    const existingProfile = body.existingProfile ?? {}

    // Chat mode — ongoing conflict-resolution conversation
    if (body.message && Array.isArray(body.history)) {
      const userMessage = (body.message ?? '').toString().trim()
      if (!userMessage) return json({ error: 'No message' }, 400)

      const systemPrompt = `You are a profile merge assistant for Career Campus. The user is resolving conflicts between their existing profile and data extracted from a document.

Be brief and friendly. Once all conflicts are resolved — or when the user says "save", "looks good", "that's fine", "go ahead", or similar approval — output MERGE_READY on its own line followed immediately by a JSON array of the final merged fields:

MERGE_READY
[{"label":"Name","value":"..."},{"label":"Degree","value":"..."}]

The array must contain ALL final fields that should be added to the profile (conflict-resolved + safe additions).`

      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...(body.history as any[]).slice(-10),
        { role: 'user', content: userMessage },
      ]

      const result = await callGroqWithHistory(systemPrompt, messages)
      const reply = result.reply

      const mergeMatch = reply.match(/MERGE_READY\s*\n\s*(\[[\s\S]*?\])/m)
      if (mergeMatch) {
        try {
          const finalFields = JSON.parse(mergeMatch[1])
          return json({
            reply: reply.replace(/MERGE_READY[\s\S]*$/, '').trim() ||
              'All resolved! Saving your profile now…',
            mergeReady: true,
            finalFields,
          })
        } catch { /* fall through */ }
      }

      return json({ reply, mergeReady: false })
    }

    // Initial comparison — detect conflicts between existing profile and extracted data
    if (!extractedFields.length) {
      return json({
        hasConflicts: false,
        conflicts: [],
        safeToAdd: [],
        conflictSummary: 'No fields extracted',
      })
    }

    const existingStr = JSON.stringify(existingProfile, null, 2).slice(0, 800)
    const extractedStr = JSON.stringify(extractedFields, null, 2).slice(0, 800)

    const systemPrompt = `You are a data merge analyzer. Compare the existing user profile with newly extracted fields and identify conflicts or mismatches. Output ONLY valid JSON, no markdown.`
    const userMsg = `EXISTING PROFILE:\n${existingStr}\n\nEXTRACTED FROM DOCUMENT:\n${extractedStr}\n\nOutput this exact JSON structure:\n{"hasConflicts":false,"conflicts":[{"field":"...","existing":"...","extracted":"...","description":"..."}],"safeToAdd":[{"label":"...","value":"..."}],"conflictSummary":"..."}`

    const result = await callGroq(systemPrompt, userMsg)
    const jsonMatch = result.reply.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return json(parsed)
    }

    return json({
      hasConflicts: false,
      conflicts: [],
      safeToAdd: extractedFields,
      conflictSummary: 'No conflicts found',
    })
  } catch (error: any) {
    logger.error('profile-merge', `Error: ${error.message}`)
    return json({
      hasConflicts: false,
      conflicts: [],
      safeToAdd: Array.isArray(body.extractedFields) ? body.extractedFields : [],
      conflictSummary: 'Could not compare — adding safely',
    })
  }
}

// ===== GOOGLE CUSTOM SEARCH EVENT FETCHER =====
async function fetchGoogleEvents(
  city: string,
  query: string
): Promise<any[]> {
  logger.startTimer('google-events')

  if (!GOOGLE_KEY_POOL.length || !GOOGLE_CSE_ID) {
    logger.warn('google-events', 'Google CSE not configured')
    return []
  }

  // Run parallel targeted queries — one generic + three platform-specific
  const baseLocation = `${city} Zambia`
  const queries = [
    `${query} events ${baseLocation} 2026`,
    `career networking events ${baseLocation} site:linkedin.com OR site:meetup.com`,
    `career fair workshop conference ${baseLocation} 2026 site:facebook.com`,
    `${query} ${baseLocation} 2026 -filetype:pdf`,
  ]

  const runQuery = async (searchQuery: string, qIdx: number): Promise<any[]> => {
    try {
      const url = `${API_ENDPOINTS.googleCustomSearch}?key=${encodeURIComponent(getGoogleApiKey())}&cx=${encodeURIComponent(GOOGLE_CSE_ID)}&q=${encodeURIComponent(searchQuery)}&gl=zm&hl=en&num=10`
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 12000)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (!res.ok) return []
      const data = await res.json() as any
      return (data.items || []).map((item: any, idx: number) => ({
        id: `gsearch-q${qIdx}-${idx}`,
        title: item.title?.replace(/\s*[|\-–]\s*.*$/, '').trim() || 'Event',
        eventType: inferEventType(item.title + ' ' + item.snippet),
        organizer: extractOrganizer(item.snippet) || 'TBC',
        dateLabel: extractDate(item.snippet, item.title) || 'Check website',
        dateIso: null,
        location: city,
        description: item.snippet?.slice(0, 200) || '',
        url: item.link || null,
        source: item.link?.includes('facebook.com') ? 'facebook'
             : item.link?.includes('linkedin.com') ? 'linkedin'
             : item.link?.includes('eventbrite.com') ? 'eventbrite'
             : item.link?.includes('meetup.com') ? 'meetup'
             : 'google-search',
        tags: inferTags(item.link || '', item.title || ''),
        isOnline: (item.snippet + item.title).toLowerCase().includes('online') || (item.snippet + item.title).toLowerCase().includes('virtual'),
      }))
    } catch { return [] }
  }

  try {
    const results = await Promise.all(queries.map((q, i) => runQuery(q, i)))
    const seen = new Set<string>()
    const events: any[] = []
    for (const batch of results) {
      for (const e of batch) {
        const key = (e.title || '').toLowerCase().trim()
        if (key && !seen.has(key)) { seen.add(key); events.push(e) }
      }
    }
    logger.endTimer('google-events', 'google-search', { count: events.length })
    return events
  } catch (err: any) {
    if (err.name === 'AbortError') {
      logger.warn('google-events', 'Request timed out')
    } else {
      logger.error('google-events', `Error: ${err.message}`)
    }
    return []
  }
}

function inferTags(url: string, title: string): string[] {
  const tags: string[] = []
  if (url.includes('facebook.com')) tags.push('facebook')
  if (url.includes('linkedin.com')) tags.push('linkedin')
  if (url.includes('eventbrite.com')) tags.push('eventbrite')
  if (url.includes('meetup.com')) tags.push('meetup')
  if (tags.length === 0) tags.push('web')
  const t = title.toLowerCase()
  if (t.includes('career') || t.includes('job')) tags.push('career')
  if (t.includes('engineering') || t.includes('tech')) tags.push('tech')
  if (t.includes('workshop')) tags.push('workshop')
  if (t.includes('conference')) tags.push('conference')
  return tags
}

function inferEventType(text: string): string {
  const t = text.toLowerCase()
  if (t.includes('conference')) return 'conference'
  if (t.includes('workshop')) return 'workshop'
  if (t.includes('career') || t.includes('job') || t.includes('fair')) return 'career-expo'
  if (t.includes('hackathon')) return 'hackathon'
  if (t.includes('webinar') || t.includes('online')) return 'webinar'
  if (t.includes('meetup') || t.includes('networking')) return 'meetup'
  if (t.includes('seminar')) return 'seminar'
  return 'other'
}

function extractOrganizer(text: string): string | null {
  const patterns = [
    /by\s+([A-Z][A-Za-z\s&]+?)(?:\s+|\.|,|;|$)/,
    /from\s+([A-Z][A-Za-z\s&]+?)(?:\s+|\.|,|;|$)/,
    /hosted\s+by\s+([A-Z][A-Za-z\s&]+?)(?:\s+|\.|,|;|$)/,
  ]
  for (const p of patterns) {
    const m = text?.match(p)
    if (m) return m[1].trim().slice(0, 60)
  }
  return null
}

function extractDate(text: string, title: string): string | null {
  const combined = `${title} ${text}`
  const patterns = [
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i,
  ]
  for (const p of patterns) {
    const m = combined.match(p)
    if (m) return m[1]
  }
  return null
}

// ===== PREDICTHQ + LOCATIONIQ FETCHER =====
async function geocodeWithLocationIQ(locationName: string): Promise<{ lat: number; lon: number } | null> {
  if (!LOCATIONIQ_KEY_POOL.length) {
    logger.warn('locationiq', 'No LocationIQ token configured')
    return null
  }
  try {
    const url = `${API_ENDPOINTS.locationiq}?key=${getLocationIQToken()}&q=${encodeURIComponent(locationName)}&format=json&limit=1`
    const res = await fetch(url)
    if (!res.ok) {
      logger.warn('locationiq', `Geocode failed: ${res.status}`)
      return null
    }
    const data = await res.json() as any
    if (!Array.isArray(data) || data.length === 0) {
      logger.warn('locationiq', 'No geocode results')
      return null
    }
    const { lat, lon } = data[0]
    logger.info('locationiq', `Geocoded "${locationName}" → (${lat}, ${lon})`)
    return { lat: parseFloat(lat), lon: parseFloat(lon) }
  } catch (err: any) {
    logger.error('locationiq', `Error: ${err.message}`)
    return null
  }
}

async function fetchPredicthqEvents(
  query: string,
  interests: string
): Promise<any[]> {
  logger.startTimer('predicthq')

  if (!PREDICTHQ_KEY_POOL.length) {
    logger.warn('predicthq', 'No PredictHQ token configured')
    return []
  }

  try {
    // First geocode the location
    const coords = await geocodeWithLocationIQ(query)
    if (!coords) {
      logger.warn('predicthq', 'Could not geocode location, skipping PredictHQ')
      return []
    }

    const url = new URL(API_ENDPOINTS.predicthq)
    url.searchParams.append('category', 'conferences,expos,community,concerts,performing-arts,sports,festivals')
    url.searchParams.append('within', '50km@' + coords.lat + ',' + coords.lon)
    if (interests) {
      url.searchParams.append('q', interests)
    }
    url.searchParams.append('sort', 'start')
    url.searchParams.append('limit', '20')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${getPredictHQToken()}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      logger.warn('predicthq', `API returned ${res.status}`)
      return []
    }

    const data = await res.json() as any
    const events = (data.results || []).map((e: any, idx: number) => {
      const startDate = e.start ? e.start.substring(0, 10) : ''
      const endDate = e.end ? e.end.substring(0, 10) : ''
      const dateLabel = endDate && endDate !== startDate ? `${startDate} – ${endDate}` : startDate
      
      return {
        id: e.id || `predicthq-${idx}-${Date.now()}`,
        title: e.title || 'Untitled Event',
        eventType: mapPredictHqCategory(e.category || 'conferences'),
        organizer: e.labels?.[0]?.label || e.entities?.[0]?.name || 'Various',
        dateLabel,
        dateIso: e.start || '',
        location: e.location?.[0] || query,
        description: e.description?.slice(0, 300) || '',
        url: e.external_id ? `https://predicthq.com/events/${e.id}` : '',
        source: 'predicthq',
        isOnline: false,
        tags: (e.labels || []).map((l: any) => l.label),
        latitude: e.location?.[1] || coords.lat,
        longitude: e.location?.[0] || coords.lon,
        relevance: 0.9,
      }
    })

    logger.endTimer('predicthq', 'predicthq-fetch', { count: events.length })
    return events
  } catch (err: any) {
    if (err.name === 'AbortError') {
      logger.warn('predicthq', 'Request timed out')
    } else {
      logger.error('predicthq', `Error: ${err.message}`)
    }
    return []
  }
}

function mapPredictHqCategory(phqCategory: string): string {
  const map: Record<string, string> = {
    concerts: 'cultural',
    'performing-arts': 'cultural',
    festivals: 'cultural',
    sports: 'sport',
    conferences: 'conference',
    expos: 'trade-fair',
    community: 'community',
  }
  return map[phqCategory] || 'conference'
}

// ===== TAVILY EVENT FETCHER =====
async function fetchTavilyEvents(query: string, apiKey: string): Promise<any[]> {
  logger.startTimer('tavily-events')
  if (!apiKey) return []
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 12000)
    const res = await fetch(API_ENDPOINTS.tavily, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 8,
        include_answer: false,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) {
      logger.warn('tavily-events', `API returned ${res.status}`)
      return []
    }
    const data = await res.json() as any
    const results = (data.results || []).map((r: any, idx: number) => ({
      id: `tavily-${idx}-${Date.now()}`,
      title: r.title || 'Event',
      eventType: inferEventType(r.title + ' ' + (r.content || '')),
      organizer: extractOrganizer(r.content || '') || extractOrganizer(r.title || '') || 'TBC',
      dateLabel: extractDate(r.content || '', r.title || '') || 'Check website',
      dateIso: null,
      location: '',
      description: (r.content || r.snippet || '').slice(0, 300),
      url: r.url || r.link || null,
      source: 'tavily',
      tags: ['web', 'unverified'],
      isOnline: (r.content || r.title || '').toLowerCase().includes('online'),
    }))
    logger.endTimer('tavily-events', 'tavily-fetch', { count: results.length })
    return results
  } catch (err: any) {
    if (err.name === 'AbortError') {
      logger.warn('tavily-events', 'Request timed out')
    } else {
      logger.error('tavily-events', `Error: ${err.message}`)
    }
    return []
  }
}

// ===== HANDLERS: NETWORKING EVENTS =====
// Multi-source: Google Search → Tavily → Gemini Search → Jina scraping → AI suggestions.
// Static DB fallback REMOVED — user wants only real web search results.
async function handleNetworkingEvents(body: any): Promise<Response> {
  try {
    const { location, interests, country, degree, careerGoals, skills, institution } = body

    const searchLocation =
      normalizeLocation(location || country || '') || 'Zambia'

    const profileLines = [
      degree      ? `Degree/Field: ${degree}` : null,
      institution ? `Institution: ${institution}` : null,
      skills      ? `Skills: ${skills}` : null,
      interests   ? `Industries of interest: ${interests}` : null,
      careerGoals ? `Career goals: ${careerGoals}` : null,
    ].filter(Boolean).join('\n')

    logger.info('networking-events', 'Fetching events', { searchLocation, profileLines })

    let realEvents: any[] = []

    // ── ATTEMPT 1: Google Custom Search for Zambian career events ──
    logger.info('networking-events', 'Attempt 1: Google Custom Search')
    const gEvents = await fetchGoogleEvents(
      searchLocation,
      interests ? `${interests} networking career` : 'career networking'
    )
    if (gEvents.length > 0) {
      const existingTitles = new Set(realEvents.map(e => e.title?.toLowerCase()?.trim()))
      const newEvents = gEvents.filter(e => {
        const title = (e.title || '').toLowerCase().trim()
        return title && !existingTitles.has(title)
      })
      realEvents.push(...newEvents)
      logger.info('networking-events', `Google Search added ${newEvents.length} events`)
    }

    // ── ATTEMPT 2: Tavily deep web search for Zambian events ──
    if (realEvents.length < 8) {
      logger.info('networking-events', 'Attempt 2: Tavily web search')
      const tavilyEvents = await fetchTavilyEvents(
        `${interests || 'career'} ${searchLocation} events`,
        getTavilyKey()
      )
      if (tavilyEvents.length > 0) {
        const existingTitles = new Set(realEvents.map(e => e.title?.toLowerCase()?.trim()))
        const newEvents = tavilyEvents.filter(e => {
          const title = (e.title || '').toLowerCase().trim()
          return title && !existingTitles.has(title)
        })
        realEvents.push(...newEvents)
        logger.info('networking-events', `Tavily added ${newEvents.length} events`)
      }
    }

    // ── ATTEMPT 3: Gemini Google Search grounding — two passes targeting social platforms ──
    if (realEvents.length < 8) {
      logger.info('networking-events', 'Attempt 3: Gemini Search grounding (social platforms)')

      const fieldHint = degree ? ` relevant to ${degree}` : ''
      const geminiGroundingPasses = [
        // Pass A — social platforms: Facebook, LinkedIn, Meetup
        `Search the web RIGHT NOW and find 6-8 REAL, upcoming career and professional events in ${searchLocation}${fieldHint}.

Look specifically on these platforms:
- facebook.com/events — search for "Lusaka career", "Zambia networking", "Lusaka workshop 2026"
- linkedin.com/events — search for Zambia or Lusaka professional events
- meetup.com — search for Lusaka or Zambia groups hosting events
- lu.sk (Lusaka event listings if any)

Rules:
- ONLY include events with a REAL confirmed date in 2025 or 2026
- ONLY include events with a REAL URL (facebook.com/events/..., linkedin.com/events/..., meetup.com/events/...)
- Do NOT invent events. If you cannot find real events, return an empty array []

Return ONLY a valid JSON array (no markdown, no explanation):
[{
  "id": "<url-slug>",
  "title": "<exact event title from the platform>",
  "eventType": "<career-expo|conference|workshop|meetup|seminar|hackathon|webinar|other>",
  "organizer": "<organiser or Facebook page / LinkedIn company name>",
  "dateLabel": "<e.g. 14 June 2026>",
  "dateIso": "<YYYY-MM-DD or null>",
  "location": "<city or Online>",
  "description": "<1 sentence from the event description>",
  "url": "<real direct URL — e.g. https://www.facebook.com/events/123456>",
  "source": "<facebook|linkedin|meetup>",
  "tags": ["<platform>", "<career|workshop|networking>"],
  "isOnline": false
}]`,

        // Pass B — Zambian professional bodies + local news
        `Search the web RIGHT NOW and find 4-6 REAL upcoming career, professional, and student events in ${searchLocation}${fieldHint}.

Check these Zambian sources:
- eiz.org.zm (Engineering Institution of Zambia — events, AGMs, seminars)
- zica.co.zm (Zambia Institute of Chartered Accountants — CPD events, workshops)
- zacci.co.zm (Zambia Chamber of Commerce — business events, trade fairs)
- unza.zm, cbu.ac.zm, mu.ac.zm (university career fairs, open days, graduation)
- lusakatimes.com, daily-mail.co.zm, znbc.co.zm (local news event announcements)

Rules:
- ONLY include events with a confirmed real date in 2025 or 2026
- Include the URL to the source page where the event is listed
- Do NOT invent events. Return [] if none found.

Return ONLY a valid JSON array with the same schema as above.`,
      ]

      const parseGroundingResponse = (raw: string): any[] => {
        try {
          const data = extractJSON<any>(raw)
          const replyText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
          const match = replyText.match(/\[[\s\S]*\]/)
          if (!match) return []
          const parsed = JSON.parse(match[0])
          if (!Array.isArray(parsed)) return []
          return parsed
        } catch { return [] }
      }

      const geminiModels = [MODELS.generation.primary, MODELS.generation.fallback]
      const keysToTry = await getGeminiKeysForRequest()
      const groundingKey = keysToTry[0] || GEMINI_API_KEY

      for (const [passIdx, searchPrompt] of geminiGroundingPasses.entries()) {
        try {
          let geminiRes: Response | null = null
          for (const model of geminiModels) {
            try {
              const url = `${API_ENDPOINTS.gemini}/${model}:generateContent?key=${encodeURIComponent(groundingKey)}`
              const controller = new AbortController()
              const timeoutId = setTimeout(() => controller.abort(), 50000)
              const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts: [{ text: searchPrompt }] }],
                  tools: [{ googleSearch: {} }],
                  generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
                }),
                signal: controller.signal,
              })
              clearTimeout(timeoutId)
              if (res.status === 429) {
                logger.warn('networking-events', `${model} 429 on pass ${passIdx}, trying fallback model`)
                await new Promise(r => setTimeout(r, 1500))
                continue
              }
              if (res.ok) { geminiRes = res; break }
            } catch (err: any) {
              logger.warn('networking-events', `${model} grounding pass ${passIdx} error: ${err.message}`)
            }
          }

          if (geminiRes?.ok) {
            const parsed = parseGroundingResponse(await geminiRes.text())
            const existingTitles = new Set(realEvents.map(e => e.title?.toLowerCase()?.trim()))
            const newEvents = parsed.filter((e: any) => {
              const title = (e.title || e.eventName || e.name || '').toLowerCase().trim()
              return title && !existingTitles.has(title)
            })
            realEvents.push(...newEvents.map((e: any) => ({
              id: e.id || `gsearch-p${passIdx}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
              title: e.title || e.eventName || e.name || '',
              eventType: e.eventType || e.event_type || 'other',
              organizer: e.organizer || e.organiser || e.organization || 'TBC',
              dateLabel: e.dateLabel || e.date_label || e.date || 'TBC',
              dateIso: e.dateIso || e.date_iso || e.date || null,
              location: e.location || searchLocation,
              description: e.description || '',
              url: e.url || e.website || null,
              source: e.source || 'gemini-search',
              tags: Array.isArray(e.tags) ? e.tags : ['unverified'],
              isOnline: e.isOnline ?? e.is_online ?? false,
            })))
            logger.info('networking-events', `Gemini grounding pass ${passIdx} added ${newEvents.length} events`)
          }
        } catch (err: any) {
          logger.warn('networking-events', `Gemini grounding pass ${passIdx} failed: ${err.message}`)
        }
      }
    }

    // ── ATTEMPT 4: Jina scraping — Meetup, EIZ, ZACCI, ZICA ──
    if (realEvents.length < 5) {
      logger.info('networking-events', 'Attempt 4: Jina scraping (Meetup, local Zambian bodies)')
      try {
        const isZambia = /zambia|lusaka|ndola|kitwe|livingstone|copperbelt/i.test(searchLocation)
        const eventUrls = isZambia
          ? [
              `https://www.meetup.com/find/?keywords=lusaka+career&source=EVENTS`,
              'https://www.eiz.org.zm/events',
              'https://zacci.co.zm/events',
              'https://www.zica.co.zm/events',
            ]
          : [
              `https://www.meetup.com/find/?keywords=${encodeURIComponent(searchLocation.toLowerCase())}&source=EVENTS`,
            ]

        const scrapeOne = async (u: string): Promise<string> => {
          try {
            const txt = await jinaRead(u, 12000)
            return (txt && txt.length > 200) ? txt.slice(0, 1500) : ''
          } catch { return '' }
        }

        const scrapedPairs = await Promise.all(eventUrls.map(async u => ({ url: u, text: await scrapeOne(u) })))
        const scrapedTexts = scrapedPairs.filter(p => p.text)

        if (scrapedTexts.length > 0) {
          const webContext = scrapedTexts.map(p => `SOURCE: ${p.url}\n${p.text}`).join('\n\n---\n\n')
          const scrapePrompt = `Extract REAL events from this web content scraped from event listing sites. Return ONLY a valid JSON array.

Web content:
${webContext}

Location context: ${searchLocation}

Rules:
- Only extract events that clearly have a title, date, and organizer in the content
- If a URL is visible in the content for an event, include it
- Do NOT invent events not present in the content
- For Eventbrite events, the URL should be the eventbrite.com/e/... link
- For Meetup events, the URL should be the meetup.com/... link

Each event:
{
  "title": "...", "eventType": "<career-expo|conference|workshop|meetup|seminar|hackathon|webinar|other>",
  "organizer": "...", "dateLabel": "...", "dateIso": "<YYYY-MM-DD or null>",
  "location": "...", "description": "<1 sentence>", "url": "<direct event URL if found, else null>",
  "source": "<eventbrite|meetup|eiz|zab|zacci|scraped>", "tags": ["<platform>"], "isOnline": false
}`
          const result = await callGeminiWithFallback(
            'You are a data extraction assistant. Extract ONLY real events visible in the web content. Do not invent events.',
            scrapePrompt
          )
          const match = result.reply.match(/\[[\s\S]*\]/)
          if (match) {
            try {
              const parsed = JSON.parse(match[0])
              if (Array.isArray(parsed)) {
                const existingTitles = new Set(realEvents.map(e => e.title?.toLowerCase()?.trim()))
                const newEvents = parsed.filter((e: any) => {
                  const title = (e.title || '').toLowerCase().trim()
                  return title && !existingTitles.has(title)
                })
                realEvents.push(...newEvents)
                logger.info('networking-events', `Scraping added ${newEvents.length} events`)
              }
            } catch { /* silently skip */ }
          }
        }
      } catch (err: any) {
        logger.warn('networking-events', `Jina scraping failed: ${err.message}`)
      }
    }

    // ── LAST RESORT: Platform discovery cards (ONLY if zero real events found) ──
    // Instead of inventing events, give the user real links to search on
    // Facebook, LinkedIn, Meetup, EIZ, ZACCI etc. so they can find events themselves.
    if (realEvents.length === 0) {
      logger.warn('networking-events', 'Zero real events found. Serving platform discovery cards.')
      const city = searchLocation.replace(/,?\s*zambia/i, '').trim() || 'Lusaka'
      const q = encodeURIComponent(`${city} career networking 2026`)
      const fbQ = encodeURIComponent(`${city} career OR networking OR workshop`)
      realEvents = [
        {
          id: 'discover-facebook',
          title: `Search Facebook Events — "${city} Career & Networking"`,
          eventType: 'meetup',
          organizer: 'Facebook Events',
          dateLabel: 'Tap to browse upcoming events',
          dateIso: null,
          location: city,
          description: `Find career fairs, workshops and networking events near ${city} posted by Zambian companies, universities and professional groups on Facebook.`,
          url: `https://www.facebook.com/events/search/?q=${fbQ}`,
          source: 'facebook',
          tags: ['facebook', 'discovery'],
          isOnline: false,
        },
        {
          id: 'discover-linkedin',
          title: `LinkedIn Events — Professional Events in Zambia`,
          eventType: 'conference',
          organizer: 'LinkedIn Events',
          dateLabel: 'Tap to browse upcoming events',
          dateIso: null,
          location: city,
          description: `Browse upcoming webinars, conferences and professional development events in Zambia posted on LinkedIn.`,
          url: `https://www.linkedin.com/events/`,
          source: 'linkedin',
          tags: ['linkedin', 'discovery'],
          isOnline: false,
        },
        {
          id: 'discover-meetup',
          title: `Meetup Groups — "${city}" Career & Tech`,
          eventType: 'meetup',
          organizer: 'Meetup.com',
          dateLabel: 'Tap to browse upcoming events',
          dateIso: null,
          location: city,
          description: `Discover Lusaka-based Meetup groups hosting career, tech and professional networking events.`,
          url: `https://www.meetup.com/find/?keywords=${encodeURIComponent(city + ' career')}&source=EVENTS`,
          source: 'meetup',
          tags: ['meetup', 'discovery'],
          isOnline: false,
        },
        {
          id: 'discover-eiz',
          title: 'EIZ Events — Engineering Institution of Zambia',
          eventType: 'seminar',
          organizer: 'Engineering Institution of Zambia',
          dateLabel: 'Tap to see upcoming EIZ events',
          dateIso: null,
          location: 'Lusaka, Zambia',
          description: 'Seminars, AGMs and professional development events for engineers in Zambia.',
          url: 'https://www.eiz.org.zm/events',
          source: 'eiz',
          tags: ['engineering', 'professional'],
          isOnline: false,
        },
        {
          id: 'discover-zacci',
          title: 'ZACCI Events — Chamber of Commerce',
          eventType: 'trade-fair',
          organizer: 'Zambia Chamber of Commerce & Industry',
          dateLabel: 'Tap to see upcoming ZACCI events',
          dateIso: null,
          location: 'Lusaka, Zambia',
          description: 'Business networking events, trade fairs and breakfast meetings hosted by Zambia\'s Chamber of Commerce.',
          url: 'https://zacci.co.zm/events',
          source: 'zacci',
          tags: ['business', 'networking'],
          isOnline: false,
        },
        {
          id: 'discover-zica',
          title: 'ZICA Events — Institute of Chartered Accountants',
          eventType: 'training',
          organizer: 'Zambia Institute of Chartered Accountants',
          dateLabel: 'Tap to see upcoming ZICA events',
          dateIso: null,
          location: 'Lusaka, Zambia',
          description: 'CPD workshops, seminars and annual events for accounting and finance professionals in Zambia.',
          url: 'https://www.zica.co.zm/events',
          source: 'zica',
          tags: ['finance', 'professional'],
          isOnline: false,
        },
      ]
    }

    // ── AI ENRICHMENT: If we have real events, use AI to rank and personalize ──
    let finalEvents = realEvents
    if (realEvents.length > 0 && (GEMINI_KEY_POOL.length > 0 || GROQ_KEY_POOL.length > 0) && profileLines) {
      logger.info('networking-events', 'Enriching events with AI ranking')
      try {
        const enrichPrompt = `You are a career advisor. Rank these ${realEvents.length} real events by how well they match this student profile. Add a brief "whyAttend" sentence.

Student Profile:
${profileLines}

Events:
${JSON.stringify(realEvents.slice(0, 15).map(e => ({
  id: e.id,
  title: e.title,
  eventType: e.eventType,
  organizer: e.organizer,
  location: e.location,
  description: e.description,
})))}

Return ONLY a JSON array of objects with:
{ "id": "<same id as input>", "relevanceScore": <1-100>, "whyAttend": "<1 sentence>", "recommendedTags": ["<tag>"] }

Do not change the ids.`

        const enrichResult = await callGeminiWithFallback(
          'You are a career matching assistant. Return ONLY valid JSON.',
          enrichPrompt
        )
        const enrichMatch = enrichResult.reply.match(/\[[\s\S]*\]/)
        if (enrichMatch) {
          try {
            const enrichData = JSON.parse(enrichMatch[0])
            if (Array.isArray(enrichData)) {
              const enrichMap = new Map(enrichData.map((e: any) => [e.id, e]))
              finalEvents = realEvents.map((e: any) => {
                const enrich = enrichMap.get(e.id)
                return {
                  ...e,
                  relevanceScore: enrich?.relevanceScore ?? 50,
                  whyAttend: enrich?.whyAttend ?? e.description,
                  tags: enrich?.recommendedTags ? [...new Set([...(e.tags || []), ...enrich.recommendedTags])] : (e.tags || []),
                }
              }).sort((a: any, b: any) => (b.relevanceScore ?? 50) - (a.relevanceScore ?? 50))
              logger.info('networking-events', `AI enrichment applied to ${finalEvents.length} events`)
            }
          } catch { /* use unenriched events */ }
        }
      } catch (err: any) {
        logger.warn('networking-events', `AI enrichment failed: ${err.message}`)
      }
    }

    // ── Final normalise and return ──
    const normalised = finalEvents
      .map((e: any, i: number) => ({
        id:          (e.id || `event-${i}-${Date.now()}`).replace(/\s+/g, '-').toLowerCase(),
        title:       e.title || e.eventName || e.name || '',
        eventType:   e.eventType || e.event_type || 'other',
        organizer:   e.organizer || e.organiser || e.organization || 'TBC',
        dateLabel:   e.dateLabel || e.date_label || e.date || 'TBC',
        dateIso:     e.dateIso   || e.date_iso   || e.date || null,
        location:    e.location  || searchLocation,
        description: e.whyAttend || e.description || '',
        url:         e.url || e.website || null,
        source:      e.source || 'unknown',
        tags:        Array.isArray(e.tags) ? e.tags.slice(0, 4) : [],
        isOnline:    e.isOnline ?? e.is_online ?? false,
        relevanceScore: e.relevanceScore ?? 50,
      }))
      .filter((e: any) => !!e.title)

    logger.info('networking-events', 'Events ready', {
      total: normalised.length,
      googleSearch: gEvents.length,
      sources: [...new Set(normalised.map((e: any) => e.source))],
    })

    // Return structured response — mobile app handles both array and { events, sources, totalFound }
    const sources = [...new Set(normalised.map((e: any) => e.source))]
    return json({
      events: normalised,
      sources,
      totalFound: normalised.length,
    }, 200)
  } catch (error: any) {
    logger.error('networking-events', `Error: ${error.message}`)
    return json({ error: error?.message || 'Failed to find events' }, 500)
  }
}

// ===== HANDLERS: JOB MATCHING (Gemini-based, Adzuna-ready) =====
async function handleJobMatching(body: any): Promise<Response> {
  try {
    const { qualifications, interests, location } = body

    if (!qualifications?.trim()) {
      return json({ error: 'Qualifications are required' }, 400)
    }

    logger.info('job-matching', 'Starting job matching', { qualifications, interests, location })

    // Use Gemini to find and match jobs based on qualifications
    const prompt = `You are a career matching assistant for Zambian job seekers.

User Qualifications: ${qualifications}
${interests ? `Interests: ${interests}` : ''}
${location ? `Location: ${location}` : 'Location: Zambia'}

Task: Generate a list of 10-15 job opportunities that match these qualifications.

For each job provide:
1. title - Job title
2. company - Company name (use realistic Zambian/international companies)
3. industry - Industry sector
4. location - Where the job is based
5. description - 1-2 sentence description of the role
6. match_score - Score from 1-100 indicating how well qualifications match
7. key_skills - Array of 3-5 skills the role requires
8. salary_range - Estimated salary range (optional)

Sort by match_score descending (best matches first).

Return ONLY valid JSON as an array of job objects. Example:
[{"title": "Software Engineering Intern", "company": "Zamtel", "industry": "Telecom", "location": "Lusaka", "description": "...", "match_score": 85, "key_skills": ["Python", "SQL", "Teamwork"], "salary_range": "ZMW 5,000-8,000/month"}]`

    const result = await callGeminiWithFallback(
      'You are a career matching assistant. Generate realistic job matches based on qualifications.',
      prompt
    )

    let jobs: any[] = []
    try {
      const parsed = extractJSON<any[]>(result.reply)
      if (Array.isArray(parsed)) {
        jobs = parsed
      }
    } catch {
      logger.warn('job-matching', 'Could not parse job matches as JSON, returning raw text')
      jobs = []
    }

    const response = {
      jobs,
      totalMatches: jobs.length,
      model: result.model,
      rawResponse: jobs.length === 0 ? result.reply : undefined,
    }

    logger.info('job-matching', 'Jobs matched successfully', { count: response.totalMatches })
    return json(response, 200)
  } catch (error: any) {
    logger.error('job-matching', `Error: ${error.message}`)
    return json({ error: error?.message || 'Failed to match jobs' }, 500)
  }
}

// ===== HEALTH CHECK =====
async function handleHealthCheck(): Promise<Response> {
  const checks = {
    gemini: GEMINI_KEY_POOL.length > 0,
    groq: GROQ_KEY_POOL.length > 0,
    jina: true, // always available — no key needed
    googleCustomSearch: GOOGLE_KEY_POOL.length > 0 && !!GOOGLE_CSE_ID,
    tavily: TAVILY_KEY_POOL.length > 0,
    predicthq: PREDICTHQ_KEY_POOL.length > 0,
    locationiq: LOCATIONIQ_KEY_POOL.length > 0,
  }

  const keyCounts = {
    gemini: GEMINI_KEY_POOL.length,
    groq: GROQ_KEY_POOL.length,
    google: GOOGLE_KEY_POOL.length,
    tavily: TAVILY_KEY_POOL.length,
    predicthq: PREDICTHQ_KEY_POOL.length,
    locationiq: LOCATIONIQ_KEY_POOL.length,
  }

  const hasAiProvider = checks.gemini || checks.groq
  const status = hasAiProvider ? 'healthy' : 'degraded'

  const response = {
    status,
    timestamp: new Date().toISOString(),
    services: checks,
    keyCounts,
    note: !hasAiProvider
      ? 'Add GEMINI_API_KEY_1…4 (aistudio.google.com) or GROQ_API_KEY_1…4 (console.groq.com) to Supabase secrets to enable AI features.'
      : undefined,
  }

  logger.info('health-check', 'Health check performed', checks)

  return json(response, hasAiProvider ? 200 : 503)
}

// ═══════════════════════════════════════════════════════════════
// ===== AUTO-MIGRATION: create tables on first cold start =====
// Uses the direct postgres connection available in Supabase edge functions.
// Fully idempotent (IF NOT EXISTS) — safe to run on every cold start.
let _dbReady = false
async function ensureDatabase(): Promise<void> {
  if (_dbReady) return
  const dbUrl = Deno.env.get('SUPABASE_DB_URL')
  if (!dbUrl) return
  try {
    const sql = postgres(dbUrl, { prepare: false })

    // 1. cc_user_data (existing)
    await sql`
      CREATE TABLE IF NOT EXISTS public.cc_user_data (
        user_id            UUID        NOT NULL
                           REFERENCES auth.users(id) ON DELETE CASCADE,
        profile            JSONB,
        applications       JSONB       NOT NULL DEFAULT '[]'::jsonb,
        contacts           JSONB       NOT NULL DEFAULT '[]'::jsonb,
        saved_events       JSONB       NOT NULL DEFAULT '[]'::jsonb,
        documents          JSONB       NOT NULL DEFAULT '[]'::jsonb,
        letters            JSONB       NOT NULL DEFAULT '[]'::jsonb,
        interview_sessions JSONB       NOT NULL DEFAULT '[]'::jsonb,
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT cc_user_data_pkey PRIMARY KEY (user_id)
      )
    `
    await sql`ALTER TABLE public.cc_user_data ENABLE ROW LEVEL SECURITY`
    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename  = 'cc_user_data'
            AND policyname = 'Users own their data'
        ) THEN
          CREATE POLICY "Users own their data"
            ON public.cc_user_data FOR ALL
            USING  (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
        END IF;
      END $$
    `

    // 2. zambian_companies (new directory table with rich fields)
    await sql`
      CREATE TABLE IF NOT EXISTS public.zambian_companies (
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        town          TEXT NOT NULL,
        province      TEXT,
        address       TEXT,
        phone         TEXT,
        email         TEXT,
        website       TEXT,
        sector        TEXT,
        category      TEXT NOT NULL DEFAULT 'General',
        subcategory   TEXT NOT NULL DEFAULT 'General',
        industry      TEXT NOT NULL DEFAULT 'Other',
        description   TEXT,
        professions   TEXT,
        is_nationwide BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT zambian_companies_unique UNIQUE (name, town)
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_zambian_companies_town ON public.zambian_companies(town)`
    await sql`CREATE INDEX IF NOT EXISTS idx_zambian_companies_industry ON public.zambian_companies(industry)`
    await sql`CREATE INDEX IF NOT EXISTS idx_zambian_companies_category ON public.zambian_companies(category)`
    await sql`CREATE INDEX IF NOT EXISTS idx_zambian_companies_province ON public.zambian_companies(province)`
    await sql`CREATE INDEX IF NOT EXISTS idx_zambian_companies_sector ON public.zambian_companies(sector)`
    await sql`ALTER TABLE public.zambian_companies ENABLE ROW LEVEL SECURITY`
    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename  = 'zambian_companies'
            AND policyname = 'Public read zambian companies'
        ) THEN
          CREATE POLICY "Public read zambian companies"
            ON public.zambian_companies FOR SELECT
            TO anon, authenticated
            USING (true);
        END IF;
      END $$
    `

    await sql.end()
    _dbReady = true
    logger.info('db-init', 'Database tables ready (cc_user_data + zambian_companies)')
  } catch (err: any) {
    logger.warn('db-init', `Auto-migration skipped: ${err?.message ?? err}`)
  }
}

// ===== MAIN HANDLER =====
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    if (req.url.endsWith('/health')) {
      return await handleHealthCheck()
    }

    const body = await req.json()
    const action = body?.action as string | undefined

    // Log incoming request
    logger.info('ai-service', `Request received: POST /functions/v1/ai-service`)
    logger.info('ai-service', `Action invoked: ${action}`)

    if (!action) {
      throw new ValidationError('Missing body.action')
    }

    switch (action) {
      case 'profile-chat':
        return await handleProfileChat(body)
      case 'hybrid-chat':
        return await handleHybridChat(body)
      case 'embed':
        return await handleEmbedding(body)
      case 'similarity-search':
        return await handleSimilaritySearch(body)
      case 'draft-letter':
        return await handleDraftLetter(body)
      case 'discover-companies':
        return await handleDiscoverCompanies(body)
      case 'interview-questions':
        return await handleInterviewQuestions(body)
      case 'research-company':
        return await handleResearchCompany(body)
      case 'extract-content':
        return await handleExtractContent(body)
      case 'star-feedback':
        return await handleStarFeedback(body)
      case 'interview-verdict':
        return await handleInterviewVerdict(body)
      case 'parse-profile-from-cv':
        return await handleParseProfileFromCv(body)
      case 'networking-events':
        return await handleNetworkingEvents(body)
      case 'job-matching':
        return await handleJobMatching(body)
      case 'company-chat':
        return await handleCompanyChat(body)
      case 'letter-chat':
        return await handleLetterChat(body)
      case 'event-chat':
        return await handleEventChat(body)
      case 'profile-merge':
        return await handleProfileMerge(body)
      case 'generate-profession-keywords':
        return await handleGenerateProfessionKeywords(body)
      case 'event-prep-brief':
        return await handleEventPrepBrief(body)
      case 'event-followup-draft':
        return await handleEventFollowupDraft(body)

      default:
        throw new ValidationError(`Unknown action: ${action}`)
    }
  } catch (error: any) {
    const statusCode = error?.statusCode ?? 500
    const errorCode = error?.code ?? 'UNKNOWN_ERROR'
    const message = error?.message || 'Internal Server Error'

    logger.error('ai-service', `Unhandled error: ${message}`, {
      code: errorCode,
      status: statusCode,
    })

    return json(
      {
        error: message,
        code: errorCode,
        timestamp: new Date().toISOString(),
      },
      statusCode
    )
  }
})

// ═════════════════════════════════════════════════════════════════
// GENERATE PROFESSION KEYWORDS — Groq turns a degree into a list of job titles
// ═══════════════════════════════════════════════════════════════════════════

async function handleGenerateProfessionKeywords(body: any): Promise<Response> {
  const degree = (body.degree ?? '').toString().trim()
  const skills = (body.skills ?? '').toString().trim()
  const careerGoals = (body.careerGoals ?? '').toString().trim()

  if (!degree) {
    return json({ error: 'Missing degree' }, 400)
  }

  try {
    const systemPrompt = `You are a Zambian career advisor. Given a student's degree, skills, and goals, list the EXACT job titles this qualification would realistically hold in the Zambian job market.

RULES:
- Return ONLY valid JSON. No markdown, no explanation.
- Output: { "keywords": string[], "jobTitles": string[] }
- "keywords" are short, specific search terms (lowercase, 1-3 words) for matching against company professions databases. Example: ["mechatronics", "automation", "robotics", "plc", "scada"]
- "jobTitles" are full job titles a company would list in their hiring profiles. Example: ["Mechatronics Engineer", "Automation Engineer", "Robotics Technician", "Control Systems Engineer"]
- Keep entries very specific to the degree. Don't add generic words like "systems", "management", "operations", "engineering" alone.
- If the user mentions a diploma or certificate in a trade, include those trade titles too.
- Do NOT include vague words like "leadership", "teamwork", "communication".
- Max 10 keywords and 10 job titles each.`

    const userPrompt = `Degree: ${degree}
${skills ? `Skills: ${skills}` : ''}
${careerGoals ? `Career Goals: ${careerGoals}` : ''}

Generate matching keywords and job titles.`

    const result = await callGroq(systemPrompt, userPrompt)
    const reply = result.reply

    let parsed: { keywords: string[]; jobTitles: string[] } = { keywords: [], jobTitles: [] }
    try {
      parsed = extractJSON(reply) as any
      if (!Array.isArray(parsed.keywords)) parsed.keywords = []
      if (!Array.isArray(parsed.jobTitles)) parsed.jobTitles = []
    } catch {
      logger.warn('generate-profession-keywords', 'Could not parse JSON, falling back to line extraction')
      const lines = reply.split('\n').map(l => l.trim()).filter(l => l && l.length > 2 && l.length < 60)
      parsed = { keywords: lines.slice(0, 10).map(l => l.toLowerCase()), jobTitles: [] }
    }

    return json({
      keywords: parsed.keywords,
      jobTitles: parsed.jobTitles,
      model: result.model,
    })
  } catch (err: any) {
    logger.warn('generate-profession-keywords', `Failed: ${err?.message ?? err}`)
    return json({
      error: err?.message || 'AI service failed',
      keywords: [],
      jobTitles: [],
    }, 500)
  }
}

// ═════════════════════════════════════════════════════════════════
// EVENT PREP BRIEF — Personalised preparation guide for an event
// ═════════════════════════════════════════════════════════════════

async function handleEventPrepBrief(body: any): Promise<Response> {
  const event = body.event ?? {}
  const userProfile = body.userProfile ?? {}
  const relevantCompanies: Array<{ name: string; industry?: string }> = body.relevantCompanies ?? []

  const eventTitle = (event.title ?? '').toString().trim()
  if (!eventTitle) return json({ error: 'Missing event.title' }, 400)

  const companyList = relevantCompanies.length > 0
    ? relevantCompanies.slice(0, 8).map(c => `- ${c.name}${c.industry ? ` (${c.industry})` : ''}`).join('\n')
    : null

  const systemPrompt = `You are a Zambian career advisor helping a student prepare for a professional networking event.

Write a PERSONALISED, practical prep brief. Be specific, actionable, and encouraging.
Avoid fluff. Speak directly to the student ("you", "your").

Structure your response with these sections (use plain text, no markdown headers or bullets):
1. Why this event matters for your career goals (2 sentences max)
2. What to prepare before you go (3–4 specific actions)
3. Who to target at this event (if company list is provided, mention those; otherwise suggest types)
4. Smart questions to ask (3 specific questions)
5. One quick follow-up action after the event

Keep total length to 300–400 words. No bullet points. Write in flowing paragraphs.`

  const userPrompt = `Student profile:
- Degree: ${userProfile.currentDegree || 'Not specified'}
- Career goals: ${userProfile.careerGoals || 'Not specified'}
- Skills: ${userProfile.skills || 'Not specified'}
- Institution: ${userProfile.institution || 'Not specified'}
- Preferred industries: ${userProfile.preferredIndustries || 'Not specified'}
${userProfile.displayName ? `- Name: ${userProfile.displayName}` : ''}

Event:
- Title: ${eventTitle}
- Type: ${event.eventType || 'event'}
- Organizer: ${event.organizer || 'Unknown'}
- Date: ${event.dateLabel || 'TBC'}
- Location: ${event.location || 'TBC'}
- Description: ${event.description ? event.description.substring(0, 300) : 'Not provided'}
- Tags: ${(event.tags ?? []).join(', ') || 'None'}

${companyList ? `Companies from their career target list that may attend:\n${companyList}` : ''}

Write their personalised prep brief now.`

  try {
    const result = await callGroq(systemPrompt, userPrompt)
    return json({ brief: result.reply, model: result.model })
  } catch (err: any) {
    // Fallback to Gemini if Groq fails
    try {
      const result = await callGemini(systemPrompt, userPrompt)
      return json({ brief: result.reply, model: result.model })
    } catch (fallbackErr: any) {
      logger.warn('event-prep-brief', `Failed: ${err?.message ?? err}`)
      return json({ error: err?.message || 'AI service failed' }, 500)
    }
  }
}

// ═════════════════════════════════════════════════════════════════
// EVENT FOLLOW-UP DRAFT — LinkedIn connection request or follow-up email
// ═════════════════════════════════════════════════════════════════

async function handleEventFollowupDraft(body: any): Promise<Response> {
  const event = body.event ?? {}
  const contactName = (body.contactName ?? '').toString().trim()
  const contactCompany = (body.contactCompany ?? '').toString().trim()
  const userProfile = body.userProfile ?? {}
  const draftType: 'linkedin' | 'email' = body.draftType === 'email' ? 'email' : 'linkedin'
  const context = (body.context ?? '').toString().trim()

  if (!contactName) return json({ error: 'Missing contactName' }, 400)
  if (!event.title) return json({ error: 'Missing event.title' }, 400)

  const isLinkedin = draftType === 'linkedin'

  const systemPrompt = isLinkedin
    ? `You are a Zambian career advisor helping a student write a LinkedIn connection request after a networking event.

The message must be:
- Short: 250–300 characters MAX (LinkedIn limit)
- Personal: reference the event and something specific
- Professional but warm
- End with a clear reason to connect
- NO subject line, NO signature, NO greeting like "Dear" — just the connection note text
- Written from the student's perspective`

    : `You are a Zambian career advisor helping a student write a follow-up email after a networking event.

The email must be:
- Subject line on the first line (format: "Subject: ...")
- 120–180 words total
- Reference the event and something specific they discussed or the student's interest
- Express genuine interest in learning more / staying in touch
- Professional closing with the student's name
- No generic phrases like "Hope this email finds you well"
- Written from the student's perspective`

  const userPrompt = `Student:
- Name: ${userProfile.displayName || 'the student'}
- Degree: ${userProfile.currentDegree || 'Not specified'}
- Career goals: ${userProfile.careerGoals || 'Not specified'}

They met: ${contactName}${contactCompany ? ` from ${contactCompany}` : ''}

At event: "${event.title}" by ${event.organizer || 'the organizer'} (${event.dateLabel || 'recently'}, ${event.location || 'Zambia'})

${context ? `Context / what they discussed: ${context}` : ''}

Draft the ${isLinkedin ? 'LinkedIn connection note' : 'follow-up email'} now.`

  try {
    const result = await callGroq(systemPrompt, userPrompt)
    return json({ draft: result.reply, model: result.model })
  } catch (err: any) {
    try {
      const result = await callGemini(systemPrompt, userPrompt)
      return json({ draft: result.reply, model: result.model })
    } catch (fallbackErr: any) {
      logger.warn('event-followup-draft', `Failed: ${err?.message ?? err}`)
      return json({ error: err?.message || 'AI service failed' }, 500)
    }
  }
}