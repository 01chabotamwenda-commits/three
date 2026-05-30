import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Feather } from '@expo/vector-icons';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppProvider, useApp } from '@/context/AppContext';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function AuthRedirect() {
  const { isLoaded, isAuthenticated, profile } = useApp();
  const router = useRouter();
  const wasAuthenticated = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isAuthenticated) {
      wasAuthenticated.current = false;
      router.replace('/login');
      return;
    }

    // Already handled this auth transition — don't re-navigate
    if (wasAuthenticated.current) return;
    wasAuthenticated.current = true;

    if (profile && profile.displayName === 'You' && !profile.currentDegree) {
      router.replace('/onboarding');
    } else {
      router.replace('/(tabs)');
    }
  }, [isLoaded, isAuthenticated, profile]);

  return null;
}

function RootLayoutNav() {
  return (
    <>
      <AuthRedirect />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="login"
          options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
        />
        <Stack.Screen
          name="signup"
          options={{ headerShown: false, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="onboarding"
          options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
        />
        <Stack.Screen name="docs" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="doc-viewer" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="letter-editor" options={{ headerShown: false, animation: 'slide_from_right' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...Feather.font,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = `
      ::-webkit-scrollbar { display: none; }
      * {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    let dismissTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleDismiss(el: HTMLElement) {
      if (dismissTimer) return;
      dismissTimer = setTimeout(() => {
        el.style.transition = 'opacity 0.4s ease';
        el.style.opacity = '0';
        setTimeout(() => { el.style.display = 'none'; }, 420);
      }, 5000);
    }

    function findAndSchedule() {
      const candidates = [
        document.querySelector('replit-badge'),
        document.querySelector('[data-replit-badge]'),
        document.querySelector('#replit-badge'),
        document.querySelector('.replit-badge'),
        ...(Array.from(document.querySelectorAll('*')).filter(el => {
          const tag = el.tagName?.toLowerCase() ?? '';
          return tag.includes('replit') || tag.includes('badge');
        })),
      ].filter(Boolean) as HTMLElement[];

      if (candidates.length > 0) {
        scheduleDismiss(candidates[0]);
        return true;
      }
      return false;
    }

    if (!findAndSchedule()) {
      const observer = new MutationObserver(() => {
        if (findAndSchedule()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const cleanup = setTimeout(() => observer.disconnect(), 15000);
      return () => {
        observer.disconnect();
        clearTimeout(cleanup);
        if (dismissTimer) clearTimeout(dismissTimer);
      };
    }

    return () => { if (dismissTimer) clearTimeout(dismissTimer); };
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AppProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </AppProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
