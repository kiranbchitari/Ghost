import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { router, Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { showError } from '@/components/dialog';
import { startConversation } from '@/features/messaging/api';
import { maskText } from '@/features/messaging/mask';
import { useConversations } from '@/features/messaging/use-conversations';
import { HeroAvatar } from '@/features/profile/hero-avatar';
import { heroFor } from '@/features/profile/heroes';
import { useMyProfile } from '@/features/profile/use-my-profile';
import { useAppTheme, useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

export default function ChatsScreen() {
  const { theme } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const { code: myCode, hero: myHero, error: codeError } = useMyProfile();
  const { conversations, error, isRefreshing, refresh } = useConversations();
  const [friendCode, setFriendCode] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Show the tick for a moment after copying.
  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [isCopied]);

  async function startChat() {
    const code = friendCode.trim();
    if (!code || isStarting) return;

    setIsStarting(true);
    try {
      const id = await startConversation(code);
      setFriendCode('');
      router.push({ pathname: '/chat/[id]', params: { id, code } });
    } catch (e) {
      showError("Couldn't start chat", e);
    } finally {
      setIsStarting(false);
    }
  }

  async function copyCode() {
    if (!myCode) return;
    await Clipboard.setStringAsync(myCode);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setIsCopied(true);
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.newChat}>
        <TextInput
          style={styles.input}
          placeholder="Friend's code, e.g. Thor4821"
          placeholderTextColor={theme.colors.placeholder}
          selectionColor={theme.colors.tint}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          maxLength={24}
          value={friendCode}
          onChangeText={setFriendCode}
          onSubmitEditing={startChat}
          returnKeyType="go"
        />
        <Pressable
          style={[styles.button, (!friendCode.trim() || isStarting) && styles.buttonDisabled]}
          disabled={!friendCode.trim() || isStarting}
          onPress={startChat}>
          <Text style={styles.buttonText}>Chat</Text>
        </Pressable>
      </View>

      {codeError && <Text style={styles.error}>{codeError}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );

  return (
    <>
      <Tabs.Screen
        options={{
          // Like WhatsApp's wordmark: your code, left-aligned in the header.
          headerTitleAlign: 'left',
          headerTitle: () => (
            <Pressable
              style={styles.brand}
              onPress={copyCode}
              disabled={!myCode}
              accessibilityRole="button"
              accessibilityLabel={myCode ? `Your Ghost code ${myCode}` : 'Your Ghost code'}
              accessibilityHint="Copies your code">
              {myHero && <HeroAvatar hero={myHero} size={30} />}
              <Text style={styles.brandCode} numberOfLines={1} adjustsFontSizeToFit>
                {myCode ?? '········'}
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              style={styles.headerButton}
              onPress={copyCode}
              disabled={!myCode}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={isCopied ? 'Copied' : 'Copy your Ghost code'}>
              <Ionicons name={isCopied ? 'checkmark' : 'copy-outline'} size={22} color={theme.colors.tint} />
            </Pressable>
          ),
        }}
      />
      <FlatList
      style={styles.screen}
      data={conversations}
      keyExtractor={(c) => c.conversation_id}
      ListHeaderComponent={header}
      ListEmptyComponent={<Text style={styles.empty}>No chats yet.</Text>}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={theme.colors.textMuted} />
      }
      renderItem={({ item }) => {
        const unread = item.unread_count ?? 0;
        return (
          <Pressable
            style={styles.row}
            onPress={() =>
              router.push({
                pathname: '/chat/[id]',
                params: { id: item.conversation_id, code: item.friend_code },
              })
            }>
            <HeroAvatar hero={heroFor(item.friend_avatar, item.friend_code)} size={46} />
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Text style={styles.rowTitle}>{item.friend_code}</Text>
                {/* Like WhatsApp, the time takes the accent colour while there's unread. */}
                <Text style={[styles.rowTime, unread > 0 && styles.rowTimeUnread]}>
                  {new Date(item.last_message_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              <View style={styles.rowBottom}>
                <Text style={styles.rowPreview} numberOfLines={1}>
                  {item.preview === null
                    ? 'No messages yet'
                    : theme.privacy?.maskMessages
                      ? maskText(item.preview)
                      : item.preview}
                </Text>
                {unread > 0 && (
                  <View style={styles.badge} accessibilityLabel={`${unread} unread`}>
                    <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        );
      }}
      />
    </>
  );
}

const createStyles = ({ colors, glow }: AppTheme) =>
  StyleSheet.create({
    screen: { backgroundColor: colors.background },
    header: { padding: 16, gap: 12 },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
    brandCode: {
      flexShrink: 1,
      color: colors.tint,
      fontSize: 24,
      fontWeight: '800',
      letterSpacing: 0.3,
      // Padding gives the glow room: iOS clips text shadows to the Text frame.
      ...(glow && {
        textShadowColor: glow,
        textShadowRadius: 10,
        textShadowOffset: { width: 0, height: 0 },
        paddingHorizontal: 8,
        marginHorizontal: -8,
      }),
    },
    headerButton: { paddingHorizontal: 16 },
    newChat: { flexDirection: 'row', gap: 8 },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.input,
    },
    button: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 18, justifyContent: 'center' },
    buttonDisabled: { opacity: 0.4 },
    buttonText: { color: colors.onAccent, fontWeight: '600', fontSize: 16 },
    error: { color: colors.danger },
    empty: { textAlign: 'center', color: colors.textMuted, marginTop: 24 },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
    rowBody: { flex: 1 },
    rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
    rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
    rowTime: { color: colors.textMuted, fontSize: 12 },
    rowTimeUnread: { color: colors.accent, fontWeight: '700' },
    rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    rowPreview: { flex: 1, color: colors.textMuted },
    badge: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    badgeText: { color: colors.onAccent, fontSize: 12, fontWeight: '700' },
  });
