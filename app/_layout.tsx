import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { DialogHost } from '@/components/dialog';
import { DisguiseProvider, useDisguise } from '@/features/disguise/disguise-provider';
import { SnakeGame } from '@/features/disguise/snake-game';
import { useDeliveryReceipts } from '@/features/messaging/use-delivery-receipts';
import { ConnectScreen } from '@/features/security/connect-screen';
import { PanicButton } from '@/features/security/panic-button';
import { ScreenProtection } from '@/features/security/screen-protection';
import { useAppState } from '@/hooks/use-app-state';
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

// Ghost is always a Snake game on the outside: while locked only the game
// exists (no chats, panic button or screenshot blocking to give it away).
// While unlocked, the game covers the app whenever it leaves the foreground,
// so the app switcher shows Snake.
function DisguiseGate({ children }: PropsWithChildren) {
  const { isLocked, isCaptureBlocked } = useDisguise();

  return (
    <>
      {isCaptureBlocked && <ScreenProtection />}
      {isLocked ? <SnakeGame /> : <Unlocked>{children}</Unlocked>}
    </>
  );
}

function Unlocked({ children }: PropsWithChildren) {
  const appState = useAppState();
  return (
    <>
      {children}
      {appState !== 'active' && (
        <View style={styles.cover} pointerEvents="none">
          <SnakeGame />
        </View>
      )}
    </>
  );
}

function ThemedStatusBar() {
  const { theme } = useAppTheme();
  return <StatusBar style={theme.isDark ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <AppThemeProvider>
          <SessionProvider>
            <DisguiseProvider>
              <DisguiseGate>
                <RootNavigator />
                <ThemedStatusBar />
                <DialogHost />
                <PanicButton />
                <PrivacyCover />
              </DisguiseGate>
            </DisguiseProvider>
          </SessionProvider>
        </AppThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Above the privacy cover (1000).
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1001, elevation: 1001 },
});
