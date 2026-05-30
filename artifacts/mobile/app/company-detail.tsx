import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
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

import { useApp } from '@/context/AppContext';
import { aiService } from '@/lib/aiService';
import { useColors } from '@/hooks/useColors';
import { cleanAiResponse, cleanJsonResponse } from '@/utils/cleanAiResponse';
import { getCoverLetterExamples } from '@/utils/docContext';
import ConfirmDialog from '@/components/ConfirmDialog';

interface CompanyData {
  name: string;
  description: string;
  fitScore: string;
  website?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  linkedin?: string | null;
  facebook?: string | null;
  twitter?: string | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type LetterOpType = 'attachment' | 'internship' | 'graduate' | 'job' | 'general';
const LETTER_OP_TYPES: { key: LetterOpType; label: string }[] = [
  { key: 'attachment', label: 'Industrial Attachment' },
  { key: 'internship', label: 'Internship' },
  { key: 'graduate', label: 'Graduate Programme' },
  { key: 'job', label: 'Full-Time Employment' },
  { key: 'general', label: 'General Application' },
];

const FIT_META: Record<string, { color: string; bg: string; border: string; icon: string }> = {
  'Excellent Fit': { color: '#14b8a6', bg: 'rgba(20,184,166,0.15)', border: 'rgba(20,184,166,0.25)', icon: 'star' },
  'Strong Fit':    { color: '#6366f1', bg: 'rgba(99,102,241,0.14)', border: 'rgba(99,102,241,0.25)', icon: 'trending-up' },
  'Good Fit':      { color: '#3b82f6', bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.25)', icon: 'thumbs-up' },
};

export default function CompanyDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ data: string }>();
  const { profile, applications, docs, addApplication, updateApplication, addLetter } = useApp();

  const company: CompanyData | null = React.useMemo(() => {
    try { return params.data ? JSON.parse(decodeURIComponent(params.data)) : null; }
    catch { return null; }
  }, [params.data]);

  const [showLetterModal, setShowLetterModal] = useState(false);
  const [showLetterConfirm, setShowLetterConfirm] = useState(false);
  const [trackSuccess, setTrackSuccess] = useState(false);
  const [research, setResearch] = useState('');
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState('');
  const [interviewQ, setInterviewQ] = useState<{ personal: string[]; company: string[]; experience: string[] } | null>(null);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [interviewError, setInterviewError] = useState('');

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollRef = useRef<ScrollView>(null);

  const [letterOpType, setLetterOpType] = useState<LetterOpType>('attachment');
  const [letterRole, setLetterRole] = useState('');
  const [letterDraft, setLetterDraft] = useState('');
  const [letter, setLetter] = useState('');
  const [letterLoading, setLetterLoading] = useState(false);
  const [letterError, setLetterError] = useState('');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 72 : insets.bottom;

  const trackedApp = company
    ? applications.find(a => a.companyName.toLowerCase() === company.name.toLowerCase())
    : null;

  const isTracked = !!trackedApp;

  if (!company) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_400Regular' }}>
          Company data not found.
        </Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.primary, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const fit = FIT_META[company.fitScore] || FIT_META['Good Fit'];

  const handleTrack = async () => {
    if (isTracked || trackSuccess) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await addApplication({
      companyName: company.name,
      role: `WIL Placement – ${profile?.currentDegree || 'General'}`,
      status: 'Interested',
      researchSummary: research || undefined,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTrackSuccess(true);
  };

  const handleOpenMaps = () => {
    const addressParts = [company.name, company.address, 'Zambia'].filter(Boolean).join(', ');
    const query = encodeURIComponent(addressParts);
    const url = Platform.OS === 'ios'
      ? `maps:?q=${query}`
      : `https://maps.google.com/maps?q=${query}`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/maps?q=${query}`));
  };

  const handleResearch = async () => {
    setResearchLoading(true);
    setResearchError('');
    try {
      const data = await aiService.researchCompany({
          companyName: company.name,
          degree: profile?.currentDegree || '',
          goals: profile?.careerGoals || '',
        });
      const summary = cleanAiResponse(data.summary || '');
      setResearch(summary);
      if (trackedApp) {
        await updateApplication(trackedApp.id, { researchSummary: summary });
      }
    } catch (err: unknown) {
      setResearchError(err instanceof Error ? err.message : 'Could not fetch research. Check your internet connection.');
    } finally {
      setResearchLoading(false);
    }
  };

  const handleInterviewPrep = async () => {
    setInterviewLoading(true);
    setInterviewError('');
    try {
      const data = await aiService.interviewQuestions({
          companyName: company.name,
          role: `WIL Placement – ${profile?.currentDegree || 'General'}`,
          degree: profile?.currentDegree || '',
          goals: profile?.careerGoals || '',
          skills: profile?.skills || '',
          institution: profile?.institution || '',
          yearOfStudy: profile?.yearOfStudy || '',
          researchSummary: research || '',
        });
      const cleanedQuestions = cleanJsonResponse(data);
      setInterviewQ(cleanedQuestions);
    } catch (err: unknown) {
      setInterviewError(err instanceof Error ? err.message : 'Could not generate questions. Check your internet connection.');
    } finally {
      setInterviewLoading(false);
    }
  };

  const handleSendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    const newHistory: ChatMessage[] = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages(newHistory);
    setChatLoading(true);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      const data = await aiService.companyChat({
        companyName: company.name,
        message: msg,
        history: chatMessages.slice(-6),
        researchContext: research || '',
      });
      const reply = data.reply || 'Sorry, I could not get a response. Please try again.';
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not connect. Please check your internet and try again.';
      setChatMessages(prev => [...prev, { role: 'assistant', content: `⚠ ${msg}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const generateLetter = async () => {
    setLetterLoading(true);
    setLetterError('');
    setLetter('');
    try {
      const data = await aiService.draftLetter({
          companyName: company.name,
          role: letterRole.trim() || 'Relevant Department',
          degree: profile?.currentDegree || '',
          goals: profile?.careerGoals || '',
          institution: profile?.institution || '',
          yearOfStudy: profile?.yearOfStudy || '',
          skills: profile?.skills || '',
          portfolioUrl: profile?.portfolioUrl || '',
          letterType: letterOpType,
          studentName: profile?.displayName && profile.displayName !== 'You' ? profile.displayName : '',
          studentCity: profile?.city || '',
          userDraft: letterDraft.trim() || undefined,
          companyResearch: research || '',
          styleExamples: getCoverLetterExamples(docs),
        });
      if (data.letter) {
        const cleanedLetter = cleanAiResponse(data.letter);
        setLetter(cleanedLetter);
        if (trackedApp) {
          await updateApplication(trackedApp.id, { draftedLetter: cleanedLetter });
        }
        // Auto-save as draft
        await addLetter({
          title: `${company.name} \u2013 ${letterRole.trim() || 'Application'}`,
          company: company.name,
          role: letterRole.trim() || 'Application',
          letterType: letterOpType,
          content: cleanedLetter,
          status: 'draft',
        });
      } else {
        setLetterError('Could not generate the letter. Please try again.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection error — check your internet and try again.';
      setLetterError(msg);
    } finally {
      setLetterLoading(false);
    }
  };

  function openLetterEditor() {
    if (!letter) return;
    if (!company) return;
    router.push(`/letter-editor?company=${encodeURIComponent(company.name)}&role=${encodeURIComponent(letterRole.trim() || 'Application')}&letterType=${encodeURIComponent(letterOpType)}&content=${encodeURIComponent(letter)}`);
  }

  const s = styles(colors);

  const CHAT_STARTERS = [
    'What roles do they offer?',
    'When do they take interns?',
    'What do they look for?',
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingBottom: bottomPad }}>
      <ScrollView
        style={s.screen}
        contentContainerStyle={{ paddingTop: topPad + 8, paddingBottom: 40 }}
        showsVerticalScrollIndicator
        indicatorStyle={colors.isDark ? 'white' : 'black'}
      >
        {/* Header */}
        <View style={s.headerRow}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Feather name="arrow-left" size={18} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.companyName} numberOfLines={2}>{company.name}</Text>
          </View>
          <View style={[s.fitBadge, { backgroundColor: fit.bg, borderColor: fit.border }]}>
            <Feather name={fit.icon as any} size={11} color={fit.color} />
            <Text style={[s.fitText, { color: fit.color }]}>{company.fitScore}</Text>
          </View>
        </View>

        {/* Description */}
        <View style={s.card}>
          <Text style={s.cardLabel}>About</Text>
          <Text style={s.description}>{company.description}</Text>
        </View>

        {/* Quick Actions */}
        <View style={s.actionsRow}>
          {!isTracked && !trackSuccess && (
            <Pressable
              style={({ pressed }) => [s.actionBtn, s.actionBtnPrimary, pressed && { opacity: 0.82 }]}
              onPress={handleTrack}
              android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
            >
              <Feather name="plus-circle" size={16} color="#fff" />
              <Text style={s.actionBtnText}>Track Company</Text>
            </Pressable>
          )}

          {company.website && (
            <Pressable
              style={({ pressed }) => [s.actionBtnSecondary, pressed && { opacity: 0.75 }]}
              onPress={() => Linking.openURL(company.website!)}
            >
              <Feather name="globe" size={15} color={colors.primary} />
              <Text style={s.actionBtnSecondaryText}>Website</Text>
            </Pressable>
          )}

          {(company.address || company.name) && (
            <Pressable
              style={({ pressed }) => [s.actionBtnSecondary, pressed && { opacity: 0.75 }]}
              onPress={handleOpenMaps}
            >
              <Feather name="map-pin" size={15} color={colors.primary} />
              <Text style={s.actionBtnSecondaryText}>Maps</Text>
            </Pressable>
          )}
        </View>

        {/* ── Tracked / Success Card ── */}
        {(isTracked || trackSuccess) && (() => {
          const currentStatus = trackedApp?.status || 'Interested';
          const stages = ['Interested', 'Applied', 'Interviewing', 'Offer', 'Accepted'];
          const currentIdx = currentStatus === 'Rejected' ? -1 : stages.indexOf(currentStatus);
          return (
            <View style={s.trackedCard}>
              {/* Status badge */}
              <View style={s.trackedCardHeader}>
                <View style={s.trackedBadge}>
                  <Feather name="check-circle" size={13} color={colors.success} />
                  <Text style={s.trackedBadgeText}>
                    {trackSuccess && !isTracked
                      ? '✓ Added to Applications!'
                      : currentStatus === 'Rejected'
                        ? 'Rejected / Not a fit'
                        : `Tracking · ${currentStatus}`}
                  </Text>
                </View>
              </View>

              {/* Mini pipeline */}
              {currentStatus !== 'Rejected' && (
                <View style={s.miniPipeline}>
                  {stages.map((st, idx) => (
                    <React.Fragment key={st}>
                      <View style={[
                        s.miniDot,
                        idx < currentIdx
                          ? { backgroundColor: colors.success, borderColor: colors.success }
                          : idx === currentIdx
                            ? { backgroundColor: colors.primary, borderColor: colors.primary }
                            : { backgroundColor: colors.muted, borderColor: colors.border },
                      ]}>
                        {idx <= currentIdx && (
                          <Feather name={idx < currentIdx ? 'check' : 'bookmark'} size={7} color="#fff" />
                        )}
                      </View>
                      {idx < stages.length - 1 && (
                        <View style={[s.miniLine, { backgroundColor: idx < currentIdx ? colors.success + '55' : colors.border }]} />
                      )}
                    </React.Fragment>
                  ))}
                </View>
              )}

              {/* Action shortcuts */}
              <View style={s.trackedActions}>
                <Pressable
                  style={({ pressed }) => [s.trackedActionBtn, pressed && { opacity: 0.75 }]}
                  onPress={() => router.push('/(tabs)/applications')}
                >
                  <Feather name="list" size={13} color={colors.primary} />
                  <Text style={s.trackedActionText}>View Application</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [s.trackedActionBtn, pressed && { opacity: 0.75 }]}
                  onPress={handleResearch}
                  disabled={researchLoading}
                >
                  {researchLoading
                    ? <ActivityIndicator size="small" color={colors.primary} style={{ width: 13 }} />
                    : <Feather name="search" size={13} color={colors.primary} />}
                  <Text style={s.trackedActionText}>{research ? 'Re-research' : 'Research'}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [s.trackedActionBtn, pressed && { opacity: 0.75 }]}
                  onPress={() => setShowLetterModal(true)}
                >
                  <Feather name="file-text" size={13} color={colors.primary} />
                  <Text style={s.trackedActionText}>Write Letter</Text>
                </Pressable>
              </View>
            </View>
          );
        })()}

        {/* Contact Info */}
        {(company.address || company.phone || company.email || company.linkedin || company.facebook || company.twitter) && (
          <View style={s.card}>
            <Text style={s.cardLabel}>Contact Details</Text>
            {company.address ? (
              <Pressable style={s.contactRow} onPress={handleOpenMaps}>
                <Feather name="map-pin" size={13} color={colors.textMuted} />
                <Text style={s.contactText}>{company.address}</Text>
              </Pressable>
            ) : null}
            {company.phone ? (
              <Pressable style={s.contactRow} onPress={() => Linking.openURL(`tel:${company.phone!.replace(/\s/g, '')}`)}>
                <Feather name="phone" size={13} color={colors.primary} />
                <Text style={[s.contactText, s.contactLink]}>{company.phone}</Text>
              </Pressable>
            ) : null}
            {company.email ? (
              <Pressable style={s.contactRow} onPress={() => Linking.openURL(`mailto:${company.email}`)}>
                <Feather name="mail" size={13} color={colors.primary} />
                <Text style={[s.contactText, s.contactLink]} numberOfLines={1}>{company.email}</Text>
              </Pressable>
            ) : null}
            {company.website ? (
              <Pressable style={s.contactRow} onPress={() => Linking.openURL(company.website!)}>
                <Feather name="globe" size={13} color={colors.primary} />
                <Text style={[s.contactText, s.contactLink]} numberOfLines={1}>{company.website.replace(/^https?:\/\//, '')}</Text>
              </Pressable>
            ) : null}
            {company.linkedin ? (
              <Pressable style={s.contactRow} onPress={() => Linking.openURL(company.linkedin!)}>
                <Feather name="linkedin" size={13} color={colors.primary} />
                <Text style={[s.contactText, s.contactLink]} numberOfLines={1}>{company.linkedin.replace(/^https?:\/\/(www\.)?/, '')}</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {/* AI Research */}
        <View style={s.card}>
          <View style={s.cardHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardLabel}>AI Company Research</Text>
              <Text style={s.cardSub}>Get insider info to tailor your application</Text>
            </View>
            <Pressable
              style={({ pressed }) => [s.aiBtn, pressed && { opacity: 0.8 }]}
              onPress={handleResearch}
              disabled={researchLoading}
            >
              {researchLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Feather name="search" size={14} color="#fff" />}
              <Text style={s.aiBtnText}>{researchLoading ? 'Researching…' : research ? 'Refresh' : 'Research'}</Text>
            </Pressable>
          </View>
          {!!researchError && (
            <View style={s.inlineError}>
              <Feather name="alert-circle" size={13} color={colors.danger} style={{ marginTop: 2 }} />
              <Text style={[s.inlineErrorText, { color: colors.danger }]}>{researchError}</Text>
              <Pressable
                style={s.retryBtn}
                onPress={() => { setResearchError(''); handleResearch(); }}
                accessibilityRole="button"
                accessibilityLabel="Retry research"
              >
                <Feather name="refresh-cw" size={11} color={colors.danger} />
                <Text style={[s.retryBtnText, { color: colors.danger }]}>Retry</Text>
              </Pressable>
            </View>
          )}
          {research ? (
            <ScrollView style={s.researchBox} showsVerticalScrollIndicator>
              <Text style={s.researchText}>{research}</Text>
            </ScrollView>
          ) : !researchLoading && !researchError ? (
            <Text style={[s.cardSub, { marginTop: 8 }]}>
              Tap Research to get company background, culture, and tips for your application. Powered by Google Search + Groq.
            </Text>
          ) : null}
        </View>

        {/* Company Chat — visible after research or always */}
        <View style={s.card}>
          <View style={s.cardHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardLabel}>Ask About This Company</Text>
              <Text style={s.cardSub}>Chat with AI about {company.name} using live web data</Text>
            </View>
            <View style={s.groqBadge}>
              <Text style={s.groqBadgeText}>Groq</Text>
            </View>
          </View>

          {chatMessages.length === 0 && (
            <View style={s.chatStartersRow}>
              {CHAT_STARTERS.map(q => (
                <Pressable
                  key={q}
                  style={({ pressed }) => [s.starterChip, pressed && { opacity: 0.75 }]}
                  onPress={() => { setChatInput(q); }}
                >
                  <Text style={s.starterChipText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {chatMessages.length > 0 && (
            <ScrollView
              ref={chatScrollRef}
              style={s.chatHistory}
              contentContainerStyle={{ gap: 10, paddingTop: 4 }}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: false })}
            >
              {chatMessages.map((msg, i) => (
                <View key={i} style={[s.chatBubbleWrap, msg.role === 'user' && { alignItems: 'flex-end' }]}>
                  <View style={[
                    s.chatBubble,
                    msg.role === 'user' ? s.chatBubbleUser : s.chatBubbleAI,
                  ]}>
                    <Text style={[s.chatBubbleText, msg.role === 'user' && { color: '#fff' }]}>
                      {msg.content}
                    </Text>
                  </View>
                </View>
              ))}
              {chatLoading && (
                <View style={s.chatBubbleWrap}>
                  <View style={[s.chatBubble, s.chatBubbleAI, { paddingVertical: 10 }]}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                </View>
              )}
            </ScrollView>
          )}

          <View style={s.chatInputRow}>
            <TextInput
              style={s.chatInput}
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Ask anything about this company…"
              placeholderTextColor={colors.textMuted}
              returnKeyType="send"
              onSubmitEditing={handleSendChat}
              editable={!chatLoading}
              multiline={false}
            />
            <Pressable
              style={({ pressed }) => [s.chatSendBtn, (!chatInput.trim() || chatLoading) && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}
              onPress={handleSendChat}
              disabled={!chatInput.trim() || chatLoading}
            >
              <Feather name="send" size={16} color="#fff" />
            </Pressable>
          </View>
        </View>

        {/* Interview Prep */}
        <View style={s.card}>
          <View style={s.cardHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardLabel}>Interview Questions</Text>
              <Text style={s.cardSub}>AI-generated questions for this company</Text>
            </View>
            <Pressable
              style={({ pressed }) => [s.aiBtn, pressed && { opacity: 0.8 }]}
              onPress={handleInterviewPrep}
              disabled={interviewLoading}
            >
              {interviewLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Feather name="mic" size={14} color="#fff" />}
              <Text style={s.aiBtnText}>{interviewLoading ? 'Generating…' : interviewQ ? 'Refresh' : 'Generate'}</Text>
            </Pressable>
          </View>

          {!!interviewError && (
            <View style={s.inlineError}>
              <Feather name="alert-circle" size={13} color={colors.danger} />
              <Text style={[s.inlineErrorText, { color: colors.danger }]}>{interviewError}</Text>
            </View>
          )}
          {interviewQ ? (
            <ScrollView style={{ maxHeight: 480, marginTop: 12 }} showsVerticalScrollIndicator>
            <View style={{ gap: 14 }}>
              {[
                { title: 'Personal & Motivational', items: interviewQ.personal },
                { title: 'Company-specific', items: interviewQ.company },
                { title: 'Experience-based', items: interviewQ.experience },
              ].map(section => (
                <View key={section.title}>
                  <Text style={s.interviewSection}>{section.title}</Text>
                  {section.items?.map((q, i) => (
                    <View key={i} style={s.questionRow}>
                      <Text style={s.questionNum}>{i + 1}.</Text>
                      <Text style={s.questionText}>{q}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
            </ScrollView>
          ) : !interviewLoading && !interviewError ? (
            <Text style={[s.cardSub, { marginTop: 8 }]}>
              Tap Generate to get tailored interview questions for {company.name}.
            </Text>
          ) : null}
        </View>

        {/* Prep for this company */}
        <Pressable
          style={({ pressed }) => [s.prepBtn, pressed && { opacity: 0.9 }]}
          onPress={() => {
            const role = `WIL Placement – ${profile?.currentDegree || 'General'}`;
            router.push(`/(tabs)/prep?company=${encodeURIComponent(company.name)}&role=${encodeURIComponent(role)}&section=interview` as any);
          }}
        >
          <LinearGradient
            colors={['#6366f1', '#4f46e5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.prepBtnGradient}
          >
            <Feather name="mic" size={18} color="#fff" />
            <Text style={s.prepBtnText}>Prep for {company.name}</Text>
            <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.7)" />
          </LinearGradient>
        </Pressable>

        {/* Letter Writer */}
        <Pressable
          style={({ pressed }) => [s.letterBtn, pressed && { opacity: 0.9 }]}
          onPress={() => setShowLetterModal(true)}
        >
          <LinearGradient
            colors={['#14b8a6', '#0d9488']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.letterBtnGradient}
          >
            <Feather name="file-text" size={18} color="#fff" />
            <Text style={s.letterBtnText}>Write Application Letter</Text>
            <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.7)" />
          </LinearGradient>
        </Pressable>
      </ScrollView>

      {/* Letter Writer Modal */}
      <Modal
        visible={showLetterModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowLetterModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[s.modalContainer, { paddingTop: insets.top || 16 }]}>
            <View style={s.modalHeader}>
              <Pressable onPress={() => { setShowLetterModal(false); setLetter(''); setLetterError(''); }} style={s.closeBtn}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </Pressable>
              <Text style={s.modalTitle}>Write a Letter</Text>
              <View style={{ width: 36 }} />
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator indicatorStyle={colors.isDark ? 'white' : 'black'} keyboardShouldPersistTaps="handled">
              <View style={s.companyChip}>
                <Feather name="briefcase" size={13} color={colors.primary} />
                <Text style={s.companyChipText} numberOfLines={1}>{company.name}</Text>
              </View>

              <Text style={s.fieldLabel}>Letter Type</Text>
              <View style={s.segmentRow}>
                {LETTER_OP_TYPES.map(t => (
                  <Pressable
                    key={t.key}
                    onPress={() => setLetterOpType(t.key)}
                    style={[s.segment, letterOpType === t.key && s.segmentActive]}
                  >
                    <Text style={[s.segmentText, letterOpType === t.key && { color: '#fff' }]}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={s.fieldLabel}>Target Role (optional)</Text>
              <TextInput
                value={letterRole}
                onChangeText={setLetterRole}
                placeholder="e.g. Software Engineer Intern"
                placeholderTextColor={colors.textMuted}
                style={s.textInput}
                returnKeyType="next"
              />

              <Text style={s.fieldLabel}>Extra notes (optional)</Text>
              <TextInput
                value={letterDraft}
                onChangeText={setLetterDraft}
                placeholder="Add any specific points you'd like included…"
                placeholderTextColor={colors.textMuted}
                style={[s.textInput, { height: 80, textAlignVertical: 'top' }]}
                multiline
              />

              <Pressable
                style={({ pressed }) => [s.generateBtn, pressed && { opacity: 0.85 }, letterLoading && { opacity: 0.7 }]}
                onPress={() => setShowLetterConfirm(true)}
                disabled={letterLoading}
              >
                {letterLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Feather name="zap" size={16} color="#fff" />}
                <Text style={s.generateBtnText}>{letterLoading ? 'Writing letter…' : 'Generate Letter'}</Text>
              </Pressable>

              {letterError ? (
                <Text style={{ color: colors.danger, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 12, textAlign: 'center' }}>
                  {letterError}
                </Text>
              ) : null}

              {letter ? (
                <View style={s.letterBox}>
                  <Text style={s.letterText}>{letter}</Text>
                  <View style={{ gap: 10, marginTop: 16 }}>
                    <Pressable
                      style={[s.generateBtn, { backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder }]}
                      onPress={openLetterEditor}
                    >
                      <Feather name="edit-3" size={16} color={colors.primary} />
                      <Text style={[s.generateBtnText, { color: colors.primary }]}>Edit & Refine</Text>
                    </Pressable>
                    <Pressable
                      style={[s.generateBtn, { backgroundColor: colors.primary }]}
                      onPress={() => Share.share({ message: letter, title: `Application Letter – ${company.name}` })}
                    >
                      <Feather name="share-2" size={16} color="#fff" />
                      <Text style={s.generateBtnText}>Share Letter</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmDialog
        visible={showLetterConfirm}
        title="Generate Letter?"
        message="AI will write a personalised cover letter using your profile and research. This may take up to 45 seconds."
        confirmLabel="Generate"
        cancelLabel="Cancel"
        onConfirm={() => { setShowLetterConfirm(false); generateLetter(); }}
        onCancel={() => setShowLetterConfirm(false)}
      />
    </View>
  );
}

const styles = (colors: ReturnType<typeof import('@/hooks/useColors').useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  companyName: { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.text, letterSpacing: -0.5 },
  fitBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, flexShrink: 0,
  },
  fitText: { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 3,
  },
  cardLabel: {
    fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },
  cardSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted, lineHeight: 17 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  description: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 22 },
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  trackedCard: {
    backgroundColor: colors.card, borderRadius: 18, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: colors.success + '44',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 2,
  },
  trackedCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  trackedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.success + '18', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1, borderColor: colors.success + '44',
  },
  trackedBadgeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.success },
  miniPipeline: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, paddingHorizontal: 2 },
  miniDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  miniLine: { flex: 1, height: 2, marginHorizontal: 2 },
  trackedActions: { flexDirection: 'row', gap: 8 },
  trackedActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12,
    backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder,
  },
  trackedActionText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.primary },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14 },
  actionBtnPrimary: {
    backgroundColor: colors.primary,
    shadowColor: '#3730a3', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4,
  },
  actionBtnSuccess: {
    backgroundColor: colors.success,
    shadowColor: '#0d9488', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4,
  },
  actionBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  actionBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14,
    backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder,
  },
  actionBtnSecondaryText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.primary },
  contactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8 },
  contactText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flex: 1, lineHeight: 18 },
  contactLink: { color: colors.primary, fontFamily: 'Inter_500Medium' },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, flexShrink: 0,
  },
  aiBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  inlineError: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: 10, padding: 10, borderRadius: 10,
    backgroundColor: colors.dangerBg || 'rgba(239,68,68,0.08)',
    borderWidth: 1, borderColor: colors.dangerBorder || 'rgba(239,68,68,0.25)',
  },
  inlineErrorText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.dangerBorder || 'rgba(239,68,68,0.35)', backgroundColor: colors.dangerBg || 'rgba(239,68,68,0.1)' },
  retryBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  researchBox: {
    marginTop: 12, padding: 14,
    backgroundColor: colors.muted, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
  },
  researchText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 21 },
  groqBadge: {
    backgroundColor: colors.indigoBg, borderWidth: 1, borderColor: colors.indigoBorder,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  groqBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },
  chatStartersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  starterChip: {
    backgroundColor: colors.muted, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.border,
  },
  starterChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.textSecondary },
  chatHistory: { maxHeight: 520, marginTop: 12 },
  chatBubbleWrap: { alignItems: 'flex-start' },
  chatBubble: { maxWidth: '85%', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  chatBubbleUser: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  chatBubbleAI: {
    backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  chatBubbleText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.text, lineHeight: 20 },
  chatInputRow: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'flex-end' },
  chatInput: {
    flex: 1, backgroundColor: colors.muted, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.text,
    minHeight: 42,
  },
  chatSendBtn: {
    width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  interviewSection: {
    fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  questionRow: { flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'flex-start' },
  questionNum: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary, width: 20, flexShrink: 0 },
  questionText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flex: 1, lineHeight: 20 },
  prepBtn: { marginBottom: 10 },
  prepBtnGradient: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 16, borderRadius: 18,
  },
  prepBtnText: { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
  letterBtn: { marginBottom: 10 },
  letterBtnGradient: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 16, borderRadius: 18,
  },
  letterBtnText: { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.text },
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.indigoBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 20, borderWidth: 1, borderColor: colors.indigoBorder, alignSelf: 'flex-start',
  },
  companyChipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.primary },
  fieldLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8, marginTop: 16 },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
  },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textSecondary },
  textInput: {
    backgroundColor: colors.muted, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.text,
  },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#14b8a6', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, marginTop: 16,
  },
  generateBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  letterBox: {
    marginTop: 16, padding: 16,
    backgroundColor: colors.muted, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
  },
  letterText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 22 },
});
