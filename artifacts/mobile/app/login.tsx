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

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const s = styles(colors);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await signIn(email.trim(), password);
      if (!result.success) {
        setError(result.error ?? 'Login failed.');
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
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        indicatorStyle={colors.isDark ? 'white' : 'black'}
      >
        {/* Logo / Brand */}
        <View style={s.brand}>
          <View style={s.logoWrap}>
            <Feather name="compass" size={36} color="#fff" />
          </View>
          <Text style={s.appName}>Career Campus</Text>
          <Text style={s.tagline}>Your career journey starts here</Text>
        </View>

        {/* Card */}
        <View style={s.card}>
          <Text style={s.heading}>Welcome back</Text>
          <Text style={s.subheading}>Sign in to continue</Text>

          {error ? (
            <View style={s.errorBox}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

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
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <Pressable onPress={() => setShowPassword(v => !v)} hitSlop={8} style={s.eyeBtn}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* Sign In Button */}
          <Pressable
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }, loading && { opacity: 0.7 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.primaryBtnText}>Sign In</Text>}
          </Pressable>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>Don't have an account?</Text>
          <Pressable onPress={() => router.push('/signup')} hitSlop={8}>
            <Text style={s.footerLink}> Sign up</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },

  brand: { alignItems: 'center', marginBottom: 32 },
  logoWrap: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 10,
  },
  appName: {
    fontSize: 26, fontFamily: 'Inter_700Bold',
    color: colors.text, letterSpacing: -0.5, marginBottom: 4,
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
  heading: {
    fontSize: 22, fontFamily: 'Inter_700Bold',
    color: colors.text, letterSpacing: -0.3, marginBottom: 4,
  },
  subheading: {
    fontSize: 14, fontFamily: 'Inter_400Regular',
    color: colors.textMuted, marginBottom: 20,
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
