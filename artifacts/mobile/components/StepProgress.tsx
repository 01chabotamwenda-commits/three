import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export type StepStatus = 'pending' | 'active' | 'done' | 'failed';

export interface ProgressStep {
  label: string;
  status: StepStatus;
  detail?: string;
}

function SpinIcon({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    ).start();
    return () => anim.stopAnimation();
  }, [anim]);
  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Feather name="loader" size={15} color={color} />
    </Animated.View>
  );
}

function StepRow({ step, colors }: { step: ProgressStep; colors: ReturnType<typeof useColors> }) {
  const s = styles(colors);
  const isPending = step.status === 'pending';
  const isActive  = step.status === 'active';
  const isDone    = step.status === 'done';
  const isFailed  = step.status === 'failed';

  return (
    <View style={[s.row, isPending && s.rowPending]}>
      {/* Icon */}
      <View style={s.iconWrap}>
        {isActive  && <SpinIcon color={colors.primary} />}
        {isDone    && <Feather name="check-circle" size={15} color={colors.success}  />}
        {isFailed  && <Feather name="alert-circle" size={15} color={colors.warning}  />}
        {isPending && <Feather name="circle"        size={15} color={colors.border}  />}
      </View>

      {/* Text */}
      <View style={s.textWrap}>
        <Text
          style={[
            s.label,
            isDone    && s.labelDone,
            isFailed  && s.labelFailed,
            isPending && s.labelPending,
            isActive  && s.labelActive,
          ]}
        >
          {step.label}
        </Text>

        {(isDone || isFailed) && !!step.detail && (
          <Text
            style={[
              s.detail,
              isDone   && { color: colors.success },
              isFailed && { color: colors.warning },
            ]}
            numberOfLines={3}
          >
            {step.detail}
          </Text>
        )}
      </View>
    </View>
  );
}

export function StepProgress({ steps }: { steps: ProgressStep[] }) {
  const colors = useColors();
  const s = styles(colors);

  return (
    <View style={s.container}>
      {steps.map((step, i) => (
        <View key={i}>
          <StepRow step={step} colors={colors} />
          {i < steps.length - 1 && (
            <View style={[
              s.connector,
              step.status === 'done'    && { backgroundColor: colors.success },
              step.status === 'failed'  && { backgroundColor: colors.warning },
              step.status === 'pending' && { backgroundColor: colors.border },
              step.status === 'active'  && { backgroundColor: colors.primary },
            ]} />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      paddingVertical: 24,
      paddingHorizontal: 20,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 14,
      paddingVertical: 6,
    },
    rowPending: { opacity: 0.4 },
    iconWrap: {
      width: 22,
      alignItems: 'center',
      paddingTop: 2,
      flexShrink: 0,
    },
    textWrap: { flex: 1 },
    label: {
      fontSize: 14,
      fontFamily: 'Inter_500Medium',
      color: colors.text,
      lineHeight: 20,
    },
    labelActive:  { color: colors.primary, fontFamily: 'Inter_600SemiBold' },
    labelDone:    { color: colors.textSecondary },
    labelFailed:  { color: colors.warning, fontFamily: 'Inter_600SemiBold' },
    labelPending: { color: colors.textMuted },
    detail: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      marginTop: 2,
      lineHeight: 17,
    },
    connector: {
      width: 2,
      height: 14,
      marginLeft: 10,
      borderRadius: 1,
      backgroundColor: colors.border,
    },
  });
