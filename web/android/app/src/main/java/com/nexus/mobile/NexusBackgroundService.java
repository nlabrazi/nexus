package com.nexus.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public class NexusBackgroundService extends Service {

    private static final String SERVICE_CHANNEL_ID = "nexus_daemon_service_channel";
    private static final int SERVICE_NOTIFICATION_ID = 1001;

    private ScheduledExecutorService scheduler;
    private PowerManager.WakeLock wakeLock;
    private final Map<String, String> knownTaskStatuses = new ConcurrentHashMap<>();
    private volatile boolean initialTasksLoaded = false;

    public static void startOrUpdate(Context context) {
        if (context == null) {
            return;
        }
        try {
            Intent intent = new Intent(context, NexusBackgroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureServiceChannel();
        acquireWakeLock();
        startWatcherLoop();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureServiceChannel();
        Notification notification = buildForegroundNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    SERVICE_NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                );
            } else {
                startForeground(SERVICE_NOTIFICATION_ID, notification);
            }
        } catch (Exception ignored) {
        }
        startWatcherLoop();
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        startOrUpdate(getApplicationContext());
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (scheduler != null) {
            scheduler.shutdownNow();
            scheduler = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {
            }
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && (wakeLock == null || !wakeLock.isHeld())) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nexus:bg_watcher_lock");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
        } catch (Exception ignored) {
        }
    }

    private void ensureServiceChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) {
                return;
            }
            NotificationChannel channel = new NotificationChannel(
                SERVICE_CHANNEL_ID,
                "Nexus Connexion Permanente",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Maintient l'écoute des approbations et des tâches en arrière-plan");
            channel.setShowBadge(false);
            channel.enableVibration(false);
            channel.setSound(null, null);
            nm.createNotificationChannel(channel);
        }
    }

    private Notification buildForegroundNotification() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(this, SERVICE_NOTIFICATION_ID, launchIntent, flags);

        Bitmap largeLogo = null;
        try {
            largeLogo = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher_round);
        } catch (Exception ignored) {
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_nexus)
            .setColor(0xFF00F0FF)
            .setContentTitle("Nexus")
            .setContentText("Connecté à votre PC — En écoute des approbations")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE);

        if (largeLogo != null) {
            builder.setLargeIcon(largeLogo);
        }

        return builder.build();
    }

    private synchronized void startWatcherLoop() {
        if (scheduler != null && !scheduler.isShutdown()) {
            return;
        }
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleWithFixedDelay(this::pollDaemonOnce, 2, 3, TimeUnit.SECONDS);
    }

    private void pollDaemonOnce() {
        try {
            SharedPreferences prefs = getSharedPreferences(NexusNativeAlertPlugin.PREFS_NAME, Context.MODE_PRIVATE);
            boolean enabled = prefs.getBoolean("notifications_enabled", true);
            String coreUrl = prefs.getString("core_url", "");
            String authToken = prefs.getString("auth_token", "");

            if (!enabled || coreUrl == null || coreUrl.trim().isEmpty()) {
                return;
            }

            String baseUrl = coreUrl.trim().replaceAll("/+$", "");
            checkPendingApprovals(baseUrl, authToken);
            checkRunningTasks(baseUrl, authToken);
        } catch (Exception ignored) {
        }
    }

    private void checkPendingApprovals(String baseUrl, String authToken) {
        String json = httpGet(baseUrl + "/api/approvals", authToken);
        if (json == null || !json.trim().startsWith("[")) {
            return;
        }
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item == null) continue;
                String status = item.optString("status", "pending");
                if (!"pending".equals(status)) continue;

                String approvalId = item.optString("approvalId", "");
                if (approvalId.isEmpty()) continue;

                String toolName = item.optString("toolName", "Commande");
                String summary = item.optString("summary", "");
                if (summary.isEmpty()) {
                    summary = extractHumanApprovalSummary(item.optString("details", ""));
                }

                // Only trigger from background poller if app is minimized/closed, or if WebView missed it
                if (!NexusNativeAlertPlugin.isAppInForeground()) {
                    NexusNativeAlertPlugin.postUrgentSmsNotification(
                        getApplicationContext(),
                        "Nexus · Approbation (" + toolName + ")",
                        summary,
                        approvalId,
                        "approval:" + approvalId
                    );
                }
            }
        } catch (Exception ignored) {
        }
    }

    private void checkRunningTasks(String baseUrl, String authToken) {
        String json = httpGet(baseUrl + "/api/tasks", authToken);
        if (json == null || !json.trim().startsWith("[")) {
            return;
        }
        try {
            JSONArray array = new JSONArray(json);
            boolean firstPass = !initialTasksLoaded;
            for (int i = 0; i < array.length(); i++) {
                JSONObject task = array.optJSONObject(i);
                if (task == null) continue;
                String taskId = task.optString("taskId", "");
                String status = task.optString("status", "");
                if (taskId.isEmpty() || status.isEmpty()) continue;

                String previousStatus = knownTaskStatuses.put(taskId, status);
                if (firstPass) {
                    continue;
                }

                boolean transitionedFromActive =
                    previousStatus == null ||
                    "running".equals(previousStatus) ||
                    "pending".equals(previousStatus);

                if (transitionedFromActive && !NexusNativeAlertPlugin.isAppInForeground()) {
                    if ("completed".equals(status)) {
                        String summary = task.optString("fileSummary", "La tâche demandée a été exécutée avec succès.");
                        NexusNativeAlertPlugin.postUrgentSmsNotification(
                            getApplicationContext(),
                            "Nexus · Tâche terminée ✅",
                            summary,
                            "",
                            "task:" + taskId + ":completed"
                        );
                    } else if ("failed".equals(status)) {
                        String err = task.optString("error", "Une erreur est survenue lors de l'exécution.");
                        NexusNativeAlertPlugin.postUrgentSmsNotification(
                            getApplicationContext(),
                            "Nexus · Tâche échouée ❌",
                            err,
                            "",
                            "task:" + taskId + ":failed"
                        );
                    }
                }
            }
            initialTasksLoaded = true;
        } catch (Exception ignored) {
        }
    }

    public static String extractHumanApprovalSummary(String rawDetails) {
        if (rawDetails == null || rawDetails.trim().isEmpty()) {
            return "Une action de l'agent requiert votre accord — pouvez-vous valider ?";
        }
        String trimmed = rawDetails.trim();
        if (!trimmed.startsWith("{")) {
            return trimmed.length() > 140 ? trimmed.substring(0, 140) + "…" : trimmed;
        }
        try {
            JSONObject obj = new JSONObject(trimmed);
            JSONObject action = obj.optJSONObject("action");

            String reason = obj.optString("reason",
                obj.optString("Description",
                    obj.optString("description",
                        obj.optString("toolSummary", ""))));

            String cmd = obj.optString("CommandLine", "");
            if (cmd.isEmpty()) {
                Object rawCmd = obj.opt("command");
                if (rawCmd == null && action != null) {
                    rawCmd = action.opt("command");
                }
                if (rawCmd instanceof JSONArray) {
                    JSONArray arr = (JSONArray) rawCmd;
                    if (arr.length() >= 3) {
                        cmd = arr.optString(arr.length() - 1, "");
                    } else {
                        StringBuilder sb = new StringBuilder();
                        for (int i = 0; i < arr.length(); i++) {
                            if (i > 0) sb.append(" ");
                            sb.append(arr.optString(i, ""));
                        }
                        cmd = sb.toString();
                    }
                } else if (rawCmd instanceof String) {
                    cmd = (String) rawCmd;
                }
            }

            cmd = cmd.replaceAll("^(?:/usr/bin/env\\s+)?(?:/bin/|/usr/bin/)?(?:ba|z|da|k)?sh\\s+-[a-z]*c[a-z]*\\s+", "").trim();
            if ((cmd.startsWith("'") && cmd.endsWith("'")) || (cmd.startsWith("\"") && cmd.endsWith("\""))) {
                cmd = cmd.substring(1, cmd.length() - 1).trim();
            }

            if (!cmd.isEmpty()) {
                String shortCmd = cmd.length() > 70 ? cmd.substring(0, 69) + "…" : cmd;
                if (!reason.isEmpty()) {
                    return reason + " (" + shortCmd + ") — pouvez-vous valider ?";
                }
                return "Je souhaite exécuter « " + shortCmd + " » — pouvez-vous valider ?";
            }

            String targetFile = obj.optString("TargetFile", obj.optString("path", ""));
            if (!targetFile.isEmpty()) {
                return "Je souhaite modifier « " + targetFile + " » — pouvez-vous valider ?";
            }
            if (!reason.isEmpty()) {
                return reason + " — pouvez-vous valider ?";
            }
        } catch (Exception ignored) {
        }
        return "Une action de l'agent requiert votre accord — pouvez-vous valider ?";
    }

    private String httpGet(String urlStr, String authToken) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(3500);
            conn.setRequestProperty("Accept", "application/json");
            if (authToken != null && !authToken.trim().isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + authToken.trim());
            }
            int code = conn.getResponseCode();
            if (code != 200) {
                return null;
            }
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8)
            )) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                return sb.toString();
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }
}
