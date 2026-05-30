import { Alert, Platform } from 'react-native';

/**
 * Cross-platform confirmation dialog.
 * On native  → Alert.alert with Cancel / Confirm buttons.
 * On web     → window.confirm (works in iframe preview).
 */
export function confirmDialog(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
) {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    if (window.confirm(text)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel' },
      { text: confirmText, style: 'destructive', onPress: () => onConfirm() },
    ]);
  }
}

/**
 * Cross-platform two-step (double-confirm) dialog.
 * Shows a first confirm, then if accepted shows a second before calling onConfirm.
 */
export function doubleConfirmDialog(
  title1: string,
  message1: string,
  title2: string,
  message2: string,
  onConfirm: () => void | Promise<void>,
  confirmText = 'Delete',
) {
  if (Platform.OS === 'web') {
    const t1 = message1 ? `${title1}\n\n${message1}` : title1;
    if (!window.confirm(t1)) return;
    const t2 = message2 ? `${title2}\n\n${message2}` : title2;
    if (window.confirm(t2)) onConfirm();
  } else {
    Alert.alert(title1, message1, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue →',
        style: 'destructive',
        onPress: () => {
          Alert.alert(title2, message2, [
            { text: 'No, cancel', style: 'cancel' },
            { text: confirmText, style: 'destructive', onPress: () => onConfirm() },
          ]);
        },
      },
    ]);
  }
}

/**
 * Cross-platform info alert (no cancel, just OK).
 */
export function infoAlert(title: string, message?: string) {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}
