import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp, SavedEvent, UserProfile, StoredDocument } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';
import { aiService } from '@/lib/aiService';
import { getCoverLetterExamples } from '@/utils/docContext';

const STATUS_COLORS: Record<string, string> = {
  Interested: '#6b7280',
  Applied: '#3b82f6',
  Interviewing: '#a855f7',
  Offer: '#14b8a6',
  Rejected: '#ef4444',
  Accepted: '#f59e0b',
};

// ─── Letter Writer ─────────────────────────────────────────────────────────────

type LetterOpType = 'attachment' | 'internship' | 'graduate' | 'job' | 'general';
const LETTER_OP_TYPES: { key: LetterOpType; label: string }[] = [
  { key: 'attachment', label: 'Industrial Attachment' },
  { key: 'internship', label: 'Internship' },
  { key: 'graduate', label: 'Graduate Programme' },
  { key: 'job', label: 'Full-Time Employment' },
  { key: 'general', label: 'General Application' },
];

function LetterWriterModal({
  visible,
  onClose,
  profile,
  docs,
  colors,
}: {
  visible: boolean;
  onClose: () => void;
  profile: UserProfile | null;
  docs: StoredDocument[];
  colors: ReturnType<typeof useColors>;
}) {
  const insets = useSafeAreaInsets();
  const { addLetter } = useApp();
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [opType, setOpType] = useState<LetterOpType>('attachment');
  const [userDraft, setUserDraft] = useState('');
  const [letter, setLetter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setCompany(''); setRole(''); setOpType('attachment');
    setUserDraft(''); setLetter(''); setError('');
  };

  const handleClose = () => { reset(); onClose(); };

  const generate = async () => {
    if (!company.trim()) return;
    setLoading(true); setError(''); setLetter('');
    try {
      const data = await aiService.draftLetter({
          companyName: company.trim(),
          role: role.trim() || 'Relevant Department',
          degree: profile?.currentDegree || '',
          goals: profile?.careerGoals || '',
          institution: profile?.institution || '',
          yearOfStudy: profile?.yearOfStudy || '',
          skills: profile?.skills || '',
          portfolioUrl: profile?.portfolioUrl || '',
          letterType: opType,
          studentName: profile?.displayName && profile.displayName !== 'You' ? profile.displayName : '',
          studentCity: profile?.city || '',
          userDraft: userDraft.trim() || undefined,
          styleExamples: getCoverLetterExamples(docs),
        });
      if (data.letter) {
        setLetter(data.letter);
        await addLetter({
          title: `${company.trim()} \u2013 ${role.trim() || 'Application'}`,
          company: company.trim(),
          role: role.trim() || 'Application',
          letterType: opType,
          content: data.letter,
          status: 'draft',
        });
      } else {
        setError('Could not generate the letter. Please try again.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection error — check your internet and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({ message: letter, title: 'Application Letter' });
    } catch (err) {
      // User cancelled or share failed — no action needed
      console.log('Share cancelled');
    }
  };

  const lw = lwStyles(colors);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[lw.container, { paddingTop: insets.top || 16 }]}>
          {/* Header */}
          <View style={lw.header}>
            <Pressable onPress={handleClose} style={lw.closeBtn} accessibilityLabel="Close letter writer">
              <Feather name="x" size={20} color={colors.textMuted} />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={lw.headerTitle}>Write a Letter</Text>
            </View>
            {letter ? (
              <Pressable onPress={handleShare} style={lw.shareIconBtn} accessibilityLabel="Share letter">
                <Feather name="share-2" size={18} color={colors.primary} />
              </Pressable>
            ) : (
              <View style={{ width: 36 }} />
            )}
          </View>

          <ScrollView
            contentContainerStyle={lw.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            indicatorStyle={colors.isDark ? 'white' : 'black'}
          >
            {/* Profile summary banner */}
            {profile && (profile.displayName !== 'You' || profile.currentDegree) && (
              <View style={lw.profileBanner}>
                <Feather name="user" size={13} color={colors.primary} />
                <Text style={lw.profileText} numberOfLines={2}>
                  {[
                    profile.displayName !== 'You' ? profile.displayName : null,
                    profile.currentDegree,
                    profile.institution,
                    profile.city,
                  ].filter(Boolean).join('  ·  ')}
                </Text>
              </View>
            )}

            {/* Company input */}
            <Text style={lw.label}>COMPANY / ORGANISATION *</Text>
            <TextInput
              value={company}
              onChangeText={setCompany}
              placeholder="e.g. Mopani Copper Mines, ZESCO, MTN Zambia"
              placeholderTextColor={colors.textMuted}
              style={lw.input}
              accessibilityLabel="Company name"
            />

            {/* Role input */}
            <Text style={lw.label}>ROLE / DEPARTMENT (optional)</Text>
            <TextInput
              value={role}
              onChangeText={setRole}
              placeholder="e.g. Electrical Engineering, Finance Department"
              placeholderTextColor={colors.textMuted}
              style={lw.input}
              accessibilityLabel="Role or department"
            />

            {/* Letter type chips */}
            <Text style={lw.label}>TYPE OF OPPORTUNITY</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 8 }}>
              {LETTER_OP_TYPES.map(lt => (
                <Pressable
                  key={lt.key}
                  style={[
                    lw.typeChip,
                    opType === lt.key && lw.typeChipActive,
                  ]}
                  onPress={() => setOpType(lt.key)}
                  accessibilityLabel={lt.label}
                >
                  <Text style={[lw.typeChipText, opType === lt.key && lw.typeChipTextActive]}>
                    {lt.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Optional draft */}
            <Text style={lw.label}>YOUR DRAFT (optional)</Text>
            <TextInput
              value={userDraft}
              onChangeText={setUserDraft}
              placeholder="Paste your own draft here and AI will polish it — or leave blank to generate from scratch."
              placeholderTextColor={colors.textMuted}
              style={[lw.input, lw.draftInput]}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Your draft letter"
            />

            {/* Error */}
            {!!error && (
              <View style={lw.errorBanner}>
                <Feather name="alert-circle" size={14} color={colors.danger} />
                <Text style={lw.errorText}>{error}</Text>
              </View>
            )}

            {/* Generate / Redraft button */}
            {!letter ? (
              <Pressable
                style={[lw.generateBtn, (!company.trim() || loading) && { opacity: 0.55 }]}
                onPress={generate}
                disabled={!company.trim() || loading}
                accessibilityLabel="Generate letter"
                android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
              >
                {loading
                  ? <><ActivityIndicator color="#fff" size="small" /><Text style={lw.generateBtnText}>Drafting your letter…</Text></>
                  : <><Feather name="zap" size={16} color="#fff" /><Text style={lw.generateBtnText}>Generate Letter</Text></>
                }
              </Pressable>
            ) : (
              <>
                <View style={lw.letterBox}>
                  <Text style={lw.letterText}>{letter}</Text>
                </View>
                <View style={lw.letterActions}>
                  <Pressable
                    style={lw.actionBtn}
                    onPress={generate}
                    disabled={loading}
                    accessibilityLabel="Redraft letter"
                  >
                    {loading
                      ? <ActivityIndicator color={colors.primary} size="small" />
                      : <Feather name="refresh-cw" size={15} color={colors.primary} />
                    }
                    <Text style={lw.actionBtnText}>{loading ? 'Redrafting…' : 'Redraft'}</Text>
                  </Pressable>
                  <Pressable
                    style={lw.actionBtn}
                    onPress={() => router.push(`/letter-editor?company=${encodeURIComponent(company.trim())}&role=${encodeURIComponent(role.trim())}&letterType=${encodeURIComponent(opType)}&content=${encodeURIComponent(letter)}`)}
                    accessibilityLabel="Edit and refine letter"
                  >
                    <Feather name="edit-3" size={15} color={colors.primary} />
                    <Text style={lw.actionBtnText}>Edit & Refine</Text>
                  </Pressable>
                  <Pressable style={lw.actionBtn} onPress={handleShare} accessibilityLabel="Share letter">
                    <Feather name="share-2" size={15} color={colors.primary} />
                    <Text style={lw.actionBtnText}>Share</Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const lwStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  shareIconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.indigoBg, borderRadius: 10, borderWidth: 1, borderColor: colors.indigoBorder },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.text, letterSpacing: -0.3 },
  body: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  profileBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.indigoBg, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: colors.indigoBorder, marginBottom: 20,
  },
  profileText: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.primary, lineHeight: 18 },
  label: { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  input: {
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.text,
    borderWidth: 1, borderColor: colors.border, marginBottom: 20,
  },
  draftInput: { height: 100, textAlignVertical: 'top' },
  typeChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  typeChipActive: { borderColor: colors.primary, backgroundColor: colors.indigoBg },
  typeChipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
  typeChipTextActive: { color: colors.primary },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.dangerBg, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: colors.dangerBorder, marginBottom: 16,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16,
  },
  generateBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  letterBox: {
    backgroundColor: colors.card, borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: colors.border, marginBottom: 16,
  },
  letterText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.text, lineHeight: 22 },
  letterActions: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.indigoBg, borderRadius: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: colors.indigoBorder,
  },
  actionBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.primary },
});

function daysUntil(dateStr: string) {
  return (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}

function formatDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-ZM', { day: 'numeric', month: 'short' });
}

function isThisWeek(isoDate: string) {
  return (Date.now() - new Date(isoDate).getTime()) < 7 * 24 * 60 * 60 * 1000;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { profile, applications, contacts, savedEvents, unsaveEvent, docs } = useApp();
  const [showLetterWriter, setShowLetterWriter] = useState(false);

  const stats = useMemo(() => ({
    total: applications.length,
    applied: applications.filter(a => a.status === 'Applied').length,
    interviewing: applications.filter(a => a.status === 'Interviewing').length,
    offers: applications.filter(a => a.status === 'Offer' || a.status === 'Accepted').length,
  }), [applications]);

  const urgentDeadlines = useMemo(() =>
    applications
      .filter(a => a.deadline && daysUntil(a.deadline) <= 7)
      .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
  , [applications]);

  const recentApps = useMemo(() =>
    [...applications]
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
      .slice(0, 4)
  , [applications]);

  const followUpContacts = contacts.filter(c => c.needsFollowUp).length;

  const topPad = Platform.OS === 'web' ? 16 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 72 : insets.bottom + 56;
  const s = styles(colors);

  const statItems = [
    { label: 'Tracked', value: stats.total, icon: 'briefcase' as const, color: colors.primary, bg: colors.indigoBg, border: colors.indigoBorder, route: '/(tabs)/applications' as const },
    { label: 'Applied', value: stats.applied, icon: 'send' as const, color: colors.blue, bg: colors.blueBg, border: colors.blueBorder, route: '/(tabs)/applications' as const },
    { label: 'Interviews', value: stats.interviewing, icon: 'message-circle' as const, color: colors.purple, bg: colors.purpleBg, border: colors.purpleBorder, route: '/(tabs)/applications' as const },
    { label: 'Offers', value: stats.offers, icon: 'check-circle' as const, color: colors.success, bg: colors.successBg, border: colors.successBorder, route: '/(tabs)/applications' as const },
  ];

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={{ paddingTop: topPad + 24, paddingBottom: bottomPad + 24 }}
      showsVerticalScrollIndicator
      indicatorStyle={colors.isDark ? 'white' : 'black'}
    >
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.greeting}>{getGreeting()},</Text>
          <Text style={s.name}>{profile?.displayName?.split(' ')[0] || 'there'}</Text>
          {profile?.currentDegree ? (
            <Text style={s.degreeTag}>{profile.currentDegree}</Text>
          ) : (
            <Pressable
              onPress={() => router.push('/(tabs)/profile')}
              accessibilityLabel="Set your degree in Profile"
              accessibilityRole="button"
            >
              <Text style={[s.degreeTag, { color: colors.warning }]}>
                Tap to set your degree →
              </Text>
            </Pressable>
          )}
        </View>
        <Pressable
          style={s.avatarBtn}
          onPress={() => router.push('/(tabs)/profile')}
          accessibilityLabel="Open profile"
          accessibilityRole="button"
          android_ripple={{ color: colors.muted, borderless: true, radius: 22 }}
        >
          {profile?.profileImageUri ? (
            <Image
              source={{ uri: profile.profileImageUri }}
              style={{ width: 44, height: 44, borderRadius: 22 }}
              contentFit="cover"
            />
          ) : (
            <Text style={s.avatarText}>{profile?.displayName?.[0]?.toUpperCase() || 'Y'}</Text>
          )}
        </Pressable>
      </View>

      {/* Stats Grid */}
      <View style={s.statsGrid}>
        {statItems.map(stat => (
          <Pressable
            key={stat.label}
            style={({ pressed }) => [s.statCard, pressed && { opacity: 0.85 }]}
            onPress={() => router.push(stat.route)}
            accessibilityLabel={`${stat.value} ${stat.label}`}
            accessibilityRole="button"
            android_ripple={{ color: stat.bg, borderless: false }}
          >
            <View style={[s.statIconBg, { backgroundColor: stat.bg, borderColor: stat.border }]}>
              <Feather name={stat.icon} size={16} color={stat.color} />
            </View>
            <Text style={[s.statValue, { color: stat.color }]}>{stat.value}</Text>
            <Text style={s.statLabel}>{stat.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Urgent Deadlines */}
      {urgentDeadlines.length > 0 && (
        <View style={s.urgentCard}>
          <View style={s.urgentHeader}>
            <Feather name="alert-circle" size={14} color={colors.warning} />
            <Text style={s.urgentTitle}>Deadlines This Week</Text>
          </View>
          {urgentDeadlines.map(app => {
            const days = daysUntil(app.deadline!);
            const isPast = days < 0;
            return (
              <Pressable
                key={app.id}
                style={s.urgentRow}
                onPress={() => router.push('/(tabs)/applications')}
                accessibilityRole="button"
                accessibilityLabel={`${app.companyName} deadline ${isPast ? 'passed' : `in ${Math.ceil(days)} days`}`}
                android_ripple={{ color: colors.warningBg }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.urgentCompany}>{app.companyName}</Text>
                  <Text style={s.urgentRole} numberOfLines={1}>{app.role}</Text>
                </View>
                <View style={[s.urgentBadge, { backgroundColor: isPast ? colors.dangerBg : colors.warningBg, borderColor: isPast ? colors.dangerBorder : colors.warningBorder }]}>
                  <Text style={[s.urgentBadgeText, { color: isPast ? colors.danger : colors.warning }]}>
                    {isPast ? 'Passed' : days < 1 ? 'Today' : `${Math.ceil(days)}d`}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Recent Applications */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Recent Applications</Text>
        <Pressable
          onPress={() => router.push('/(tabs)/applications')}
          accessibilityRole="button"
          accessibilityLabel="View all applications"
        >
          <Text style={s.viewAll}>View all</Text>
        </Pressable>
      </View>

      {recentApps.length === 0 ? (
        <View style={s.emptyCard}>
          <View style={s.emptyIconBg}>
            <Feather name="inbox" size={28} color={colors.primary} />
          </View>
          <Text style={s.emptyTitle}>No applications yet</Text>
          <Text style={s.emptySubtitle}>Start tracking your job, internship, and attachment applications here.</Text>
          <Pressable
            style={s.emptyBtn}
            onPress={() => router.push('/(tabs)/applications')}
            accessibilityRole="button"
            accessibilityLabel="Add your first application"
            android_ripple={{ color: colors.indigoBg }}
          >
            <Feather name="plus" size={15} color={colors.primary} />
            <Text style={s.emptyBtnText}>Add your first one</Text>
          </Pressable>
        </View>
      ) : (
        recentApps.map(app => {
          const dotColor = STATUS_COLORS[app.status] || colors.textMuted;
          return (
            <Pressable
              key={app.id}
              style={({ pressed }) => [s.appCard, pressed && { opacity: 0.85 }]}
              onPress={() => router.push('/(tabs)/applications')}
              accessibilityRole="button"
              accessibilityLabel={`${app.companyName}, ${app.role}, status ${app.status}`}
              android_ripple={{ color: colors.muted, borderless: false }}
            >
              <View style={[s.appInitial, { backgroundColor: colors.indigoBg }]}>
                <Text style={[s.appInitialText, { color: colors.primary }]}>{app.companyName[0]?.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.appCompany} numberOfLines={1}>{app.companyName}</Text>
                <Text style={s.appRole} numberOfLines={1}>{app.role}</Text>
              </View>
              <View style={s.appRight}>
                <View style={[s.statusPill, { backgroundColor: `${dotColor}22` }]}>
                  <View style={[s.statusDot, { backgroundColor: dotColor }]} />
                  <Text style={[s.statusText, { color: dotColor }]}>{app.status}</Text>
                </View>
                <Text style={s.appDate}>{formatDate(app.lastModified)}</Text>
              </View>
            </Pressable>
          );
        })
      )}

      {/* Saved Events */}
      {savedEvents.length > 0 && (
        <>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Saved Events</Text>
            <Pressable
              onPress={() => router.push('/(tabs)/contacts')}
              accessibilityRole="button"
              accessibilityLabel="View all networking events"
            >
              <Text style={s.viewAll}>Browse more</Text>
            </Pressable>
          </View>
          {savedEvents.slice(0, 3).map((event: SavedEvent) => {
            const TYPE_COLORS: Record<string, { color: string; bg: string; border: string }> = {
              'career-expo': { color: '#6366f1', bg: 'rgba(99,102,241,0.14)', border: 'rgba(99,102,241,0.25)' },
              'event':       { color: '#3b82f6', bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.25)' },
              'meetup':      { color: '#14b8a6', bg: 'rgba(20,184,166,0.15)', border: 'rgba(20,184,166,0.25)' },
              'conference':  { color: '#f59e0b', bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.25)' },
              'trade-fair':  { color: '#a855f7', bg: 'rgba(168,85,247,0.14)', border: 'rgba(168,85,247,0.25)' },
              'workshop':    { color: '#14b8a6', bg: 'rgba(20,184,166,0.14)', border: 'rgba(20,184,166,0.25)' },
            };
            const meta = TYPE_COLORS[event.eventType] ?? TYPE_COLORS['event'];
            return (
              <View key={event.id} style={s.savedEventCard}>
                <View style={s.savedEventLeft}>
                  <View style={[s.savedEventTypeDot, { backgroundColor: meta.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.savedEventTitle} numberOfLines={1}>{event.title}</Text>
                    <Text style={s.savedEventMeta} numberOfLines={1}>
                      {event.dateLabel ? `${event.dateLabel}  ·  ` : ''}{event.location}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => unsaveEvent(event.id)}
                  style={s.savedEventUnsave}
                  accessibilityLabel="Remove saved event"
                  accessibilityRole="button"
                >
                  <Feather name="bookmark" size={15} color={meta.color} />
                </Pressable>
              </View>
            );
          })}
          {savedEvents.length > 3 && (
            <Pressable
              style={s.savedEventMore}
              onPress={() => router.push('/(tabs)/contacts')}
              accessibilityRole="button"
            >
              <Text style={s.savedEventMoreText}>+{savedEvents.length - 3} more saved events</Text>
              <Feather name="chevron-right" size={14} color={colors.primary} />
            </Pressable>
          )}
        </>
      )}

      {/* Quick Actions */}
      <Text style={[s.sectionTitle, { marginTop: 24, marginBottom: 14 }]}>Quick Actions</Text>
      <View style={s.quickRow}>
        <Pressable
          style={({ pressed }) => [s.quickCard, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
          onPress={() => router.push('/(tabs)/companies')}
          accessibilityRole="button"
          accessibilityLabel="Find opportunities"
        >
          <View style={[s.quickIconBg, { backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder }]}>
            <Feather name="compass" size={22} color={colors.primary} />
          </View>
          <Text style={s.quickTitle}>Find{'\n'}Internships</Text>
          <Text style={s.quickSub}>AI-powered discovery</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [s.quickCard, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
          onPress={() => router.push('/(tabs)/contacts')}
          accessibilityRole="button"
          accessibilityLabel={`Network tab${followUpContacts > 0 ? `, ${followUpContacts} to follow up` : ''}`}
        >
          <View style={[s.quickIconBg, { backgroundColor: colors.blueBg, borderColor: colors.blueBorder }]}>
            <Feather name="radio" size={22} color={colors.blue} />
          </View>
          <Text style={s.quickTitle}>Networking{'\n'}Events</Text>
          <Text style={s.quickSub}>
            {savedEvents.length > 0
              ? `${savedEvents.length} saved event${savedEvents.length !== 1 ? 's' : ''}`
              : 'Find events near you'}
          </Text>
        </Pressable>
      </View>

      {/* Prep row: Letter Writer + Interview Prep */}
      <View style={s.quickRow}>
        <Pressable
          style={({ pressed }) => [s.quickCard, { backgroundColor: 'rgba(20,184,166,0.07)', borderColor: 'rgba(20,184,166,0.22)', transform: [{ scale: pressed ? 0.96 : 1 }] }]}
          onPress={() => setShowLetterWriter(true)}
          accessibilityRole="button"
          accessibilityLabel="Write an application letter"
        >
          <View style={[s.quickIconBg, { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(20,184,166,0.25)' }]}>
            <Feather name="file-text" size={22} color="#14b8a6" />
          </View>
          <Text style={s.quickTitle}>Write a{'\n'}Letter</Text>
          <Text style={s.quickSub}>AI letter writer</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [s.quickCard, { backgroundColor: colors.purpleBg, borderColor: colors.purpleBorder, transform: [{ scale: pressed ? 0.96 : 1 }] }]}
          onPress={() => router.push('/(tabs)/prep')}
          accessibilityRole="button"
          accessibilityLabel="Interview practice and career prep"
        >
          <View style={[s.quickIconBg, { backgroundColor: colors.purpleBg, borderColor: colors.purpleBorder }]}>
            <Feather name="mic" size={22} color={colors.purple} />
          </View>
          <Text style={s.quickTitle}>Interview{'\n'}Prep</Text>
          <Text style={s.quickSub}>AI practice</Text>
        </Pressable>
      </View>

      <View style={{ height: 20 }} />

      <LetterWriterModal
        visible={showLetterWriter}
        onClose={() => setShowLetterWriter(false)}
        profile={profile}
        docs={docs}
        colors={colors}
      />
    </ScrollView>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 34 },
  greeting: { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 2 },
  name: { fontSize: 30, fontFamily: 'Inter_700Bold', color: colors.text, letterSpacing: -0.8, lineHeight: 36 },
  degreeTag: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textMuted, marginTop: 6 },
  avatarBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.indigoBg, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  avatarText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.primary },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 24 },
  statCard: { flex: 1, minWidth: '44%', backgroundColor: colors.card, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: colors.border, gap: 12 },
  statIconBg: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  statValue: { fontSize: 32, fontFamily: 'Inter_700Bold', letterSpacing: -1.5, lineHeight: 36 },
  statLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  goalCard: { backgroundColor: colors.card, borderRadius: 22, padding: 22, marginBottom: 20, borderWidth: 1, borderColor: colors.border },
  goalHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  goalIconBg: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder, alignItems: 'center', justifyContent: 'center' },
  goalTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.text },
  goalSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  goalEditBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted },
  progressTrack: { height: 10, backgroundColor: colors.muted, borderRadius: 5, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: 10, borderRadius: 5 },
  progressLabels: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressPct: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
  goalCompletePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.successBg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: colors.successBorder },
  goalCompleteText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.success },
  goalEditRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.divider },
  goalEditLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textSecondary },
  goalInput: { backgroundColor: colors.muted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text, width: 54, textAlign: 'center', borderWidth: 1, borderColor: colors.borderStrong },
  goalSaveBtn: { backgroundColor: colors.indigoBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.indigoBorder },
  goalSaveBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.primary },
  urgentCard: { backgroundColor: colors.warningBg, borderRadius: 18, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: colors.warningBorder },
  urgentHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  urgentTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.warning, textTransform: 'uppercase', letterSpacing: 0.8 },
  urgentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.warningBorder },
  urgentCompany: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.text },
  urgentRole: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1 },
  urgentBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  urgentBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  sectionTitle: { fontSize: 19, fontFamily: 'Inter_700Bold', color: colors.text, letterSpacing: -0.3 },
  viewAll: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.primary },
  emptyCard: { backgroundColor: colors.card, borderRadius: 20, padding: 32, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  emptyIconBg: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.indigoBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.indigoBorder, marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text },
  emptySubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: colors.primary, borderRadius: 14, marginTop: 4 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  appCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.card, borderRadius: 18, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  appInitial: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  appInitialText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  appCompany: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.text },
  appRole: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  appRight: { alignItems: 'flex-end', gap: 5, flexShrink: 0 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  appDate: { fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.textMuted },
  quickRow: { flexDirection: 'row', gap: 14, marginBottom: 14 },
  quickCard: { flex: 1, backgroundColor: colors.card, borderRadius: 22, padding: 22, borderWidth: 1, borderColor: colors.border, gap: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 10, elevation: 5 },
  quickIconBg: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  quickTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text, lineHeight: 23 },
  quickSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  letterCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: 'rgba(20,184,166,0.07)', borderRadius: 20, padding: 18,
    marginTop: 10, borderWidth: 1, borderColor: 'rgba(20,184,166,0.22)',
  },
  savedEventCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 18, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: colors.border, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 3 },
  savedEventLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  savedEventTypeDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  savedEventTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.text, marginBottom: 3 },
  savedEventMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted },
  savedEventUnsave: { padding: 6 },
  savedEventMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginBottom: 8 },
  savedEventMoreText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.primary },
});
