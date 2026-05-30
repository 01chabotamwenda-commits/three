import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/context/AppContext';
import { aiService } from '@/lib/aiService';
import { useColors } from '@/hooks/useColors';
import { getCvContent } from '@/utils/docContext';

type InterviewStage =
  | 'pick'
  | 'loading-intel'
  | 'naming'
  | 'briefing'
  | 'interviewing'
  | 'loading-verdict'
  | 'verdict';

type DashboardTab = 'dashboard' | 'new';

interface SelectedCompany {
  name: string;
  role: string;
}

interface AnswerFeedback {
  question: string;
  answer: string;
  feedback: string;
  score: number;
}

interface VerdictResult {
  verdict: 'accepted' | 'shortlisted' | 'rejected';
  overallScore: number;
  overallFeedback: string;
  strengths: string[];
  areasToImprove: string[];
  answerFeedback: AnswerFeedback[];
  recommendation: string;
}

// ─── Score Ring (SVG) ────────────────────────────────────────────────────────
function ScoreRing({
  score,
  size = 48,
  colors,
}: {
  score: number;
  size?: number;
  colors: ReturnType<typeof useColors>;
}) {
  const strokeW = 3;
  const radius = (size - strokeW * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = score > 0 ? (score / 10) * circumference : 0;
  const cx = size / 2;
  const cy = size / 2;
  const ringColor =
    score >= 8 ? colors.success : score >= 5 ? colors.warning : colors.danger;
  const trackColor = colors.muted;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0 }}>
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeW}
        />
        {score > 0 && (
          <Circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={strokeW}
            strokeLinecap="round"
            strokeDasharray={`${progress} ${circumference}`}
            strokeDashoffset={0}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
      </Svg>
      <Text
        style={{
          fontSize: size < 44 ? 10 : 12,
          fontFamily: 'Inter_700Bold',
          color: score > 0 ? ringColor : colors.textMuted,
        }}
      >
        {score > 0 ? score.toFixed(1) : '—'}
      </Text>
    </View>
  );
}

// ─── Stat Ring (solid border circle with label) ─────────────────────────────
function StatRing({
  value,
  label,
  borderColor,
  bgColor,
  textColor,
}: {
  value: string | number;
  label: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
}) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          borderWidth: 2,
          borderColor,
          backgroundColor: bgColor,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 8,
        }}
      >
        <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: textColor }}>{value}</Text>
      </View>
      <Text style={{ fontSize: 10, fontFamily: 'Inter_500Medium', color: textColor, opacity: 0.7 }}>
        {label}
      </Text>
    </View>
  );
}

export default function InterviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { profile, applications, docs, interviewSessions, addInterview, updateInterview, deleteInterview, updateApplication } =
    useApp();
  const s = styles(colors);
  const params = useLocalSearchParams<{ company?: string; role?: string }>();

  const topPad = Platform.OS === 'web' ? 16 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 16 : insets.bottom;

  const [stage, setStage] = useState<InterviewStage>('pick');
  const [tab, setTab] = useState<DashboardTab>('dashboard');
  const [customCompany, setCustomCompany] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [selected, setSelected] = useState<SelectedCompany | null>(null);

  const autoStarted = useRef(false);
  const initialCompany = params.company ? decodeURIComponent(params.company) : undefined;
  const initialRole = params.role ? decodeURIComponent(params.role) : undefined;

  useEffect(() => {
    if (initialCompany && !autoStarted.current && stage === 'pick') {
      autoStarted.current = true;
      startWithCompany({
        name: initialCompany,
        role: initialRole || `WIL Placement / ${profile?.currentDegree || 'General'}`,
      });
    }
  }, [initialCompany]);

  const [stageError, setStageError] = useState('');
  const [researchSummary, setResearchSummary] = useState('');
  const [questions, setQuestions] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [verdict, setVerdict] = useState<VerdictResult | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionNameInput, setSessionNameInput] = useState('');
  const [showExitDialog, setShowExitDialog] = useState(false);
  const chatRef = useRef<ScrollView>(null);
  const recognitionRef = useRef<any>(null);

  // ── Computed stats ──────────────────────────────────────────────────────────
  const completedSessions = interviewSessions.filter(s => s.status === 'completed' && s.verdict);
  const avgScore =
    completedSessions.length > 0
      ? completedSessions.reduce((sum, s) => sum + (s.verdict?.overallScore ?? 0), 0) /
        completedSessions.length
      : 0;
  const bestScore =
    completedSessions.length > 0
      ? Math.max(...completedSessions.map(s => s.verdict?.overallScore ?? 0))
      : 0;

  function toggleVoice() {
    if (Platform.OS !== 'web') {
      Alert.alert('Voice input', 'Voice input is available on the web version. Please type your answer here.');
      return;
    }
    const win = window as any;
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) {
      Alert.alert('Voice not supported', 'Please type your answer.');
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const r = new SR();
    recognitionRef.current = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onstart = () => setIsListening(true);
    r.onend = () => setIsListening(false);
    r.onerror = () => setIsListening(false);
    r.onresult = (e: any) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setCurrentAnswer(t);
    };
    r.start();
  }

  function resetInterview() {
    recognitionRef.current?.stop();
    setIsListening(false);
    setStage('pick');
    setSelected(null);
    setResearchSummary('');
    setQuestions([]);
    setCurrentIdx(0);
    setAnswers([]);
    setCurrentAnswer('');
    setVerdict(null);
    setShowCustomInput(false);
    setCustomCompany('');
    setCustomRole('');
  }

  async function startWithCompany(company: SelectedCompany) {
    setSelected(company);
    setStageError('');
    setStage('loading-intel');
    try {
      const [researchData, questionsData] = await Promise.all([
        aiService.researchCompany({ companyName: company.name }),
        aiService.interviewQuestions({
          companyName: company.name,
          role: company.role,
          degree: profile?.currentDegree || 'General',
          goals: profile?.careerGoals || '',
          institution: profile?.institution || '',
          yearOfStudy: profile?.yearOfStudy || '',
          skills: profile?.skills || '',
          cvContent: getCvContent(docs),
        }),
      ]);

      const qData = questionsData as { personal: string[]; company: string[]; experience: string[] };
      const allQuestions = [...qData.personal, ...qData.company, ...qData.experience].slice(0, 8);
      if (allQuestions.length === 0) throw new Error('no-questions');

      setResearchSummary((researchData as { summary: string }).summary);
      setQuestions(allQuestions);

      const defaultName = `Mock Interview #${
        interviewSessions.filter(s => s.company.toLowerCase() === company.name.toLowerCase()).length + 1
      }`;
      setSessionNameInput(defaultName);
      setStage('naming');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not load company data. Check your internet connection.';
      setStageError(msg);
      setStage('pick');
    }
  }

  async function confirmSessionName() {
    if (!selected || !sessionNameInput.trim()) {
      Alert.alert('Name required', 'Give your session a name.');
      return;
    }
    const trimmed = sessionNameInput.trim();
    const exists = interviewSessions.find(
      s =>
        s.company.toLowerCase() === selected.name.toLowerCase() &&
        s.title.toLowerCase() === trimmed.toLowerCase()
    );
    if (exists && exists.status !== 'completed') {
      Alert.alert('Session exists', 'An active session with that name already exists.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resume',
          onPress: () => {
            setActiveSessionId(exists.id);
            setQuestions(exists.questions);
            setCurrentIdx(exists.answers.length);
            setAnswers(exists.answers);
            setResearchSummary(exists.researchSummary || '');
            setStage('interviewing');
          },
        },
      ]);
      return;
    }
    const newSession = await addInterview({
      title: trimmed,
      company: selected.name,
      role: selected.role,
      questions,
      answers: [],
      researchSummary,
      status: 'in-progress',
    });
    setActiveSessionId(newSession.id);
    setStage('briefing');
  }

  async function submitAnswer() {
    if (!selected || !currentAnswer.trim()) return;
    const updated = [...answers, currentAnswer.trim()];
    setAnswers(updated);
    setCurrentAnswer('');
    if (activeSessionId) {
      await updateInterview(activeSessionId, { answers: updated });
    }
    if (currentIdx + 1 >= questions.length) {
      setStage('loading-verdict');
      try {
        const verdictData = (await aiService.interviewVerdict({
          companyName: selected.name,
          role: selected.role,
          degree: profile?.currentDegree || '',
          goals: profile?.careerGoals || '',
          skills: profile?.skills || '',
          questions,
          answers: updated,
          researchSummary,
        })) as unknown as VerdictResult;
        setVerdict(verdictData);
        if (activeSessionId) {
          await updateInterview(activeSessionId, { status: 'completed', verdict: verdictData });
        }
        const app = applications.find(
          a => a.companyName.toLowerCase() === selected.name.toLowerCase()
        );
        if (app && app.status === 'Applied') {
          updateApplication(app.id, { status: 'Interviewing' });
        }
        setStage('verdict');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Could not generate feedback. Check your internet connection.';
        setStageError(msg);
        setStage('interviewing');
      }
    } else {
      setCurrentIdx(currentIdx + 1);
    }
  }

  const VERDICT_META = {
    accepted: { color: colors.success, bg: colors.successBg, border: colors.successBorder, icon: 'check-circle' as const, label: 'ACCEPTED' },
    shortlisted: { color: colors.warning, bg: colors.warningBg, border: colors.warningBorder, icon: 'star' as const, label: 'SHORTLISTED' },
    rejected: { color: colors.danger, bg: colors.dangerBg, border: colors.dangerBorder, icon: 'x-circle' as const, label: 'NOT SELECTED' },
  };

  function scoreColor(score: number) {
    if (score >= 8) return colors.success;
    if (score >= 5) return colors.warning;
    return colors.danger;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PICK stage — dashboard / new session
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === 'pick') {
    return (
      <View style={[s.screen, { paddingTop: topPad, paddingBottom: bottomPad }]}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Pressable style={s.backBtn} onPress={() => router.back()} android_ripple={{ color: colors.indigoBg }}>
              <Feather name="arrow-left" size={18} color={colors.text} />
            </Pressable>
            <View>
              <Text style={s.headerTitle}>Interview Sim</Text>
              <Text style={s.headerSubtitle}>AI-powered practice sessions</Text>
            </View>
          </View>
        </View>

        {/* Stage error banner */}
        {!!stageError && (
          <Pressable
            style={[s.stageErrorBanner, { backgroundColor: colors.dangerBg || 'rgba(239,68,68,0.08)', borderColor: colors.dangerBorder || 'rgba(239,68,68,0.25)' }]}
            onPress={() => setStageError('')}
          >
            <Feather name="alert-circle" size={13} color={colors.danger} />
            <Text style={[s.stageErrorText, { color: colors.danger }]}>{stageError}</Text>
            <Feather name="x" size={12} color={colors.danger} />
          </Pressable>
        )}

        {/* Tab toggle */}
        <View style={s.tabBar}>
          <View style={s.tabPill}>
            {(['dashboard', 'new'] as const).map(v => (
              <Pressable
                key={v}
                style={[s.tabBtn, tab === v && s.tabBtnActive]}
                onPress={() => setTab(v)}
              >
                <Text style={[s.tabBtnText, tab === v && s.tabBtnTextActive]}>
                  {v === 'dashboard' ? 'Dashboard' : 'New Session'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad + 32 }}
          showsVerticalScrollIndicator
          indicatorStyle={colors.isDark ? 'white' : 'black'}
        >
          {/* ── DASHBOARD ── */}
          {tab === 'dashboard' && (
            <>
              {/* Performance card */}
              <View style={s.perfCard}>
                <Text style={s.perfCardLabel}>PERFORMANCE</Text>
                <View style={s.perfStats}>
                  {/* Avg score ring */}
                  <View style={{ alignItems: 'center' }}>
                    <ScoreRing score={Math.round(avgScore * 10) / 10} size={56} colors={{...colors, success: colors.score, warning: colors.score, danger: colors.score} as any} />
                    <Text style={s.statLabel}>Avg Score</Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <ScoreRing score={interviewSessions.length ? 10 : 0} size={56} colors={{...colors, success: colors.primary, warning: colors.primary, danger: colors.primary} as any} />
                    <Text style={s.statLabel}>Sessions</Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <ScoreRing score={bestScore > 0 ? 10 : 0} size={56} colors={{...colors, success: colors.success, warning: colors.success, danger: colors.success} as any} />
                    <Text style={s.statLabel}>Best Score</Text>
                  </View>
                </View>
              </View>

              {/* Recent sessions */}
              <Text style={s.sectionLabel}>Recent Sessions</Text>
              {interviewSessions.length === 0 ? (
                <View style={s.emptyState}>
                  <View style={[s.emptyIcon, { backgroundColor: colors.indigoBg }]}>
                    <Feather name="users" size={24} color={colors.primary} />
                  </View>
                  <Text style={s.emptyTitle}>No sessions yet</Text>
                  <Text style={s.emptySubtitle}>
                    Start a practice session from the New Session tab.
                  </Text>
                  <Pressable
                    style={[s.primaryBtn, { marginTop: 8, paddingHorizontal: 28 }]}
                    onPress={() => setTab('new')}
                  >
                    <Text style={s.primaryBtnText}>Start Practising</Text>
                  </Pressable>
                </View>
              ) : (
                interviewSessions
                  .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
                  .slice(0, 8)
                  .map(session => {
                    const score = session.verdict?.overallScore ?? 0;
                    const isLive = session.status !== 'completed';
                    return (
                      <Pressable
                        key={session.id}
                        style={[
                          s.sessionCard,
                          isLive && { borderColor: colors.primary, backgroundColor: colors.indigoBg },
                        ]}
                        onPress={() => {
                          if (isLive) {
                            setSelected({ name: session.company, role: session.role });
                            setActiveSessionId(session.id);
                            setQuestions(session.questions);
                            setCurrentIdx(session.answers.length);
                            setAnswers(session.answers);
                            setResearchSummary(session.researchSummary || '');
                            setStage('interviewing');
                          } else if (session.verdict) {
                            setSelected({ name: session.company, role: session.role });
                            setVerdict(session.verdict as VerdictResult);
                            setStage('verdict');
                          }
                        }}
                        android_ripple={{ color: colors.indigoBg }}
                      >
                        <View style={s.sessionCardTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.sessionCompany} numberOfLines={1}>{session.company}</Text>
                            <Text style={s.sessionRole} numberOfLines={1}>{session.role}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 6 }}>
                            <ScoreRing score={score} size={40} colors={colors} />
                            <View
                              style={[
                                s.statusChip,
                                {
                                  backgroundColor: isLive ? (colors as any).liveBg : colors.successBg,
                                  borderColor: isLive ? (colors as any).liveBorder : colors.successBorder,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  s.statusChipText,
                                  { color: isLive ? (colors as any).live : colors.success },
                                ]}
                              >
                                {isLive ? 'LIVE' : 'DONE'}
                              </Text>
                            </View>
                          </View>
                        </View>
                        <View style={s.sessionCardBottom}>
                          <Text style={s.sessionMeta}>{session.questions.length} questions</Text>
                          <Text style={s.sessionMeta}>
                            {new Date(session.startedAt).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })
              )}
            </>
          )}

          {/* ── NEW SESSION ── */}
          {tab === 'new' && (
            <>
              <Text style={s.stepLabel}>Choose a company to practice with</Text>

              {/* Custom company card */}
              <Pressable
                style={s.companyCard}
                onPress={() => setShowCustomInput(c => !c)}
                android_ripple={{ color: colors.indigoBg }}
              >
                <View style={[s.companyAvatar, { backgroundColor: colors.purpleBg, borderColor: colors.purpleBorder }]}>
                  <Feather name="plus" size={20} color={colors.purple} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.companyCardName}>Custom Company</Text>
                  <Text style={s.companyCardRole}>Enter any company name and role</Text>
                </View>
                <Feather
                  name={showCustomInput ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textMuted}
                />
              </Pressable>

              {showCustomInput && (
                <View style={s.customForm}>
                  <Text style={s.inputLabel}>COMPANY NAME</Text>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. Zamtel, PwC Zambia..."
                    placeholderTextColor={colors.textMuted}
                    value={customCompany}
                    onChangeText={setCustomCompany}
                  />
                  <Text style={[s.inputLabel, { marginTop: 12 }]}>ROLE / POSITION</Text>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. Software Engineer Intern"
                    placeholderTextColor={colors.textMuted}
                    value={customRole}
                    onChangeText={setCustomRole}
                  />
                  <Pressable
                    style={[
                      s.primaryBtn,
                      { marginTop: 16 },
                      (!customCompany.trim() || !customRole.trim()) && { opacity: 0.5 },
                    ]}
                    onPress={() =>
                      customCompany.trim() &&
                      customRole.trim() &&
                      startWithCompany({ name: customCompany.trim(), role: customRole.trim() })
                    }
                    disabled={!customCompany.trim() || !customRole.trim()}
                  >
                    <Feather name="play" size={15} color="#fff" />
                    <Text style={s.primaryBtnText}>Start Interview</Text>
                  </Pressable>
                </View>
              )}

              {/* Applications list */}
              {applications.length === 0 ? (
                <View style={s.emptyState}>
                  <View style={[s.emptyIcon, { backgroundColor: colors.indigoBg }]}>
                    <Feather name="briefcase" size={24} color={colors.primary} />
                  </View>
                  <Text style={s.emptyTitle}>No saved companies</Text>
                  <Text style={s.emptySubtitle}>
                    Save a company in the Companies tab to practice for it, or use Custom Company above.
                  </Text>
                </View>
              ) : (
                applications.map(app => (
                  <Pressable
                    key={app.id}
                    style={s.companyCard}
                    onPress={() => startWithCompany({ name: app.companyName, role: app.role || 'WIL Placement' })}
                    android_ripple={{ color: colors.indigoBg }}
                  >
                    <View style={s.companyAvatar}>
                      <Text style={s.companyAvatarText}>{app.companyName.charAt(0)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.companyCardName}>{app.companyName}</Text>
                      <Text style={s.companyCardRole}>{app.role || 'WIL Placement'}</Text>
                      <View style={s.companyTags}>
                        <View style={s.companyTagDot} />
                        <Text style={s.companyTagText}>Technical · Behavioural · Case study</Text>
                      </View>
                    </View>
                    <View
                      style={[
                        s.statusChip,
                        {
                          backgroundColor:
                            app.status === 'Interviewing' ? colors.purpleBg
                            : app.status === 'Offer' || app.status === 'Accepted' ? colors.successBg
                            : app.status === 'Rejected' ? colors.dangerBg
                            : colors.indigoBg,
                          borderColor:
                            app.status === 'Interviewing' ? colors.purpleBorder
                            : app.status === 'Offer' || app.status === 'Accepted' ? colors.successBorder
                            : app.status === 'Rejected' ? colors.dangerBorder
                            : colors.indigoBorder,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          s.statusChipText,
                          {
                            color:
                              app.status === 'Interviewing' ? colors.purple
                              : app.status === 'Offer' || app.status === 'Accepted' ? colors.success
                              : app.status === 'Rejected' ? colors.danger
                              : colors.primary,
                          },
                        ]}
                      >
                        {app.status}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOADING stages
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === 'loading-intel' || stage === 'loading-verdict') {
    return (
      <View style={[s.screen, { paddingTop: topPad, justifyContent: 'center', alignItems: 'center' }]}>
        <View style={[s.spinnerCircle, { backgroundColor: colors.indigoBg, marginBottom: 24 }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
        <Text style={s.loadingTitle}>
          {stage === 'loading-intel' ? 'Researching the company...' : 'Analysing your answers...'}
        </Text>
        <Text style={s.loadingSub}>
          {stage === 'loading-intel'
            ? 'Personalising your interview questions'
            : 'Preparing your feedback report'}
        </Text>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NAMING stage
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === 'naming' && selected) {
    return (
      <KeyboardAvoidingView
        style={[s.screen, { paddingTop: topPad, paddingBottom: bottomPad }]}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.companyHeader}>
            <View style={s.companyAvatar}>
              <Text style={s.companyAvatarText}>{selected.name.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.sessionCompanyBig}>{selected.name}</Text>
              <Text style={s.sessionRoleSmall}>{selected.role}</Text>
            </View>
          </View>

          <Text style={s.inputLabel}>SESSION NAME</Text>
          <TextInput
            style={s.input}
            value={sessionNameInput}
            onChangeText={setSessionNameInput}
            placeholder="e.g. Mock Interview #1"
            placeholderTextColor={colors.textMuted}
            autoFocus
          />

          <Pressable
            style={[s.primaryBtn, !sessionNameInput.trim() && { opacity: 0.5 }]}
            onPress={confirmSessionName}
            disabled={!sessionNameInput.trim()}
          >
            <Feather name="play" size={15} color="#fff" />
            <Text style={s.primaryBtnText}>Start Interview</Text>
          </Pressable>

          <Pressable style={s.backLink} onPress={resetInterview}>
            <Feather name="arrow-left" size={14} color={colors.textMuted} />
            <Text style={s.backLinkText}>Choose a different company</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BRIEFING stage
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === 'briefing' && selected) {
    return (
      <ScrollView
        style={[s.screen, { paddingTop: topPad }]}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad + 24 }}
        showsVerticalScrollIndicator
        indicatorStyle={colors.isDark ? 'white' : 'black'}
      >
        <View style={s.companyHeader}>
          <View style={s.companyAvatar}>
            <Text style={s.companyAvatarText}>{selected.name.charAt(0)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.sessionCompanyBig}>{selected.name}</Text>
            <Text style={s.sessionRoleSmall}>{selected.role}</Text>
          </View>
        </View>

        {!!researchSummary && (
          <View style={s.infoCard}>
            <View style={s.infoCardHeader}>
              <Feather name="globe" size={13} color={colors.primary} />
              <Text style={s.infoCardTitle}>Company Snapshot</Text>
            </View>
            <Text style={s.infoCardText}>{researchSummary}</Text>
          </View>
        )}

        <View style={s.tipsCard}>
          <Text style={s.tipsTitle}>INTERVIEW TIPS</Text>
          {[
            'Answer as if you are in a real interview.',
            '60–90 seconds per answer is ideal.',
            'Use the STAR method: Situation, Task, Action, Result.',
            'Mention specific skills and experiences from your CV.',
            "You'll receive a score and personalised feedback at the end.",
          ].map((tip, i) => (
            <View key={i} style={s.tipRow}>
              <View style={s.tipDot} />
              <Text style={s.tipText}>{tip}</Text>
            </View>
          ))}
        </View>

        <Pressable style={s.primaryBtn} onPress={() => setStage('interviewing')}>
          <Feather name="play" size={15} color="#fff" />
          <Text style={s.primaryBtnText}>Begin Interview</Text>
        </Pressable>

        <Pressable style={s.backLink} onPress={resetInterview}>
          <Feather name="arrow-left" size={14} color={colors.textMuted} />
          <Text style={s.backLinkText}>Choose a different company</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERVIEWING stage
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === 'interviewing' && selected) {
    const progress = questions.length > 0 ? (currentIdx / questions.length) * 100 : 0;
    return (
      <KeyboardAvoidingView
        style={[s.screen, { paddingTop: topPad, paddingBottom: bottomPad }]}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        {/* Interview header */}
        <View style={s.interviewHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.interviewCompany} numberOfLines={1}>
              {selected.name} · {selected.role}
            </Text>
            <Text style={s.interviewProgress}>
              Question {currentIdx + 1} of {questions.length}
            </Text>
          </View>
          <Pressable onPress={() => setShowExitDialog(true)} hitSlop={8}>
            <Feather name="x" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* ── Exit confirmation dialog ── */}
        <Modal
          visible={showExitDialog}
          transparent
          animationType="fade"
          onRequestClose={() => setShowExitDialog(false)}
        >
          <Pressable
            style={s.dialogOverlay}
            onPress={() => setShowExitDialog(false)}
          >
            <Pressable style={s.dialogBox} onPress={() => {}}>
              <View style={s.dialogIconWrap}>
                <Feather name="alert-circle" size={28} color={colors.warning} />
              </View>
              <Text style={s.dialogTitle}>End this interview?</Text>
              <Text style={s.dialogSubtitle}>
                Your answers so far are saved automatically. Choose what to do with this session.
              </Text>

              {/* Save as Draft */}
              <Pressable
                style={[s.dialogBtn, { backgroundColor: colors.indigoBg, borderColor: colors.indigoBorder }]}
                onPress={() => {
                  setShowExitDialog(false);
                  resetInterview();
                }}
              >
                <Feather name="save" size={16} color={colors.primary} />
                <Text style={[s.dialogBtnText, { color: colors.primary }]}>Save as Draft</Text>
              </Pressable>

              {/* Delete Interview */}
              <Pressable
                style={[s.dialogBtn, { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder }]}
                onPress={async () => {
                  setShowExitDialog(false);
                  if (activeSessionId) await deleteInterview(activeSessionId);
                  resetInterview();
                }}
              >
                <Feather name="trash-2" size={16} color={colors.danger} />
                <Text style={[s.dialogBtnText, { color: colors.danger }]}>Delete Interview</Text>
              </Pressable>

              {/* Cancel */}
              <Pressable
                style={s.dialogCancelBtn}
                onPress={() => setShowExitDialog(false)}
              >
                <Text style={s.dialogCancelText}>Keep Going</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Progress bar */}
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${progress}%` as any }]} />
        </View>

        <ScrollView
          ref={chatRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: true })}
        >
          {answers.map((ans, i) => (
            <View key={i} style={{ marginBottom: 16 }}>
              <View style={s.questionBubble}>
                <Feather name="cpu" size={12} color={colors.primary} style={{ marginTop: 2 }} />
                <Text style={s.questionText}>{questions[i]}</Text>
              </View>
              <View style={s.answerBubble}>
                <Feather name="user" size={12} color={colors.textSecondary} style={{ marginTop: 2 }} />
                <Text style={s.answerText}>{ans}</Text>
              </View>
            </View>
          ))}
          <View style={[s.questionBubble, s.questionBubbleCurrent]}>
            <Feather name="cpu" size={13} color={colors.primary} style={{ marginTop: 2 }} />
            <Text style={[s.questionText, { color: colors.text }]}>{questions[currentIdx]}</Text>
          </View>
        </ScrollView>

        <View style={[s.answerInputArea, { paddingBottom: bottomPad + 8 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <Pressable
              onPress={toggleVoice}
              style={[s.micBtn, isListening && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              accessibilityLabel={isListening ? 'Stop listening' : 'Speak your answer'}
              accessibilityRole="button"
            >
              <Feather
                name={isListening ? 'mic-off' : 'mic'}
                size={20}
                color={isListening ? '#fff' : colors.primary}
              />
            </Pressable>
            <TextInput
              style={[s.answerInput, { flex: 1 }]}
              placeholder={isListening ? 'Listening… speak now' : 'Type your answer…'}
              placeholderTextColor={isListening ? colors.primary : colors.textMuted}
              value={currentAnswer}
              onChangeText={setCurrentAnswer}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>
          <Pressable
            style={[s.primaryBtn, { marginBottom: 0 }]}
            onPress={submitAnswer}
            android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
          >
            <Text style={s.primaryBtnText}>
              {currentIdx + 1 === questions.length ? 'Finish Interview' : 'Next Question'}
            </Text>
            <Feather
              name={currentIdx + 1 === questions.length ? 'flag' : 'arrow-right'}
              size={15}
              color="#fff"
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VERDICT stage
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === 'verdict' && verdict && selected) {
    const meta = VERDICT_META[verdict.verdict] ?? VERDICT_META.rejected;
    return (
      <ScrollView
        style={[s.screen, { paddingTop: topPad }]}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad + 24 }}
        showsVerticalScrollIndicator
        indicatorStyle={colors.isDark ? 'white' : 'black'}
      >
        {/* Verdict banner */}
        <View style={[s.verdictBanner, { backgroundColor: meta.bg, borderColor: meta.border }]}>
          {/* Large score ring */}
          <ScoreRing score={verdict.overallScore} size={80} colors={colors} />
          <Feather name={meta.icon} size={28} color={meta.color} />
          <Text style={[s.verdictLabel, { color: meta.color }]}>{meta.label}</Text>
          <Text style={[s.verdictCompany, { color: meta.color }]}>
            {selected.name} · {selected.role}
          </Text>
        </View>

        {/* Overall assessment */}
        <View style={s.infoCard}>
          <Text style={s.infoCardTitle}>Overall Assessment</Text>
          <Text style={s.infoCardText}>{verdict.overallFeedback}</Text>
        </View>

        {/* Strengths */}
        <View style={s.infoCard}>
          <Text style={s.infoCardTitle}>What You Did Well</Text>
          {verdict.strengths.map((str, i) => (
            <View key={i} style={s.tipRow}>
              <Feather name="check-circle" size={13} color={colors.success} style={{ marginTop: 2, flexShrink: 0 }} />
              <Text style={s.tipText}>{str}</Text>
            </View>
          ))}
        </View>

        {/* Improve */}
        <View style={s.infoCard}>
          <Text style={s.infoCardTitle}>Areas to Improve</Text>
          {verdict.areasToImprove.map((area, i) => (
            <View key={i} style={s.tipRow}>
              <Feather name="alert-circle" size={13} color={colors.warning} style={{ marginTop: 2, flexShrink: 0 }} />
              <Text style={s.tipText}>{area}</Text>
            </View>
          ))}
        </View>

        {/* Per-question breakdown */}
        <Text style={s.sectionLabel}>Answer Breakdown</Text>
        {verdict.answerFeedback.map((af, i) => (
          <View key={i} style={s.afCard}>
            <View style={s.afCardHeader}>
              <Text style={s.afNum}>Q{i + 1}</Text>
              <ScoreRing score={af.score} size={36} colors={colors} />
            </View>
            <Text style={s.afQuestion}>{af.question}</Text>
            <View style={[s.afAnswerBox, { backgroundColor: colors.muted }]}>
              <Text style={s.afAnswerLabel}>YOUR ANSWER</Text>
              <Text style={s.afAnswerText}>{af.answer}</Text>
            </View>
            <Text style={s.afFeedback}>{af.feedback}</Text>
          </View>
        ))}

        {/* Recommendation */}
        <View style={[s.infoCard, { borderColor: colors.indigoBorder, backgroundColor: colors.indigoBg }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Feather name="compass" size={13} color={colors.primary} />
            <Text style={[s.infoCardTitle, { color: colors.primary }]}>Personal Recommendation</Text>
          </View>
          <Text style={s.infoCardText}>{verdict.recommendation}</Text>
        </View>

        {/* Actions */}
        <Pressable
          style={s.primaryBtn}
          onPress={() => {
            setCurrentIdx(0);
            setAnswers([]);
            setCurrentAnswer('');
            setVerdict(null);
            setStage('briefing');
          }}
        >
          <Feather name="refresh-cw" size={15} color="#fff" />
          <Text style={s.primaryBtnText}>Practice Again</Text>
        </Pressable>
        <Pressable style={s.outlineBtn} onPress={resetInterview}>
          <Text style={s.outlineBtnText}>Try a Different Company</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return null;
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },

    // ── Header
    stageErrorBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      marginHorizontal: 20, marginBottom: 6, marginTop: 2,
      paddingHorizontal: 12, paddingVertical: 9,
      borderRadius: 10, borderWidth: 1,
    },
    stageErrorText: {
      flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 16,
    },
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

    // ── Tabs
    tabBar: { paddingHorizontal: 20, paddingBottom: 16 },
    tabPill: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 4,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 12,
      alignItems: 'center',
    },
    tabBtnActive: { backgroundColor: colors.indigoBg },
    tabBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
    tabBtnTextActive: { color: colors.primary },

    // ── Performance card
    perfCard: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 20,
      marginBottom: 20,
    },
    perfCardLabel: {
      fontSize: 10,
      fontFamily: 'Inter_700Bold',
      color: colors.textMuted,
      letterSpacing: 0.8,
      marginBottom: 16,
    },
    perfStats: { flexDirection: 'row', alignItems: 'center', gap: 24 },
    statLabel: {
      fontSize: 10,
      fontFamily: 'Inter_500Medium',
      color: colors.textMuted,
      marginTop: 6,
      textAlign: 'center',
    },

    // ── Session cards
    sectionLabel: {
      fontSize: 10,
      fontFamily: 'Inter_700Bold',
      color: colors.textMuted,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginBottom: 12,
    },
    sessionCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 12,
    },
    sessionCardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
    sessionCompany: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.text, marginBottom: 3 },
    sessionRole: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted },
    sessionCardBottom: {
      flexDirection: 'row',
      gap: 16,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    sessionMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted },

    // ── Status chip
    statusChip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
      borderWidth: 1,
    },
    statusChipText: { fontSize: 10, fontFamily: 'Inter_700Bold' },

    // ── Company cards (New Session)
    stepLabel: {
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
      color: colors.textMuted,
      marginBottom: 16,
      marginTop: 4,
    },
    companyCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
    },
    companyAvatar: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: colors.indigoBg,
      borderWidth: 1,
      borderColor: colors.indigoBorder,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    companyAvatarText: { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.primary },
    companyCardName: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.text, marginBottom: 2 },
    companyCardRole: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textMuted, marginBottom: 6 },
    companyTags: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    companyTagDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    companyTagText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted },

    // ── Custom form
    customForm: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.indigoBorder,
      padding: 16,
      marginBottom: 16,
    },
    inputLabel: {
      fontSize: 10,
      fontFamily: 'Inter_700Bold',
      color: colors.textMuted,
      letterSpacing: 0.6,
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.text,
    },

    // ── Empty state
    emptyState: { alignItems: 'center', paddingVertical: 40, gap: 10 },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text },
    emptySubtitle: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 20,
      maxWidth: 260,
    },

    // ── Buttons
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 18,
      paddingVertical: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 12,
    },
    primaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
    outlineBtn: {
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: colors.indigoBorder,
      paddingVertical: 16,
      alignItems: 'center',
      backgroundColor: colors.indigoBg,
      marginBottom: 12,
    },
    outlineBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.primary },
    backLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      justifyContent: 'center',
      paddingVertical: 16,
    },
    backLinkText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textMuted },

    // ── Loading
    spinnerCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadingTitle: {
      fontSize: 18,
      fontFamily: 'Inter_700Bold',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    loadingSub: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
      textAlign: 'center',
    },

    // ── Company header (naming / briefing)
    companyHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      marginBottom: 24,
    },
    sessionCompanyBig: {
      fontSize: 18,
      fontFamily: 'Inter_700Bold',
      color: colors.text,
      letterSpacing: -0.3,
    },
    sessionRoleSmall: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
      marginTop: 3,
    },

    // ── Info card
    infoCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 18,
      marginBottom: 14,
    },
    infoCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    infoCardTitle: {
      fontSize: 11,
      fontFamily: 'Inter_700Bold',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 10,
    },
    infoCardText: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.textSecondary,
      lineHeight: 22,
    },

    // ── Tips card
    tipsCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 18,
      marginBottom: 20,
    },
    tipsTitle: {
      fontSize: 10,
      fontFamily: 'Inter_700Bold',
      color: colors.textMuted,
      letterSpacing: 0.8,
      marginBottom: 14,
    },
    tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
    tipDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
      marginTop: 7,
      flexShrink: 0,
    },
    tipText: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
      lineHeight: 20,
      flex: 1,
    },

    // ── Interview header
    interviewHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    interviewCompany: {
      fontSize: 13,
      fontFamily: 'Inter_600SemiBold',
      color: colors.text,
      marginBottom: 3,
    },
    interviewProgress: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
    },
    progressTrack: { height: 3, backgroundColor: colors.muted },
    progressFill: { height: 3, backgroundColor: colors.primary, borderRadius: 2 },

    // ── Chat bubbles
    questionBubble: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 8,
    },
    questionBubbleCurrent: {
      borderColor: colors.indigoBorder,
      backgroundColor: colors.indigoBg,
    },
    questionText: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.textSecondary,
      lineHeight: 22,
      flex: 1,
    },
    answerBubble: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      backgroundColor: colors.muted,
      borderRadius: 16,
      padding: 14,
      marginLeft: 20,
    },
    answerText: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.textSecondary,
      lineHeight: 20,
      flex: 1,
    },

    // ── Answer input
    answerInputArea: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      padding: 16,
      gap: 12,
      backgroundColor: colors.background,
    },
    answerInput: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.text,
      minHeight: 80,
      textAlignVertical: 'top',
    },
    micBtn: {
      width: 48,
      height: 80,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.indigoBorder,
      backgroundColor: colors.indigoBg,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },

    // ── Verdict
    verdictBanner: {
      borderRadius: 24,
      borderWidth: 1,
      padding: 28,
      alignItems: 'center',
      marginBottom: 20,
      gap: 10,
    },
    verdictLabel: {
      fontSize: 24,
      fontFamily: 'Inter_700Bold',
      letterSpacing: 2,
      textTransform: 'uppercase',
    },
    verdictCompany: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      opacity: 0.8,
      textAlign: 'center',
    },

    // ── Answer feedback
    afCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 18,
      marginBottom: 12,
    },
    afCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    afNum: {
      fontSize: 11,
      fontFamily: 'Inter_700Bold',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    afQuestion: {
      fontSize: 13,
      fontFamily: 'Inter_600SemiBold',
      color: colors.text,
      lineHeight: 20,
      marginBottom: 10,
    },
    afAnswerBox: { borderRadius: 10, padding: 12, marginBottom: 10 },
    afAnswerLabel: {
      fontSize: 9,
      fontFamily: 'Inter_700Bold',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 4,
    },
    afAnswerText: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.textSecondary,
      lineHeight: 18,
    },
    afFeedback: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.textSecondary,
      lineHeight: 20,
    },

    // ── Exit dialog
    dialogOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    dialogBox: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 24,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    dialogIconWrap: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.warningBg,
      borderWidth: 1,
      borderColor: colors.warningBorder,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    dialogTitle: {
      fontSize: 18,
      fontFamily: 'Inter_700Bold',
      color: colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    dialogSubtitle: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 19,
      marginBottom: 20,
    },
    dialogBtn: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 13,
      borderRadius: 12,
      borderWidth: 1,
      marginBottom: 10,
    },
    dialogBtnText: {
      fontSize: 15,
      fontFamily: 'Inter_600SemiBold',
    },
    dialogCancelBtn: {
      paddingVertical: 10,
      marginTop: 4,
    },
    dialogCancelText: {
      fontSize: 14,
      fontFamily: 'Inter_500Medium',
      color: colors.textMuted,
    },
  });
