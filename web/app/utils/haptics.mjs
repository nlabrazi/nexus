import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export async function triggerHaptic(
  type = 'press'
) {
  if (Capacitor.isNativePlatform()) {
    try {
      if (type === 'light' || type === 'release') {
        await Haptics.impact({ style: ImpactStyle.Light });
      } else if (type === 'heavy') {
        await Haptics.impact({ style: ImpactStyle.Heavy });
      } else if (type === 'press' || type === 'medium') {
        await Haptics.impact({ style: ImpactStyle.Medium });
      } else if (type === 'success') {
        await Haptics.notification({ type: NotificationType.Success });
      } else if (type === 'cancel' || type === 'warning') {
        await Haptics.notification({ type: NotificationType.Warning });
      }
      return;
    } catch {}
  }
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      if (type === 'heavy') navigator.vibrate(60);
      else if (type === 'press' || type === 'medium') navigator.vibrate(40);
      else if (type === 'release' || type === 'light') navigator.vibrate([20, 30, 20]);
    } catch {}
  }
}
