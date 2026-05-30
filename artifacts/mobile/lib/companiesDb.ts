import { supabase } from './supabase';

export interface DbCompany {
  id: number;
  name: string;
  town: string;
  province: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  sector: string | null;
  category: string | null;
  subcategory: string | null;
  industry: string | null;
  description: string | null;
  professions: string | null;
  is_nationwide: boolean;
}

export interface CompanySearchResult {
  name: string;
  description: string;
  whyGoodFit?: string;
  fitScore: number;
  typesOfRoles?: string[];
  industry?: string;
  size?: string;
  website?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  linkedin?: string | null;
  source?: string;
  verified?: boolean;
  town?: string;
  province?: string | null;
  professionsMatch?: boolean;
  matchedRole?: string; // best-matching role for the user's profile
  professionProximity?: number; // how close the matched role is to the user's career
  companyProximity?: number; // combined proximity of ALL matching roles (uncapped, for tie-breaking)
}

const TOWN_ALIASES: Record<string, string[]> = {
  'lusaka': ['lusaka', 'lusaca', 'lusak', 'lusakaa', 'luska', 'lsk', 'lusaaka'],
  'kafue': ['kafue'],
  'chongwe': ['chongwe'],
  'chilanga': ['chilanga'],
  'rufunsa': ['rufunsa'],
  'luangwa': ['luangwa'],
  'chirundu': ['chirundu'],
  'kitwe': ['kitwe', 'ktwe', 'kitwee', 'kitwie', 'kiwe'],
  'ndola': ['ndola', 'ndla', 'ndoola', 'ndolaa', 'ndoha'],
  'chingola': ['chingola'],
  'mufulira': ['mufulira'],
  'kalulushi': ['kalulushi', 'chambishi'],
  'luanshya': ['luanshya'],
  'chambishi': ['chambishi'],
  'solwezi': ['solwezi', 'solwezzy', 'solwez', 'solwezii', 'solwezy'],
  'livingstone': ['livingstone'],
  'chipata': ['chipata'],
  'kabwe': ['kabwe'],
  'kasama': ['kasama'],
  'mongu': ['mongu'],
  'choma': ['choma'],
  'mazabuka': ['mazabuka'],
  'sesheke': ['sesheke'],
  'kaoma': ['kaoma'],
  'sinazongwe': ['sinazongwe'],
  'monze': ['monze'],
  'samfya': ['samfya'],
  'mansa': ['mansa'],
  'mwansabombwe': ['mwansabombwe'],
  'kawambwa': ['kawambwa'],
  'mpika': ['mpika'],
  'nakonde': ['nakonde'],
  'chinsali': ['chinsali'],
  'isoka': ['isoka'],
  'mbala': ['mbala'],
  'mwinilunga': ['mwinilunga'],
  'zambezi': ['zambezi'],
  'kasempa': ['kasempa'],
  'kabompo': ['kabompo'],
  'senanga': ['senanga'],
  'kalabo': ['kalabo'],
  'lukulu': ['lukulu'],
  'siavonga': ['siavonga'],
  'namwala': ['namwala'],
  'itexhi-tezhi': ['itexhi-tezhi', 'itezhi tezhi'],
  'kapiri mposhi': ['kapiri mposhi', 'kapiri'],
  'mkushi': ['mkushi'],
  'serenje': ['serenje'],
  'petauke': ['petauke'],
  'lundazi': ['lundazi'],
  'katete': ['katete'],
  'nyimba': ['nyimba'],
  'chililabombwe': ['chililabombwe'],
  'maamba': ['maamba'],
  'kansanshi': ['kansanshi'],
  'mungwi': ['mungwi'],
  'mpulungu': ['mpulungu'],
  'kaputa': ['kaputa'],
  'luwingu': ['luwingu'],
  'chama': ['chama'],
  'mumbwa': ['mumbwa'],
  'shibuyunji': ['shibuyunji'],
  'masaiti': ['masaiti'],
};

const ALL_TOWNS = Object.keys(TOWN_ALIASES);

/** Levenshtein edit distance for fuzzy matching */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function bestMatchTown(input: string): string {
  const clean = input.trim().toLowerCase().replace(/\s+/g, ' ');
  // Exact or alias match
  for (const [town, aliases] of Object.entries(TOWN_ALIASES)) {
    if (aliases.includes(clean)) return town;
  }
  // Fuzzy match: find closest town by edit distance
  let best = clean;
  let bestScore = Infinity;
  for (const town of ALL_TOWNS) {
    const dist = levenshtein(clean, town);
    const threshold = Math.max(2, Math.floor(town.length * 0.35));
    if (dist <= threshold && dist < bestScore) {
      best = town;
      bestScore = dist;
    }
  }
  return best;
}

function normalizeTown(input: string): string {
  return bestMatchTown(input);
}

/** Map search terms to the correct DB town field — e.g. "maamba" -> "sinazongwe" */
const ALIAS_TO_TOWN: Record<string, string> = {
  'maamba': 'sinazongwe',
};

function resolveTown(input: string): string {
  const matched = normalizeTown(input);
  const canonical = ALIAS_TO_TOWN[matched] || matched;
  return canonical;
}

/**
 * Region map — keys are normalised user inputs, values are the canonical DB
 * town names that belong to that region. Enables searches like "ndola-region"
 * or "greater lusaka" to return companies from all surrounding towns.
 */
const REGION_MAP: Record<string, string[]> = {
  'ndola-region':    ['ndola', 'masaiti', 'mufulira', 'luanshya', 'kalulushi', 'chambishi'],
  'kitwe-region':    ['kitwe', 'chingola', 'chililabombwe', 'kalulushi', 'chambishi', 'masaiti'],
  'lusaka-region':   ['lusaka', 'kafue', 'chilanga', 'chongwe', 'rufunsa', 'luangwa', 'chirundu'],
  'copperbelt':      ['ndola', 'kitwe', 'chingola', 'mufulira', 'luanshya', 'kalulushi', 'chambishi', 'chililabombwe', 'masaiti'],
  'solwezi-region':  ['solwezi', 'kansanshi', 'mwinilunga', 'zambezi', 'kabompo', 'kasempa'],
  'livingstone-region': ['livingstone', 'sesheke', 'siavonga', 'sinazongwe', 'kazungula'],
};

/** Aliases that all resolve to the same REGION_MAP key */
const REGION_ALIASES: Record<string, string> = {
  'ndola region': 'ndola-region',
  'greater ndola': 'ndola-region',
  'near ndola': 'ndola-region',
  'ndola area': 'ndola-region',
  'ndola surroundings': 'ndola-region',
  'kitwe region': 'kitwe-region',
  'greater kitwe': 'kitwe-region',
  'kitwe area': 'kitwe-region',
  'lusaka region': 'lusaka-region',
  'greater lusaka': 'lusaka-region',
  'lusaka area': 'lusaka-region',
  'copperbelt region': 'copperbelt',
  'the copperbelt': 'copperbelt',
  'solwezi region': 'solwezi-region',
  'solwezi area': 'solwezi-region',
  'livingstone region': 'livingstone-region',
  'livingstone area': 'livingstone-region',
};

function resolveRegion(input: string): string[] | null {
  const clean = input.toLowerCase().trim().replace(/\s+/g, ' ');
  const key = REGION_ALIASES[clean] ?? (REGION_MAP[clean] ? clean : null);
  return key ? (REGION_MAP[key] ?? null) : null;
}

/**
 * Province-level search — maps canonical province keys to the substring used to
 * match the DB `province` field (e.g. "Lusaka", "Copperbelt").
 * Supports inputs like "lusaka province", "lusaka-province", "southern province", etc.
 */
const ZAMBIA_PROVINCE_DB: Record<string, string> = {
  'lusaka':        'Lusaka',
  'copperbelt':    'Copperbelt',
  'southern':      'Southern',
  'eastern':       'Eastern',
  'western':       'Western',
  'northern':      'Northern',
  'north-western': 'North-Western',
  'northwestern':  'North-Western',
  'muchinga':      'Muchinga',
  'central':       'Central',
  'luapula':       'Luapula',
};

const PROVINCE_SEARCH_ALIASES: Record<string, string> = {
  'lusaka province': 'lusaka',        'lusaka-province': 'lusaka',
  'copperbelt province': 'copperbelt','copperbelt-province': 'copperbelt',
  'southern province': 'southern',    'southern-province': 'southern',
  'eastern province': 'eastern',      'eastern-province': 'eastern',
  'western province': 'western',      'western-province': 'western',
  'northern province': 'northern',    'northern-province': 'northern',
  'north-western province': 'north-western',   'north-western-province': 'north-western',
  'northwestern province': 'north-western',    'northwestern-province': 'north-western',
  'north western province': 'north-western',
  'muchinga province': 'muchinga',    'muchinga-province': 'muchinga',
  'central province': 'central',      'central-province': 'central',
  'luapula province': 'luapula',      'luapula-province': 'luapula',
};

/**
 * Returns the DB province string to filter on if the input is a province-level search,
 * or null if it's a city/region/country search.
 */
function resolveProvinceSearch(input: string): string | null {
  const clean = input.toLowerCase().trim().replace(/\s+/g, ' ');
  const key = PROVINCE_SEARCH_ALIASES[clean] ?? (ZAMBIA_PROVINCE_DB[clean] ? clean : null);
  return key ? (ZAMBIA_PROVINCE_DB[key] ?? null) : null;
}

function mapIndustryFilter(filter: string): string[] {
  const map: Record<string, string[]> = {
    'mining': ['Mining', 'Engineering'],
    'energy': ['Energy'],
    'tech': ['Tech', 'Telecom'],
    'telecom': ['Telecom'],
    'finance': ['Finance', 'Business'],
    'health': ['Healthcare'],
    'ngo': ['NGO', 'Business'],
    'manufactur': ['Manufacturing'],
    'education': ['Education'],
    'construction': ['Engineering', 'Construction'],
    'transport': ['Transport'],
    'food': ['Agriculture'],
    'legal': ['Legal'],
    'hospitality': ['Hospitality'],
    'agriculture': ['Agriculture'],
    'engineering': ['Engineering'],
    'government': ['Government'],
    'retail': ['Retail'],
    'environmental': ['Environmental'],
    'media': ['Media'],
    'automotive': ['Automotive'],
    'pharmaceutical': ['Pharmaceutical'],
    'utilities': ['Utilities'],
    'creative arts': ['Creative Arts'],
  };
  return map[filter] || [filter.charAt(0).toUpperCase() + filter.slice(1)];
}

/**
 * Search the zambian_companies table directly.
 * Returns local results or empty array if the table doesn't exist / is empty.
 */
// Country-level keywords — when the user searches at the country level,
// don't filter by town/province; return the full national dataset.
const COUNTRY_LEVEL_TERMS = new Set([
  'zambia', 'zam', 'zm', 'zambia, africa', 'zambia africa',
  'all zambia', 'whole zambia', 'entire zambia', 'nationwide',
]);

function isCountryLevelSearch(location: string): boolean {
  const clean = location.toLowerCase().trim().replace(/[.,]+$/, '');
  return COUNTRY_LEVEL_TERMS.has(clean) || clean === 'zambia';
}

// ─── Search-type-aware scoring helpers ───────────────────────────────────────

/** Sectors that are strong hosts for engineering attachment / internship / graduate roles.
 *  IMPORTANT: keep this list to genuinely technical/industrial sectors only.
 *  Do NOT add banks, hospitals, government, NGOs here — they are generic employers
 *  that appear in every result and inflate scores for non-relevant companies. */
const ENGINEERING_HOST_KEYWORDS = [
  'engineering', 'manufactur', 'mining', 'energy', 'power', 'electric', 'mechatron',
  'telecom', 'ict', 'information tech', 'construction', 'utilities', 'chemical',
  'process', 'refinery', 'petroleum', 'oil', 'plant', 'factory', 'workshop',
  'copper', 'smelter', 'metallurg', 'industrial', 'automation', 'robotics',
  'zesco', 'zamtel', 'airtel', 'mtn', 'huawei', 'liquid tech', 'paratus',
  'water supply', 'sewage', 'sanitation',
];

/** Patterns in company NAMES that indicate a generic public-sector body unlikely
 *  to offer meaningful engineering placements. These are filtered out for
 *  attachment / internship / graduate / jobs searches. */
const NOISE_NAME_PATTERNS = [
  'district commissioner', 'district council', 'district hospital',
  'district education board', 'district education board secretary',
  'zambia police', 'zampost', 'rural health', 'health post',
  'provincial education', 'ministry of', 'district health office',
  'zambia correctional', 'magistrate', 'ward councillor',
];

/**
 * Name fragments that identify a company as a PRIMARY HEALTHCARE PROVIDER —
 * a place whose core business is delivering medical care to patients.
 * These are distinct from health-adjacent companies (pharma, medical devices, etc.)
 * that DO hire engineers, accountants, and other non-medical staff regularly.
 */
const HEALTHCARE_FACILITY_PATTERNS = [
  'hospital', 'clinic', 'health centre', 'health center', 'medical centre',
  'medical center', 'dispensary', 'health post', 'maternity', 'hospice',
  'district health', 'rural health', 'community health',
];

/**
 * Degree keywords that indicate the user's PRIMARY profession is clinical/medical.
 * Used to decide whether a healthcare facility is relevant to them.
 */
const MEDICAL_DEGREE_KEYWORDS = [
  'medicine', 'nursing', 'pharmacy', 'clinical medicine', 'medical doctor',
  'physician', 'dentistry', 'dental surgery', 'physiotherapy', 'radiography',
  'optometry', 'public health', 'environmental health', 'midwifery',
  'allied health', 'health science', 'biomedical', 'speech therapy',
  'occupational therapy', 'clinical officer',
];

function isHealthcareFacility(c: any): boolean {
  const nameLower = (c.name || '').toLowerCase();
  return HEALTHCARE_FACILITY_PATTERNS.some(p => nameLower.includes(p));
}

function isMedicalProfession(degree: string, storedKeywords?: string[]): boolean {
  const d = degree.toLowerCase();
  if (MEDICAL_DEGREE_KEYWORDS.some(k => d.includes(k))) return true;
  if (storedKeywords && storedKeywords.length > 0) {
    const clinicalRoles = [
      'doctor', 'nurse', 'pharmacist', 'physician', 'surgeon', 'dentist',
      'physiotherapist', 'radiographer', 'optometrist', 'midwife', 'clinical officer',
      'medical officer', 'health officer',
    ];
    return clinicalRoles.some(r => storedKeywords.some(k => k.toLowerCase().includes(r)));
  }
  return false;
}

/** These are TRAINING institutions — not employers — so they should not appear as
 *  attachment / internship / graduate / job search results for an engineering student. */
const EDUCATION_INSTITUTION_KEYWORDS = [
  'university', 'college', 'school', 'academy', 'polytechnic', 'institute of tech',
  'technical college', 'primary', 'secondary', 'nursery', 'kindergarten', 'cbu',
  'unza', 'mulungushi', 'northrise', 'cavendish', 'chalimabana', 'evelyn hone',
  'nortec', 'zambia open university', 'zou', 'zambia centre for accountancy',
];

/** Volunteer-friendly organisations */
const VOLUNTEER_ORG_KEYWORDS = [
  'ngo', 'nonprofit', 'non-profit', 'foundation', 'trust', 'charity', 'aid',
  'development', 'community', 'church', 'mission', 'volunteer', 'relief', 'welfare',
  'social', 'advocacy', 'habitat', 'red cross', 'unicef', 'undp', 'who ', 'world food',
  'save the children', 'plan inter', 'world vision',
];

function companyTextFields(c: any): string {
  return [c.name, c.sector, c.industry, c.category, c.subcategory, c.description].filter(Boolean).join(' ').toLowerCase();
}

function isEducationInstitution(c: any): boolean {
  const text = companyTextFields(c);
  return EDUCATION_INSTITUTION_KEYWORDS.some(k => text.includes(k));
}

function isEngineeringHost(c: any): boolean {
  const text = companyTextFields(c);
  return ENGINEERING_HOST_KEYWORDS.some(k => text.includes(k));
}

function isVolunteerOrg(c: any): boolean {
  const text = companyTextFields(c);
  return VOLUNTEER_ORG_KEYWORDS.some(k => text.includes(k));
}

/** Returns true for generic public bodies that clutter engineering search results */
function isNoiseEntity(c: any): boolean {
  const nameLower = (c.name || '').toLowerCase();
  return NOISE_NAME_PATTERNS.some(p => nameLower.includes(p));
}

/**
 * Extract specific job titles from a degree string using AI-generated keywords.
 * Falls back to the user's stored professionKeywords if available, otherwise
 * returns a simple direct extraction (no hardcoded map).
 */
function extractJobTitlesFromDegree(degree: string, storedKeywords?: string[]): string[] {
  if (storedKeywords && storedKeywords.length > 0) return storedKeywords;
  if (!degree) return [];
  const d = degree.toLowerCase();
  const titles: string[] = [];
  // Only the most direct, unambiguous matches — no broad expansion
  if (d.includes('mechatronics')) titles.push('mechatronics engineer');
  if (d.includes('mechanical') && !d.includes('mechatronics')) titles.push('mechanical engineer');
  if (d.includes('electrical') && !d.includes('mechatronics')) titles.push('electrical engineer');
  if (d.includes('civil')) titles.push('civil engineer');
  if (d.includes('chemical') || d.includes('process')) titles.push('chemical engineer', 'process engineer');
  if (d.includes('software') || d.includes('computer')) titles.push('software developer', 'software engineer');
  if (d.includes('mining')) titles.push('mining engineer');
  if (d.includes('quantity survey')) titles.push('quantity surveyor');
  if (d.includes('accounting') || d.includes('accountancy')) titles.push('accountant');
  if (d.includes('law') || d.includes('legal')) titles.push('lawyer');
  if (d.includes('nursing') || d.includes('nurse')) titles.push('nurse');
  if (d.includes('medicine') || d.includes('medical doctor')) titles.push('medical doctor');
  if (d.includes('pharmacy')) titles.push('pharmacist');
  if (d.includes('architecture')) titles.push('architect');
  if (d.includes('agriculture') || d.includes('agronomy')) titles.push('agronomist');
  return titles;
}

/**
 * Check if any job title from the degree (or AI-generated keywords) appears
 * DIRECTLY in the company's professions field. Much stricter than loose keyword matching.
 */
function directProfessionMatch(professions: string | null, degree: string, storedKeywords?: string[]): boolean {
  if (!professions || !degree) return false;
  const profLower = professions.toLowerCase();
  const titles = extractJobTitlesFromDegree(degree, storedKeywords);
  return titles.some(t => profLower.includes(t));
}

/**
 * Compute a relevance score (0-100) based on what the user is actually looking for.
 *
 * Scoring tiers (attachment / internship / graduate / jobs):
 *  - directMatch + isHost  → 95-97  (specific title in professions AND relevant sector)
 *  - directMatch only      → 75-80  (specific title but generic sector)
 *  - broadMatch + isHost   → 55-60  (only loose keyword match but good sector)
 *  - broadMatch only       → 35-42  (loose keyword match, generic sector)
 *  - noiseEntity           → 5      (district councils, police, zampost etc.)
 *  - no match              → 15     (will be filtered out)
 */
function computeFitScore(
  c: any,
  professionMatch: boolean,
  directMatch: boolean,
  searchType: string,
  degree?: string,
  storedKeywords?: string[],
): number {
  const isEdu = isEducationInstitution(c);
  const isHost = isEngineeringHost(c);
  const isVol = isVolunteerOrg(c);
  const isNoise = isNoiseEntity(c);

  // ── Sector-mismatch scoring cap ───────────────────────────────────────────
  // Let the scoring system — not a hard exclusion — decide relevance based on
  // the user's actual degree/keywords. A healthcare facility should score near
  // zero for an engineer (and vice versa) so it naturally falls below the
  // MIN_SCORE_THRESHOLD. This works for ALL profession types, not just engineers.
  if (degree) {
    const userIsMedical = isMedicalProfession(degree, storedKeywords);
    const companyIsHealthFacility = isHealthcareFacility(c);

    if (companyIsHealthFacility && !userIsMedical) {
      // Non-medical student → primary care facility is not a suitable placement site
      // (they hire 1-2 engineers on contract; attachment/internship slots go to medical staff)
      return 8;
    }

    if (!companyIsHealthFacility && userIsMedical && isHost) {
      // Medical student in a pure industrial/engineering company (mine, factory, power plant)
      // that lists NO medical/health professions → not a relevant placement
      const hasMedicalRole = c.professions
        ? MEDICAL_DEGREE_KEYWORDS.some(k => c.professions.toLowerCase().includes(k))
        : false;
      if (!hasMedicalRole) return 10;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  switch (searchType) {
    case 'attachment':
    case 'internships': {
      if (isNoise) return 5;
      if (isEdu) return 10;
      if (directMatch && isHost) return 97;
      if (directMatch) return 82;
      if (professionMatch && isHost) return 78;  // precise title match in an engineering sector
      if (professionMatch) return 42;
      if (isHost) return 30;
      return 12;
    }
    case 'graduate': {
      if (isNoise) return 5;
      if (isEdu) return 12;
      if (directMatch && isHost) return 95;
      if (directMatch) return 80;
      if (professionMatch && isHost) return 76;  // precise title match in an engineering sector
      if (professionMatch) return 40;
      if (isHost) return 28;
      return 12;
    }
    case 'volunteer': {
      if (isVol && directMatch) return 95;
      if (isVol && professionMatch) return 82;
      if (isVol) return 70;
      if (directMatch) return 50;
      if (professionMatch) return 40;
      return 25;
    }
    default: { // jobs / browse
      if (isNoise) return 5;
      if (isEdu && !directMatch) return 30;
      if (directMatch && isHost) return 95;
      if (directMatch) return 80;
      if (professionMatch && isHost) return 62;
      if (professionMatch) return 45;
      return c.professions ? 35 : 20;
    }
  }
}

/** Minimum score a company must reach to be included in non-browse results.
 *  For attachment/internship/graduate this must be > 58 (the max score for
 *  broad-keyword-only matches) so that only companies with a DIRECT profession
 *  title match qualify. This prevents the broad PROFESSION_MAP expansion from
 *  flooding results with every company that mentions "systems" or "electrical". */
const MIN_SCORE_THRESHOLD: Record<string, number> = {
  attachment: 74,
  internships: 74,
  graduate: 74,
  jobs: 60,
  volunteer: 55,
  browse: 0,
};

/** Build search-type-specific role labels */
function buildTypedRoles(c: any, searchType: string, professions: string[]): string[] {
  const top = professions.slice(0, 3);
  switch (searchType) {
    case 'attachment':
      return top.length > 0
        ? top.map(r => `Attachment – ${r}`)
        : ['Industrial Attachment', 'WIL Placement', 'Student Trainee'];
    case 'internships':
      return top.length > 0
        ? top.map(r => `Intern – ${r}`)
        : ['Intern', 'Vacation Student', 'Student Intern'];
    case 'graduate':
      return top.length > 0
        ? top.map(r => `Graduate Trainee – ${r}`)
        : ['Graduate Trainee', 'Management Trainee', 'Junior Officer'];
    case 'volunteer':
      return top.length > 0
        ? top.map(r => `Volunteer – ${r}`)
        : ['Volunteer', 'Community Volunteer', 'Service Volunteer'];
    default:
      return professions.slice(0, 8);
  }
}

/** Build search-type-specific "why good fit" text */
function buildWhyGoodFit(c: any, searchType: string, professionMatch: boolean, professions: string[]): string {
  const loc = c.is_nationwide ? '(nationwide)' : c.town;
  const sector = c.sector || c.industry || c.category || 'company';
  const top3 = professions.slice(0, 3).join(', ');

  switch (searchType) {
    case 'attachment':
      if (professionMatch)
        return `${c.name} operates in ${sector} and can host you for industrial attachment in roles like ${top3 || 'your field'}.`;
      return `${c.name} — ${sector} in ${loc}. Contact their HR to enquire about industrial attachment / WIL placement.`;
    case 'internships':
      if (professionMatch)
        return `${c.name} hires for ${top3 || 'your field'} — strong candidate for a paid or unpaid internship.`;
      return `${c.name} — ${sector} in ${loc}. Worth approaching for internship opportunities suited to your degree.`;
    case 'graduate':
      if (professionMatch)
        return `${c.name} recruits ${top3 || 'graduates in your field'} — good fit for a graduate trainee application.`;
      return `${c.name} — ${sector} in ${loc}. May run graduate schemes — check their careers page.`;
    case 'volunteer':
      if (professionMatch)
        return `${c.name} accepts volunteers with skills in ${top3 || 'your field'}. Great way to build experience.`;
      return `${c.name} — ${sector} in ${loc}. Community-oriented organisation open to volunteers.`;
    default:
      if (professionMatch)
        return `${c.name} — hires ${top3 || 'in your field'}. Strong match for your profile!`;
      return `${c.name} — ${sector} in ${loc}. ${c.professions ? `Roles: ${c.professions.substring(0, 80)}${c.professions.length > 80 ? '…' : ''}.` : ''}`;
  }
}

export async function searchLocalCompanies(
  location: string,
  industryFilter?: string,
  userProfile?: { degree?: string; skills?: string; preferredIndustries?: string; goals?: string; professionKeywords?: string[] },
  limit?: number,
  searchType?: string,
): Promise<CompanySearchResult[]> {
  try {
    const provinceDbValue = resolveProvinceSearch(location);
    const regionTowns = provinceDbValue ? null : resolveRegion(location);
    const town = regionTowns ? regionTowns[0] : resolveTown(location);
    const countryWide = isCountryLevelSearch(location);
    const industries = industryFilter ? mapIndustryFilter(industryFilter.toLowerCase()) : [];

    let query = supabase
      .from('zambian_companies')
      .select('name, town, province, address, phone, email, website, sector, category, subcategory, industry, description, professions, is_nationwide')
      .order('is_nationwide', { ascending: false })
      .order('name');

    // Province search: filter directly by province field.
    // Region search: OR across all towns in the region.
    // City search: match town or province field.
    // Country search: no location filter.
    if (!countryWide) {
      if (provinceDbValue) {
        query = query.ilike('province', `%${provinceDbValue}%`);
      } else if (regionTowns && regionTowns.length > 1) {
        const townOr = regionTowns.map(t => `town.ilike.${t}`).join(',');
        query = query.or(townOr);
      } else {
        query = query.or(`town.ilike.${town},province.ilike.${town}`);
      }
    }

    // Province searches span large areas — raise the default cap to get more results.
    query = query.limit(provinceDbValue ? Math.max(limit ?? 30, 60) : (limit ?? 30));

    if (industries.length > 0) {
      const industryOr = industries.map(i => `industry.ilike.${i}`).join(',');
      query = query.or(industryOr);
    }

    const { data, error } = await query;

    if (error) {
      // Table may not exist yet or schema cache stale — silently return empty
      if (error.code === '42P01' || error.message.includes('schema cache')) return [];
      console.warn('[companiesDb] Supabase error:', error.message);
      return [];
    }

    if (!data || data.length === 0) return [];

    // Build profession keywords from user profile for matching
    const storedKeywords = userProfile?.professionKeywords;
    const professionKeywords = buildProfessionKeywords(userProfile);
    const degree = userProfile?.degree ?? '';
    const type = searchType ?? 'jobs';
    const minScore = MIN_SCORE_THRESHOLD[type] ?? 0;

    const scored = data.map((c: any) => {
      // Broad keyword match (expanded synonyms)
      const professionMatch = professionKeywords.length > 0 && c.professions
        ? professionKeywords.some(k => c.professions.toLowerCase().includes(k.toLowerCase()))
        : false;

      // Direct title match — uses AI-generated keywords if available, otherwise simple degree parsing
      const directMatch = directProfessionMatch(c.professions, degree, storedKeywords);

      const professions: string[] = c.professions
        ? c.professions.split(',').map((r: string) => r.trim()).filter(Boolean)
        : [];

      const fitScore = computeFitScore(c, professionMatch, directMatch, type, degree, storedKeywords);
      const whyGoodFit = buildWhyGoodFit(c, type, directMatch || professionMatch, professions);
      const typesOfRoles = buildTypedRoles(c, type, professions);
      const matchedRole = findMatchedRole(c.professions, userProfile);
      const professionProximity = computeProfessionProximity(matchedRole, userProfile);
      // Bonus: companies with MORE relevant roles (proximity > 0) get extra points
      const companyProximity = computeCompanyProximity(professions, degree, storedKeywords);
      const proximityBonus = Math.round(companyProximity * 0.10);
      const finalScore = Math.min(100, fitScore + proximityBonus);

      return {
        name: c.name,
        description: c.description || `${c.name} is a ${c.sector || c.category || c.subcategory || 'company'} in ${c.town}${c.is_nationwide ? ' with nationwide presence' : ''}.`,
        whyGoodFit,
        fitScore: finalScore,
        typesOfRoles,
        industry: c.industry || c.sector || 'Various',
        size: 'Unknown',
        website: c.website || null,
        address: c.address || c.town,
        phone: c.phone || null,
        email: c.email || null,
        linkedin: null,
        source: 'zambian-companies-db',
        verified: true,
        town: c.town,
        province: c.province,
        professionsMatch: directMatch || professionMatch,
        matchedRole,
        professionProximity,
        companyProximity,
      };
    });

    // Filter out noise entities (gov offices, hospitals, etc.) and low-scoring companies
    const filtered = scored.filter(r => {
      const isNoise = NOISE_NAME_PATTERNS.some(p => r.name.toLowerCase().includes(p));
      return !isNoise && r.fitScore >= minScore;
    });
    // Sort by fitScore, then by companyProximity (more relevant roles = higher), then professionProximity
    const sorted = filtered.sort((a, b) => {
      const scoreDiff = (b.fitScore ?? 0) - (a.fitScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const compDiff = (b.companyProximity ?? 0) - (a.companyProximity ?? 0);
      if (compDiff !== 0) return compDiff;
      return (b.professionProximity ?? 0) - (a.professionProximity ?? 0);
    });
    // Hard cap: never return more than 30 results to avoid overwhelming the user
    return sorted.slice(0, 30);
  } catch (err: any) {
    console.warn('[companiesDb] Unexpected error:', err.message);
    return [];
  }
}

/**
 * Post-retrieval validation pass — run AFTER local DB + AI results are merged.
 *
 * Purpose: AI-discovered companies arrive with whatever score the model assigned.
 * This step re-evaluates every result against the user's actual profile using the
 * same profession-mismatch rules as computeFitScore, so inflated AI scores
 * (e.g. a children's hospital scored 85 for an electrical engineer) get corrected
 * before the list is shown. Results that fall below minScore are removed.
 *
 * Called in companies.tsx for every non-browse search, on the complete merged list.
 */
export function validateResultsForProfile(
  results: CompanySearchResult[],
  userProfile: { degree?: string; professionKeywords?: string[] },
  searchType: string,
): CompanySearchResult[] {
  const degree = userProfile.degree ?? '';
  const storedKeywords = userProfile.professionKeywords;
  const minScore = MIN_SCORE_THRESHOLD[searchType] ?? 0;
  const userIsMedical = degree ? isMedicalProfession(degree, storedKeywords) : null;

  return results
    .map(r => {
      // Reconstruct a minimal company-like object so helper functions work correctly.
      // typesOfRoles (from DB) or roles returned by the AI act as the professions proxy.
      const c = {
        name: r.name,
        sector: r.industry ?? '',
        industry: r.industry ?? '',
        category: '',
        subcategory: '',
        description: r.description ?? '',
        professions: (r.typesOfRoles ?? []).join(', '),
      };

      let score = r.fitScore;

      // ── Sector-mismatch caps (mirrors computeFitScore logic) ──────────────
      if (userIsMedical === false && isHealthcareFacility(c)) {
        // Non-medical user → primary healthcare facility is not a relevant placement
        score = Math.min(score, 8);
      } else if (userIsMedical === true && isEngineeringHost(c)) {
        // Medical user → pure industrial host with no medical roles is not relevant
        const hasMedicalRole =
          (r.typesOfRoles ?? []).some(role =>
            MEDICAL_DEGREE_KEYWORDS.some(k => role.toLowerCase().includes(k))
          ) ||
          MEDICAL_DEGREE_KEYWORDS.some(k => (r.description ?? '').toLowerCase().includes(k));
        if (!hasMedicalRole) score = Math.min(score, 10);
      }

      // ── Noise entity cap ──────────────────────────────────────────────────
      if (isNoiseEntity(c)) score = Math.min(score, 5);

      return score !== r.fitScore ? { ...r, fitScore: score } : r;
    })
    .filter(r => r.fitScore >= minScore);
}

/** Words that appear in degree names but are too generic to be useful as profession keywords.
 *  "engineering" matches every engineer role at every company, defeating filtering. */
const DEGREE_STOPWORDS = new Set([
  'bachelor', 'master', 'doctor', 'phd', 'bsc', 'msc', 'meng', 'beng', 'bed',
  'honours', 'hons', 'degree', 'science', 'arts', 'technology', 'applied', 'advanced',
  'engineering', 'studies', 'management', 'general', 'pure', 'the', 'and', 'of', 'in',
  'with', 'for', 'from', 'international', 'national',
]);

function buildProfessionKeywords(userProfile?: { degree?: string; skills?: string; preferredIndustries?: string; goals?: string }): string[] {
  if (!userProfile) return [];
  const keywords: string[] = [];

  // Degree: only push individual tokens that are SPECIFIC field names (not generic academic terms)
  if (userProfile.degree) {
    userProfile.degree.split(/[,\s\+\/\(\)]+/).forEach(k => {
      const t = k.trim().toLowerCase().replace(/[^a-z]/g, '');
      if (t.length > 3 && !DEGREE_STOPWORDS.has(t)) keywords.push(t);
    });
  }

  const push = (s: string) => {
    s.split(/[,\s\+\/]+/).forEach(k => {
      const t = k.trim().toLowerCase();
      if (t.length > 2 && t !== 'and' && t !== 'of') keywords.push(t);
    });
  };
  if (userProfile.skills) push(userProfile.skills);
  if (userProfile.preferredIndustries) push(userProfile.preferredIndustries);
  if (userProfile.goals) push(userProfile.goals);
  // Expand keywords using PROFESSION_MAP for smart matching
  const expanded = new Set(keywords);
  for (const kw of keywords) {
    for (const [key, related] of Object.entries(PROFESSION_MAP)) {
      if (kw.includes(key) || key.includes(kw)) {
        related.forEach(r => expanded.add(r.toLowerCase()));
      }
    }
  }
  return [...expanded];
}

function findMatchedRole(
  companyProfessions: string | null,
  userProfile?: { degree?: string; skills?: string; preferredIndustries?: string; goals?: string; professionKeywords?: string[] },
): string | undefined {
  if (!companyProfessions || !userProfile) return undefined;
  const professions = companyProfessions.split(',').map(p => p.trim());
  const keywords = buildProfessionKeywords(userProfile);
  // Direct match first
  for (const prof of professions) {
    const profLower = prof.toLowerCase();
    for (const kw of keywords) {
      if (profLower.includes(kw) || kw.includes(profLower)) {
        return prof;
      }
    }
  }
  // Fuzzy match via PROFESSION_MAP
  for (const prof of professions) {
    const profLower = prof.toLowerCase();
    for (const [, related] of Object.entries(PROFESSION_MAP)) {
      for (const r of related) {
        const rLower = r.toLowerCase();
        if (profLower.includes(rLower) || rLower.includes(profLower)) {
          return prof;
        }
      }
    }
  }
  return undefined;
}

/**
 * Compute how close a single role is to the user's career path.
 * Returns 0-100 where 100 = exact degree match, 90 = 2nd keyword, 80 = 3rd keyword,
 * 60 = related via PROFESSION_MAP, 30 = broad keyword match.
 */
function computeRoleProximity(
  role: string,
  degree: string,
  storedKeywords: string[] | undefined,
): number {
  if (!role || !degree) return 0;
  const roleLower = role.toLowerCase();

  // Level 1: exact match with degree name
  const degreeName = degree.toLowerCase().replace(/[^a-z]/g, '');
  if (degreeName.length > 4 && roleLower.includes(degreeName)) return 100;

  // Level 2: match with stored keywords (priority based on position)
  const keywords = storedKeywords || [];
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i].toLowerCase();
    if (kw.length > 4 && roleLower.includes(kw)) {
      return 100 - (i * 10);
    }
  }

  // Level 3: PROFESSION_MAP related
  for (const [, related] of Object.entries(PROFESSION_MAP)) {
    for (const r of related) {
      const rLower = r.toLowerCase();
      if (roleLower.includes(rLower) || rLower.includes(roleLower)) {
        return 60;
      }
    }
  }

  return 30;
}

/**
 * Compute how close the best-matched role is to the user's career path.
 * Returns 0-100 where 100 = exact title match, 80 = closely related keyword match,
 * 60 = related via PROFESSION_MAP, 30 = broad keyword match.
 */
function computeProfessionProximity(
  matchedRole: string | undefined,
  userProfile?: { degree?: string; skills?: string; preferredIndustries?: string; goals?: string; professionKeywords?: string[] },
): number {
  if (!matchedRole || !userProfile) return 0;
  return computeRoleProximity(matchedRole, userProfile.degree ?? '', userProfile.professionKeywords);
}

/**
 * Compute overall proximity for a company by looking at ALL its professions.
 * Rewards companies that have MULTIPLE relevant roles.
 * Returns: maxProximity + (numMatchingRoles - 1) * 10
 */
function computeCompanyProximity(
  professions: string[],
  degree: string,
  storedKeywords: string[] | undefined,
): number {
  const proximities = professions
    .map(role => computeRoleProximity(role, degree, storedKeywords))
    .filter(p => p > 30);
  if (proximities.length === 0) return 0;
  const maxProx = Math.max(...proximities);
  const extraRoles = proximities.length - 1;
  return maxProx + extraRoles * 10;
}

/** Degree/keyword → related profession keywords.
 *  IMPORTANT: Do NOT add generic words like 'systems', 'power', 'energy',
 *  'industrial', 'management', 'operations' here — they match almost every
 *  company and make professionMatch useless as a filter signal. Keep entries
 *  to actual job TITLES or tight domain terms. */
const PROFESSION_MAP: Record<string, string[]> = {
  'mechatronics': ['mechatronics engineer', 'mechatronics', 'automation engineer', 'robotics engineer', 'control engineer', 'instrumentation engineer'],
  'mechanical': ['mechanical engineer', 'mechanical', 'mechatronics engineer', 'automotive engineer', 'maintenance engineer', 'plant engineer'],
  'electrical': ['electrical engineer', 'electronic engineer', 'electronics engineer', 'telecommunications engineer', 'telecom engineer'],
  'electronics': ['electronics engineer', 'electronic engineer', 'electrical engineer', 'telecommunications engineer', 'robotics engineer'],
  'civil': ['civil engineer', 'structural engineer', 'quantity surveyor', 'construction engineer'],
  'chemical': ['chemical engineer', 'process engineer', 'petroleum engineer', 'refinery engineer'],
  'environmental': ['environmental engineer', 'environmental health officer', 'health and safety officer', 'safety officer'],
  'mining': ['mining engineer', 'geologist', 'metallurgical engineer', 'mine geologist', 'minerals engineer'],
  'geology': ['geologist', 'mine geologist', 'mining engineer', 'minerals engineer'],
  'metallurgy': ['metallurgical engineer', 'metallurgist', 'mining engineer'],
  'computer': ['software developer', 'software engineer', 'programmer', 'network engineer', 'cybersecurity analyst'],
  'software': ['software developer', 'software engineer', 'programmer', 'cybersecurity analyst', 'data engineer'],
  'computer science': ['software developer', 'software engineer', 'data scientist', 'cybersecurity analyst'],
  'information technology': ['IT specialist', 'network engineer', 'software developer', 'cybersecurity analyst', 'systems administrator'],
  'accounting': ['accountant', 'audit', 'finance', 'financial', 'tax', 'bookkeeping'],
  'finance': ['finance', 'financial', 'accountant', 'economist', 'investment', 'banking'],
  'business': ['business', 'management', 'administration', 'HR', 'human resources', 'marketing', 'sales', 'operations'],
  'human resource': ['HR', 'human resources', 'personnel', 'recruitment', 'talent'],
  'marketing': ['marketing', 'communications', 'sales', 'public relations', 'brand', 'social media'],
  'journalism': ['journalist', 'media', 'communications', 'public relations', 'content', 'editor'],
  'media': ['media', 'journalist', 'communications', 'public relations', 'content', 'video', 'broadcast'],
  'law': ['lawyer', 'advocate', 'legal', 'corporate secretary', 'attorney', 'compliance', 'paralegal'],
  'nursing': ['nurse', 'clinical', 'health', 'care', 'midwife'],
  'medicine': ['doctor', 'physician', 'clinical', 'health', 'surgeon'],
  'clinical': ['clinical', 'nurse', 'health', 'midwife', 'care'],
  'public health': ['public health', 'environmental health', 'health promotion', 'epidemiology'],
  'environmental health': ['environmental health', 'public health', 'health promotion', 'safety'],
  'pharmacy': ['pharmacist', 'pharmaceutical', 'drug', 'clinical', 'health'],
  'biomedical': ['biomedical', 'biomedical engineer', 'medical', 'health technology', 'biotech'],
  'biotechnology': ['biotech', 'biotechnology', 'biomedical', 'microbiology', 'research', 'laboratory'],
  'microbiology': ['microbiology', 'biotech', 'biotechnology', 'laboratory', 'research', 'quality'],
  'biochemistry': ['biochemistry', 'biotech', 'biotechnology', 'laboratory', 'research', 'quality'],
  'statistics': ['statistician', 'data', 'data analyst', 'data scientist', 'research', 'economics'],
  'mathematics': ['mathematician', 'data', 'data analyst', 'statistician', 'research', 'economics'],
  'economics': ['economist', 'finance', 'financial', 'policy', 'research', 'data analyst'],
  'political science': ['political', 'policy', 'government', 'public', 'international', 'diplomacy'],
  'international relations': ['international', 'diplomacy', 'political', 'policy', 'government', 'public'],
  'public administration': ['public', 'government', 'policy', 'administration', 'management', 'civil service'],
  'development': ['development', 'NGO', 'project', 'programme', 'community', 'social'],
  'agriculture': ['agriculture', 'agricultural', 'agronomy', 'crop', 'livestock', 'fisheries', 'forestry'],
  'agricultural': ['agriculture', 'agricultural', 'agronomy', 'crop', 'livestock', 'fisheries'],
  'veterinary': ['veterinary', 'veterinarian', 'animal', 'livestock', 'health'],
  'forestry': ['forestry', 'forest', 'natural', 'environmental', 'conservation', 'agriculture'],
  'fisheries': ['fisheries', 'aquaculture', 'marine', 'water', 'agriculture', 'livestock'],
  'food science': ['food', 'nutrition', 'diet', 'quality', 'processing', 'food technology'],
  'nutrition': ['nutrition', 'diet', 'food', 'health', 'dietician', 'nutritionist'],
  'education': ['education', 'teacher', 'lecturer', 'tutor', 'school', 'training'],
  'teaching': ['teacher', 'lecturer', 'tutor', 'education', 'training', 'school'],
  'architecture': ['architecture', 'architect', 'building', 'design', 'urban', 'planning'],
  'urban planning': ['urban planning', 'urban', 'planner', 'architecture', 'design', 'landscape'],
  'surveying': ['surveyor', 'survey', 'geomatics', 'GIS', 'mapping', 'land', 'quantity'],
  'quantity survey': ['quantity surveyor', 'surveying', 'construction', 'cost', 'project'],
  'quantity surveying': ['quantity surveyor', 'surveying', 'construction', 'cost', 'project'],
  'logistics': ['logistics', 'supply chain', 'transport', 'procurement', 'warehouse', 'distribution'],
  'supply chain': ['supply chain', 'logistics', 'procurement', 'warehouse', 'distribution', 'transport'],
  'transport': ['transport', 'logistics', 'supply chain', 'fleet', 'driver', 'distribution'],
  'procurement': ['procurement', 'supply chain', 'logistics', 'purchasing', 'sourcing', 'warehouse'],
  'real estate': ['real estate', 'property', 'valuer', 'land', 'housing', 'survey'],
  'property': ['property', 'real estate', 'valuer', 'land', 'housing', 'survey'],
  'psychology': ['psychology', 'psychologist', 'counseling', 'mental', 'HR', 'social'],
  'sociology': ['sociology', 'social', 'community', 'development', 'NGO', 'research'],
  'social work': ['social work', 'social worker', 'community', 'development', 'NGO', 'counseling'],
  'anthropology': ['anthropology', 'anthropologist', 'social', 'community', 'research', 'culture'],
  'labour': ['labour', 'industrial', 'HR', 'human resources', 'employment', 'relations'],
  'industrial': ['industrial', 'labour', 'HR', 'human resources', 'employment', 'relations'],
  'relations': ['industrial', 'labour', 'HR', 'human resources', 'employment', 'relations'],
  'chemistry': ['chemist', 'chemistry', 'laboratory', 'research', 'quality', 'pharmaceutical'],
  'physics': ['physics', 'physicist', 'research', 'laboratory', 'radiation', 'nuclear', 'energy'],
  'welding': ['welder', 'welding', 'metal', 'fabrication', 'mechanical', 'construction'],
  'fabrication': ['metal', 'fabrication', 'welder', 'mechanical', 'construction'],
  'electrician': ['electrician', 'electrical', 'maintenance', 'power', 'energy'],
  'plumber': ['plumber', 'plumbing', 'maintenance', 'construction', 'building'],
  'carpentry': ['carpenter', 'carpentry', 'woodwork', 'construction', 'building'],
  'automotive': ['automotive', 'mechanical', 'mechatronics', 'mechanic', 'vehicle'],
  'refrigeration': ['refrigeration', 'HVAC', 'air conditioning', 'mechanical', 'maintenance'],
  'HVAC': ['HVAC', 'refrigeration', 'air conditioning', 'mechanical', 'maintenance'],
  'heavy equipment': ['heavy equipment', 'operator', 'plant', 'mining', 'construction'],
  'plant operator': ['heavy equipment', 'operator', 'plant', 'mining', 'construction'],
  'security': ['security', 'security officer', 'guard', 'police', 'safety', 'fire'],
  'cybersecurity': ['cybersecurity', 'cyber', 'security', 'IT', 'network', 'software', 'data'],
  'network': ['network', 'network engineer', 'networking', 'IT', 'telecom', 'communications'],
  'database': ['database', 'database administrator', 'DBA', 'data', 'IT', 'software'],
  'data science': ['data scientist', 'data science', 'data', 'machine learning', 'AI', 'analytics'],
  'machine learning': ['machine learning', 'AI', 'artificial intelligence', 'data', 'software', 'data scientist'],
  'artificial intelligence': ['AI', 'artificial intelligence', 'machine learning', 'data', 'software', 'data scientist'],
  'cloud': ['cloud', 'cloud computing', 'DevOps', 'infrastructure', 'IT', 'software'],
  'devops': ['DevOps', 'cloud', 'infrastructure', 'SRE', 'IT', 'software', 'systems'],
  'project management': ['project manager', 'project management', 'programme', 'operations', 'business'],
  'programme': ['programme', 'project', 'programme manager', 'operations', 'development', 'NGO'],
  'operations': ['operations', 'operations manager', 'business', 'management', 'project'],
  'risk': ['risk', 'risk manager', 'risk management', 'compliance', 'audit', 'finance'],
  'compliance': ['compliance', 'regulatory', 'legal', 'risk', 'audit', 'governance'],
  'governance': ['governance', 'compliance', 'regulatory', 'legal', 'risk', 'audit'],
  'audit': ['audit', 'auditor', 'internal audit', 'compliance', 'accountant', 'risk'],
  'records': ['records', 'records manager', 'archivist', 'documentation', 'information'],
  'archivist': ['archivist', 'records', 'documentation', 'library', 'information'],
  'library': ['library', 'librarian', 'information', 'records', 'documentation'],
  'GIS': ['GIS', 'geographic', 'geomatics', 'survey', 'mapping', 'GIS analyst'],
  'cartography': ['cartography', 'GIS', 'geomatics', 'survey', 'mapping', 'geography'],
  'metrology': ['metrology', 'metrologist', 'measurement', 'standards', 'quality', 'laboratory'],
  'quality': ['quality', 'quality assurance', 'QA', 'quality control', 'QC', 'laboratory', 'testing'],
  'radiation': ['radiation', 'radiographer', 'radiology', 'medical', 'health', 'nuclear'],
  'radiology': ['radiology', 'radiographer', 'radiation', 'medical', 'health', 'imaging'],
  'medical laboratory': ['medical laboratory', 'laboratory', 'medical', 'biomedical', 'microbiology', 'clinical'],
  'speech': ['speech', 'speech therapist', 'audiologist', 'language', 'communication', 'therapy'],
  'audiology': ['audiology', 'audiologist', 'speech', 'hearing', 'therapy', 'communication'],
  'optometry': ['optometry', 'optometrist', 'optician', 'eye', 'health', 'vision'],
  'optician': ['optician', 'optometry', 'optometrist', 'eye', 'health', 'vision'],
  'physiotherapy': ['physiotherapy', 'physiotherapist', 'rehabilitation', 'therapy', 'health', 'sports'],
  'rehabilitation': ['rehabilitation', 'physiotherapy', 'therapy', 'health', 'disability', 'social'],
  'occupational therapy': ['occupational therapy', 'occupational therapist', 'therapy', 'health', 'rehabilitation'],
  'pharmaceutical': ['pharmaceutical', 'pharmacist', 'pharmacy', 'drug', 'clinical', 'quality'],
  'clinical medicine': ['doctor', 'physician', 'clinical', 'medicine', 'health', 'surgery'],
  'surgery': ['surgeon', 'surgery', 'doctor', 'physician', 'clinical', 'health'],
  'dentistry': ['dentist', 'dental', 'oral', 'health', 'surgery'],
  'dental': ['dental', 'dentist', 'oral', 'health', 'hygiene'],
  'anesthesia': ['anesthesiologist', 'anesthesia', 'critical care', 'pain', 'medicine', 'surgery'],
  'pediatrics': ['pediatrician', 'pediatrics', 'child', 'medicine', 'health', 'surgery'],
  'obstetrics': ['obstetrician', 'obstetrics', 'gynecology', 'women', 'health', 'surgery'],
  'gynecology': ['gynecologist', 'gynecology', 'obstetrics', 'women', 'health', 'surgery'],
  'psychiatry': ['psychiatrist', 'psychiatry', 'mental', 'psychology', 'health', 'counseling'],
  'pathology': ['pathologist', 'pathology', 'laboratory', 'medical', 'diagnosis', 'research'],
  'forensic': ['forensic', 'forensic scientist', 'pathology', 'criminal', 'investigation', 'legal'],
  'neurology': ['neurologist', 'neurology', 'brain', 'nervous', 'medical', 'health'],
  'cardiology': ['cardiologist', 'cardiology', 'heart', 'medical', 'health', 'surgery'],
  'oncology': ['oncologist', 'oncology', 'cancer', 'medical', 'health', 'surgery'],
  'orthopedics': ['orthopedist', 'orthopedics', 'bones', 'surgery', 'medical', 'health'],
  'urology': ['urologist', 'urology', 'medical', 'health', 'surgery'],
  'nephrology': ['nephrologist', 'nephrology', 'kidney', 'medical', 'health', 'surgery'],
  'gastroenterology': ['gastroenterologist', 'gastroenterology', 'digestive', 'medical', 'health', 'surgery'],
  'endocrinology': ['endocrinologist', 'endocrinology', 'hormone', 'medical', 'health', 'surgery'],
  'dermatology': ['dermatologist', 'dermatology', 'skin', 'medical', 'health', 'surgery'],
  'ophthalmology': ['ophthalmologist', 'ophthalmology', 'eye', 'medical', 'health', 'surgery'],
  'otorhinolaryngology': ['ENT', 'otorhinolaryngology', 'ear', 'nose', 'throat', 'medical', 'health'],
  'emergency medicine': ['emergency', 'emergency medicine', 'paramedic', 'critical', 'trauma', 'medical'],
  'critical care': ['critical care', 'intensive care', 'ICU', 'emergency', 'medicine', 'health'],
  'intensive care': ['critical care', 'intensive care', 'ICU', 'emergency', 'medicine', 'health'],
  'family medicine': ['family medicine', 'general practice', 'GP', 'primary care', 'health', 'medicine'],
  'general practice': ['general practice', 'GP', 'family medicine', 'primary care', 'health', 'medicine'],
  'geriatrics': ['geriatrics', 'geriatric', 'elderly', 'medicine', 'health', 'care'],
  'palliative': ['palliative', 'palliative care', 'hospice', 'care', 'medicine', 'health'],
  'sports medicine': ['sports medicine', 'sports', 'athletic', 'rehabilitation', 'physiotherapy', 'health'],
  'tourism': ['tourism', 'tour', 'hospitality', 'hotel', 'travel', 'guide', 'event'],
  'hospitality': ['hospitality', 'hotel', 'tourism', 'catering', 'event', 'restaurant', 'tour'],
  'catering': ['catering', 'chef', 'cook', 'food', 'hospitality', 'restaurant', 'hotel'],
  'events': ['event', 'events', 'event management', 'planning', 'coordination', 'hospitality', 'tourism'],
  'retail': ['retail', 'sales', 'shop', 'store', 'customer', 'merchandise', 'buyer'],
  'sales': ['sales', 'retail', 'business', 'marketing', 'customer', 'account', 'trade'],
  'customer': ['customer', 'customer service', 'customer care', 'support', 'retail', 'sales'],
  'buyer': ['buyer', 'purchasing', 'procurement', 'supply chain', 'merchandise', 'retail'],
  'merchandise': ['merchandise', 'buyer', 'retail', 'sales', 'fashion', 'product'],
  'fashion': ['fashion', 'design', 'textile', 'apparel', 'merchandise', 'buyer'],
  'textile': ['textile', 'fabric', 'fashion', 'apparel', 'design', 'manufacturing'],
  'apparel': ['apparel', 'fashion', 'textile', 'clothing', 'garment', 'design'],
  'garment': ['garment', 'apparel', 'fashion', 'textile', 'clothing', 'manufacturing'],
  'printing': ['printing', 'print', 'publisher', 'graphic', 'design', 'media'],
  'publishing': ['publishing', 'publisher', 'editor', 'journalist', 'media', 'content'],
  'graphic': ['graphic', 'graphic design', 'design', 'creative', 'art', 'visual', 'media'],
  'creative': ['creative', 'design', 'art', 'visual', 'media', 'content', 'graphic'],
  'acting': ['acting', 'actor', 'theatre', 'performing', 'arts', 'film', 'drama'],
  'performing': ['performing', 'theatre', 'dance', 'music', 'arts', 'film', 'drama'],
  'music': ['music', 'musician', 'performing', 'arts', 'sound', 'audio', 'production'],
  'dance': ['dance', 'dancer', 'performing', 'arts', 'choreography', 'movement'],
  'film': ['film', 'filmmaker', 'video', 'production', 'media', 'cinematography', 'director'],
  'photography': ['photography', 'photographer', 'visual', 'media', 'film', 'video', 'creative'],
  'broadcasting': ['broadcast', 'broadcasting', 'radio', 'TV', 'media', 'journalist', 'production'],
  'radio': ['radio', 'broadcast', 'media', 'journalist', 'content', 'production'],
  'TV': ['TV', 'television', 'broadcast', 'media', 'journalist', 'production', 'video'],
  'television': ['TV', 'television', 'broadcast', 'media', 'journalist', 'production', 'video'],
  'animation': ['animation', 'animator', 'motion', 'graphic', 'design', 'creative', 'media'],
  'game': ['game', 'game developer', 'gaming', 'design', 'programmer', 'creative'],
  'special education': ['special education', 'special needs', 'disability', 'inclusive', 'education', 'teacher'],
  'early childhood': ['early childhood', 'preschool', 'kindergarten', 'nursery', 'education', 'teacher'],
  'primary education': ['primary', 'elementary', 'school', 'teacher', 'education', 'training'],
  'secondary education': ['secondary', 'high school', 'teacher', 'education', 'training', 'tutor'],
  'higher education': ['higher education', 'university', 'lecturer', 'professor', 'research', 'academic'],
  'adult education': ['adult education', 'lifelong', 'training', 'vocational', 'education', 'teacher'],
  'vocational': ['vocational', 'technical', 'training', 'apprentice', 'trade', 'skills'],
  'counseling': ['counseling', 'counselor', 'psychology', 'therapy', 'mental', 'social', 'guidance'],
  'guidance': ['guidance', 'counselor', 'career', 'education', 'school', 'psychology'],
  'career guidance': ['career guidance', 'career counselor', 'counseling', 'education', 'HR', 'recruitment'],
  'coaching': ['coaching', 'coach', 'mentor', 'training', 'performance', 'sports', 'leadership'],
  'mentor': ['mentor', 'mentoring', 'coaching', 'training', 'advisor', 'development'],
  'supervision': ['supervisor', 'supervision', 'management', 'leadership', 'team', 'operations'],
  'leadership': ['leadership', 'leader', 'management', 'executive', 'director', 'CEO', 'supervisor'],
  'executive': ['executive', 'leadership', 'management', 'director', 'CEO', 'COO', 'strategy'],
  'strategy': ['strategy', 'strategic', 'planning', 'management', 'business', 'consulting'],
  'consulting': ['consulting', 'consultant', 'advisor', 'strategy', 'business', 'management'],
  'investment': ['investment', 'investor', 'asset', 'portfolio', 'private equity', 'fund'],
  'asset': ['asset', 'asset management', 'investment', 'portfolio', 'fund', 'finance'],
  'portfolio': ['portfolio', 'asset', 'investment', 'fund', 'finance', 'management'],
  'private equity': ['private equity', 'investment', 'fund', 'asset', 'portfolio', 'finance'],
  'fund': ['fund', 'funding', 'investment', 'portfolio', 'asset', 'finance'],
  'insurance': ['insurance', 'underwriter', 'actuary', 'risk', 'broker', 'claims', 'finance'],
  'actuary': ['actuary', 'actuarial', 'insurance', 'risk', 'statistics', 'finance'],
  'underwriter': ['underwriting', 'underwriter', 'insurance', 'risk', 'finance', 'broker'],
  'broker': ['broker', 'brokerage', 'insurance', 'real estate', 'finance', 'stock', 'sales'],
  'claims': ['claims', 'claims manager', 'insurance', 'adjuster', 'risk', 'finance'],
  'tax': ['tax', 'taxation', 'tax advisor', 'accountant', 'audit', 'finance', 'law'],
  'valuation': ['valuation', 'valuer', 'property', 'real estate', 'asset', 'finance', 'investment'],
  'cash management': ['cash', 'treasury', 'cash management', 'finance', 'accounting', 'banking'],
  'treasury': ['treasury', 'treasurer', 'cash', 'finance', 'banking', 'investment'],
  'banking': ['banking', 'bank', 'finance', 'credit', 'lending', 'investment', 'customer'],
  'credit': ['credit', 'credit analyst', 'lending', 'banking', 'finance', 'risk', 'underwriting'],
  'lending': ['lending', 'credit', 'loan', 'banking', 'finance', 'mortgage', 'investment'],
  'mortgage': ['mortgage', 'lending', 'loan', 'banking', 'finance', 'credit', 'real estate'],
  'trade finance': ['trade finance', 'trade', 'export', 'import', 'banking', 'finance', 'credit'],
  'factoring': ['factoring', 'invoice', 'finance', 'credit', 'lending', 'cash', 'business'],
  'lease': ['lease', 'leasing', 'finance', 'asset', 'vehicle', 'equipment', 'credit'],
  'fleet': ['fleet', 'fleet manager', 'transport', 'logistics', 'vehicle', 'operations'],
  'vehicle': ['vehicle', 'fleet', 'automotive', 'transport', 'logistics', 'mechanical'],
  'aviation': ['aviation', 'airline', 'aircraft', 'pilot', 'airport', 'aerospace', 'transport'],
  'airline': ['airline', 'aviation', 'aircraft', 'pilot', 'airport', 'cabin', 'ground'],
  'airport': ['airport', 'airline', 'aviation', 'ground', 'logistics', 'security', 'transport'],
  'aerospace': ['aerospace', 'aviation', 'aircraft', 'engineering', 'mechanical', 'aeronautical'],
  'maritime': ['maritime', 'marine', 'ship', 'shipping', 'port', 'logistics', 'transport'],
  'marine': ['marine', 'maritime', 'ship', 'ocean', 'biology', 'fisheries', 'port'],
  'ship': ['ship', 'shipping', 'maritime', 'marine', 'port', 'logistics', 'transport'],
  'port': ['port', 'shipping', 'maritime', 'logistics', 'transport', 'customs', 'security'],
  'customs': ['customs', 'border', 'immigration', 'trade', 'logistics', 'security', 'compliance'],
  'immigration': ['immigration', 'customs', 'border', 'security', 'compliance', 'passport', 'visa'],
  'border': ['border', 'customs', 'immigration', 'security', 'compliance', 'passport', 'control'],
  'passport': ['passport', 'immigration', 'customs', 'border', 'security', 'identity', 'visa'],
  'visa': ['visa', 'immigration', 'customs', 'border', 'security', 'passport', 'consular'],
  'consular': ['consular', 'diplomatic', 'visa', 'immigration', 'embassy', 'foreign', 'passport'],
  'diplomatic': ['diplomatic', 'consular', 'foreign', 'international', 'embassy', 'political', 'relations'],
  'embassy': ['embassy', 'diplomatic', 'consular', 'foreign', 'international', 'political', 'relations'],
  'foreign service': ['foreign service', 'diplomatic', 'consular', 'international', 'embassy', 'political', 'relations'],
  'military': ['military', 'army', 'defence', 'security', 'intelligence', 'operations', 'logistics'],
  'army': ['army', 'military', 'defence', 'security', 'operations', 'logistics', 'intelligence'],
  'defence': ['defence', 'military', 'army', 'security', 'intelligence', 'operations', 'policy'],
  'intelligence': ['intelligence', 'security', 'military', 'defence', 'analyst', 'operations', 'risk'],
  'police': ['police', 'law enforcement', 'security', 'officer', 'criminal', 'investigation', 'patrol'],
  'law enforcement': ['law enforcement', 'police', 'security', 'criminal', 'investigation', 'officer', 'patrol'],
  'fire': ['fire', 'firefighter', 'firefighting', 'emergency', 'rescue', 'safety', 'hazard'],
  'rescue': ['rescue', 'emergency', 'firefighter', 'paramedic', 'safety', 'health', 'disaster'],
  'paramedic': ['paramedic', 'EMT', 'emergency', 'ambulance', 'health', 'rescue', 'medical'],
  'EMT': ['EMT', 'paramedic', 'emergency', 'ambulance', 'health', 'rescue', 'medical'],
  'ambulance': ['ambulance', 'paramedic', 'EMT', 'emergency', 'health', 'rescue', 'transport'],
  'disaster': ['disaster', 'disaster management', 'emergency', 'relief', 'NGO', 'humanitarian', 'rescue'],
  'humanitarian': ['humanitarian', 'NGO', 'relief', 'disaster', 'development', 'aid', 'social'],
  'relief': ['relief', 'humanitarian', 'NGO', 'disaster', 'aid', 'emergency', 'social'],
  'aid': ['aid', 'development', 'NGO', 'humanitarian', 'relief', 'social', 'community'],
  'water': ['water', 'water engineer', 'hydrology', 'sanitation', 'environmental', 'civil', 'irrigation'],
  'sanitation': ['sanitation', 'water', 'environmental', 'public health', 'hygiene', 'WASH', 'health'],
  'WASH': ['WASH', 'water', 'sanitation', 'hygiene', 'environmental', 'public health', 'development'],
  'hygiene': ['hygiene', 'sanitation', 'WASH', 'public health', 'environmental', 'health', 'water'],
  'climate': ['climate', 'climate change', 'environmental', 'adaptation', 'mitigation', 'research', 'policy'],
  'climate change': ['climate change', 'climate', 'environmental', 'adaptation', 'mitigation', 'policy', 'research'],
  'adaptation': ['adaptation', 'climate', 'climate change', 'environmental', 'mitigation', 'policy', 'development'],
  'mitigation': ['mitigation', 'climate', 'climate change', 'environmental', 'adaptation', 'policy', 'energy'],
  'energy': ['energy', 'power', 'electrical', 'renewable', 'solar', 'wind', 'electricity', 'petroleum', 'oil', 'gas'],
  'power': ['power', 'energy', 'electrical', 'renewable', 'electricity', 'grid', 'transmission'],
  'renewable': ['renewable', 'solar', 'wind', 'energy', 'power', 'green', 'sustainable', 'environmental'],
  'solar': ['solar', 'renewable', 'energy', 'power', 'photovoltaic', 'green', 'sustainable', 'environmental'],
  'wind': ['wind', 'renewable', 'energy', 'power', 'sustainable', 'green', 'environmental', 'turbine'],
  'green': ['green', 'sustainable', 'renewable', 'environmental', 'energy', 'climate', 'eco'],
  'sustainable': ['sustainable', 'green', 'renewable', 'environmental', 'development', 'CSR', 'sustainability'],
  'CSR': ['CSR', 'corporate social responsibility', 'sustainability', 'community', 'development', 'NGO', 'social'],
  'sustainability': ['sustainability', 'sustainable', 'CSR', 'environmental', 'green', 'development', 'community'],
  'ecology': ['ecology', 'ecologist', 'environmental', 'biology', 'conservation', 'nature', 'research'],
  'conservation': ['conservation', 'environmental', 'ecology', 'nature', 'wildlife', 'forestry', 'park'],
  'wildlife': ['wildlife', 'conservation', 'environmental', 'nature', 'biology', 'zoology', 'park'],
  'zoology': ['zoology', 'zoologist', 'wildlife', 'biology', 'conservation', 'animal', 'research'],
  'botany': ['botany', 'botanist', 'plant', 'biology', 'agriculture', 'conservation', 'research'],
  'marine biology': ['marine biology', 'marine biologist', 'ocean', 'biology', 'marine', 'fisheries', 'conservation'],
  'oceanography': ['oceanography', 'oceanographer', 'marine', 'ocean', 'research', 'environmental', 'climate'],
  'hydrology': ['hydrology', 'hydrologist', 'water', 'civil', 'environmental', 'climate', 'research'],
  'meteorology': ['meteorology', 'meteorologist', 'weather', 'climate', 'environmental', 'research', 'forecast'],
  'weather': ['weather', 'meteorology', 'climate', 'forecast', 'environmental', 'research', 'agriculture'],
  'seismology': ['seismology', 'seismologist', 'earthquake', 'geology', 'research', 'hazard', 'risk'],
  'volcanology': ['volcanology', 'volcanologist', 'volcano', 'geology', 'hazard', 'research', 'risk'],
  'paleontology': ['paleontology', 'paleontologist', 'fossil', 'geology', 'biology', 'research', 'museum'],
  'archaeology': ['archaeology', 'archaeologist', 'heritage', 'museum', 'history', 'culture', 'research'],
  'heritage': ['heritage', 'archaeology', 'culture', 'museum', 'history', 'conservation', 'tourism'],
  'museum': ['museum', 'curator', 'heritage', 'archaeology', 'culture', 'history', 'conservation'],
  'curator': ['curator', 'museum', 'heritage', 'art', 'culture', 'history', 'conservation'],
  'art': ['art', 'artist', 'fine art', 'creative', 'design', 'visual', 'culture', 'painting'],
  'fine art': ['art', 'artist', 'fine art', 'creative', 'design', 'visual', 'culture', 'painting'],
  'sculpture': ['sculpture', 'sculptor', 'art', 'fine art', 'creative', 'visual', 'design', 'culture'],
  'ceramics': ['ceramics', 'pottery', 'art', 'design', 'creative', 'craft', 'visual', 'culture'],
  'metalwork': ['metalwork', 'metal', 'craft', 'art', 'design', 'creative', 'welding', 'fabrication'],
  'jewelry': ['jewelry', 'jeweller', 'design', 'art', 'craft', 'metalwork', 'creative', 'fashion'],
  'fashion design': ['fashion design', 'fashion designer', 'fashion', 'apparel', 'textile', 'creative', 'design'],
  'interior': ['interior', 'interior design', 'design', 'architecture', 'creative', 'decor', 'space'],
  'interior design': ['interior design', 'interior', 'design', 'architecture', 'creative', 'decor', 'space'],
  'landscape': ['landscape', 'landscape design', 'landscape architecture', 'garden', 'environmental', 'design', 'creative'],
  'industrial design': ['industrial design', 'product design', 'design', 'creative', 'manufacturing', 'engineering', 'ergonomics'],
  'product design': ['product design', 'industrial design', 'design', 'creative', 'manufacturing', 'engineering', 'ergonomics'],
  'UX': ['UX', 'user experience', 'design', 'creative', 'software', 'product', 'interface', 'digital'],
  'user experience': ['UX', 'user experience', 'design', 'creative', 'software', 'product', 'interface', 'digital'],
  'UI': ['UI', 'user interface', 'design', 'creative', 'software', 'digital', 'visual', 'graphic'],
  'user interface': ['UI', 'user interface', 'design', 'creative', 'software', 'digital', 'visual', 'graphic'],
  'interaction': ['interaction', 'interaction design', 'UX', 'design', 'creative', 'software', 'digital', 'product'],
  'service design': ['service design', 'service', 'design', 'UX', 'creative', 'business', 'customer', 'digital'],
  'brand design': ['brand design', 'brand', 'design', 'creative', 'marketing', 'visual', 'identity', 'graphic'],
  'motion design': ['motion design', 'motion', 'animation', 'design', 'creative', 'media', 'video', 'digital'],
  'sound design': ['sound design', 'sound', 'audio', 'music', 'production', 'creative', 'media', 'engineering'],
  'lighting': ['lighting', 'lighting design', 'design', 'creative', 'theatre', 'event', 'architecture', 'technical'],
  'stage': ['stage', 'stage management', 'theatre', 'performing', 'event', 'production', 'technical', 'creative'],
  'technical theatre': ['technical theatre', 'theatre', 'stage', 'lighting', 'sound', 'production', 'creative'],
  'prop': ['prop', 'property', 'theatre', 'film', 'creative', 'design', 'craft', 'art'],
  'wardrobe': ['wardrobe', 'costume', 'theatre', 'film', 'creative', 'design', 'fashion', 'textile'],
  'costume': ['costume', 'wardrobe', 'theatre', 'film', 'creative', 'design', 'fashion', 'textile'],
  'makeup': ['makeup', 'makeup artist', 'beauty', 'theatre', 'film', 'creative', 'fashion', 'media'],
  'hair': ['hair', 'hairdresser', 'hairstylist', 'beauty', 'salon', 'creative', 'fashion', 'theatre'],
  'beauty': ['beauty', 'salon', 'makeup', 'hair', 'skincare', 'cosmetology', 'creative'],
  'cosmetology': ['cosmetology', 'beauty', 'salon', 'makeup', 'hair', 'skincare', 'esthetician'],
  'esthetician': ['esthetician', 'skincare', 'beauty', 'salon', 'makeup', 'cosmetology', 'wellness'],
  'wellness': ['wellness', 'wellness coach', 'health', 'spa', 'fitness', 'holistic', 'lifestyle'],
  'spa': ['spa', 'wellness', 'beauty', 'salon', 'massage', 'therapy', 'health', 'relaxation'],
  'massage': ['massage', 'massage therapist', 'therapy', 'wellness', 'spa', 'health', 'sports'],
  'fitness': ['fitness', 'fitness trainer', 'gym', 'sports', 'wellness', 'health', 'coach', 'personal trainer'],
  'personal trainer': ['personal trainer', 'fitness', 'trainer', 'gym', 'sports', 'wellness', 'health', 'coach'],
  'sports coaching': ['sports coaching', 'sports', 'coach', 'fitness', 'personal trainer', 'wellness', 'health', 'athletic'],
  'dietetics': ['dietetics', 'dietician', 'nutrition', 'nutritionist', 'food', 'health', 'wellness', 'clinical'],
  'food technology': ['food technology', 'food technologist', 'food', 'processing', 'quality', 'nutrition', 'safety'],
  'food processing': ['food processing', 'food technology', 'food', 'manufacturing', 'quality', 'safety', 'nutrition'],
  'food safety': ['food safety', 'food', 'quality', 'safety', 'HACCP', 'inspection', 'nutrition', 'health'],
  'HACCP': ['HACCP', 'food safety', 'food', 'quality', 'safety', 'inspection', 'nutrition', 'health'],
  'inspection': ['inspection', 'inspector', 'quality', 'safety', 'compliance', 'audit', 'food', 'health'],
  'quality assurance': ['quality assurance', 'QA', 'quality', 'testing', 'compliance', 'audit', 'food', 'health'],
  'quality control': ['quality control', 'QC', 'quality', 'testing', 'inspection', 'compliance', 'audit', 'food'],
  'testing': ['testing', 'test', 'tester', 'quality', 'QA', 'QC', 'inspection', 'compliance', 'laboratory'],
  'laboratory': ['laboratory', 'lab', 'lab technician', 'technician', 'testing', 'quality', 'research', 'science'],
  'lab technician': ['lab technician', 'laboratory', 'lab', 'technician', 'testing', 'quality', 'research', 'science'],
  'technician': ['technician', 'technician', 'lab', 'laboratory', 'testing', 'quality', 'maintenance', 'repair'],
  'research': ['research', 'researcher', 'research assistant', 'scientist', 'laboratory', 'academic', 'analyst'],
  'research assistant': ['research assistant', 'research', 'researcher', 'scientist', 'laboratory', 'academic', 'analyst'],
  'scientist': ['scientist', 'research', 'researcher', 'laboratory', 'academic', 'analyst', 'science'],
  'analyst': ['analyst', 'data analyst', 'business analyst', 'systems analyst', 'research', 'analyst', 'data'],
  'data analyst': ['data analyst', 'analyst', 'data', 'business analyst', 'systems analyst', 'research', 'analytics'],
  'business analyst': ['business analyst', 'analyst', 'business', 'systems analyst', 'data', 'research', 'requirements'],
  'systems analyst': ['systems analyst', 'analyst', 'systems', 'IT', 'business analyst', 'data', 'research', 'requirements'],
  'programmer': ['programmer', 'developer', 'software', 'coding', 'IT', 'systems', 'application'],
  'developer': ['developer', 'programmer', 'software', 'coding', 'IT', 'systems', 'application', 'web'],
  'web': ['web', 'web developer', 'developer', 'programmer', 'software', 'frontend', 'backend', 'fullstack'],
  'frontend': ['frontend', 'frontend developer', 'web', 'developer', 'programmer', 'UI', 'design', 'software'],
  'backend': ['backend', 'backend developer', 'web', 'developer', 'programmer', 'database', 'server', 'software'],
  'fullstack': ['fullstack', 'fullstack developer', 'web', 'developer', 'frontend', 'backend', 'software', 'programmer'],
  'mobile': ['mobile', 'mobile developer', 'app', 'developer', 'software', 'programmer', 'iOS', 'Android'],
  'app': ['app', 'mobile', 'application', 'developer', 'software', 'programmer', 'iOS', 'Android'],
  'iOS': ['iOS', 'iOS developer', 'mobile', 'Apple', 'developer', 'app', 'software', 'programmer'],
  'Android': ['Android', 'Android developer', 'mobile', 'Google', 'developer', 'app', 'software', 'programmer'],
  'embedded': ['embedded', 'embedded systems', 'firmware', 'hardware', 'software', 'electronics', 'IoT', 'microcontroller'],
  'firmware': ['firmware', 'embedded', 'embedded systems', 'hardware', 'software', 'electronics', 'IoT', 'microcontroller'],
  'hardware': ['hardware', 'hardware engineer', 'electronics', 'embedded', 'firmware', 'design', 'testing', 'manufacturing'],
  'IoT': ['IoT', 'Internet of Things', 'embedded', 'hardware', 'software', 'electronics', 'firmware', 'sensor'],
  'microcontroller': ['microcontroller', 'embedded', 'hardware', 'software', 'electronics', 'firmware', 'IoT', 'design'],
  'sensor': ['sensor', 'sensing', 'IoT', 'embedded', 'hardware', 'electronics', 'measurement', 'design'],
  'nanotechnology': ['nanotechnology', 'nano', 'nanoscience', 'materials', 'physics', 'chemistry', 'engineering', 'research'],
  'materials': ['materials', 'materials science', 'materials engineer', 'nanotechnology', 'metallurgy', 'ceramics', 'composites'],
  'glass': ['glass', 'glass engineering', 'materials', 'ceramics', 'design', 'manufacturing', 'art', 'architecture'],
  'polymer': ['polymer', 'polymer science', 'plastics', 'materials', 'chemistry', 'engineering', 'manufacturing'],
  'plastics': ['plastics', 'polymer', 'materials', 'engineering', 'manufacturing', 'design', 'chemistry', 'processing'],
  'rubber': ['rubber', 'elastomer', 'polymer', 'materials', 'engineering', 'manufacturing', 'design', 'processing'],
  'textile engineering': ['textile engineering', 'textile', 'materials', 'engineering', 'fabric', 'fashion', 'manufacturing', 'design'],
  'paper': ['paper', 'pulp', 'paper engineering', 'materials', 'manufacturing', 'design', 'printing', 'packaging'],
  'packaging': ['packaging', 'package', 'packaging design', 'materials', 'manufacturing', 'design', 'food', 'product'],
  'pulp': ['pulp', 'paper', 'paper engineering', 'materials', 'manufacturing', 'design', 'printing', 'packaging'],
  'printing engineering': ['printing engineering', 'printing', 'print', 'engineering', 'manufacturing', 'design', 'media', 'graphic'],
  'bioengineering': ['bioengineering', 'bioengineer', 'biomedical', 'biotechnology', 'engineering', 'health', 'research', 'tissue'],
  'tissue engineering': ['tissue engineering', 'bioengineering', 'bioengineer', 'biomedical', 'biotechnology', 'health', 'research', 'tissue'],
  'genetic engineering': ['genetic engineering', 'geneticist', 'genetics', 'biotechnology', 'bioengineering', 'research', 'laboratory', 'health'],
  'genetics': ['genetics', 'geneticist', 'genetic engineering', 'biotechnology', 'bioengineering', 'research', 'laboratory', 'health'],
  'bioinformatics': ['bioinformatics', 'bioinformatician', 'computational', 'biology', 'data', 'software', 'research', 'genomics'],
  'computational': ['computational', 'computational biology', 'bioinformatics', 'data', 'software', 'research', 'mathematics', 'modeling'],
  'genomics': ['genomics', 'genomicist', 'bioinformatics', 'computational', 'biology', 'data', 'research', 'genetics'],
  'proteomics': ['proteomics', 'proteomics', 'bioinformatics', 'computational', 'biology', 'data', 'research', 'genetics'],
  'immunology': ['immunology', 'immunologist', 'biomedical', 'health', 'research', 'laboratory', 'vaccine', 'disease'],
  'vaccine': ['vaccine', 'vaccinology', 'immunology', 'biomedical', 'health', 'research', 'laboratory', 'pharmaceutical'],
  'toxicology': ['toxicology', 'toxicologist', 'chemistry', 'pharmaceutical', 'environmental', 'health', 'safety', 'research'],
  'pharmacology': ['pharmacology', 'pharmacologist', 'pharmaceutical', 'drug', 'health', 'research', 'laboratory', 'clinical'],
  'pharmaceutics': ['pharmaceutics', 'pharmaceutical', 'drug', 'health', 'research', 'laboratory', 'formulation', 'clinical'],
  'drug': ['drug', 'pharmaceutical', 'pharmaceutics', 'pharmacology', 'health', 'research', 'laboratory', 'formulation'],
  'formulation': ['formulation', 'pharmaceutical', 'drug', 'pharmaceutics', 'health', 'research', 'laboratory', 'chemistry'],
  'clinical research': ['clinical research', 'clinical trial', 'research', 'pharmaceutical', 'health', 'laboratory', 'drug', 'medical'],
  'clinical trial': ['clinical trial', 'clinical research', 'research', 'pharmaceutical', 'health', 'laboratory', 'drug', 'medical'],
  'regulatory': ['regulatory', 'regulatory affairs', 'compliance', 'pharmaceutical', 'drug', 'health', 'clinical', 'government'],
  'regulatory affairs': ['regulatory affairs', 'regulatory', 'compliance', 'pharmaceutical', 'drug', 'health', 'clinical', 'government'],
  'medical writing': ['medical writing', 'medical writer', 'clinical', 'pharmaceutical', 'research', 'documentation', 'health', 'communication'],
  'medical device': ['medical device', 'medical device engineer', 'biomedical', 'health', 'engineering', 'design', 'manufacturing', 'regulatory'],
  'prosthetics': ['prosthetics', 'prosthetist', 'biomedical', 'health', 'orthotics', 'engineering', 'design', 'rehabilitation'],
  'orthotics': ['orthotics', 'orthotist', 'biomedical', 'health', 'prosthetics', 'engineering', 'design', 'rehabilitation'],
  'health informatics': ['health informatics', 'health information', 'health IT', 'medical', 'IT', 'data', 'software', 'health'],
  'health information': ['health information', 'health informatics', 'health IT', 'medical', 'IT', 'data', 'software', 'health'],
  'medical imaging': ['medical imaging', 'imaging', 'radiology', 'radiographer', 'medical', 'health', 'technology', 'biomedical'],
  'telemedicine': ['telemedicine', 'telehealth', 'health', 'IT', 'medical', 'software', 'digital', 'remote'],
  'telehealth': ['telehealth', 'telemedicine', 'health', 'IT', 'medical', 'software', 'digital', 'remote'],
  'health technology': ['health technology', 'health tech', 'biomedical', 'medical', 'IT', 'software', 'health', 'digital'],
  'health tech': ['health tech', 'health technology', 'biomedical', 'medical', 'IT', 'software', 'health', 'digital'],
  'civil service': ['civil service', 'public', 'government', 'policy', 'administration', 'public administration', 'management'],
  'local government': ['local government', 'council', 'municipal', 'public', 'government', 'policy', 'administration'],
  'central government': ['central government', 'national', 'public', 'government', 'policy', 'administration', 'management'],
  'parliament': ['parliament', 'legislative', 'government', 'policy', 'political', 'law', 'public', 'administration'],
  'legislative': ['legislative', 'parliament', 'government', 'policy', 'law', 'political', 'public', 'administration'],
  'judiciary': ['judiciary', 'judge', 'court', 'legal', 'law', 'justice', 'public', 'administration'],
  'court': ['court', 'judiciary', 'judge', 'legal', 'law', 'justice', 'public', 'administration'],
  'probation': ['probation', 'probation officer', 'correction', 'justice', 'social', 'legal', 'public', 'administration'],
  'correction': ['correction', 'correctional', 'probation', 'justice', 'social', 'legal', 'public', 'administration'],
  'prison': ['prison', 'correctional', 'probation', 'justice', 'social', 'legal', 'public', 'administration'],
  'youth': ['youth', 'youth worker', 'social', 'community', 'development', 'education', 'counseling', 'guidance'],
  'community': ['community', 'community development', 'social', 'youth', 'development', 'NGO', 'counseling', 'education'],
  'social': ['social', 'social worker', 'social work', 'community', 'development', 'NGO', 'counseling', 'education'],
  'disability': ['disability', 'disability support', 'inclusive', 'special', 'education', 'social', 'health', 'care'],
  'inclusive': ['inclusive', 'inclusion', 'disability', 'special', 'education', 'social', 'diversity', 'accessibility'],
  'accessibility': ['accessibility', 'accessible', 'inclusion', 'disability', 'design', 'IT', 'social', 'health'],
  'sign language': ['sign language', 'interpreter', 'deaf', 'communication', 'language', 'disability', 'education', 'social'],
  'interpreter': ['interpreter', 'interpretation', 'language', 'sign language', 'translation', 'communication', 'multilingual', 'social'],
  'translation': ['translation', 'translator', 'language', 'interpreter', 'communication', 'multilingual', 'social', 'media'],
  'multilingual': ['multilingual', 'language', 'interpreter', 'translation', 'communication', 'social', 'education', 'cultural'],
  'cultural': ['cultural', 'culture', 'anthropology', 'social', 'community', 'arts', 'education', 'heritage'],
  'language': ['language', 'linguist', 'linguistics', 'translator', 'interpreter', 'communication', 'education', 'social'],
  'teacher': ['teacher', 'education', 'lecturer', 'tutor', 'school', 'training', 'academic', 'instruction'],
  'lecturer': ['lecturer', 'education', 'teacher', 'university', 'training', 'academic', 'instruction', 'research'],
  'tutor': ['tutor', 'teacher', 'education', 'training', 'academic', 'instruction', 'school', 'coaching'],
  'school': ['school', 'education', 'teacher', 'training', 'academic', 'instruction', 'tutor', 'lecturer'],
  'training': ['training', 'trainer', 'education', 'teacher', 'coaching', 'vocational', 'skills', 'development'],
  'academic': ['academic', 'education', 'lecturer', 'university', 'research', 'professor', 'instruction', 'scholar'],
  'professor': ['professor', 'academic', 'education', 'university', 'research', 'lecturer', 'instruction', 'scholar'],
  'scholar': ['scholar', 'academic', 'education', 'research', 'university', 'professor', 'lecturer', 'instruction'],
  'instruction': ['instruction', 'instructional', 'education', 'teacher', 'training', 'academic', 'design', 'curriculum'],
  'curriculum': ['curriculum', 'curriculum developer', 'education', 'instructional', 'teacher', 'training', 'academic', 'design'],
  'instructional design': ['instructional design', 'instructional', 'education', 'curriculum', 'training', 'academic', 'e-learning', 'design'],
  'e-learning': ['e-learning', 'online learning', 'instructional', 'education', 'curriculum', 'training', 'digital', 'design'],
  'online learning': ['online learning', 'e-learning', 'instructional', 'education', 'curriculum', 'training', 'digital', 'design'],
  'distance learning': ['distance learning', 'online', 'e-learning', 'education', 'curriculum', 'training', 'digital', 'remote'],
  'adult learning': ['adult learning', 'adult education', 'lifelong', 'training', 'vocational', 'education', 'teacher', 'instructional'],
  'workplace learning': ['workplace learning', 'training', 'corporate', 'education', 'instructional', 'development', 'skills', 'coaching'],
  'corporate training': ['corporate training', 'training', 'corporate', 'education', 'instructional', 'development', 'skills', 'coaching'],
  'talent': ['talent', 'talent management', 'HR', 'human resources', 'recruitment', 'development', 'performance', 'career'],
  'talent management': ['talent management', 'talent', 'HR', 'human resources', 'recruitment', 'development', 'performance', 'career'],
  'performance': ['performance', 'performance management', 'HR', 'human resources', 'talent', 'development', 'appraisal', 'management'],
  'performance management': ['performance management', 'performance', 'HR', 'human resources', 'talent', 'development', 'appraisal', 'management'],
  'appraisal': ['appraisal', 'performance', 'HR', 'human resources', 'talent', 'development', 'evaluation', 'management'],
  'evaluation': ['evaluation', 'evaluator', 'assessment', 'performance', 'research', 'education', 'testing', 'quality'],
  'assessment': ['assessment', 'assessor', 'evaluation', 'testing', 'performance', 'education', 'quality', 'research'],
  'testing and assessment': ['testing', 'assessment', 'evaluation', 'quality', 'education', 'research', 'performance', 'testing'],
  'examiner': ['examiner', 'examination', 'testing', 'assessment', 'evaluation', 'education', 'quality', 'research'],
  'exam': ['exam', 'examination', 'testing', 'assessment', 'evaluation', 'education', 'quality', 'research'],
  'examination': ['examination', 'exam', 'testing', 'assessment', 'evaluation', 'education', 'quality', 'research'],
  'moderator': ['moderator', 'moderation', 'assessment', 'examination', 'education', 'quality', 'evaluation', 'testing'],
  'marking': ['marking', 'marking', 'assessment', 'examination', 'education', 'quality', 'evaluation', 'testing'],
  'exam invigilator': ['exam invigilator', 'invigilation', 'examination', 'education', 'testing', 'assessment', 'quality'],
  'invigilation': ['invigilation', 'exam invigilator', 'examination', 'education', 'testing', 'assessment', 'quality'],
  'security screening': ['security screening', 'screening', 'security', 'border', 'customs', 'immigration', 'airport', 'hazard'],
  'screening': ['screening', 'security screening', 'security', 'border', 'customs', 'immigration', 'airport', 'hazard'],
  'surveillance': ['surveillance', 'security', 'monitoring', 'CCTV', 'patrol', 'investigation', 'intelligence', 'operations'],
  'CCTV': ['CCTV', 'surveillance', 'security', 'monitoring', 'patrol', 'investigation', 'intelligence', 'operations'],
  'patrol': ['patrol', 'security', 'police', 'law enforcement', 'patrol', 'operations', 'guard', 'patrol'],
  'guard': ['guard', 'security', 'security guard', 'patrol', 'surveillance', 'protection', 'patrol', 'operations'],
  'protection': ['protection', 'security', 'bodyguard', 'close protection', 'surveillance', 'intelligence', 'operations', 'risk'],
  'bodyguard': ['bodyguard', 'close protection', 'protection', 'security', 'surveillance', 'intelligence', 'operations', 'risk'],
  'close protection': ['close protection', 'bodyguard', 'protection', 'security', 'surveillance', 'intelligence', 'operations', 'risk'],
  'dog handler': ['dog handler', 'K9', 'security', 'police', 'military', 'patrol', 'detection', 'operations'],
  'K9': ['K9', 'dog handler', 'security', 'police', 'military', 'patrol', 'detection', 'operations'],
  'detection': ['detection', 'detector', 'security', 'dog handler', 'K9', 'patrol', 'explosives', 'drugs'],
  'explosives': ['explosives', 'explosive', 'bomb', 'EOD', 'security', 'military', 'detection', 'disposal'],
  'EOD': ['EOD', 'explosives', 'bomb', 'disposal', 'security', 'military', 'detection', 'operations'],
  'bomb': ['bomb', 'explosives', 'EOD', 'disposal', 'security', 'military', 'detection', 'operations'],
  'disposal': ['disposal', 'EOD', 'explosives', 'bomb', 'security', 'military', 'detection', 'operations'],
  'drugs': ['drugs', 'narcotics', 'drug enforcement', 'security', 'police', 'detection', 'investigation', 'forensic'],
  'narcotics': ['narcotics', 'drugs', 'drug enforcement', 'security', 'police', 'detection', 'investigation', 'forensic'],
  'drug enforcement': ['drug enforcement', 'narcotics', 'drugs', 'security', 'police', 'detection', 'investigation', 'forensic'],
  'forensic science': ['forensic science', 'forensic', 'criminal', 'investigation', 'laboratory', 'legal', 'crime', 'science'],
  'crime': ['crime', 'criminal', 'crime scene', 'investigation', 'forensic', 'police', 'security', 'law'],
  'crime scene': ['crime scene', 'crime scene investigator', 'CSI', 'forensic', 'investigation', 'police', 'security', 'law'],
  'CSI': ['CSI', 'crime scene', 'crime scene investigator', 'forensic', 'investigation', 'police', 'security', 'law'],
  'criminal': ['criminal', 'crime', 'criminal justice', 'law', 'security', 'police', 'investigation', 'forensic'],
  'criminal justice': ['criminal justice', 'criminal', 'crime', 'law', 'security', 'police', 'investigation', 'forensic'],
  'justice': ['justice', 'legal', 'law', 'court', 'judiciary', 'criminal', 'security', 'public'],
  'legal aid': ['legal aid', 'legal', 'law', 'lawyer', 'advocate', 'access', 'justice', 'public'],
  'access to justice': ['access to justice', 'legal aid', 'legal', 'law', 'justice', 'public', 'human rights', 'advocacy'],
  'human rights': ['human rights', 'human rights lawyer', 'advocacy', 'legal', 'law', 'justice', 'NGO', 'international'],
  'advocacy': ['advocacy', 'advocate', 'human rights', 'legal', 'law', 'justice', 'NGO', 'international'],
  'NGO': ['NGO', 'non-governmental', 'development', 'humanitarian', 'relief', 'aid', 'social', 'community'],
  'non-governmental': ['NGO', 'non-governmental', 'development', 'humanitarian', 'relief', 'aid', 'social', 'community'],
  'civil society': ['civil society', 'NGO', 'community', 'development', 'advocacy', 'social', 'human rights', 'participation'],
  'participation': ['participation', 'community', 'civil society', 'development', 'advocacy', 'social', 'human rights', 'engagement'],
  'engagement': ['engagement', 'community', 'civil society', 'development', 'advocacy', 'social', 'human rights', 'participation'],
  'stakeholder': ['stakeholder', 'engagement', 'participation', 'community', 'development', 'advocacy', 'social', 'management'],
  'M&E': ['M&E', 'monitoring', 'evaluation', 'monitoring and evaluation', 'research', 'development', 'NGO', 'quality'],
  'monitoring and evaluation': ['monitoring and evaluation', 'M&E', 'monitoring', 'evaluation', 'research', 'development', 'NGO', 'quality'],
  'impact': ['impact', 'impact assessment', 'evaluation', 'monitoring', 'research', 'development', 'NGO', 'quality'],
  'impact assessment': ['impact assessment', 'impact', 'evaluation', 'monitoring', 'research', 'development', 'NGO', 'quality'],
  'baseline': ['baseline', 'baseline survey', 'survey', 'research', 'monitoring', 'evaluation', 'development', 'NGO'],
  'survey': ['survey', 'surveying', 'baseline', 'research', 'monitoring', 'evaluation', 'development', 'GIS'],
  'field': ['field', 'field officer', 'field work', 'research', 'monitoring', 'evaluation', 'development', 'NGO'],
  'field officer': ['field officer', 'field', 'field work', 'research', 'monitoring', 'evaluation', 'development', 'NGO'],
  'field work': ['field work', 'field', 'field officer', 'research', 'monitoring', 'evaluation', 'development', 'NGO'],
  ' enumerator': ['enumerator', 'survey', 'field', 'research', 'monitoring', 'evaluation', 'data', 'development'],
  'data collection': ['data collection', 'data', 'field', 'survey', 'research', 'monitoring', 'evaluation', 'development'],
  'data entry': ['data entry', 'data', 'administration', 'clerical', 'office', 'computer', 'research', 'development'],
  'transcription': ['transcription', 'transcriber', 'data', 'language', 'research', 'documentation', 'audio', 'medical'],
  'captioning': ['captioning', 'subtitling', 'transcription', 'language', 'media', 'accessibility', 'communication', 'digital'],
  'subtitling': ['subtitling', 'captioning', 'transcription', 'language', 'media', 'accessibility', 'communication', 'digital'],
  'sign language interpreter': ['sign language interpreter', 'sign language', 'interpreter', 'deaf', 'communication', 'language', 'disability', 'education'],
  'braille': ['braille', 'blind', 'visual impairment', 'disability', 'education', 'accessibility', 'communication', 'inclusion'],
  'visual impairment': ['visual impairment', 'blind', 'braille', 'disability', 'education', 'accessibility', 'communication', 'inclusion'],
  'hearing impairment': ['hearing impairment', 'deaf', 'sign language', 'disability', 'education', 'accessibility', 'communication', 'inclusion'],
  'speech impairment': ['speech impairment', 'speech', 'communication', 'disability', 'education', 'accessibility', 'inclusion', 'therapy'],
  'physical disability': ['physical disability', 'disability', 'rehabilitation', 'physiotherapy', 'health', 'social', 'inclusion', 'accessibility'],
  'intellectual disability': ['intellectual disability', 'disability', 'special education', 'education', 'social', 'inclusion', 'support', 'care'],
  'community development': ['community development', 'community', 'development', 'NGO', 'social', 'counseling', 'therapy', 'education'],
  'rural development': ['rural development', 'community', 'development', 'agriculture', 'NGO', 'social', 'rural', 'education'],
  'urban development': ['urban development', 'urban', 'planning', 'architecture', 'community', 'development', 'social', 'housing'],
  'housing': ['housing', 'real estate', 'property', 'urban', 'development', 'social', 'construction', 'planning'],
  'slum': ['slum', 'urban', 'development', 'housing', 'social', 'community', 'construction', 'planning'],
  'water supply': ['water supply', 'water', 'civil', 'environmental', 'engineering', 'public', 'health', 'development'],
  'sewerage': ['sewerage', 'sanitation', 'water', 'civil', 'environmental', 'engineering', 'public', 'health', 'development'],
  'solid waste': ['solid waste', 'waste', 'environmental', 'sanitation', 'civil', 'engineering', 'public', 'health', 'development'],
  'waste management': ['waste management', 'waste', 'environmental', 'sanitation', 'civil', 'engineering', 'public', 'health', 'development'],
  'waste': ['waste', 'waste management', 'environmental', 'sanitation', 'civil', 'engineering', 'public', 'health', 'development'],
  'recycling': ['recycling', 'waste', 'environmental', 'sustainability', 'green', 'manufacturing', 'processing', 'engineering'],
  'pollution': ['pollution', 'pollution control', 'environmental', 'sanitation', 'civil', 'engineering', 'public', 'health', 'development'],
  'pollution control': ['pollution control', 'pollution', 'environmental', 'sanitation', 'civil', 'engineering', 'public', 'health', 'development'],
  'air quality': ['air quality', 'environmental', 'pollution', 'climate', 'public', 'health', 'engineering', 'monitoring'],
  'noise': ['noise', 'environmental', 'pollution', 'public', 'health', 'engineering', 'monitoring', 'assessment'],
  'vibration': ['vibration', 'environmental', 'pollution', 'engineering', 'monitoring', 'assessment', 'health', 'noise'],
  'land': ['land', 'land management', 'land surveying', 'GIS', 'property', 'real estate', 'urban', 'planning'],
  'land management': ['land management', 'land', 'property', 'real estate', 'urban', 'planning', 'GIS', 'surveying'],
  'land surveying': ['land surveying', 'surveying', 'land', 'property', 'real estate', 'urban', 'GIS', 'planning'],
  'cadastral': ['cadastral', 'land', 'property', 'surveying', 'GIS', 'real estate', 'urban', 'planning'],
  'title': ['title', 'title deed', 'land', 'property', 'real estate', 'legal', 'surveying', 'registration'],
  'deed': ['deed', 'title deed', 'land', 'property', 'real estate', 'legal', 'surveying', 'registration'],
  'registration': ['registration', 'registrar', 'land', 'property', 'real estate', 'legal', 'surveying', 'title'],
  'conveyancing': ['conveyancing', 'conveyancer', 'property', 'real estate', 'legal', 'law', 'registration', 'title'],
  'notary': ['notary', 'notary public', 'legal', 'law', 'document', 'registration', 'authentication', 'conveyancing'],
  'notary public': ['notary', 'notary public', 'legal', 'law', 'document', 'registration', 'authentication', 'conveyancing'],
  'arbitration': ['arbitration', 'arbitrator', 'dispute', 'legal', 'law', 'alternative', 'mediation', 'resolution'],
  'mediation': ['mediation', 'mediator', 'dispute', 'legal', 'law', 'alternative', 'arbitration', 'resolution'],
  'dispute': ['dispute', 'dispute resolution', 'legal', 'law', 'alternative', 'arbitration', 'mediation', 'resolution'],
  'dispute resolution': ['dispute resolution', 'dispute', 'legal', 'law', 'alternative', 'arbitration', 'mediation', 'resolution'],
  'alternative dispute': ['alternative dispute', 'dispute', 'legal', 'law', 'arbitration', 'mediation', 'resolution', 'conciliation'],
  'conciliation': ['conciliation', 'conciliator', 'dispute', 'legal', 'law', 'alternative', 'arbitration', 'mediation'],
  'ombudsman': ['ombudsman', 'complaint', 'grievance', 'public', 'administration', 'legal', 'justice', 'advocacy'],
  'complaint': ['complaint', 'complaints', 'ombudsman', 'grievance', 'customer', 'service', 'quality', 'resolution'],
  'grievance': ['grievance', 'complaint', 'ombudsman', 'HR', 'legal', 'justice', 'resolution', 'advocacy'],
  'customer service': ['customer service', 'customer', 'support', 'retail', 'sales', 'complaint', 'quality', 'helpdesk'],
  'helpdesk': ['helpdesk', 'customer service', 'support', 'IT', 'technical', 'customer', 'service', 'quality'],
  'technical support': ['technical support', 'support', 'IT', 'helpdesk', 'customer', 'service', 'technical', 'quality'],
  'call center': ['call center', 'call centre', 'customer service', 'support', 'telephone', 'customer', 'service', 'sales'],
  'call centre': ['call center', 'call centre', 'customer service', 'support', 'telephone', 'customer', 'service', 'sales'],
  'telephone': ['telephone', 'call center', 'call centre', 'customer service', 'support', 'telephone', 'customer', 'sales'],
  'reception': ['reception', 'receptionist', 'front desk', 'administration', 'customer', 'service', 'office', 'guest'],
  'front desk': ['front desk', 'reception', 'receptionist', 'administration', 'customer', 'service', 'office', 'guest'],
  'secretarial': ['secretarial', 'secretary', 'administration', 'office', 'PA', 'personal assistant', 'executive', 'assistant'],
  'secretary': ['secretary', 'secretarial', 'administration', 'office', 'PA', 'personal assistant', 'executive', 'assistant'],
  'PA': ['PA', 'personal assistant', 'secretary', 'secretarial', 'administration', 'office', 'executive', 'assistant'],
  'personal assistant': ['personal assistant', 'PA', 'secretary', 'secretarial', 'administration', 'office', 'executive', 'assistant'],
  'executive assistant': ['executive assistant', 'assistant', 'PA', 'secretary', 'administration', 'office', 'executive', 'management'],
  'administration': ['administration', 'administrator', 'office', 'management', 'business', 'secretary', 'coordinator', 'assistant'],
  'administrator': ['administrator', 'administration', 'office', 'management', 'business', 'secretary', 'coordinator', 'assistant'],
  'office': ['office', 'office manager', 'administration', 'management', 'business', 'secretary', 'coordinator', 'assistant'],
  'office manager': ['office manager', 'office', 'administration', 'management', 'business', 'secretary', 'coordinator', 'assistant'],
  'coordinator': ['coordinator', 'coordinator', 'administration', 'management', 'business', 'office', 'project', 'assistant'],
  'assistant': ['assistant', 'assistant', 'administration', 'office', 'coordinator', 'secretary', 'PA', 'support'],
  'clerk': ['clerk', 'clerical', 'administration', 'office', 'data', 'records', 'filing', 'assistant'],
  'clerical': ['clerical', 'clerk', 'administration', 'office', 'data', 'records', 'filing', 'assistant'],
  'data': ['data', 'data analyst', 'data scientist', 'database', 'IT', 'research', 'statistics', 'analytics'],
  'data scientist': ['data scientist', 'data science', 'data', 'machine learning', 'AI', 'analytics', 'statistics', 'research'],
  'analytics': ['analytics', 'data analyst', 'data', 'business intelligence', 'BI', 'statistics', 'research', 'IT'],
  'business intelligence': ['business intelligence', 'BI', 'analytics', 'data', 'reporting', 'statistics', 'research', 'IT'],
  'reporting': ['reporting', 'report', 'business intelligence', 'BI', 'analytics', 'data', 'statistics', 'research'],
  'dashboard': ['dashboard', 'reporting', 'business intelligence', 'BI', 'analytics', 'data', 'visualization', 'IT'],
  'visualization': ['visualization', 'data visualization', 'dashboard', 'reporting', 'analytics', 'data', 'design', 'IT'],
  'data visualization': ['data visualization', 'visualization', 'dashboard', 'reporting', 'analytics', 'data', 'design', 'IT'],
  'ETL': ['ETL', 'data engineer', 'data engineering', 'data', 'database', 'pipeline', 'analytics', 'IT'],
  'data engineering': ['data engineering', 'data engineer', 'ETL', 'data', 'database', 'pipeline', 'analytics', 'IT'],
  'data engineer': ['data engineer', 'data engineering', 'ETL', 'data', 'database', 'pipeline', 'analytics', 'IT'],
  'pipeline': ['pipeline', 'data pipeline', 'ETL', 'data engineering', 'data', 'database', 'analytics', 'IT'],
  'data pipeline': ['data pipeline', 'pipeline', 'ETL', 'data engineering', 'data', 'database', 'analytics', 'IT'],
  'warehouse': ['warehouse', 'data warehouse', 'ETL', 'data engineering', 'data', 'database', 'analytics', 'IT'],
  'data warehouse': ['data warehouse', 'warehouse', 'ETL', 'data engineering', 'data', 'database', 'analytics', 'IT'],
  'data lake': ['data lake', 'data', 'data engineering', 'warehouse', 'ETL', 'database', 'analytics', 'IT'],
  'big data': ['big data', 'data', 'data engineering', 'data science', 'analytics', 'Hadoop', 'Spark', 'IT'],
  'Hadoop': ['Hadoop', 'big data', 'data engineering', 'data', 'analytics', 'Spark', 'IT', 'database'],
  'Spark': ['Spark', 'big data', 'data engineering', 'data', 'analytics', 'Hadoop', 'IT', 'database'],
  'NoSQL': ['NoSQL', 'database', 'data engineering', 'data', 'MongoDB', 'Cassandra', 'IT', 'database'],
  'MongoDB': ['MongoDB', 'NoSQL', 'database', 'data engineering', 'data', 'IT', 'database'],
  'Cassandra': ['Cassandra', 'NoSQL', 'database', 'data engineering', 'data', 'IT', 'database'],
  'Redis': ['Redis', 'database', 'cache', 'data engineering', 'data', 'IT', 'database'],
  'Elasticsearch': ['Elasticsearch', 'search', 'database', 'data engineering', 'data', 'IT', 'database'],
  'search': ['search', 'Elasticsearch', 'database', 'data engineering', 'data', 'IT', 'database'],
  'Apache': ['Apache', 'Apache Spark', 'Apache Hadoop', 'big data', 'data engineering', 'data', 'IT', 'database'],
  'Apache Spark': ['Apache Spark', 'Spark', 'Apache', 'big data', 'data engineering', 'data', 'IT', 'database'],
  'Apache Hadoop': ['Apache Hadoop', 'Hadoop', 'Apache', 'big data', 'data engineering', 'data', 'IT', 'database'],
  'Apache Kafka': ['Apache Kafka', 'Kafka', 'Apache', 'data engineering', 'data', 'IT', 'database'],
  'Kafka': ['Kafka', 'Apache Kafka', 'data engineering', 'data', 'IT', 'database'],
  'RabbitMQ': ['RabbitMQ', 'message', 'queue', 'data engineering', 'data', 'IT', 'database'],
  'message queue': ['message queue', 'RabbitMQ', 'Kafka', 'queue', 'data engineering', 'data', 'IT', 'database'],
  'queue': ['queue', 'message queue', 'RabbitMQ', 'Kafka', 'data engineering', 'data', 'IT', 'database'],
  'message': ['message', 'message queue', 'RabbitMQ', 'Kafka', 'communication', 'data', 'IT', 'database'],
  'communication': ['communication', 'communications', 'PR', 'public relations', 'media', 'marketing', 'journalism', 'journalist'],
  'communications': ['communication', 'communications', 'PR', 'public relations', 'media', 'marketing', 'journalism', 'journalist'],
  'public relations': ['PR', 'public relations', 'communication', 'media', 'marketing', 'journalism', 'journalist'],
  'PR': ['PR', 'public relations', 'communication', 'media', 'marketing', 'journalism', 'journalist'],
  'content': ['content', 'content creator', 'writer', 'editor', 'media', 'marketing', 'journalism', 'digital'],
  'content creator': ['content creator', 'content', 'writer', 'editor', 'media', 'marketing', 'journalism', 'digital'],
  'writer': ['writer', 'content', 'author', 'editor', 'media', 'marketing', 'journalism', 'digital'],
  'author': ['author', 'writer', 'content', 'editor', 'media', 'marketing', 'journalism', 'digital'],
  'editor': ['editor', 'content', 'writer', 'author', 'media', 'marketing', 'journalism', 'digital'],
  'copywriting': ['copywriting', 'copywriter', 'writer', 'content', 'marketing', 'advertising', 'media', 'digital'],
  'copywriter': ['copywriter', 'copywriting', 'writer', 'content', 'marketing', 'advertising', 'media', 'digital'],
  'advertising': ['advertising', 'advertiser', 'marketing', 'media', 'creative', 'brand', 'sales', 'digital'],
  'brand': ['brand', 'brand manager', 'branding', 'marketing', 'creative', 'advertising', 'media', 'design'],
  'branding': ['branding', 'brand', 'brand manager', 'marketing', 'creative', 'advertising', 'media', 'design'],
  'brand manager': ['brand manager', 'brand', 'branding', 'marketing', 'creative', 'advertising', 'media', 'design'],
  'digital marketing': ['digital marketing', 'digital', 'marketing', 'social media', 'SEO', 'online', 'content', 'advertising'],
  'digital': ['digital', 'digital marketing', 'marketing', 'social media', 'SEO', 'online', 'content', 'advertising'],
  'social media': ['social media', 'digital marketing', 'marketing', 'social', 'online', 'content', 'advertising', 'community'],
  'SEO': ['SEO', 'search engine optimization', 'digital marketing', 'marketing', 'online', 'content', 'advertising', 'web'],
  'search engine optimization': ['SEO', 'search engine optimization', 'digital marketing', 'marketing', 'online', 'content', 'advertising', 'web'],
  'online': ['online', 'digital', 'digital marketing', 'marketing', 'social media', 'SEO', 'content', 'advertising'],
  'email marketing': ['email marketing', 'digital marketing', 'marketing', 'online', 'content', 'advertising', 'campaign', 'CRM'],
  'campaign': ['campaign', 'campaign manager', 'marketing', 'advertising', 'digital', 'PR', 'communications', 'events'],
  'campaign manager': ['campaign manager', 'campaign', 'marketing', 'advertising', 'digital', 'PR', 'communications', 'events'],
  'CRM': ['CRM', 'customer relationship', 'sales', 'marketing', 'customer', 'database', 'business', 'technology'],
  'customer relationship': ['customer relationship', 'CRM', 'sales', 'marketing', 'customer', 'database', 'business', 'technology'],
  'salesforce': ['salesforce', 'CRM', 'sales', 'marketing', 'customer', 'database', 'business', 'technology'],
  'hubspot': ['hubspot', 'CRM', 'marketing', 'customer', 'database', 'business', 'technology', 'digital'],
  'market research': ['market research', 'research', 'marketing', 'analytics', 'data', 'consumer', 'business', 'strategy'],
  'consumer': ['consumer', 'consumer behavior', 'market research', 'marketing', 'analytics', 'data', 'business', 'strategy'],
  'consumer behavior': ['consumer behavior', 'consumer', 'market research', 'marketing', 'analytics', 'data', 'business', 'psychology'],
  'product management': ['product management', 'product manager', 'product', 'business', 'technology', 'marketing', 'design', 'strategy'],
  'product manager': ['product manager', 'product management', 'product', 'business', 'technology', 'marketing', 'design', 'strategy'],
  'product': ['product', 'product management', 'product manager', 'business', 'technology', 'marketing', 'design', 'strategy'],
  'business development': ['business development', 'business', 'development', 'sales', 'marketing', 'strategy', 'growth', 'partnership'],
  'growth': ['growth', 'growth hacking', 'growth hacker', 'business', 'marketing', 'sales', 'digital', 'strategy'],
  'growth hacking': ['growth hacking', 'growth', 'growth hacker', 'business', 'marketing', 'sales', 'digital', 'strategy'],
  'partnership': ['partnership', 'partnership manager', 'business', 'development', 'sales', 'strategy', 'growth', 'relationship'],
  'partnership manager': ['partnership manager', 'partnership', 'business', 'development', 'sales', 'strategy', 'growth', 'relationship'],
  'relationship': ['relationship', 'relationship manager', 'partnership', 'business', 'sales', 'strategy', 'customer', 'account'],
  'relationship manager': ['relationship manager', 'relationship', 'partnership', 'business', 'sales', 'strategy', 'customer', 'account'],
  'account': ['account', 'account manager', 'sales', 'customer', 'business', 'relationship', 'marketing', 'finance'],
  'account manager': ['account manager', 'account', 'sales', 'customer', 'business', 'relationship', 'marketing', 'finance'],
  'key account': ['key account', 'key account manager', 'account', 'sales', 'customer', 'business', 'relationship', 'marketing'],
  'key account manager': ['key account manager', 'key account', 'account', 'sales', 'customer', 'business', 'relationship', 'marketing'],
  'national account': ['national account', 'national account manager', 'account', 'sales', 'customer', 'business', 'relationship', 'marketing'],
  'national account manager': ['national account manager', 'national account', 'account', 'sales', 'customer', 'business', 'relationship', 'marketing'],
  'territory': ['territory', 'territory manager', 'sales', 'region', 'customer', 'business', 'relationship', 'marketing'],
  'territory manager': ['territory manager', 'territory', 'sales', 'region', 'customer', 'business', 'relationship', 'marketing'],
  'region': ['region', 'regional', 'region manager', 'sales', 'territory', 'customer', 'business', 'relationship', 'marketing'],
  'regional': ['regional', 'region', 'region manager', 'sales', 'territory', 'customer', 'business', 'relationship', 'marketing'],
  'region manager': ['region manager', 'region', 'regional', 'sales', 'territory', 'customer', 'business', 'relationship', 'marketing'],
  'district': ['district', 'district manager', 'sales', 'territory', 'customer', 'business', 'relationship', 'marketing'],
  'district manager': ['district manager', 'district', 'sales', 'territory', 'customer', 'business', 'relationship', 'marketing'],
  'area': ['area', 'area manager', 'sales', 'territory', 'customer', 'business', 'relationship', 'marketing'],
  'area manager': ['area manager', 'area', 'sales', 'territory', 'customer', 'business', 'relationship', 'marketing'],
  'branch': ['branch', 'branch manager', 'sales', 'region', 'customer', 'business', 'relationship', 'marketing'],
  'branch manager': ['branch manager', 'branch', 'sales', 'region', 'customer', 'business', 'relationship', 'marketing'],
  'store': ['store', 'store manager', 'retail', 'sales', 'customer', 'business', 'region', 'marketing'],
  'store manager': ['store manager', 'store', 'retail', 'sales', 'customer', 'business', 'region', 'marketing'],
  'franchise': ['franchise', 'franchisee', 'franchisor', 'retail', 'business', 'sales', 'marketing', 'operations'],
  'franchisee': ['franchisee', 'franchise', 'franchisor', 'retail', 'business', 'sales', 'marketing', 'operations'],
  'franchisor': ['franchisor', 'franchise', 'franchisee', 'retail', 'business', 'sales', 'marketing', 'operations'],
  'wholesale': ['wholesale', 'wholesaler', 'distribution', 'sales', 'supply chain', 'logistics', 'business', 'marketing'],
  'wholesaler': ['wholesaler', 'wholesale', 'distribution', 'sales', 'supply chain', 'logistics', 'business', 'marketing'],
  'distribution': ['distribution', 'distribution manager', 'supply chain', 'logistics', 'sales', 'business', 'marketing', 'warehouse'],
  'distribution manager': ['distribution manager', 'distribution', 'supply chain', 'logistics', 'sales', 'business', 'marketing', 'warehouse'],
  'import': ['import', 'import/export', 'trade', 'customs', 'logistics', 'supply chain', 'business', 'marketing'],
  'export': ['export', 'import/export', 'trade', 'customs', 'logistics', 'supply chain', 'business', 'marketing'],
  'import/export': ['import/export', 'import', 'export', 'trade', 'customs', 'logistics', 'supply chain', 'business', 'marketing'],
  'trade': ['trade', 'import/export', 'import', 'export', 'customs', 'logistics', 'supply chain', 'business', 'marketing'],
  'commodity': ['commodity', 'commodity trader', 'trade', 'finance', 'investment', 'agriculture', 'mining', 'business'],
  'commodity trader': ['commodity trader', 'commodity', 'trade', 'finance', 'investment', 'agriculture', 'mining', 'business'],
  'stock': ['stock', 'stock broker', 'stock trading', 'finance', 'investment', 'securities', 'broker', 'market'],
  'stock broker': ['stock broker', 'stock', 'stock trading', 'finance', 'investment', 'securities', 'broker', 'market'],
  'stock trading': ['stock trading', 'stock', 'stock broker', 'finance', 'investment', 'securities', 'trader', 'market'],
  'securities': ['securities', 'securities analyst', 'finance', 'investment', 'stock', 'broker', 'market', 'trading'],
  'securities analyst': ['securities analyst', 'securities', 'finance', 'investment', 'stock', 'broker', 'market', 'trading'],
  'trader': ['trader', 'trading', 'stock', 'finance', 'investment', 'securities', 'broker', 'market'],
  'trading': ['trading', 'trader', 'stock', 'finance', 'investment', 'securities', 'broker', 'market'],
  'derivatives': ['derivatives', 'derivative', 'finance', 'investment', 'trading', 'risk', 'securities', 'market'],
  'forex': ['forex', 'foreign exchange', 'currency', 'finance', 'trading', 'investment', 'securities', 'market'],
  'foreign exchange': ['forex', 'foreign exchange', 'currency', 'finance', 'trading', 'investment', 'securities', 'market'],
  'currency': ['currency', 'forex', 'foreign exchange', 'finance', 'trading', 'investment', 'securities', 'market'],
  'cryptocurrency': ['cryptocurrency', 'crypto', 'blockchain', 'finance', 'trading', 'investment', 'digital', 'technology'],
  'crypto': ['crypto', 'cryptocurrency', 'blockchain', 'finance', 'trading', 'investment', 'digital', 'technology'],
  'blockchain': ['blockchain', 'crypto', 'cryptocurrency', 'finance', 'trading', 'investment', 'digital', 'technology', 'development'],
  'smart contract': ['smart contract', 'blockchain', 'crypto', 'cryptocurrency', 'finance', 'trading', 'investment', 'digital', 'development'],
  'NFT': ['NFT', 'crypto', 'cryptocurrency', 'blockchain', 'digital', 'art', 'finance', 'trading', 'technology'],
  'DeFi': ['DeFi', 'decentralized finance', 'crypto', 'cryptocurrency', 'blockchain', 'finance', 'trading', 'investment', 'digital'],
  'decentralized finance': ['DeFi', 'decentralized finance', 'crypto', 'cryptocurrency', 'blockchain', 'finance', 'trading', 'investment', 'digital'],
  'fintech': ['fintech', 'financial technology', 'finance', 'technology', 'banking', 'digital', 'investment', 'software'],
  'financial technology': ['fintech', 'financial technology', 'finance', 'technology', 'banking', 'digital', 'investment', 'software'],
  'insurtech': ['insurtech', 'insurance technology', 'insurance', 'technology', 'digital', 'finance', 'software', 'data'],
  'regtech': ['regtech', 'regulatory technology', 'regulatory', 'technology', 'digital', 'compliance', 'finance', 'software'],
  'proptech': ['proptech', 'property technology', 'real estate', 'technology', 'digital', 'finance', 'software', 'data'],
  'property technology': ['proptech', 'property technology', 'real estate', 'technology', 'digital', 'finance', 'software', 'data'],
  'edtech': ['edtech', 'education technology', 'education', 'technology', 'digital', 'software', 'e-learning', 'online'],
  'education technology': ['edtech', 'education technology', 'education', 'technology', 'digital', 'software', 'e-learning', 'online'],
  'healthtech': ['healthtech', 'health technology', 'health', 'technology', 'digital', 'software', 'medical', 'data'],
  'agritech': ['agritech', 'agriculture technology', 'agriculture', 'technology', 'digital', 'software', 'data', 'farming'],
  'agriculture technology': ['agritech', 'agriculture technology', 'agriculture', 'technology', 'digital', 'software', 'data', 'farming'],
  'cleantech': ['cleantech', 'clean technology', 'environmental', 'technology', 'digital', 'software', 'energy', 'sustainable'],
  'clean technology': ['cleantech', 'clean technology', 'environmental', 'technology', 'digital', 'software', 'energy', 'sustainable'],
  'greentech': ['greentech', 'green technology', 'environmental', 'technology', 'digital', 'software', 'energy', 'sustainable'],
  'green technology': ['greentech', 'green technology', 'environmental', 'technology', 'digital', 'software', 'energy', 'sustainable'],
  'martech': ['martech', 'marketing technology', 'marketing', 'technology', 'digital', 'software', 'data', 'analytics'],
  'marketing technology': ['martech', 'marketing technology', 'marketing', 'technology', 'digital', 'software', 'data', 'analytics'],
  'legaltech': ['legaltech', 'legal technology', 'legal', 'technology', 'digital', 'software', 'law', 'compliance'],
  'legal technology': ['legaltech', 'legal technology', 'legal', 'technology', 'digital', 'software', 'law', 'compliance'],
  'HRtech': ['HRtech', 'HR technology', 'HR', 'human resources', 'technology', 'digital', 'software', 'data'],
  'HR technology': ['HRtech', 'HR technology', 'HR', 'human resources', 'technology', 'digital', 'software', 'data'],
  'govtech': ['govtech', 'government technology', 'government', 'technology', 'digital', 'software', 'public', 'data'],
  'government technology': ['govtech', 'government technology', 'government', 'technology', 'digital', 'software', 'public', 'data'],
  'civictech': ['civictech', 'civic technology', 'civic', 'government', 'technology', 'digital', 'software', 'public', 'participation'],
  'civic technology': ['civictech', 'civic technology', 'civic', 'government', 'technology', 'digital', 'software', 'public', 'participation'],
  'smart city': ['smart city', 'smart', 'city', 'urban', 'technology', 'digital', 'government', 'IoT', 'data'],
  'smart': ['smart', 'smart city', 'technology', 'digital', 'IoT', 'data', 'urban', 'government'],
  'e-government': ['e-government', 'digital government', 'government', 'technology', 'digital', 'software', 'public', 'data'],
  'digital government': ['e-government', 'digital government', 'government', 'technology', 'digital', 'software', 'public', 'data'],
  'open data': ['open data', 'data', 'government', 'technology', 'digital', 'public', 'transparency', 'civic'],
  'transparency': ['transparency', 'open data', 'accountability', 'government', 'public', 'civic', 'advocacy', 'NGO'],
  'accountability': ['accountability', 'transparency', 'open data', 'government', 'public', 'civic', 'advocacy', 'NGO'],
  'citizen': ['citizen', 'citizen engagement', 'participation', 'civic', 'government', 'community', 'advocacy', 'NGO'],
  'citizen engagement': ['citizen engagement', 'citizen', 'participation', 'civic', 'government', 'community', 'advocacy', 'NGO'],
  'participatory': ['participatory', 'participation', 'citizen', 'civic', 'government', 'community', 'advocacy', 'NGO'],
  'budget': ['budget', 'budgeting', 'finance', 'government', 'public', 'accounting', 'economics', 'policy'],
  'budgeting': ['budgeting', 'budget', 'finance', 'government', 'public', 'accounting', 'economics', 'policy'],
  'public finance': ['public finance', 'finance', 'government', 'public', 'accounting', 'economics', 'policy', 'budget'],
  'fiscal': ['fiscal', 'fiscal policy', 'finance', 'government', 'public', 'accounting', 'economics', 'policy', 'budget'],
  'fiscal policy': ['fiscal policy', 'fiscal', 'finance', 'government', 'public', 'accounting', 'economics', 'policy', 'budget'],
  'monetary': ['monetary', 'monetary policy', 'finance', 'government', 'central bank', 'economics', 'policy', 'banking'],
  'monetary policy': ['monetary policy', 'monetary', 'finance', 'government', 'central bank', 'economics', 'policy', 'banking'],
  'central bank': ['central bank', 'bank', 'banking', 'finance', 'government', 'monetary', 'economics', 'policy', 'currency'],
  'currency policy': ['currency policy', 'currency', 'central bank', 'bank', 'banking', 'finance', 'government', 'monetary', 'economics'],
  'exchange rate': ['exchange rate', 'currency', 'forex', 'central bank', 'bank', 'banking', 'finance', 'government', 'monetary'],
  'inflation': ['inflation', 'economics', 'finance', 'central bank', 'bank', 'banking', 'government', 'monetary', 'policy'],
  'deflation': ['deflation', 'economics', 'finance', 'central bank', 'bank', 'banking', 'government', 'monetary', 'policy'],
  'interest rate': ['interest rate', 'finance', 'banking', 'central bank', 'economics', 'government', 'monetary', 'policy'],
  'credit policy': ['credit policy', 'credit', 'banking', 'finance', 'central bank', 'economics', 'government', 'monetary', 'policy'],
  'debt': ['debt', 'debt management', 'finance', 'government', 'public', 'economics', 'policy', 'budget'],
  'debt management': ['debt management', 'debt', 'finance', 'government', 'public', 'economics', 'policy', 'budget'],
  'public debt': ['public debt', 'debt', 'finance', 'government', 'public', 'economics', 'policy', 'budget'],
  'sovereign debt': ['sovereign debt', 'debt', 'finance', 'government', 'public', 'economics', 'policy', 'budget'],
  'external debt': ['external debt', 'debt', 'finance', 'government', 'public', 'economics', 'policy', 'budget'],
  'domestic debt': ['domestic debt', 'debt', 'finance', 'government', 'public', 'economics', 'policy', 'budget'],
  'bond': ['bond', 'bonds', 'debt', 'finance', 'government', 'investment', 'securities', 'market', 'trading'],
  'bonds': ['bonds', 'bond', 'debt', 'finance', 'government', 'investment', 'securities', 'market', 'trading'],
  'treasury bill': ['treasury bill', 'treasury', 'government', 'finance', 'investment', 'debt', 'securities', 'market'],
  'treasury bond': ['treasury bond', 'treasury', 'government', 'finance', 'investment', 'debt', 'securities', 'market'],
  'government securities': ['government securities', 'securities', 'government', 'finance', 'investment', 'debt', 'market', 'trading'],
  'pension': ['pension', 'pension fund', 'retirement', 'finance', 'investment', 'social', 'security', 'government'],
  'pension fund': ['pension fund', 'pension', 'retirement', 'finance', 'investment', 'social', 'security', 'government'],
  'retirement': ['retirement', 'pension', 'retirement planning', 'finance', 'investment', 'social', 'security', 'government'],
  'retirement planning': ['retirement planning', 'retirement', 'pension', 'finance', 'investment', 'social', 'security', 'government'],
  'social security': ['social security', 'social', 'security', 'pension', 'retirement', 'finance', 'government', 'welfare'],
  'welfare': ['welfare', 'social', 'security', 'government', 'pension', 'retirement', 'finance', 'social work'],
  'social insurance': ['social insurance', 'social', 'insurance', 'security', 'government', 'pension', 'retirement', 'finance'],
  'unemployment': ['unemployment', 'unemployment insurance', 'social', 'insurance', 'security', 'government', 'pension', 'retirement'],
  'unemployment insurance': ['unemployment insurance', 'unemployment', 'social', 'insurance', 'security', 'government', 'pension', 'retirement'],
  'health insurance': ['health insurance', 'insurance', 'health', 'medical', 'social', 'security', 'government', 'finance'],
  'disability insurance': ['disability insurance', 'insurance', 'disability', 'social', 'security', 'government', 'finance', 'welfare'],
  'life insurance': ['life insurance', 'insurance', 'life', 'social', 'security', 'government', 'finance', 'investment'],
  'microfinance': ['microfinance', 'micro', 'finance', 'banking', 'investment', 'social', 'development', 'NGO'],
  'microcredit': ['microcredit', 'micro', 'credit', 'finance', 'banking', 'investment', 'social', 'development', 'NGO'],
  'SME': ['SME', 'small', 'medium', 'enterprise', 'business', 'finance', 'development', 'government', 'support'],
  'small': ['small', 'SME', 'medium', 'enterprise', 'business', 'finance', 'development', 'government', 'support'],
  'medium': ['medium', 'SME', 'small', 'enterprise', 'business', 'finance', 'development', 'government', 'support'],
  'enterprise': ['enterprise', 'SME', 'small', 'medium', 'business', 'finance', 'development', 'government', 'support'],
  'entrepreneur': ['entrepreneur', 'entrepreneurship', 'business', 'start-up', 'startup', 'innovation', 'enterprise', 'SME'],
  'entrepreneurship': ['entrepreneur', 'entrepreneurship', 'business', 'start-up', 'startup', 'innovation', 'enterprise', 'SME'],
  'start-up': ['start-up', 'startup', 'entrepreneur', 'entrepreneurship', 'business', 'innovation', 'enterprise', 'technology'],
  'startup': ['startup', 'start-up', 'entrepreneur', 'entrepreneurship', 'business', 'innovation', 'enterprise', 'technology'],
  'innovation': ['innovation', 'innovation', 'innovation manager', 'business', 'technology', 'start-up', 'startup', 'R&D', 'research'],
  'innovation manager': ['innovation manager', 'innovation', 'business', 'technology', 'start-up', 'startup', 'R&D', 'research'],
  'R&D': ['R&D', 'research', 'development', 'innovation', 'technology', 'science', 'laboratory', 'engineering', 'product'],
  'research and development': ['R&D', 'research and development', 'research', 'development', 'innovation', 'technology', 'science', 'laboratory', 'engineering'],
  'technology transfer': ['technology transfer', 'technology', 'transfer', 'innovation', 'R&D', 'research', 'development', 'university'],
  'intellectual property': ['intellectual property', 'IP', 'patent', 'copyright', 'trademark', 'technology', 'legal', 'innovation', 'R&D'],
  'patent': ['patent', 'patent attorney', 'patent agent', 'intellectual property', 'IP', 'technology', 'legal', 'innovation', 'R&D'],
  'copyright': ['copyright', 'intellectual property', 'IP', 'technology', 'legal', 'innovation', 'R&D', 'media'],
  'trademark': ['trademark', 'intellectual property', 'IP', 'technology', 'legal', 'innovation', 'R&D', 'brand'],
  'IP': ['IP', 'intellectual property', 'patent', 'copyright', 'trademark', 'technology', 'legal', 'innovation', 'R&D'],
  'technology licensing': ['technology licensing', 'licensing', 'technology', 'IP', 'intellectual property', 'legal', 'innovation', 'R&D'],
  'licensing': ['licensing', 'technology licensing', 'technology', 'IP', 'intellectual property', 'legal', 'innovation', 'R&D'],
  'standards': ['standards', 'standard', 'standardization', 'quality', 'metrology', 'testing', 'compliance', 'certification'],
  'standardization': ['standardization', 'standards', 'standard', 'quality', 'metrology', 'testing', 'compliance', 'certification'],
  'certification': ['certification', 'certification body', 'standards', 'quality', 'compliance', 'testing', 'metrology', 'accreditation'],
  'certification body': ['certification body', 'certification', 'standards', 'quality', 'compliance', 'testing', 'metrology', 'accreditation'],
  'accreditation': ['accreditation', 'accreditation body', 'certification', 'standards', 'quality', 'compliance', 'testing', 'metrology'],
  'accreditation body': ['accreditation body', 'accreditation', 'certification', 'standards', 'quality', 'compliance', 'testing', 'metrology'],
  'inspection body': ['inspection body', 'inspection', 'certification', 'standards', 'quality', 'compliance', 'testing', 'metrology'],
  'notified body': ['notified body', 'certification', 'standards', 'quality', 'compliance', 'testing', 'metrology', 'EU'],
  'EU': ['EU', 'European Union', 'notified body', 'certification', 'standards', 'quality', 'compliance', 'testing', 'metrology'],
  'European Union': ['EU', 'European Union', 'notified body', 'certification', 'standards', 'quality', 'compliance', 'testing', 'metrology'],
  'international trade': ['international trade', 'trade', 'export', 'import', 'customs', 'logistics', 'business', 'WTO'],
  'WTO': ['WTO', 'World Trade Organization', 'international trade', 'trade', 'export', 'import', 'customs', 'business', 'policy'],
  'World Trade Organization': ['WTO', 'World Trade Organization', 'international trade', 'trade', 'export', 'import', 'customs', 'business', 'policy'],
  'African Union': ['African Union', 'AU', 'international', 'Africa', 'policy', 'government', 'diplomatic', 'development'],
  'AU': ['African Union', 'AU', 'international', 'Africa', 'policy', 'government', 'diplomatic', 'development'],
  'SADC': ['SADC', 'Southern African Development Community', 'regional', 'Africa', 'trade', 'development', 'policy', 'government'],
  'Southern African Development Community': ['SADC', 'Southern African Development Community', 'regional', 'Africa', 'trade', 'development', 'policy', 'government'],
  'COMESA': ['COMESA', 'Common Market for Eastern and Southern Africa', 'regional', 'Africa', 'trade', 'development', 'policy', 'government'],
  'Common Market for Eastern and Southern Africa': ['COMESA', 'Common Market for Eastern and Southern Africa', 'regional', 'Africa', 'trade', 'development', 'policy', 'government'],
  'EAC': ['EAC', 'East African Community', 'regional', 'Africa', 'trade', 'development', 'policy', 'government'],
  'East African Community': ['EAC', 'East African Community', 'regional', 'Africa', 'trade', 'development', 'policy', 'government'],
  'ECOWAS': ['ECOWAS', 'Economic Community of West African States', 'regional', 'Africa', 'trade', 'development', 'policy', 'government'],
  'Economic Community of West African States': ['ECOWAS', 'Economic Community of West African States', 'regional', 'Africa', 'trade', 'development', 'policy', 'government'],
  'IFC': ['IFC', 'International Finance Corporation', 'World Bank', 'finance', 'development', 'investment', 'private', 'sector'],
  'International Finance Corporation': ['IFC', 'International Finance Corporation', 'World Bank', 'finance', 'development', 'investment', 'private', 'sector'],
  'IDA': ['IDA', 'International Development Association', 'World Bank', 'finance', 'development', 'investment', 'poor', 'country'],
  'International Development Association': ['IDA', 'International Development Association', 'World Bank', 'finance', 'development', 'investment', 'poor', 'country'],
  'MIGA': ['MIGA', 'Multilateral Investment Guarantee Agency', 'World Bank', 'finance', 'investment', 'risk', 'insurance', 'guarantee'],
  'Multilateral Investment Guarantee Agency': ['MIGA', 'Multilateral Investment Guarantee Agency', 'World Bank', 'finance', 'investment', 'risk', 'insurance', 'guarantee'],
  'ICSID': ['ICSID', 'International Centre for Settlement of Investment Disputes', 'World Bank', 'finance', 'investment', 'dispute', 'arbitration', 'legal'],
  'International Centre for Settlement of Investment Disputes': ['ICSID', 'International Centre for Settlement of Investment Disputes', 'World Bank', 'finance', 'investment', 'dispute', 'arbitration', 'legal'],
  'FAO': ['FAO', 'Food and Agriculture Organization', 'UN', 'agriculture', 'food', 'development', 'policy', 'government', 'international'],
  'Food and Agriculture Organization': ['FAO', 'Food and Agriculture Organization', 'UN', 'agriculture', 'food', 'development', 'policy', 'government', 'international'],
  'ILO': ['ILO', 'International Labour Organization', 'UN', 'labour', 'employment', 'policy', 'government', 'international', 'NGO'],
  'International Labour Organization': ['ILO', 'International Labour Organization', 'UN', 'labour', 'employment', 'policy', 'government', 'international', 'NGO'],
  'WIPO': ['WIPO', 'World Intellectual Property Organization', 'UN', 'intellectual property', 'IP', 'patent', 'technology', 'international', 'legal'],
  'World Intellectual Property Organization': ['WIPO', 'World Intellectual Property Organization', 'UN', 'intellectual property', 'IP', 'patent', 'technology', 'international', 'legal'],
  'ITU': ['ITU', 'International Telecommunication Union', 'UN', 'telecom', 'telecommunications', 'policy', 'government', 'international', 'technology'],
  'International Telecommunication Union': ['ITU', 'International Telecommunication Union', 'UN', 'telecom', 'telecommunications', 'policy', 'government', 'international', 'technology'],
  'UPU': ['UPU', 'Universal Postal Union', 'UN', 'post', 'postal', 'logistics', 'policy', 'government', 'international', 'communication'],
  'Universal Postal Union': ['UPU', 'Universal Postal Union', 'UN', 'post', 'postal', 'logistics', 'policy', 'government', 'international', 'communication'],
  'IMO': ['IMO', 'International Maritime Organization', 'UN', 'maritime', 'shipping', 'policy', 'government', 'international', 'transport'],
  'International Maritime Organization': ['IMO', 'International Maritime Organization', 'UN', 'maritime', 'shipping', 'policy', 'government', 'international', 'transport'],
  'ICAO': ['ICAO', 'International Civil Aviation Organization', 'UN', 'aviation', 'airline', 'airport', 'policy', 'government', 'international', 'transport'],
  'International Civil Aviation Organization': ['ICAO', 'International Civil Aviation Organization', 'UN', 'aviation', 'airline', 'airport', 'policy', 'government', 'international', 'transport'],
  'UNHCR': ['UNHCR', 'United Nations High Commissioner for Refugees', 'UN', 'refugee', 'humanitarian', 'relief', 'international', 'NGO', 'policy'],
  'United Nations High Commissioner for Refugees': ['UNHCR', 'United Nations High Commissioner for Refugees', 'UN', 'refugee', 'humanitarian', 'relief', 'international', 'NGO', 'policy'],
  'refugee': ['refugee', 'UNHCR', 'humanitarian', 'relief', 'international', 'NGO', 'policy', 'displacement', 'migration'],
  'WFP': ['WFP', 'World Food Programme', 'UN', 'food', 'agriculture', 'humanitarian', 'relief', 'international', 'NGO', 'policy'],
  'World Food Programme': ['WFP', 'World Food Programme', 'UN', 'food', 'agriculture', 'humanitarian', 'relief', 'processing'],
  'counterfeit': ['counterfeit', 'counterfeit', 'fraud', 'security', 'customs', 'border', 'trade', 'police', 'investigation'],
  'fraud': ['fraud', 'fraud', 'investigation', 'security', 'customs', 'border', 'audit', 'accounting', 'forensic'],
  'anti-corruption': ['anti-corruption', 'anti-corruption', 'corruption', 'fraud', 'investigation', 'security', 'audit', 'accounting', 'forensic'],
  'corruption': ['corruption', 'anti-corruption', 'fraud', 'investigation', 'security', 'audit', 'accounting', 'forensic'],
  'forensic accounting': ['forensic accounting', 'forensic', 'accounting', 'fraud', 'investigation', 'audit', 'security', 'legal'],
  'investigation': ['investigation', 'investigator', 'detective', 'security', 'police', 'fraud', 'forensic', 'audit', 'intelligence'],
  'intelligence analyst': ['intelligence analyst', 'intelligence', 'security', 'military', 'defence', 'investigation', 'police', 'data'],
  'security consultant': ['security consultant', 'security', 'consultant', 'risk', 'advisor', 'audit', 'investigation', 'protection'],
  'security manager': ['security manager', 'security', 'management', 'risk', 'operations', 'patrol', 'surveillance', 'protection'],
  'security officer': ['security officer', 'security', 'officer', 'guard', 'patrol', 'surveillance', 'protection', 'operations'],
  'security guard': ['security guard', 'security', 'guard', 'officer', 'patrol', 'surveillance', 'protection', 'operations'],
  'access control': ['access control', 'security', 'CCTV', 'surveillance', 'patrol', 'operations', 'guard', 'technology'],
  'fire safety': ['fire safety', 'fire', 'firefighter', 'firefighting', 'emergency', 'rescue', 'safety', 'hazard', 'prevention'],
  'fire prevention': ['fire prevention', 'fire', 'firefighter', 'firefighting', 'emergency', 'rescue', 'safety', 'hazard', 'prevention'],
  'hazard': ['hazard', 'hazard', 'safety', 'fire', 'firefighter', 'emergency', 'rescue', 'environmental', 'risk'],
  'hazardous': ['hazardous', 'hazard', 'safety', 'fire', 'firefighter', 'emergency', 'rescue', 'environmental', 'risk'],
  'risk assessment': ['risk assessment', 'risk', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'insurance'],
  'risk management': ['risk management', 'risk', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'insurance'],
  'safety management': ['safety management', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'health', 'risk'],
  'occupational safety': ['occupational safety', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'health', 'risk'],
  'health and safety': ['health and safety', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'health', 'risk'],
  'environmental safety': ['environmental safety', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'health', 'risk'],
  'process safety': ['process safety', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'chemical', 'risk'],
  'chemical safety': ['chemical safety', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'chemical', 'risk'],
  'biological safety': ['biological safety', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'biological', 'risk'],
  'radiation safety': ['radiation safety', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'radiation', 'risk'],
  'nuclear safety': ['nuclear safety', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'nuclear', 'risk'],
  'electrical safety': ['electrical safety', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'electrical', 'risk'],
  'mechanical safety': ['mechanical safety', 'safety', 'hazard', 'environmental', 'fire', 'emergency', 'mechanical', 'risk'],
  'fire engineering': ['fire engineering', 'fire', 'firefighter', 'firefighting', 'emergency', 'rescue', 'safety', 'hazard', 'engineering'],
  'firefighter': ['firefighter', 'fire', 'firefighting', 'emergency', 'rescue', 'safety', 'hazard', 'risk'],
  'firefighting': ['firefighting', 'fire', 'firefighter', 'emergency', 'rescue', 'safety', 'hazard', 'risk'],
  'emergency': ['emergency', 'emergency', 'emergency response', 'rescue', 'fire', 'firefighter', 'paramedic', 'safety'],
  'IGAD 2': ['IGAD', 'Intergovernmental Authority on Development', 'regional', 'Africa', 'trade', 'development', 'policy', 'government', 'development'],
  'Intergovernmental Authority on Development 2': ['IGAD', 'Intergovernmental Authority on Development', 'regional', 'Africa', 'trade', 'development', 'policy', 'government', 'development'],
  'UN 2': ['UN', 'United Nations', 'international', 'global', 'development', 'policy', 'government', 'NGO', 'humanitarian', 'development'],
  'United Nations 2': ['UN', 'United Nations', 'international', 'global', 'development', 'policy', 'government', 'NGO', 'humanitarian', 'development'],
  'UNDP 2': ['UNDP', 'United Nations Development Programme', 'UN', 'development', 'policy', 'government', 'NGO', 'humanitarian', 'international', 'development'],
  'United Nations Development Programme 2': ['UNDP', 'United Nations Development Programme', 'UN', 'development', 'policy', 'government', 'NGO', 'humanitarian', 'international', 'development'],
  'UNICEF 2': ['UNICEF', 'United Nations Children Fund', 'UN', 'development', 'policy', 'government', 'NGO', 'humanitarian', 'children', 'development'],
  'United Nations Children Fund 2': ['UNICEF', 'United Nations Children Fund', 'UN', 'development', 'policy', 'government', 'NGO', 'humanitarian', 'children', 'development'],
  'UNESCO 2': ['UNESCO', 'United Nations Educational, Scientific and Cultural Organization', 'UN', 'education', 'culture', 'science', 'international', 'heritage', 'development'],
  'United Nations Educational, Scientific and Cultural Organization 2': ['UNESCO', 'United Nations Educational, Scientific and Cultural Organization', 'UN', 'education', 'culture', 'science', 'international', 'heritage', 'development'],
  'WHO 2': ['WHO', 'World Health Organization', 'UN', 'health', 'medical', 'policy', 'government', 'international', 'NGO', 'development'],
  'World Health Organization 2': ['WHO', 'World Health Organization', 'UN', 'health', 'medical', 'policy', 'government', 'international', 'NGO', 'development'],
  'World Bank 2': ['World Bank', 'World Bank Group', 'international', 'finance', 'development', 'policy', 'government', 'NGO', 'investment', 'development'],
  'World Bank Group 2': ['World Bank', 'World Bank Group', 'international', 'finance', 'development', 'policy', 'government', 'NGO', 'investment', 'development'],
  'IMF 2': ['IMF', 'International Monetary Fund', 'international', 'finance', 'development', 'policy', 'government', 'NGO', 'investment', 'development'],
  'International Monetary Fund 2': ['IMF', 'International Monetary Fund', 'international', 'finance', 'development', 'policy', 'government', 'NGO', 'investment', 'development'],
  'IFC 2': ['IFC', 'International Finance Corporation', 'World Bank', 'finance', 'development', 'investment', 'private', 'sector', 'development'],
  'International Finance Corporation 2': ['IFC', 'International Finance Corporation', 'World Bank', 'finance', 'development', 'investment', 'private', 'sector', 'development'],
  'IDA 2': ['IDA', 'International Development Association', 'World Bank', 'finance', 'development', 'investment', 'poor', 'country', 'development'],
  'International Development Association 2': ['IDA', 'International Development Association', 'World Bank', 'finance', 'development', 'investment', 'poor', 'country', 'development'],
  'MIGA 2': ['MIGA', 'Multilateral Investment Guarantee Agency', 'World Bank', 'finance', 'investment', 'risk', 'insurance', 'guarantee', 'development'],
  'Multilateral Investment Guarantee Agency 2': ['MIGA', 'Multilateral Investment Guarantee Agency', 'World Bank', 'finance', 'investment', 'risk', 'insurance', 'guarantee', 'development'],
  'ICSID 2': ['ICSID', 'International Centre for Settlement of Investment Disputes', 'World Bank', 'finance', 'investment', 'dispute', 'arbitration', 'legal', 'development'],
  'International Centre for Settlement of Investment Disputes 2': ['ICSID', 'International Centre for Settlement of Investment Disputes', 'World Bank', 'finance', 'investment', 'dispute', 'arbitration', 'legal', 'development'],
  'FAO 2': ['FAO', 'Food and Agriculture Organization', 'UN', 'agriculture', 'food', 'development', 'policy', 'government', 'international', 'development'],
  'Food and Agriculture Organization 2': ['FAO', 'Food and Agriculture Organization', 'UN', 'agriculture', 'food', 'development', 'policy', 'government', 'international', 'development'],
  'ILO 2': ['ILO', 'International Labour Organization', 'UN', 'labour', 'employment', 'policy', 'government', 'international', 'NGO', 'development'],
  'International Labour Organization 2': ['ILO', 'International Labour Organization', 'UN', 'labour', 'employment', 'policy', 'government', 'international', 'NGO', 'development'],
  'WIPO 2': ['WIPO', 'World Intellectual Property Organization', 'UN', 'intellectual property', 'IP', 'patent', 'technology', 'international', 'legal', 'development'],
  'World Intellectual Property Organization 2': ['WIPO', 'World Intellectual Property Organization', 'UN', 'intellectual property', 'IP', 'patent', 'technology', 'international', 'legal', 'development'],
  'ITU 2': ['ITU', 'International Telecommunication Union', 'UN', 'telecom', 'telecommunications', 'policy', 'government', 'international', 'technology', 'development'],
  'International Telecommunication Union 2': ['ITU', 'International Telecommunication Union', 'UN', 'telecom', 'telecommunications', 'policy', 'government', 'international', 'technology', 'development'],
  'UPU 2': ['UPU', 'Universal Postal Union', 'UN', 'post', 'postal', 'logistics', 'policy', 'government', 'international', 'communication', 'development'],
  'Universal Postal Union 2': ['UPU', 'Universal Postal Union', 'UN', 'post', 'postal', 'logistics', 'policy', 'government', 'international', 'communication', 'development'],
  'IMO 2': ['IMO', 'International Maritime Organization', 'UN', 'maritime', 'shipping', 'policy', 'government', 'international', 'transport', 'development'],
  'International Maritime Organization 2': ['IMO', 'International Maritime Organization', 'UN', 'maritime', 'shipping', 'policy', 'government', 'international', 'transport', 'development'],
  'ICAO 2': ['ICAO', 'International Civil Aviation Organization', 'UN', 'aviation', 'airline', 'airport', 'policy', 'government', 'international', 'transport', 'development'],
  'International Civil Aviation Organization 2': ['ICAO', 'International Civil Aviation Organization', 'UN', 'aviation', 'airline', 'airport', 'policy', 'government', 'international', 'transport', 'development'],
  'UNHCR 2': ['UNHCR', 'United Nations High Commissioner for Refugees', 'UN', 'refugee', 'humanitarian', 'relief', 'international', 'NGO', 'policy', 'development'],
  'United Nations High Commissioner for Refugees 2': ['UNHCR', 'United Nations High Commissioner for Refugees', 'UN', 'refugee', 'humanitarian', 'relief', 'international', 'NGO', 'policy', 'development'],
  'refugee 2': ['refugee', 'UNHCR', 'humanitarian', 'relief', 'international', 'NGO', 'policy', 'displacement', 'migration', 'development'],
  'WFP 2': ['WFP', 'World Food Programme', 'UN', 'food', 'agriculture', 'humanitarian', 'relief', 'international', 'NGO', 'policy', 'development'],
  'World Food Programme 2': ['WFP', 'World Food Programme', 'UN', 'food', 'agriculture', 'humanitarian', 'relief', 'international', 'NGO', 'policy', 'development'],
  'UNFPA': ['UNFPA', 'United Nations Population Fund', 'UN', 'population', 'health', 'family', 'development', 'policy', 'government', 'international', 'development'],
  'United Nations Population Fund': ['UNFPA', 'United Nations Population Fund', 'UN', 'population', 'health', 'family', 'development', 'policy', 'government', 'international', 'development'],
  'UN Women': ['UN Women', 'United Nations Entity for Gender Equality and the Empowerment of Women', 'UN', 'gender', 'women', 'development', 'policy', 'international', 'NGO', 'development'],
  'United Nations Entity for Gender Equality and the Empowerment of Women': ['UN Women', 'United Nations Entity for Gender Equality and the Empowerment of Women', 'UN', 'gender', 'women', 'development', 'policy', 'international', 'NGO', 'development'],
  'gender': ['gender', 'gender equality', 'women', 'development', 'policy', 'international', 'NGO', 'advocacy', 'human rights', 'development'],
  'gender equality': ['gender equality', 'gender', 'women', 'development', 'policy', 'international', 'NGO', 'advocacy', 'human rights', 'development'],
  'women empowerment': ['women empowerment', 'women', 'gender', 'development', 'policy', 'international', 'NGO', 'advocacy', 'human rights', 'development'],
  'empowerment': ['empowerment', 'women empowerment', 'development', 'community', 'social', 'NGO', 'advocacy', 'human rights', 'development'],
  'microenterprise': ['microenterprise', 'micro', 'business', 'SME', 'finance', 'development', 'NGO', 'social', 'entrepreneurship', 'development'],
  'cooperative': ['cooperative', 'co-op', 'business', 'SME', 'finance', 'agriculture', 'development', 'social', 'community', 'development'],
  'co-op': ['co-op', 'cooperative', 'business', 'SME', 'finance', 'agriculture', 'development', 'social', 'community', 'development'],
  'savings': ['savings', 'savings and credit', 'finance', 'banking', 'cooperative', 'microfinance', 'credit', 'union', 'development'],
  'credit union': ['credit union', 'savings', 'finance', 'banking', 'cooperative', 'microfinance', 'credit', 'union', 'development'],
  'union': ['union', 'credit union', 'savings', 'finance', 'banking', 'cooperative', 'microfinance', 'credit', 'development'],
  'village bank': ['village bank', 'microfinance', 'finance', 'banking', 'cooperative', 'community', 'rural', 'development', 'SME', 'development'],
  'self-help': ['self-help', 'community', 'development', 'social', 'NGO', 'empowerment', 'women', 'rural', 'microfinance', 'development'],
  'self-help group': ['self-help group', 'self-help', 'community', 'development', 'social', 'NGO', 'empowerment', 'women', 'rural', 'development'],
  'rotating': ['rotating', 'rotating savings', 'savings', 'finance', 'cooperative', 'community', 'microfinance', 'development', 'SME', 'development'],
  'rotating savings': ['rotating savings', 'rotating', 'savings', 'finance', 'cooperative', 'community', 'microfinance', 'development', 'SME', 'development'],
  'table banking': ['table banking', 'rotating savings', 'savings', 'finance', 'cooperative', 'community', 'microfinance', 'development', 'SME', 'development'],
  'sacco': ['sacco', 'savings', 'credit', 'cooperative', 'microfinance', 'finance', 'community', 'development', 'SME', 'development'],
  'chama': ['chama', 'savings', 'cooperative', 'community', 'microfinance', 'finance', 'development', 'SME', 'social', 'development'],
  'merry-go-round': ['merry-go-round', 'savings', 'cooperative', 'community', 'microfinance', 'finance', 'development', 'SME', 'social', 'development'],
  'tontine': ['tontine', 'savings', 'cooperative', 'community', 'microfinance', 'finance', 'development', 'SME', 'social', 'development'],
  'village savings': ['village savings', 'savings', 'cooperative', 'community', 'microfinance', 'finance', 'rural', 'development', 'SME', 'development'],
  'VSLA': ['VSLA', 'village savings', 'savings', 'cooperative', 'community', 'microfinance', 'finance', 'rural', 'development', 'SME', 'development'],
  'community-based': ['community-based', 'community', 'organization', 'NGO', 'development', 'social', 'health', 'education', 'development'],
  'faith-based': ['faith-based', 'faith', 'religion', 'NGO', 'community', 'development', 'social', 'health', 'education', 'development'],
  'religion': ['religion', 'faith', 'faith-based', 'theology', 'ministry', 'church', 'mosque', 'temple', 'development'],
  'theology': ['theology', 'theologian', 'religion', 'faith', 'ministry', 'church', 'mosque', 'temple', 'development'],
  'ministry': ['ministry', 'minister', 'religion', 'faith', 'church', 'mosque', 'temple', 'theology', 'development'],
  'pastoral': ['pastoral', 'pastor', 'religion', 'faith', 'church', 'ministry', 'theology', 'counseling', 'development'],
  'evangelism': ['evangelism', 'evangelist', 'religion', 'faith', 'church', 'ministry', 'theology', 'mission', 'development'],
  'mission': ['mission', 'missionary', 'religion', 'faith', 'church', 'ministry', 'theology', 'NGO', 'development'],
  'missionary': ['missionary', 'mission', 'religion', 'faith', 'church', 'ministry', 'theology', 'NGO', 'development'],
  'chaplain': ['chaplain', 'chaplaincy', 'religion', 'faith', 'church', 'ministry', 'theology', 'counseling', 'hospital', 'development'],
  'chaplaincy': ['chaplaincy', 'chaplain', 'religion', 'faith', 'church', 'ministry', 'theology', 'counseling', 'hospital', 'development'],
  'hospice': ['hospice', 'palliative', 'care', 'health', 'nursing', 'counseling', 'spiritual', 'support', 'development'],
  'spiritual': ['spiritual', 'spiritual care', 'counseling', 'religion', 'faith', 'pastoral', 'chaplain', 'support', 'development'],
  'spiritual care': ['spiritual care', 'spiritual', 'counseling', 'religion', 'faith', 'pastoral', 'chaplain', 'support', 'development'],
  'bereavement': ['bereavement', 'grief', 'counseling', 'support', 'spiritual', 'pastoral', 'social', 'health', 'development'],
  'grief': ['grief', 'bereavement', 'counseling', 'support', 'spiritual', 'pastoral', 'social', 'health', 'development'],
  'crisis': ['crisis', 'crisis management', 'emergency', 'disaster', 'response', 'counseling', 'social', 'health', 'development'],
  'crisis management': ['crisis management', 'crisis', 'emergency', 'disaster', 'response', 'counseling', 'social', 'health', 'development'],
  'response 2': ['response', 'crisis', 'emergency', 'disaster', 'response', 'counseling', 'social', 'health', 'development'],
  'emergency response 2': ['emergency response', 'emergency', 'crisis', 'disaster', 'response', 'counseling', 'social', 'health', 'development'],
  'business continuity': ['business continuity', 'continuity', 'disaster', 'emergency', 'crisis', 'risk', 'management', 'operations', 'development'],
  'continuity': ['continuity', 'business continuity', 'disaster', 'emergency', 'crisis', 'risk', 'management', 'operations', 'development'],
  'disaster recovery': ['disaster recovery', 'disaster', 'emergency', 'crisis', 'business continuity', 'risk', 'management', 'operations', 'development'],
  'recovery': ['recovery', 'disaster recovery', 'disaster', 'emergency', 'crisis', 'business continuity', 'risk', 'management', 'development'],
  'backup': ['backup', 'disaster recovery', 'disaster', 'emergency', 'IT', 'data', 'operations', 'risk', 'development'],
  'redundancy': ['redundancy', 'backup', 'disaster recovery', 'disaster', 'emergency', 'IT', 'data', 'operations', 'risk', 'development'],
  'failover': ['failover', 'backup', 'disaster recovery', 'disaster', 'emergency', 'IT', 'data', 'operations', 'risk', 'development'],
  'high availability': ['high availability', 'availability', 'backup', 'disaster recovery', 'IT', 'data', 'operations', 'risk', 'development'],
  'availability': ['availability', 'high availability', 'backup', 'disaster recovery', 'IT', 'data', 'operations', 'risk', 'development'],
  'site reliability': ['site reliability', 'SRE', 'availability', 'backup', 'disaster recovery', 'IT', 'data', 'operations', 'risk', 'development'],
  'SRE': ['SRE', 'site reliability', 'availability', 'backup', 'disaster recovery', 'IT', 'data', 'operations', 'risk', 'development'],
  'infrastructure': ['infrastructure', 'infrastructure engineer', 'cloud', 'DevOps', 'IT', 'data', 'operations', 'network', 'development'],
  'infrastructure engineer': ['infrastructure engineer', 'infrastructure', 'cloud', 'DevOps', 'IT', 'data', 'operations', 'network', 'development'],
  'network engineer': ['network engineer', 'network', 'networking', 'IT', 'telecom', 'communications', 'infrastructure', 'data', 'development'],
  'networking': ['networking', 'network', 'network engineer', 'IT', 'telecom', 'communications', 'infrastructure', 'data', 'development'],
  'systems engineer': ['systems engineer', 'systems', 'IT', 'infrastructure', 'network', 'operations', 'software', 'hardware', 'development'],
  'systems': ['systems', 'systems engineer', 'IT', 'infrastructure', 'network', 'operations', 'software', 'hardware', 'development'],
  'platform engineer': ['platform engineer', 'platform', 'software', 'infrastructure', 'cloud', 'DevOps', 'IT', 'operations', 'development'],
  'platform': ['platform', 'platform engineer', 'software', 'infrastructure', 'cloud', 'DevOps', 'IT', 'operations', 'development'],
  'site engineer': ['site engineer', 'site', 'construction', 'civil', 'engineering', 'project', 'management', 'operations', 'development'],
  'site': ['site', 'site engineer', 'construction', 'civil', 'engineering', 'project', 'management', 'operations', 'development'],
  'construction engineer': ['construction engineer', 'construction', 'civil', 'engineering', 'project', 'management', 'site', 'operations', 'development'],
  'construction': ['construction', 'construction engineer', 'civil', 'engineering', 'project', 'management', 'site', 'operations', 'development'],
  'building': ['building', 'construction', 'civil', 'engineering', 'architecture', 'project', 'management', 'site', 'operations', 'development'],
  'structural': ['structural', 'structural engineer', 'civil', 'engineering', 'construction', 'building', 'project', 'design', 'development'],
  'structural engineer': ['structural engineer', 'structural', 'civil', 'engineering', 'construction', 'building', 'project', 'design', 'development'],
  'geotechnical': ['geotechnical', 'geotechnical engineer', 'civil', 'engineering', 'construction', 'building', 'project', 'soil', 'development'],
  'geotechnical engineer': ['geotechnical engineer', 'geotechnical', 'civil', 'engineering', 'construction', 'building', 'project', 'soil', 'development'],
  'transportation': ['transportation', 'transportation engineer', 'civil', 'engineering', 'construction', 'traffic', 'planning', 'project', 'development'],
  'transportation engineer': ['transportation engineer', 'transportation', 'civil', 'engineering', 'construction', 'traffic', 'planning', 'project', 'development'],
  'traffic': ['traffic', 'traffic engineer', 'transportation', 'civil', 'engineering', 'construction', 'planning', 'project', 'development'],
  'traffic engineer': ['traffic engineer', 'traffic', 'transportation', 'civil', 'engineering', 'construction', 'planning', 'project', 'development'],
  'highway': ['highway', 'highway engineer', 'transportation', 'civil', 'engineering', 'construction', 'traffic', 'road', 'development'],
  'highway engineer': ['highway engineer', 'highway', 'transportation', 'civil', 'engineering', 'construction', 'traffic', 'road', 'development'],
  'road': ['road', 'road engineer', 'transportation', 'civil', 'engineering', 'construction', 'traffic', 'highway', 'development'],
  'road engineer': ['road engineer', 'road', 'transportation', 'civil', 'engineering', 'construction', 'traffic', 'highway', 'development'],
  'bridge': ['bridge', 'bridge engineer', 'structural', 'civil', 'engineering', 'construction', 'transportation', 'project', 'development'],
  'bridge engineer': ['bridge engineer', 'bridge', 'structural', 'civil', 'engineering', 'construction', 'transportation', 'project', 'development'],
  'tunnel': ['tunnel', 'tunnel engineer', 'structural', 'civil', 'engineering', 'construction', 'transportation', 'project', 'development'],
  'tunnel engineer': ['tunnel engineer', 'tunnel', 'structural', 'civil', 'engineering', 'construction', 'transportation', 'project', 'development'],
  'dam': ['dam', 'dam engineer', 'hydraulic', 'civil', 'engineering', 'construction', 'water', 'environmental', 'development'],
  'dam engineer': ['dam engineer', 'dam', 'hydraulic', 'civil', 'engineering', 'construction', 'water', 'environmental', 'development'],
  'hydraulic': ['hydraulic', 'hydraulic engineer', 'dam', 'civil', 'engineering', 'construction', 'water', 'environmental', 'development'],
  'hydraulic engineer': ['hydraulic engineer', 'hydraulic', 'dam', 'civil', 'engineering', 'construction', 'water', 'environmental', 'development'],
  'coastal': ['coastal', 'coastal engineer', 'civil', 'engineering', 'construction', 'marine', 'environmental', 'water', 'development'],
  'coastal engineer': ['coastal engineer', 'coastal', 'civil', 'engineering', 'construction', 'marine', 'environmental', 'water', 'development'],
  'port engineer': ['port engineer', 'port', 'coastal', 'civil', 'engineering', 'construction', 'marine', 'transport', 'development'],
  'harbor': ['harbor', 'harbor engineer', 'coastal', 'civil', 'engineering', 'construction', 'marine', 'port', 'development'],
  'harbor engineer': ['harbor engineer', 'harbor', 'coastal', 'civil', 'engineering', 'construction', 'marine', 'port', 'development'],
  'pipeline engineer': ['pipeline engineer', 'pipeline', 'civil', 'engineering', 'construction', 'oil', 'gas', 'water', 'development'],
  'oil': ['oil', 'oil engineer', 'petroleum', 'petroleum engineer', 'chemical', 'energy', 'pipeline', 'gas', 'development'],
  'oil engineer': ['oil engineer', 'oil', 'petroleum', 'petroleum engineer', 'chemical', 'energy', 'pipeline', 'gas', 'development'],
  'gas': ['gas', 'gas engineer', 'petroleum', 'petroleum engineer', 'chemical', 'energy', 'pipeline', 'oil', 'development'],
  'gas engineer': ['gas engineer', 'gas', 'petroleum', 'petroleum engineer', 'chemical', 'energy', 'pipeline', 'oil', 'development'],
  'petroleum': ['petroleum', 'petroleum engineer', 'petroleum engineer', 'oil', 'gas', 'chemical', 'energy', 'pipeline', 'development'],
  'petroleum engineer': ['petroleum engineer', 'petroleum', 'petroleum engineer', 'oil', 'gas', 'chemical', 'energy', 'pipeline', 'development'],
  'reservoir': ['reservoir', 'reservoir engineer', 'petroleum', 'oil', 'gas', 'chemical', 'energy', 'geology', 'development'],
  'reservoir engineer': ['reservoir engineer', 'reservoir', 'petroleum', 'oil', 'gas', 'chemical', 'energy', 'geology', 'development'],
  'drilling': ['drilling', 'drilling engineer', 'petroleum', 'oil', 'gas', 'chemical', 'energy', 'geology', 'development'],
  'drilling engineer': ['drilling engineer', 'drilling', 'petroleum', 'oil', 'gas', 'chemical', 'energy', 'geology', 'development'],
  'well': ['well', 'well engineer', 'drilling', 'petroleum', 'oil', 'gas', 'chemical', 'energy', 'geology', 'development'],
  'well engineer': ['well engineer', 'well', 'drilling', 'petroleum', 'oil', 'gas', 'chemical', 'energy', 'geology', 'development'],
  'completion': ['completion', 'completion engineer', 'drilling', 'petroleum', 'oil', 'gas', 'chemical', 'energy', 'geology', 'development'],
  'completion engineer': ['completion engineer', 'completion', 'drilling', 'petroleum', 'oil', 'gas', 'chemical', 'energy', 'geology', 'development'],
  'production': ['production', 'production engineer', 'manufacturing', 'petroleum', 'oil', 'gas', 'chemical', 'energy', 'development'],
  'production engineer': ['production engineer', 'production', 'manufacturing', 'petroleum', 'oil', 'gas', 'chemical', 'energy', 'development'],
  'manufacturing': ['manufacturing', 'manufacturing engineer', 'production', 'factory', 'industrial', 'mechanical', 'quality', 'operations', 'development'],
  'manufacturing engineer': ['manufacturing engineer', 'manufacturing', 'production', 'factory', 'industrial', 'mechanical', 'quality', 'operations', 'development'],
  'factory': ['factory', 'manufacturing', 'production', 'industrial', 'mechanical', 'quality', 'operations', 'engineering', 'development'],
  'industrial 2': ['industrial', 'industrial engineer', 'manufacturing', 'production', 'factory', 'mechanical', 'quality', 'operations', 'development'],
  'industrial engineer': ['industrial engineer', 'industrial', 'manufacturing', 'production', 'factory', 'mechanical', 'quality', 'operations', 'development'],
  'operations engineer': ['operations engineer', 'operations', 'industrial', 'manufacturing', 'production', 'mechanical', 'quality', 'site', 'development'],
  'maintenance': ['maintenance', 'maintenance engineer', 'mechanical', 'electrical', 'operations', 'industrial', 'manufacturing', 'plant', 'development'],
  'maintenance engineer': ['maintenance engineer', 'maintenance', 'mechanical', 'electrical', 'operations', 'industrial', 'manufacturing', 'plant', 'development'],
  'reliability': ['reliability', 'reliability engineer', 'maintenance', 'mechanical', 'electrical', 'operations', 'industrial', 'manufacturing', 'plant', 'development'],
  'reliability engineer': ['reliability engineer', 'reliability', 'maintenance', 'mechanical', 'electrical', 'operations', 'industrial', 'manufacturing', 'plant', 'development'],
  'asset integrity': ['asset integrity', 'integrity', 'maintenance', 'reliability', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'integrity': ['integrity', 'asset integrity', 'maintenance', 'reliability', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'condition': ['condition', 'condition monitoring', 'maintenance', 'reliability', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'condition monitoring': ['condition monitoring', 'condition', 'maintenance', 'reliability', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'predictive': ['predictive', 'predictive maintenance', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'predictive maintenance': ['predictive maintenance', 'predictive', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'preventive': ['preventive', 'preventive maintenance', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'preventive maintenance': ['preventive maintenance', 'preventive', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'corrective': ['corrective', 'corrective maintenance', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'corrective maintenance': ['corrective maintenance', 'corrective', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'breakdown': ['breakdown', 'breakdown maintenance', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'breakdown maintenance': ['breakdown maintenance', 'breakdown', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'shutdown': ['shutdown', 'shutdown maintenance', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'shutdown maintenance': ['shutdown maintenance', 'shutdown', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'turnaround': ['turnaround', 'turnaround maintenance', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'turnaround maintenance': ['turnaround maintenance', 'turnaround', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'outage': ['outage', 'outage maintenance', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'outage maintenance': ['outage maintenance', 'outage', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'overhaul': ['overhaul', 'overhaul maintenance', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'overhaul maintenance': ['overhaul maintenance', 'overhaul', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'spare parts': ['spare parts', 'parts', 'maintenance', 'reliability', 'condition', 'mechanical', 'electrical', 'operations', 'industrial', 'development'],
  'inventory': ['inventory', 'inventory management', 'supply chain', 'warehouse', 'stock', 'operations', 'logistics', 'procurement', 'development'],
  'inventory management': ['inventory management', 'inventory', 'supply chain', 'warehouse', 'stock', 'operations', 'logistics', 'procurement', 'development'],
  'stock control': ['stock control', 'stock', 'inventory', 'supply chain', 'warehouse', 'operations', 'logistics', 'procurement', 'development'],
  'stock 2': ['stock', 'stock control', 'inventory', 'supply chain', 'warehouse', 'operations', 'logistics', 'procurement', 'development'],
  'warehouse 2': ['warehouse', 'warehouse manager', 'inventory', 'supply chain', 'stock', 'operations', 'logistics', 'procurement', 'development'],
  'warehouse manager': ['warehouse manager', 'warehouse', 'inventory', 'supply chain', 'stock', 'operations', 'logistics', 'procurement', 'development'],
  'storekeeper': ['storekeeper', 'store', 'warehouse', 'inventory', 'stock', 'operations', 'logistics', 'procurement', 'development'],
  'storeman': ['storeman', 'store', 'warehouse', 'inventory', 'stock', 'operations', 'logistics', 'procurement', 'development'],
  'forklift': ['forklift', 'forklift operator', 'warehouse', 'logistics', 'operations', 'transport', 'mechanical', 'driver', 'development'],
  'forklift operator': ['forklift operator', 'forklift', 'warehouse', 'logistics', 'operations', 'transport', 'mechanical', 'driver', 'development'],
  'crane': ['crane', 'crane operator', 'construction', 'operations', 'transport', 'mechanical', 'heavy equipment', 'safety', 'development'],
  'crane operator': ['crane operator', 'crane', 'construction', 'operations', 'transport', 'mechanical', 'heavy equipment', 'safety', 'development'],
  'rigging': ['rigging', 'rigger', 'construction', 'operations', 'transport', 'mechanical', 'heavy equipment', 'safety', 'crane', 'development'],
  'rigger': ['rigger', 'rigging', 'construction', 'operations', 'transport', 'mechanical', 'heavy equipment', 'safety', 'crane', 'development'],
  'scaffolding': ['scaffolding', 'scaffolder', 'construction', 'operations', 'safety', 'crane', 'building', 'steel', 'development'],
  'scaffolder': ['scaffolder', 'scaffolding', 'construction', 'operations', 'safety', 'crane', 'building', 'steel', 'development'],
  'steel': ['steel', 'steel erector', 'construction', 'operations', 'safety', 'crane', 'building', 'scaffolding', 'development'],
  'steel erector': ['steel erector', 'steel', 'construction', 'operations', 'safety', 'crane', 'building', 'scaffolding', 'development'],
  'concreting': ['concreting', 'concrete', 'construction', 'operations', 'civil', 'building', 'steel', 'scaffolding', 'development'],
  'concrete': ['concrete', 'concreting', 'construction', 'operations', 'civil', 'building', 'steel', 'scaffolding', 'development'],
  'formwork': ['formwork', 'concrete', 'construction', 'operations', 'civil', 'building', 'steel', 'scaffolding', 'development'],
  'rebar': ['rebar', 'concrete', 'construction', 'operations', 'civil', 'building', 'steel', 'scaffolding', 'development'],
  'masonry': ['masonry', 'mason', 'construction', 'operations', 'civil', 'building', 'brick', 'stone', 'development'],
  'mason': ['mason', 'masonry', 'construction', 'operations', 'civil', 'building', 'brick', 'stone', 'development'],
  'brick': ['brick', 'bricklayer', 'masonry', 'construction', 'operations', 'civil', 'building', 'stone', 'development'],
  'bricklayer': ['bricklayer', 'brick', 'masonry', 'construction', 'operations', 'civil', 'building', 'stone', 'development'],
  'stone': ['stone', 'stonemason', 'masonry', 'construction', 'operations', 'civil', 'building', 'brick', 'development'],
  'stonemason': ['stonemason', 'stone', 'masonry', 'construction', 'operations', 'civil', 'building', 'brick', 'development'],
  'tiling': ['tiling', 'tiler', 'construction', 'operations', 'civil', 'building', 'floor', 'wall', 'development'],
  'tiler': ['tiler', 'tiling', 'construction', 'operations', 'civil', 'building', 'floor', 'wall', 'development'],
  'painting': ['painting', 'painter', 'construction', 'operations', 'civil', 'building', 'decor', 'wall', 'development'],
  'painter': ['painter', 'painting', 'construction', 'operations', 'civil', 'building', 'decor', 'wall', 'development'],
  'decor': ['decor', 'decorator', 'painting', 'construction', 'operations', 'civil', 'building', 'interior', 'design', 'development'],
  'decorator': ['decorator', 'decor', 'painting', 'construction', 'operations', 'civil', 'building', 'interior', 'design', 'development'],
  'plastering': ['plastering', 'plasterer', 'construction', 'operations', 'civil', 'building', 'wall', 'decor', 'development'],
  'plasterer': ['plasterer', 'plastering', 'construction', 'operations', 'civil', 'building', 'wall', 'decor', 'development'],
  'drywall': ['drywall', 'drywall installer', 'construction', 'operations', 'civil', 'building', 'wall', 'decor', 'development'],
  'drywall installer': ['drywall installer', 'drywall', 'construction', 'operations', 'civil', 'building', 'wall', 'decor', 'development'],
  'insulation': ['insulation', 'insulation installer', 'construction', 'operations', 'civil', 'building', 'energy', 'thermal', 'development'],
  'insulation installer': ['insulation installer', 'insulation', 'construction', 'operations', 'civil', 'building', 'energy', 'thermal', 'development'],
  'roofing': ['roofing', 'roofer', 'construction', 'operations', 'civil', 'building', 'solar', 'thermal', 'development'],
  'roofer': ['roofer', 'roofing', 'construction', 'operations', 'civil', 'building', 'solar', 'thermal', 'development'],
  'glazing': ['glazing', 'glazier', 'construction', 'operations', 'civil', 'building', 'glass', 'window', 'development'],
  'glazier': ['glazier', 'glazing', 'construction', 'operations', 'civil', 'building', 'glass', 'window', 'development'],
  'window': ['window', 'window installer', 'construction', 'operations', 'civil', 'building', 'glass', 'door', 'development'],
  'window installer': ['window installer', 'window', 'construction', 'operations', 'civil', 'building', 'glass', 'door', 'development'],
  'door': ['door', 'door installer', 'construction', 'operations', 'civil', 'building', 'wood', 'metal', 'development'],
  'door installer': ['door installer', 'door', 'construction', 'operations', 'civil', 'building', 'wood', 'metal', 'development'],
  'joinery': ['joinery', 'joiner', 'construction', 'operations', 'civil', 'building', 'wood', 'carpentry', 'door', 'development'],
  'joiner': ['joiner', 'joinery', 'construction', 'operations', 'civil', 'building', 'wood', 'carpentry', 'door', 'development'],
  'carpentry 2': ['carpentry', 'carpenter', 'construction', 'operations', 'civil', 'building', 'wood', 'joinery', 'door', 'development'],
  'carpenter': ['carpenter', 'carpentry', 'construction', 'operations', 'civil', 'building', 'wood', 'joinery', 'door', 'development'],
  'woodwork': ['woodwork', 'woodworker', 'carpentry', 'construction', 'operations', 'civil', 'building', 'wood', 'joinery', 'development'],
  'woodworker': ['woodworker', 'woodwork', 'carpentry', 'construction', 'operations', 'civil', 'building', 'wood', 'joinery', 'development'],
  'furniture': ['furniture', 'furniture maker', 'carpentry', 'construction', 'operations', 'wood', 'design', 'creative', 'manufacturing', 'development'],
  'furniture maker': ['furniture maker', 'furniture', 'carpentry', 'construction', 'operations', 'wood', 'design', 'creative', 'manufacturing', 'development'],
  'cabinet': ['cabinet', 'cabinet maker', 'furniture', 'carpentry', 'construction', 'operations', 'wood', 'design', 'creative', 'development'],
  'cabinet maker': ['cabinet maker', 'cabinet', 'furniture', 'carpentry', 'construction', 'operations', 'wood', 'design', 'creative', 'development'],
  'upholstery': ['upholstery', 'upholsterer', 'furniture', 'carpentry', 'construction', 'operations', 'fabric', 'design', 'creative', 'development'],
  'upholsterer': ['upholsterer', 'upholstery', 'furniture', 'carpentry', 'construction', 'operations', 'fabric', 'design', 'creative', 'development'],
  'sanding': ['sanding', 'sander', 'furniture', 'carpentry', 'construction', 'operations', 'wood', 'finishing', 'creative', 'development'],
  'sander': ['sander', 'sanding', 'furniture', 'carpentry', 'construction', 'operations', 'wood', 'finishing', 'creative', 'development'],
  'finishing': ['finishing', 'finisher', 'furniture', 'carpentry', 'construction', 'operations', 'wood', 'sanding', 'painting', 'development'],
  'finisher': ['finisher', 'finishing', 'furniture', 'carpentry', 'construction', 'operations', 'wood', 'sanding', 'painting', 'development'],
  'spray': ['spray', 'spray painter', 'painting', 'furniture', 'construction', 'operations', 'finishing', 'creative', 'automotive', 'development'],
  'spray painter': ['spray painter', 'spray', 'painting', 'furniture', 'construction', 'operations', 'finishing', 'creative', 'automotive', 'development'],
  'powder coating': ['powder coating', 'coating', 'paint', 'finishing', 'furniture', 'manufacturing', 'creative', 'automotive', 'development'],
  'coating': ['coating', 'powder coating', 'paint', 'finishing', 'furniture', 'manufacturing', 'creative', 'automotive', 'development'],
  'anodizing': ['anodizing', 'coating', 'paint', 'finishing', 'metal', 'manufacturing', 'creative', 'automotive', 'development'],
  'galvanizing': ['galvanizing', 'coating', 'paint', 'finishing', 'metal', 'manufacturing', 'creative', 'automotive', 'development'],
  'electroplating': ['electroplating', 'coating', 'paint', 'finishing', 'metal', 'manufacturing', 'creative', 'automotive', 'development'],
  'plating': ['plating', 'coating', 'paint', 'finishing', 'metal', 'manufacturing', 'creative', 'automotive', 'development'],
  'polishing': ['polishing', 'polisher', 'finishing', 'metal', 'furniture', 'creative', 'automotive', 'jewelry', 'development'],
  'polisher': ['polisher', 'polishing', 'finishing', 'metal', 'furniture', 'creative', 'automotive', 'jewelry', 'development'],
  'grinding': ['grinding', 'grinder', 'finishing', 'metal', 'furniture', 'creative', 'automotive', 'manufacturing', 'development'],
  'grinder': ['grinder', 'grinding', 'finishing', 'metal', 'furniture', 'creative', 'automotive', 'manufacturing', 'development'],
  'buffing': ['buffing', 'buffer', 'finishing', 'metal', 'furniture', 'creative', 'automotive', 'manufacturing', 'development'],
  'buffer': ['buffer', 'buffing', 'finishing', 'metal', 'furniture', 'creative', 'automotive', 'manufacturing', 'development'],
  'lathe': ['lathe', 'lathe operator', 'metal', 'manufacturing', 'creative', 'automotive', 'machining', 'engineering', 'development'],
  'lathe operator': ['lathe operator', 'lathe', 'metal', 'manufacturing', 'creative', 'automotive', 'machining', 'engineering', 'development'],
  'milling': ['milling', 'milling operator', 'metal', 'manufacturing', 'creative', 'automotive', 'machining', 'engineering', 'development'],
  'milling operator': ['milling operator', 'milling', 'metal', 'manufacturing', 'creative', 'automotive', 'machining', 'engineering', 'development'],
  'machining': ['machining', 'machinist', 'metal', 'manufacturing', 'creative', 'automotive', 'lathe', 'milling', 'engineering', 'development'],
  'machinist': ['machinist', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'lathe', 'milling', 'engineering', 'development'],
  'CNC': ['CNC', 'CNC operator', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'CNC operator': ['CNC operator', 'CNC', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'programmable': ['programmable', 'CNC', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'tool': ['tool', 'toolmaker', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'toolmaker': ['toolmaker', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'die': ['die', 'die maker', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'die maker': ['die maker', 'die', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'mold': ['mold', 'mold maker', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'mold maker': ['mold maker', 'mold', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'pattern': ['pattern', 'pattern maker', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'pattern maker': ['pattern maker', 'pattern', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'jig': ['jig', 'jig maker', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'jig maker': ['jig maker', 'jig', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'fixture': ['fixture', 'fixture maker', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'fixture maker': ['fixture maker', 'fixture', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'gauge': ['gauge', 'gauge maker', 'tool', 'machining', 'metal', 'manufacturing', 'creative', 'automotive', 'engineering', 'development'],
  'inspector': ['inspector', 'inspection', 'quality', 'safety', 'compliance', 'audit', 'food', 'health', 'development'],
  'quality inspector': ['quality inspector', 'inspection', 'quality', 'safety', 'compliance', 'audit', 'food', 'health', 'development'],
  'safety inspector': ['safety inspector', 'inspection', 'safety', 'compliance', 'audit', 'health', 'environmental', 'development'],
};

/**
 * Check if the local table has any data.
 */
export async function hasLocalCompanies(): Promise<boolean> {
  try {
    const { count, error } = await supabase
      .from('zambian_companies')
      .select('*', { count: 'exact', head: true });
    return !error && (count ?? 0) > 0;
  } catch {
    return false;
  }
}
