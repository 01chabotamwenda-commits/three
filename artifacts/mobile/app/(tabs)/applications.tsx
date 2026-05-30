import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
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
import { useMutation } from '@tanstack/react-query';

import { useApp, Application, ApplicationStatus } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';
import { aiService } from '@/lib/aiService';
import { getCvContent, getCoverLetterExamples } from '@/utils/docContext';
import { confirmDialog } from '@/utils/alert';

const ALL_STATUSES: ApplicationStatus[] = ['Interested', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Accepted'];

const STATUS_DISPLAY: Record<ApplicationStatus, string> = {
  Interested: 'Tracking',
  Applied: 'Applied',
  Interviewing: 'Interviewing',
  Offer: 'Offer Received',
  Rejected: 'Rejected',
  Accepted: 'Accepted',
};

const STATUS_META: Record<ApplicationStatus, { color: string; bg: string; border: string; icon: string }> = {
  Interested: { color: '#6b7280', bg: 'rgba(107,114,128,0.14)', border: 'rgba(107,114,128,0.25)', icon: 'bookmark' },
  Applied: { color: '#3b82f6', bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.25)', icon: 'send' },
  Interviewing: { color: '#a855f7', bg: 'rgba(168,85,247,0.14)', border: 'rgba(168,85,247,0.25)', icon: 'message-circle' },
  Offer: { color: '#14b8a6', bg: 'rgba(20,184,166,0.15)', border: 'rgba(20,184,166,0.25)', icon: 'gift' },
  Rejected: { color: '#ef4444', bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.25)', icon: 'x-circle' },
  Accepted: { color: '#f59e0b', bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.25)', icon: 'check-circle' },
};

const PIPELINE_STAGES: { status: ApplicationStatus; label: string }[] = [
  { status: 'Interested', label: 'Tracking' },
  { status: 'Applied', label: 'Applied' },
  { status: 'Interviewing', label: 'Interviewing' },
  { status: 'Offer', label: 'Offer' },
  { status: 'Accepted', label: 'Accepted' },
];

function daysUntil(d: string) { return (new Date(d).getTime() - Date.now()) / 864e5; }
function daysSince(d: string) { return (Date.now() - new Date(d).getTime()) / 864e5; }

const CAL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CAL_DAYS = ['M','T','W','T','F','S','S'];

function DatePickerField({
  value,
  onChange,
  placeholder = 'Set deadline (optional)',
  colors,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  colors: ReturnType<typeof useColors>;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const parsedValue = value ? (() => { const d = new Date(value); d.setHours(0,0,0,0); return isNaN(d.getTime()) ? null : d; })() : null;
  const [cursor, setCursor] = useState(() => {
    const d = parsedValue ?? today;
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const displayValue = parsedValue
    ? parsedValue.toLocaleDateString('en-ZM', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  return (
    <View style={{ marginBottom: open ? 0 : 18 }}>
      <Pressable
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: colors.muted, borderRadius: 14, padding: 16,
          borderWidth: 1, borderColor: open ? colors.primary : colors.border,
        }}
        onPress={() => { Haptics.selectionAsync(); setOpen(o => !o); }}
        accessibilityLabel="Select deadline date"
        accessibilityRole="button"
      >
        <Feather name="calendar" size={16} color={displayValue ? colors.primary : colors.textMuted} />
        <Text style={{ flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: displayValue ? colors.text : colors.textMuted }}>
          {displayValue || placeholder}
        </Text>
        {displayValue ? (
          <Pressable
            onPress={() => { onChange(''); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            hitSlop={10}
            accessibilityLabel="Clear date"
            accessibilityRole="button"
          >
            <Feather name="x" size={14} color={colors.textMuted} />
          </Pressable>
        ) : null}
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
      </Pressable>
      {open && (
        <View style={{
          backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary,
          borderTopWidth: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14,
          overflow: 'hidden', marginBottom: 18,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
            <Pressable onPress={() => { setCursor(new Date(year, month - 1, 1)); Haptics.selectionAsync(); }} hitSlop={8} accessibilityLabel="Previous month">
              <Feather name="chevron-left" size={18} color={colors.textMuted} />
            </Pressable>
            <Text style={{ flex: 1, textAlign: 'center', fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.text }}>
              {CAL_MONTHS[month]} {year}
            </Text>
            <Pressable onPress={() => { setCursor(new Date(year, month + 1, 1)); Haptics.selectionAsync(); }} hitSlop={8} accessibilityLabel="Next month">
              <Feather name="chevron-right" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', paddingHorizontal: 8, paddingTop: 10, paddingBottom: 4 }}>
            {CAL_DAYS.map((d, i) => (
              <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.textMuted }}>{d}</Text>
            ))}
          </View>
          <View style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
            {Array.from({ length: cells.length / 7 }).map((_, rowI) => (
              <View key={rowI} style={{ flexDirection: 'row' }}>
                {cells.slice(rowI * 7, rowI * 7 + 7).map((day, colI) => {
                  if (!day) return <View key={colI} style={{ flex: 1 }} />;
                  const isSelected = parsedValue && parsedValue.getDate() === day && parsedValue.getMonth() === month && parsedValue.getFullYear() === year;
                  const isToday = today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;
                  const isPast = new Date(year, month, day) < today;
                  return (
                    <Pressable
                      key={colI}
                      style={{ flex: 1, alignItems: 'center', paddingVertical: 5 }}
                      onPress={() => { onChange(new Date(year, month, day).toISOString().split('T')[0]); setOpen(false); Haptics.selectionAsync(); }}
                      accessibilityLabel={`${day} ${CAL_MONTHS[month]} ${year}`}
                    >
                      <View style={[
                        { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
                        isSelected ? { backgroundColor: colors.primary } : null,
                        isToday && !isSelected ? { borderWidth: 1.5, borderColor: colors.primary } : null,
                      ]}>
                        <Text style={[
                          { fontSize: 13, fontFamily: 'Inter_400Regular', color: isPast && !isSelected ? colors.textMuted : colors.text },
                          isSelected ? { color: '#fff', fontFamily: 'Inter_700Bold' } : null,
                          isToday && !isSelected ? { color: colors.primary, fontFamily: 'Inter_600SemiBold' } : null,
                        ]}>
                          {day}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

type DetailTab = 'overview' | 'research' | 'interview' | 'letter';

const DETAIL_TABS: { key: DetailTab; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'list' },
  { key: 'research', label: 'Research', icon: 'search' },
  { key: 'interview', label: 'Interview', icon: 'mic' },
  { key: 'letter', label: 'Letter', icon: 'file-text' },
];

export default function ApplicationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, applications, docs, addApplication, updateApplication, deleteApplication, addLetter } = useApp();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | 'All'>('All');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ companyName: '', role: '', deadline: '', initStatus: 'Interested' as ApplicationStatus, pastedLetter: '', showLetterInput: false });
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [draftLetter, setDraftLetter] = useState('');
  const [editingNotes, setEditingNotes] = useState('');
  const [editingRole, setEditingRole] = useState('');
  const [editingContact, setEditingContact] = useState({ person: '', email: '', phone: '' });
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [aiErrors, setAiErrors] = useState<{ research?: string; interview?: string; letter?: string }>({});

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const app of applications) counts[app.status] = (counts[app.status] ?? 0) + 1;
    return counts;
  }, [applications]);

  const topPad = Platform.OS === 'web' ? 16 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 72 : insets.bottom + 56;

  const filtered = useMemo(() =>
    applications.filter(app => {
      const q = search.toLowerCase();
      return (!q || app.companyName.toLowerCase().includes(q) || app.role.toLowerCase().includes(q))
        && (statusFilter === 'All' || app.status === statusFilter);
    }).sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
  , [applications, search, statusFilter]);

  const draftMutation = useMutation({
    mutationFn: async (app: Application) => {
      if (!profile) throw new Error('no-profile');
      return (await aiService.draftLetter({
          companyName: app.companyName,
          role: app.role,
          degree: profile.currentDegree,
          goals: profile.careerGoals,
          institution: profile.institution,
          yearOfStudy: profile.yearOfStudy,
          skills: profile.skills,
          portfolioUrl: profile.portfolioUrl,
          cvContent: getCvContent(docs),
          styleExamples: getCoverLetterExamples(docs),
        })).letter;
    },
    onSuccess: async (letter, app) => {
      setAiErrors(e => ({ ...e, letter: undefined }));
      setDraftLetter(letter);
      setSelectedApp(prev => prev?.id === app.id ? { ...prev, draftedLetter: letter } : prev);
      await updateApplication(app.id, { draftedLetter: letter });
      await addLetter({
        title: `${app.companyName} \u2013 ${app.role}`,
        company: app.companyName,
        role: app.role,
        letterType: 'general',
        content: letter,
        status: 'draft',
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Could not draft letter. Check your connection.';
      setAiErrors(e => ({ ...e, letter: msg }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const researchMutation = useMutation({
    mutationFn: async (app: Application) => {
      return (await aiService.researchCompany({ companyName: app.companyName })).summary;
    },
    onSuccess: async (summary, app) => {
      setAiErrors(e => ({ ...e, research: undefined }));
      await updateApplication(app.id, { researchSummary: summary });
      setSelectedApp(prev => prev ? { ...prev, researchSummary: summary } : null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => { setAiErrors(e => ({ ...e, research: 'Research failed. Check your connection.' })); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); },
  });

  const interviewMutation = useMutation({
    mutationFn: async (app: Application) => {
      if (!profile) throw new Error('no-profile');
      return aiService.interviewQuestions({
          companyName: app.companyName,
          role: app.role,
          degree: profile.currentDegree,
          goals: profile.careerGoals,
          institution: profile.institution,
          yearOfStudy: profile.yearOfStudy,
          skills: profile.skills,
          researchSummary: app.researchSummary,
          cvContent: getCvContent(docs),
        });
    },
    onSuccess: async (questions, app) => {
      setAiErrors(e => ({ ...e, interview: undefined }));
      await updateApplication(app.id, { interviewQuestions: questions });
      setSelectedApp(prev => prev ? { ...prev, interviewQuestions: questions } : null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => { setAiErrors(e => ({ ...e, interview: 'Could not generate questions. Check your connection.' })); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); },
  });

  const handleAdd = async () => {
    if (!form.companyName.trim() || !form.role.trim() || !profile) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newApp = await addApplication({
      companyName: form.companyName.trim(),
      role: form.role.trim(),
      status: form.initStatus,
      deadline: form.deadline || undefined,
      appliedDate: form.initStatus === 'Applied' ? new Date().toISOString() : undefined,
      draftedLetter: form.pastedLetter.trim() || undefined,
    });
    if (form.pastedLetter.trim()) {
      await addLetter({
        title: `${form.companyName.trim()} \u2013 ${form.role.trim()}`,
        company: form.companyName.trim(),
        role: form.role.trim(),
        letterType: 'general',
        content: form.pastedLetter.trim(),
        status: form.initStatus === 'Applied' ? 'applied' : 'saved',
        linkedApplicationId: newApp.id,
      });
    }
    setForm({ companyName: '', role: '', deadline: '', initStatus: 'Interested', pastedLetter: '', showLetterInput: false });
    setShowAdd(false);
  };

  const handleDelete = (app: Application) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    confirmDialog(
      'Remove Application',
      `Remove ${app.companyName}?`,
      async () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        await deleteApplication(app.id);
        if (selectedApp?.id === app.id) setSelectedApp(null);
      },
      'Remove',
    );
  };

  const handleStatusChange = async (app: Application, status: ApplicationStatus) => {
    Haptics.selectionAsync();
    const updates: Partial<Application> = { status };
    if (status === 'Applied' && !app.appliedDate) updates.appliedDate = new Date().toISOString();
    await updateApplication(app.id, updates);
    setSelectedApp(prev => prev ? { ...prev, status, ...(updates.appliedDate ? { appliedDate: updates.appliedDate } : {}) } : null);
  };

  const handleSaveNotes = async () => {
    if (!selectedApp) return;
    await updateApplication(selectedApp.id, { notes: editingNotes });
    setSelectedApp(prev => prev ? { ...prev, notes: editingNotes } : null);
  };

  const handleSaveRole = async () => {
    if (!selectedApp || !editingRole.trim() || editingRole.trim() === selectedApp.role) return;
    const newRole = editingRole.trim();
    await updateApplication(selectedApp.id, { role: newRole });
    setSelectedApp(prev => prev ? { ...prev, role: newRole } : null);
  };

  const handleSaveContact = async () => {
    if (!selectedApp) return;
    await updateApplication(selectedApp.id, {
      contactPerson: editingContact.person.trim() || undefined,
      contactEmail: editingContact.email.trim() || undefined,
      contactPhone: editingContact.phone.trim() || undefined,
    });
  };

  const openDetail = (app: Application) => {
    setSelectedApp(app);
    setDraftLetter(app.draftedLetter || '');
    setEditingNotes(app.notes || '');
    setEditingRole(app.role);
    setEditingContact({ person: app.contactPerson || '', email: app.contactEmail || '', phone: app.contactPhone || '' });
    setActiveTab('overview');
    setAiErrors({});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const s = styles(colors);

  return (
    <View style={[s.screen, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Applications</Text>
          <Text style={s.subtitle}>{applications.length} application{applications.length !== 1 ? 's' : ''} tracked</Text>
        </View>
        <Pressable
          style={s.addBtn}
          onPress={() => setShowAdd(true)}
          accessibilityLabel="Add new application"
          accessibilityRole="button"
          android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: true, radius: 22 }}
        >
          <Feather name="plus" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Career Prep Tools banner */}
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)/prep'); }}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 14,
          marginHorizontal: 20, marginBottom: 14,
          backgroundColor: colors.purpleBg, borderRadius: 16,
          borderWidth: 1, borderColor: colors.purpleBorder,
          paddingHorizontal: 16, paddingVertical: 13,
        }}
        accessibilityRole="button"
        accessibilityLabel="Career prep tools: interview practice and letter writing"
        android_ripple={{ color: colors.purpleBg }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.purple + '22', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.purpleBorder }}>
          <Feather name="mic" size={18} color={colors.purple} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.text }}>Career Prep Tools</Text>
          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 2 }}>Interview practice · Application letter writer</Text>
        </View>
        <Feather name="chevron-right" size={15} color={colors.purple} />
      </Pressable>

      {/* Search */}
      <View style={s.searchRow}>
        <Feather name="search" size={14} color={colors.textMuted} style={{ marginLeft: 12 }} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Search company or role…"
          placeholderTextColor={colors.textMuted}
          style={s.searchInput}
          accessibilityLabel="Search applications"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} style={s.searchClear} accessibilityLabel="Clear search" accessibilityRole="button">
            <Feather name="x" size={14} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Pipeline overview */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 14, flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 24, gap: 0, alignItems: 'center' }}
      >
        {PIPELINE_STAGES.map((stage, idx) => {
          const count = statusCounts[stage.status] || 0;
          const meta = STATUS_META[stage.status];
          const isActive = count > 0;
          return (
            <React.Fragment key={stage.status}>
              <Pressable
                style={[s.pipelineNode, isActive && { borderColor: meta.border, backgroundColor: meta.bg }]}
                onPress={() => { setStatusFilter(stage.status); Haptics.selectionAsync(); }}
                accessibilityLabel={`${stage.label}: ${count}`}
                accessibilityRole="button"
              >
                <Text style={[s.pipelineCount, { color: isActive ? meta.color : colors.textMuted }]}>{count}</Text>
                <Text style={[s.pipelineLabel, { color: isActive ? meta.color : colors.textMuted }]} numberOfLines={1}>{stage.label}</Text>
              </Pressable>
              {idx < PIPELINE_STAGES.length - 1 && (
                <Feather name="chevron-right" size={13} color={colors.textMuted} style={{ marginHorizontal: 2 }} />
              )}
            </React.Fragment>
          );
        })}
      </ScrollView>

      {/* List */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: bottomPad + 20, paddingTop: 8 }}
        showsVerticalScrollIndicator
        indicatorStyle={colors.isDark ? 'white' : 'black'}
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 ? (
          <View style={s.emptyState}>
            <View style={s.emptyIconBg}>
              <Feather name="inbox" size={28} color={colors.primary} />
            </View>
            <Text style={s.emptyTitle}>
              {search || statusFilter !== 'All' ? 'No matches found' : 'No applications yet'}
            </Text>
            {!search && statusFilter === 'All' && (
              <>
                <Text style={s.emptySubtitle}>Find companies that best suit your career and your goals.</Text>
                <Pressable
                  style={s.emptyBtn}
                  onPress={() => setShowAdd(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Add first application"
                  android_ripple={{ color: colors.indigoBg }}
                >
                  <Feather name="plus" size={15} color="#fff" />
                  <Text style={s.emptyBtnText}>Add your first one</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : (
          filtered.map(app => {
            const dl = app.deadline ? daysUntil(app.deadline) : null;
            const sm = STATUS_META[app.status];
            const needsFollowUp = app.status === 'Applied' && app.appliedDate && daysSince(app.appliedDate) >= 14;
            const hasNotes = !!app.notes?.trim();
            const hasResearch = !!app.researchSummary?.trim();
            return (
              <View key={app.id} style={s.appCard}>
                <Pressable
                  style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.88 }]}
                  onPress={() => openDetail(app)}
                  accessibilityLabel={`${app.companyName}, ${app.role}, ${app.status}`}
                  accessibilityRole="button"
                  android_ripple={{ color: colors.muted, borderless: false }}
                >
                  <View style={s.appCardRow}>
                    <View style={[s.appInitial, { backgroundColor: sm.bg, borderColor: sm.border }]}>
                      <Text style={[s.appInitialText, { color: sm.color }]}>{app.companyName[0]?.toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.appCompany} numberOfLines={1}>{app.companyName}</Text>
                      <Text style={s.appRole} numberOfLines={1}>{app.role}</Text>
                      {/* Badges row */}
                      {(dl !== null || needsFollowUp) && (
                        <View style={s.badgeRow}>
                          {dl !== null && (
                            <View style={[s.badge, { backgroundColor: dl < 0 ? 'rgba(239,68,68,0.14)' : 'rgba(245,158,11,0.14)', borderColor: dl < 0 ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)', borderWidth: 1 }]}>
                              <Feather name="clock" size={10} color={dl < 0 ? '#ef4444' : '#f59e0b'} />
                              <Text style={[s.badgeText, { color: dl < 0 ? '#ef4444' : '#f59e0b' }]}>
                                {dl < 0 ? 'Deadline passed' : dl < 1 ? 'Due today' : `${Math.ceil(dl)}d left`}
                              </Text>
                            </View>
                          )}
                          {needsFollowUp && (
                            <View style={[s.badge, { backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder, borderWidth: 1 }]}>
                              <Feather name="mail" size={10} color={colors.primary} />
                              <Text style={[s.badgeText, { color: colors.primary }]}>Follow up</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                    <View style={s.appCardRight}>
                      <View style={[s.statusPill, { backgroundColor: sm.bg, borderColor: sm.border }]}>
                        <Text style={[s.statusPillText, { color: sm.color }]}>{STATUS_DISPLAY[app.status]}</Text>
                      </View>
                      {/* Indicators */}
                      <View style={s.indicatorRow}>
                        {hasNotes && <View style={[s.indicator, { backgroundColor: colors.blue }]} />}
                        {hasResearch && <View style={[s.indicator, { backgroundColor: colors.success }]} />}
                        {!!app.draftedLetter && <View style={[s.indicator, { backgroundColor: colors.purple }]} />}
                      </View>
                    </View>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => handleDelete(app)}
                  style={({ pressed }) => [s.deleteBtn, { position: 'absolute', right: 12, bottom: 10, backgroundColor: pressed ? colors.dangerBg : 'transparent' }]}
                  accessibilityLabel={`Delete ${app.companyName}`}
                  accessibilityRole="button"
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Feather name="trash-2" size={14} color={colors.textMuted} />
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* ── ADD MODAL ── */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView style={[s.sheet, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Pressable onPress={() => setShowAdd(false)} style={s.sheetDismiss} accessibilityLabel="Close" accessibilityRole="button">
              <Text style={s.sheetDismissText}>Cancel</Text>
            </Pressable>
            <Text style={s.sheetTitle}>New Application</Text>
            <Pressable
              onPress={handleAdd}
              style={[s.sheetAction, (!form.companyName.trim() || !form.role.trim()) && { opacity: 0.4 }]}
              disabled={!form.companyName.trim() || !form.role.trim()}
              accessibilityLabel="Save application"
              accessibilityRole="button"
            >
              <Text style={s.sheetActionText}>Add</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={s.sheetBody} showsVerticalScrollIndicator indicatorStyle={colors.isDark ? 'white' : 'black'} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>Company Name</Text>
            <TextInput
              value={form.companyName} onChangeText={v => setForm(f => ({ ...f, companyName: v }))}
              placeholder="e.g. Telkom, Deloitte, Shoprite"
              placeholderTextColor={colors.textMuted}
              style={s.field} autoFocus returnKeyType="next"
              accessibilityLabel="Company name"
            />
            <Text style={s.fieldLabel}>Role / Position</Text>
            <TextInput
              value={form.role} onChangeText={v => setForm(f => ({ ...f, role: v }))}
              placeholder="e.g. Internship – Software Engineering"
              placeholderTextColor={colors.textMuted}
              style={s.field} returnKeyType="next"
              accessibilityLabel="Role or position"
            />
            <Text style={s.fieldLabel}>Application Deadline <Text style={s.fieldLabelOptional}>(optional)</Text></Text>
            <DatePickerField
              value={form.deadline}
              onChange={v => setForm(f => ({ ...f, deadline: v }))}
              colors={colors}
            />
            <View style={[s.fieldHintRow, { marginBottom: 20 }]}>
              <Feather name="info" size={12} color={colors.textMuted} />
              <Text style={s.fieldHint}>You will see a warning badge 7 days before the deadline.</Text>
            </View>

            <Text style={s.fieldLabel}>Stage</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
              {([
                { status: 'Interested' as ApplicationStatus, label: 'Tracking', sub: "Haven't applied yet" },
                { status: 'Applied' as ApplicationStatus, label: 'Already Applied', sub: 'Sets applied date to today' },
              ]).map(opt => {
                const isOpt = form.initStatus === opt.status;
                const meta = STATUS_META[opt.status];
                return (
                  <Pressable
                    key={opt.status}
                    style={{ flex: 1, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: isOpt ? meta.border : colors.border, backgroundColor: isOpt ? meta.bg : colors.muted }}
                    onPress={() => setForm(f => ({ ...f, initStatus: opt.status }))}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isOpt }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: isOpt ? meta.color : colors.textSecondary }}>{opt.label}</Text>
                    <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: isOpt ? meta.color : colors.textMuted, marginTop: 3 }}>{opt.sub}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, backgroundColor: form.showLetterInput ? colors.indigoBg : colors.muted, borderWidth: 1, borderColor: form.showLetterInput ? colors.indigoBorder : colors.border, marginBottom: 12 }}
              onPress={() => setForm(f => ({ ...f, showLetterInput: !f.showLetterInput, pastedLetter: f.showLetterInput ? '' : f.pastedLetter }))}
              accessibilityRole="button"
              accessibilityLabel="Toggle attach cover letter"
            >
              <Feather name="file-text" size={15} color={form.showLetterInput ? colors.primary : colors.textMuted} />
              <Text style={{ flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: form.showLetterInput ? colors.primary : colors.textSecondary }}>I have a cover letter to attach</Text>
              <Feather name={form.showLetterInput ? 'chevron-up' : 'chevron-down'} size={14} color={form.showLetterInput ? colors.primary : colors.textMuted} />
            </Pressable>
            {form.showLetterInput && (
              <>
                <TextInput
                  value={form.pastedLetter}
                  onChangeText={v => setForm(f => ({ ...f, pastedLetter: v }))}
                  placeholder="Paste your cover letter here…"
                  placeholderTextColor={colors.textMuted}
                  style={[s.field, { minHeight: 160, paddingTop: 14, marginBottom: 6 }]}
                  multiline
                  numberOfLines={8}
                  textAlignVertical="top"
                  accessibilityLabel="Paste cover letter"
                />
                <View style={[s.fieldHintRow, { marginBottom: 20 }]}>
                  <Feather name="save" size={11} color={colors.textMuted} />
                  <Text style={s.fieldHint}>Saved to your letter library and linked to this application.</Text>
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── DETAIL MODAL ── */}
      <Modal visible={!!selectedApp} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedApp(null)}>
        {selectedApp && (() => {
          const sm = STATUS_META[selectedApp.status];
          return (
            <View style={[s.sheet, { backgroundColor: colors.background }]}>
              <View style={s.sheetHandle} />

              {/* Modal header */}
              <View style={s.detailHeader}>
                <View style={[s.detailInitial, { backgroundColor: sm.bg, borderColor: sm.border }]}>
                  <Text style={[s.detailInitialText, { color: sm.color }]}>{selectedApp.companyName[0]?.toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.detailCompany} numberOfLines={1}>{selectedApp.companyName}</Text>
                  <Text style={s.detailRole} numberOfLines={1}>{selectedApp.role}</Text>
                </View>
                <Pressable
                  onPress={() => setSelectedApp(null)}
                  style={s.closeBtn}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                  android_ripple={{ color: colors.muted, borderless: true, radius: 20 }}
                >
                  <Feather name="x" size={20} color={colors.textMuted} />
                </Pressable>
              </View>

              {/* Tab bar */}
              <ScrollView
                horizontal showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0 }}
                contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 12 }}
              >
                {DETAIL_TABS.map(tab => (
                  <Pressable
                    key={tab.key}
                    style={[s.detailTab, activeTab === tab.key && s.detailTabActive]}
                    onPress={() => { setActiveTab(tab.key); Haptics.selectionAsync(); }}
                    accessibilityRole="tab"
                    accessibilityLabel={tab.label}
                    accessibilityState={{ selected: activeTab === tab.key }}
                    android_ripple={{ color: colors.indigoBg }}
                  >
                    <Feather name={tab.icon as any} size={13} color={activeTab === tab.key ? colors.primary : colors.textMuted} />
                    <Text style={[s.detailTabText, activeTab === tab.key && s.detailTabTextActive]}>{tab.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <ScrollView contentContainerStyle={s.sheetBody} showsVerticalScrollIndicator indicatorStyle={colors.isDark ? 'white' : 'black'} keyboardShouldPersistTaps="handled">

                {/* ─ OVERVIEW ─ */}
                {activeTab === 'overview' && (
                  <>
                    {/* ── Pipeline stepper ── */}
                    <Text style={s.sectionHeading}>Stage</Text>
                    {(() => {
                      const PIPELINE = ['Interested', 'Applied', 'Interviewing', 'Offer', 'Accepted'] as ApplicationStatus[];
                      const currentIdx = PIPELINE.indexOf(selectedApp.status);
                      return (
                        <>
                          <View style={s.pipelineStepper}>
                            {PIPELINE_STAGES.map((stage, idx) => {
                              const isPast = currentIdx > idx && selectedApp.status !== 'Rejected';
                              const isActive = selectedApp.status === stage.status;
                              const m = STATUS_META[stage.status];
                              return (
                                <React.Fragment key={stage.status}>
                                  <Pressable
                                    style={{ alignItems: 'center', flex: 1 }}
                                    onPress={() => { handleStatusChange(selectedApp, stage.status); Haptics.selectionAsync(); }}
                                    accessibilityRole="radio"
                                    accessibilityLabel={stage.label}
                                    accessibilityState={{ checked: isActive }}
                                  >
                                    <View style={[
                                      s.stepDot,
                                      isActive ? { backgroundColor: m.color, borderColor: m.color } : null,
                                      isPast ? { backgroundColor: m.bg, borderColor: m.color } : null,
                                    ]}>
                                      {isActive && <Feather name={m.icon as any} size={11} color="#fff" />}
                                      {isPast && <Feather name="check" size={10} color={m.color} />}
                                    </View>
                                    <Text style={[
                                      s.stepLabel,
                                      isActive ? { color: m.color, fontFamily: 'Inter_700Bold' } : null,
                                      isPast ? { color: m.color } : null,
                                    ]} numberOfLines={1}>{stage.label}</Text>
                                  </Pressable>
                                  {idx < PIPELINE_STAGES.length - 1 && (
                                    <View style={[s.stepLine, isPast ? { backgroundColor: m.color + '55' } : null]} />
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </View>
                          <Pressable
                            style={[
                              s.rejectedBtn,
                              selectedApp.status === 'Rejected' ? { borderColor: STATUS_META.Rejected.border, backgroundColor: STATUS_META.Rejected.bg } : null,
                            ]}
                            onPress={() => { handleStatusChange(selectedApp, 'Rejected'); Haptics.selectionAsync(); }}
                            accessibilityRole="radio"
                            accessibilityLabel="Rejected"
                            accessibilityState={{ checked: selectedApp.status === 'Rejected' }}
                          >
                            <Feather name="x-circle" size={13} color={selectedApp.status === 'Rejected' ? STATUS_META.Rejected.color : colors.textMuted} />
                            <Text style={[s.rejectedBtnText, selectedApp.status === 'Rejected' ? { color: STATUS_META.Rejected.color } : null]}>
                              Mark as Rejected
                            </Text>
                          </Pressable>
                        </>
                      );
                    })()}

                    {/* Applied date / follow-up */}
                    {selectedApp.appliedDate && (
                      <View style={[s.infoChip, daysSince(selectedApp.appliedDate) >= 14 && { borderColor: colors.indigoBorder, backgroundColor: colors.indigoBg }]}>
                        <Feather name="send" size={13} color={daysSince(selectedApp.appliedDate) >= 14 ? colors.primary : colors.textMuted} />
                        <Text style={[s.infoChipText, daysSince(selectedApp.appliedDate) >= 14 && { color: colors.primary }]}>
                          Applied {Math.round(daysSince(selectedApp.appliedDate))} days ago{daysSince(selectedApp.appliedDate) >= 14 ? ' — send a follow-up email!' : ''}
                        </Text>
                      </View>
                    )}

                    {/* ── Role (editable) ── */}
                    <Text style={[s.sectionHeading, { marginTop: 20 }]}>Role / Position</Text>
                    <TextInput
                      value={editingRole}
                      onChangeText={setEditingRole}
                      onBlur={handleSaveRole}
                      placeholder="e.g. Industrial Attachment – Software Engineering"
                      placeholderTextColor={colors.textMuted}
                      style={s.field}
                      returnKeyType="done"
                      accessibilityLabel="Role or position"
                    />

                    {/* ── Deadline ── */}
                    <Text style={[s.sectionHeading, { marginTop: 4 }]}>Deadline</Text>
                    <DatePickerField
                      value={selectedApp.deadline ?? ''}
                      onChange={async (iso) => {
                        await updateApplication(selectedApp.id, { deadline: iso || undefined });
                        setSelectedApp(prev => prev ? { ...prev, deadline: iso || undefined } : null);
                      }}
                      placeholder="No deadline set"
                      colors={colors}
                    />

                    {/* ── Contact / Recruiter ── */}
                    <Text style={[s.sectionHeading, { marginTop: 4 }]}>
                      Contact <Text style={s.fieldLabelOptional}>(optional)</Text>
                    </Text>
                    <TextInput
                      value={editingContact.person}
                      onChangeText={v => setEditingContact(c => ({ ...c, person: v }))}
                      onBlur={handleSaveContact}
                      placeholder="Recruiter or contact name"
                      placeholderTextColor={colors.textMuted}
                      style={[s.field, { marginBottom: 8 }]}
                      returnKeyType="next"
                      accessibilityLabel="Contact person"
                    />
                    <TextInput
                      value={editingContact.email}
                      onChangeText={v => setEditingContact(c => ({ ...c, email: v }))}
                      onBlur={handleSaveContact}
                      placeholder="Contact email"
                      placeholderTextColor={colors.textMuted}
                      style={[s.field, { marginBottom: 8 }]}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      returnKeyType="next"
                      accessibilityLabel="Contact email"
                    />
                    <TextInput
                      value={editingContact.phone}
                      onChangeText={v => setEditingContact(c => ({ ...c, phone: v }))}
                      onBlur={handleSaveContact}
                      placeholder="Contact phone"
                      placeholderTextColor={colors.textMuted}
                      style={[s.field, { marginBottom: 18 }]}
                      keyboardType="phone-pad"
                      returnKeyType="done"
                      accessibilityLabel="Contact phone"
                    />

                    {/* ── Notes ── */}
                    <Text style={[s.sectionHeading, { marginTop: 4 }]}>Notes</Text>
                    <TextInput
                      value={editingNotes}
                      onChangeText={setEditingNotes}
                      onBlur={handleSaveNotes}
                      placeholder="Paste research notes, recruiter details, interview tips…"
                      placeholderTextColor={colors.textMuted}
                      style={[s.field, s.notesField]}
                      multiline numberOfLines={5} textAlignVertical="top"
                      accessibilityLabel="Application notes"
                    />
                    <View style={s.fieldHintRow}>
                      <Feather name="save" size={11} color={colors.textMuted} />
                      <Text style={s.fieldHint}>All fields save automatically when you leave them.</Text>
                    </View>

                    {/* ── Progress Checklist ── */}
                    <Text style={[s.sectionHeading, { marginTop: 20 }]}>Progress</Text>
                    <View style={s.progressGrid}>
                      {([
                        { key: 'research', label: 'Research', done: !!selectedApp.researchSummary?.trim(), icon: 'search', tab: 'research' as DetailTab, actionLabel: 'Run AI Research' },
                        { key: 'letter', label: 'Cover Letter', done: !!selectedApp.draftedLetter?.trim(), icon: 'file-text', tab: 'letter' as DetailTab, actionLabel: 'Draft with AI' },
                        { key: 'interview', label: 'Interview Prep', done: !!selectedApp.interviewQuestions, icon: 'mic', tab: 'interview' as DetailTab, actionLabel: 'Generate Questions' },
                      ] as const).map(item => (
                        <Pressable
                          key={item.key}
                          style={[
                            s.progressCard,
                            item.done
                              ? { borderColor: colors.success + '55', backgroundColor: colors.success + '10' }
                              : { borderColor: colors.border, backgroundColor: colors.muted },
                          ]}
                          onPress={() => { setActiveTab(item.tab); Haptics.selectionAsync(); }}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.label}: ${item.done ? 'Done' : 'Pending'}, tap to open`}
                          android_ripple={{ color: item.done ? colors.success + '22' : colors.indigoBg }}
                        >
                          <View style={[
                            s.progressIconBg,
                            { backgroundColor: item.done ? colors.success + '22' : colors.indigoBg },
                          ]}>
                            <Feather name={item.icon as any} size={15} color={item.done ? colors.success : colors.primary} />
                          </View>
                          <Text style={s.progressLabel}>{item.label}</Text>
                          <View style={[
                            s.progressStatusBadge,
                            {
                              backgroundColor: item.done ? colors.success + '18' : colors.indigoBg,
                              borderColor: item.done ? colors.success + '55' : colors.indigoBorder,
                            },
                          ]}>
                            <Feather name={item.done ? 'check' : 'chevron-right'} size={10} color={item.done ? colors.success : colors.primary} />
                            <Text style={[s.progressStatusText, { color: item.done ? colors.success : colors.primary }]}>
                              {item.done ? 'Done' : item.actionLabel}
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}

                {/* ─ RESEARCH ─ */}
                {activeTab === 'research' && (
                  <>
                    <Text style={s.sectionHeading}>Company Research</Text>
                    <Text style={s.sectionSubtitle}>AI-generated overview of {selectedApp.companyName} — including their programmes, open roles, and interview tips.</Text>
                    {aiErrors.research && !researchMutation.isPending && (
                      <View style={s.errorBanner}>
                        <Feather name="wifi-off" size={14} color={colors.danger} />
                        <Text style={s.errorBannerText}>{aiErrors.research}</Text>
                        <Pressable onPress={() => { setAiErrors(e => ({ ...e, research: undefined })); researchMutation.mutate(selectedApp); }} style={s.retryBtn} accessibilityRole="button" accessibilityLabel="Retry research">
                          <Text style={s.retryBtnText}>Retry</Text>
                        </Pressable>
                      </View>
                    )}
                    {selectedApp.researchSummary ? (
                      <>
                        <View style={s.contentBox}>
                          <Text style={s.contentText}>{selectedApp.researchSummary}</Text>
                        </View>
                        <Pressable
                          style={s.secondaryBtn}
                          onPress={() => researchMutation.mutate(selectedApp)}
                          disabled={researchMutation.isPending}
                          accessibilityRole="button"
                          accessibilityLabel="Refresh research"
                          android_ripple={{ color: colors.indigoBg }}
                        >
                          {researchMutation.isPending ? <ActivityIndicator color={colors.primary} size="small" /> : <Feather name="refresh-cw" size={15} color={colors.primary} />}
                          <Text style={s.secondaryBtnText}>{researchMutation.isPending ? 'Refreshing…' : 'Refresh Research'}</Text>
                        </Pressable>
                      </>
                    ) : (
                      <Pressable
                        style={s.primaryBtn}
                        onPress={() => researchMutation.mutate(selectedApp)}
                        disabled={researchMutation.isPending}
                        accessibilityRole="button"
                        accessibilityLabel="Research company with AI"
                        android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
                      >
                        {researchMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="search" size={16} color="#fff" />}
                        <Text style={s.primaryBtnText}>{researchMutation.isPending ? 'Researching…' : 'Research with AI'}</Text>
                      </Pressable>
                    )}
                  </>
                )}

                {/* ─ INTERVIEW ─ */}
                {activeTab === 'interview' && (
                  <>
                    <Text style={s.sectionHeading}>Interview Prep</Text>
                    <Text style={s.sectionSubtitle}>15 personalised questions for your interview at {selectedApp.companyName}.</Text>
                    {aiErrors.interview && !interviewMutation.isPending && (
                      <View style={s.errorBanner}>
                        <Feather name="wifi-off" size={14} color={colors.danger} />
                        <Text style={s.errorBannerText}>{aiErrors.interview}</Text>
                        <Pressable onPress={() => { setAiErrors(e => ({ ...e, interview: undefined })); interviewMutation.mutate(selectedApp); }} style={s.retryBtn} accessibilityRole="button" accessibilityLabel="Retry interview questions">
                          <Text style={s.retryBtnText}>Retry</Text>
                        </Pressable>
                      </View>
                    )}
                    {selectedApp.interviewQuestions ? (
                      <>
                        {[
                          { key: 'personal', label: 'Personal Questions', color: colors.primary, border: colors.indigoBorder, bg: colors.indigoBg },
                          { key: 'company', label: 'About the Company', color: colors.blue, border: colors.blueBorder, bg: colors.blueBg },
                          { key: 'experience', label: 'Experience & Skills', color: colors.purple, border: colors.purpleBorder, bg: colors.purpleBg },
                        ].map(({ key, label, color, border, bg }) => {
                          const qs = selectedApp.interviewQuestions![key as keyof typeof selectedApp.interviewQuestions] as string[];
                          return (
                            <View key={key} style={[s.questionGroup, { borderColor: border, backgroundColor: bg }]}>
                              <Text style={[s.questionGroupLabel, { color }]}>{label}</Text>
                              {qs.map((q, i) => (
                                <View key={i} style={s.questionRow}>
                                  <Text style={[s.questionNum, { color }]}>{i + 1}.</Text>
                                  <Text style={s.questionText}>{q}</Text>
                                </View>
                              ))}
                            </View>
                          );
                        })}
                        <Pressable
                          style={s.secondaryBtn}
                          onPress={() => interviewMutation.mutate(selectedApp)}
                          disabled={interviewMutation.isPending}
                          accessibilityRole="button"
                          accessibilityLabel="Regenerate interview questions"
                          android_ripple={{ color: colors.indigoBg }}
                        >
                          {interviewMutation.isPending ? <ActivityIndicator color={colors.primary} size="small" /> : <Feather name="refresh-cw" size={15} color={colors.primary} />}
                          <Text style={s.secondaryBtnText}>{interviewMutation.isPending ? 'Regenerating…' : 'Regenerate Questions'}</Text>
                        </Pressable>
                      </>
                    ) : (
                      <Pressable
                        style={s.primaryBtn}
                        onPress={() => interviewMutation.mutate(selectedApp)}
                        disabled={interviewMutation.isPending}
                        accessibilityRole="button"
                        accessibilityLabel="Generate interview questions"
                        android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
                      >
                        {interviewMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="mic" size={16} color="#fff" />}
                        <Text style={s.primaryBtnText}>{interviewMutation.isPending ? 'Generating…' : 'Generate Questions'}</Text>
                      </Pressable>
                    )}
                  </>
                )}

                {/* ─ LETTER ─ */}
                {activeTab === 'letter' && (
                  <>
                    <Text style={s.sectionHeading}>Cover Letter</Text>
                    <Text style={s.sectionSubtitle}>AI-generated, tailored to {selectedApp.companyName} using your profile and degree.</Text>
                    {aiErrors.letter && !draftMutation.isPending && (
                      <View style={s.errorBanner}>
                        <Feather name="wifi-off" size={14} color={colors.danger} />
                        <Text style={s.errorBannerText}>{aiErrors.letter}</Text>
                        <Pressable onPress={() => { setAiErrors(e => ({ ...e, letter: undefined })); draftMutation.mutate(selectedApp); }} style={s.retryBtn} accessibilityRole="button" accessibilityLabel="Retry cover letter">
                          <Text style={s.retryBtnText}>Retry</Text>
                        </Pressable>
                      </View>
                    )}
                    {draftLetter ? (
                      <>
                        <View style={s.contentBox}>
                          <Text style={s.contentText}>{draftLetter}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                          <Pressable
                            style={[s.secondaryBtn, { flex: 1 }]}
                            onPress={async () => {
                              try {
                                await Share.share({ message: draftLetter, title: 'Cover Letter' });
                              } catch (err) {
                                console.log('Share cancelled');
                              }
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Share cover letter"
                            android_ripple={{ color: colors.indigoBg }}
                          >
                            <Feather name="share-2" size={15} color={colors.primary} />
                            <Text style={s.secondaryBtnText}>Share</Text>
                          </Pressable>
                          <Pressable
                            style={[s.secondaryBtn, { flex: 1 }]}
                            onPress={() => router.push(`/letter-editor?company=${encodeURIComponent(selectedApp!.companyName)}&role=${encodeURIComponent(selectedApp!.role)}&letterType=general&content=${encodeURIComponent(draftLetter)}`)}
                            accessibilityRole="button"
                            accessibilityLabel="Edit and refine cover letter"
                            android_ripple={{ color: colors.indigoBg }}
                          >
                            <Feather name="edit-3" size={15} color={colors.primary} />
                            <Text style={s.secondaryBtnText}>Edit & Refine</Text>
                          </Pressable>
                          <Pressable
                            style={[s.secondaryBtn, { flex: 1 }]}
                            onPress={() => draftMutation.mutate(selectedApp)}
                            disabled={draftMutation.isPending}
                            accessibilityRole="button"
                            accessibilityLabel="Redraft cover letter"
                            android_ripple={{ color: colors.indigoBg }}
                          >
                            {draftMutation.isPending ? <ActivityIndicator color={colors.primary} size="small" /> : <Feather name="refresh-cw" size={15} color={colors.primary} />}
                            <Text style={s.secondaryBtnText}>{draftMutation.isPending ? 'Drafting\u2026' : 'Redraft'}</Text>
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <Pressable
                        style={s.primaryBtn}
                        onPress={() => draftMutation.mutate(selectedApp)}
                        disabled={draftMutation.isPending}
                        accessibilityRole="button"
                        accessibilityLabel="Draft cover letter with AI"
                        android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
                      >
                        {draftMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="zap" size={16} color="#fff" />}
                        <Text style={s.primaryBtnText}>{draftMutation.isPending ? 'Drafting…' : 'Draft with AI'}</Text>
                      </Pressable>
                    )}
                  </>
                )}
              </ScrollView>
            </View>
          );
        })()}
      </Modal>
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 20 },
  title: { fontSize: 30, fontFamily: 'Inter_700Bold', color: colors.text, letterSpacing: -0.8 },
  subtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 2 },
  addBtn: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginHorizontal: 24, marginBottom: 10, height: 40 },
  searchInput: { flex: 1, paddingVertical: 8, paddingHorizontal: 8, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.text },
  searchClear: { paddingHorizontal: 10, paddingVertical: 10 },
  emptyState: { alignItems: 'center', paddingTop: 64, gap: 12 },
  emptyIconBg: { width: 64, height: 64, borderRadius: 18, backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.text },
  emptySubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted, textAlign: 'center', lineHeight: 20, maxWidth: 260 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: colors.primary, borderRadius: 14, marginTop: 4 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  appCard: { backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 18, marginBottom: 13, borderWidth: 1, borderColor: colors.border },
  appCardRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  appInitial: { width: 52, height: 52, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 0 },
  appInitialText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  appCompany: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.text },
  appRole: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  appCardRight: { alignItems: 'flex-end', gap: 6, flexShrink: 0 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  statusPillText: { fontSize: 10, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  indicatorRow: { flexDirection: 'row', gap: 4 },
  indicator: { width: 5, height: 5, borderRadius: 3 },
  deleteBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  // Sheet
  sheet: { flex: 1, paddingTop: 12 },
  sheetHandle: { width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, alignSelf: 'center', marginBottom: 4 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  sheetTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: colors.text },
  sheetDismiss: { paddingHorizontal: 4, paddingVertical: 4, minWidth: 52 },
  sheetDismissText: { fontSize: 16, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  sheetAction: { paddingHorizontal: 4, paddingVertical: 4, minWidth: 52, alignItems: 'flex-end' },
  sheetActionText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.primary },
  sheetBody: { padding: 20, paddingBottom: 60 },
  fieldLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary, marginBottom: 8, marginTop: 4 },
  fieldLabelOptional: { fontFamily: 'Inter_400Regular', color: colors.textMuted },
  field: { backgroundColor: colors.muted, borderRadius: 14, padding: 16, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.text, borderWidth: 1, borderColor: colors.border, marginBottom: 18 },
  notesField: { minHeight: 120, paddingTop: 14 },
  fieldHintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: -12, marginBottom: 20 },
  fieldHint: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted, lineHeight: 18 },
  // Detail header
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  detailInitial: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 0 },
  detailInitialText: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  detailCompany: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.text, letterSpacing: -0.3 },
  detailRole: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  // Tabs
  detailTab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: colors.muted, borderWidth: 1, borderColor: 'transparent' },
  detailTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  detailTabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
  detailTabTextActive: { color: '#fff' },
  // Sections
  sectionHeading: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  sectionSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted, lineHeight: 20, marginBottom: 20, marginTop: -4 },
  pipelineStepper: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  stepDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.textMuted, marginTop: 5, textAlign: 'center', letterSpacing: 0.2, maxWidth: 50 },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.border, marginTop: 14, flexShrink: 0 },
  rejectedBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, marginBottom: 16 },
  rejectedBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textMuted },
  progressGrid: { gap: 8, marginBottom: 8 },
  progressCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  progressIconBg: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  progressLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.text },
  progressStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, borderWidth: 1, flexShrink: 0 },
  progressStatusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  infoChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.muted, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 4 },
  infoChipText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textMuted, lineHeight: 18 },
  contentBox: { backgroundColor: colors.muted, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  contentText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 22 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 24 },
  primaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20 },
  secondaryBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.primary },
  questionGroup: { borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 12 },
  questionGroupLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  questionRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  questionNum: { fontSize: 13, fontFamily: 'Inter_700Bold', minWidth: 20 },
  questionText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.dangerBg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.dangerBorder, marginBottom: 16 },
  errorBannerText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.danger, lineHeight: 17 },
  retryBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.danger, borderRadius: 8 },
  retryBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  pipelineNode: { alignItems: 'center', justifyContent: 'center', width: 56, paddingVertical: 4, paddingHorizontal: 2, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted },
  pipelineCount: { fontSize: 14, fontFamily: 'Inter_700Bold', lineHeight: 16 },
  pipelineLabel: { fontSize: 7, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1, textAlign: 'center' },
});
