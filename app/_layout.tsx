import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useDeliveryReceipts } from '@/features/messaging/use-delivery-receipts';
import { ConnectScreen } from '@/features/security/connect-screen';
import { ScreenProtection } from '@/features/security/screen-protection';
import { SessionProvider, useSession } from '@/hooks/use-session';
import { getDeviceKeyPair } from '@/services/encryption/device-keys';
import { PrivacyCover } from '@/theme/privacy-cover';
import { AppThemeProvider, useAppTheme } from '@/theme/theme-provider';

function RootNavigator() {
  const { session } = useSession();
  const userId = session?.user.id;

  // Create this identity's key pair and publish the public key as soon as it
  // signs in, so friends can encrypt to it before it ever opens a chat.
  useEffect(() => {
    if (!userId) return;
    getDeviceKeyPair(userId).catch((e: Error) => console.warn('Publishing encryption key failed:', e.message));
  }, [userId]);

  useDeliveryReceipts(userId);

  // Without a session nothing is routable. Gating outside the router (rather
  // than with Stack.Protected) means a new identity always starts from a
  // fresh navigator with no screens left over from the previous one.
  if (!session) return <ConnectScreen />;

  return (
    <Stack screenOptions={{ headerShown: false, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: 'Chat' }} />
    </Stack>
  );
}

function ThemedStatusBar() {
  const { theme } = useAppTheme();
  return <StatusBar style={theme.isDark ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <SessionProvider>
        <RootNavigator />
        <ThemedStatusBar />
        <PrivacyCover />
        <ScreenProtection />
      </SessionProvider>
    </AppThemeProvider>
  );
}
