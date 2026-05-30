import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useApp, Contact } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';
import { aiService } from '@/lib/aiService';
import { confirmDialog } from '@/utils/alert';
import { requestNotificationPermissions, scheduleLocalNotification } from '@/utils/notifications';
import { StepProgress, ProgressStep } from '@/components/StepProgress';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NetworkingEvent {
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
  _discoveredAt?: number;
}

type EventType =
  | 'all' | 'career-expo' | 'conference' | 'workshop' | 'meetup'
  | 'trade-fair' | 'seminar' | 'hackathon' | 'alumni' | 'webinar'
  | 'panel' | 'open-day' | 'pitch' | 'mentorship' | 'association'
  | 'community' | 'awards' | 'training' | 'sport' | 'cultural' | 'other';

type SortBy = 'date' | 'location' | 'field' | 'company';
type ContactFilterMode = 'all' | 'warm' | 'followup';
type MainTab = 'events' | 'contacts';

const HOW_MET_OPTIONS = ['Career Expo', 'LinkedIn', 'Referral', 'Cold Outreach', 'University', 'Other'];

const EVENT_FILTERS: { key: EventType; label: string }[] = [
  { key: 'all',         label: 'All'          },
  { key: 'career-expo', label: 'Job Fairs'     },
  { key: 'hackathon',   label: 'Hackathons'    },
  { key: 'webinar',     label: 'Webinars'      },
  { key: 'workshop',    label: 'Workshops'     },
  { key: 'meetup',      label: 'Meetups'       },
  { key: 'conference',  label: 'Conferences'   },
  { key: 'seminar',     label: 'Seminars'      },
  { key: 'mentorship',  label: 'Mentorship'    },
  { key: 'pitch',       label: 'Pitch Events'  },
  { key: 'trade-fair',  label: 'Trade Fairs'   },
  { key: 'panel',       label: 'Panels'        },
  { key: 'training',    label: 'Training'      },
  { key: 'awards',      label: 'Awards'        },
  { key: 'alumni',      label: 'Alumni'        },
];

const SORT_OPTIONS: { key: SortBy; label: string; icon: string }[] = [
  { key: 'date',     label: 'Date (Soonest first)', icon: 'calendar' },
  { key: 'company',  label: 'Organiser',            icon: 'briefcase' },
  { key: 'location', label: 'Location',             icon: 'map-pin' },
  { key: 'field',    label: 'Career Field',         icon: 'tag' },
];

const TYPE_META: Record<string, { color: string; bg: string; border: string; label: string }> = {
  'career-expo': { color: '#6366f1', bg: 'rgba(99,102,241,0.14)',  border: 'rgba(99,102,241,0.3)',  label: 'Job Fair'    },
  'conference':  { color: '#f59e0b', bg: 'rgba(245,158,11,0.14)',  border: 'rgba(245,158,11,0.3)',  label: 'Conference'  },
  'workshop':    { color: '#14b8a6', bg: 'rgba(20,184,166,0.14)',  border: 'rgba(20,184,166,0.3)',  label: 'Workshop'    },
  'meetup':      { color: '#14b8a6', bg: 'rgba(20,184,166,0.15)',  border: 'rgba(20,184,166,0.3)',  label: 'Meetup'      },
  'trade-fair':  { color: '#a855f7', bg: 'rgba(168,85,247,0.14)', border: 'rgba(168,85,247,0.3)', label: 'Trade Fair'  },
  'seminar':     { color: '#3b82f6', bg: 'rgba(59,130,246,0.14)',  border: 'rgba(59,130,246,0.3)',  label: 'Seminar'     },
  'hackathon':   { color: '#ef4444', bg: 'rgba(239,68,68,0.14)',   border: 'rgba(239,68,68,0.3)',   label: 'Hackathon'   },
  'alumni':      { color: '#ec4899', bg: 'rgba(236,72,153,0.14)',  border: 'rgba(236,72,153,0.3)',  label: 'Alumni'      },
  'webinar':     { color: '#06b6d4', bg: 'rgba(6,182,212,0.14)',   border: 'rgba(6,182,212,0.3)',   label: 'Webinar'     },
  'panel':       { color: '#8b5cf6', bg: 'rgba(139,92,246,0.14)',  border: 'rgba(139,92,246,0.3)',  label: 'Panel'       },
  'open-day':    { color: '#84cc16', bg: 'rgba(132,204,22,0.14)',  border: 'rgba(132,204,22,0.3)',  label: 'Open Day'    },
  'pitch':       { color: '#f97316', bg: 'rgba(249,115,22,0.14)',  border: 'rgba(249,115,22,0.3)',  label: 'Pitch Event' },
  'mentorship':  { color: '#d946ef', bg: 'rgba(217,70,239,0.14)',  border: 'rgba(217,70,239,0.3)',  label: 'Mentorship'  },
  'association': { color: '#64748b', bg: 'rgba(100,116,139,0.14)', border: 'rgba(100,116,139,0.3)', label: 'Association' },
  'community':   { color: '#22c55e', bg: 'rgba(34,197,94,0.14)',   border: 'rgba(34,197,94,0.3)',   label: 'Community'   },
  'awards':      { color: '#eab308', bg: 'rgba(234,179,8,0.14)',   border: 'rgba(234,179,8,0.3)',   label: 'Awards'      },
  'training':    { color: '#0ea5e9', bg: 'rgba(14,165,233,0.14)',  border: 'rgba(14,165,233,0.3)',  label: 'Training'    },
  'other':       { color: '#94a3b8', bg: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.3)', label: 'Other'       },
};

const CONTACT_COLORS = ['#6366f1','#14b8a6','#f97316','#3b82f6','#a855f7','#ef4444','#22c55e','#eab308','#ec4899','#06b6d4'];
const LAST_FETCH_KEY = 'cc_last_events_fetch';
const EVENTS_TTL     = 4 * 60 * 60 * 1000;   // 4 hours
const EVENT_MAX_AGE  = 2 * 24 * 60 * 60 * 1000; // 2 days after discovery
const ALL_EVENTS_KEY = 'cc_all_events';

/** Keep events for 2 days after we discovered them, OR if they have a future date keep until 1 day after. */
function pruneOld(events: NetworkingEvent[]): NetworkingEvent[] {
  const now = Date.now();
  const discoveryCutoff = now - EVENT_MAX_AGE;
  return events.filter(e => {
    const discovered = e._discoveredAt ?? now;
    if (discovered > discoveryCutoff) return true; // within 2 days of discovery
    // Event with a future date gets a 1-day grace after the event
    if (e.dateIso) {
      const eventDate = new Date(e.dateIso).getTime();
      if (eventDate > now) return true; // still upcoming
      if (now - eventDate < 24 * 60 * 60 * 1000) return true; // within 1 day after
    }
    return false;
  });
}
function isPast(event: NetworkingEvent): boolean {
  return event.dateIso ? new Date(event.dateIso) < new Date() : false;
}
function withTimeout<T>(p: Promise<T>, ms: number, msg = 'Timeout'): Promise<T> {
  return Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error(msg)), ms))]);
}
async function getLocation(): Promise<{ latitude: number; longitude: number; country: string }> {
  let lat: number, lon: number;
  if (Platform.OS === 'web') {
    const pos = await withTimeout(new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })), 6000);
    lat = pos.coords.latitude; lon = pos.coords.longitude;
  } else {
    const { status } = await withTimeout(Location.requestForegroundPermissionsAsync(), 8000);
    if (status !== 'granted') throw new Error('Location permission denied');
    const loc = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 10000);
    lat = loc.coords.latitude; lon = loc.coords.longitude;
  }
  try {
    const r = await withTimeout(fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, { headers: { 'Accept-Language': 'en' } }), 6000);
    if (r.ok) { const d = await r.json() as any; return { latitude: lat, longitude: lon, country: d.address?.country || 'Zambia' }; }
  } catch { /* fall through */ }
  return { latitude: lat, longitude: lon, country: 'Zambia' };
}
function getContactColor(name: string): string { return CONTACT_COLORS[name.charCodeAt(0) % CONTACT_COLORS.length]; }

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NetworkScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { profile, contacts, savedEvents, saveEvent, unsaveEvent, addContact, updateContact, deleteContact, updateProfile, discoveredEvents: syncedDiscoveredEvents, setDiscoveredEvents: saveDiscoveredEvents } = useApp();
  const router = useRouter();

  const [mainTab, setMainTab] = useState<MainTab>('events');
  const [allEvents, setAllEvents] = useState<NetworkingEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchSteps, setSearchSteps] = useState<ProgressStep[]>([]);
  const [activeFilter, setActiveFilter] = useState<EventType>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countryDraft, setCountryDraft] = useState('Zambia');
  const [showResults, setShowResults] = useState(false);
  const latestProfile = useRef(profile);
  useEffect(() => { latestProfile.current = profile; }, [profile]);

  const [contactFilter, setContactFilter] = useState<ContactFilterMode>('all');
  const [showAddContact, setShowAddContact] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [contactForm, setContactForm] = useState({ name: '', company: '', howWeMet: 'Career Expo', notes: '', isWarmLead: false, needsFollowUp: false });

  const topPad = Platform.OS === 'web' ? 16 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 80 : insets.bottom + 60;
  const s = styles(colors);

  // ── Fetch events ──────────────────────────────────────────────────────────

  const fetchEvents = useCallback(async ({ overrideCountry, refreshing = false }: { overrideCountry?: string; refreshing?: boolean } = {}) => {
    if (refreshing) setIsRefreshing(true); else setIsLoading(true);
    setFetchError(null); setShowResults(false);
    const now = Date.now();
    setSearchSteps([
      { label: 'Detecting your location', status: 'active' },
      { label: 'Searching the web for events', status: 'pending' },
      { label: 'Loading your saved events', status: 'pending' },
      { label: 'Filtering by your career profile', status: 'pending' },
    ]);

    let locData: { latitude: number; longitude: number; country: string };
    try {
      const gps = await getLocation();
      locData = { latitude: gps.latitude, longitude: gps.longitude, country: gps.country || 'Zambia' };
      if (locData.country && locData.country !== latestProfile.current?.city && latestProfile.current) updateProfile({ ...latestProfile.current, city: locData.country });
      setSearchSteps(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'done', detail: `Located: ${locData.country}` } : i === 1 ? { ...s, status: 'active' } : s));
    } catch {
      const fb = overrideCountry || latestProfile.current?.city;
      if (!fb) {
        setSearchSteps(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'failed', detail: 'GPS unavailable — enter your country' } : s));
        setIsLoading(false); setIsRefreshing(false); setCountryDraft('Zambia'); setShowCountryPicker(true); return;
      }
      locData = { latitude: -13.1339, longitude: 27.8493, country: fb };
      setSearchSteps(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'failed', detail: `GPS denied — using ${fb}` } : i === 1 ? { ...s, status: 'active' } : s));
    }

    let freshEvents: NetworkingEvent[] = [];
    let scope = locData.country;
    try {
      const args = (c: string, lat: number, lon: number) => ({
        country: c, latitude: lat, longitude: lon,
        interests: profile?.preferredIndustries || '', degree: profile?.currentDegree || '',
        skills: profile?.skills || '', careerGoals: profile?.careerGoals || '', institution: profile?.institution || '',
      });
      let data = await aiService.networkingEvents(args(scope, locData.latitude, locData.longitude));
      freshEvents = Array.isArray(data) ? (data as NetworkingEvent[]).map(e => ({ ...e, _discoveredAt: e._discoveredAt ?? now })) : Array.isArray((data as any)?.events) ? ((data as any).events as NetworkingEvent[]).map(e => ({ ...e, _discoveredAt: e._discoveredAt ?? now })) : [];
      if (freshEvents.length === 0 && scope.toLowerCase() !== 'zambia') {
        scope = 'Zambia'; data = await aiService.networkingEvents(args('Zambia', -13.1339, 27.8493));
        freshEvents = Array.isArray(data) ? (data as NetworkingEvent[]).map(e => ({ ...e, _discoveredAt: e._discoveredAt ?? now })) : Array.isArray((data as any)?.events) ? ((data as any).events as NetworkingEvent[]).map(e => ({ ...e, _discoveredAt: e._discoveredAt ?? now })) : [];
      }
      setSearchSteps(prev => prev.map((s, i) => i === 1 ? { ...s, status: 'done', detail: `${freshEvents.length} events found in ${scope}` } : i === 2 ? { ...s, status: 'active' } : s));
    } catch (err: any) {
      setSearchSteps(prev => prev.map((s, i) => i === 1 ? { ...s, status: 'failed', detail: err.name === 'AbortError' ? 'Request timed out' : (err.message || 'Search failed') } : s));
      setFetchError(err.message || 'Could not load events'); setIsLoading(false); setIsRefreshing(false); return;
    }

    // Merge with cloud-synced discovered events (from other devices)
    const stored: NetworkingEvent[] = (syncedDiscoveredEvents ?? []).map(e => ({ ...e, _discoveredAt: e._discoveredAt ?? now }));
    setSearchSteps(prev => prev.map((s, i) => i === 2 ? { ...s, status: 'done', detail: `${stored.length} synced events loaded` } : i === 3 ? { ...s, status: 'active' } : s));
    const idMap = new Map(stored.map(e => [e.id, e]));
    freshEvents.forEach(e => idMap.set(e.id, e));
    const merged = pruneOld(Array.from(idMap.values()));
    setAllEvents(merged);
    // Save to cloud sync so events appear on other devices
    saveDiscoveredEvents(merged);
    AsyncStorage.setItem(LAST_FETCH_KEY, String(now)).catch((err) => console.warn('Failed to save last fetch:', err));
    const newCount = freshEvents.filter(e => !stored.some(sv => sv.id === e.id)).length;
    setSearchSteps(prev => prev.map((s, i) => i === 3 ? { ...s, status: 'done', detail: `${merged.length} total · ${newCount} new` } : s));
    if (newCount > 0 && Platform.OS !== 'web') {
      const firstName = profile?.displayName?.split(' ')[0] || 'there';
      scheduleLocalNotification({
        title: `Hey ${firstName}, we found ${newCount} new networking ${newCount === 1 ? 'activity' : 'activities'}`,
        body: `Tap to see events relevant to your ${profile?.currentDegree || 'career'}.`,
        data: { screen: 'contacts', tab: 'events' },
      }).catch((err) => console.warn('Failed to schedule event notification:', err));
    }
    setIsLoading(false); setIsRefreshing(false);
  }, [profile?.city, profile?.currentDegree, profile?.preferredIndustries, profile?.careerGoals, profile?.skills, profile?.institution, updateProfile, syncedDiscoveredEvents, saveDiscoveredEvents]);

  const handleCountryConfirm = async () => {
    const c = countryDraft.trim() || 'Zambia'; setShowCountryPicker(false);
    if (latestProfile.current) await updateProfile({ ...latestProfile.current, city: c });
    fetchEvents({ overrideCountry: c });
  };

  // Sync discovered events from cloud when they change on another device
  useEffect(() => {
    if (syncedDiscoveredEvents && syncedDiscoveredEvents.length > 0) {
      const pruned = pruneOld(syncedDiscoveredEvents as NetworkingEvent[]);
      setAllEvents(pruned);
    }
  }, [syncedDiscoveredEvents]);

  // Clear legacy event caches on first load
  const didClearOld = useRef(false);
  useEffect(() => {
    if (didClearOld.current) return; didClearOld.current = true;
    AsyncStorage.getItem('cc_events_cleared_v2').then(cleared => {
      if (!cleared) {
        AsyncStorage.multiRemove([ALL_EVENTS_KEY, LAST_FETCH_KEY]).catch((err) => console.warn('Failed to clear legacy events:', err));
        AsyncStorage.setItem('cc_events_cleared_v2', '1').catch((err) => console.warn('Failed to set clear flag:', err));
      }
    }).catch((err) => console.warn('Failed to check legacy events:', err));
  }, []);

  const didAutoFetch = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web') requestNotificationPermissions().catch((err) => console.warn('Failed to request notification permissions:', err));
    if (didAutoFetch.current) return; didAutoFetch.current = true;
    AsyncStorage.getItem(LAST_FETCH_KEY).then(stored => { if (Date.now() - (stored ? parseInt(stored, 10) : 0) > EVENTS_TTL) fetchEvents(); }).catch((err) => { console.warn('Failed to read last fetch, fetching anyway:', err); fetchEvents(); });
  }, [fetchEvents]);

  // Periodic background refresh every 4 hours while app is open
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const interval = setInterval(() => {
      AsyncStorage.getItem(LAST_FETCH_KEY).then(stored => {
        const last = stored ? parseInt(stored, 10) : 0;
        if (Date.now() - last > EVENTS_TTL) fetchEvents();
      }).catch((err) => console.warn('Periodic refresh check failed:', err));
    }, EVENTS_TTL);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  // ── Filtering ─────────────────────────────────────────────────────────────

  const displayedEvents = useMemo(() => {
    let list = activeFilter !== 'all' ? allEvents.filter(e => e.eventType === activeFilter) : allEvents;
    const sorted = [...list];
    if (sortBy === 'date') sorted.sort((a, b) => { if (!a.dateIso && !b.dateIso) return 0; if (!a.dateIso) return 1; if (!b.dateIso) return -1; return new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime(); });
    else if (sortBy === 'company') sorted.sort((a, b) => a.organizer.localeCompare(b.organizer));
    else if (sortBy === 'location') sorted.sort((a, b) => a.location.localeCompare(b.location));
    else if (sortBy === 'field') sorted.sort((a, b) => (a.tags?.[0] ?? '').localeCompare(b.tags?.[0] ?? ''));
    return sorted;
  }, [allEvents, activeFilter, sortBy]);

  const filterCounts = useMemo(() => { const c: Partial<Record<EventType, number>> = {}; allEvents.forEach(e => { c[e.eventType] = (c[e.eventType] || 0) + 1; }); return c; }, [allEvents]);

  const isEventSaved = (id: string) => savedEvents.some(e => e.id === id);
  const handleToggleSave = (event: NetworkingEvent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isEventSaved(event.id)) unsaveEvent(event.id);
    else saveEvent({ id: event.id, title: event.title, eventType: event.eventType, organizer: event.organizer, dateLabel: event.dateLabel, dateIso: event.dateIso, location: event.location, description: event.description, url: event.url, source: event.source, tags: event.tags, isOnline: event.isOnline });
  };

  // ── Contacts ─────────────────────────────────────────────────────────────

  const resetForm = () => setContactForm({ name: '', company: '', howWeMet: 'Career Expo', notes: '', isWarmLead: false, needsFollowUp: false });
  const handleAddContact = async () => {
    if (!contactForm.name.trim() || !contactForm.company.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await addContact({ ...contactForm, name: contactForm.name.trim(), company: contactForm.company.trim() });
    resetForm(); setShowAddContact(false);
  };
  const handleDeleteContact = (c: Contact) => {
    confirmDialog(
      'Remove Contact',
      `Remove ${c.name}?`,
      async () => { await deleteContact(c.id); if (selectedContact?.id === c.id) setSelectedContact(null); },
      'Remove',
    );
  };
  const handleToggleField = async (c: Contact, field: 'isWarmLead' | 'needsFollowUp') => {
    Haptics.selectionAsync();
    const update = { [field]: !c[field] };
    await updateContact(c.id, update);
    setSelectedContact(prev => prev?.id === c.id ? { ...prev, ...update } : prev);
  };
  const filteredContacts = useMemo(() => contacts.filter(c => {
    if (contactFilter === 'warm') return c.isWarmLead;
    if (contactFilter === 'followup') return c.needsFollowUp;
    return true;
  }).sort((a, b) => new Date(b.addedDate).getTime() - new Date(a.addedDate).getTime()), [contacts, contactFilter]);
  const followUpCount = contacts.filter(c => c.needsFollowUp).length;

  // ── Render event card (Option A style) ───────────────────────────────────

  const renderEventCard = (event: NetworkingEvent) => {
    const meta = TYPE_META[event.eventType] ?? TYPE_META['other'];
    const saved = isEventSaved(event.id);

    return (
      <Pressable key={event.id} style={({ pressed }) => [s.eventCard, pressed && { opacity: 0.88 }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/event-detail?id=${encodeURIComponent(event.id)}`); }}
        accessibilityRole="button" accessibilityLabel={`${event.title}, ${meta.label}`}
      >
        {/* Left accent strip */}
        <View style={[s.eventAccent, { backgroundColor: meta.color }]} />

        <View style={s.eventBody}>
          {/* Badge row */}
          <View style={s.badgeRow}>
            <View style={[s.typeBadge, { backgroundColor: meta.bg, borderColor: meta.border }]}>
              <Text style={[s.typeBadgeText, { color: meta.color }]}>{meta.label}</Text>
            </View>
            {event.isOnline && (
              <View style={s.onlineBadge}><Text style={s.onlineBadgeText}>Online</Text></View>
            )}
            <Pressable onPress={e => { e.stopPropagation?.(); handleToggleSave(event); }} style={[s.saveBtn, saved && { backgroundColor: meta.bg, borderColor: meta.border }]}>
              <Feather name="bookmark" size={12} color={saved ? meta.color : colors.textMuted} />
            </Pressable>
          </View>

          {/* Title */}
          <Text style={s.eventTitle} numberOfLines={2}>{event.title}</Text>

          {/* Date · Location · Organiser */}
          <View style={s.eventMeta}>
            <Feather name="calendar" size={10} color={colors.textMuted} />
            <Text style={s.eventMetaText}>{event.dateLabel}</Text>
            <Feather name={event.isOnline ? 'monitor' : 'map-pin'} size={10} color={colors.textMuted} />
            <Text style={s.eventMetaText} numberOfLines={1}>{event.location}</Text>
            <Text style={[s.eventMetaText, { marginLeft: 'auto' as any }]} numberOfLines={1}>{event.organizer}</Text>
          </View>

          {/* Actions */}
          <View style={s.eventActions}>
            <Pressable onPress={() => { const q = encodeURIComponent(`${event.title} ${event.organizer}`); Linking.openURL(`https://www.google.com/search?q=${q}`); }} style={s.googleBtn}>
              <Feather name="search" size={10} color={colors.textSecondary} />
              <Text style={s.googleBtnText}>Search</Text>
            </Pressable>
            {!!event.url && (
              <Pressable onPress={() => Linking.openURL(event.url!)} style={[s.openBtn, { backgroundColor: meta.color }]}>
                <Text style={s.openBtnText}>Open</Text>
                <Feather name="external-link" size={10} color="#fff" />
              </Pressable>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[s.screen, { paddingTop: topPad }]}>

      {/* ── Header ──────────────────────────────────────── */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Network</Text>
          <Text style={s.subtitle}>Events · Contacts · Connections</Text>
        </View>
        <Pressable style={s.menuBtn} onPress={() => setShowSortSheet(true)} accessibilityLabel="Sort options">
          <Feather name="menu" size={16} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* ── Main tabs ────────────────────────────────────── */}
      <View style={s.mainTabBar}>
        {(['events', 'contacts'] as MainTab[]).map(tab => (
          <Pressable key={tab} style={[s.mainTab, mainTab === tab && s.mainTabActive]} onPress={() => { setMainTab(tab); Haptics.selectionAsync(); }} accessibilityRole="tab">
            <Text style={[s.mainTabText, mainTab === tab && s.mainTabTextActive]}>
              {tab === 'events' ? 'Events' : 'Contacts'}
            </Text>
            {tab === 'contacts' && followUpCount > 0 && (
              <View style={[s.mainTabBadge, mainTab === tab && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                <Text style={[s.mainTabBadgeText, mainTab === tab && { color: '#fff' }]}>{followUpCount}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>

      {/* ══════════════════ EVENTS TAB ════════════════════ */}
      {mainTab === 'events' && (
        <>
          {/* Filter chips — explicit height to prevent flex expansion */}
          <View style={{ height: 44 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, alignItems: 'center', height: 44 }}>
              {EVENT_FILTERS.filter(f => f.key === 'all' || (filterCounts[f.key] ?? 0) > 0).map(f => {
                const count = f.key === 'all' ? allEvents.length : (filterCounts[f.key] ?? 0);
                const isActive = activeFilter === f.key;
                return (
                  <Pressable key={f.key} onPress={() => { setActiveFilter(f.key); Haptics.selectionAsync(); }} style={[s.filterChip, isActive && s.filterChipActive]} accessibilityRole="button">
                    <Text style={[s.filterChipText, isActive && s.filterChipTextActive]}>{f.label}</Text>
                    {count > 0 && <View style={[s.filterCount, isActive && { backgroundColor: 'rgba(255,255,255,0.25)' }]}><Text style={[s.filterCountText, isActive && { color: '#fff' }]}>{count}</Text></View>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Sort row */}
          {allEvents.length > 0 && (
            <View style={s.sortRow}>
              <Text style={s.sortLabel}>{SORT_OPTIONS.find(o => o.key === sortBy)?.label}</Text>
              <Text style={s.sortCount}>· {displayedEvents.length}</Text>
              <Pressable onPress={() => setShowSortSheet(true)} style={s.sortBtn}>
                <Feather name="sliders" size={12} color={colors.textMuted} />
                <Text style={s.sortBtnText}>Sort</Text>
              </Pressable>
            </View>
          )}

          {/* Events feed */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, paddingTop: 8, gap: 10 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => fetchEvents({ refreshing: true })} tintColor={colors.primary} />}
          >
            {isLoading ? (
              <StepProgress steps={searchSteps} />
            ) : !showResults && searchSteps.length > 0 ? (
              <>
                <StepProgress steps={searchSteps} />
                <Pressable style={[s.showResultsBtn, fetchError ? { backgroundColor: colors.warningBg, borderColor: colors.warningBorder } : { backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder }]}
                  onPress={() => fetchError ? fetchEvents() : setShowResults(true)}>
                  <Feather name={fetchError ? 'refresh-cw' : 'list'} size={14} color={fetchError ? colors.warning : colors.primary} />
                  <Text style={[s.showResultsBtnText, { color: fetchError ? colors.warning : colors.primary }]}>
                    {fetchError ? 'Retry' : displayedEvents.length > 0 ? `Show ${displayedEvents.length} result${displayedEvents.length !== 1 ? 's' : ''}` : 'Show results'}
                  </Text>
                </Pressable>
              </>
            ) : displayedEvents.length === 0 ? (
              <View style={s.emptyState}>
                <View style={[s.emptyIcon, { backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder }]}><Feather name="calendar" size={26} color={colors.primary} /></View>
                <Text style={s.emptyTitle}>{activeFilter !== 'all' ? 'No events in this category' : 'No events yet'}</Text>
                <Text style={s.emptySubtitle}>{activeFilter !== 'all' ? 'Try a different category or pull to refresh.' : 'Pull down to find networking events matched to your profile.'}</Text>
                <Pressable style={s.retryBtn} onPress={() => fetchEvents()}>
                  <Feather name="refresh-cw" size={13} color="#fff" />
                  <Text style={s.retryBtnText}>Find events now</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {displayedEvents.map(renderEventCard)}

                {/* MY CONTACTS mini section */}
                <View style={s.contactsMini}>
                  <View style={s.contactsMiniHeader}>
                    <Text style={s.contactsMiniLabel}>MY CONTACTS</Text>
                    <Pressable onPress={() => { resetForm(); setShowAddContact(true); }}>
                      <Text style={s.contactsMiniAdd}>Add new</Text>
                    </Pressable>
                  </View>
                  {contacts.length === 0 ? (
                    <Pressable style={s.contactsEmptyRow} onPress={() => { resetForm(); setShowAddContact(true); }}>
                      <Feather name="user-plus" size={14} color={colors.textMuted} />
                      <Text style={s.contactsEmptyText}>Add your first contact</Text>
                    </Pressable>
                  ) : contacts.slice(0, 3).map(c => {
                    const avatarColor = getContactColor(c.name);
                    return (
                      <Pressable key={c.id} style={s.contactMiniCard} onPress={() => { setSelectedContact(c); setEditNotes(c.notes || ''); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMainTab('contacts'); }}>
                        <View style={[s.contactMiniAvatar, { backgroundColor: `${avatarColor}20` }]}>
                          <Text style={[s.contactMiniAvatarText, { color: avatarColor }]}>{c.name[0]?.toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.contactMiniName}>{c.name}</Text>
                          <Text style={s.contactMiniRole}>{c.company}</Text>
                        </View>
                        {c.isWarmLead && (
                          <View style={s.warmBadge}><Text style={s.warmBadgeText}>Warm</Text></View>
                        )}
                      </Pressable>
                    );
                  })}
                  {contacts.length > 3 && (
                    <Pressable onPress={() => setMainTab('contacts')} style={s.seeAllBtn}>
                      <Text style={s.seeAllText}>See all {contacts.length} contacts</Text>
                      <Feather name="chevron-right" size={13} color={colors.primary} />
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </ScrollView>
        </>
      )}

      {/* ══════════════════ CONTACTS TAB ══════════════════ */}
      {mainTab === 'contacts' && (
        <>
          {/* Filter pills */}
          <View style={{ height: 44 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center', height: 44 }}>
              {([
                { key: 'all' as ContactFilterMode, label: `All  ${contacts.length}` },
                { key: 'warm' as ContactFilterMode, label: `Warm  ${contacts.filter(c => c.isWarmLead).length}` },
                { key: 'followup' as ContactFilterMode, label: `Follow up  ${followUpCount}` },
              ]).map(f => (
                <Pressable key={f.key} style={[s.filterChip, contactFilter === f.key && s.filterChipActive]} onPress={() => { setContactFilter(f.key); Haptics.selectionAsync(); }}>
                  <Text style={[s.filterChipText, contactFilter === f.key && s.filterChipTextActive]}>{f.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad + 72, paddingTop: 8, gap: 8 }} showsVerticalScrollIndicator={false}>
            {filteredContacts.length === 0 ? (
              <View style={s.emptyState}>
                <View style={[s.emptyIcon, { backgroundColor: colors.blueBg, borderColor: colors.blueBorder }]}><Feather name="users" size={26} color={colors.blue} /></View>
                <Text style={s.emptyTitle}>{contactFilter !== 'all' ? 'No matches' : 'No contacts yet'}</Text>
                <Text style={s.emptySubtitle}>{contactFilter !== 'all' ? 'Try a different filter.' : '80% of jobs are never advertised.\nStart logging your professional connections here.'}</Text>
                {contactFilter === 'all' && (
                  <Pressable style={[s.retryBtn, { backgroundColor: colors.blue }]} onPress={() => { resetForm(); setShowAddContact(true); }}>
                    <Feather name="user-plus" size={13} color="#fff" />
                    <Text style={s.retryBtnText}>Add your first contact</Text>
                  </Pressable>
                )}
              </View>
            ) : filteredContacts.map(contact => {
              const avatarColor = getContactColor(contact.name);
              return (
                <Pressable key={contact.id} style={({ pressed }) => [s.contactCard, pressed && { opacity: 0.88 }]}
                  onPress={() => { setSelectedContact(contact); setEditNotes(contact.notes || ''); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}>
                  <View style={[s.contactAvatar, { backgroundColor: `${avatarColor}20` }]}>
                    <Text style={[s.contactAvatarText, { color: avatarColor }]}>{contact.name[0]?.toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.contactName}>{contact.name}</Text>
                    <Text style={s.contactSub}>{contact.company}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      <View style={s.howMetPill}><Text style={s.howMetText}>{contact.howWeMet}</Text></View>
                      {contact.isWarmLead && <View style={[s.howMetPill, { backgroundColor: colors.amberBg, borderColor: colors.warningBorder }]}><Text style={[s.howMetText, { color: colors.warning }]}>Warm lead</Text></View>}
                      {contact.needsFollowUp && <View style={[s.howMetPill, { backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder }]}><Text style={[s.howMetText, { color: colors.primary }]}>Follow up</Text></View>}
                    </View>
                  </View>
                  <Feather name="chevron-right" size={14} color={colors.textMuted} />
                </Pressable>
              );
            })}
          </ScrollView>

          {/* FAB */}
          <View style={[s.fab, { bottom: bottomPad + 12 }]}>
            <Pressable style={[s.fabInner, { backgroundColor: colors.primary }]} onPress={() => { resetForm(); setShowAddContact(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}>
              <Feather name="user-plus" size={16} color="#fff" />
              <Text style={s.fabText}>Add Contact</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* ── Sort sheet ──────────────────────────────────── */}
      <Modal visible={showSortSheet} animationType="slide" transparent onRequestClose={() => setShowSortSheet(false)}>
        <Pressable style={s.sheetOverlay} onPress={() => setShowSortSheet(false)} />
        <View style={[s.sortSheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>Sort events by</Text>
          {SORT_OPTIONS.map(opt => (
            <Pressable key={opt.key} style={s.sortOption} onPress={() => { setSortBy(opt.key); Haptics.selectionAsync(); setShowSortSheet(false); }}>
              <View style={[s.sortOptionIcon, sortBy === opt.key && { backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder }]}>
                <Feather name={opt.icon as any} size={14} color={sortBy === opt.key ? colors.primary : colors.textMuted} />
              </View>
              <Text style={[s.sortOptionText, sortBy === opt.key && { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{opt.label}</Text>
              {sortBy === opt.key && <Feather name="check" size={14} color={colors.primary} />}
            </Pressable>
          ))}
        </View>
      </Modal>

      {/* ── Contact detail sheet ────────────────────────── */}
      <Modal visible={!!selectedContact} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedContact(null)}>
        {selectedContact && (
          <KeyboardAvoidingView style={[s.sheet, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <Pressable onPress={() => setSelectedContact(null)} style={s.sheetBtn}><Text style={s.sheetCancel}>Done</Text></Pressable>
              <Text style={s.sheetTitleText}>{selectedContact.name}</Text>
              <Pressable onPress={() => handleDeleteContact(selectedContact)} style={s.sheetBtn}><Feather name="trash-2" size={16} color={colors.destructive} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={s.sheetBody} keyboardShouldPersistTaps="handled">
              <View style={s.profileBlock}>
                <View style={[s.profileAvatar, { backgroundColor: `${getContactColor(selectedContact.name)}22` }]}>
                  <Text style={[s.profileAvatarText, { color: getContactColor(selectedContact.name) }]}>{selectedContact.name[0]?.toUpperCase()}</Text>
                </View>
                <View>
                  <Text style={s.profileName}>{selectedContact.name}</Text>
                  <Text style={s.profileCompany}>{selectedContact.company}</Text>
                  <View style={[s.howMetPill, { marginTop: 6, alignSelf: 'flex-start' }]}><Text style={s.howMetText}>Met via {selectedContact.howWeMet}</Text></View>
                </View>
              </View>
              <View style={s.toggleCard}>
                <View style={s.toggleRow}>
                  <View style={[s.toggleIcon, { backgroundColor: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.25)' }]}><Feather name="star" size={13} color="#f59e0b" /></View>
                  <View style={{ flex: 1 }}><Text style={s.toggleLabel}>Warm Lead</Text><Text style={s.toggleHint}>They expressed genuine interest</Text></View>
                  <Switch value={selectedContact.isWarmLead} onValueChange={() => handleToggleField(selectedContact, 'isWarmLead')} trackColor={{ false: colors.muted, true: 'rgba(245,158,11,0.5)' }} thumbColor={selectedContact.isWarmLead ? '#f59e0b' : '#888'} />
                </View>
                <View style={[s.toggleRow, { borderTopWidth: 1, borderTopColor: colors.divider }]}>
                  <View style={[s.toggleIcon, { backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder }]}><Feather name="mail" size={13} color={colors.primary} /></View>
                  <View style={{ flex: 1 }}><Text style={s.toggleLabel}>Needs Follow-Up</Text><Text style={s.toggleHint}>Remind yourself to reach out</Text></View>
                  <Switch value={selectedContact.needsFollowUp} onValueChange={() => handleToggleField(selectedContact, 'needsFollowUp')} trackColor={{ false: colors.muted, true: 'rgba(99,102,241,0.5)' }} thumbColor={selectedContact.needsFollowUp ? colors.primary : '#888'} />
                </View>
              </View>
              <Text style={s.fieldLabel}>Notes</Text>
              <TextInput value={editNotes} onChangeText={setEditNotes} onBlur={() => updateContact(selectedContact.id, { notes: editNotes })} placeholder="What did you discuss?" placeholderTextColor={colors.textMuted} style={[s.field, { minHeight: 100, textAlignVertical: 'top' }]} multiline />
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </Modal>

      {/* ── Add contact sheet ───────────────────────────── */}
      <Modal visible={showAddContact} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddContact(false)}>
        <KeyboardAvoidingView style={[s.sheet, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Pressable onPress={() => setShowAddContact(false)} style={s.sheetBtn}><Text style={s.sheetCancel}>Cancel</Text></Pressable>
            <Text style={s.sheetTitleText}>Add Contact</Text>
            <Pressable onPress={handleAddContact} style={[s.sheetBtn, (!contactForm.name.trim() || !contactForm.company.trim()) && { opacity: 0.4 }]} disabled={!contactForm.name.trim() || !contactForm.company.trim()}><Text style={s.sheetSave}>Save</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={s.sheetBody} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>Name</Text>
            <TextInput value={contactForm.name} onChangeText={v => setContactForm(f => ({ ...f, name: v }))} placeholder="e.g. Thabo Dlamini" placeholderTextColor={colors.textMuted} style={s.field} autoFocus />
            <Text style={s.fieldLabel}>Company / Organisation</Text>
            <TextInput value={contactForm.company} onChangeText={v => setContactForm(f => ({ ...f, company: v }))} placeholder="e.g. ZESCO, Airtel…" placeholderTextColor={colors.textMuted} style={s.field} />
            <Text style={s.fieldLabel}>How did you meet?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 8 }}>
              {HOW_MET_OPTIONS.map(opt => (
                <Pressable key={opt} style={[s.howMetOpt, contactForm.howWeMet === opt && s.howMetOptActive]} onPress={() => setContactForm(f => ({ ...f, howWeMet: opt }))}>
                  <Text style={[s.howMetOptText, contactForm.howWeMet === opt && { color: '#fff' }]}>{opt}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={s.fieldLabel}>Notes (optional)</Text>
            <TextInput value={contactForm.notes} onChangeText={v => setContactForm(f => ({ ...f, notes: v }))} placeholder="What did you discuss?" placeholderTextColor={colors.textMuted} style={[s.field, { minHeight: 80, textAlignVertical: 'top' }]} multiline />
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}><Text style={s.switchLabel}>Warm lead</Text><Text style={s.switchHint}>They showed interest</Text></View>
              <Switch value={contactForm.isWarmLead} onValueChange={v => setContactForm(f => ({ ...f, isWarmLead: v }))} trackColor={{ false: colors.muted, true: 'rgba(245,158,11,0.5)' }} thumbColor={contactForm.isWarmLead ? '#f59e0b' : '#888'} />
            </View>
            <View style={[s.switchRow, { borderTopWidth: 1, borderTopColor: colors.divider }]}>
              <View style={{ flex: 1 }}><Text style={s.switchLabel}>Needs follow-up</Text><Text style={s.switchHint}>Remind yourself to reach out</Text></View>
              <Switch value={contactForm.needsFollowUp} onValueChange={v => setContactForm(f => ({ ...f, needsFollowUp: v }))} trackColor={{ false: colors.muted, true: 'rgba(99,102,241,0.5)' }} thumbColor={contactForm.needsFollowUp ? colors.primary : '#888'} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Country picker ──────────────────────────────── */}
      <Modal visible={showCountryPicker} animationType="fade" transparent onRequestClose={() => setShowCountryPicker(false)}>
        <KeyboardAvoidingView style={s.cpOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.cpDialog}>
            <View style={[s.cpIconBg, { backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder }]}><Feather name="map-pin" size={20} color={colors.primary} /></View>
            <Text style={s.cpTitle}>Where are you?</Text>
            <Text style={s.cpSubtitle}>GPS is unavailable. Enter your country or city to find events.</Text>
            <TextInput value={countryDraft} onChangeText={setCountryDraft} placeholder="e.g. Zambia, Lusaka…" placeholderTextColor={colors.textMuted} style={s.cpInput} autoFocus returnKeyType="done" onSubmitEditing={handleCountryConfirm} />
            <View style={s.cpBtns}>
              <Pressable style={[s.cpBtn, { backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }]} onPress={() => setShowCountryPicker(false)}><Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textMuted }}>Cancel</Text></Pressable>
              <Pressable style={[s.cpBtn, { backgroundColor: colors.primary, flex: 1 }]} onPress={handleCountryConfirm}><Feather name="map-pin" size={13} color="#fff" /><Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' }}>Confirm</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 10 },
  title: { fontSize: 26, fontFamily: 'Inter_800ExtraBold', color: colors.text, letterSpacing: -0.6 },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 2 },
  menuBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },

  // Main tabs (segmented)
  mainTabBar: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 10, backgroundColor: colors.muted, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: colors.border },
  mainTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 9 },
  mainTabActive: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  mainTabText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textMuted },
  mainTabTextActive: { fontFamily: 'Inter_700Bold', color: colors.text },
  mainTabBadge: { backgroundColor: '#ef4444', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1 },
  mainTabBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Filter chips
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
  filterChipTextActive: { color: '#fff' },
  filterCount: { backgroundColor: colors.mutedStrong, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  filterCountText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: colors.textMuted },

  // Sort row
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 18, paddingBottom: 6 },
  sortLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.textMuted },
  sortCount: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted, flex: 1 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
  sortBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },

  // Event card — left accent strip (Option A)
  eventCard: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  eventAccent: { width: 4, flexShrink: 0 },
  eventBody: { flex: 1, padding: 12 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  typeBadge: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  typeBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  onlineBadge: { backgroundColor: 'rgba(34,197,94,0.14)', borderRadius: 6, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)', paddingHorizontal: 7, paddingVertical: 3 },
  onlineBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#22c55e' },
  saveBtn: { marginLeft: 'auto' as any, width: 26, height: 26, borderRadius: 7, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  eventTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.text, lineHeight: 20, marginBottom: 6 },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 8 },
  eventMetaText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted },
  eventActions: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  googleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.muted, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: colors.border },
  googleBtnText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.textSecondary },
  openBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  openBtnText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Show results
  showResultsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, borderRadius: 12, paddingVertical: 13, borderWidth: 1 },
  showResultsBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold' },

  // MY CONTACTS mini section
  contactsMini: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.divider },
  contactsMiniHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  contactsMiniLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textMuted, letterSpacing: 0.6 },
  contactsMiniAdd: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.primary },
  contactsEmptyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: colors.muted, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  contactsEmptyText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textMuted },
  contactMiniCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: '10px 12px' as any, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10 },
  contactMiniAvatar: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  contactMiniAvatarText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  contactMiniName: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.text },
  contactMiniRole: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted },
  warmBadge: { backgroundColor: 'rgba(245,158,11,0.15)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  warmBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#f59e0b' },
  seeAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center', paddingVertical: 8 },
  seeAllText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.primary },

  // Contacts tab
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12 },
  contactAvatar: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  contactAvatarText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  contactName: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.text },
  contactSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 1 },
  howMetPill: { backgroundColor: colors.muted, borderRadius: 6, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 7, paddingVertical: 2 },
  howMetText: { fontSize: 10, fontFamily: 'Inter_500Medium', color: colors.textMuted },

  // FAB
  fab: { position: 'absolute', left: 20, right: 20 },
  fabInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 15 },
  fabText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Empty
  emptyState: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 32, gap: 12 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.text, textAlign: 'center', letterSpacing: -0.3 },
  emptySubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 },
  retryBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  // Sort sheet
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sortSheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingHorizontal: 20, borderWidth: 1, borderColor: colors.border },
  sheetHandle: { width: 36, height: 4, backgroundColor: colors.mutedStrong, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  sheetTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text, marginBottom: 14 },
  sortOption: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  sortOptionIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
  sortOptionText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: colors.textSecondary },

  // Sheets
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  sheetBtn: { minWidth: 52, alignItems: 'center' },
  sheetCancel: { fontSize: 15, fontFamily: 'Inter_500Medium', color: colors.textMuted },
  sheetSave: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary },
  sheetTitleText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.text },
  sheetBody: { padding: 18, gap: 10 },

  // Contact detail
  profileBlock: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  profileAvatar: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  profileName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text },
  profileCompany: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted },
  toggleCard: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  toggleIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  toggleLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.text },
  toggleHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 1 },
  fieldLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textMuted, letterSpacing: 0.5, marginBottom: 2 },
  field: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.text },
  howMetOpt: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
  howMetOptActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  howMetOptText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.textMuted },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 13, padding: 13, borderWidth: 1, borderColor: colors.border },
  switchLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.text },
  switchHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 1 },

  // Country picker
  cpOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  cpDialog: { width: '100%', backgroundColor: colors.card, borderRadius: 22, padding: 24, alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border },
  cpIconBg: { width: 48, height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  cpTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text },
  cpSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted, textAlign: 'center' },
  cpInput: { width: '100%', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.text, backgroundColor: colors.background },
  cpBtns: { flexDirection: 'row', gap: 10, width: '100%' },
  cpBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12 },
});
