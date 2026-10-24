import { ref, watch, type Ref } from 'vue';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import { parseApprovalDetails } from '../utils/approval-parser.mjs';
import type { PendingApprovalItem } from '../types/nexus';

interface NexusNativeAlertPluginInterface {
  sendUrgentNotification(options: {
    title: string;
    body: string;
    approvalId?: string;
    dedupKey?: string;
  }): Promise<void>;
  configureDaemon(options: {
    url: string;
    token: string;
    notificationsEnabled: boolean;
  }): Promise<void>;
}

const NexusNativeAlert = registerPlugin<NexusNativeAlertPluginInterface>('NexusNativeAlert');

export function useSystemNotifications(options: {
  coreUrl: Ref<string>;
  authToken: Ref<string>;
  errorMessage: Ref<string>;
  apiUrl: (path?: string) => string;
  approvals: Ref<PendingApprovalItem[]>;
  showApprovalModal: Ref<boolean>;
  activeApprovalIndex: Ref<number>;
}) {
  const {
    coreUrl,
    authToken,
    errorMessage,
    apiUrl,
    approvals,
    showApprovalModal,
    activeApprovalIndex,
  } = options;

  const notificationsEnabled = ref<boolean>(true);
  const fcmToken = ref<string>('');
  const notifiedApprovalIds = new Set<string>();
  const notifiedTaskIds = new Set<string>();

  if (typeof window !== 'undefined') {
    try {
      const savedNotifs = localStorage.getItem('nexus_notifications_enabled');
      if (savedNotifs !== null) notificationsEnabled.value = savedNotifs === 'true';
    } catch {}
  }

  async function syncNativeDaemonConfig() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await NexusNativeAlert.configureDaemon({
        url: coreUrl.value || '',
        token: authToken.value || '',
        notificationsEnabled: notificationsEnabled.value,
      });
    } catch (err) {
      console.warn('NexusNativeAlert.configureDaemon error:', err);
    }
  }

  watch(notificationsEnabled, (val) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('nexus_notifications_enabled', String(val));
    } catch {}
    void syncNativeDaemonConfig();
  });

  async function sendSystemNotification(title: string, body: string, extra?: Record<string, any>) {
    if (!notificationsEnabled.value) return;
    if (Capacitor.isNativePlatform()) {
      try {
        await NexusNativeAlert.sendUrgentNotification({
          title,
          body,
          approvalId: extra?.approvalId || '',
          dedupKey: extra?.dedupKey || (extra?.approvalId ? `approval:${extra.approvalId}` : ''),
        });
      } catch (e) {
        console.warn('NexusNativeAlert error, fallback local-notif:', e);
        try {
          await LocalNotifications.schedule({
            notifications: [
              {
                id: Math.floor(Math.random() * 1000000) + 1,
                title,
                body,
                channelId: 'nexus_urgent_sms_channel_v2',
                extra,
              },
            ],
          });
        } catch {}
      }
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/pwa-icon.png', badge: '/pwa-icon.png' });
      } catch {}
    }
  }

  async function testUrgentNotification() {
    await sendSystemNotification(
      "Nexus : Test d'alerte SMS",
      'Ceci est une alerte sonore et pop-up Heads-Up comme un SMS !'
    );
  }

  async function sendTokenToDaemon(token: string) {
    if (!coreUrl.value || !token) return;
    try {
      const rawUrl = apiUrl();
      await fetch(`${rawUrl}/api/push/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken.value ? { Authorization: `Bearer ${authToken.value}` } : {}),
        },
        body: JSON.stringify({ token }),
      });
      console.log('[FCM] Token enregistré avec succès sur le daemon');
    } catch (err) {
      console.warn('[FCM] Échec enregistrement token sur le daemon:', err);
    }
  }

  async function testFcmPush() {
    if (!coreUrl.value) {
      errorMessage.value = "Connectez-vous d'abord au daemon.";
      return;
    }
    try {
      const rawUrl = apiUrl();
      const res = await fetch(`${rawUrl}/api/push/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken.value ? { Authorization: `Bearer ${authToken.value}` } : {}),
        },
      });
      const data = await res.json();
      if (res.ok) {
        alert('✅ Requête push envoyée à Google ! Votre téléphone va sonner.');
      } else {
        alert(`Erreur push : ${data.error || 'Échec'}`);
      }
    } catch (err: any) {
      alert(`Erreur de connexion au daemon : ${err.message}`);
    }
  }

  function notifyApprovalIfNeeded(item: Partial<PendingApprovalItem> & { approvalId?: string }) {
    if (!item?.approvalId || notifiedApprovalIds.has(item.approvalId)) {
      return;
    }
    notifiedApprovalIds.add(item.approvalId);

    const parsed = parseApprovalDetails(item);
    void sendSystemNotification(
      parsed.notificationTitle,
      item.summary || parsed.notificationBody,
      { approvalId: item.approvalId, dedupKey: `approval:${item.approvalId}` }
    );
  }

  async function initNativeNotifications() {
    if (typeof window !== 'undefined') {
      fcmToken.value = localStorage.getItem('nexus_fcm_token') || '';
    }
    if (Capacitor.isNativePlatform()) {
      try {
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: '#07090e' });
      } catch {}
      try {
        const perm = await LocalNotifications.checkPermissions();
        if (perm.display !== 'granted') {
          await LocalNotifications.requestPermissions();
        }
        await LocalNotifications.createChannel({
          id: 'nexus-alerts',
          name: 'Nexus Approbations & Alertes',
          description: 'Alertes instantanées pour les approbations requises et fins de tâches',
          importance: 5,
          visibility: 1,
          vibration: true,
          lights: true,
          lightColor: '#4f98a3',
        });
        await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
          if (action.notification.extra?.approvalId) {
            showApprovalModal.value = true;
            const idx = approvals.value.findIndex(
              (a) => a.approvalId === action.notification.extra?.approvalId
            );
            if (idx >= 0) activeApprovalIndex.value = idx;
          }
        });
      } catch (err) {
        console.warn('LocalNotifications init error:', err);
      }
      try {
        await PushNotifications.addListener('registration', async (token) => {
          console.log('[FCM] Registered token:', token.value);
          fcmToken.value = token.value;
          localStorage.setItem('nexus_fcm_token', token.value);
          await sendTokenToDaemon(token.value);
        });

        await PushNotifications.addListener('registrationError', (err) => {
          console.warn('[FCM] Registration error:', err);
        });

        await PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('[FCM] Push received foreground:', notification);
        });

        await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          console.log('[FCM] Push action clicked:', action);
          const approvalId = action.notification.data?.approvalId;
          if (approvalId) {
            showApprovalModal.value = true;
            const idx = approvals.value.findIndex((a) => a.approvalId === approvalId);
            if (idx >= 0) activeApprovalIndex.value = idx;
          }
        });

        let pushPerm = await PushNotifications.checkPermissions();
        if (pushPerm.receive !== 'granted') {
          pushPerm = await PushNotifications.requestPermissions();
        }
        if (pushPerm.receive === 'granted') {
          await PushNotifications.register();
        }
      } catch (err) {
        console.warn('PushNotifications init error:', err);
      }
      await syncNativeDaemonConfig();
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        void Notification.requestPermission();
      } catch {}
    }
  }

  return {
    notificationsEnabled,
    fcmToken,
    notifiedTaskIds,
    syncNativeDaemonConfig,
    sendSystemNotification,
    testUrgentNotification,
    sendTokenToDaemon,
    testFcmPush,
    notifyApprovalIfNeeded,
    initNativeNotifications,
  };
}

