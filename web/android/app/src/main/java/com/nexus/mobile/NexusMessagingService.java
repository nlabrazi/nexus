package com.nexus.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class NexusMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(NexusNativeAlertPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("notifications_enabled", true)) {
            return;
        }

        Map<String, String> data = remoteMessage.getData();
        String title = data != null ? data.get("title") : null;
        String body = data != null ? data.get("body") : null;
        String approvalId = data != null ? data.get("approvalId") : "";
        String taskId = data != null ? data.get("taskId") : "";
        String type = data != null ? data.get("type") : "";

        RemoteMessage.Notification notif = remoteMessage.getNotification();
        if ((title == null || title.isEmpty()) && notif != null) {
            title = notif.getTitle();
        }
        if ((body == null || body.isEmpty()) && notif != null) {
            body = notif.getBody();
        }

        String dedupKey = "";
        if (approvalId != null && !approvalId.isEmpty()) {
            dedupKey = "approval:" + approvalId;
        } else if (taskId != null && !taskId.isEmpty()) {
            dedupKey = "task:" + taskId + ":" + ("task_failed".equals(type) ? "failed" : "completed");
        }

        NexusNativeAlertPlugin.postUrgentSmsNotification(
            context,
            title != null ? title : "Nexus",
            body != null ? body : "Une action requiert votre attention.",
            approvalId != null ? approvalId : "",
            dedupKey
        );
    }
}
