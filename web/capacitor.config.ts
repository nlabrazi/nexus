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
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#07090e',
    },
  },
};

export default config;
