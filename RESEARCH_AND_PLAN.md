# Career Campus — Networking & Companies Research & Plan

**Date:** 2026-05-25
**Status:** Research & Planning Phase
**Problem:** The Networking and Companies sections currently rely entirely on AI (Gemini/Groq) to generate results. This produces hallucinated or stale data. We need real, verifiable sources for networking events and company listings.

---

## 1. Current App Architecture (What Already Works)

### User Data Collected (Frontend → Supabase Auth + AsyncStorage)
The app already captures everything needed to make meaningful searches:

| Field | Data Type | Used For |
|-------|-----------|----------|
| `currentDegree` | string | Filtering companies by relevance to degree |
| `institution` | string | Context for networking events |
| `yearOfStudy` | string | Targeting right-level opportunities |
| `skills` | string | Matching against job requirements |
| `city` | string | Geolocation / search radius |
| `preferredIndustries` | string | Filtering by sector |
| `careerGoals` | string | AI prompt enrichment |
| `portfolioUrl` | string | Optional — could be used for matching |
| `profileFields` | array | Extra custom fields (jobs, skills) |
| `docs` | StoredDocument[] | CV text extraction for deeper matching |

**Key insight:** The user profile alone contains enough data to make targeted, specific queries. The issue is not "what to search" but "where to search."

---

## 2. Current Backend Implementation (Supabase Edge Function)

### File: `supabase/functions/ai-service/index.ts`

**How Networking Events currently work:**
1. Attempt 1: Gemini with Google Search grounding (`googleSearch: {}` tool) — searches the live web
2. Attempt 2: Jina AI web scraping of Eventbrite + Zambia-specific sites (`zab.co.zm`, `eiz.org.zm`)
3. Attempt 3: Plain AI generation (hallucination fallback)

**How Discover Companies currently works:**
1. Jina AI scrapes `znbc.co.zm/business/` or Wikipedia economy page for context
2. Prompts Gemini to generate 10-15 companies with full contact details
3. Returns JSON array

**AI Provider Chain:**
- Primary: Gemini 2.5 Flash (free tier via Google API)
- Fallback: Groq (llama-3.3-70b-versatile, free tier)
- File parsing: Gemini multimodal (PDF, DOCX, images)

**Why it fails:**
- Gemini Google Search grounding is unreliable — sometimes returns nothing, sometimes returns generic results
- Jina scraping is brittle — sites change layout, Eventbrite blocks scraping
- Plain AI generation produces fake companies/events with fake contact details
- No persistent database of verified companies/events
- No caching beyond 3-hour AsyncStorage TTL on the mobile app

---

## 3. Research: Existing Open-Source Apps & Tutorials

### GitHub Repos (React Native + Expo)
| Repo | What It Does | Gap vs Career Campus |
|------|--------------|---------------------|
| dmehra2102/React-Native-job-app | Job search via RapidAPI | No tracker, no AI matching, no events |
| GonzaloVolonterio/react-native-jobs-app | Job search with custom hooks | No WIL focus, no networking |
| maumercado/job-finder-react-native | Maps, swipe cards, push notifs | No student focus, no Zambian context |
| RockinRonE/jobs | Indeed API + swipe UX | US-centric, no AI matching |

**Conclusion:** No open-source repo combines job tracking + networking events + AI matching + student-focused WIL discovery. Career Campus is genuinely novel.

### YouTube Tutorials
- Traversy Media (2026) — React Native crash course
- JavaScript Mastery (2025) — Full-stack Expo + Supabase
- PedroTech (2026) — Expo Router
- Various — Job tracker tutorials exist but are generic

**Conclusion:** Tutorials teach individual skills (auth, lists, APIs). None teach the full pipeline of profile → AI query → real data → structured result.

---

## 4. Research: APIs & Data Sources

### 4.1 Job Search APIs (Freemium)

| Service | Free Tier | What It Does | Limitation |
|---------|-----------|--------------|------------|
| **Google Custom Search JSON API** | 100 queries/day | Search any site programmatically | 10 results/query, stops at 100/day |
| **SerpApi (Google Jobs API)** | 250 searches/month | Scrapes Google Jobs tab with structured data | Expensive beyond free tier |
| **JSearch via RapidAPI** | 200 requests/month | Job listings API | Limited to listed jobs, not all companies |
| **Serply.io** | 2,500 onboarding credits | Job search parsing | Credits run out |
| ~~Adzuna API~~ | ~~100 requests/day~~ | ~~Job listings by country~~ | ~~Removed per user decision~~ |

**Key finding:** Zambian job boards are the primary local source. International APIs have limited Zambia coverage.

### 4.2 Web Scraping (Free, No API Key)

| Source | What You Get | Reliability |
|--------|-------------|-------------|
| **gozambiajobs.com** | Zambian job listings | Good — established job board |
| **greatzambiajobs.com** | Zambian job listings | Good — established job board |
| **linkedin.com/jobs** | Professional listings | Blocks scraping, needs API |
| **Eventbrite** | Networking events | Blocks scraping, needs API |
| **zab.co.zm** | Zambia Association of Business events | Small, infrequent updates |
| **eiz.org.zm** | Engineering Institution of Zambia events | Professional body events |
| **ZNBC business pages** | News about companies | Not structured, news only |
| **Facebook Events** | Community events | Hard to scrape reliably |

**Key finding:** Zambian job boards (`gozambiajobs.com`, `greatzambiajobs.com`) are scrapable and contain real, current listings. No other app in our research uses these.

### 4.3 Networking Event APIs

| Service | Free Tier | What It Does |
|---------|-----------|--------------|
| **Eventbrite API** | 1,000 calls/day | Search events by location, category |
| **PredictHQ** | Limited free | Events database (sports, concerts, business) |
| **Google Calendar / Google Events** | Free | Scrapable via Google Search |
| **Meetup API** | Limited | Tech/professional meetups |

**Key finding:** Eventbrite has a real API with location-based search. This is the most reliable source for networking events.

### 4.4 AI + Search Grounding (Current Approach)

| Tool | What It Does | Limitation |
|------|-------------|------------|
| **Gemini Google Search grounding** | AI generates answers using live Google Search | Unreliable, sometimes returns nothing |
| **Jina AI (r.jina.ai)** | Converts any URL to clean text | Sites block it, layout changes break it |
| **Tavily API** | AI-optimized search results | Needs API key, free tier limited |
| **Serper API** | Google Search results as JSON | Needs API key, paid |

---

## 5. Brainstorm: Possible Approaches

### Approach A: Pure API Stack (Replace AI with Real APIs)
**Idea:** Stop using AI for discovery. Use real APIs + scraping.

**Networking Events:**
1. Eventbrite API — search by location + category
2. Scrape EIZ, ZACCI, Ndola Chamber for professional events
3. Cache results in Supabase DB (7-day TTL)

**Companies:**
1. Scrape gozambiajobs.com + greatzambiajobs.com daily
2. Google Custom Search for company verification
3. Store in Supabase DB with search indexing

**Pros:** Real data, no hallucination, faster
**Cons:** APIs have limits, scraping is fragile, doesn't leverage user profile for matching

### Approach B: AI-Assisted Enrichment (Keep AI, Add Real Sources)
**Idea:** Use AI to *synthesize* and *enrich*, but feed it real data as context.

**Networking Events:**
1. Fetch real events from Eventbrite API
2. Fetch real events from PredictHQ
3. Scrape local sources (eiz.org.zm, zab.co.zm)
4. Feed ALL raw data + user profile to Gemini
5. Ask Gemini to: deduplicate, rank by relevance, add descriptions, suggest which to attend

**Companies:**
1. Scrape gozambiajobs.com daily → raw job listings
2. Scrape company career pages for top 50 Zambian companies
3. Feed raw data + user profile to Gemini
4. Ask Gemini to: match to profile, generate fit scores, extract contact info

**Pros:** AI adds value (ranking, descriptions, matching) instead of hallucinating from scratch
**Cons:** More complex pipeline, still depends on AI for final output

### Approach C: Hybrid Database + AI (Recommended)
**Idea:** Build a persistent database of verified companies and events. AI is used only for matching and enrichment.

**Database Schema (Supabase PostgreSQL):**
```sql
-- Companies table (populated by scraping + manual curation)
create table companies (
  id uuid primary key,
  name text not null,
  industry text,
  location text,
  size text, -- Small/Medium/Large/Multinational
  website text,
  address text,
  phone text,
  email text,
  linkedin text,
  description text,
  verified boolean default false,
  source text, -- 'scraped', 'manual', 'user-submitted'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Job listings table (scraped from job boards)
create table job_listings (
  id uuid primary key,
  company_id uuid references companies(id),
  title text not null,
  type text, -- 'internship', 'attachment', 'graduate', 'full-time'
  location text,
  description text,
  requirements text[],
  url text,
  salary_range text,
  posted_at timestamptz,
  expires_at timestamptz,
  source text,
  raw_data jsonb
);

-- Events table (from Eventbrite + scraping)
create table events (
  id uuid primary key,
  title text not null,
  event_type text, -- 'career-expo', 'conference', etc.
  organizer text,
  date timestamptz,
  location text,
  description text,
  url text,
  source text,
  tags text[],
  is_online boolean,
  created_at timestamptz default now()
);

-- User-event interactions (saved, attended)
create table user_events (
  user_id uuid,
  event_id uuid,
  saved_at timestamptz,
  primary key (user_id, event_id)
);
```

**Pipeline:**
1. Daily cron job: scrape gozambiajobs.com → store in `job_listings`
2. Daily cron job: Eventbrite API → store in `events`
3. When user opens Companies tab:
   - Query DB for jobs in their location
   - Feed user's profile + matching jobs to Gemini
   - Gemini generates: fit scores, why it's a match, cover letter suggestions
   - Return structured JSON to frontend
4. When user opens Networking tab:
   - Query DB for upcoming events in their location
   - Feed profile + events to Gemini for ranking
   - Return ranked, enriched events

**Pros:**
- Real, verifiable data at the base
- AI adds genuine value (matching, ranking, enrichment)
- Fast queries (DB instead of AI generation)
- Works offline with cached data
- Can crowd-source: users can submit companies/events

**Cons:**
- Requires building scrapers
- Requires database maintenance
- More upfront work

### Approach D: Community + AI (Crowd-Sourced + AI Verified)
**Idea:** Let users submit companies and events, use AI to verify and enrich.

**Pipeline:**
1. User submits: "Company X in Kitwe hires engineering interns"
2. AI verification step:
   - Search web for Company X
   - Verify they exist, verify website
   - Extract contact details
   - Flag as "AI-verified" or "user-submitted (unverified)"
3. Store in shared database
4. All users benefit from community submissions

**Pros:** Scales without scraping, community engagement
**Cons:** Quality control needed, cold-start problem

---

## 6. Recommended Strategy

**Start with Approach C (Hybrid Database + AI), but bootstrap with Approach B (AI-Assisted Enrichment) for immediate results.**

### Phase 1: Immediate Fix (Week 1)
**Goal:** Make the existing AI-based discovery actually produce real results.

**Actions:**
1. Add Google Custom Search API as a real search source in the edge function
   - Before calling Gemini, search Google for: `"internship" "Lusaka" "engineering" site:gozambiajobs.com OR site:linkedin.com/jobs`
   - Pass the top 5 search results as context to Gemini
   - This grounds the AI in real data

2. Add Eventbrite API to networking events handler
   - Before AI generation, call Eventbrite API with user's location
   - Pass real events as context to Gemini
   - Gemini only enriches (adds descriptions, tags, relevance scores)

3. Add better prompt engineering
   - Instead of "find companies", say: "based on these real search results [paste], identify companies that match this profile"
   - Instruct AI: "if you cannot verify a company exists, set verified: false"

### Phase 2: Database Layer (Week 2-3)
**Goal:** Build persistent storage for verified data.

**Actions:**
1. Create `companies`, `job_listings`, `events` tables in Supabase
2. Build a Python scraper (or Deno edge function) that runs daily:
   - Scrape gozambiajobs.com
   - Scrape greatzambiajobs.com
   - Call Eventbrite API for Zambian cities
   - Store results in Supabase
3. Update frontend to query DB first, AI second

### Phase 3: AI Enrichment Layer (Week 3-4)
**Goal:** AI adds value on top of real data.

**Actions:**
1. When user opens Companies tab:
   - Query DB for jobs in their location + field
   - Feed results + user profile to Gemini
   - Gemini returns: fit scores, personalized descriptions, contact templates
2. When user opens Networking tab:
   - Query DB for upcoming events
   - Gemini ranks by relevance to user's profile
   - Suggests which events to prioritize

### Phase 4: Community Layer (Week 4+)
**Goal:** Let users contribute and benefit from each other.

**Actions:**
1. Add "Submit a Company" feature
2. Add "Submit an Event" feature
3. AI verification pipeline for user submissions
4. Gamification: points for verified submissions

---

## 7. Free API Keys & Resources Needed

| Service | Free Tier | How to Get Key |
|---------|-----------|---------------|
| Google Custom Search | 100 searches/day | Google Cloud Console → Programmable Search Engine |
| Eventbrite API | 1,000 calls/day | eventbrite.com → Developer Portal |
| ~~Adzuna API~~ | ~~Removed per user decision~~ | ~~Not used~~ |
| Groq API | Generous free tier | groq.com → Sign up |
| Gemini API | 1,500 requests/day | Google AI Studio → API Key |
| Jina AI | No key needed | Just use `r.jina.ai/{url}` |
| PredictHQ | Limited free | predicthq.com → Developer |
| Tavily | 1,000 calls/month | tavily.com → Sign up |

---

## 8. Technical Implementation Notes

### Where to add scrapers
**Option 1: Supabase Edge Functions (Deno)**
- Already using this for AI service
- Can add scheduled functions (cron)
- Limit: 150s execution time per request

**Option 2: Python scripts in `scripts/` folder**
- Can run locally or on a server
- More powerful scraping libraries (BeautifulSoup, Scrapy)
- Need to push data to Supabase

**Option 3: API Server (`artifacts/api-server`)**
- Already have Express backend
- Can add scraping endpoints
- Can schedule with cron jobs

**Recommendation:** Use the existing API server for scrapers. Add:
- `/api/scrape/jobs` — scrape job boards
- `/api/scrape/events` — fetch from Eventbrite
- `/api/ai/enrich` — call Gemini with real data
- Cron job (via `node-cron`) to run scrapers daily

### Prompt Engineering Template (for grounded AI)

```
You are a career advisor for Zambian students.

STUDENT PROFILE:
- Degree: {degree}
- Skills: {skills}
- Location: {location}
- Goals: {goals}

REAL DATA FROM THE WEB:
{search_results}

TASK: Based ONLY on the real data above, identify companies/events that match this student's profile.

RULES:
- Only include companies/events that appear in the real data
- If a company's website is not verified, mark it as "unverified"
- For each match, explain WHY it fits the student's profile
- Return structured JSON
```

---

## 9. Next Steps

### Phase 0: Collect API Keys (DO THIS FIRST — Stop here until done)

Before any backend or frontend changes can work, we need all API keys configured in Supabase Edge Function secrets.

**Priority order (most important first):**

| API Key | Why We Need It | How to Get It | Free Tier | Status |
|---------|---------------|---------------|-----------|--------|
| **EVENTBRITE_API_KEY** | Real networking events in Zambia | eventbrite.com/platform/api → Create app | 1,000 calls/day | ✅ Stored |
| **TAVILY_API_KEY** | Web search for companies when scraping fails | tavily.com → Sign up | 1,000 calls/month | ✅ Stored |
| **GOOGLE_API_KEY** + **GOOGLE_CSE_ID** | Google Custom Search for company verification | Google Cloud Console → Programmable Search Engine | 100 searches/day | ✅ Stored |
| **GROQ_API_KEY** | Fast AI fallback for enrichment | groq.com → Sign up | Generous free tier | ✅ Stored |
| **GEMINI_API_KEY** | AI enrichment + search grounding | Google AI Studio → API Key | 1,500 requests/day | ✅ Stored |

**Action checklist for user:**

- [x] ~~Sign up for Eventbrite API~~ — Done
- [x] ~~Get Google Custom Search Engine ID~~ — Done
- [x] ~~Sign up for Tavily~~ — Done
- [x] ~~Sign up for Groq~~ — Done
- [x] ~~Sign up for Gemini~~ — Done
- [x] ~~Store ALL keys in Supabase Edge Function secrets~~ — Done
- [​] **Deploy the edge function:**
  ```bash
  supabase functions deploy ai-service
  ```

**Note:** The app will still work without these keys — it falls back to AI-only suggestions. But results will be less reliable until real data sources are connected.

---

### Phase 1: Test & Validate Real Data Flow (After API keys are set)

1. **Test Eventbrite integration** — open Networking tab, tap "Discover Events", verify real Zambian events appear with "Verified · Eventbrite" badge
2. **Test company scraping** — open Companies tab, tap "Start Scan", verify job board data flows through with "Verified · Job Board" badge
3. **Test Tavily fallback** — temporarily disable scraping, verify Tavily web search still finds companies
4. **Test AI enrichment** — verify fit scores (1-100) and "whyGoodFit" descriptions are personalized to the student's profile
5. **Test graceful degradation** — verify the app still works with no API keys (AI fallback produces suggestions with amber badges)

### Phase 2: Database & Caching (Week 2)

1. **Add caching layer** — store scraped companies and events in Supabase DB with 24-hour TTL to avoid re-scraping on every app open
2. **Build cron job** — daily background job that refreshes the company/event cache from all sources
3. **Add offline support** — if no internet, show cached data from the last successful fetch

### Phase 3: Quality & Polish (Week 3)

1. **Add company verification** — when a company is found via scraping, use Google Search to verify the website/address exist
2. **Add event deduplication** — same event from multiple sources should appear once with merged metadata
3. **Add user feedback** — "This company no longer exists" / "This event was cancelled" buttons to flag bad data
4. **Improve error handling** — when a source fails, show the user which source failed and what fallback was used

### Phase 4: Community & Growth (Week 4+)

1. **Add "Submit a Company" feature** — users can submit companies they know offer WIL
2. **Add "Submit an Event" feature** — users can submit networking events
3. **AI verification pipeline** — verify user submissions before showing to others
4. **Gamification** — points/badges for verified submissions

---

## 10. Open Questions

- How many Zambian companies actually post jobs online? (Many may not have web presence)
- Is there a Zambia-specific professional network (like LinkedIn but local)?
- Can we partner with university career offices for verified company lists?
- What is the cost if we exceed free API tiers? (Likely <$10/month for early users)
- Should we add a "offline mode" where AI generates suggestions based purely on profile? (Useful when no internet)

---

*This document is a living reference. Update it as research progresses and decisions are made.*
