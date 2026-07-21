const isProdBuild = process.env.NODE_ENV === 'production';

const config = {
  appId: 'rd.sheepskin.sandboxmusic',
  appName: 'Sandbox Music',
  webDir: 'dist',
  bundledWebRuntime: false,
  // Native HTTP bypasses browser CORS for dynamic stream URLs resolved on-device.
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    BackgroundMedia: {
      gaplessPlayback: true,
      stayAliveOnMinimize: true
    },
    // MainActivity pads the WebView container; Capacitor CSS insets fight OEM 3-button nav.
    SystemBars: {
      insetsHandling: 'disable',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_music',
    },
  },
  server: {
    androidScheme: 'https',
    // Release builds restrict navigation; dev/debug keeps LAN stream flexibility.
    cleartext: !isProdBuild,
    allowNavigation: isProdBuild
      ? ['https://*', 'http://localhost/*', 'http://127.0.0.1/*', 'http://10.*/*', 'http://192.168.*/*']
      : ['*'],
  },
  android: {
    // Retain Android SDK configuration alongside Leanback TV mode requirements
    allowMixedContent: !isProdBuild,
    // Self-hosted Sandbox Server is typically http://LAN-IP:3001
    cleartext: !isProdBuild,
    // false = full Gboard/IME (predictive text + voice dictation). captureInput swaps in a stub
    // InputConnection that breaks soft-keyboard suggestions and talk-to-type on phones.
    captureInput: false,
  },
  // Reserved for a future Capacitor iOS target (not in current release scope).
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    // Permit cross-origin stream fetches from registered mobile resolver addons.
    limitsNavigationsToAppBoundDomains: false,
    allowsLinkPreview: false
  }
};

export default config;
