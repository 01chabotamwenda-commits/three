import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DocCategory, StoredDocument, UserProfile, useApp } from '@/context/AppContext';
import { aiService } from '@/lib/aiService';
import { extractTextClientSide, extractTextFromBase64Pdf, heuristicParseProfile } from '@/lib/clientExtraction';
import { useColors } from '@/hooks/useColors';
import ConfirmDialog from '@/components/ConfirmDialog';

const CATEGORIES: DocCategory[] = [
  'CV / Resume',
  'Cover Letter',
  'Certificate',
  'Academic Transcript',
  'Reference Letter',
  'Portfolio',
  'Other',
];

const CATEGORY_ICONS: Record<DocCategory, string> = {
  'CV / Resume': 'user',
  'Cover Letter': 'mail',
  'Certificate': 'award',
  'Academic Transcript': 'book',
  'Reference Letter': 'users',
  'Portfolio': 'briefcase',
  'Other': 'file',
};

const CATEGORY_COLORS: Record<DocCategory, { bg: string; icon: string; border: string }> = {
  'CV / Resume': { bg: 'rgba(99,102,241,0.14)', icon: '#6366f1', border: 'rgba(99,102,241,0.25)' },
  'Cover Letter': { bg: 'rgba(59,130,246,0.14)', icon: '#3b82f6', border: 'rgba(59,130,246,0.25)' },
  'Certificate': { bg: 'rgba(245,158,11,0.14)', icon: '#f59e0b', border: 'rgba(245,158,11,0.25)' },
  'Academic Transcript': { bg: 'rgba(20,184,166,0.15)', icon: '#14b8a6', border: 'rgba(20,184,166,0.25)' },
  'Reference Letter': { bg: 'rgba(168,85,247,0.14)', icon: '#a855f7', border: 'rgba(168,85,247,0.25)' },
  'Portfolio': { bg: 'rgba(239,68,68,0.14)', icon: '#ef4444', border: 'rgba(239,68,68,0.25)' },
  'Other': { bg: 'rgba(255,255,255,0.08)', icon: 'rgba(255,255,255,0.6)', border: 'rgba(255,255,255,0.15)' },
};

const DOCS_DIR = Platform.OS !== 'web' ? `${FileSystem.documentDirectory}career-compass-docs/` : null;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function ensureDocsDir() {
  if (!DOCS_DIR) return;
  try {
    const info = await FileSystem.getInfoAsync(DOCS_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(DOCS_DIR, { intermediates: true });
    }
  } catch (err) {
    // If getInfoAsync fails, try creating directory directly
    await FileSystem.makeDirectoryAsync(DOCS_DIR, { intermediates: true }).catch((err) => console.warn('Failed to create docs directory:', err));
  }
}

export default function DocsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { autoUpload } = useLocalSearchParams<{ autoUpload?: string }>();
  const { docs, addDoc, updateDoc, deleteDoc, profile, updateProfile } = useApp();

  const [filter, setFilter] = useState<DocCategory | 'All'>('All');
  const [uploading, setUploading] = useState(false);
  const [uploadingCategory, setUploadingCategory] = useState<DocCategory>('CV / Resume');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [pendingFile, setPendingFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);

  const [extractDoc, setExtractDoc] = useState<StoredDocument | null>(null);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractedRows, setExtractedRows] = useState<Array<{ id: string; label: string; value: string }>>([]);
  const [merging, setMerging] = useState(false);
  const [chatPhase, setChatPhase] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [mergeReady, setMergeReady] = useState(false);
  const [finalFieldsReady, setFinalFieldsReady] = useState<Array<{ label: string; value: string }> | null>(null);
  const chatScrollRef = useRef<ScrollView>(null);

  // ── Review panel state ──
  type ReviewStatus = 'pending' | 'checking' | 'approved' | 'conflict' | 'skipped';
  interface ReviewItem {
    id: string;
    label: string;
    value: string;
    status: ReviewStatus;
    aiNote?: string;
    existingValue?: string;
  }
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewMode, setReviewMode] = useState(false);
  const reviewPanelRef = useRef<ScrollView>(null);

  // ── Per-doc processing / failure state ──
  const [processingDocIds, setProcessingDocIds] = useState<Set<string>>(new Set());
  const [failedDocIds, setFailedDocIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<StoredDocument | null>(null);

  const markProcessing = (id: string) =>
    setProcessingDocIds(prev => new Set([...prev, id]));
  const unmarkProcessing = (id: string) =>
    setProcessingDocIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  const markFailed = (id: string) =>
    setFailedDocIds(prev => new Set([...prev, id]));
  const unmarkFailed = (id: string) =>
    setFailedDocIds(prev => { const n = new Set(prev); n.delete(id); return n; });

  const handleRetryExtraction = useCallback(async (doc: StoredDocument) => {
    unmarkFailed(doc.id);
    markProcessing(doc.id);
    try {
      let base64: string | null = null;
      if (doc.objectPath.startsWith('data:')) {
        base64 = doc.objectPath.split(',')[1] ?? null;
      } else if (Platform.OS === 'web') {
        base64 = null;
      } else {
        base64 = await FileSystem.readAsStringAsync(doc.objectPath, { encoding: 'base64' }).catch(() => null);
      }

      let textForParsing = '';
      if (base64) {
        try {
          const aiResponse = await aiService.extractContent({
            fileContent: base64,
            contentType: doc.contentType,
            category: doc.category,
          });
          if (aiResponse?.extractedText) {
            textForParsing = aiResponse.extractedText;
            await updateDoc(doc.id, { extractedText: aiResponse.extractedText });
          }
        } catch {
          markFailed(doc.id);
        }
      }
      if (!textForParsing) markFailed(doc.id);
    } catch {
      markFailed(doc.id);
    } finally {
      unmarkProcessing(doc.id);
    }
  }, []);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 72 : insets.bottom + 56;
  const { height } = useWindowDimensions();

  const autoUploadTriggered = useRef(false);
  useEffect(() => {
    if (autoUpload !== 'true' || autoUploadTriggered.current) return;
    autoUploadTriggered.current = true;
    const timer = setTimeout(() => {
      handlePickFile();
    }, 650);
    return () => clearTimeout(timer);
  }, [autoUpload]);

  const filteredDocs = filter === 'All' ? docs : docs.filter(d => d.category === filter);

  const closeExtractModal = useCallback(() => {
    setExtractDoc(null);
    setExtractedRows([]);
    setChatPhase(false);
    setChatMessages([]);
    setChatInput('');
    setMergeReady(false);
    setFinalFieldsReady(null);
    setReviewItems([]);
    setReviewMode(false);
    // review panel is shown via reviewMode
  }, []);

  // Unified label -> top-level profile key mapping. Grows as needed.
  const TOP_LEVEL_FIELD_MAP: Record<string, keyof UserProfile> = {
    'name': 'displayName',
    'display name': 'displayName',
    'degree': 'currentDegree',
    'current degree': 'currentDegree',
    'qualification': 'currentDegree',
    'institution': 'institution',
    'university': 'institution',
    'college': 'institution',
    'year of study': 'yearOfStudy',
    'year': 'yearOfStudy',
    'skills': 'skills',
    'technical skills': 'skills',
    'city': 'city',
    'location': 'city',
    'industries': 'preferredIndustries',
    'preferred industries': 'preferredIndustries',
    'career goals': 'careerGoals',
    'goals': 'careerGoals',
    'objective': 'careerGoals',
    'portfolio url': 'portfolioUrl',
    'portfolio': 'portfolioUrl',
    'website': 'portfolioUrl',
    'linkedin': 'linkedInUrl',
    'github': 'githubUrl',
    'gpa': 'skills',
    'courses': 'skills',
    'honors': 'skills',
    'total credits': 'skills',
    'program': 'currentDegree',
    'dates': 'yearOfStudy',
  };

  const handleSaveToProfile = useCallback(async (fieldsToSave: Array<{ label: string; value: string }>) => {
    if (!profile) return;
    const isBlank = (v: unknown) => !v || v === 'You';
    const existingLabels = new Set((profile.profileFields ?? []).map(f => f.label.toLowerCase()));
    const mergedFields = [...(profile.profileFields ?? [])];
    const updates: Partial<UserProfile> = {};
    for (const f of fieldsToSave) {
      const key = TOP_LEVEL_FIELD_MAP[f.label.toLowerCase()];
      if (key && isBlank((profile as any)[key])) {
        (updates as any)[key] = f.value;
      }
      // Everything lands in profileFields so the table grows organically
      if (!existingLabels.has(f.label.toLowerCase())) {
        mergedFields.push({ id: `doc_${Date.now()}_${mergedFields.length}`, label: f.label, value: f.value });
        existingLabels.add(f.label.toLowerCase());
      }
    }
    await updateProfile({ ...profile, ...updates, profileFields: mergedFields });
    closeExtractModal();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Profile Updated', `Added ${fieldsToSave.length} field${fieldsToSave.length !== 1 ? 's' : ''} to your profile.`);
  }, [profile, updateProfile, closeExtractModal]);

  const handleExtract = useCallback(async (doc: StoredDocument) => {
      setExtractDoc(doc);
      setExtractLoading(true);
      setExtractedRows([]);
      setChatPhase(false);
      setChatMessages([]);
      setMergeReady(false);
      setFinalFieldsReady(null);
      try {
        const rows: Array<{ id: string; label: string; value: string }> = [];
        let idx = 0;

        // -- Preferred path: use stored parsedData from the category-aware AI extraction --
        if (doc.parsedData && typeof doc.parsedData === 'object') {
          const labels = CATEGORY_FIELD_LABELS[doc.category] ?? {};
          const flatten = (obj: Record<string, unknown>, prefix = '') => {
            for (const [key, val] of Object.entries(obj)) {
              if (['rawText', 'extractedText', 'uid', 'weeklyGoal', 'profileImageUri', 'model'].includes(key)) continue;
              const label = labels[key] || prefix + key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
              if (typeof val === 'string' && val.trim()) {
                rows.push({ id: `r${idx++}`, label, value: val.trim() });
              } else if (Array.isArray(val)) {
                const strings = val.filter(v => typeof v === 'string' && v.trim()).join(', ');
                if (strings) rows.push({ id: `r${idx++}`, label, value: strings });
                for (const item of val) {
                  if (typeof item === 'object' && item) {
                    const itemTitle = (item as any).name || (item as any).role || (item as any).degree || (item as any).title || (item as any).course || 'Item';
                    const itemLabel = `${label} — ${itemTitle}`;
                    const itemValue = Object.values(item).filter(v => typeof v === 'string' && v.trim()).join(' · ');
                    if (itemValue) rows.push({ id: `r${idx++}`, label: itemLabel, value: itemValue });
                  }
                }
              }
            }
          };
          flatten(doc.parsedData as Record<string, unknown>);
        }

        // -- Fallback path: no parsedData — try to extract text and parse manually --
        if (!rows.length) {
          let textForParsing = doc.extractedText ?? '';

          // If extractedText is actually a raw Gemini JSON reply (stored by older app versions),
          // recover parsedData from it so we don't run heuristicParseProfile on JSON syntax.
          if (textForParsing.trimStart().startsWith('{')) {
            try {
              const recovered = JSON.parse(textForParsing) as Record<string, unknown>;
              await updateDoc(doc.id, { parsedData: recovered });
              const lbls = CATEGORY_FIELD_LABELS[doc.category] ?? {};
              const flatRecovered = (obj: Record<string, unknown>) => {
                for (const [key, val] of Object.entries(obj)) {
                  if (['rawText', 'extractedText', 'uid', 'weeklyGoal', 'profileImageUri', 'model'].includes(key)) continue;
                  const label = lbls[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
                  if (typeof val === 'string' && val.trim()) {
                    rows.push({ id: `r${idx++}`, label, value: val.trim() });
                  } else if (Array.isArray(val)) {
                    const strings = val.filter(v => typeof v === 'string' && v.trim()).join(', ');
                    if (strings) rows.push({ id: `r${idx++}`, label, value: strings });
                    for (const item of val) {
                      if (typeof item === 'object' && item) {
                        const itemTitle = (item as any).name || (item as any).role || (item as any).degree || (item as any).title || (item as any).course || 'Item';
                        const itemLabel = `${label} — ${itemTitle}`;
                        const itemValue = Object.values(item).filter(v => typeof v === 'string' && v.trim()).join(' · ');
                        if (itemValue) rows.push({ id: `r${idx++}`, label: itemLabel, value: itemValue });
                      }
                    }
                  }
                }
              };
              flatRecovered(recovered);
              textForParsing = ''; // prevent heuristic parser from mangling JSON syntax
            } catch {
              // Not valid JSON — let heuristic parser try
            }
          }

          let parsedFree: ReturnType<typeof heuristicParseProfile> | null = null;

          // Step 1: try zero-cost client-side extraction
          if (!textForParsing) {
            const file = (doc as any).file instanceof File ? (doc as any).file : null;
            textForParsing = (await extractTextClientSide(file ?? doc.objectPath, doc.contentType)) ?? '';
          }
          if (textForParsing) {
            parsedFree = heuristicParseProfile(textForParsing);
            await updateDoc(doc.id, { extractedText: textForParsing });
          }

          // Step 2: fall back to AI if client-side didn't yield text
          if (!textForParsing) {
            let base64: string | null = null;
            if (Platform.OS === 'web' && (doc as any).file instanceof File) {
              base64 = await new Promise<string | null>(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve((reader.result as string).split(',')[1] ?? null);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL((doc as any).file as File);
              });
            } else {
              base64 = await FileSystem.readAsStringAsync(doc.objectPath, { encoding: 'base64' }).catch(() => null);
            }
            if (!base64) {
              Alert.alert('Cannot read file', 'Re-upload the document and try again.');
              setExtractDoc(null);
              return;
            }
            try {
              const extracted = await aiService.extractContent({ fileContent: base64, contentType: doc.contentType, category: doc.category });
              if (extracted?.extractedText) {
                textForParsing = (extracted as any).rawText || extracted.extractedText;
                await updateDoc(doc.id, { extractedText: extracted.extractedText });
                const parsed = (extracted as any).parsedData;
                if (parsed) await updateDoc(doc.id, { parsedData: parsed });
              }
            } catch {
              // AI extraction failed
            }
            if (!textForParsing && doc.contentType === 'application/pdf') {
              textForParsing = extractTextFromBase64Pdf(base64) ?? '';
            }
            if (!textForParsing) {
              Alert.alert('Nothing found', 'Could not read this file. Try a .docx or .txt version.');
              setExtractDoc(null);
              return;
            }
            parsedFree = heuristicParseProfile(textForParsing);
          }

          // Build rows from heuristic fallback using CV-centric labels
          const knownFieldMap: Record<string, string> = {
            displayName: 'Name', currentDegree: 'Degree', institution: 'Institution',
            yearOfStudy: 'Year of Study', skills: 'Skills', city: 'City',
            preferredIndustries: 'Industries', careerGoals: 'Career Goals',
            portfolioUrl: 'Portfolio URL', linkedInUrl: 'LinkedIn', githubUrl: 'GitHub',
          };
          const skipKeys = new Set(['profileFields', 'rawText', 'extractedText', 'uid', 'weeklyGoal', 'profileImageUri', 'model']);
          const addRow = (label: string, val: unknown) => {
            const v = (val as string | undefined)?.trim();
            if (v) rows.push({ id: `r${idx++}`, label, value: v });
          };
          const acceptAllFields = (source: Record<string, unknown>) => {
            for (const [key, val] of Object.entries(source)) {
              if (skipKeys.has(key)) continue;
              const label = knownFieldMap[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
              if (typeof val === 'string' && val.trim()) addRow(label, val);
              else if (Array.isArray(val)) {
                const joined = val.filter(v => typeof v === 'string' && v.trim()).join(', ');
                if (joined) addRow(label, joined);
              }
            }
          };
          if (parsedFree) acceptAllFields(parsedFree as unknown as Record<string, unknown>);
        }

        if (!rows.length) {
          Alert.alert('Nothing to add', 'No profile fields were found in this document.');
          setExtractDoc(null);
          return;
        }
        setExtractedRows(rows);
      } catch (err: any) {
        Alert.alert('Error', err?.message ?? 'Extraction failed. Please try again.');
        setExtractDoc(null);
      } finally {
        setExtractLoading(false);
      }
    }, [updateDoc]);

  // Simple fuzzy check: returns true if two strings are likely the same thing
  // (e.g. "John De" vs "M Doe John" or "Kitwe" vs "kitwe, zambia")
  const isProbablySame = useCallback((a: string, b: string): boolean => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;
    // Word overlap
    const wa = new Set(na.split(' ').filter(w => w.length > 1));
    const wb = new Set(nb.split(' ').filter(w => w.length > 1));
    const shared = [...wa].filter(w => wb.has(w));
    if (shared.length >= 2) return true; // e.g. "john de" shares 2 words with "m doe john"
    if (shared.length === 1 && shared[0].length > 3) return true; // one long shared word
    return false;
  }, []);

  // Category-specific field labels for the extract modal
  const CATEGORY_FIELD_LABELS: Record<DocCategory, Record<string, string>> = {
    'CV / Resume': {
      displayName: 'Name',
      currentDegree: 'Degree',
      institution: 'Institution',
      yearOfStudy: 'Year of Study',
      skills: 'Skills',
      city: 'City',
      preferredIndustries: 'Industries',
      careerGoals: 'Career Goals',
      portfolioUrl: 'Portfolio URL',
      linkedInUrl: 'LinkedIn',
      githubUrl: 'GitHub',
    },
    'Cover Letter': {
      recipient: 'Recipient / Company',
      position: 'Position Applied For',
      motivation: 'Key Motivations',
      skillsHighlighted: 'Skills Highlighted',
      tone: 'Tone / Style',
      closing: 'Closing Statement',
    },
    'Certificate': {
      title: 'Certificate Title',
      issuer: 'Issuing Organization',
      date: 'Date Issued',
      credentialId: 'Credential ID',
      skillsCertified: 'Skills Certified',
      level: 'Level / Grade',
    },
    'Academic Transcript': {
      institution: 'Institution',
      program: 'Program / Degree',
      gpa: 'GPA / Grade',
      courses: 'Key Courses',
      dates: 'Period Covered',
    },
    'Reference Letter': {
      referee: 'Referee Name',
      relationship: 'Relationship to You',
      keyPoints: 'Key Recommendations',
      contact: 'Referee Contact',
      institution: 'Institution / Company',
    },
    'Portfolio': {
      projectName: 'Project Name',
      technologies: 'Technologies Used',
      description: 'Description',
      link: 'Project Link',
      role: 'Your Role',
    },
    'Other': {
      summary: 'Summary',
      keyPoints: 'Key Points',
      dates: 'Relevant Dates',
    },
  };

  // ── NEW: Smart review + batched AI conflict checking ──

  // Step 1: Build review items from extracted rows
  const startReview = useCallback(async () => {
    if (!extractedRows.length || !profile) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Build initial review items with client-side dedup
    const existingLabels = new Set((profile.profileFields ?? []).map(f => f.label.toLowerCase()));
    const existingValues = new Map<string, string>();
    for (const key of Object.keys(TOP_LEVEL_FIELD_MAP)) {
      const profileKey = TOP_LEVEL_FIELD_MAP[key];
      const val = (profile as any)[profileKey];
      if (val && val !== 'You') existingValues.set(key, String(val).trim().toLowerCase());
    }
    for (const f of (profile.profileFields ?? [])) {
      existingValues.set(f.label.toLowerCase(), f.value.trim().toLowerCase());
    }

    const items: ReviewItem[] = extractedRows.map(row => {
      const labelLower = row.label.toLowerCase();
      const valueLower = row.value.trim().toLowerCase();

      // Exact duplicate — skip
      if (existingValues.has(labelLower) && existingValues.get(labelLower) === valueLower) {
        return { id: row.id, label: row.label, value: row.value, status: 'skipped', aiNote: 'Already in your profile' };
      }
      // Same label, different value — potential conflict (flag for AI check)
      if (existingValues.has(labelLower)) {
        return { id: row.id, label: row.label, value: row.value, status: 'pending', existingValue: existingValues.get(labelLower) };
      }
      // New label — likely fine, but we still batch-check
      return { id: row.id, label: row.label, value: row.value, status: 'pending' };
    });

    // Nothing new to review — everything is already in the profile
    const needsReview = items.filter(i => i.status === 'pending' || i.status === 'conflict');
    if (needsReview.length === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Nothing new to add', 'All extracted fields are already in your profile.');
      setExtractDoc(null);
      return;
    }

    setReviewItems(items);
    setReviewMode(true);
    setChatPhase(false);
    setChatMessages([]);
    setMergeReady(false);
    setFinalFieldsReady(null);

    // Start batched AI checking
    await runBatchedReview(items);
  }, [extractedRows, profile]);

  // Step 2: Send items to AI in batches of 3 to avoid rate limits
  const runBatchedReview = useCallback(async (items: ReviewItem[]) => {
    if (!profile) return;
    setMerging(true);

    const BATCH_SIZE = 3;
    const pendingItems = items.filter(i => i.status === 'pending');
    let currentItems = [...items];

    for (let i = 0; i < pendingItems.length; i += BATCH_SIZE) {
      const batch = pendingItems.slice(i, i + BATCH_SIZE);
      const batchLabels = batch.map(b => b.label.toLowerCase());

      // Mark batch as checking
      setReviewItems(prev => prev.map(item =>
        batchLabels.includes(item.label.toLowerCase()) ? { ...item, status: 'checking' } : item
      ));

      try {
        const result = await aiService.profileMerge({
          extractedFields: batch.map(b => ({ label: b.label, value: b.value })),
          existingProfile: {
            displayName: profile.displayName,
            currentDegree: profile.currentDegree,
            institution: profile.institution,
            yearOfStudy: profile.yearOfStudy,
            skills: profile.skills,
            city: profile.city,
            preferredIndustries: profile.preferredIndustries,
            careerGoals: profile.careerGoals,
            portfolioUrl: profile.portfolioUrl,
            profileFields: profile.profileFields ?? [],
          },
        });

        // Apply AI decisions to each item in the batch
        for (const item of batch) {
          const itemLower = item.label.toLowerCase();

          // Check for conflicts from AI
          const aiConflict = result.conflicts?.find((c: any) => c.field.toLowerCase() === itemLower);
          if (aiConflict && !isProbablySame(String(aiConflict.existing ?? ''), String(aiConflict.extracted ?? ''))) {
            currentItems = currentItems.map(ci =>
              ci.label.toLowerCase() === itemLower
                ? { ...ci, status: 'conflict' as ReviewStatus, aiNote: `Current: "${aiConflict.existing}"`, existingValue: aiConflict.existing }
                : ci
            );
            continue;
          }

          // Check safeToAdd list
          const safe = result.safeToAdd?.some((s: any) => s.label.toLowerCase() === itemLower);
          if (safe) {
            currentItems = currentItems.map(ci =>
              ci.label.toLowerCase() === itemLower
                ? { ...ci, status: 'approved' as ReviewStatus, aiNote: 'Looks good' }
                : ci
            );
            continue;
          }

          // If AI didn't mention it explicitly and there were no conflicts, assume approved
          if (!result.hasConflicts) {
            currentItems = currentItems.map(ci =>
              ci.label.toLowerCase() === itemLower
                ? { ...ci, status: 'approved' as ReviewStatus, aiNote: 'Looks good' }
                : ci
            );
            continue;
          }

          // Default: keep as pending if AI was unclear
          currentItems = currentItems.map(ci =>
            ci.label.toLowerCase() === itemLower
              ? { ...ci, status: 'pending' as ReviewStatus, aiNote: 'Needs review' }
              : ci
          );
        }

        setReviewItems([...currentItems]);
      } catch (err: any) {
        // AI failed for this batch — mark all as pending for manual review
        for (const item of batch) {
          currentItems = currentItems.map(ci =>
            ci.label.toLowerCase() === item.label.toLowerCase()
              ? { ...ci, status: 'pending' as ReviewStatus, aiNote: 'Check failed — review manually' }
              : ci
          );
        }
        setReviewItems([...currentItems]);
        console.error('[review] batch check failed:', err?.message);
      }

      // Small delay between batches to be extra-safe with rate limits
      if (i + BATCH_SIZE < pendingItems.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    setMerging(false);

    // If any conflicts remain, auto-open conflict chat
    const conflicts = currentItems.filter(i => i.status === 'conflict');
    if (conflicts.length > 0) {
      const intro = `I found ${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''} between your profile and this document:\n\n${conflicts.map((c: any) => `• ${c.label}: you have "${c.existingValue}" but document says "${c.value}"`).join('\n')}\n\nTell me which version to keep, or how to resolve each.`;
      setChatMessages([{ role: 'assistant', content: intro }]);
      setChatPhase(true);
    }
  }, [profile, isProbablySame]);

  // User manually approves or rejects a review item
  const approveReviewItem = useCallback((id: string) => {
    setReviewItems(prev => prev.map(item =>
      item.id === id ? { ...item, status: 'approved', aiNote: item.aiNote ?? 'Approved by you' } : item
    ));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const rejectReviewItem = useCallback((id: string) => {
    setReviewItems(prev => prev.map(item =>
      item.id === id ? { ...item, status: 'skipped', aiNote: 'Skipped by you' } : item
    ));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // Save all approved items from the review panel
  const saveApprovedReviewItems = useCallback(async () => {
    const approved = reviewItems.filter(i => i.status === 'approved');
    if (!approved.length) {
      Alert.alert('Nothing to save', 'No items are approved. Tap the checkmark on items you want to keep.');
      return;
    }
    await handleSaveToProfile(approved.map(a => ({ label: a.label, value: a.value })));
  }, [reviewItems, handleSaveToProfile]);

  // Chat handler: only sends conflict items, receives updates
  const handleChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const updated = [...chatMessages, { role: 'user' as const, content: text }];
    setChatMessages(updated);
    setChatInput('');
    setChatLoading(true);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const conflictItems = reviewItems.filter(i => i.status === 'conflict');
      const result = await aiService.profileMerge({
        message: text,
        history: updated,
        extractedFields: conflictItems.map(r => ({ label: r.label, value: r.value })),
        existingProfile: profile ? {
          displayName: profile.displayName,
          currentDegree: profile.currentDegree,
          institution: profile.institution,
          skills: profile.skills,
          city: profile.city,
          careerGoals: profile.careerGoals,
          portfolioUrl: profile.portfolioUrl,
          profileFields: profile.profileFields ?? [],
        } : {},
      });
      setChatMessages(prev => [...prev, { role: 'assistant', content: result.reply || 'I processed your request. Let me know how else I can help.' }]);

      if (result.mergeReady && result.finalFields) {
        setMergeReady(true);
        setFinalFieldsReady(result.finalFields);
        // Update review items based on AI resolution
        for (const ff of result.finalFields) {
          setReviewItems(prev => prev.map(item => {
            if (item.label.toLowerCase() === ff.label.toLowerCase()) {
              return { ...item, value: ff.value, status: 'approved', aiNote: 'Resolved via chat' };
            }
            return item;
          }));
        }
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [chatInput, chatLoading, chatMessages, reviewItems, profile]);

  const handlePickFile = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setPendingFile(asset);
      setShowCategoryPicker(true);
    } catch {
      Alert.alert('Error', 'Failed to pick file. Please try again.');
    }
  };

  const handleUpload = async (category: DocCategory) => {
    if (!pendingFile) return;
    setShowCategoryPicker(false);
    setUploading(true);
    setUploadingCategory(category);

    try {
      const asset = pendingFile;
      const mimeType = asset.mimeType ?? 'application/octet-stream';

      await ensureDocsDir();

      const ext = asset.name.split('.').pop()?.toLowerCase() || 'bin';
      const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      let localUri = DOCS_DIR ? `${DOCS_DIR}${uniqueName}` : asset.uri;

      if (DOCS_DIR && asset.uri !== localUri) {
        try {
          await FileSystem.copyAsync({ from: asset.uri, to: localUri });
        } catch {
          localUri = asset.uri;
        }
      }

      // On web, blob URLs expire — persist as a base64 data URL so documents stay readable
      let objectPath = localUri;
      if (Platform.OS === 'web' && (asset as any).file instanceof File) {
        const b64 = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1] ?? null);
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL((asset as any).file as File);
        });
        if (b64) {
          objectPath = `data:${mimeType};base64,${b64}`;
        }
      }

      const stored = await addDoc({
        name: asset.name,
        category,
        objectPath,
        contentType: mimeType,
        size: asset.size ?? 0,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved!', `"${asset.name}" added to your library. Scanning for details…`);

      // Run AI extraction in background — always attempt regardless of copy outcome
      markProcessing(stored.id);
      void (async () => {
        try {
          // Read file as base64. On web, expo-document-picker provides a native
          // File object (asset.file) which must be read via FileReader since
          // FileSystem.readAsStringAsync cannot handle blob: URIs reliably on web.
          let base64: string | null = null;

          if (Platform.OS === 'web' && (asset as any).file instanceof File) {
            // Web path: use FileReader on the native File object
            base64 = await new Promise<string | null>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                // result = "data:<mime>;base64,<data>"
                const b64 = result.split(',')[1] ?? null;
                resolve(b64);
              };
              reader.onerror = () => resolve(null);
              reader.readAsDataURL((asset as any).file as File);
            });
          } else {
            // Native path: read from the local file URI
            try {
              base64 = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' });
            } catch {
              if (asset.uri !== localUri) {
                base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' }).catch(() => null);
              }
            }
          }

          let textForParsing = '';
          let aiResponse: any = null;

          // ── Try zero-cost client-side extraction first ──
          const freeText = await extractTextClientSide(
            (asset as any).file ?? localUri,
            asset.mimeType ?? 'application/octet-stream',
          );
          if (freeText) {
            textForParsing = freeText;
            await updateDoc(stored.id, { extractedText: freeText });
          }

          // ── Fall back to AI for non-text files ──
          let extractionFailed = false;
          if (!textForParsing && base64) {
            try {
              aiResponse = await aiService.extractContent({
                fileContent: base64,
                contentType: asset.mimeType ?? 'application/octet-stream',
                category,
              });
              if (aiResponse?.extractedText) {
                textForParsing = (aiResponse as any).rawText || aiResponse.extractedText;
                await updateDoc(stored.id, { extractedText: aiResponse.extractedText });
              } else if ((aiResponse as any)?.imageOnly) {
                // Image-only file (e.g. scanned certificate): AI couldn't extract text
                // right now (rate-limited) but the doc is saved — not an error.
                // Leave extractionFailed = false so no red badge is shown.
              } else {
                extractionFailed = true;
              }
            } catch {
              extractionFailed = true;
            }
          }
          if (!textForParsing) {
            if (extractionFailed) markFailed(stored.id);
            return;
          }

          // ── Store parsed structured data on the document ──
          const parsedData = aiResponse?.parsedData ?? null;
          if (parsedData) {
            await updateDoc(stored.id, { parsedData });
          }

          // ── Auto-fill profile ONLY from CV/Resume ──
          if (category === 'CV / Resume' && profile && parsedData) {
            try {
              const mergedFields = [...(profile.profileFields ?? [])];
              const existingLabels = new Set(mergedFields.map(f => f.label.toLowerCase()));
              const isBlank = (v: string | undefined | null) => !v || v === 'You';
              const updates: Partial<typeof profile> = {};
              const knownFieldMap: Record<string, string> = {
                displayName: 'Name',
                currentDegree: 'Degree',
                institution: 'Institution',
                yearOfStudy: 'Year of Study',
                skills: 'Skills',
                city: 'City',
                preferredIndustries: 'Industries',
                careerGoals: 'Career Goals',
                portfolioUrl: 'Portfolio URL',
                linkedInUrl: 'LinkedIn',
                githubUrl: 'GitHub',
              };

              // Flatten parsedData into profile fields using category labels
              const flatten = (obj: Record<string, unknown>, prefix = '') => {
                for (const [key, val] of Object.entries(obj)) {
                  if (['rawText', 'extractedText', 'uid', 'weeklyGoal', 'profileImageUri', 'model'].includes(key)) continue;
                  const label = knownFieldMap[key] || prefix + key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
                  if (typeof val === 'string' && val.trim()) {
                    if (!existingLabels.has(label.toLowerCase())) {
                      mergedFields.push({ id: `doc_${Date.now()}_${mergedFields.length}`, label, value: val.trim() });
                      existingLabels.add(label.toLowerCase());
                    }
                    if ((TOP_LEVEL_FIELD_MAP as any)[label.toLowerCase()] && isBlank((profile as any)[key])) {
                      (updates as any)[key] = val.trim();
                    }
                  } else if (Array.isArray(val)) {
                    // Arrays: objects become grouped rows, strings become comma-joined
                    const strings = val.filter(v => typeof v === 'string' && v.trim()).join(', ');
                    if (strings) {
                      if (!existingLabels.has(label.toLowerCase())) {
                        mergedFields.push({ id: `doc_${Date.now()}_${mergedFields.length}`, label, value: strings });
                        existingLabels.add(label.toLowerCase());
                      }
                    }
                    for (const item of val) {
                      if (typeof item === 'object' && item) {
                        const itemLabel = `${label} — ${(item as any).name || (item as any).role || (item as any).degree || 'Item'}`;
                        const itemValue = Object.values(item).filter(v => typeof v === 'string' && v.trim()).join(' · ');
                        if (itemValue && !existingLabels.has(itemLabel.toLowerCase())) {
                          mergedFields.push({ id: `doc_${Date.now()}_${mergedFields.length}`, label: itemLabel, value: itemValue });
                          existingLabels.add(itemLabel.toLowerCase());
                        }
                      }
                    }
                  }
                }
              };
              flatten(parsedData);

              await updateProfile({ ...profile, ...updates, profileFields: mergedFields });

              const filled = [
                updates.displayName && 'Name',
                updates.currentDegree && 'Degree',
                updates.institution && 'Institution',
                updates.skills && 'Skills',
                updates.city && 'City',
                mergedFields.length > (profile.profileFields?.length ?? 0) && 'Extra details',
              ].filter(Boolean);
              if (filled.length > 0) {
                Alert.alert('Profile updated', `Extracted from "${asset.name}": ${filled.join(', ')}.`);
              }
            } catch (err) {
              console.log('Profile extraction warning:', err);
            }
          }
        } catch {
          markFailed(stored.id);
        }
        finally {
          unmarkProcessing(stored.id);
        }
      })();

    } catch (err: any) {
      Alert.alert('Save Failed', err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setUploading(false);
      setPendingFile(null);
    }
  };

  const handleDelete = (doc: StoredDocument) => {
    setDeleteTarget(doc);
  };

  const handleOpen = async (doc: StoredDocument) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS !== 'web' && doc.objectPath.startsWith('file://')) {
      try {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(doc.objectPath, {
            mimeType: doc.contentType,
            dialogTitle: `Open ${doc.name}`,
          });
        } else {
          Alert.alert('Cannot open', 'No app available to open this file type.');
        }
      } catch {
        Alert.alert('Error', 'Could not open this document.');
      }
      return;
    }
    router.push(`/doc-viewer?docId=${encodeURIComponent(doc.id)}`);
  };

  const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingBottom: 12,
      gap: 10,
    },
    backBtn: {
      width: 36, height: 36, borderRadius: 10,
      backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: {
      flex: 1, fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.text,
    },
    uploadBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: colors.primary, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 8,
    },
    uploadBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },
    statsRow: {
      flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12,
    },
    statChip: {
      flex: 1, alignItems: 'center', paddingVertical: 10,
      backgroundColor: colors.indigoBg, borderRadius: 12,
      borderWidth: 1, borderColor: colors.indigoBorder,
    },
    statVal: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.primary },
    statLbl: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.textMuted, marginTop: 1 },
    filterScroll: { paddingHorizontal: 16, marginBottom: 12 },
    filterChip: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
      borderWidth: 1, marginRight: 8,
    },
    filterChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
    docCard: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: colors.card, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border,
      padding: 14, marginHorizontal: 16, marginBottom: 10,
    },
    docIcon: {
      width: 44, height: 44, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
    },
    docName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.text, marginBottom: 2 },
    docMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted },
    docActions: { flexDirection: 'row', gap: 8 },
    actionBtn: {
      width: 34, height: 34, borderRadius: 9,
      alignItems: 'center', justifyContent: 'center',
    },
    emptyState: {
      alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32,
    },
    emptyIcon: {
      width: 72, height: 72, borderRadius: 36,
      backgroundColor: colors.indigoBg, alignItems: 'center', justifyContent: 'center',
      marginBottom: 16,
    },
    emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.text, marginBottom: 8 },
    emptyBody: {
      fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted,
      textAlign: 'center', lineHeight: 20,
    },
    modal: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: colors.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      paddingHorizontal: 20, paddingBottom: bottomPad + 12,
      borderWidth: 1, borderColor: colors.border,
    },
    modalHandle: {
      width: 36, height: 4, borderRadius: 2,
      backgroundColor: colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 16,
    },
    modalTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text, marginBottom: 4 },
    modalSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginBottom: 16 },
    catBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 12, paddingHorizontal: 14,
      borderRadius: 12, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.muted, marginBottom: 8,
    },
    catBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.text, flex: 1 },
    cancelCatBtn: {
      paddingVertical: 12, alignItems: 'center',
      borderRadius: 12, borderWidth: 1, borderColor: colors.border,
      marginTop: 4,
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingBottom: bottomPad }}>
      <ScrollView
        style={s.screen}
        contentContainerStyle={{ paddingTop: topPad + 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator
        indicatorStyle={colors.isDark ? 'white' : 'black'}
      >
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Feather name="arrow-left" size={18} color={colors.text} />
          </Pressable>
          <Text style={s.headerTitle}>My Documents</Text>
          <Pressable
            onPress={handlePickFile}
            disabled={uploading}
            style={({ pressed }) => [s.uploadBtn, pressed && { opacity: 0.8 }, uploading && { opacity: 0.6 }]}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="upload" size={14} color="#fff" />
            )}
            <Text style={s.uploadBtnText}>{uploading ? 'Saving…' : 'Upload'}</Text>
          </Pressable>
        </View>

        <View style={s.statsRow}>
          <View style={s.statChip}>
            <Text style={s.statVal}>{docs.length}</Text>
            <Text style={s.statLbl}>Total Files</Text>
          </View>
          {CATEGORIES.slice(0, 2).map(cat => (
            <View key={cat} style={s.statChip}>
              <Text style={s.statVal}>{docs.filter(d => d.category === cat).length}</Text>
              <Text style={s.statLbl} numberOfLines={1}>{cat.split(' ')[0]}</Text>
            </View>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}>
          {(['All', ...CATEGORIES] as const).map(cat => {
            const active = filter === cat;
            return (
              <Pressable
                key={cat}
                onPress={() => setFilter(cat)}
                style={[s.filterChip, {
                  backgroundColor: active ? colors.primary : colors.muted,
                  borderColor: active ? colors.primary : colors.border,
                }]}
              >
                <Text style={[s.filterChipText, { color: active ? '#fff' : colors.textSecondary }]}>
                  {cat}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {uploading && (
          <View style={{
            marginHorizontal: 16, marginBottom: 12, padding: 14,
            backgroundColor: colors.indigoBg, borderRadius: 12,
            borderWidth: 1, borderColor: colors.indigoBorder,
            flexDirection: 'row', alignItems: 'center', gap: 10,
          }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.text }}>
                Saving {pendingFile?.name ?? 'file'}…
              </Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 2 }}>
                Category: {uploadingCategory}
              </Text>
            </View>
          </View>
        )}

        {filteredDocs.length === 0 ? (
          <View style={s.emptyState}>
            <View style={s.emptyIcon}>
              <Feather name="folder" size={28} color={colors.primary} />
            </View>
            <Text style={s.emptyTitle}>
              {filter === 'All' ? 'No documents yet' : `No ${filter} files`}
            </Text>
            <Text style={s.emptyBody}>
              {filter === 'All'
                ? 'Tap Upload to add your CV, certificates, cover letters, and other documents.'
                : `Tap Upload to add a ${filter} to your library.`}
            </Text>
          </View>
        ) : (
          filteredDocs.map(doc => {
            const catColors = CATEGORY_COLORS[doc.category];
            return (
              <View key={doc.id} style={s.docCard}>
                <View style={[s.docIcon, { backgroundColor: catColors.bg, borderWidth: 1, borderColor: catColors.border }]}>
                  <Feather name={CATEGORY_ICONS[doc.category] as any} size={18} color={catColors.icon} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.docName} numberOfLines={1}>{doc.name}</Text>
                  <Text style={s.docMeta}>
                    {doc.category} · {formatFileSize(doc.size)} · {formatDate(doc.uploadedAt)}
                  </Text>
                  {(() => {
                    const isProcessing = processingDocIds.has(doc.id);
                    const isFailed = failedDocIds.has(doc.id);
                    if (isProcessing) {
                      return (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
                          <ActivityIndicator size="small" color="#f97316" style={{ transform: [{ scale: 0.7 }] }} />
                          <Text style={[s.docMeta, { color: '#f97316', fontFamily: 'Inter_600SemiBold' }]}>
                            Processing… please wait
                          </Text>
                        </View>
                      );
                    }
                    if (doc.extractedText) {
                      return (
                        <Text style={[s.docMeta, { color: colors.success, marginTop: 2, fontFamily: 'Inter_600SemiBold' }]}>
                          ✓ File ready
                        </Text>
                      );
                    }
                    // No extractedText → file is not indexed. Show retry button always,
                    // regardless of whether failedDocIds contains this doc. This survives
                    // navigation away and back because it's driven by persistent doc state,
                    // not in-memory failure flags.
                    return (
                      <Pressable
                        onPress={() => handleRetryExtraction(doc)}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                          marginTop: 3,
                          opacity: pressed ? 0.6 : 1,
                        })}
                        accessibilityLabel="Retry indexing"
                      >
                        <Feather name="refresh-cw" size={11} color={isFailed ? colors.danger : '#f97316'} />
                        <Text style={[s.docMeta, { color: isFailed ? colors.danger : '#f97316', fontFamily: 'Inter_600SemiBold' }]}>
                          {isFailed ? 'Indexing failed — tap to retry' : 'Not indexed — tap to process'}
                        </Text>
                      </Pressable>
                    );
                  })()}
                </View>
                {(() => {
                  const isProcessing = processingDocIds.has(doc.id);
                  const isReady = !!doc.extractedText;
                  const extractDisabled = isProcessing || !isReady;
                  return (
                    <View style={s.docActions}>
                      <Pressable
                        onPress={extractDisabled ? undefined : () => handleExtract(doc)}
                        disabled={extractDisabled}
                        style={({ pressed }) => [
                          s.actionBtn,
                          {
                            backgroundColor: extractDisabled ? colors.muted : colors.successBg,
                            borderWidth: 1,
                            borderColor: extractDisabled ? colors.border : colors.successBorder,
                            opacity: extractDisabled ? 0.4 : pressed ? 0.7 : 1,
                          },
                        ]}
                        accessibilityLabel="Extract to profile"
                      >
                        <Feather name="layers" size={15} color={extractDisabled ? colors.textMuted : colors.success} />
                      </Pressable>
                      <Pressable
                        onPress={() => handleOpen(doc)}
                        style={({ pressed }) => [
                          s.actionBtn,
                          {
                            backgroundColor: colors.indigoBg,
                            borderWidth: 1,
                            borderColor: colors.indigoBorder,
                            opacity: pressed ? 0.7 : 1,
                          },
                        ]}
                        accessibilityLabel="Open document"
                      >
                        <Feather name="external-link" size={15} color={colors.primary} />
                      </Pressable>
                      <Pressable
                        onPress={() => handleDelete(doc)}
                        style={({ pressed }) => [
                          s.actionBtn,
                          {
                            backgroundColor: colors.dangerBg,
                            borderWidth: 1,
                            borderColor: colors.dangerBorder,
                            opacity: pressed ? 0.7 : 1,
                          },
                        ]}
                        accessibilityLabel="Delete document"
                      >
                        <Feather name="trash-2" size={15} color={colors.danger} />
                      </Pressable>
                    </View>
                  );
                })()}
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={!!extractDoc}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeExtractModal}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingHorizontal: 16, paddingTop: topPad + 8, paddingBottom: 14,
            borderBottomWidth: 1, borderBottomColor: colors.border,
            backgroundColor: colors.card,
          }}>
            <Pressable
              onPress={closeExtractModal}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="x" size={18} color={colors.text} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text }}>
                {chatPhase ? 'Resolve Conflicts' : 'Extract to Profile'}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>
                {extractDoc?.name ?? ''}
              </Text>
            </View>
            {chatPhase && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.warningBg, borderRadius: 20, borderWidth: 1, borderColor: colors.warningBorder }}>
                <Feather name="alert-circle" size={11} color="#f59e0b" />
                <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#f59e0b' }}>Conflicts</Text>
              </View>
            )}
          </View>

          {extractLoading ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 }}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textMuted }}>Reading document…</Text>
            </View>
          ) : chatPhase ? (
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              {mergeReady && (
                <View style={{
                  margin: 12, padding: 14,
                  backgroundColor: colors.successBg, borderRadius: 12,
                  borderWidth: 1, borderColor: colors.successBorder,
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                }}>
                  <Feather name="check-circle" size={16} color={colors.success} />
                  <Text style={{ flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.success }}>All conflicts resolved!</Text>
                  <Pressable
                    onPress={() => handleSaveToProfile(finalFieldsReady ?? [])}
                    style={{ backgroundColor: colors.success, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Inter_700Bold' }}>Save Now</Text>
                  </Pressable>
                </View>
              )}
              <ScrollView
                ref={chatScrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 14, gap: 10 }}
                showsVerticalScrollIndicator
                indicatorStyle={colors.isDark ? 'white' : 'black'}
              >
                {chatMessages.map((msg, i) => (
                  <View
                    key={i}
                    style={{
                      alignSelf: msg.role === 'assistant' ? 'flex-start' : 'flex-end',
                      maxWidth: '86%',
                      backgroundColor: msg.role === 'assistant' ? colors.indigoBg : colors.mutedStrong,
                      borderWidth: 1,
                      borderColor: msg.role === 'assistant' ? colors.indigoBorder : colors.border,
                      borderRadius: 14, padding: 12,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.text, lineHeight: 20 }}>
                      {msg.content}
                    </Text>
                  </View>
                ))}
                {chatLoading && (
                  <View style={{ alignSelf: 'flex-start', backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder, borderRadius: 14, padding: 12 }}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                )}
              </ScrollView>
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12 }}>
                  <TextInput
                    style={{
                      flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
                      paddingHorizontal: 14, paddingVertical: 10,
                      fontSize: 14, fontFamily: 'Inter_400Regular',
                      color: colors.text, backgroundColor: colors.background, maxHeight: 100,
                    }}
                    placeholder="Tell the AI how to resolve conflicts…"
                    placeholderTextColor={colors.textMuted}
                    value={chatInput}
                    onChangeText={setChatInput}
                    onSubmitEditing={handleChatSend}
                    returnKeyType="send"
                    multiline
                  />
                  <Pressable
                    onPress={handleChatSend}
                    disabled={!chatInput.trim() || chatLoading}
                    style={[{
                      width: 42, height: 42, borderRadius: 21,
                      backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
                    }, (!chatInput.trim() || chatLoading) && { opacity: 0.4 }]}
                  >
                    <Feather name="send" size={16} color="#fff" />
                  </Pressable>
                </View>
                {!mergeReady && (
                  <Pressable
                    onPress={() => handleSaveToProfile(extractedRows.map(r => ({ label: r.label, value: r.value })))}
                    style={({ pressed }) => [{
                      marginHorizontal: 12, marginBottom: 12, padding: 13,
                      backgroundColor: colors.muted, borderRadius: 12, alignItems: 'center',
                      borderWidth: 1, borderColor: colors.border,
                    }, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary }}>
                      Save as-is (ignore conflicts)
                    </Text>
                  </Pressable>
                )}
              </View>
            </KeyboardAvoidingView>
          ) : (
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 14, paddingBottom: 24, gap: 10 }}
                showsVerticalScrollIndicator
                indicatorStyle={colors.isDark ? 'white' : 'black'}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginBottom: 6, lineHeight: 19 }}>
                  Review and edit the extracted fields. Remove any you don't want, then tap Add to My Profile.
                </Text>

                {/* Scrollable field cards */}
                {extractedRows.map((row, i) => (
                  <View
                    key={row.id}
                    style={{
                      backgroundColor: colors.card,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: colors.border,
                      padding: 14,
                      marginBottom: 10,
                    }}
                  >
                    {/* Row header with label input + remove */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                      <TextInput
                        style={{
                          flex: 1,
                          fontSize: 11,
                          fontFamily: 'Inter_700Bold',
                          color: colors.textMuted,
                          letterSpacing: 0.5,
                          textTransform: 'uppercase',
                          padding: 0,
                        }}
                        value={row.label}
                        onChangeText={text => setExtractedRows(prev => prev.map((r, j) => j === i ? { ...r, label: text } : r))}
                        placeholder="Field name"
                        placeholderTextColor={colors.textMuted}
                      />
                      <Pressable
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setExtractedRows(prev => prev.filter((_, j) => j !== i));
                        }}
                        style={{ padding: 4, marginLeft: 8 }}
                        hitSlop={8}
                        accessibilityLabel={`Remove ${row.label} field`}
                      >
                        <Feather name="x" size={14} color={colors.textMuted} />
                      </Pressable>
                    </View>
                    {/* Value input — grows with content */}
                    <TextInput
                      style={(() => {
                        const CHARS_PER_LINE = 38;
                        const lineCount = row.value.split('\n').reduce(
                          (sum, line) => sum + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0,
                        );
                        return {
                          fontSize: 14,
                          fontFamily: 'Inter_400Regular',
                          color: colors.text,
                          padding: 12,
                          lineHeight: 22,
                          backgroundColor: colors.muted,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: colors.border,
                          textAlignVertical: 'top',
                          minHeight: Math.max(60, lineCount * 22 + 24),
                        };
                      })()}
                      value={row.value}
                      onChangeText={text => setExtractedRows(prev => prev.map((r, j) => j === i ? { ...r, value: text } : r))}
                      multiline
                      placeholder="Enter value..."
                      placeholderTextColor={colors.textMuted}
                    />
                  </View>
                ))}

                {/* Add custom field */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setExtractedRows(prev => [...prev, { id: `custom_${Date.now()}`, label: '', value: '' }]);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 8,
                    paddingVertical: 14, paddingHorizontal: 16,
                    backgroundColor: colors.muted, borderRadius: 12,
                    borderWidth: 1, borderColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                    marginBottom: 10,
                  })}
                >
                  <Feather name="plus" size={14} color={colors.primary} />
                  <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.primary }}>Add custom field</Text>
                </Pressable>

                {extractedRows.length === 0 && (
                  <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                    <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textMuted }}>No fields found</Text>
                  </View>
                )}
              </ScrollView>
              <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Pressable
                  onPress={startReview}
                  disabled={merging || extractedRows.length === 0 || reviewMode}
                  style={[{
                    backgroundColor: colors.primary, borderRadius: 13, padding: 16,
                    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10,
                  }, (merging || extractedRows.length === 0 || reviewMode) && { opacity: 0.5 }]}
                >
                  {merging
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Feather name="user-plus" size={16} color="#fff" />
                  }
                  <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' }}>
                    {merging ? 'Checking with AI…' : reviewMode ? 'Review in progress' : 'Review & Add to Profile'}
                  </Text>
                </Pressable>
              </View>
            </KeyboardAvoidingView>
          )}
        </View>

        {/* ── Floating Review Panel ── */}
        {reviewMode && (
          <View
            style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              maxHeight: Math.min(520, height * 0.65),
              backgroundColor: colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              borderWidth: 1, borderColor: colors.border,
              shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.12, shadowRadius: 16,
              elevation: 20,
              zIndex: 50,
            }}
            pointerEvents="box-none"
          >
            <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.textMuted + '66' }} />
            </View>

            {/* Panel header with status summary */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 14, paddingVertical: 10,
              borderBottomWidth: 1, borderBottomColor: colors.border,
            }}>
              <View>
                <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.text }}>
                  Review {(() => {
                    const approved = reviewItems.filter(i => i.status === 'approved').length;
                    const skipped = reviewItems.filter(i => i.status === 'skipped').length;
                    const total = reviewItems.length;
                    if (!total) return '0%';
                    const pct = Math.round(100 * ((approved + skipped) / total));
                    return `${pct}%`;
                  })()}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 2 }}>
                  {reviewItems.filter(i => i.status === 'skipped').length === reviewItems.length
                    ? 'Everything already in your profile'
                    : reviewItems.filter(i => i.status === 'conflict').length > 0
                      ? `${reviewItems.filter(i => i.status === 'conflict').length} conflict${reviewItems.filter(i => i.status === 'conflict').length > 1 ? 's' : ''} to resolve`
                      : reviewItems.some(i => i.status === 'checking')
                        ? 'Checking with AI…'
                        : 'Tap checkmark to approve, X to skip'}
                </Text>
              </View>
              {merging && <ActivityIndicator size="small" color={colors.primary} />}
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 14, gap: 10 }}
              showsVerticalScrollIndicator
              indicatorStyle={colors.isDark ? 'white' : 'black'}
            >
              {reviewItems.map(item => {
                const badgeColor =
                  item.status === 'approved' ? colors.success :
                  item.status === 'conflict' ? colors.danger :
                  item.status === 'skipped' ? colors.textMuted :
                  item.status === 'checking' ? colors.primary :
                  '#f59e0b';
                const badgeBg =
                  item.status === 'approved' ? colors.successBg :
                  item.status === 'conflict' ? colors.dangerBg :
                  item.status === 'skipped' ? colors.muted :
                  item.status === 'checking' ? colors.indigoBg :
                  '#fffbeb';
                const badgeBorder =
                  item.status === 'approved' ? colors.successBorder :
                  item.status === 'conflict' ? colors.dangerBorder :
                  item.status === 'skipped' ? colors.border :
                  item.status === 'checking' ? colors.indigoBorder :
                  '#fcd34d';

                return (
                  <View
                    key={item.id}
                    style={{
                      backgroundColor: colors.card,
                      borderRadius: 12, borderWidth: 1,
                      borderColor: item.status === 'conflict' ? colors.dangerBorder : colors.border,
                      padding: 12,
                      opacity: item.status === 'skipped' ? 0.55 : 1,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                        {item.label}
                      </Text>
                      <View style={{
                        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
                        backgroundColor: badgeBg, borderWidth: 1, borderColor: badgeBorder,
                      }}>
                        <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: badgeColor }}>
                          {item.status === 'approved' ? 'Approved' : item.status === 'conflict' ? 'Conflict' : item.status === 'skipped' ? 'Skipped' : item.status === 'checking' ? 'Checking' : 'Pending'}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.text, lineHeight: 20, marginBottom: 4 }}>
                      {item.value}
                    </Text>
                    {item.aiNote && (
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginBottom: 6 }}>
                        {item.aiNote}
                      </Text>
                    )}
                    {item.status !== 'skipped' && item.status !== 'checking' && (
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                        <Pressable
                          onPress={() => approveReviewItem(item.id)}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 4,
                            paddingHorizontal: 10, paddingVertical: 5,
                            backgroundColor: item.status === 'approved' ? colors.success : colors.successBg,
                            borderRadius: 8, borderWidth: 1,
                            borderColor: item.status === 'approved' ? colors.success : colors.successBorder,
                          }}
                        >
                          <Feather name="check" size={12} color={item.status === 'approved' ? '#fff' : colors.success} />
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: item.status === 'approved' ? '#fff' : colors.success }}>
                            {item.status === 'approved' ? 'Approved' : 'Approve'}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => rejectReviewItem(item.id)}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 4,
                            paddingHorizontal: 10, paddingVertical: 5,
                            backgroundColor: colors.muted,
                            borderRadius: 8, borderWidth: 1, borderColor: colors.border,
                          }}
                        >
                          <Feather name="x" size={12} color={colors.textMuted} />
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textMuted }}>Skip</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            {/* Panel footer with save button */}
            <View style={{
              borderTopWidth: 1, borderTopColor: colors.border,
              padding: 14, flexDirection: 'row', gap: 10,
              backgroundColor: colors.card,
            }}>
              <Pressable
                onPress={() => {
                  setReviewMode(false);
                  setReviewItems([]);
                }}
                style={{
                  paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
                  backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary }}>Close</Text>
              </Pressable>
              <Pressable
                onPress={saveApprovedReviewItems}
                disabled={reviewItems.filter(i => i.status === 'approved').length === 0 || merging}
                style={({ pressed }) => [{
                  flex: 1, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
                  backgroundColor: colors.success, alignItems: 'center',
                  flexDirection: 'row', justifyContent: 'center', gap: 8,
                }, (reviewItems.filter(i => i.status === 'approved').length === 0 || merging) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
              >
                {merging
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Feather name="save" size={14} color="#fff" />
                }
                <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' }}>
                  Save {reviewItems.filter(i => i.status === 'approved').length > 0 ? `(${reviewItems.filter(i => i.status === 'approved').length})` : ''}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </Modal>

      {showCategoryPicker && (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <Pressable style={{ flex: 1 }} onPress={() => { setShowCategoryPicker(false); setPendingFile(null); }} />
          <View style={s.modal}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Choose a category</Text>
            <Text style={s.modalSub}>
              "{pendingFile?.name ?? 'File'}" — {formatFileSize(pendingFile?.size ?? 0)}
            </Text>
            {CATEGORIES.map(cat => {
              const cc = CATEGORY_COLORS[cat];
              return (
                <Pressable
                  key={cat}
                  onPress={() => handleUpload(cat)}
                  style={({ pressed }) => [s.catBtn, pressed && { opacity: 0.75 }]}
                >
                  <View style={{
                    width: 32, height: 32, borderRadius: 8,
                    backgroundColor: cc.bg, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: cc.border,
                  }}>
                    <Feather name={CATEGORY_ICONS[cat] as any} size={14} color={cc.icon} />
                  </View>
                  <Text style={s.catBtnText}>{cat}</Text>
                  <Feather name="chevron-right" size={14} color={colors.textMuted} />
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => { setShowCategoryPicker(false); setPendingFile(null); }}
              style={({ pressed }) => [s.cancelCatBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textMuted }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      <ConfirmDialog
        visible={!!deleteTarget}
        title="Delete file?"
        message={deleteTarget ? `Remove "${deleteTarget.name}" from your library. This cannot be undone.` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            deleteDoc(deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </View>
  );
}
