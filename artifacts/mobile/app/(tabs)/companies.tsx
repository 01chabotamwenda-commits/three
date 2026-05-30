import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp } from '@/context/AppContext';
import { StepProgress, ProgressStep } from '@/components/StepProgress';
import { useColors } from '@/hooks/useColors';
import { aiService } from '@/lib/aiService';
import { searchLocalCompanies, validateResultsForProfile } from '@/lib/companiesDb';
import { buildDocumentsContext } from '@/utils/docContext';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CompanyResult {
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
}

interface RecentSearch {
  label: string;
  location: string;
  searchType: string;
  timestamp: number;
}

type SearchType = 'jobs' | 'internships' | 'graduate' | 'volunteer' | 'attachment' | 'browse';

// Career-progression order: earliest stage first
const SEARCH_TYPES: { key: SearchType; label: string }[] = [
  { key: 'attachment', label: 'Industrial Attachment' },
  { key: 'internships', label: 'Internships' },
  { key: 'graduate',   label: 'Graduate'     },
  { key: 'volunteer',  label: 'Volunteer'    },
  { key: 'jobs',        label: 'Jobs'        },
  { key: 'browse',     label: 'Browse Area'  },
];

const BROWSE_INDUSTRIES: { key: string; label: string; icon: string }[] = [
  { key: 'all',          label: 'All Industries', icon: 'grid'         },
  { key: 'mining',       label: 'Mining',         icon: 'layers'       },
  { key: 'energy',       label: 'Energy',         icon: 'zap'          },
  { key: 'tech',         label: 'Tech & IT',      icon: 'cpu'          },
  { key: 'telecom',      label: 'Telecom',         icon: 'radio'        },
  { key: 'finance',      label: 'Finance',         icon: 'dollar-sign'  },
  { key: 'health',       label: 'Healthcare',      icon: 'heart'        },
  { key: 'ngo',          label: 'NGOs',            icon: 'globe'        },
  { key: 'manufactur',   label: 'Manufacturing',   icon: 'tool'         },
  { key: 'education',    label: 'Education',       icon: 'book-open'    },
  { key: 'construction', label: 'Construction',    icon: 'home'         },
  { key: 'transport',    label: 'Logistics',       icon: 'truck'        },
  { key: 'food',         label: 'Agriculture',     icon: 'package'      },
  { key: 'legal',        label: 'Legal',           icon: 'briefcase'    },
  { key: 'hospitality',  label: 'Hospitality',     icon: 'coffee'       },
];

const RECENT_KEY  = 'cc_company_recent_searches';
const CACHE_PFX   = 'cc_company_results_';
const MAX_RECENT  = 8;
const CACHE_TTL   = 6 * 60 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFitColor(score: number): string {
  if (score >= 80) return '#14b8a6';
  if (score >= 60) return '#6366f1';
  return '#3b82f6';
}

function getIndustrySector(industry?: string): { icon: string; color: string; bg: string } {
  const i = (industry || '').toLowerCase();
  if (i.includes('mining') || i.includes('copper'))                                          return { icon: 'layers',      color: '#f97316', bg: 'rgba(249,115,22,0.18)' };
  if (i.includes('energy') || i.includes('power') || i.includes('electric'))                return { icon: 'zap',         color: '#eab308', bg: 'rgba(234,179,8,0.18)'  };
  if (i.includes('tech') || i.includes('software') || i.includes('it') || i.includes('digital')) return { icon: 'cpu',    color: '#6366f1', bg: 'rgba(99,102,241,0.18)' };
  if (i.includes('telecom') || i.includes('mobile') || i.includes('network'))               return { icon: 'radio',       color: '#3b82f6', bg: 'rgba(59,130,246,0.18)' };
  if (i.includes('bank') || i.includes('financ') || i.includes('insurance'))                return { icon: 'dollar-sign', color: '#14b8a6', bg: 'rgba(20,184,166,0.18)' };
  if (i.includes('health') || i.includes('medical') || i.includes('hospital'))              return { icon: 'heart',       color: '#ef4444', bg: 'rgba(239,68,68,0.18)'   };
  if (i.includes('ngo') || i.includes('develop') || i.includes('charity') || i.includes('aid')) return { icon: 'globe',  color: '#22c55e', bg: 'rgba(34,197,94,0.18)'   };
  if (i.includes('manufactur') || i.includes('industrial'))                                  return { icon: 'tool',        color: '#a855f7', bg: 'rgba(168,85,247,0.18)' };
  if (i.includes('construction') || i.includes('infrastructure'))                           return { icon: 'home',        color: '#fb923c', bg: 'rgba(251,146,60,0.18)'  };
  if (i.includes('education') || i.includes('university') || i.includes('school'))          return { icon: 'book-open',   color: '#06b6d4', bg: 'rgba(6,182,212,0.18)'   };
  if (i.includes('transport') || i.includes('logistics'))                                   return { icon: 'truck',       color: '#64748b', bg: 'rgba(100,116,139,0.18)' };
  if (i.includes('food') || i.includes('agri') || i.includes('farm'))                      return { icon: 'package',     color: '#84cc16', bg: 'rgba(132,204,22,0.18)'  };
  return { icon: 'briefcase', color: '#6366f1', bg: 'rgba(99,102,241,0.18)' };
}

const AVATAR_COLORS = ['#6366f1','#14b8a6','#f97316','#3b82f6','#a855f7','#ef4444','#22c55e','#eab308'];
function getAvatarColor(name: string): string {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

const INDUSTRY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'mining', label: 'Mining' },
  { key: 'energy', label: 'Energy' },
  { key: 'tech', label: 'Tech' },
  { key: 'telecom', label: 'Telecom' },
  { key: 'finance', label: 'Finance' },
  { key: 'ngo', label: 'NGOs' },
  { key: 'manufactur', label: 'Manufacturing' },
  { key: 'health', label: 'Healthcare' },
  { key: 'education', label: 'Education' },
];

function matchesFilter(c: CompanyResult, filter: string): boolean {
  if (filter === 'all') return true;
  const ind = (c.industry || '').toLowerCase();
  if (filter === 'ngo') return ind.includes('ngo') || ind.includes('develop') || ind.includes('aid') || ind.includes('charity');
  return ind.includes(filter);
}

function withTimeout<T>(p: Promise<T>, ms: number, msg = 'Timeout'): Promise<T> {
  return Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error(msg)), ms))]);
}

async function detectLocation(): Promise<string> {
  if (Platform.OS === 'web') {
    const pos = await withTimeout(new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })), 6000, 'GPS timeout');
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`, { headers: { 'Accept-Language': 'en' } });
    if (r.ok) { const d = await r.json() as any; const a = d.address ?? {}; return [a.city || a.town || a.state, a.country].filter(Boolean).join(', ') || 'Zambia'; }
    return 'Zambia';
  }
  const { status } = await withTimeout(Location.requestForegroundPermissionsAsync(), 8000);
  if (status !== 'granted') throw new Error('Location permission denied');
  const loc = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 10000);
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${loc.coords.latitude}&lon=${loc.coords.longitude}&format=json`, { headers: { 'Accept-Language': 'en' } });
  if (r.ok) { const d = await r.json() as any; const a = d.address ?? {}; return [a.city || a.town || a.state, a.country].filter(Boolean).join(', ') || 'Zambia'; }
  return 'Zambia';
}

function cacheKey(loc: string, type: string) { return CACHE_PFX + loc.toLowerCase().replace(/\W+/g, '_') + '_' + type; }

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CompaniesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { profile, applications, docs, addApplication, updateProfile, searchResults: syncedResults, recentSearches: syncedRecentSearches, setSearchResults: saveSearchResults, setRecentSearches: saveRecentSearches } = useApp();
  const router = useRouter();

  const [locationText, setLocationText] = useState(profile?.city || 'Zambia');
  const [searchType, setSearchType] = useState<SearchType>('jobs');
  const [browseIndustry, setBrowseIndustry] = useState<string>('all');
  const [results, setResults] = useState<CompanyResult[]>(syncedResults ?? []);
  const [trackedNames, setTrackedNames] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState('all');
  const [isScanning, setIsScanning] = useState(false);
  const [scanSteps, setScanSteps] = useState<ProgressStep[]>([]);
  const [searchedLocation, setSearchedLocation] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(syncedRecentSearches ?? []);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countryDraft, setCountryDraft] = useState('Zambia');
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const [searchExpanded, setSearchExpanded] = useState(true);
  const locationRef = useRef<TextInput>(null);

  const topPad = Platform.OS === 'web' ? 16 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 72 : insets.bottom + 56;
  const s = styles(colors);

  // Clear legacy company caches on first load
  const didClearCompanies = useRef(false);
  useEffect(() => {
    if (didClearCompanies.current) return; didClearCompanies.current = true;
    AsyncStorage.getItem('cc_companies_cleared_v5').then(async (cleared) => {
      if (!cleared) {
        const keys = await AsyncStorage.getAllKeys();
        const stale = keys.filter(k => k.startsWith(CACHE_PFX));
        if (stale.length) await AsyncStorage.multiRemove(stale);
        await AsyncStorage.setItem('cc_companies_cleared_v5', '1');
      }
    }).catch((err) => console.warn('Failed to clear company cache:', err));
  }, []);

  // Sync recent searches from cloud when they change on another device
  useEffect(() => {
    if (syncedRecentSearches && syncedRecentSearches.length > 0) {
      setRecentSearches(syncedRecentSearches);
    }
  }, [syncedRecentSearches]);

  const saveRecent = useCallback((loc: string, type: string) => {
    const label = `${type.charAt(0).toUpperCase() + type.slice(1)} · ${loc.split(',')[0]}`;
    const next = [{ label, location: loc, searchType: type, timestamp: Date.now() }, ...recentSearches.filter(r => !(r.location === loc && r.searchType === type))].slice(0, MAX_RECENT);
    setRecentSearches(next);
    saveRecentSearches(next);
  }, [recentSearches, saveRecentSearches]);

  const handleUseGps = async () => {
    setGpsLoading(true);
    try {
      const place = await detectLocation();
      setLocationText(place);
      if (profile) updateProfile({ ...profile, city: place });
    } catch { setCountryDraft(profile?.city || 'Zambia'); setShowCountryPicker(true); }
    finally { setGpsLoading(false); }
  };

  const handleCountryConfirm = async () => {
    const c = countryDraft.trim() || 'Zambia';
    setShowCountryPicker(false); setLocationText(c);
    if (profile) await updateProfile({ ...profile, city: c });
  };

  const alreadyTracked = (name: string) =>
    applications.some(a => a.companyName.toLowerCase() === name.toLowerCase()) || trackedNames.has(name);

  const handleScan = async (overrideLoc?: string, overrideType?: SearchType, bypassCache = false) => {
    const type = overrideType ?? searchType;
    const isBrowse = type === 'browse';
    const isAttachments = type === 'attachment';

    if (!isBrowse && !profile?.currentDegree) {
      Alert.alert('Degree required', 'Add your degree in Profile before scanning.'); return;
    }
    const loc = (overrideLoc ?? locationText).trim();
    if (!loc) { Alert.alert('Location required', 'Enter a city, province, or country.'); locationRef.current?.focus(); return; }

    const industryLabel = isBrowse && browseIndustry !== 'all'
      ? (BROWSE_INDUSTRIES.find(b => b.key === browseIndustry)?.label ?? browseIndustry)
      : '';
    const ck = cacheKey(loc, isBrowse ? `browse_${browseIndustry}` : isAttachments ? 'attachments' : type);

    if (!bypassCache) {
      try {
        const raw = await AsyncStorage.getItem(ck);
        if (raw) {
          const { data, ts } = JSON.parse(raw) as { data: CompanyResult[]; ts: number };
          if (Date.now() - ts < CACHE_TTL) {
            setResults(data); setSearchedLocation(loc); setActiveFilter('all'); setExpandedCard(null);
            saveRecent(loc, type); return;
          }
        }
      } catch { /* ignore */ }
    }

    setIsScanning(true); setResults([]); setActiveFilter('all'); setExpandedCard(null); setSearchedLocation(loc);

    if (isBrowse) {
      setScanSteps([
        { label: loc, status: 'done', detail: industryLabel || 'All industries' },
        { label: `Searching ${industryLabel || 'all'} companies in ${loc}`, status: 'active' },
        { label: 'Collecting company details', status: 'pending' },
        { label: 'Gathering contact info', status: 'pending' },
      ]);
    } else if (isAttachments) {
      setScanSteps([
        { label: 'Profile validated', status: 'done', detail: `${profile!.currentDegree} · ${loc}` },
        { label: `Finding attachment sites in ${loc}`, status: 'active' },
        { label: 'Matching to your field of study', status: 'pending' },
        { label: 'Gathering contact details', status: 'pending' },
      ]);
    } else {
      setScanSteps([
        { label: 'Profile validated', status: 'done', detail: `${profile!.currentDegree} · ${loc}` },
        { label: `Searching ${loc} — ${SEARCH_TYPES.find(t => t.key === type)?.label}`, status: 'active' },
        { label: 'Matching to your degree and skills', status: 'pending' },
        { label: 'Gathering contact details', status: 'pending' },
      ]);
    }

    try {
      // Step 1: query local database first
      let data: CompanyResult[] = [];
      const userProfile = profile ? {
        degree: profile.currentDegree,
        skills: profile.skills,
        preferredIndustries: profile.preferredIndustries,
        goals: profile.careerGoals,
        professionKeywords: profile.professionKeywords,
      } : undefined;
      const dbResults = await searchLocalCompanies(
        loc,
        isBrowse ? (industryLabel?.toLowerCase() ?? '') : (profile?.preferredIndustries?.toLowerCase() ?? ''),
        userProfile,
        undefined,
        type,
      );

      // Threshold: if we have fewer than this many local results, also run AI to supplement
      const AI_SUPPLEMENT_THRESHOLD = 25;

      const USER_INTENT_MAP: Record<SearchType, string> = {
        attachment: `Find companies physically located in ${loc} that can host a ${profile?.currentDegree ?? 'engineering'} student for industrial attachment or WIL placement. Do NOT include universities, schools, or colleges — those are training institutions, not attachment hosts. Only return companies whose headquarters, mine sites, or main offices are in or near ${loc}.`,
        internships: `Find companies physically located in ${loc} offering paid or unpaid internships for a ${profile?.currentDegree ?? 'engineering'} student. Exclude educational institutions as employers. Only return companies whose headquarters or main offices are in or near ${loc}.`,
        graduate: `Find companies physically located in ${loc} with graduate trainee programmes or entry-level roles suited to a fresh ${profile?.currentDegree ?? 'engineering'} graduate. Only return companies whose headquarters or main offices are in or near ${loc}.`,
        volunteer: `Find NGOs, community organisations, hospitals, and charities physically located in ${loc} that accept volunteers with a background in ${profile?.currentDegree ?? 'engineering'}. Only return organisations whose headquarters or main offices are in or near ${loc}.`,
        jobs: `Find companies physically located in ${loc} actively hiring for full-time ${profile?.currentDegree ?? 'engineering'} roles and related positions. Only return companies whose headquarters or main offices are in or near ${loc}.`,
        browse: `Browse ${industryLabel || 'all'} companies whose headquarters or main offices are physically located in ${loc}.`,
      };

      const buildAiPayload = (): Record<string, unknown> => isBrowse
        ? { locationText: loc, industry: industryLabel, browseMode: true, userIntent: USER_INTENT_MAP.browse }
        : {
            locationText: loc,
            degree: profile!.currentDegree,
            institution: profile!.institution,
            yearOfStudy: profile!.yearOfStudy,
            skills: profile!.skills,
            city: profile!.city,
            preferredIndustries: profile!.preferredIndustries,
            goals: profile!.careerGoals,
            documentsContext: buildDocumentsContext(docs),
            searchType: type,
            userIntent: USER_INTENT_MAP[type] ?? USER_INTENT_MAP.jobs,
          };

      const MAX_RESULTS = 30;
      const mergeResults = (local: CompanyResult[], ai: CompanyResult[]): CompanyResult[] => {
        const seen = new Set(local.map(c => c.name.toLowerCase().trim()));
        const unique = ai.filter(c => !seen.has(c.name.toLowerCase().trim()));
        return [...local, ...unique];
      };

      if (dbResults.length > 0 && dbResults.length >= AI_SUPPLEMENT_THRESHOLD) {
        // Enough local results — skip AI
        data = dbResults.sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0)).slice(0, MAX_RESULTS);
        const matchedCount = data.filter(c => c.professionsMatch).length;
        setScanSteps(prev => prev.map((step, i) => {
          if (i === 1) return { ...step, status: 'done', detail: `${data.length} from local directory` };
          if (i === 2) return { ...step, status: 'done', detail: isBrowse ? 'Details collected' : matchedCount > 0 ? `${matchedCount} matched to your degree` : `Searched for ${profile!.currentDegree}` };
          if (i === 3) return { ...step, status: 'done', detail: 'Database search complete' };
          return step;
        }));
      } else {
        // Either no local results, or fewer than threshold — run AI to supplement
        const hasLocal = dbResults.length > 0;
        setScanSteps(prev => prev.map((step, i) => {
          if (i === 1) return { ...step, status: 'active', detail: hasLocal ? `${dbResults.length} local — searching web for more` : 'No local matches — searching web' };
          return step;
        }));

        let aiData: CompanyResult[] = [];
        try {
          const raw = await aiService.discoverCompanies(buildAiPayload());
          const rawArr: CompanyResult[] = Array.isArray(raw) ? raw as CompanyResult[] : Array.isArray((raw as any)?.companies) ? (raw as any).companies : [];
          aiData = rawArr.map(c => ({ ...c, fitScore: typeof c.fitScore === 'number' ? c.fitScore : 50 }));
        } catch { /* AI failed — continue with local only */ }

        data = hasLocal ? mergeResults(dbResults, aiData) : aiData;
        data = data.sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0)).slice(0, MAX_RESULTS);

        const matchedCount = data.filter(c => c.professionsMatch).length;
        setScanSteps(prev => prev.map((step, i) => {
          if (i === 1) return { ...step, status: 'done', detail: `${dbResults.length} local + ${aiData.length} web = ${data.length} total` };
          if (i === 2) return { ...step, status: 'done', detail: isBrowse ? 'Details collected' : matchedCount > 0 ? `${matchedCount} matched to your degree` : `Searched for ${profile?.currentDegree ?? 'your degree'}` };
          if (i === 3) return { ...step, status: 'done', detail: 'Websites and addresses gathered' };
          return step;
        }));
      }

      // ── Post-retrieval validation ──────────────────────────────────────────
      // Re-score every result (local + AI) against the user's actual profile.
      // This corrects inflated AI scores and removes profession-sector mismatches
      // before the list is shown — e.g. a children's hospital can't appear with a
      // high fit score for an electrical engineering student.
      if (!isBrowse && userProfile) {
        const before = data.length;
        data = validateResultsForProfile(data, userProfile, type)
          .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))
          .slice(0, MAX_RESULTS);
        const removed = before - data.length;
        if (removed > 0) {
          setScanSteps(prev => prev.map((step, i) =>
            i === 3
              ? { ...step, status: 'done', detail: `${data.length} relevant · ${removed} irrelevant removed` }
              : step
          ));
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      setResults(data);
      setSearchExpanded(false);
      saveRecent(loc, type);
      // Save to cloud sync so results appear on other devices
      saveSearchResults(data);
      AsyncStorage.setItem(ck, JSON.stringify({ data, ts: Date.now() })).catch((err) => console.warn('Failed to save search results:', err));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setScanSteps(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'failed', detail: err.name === 'AbortError' ? 'Request timed out' : (err.message || 'Unexpected error') } : s));
      Alert.alert('Search failed', err.name === 'AbortError' ? 'The search timed out. Try again.' : (err.message || 'Check your connection and try again.'));
    } finally { setIsScanning(false); }
  };

  const handleTrack = async (company: CompanyResult) => {
    if (alreadyTracked(company.name)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await addApplication({ companyName: company.name, role: `${SEARCH_TYPES.find(t => t.key === searchType)?.label ?? 'Role'} – ${profile?.currentDegree || 'General'}`, status: 'Interested', researchSummary: undefined });
    setTrackedNames(prev => new Set([...prev, company.name]));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const filteredResults = useMemo(() => results.filter(c => matchesFilter(c, activeFilter)), [results, activeFilter]);
  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { all: results.length };
    INDUSTRY_FILTERS.slice(1).forEach(f => { counts[f.key] = results.filter(c => matchesFilter(c, f.key)).length; });
    return counts;
  }, [results]);

  const avgMatch = results.length > 0 ? Math.round(results.reduce((s, c) => s + c.fitScore, 0) / results.length) : 0;
  const hiringNow = results.filter(c => c.fitScore >= 70).length;

  return (
    <ScrollView style={[s.screen, { paddingTop: topPad }]} contentContainerStyle={{ paddingBottom: bottomPad + 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

      {/* ── Header ─────────────────────────────────────── */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Companies</Text>
          <Text style={s.headerSub}>
            {profile?.city ? `${profile.city.split(',')[0]} · ` : 'Zambia · '}
            {searchType === 'browse'
            ? 'Browse by area & industry'
            : searchType === 'attachment'
              ? 'Find industrial attachment sites'
              : (profile?.currentDegree ? profile.currentDegree.replace(/^(Bachelor|B\.?Sc|B\.?Eng|B\.?A|Bachelor of)[\s.]+/i, 'B.') : 'Add degree in Profile')}
          </Text>
        </View>
        <Pressable style={s.searchIconBtn} onPress={() => locationRef.current?.focus()} accessibilityLabel="Focus location search">
          <Feather name="search" size={16} color={colors.primary} />
        </Pressable>
      </View>

      {/* ── Collapsed search bar (shown when results exist and not expanded) ── */}
      {results.length > 0 && !searchExpanded && !isScanning ? (
        <View style={s.collapsedBar}>
          <Pressable style={s.collapsedLeft} onPress={() => setSearchExpanded(true)} accessibilityRole="button" accessibilityLabel="Expand search options">
            <Feather name="map-pin" size={12} color={colors.primary} />
            <Text style={s.collapsedLoc} numberOfLines={1}>{locationText.split(',')[0]}</Text>
            <View style={s.collapsedTypePill}>
              <Text style={s.collapsedTypeText}>{SEARCH_TYPES.find(t => t.key === searchType)?.label ?? searchType}</Text>
            </View>
          </Pressable>
          <View style={s.collapsedRight}>
            <Pressable
              style={({ pressed }) => [s.collapsedRescanBtn, pressed && { opacity: 0.8 }]}
              onPress={() => { setSearchExpanded(false); handleScan(undefined, undefined, true); }}
              disabled={isScanning}
              accessibilityRole="button"
              accessibilityLabel="Search again"
            >
              <Feather name="refresh-cw" size={12} color="#fff" />
              <Text style={s.collapsedRescanText}>Rescan</Text>
            </Pressable>
            <Pressable onPress={() => setSearchExpanded(true)} accessibilityRole="button" accessibilityLabel="Expand">
              <Feather name="chevron-down" size={14} color={colors.textMuted} style={{ marginLeft: 6 }} />
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          {/* ── Location + Profession row ───────────────────── */}
          <View style={s.inputRow}>
            {/* Location pill */}
            <Pressable style={[s.inputPill, { borderColor: colors.indigoBorder }]} onPress={() => locationRef.current?.focus()}>
              {gpsLoading
                ? <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 6 }} />
                : <Feather name="map-pin" size={13} color={colors.primary} style={{ marginRight: 6 }} />}
              <TextInput
                ref={locationRef}
                value={locationText}
                onChangeText={setLocationText}
                placeholder="Location"
                placeholderTextColor={colors.textMuted}
                style={s.inputPillText}
                returnKeyType="search"
                onSubmitEditing={() => handleScan()}
                autoCorrect={false}
              />
              <Feather name="chevron-down" size={12} color={colors.textMuted} style={{ marginLeft: 'auto' as any }} />
            </Pressable>

            {/* Profession pill — hidden in Browse Area */}
            {searchType !== 'browse' && (
              <Pressable style={[s.inputPill, s.inputPillProfession]} onPress={() => !profile?.currentDegree ? router.push('/profile' as any) : handleUseGps()}>
                <Feather name="box" size={13} color={colors.textMuted} style={{ marginRight: 6, flexShrink: 0 }} />
                <Text style={[s.inputPillText, !profile?.currentDegree && { color: colors.textMuted }]} numberOfLines={2}>
                  {profile?.currentDegree ?? 'Profession…'}
                </Text>
              </Pressable>
            )}
          </View>

          {/* ── Search type tabs ── */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 4, marginBottom: 8 }}>
            {SEARCH_TYPES.map(t => (
              <Pressable
                key={t.key}
                style={[s.typeTab, searchType === t.key && s.typeTabActive]}
                onPress={() => { setSearchType(t.key); setResults([]); setScanSteps([]); setActiveFilter('all'); setSearchExpanded(true); Haptics.selectionAsync(); }}
                accessibilityRole="button"
                accessibilityState={{ selected: searchType === t.key }}
              >
                <Text style={[s.typeTabText, searchType === t.key && s.typeTabTextActive]} numberOfLines={1}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* ── Tab hint banner ── */}
          {searchType !== 'browse' && (() => {
            const hints: Record<string, { icon: string; text: React.ReactNode }> = {
              jobs: { icon: 'briefcase', text: <>Finds <Text style={{ fontFamily: 'Inter_700Bold', color: colors.primary }}>full-time job openings</Text> at companies in your area matched to your degree and skills.</> },
              internships: { icon: 'clock', text: <>Finds companies offering <Text style={{ fontFamily: 'Inter_700Bold', color: colors.primary }}>paid or unpaid internships</Text> suited to your field of study and experience level.</> },
              graduate: { icon: 'award', text: <>Finds <Text style={{ fontFamily: 'Inter_700Bold', color: colors.primary }}>graduate programmes and trainee schemes</Text> at employers in your area that hire fresh graduates.</> },
              volunteer: { icon: 'heart', text: <>Finds <Text style={{ fontFamily: 'Inter_700Bold', color: colors.primary }}>volunteer and community roles</Text> where you can build experience and give back in your area.</> },
              attachment: { icon: 'layers', text: <>Finds companies in your area that offer <Text style={{ fontFamily: 'Inter_700Bold', color: colors.primary }}>industrial attachment / WIL</Text> placements matched to your field of study.</> },
            };
            const h = hints[searchType];
            if (!h) return null;
            return (
              <View style={s.attachmentHint}>
                <Feather name={h.icon as any} size={13} color={colors.primary} />
                <Text style={s.attachmentHintText}>{h.text}</Text>
              </View>
            );
          })()}

          {/* ── Industry picker (Browse Area only) ── */}
          {searchType === 'browse' && (
            <View style={{ marginBottom: 14 }}>
              <Text style={s.browseIndustryLabel}>INDUSTRY</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 5 }}>
                {BROWSE_INDUSTRIES.map(ind => (
                  <Pressable
                    key={ind.key}
                    style={[s.browseChip, browseIndustry === ind.key && s.browseChipActive]}
                    onPress={() => { setBrowseIndustry(ind.key); Haptics.selectionAsync(); }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: browseIndustry === ind.key }}
                  >
                    <Feather name={ind.icon as any} size={10} color={browseIndustry === ind.key ? '#fff' : colors.textMuted} />
                    <Text style={[s.browseChipText, browseIndustry === ind.key && s.browseChipTextActive]}>{ind.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* ── Recent searches ────────────────────────────── */}
          {recentSearches.length > 0 && (
            <View style={s.recentSection}>
              <View style={s.recentHeader}>
                <Text style={s.recentLabel}>RECENT</Text>
                <Pressable
                  onPress={() => { setRecentSearches([]); saveRecentSearches([]); }}
                  accessibilityLabel="Clear search history"
                  accessibilityRole="button"
                  style={s.clearHistoryBtn}
                >
                  <Feather name="trash-2" size={11} color={colors.danger} />
                  <Text style={s.clearHistoryText}>Clear</Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 5 }}>
                {recentSearches.slice(0, 6).map((r, i) => (
                  <Pressable key={i} style={s.recentChip} onPress={() => { setLocationText(r.location); setSearchType(r.searchType as SearchType); handleScan(r.location, r.searchType as SearchType); }}>
                    <Feather name="rotate-ccw" size={10} color={colors.textMuted} />
                    <Text style={s.recentChipText}>{r.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* ── Scan button ────────────────────────────────── */}
          <Pressable style={({ pressed }) => [s.scanBtn, isScanning && { opacity: 0.8 }, pressed && { opacity: 0.88 }]} onPress={() => { setSearchExpanded(false); handleScan(); }} disabled={isScanning} accessibilityRole="button">
            {isScanning
              ? <ActivityIndicator size="small" color="#fff" />
              : <Feather name={searchType === 'browse' ? 'map' : searchType === 'attachment' ? 'layers' : 'search'} size={16} color="#fff" />}
            <Text style={s.scanBtnText}>
              {isScanning
                ? (searchType === 'browse' ? 'Browsing…' : searchType === 'attachment' ? 'Finding Sites…' : 'Scanning…')
                : results.length > 0
                  ? (searchType === 'browse' ? 'Browse Again' : searchType === 'attachment' ? 'Search Again' : 'Scan Again')
                  : (searchType === 'browse' ? 'Browse Companies' : searchType === 'attachment' ? 'Find Attachment Sites' : 'Scan Companies')}
            </Text>
          </Pressable>

          {/* ── Step progress ──────────────────────────────── */}
          {scanSteps.length > 0 && searchExpanded && (
            <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
              <StepProgress steps={scanSteps} />
              {!isScanning && scanSteps.some(s => s.status === 'failed') && (
                <Pressable
                  style={({ pressed }) => [s.retryIndexBtn, pressed && { opacity: 0.82 }]}
                  onPress={() => { setScanSteps([]); handleScan(); }}
                  accessibilityRole="button"
                >
                  <Feather name="refresh-cw" size={13} color="#fff" />
                  <Text style={s.retryIndexBtnText}>Retry</Text>
                </Pressable>
              )}
            </View>
          )}
        </>
      )}

      {/* ── Step progress during active scan (collapsed mode only) ── */}
      {isScanning && scanSteps.length > 0 && !searchExpanded && (
        <View style={{ paddingHorizontal: 16, marginTop: 4, marginBottom: 8 }}>
          <StepProgress steps={scanSteps} />
        </View>
      )}

      {/* ── Results ───────────────────────────────────── */}
      {results.length > 0 && (
        <>
          {/* Stats strip */}
          <View style={s.statsStrip}>
            {[[String(results.length), 'Companies'], [String(hiringNow), searchType === 'browse' ? 'Likely Hiring' : searchType === 'attachment' ? 'Accept Students' : 'Hiring Now'], [`${avgMatch}%`, searchType === 'browse' ? 'Area Score' : searchType === 'attachment' ? 'Fit Score' : 'Avg Match']].map(([n, l], i) => (
              <React.Fragment key={i}>
                {i > 0 && <View style={s.statsDivider} />}
                <View style={s.statItem}>
                  <Text style={[s.statNum, i === 2 && { color: colors.primary }]}>{n}</Text>
                  <Text style={s.statLabel}>{l}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>

          {/* Industry filters */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 5, paddingBottom: 4, marginBottom: 8 }}>
            {INDUSTRY_FILTERS.filter(f => f.key === 'all' || (filterCounts[f.key] ?? 0) > 0).map(f => (
              <Pressable key={f.key} style={[s.filterChip, activeFilter === f.key && s.filterChipActive]} onPress={() => { setActiveFilter(f.key); Haptics.selectionAsync(); }}>
                <Text style={[s.filterChipText, activeFilter === f.key && s.filterChipTextActive]}>{f.label}</Text>
                {filterCounts[f.key] > 0 && (
                  <View style={[s.filterBadge, activeFilter === f.key && { backgroundColor: 'rgba(255,255,255,0.28)' }]}>
                    <Text style={[s.filterBadgeText, activeFilter === f.key && { color: '#fff' }]}>{filterCounts[f.key]}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>

          {/* 2-col grid */}
          <View style={s.grid}>
            {filteredResults.map((company, idx) => {
              const fitColor = getFitColor(company.fitScore);
              const avatarColor = getAvatarColor(company.name);
              const tracked = alreadyTracked(company.name);
              const expanded = expandedCard === idx;
              const score = Math.min(100, Math.max(0, company.fitScore));

              return (
                <Pressable key={idx} style={[s.gridCard, expanded && s.gridCardExpanded]} onPress={() => { setExpandedCard(expanded ? null : idx); Haptics.selectionAsync(); }} accessibilityRole="button">
                  {/* Subtle corner glow */}
                  <View style={[s.cardCornerGlow, { backgroundColor: `${avatarColor}12` }]} />

                  {/* Avatar */}
                  <View style={[s.gridAvatar, { backgroundColor: `${avatarColor}20` }]}>
                    <Text style={[s.gridAvatarText, { color: avatarColor }]}>{company.name[0]?.toUpperCase()}</Text>
                  </View>

                  {/* Name + industry */}
                  <Text style={s.gridName} numberOfLines={2}>{company.name}</Text>
                  <Text style={s.gridIndustry} numberOfLines={1}>{company.industry || 'General'}</Text>

                  {/* Score bar */}
                  <View style={s.scoreTrack}>
                    <View style={[s.scoreFill, { width: `${score}%` as any, backgroundColor: fitColor }]} />
                  </View>
                  <View style={s.scoreRow}>
                    <Text style={s.scoreFitLabel}>Fit</Text>
                    <Text style={[s.scorePercent, { color: fitColor }]}>{score}%</Text>
                  </View>

                  {/* Expanded detail */}
                  {expanded && (
                    <>
                      {/* Best matched role */}
                      {company.matchedRole && (
                        <View style={[s.matchedRoleBanner, { backgroundColor: `${avatarColor}18`, borderColor: `${avatarColor}40` }]}>
                          <Feather name="briefcase" size={12} color={avatarColor} />
                          <Text style={[s.matchedRoleText, { color: avatarColor }]}>
                            You could work as a <Text style={{ fontWeight: '700' }}>{company.matchedRole}</Text>
                          </Text>
                        </View>
                      )}
                      {(company.whyGoodFit || company.description) && (
                        <Text style={s.gridWhyFit} numberOfLines={4}>{company.whyGoodFit || company.description}</Text>
                      )}
                      {company.typesOfRoles && company.typesOfRoles.length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                          {company.typesOfRoles.slice(0, 3).map((r, ri) => (
                            <View key={ri} style={[s.rolePill, { backgroundColor: `${avatarColor}14`, borderColor: `${avatarColor}35` }]}>
                              <Text style={[s.roleText, { color: avatarColor }]}>{r}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {(company.address || company.website || company.email) && (
                        <View style={s.expandedContact}>
                          {company.address ? <View style={s.cRow}><Feather name="map-pin" size={10} color={colors.textMuted} /><Text style={s.cText} numberOfLines={1}>{company.address}</Text></View> : null}
                          {company.website ? <Pressable style={s.cRow} onPress={() => Linking.openURL(company.website!)}><Feather name="globe" size={10} color={colors.primary} /><Text style={[s.cText, { color: colors.primary }]} numberOfLines={1}>{company.website.replace(/^https?:\/\//, '')}</Text></Pressable> : null}
                          {company.email ? <Pressable style={s.cRow} onPress={() => Linking.openURL(`mailto:${company.email}`)}><Feather name="mail" size={10} color={colors.primary} /><Text style={[s.cText, { color: colors.primary }]} numberOfLines={1}>{company.email}</Text></Pressable> : null}
                        </View>
                      )}
                      <View style={s.cardActions}>
                        <Pressable style={[s.trackBtn, tracked && s.trackBtnDone]} onPress={e => { e.stopPropagation?.(); handleTrack(company); }} disabled={tracked}>
                          <Feather name={tracked ? 'check' : 'bookmark'} size={11} color={tracked ? colors.success : '#fff'} />
                          <Text style={[s.trackBtnText, tracked && { color: colors.success }]}>{tracked ? 'Tracked' : 'Track'}</Text>
                        </Pressable>
                        <Pressable style={[s.viewBtn, { backgroundColor: `${avatarColor}14`, borderColor: `${avatarColor}35` }]} onPress={() => router.push(`/company-detail?data=${encodeURIComponent(JSON.stringify(company))}` as any)}>
                          <Text style={[s.viewBtnText, { color: avatarColor }]}>View</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ── Empty state ────────────────────────────────── */}
      {!isScanning && results.length === 0 && scanSteps.length === 0 && (
        <View style={s.emptyState}>
          <View style={s.emptyIconRing}>
            <Feather name={searchType === 'browse' ? 'map' : searchType === 'attachment' ? 'layers' : 'compass'} size={30} color={colors.primary} />
          </View>
          {searchType === 'browse' ? (
            <>
              <Text style={s.emptyTitle}>Browse companies in your area</Text>
              <Text style={s.emptySubtitle}>Pick an industry above, set your location, and see all companies operating in that sector near you.</Text>
              <View style={{ width: '100%', gap: 8 }}>
                {[
                  { icon: 'map-pin', text: 'Set your location above' },
                  { icon: 'grid', text: 'Choose an industry' },
                  { icon: 'map', text: 'Tap Browse Companies' },
                ].map((step, i) => (
                  <View key={i} style={s.emptyStep}>
                    <View style={s.emptyStepNum}><Text style={s.emptyStepNumText}>{i + 1}</Text></View>
                    <Feather name={step.icon as any} size={13} color={colors.primary} />
                    <Text style={s.emptyStepText}>{step.text}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : searchType === 'attachment' ? (
            <>
              <Text style={s.emptyTitle}>Find your attachment site</Text>
              <Text style={s.emptySubtitle}>We search for companies in your area known to host students for industrial attachment and WIL placements in your field.</Text>
              <View style={{ width: '100%', gap: 8 }}>
                {[
                  { icon: 'map-pin', text: 'Set your location above' },
                  { icon: 'layers', text: 'Tap Find Attachment Sites' },
                  { icon: 'bookmark', text: 'Track sites you want to apply to' },
                ].map((step, i) => (
                  <View key={i} style={s.emptyStep}>
                    <View style={s.emptyStepNum}><Text style={s.emptyStepNumText}>{i + 1}</Text></View>
                    <Feather name={step.icon as any} size={13} color={colors.primary} />
                    <Text style={s.emptyStepText}>{step.text}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={s.emptyTitle}>Find your best match</Text>
              <Text style={s.emptySubtitle}>We scan Zambian companies and score them against your degree, skills, and career goals.</Text>
              <View style={{ width: '100%', gap: 8 }}>
                {[{ icon: 'map-pin', text: 'Set your location above' }, { icon: 'search', text: 'Tap Scan Companies' }, { icon: 'bookmark', text: 'Track the ones you like' }].map((step, i) => (
                  <View key={i} style={s.emptyStep}>
                    <View style={s.emptyStepNum}><Text style={s.emptyStepNumText}>{i + 1}</Text></View>
                    <Feather name={step.icon as any} size={13} color={colors.primary} />
                    <Text style={s.emptyStepText}>{step.text}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      )}

      {/* ── Country picker modal ───────────────────────── */}
      <Modal visible={showCountryPicker} animationType="fade" transparent onRequestClose={() => setShowCountryPicker(false)}>
        <KeyboardAvoidingView style={s.cpOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.cpDialog}>
            <View style={[s.cpIconBg, { backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder }]}><Feather name="map-pin" size={22} color={colors.primary} /></View>
            <Text style={s.cpTitle}>Where are you?</Text>
            <Text style={s.cpSubtitle}>GPS is unavailable. Enter your country or city.</Text>
            <TextInput value={countryDraft} onChangeText={setCountryDraft} placeholder="e.g. Zambia, Lusaka…" placeholderTextColor={colors.textMuted} style={s.cpInput} autoFocus returnKeyType="done" onSubmitEditing={handleCountryConfirm} />
            <View style={s.cpBtns}>
              <Pressable style={[s.cpBtn, { backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }]} onPress={() => setShowCountryPicker(false)}><Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textMuted }}>Cancel</Text></Pressable>
              <Pressable style={[s.cpBtn, { backgroundColor: colors.primary, flex: 1 }]} onPress={handleCountryConfirm}><Feather name="map-pin" size={13} color="#fff" /><Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' }}>Confirm</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, paddingTop: 12, gap: 12 },
  headerTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: colors.text, letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 2 },
  searchIconBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder, alignItems: 'center', justifyContent: 'center' },

  // Location + Profession row
  inputRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  inputPill: { width: 140, flexShrink: 0, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
  inputPillProfession: { width: undefined, flex: 1 },
  inputPillText: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.text } as any,

  // Mode toggle
  modeToggle: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 10, backgroundColor: colors.muted, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: colors.border },
  modeTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 9 },
  modeTabActive: { backgroundColor: colors.primary },
  modeTabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
  modeTabTextActive: { color: '#fff', fontFamily: 'Inter_700Bold' },

  // For Me sub-tabs
  subTabRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, gap: 8 },
  subTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  subTabActive: { borderColor: colors.primary, backgroundColor: colors.indigoBg },
  subTabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
  subTabTextActive: { color: colors.primary, fontFamily: 'Inter_700Bold' },

  // Attachment hint
  attachmentHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 16, marginBottom: 14, padding: 12, borderRadius: 12, backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder },
  attachmentHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18 },

  // Browse industry chips
  browseIndustryLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.textMuted, letterSpacing: 0.8, paddingHorizontal: 16, marginBottom: 8 },
  browseChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, height: 34 },
  browseChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  browseChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
  browseChipTextActive: { color: '#fff' },

  // Search type tabs
  typeTabRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 6, rowGap: 6 },
  typeTab: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  typeTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeTabText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
  typeTabTextActive: { color: '#fff', fontFamily: 'Inter_700Bold' },

  // Recent
  recentSection: { marginBottom: 12 },
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  recentLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.textMuted, letterSpacing: 0.8 },
  clearHistoryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.dangerBorder },
  clearHistoryText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.danger },
  recentChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6, height: 30 },
  recentChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.textSecondary },

  // Collapsed search bar
  collapsedBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  collapsedLeft: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 },
  collapsedLoc: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.text, flexShrink: 1 },
  collapsedTypePill: { backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  collapsedTypeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },
  collapsedRight: { flexDirection: 'row', alignItems: 'center', gap: 0, marginLeft: 8, flexShrink: 0 },
  collapsedRescanBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 6 },
  collapsedRescanText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Scan button
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 14, marginHorizontal: 16, paddingVertical: 15, marginBottom: 14 },
  scanBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  retryIndexBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, marginTop: 10 },
  retryIndexBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Stats
  statsStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, marginHorizontal: 16, marginBottom: 12, paddingVertical: 12, borderWidth: 1, borderColor: colors.border },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: colors.text },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 2 },
  statsDivider: { width: 1, height: 28, backgroundColor: colors.divider },

  // Industry filter
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, height: 30 },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
  filterChipTextActive: { color: '#fff' },
  filterBadge: { backgroundColor: colors.mutedStrong, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  filterBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: colors.textMuted },

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 10, marginBottom: 8 },
  gridCard: { width: '47%', backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, position: 'relative', overflow: 'hidden' },
  gridCardExpanded: { width: '100%' },
  cardCornerGlow: { position: 'absolute', top: 0, right: 0, width: 48, height: 48, borderBottomLeftRadius: 48, borderTopRightRadius: 14 },
  gridAvatar: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  gridAvatarText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold' },
  gridName: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.text, marginBottom: 2, lineHeight: 18 },
  gridIndustry: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginBottom: 10 },
  scoreTrack: { height: 4, backgroundColor: colors.muted, borderRadius: 4, overflow: 'hidden' },
  scoreFill: { height: '100%', borderRadius: 4 },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  scoreFitLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.textMuted },
  scorePercent: { fontSize: 10, fontFamily: 'Inter_700Bold' },

  // Expanded
  gridWhyFit: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 16, marginTop: 10, borderLeftWidth: 2, borderLeftColor: colors.indigoBorder, paddingLeft: 7 },
  matchedRoleBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, marginTop: 10 },
  matchedRoleText: { fontSize: 11, fontFamily: 'Inter_500Medium', flex: 1 },
  rolePill: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  roleText: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  expandedContact: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.divider, gap: 5 },
  cRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flex: 1 },
  cardActions: { flexDirection: 'row', gap: 6, marginTop: 10 },
  trackBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.primary, borderRadius: 9, paddingVertical: 8 },
  trackBtnDone: { backgroundColor: colors.successBg, borderWidth: 1, borderColor: colors.successBorder },
  trackBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  viewBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 9, paddingVertical: 8, borderWidth: 1 },
  viewBtnText: { fontSize: 11, fontFamily: 'Inter_700Bold' },

  // Empty
  emptyState: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 28, gap: 14 },
  emptyIconRing: { width: 72, height: 72, borderRadius: 22, backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.text, textAlign: 'center', letterSpacing: -0.4 },
  emptySubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  emptyStep: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: colors.border },
  emptyStepNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.indigoBg, alignItems: 'center', justifyContent: 'center' },
  emptyStepNumText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.primary },
  emptyStepText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.textSecondary, flex: 1 },

  // Country picker
  cpOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  cpDialog: { width: '100%', backgroundColor: colors.card, borderRadius: 24, padding: 24, alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border },
  cpIconBg: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  cpTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.text },
  cpSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted, textAlign: 'center' },
  cpInput: { width: '100%', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.text, backgroundColor: colors.background },
  cpBtns: { flexDirection: 'row', gap: 10, width: '100%' },
  cpBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 12 },
});
