import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nexus.mobile',
  appName: 'Nexus',
  webDir: '.output/public',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  plugins: {
    VoiceRecorder: {},
  },
};

export default config;
