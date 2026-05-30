import { supabase } from './supabase';
import type {
  Application,
  Contact,
  InterviewSession,
  SavedEvent,
  SavedLetter,
  StoredDocument,
  UserProfile,
} from '@/context/AppContext';

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
}

export interface RecentSearch {
  label: string;
  location: string;
  searchType: string;
  timestamp: number;
}

export type EventType =
  | 'all' | 'career-expo' | 'conference' | 'workshop' | 'meetup'
  | 'trade-fair' | 'seminar' | 'hackathon' | 'alumni' | 'webinar'
  | 'panel' | 'open-day' | 'pitch' | 'mentorship' | 'association'
  | 'community' | 'awards' | 'training' | 'sport' | 'cultural' | 'other';

export interface DiscoveredEvent {
  id: string;
  title: string;
  eventType: EventType;
  organizer: string;
  dateLabel: string;
  dateIso?: string;
  location: string;
  description?: string;
  url?: string;
  source?: string;
  tags?: string[];
  isOnline?: boolean;
  relevanceScore?: number;
  _discoveredAt?: number;
}

export interface CloudData {
  profile: UserProfile | null;
  applications: Application[];
  contacts: Contact[];
  savedEvents: SavedEvent[];
  documents: StoredDocument[];
  letters: SavedLetter[];
  interviewSessions: InterviewSession[];
  searchResults: CompanySearchResult[];
  recentSearches: RecentSearch[];
  discoveredEvents: DiscoveredEvent[];
}

export async function fetchCloudData(userId: string): Promise<CloudData | null> {
  try {
    const { data, error } = await supabase
      .from('cc_user_data')
      .select('profile, applications, contacts, saved_events, documents, letters, interview_sessions, search_results, recent_searches, discovered_events')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      profile: (data.profile as UserProfile) ?? null,
      applications: (data.applications as Application[]) ?? [],
      contacts: (data.contacts as Contact[]) ?? [],
      savedEvents: (data.saved_events as SavedEvent[]) ?? [],
      documents: (data.documents as StoredDocument[]) ?? [],
      letters: (data.letters as SavedLetter[]) ?? [],
      interviewSessions: (data.interview_sessions as InterviewSession[]) ?? [],
      searchResults: (data.search_results as CompanySearchResult[]) ?? [],
      recentSearches: (data.recent_searches as RecentSearch[]) ?? [],
      discoveredEvents: (data.discovered_events as DiscoveredEvent[]) ?? [],
    };
  } catch {
    return null;
  }
}

export async function pushCloudData(userId: string, data: CloudData): Promise<void> {
  try {
    await supabase.from('cc_user_data').upsert(
      {
        user_id: userId,
        profile: data.profile,
        applications: data.applications,
        contacts: data.contacts,
        saved_events: data.savedEvents,
        documents: data.documents,
        letters: data.letters,
        interview_sessions: data.interviewSessions,
        search_results: data.searchResults,
        recent_searches: data.recentSearches,
        discovered_events: data.discoveredEvents,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  } catch {
    // Fire-and-forget — silently ignore network/offline errors
  }
}
