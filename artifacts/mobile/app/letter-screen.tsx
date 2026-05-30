import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { aiService } from '@/lib/aiService';
import { useColors } from '@/hooks/useColors';
import { getCvContent, getCoverLetterExamples } from '@/utils/docContext';
import ConfirmDialog from '@/components/ConfirmDialog';
import { confirmDialog } from '@/utils/alert';

const LAST_LETTER_KEY = 'cc_last_letter';

type LetterType = 'attachment' | 'internship' | 'graduate' | 'job' | 'general';
type Step = 'type' | 'details' | 'generating' | 'preview';

interface LetterTypeOption {
  key: LetterType;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}

const LETTER_TYPES: LetterTypeOption[] = [
  { key: 'attachment', label: 'Industrial\nAttachment', icon: 'tool' },
  { key: 'internship', label: 'Internship', icon: 'briefcase' },
  { key: 'graduate', label: 'Graduate\nProgramme', icon: 'award' },
  { key: 'job', label: 'Full-Time\nEmployment', icon: 'monitor' },
  { key: 'general', label: 'General\nApplication', icon: 'file-text' },
];

const STEPS: { key: Step; label: string }[] = [
  { key: 'type', label: 'Type' },
  { key: 'details', label: 'Details' },
  { key: 'generating', label: 'Generate' },
  { key: 'preview', label: 'Preview' },
];

const TEASER_TAGS = [
  'Professional greeting',
  'Role alignment',
  'Skills evidence',
  'Clear call to action',
  'Polite close',
];

function getProfileField(fields: { label: string; value: string }[] | undefined, ...keys: string[]) {
  if (!fields) return '';
  const lower = keys.map(k => k.toLowerCase());
  return fields.find(f => lower.some(k => f.label.toLowerCase().includes(k)))?.value ?? '';
}

export default function LetterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { profile, docs, savedLetters, addLetter, deleteLetter } = useApp();
  const s = styles(colors);

  const topPad = Platform.OS === 'web' ? 16 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 16 : insets.bottom;

  const profilePhone = getProfileField(profile?.profileFields, 'phone', 'mobile', 'tel');
  const profileEmail = getProfileField(profile?.profileFields, 'email');

  const [step, setStep] = useState<Step>('type');
  const [letterType, setLetterType] = useState<LetterType>('attachment');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('');
  const [hasDraft, setHasDraft] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatedLetter, setGeneratedLetter] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [showLetterConfirm, setShowLetterConfirm] = useState(false);
  const [generatedLetterId, setGeneratedLetterId] = useState<string | undefined>(undefined);
  const scrollRef = useRef<ScrollView>(null);

  // Restore last letter on mount
  useEffect(() => {
    AsyncStorage.getItem(LAST_LETTER_KEY).then(raw => {
      if (!raw) return;
      const saved = JSON.parse(raw) as { company: string; role: string; letterType: LetterType; letter: string; letterId?: string };
      if (saved?.letter) {
        setCompany(saved.company || '');
        setRole(saved.role || '');
        if (saved.letterType) setLetterType(saved.letterType);
        setGeneratedLetter(saved.letter);
        if (saved.letterId) setGeneratedLetterId(saved.letterId);
        setStep('preview');
      }
    }).catch((err) => console.warn('Failed to load last letter:', err));
  }, []);

  async function generateLetter() {
    if (!company.trim()) { setError('Please enter the company or organisation name.'); return; }
    if (!role.trim()) { setError('Please enter the role or department you are applying for.'); return; }

    if (!profile) { setError('Please complete your profile before generating a letter.'); return; }

    setLoading(true);
    setError('');
    setGeneratedLetter('');
    setStep('generating');

    try {
      const data = await aiService.draftLetter({
        companyName: company.trim(),
        role: role.trim(),
        degree: profile.currentDegree,
        goals: profile.careerGoals || '',
        institution: profile.institution || '',
        yearOfStudy: profile.yearOfStudy || '',
        skills: profile.skills || '',
        portfolioUrl: profile.portfolioUrl || '',
        userDraft: hasDraft ? draft.trim() : undefined,
        letterType,
        studentName: profile.displayName || '',
        studentPhone: profilePhone,
        studentEmail: profileEmail,
        studentCity: profile.city || '',
        cvContent: getCvContent(docs),
        styleExamples: getCoverLetterExamples(docs),
      });

      setGeneratedLetter(data.letter);
      setStep('preview');
      const saved = await addLetter({
        title: `${company.trim()} – ${role.trim()}`,
        company: company.trim(),
        role: role.trim(),
        letterType,
        content: data.letter,
        status: 'draft',
      });
      setGeneratedLetterId(saved.id);
      AsyncStorage.setItem(LAST_LETTER_KEY, JSON.stringify({
        company: company.trim(), role: role.trim(), letterType, letter: data.letter, letterId: saved.id,
      })).catch((err) => console.warn('Failed to save last letter:', err));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(msg);
      setStep('details');
    } finally {
      setLoading(false);
    }
  }

  function openEditor(content: string, companyName: string, roleName: string, type: string, letterId?: string) {
    const path = letterId
      ? `/letter-editor?letterId=${encodeURIComponent(letterId)}`
      : `/letter-editor?company=${encodeURIComponent(companyName)}&role=${encodeURIComponent(roleName)}&letterType=${encodeURIComponent(type)}&content=${encodeURIComponent(content)}`;
    router.push(path as any);
  }

  function goBack() {
    if (step === 'details') setStep('type');
    else if (step === 'preview') setStep('details');
    else router.back();
  }

  // ─── Step indicator ───────────────────────────────────────────────────────
  const currentStepIndex = STEPS.findIndex(s => s.key === step);

  function StepIndicator() {
    return (
      <View style={s.stepRow}>
        {STEPS.map((st, i, arr) => {
          const isCurrent = step === st.key;
          const isDone = currentStepIndex > i;
          const isActive = isCurrent || isDone;
          return (
            <View key={st.key} style={s.stepItem}>
              <View
                style={[
                  s.stepCircle,
                  {
                    backgroundColor: isCurrent ? colors.primary : isDone ? colors.success : colors.card,
                    borderColor: isCurrent ? colors.primary : isDone ? colors.success : colors.border,
                  },
                ]}
              >
                {isDone ? (
                  <Feather name="check" size={12} color="#fff" />
                ) : (
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: 'Inter_700Bold',
                      color: isCurrent ? '#fff' : colors.textMuted,
                    }}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              {i < arr.length - 1 && (
                <View
                  style={[
                    s.stepLine,
                    { backgroundColor: isDone ? colors.success : colors.borderStrong || colors.border },
                  ]}
                />
              )}
            </View>
          );
        })}
      </View>
    );
  }

  // ─── Step 1: Type selection ─────────────────────────────────────────────────
  function TypeStep() {
    return (
      <>
        <Text style={s.stepLabel}>What type of letter do you need?</Text>
        <View style={s.typeGrid}>
          {LETTER_TYPES.map(lt => {
            const active = letterType === lt.key;
            return (
              <Pressable
                key={lt.key}
                onPress={() => setLetterType(lt.key)}
                style={[
                  s.typeCard,
                  {
                    backgroundColor: active ? colors.indigoBg : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ marginBottom: 8 }}>
                  <Feather name={lt.icon} size={24} color={active ? colors.text : colors.textMuted} />
                </Text>
                <Text
                  style={[
                    s.typeLabel,
                    { color: active ? colors.text : colors.textMuted },
                  ]}
                >
                  {lt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.9 }]}
          onPress={() => setStep('details')}
          android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
        >
          <Text style={s.primaryBtnText}>Continue</Text>
        </Pressable>
      </>
    );
  }

  // ─── Step 2: Details ──────────────────────────────────────────────────────
  function DetailsStep() {
    return (
      <>
        <Text style={s.stepLabel}>Who are you writing to?</Text>

        <View style={s.inputGroup}>
          <View style={s.inputWrap}>
            <Text style={s.inputLabel}>COMPANY NAME</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. Safaricom PLC"
              placeholderTextColor={colors.textMuted}
              value={company}
              onChangeText={setCompany}
              autoCapitalize="words"
            />
          </View>
          <View style={s.inputWrap}>
            <Text style={s.inputLabel}>POSITION / ROLE</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. Graduate Software Engineer"
              placeholderTextColor={colors.textMuted}
              value={role}
              onChangeText={setRole}
            />
          </View>
          <View style={s.inputWrap}>
            <Text style={s.inputLabel}>DEPARTMENT (OPTIONAL)</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. Engineering"
              placeholderTextColor={colors.textMuted}
              value={department}
              onChangeText={setDepartment}
            />
          </View>
        </View>

        {/* Draft toggle */}
        <Pressable
          style={s.draftToggle}
          onPress={() => setHasDraft(p => !p)}
          android_ripple={{ color: colors.indigoBg }}
        >
          <View style={[s.checkbox, hasDraft && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
            {hasDraft && <Feather name="check" size={11} color="#fff" />}
          </View>
          <Text style={s.draftToggleText}>I have a draft I want polished</Text>
        </Pressable>

        {hasDraft && (
          <TextInput
            style={[s.input, s.textarea]}
            placeholder="Paste your draft letter here..."
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
        )}

        {/* Teaser card */}
        <View style={s.teaserCard}>
          <View style={s.teaserHeader}>
            <View style={[s.teaserIcon, { backgroundColor: colors.indigoBg }]}>
              <Feather name="info" size={12} color={colors.primary} />
            </View>
            <Text style={s.teaserTitle}>Your letter will include</Text>
          </View>
          <View style={s.teaserTags}>
            {TEASER_TAGS.map(tag => (
              <View key={tag} style={[s.teaserTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={s.teaserTagText}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Error banner */}
        {!!error && (
          <View style={s.errorBanner}>
            <Feather name="alert-circle" size={14} color={colors.danger} />
            <Text style={s.errorBannerText}>{error}</Text>
            <Pressable onPress={generateLetter}>
              <Text style={s.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.9 }]}
          onPress={() => setShowLetterConfirm(true)}
          disabled={loading}
          android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
        >
          <Feather name="upload" size={16} color="#fff" />
          <Text style={s.primaryBtnText}>Generate Letter</Text>
        </Pressable>
      </>
    );
  }

  // ─── Step 3: Generating ───────────────────────────────────────────────────
  function GeneratingStep() {
    return (
      <View style={s.generatingWrap}>
        <View style={[s.spinnerCircle, { backgroundColor: colors.indigoBg }]}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
        <Text style={s.generatingTitle}>Crafting your letter...</Text>
        <Text style={s.generatingSub}>Personalizing with your profile</Text>
      </View>
    );
  }

  // ─── Step 4: Preview ──────────────────────────────────────────────────────
  function PreviewStep() {
    return (
      <>
        <View style={s.previewCard}>
          <View style={s.previewHeader}>
            <Text style={s.previewHeaderText}>Preview</Text>
            <View style={[s.draftBadge, { backgroundColor: colors.indigoBg }]}>
              <Text style={[s.draftBadgeText, { color: colors.primary }]}>Draft</Text>
            </View>
          </View>
          <Text style={s.letterText} selectable>{generatedLetter}</Text>
        </View>

        <View style={s.previewActions}>
          <Pressable
            style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.9 }]}
            onPress={() => openEditor(generatedLetter, company, role, letterType, generatedLetterId)}
          >
            <Text style={s.secondaryBtnText}>Edit</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.9 }]}
            onPress={() => router.back()}
          >
            <Text style={s.primaryBtnText}>Done</Text>
          </Pressable>
        </View>
      </>
    );
  }

  // ─── Saved letters library (collapsible) ────────────────────────────────────
  function SavedLetters() {
    if (!showLibrary) return null;
    return (
      <View style={s.libraryCard}>
        <View style={s.libraryHeader}>
          <Text style={s.libraryTitle}>Saved Letters</Text>
          <Pressable onPress={() => setShowLibrary(false)} hitSlop={8}>
            <Feather name="x" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
        {savedLetters.length === 0 ? (
          <Text style={s.libraryEmpty}>No letters yet.</Text>
        ) : (
          savedLetters.map(l => {
            const statusStyle =
              l.status === 'draft'
                ? { bg: colors.warningBg, text: colors.warning, border: colors.warningBorder }
                : l.status === 'saved'
                  ? { bg: colors.indigoBg, text: colors.primary, border: colors.indigoBorder }
                  : { bg: colors.successBg, text: colors.success, border: colors.successBorder };
            return (
              <Pressable
                key={l.id}
                style={s.libraryItem}
                onPress={() => openEditor(l.content, l.company, l.role, l.letterType, l.id)}
              >
                <View style={{ flex: 1 }}>
                  <View style={s.libraryItemRow}>
                    <Text style={s.libraryItemTitle} numberOfLines={1}>{l.title}</Text>
                    <View style={[s.statusBadge, { backgroundColor: statusStyle.bg, borderColor: statusStyle.border }]}>
                      <Text style={[s.statusBadgeText, { color: statusStyle.text }]}>{l.status}</Text>
                    </View>
                  </View>
                  <Text style={s.libraryItemMeta}>{l.company} · {LETTER_TYPES.find(t => t.key === l.letterType)?.label?.replace('\n', ' ') || l.letterType}</Text>
                  <Text style={s.libraryItemDate}>{new Date(l.updatedAt).toLocaleDateString()}</Text>
                </View>
                <Pressable
                  style={s.libraryDelete}
                  onPress={() => {
                    confirmDialog(
                      'Delete letter?',
                      l.title,
                      () => deleteLetter(l.id),
                      'Delete',
                    );
                  }}
                >
                  <Feather name="trash-2" size={14} color={colors.danger} />
                </Pressable>
              </Pressable>
            );
          })
        )}
      </View>
    );
  }

  return (
    <View style={[s.screen, { paddingTop: topPad, paddingBottom: bottomPad }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Pressable style={s.backBtn} onPress={goBack} android_ripple={{ color: colors.indigoBg }}>
            <Feather name="arrow-left" size={18} color={colors.text} />
          </Pressable>
          <View>
            <Text style={s.headerTitle}>Letter Writer</Text>
            <Text style={s.headerSubtitle}>AI-powered application letters</Text>
          </View>
        </View>
        <Pressable style={s.libraryToggleBtn} onPress={() => setShowLibrary(p => !p)}>
          <Feather name="folder" size={16} color={colors.primary} />
          {savedLetters.length > 0 && (
            <View style={[s.badgeDot, { backgroundColor: colors.primary }]}>
              <Text style={s.badgeDotText}>{savedLetters.length}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {StepIndicator()}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad + 24 }}
          showsVerticalScrollIndicator
          indicatorStyle={colors.isDark ? 'white' : 'black'}
          keyboardShouldPersistTaps="handled"
        >
          {SavedLetters()}

          {step === 'type' && TypeStep()}
          {step === 'details' && DetailsStep()}
          {step === 'generating' && GeneratingStep()}
          {step === 'preview' && PreviewStep()}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={showLetterConfirm}
        title="Generate Letter?"
        message="AI will write a personalised cover letter using your profile and CV. This may take up to 45 seconds."
        confirmLabel="Generate"
        cancelLabel="Cancel"
        onConfirm={() => { setShowLetterConfirm(false); generateLetter(); }}
        onCancel={() => setShowLetterConfirm(false)}
      />
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 8,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.text },
    headerSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginTop: 2 },
    libraryToggleBtn: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: colors.indigoBg,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    badgeDot: {
      position: 'absolute',
      top: -4,
      right: -4,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    badgeDotText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },

    // Steps
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingBottom: 20,
      gap: 4,
    },
    stepItem: { flexDirection: 'row', alignItems: 'center' },
    stepCircle: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepLine: { width: 24, height: 2, marginHorizontal: 4 },

    // Step content
    stepLabel: {
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
      color: colors.textMuted,
      marginBottom: 16,
      marginTop: 4,
    },

    // Type grid
    typeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 20,
    },
    typeCard: {
      width: '47%',
      padding: 16,
      borderRadius: 18,
      borderWidth: 1.5,
      minHeight: 100,
    },
    typeLabel: {
      fontSize: 13,
      fontFamily: 'Inter_600SemiBold',
      lineHeight: 18,
    },

    // Inputs
    inputGroup: { gap: 14, marginBottom: 16 },
    inputWrap: {},
    inputLabel: {
      fontSize: 10,
      fontFamily: 'Inter_700Bold',
      color: colors.textMuted,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.text,
    },
    textarea: {
      height: 120,
      textAlignVertical: 'top',
      paddingTop: 12,
    },

    // Draft toggle
    draftToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 16,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    draftToggleText: {
      fontSize: 13,
      fontFamily: 'Inter_500Medium',
      color: colors.textSecondary,
    },

    // Teaser
    teaserCard: {
      backgroundColor: 'rgba(99,102,241,0.06)',
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 20,
    },
    teaserHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    teaserIcon: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    teaserTitle: {
      fontSize: 12,
      fontFamily: 'Inter_600SemiBold',
      color: colors.textMuted,
    },
    teaserTags: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    teaserTag: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      borderWidth: 1,
    },
    teaserTagText: {
      fontSize: 11,
      fontFamily: 'Inter_500Medium',
      color: colors.textMuted,
    },

    // Buttons
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 18,
      paddingVertical: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 16,
    },
    primaryBtnText: {
      fontSize: 15,
      fontFamily: 'Inter_700Bold',
      color: '#fff',
    },
    secondaryBtn: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 18,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryBtnText: {
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
      color: colors.text,
    },

    // Error
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.dangerBg,
      borderRadius: 14,
      padding: 14,
      marginBottom: 16,
    },
    errorBannerText: {
      flex: 1,
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.danger,
      lineHeight: 17,
    },
    retryText: {
      fontSize: 12,
      fontFamily: 'Inter_700Bold',
      color: colors.danger,
    },

    // Generating
    generatingWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 80,
    },
    spinnerCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    generatingTitle: {
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
      color: colors.text,
      marginBottom: 6,
    },
    generatingSub: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
    },

    // Preview
    previewCard: {
      backgroundColor: colors.cardElevated || colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 20,
    },
    previewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    previewHeaderText: {
      fontSize: 11,
      fontFamily: 'Inter_700Bold',
      color: colors.textMuted,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    draftBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
    },
    draftBadgeText: {
      fontSize: 10,
      fontFamily: 'Inter_700Bold',
    },
    letterText: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.textSecondary,
      lineHeight: 22,
      padding: 18,
    },
    previewActions: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 20,
    },

    // Library
    libraryCard: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 20,
    },
    libraryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    libraryTitle: {
      fontSize: 14,
      fontFamily: 'Inter_700Bold',
      color: colors.text,
    },
    libraryEmpty: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
      textAlign: 'center',
      paddingVertical: 24,
    },
    libraryItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    libraryItemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 2,
    },
    libraryItemTitle: {
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
      color: colors.text,
      flex: 1,
    },
    libraryItemMeta: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
    },
    libraryItemDate: {
      fontSize: 11,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
      marginTop: 2,
    },
    libraryDelete: {
      padding: 8,
      borderRadius: 8,
      backgroundColor: colors.dangerBg,
      marginLeft: 8,
    },
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
      borderWidth: 1,
    },
    statusBadgeText: {
      fontSize: 10,
      fontFamily: 'Inter_700Bold',
      textTransform: 'capitalize',
    },
  });
