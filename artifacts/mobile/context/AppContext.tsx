import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { aiService } from '@/lib/aiService';
import { supabase } from '@/lib/supabase';
import { fetchCloudData, pushCloudData } from '@/lib/cloudSync';
import type { CompanySearchResult, RecentSearch, DiscoveredEvent } from '@/lib/cloudSync';

export type ApplicationStatus = 'Interested' | 'Applied' | 'Interviewing' | 'Offer' | 'Rejected' | 'Accepted';
export type ThemeOverride = 'system' | 'light' | 'dark';

export interface ProfileField {
  id: string;
  label: string;
  value: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  weeklyGoal?: number;
  currentDegree: string;
  institution?: string;
  yearOfStudy?: string;
  skills?: string;
  city?: string;
  preferredIndustries?: string;
  careerGoals: string;
  portfolioUrl?: string;
  linkedInUrl?: string;
  githubUrl?: string;
  profileImageUri?: string;
  profileFields?: ProfileField[];
  /** AI-generated job titles that match the user's degree/career, used for smart company filtering */
  professionKeywords?: string[];
}

export interface Application {
  id: string;
  companyName: string;
  role: string;
  status: ApplicationStatus;
  deadline?: string;
  notes?: string;
  appliedDate?: string;
  lastModified: string;
  createdDate?: string;
  draftedLetter?: string;
  researchSummary?: string;
  interviewQuestions?: { personal: string[]; company: string[]; experience: string[] };
  interviewVerdict?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface InterviewAnswer {
  question: string;
  answer: string;
}

export interface InterviewVerdict {
  verdict: 'accepted' | 'shortlisted' | 'rejected';
  overallScore: number;
  overallFeedback: string;
  strengths: string[];
  areasToImprove: string[];
  answerFeedback: Array<{ question: string; answer: string; feedback: string; score: number }>;
  recommendation: string;
}

export interface InterviewSession {
  id: string;
  title: string;
  company: string;
  role: string;
  status: 'in-progress' | 'completed';
  questions: string[];
  answers: string[];
  researchSummary: string;
  verdict?: InterviewVerdict;
  startedAt: string;
  completedAt?: string;
}

export interface SavedLetter {
  id: string;
  title: string;
  company: string;
  role: string;
  letterType: string;
  content: string;
  status: 'draft' | 'saved' | 'applied';
  createdAt: string;
  updatedAt: string;
  linkedApplicationId?: string;
}

export interface Contact {
  id: string;
  name: string;
  company: string;
  howWeMet: string;
  notes?: string;
  isWarmLead: boolean;
  needsFollowUp: boolean;
  addedDate: string;
}

export interface SavedEvent {
  id: string;
  title: string;
  eventType: string;
  organizer: string;
  dateLabel: string;
  dateIso?: string;
  location: string;
  description?: string;
  url?: string;
  source?: string;
  tags?: string[];
  isOnline?: boolean;
  savedAt: string;
}

export type DocCategory =
  | 'CV / Resume'
  | 'Cover Letter'
  | 'Certificate'
  | 'Academic Transcript'
  | 'Reference Letter'
  | 'Portfolio'
  | 'Other';

export interface StoredDocument {
  id: string;
  name: string;
  category: DocCategory;
  objectPath: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  extractedText?: string;
  parsedData?: Record<string, unknown>;
}

interface AppContextType {
  profile: UserProfile | null;
  applications: Application[];
  contacts: Contact[];
  savedEvents: SavedEvent[];
  docs: StoredDocument[];
  savedLetters: SavedLetter[];
  interviewSessions: InterviewSession[];
  isLoaded: boolean;
  isAuthenticated: boolean;
  themeOverride: ThemeOverride;
  setThemeOverride: (t: ThemeOverride) => Promise<void>;
  updateProfile: (p: UserProfile) => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  addApplication: (data: Omit<Application, 'id' | 'lastModified'>) => Promise<Application>;
  updateApplication: (id: string, updates: Partial<Application>) => Promise<void>;
  deleteApplication: (id: string) => Promise<void>;
  addContact: (data: Omit<Contact, 'id' | 'addedDate'>) => Promise<Contact>;
  updateContact: (id: string, updates: Partial<Contact>) => Promise<void>;
  deleteContact: (id: string) => Promise<void>;
  saveEvent: (event: Omit<SavedEvent, 'savedAt'>) => Promise<void>;
  unsaveEvent: (id: string) => Promise<void>;
  addDoc: (doc: Omit<StoredDocument, 'id' | 'uploadedAt'>) => Promise<StoredDocument>;
  updateDoc: (id: string, updates: Partial<StoredDocument>) => Promise<void>;
  deleteDoc: (id: string) => Promise<void>;
  addLetter: (data: Omit<SavedLetter, 'id' | 'createdAt' | 'updatedAt'>) => Promise<SavedLetter>;
  updateLetter: (id: string, updates: Partial<SavedLetter>) => Promise<void>;
  deleteLetter: (id: string) => Promise<void>;
  addInterview: (data: Omit<InterviewSession, 'id' | 'startedAt'>) => Promise<InterviewSession>;
  updateInterview: (id: string, updates: Partial<InterviewSession>) => Promise<void>;
  deleteInterview: (id: string) => Promise<void>;
  searchResults: CompanySearchResult[];
  setSearchResults: (r: CompanySearchResult[]) => Promise<void>;
  recentSearches: RecentSearch[];
  setRecentSearches: (r: RecentSearch[]) => Promise<void>;
  discoveredEvents: DiscoveredEvent[];
  setDiscoveredEvents: (e: DiscoveredEvent[]) => Promise<void>;
  clearAllData: () => Promise<void>;
}

export const AppContext = createContext<AppContextType | null>(null);

const PROFILE_KEY = 'cc_profile';
const APPS_KEY = 'cc_applications';
const CONTACTS_KEY = 'cc_contacts';
const SAVED_EVENTS_KEY = 'cc_saved_events';
const DOCS_KEY = 'cc_documents';
const LETTERS_KEY = 'cc_letters';
const INTERVIEWS_KEY = 'cc_interviews';
const THEME_KEY = 'cc_theme';
const SEARCH_RESULTS_KEY = 'cc_search_results';
const RECENT_SEARCHES_KEY = 'cc_recent_searches';
const DISCOVERED_EVENTS_KEY = 'cc_discovered_events';

export function genId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

async function loadLocalData(
  setProfile: (p: UserProfile) => void,
  setApplications: (a: Application[]) => void,
  setContacts: (c: Contact[]) => void,
  setSavedEvents: (e: SavedEvent[]) => void,
  setDocs: (d: StoredDocument[]) => void,
  setLetters: (l: SavedLetter[]) => void,
  setInterviews: (i: InterviewSession[]) => void,
  setSearchResults: (r: CompanySearchResult[]) => void,
  setRecentSearches: (r: RecentSearch[]) => void,
  setDiscoveredEvents: (e: DiscoveredEvent[]) => void,
  uid: string,
  displayName?: string,
) {
  const [
    rawProfile, rawApps, rawContacts, rawEvents, rawDocs, rawLetters, rawInterviews,
    rawSearchResults, rawRecentSearches, rawDiscoveredEvents,
  ] = await Promise.all([
    AsyncStorage.getItem(PROFILE_KEY),
    AsyncStorage.getItem(APPS_KEY),
    AsyncStorage.getItem(CONTACTS_KEY),
    AsyncStorage.getItem(SAVED_EVENTS_KEY),
    AsyncStorage.getItem(DOCS_KEY),
    AsyncStorage.getItem(LETTERS_KEY),
    AsyncStorage.getItem(INTERVIEWS_KEY),
    AsyncStorage.getItem(SEARCH_RESULTS_KEY),
    AsyncStorage.getItem(RECENT_SEARCHES_KEY),
    AsyncStorage.getItem(DISCOVERED_EVENTS_KEY),
  ]);
  let p: UserProfile = rawProfile
    ? JSON.parse(rawProfile)
    : { uid, displayName: displayName ?? 'You', currentDegree: '', careerGoals: '', weeklyGoal: 5 };
  if (!rawProfile) await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  setProfile(p);
  setApplications(rawApps ? JSON.parse(rawApps) : []);
  setContacts(rawContacts ? JSON.parse(rawContacts) : []);
  setSavedEvents(rawEvents ? JSON.parse(rawEvents) : []);
  setDocs(rawDocs ? JSON.parse(rawDocs) : []);
  setLetters(rawLetters ? JSON.parse(rawLetters) : []);
  setInterviews(rawInterviews ? JSON.parse(rawInterviews) : []);
  setSearchResults(rawSearchResults ? JSON.parse(rawSearchResults) : []);
  setRecentSearches(rawRecentSearches ? JSON.parse(rawRecentSearches) : []);
  setDiscoveredEvents(rawDiscoveredEvents ? JSON.parse(rawDiscoveredEvents) : []);
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [savedEvents, setSavedEvents] = useState<SavedEvent[]>([]);
  const [docs, setDocs] = useState<StoredDocument[]>([]);
  const [savedLetters, setSavedLetters] = useState<SavedLetter[]>([]);
  const [interviewSessions, setInterviewSessions] = useState<InterviewSession[]>([]);
  const [searchResults, setSearchResultsState] = useState<CompanySearchResult[]>([]);
  const [recentSearches, setRecentSearchesState] = useState<RecentSearch[]>([]);
  const [discoveredEvents, setDiscoveredEventsState] = useState<DiscoveredEvent[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [themeOverride, setThemeOverrideState] = useState<ThemeOverride>('dark');

  // Debounced cloud push — fires 2s after any data change while authenticated
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isAuthenticated || !profile?.uid) return;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => {
      pushCloudData(profile.uid, {
        profile,
        applications,
        contacts,
        savedEvents,
        documents: docs,
        letters: savedLetters,
        interviewSessions,
        searchResults,
        recentSearches,
        discoveredEvents,
      });
    }, 2000);
    return () => {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, applications, contacts, savedEvents, docs, savedLetters, interviewSessions, searchResults, recentSearches, discoveredEvents, isAuthenticated]);

  // Helper: apply cloud data over local state and persist to AsyncStorage.
  // Cloud is always authoritative — apply everything unconditionally so that
  // deletions made on another device are honoured here too.
  const applyCloudData = useCallback(async (cloud: Awaited<ReturnType<typeof fetchCloudData>>) => {
    if (!cloud) return;
    if (cloud.profile) {
      // Strip stale local-device file paths — they are unreachable on other devices.
      // Only data: URIs (base64-embedded) and https: URLs are portable.
      const sanitisedProfile = { ...cloud.profile };
      const imgUri = sanitisedProfile.profileImageUri ?? '';
      if (imgUri.startsWith('file://') || imgUri.startsWith('/')) {
        delete sanitisedProfile.profileImageUri;
      }
      setProfile(sanitisedProfile);
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(sanitisedProfile));
    }
    setApplications(cloud.applications);
    await AsyncStorage.setItem(APPS_KEY, JSON.stringify(cloud.applications));
    setContacts(cloud.contacts);
    await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(cloud.contacts));
    setSavedEvents(cloud.savedEvents);
    await AsyncStorage.setItem(SAVED_EVENTS_KEY, JSON.stringify(cloud.savedEvents));
    setDocs(cloud.documents);
    await AsyncStorage.setItem(DOCS_KEY, JSON.stringify(cloud.documents));
    setSavedLetters(cloud.letters);
    await AsyncStorage.setItem(LETTERS_KEY, JSON.stringify(cloud.letters));
    setInterviewSessions(cloud.interviewSessions);
    await AsyncStorage.setItem(INTERVIEWS_KEY, JSON.stringify(cloud.interviewSessions));
    setSearchResultsState(cloud.searchResults);
    await AsyncStorage.setItem(SEARCH_RESULTS_KEY, JSON.stringify(cloud.searchResults));
    setRecentSearchesState(cloud.recentSearches);
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(cloud.recentSearches));
    setDiscoveredEventsState(cloud.discoveredEvents);
    await AsyncStorage.setItem(DISCOVERED_EVENTS_KEY, JSON.stringify(cloud.discoveredEvents));
  }, []);

  useEffect(() => {
    const rawThemeLoad = AsyncStorage.getItem(THEME_KEY).then(rawTheme => {
      if (rawTheme === 'light' || rawTheme === 'dark' || rawTheme === 'system') {
        setThemeOverrideState(rawTheme);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      await rawThemeLoad;
      if (session?.user) {
        const meta = session.user.user_metadata as { display_name?: string } | undefined;
        await loadLocalData(
          setProfile, setApplications, setContacts, setSavedEvents, setDocs,
          setSavedLetters, setInterviewSessions,
          setSearchResultsState, setRecentSearchesState, setDiscoveredEventsState,
          session.user.id, meta?.display_name,
        );
        setIsAuthenticated(true);
        // Fetch cloud data in background and override local if cloud has more data
        fetchCloudData(session.user.id).then(applyCloudData).catch((err) => console.warn('Cloud sync failed:', err));
      }
      setIsLoaded(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const meta = session.user.user_metadata as { display_name?: string } | undefined;
        await loadLocalData(
          setProfile, setApplications, setContacts, setSavedEvents, setDocs,
          setSavedLetters, setInterviewSessions,
          setSearchResultsState, setRecentSearchesState, setDiscoveredEventsState,
          session.user.id, meta?.display_name,
        );
        setIsAuthenticated(true);
        // Sync from cloud when signing in on a new device
        fetchCloudData(session.user.id).then(applyCloudData).catch((err) => console.warn('Cloud sync failed:', err));
      } else {
        setIsAuthenticated(false);
        setProfile(null);
        setApplications([]);
        setContacts([]);
        setSavedEvents([]);
        setDocs([]);
        setSavedLetters([]);
        setInterviewSessions([]);
        setSearchResultsState([]);
        setRecentSearchesState([]);
        setDiscoveredEventsState([]);
      }
    });

    return () => subscription.unsubscribe();
  }, [applyCloudData]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { success: false, error: error.message };
    return { success: true };
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() } },
    });
    if (error) return { success: false, error: error.message };
    if (data.user && !data.session) {
      return { success: false, error: 'Check your email to confirm your account, then sign in.' };
    }
    return { success: true };
  }, []);

    const signOut = useCallback(async () => {
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore remote sign-out errors
      } finally {
        // Always clear local state immediately so the UI reflects signed-out state
        setIsAuthenticated(false);
        setProfile(null);
        setApplications([]);
        setContacts([]);
        setSavedEvents([]);
        setDocs([]);
        setSavedLetters([]);
        setInterviewSessions([]);
      }
    }, []);

  const saveApps = useCallback(async (apps: Application[]) => {
    setApplications(apps);
    await AsyncStorage.setItem(APPS_KEY, JSON.stringify(apps));
  }, []);

  const saveContacts = useCallback(async (ctcts: Contact[]) => {
    setContacts(ctcts);
    await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(ctcts));
  }, []);

  const keywordGenLock = useRef(false);

  const updateProfile = useCallback(async (p: UserProfile) => {
    // Never persist a local-device file path — strip it so it can't pollute
    // cloud sync.  Only data: URIs (base64) and https: URLs are portable.
    const imgUri = p.profileImageUri ?? '';
    const cleanProfile = (imgUri.startsWith('file://') || (imgUri.startsWith('/') && !imgUri.startsWith('//')))
      ? { ...p, profileImageUri: undefined }
      : p;
    setProfile(cleanProfile);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(cleanProfile));

    // Auto-generate AI profession keywords when degree changes and we don't have any
    if (cleanProfile.currentDegree && !cleanProfile.professionKeywords && !keywordGenLock.current) {
      keywordGenLock.current = true;
      try {
        const result = await aiService.generateProfessionKeywords({
          degree: cleanProfile.currentDegree,
          skills: cleanProfile.skills,
          careerGoals: cleanProfile.careerGoals,
        });
        if (result.keywords && result.keywords.length > 0) {
          const updated = { ...cleanProfile, professionKeywords: result.keywords };
          setProfile(updated);
          await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
        }
      } catch {
        // silently ignore AI failures — keywords will be generated on next save
      } finally {
        keywordGenLock.current = false;
      }
    }
  }, []);

  const addApplication = useCallback(async (data: Omit<Application, 'id' | 'lastModified'>) => {
    const now = new Date().toISOString();
    const app: Application = { ...data, id: genId(), lastModified: now, createdDate: now };
    setApplications(prev => {
      const next = [app, ...prev];
      AsyncStorage.setItem(APPS_KEY, JSON.stringify(next));
      return next;
    });
    return app;
  }, []);

  const updateApplication = useCallback(async (id: string, updates: Partial<Application>) => {
    setApplications(prev => {
      const next = prev.map(a => a.id === id ? { ...a, ...updates, lastModified: new Date().toISOString() } : a);
      AsyncStorage.setItem(APPS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteApplication = useCallback(async (id: string) => {
    setApplications(prev => {
      const next = prev.filter(a => a.id !== id);
      AsyncStorage.setItem(APPS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const addContact = useCallback(async (data: Omit<Contact, 'id' | 'addedDate'>) => {
    const contact: Contact = { ...data, id: genId(), addedDate: new Date().toISOString() };
    setContacts(prev => {
      const next = [contact, ...prev];
      AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
      return next;
    });
    return contact;
  }, []);

  const updateContact = useCallback(async (id: string, updates: Partial<Contact>) => {
    setContacts(prev => {
      const next = prev.map(c => c.id === id ? { ...c, ...updates } : c);
      AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteContact = useCallback(async (id: string) => {
    setContacts(prev => {
      const next = prev.filter(c => c.id !== id);
      AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const saveEvent = useCallback(async (event: Omit<SavedEvent, 'savedAt'>) => {
    const saved: SavedEvent = { ...event, savedAt: new Date().toISOString() };
    setSavedEvents(prev => {
      if (prev.some(e => e.id === event.id)) return prev;
      const next = [saved, ...prev];
      AsyncStorage.setItem(SAVED_EVENTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const unsaveEvent = useCallback(async (id: string) => {
    setSavedEvents(prev => {
      const next = prev.filter(e => e.id !== id);
      AsyncStorage.setItem(SAVED_EVENTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const addDoc = useCallback(async (data: Omit<StoredDocument, 'id' | 'uploadedAt'>) => {
    const doc: StoredDocument = { ...data, id: genId(), uploadedAt: new Date().toISOString() };
    setDocs(prev => {
      const next = [doc, ...prev];
      AsyncStorage.setItem(DOCS_KEY, JSON.stringify(next));
      return next;
    });
    return doc;
  }, []);

  const updateDoc = useCallback(async (id: string, updates: Partial<StoredDocument>) => {
    setDocs(prev => {
      const next = prev.map(d => d.id === id ? { ...d, ...updates } : d);
      AsyncStorage.setItem(DOCS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteDoc = useCallback(async (id: string) => {
    setDocs(prev => {
      const next = prev.filter(d => d.id !== id);
      AsyncStorage.setItem(DOCS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const setThemeOverride = useCallback(async (t: ThemeOverride) => {
    setThemeOverrideState(t);
    await AsyncStorage.setItem(THEME_KEY, t);
  }, []);

  const addLetter = useCallback(async (data: Omit<SavedLetter, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const letter: SavedLetter = { ...data, id: genId(), createdAt: now, updatedAt: now };
    setSavedLetters(prev => {
      const next = [letter, ...prev];
      AsyncStorage.setItem(LETTERS_KEY, JSON.stringify(next));
      return next;
    });
    return letter;
  }, []);

  const updateLetter = useCallback(async (id: string, updates: Partial<SavedLetter>) => {
    setSavedLetters(prev => {
      const next = prev.map(l => l.id === id ? { ...l, ...updates, updatedAt: new Date().toISOString() } : l);
      AsyncStorage.setItem(LETTERS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteLetter = useCallback(async (id: string) => {
    setSavedLetters(prev => {
      const next = prev.filter(l => l.id !== id);
      AsyncStorage.setItem(LETTERS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const addInterview = useCallback(async (data: Omit<InterviewSession, 'id' | 'startedAt'>) => {
    const now = new Date().toISOString();
    const session: InterviewSession = { ...data, id: genId(), startedAt: now };
    setInterviewSessions(prev => {
      const next = [session, ...prev];
      AsyncStorage.setItem(INTERVIEWS_KEY, JSON.stringify(next));
      return next;
    });
    return session;
  }, []);

  const updateInterview = useCallback(async (id: string, updates: Partial<InterviewSession>) => {
    setInterviewSessions(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...updates } : s);
      AsyncStorage.setItem(INTERVIEWS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteInterview = useCallback(async (id: string) => {
    setInterviewSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      AsyncStorage.setItem(INTERVIEWS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const setSearchResults = useCallback(async (r: CompanySearchResult[]) => {
    setSearchResultsState(r);
    await AsyncStorage.setItem(SEARCH_RESULTS_KEY, JSON.stringify(r));
  }, []);

  const setRecentSearches = useCallback(async (r: RecentSearch[]) => {
    setRecentSearchesState(r);
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(r));
  }, []);

  const setDiscoveredEvents = useCallback(async (e: DiscoveredEvent[]) => {
    setDiscoveredEventsState(e);
    await AsyncStorage.setItem(DISCOVERED_EVENTS_KEY, JSON.stringify(e));
  }, []);

  const clearAllData = useCallback(async () => {
    await AsyncStorage.multiRemove([
      PROFILE_KEY, APPS_KEY, CONTACTS_KEY, SAVED_EVENTS_KEY, DOCS_KEY, LETTERS_KEY, INTERVIEWS_KEY,
      SEARCH_RESULTS_KEY, RECENT_SEARCHES_KEY, DISCOVERED_EVENTS_KEY,
    ]);
    setProfile(null);
    setApplications([]);
    setContacts([]);
    setSavedEvents([]);
    setDocs([]);
    setSavedLetters([]);
    setInterviewSessions([]);
    setSearchResultsState([]);
    setRecentSearchesState([]);
    setDiscoveredEventsState([]);
  }, []);

  return (
    <AppContext.Provider value={{
      profile, applications, contacts, savedEvents, docs, savedLetters, interviewSessions,
      searchResults, recentSearches, discoveredEvents,
      isLoaded,
      isAuthenticated,
      themeOverride, setThemeOverride,
      updateProfile,
      signIn, signUp, signOut,
      addApplication, updateApplication, deleteApplication,
      addContact, updateContact, deleteContact,
      saveEvent, unsaveEvent,
      addDoc, updateDoc, deleteDoc,
      addLetter, updateLetter, deleteLetter,
      addInterview, updateInterview, deleteInterview,
      setSearchResults, setRecentSearches, setDiscoveredEvents,
      clearAllData,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
