import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
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
import { useColors } from '@/hooks/useColors';

export default function SignupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp } = useApp();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const s = styles(colors);

  async function handleSignup() {
    if (!displayName.trim()) { setError('Please enter your name.'); return; }
    if (!email.trim()) { setError('Please enter your email.'); return; }
    if (!email.includes('@')) { setError('Please enter a valid email.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);
    try {
      const result = await signUp(email.trim(), password, displayName.trim());
      if (!result.success) {
        setError(result.error ?? 'Sign up failed.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        indicatorStyle={colors.isDark ? 'white' : 'black'}
      >
        {/* Back */}
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={20} color={colors.text} />
        </Pressable>

        {/* Logo / Brand */}
        <View style={s.brand}>
          <View style={s.logoWrap}>
            <Feather name="compass" size={32} color="#fff" />
          </View>
          <Text style={s.appName}>Create Account</Text>
          <Text style={s.tagline}>Join Career Campus today</Text>
        </View>

        {/* Card */}
        <View style={s.card}>
          {error ? (
            <View style={s.errorBox}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Name */}
          <View style={s.fieldWrap}>
            <Text style={s.label}>Full Name</Text>
            <View style={s.inputRow}>
              <Feather name="user" size={16} color={colors.textMuted} style={s.inputIcon} />
              <TextInput
                style={s.input}
                placeholder="Your name"
                placeholderTextColor={colors.textMuted}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Email */}
          <View style={s.fieldWrap}>
            <Text style={s.label}>Email</Text>
            <View style={s.inputRow}>
              <Feather name="mail" size={16} color={colors.textMuted} style={s.inputIcon} />
              <TextInput
                style={s.input}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Password */}
          <View style={s.fieldWrap}>
            <Text style={s.label}>Password</Text>
            <View style={s.inputRow}>
              <Feather name="lock" size={16} color={colors.textMuted} style={s.inputIcon} />
              <TextInput
                style={[s.input, { flex: 1 }]}
                placeholder="Min. 6 characters"
                placeholderTextColor={colors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="next"
              />
              <Pressable onPress={() => setShowPassword(v => !v)} hitSlop={8} style={s.eyeBtn}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* Confirm Password */}
          <View style={s.fieldWrap}>
            <Text style={s.label}>Confirm Password</Text>
            <View style={s.inputRow}>
              <Feather name="lock" size={16} color={colors.textMuted} style={s.inputIcon} />
              <TextInput
                style={[s.input, { flex: 1 }]}
                placeholder="Re-enter password"
                placeholderTextColor={colors.textMuted}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleSignup}
              />
            </View>
          </View>

          {/* Sign Up Button */}
          <Pressable
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }, loading && { opacity: 0.7 }]}
            onPress={handleSignup}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.primaryBtnText}>Create Account</Text>}
          </Pressable>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>Already have an account?</Text>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={s.footerLink}> Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },

  backBtn: { marginBottom: 16, alignSelf: 'flex-start' },

  brand: { alignItems: 'center', marginBottom: 24 },
  logoWrap: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  appName: {
    fontSize: 24, fontFamily: 'Inter_700Bold',
    color: colors.text, letterSpacing: -0.4, marginBottom: 4,
  },
  tagline: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textMuted },

  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: colors.isDark ? 0.3 : 0.08,
    shadowRadius: 12,
    elevation: 6,
  },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.dangerBg,
    borderWidth: 1, borderColor: colors.dangerBorder,
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  errorText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.danger, flex: 1 },

  fieldWrap: { marginBottom: 16 },
  label: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold',
    color: colors.textSecondary, marginBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.muted,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, paddingHorizontal: 14, height: 50,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular',
    color: colors.text,
  },
  eyeBtn: { padding: 4 },

  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14, height: 52,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },

  footer: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
  },
  footerText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textMuted },
  footerLink: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.primary },
});
