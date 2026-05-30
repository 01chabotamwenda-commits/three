import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';
import { aiService } from '@/lib/aiService';
import {
  scheduleTimedNotification,
} from '@/utils/notifications';

const ALL_EVENTS_KEY = 'cc_all_events';
const REMINDERS_KEY = 'cc_event_reminders';

interface NetworkingEvent {
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
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const TYPE_META: Record<string, { color: string; bg: string; border: string; label: string }> = {
  'career-expo': { color: '#6366f1', bg: 'rgba(99,102,241,0.14)',  border: 'rgba(99,102,241,0.25)',  label: 'Job Fair' },
  'conference':  { color: '#f59e0b', bg: 'rgba(245,158,11,0.14)',  border: 'rgba(245,158,11,0.25)',  label: 'Conference' },
  'workshop':    { color: '#14b8a6', bg: 'rgba(20,184,166,0.14)',  border: 'rgba(20,184,166,0.25)',  label: 'Workshop' },
  'meetup':      { color: '#14b8a6', bg: 'rgba(20,184,166,0.15)',  border: 'rgba(20,184,166,0.25)',  label: 'Meetup' },
  'trade-fair':  { color: '#a855f7', bg: 'rgba(168,85,247,0.14)', border: 'rgba(168,85,247,0.25)', label: 'Trade Fair' },
  'seminar':     { color: '#3b82f6', bg: 'rgba(59,130,246,0.14)',  border: 'rgba(59,130,246,0.25)',  label: 'Seminar' },
  'hackathon':   { color: '#ef4444', bg: 'rgba(239,68,68,0.14)',   border: 'rgba(239,68,68,0.25)',   label: 'Hackathon' },
  'alumni':      { color: '#ec4899', bg: 'rgba(236,72,153,0.14)',  border: 'rgba(236,72,153,0.25)',  label: 'Alumni' },
  'webinar':     { color: '#06b6d4', bg: 'rgba(6,182,212,0.14)',   border: 'rgba(6,182,212,0.25)',   label: 'Webinar' },
  'panel':       { color: '#8b5cf6', bg: 'rgba(139,92,246,0.14)',  border: 'rgba(139,92,246,0.25)',  label: 'Panel' },
  'open-day':    { color: '#84cc16', bg: 'rgba(132,204,22,0.14)',  border: 'rgba(132,204,22,0.25)',  label: 'Open Day' },
  'pitch':       { color: '#f97316', bg: 'rgba(249,115,22,0.14)',  border: 'rgba(249,115,22,0.25)',  label: 'Pitch Event' },
  'mentorship':  { color: '#d946ef', bg: 'rgba(217,70,239,0.14)',  border: 'rgba(217,70,239,0.25)',  label: 'Mentorship' },
  'association': { color: '#64748b', bg: 'rgba(100,116,139,0.14)', border: 'rgba(100,116,139,0.25)', label: 'Association' },
  'community':   { color: '#22c55e', bg: 'rgba(34,197,94,0.14)',   border: 'rgba(34,197,94,0.25)',   label: 'Community' },
  'awards':      { color: '#eab308', bg: 'rgba(234,179,8,0.14)',   border: 'rgba(234,179,8,0.25)',   label: 'Awards' },
  'training':    { color: '#0ea5e9', bg: 'rgba(14,165,233,0.14)',  border: 'rgba(14,165,233,0.25)',  label: 'Training' },
  'sport':       { color: '#16a34a', bg: 'rgba(22,163,74,0.14)',   border: 'rgba(22,163,74,0.25)',   label: 'Sports' },
  'cultural':    { color: '#e879f9', bg: 'rgba(232,121,249,0.14)', border: 'rgba(232,121,249,0.25)', label: 'Cultural' },
  'other':       { color: '#94a3b8', bg: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.25)', label: 'Other' },
};

const REMINDER_OPTIONS = [
  { key: '2d',  label: '2 days before',   ms: 2 * 24 * 60 * 60 * 1000 },
  { key: '1d',  label: '1 day before',    ms: 24 * 60 * 60 * 1000 },
  { key: '2h',  label: '2 hours before',  ms: 2 * 60 * 60 * 1000 },
  { key: '30m', label: '30 min before',   ms: 30 * 60 * 1000 },
];

const QUICK_PROMPTS = [
  'How should I prepare?',
  'What should I bring?',
  'How does this fit my career?',
  'How do I follow up after?',
  'What questions should I ask?',
];

function cleanAiResponse(text: string): string {
  return text
    .replace(/PARTIAL_PROFILE:[\s\S]*$/m, '')
    .replace(/PROFILE_COMPLETE:[\s\S]*$/m, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .trim();
}

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { profile, docs, savedEvents, saveEvent, unsaveEvent } = useApp();

  const [event, setEvent] = useState<NetworkingEvent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [reminderKey, setReminderKey] = useState<string | null>(null);
  const [reminderSet, setReminderSet] = useState(false);
  const chatRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const topPad = Platform.OS === 'web' ? 16 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 24 : insets.bottom + 16;

  const isSaved = savedEvents.some(e => e.id === id);

  useEffect(() => {
    if (!id) return;
    AsyncStorage.getItem(ALL_EVENTS_KEY).then(raw => {
      if (!raw) return;
      const events = JSON.parse(raw) as NetworkingEvent[];
      const found = events.find(e => e.id === id);
      if (found) setEvent(found);
    }).catch((err) => console.warn('Failed to load event:', err));

    AsyncStorage.getItem(REMINDERS_KEY).then(raw => {
      if (!raw) return;
      const reminders = JSON.parse(raw) as Record<string, string>;
      if (reminders[id]) { setReminderKey(reminders[id]); setReminderSet(true); }
    }).catch((err) => console.warn('Failed to load reminders:', err));
  }, [id]);

  useEffect(() => {
    if (!event) return;
    const intro: ChatMessage = {
      role: 'assistant',
      content: `I can help you make the most of "${event.title}" by ${event.organizer}. Ask me anything — how to prepare, what to bring, who to connect with, or how this event fits your career goals.`,
    };
    setMessages([intro]);
  }, [event?.id]);

  const isPast = event?.dateIso ? new Date(event.dateIso) < new Date() : false;
  const meta = TYPE_META[event?.eventType ?? ''] ?? { color: '#94a3b8', bg: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.25)', label: 'Event' };

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isThinking || !event) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const userMsg: ChatMessage = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsThinking(true);
    setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      const data = await aiService.eventChat({
        message: text,
        history: messages,
        event: {
          title: event.title,
          organizer: event.organizer,
          dateLabel: event.dateLabel,
          location: event.location,
          description: event.description,
          url: event.url,
          tags: event.tags,
          eventType: event.eventType,
          isOnline: event.isOnline,
        },
        userProfile: profile
          ? {
              displayName: profile.displayName !== 'You' ? profile.displayName : '',
              currentDegree: profile.currentDegree,
              institution: profile.institution,
              yearOfStudy: profile.yearOfStudy,
              skills: profile.skills,
              city: profile.city,
              careerGoals: profile.careerGoals,
              preferredIndustries: profile.preferredIndustries,
            }
          : undefined,
      });
      const aiMsg: ChatMessage = {
        role: 'assistant',
        content: cleanAiResponse(data.reply || "I'm having trouble — please try again."),
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: "Couldn't get a response. Check your connection and try again." },
      ]);
    } finally {
      setIsThinking(false);
      setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, isThinking, event, messages, profile, docs]);

  const handleSetReminder = async (optKey: string) => {
    if (!event?.dateIso || !id) return;
    const opt = REMINDER_OPTIONS.find(o => o.key === optKey);
    if (!opt) return;
    const eventDate = new Date(event.dateIso);
    const notifyAt = new Date(eventDate.getTime() - opt.ms);
    if (notifyAt <= new Date()) {
      Alert.alert('Too late', 'This reminder time has already passed for this event.');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const raw = await AsyncStorage.getItem(REMINDERS_KEY).catch(() => null);
    const reminders: Record<string, string> = raw ? JSON.parse(raw) : {};
    reminders[id] = optKey;
    await AsyncStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
    setReminderKey(optKey);
    setReminderSet(true);
    await scheduleTimedNotification({
      title: `📅 ${event.title}`,
      body: `${opt.label.replace(' before', '')} until the event. Time to get ready!`,
      data: { screen: 'contacts', eventId: id },
      triggerDate: notifyAt,
    }).catch((err) => console.warn('Failed to schedule reminder:', err));
    if (Platform.OS !== 'web') {
      Alert.alert('Reminder Set ✓', `You'll be notified ${opt.label}.`);
    }
  };

  const handleToggleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!event) return;
    if (isSaved) {
      unsaveEvent(id);
    } else {
      saveEvent({
        id: event.id, title: event.title, eventType: event.eventType,
        organizer: event.organizer, dateLabel: event.dateLabel,
        dateIso: event.dateIso, location: event.location,
        description: event.description, url: event.url,
        source: event.source, tags: event.tags, isOnline: event.isOnline,
      });
    }
  };

  const s = styles(colors);

  if (!event) {
    return (
      <View style={[s.screen, { paddingTop: topPad + 16 }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[s.emptyText, { marginTop: 16 }]}>Loading event…</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[s.screen, { paddingTop: topPad, paddingBottom: bottomPad }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <View style={[s.typeBadge, { backgroundColor: meta.bg, borderColor: meta.border }]}>
          <View style={[s.typeDot, { backgroundColor: meta.color }]} />
          <Text style={[s.typeBadgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable onPress={handleToggleSave} style={[s.saveBtn, isSaved && { backgroundColor: meta.bg, borderColor: meta.color }]} hitSlop={8}>
          <Feather name="bookmark" size={18} color={isSaved ? meta.color : colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator
        indicatorStyle={colors.isDark ? 'white' : 'black'}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {isPast ? (
          <View style={s.statusBadge}>
            <Feather name="clock" size={12} color={colors.textMuted} />
            <Text style={s.statusBadgeText}>Past Event</Text>
          </View>
        ) : event.dateIso ? (
          <View style={[s.statusBadge, { backgroundColor: colors.successBg, borderColor: colors.successBorder }]}>
            <Feather name="calendar" size={12} color={colors.success} />
            <Text style={[s.statusBadgeText, { color: colors.success }]}>Upcoming</Text>
          </View>
        ) : null}

        <Text style={s.title}>{event.title}</Text>
        <Text style={s.organizer}>{event.organizer}</Text>

        <View style={s.metaCard}>
          <View style={s.metaRow}>
            <Feather name="calendar" size={15} color={colors.primary} />
            <Text style={s.metaText}>{event.dateLabel}</Text>
          </View>
          <View style={s.metaDivider} />
          <View style={s.metaRow}>
            <Feather name={event.isOnline ? 'monitor' : 'map-pin'} size={15} color={colors.primary} />
            <Text style={s.metaText}>{event.location}</Text>
          </View>
          {!!event.source && (
            <>
              <View style={s.metaDivider} />
              <View style={s.metaRow}>
                <Feather name="globe" size={15} color={colors.primary} />
                <Text style={s.metaText}>{event.source}</Text>
              </View>
            </>
          )}
        </View>

        {!!event.description && (
          <View style={s.descCard}>
            <Text style={s.descTitle}>About This Event</Text>
            <Text style={s.descText}>{event.description}</Text>
          </View>
        )}

        {event.tags && event.tags.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
            {event.tags.map(tag => (
              <View key={tag} style={[s.tagPill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
                <Text style={[s.tagText, { color: meta.color }]}>{tag}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        <View style={s.actionRow}>
          <Pressable
            style={[s.actionBtn, { flex: 1, borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => {
              const q = encodeURIComponent(`${event.title} ${event.organizer}`);
              Linking.openURL(`https://www.google.com/search?q=${q}`);
            }}
          >
            <Feather name="search" size={14} color={colors.textSecondary} />
            <Text style={[s.actionBtnText, { color: colors.textSecondary }]}>Search Google</Text>
          </Pressable>
          {!!event.url && (
            <Pressable
              style={[s.actionBtn, { flex: 1, backgroundColor: meta.color }]}
              onPress={() => Linking.openURL(event.url!)}
            >
              <Text style={[s.actionBtnText, { color: '#fff' }]}>Open Event</Text>
              <Feather name="external-link" size={14} color="#fff" />
            </Pressable>
          )}
        </View>

        {!isPast && event.dateIso && (
          <View style={s.reminderCard}>
            <View style={s.reminderHeader}>
              <Feather name="bell" size={14} color={colors.primary} />
              <Text style={s.reminderTitle}>Set a Reminder</Text>
              {reminderSet && (
                <View style={[s.reminderSetBadge, { backgroundColor: colors.successBg, borderColor: colors.successBorder }]}>
                  <Feather name="check" size={10} color={colors.success} />
                  <Text style={[s.reminderSetText, { color: colors.success }]}>Active</Text>
                </View>
              )}
            </View>
            <View style={s.reminderOptions}>
              {REMINDER_OPTIONS.map(opt => (
                <Pressable
                  key={opt.key}
                  style={[
                    s.reminderChip,
                    reminderKey === opt.key && { backgroundColor: colors.indigoBg, borderColor: colors.primary },
                  ]}
                  onPress={() => handleSetReminder(opt.key)}
                >
                  <Text style={[
                    s.reminderChipText,
                    reminderKey === opt.key && { color: colors.primary, fontFamily: 'Inter_600SemiBold' },
                  ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={s.aiSection}>
          <View style={s.aiHeader}>
            <View style={s.aiDotCircle}>
              <Text style={{ fontSize: 9, color: '#fff' }}>✦</Text>
            </View>
            <Text style={s.aiTitle}>Ask AI About This Event</Text>
          </View>

          <ScrollView
            ref={chatRef}
            style={s.chatArea}
            contentContainerStyle={{ padding: 14, gap: 10 }}
            showsVerticalScrollIndicator
            indicatorStyle={colors.isDark ? 'white' : 'black'}
            nestedScrollEnabled
          >
            {messages.map((msg, i) => (
              <View
                key={i}
                style={[
                  s.bubble,
                  msg.role === 'assistant'
                    ? { alignSelf: 'flex-start', backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder }
                    : { alignSelf: 'flex-end', backgroundColor: colors.mutedStrong, borderColor: colors.border },
                ]}
              >
                <Text style={s.bubbleText}>{msg.content}</Text>
              </View>
            ))}
            {isThinking && (
              <View style={[s.bubble, { alignSelf: 'flex-start', backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder }]}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
          </ScrollView>

          {messages.length <= 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ borderTopWidth: 1, borderTopColor: colors.border }}
              contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
            >
              {QUICK_PROMPTS.map(q => (
                <Pressable
                  key={q}
                  style={[s.quickPrompt, { borderColor: colors.indigoBorder, backgroundColor: colors.indigoBg }]}
                  onPress={() => { setInput(q); inputRef.current?.focus(); }}
                >
                  <Text style={[s.quickPromptText, { color: colors.primary }]}>{q}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View>
            <View style={[s.inputRow, { borderTopColor: colors.border }]}>
              <TextInput
                ref={inputRef}
                style={[s.inputField, { borderColor: colors.border, backgroundColor: colors.background, color: colors.text }]}
                placeholder="Ask about this event…"
                placeholderTextColor={colors.textMuted}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={handleSend}
                returnKeyType="send"
                multiline
              />
              <Pressable
                style={[s.sendBtn, (!input.trim() || isThinking) && { opacity: 0.4 }]}
                onPress={handleSend}
                disabled={!input.trim() || isThinking}
              >
                <Feather name="send" size={16} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  typeDot: { width: 6, height: 6, borderRadius: 3 },
  typeBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  saveBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    marginTop: 16, marginBottom: 8,
  },
  statusBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
  title: {
    fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.text,
    marginTop: 10, lineHeight: 30,
  },
  organizer: {
    fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.primary,
    marginTop: 4, marginBottom: 16,
  },
  metaCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 14, padding: 16, marginBottom: 16, gap: 0,
  },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  metaDivider: { height: 1, backgroundColor: colors.border, marginHorizontal: -16 },
  metaText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.text, flex: 1, lineHeight: 20 },
  descCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 14, padding: 16, marginBottom: 16,
  },
  descTitle: {
    fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textMuted,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  descText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.text, lineHeight: 22 },
  tagPill: {
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  tagText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1, borderRadius: 12, paddingVertical: 13,
  },
  actionBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  reminderCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 14, padding: 16, marginBottom: 16,
  },
  reminderHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  reminderTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.text, flex: 1 },
  reminderSetBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
  },
  reminderSetText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  reminderOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reminderChip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  reminderChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.textSecondary },
  aiSection: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.indigoBorder,
    borderRadius: 14, overflow: 'hidden', marginBottom: 16,
  },
  aiHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: 1, borderBottomColor: colors.indigoBorder,
    backgroundColor: colors.indigoBg,
  },
  aiDotCircle: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  aiTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.3 },
  chatArea: { maxHeight: 300 },
  bubble: {
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    maxWidth: '86%',
  },
  bubbleText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.text, lineHeight: 20 },
  quickPrompt: {
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
  },
  quickPromptText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    padding: 12, borderTopWidth: 1,
  },
  inputField: {
    flex: 1, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular',
    maxHeight: 100,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textMuted },
});
