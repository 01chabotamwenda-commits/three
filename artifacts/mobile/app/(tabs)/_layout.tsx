import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

const TAB_ROUTES = ['index', 'contacts', 'companies', 'applications', 'profile'] as const;
type TabRoute = typeof TAB_ROUTES[number];

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="contacts">
        <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
        <Label>Network</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="companies">
        <Icon sf={{ default: 'safari', selected: 'safari.fill' }} />
        <Label>Companies</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="applications">
        <Icon sf={{ default: 'list.bullet.rectangle', selected: 'list.bullet.rectangle.fill' }} />
        <Label>Applications</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: 'person', selected: 'person.fill' }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const isDark = colors.isDark;
  const isIOS = Platform.OS === 'ios';
  const insets = useSafeAreaInsets();
  const { applications, contacts } = useApp();
  const router = useRouter();
  const pathname = usePathname();

  const lastSegment = pathname.split('/').filter(Boolean).pop() || 'index';
  const currentSegment: TabRoute =
    TAB_ROUTES.includes(lastSegment as TabRoute) ? (lastSegment as TabRoute) : 'index';
  const currentIdx = TAB_ROUTES.indexOf(currentSegment);

  const activeApps = applications.filter(
    a => a.status === 'Applied' || a.status === 'Interviewing'
  ).length;
  const followUps = contacts.filter(c => c.needsFollowUp).length;

  const tabBarHeight = Platform.OS === 'web' ? 72 : 62 + insets.bottom;
  const tabBarPaddingBottom = Platform.OS === 'web' ? 8 : insets.bottom + 4;

  return (
    <View style={styles.container}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: isIOS ? 'transparent' : colors.card,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            elevation: 12,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -3 },
            shadowOpacity: isDark ? 0.35 : 0.12,
            shadowRadius: 12,
            height: tabBarHeight,
            paddingBottom: tabBarPaddingBottom,
            paddingTop: 6,
          },
          tabBarBackground: () =>
            isIOS ? (
              <BlurView
                intensity={90}
                tint={isDark ? 'dark' : 'light'}
                style={StyleSheet.absoluteFill}
              />
            ) : null,
          tabBarLabelStyle: {
            fontFamily: 'Inter_600SemiBold',
            fontSize: 10,
            letterSpacing: 0.2,
          },
          tabBarIconStyle: { marginTop: 2 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarAccessibilityLabel: 'Home dashboard',
            tabBarIcon: ({ color, size }) =>
              isIOS
                ? <SymbolView name="house.fill" tintColor={color} size={size} />
                : <Feather name="home" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="contacts"
          options={{
            title: 'Network',
            tabBarAccessibilityLabel: 'Networking events and contacts',
            tabBarBadge: followUps > 0 ? followUps : undefined,
            tabBarBadgeStyle: {
              backgroundColor: colors.primary,
              fontSize: 9,
              minWidth: 15,
              height: 15,
            },
            tabBarIcon: ({ color, size }) =>
              isIOS
                ? <SymbolView name="person.2.fill" tintColor={color} size={size} />
                : <Feather name="radio" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="companies"
          options={{
            title: 'Companies',
            tabBarAccessibilityLabel: 'Discover job and placement opportunities',
            tabBarIcon: ({ color, size }) =>
              isIOS
                ? <SymbolView name="safari.fill" tintColor={color} size={size} />
                : <Feather name="compass" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="applications"
          options={{
            title: 'Applications',
            tabBarAccessibilityLabel: 'My applications and career tracker',
            tabBarBadge: activeApps > 0 ? activeApps : undefined,
            tabBarBadgeStyle: {
              backgroundColor: colors.primary,
              fontSize: 9,
              minWidth: 15,
              height: 15,
            },
            tabBarIcon: ({ color, size }) =>
              isIOS
                ? <SymbolView name="list.bullet.rectangle.fill" tintColor={color} size={size} />
                : <Feather name="briefcase" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarAccessibilityLabel: 'My profile and documents',
            tabBarIcon: ({ color, size }) =>
              isIOS
                ? <SymbolView name="person.fill" tintColor={color} size={size} />
                : <Feather name="user" size={size} color={color} />,
          }}
        />
        <Tabs.Screen name="prep" options={{ href: null }} />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
