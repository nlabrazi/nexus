package com.nexus.mobile;

import android.content.Context;
import android.os.Bundle;
import android.os.PowerManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private PowerManager.WakeLock cpuWakeLock;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NexusNativeAlertPlugin.class);
        super.onCreate(savedInstanceState);
        NexusNativeAlertPlugin.ensureUrgentChannel(this);
        acquireCpuWakeLock();
        NexusBackgroundService.startOrUpdate(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        NexusNativeAlertPlugin.setAppInForeground(true);
    }

    @Override
    public void onPause() {
        NexusNativeAlertPlugin.setAppInForeground(false);
        super.onPause();
    }

    @Override
    public void onStop() {
        NexusNativeAlertPlugin.setAppInForeground(false);
        super.onStop();
    }

    @Override
    public void onDestroy() {
        NexusNativeAlertPlugin.setAppInForeground(false);
        super.onDestroy();
        if (cpuWakeLock != null && cpuWakeLock.isHeld()) {
            try {
                cpuWakeLock.release();
            } catch (Exception ignored) {
            }
        }
    }

    private void acquireCpuWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                cpuWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nexus:daemon_keepalive");
                cpuWakeLock.acquire();
            }
        } catch (Exception ignored) {
        }
    }
}
