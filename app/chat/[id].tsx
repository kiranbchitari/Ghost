import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BurnSettingsSheet } from '@/features/burn-mode/burn-settings-sheet';
import { describeBurn, formatBurn } from '@/features/burn-mode/timer';
import { ImageViewer } from '@/features/burn-photo/image-viewer';
import { PhotoComposer } from '@/features/burn-photo/photo-composer';
import { pickImage, type PickedImage } from '@/features/burn-photo/pick-image';
import { MessageBubble } from '@/features/messaging/message-bubble';
import { HeroAvatar } from '@/features/profile/hero-avatar';
import { heroFor } from '@/features/profile/heroes';
import { useMessages, type DisplayMessage } from '@/features/messaging/use-messages';
import { useKeyboardVisible } from '@/hooks/use-keyboard-visible';
import { useSession } from '@/hooks/use-session';
import { useAppTheme, useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

export default function ChatScreen() {
  const { id, code } = useLocalSearchParams<{ id: string; code?: string }>();
  const { session } = useSession();
  const { theme } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const {
    messages,
    peer,
    sharedKey,
    isReady,
    error,
    send,
    sendImage,
    deleteMessage,
    markViewed,
    settings,
    setTimer,
    eraseForEveryone,
  } = useMessages(id);
  const [isBurnSheetOpen, setIsBurnSheetOpen] = useState(false);
  const burnSummary = settings && describeBurn(settings.burn_seconds, settings.burn_mode);
  const [pickedImage, setPickedImage] = useState<PickedImage | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = messages.find((m) => m.id === viewingId) ?? null;
  const [draft, setDraft] = useState('');
  // iOS doesn't shrink a multiline input when its text is cleared, so after a
  // send the input is remounted (and refocused) to start again at one line.
  const [composerKey, setComposerKey] = useState(0);
  const insets = useSafeAreaInsets();
  const isKeyboardVisible = useKeyboardVisible();
  const listRef = useRef<FlatList<DisplayMessage>>(null);
  const oldestFirst = useMemo(() => [...messages].reverse(), [messages]);

  const headerHeight = useHeaderHeight();

  function scrollToLatest() {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }

  function chooseAttachment() {
    const pick = (source: 'camera' | 'library') =>
      pickImage(source)
        .then((image) => image && setPickedImage(image))
        .catch((e: Error) => Alert.alert(e.message));

    showActionSheet(['Take Photo', 'Choose from Library'], (index) =>
      pick(index === 0 ? 'camera' : 'library'),
    );
  }

  async function sendPickedImage(viewOnce: boolean) {
    if (!pickedImage) return;
    try {
      await sendImage(pickedImage, viewOnce);
      setPickedImage(null);
    } catch (e) {
      Alert.alert((e as Error).message);
    }
  }

  function confirmDelete(message: DisplayMessage) {
    showActionSheet(
      ['Delete for everyone'],
      () => deleteMessage(message).catch((e: Error) => Alert.alert(e.message)),
      0,
    );
  }

  function closeViewer() {
    const message = viewing;
    setViewingId(null);
    // Closing a view-once photo you received burns it.
    if (message?.view_once && message.sender_id !== session?.user.id) {
      markViewed(message).catch((e: Error) => Alert.alert(e.message));
    }
  }

  async function submit() {
    const body = draft.trim();
    if (!body) return;

    // Clear straight away so anything typed while this sends starts a new
    // message; put the text back if sending fails.
    setDraft('');
    setComposerKey((k) => k + 1);
    try {
      await send(body);
    } catch (e) {
      setDraft((current) => (current ? `${body} ${current}` : body));
      Alert.alert((e as Error).message);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      // The iOS header is translucent and the screen starts at the top of the
      // window, so no vertical offset is needed.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          // Like WhatsApp, tapping the contact opens the chat's settings.
          headerTitle: () => (
            <Pressable
              style={styles.headerTitle}
              onPress={() => setIsBurnSheetOpen(true)}
              disabled={!settings}
              accessibilityRole="button"
              accessibilityHint="Opens burn settings">
              <HeroAvatar hero={heroFor(peer?.friend_avatar, peer?.friend_code ?? code)} size={30} />
              <Text style={styles.headerCode}>{peer?.friend_code ?? code ?? 'Chat'}</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => setIsBurnSheetOpen(true)}
              disabled={!settings}
              style={styles.timerButton}
              accessibilityRole="button"
              accessibilityLabel="Burn settings">
              <Ionicons
                name={settings?.burn_seconds ? 'flame' : 'flame-outline'}
                size={20}
                color={settings?.burn_seconds ? '#ff7a1a' : theme.colors.text}
              />
              {settings?.burn_seconds ? (
                <Text style={styles.timerLabel}>{formatBurn(settings.burn_seconds)}</Text>
              ) : null}
            </Pressable>
          ),
        }}
      />

      {messages.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No messages yet. Say hi.</Text>
        </View>
      ) : (
        // Not `inverted`: on iOS 26 the flipped list gets the header's scroll edge
        // blur over its whole body. Render oldest-first and pin to the bottom.
        <FlatList
          ref={listRef}
          data={oldestFirst}
          keyExtractor={(m) => m.id}
          // Pad for the translucent header ourselves: with "automatic", iOS
          // resets the offset after our initial scroll to the latest message.
          contentContainerStyle={[styles.list, { paddingTop: headerHeight + 8 }]}
          contentInsetAdjustmentBehavior="never"
          keyboardDismissMode="interactive"
          onContentSizeChange={scrollToLatest}
          onLayout={scrollToLatest}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isMine={item.sender_id === session?.user.id}
              sharedKey={sharedKey}
              onOpenImage={(message) => setViewingId(message.id)}
              onDelete={confirmDelete}
            />
          )}
        />
      )}

      {/* Above the composer rather than at the top, which sits under the translucent header. */}
      <Text style={[styles.notice, error && styles.error]}>
        {error ??
          (isReady
            ? `🔒 End-to-end encrypted${burnSummary ? ` · 🔥 ${burnSummary}` : ''}`
            : 'Setting up encryption…')}
      </Text>

      <View style={[styles.composer, { paddingBottom: isKeyboardVisible ? 8 : Math.max(insets.bottom, 8) }]}>
        <Pressable
          style={[styles.attach, !isReady && styles.sendDisabled]}
          disabled={!isReady}
          onPress={chooseAttachment}
          accessibilityRole="button"
          accessibilityLabel="Add photo">
          <Text style={styles.attachText}>+</Text>
        </Pressable>
        <TextInput
          key={composerKey}
          autoFocus={composerKey > 0}
          style={styles.input}
          placeholder="Message"
          placeholderTextColor={theme.colors.placeholder}
          selectionColor={theme.colors.tint}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          multiline
          maxLength={4000}
          value={draft}
          onChangeText={setDraft}
        />
        <Pressable
          style={[styles.send, (!draft.trim() || !isReady) && styles.sendDisabled]}
          disabled={!draft.trim() || !isReady}
          onPress={submit}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>

      {pickedImage && (
        <PhotoComposer image={pickedImage} onCancel={() => setPickedImage(null)} onSend={sendPickedImage} />
      )}
      {viewing && <ImageViewer message={viewing} sharedKey={sharedKey} onClose={closeViewer} />}
      {isBurnSheetOpen && settings && (
        <BurnSettingsSheet
          settings={settings}
          onChange={(seconds, mode) => setTimer(seconds, mode).catch((e: Error) => Alert.alert(e.message))}
          onErase={() => eraseForEveryone().catch((e: Error) => Alert.alert(e.message))}
          onClose={() => setIsBurnSheetOpen(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// iOS action sheet with a Cancel button; a plain alert elsewhere.
function showActionSheet(options: string[], onSelect: (index: number) => void, destructiveIndex?: number) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: [...options, 'Cancel'], cancelButtonIndex: options.length, destructiveButtonIndex: destructiveIndex },
      (index) => index < options.length && onSelect(index),
    );
    return;
  }
  Alert.alert('', undefined, [
    ...options.map((text, index) => ({
      text,
      style: index === destructiveIndex ? ('destructive' as const) : ('default' as const),
      onPress: () => onSelect(index),
    })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

const createStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.chatBackground },
    headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    timerButton: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8 },
    timerLabel: { color: '#ff7a1a', fontSize: 13, fontWeight: '700' },
    headerCode: { color: colors.text, fontSize: 17, fontWeight: '600', fontFamily: 'Menlo' },
    notice: { color: colors.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 6 },
    error: { color: colors.danger },
    list: { paddingHorizontal: 12, paddingVertical: 8 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { color: colors.textMuted },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.composer,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      paddingHorizontal: 14,
      maxHeight: 120,
      paddingTop: 9,
      paddingBottom: 9,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.input,
    },
    attach: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.input,
      borderWidth: 1,
      borderColor: colors.border,
    },
    attachText: { color: colors.tint, fontSize: 24, lineHeight: 26, fontWeight: '500' },
    send: { backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 },
    sendDisabled: { opacity: 0.4 },
    sendText: { color: colors.onAccent, fontWeight: '600' },
  });
