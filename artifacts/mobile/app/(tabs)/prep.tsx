import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

export default function PrepHub() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { savedLetters, interviewSessions } = useApp();
  const s = styles(colors);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 72 : insets.bottom + 56;

  const completedInterviews = interviewSessions.filter(s => s.status === 'completed').length;
  const draftLetters = savedLetters.filter(l => l.status === 'draft').length;

  return (
    <View style={[s.screen, { paddingTop: topPad }]}>
      <View style={s.headerArea}>
        <Text style={s.pageTitle}>Career Prep</Text>
        <Text style={s.pageSubtitle}>Write winning letters · Ace your interviews</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad + 16 }}
        showsVerticalScrollIndicator
        indicatorStyle={colors.isDark ? 'white' : 'black'}
      >
        {/* Letter card */}
        <Pressable
          style={({ pressed }) => [s.card, pressed && { opacity: 0.95 }]}
          onPress={() => router.push('/letter-screen')}
          android_ripple={{ color: colors.indigoBg }}
        >
          <LinearGradient
            colors={['#6366f1', '#4f46e5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.cardGradient}
          >
            <View style={s.cardIconBg}>
              <Feather name="file-text" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Write Application Letter</Text>
              <Text style={s.cardDesc}>Generate a professional letter using your profile and CV</Text>
            </View>
            <View style={s.cardBadge}>
              <Text style={s.cardBadgeText}>{savedLetters.length}</Text>
            </View>
            <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.7)" />
          </LinearGradient>
        </Pressable>

        {/* Interview card */}
        <Pressable
          style={({ pressed }) => [s.card, pressed && { opacity: 0.95 }]}
          onPress={() => router.push('/interview-screen')}
          android_ripple={{ color: colors.purpleBg }}
        >
          <LinearGradient
            colors={['#8b5cf6', '#7c3aed']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.cardGradient}
          >
            <View style={s.cardIconBg}>
              <Feather name="mic" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Mock Interview</Text>
              <Text style={s.cardDesc}>Practice with realistic questions for Zambian placements</Text>
            </View>
            <View style={s.cardBadge}>
              <Text style={s.cardBadgeText}>{completedInterviews}</Text>
            </View>
            <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.7)" />
          </LinearGradient>
        </Pressable>

        {/* Stats row */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statNum}>{savedLetters.length}</Text>
            <Text style={s.statLabel}>Letters saved</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNum}>{draftLetters}</Text>
            <Text style={s.statLabel}>Drafts</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNum}>{interviewSessions.length}</Text>
            <Text style={s.statLabel}>Interviews</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  headerArea: { paddingHorizontal: 24, paddingBottom: 20 },
  pageTitle: { fontSize: 30, fontFamily: 'Inter_700Bold', color: colors.text, letterSpacing: -0.8, marginBottom: 4 },
  pageSubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 2 },

  card: { borderRadius: 22, overflow: 'hidden', marginBottom: 16 },
  cardGradient: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 22 },
  cardIconBg: { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff', marginBottom: 3 },
  cardDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.85)', lineHeight: 18 },
  cardBadge: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  cardBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },

  statsRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  statCard: { flex: 1, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, alignItems: 'center' },
  statNum: { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.text, marginBottom: 2 },
  statLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
});
