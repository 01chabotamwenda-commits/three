/**
 * Client-side, zero-cost text extraction and CV parsing.
 * Used as a free alternative to paid AI edge functions.
 */

/**
 * Extract readable text from a base64-encoded PDF without any AI or server call.
 * Works for most text-based PDFs (Word exports, standard CV generators).
 * Returns null if no usable text is found (e.g., scanned image PDFs).
 */
export function extractTextFromBase64Pdf(base64: string): string | null {
  try {
    const binary = typeof atob !== 'undefined' ? atob(base64) : Buffer.from(base64, 'base64').toString('latin1');

    // Strategy 1: Extract strings only inside PDF text blocks (BT ... ET).
    // PDFs mix metadata, Type/Pages declarations, XREF tables, etc. with text.
    // Only parenthesized strings between BT and ET operators are actual page text.
    const textParts: string[] = [];
    const btEtRegex = /BT[\s\S]*?ET/g;
    let btMatch: RegExpExecArray | null;

    while ((btMatch = btEtRegex.exec(binary)) !== null) {
      const block = btMatch[0];
      // Find string literals (text) inside the block
      const stringRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let sMatch: RegExpExecArray | null;
      while ((sMatch = stringRegex.exec(block)) !== null) {
        const raw = sMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
          .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
          .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
          .trim();
        // Only keep strings that look like human text
        if (raw.length >= 3 && /[a-zA-Z]{2,}/.test(raw) && !isPdfStructural(raw)) {
          textParts.push(raw);
        }
      }
    }

    if (textParts.length > 0) {
      const joined = textParts.join(' ').replace(/\s+/g, ' ').trim();
      if (joined.length > 100) return joined;
    }

    // Strategy 2: If no BT/ET found, find long runs of printable ASCII
    // but aggressively filter out PDF structural patterns
    const readable = binary.replace(/[^\x20-\x7E\n\r]/g, ' ');
    const chunks = readable.match(/(?:[A-Za-z][a-zA-Z0-9@.+\-_,:/() ]{8,})/g) ?? [];
    const filtered = chunks.filter(c => !isPdfStructural(c));
    const joined2 = filtered.join(' ').replace(/\s+/g, ' ').trim();
    return joined2.length > 100 ? joined2 : null;
  } catch {
    return null;
  }
}

/** Detect PDF structural / metadata text so it doesn't leak into profile fields. */
function isPdfStructural(s: string): boolean {
  const bad = [
    'PDF-',
    'MarkInfo',
    'Metadata',
    'ViewerPreferences',
    'endobj',
    'endstream',
    '/Type/Pages',
    '/Type/Catalog',
    '/Type/Font',
    '/Type/ExtGState',
    '/Length',
    ' 0 R',       // object reference like "211 0 R"
    'obj <<',
    '/ProcSet',
    '/Font',
    '/MediaBox',
    '/ColorSpace',
    '/XObject',
    '/ExtGState',
    '/Pattern',
    '/Shading',
    '/Encoding',
    '/ToUnicode',
    '/Root',
    '/Info',
    '/Page',
    '/Pages',
    '/Parent',
    '/Resources',
    '/Contents',
  ];
  const lower = s.toLowerCase();
  return bad.some(b => lower.includes(b.toLowerCase()));
}

/**
 * Decode a base64 data-URL back into plain text.
 */
function decodeDataUrl(dataUrl: string): string | null {
  try {
    const comma = dataUrl.indexOf(',');
    if (comma === -1) return null;
    const b64 = dataUrl.slice(comma + 1);
    const isBase64 = dataUrl.slice(0, comma).includes('base64');
    if (isBase64) {
      return typeof atob !== 'undefined' ? atob(b64) : null;
    }
    return decodeURIComponent(b64);
  } catch {
    return null;
  }
}

/**
 * Attempt to extract readable text from a file without calling any server.
 * Works for plain-text files and base64 data URLs. Returns null for unsupported formats.
 */
export async function extractTextClientSide(
  fileOrUri: File | string,
  contentType: string,
): Promise<string | null> {
  const isText =
    contentType.startsWith('text/') ||
    ['application/json', 'application/xml', 'application/javascript'].includes(contentType);

  if (!isText) return null;

  if (typeof fileOrUri === 'string') {
    if (fileOrUri.startsWith('data:')) return decodeDataUrl(fileOrUri);
    return null;
  }

  // Web File object — read as text directly
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsText(fileOrUri);
  });
}

/**
 * Heuristic CV parser — scans raw text for common profile field patterns.
 * No AI, no network, completely free.
 */
export function heuristicParseProfile(text: string): {
  displayName?: string;
  currentDegree?: string;
  institution?: string;
  yearOfStudy?: string;
  skills?: string;
  city?: string;
  preferredIndustries?: string;
  careerGoals?: string;
  portfolioUrl?: string;
  profileFields?: Array<{ label: string; value: string }>;
} {
  const rawLines = text.split(/\r?\n/);
  // Clean lines: remove bullet chars, excess whitespace, and page breaks
  const lines = rawLines
    .map(l => l.replace(/^[\s\u2022\u25e6\u25aa\u25ab\u2713\-]+/, '').trim())
    .filter(l => l.length > 0 && !/^\d+$/.test(l) && !/^page\s*\d+$/i.test(l));
  const joined = lines.join(' ');
  const result: ReturnType<typeof heuristicParseProfile> = {};
  const extras: Array<{ label: string; value: string }> = [];

  function isNoise(s: string) {
    const noise = ['page', 'of', 'curriculum vitae', 'resume', 'cv', 'referee', 'reference', 'document'];
    return noise.some((n) => s.toLowerCase().includes(n));
  }

  function cleanValue(s: string): string {
    return s
      // Strip ALL markdown bold/italic markers globally
      .replace(/\*\*/g, '')
      .replace(/__/g, '')
      // Strip bullet chars and markdown from start
      .replace(/^[\s\u2022\u25e6\u25aa\u25ab\u2713\-\*]+/, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Name ──
  // Strategy 1: look for explicit labels
  const namePatterns = ['full name', 'name:', 'name', 'candidate', 'personal details'];
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (namePatterns.some(p => lower.includes(p))) {
      let val = lines[i].replace(/.*(?:name|candidate)[:\-\s]*/i, '').trim();
      if (val && val.length > 2 && !isNoise(val) && val.length <= 60) {
        result.displayName = val;
        break;
      }
      const next = lines[i + 1]?.trim();
      if (next && next.length > 2 && next.length <= 60 && !isNoise(next)) {
        result.displayName = next;
        break;
      }
    }
  }
  // Strategy 2: first non-noise line that looks like a name (2-4 capitalized words)
  if (!result.displayName) {
    for (const line of lines.slice(0, 8)) {
      const clean = line.replace(/\s+/g, ' ').trim();
      if (clean.length > 4 && clean.length < 50 && /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(clean) && !isNoise(clean)) {
        result.displayName = clean;
        break;
      }
    }
  }
  // Strategy 3: just use first reasonable line
  if (!result.displayName) {
    const first = lines.find(l => l.length > 3 && l.length < 50 && !isNoise(l) && !l.includes('@') && !/\d{4,}/.test(l));
    if (first) result.displayName = first;
  }

  // ── Email ──
  const emailMatches = joined.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (emailMatches) {
    extras.push({ label: 'Email', value: emailMatches[0] });
    // Add secondary emails as extra fields
    emailMatches.slice(1).forEach((em, idx) => {
      extras.push({ label: `Email ${idx + 2}`, value: em });
    });
  }

  // ── Phone ──
  const phoneMatches = joined.match(
    /(?:\+?\d{1,4}[\s\-/]?(?:\(?\d{2,4}\)?[\s\-/.]?)\d{3,4}[\s\-/.]?\d{3,4})/g,
  );
  if (phoneMatches) {
    const uniquePhones = [...new Set(phoneMatches.map(p => p.trim()).filter(p => p.length >= 10))];
    uniquePhones.forEach((p, idx) => {
      extras.push({ label: idx === 0 ? 'Phone' : `Phone ${idx + 1}`, value: p });
    });
  }

  // ── Helper: find section content after a heading ──
  function findSectionContent(
    headingPatterns: string[],
    maxLines = 6,
    maxChars = 200,
  ): string | undefined {
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      // Heading must be short (< 45 chars) and match as a heading word —
      // body text that merely *contains* the keyword must not match.
      const isHeading = lower.length < 45 && headingPatterns.some(p => {
        // Require keyword at start of line, after optional bullets/markdown,
        // or as a whole word so "degree-level skills" doesn't match "degree"
        const pat = p.replace(/:$/, '');
        const startRe = new RegExp(`^[\\s\\-*•]*${pat}\\b`, 'i');
        const wordRe = new RegExp(`\\b${pat}\\b`, 'i');
        return startRe.test(lines[i]) || (wordRe.test(lines[i]) && lower.length < 30);
      });
      if (isHeading) {
        const content: string[] = [];
        for (let j = i + 1; j < Math.min(lines.length, i + 1 + maxLines); j++) {
          const line = lines[j];
          // Stop at next major section header (also catches **Education**, **Skills:**, etc.)
          const headerRegex = /^(?:\*\*)?(education|experience|skills?|projects|certifications?|leadership|professional profile|objective|references|value to)[\*\s:]*/i;
          if (headerRegex.test(line)) break;
          if (line.length > 0 && !isNoise(line)) content.push(cleanValue(line));
        }
        const val = content.join(', ').trim();
        if (val && val.length > 3 && val.length <= maxChars) return val;
      }
    }
    return undefined;
  }

  // ── Degree ──
  const degreePatterns = ['current degree', 'qualification', 'education', 'academic background', 'degree:', 'degree'];
  result.currentDegree = findSectionContent(degreePatterns, 3, 150);
  // Fallback: look for degree patterns in full text (stop at sentence boundary or newline)
  if (!result.currentDegree) {
    const degFallback = joined.match(
      /\b(B\.?Sc|B\.?A|M\.?Sc|M\.?A|Ph\.?D|MBA|M\.?B\.?A|B\.?Eng|B\.?Tech|Diploma|Certificate|Hons|Honours)\s*(?:in|of)?\s*[A-Z][a-zA-Z\s&,]{0,60}(?=\b(?:at|from|University|College|Institute|School|\d{4}|\n|\.|,\s*\d|\z))/i,
    );
    if (degFallback) {
      result.currentDegree = degFallback[0].trim().replace(/\s+/g, ' ').replace(/\s*\.\s*$/, '');
    }
  }

  // ── Institution ──
  const instPatterns = ['institution', 'university', 'college', 'school attended', 'education'];
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (instPatterns.some(p => lower.includes(p))) {
      // Try to find university name on this line or next few lines
      for (let j = i; j < Math.min(lines.length, i + 3); j++) {
        const line = lines[j];
        // Look for known university patterns or just a proper institution name
        if (/\b(university|college|institute|school|academy)\b/i.test(line) && !/society|mentorship|club|team/i.test(line)) {
          const cleaned = cleanValue(line);
          if (cleaned.length > 5 && cleaned.length <= 120) {
            result.institution = cleaned;
            break;
          }
        }
      }
      if (result.institution) break;
    }
  }
  // Fallback: find "University" or "College" in the text
  if (!result.institution) {
    const instFallback = joined.match(/\b([A-Z][a-zA-Z\s]+(?:University|College|Institute|School))\b/i);
    if (instFallback) result.institution = instFallback[0].trim();
  }

  // ── Year of Study ──
  const yearPatterns = ['year of study', 'current year', 'academic year', 'level', 'year'];
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (yearPatterns.some(p => lower.includes(p))) {
      // Look for Year X pattern
      const yrMatch = lines[i].match(/\b(\d+(?:th|st|nd|rd)?)\s*(?:year|level)\b/i);
      if (yrMatch) {
        result.yearOfStudy = yrMatch[0].trim();
        break;
      }
      const next = lines[i + 1];
      if (next) {
        const nextMatch = next.match(/\b(\d+(?:th|st|nd|rd)?)\s*(?:year|level)\b/i);
        if (nextMatch) {
          result.yearOfStudy = nextMatch[0].trim();
          break;
        }
      }
    }
  }
  if (!result.yearOfStudy) {
    const yrFallback = joined.match(/\b(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth)\s+year\b/i);
    if (yrFallback) result.yearOfStudy = yrFallback[0].trim();
  }

  // ── Skills ──
  const skillPatterns = ['technical skills', 'skills:', 'skills', 'competencies', 'key skills', 'proficiencies'];
  result.skills = findSectionContent(skillPatterns, 10, 300);
  if (!result.skills) {
    // Look for bullet-point lists that might be skills
    // Require heading-like occurrence: short line (< 30 chars) with "skills" as a word
    for (let i = 0; i < lines.length; i++) {
      const li = lines[i].toLowerCase();
      const isSkillHeading = li.length < 30 && /\b(skills|competencies|proficiencies|expertise)\b/i.test(li) && !/\b(developed|gained|with|including|and)\b/i.test(li);
      if (!isSkillHeading) continue;
      const bullets: string[] = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const line = rawLines[j]; // use raw to detect bullets
        // Stop at next major section header (raw, uncleaned)
        if (/^\s*(?:\*\*)?(?:education|experience|projects|certifications|leadership|professional profile|objective|references|value to)\b/i.test(line)) break;
        if (line.trim().startsWith('•') || line.trim().startsWith('-') || line.trim().startsWith('*')) {
          const cleaned = cleanValue(line);
          // Don't capture degree text masquerading as a skill
          if (cleaned && !/\b(B\.?Sc|B\.?A|M\.?Sc|Ph\.?D|MBA|Diploma|Certificate|University|College)\b/i.test(cleaned)) {
            bullets.push(cleaned);
          }
        } else if (line.trim().length > 0 && /[;,]/.test(line) && bullets.length > 0) {
          // Comma-separated continuation of skills
          bullets.push(cleanValue(line));
        } else if (line.trim().length > 0 && bullets.length > 0 && !line.trim().startsWith('•') && !line.trim().startsWith('-')) {
          // Part of previous bullet (wrapped line)
          bullets[bullets.length - 1] += ' ' + cleanValue(line);
        }
      }
      if (bullets.length > 0) {
        result.skills = bullets.join(', ');
        break;
      }
    }
  }

  // ── City / Location ──
  const cityPatterns = ['city', 'location', 'address', 'based in', 'residence', 'from'];
  result.city = findSectionContent(cityPatterns, 2, 80);
  if (!result.city) {
    // Look for "City, Country" patterns
    const cityFallback = joined.match(/\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?,\s*[A-Z][a-zA-Z]+)\b/);
    if (cityFallback) result.city = cityFallback[0].trim();
  }

  // ── Industries ──
  const indPatterns = ['preferred industries', 'industries', 'sector', 'field of interest', 'industry'];
  result.preferredIndustries = findSectionContent(indPatterns, 3, 200);

  // ── Career Goals / Objective ──
  const goalPatterns = ['career goals', 'objective', 'career objective', 'ambition', 'aspiration', 'professional profile', 'summary'];
  result.careerGoals = findSectionContent(goalPatterns, 4, 250);

  // ── LinkedIn / Portfolio / URLs ──
  // Match both http(s):// and bare www. links
  const urlMatch = joined.match(/(?:https?:\/\/|www\.)[^\s\)]+/gi);
  if (urlMatch) {
    const normalized = urlMatch.map(u => u.startsWith('www.') ? `https://${u}` : u);
    const linkedIn = normalized.find(u => /linkedin/i.test(u));
    const github = normalized.find(u => /github/i.test(u));
    const portfolio = normalized.find(u => /portfolio|behance|dribbble/i.test(u));
    if (linkedIn) extras.push({ label: 'LinkedIn', value: linkedIn });
    if (github) extras.push({ label: 'GitHub', value: github });
    if (portfolio) extras.push({ label: 'Website', value: portfolio });
    // Add any remaining URLs not already captured
    normalized.forEach(u => {
      const already = [linkedIn, github, portfolio].some(x => x === u);
      if (!already && !extras.some(e => e.value === u)) {
        extras.push({ label: 'Website', value: u });
      }
    });
  }

  if (extras.length) result.profileFields = extras;
  return result;
}
