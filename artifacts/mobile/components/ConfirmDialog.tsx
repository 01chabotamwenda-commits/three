import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useColors } from '@/hooks/useColors';

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const colors = useColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
          onPress={() => {}}
        >
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {!!message && (
            <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>
          )}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.btnRow}>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.cancelBtn,
                { borderColor: colors.border },
                pressed && { opacity: 0.65 },
              ]}
              onPress={onCancel}
            >
              <Text style={[styles.btnText, { color: colors.textSecondary }]}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                destructive
                  ? { backgroundColor: colors.danger }
                  : { backgroundColor: colors.primary },
                pressed && { opacity: 0.8 },
              ]}
              onPress={onConfirm}
            >
              <Text style={[styles.btnText, { color: '#fff' }]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  sheet: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  divider: {
    height: 1,
    marginVertical: 4,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    borderWidth: 1,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
