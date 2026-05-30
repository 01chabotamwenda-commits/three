import { UserProfile, DocCategory, StoredDocument } from '@/context/AppContext';

const CV_PRIORITY: DocCategory[] = [
  'CV / Resume',
  'Academic Transcript',
  'Certificate',
  'Cover Letter',
  'Reference Letter',
  'Portfolio',
  'Other',
];

export function getCvContent(docs: StoredDocument[]): string | undefined {
  for (const cat of CV_PRIORITY) {
    const doc = docs.find(d => d.category === cat && d.extractedText?.trim());
    if (doc) return doc.extractedText;
  }
  return undefined;
}

export function getCoverLetterExamples(docs: StoredDocument[]): string | undefined {
  const letters = docs.filter(
    d => d.category === 'Cover Letter' && d.extractedText?.trim()
  );
  if (!letters.length) return undefined;
  return letters
    .slice(0, 3)
    .map((d, i) => `--- Sample Letter ${i + 1}: ${d.name} ---\n${d.extractedText!.trim()}`)
    .join('\n\n');
}

export function buildDocumentsContext(docs: StoredDocument[]): string | undefined {
  const docsWithText = CV_PRIORITY
    .flatMap(cat => docs.filter(d => d.category === cat && d.extractedText?.trim()))
    .slice(0, 3);
  if (!docsWithText.length) return undefined;
  return docsWithText
    .map(d => `--- ${d.category}: ${d.name} ---\n${d.extractedText}`)
    .join('\n\n');
}

export function buildUserContext(profile: UserProfile | null, docs: StoredDocument[]): string {
  const parts: string[] = [];
  if (profile?.displayName && profile.displayName !== 'You')
    parts.push(`Name: ${profile.displayName}`);
  if (profile?.currentDegree)
    parts.push(`Degree: ${profile.currentDegree}`);
  if (profile?.institution)
    parts.push(`University: ${profile.institution}`);
  if (profile?.yearOfStudy)
    parts.push(`Year of Study: ${profile.yearOfStudy}`);
  if (profile?.skills)
    parts.push(`Skills: ${profile.skills}`);
  if (profile?.city)
    parts.push(`City/Location: ${profile.city}`);
  if (profile?.preferredIndustries)
    parts.push(`Preferred Industries: ${profile.preferredIndustries}`);
  if (profile?.careerGoals)
    parts.push(`Career Goals: ${profile.careerGoals}`);
  if (profile?.portfolioUrl)
    parts.push(`Portfolio/GitHub: ${profile.portfolioUrl}`);
  if (profile?.profileFields?.length) {
    profile.profileFields.forEach(f => {
      if (f.value?.trim()) parts.push(`${f.label}: ${f.value}`);
    });
  }
  const docsCtx = buildDocumentsContext(docs);
  if (docsCtx) parts.push(`\nUploaded Documents:\n${docsCtx}`);
  return parts.join('\n');
}
