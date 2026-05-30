import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface SearchProgressProps {
  steps: string[];
  stepInterval?: number;
}

export function SearchProgress({ steps, stepInterval = 3500 }: SearchProgressProps) {
  const colors = useColors();
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.6)).current;
  const startTime = useRef(Date.now());

  // Spin the icon continuously
  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    ).start();
  }, [spinAnim]);

  // Pulse the dot
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0.35, duration: 700, useNativeDriver: false }),
      ])
    ).start();
  }, [pulseAnim]);

  // Cycle through steps with fade transition
  useEffect(() => {
    startTime.current = Date.now();
    setStepIndex(0);
    setElapsed(0);

    const stepTimer = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0, duration: 220, useNativeDriver: false }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: false }),
      ]).start();
      setStepIndex(prev => (prev + 1) % steps.length);
    }, stepInterval);

    const elapsedTimer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);

    return () => {
      clearInterval(stepTimer);
      clearInterval(elapsedTimer);
    };
  }, [steps, stepInterval, fadeAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const s = styles(colors);

  return (
    <View style={s.container}>
      {/* Spinner ring */}
      <View style={s.spinnerWrap}>
        <Animated.View style={[s.spinnerRing, { transform: [{ rotate: spin }] }]} />
        <View style={s.spinnerInner}>
          <Feather name="search" size={18} color={colors.primary} />
        </View>
      </View>

      {/* Status text */}
      <Animated.View style={[s.textWrap, { opacity: fadeAnim }]}>
        <View style={s.stepRow}>
          <Animated.View style={[s.dot, { opacity: pulseAnim, backgroundColor: colors.primary }]} />
          <Text style={s.stepText}>{steps[stepIndex]}</Text>
        </View>
      </Animated.View>

      {/* Step indicators */}
      <View style={s.dotsRow}>
        {steps.map((_, i) => (
          <View
            key={i}
            style={[
              s.stepDot,
              {
                backgroundColor: i === stepIndex ? colors.primary : colors.border,
                width: i === stepIndex ? 16 : 6,
              },
            ]}
          />
        ))}
      </View>

      {/* Elapsed time */}
      {elapsed > 3 && (
        <Text style={s.elapsed}>{elapsed}s — AI is searching the web…</Text>
      )}
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      paddingVertical: 40,
      paddingHorizontal: 24,
      gap: 18,
    },
    spinnerWrap: {
      width: 72,
      height: 72,
      alignItems: 'center',
      justifyContent: 'center',
    },
    spinnerRing: {
      position: 'absolute',
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 3,
      borderColor: 'transparent',
      borderTopColor: colors.primary,
      borderRightColor: colors.indigoBorder,
    },
    spinnerInner: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.indigoBg,
      borderWidth: 1,
      borderColor: colors.indigoBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textWrap: {
      alignItems: 'center',
      minHeight: 44,
      justifyContent: 'center',
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      flexShrink: 0,
    },
    stepText: {
      fontSize: 15,
      fontFamily: 'Inter_500Medium',
      color: colors.text,
      textAlign: 'center',
      lineHeight: 22,
      flex: 1,
    },
    dotsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    stepDot: {
      height: 6,
      borderRadius: 3,
    },
    elapsed: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
    },
  });
