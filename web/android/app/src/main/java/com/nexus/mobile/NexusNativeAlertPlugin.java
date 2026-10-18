package com.nexus.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "NexusNativeAlert")
public class NexusNativeAlertPlugin extends Plugin {

    public static final String URGENT_CHANNEL_ID = "nexus_urgent_sms_channel_v2";
    public static final String PREFS_NAME = "nexus_native_prefs";
    private static final long DEDUP_TTL_MS = 10 * 60 * 1000L;
    private static final ConcurrentHashMap<String, Long> notifiedKeys = new ConcurrentHashMap<>();
    private static volatile boolean appInForeground = false;

    public static void setAppInForeground(boolean foreground) {
        appInForeground = foreground;
    }

    public static boolean isAppInForeground() {
        return appInForeground;
    }

    public static void ensureUrgentChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager notificationManager = context.getSystemService(NotificationManager.class);
            if (notificationManager == null) {
                return;
            }
            CharSequence name = "Nexus Alertes SMS & Approbations";
            String description = "Alertes sonores et pop-up prioritaires type SMS pour les approbations et fins de tâches Nexus";
            NotificationChannel channel = new NotificationChannel(
                URGENT_CHANNEL_ID,
                name,
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription(description);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 300, 150, 300});
            channel.enableLights(true);
            channel.setBypassDnd(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            Uri defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                .build();
            channel.setSound(defaultSoundUri, audioAttributes);

            notificationManager.createNotificationChannel(channel);
        }
    }

    public static boolean postUrgentSmsNotification(
        Context context,
        String title,
        String body,
        String approvalId,
        String dedupKey
    ) {
        if (context == null) {
            return false;
        }

        long now = System.currentTimeMillis();
        if (dedupKey != null && !dedupKey.trim().isEmpty()) {
            String key = dedupKey.trim();
            // Purge expired deduplication entries
            Iterator<Map.Entry<String, Long>> it = notifiedKeys.entrySet().iterator();
            while (it.hasNext()) {
                Map.Entry<String, Long> entry = it.next();
                if (now - entry.getValue() > DEDUP_TTL_MS) {
                    it.remove();
                }
            }
            Long existing = notifiedKeys.putIfAbsent(key, now);
            if (existing != null && (now - existing) <= DEDUP_TTL_MS) {
                return false;
            }
        }

        ensureUrgentChannel(context);

        // 1. Wake up the screen if it was off (like an SMS arrival)
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isInteractive()) {
                @SuppressWarnings("deprecation")
                PowerManager.WakeLock screenLock = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                    "nexus:screen_sms_alert"
                );
                screenLock.acquire(4500);
            }
        } catch (Exception ignored) {
        }

        // 2. Prepare intent to open Nexus on tap
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent != null) {
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (approvalId != null && !approvalId.isEmpty()) {
                intent.putExtra("approvalId", approvalId);
            }
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        int requestCode = (int) (now % 100000);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, requestCode, intent, flags);

        Uri defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        // Decode full-color Nexus brand logo for the SMS notification popup
        Bitmap largeLogo = null;
        try {
            largeLogo = BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher_round);
            if (largeLogo == null) {
                largeLogo = BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher);
            }
        } catch (Exception ignored) {
        }

        String safeTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "Nexus";
        String safeBody = (body != null && !body.trim().isEmpty()) ? body.trim() : "Une action requiert votre attention.";

        // 3. Build notification as CATEGORY_MESSAGE with PRIORITY_MAX (Heads-Up Banner + Nexus Logo)
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, URGENT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_nexus)
            .setColor(0xFF00F0FF)
            .setSubText("Nexus")
            .setContentTitle(safeTitle)
            .setContentText(safeBody)
            .setStyle(
                new NotificationCompat.BigTextStyle()
                    .bigText(safeBody)
                    .setBigContentTitle(safeTitle)
                    .setSummaryText("Nexus")
            )
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setFullScreenIntent(pendingIntent, true)
            .setSound(defaultSoundUri)
            .setVibrate(new long[]{0, 300, 150, 300})
            .setDefaults(Notification.DEFAULT_ALL);

        if (largeLogo != null) {
            builder.setLargeIcon(largeLogo);
        }

        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager != null) {
            int notifId = (approvalId != null && !approvalId.isEmpty())
                ? Math.abs(approvalId.hashCode())
                : requestCode;
            notificationManager.notify(notifId, builder.build());
            return true;
        }
        return false;
    }

    @PluginMethod
    public void sendUrgentNotification(PluginCall call) {
        String title = call.getString("title", "Nexus");
        String body = call.getString("body", "Action requise");
        String approvalId = call.getString("approvalId", "");
        String dedupKey = call.getString("dedupKey", "");

        postUrgentSmsNotification(getContext(), title, body, approvalId, dedupKey);
        call.resolve();
    }

    @PluginMethod
    public void configureDaemon(PluginCall call) {
        String url = call.getString("url", "");
        String token = call.getString("token", "");
        Boolean enabled = call.getBoolean("notificationsEnabled", true);

        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString("core_url", url != null ? url.trim() : "")
            .putString("auth_token", token != null ? token.trim() : "")
            .putBoolean("notifications_enabled", enabled == null || enabled)
            .apply();

        NexusBackgroundService.startOrUpdate(context);
        call.resolve();
    }
}
