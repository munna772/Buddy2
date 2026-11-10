import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.buddyai.privateassistant',
  appName: 'Buddy AI',
  webDir: 'www',
  server: {
    // The native Android shell loads the existing private Buddy service.
    // Chat, memory and history continue to use the same backend and database.
    url: 'https://buddy2-41iz.onrender.com',
    cleartext: false,
    allowNavigation: ['buddy2-41iz.onrender.com']
  }
};

export default config;
