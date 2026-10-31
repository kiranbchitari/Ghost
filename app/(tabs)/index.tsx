import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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

  async function startChat() {
    const code = friendCode.trim().toUpperCase();
    if (!code || isStarting) return;

    setIsStarting(true);
    try {
      const id = await startConversation(code);
      setFriendCode('');
      router.push({ pathname: '/chat/[id]', params: { id, code } });
    } catch (e) {
      Alert.alert((e as Error).message);
    } finally {
      setIsStarting(false);
    }
  }

  function shareCode() {
    if (myCode) Share.share({ message: `Chat with me on Ghost. My code: ${myCode}` });
  }

  const header = (
    <View style={styles.header}>
      <Pressable style={styles.codeCard} onPress={shareCode} disabled={!myCode}>
        {myHero && <HeroAvatar hero={myHero} size={52} />}
        <Text style={styles.codeLabel}>Your Ghost code</Text>
        <Text style={styles.code}>{myCode ?? '········'}</Text>
        <Text style={styles.codeHint}>
          {codeError ?? 'Tap to share. Anyone with this code can start a chat with you.'}
        </Text>
      </Pressable>

      <View style={styles.newChat}>
        <TextInput
          style={styles.input}
          placeholder="Friend's code"
          placeholderTextColor={theme.colors.placeholder}
          selectionColor={theme.colors.tint}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
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

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );

  return (
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
      renderItem={({ item }) => (
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
              <Text style={styles.rowTime}>
                {new Date(item.last_message_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
            <Text style={styles.rowPreview} numberOfLines={1}>
              {item.preview === null
                ? 'No messages yet'
                : theme.privacy?.maskMessages
                  ? maskText(item.preview)
                  : item.preview}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const createStyles = ({ colors, glow }: AppTheme) =>
  StyleSheet.create({
    screen: { backgroundColor: colors.background },
    header: { padding: 16, gap: 12 },
    codeCard: {
      backgroundColor: colors.codeCard,
      borderColor: colors.codeCardBorder,
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      gap: 6,
    },
    codeLabel: { color: colors.codeCardMuted, fontSize: 13 },
    code: {
      color: colors.codeCardText,
      fontSize: 28,
      fontFamily: 'Menlo',
      letterSpacing: 3,
      marginVertical: 4,
      // Padding gives the glow room: iOS clips text shadows to the Text frame.
      ...(glow && {
        textShadowColor: glow,
        textShadowRadius: 12,
        textShadowOffset: { width: 0, height: 0 },
        padding: 14,
        marginVertical: -10,
      }),
    },
    codeHint: { color: colors.codeCardMuted, fontSize: 12, textAlign: 'center' },
    newChat: { flexDirection: 'row', gap: 8 },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      fontFamily: 'Menlo',
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
    rowTitle: { fontSize: 16, fontWeight: '600', fontFamily: 'Menlo', color: colors.text },
    rowTime: { color: colors.textMuted, fontSize: 12 },
    rowPreview: { color: colors.textMuted, marginTop: 2 },
  });
