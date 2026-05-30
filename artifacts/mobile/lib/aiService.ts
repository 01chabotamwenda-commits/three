import { supabase } from './supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://pwphrlbpwxytswdaglem.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cGhybGJwd3h5dHN3ZGFnbGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMDg5MjQsImV4cCI6MjA5NDU4NDkyNH0.c4XSqAU8tDvAi8_9n2OuqPR0j2Ptjo_yMOOTDikhqrc';
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/ai-service`;

// ── Request queue ─────────────────────────────────────────────────────────────
// Serialise ALL AI requests so they never fire simultaneously.
// This is the primary defence against Gemini 503 rate-limit errors.

let _active = 0;
const _queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (_active < 1) {
    _active++;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => _queue.push(resolve));
}

function releaseSlot(): void {
  const next = _queue.shift();
  if (next) {
    next(); // hands the slot directly to the next waiter
  } else {
    _active--;
  }
}

// ── Retry with exponential backoff ────────────────────────────────────────────
// Retries automatically on transient 503/429/500 errors.

const RETRY_DELAYS = [2000, 4000, 8000]; // ms between attempts
const FETCH_TIMEOUT_MS = 15000; // fail faster than Supabase's 10-s timeout

function isRetryable(msg: string, status?: number): boolean {
  // 400 = client error, don't waste retries on it
  if (status === 400) return false;
  // Rate limits won't clear in 2-8 s — skip retries and surface the message immediately
  if (status === 429) return false;
  if (
    msg.includes('busy right now') ||
    msg.includes('AI is busy') ||
    msg.includes('rate limit') ||
    msg.includes('Rate limit') ||
    msg.includes('providers are currently busy')
  ) return false;
  return (
    msg.includes('500') ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('overload') ||
    msg.includes('timeout') ||
    msg.includes('AI service error')
  );
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as any)?.status;
      if (attempt < RETRY_DELAYS.length && isRetryable(msg, status)) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ── Friendly error parser ─────────────────────────────────────────────────────

function parseErrorMessage(status: number, body: string): string {
  if (status === 429) return 'AI is busy right now — please wait a moment and try again.';
  if (status === 503) return 'AI service is under high demand — please try again in a moment.';
  // For 500s, inspect the body before giving up — the real cause is often a 429 from a provider
  try {
    const data = JSON.parse(body) as { error?: string };
    if (typeof data.error === 'string') {
      const raw = data.error;
      if (raw.includes('503') || raw.includes('high demand') || raw.includes('UNAVAILABLE')) {
        return 'AI service is under high demand. Please try again in a moment.';
      }
      if (
        raw.includes('429') ||
        raw.includes('quota') ||
        raw.includes('RESOURCE_EXHAUSTED') ||
        raw.includes('Rate limit') ||
        raw.includes('rate limit') ||
        raw.includes('All AI providers failed')
      ) {
        return 'AI is busy right now — please wait a minute and try again.';
      }
      const firstLine = raw.split('\n')[0].replace(/[{}"\\]/g, '').trim();
      if (firstLine.length > 5) return firstLine.slice(0, 120);
    }
  } catch {
    // ignore parse errors
  }
  if (status === 500) return 'AI service error — please try again.';
  return `AI service error (${status}). Please try again.`;
}

// ── Core invoker ──────────────────────────────────────────────────────────────

async function invokeAI<T = unknown>(
  action: string,
  payload?: Record<string, unknown>,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<T> {
  return withRetry(async () => {
    await acquireSlot();
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const authToken = session?.access_token ?? SUPABASE_ANON_KEY;

      let res: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        res = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action, ...(payload ?? {}) }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (networkErr) {
        const errMsg = networkErr instanceof Error ? networkErr.message : String(networkErr);
        console.error(`[aiService] Network/timeout error calling ${action}:`, networkErr);
        if (errMsg.includes('abort') || errMsg.includes('AbortError') || errMsg.includes('timeout')) {
          throw new Error('AI service timed out — retrying automatically…');
        }
        throw new Error('Network error — check your connection and try again.');
      }

      const text = await res.text();

      if (!res.ok) {
        const msg = parseErrorMessage(res.status, text);
        console.error(`[aiService] ${action} ${res.status}:`, text.slice(0, 200));
        throw new Error(msg);
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        console.error('[aiService] Bad JSON from', action, text.slice(0, 200));
        throw new Error('Unexpected response from AI service. Please try again.');
      }
    } finally {
      releaseSlot();
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export const aiService = {
  profileChat: (payload: Record<string, unknown>) => {
    const messages = (payload.messages as Array<{ role: string; content: string }> | undefined) ?? [];
    const message =
      (payload.message as string | undefined) ??
      [...messages].reverse().find((m) => m.role === 'user')?.content ??
      messages[messages.length - 1]?.content;

    return invokeAI<{
      reply: string;
      isComplete: boolean;
      profileData?: Record<string, unknown>;
      partialProfile?: Record<string, unknown>;
    }>('profile-chat', {
      ...payload,
      ...(message ? { message } : {}),
    });
  },

  discoverCompanies: (payload: Record<string, unknown>) =>
    invokeAI<unknown[]>('discover-companies', payload, 60000),

  generateProfessionKeywords: (payload: { degree: string; skills?: string; careerGoals?: string }) =>
    invokeAI<{ keywords: string[]; jobTitles: string[] }>('generate-profession-keywords', payload, 25000),

  draftLetter: (payload: Record<string, unknown>) =>
    invokeAI<{ letter: string }>('draft-letter', payload, 45000),

  researchCompany: (payload: Record<string, unknown>) =>
    invokeAI<{ summary: string }>('research-company', payload),

  starFeedback: (payload: Record<string, unknown>) =>
    invokeAI<{ feedback: string }>('star-feedback', payload),

  interviewQuestions: (payload: Record<string, unknown>) =>
    invokeAI<{ personal: string[]; company: string[]; experience: string[] }>(
      'interview-questions',
      payload,
    ),

  parseProfileFromCv: (payload: Record<string, unknown>) =>
    invokeAI<Record<string, unknown>>('parse-profile-from-cv', payload),

  networkingEvents: (payload: Record<string, unknown>) =>
    invokeAI<unknown[]>('networking-events', payload),

  interviewVerdict: (payload: Record<string, unknown>) =>
    invokeAI<Record<string, unknown>>('interview-verdict', payload),

  extractContent: (payload: {
    fileContent: string;
    contentType: string;
    category: string;
  }) => invokeAI<{ extractedText: string }>('extract-content', payload, 60000),

  companyChat: (payload: {
    companyName: string;
    message: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    researchContext?: string;
  }) => invokeAI<{ reply: string; model: string }>('company-chat', payload),

  letterChat: (payload: {
    letterContent: string;
    message: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    company?: string;
    role?: string;
    letterType?: string;
    profile?: Record<string, unknown>;
  }) => invokeAI<{ reply: string }>('letter-chat', payload),

  eventChat: (payload: {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    event: Record<string, unknown>;
    userProfile?: Record<string, unknown>;
  }) => invokeAI<{ reply: string }>('event-chat', payload),

  profileMerge: (payload: Record<string, unknown>) =>
    invokeAI<{
      hasConflicts?: boolean;
      conflicts?: Array<{ field: string; existing: string; extracted: string; description: string }>;
      safeToAdd?: Array<{ label: string; value: string }>;
      conflictSummary?: string;
      reply?: string;
      mergeReady?: boolean;
      finalFields?: Array<{ label: string; value: string }>;
    }>('profile-merge', payload),

  eventPrepBrief: (payload: {
    event: { title: string; organizer: string; dateLabel: string; location: string; description?: string; eventType: string; tags?: string[] };
    userProfile: { displayName?: string; currentDegree: string; careerGoals: string; skills?: string; institution?: string; preferredIndustries?: string };
    relevantCompanies?: Array<{ name: string; industry?: string }>;
  }) => invokeAI<{ brief: string }>('event-prep-brief', payload as unknown as Record<string, unknown>, 30000),

  eventFollowupDraft: (payload: {
    event: { title: string; organizer: string; dateLabel: string; location: string };
    contactName: string;
    contactCompany: string;
    userProfile: { displayName?: string; currentDegree: string; careerGoals: string };
    draftType: 'linkedin' | 'email';
    context?: string;
  }) => invokeAI<{ draft: string }>('event-followup-draft', payload as unknown as Record<string, unknown>, 25000),
};
