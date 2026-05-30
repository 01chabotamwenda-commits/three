import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/context/AppContext';
import { aiService } from '@/lib/aiService';
import { useColors } from '@/hooks/useColors';
import ConfirmDialog from '@/components/ConfirmDialog';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  revision?: string;   // proposed full-letter rewrite waiting for confirmation
  applied?: boolean;   // revision was applied
}

export default function LetterEditorScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const {
    savedLetters,
    addLetter,
    updateLetter,
    deleteLetter,
    applications,
    addApplication,
    updateApplication,
  } = useApp();

  const params = useLocalSearchParams<{
    letterId?: string;
    company?: string;
    role?: string;
    letterType?: string;
    content?: string;
  }>();

  const s = styles(colors);

  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [letterType, setLetterType] = useState('');
  const [letterId, setLetterId] = useState<string | null>(null);
  const [status, setStatus] = useState<'draft' | 'saved' | 'applied'>('draft');
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [copiedFeedback, setCopiedFeedback] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollRef = useRef<ScrollView>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAppliedConfirm, setShowAppliedConfirm] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [topError, setTopError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);

  const CHAT_HEIGHT = Math.max(200, screenH * 0.32);

  /* ── Load or create letter ── */
  useEffect(() => {
    if (params.letterId) {
      const existing = savedLetters.find(l => l.id === params.letterId);
      if (existing) {
        setLetterId(existing.id);
        setContent(existing.content);
        setTitle(existing.title);
        setCompany(existing.company);
        setRole(existing.role);
        setLetterType(existing.letterType);
        setStatus(existing.status);
      } else {
        router.back();
      }
    } else {
      const c = decodeURIComponent(params.company ?? '');
      const r = decodeURIComponent(params.role ?? '');
      const t = decodeURIComponent(params.letterType ?? 'general');
      const body = decodeURIComponent(params.content ?? '');
      const autoTitle = c && r ? `${c} – ${r}` : c || r || 'Untitled Letter';
      setCompany(c);
      setRole(r);
      setLetterType(t);
      setContent(body);
      setTitle(autoTitle);
      (async () => {
        try {
          const draft = await addLetter({
            title: autoTitle, company: c, role: r,
            letterType: t, content: body, status: 'draft',
          });
          setLetterId(draft.id);
        } catch (err: unknown) {
          setTopError(err instanceof Error ? err.message : 'Failed to save draft — your edits may not persist.');
        }
      })();
    }
  }, []);

  /* ── Send chat message ── */
  async function sendChatMessage() {
    const msg = chatInput.trim();
    if (!msg || !content.trim()) return;

    const newMessages: ChatMessage[] = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages(newMessages);
    setChatInput('');
    setChatLoading(true);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const data = await aiService.letterChat({
        letterContent: content,
        message: msg,
        history: chatMessages.filter(m => !m.revision).slice(-6),
        company,
        role,
        letterType,
      });

      const raw = data.reply ?? '';
      const sepIdx = raw.indexOf('---REVISED---');
      let displayText = raw;
      let revision: string | undefined;

      if (sepIdx !== -1) {
        displayText = raw.slice(0, sepIdx).trim();
        revision = raw.slice(sepIdx + '---REVISED---'.length).trim();
        if (!displayText) displayText = 'Here is my proposed revision. Tap Apply to update your letter.';
      }

      const updated: ChatMessage[] = [
        ...newMessages,
        { role: 'assistant' as const, content: displayText, revision },
      ];
      setChatMessages(updated);
      setChatOpen(true);
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Could not connect. Check your internet and try again.';
      setChatMessages(prev => [...prev, { role: 'assistant', content: `⚠ ${errMsg}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  /* ── Apply AI revision ── */
  async function applyRevision(msgIndex: number, revision: string) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setContent(revision);
    if (letterId) {
      await updateLetter(letterId, { content: revision, status: status === 'draft' ? 'saved' : status });
      if (status === 'draft') setStatus('saved');
    }
    setChatMessages(prev =>
      prev.map((m, i) => i === msgIndex ? { ...m, revision: undefined, applied: true } : m)
    );
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  /* ── Save ── */
  async function handleSave() {
    if (!letterId) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await updateLetter(letterId, {
      content,
      title: title || `${company} – ${role}`,
      status: status === 'draft' ? 'saved' : status,
    });
    if (status === 'draft') setStatus('saved');
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  }

  /* ── Copy ── */
  async function handleCopy() {
    await Clipboard.setStringAsync(content);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedFeedback(true);
    setTimeout(() => setCopiedFeedback(false), 2000);
  }

  /* ── Share ── */
  async function handleShare() {
    try {
      await Share.share({ message: content, title: title || 'Application Letter' });
    } catch (err) {
      console.log('Share cancelled');
    }
  }

  /* ── Mark as Applied ── */
  async function confirmApplied() {
    if (!letterId) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await updateLetter(letterId, { status: 'applied' });
    setStatus('applied');
    const existing = applications.find(
      a => a.companyName.toLowerCase() === (company || '').toLowerCase()
    );
    if (existing) {
      await updateApplication(existing.id, {
        status: 'Applied', draftedLetter: content, appliedDate: new Date().toISOString(),
      });
    } else {
      await addApplication({
        companyName: company || 'Unknown Company',
        role: role || 'Application',
        status: 'Applied',
        draftedLetter: content,
        appliedDate: new Date().toISOString(),
      });
    }
  }

  /* ── Delete ── */
  async function confirmDelete() {
    if (!letterId) return;
    await deleteLetter(letterId);
    router.back();
  }

  const topPad = Platform.OS === 'web' ? 16 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 12 : insets.bottom;

  const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
    draft:   { label: 'Draft',   color: colors.textMuted, bg: colors.cardElevated },
    saved:   { label: 'Saved',   color: '#14b8a6',        bg: 'rgba(20,184,166,0.14)' },
    applied: { label: 'Applied', color: '#6366f1',        bg: 'rgba(99,102,241,0.14)' },
  };
  const meta = STATUS_META[status] ?? STATUS_META.draft;

  const STARTER_PROMPTS = [
    'Make it shorter',
    'Sound more confident',
    'Add a stronger opening',
    'Improve the closing',
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[s.screen, { paddingTop: topPad, paddingBottom: bottomPad }]}>

        {/* ── Top error banner ── */}
        {!!topError && (
          <Pressable
            style={[s.topErrorBanner, { backgroundColor: colors.dangerBg || 'rgba(239,68,68,0.1)', borderColor: colors.dangerBorder || 'rgba(239,68,68,0.3)' }]}
            onPress={() => setTopError('')}
          >
            <Feather name="alert-circle" size={13} color={colors.danger} />
            <Text style={[s.topErrorText, { color: colors.danger }]}>{topError}</Text>
            <Feather name="x" size={12} color={colors.danger} />
          </Pressable>
        )}

        {/* ── Header ── */}
        <View style={s.header}>
          <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={10}>
            <Feather name="arrow-left" size={20} color={colors.text} />
          </Pressable>

          <View style={s.headerCenter}>
            <Text style={s.headerTitle} numberOfLines={1}>{title || 'Letter Editor'}</Text>
            <View style={[s.statusBadge, { backgroundColor: meta.bg }]}>
              <Text style={[s.statusBadgeText, { color: meta.color }]}>{meta.label}</Text>
              {company ? <Text style={[s.statusBadgeText, { color: meta.color, opacity: 0.7 }]}> · {company}</Text> : null}
            </View>
          </View>

          <View style={s.headerActions}>
            {/* Copy */}
            <Pressable style={s.iconBtn} onPress={handleCopy} hitSlop={8}>
              <Feather name={copiedFeedback ? 'check' : 'copy'} size={17} color={copiedFeedback ? '#14b8a6' : colors.textMuted} />
            </Pressable>
            {/* Share */}
            <Pressable style={s.iconBtn} onPress={handleShare} hitSlop={8}>
              <Feather name="share-2" size={17} color={colors.textMuted} />
            </Pressable>
            {/* Save */}
            <Pressable style={s.iconBtn} onPress={handleSave} hitSlop={8}>
              <Feather name={savedFeedback ? 'check' : 'save'} size={17} color={savedFeedback ? '#14b8a6' : colors.textMuted} />
            </Pressable>
            {/* Delete */}
            <Pressable style={s.iconBtn} onPress={() => setShowDeleteConfirm(true)} hitSlop={8}>
              <Feather name="trash-2" size={17} color={colors.danger} />
            </Pressable>
          </View>
        </View>

        {/* ── Letter text editor ── */}
        <TextInput
          style={s.letterInput}
          multiline
          value={content}
          onChangeText={setContent}
          placeholder="Your letter content…"
          placeholderTextColor={colors.textMuted}
          textAlignVertical="top"
          autoCorrect
          spellCheck
          scrollEnabled
        />

        {/* ── AI Chat panel ── */}
        <View style={[s.chatPanel, chatOpen && { height: CHAT_HEIGHT }]}>
          {/* Panel header — tap to toggle */}
          <Pressable style={s.chatPanelHeader} onPress={() => setChatOpen(o => !o)}>
            <View style={s.chatPanelIcon}>
              <Feather name="zap" size={12} color={colors.primary} />
            </View>
            <Text style={s.chatPanelTitle}>AI Assistant</Text>
            {chatMessages.length > 0 && !chatOpen && (
              <View style={s.chatBadge}>
                <Text style={s.chatBadgeText}>{chatMessages.length}</Text>
              </View>
            )}
            <Text style={[s.chatPanelSub, { flex: 1 }]}>
              {chatOpen ? 'Ask anything about your letter' : 'Tap to open'}
            </Text>
            <Feather
              name={chatOpen ? 'chevron-down' : 'chevron-up'}
              size={16}
              color={colors.textMuted}
            />
          </Pressable>

          {/* Messages — only rendered when open */}
          {chatOpen && <ScrollView
            ref={chatScrollRef}
            style={s.chatScroll}
            contentContainerStyle={s.chatScrollContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
          >
            {chatMessages.length === 0 ? (
              <View style={s.starterWrap}>
                {STARTER_PROMPTS.map(p => (
                  <Pressable
                    key={p}
                    style={s.starterChip}
                    onPress={() => { setChatInput(p); }}
                  >
                    <Text style={s.starterChipText}>{p}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              chatMessages.map((m, i) => (
                <View key={i}>
                  <View style={[s.bubble, m.role === 'user' ? s.bubbleUser : s.bubbleAssistant]}>
                    <Text style={[s.bubbleText, m.role === 'user' ? s.bubbleTextUser : s.bubbleTextAssistant]}>
                      {m.content}
                    </Text>
                  </View>
                  {m.role === 'assistant' && m.revision && (
                    <Pressable
                      style={({ pressed }) => [s.applyBtn, pressed && { opacity: 0.8 }]}
                      onPress={() => applyRevision(i, m.revision!)}
                    >
                      <Feather name="check-circle" size={14} color="#fff" />
                      <Text style={s.applyBtnText}>Apply this revision</Text>
                    </Pressable>
                  )}
                  {m.role === 'assistant' && m.applied && (
                    <View style={s.appliedTag}>
                      <Feather name="check" size={12} color="#14b8a6" />
                      <Text style={s.appliedTagText}>Applied to letter</Text>
                    </View>
                  )}
                </View>
              ))
            )}
            {chatLoading && (
              <View style={[s.bubble, s.bubbleAssistant]}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
          </ScrollView>}

          {chatOpen && (
            <View style={[s.chatInputRow, { paddingBottom: bottomPad + 6 }]}>
              <TextInput
                style={s.chatInput}
                placeholder="Ask AI to improve your letter…"
                placeholderTextColor={colors.textMuted}
                value={chatInput}
                onChangeText={setChatInput}
                onSubmitEditing={sendChatMessage}
                returnKeyType="send"
                multiline={false}
              />
              {status !== 'applied' && (
                <Pressable onPress={() => setShowAppliedConfirm(true)} style={s.appliedBtn} hitSlop={6}>
                  <LinearGradient
                    colors={['#6366f1', '#4f46e5']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={s.appliedBtnGrad}
                  >
                    <Feather name="check-circle" size={14} color="#fff" />
                    <Text style={s.appliedBtnText}>Applied</Text>
                  </LinearGradient>
                </Pressable>
              )}
              <Pressable
                style={[s.sendBtn, (!chatInput.trim() || chatLoading) && s.sendBtnDisabled]}
                onPress={sendChatMessage}
                disabled={chatLoading || !chatInput.trim()}
              >
                <Feather name="send" size={15} color="#fff" />
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {/* Confirm dialogs */}
      <ConfirmDialog
        visible={showDeleteConfirm}
        title="Delete this letter?"
        message="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => { setShowDeleteConfirm(false); confirmDelete(); }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      <ConfirmDialog
        visible={showAppliedConfirm}
        title="Mark as Applied?"
        message={`Have you sent this letter to ${company || 'this company'}?`}
        confirmLabel="Yes, Applied"
        cancelLabel="Cancel"
        onConfirm={() => { setShowAppliedConfirm(false); confirmApplied(); }}
        onCancel={() => setShowAppliedConfirm(false)}
      />
    </KeyboardAvoidingView>
  );
}

function styles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },

    /* Top error banner */
    topErrorBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      paddingHorizontal: 14, paddingVertical: 9,
      borderBottomWidth: 1,
    },
    topErrorText: {
      flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 16,
    },

    /* Header */
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backBtn: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.cardElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerCenter: {
      flex: 1,
      gap: 3,
    },
    headerTitle: {
      fontSize: 15,
      fontFamily: 'Inter_600SemiBold',
      color: colors.text,
    },
    statusBadge: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    statusBadgeText: {
      fontSize: 11,
      fontFamily: 'Inter_500Medium',
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    iconBtn: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },

    /* Letter editor */
    letterInput: {
      flex: 1,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.text,
      lineHeight: 23,
      textAlignVertical: 'top',
      padding: 16,
      paddingBottom: 8,
    },

    /* AI Chat panel */
    chatPanel: {
      backgroundColor: colors.card,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    chatPanelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 6,
      gap: 6,
    },
    chatPanelIcon: {
      width: 22,
      height: 22,
      borderRadius: 6,
      backgroundColor: colors.indigoBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chatPanelTitle: {
      fontSize: 13,
      fontFamily: 'Inter_600SemiBold',
      color: colors.text,
    },
    chatPanelSub: {
      fontSize: 11,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
    },
    chatBadge: {
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    chatBadgeText: {
      fontSize: 10,
      fontFamily: 'Inter_700Bold',
      color: '#fff',
    },

    /* Chat messages */
    chatScroll: {
      flex: 1,
    },
    chatScrollContent: {
      paddingHorizontal: 12,
      paddingBottom: 4,
    },
    starterWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingVertical: 10,
    },
    starterChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: colors.cardElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    starterChipText: {
      fontSize: 12,
      fontFamily: 'Inter_500Medium',
      color: colors.textMuted,
    },
    bubble: {
      maxWidth: '85%',
      borderRadius: 14,
      padding: 10,
      marginBottom: 6,
    },
    bubbleUser: {
      alignSelf: 'flex-end',
      backgroundColor: colors.indigoBg,
      borderBottomRightRadius: 3,
    },
    bubbleAssistant: {
      alignSelf: 'flex-start',
      backgroundColor: colors.cardElevated,
      borderBottomLeftRadius: 3,
      borderWidth: 1,
      borderColor: colors.border,
    },
    bubbleText: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      lineHeight: 19,
    },
    bubbleTextUser: {
      color: colors.primary,
    },
    bubbleTextAssistant: {
      color: colors.text,
    },

    /* Apply revision button */
    applyBtn: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
      marginLeft: 4,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: colors.primary,
    },
    applyBtnText: {
      fontSize: 12,
      fontFamily: 'Inter_700Bold',
      color: '#fff',
    },
    appliedTag: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 4,
      marginLeft: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 20,
      backgroundColor: 'rgba(20,184,166,0.12)',
      borderWidth: 1,
      borderColor: 'rgba(20,184,166,0.3)',
    },
    appliedTagText: {
      fontSize: 11,
      fontFamily: 'Inter_600SemiBold',
      color: '#14b8a6',
    },

    /* Input row */
    chatInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    chatInput: {
      flex: 1,
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.text,
      backgroundColor: colors.cardElevated,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: colors.border,
    },
    appliedBtn: {
      borderRadius: 8,
      overflow: 'hidden',
    },
    appliedBtnGrad: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
    },
    appliedBtnText: {
      fontSize: 12,
      fontFamily: 'Inter_600SemiBold',
      color: '#fff',
    },
    sendBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnDisabled: {
      opacity: 0.4,
    },
  });
}
