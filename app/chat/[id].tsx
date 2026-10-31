import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showActionSheet, showAlert, showError } from '@/components/dialog';
import { BurnSettingsSheet } from '@/features/burn-mode/burn-settings-sheet';
import { describeBurn, formatBurn } from '@/features/burn-mode/timer';
import { ImageViewer } from '@/features/burn-photo/image-viewer';
import { PhotoComposer } from '@/features/burn-photo/photo-composer';
import { pickImage, type PickedImage } from '@/features/burn-photo/pick-image';
import { AttachmentPanel } from '@/features/messaging/attachment-panel';
import { EmojiPanel } from '@/features/messaging/emoji-panel';
import { MessageBubble } from '@/features/messaging/message-bubble';
import { canEdit } from '@/features/messaging/edit';
import { describeForQuote, quoteFor, type Quote } from '@/features/messaging/reply';
import { TypingBubble } from '@/features/messaging/typing-bubble';
import { useReactions, type ReactionChip } from '@/features/messaging/use-reactions';
import { useTyping } from '@/features/messaging/use-typing';
import { HeroAvatar } from '@/features/profile/hero-avatar';
import { heroFor } from '@/features/profile/heroes';
import { useMessages, type DisplayMessage } from '@/features/messaging/use-messages';
import { panicBottomPanel } from '@/features/security/panic-button';
import { useSession } from '@/hooks/use-session';
import { ChatWallpaper } from '@/theme/chat-wallpaper';
import { loadDraft, saveDraft, type Draft } from '@/services/storage/encrypted-drafts';
import { useAppTheme, useThemedStyles } from '@/theme/theme-provider';
import { chatShadow, type AppTheme } from '@/theme/themes';

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
    isConnected,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    error,
    send,
    retry,
    discard,
    sendImage,
    editMessage,
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
  const myId = session?.user.id;
  const friendName = peer?.friend_code ?? code ?? 'Them';
  const mask = !!theme.privacy?.maskMessages;
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  // Held message: the header turns into Reply / Copy / Delete actions.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  // Swiped (or chosen) message the next one replies to.
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const replyTo = replyToId ? (byId.get(replyToId) ?? null) : null;
  // Briefly tinted after jumping to it from a quote.
  const [flashId, setFlashId] = useState<string | null>(null);
  // Short confirmation shown in place of the encryption notice.
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Double-tapped message showing the reaction tray (a held message shows it too).
  const [reactingId, setReactingId] = useState<string | null>(null);
  // Message getting a reaction from the full emoji panel (the tray's +).
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  // Own message being edited in the composer. The draft that was there is
  // set aside and comes back afterwards.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? (byId.get(editingId) ?? null) : null;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
  // An edit is on its way to the server; the composer keeps it until it lands.
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const setAside = useRef<Draft | null>(null);
  const storedIds = useMemo(() => messages.filter((m) => !m.sendState).map((m) => m.id), [messages]);
  const { reactions, react } = useReactions(id, storedIds, sharedKey, myId);
  const reactionsRef = useRef(reactions);
  reactionsRef.current = reactions;
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const { isPeerTyping, onDraftChange, stopTyping } = useTyping(id, myId);
  // iOS doesn't shrink a multiline input when its text is cleared, so after a
  // send the input is remounted (and refocused) to start again at one line.
  const [composerKey, setComposerKey] = useState(0);
  const insets = useSafeAreaInsets();
  // Like WhatsApp, the composer rides up with the keyboard frame by frame. The
  // screen always reaches the bottom of the window (Android is edge-to-edge),
  // so padding it by the keyboard's height keeps the composer just above it.
  // `height` runs from 0 to minus the keyboard height.
  const keyboard = useReanimatedKeyboardAnimation();
  // The emoji panel takes the keyboard's place at the same height. The screen is
  // padded by whichever is taller, so swapping one for the other doesn't move
  // the composer.
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const emojiSpace = useSharedValue(0);
  const lastKeyboardHeight = useRef(300);
  const restingPadding = Math.max(insets.bottom, 8);
  const keyboardSpace = useAnimatedStyle(() => ({
    paddingBottom: Math.max(-keyboard.height.value, emojiSpace.value),
  }));
  // Drop the home-indicator inset as the keyboard or emoji panel (which cover
  // it) comes up. Based on height rather than progress: with a hardware
  // keyboard the soft keyboard is "shown" at zero height, and the inset must stay.
  const composerPadding = useAnimatedStyle(() => ({
    paddingBottom: Math.max(restingPadding - Math.max(-keyboard.height.value, emojiSpace.value), 8),
  }));
  // The panel rides up with its space rather than appearing over the composer.
  const emojiHeight = lastKeyboardHeight.current;
  const emojiSlide = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(emojiHeight - emojiSpace.value, 0) }],
  }));
  // The panic button rises above the emoji panel as it does above the keyboard.
  useAnimatedReaction(
    () => emojiSpace.value,
    (space) => {
      panicBottomPanel.value = space;
    },
  );
  useEffect(
    () => () => {
      panicBottomPanel.value = 0;
    },
    [],
  );
  const [isAttachOpen, setIsAttachOpen] = useState(false);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  // Where emoji go; kept while the input is blurred behind the emoji panel.
  const selection = useRef({ start: 0, end: 0 });
  const listRef = useRef<FlatList<Row>>(null);
  const oldestFirst = useMemo(() => [...messages].reverse(), [messages]);
  // Messages with a day heading ("Today", "Yesterday", …) before each new day.
  const rows = useMemo(() => withDayHeadings(oldestFirst), [oldestFirst]);
  // Quotes per message, rebuilt only when messages change, so rows stay memoised.
  const quotes = useMemo(() => {
    const map = new Map<string, Quote | null>();
    for (const m of messages) map.set(m.id, quoteFor(m, byId, myId, friendName, mask));
    return map;
  }, [messages, byId, myId, friendName, mask]);

  const headerHeight = useHeaderHeight();

  // Like WhatsApp, the chat only follows new messages while you're at the
  // bottom; scrolled up, a button offers to jump down (with a count).
  const isNearBottom = useRef(true);
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const newestId = useRef<string | undefined>(undefined);

  function scrollToLatest(animated = false) {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }

  function followIfAtBottom() {
    if (isNearBottom.current) scrollToLatest();
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const near = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
    isNearBottom.current = near;
    if (near === isAwayFromBottom) setIsAwayFromBottom(!near);
    if (near && newBelow) setNewBelow(0);
  }

  // Count the friend's messages that arrive while scrolled up.
  useEffect(() => {
    const newest = messages[0];
    if (!newest || newest.id === newestId.current) return;
    const isFirst = newestId.current === undefined;
    newestId.current = newest.id;
    if (!isFirst && !isNearBottom.current && newest.sender_id !== myId) setNewBelow((n) => n + 1);
  }, [messages, myId]);

  // "Connecting…" only if it takes a moment, not on every chat opening.
  const [showConnecting, setShowConnecting] = useState(false);
  useEffect(() => {
    if (isConnected) {
      setShowConnecting(false);
      return;
    }
    const timer = setTimeout(() => setShowConnecting(true), 1500);
    return () => clearTimeout(timer);
  }, [isConnected]);

  // Remember the keyboard's height for the emoji panel, and once the keyboard
  // is up (it now covers the panel), take the panel away.
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', (e) => {
      if (e.endCoordinates.height > 100) lastKeyboardHeight.current = e.endCoordinates.height;
      emojiSpace.value = 0;
      setIsEmojiOpen(false);
    });
    return () => subscription.remove();
  }, [emojiSpace]);

  // Android back clears a selection, closes the reaction tray or panel, the
  // attach card or emoji panel, or stops editing, before leaving the chat.
  useEffect(() => {
    if (!selectedId && !isAttachOpen && !isEmojiOpen && !reactingId && !reactionPickerId && !editingId) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedId) {
        setSelectedId(null);
        return true;
      }
      if (reactionPickerId || reactingId) {
        setReactionPickerId(null);
        setReactingId(null);
        return true;
      }
      if (editingId && !isEmojiOpen && !isAttachOpen) {
        finishEditing();
        return true;
      }
      setIsAttachOpen(false);
      if (isEmojiOpen) closeEmoji();
      return true;
    });
    return () => subscription.remove();
  });

  // A selected message that burns or is deleted can't be acted on.
  useEffect(() => {
    if (selectedId && (!selected || selected.isDeleted)) setSelectedId(null);
  }, [selectedId, selected]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), 1200);
    return () => clearTimeout(timer);
  }, [flashId]);

  // Drafts survive leaving the chat and restarting the app, encrypted on this
  // phone (src/services/storage/encrypted-drafts.ts). While a sent message is
  // being edited, the draft set aside is what's kept.
  // State so the save below runs again once loading ends (text typed while it
  // loaded is saved then); the ref is for the exit flush.
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  const isDraftLoadedRef = useRef(false);
  isDraftLoadedRef.current = isDraftLoaded;
  const draftToKeep = useRef<Draft | null>(null);
  draftToKeep.current = editingId ? setAside.current : { text: draft, replyTo: replyToId };

  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    setIsDraftLoaded(false);
    loadDraft(myId, id)
      .then((saved) => {
        if (cancelled || !saved) return;
        // Anything typed while it loaded wins.
        setDraft((current) => {
          if (current) return current;
          selection.current = { start: saved.text.length, end: saved.text.length };
          return saved.text;
        });
        if (saved.replyTo) setReplyToId((current) => current ?? saved.replyTo ?? null);
      })
      .catch((e: Error) => console.warn('Loading draft failed:', e.message))
      .finally(() => {
        if (cancelled) return;
        isDraftLoadedRef.current = true;
        setIsDraftLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, myId]);

  // Saved a moment after typing stops…
  useEffect(() => {
    if (!myId || !isDraftLoaded || editingId) return;
    const value = { text: draft, replyTo: replyToId };
    const timer = setTimeout(
      () => saveDraft(myId, id, value).catch((e: Error) => console.warn('Saving draft failed:', e.message)),
      400,
    );
    return () => clearTimeout(timer);
  }, [draft, replyToId, editingId, isDraftLoaded, id, myId]);

  // …and right away on leaving the chat or the app. Only with the key already
  // in memory: after the panic button wiped it, it isn't read back.
  useEffect(() => {
    if (!myId) return;
    const flush = () => {
      if (!isDraftLoadedRef.current) return;
      saveDraft(myId, id, draftToKeep.current, { onlyIfKeyInMemory: true }).catch((e: Error) =>
        console.warn('Saving draft failed:', e.message),
      );
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush();
    });
    return () => {
      subscription.remove();
      flush();
    };
  }, [id, myId]);

  // A message being edited that burns or is deleted can't be edited.
  useEffect(() => {
    if (editingId && (!editing || editing.isDeleted || editing.isExpired)) finishEditing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, editing]);

  // The tray goes when its message does.
  useEffect(() => {
    if (reactingId && !byId.get(reactingId)) setReactingId(null);
  }, [reactingId, byId]);

  const select = useCallback((message: DisplayMessage) => {
    Haptics.selectionAsync().catch(() => {});
    setIsAttachOpen(false);
    setReactingId(null);
    setSelectedId((current) => (current === message.id ? null : message.id));
  }, []);

  const startReply = useCallback((message: DisplayMessage) => {
    setSelectedId(null);
    setReactingId(null);
    setReplyToId(message.id);
    inputRef.current?.focus();
  }, []);

  const openImage = useCallback((message: DisplayMessage) => {
    setReactingId(null);
    // A tap waits a moment for a possible double tap; by then the photo may
    // have been deleted, burned or (view once) opened.
    const current = byIdRef.current.get(message.id);
    if (!current || current.isDeleted || current.isExpired || (current.view_once && current.viewed_at)) return;
    setViewingId(message.id);
  }, []);

  // Double tap: the reaction tray, like WhatsApp.
  const openReactions = useCallback((message: DisplayMessage) => {
    setSelectedId(null);
    setIsAttachOpen(false);
    setReactingId(message.id);
  }, []);

  const closeReactions = useCallback(() => setReactingId(null), []);

  const reactTo = useCallback(
    (message: DisplayMessage, emoji: string | null) => {
      setReactingId(null);
      setSelectedId(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      react(message.id, emoji).catch((e: Error) => showError("Couldn't react", e));
    },
    [react],
  );

  const moreReactions = useCallback((message: DisplayMessage) => {
    setReactingId(null);
    setSelectedId(null);
    Keyboard.dismiss();
    setReactionPickerId(message.id);
  }, []);

  // Who reacted with what; yours can be taken back from here. Stealth keeps
  // the emoji masked here too (hold the reactions to see them).
  const showReactions = useCallback(
    (message: DisplayMessage) => {
      const list = reactionsRef.current.get(message.id) ?? [];
      if (list.length === 0) return;
      setReactingId(null);
      const shown = (emoji: string) => (mask ? '•' : emoji);
      showActionSheet(
        list.map((r) =>
          r.isMine
            ? {
                text: `You  ${shown(r.emoji)}  · Tap to remove`,
                icon: 'close-circle-outline' as const,
                style: 'destructive' as const,
                onPress: () => reactTo(message, null),
              }
            : { text: `${friendName}  ${shown(r.emoji)}`, icon: 'person-outline' as const, onPress: () => {} },
        ),
        'Reactions',
      );
    },
    [friendName, reactTo, mask],
  );

  // Put the selected message of yours in the composer to change it.
  function startEditing() {
    const message = selected;
    if (!message || !canEdit(message, myId)) return;
    stopTyping();
    if (!editingId) setAside.current = { text: draft, replyTo: replyToId };
    setSelectedId(null);
    setReactingId(null);
    setIsAttachOpen(false);
    setReplyToId(null);
    setEditingId(message.id);
    const text = message.text ?? '';
    setDraft(text);
    selection.current = { start: text.length, end: text.length };
    if (!isEmojiOpen) inputRef.current?.focus();
  }

  // Leaves editing and brings back the draft that was set aside.
  function finishEditing() {
    const saved = setAside.current;
    setAside.current = null;
    setEditingId(null);
    const text = saved?.text ?? '';
    setDraft(text);
    selection.current = { start: text.length, end: text.length };
    setReplyToId(saved?.replyTo ?? null);
    setComposerKey((k) => k + 1);
  }

  const offerRetry = useCallback(
    (message: DisplayMessage) =>
      showActionSheet(
        [
          { text: 'Try again', icon: 'refresh', onPress: () => retry(message.id) },
          { text: 'Delete', icon: 'trash-outline', style: 'destructive', onPress: () => discard(message.id) },
        ],
        "This message wasn't sent.",
      ),
    [retry, discard],
  );

  async function copySelected() {
    if (!selected?.text) return;
    await Clipboard.setStringAsync(selected.text);
    setSelectedId(null);
    setToast('Copied');
  }

  function deleteSelected() {
    const message = selected;
    if (!message) return;
    setSelectedId(null);
    showAlert(
      'Delete for everyone?',
      'It burns on both phones and is deleted from the server.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMessage(message).catch((e: Error) => showError("Couldn't delete message", e)),
        },
      ],
      { icon: 'trash-outline' },
    );
  }

  // Scroll to a quoted message and tint it for a moment.
  const jumpTo = useCallback(
    (messageId: string) => {
      const index = rows.findIndex((row) => row.type === 'message' && row.message.id === messageId);
      if (index < 0) return;
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      setFlashId(messageId);
    },
    [rows],
  );

  function openEmoji() {
    setIsAttachOpen(false);
    const height = lastKeyboardHeight.current;
    // Under an open keyboard it can appear at once; otherwise slide it up.
    emojiSpace.value = keyboard.height.value !== 0 ? height : withTiming(height, { duration: 200 });
    setIsEmojiOpen(true);
    Keyboard.dismiss();
  }

  function closeEmoji() {
    emojiSpace.value = withTiming(0, { duration: 200 });
    setIsEmojiOpen(false);
  }

  // Back to the keyboard: the panel stays underneath until the keyboard covers it.
  function toggleEmoji() {
    if (isEmojiOpen) inputRef.current?.focus();
    else openEmoji();
  }

  function insertEmoji(emoji: string) {
    const { start, end } = selection.current;
    setDraft((current) => current.slice(0, start) + emoji + current.slice(end));
    // The text now has at least this emoji in it.
    if (!editingId) onDraftChange(emoji);
    selection.current = { start: start + emoji.length, end: start + emoji.length };
  }

  function pick(source: 'camera' | 'library') {
    setIsAttachOpen(false);
    pickImage(source)
      .then((image) => image && setPickedImage(image))
      .catch((e: Error) => showError("Couldn't open photos", e));
  }

  async function sendPickedImage(viewOnce: boolean) {
    if (!pickedImage) return;
    try {
      await sendImage(pickedImage, viewOnce);
      setPickedImage(null);
    } catch (e) {
      showError('Photo not sent', e);
    }
  }

  function closeViewer() {
    const message = viewing;
    setViewingId(null);
    // Closing a view-once photo you received burns it.
    if (message?.view_once && message.sender_id !== session?.user.id) {
      markViewed(message).catch((e: Error) => showError("Couldn't burn photo", e));
    }
  }

  async function submit() {
    const body = draft.trim();
    if (!body) return;

    if (editing) {
      const target = editing;
      if (isSavingEdit) return;
      if (body === target.text) {
        finishEditing();
        return;
      }
      // Stay in edit mode until the server takes it. The server alone decides
      // the 5-minute window (it allows a little grace), so if it refuses, the
      // new text is still in the composer rather than lost.
      setIsSavingEdit(true);
      editMessage(target.id, body)
        .then(() => {
          if (editingIdRef.current === target.id) finishEditing();
        })
        .catch((e: Error) => showError("Couldn't edit message", e))
        .finally(() => setIsSavingEdit(false));
      return;
    }

    // The message shows at once (🕓) and the composer clears; if sending fails
    // it stays in the chat as "Not sent", to retry or delete.
    const replyingTo = replyTo && !replyTo.isDeleted && !replyTo.isExpired ? replyTo.id : undefined;
    try {
      send(body, replyingTo);
    } catch (e) {
      showError('Message not sent', e);
      return;
    }
    stopTyping();
    setDraft('');
    setReplyToId(null);
    setComposerKey((k) => k + 1);
    // Sending always brings you back down to your message.
    isNearBottom.current = true;
    scrollToLatest(true);
  }

  return (
    <Animated.View style={[styles.container, keyboardSpace]}>
      {theme.chat?.wallpaper && <ChatWallpaper stroke={theme.chat.wallpaper.stroke} />}
      <Stack.Screen
        options={
          selected
            ? {
                // WhatsApp-style action bar for the held message.
                headerBackVisible: false,
                headerTitle: () => null,
                headerLeft: () => (
                  <Pressable
                    onPress={() => setSelectedId(null)}
                    style={styles.headerAction}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel selection">
                    <Ionicons name="close" size={24} color={theme.colors.text} />
                  </Pressable>
                ),
                headerRight: () => (
                  <View style={styles.headerActions}>
                    <Pressable
                      onPress={() => startReply(selected)}
                      style={styles.headerAction}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Reply">
                      <Ionicons name="arrow-undo-outline" size={22} color={theme.colors.text} />
                    </Pressable>
                    {selected.kind === 'text' && selected.text !== null && (
                      <Pressable
                        onPress={copySelected}
                        style={styles.headerAction}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Copy">
                        <Ionicons name="copy-outline" size={22} color={theme.colors.text} />
                      </Pressable>
                    )}
                    {canEdit(selected, myId) && (
                      <Pressable
                        onPress={startEditing}
                        style={styles.headerAction}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Edit">
                        <Ionicons name="create-outline" size={22} color={theme.colors.text} />
                      </Pressable>
                    )}
                    {selected.sender_id === myId && (
                      <Pressable
                        onPress={deleteSelected}
                        style={styles.headerAction}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Delete for everyone">
                        <Ionicons name="trash-outline" size={22} color={theme.colors.text} />
                      </Pressable>
                    )}
                  </View>
                ),
              }
            : {
                headerBackVisible: true,
                headerLeft: undefined,
                // Like WhatsApp, tapping the contact opens the chat's settings.
                headerTitle: () => (
                  <Pressable
                    style={styles.headerTitle}
                    onPress={() => setIsBurnSheetOpen(true)}
                    disabled={!settings}
                    accessibilityRole="button"
                    accessibilityHint="Opens burn settings">
                    <HeroAvatar hero={heroFor(peer?.friend_avatar, peer?.friend_code ?? code)} size={30} />
                    <View>
                      <Text style={styles.headerCode}>{peer?.friend_code ?? code ?? 'Chat'}</Text>
                      {isPeerTyping && <Text style={styles.headerTyping}>typing…</Text>}
                    </View>
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
              }
        }
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
          data={rows}
          keyExtractor={(row) => row.key}
          // Pad for the translucent header ourselves: with "automatic", iOS
          // resets the offset after our initial scroll to the latest message.
          contentContainerStyle={[styles.list, { paddingTop: headerHeight + 8 }]}
          contentInsetAdjustmentBehavior="never"
          keyboardDismissMode="interactive"
          onScroll={onScroll}
          onScrollBeginDrag={closeReactions}
          scrollEventThrottle={32}
          onContentSizeChange={followIfAtBottom}
          onLayout={followIfAtBottom}
          // Older pages load near the top without the view jumping.
          onStartReached={hasOlder ? loadOlder : undefined}
          onStartReachedThreshold={0.5}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          ListHeaderComponent={isLoadingOlder ? <ActivityIndicator style={styles.loadingOlder} /> : undefined}
          ListFooterComponent={isPeerTyping ? <TypingBubble /> : undefined}
          initialNumToRender={30}
          windowSize={11}
          // Rows vary in height, so a far jump can miss: land near it, then retry.
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5 }), 100);
          }}
          extraData={[selectedId, flashId, quotes, reactingId, reactions]}
          renderItem={({ item }) =>
            item.type === 'day' ? (
              <View style={styles.dayRow}>
                <Text style={styles.dayLabel}>{item.label}</Text>
              </View>
            ) : (
              <MessageBubble
                message={item.message}
                isMine={item.message.sender_id === myId}
                sharedKey={sharedKey}
                quote={quotes.get(item.message.id) ?? null}
                isSelected={item.message.id === selectedId || item.message.id === flashId}
                isSelecting={selectedId !== null}
                onOpenImage={openImage}
                onSelect={select}
                onReply={startReply}
                onQuotePress={jumpTo}
                onFailedPress={offerRetry}
                reactions={reactions.get(item.message.id) ?? NO_REACTIONS}
                isReacting={item.message.id === reactingId || item.message.id === selectedId}
                onOpenReactions={openReactions}
                onReact={reactTo}
                onMoreReactions={moreReactions}
                onReactionsPress={showReactions}
                onTap={closeReactions}
                isFirstInGroup={item.isFirstInGroup}
              />
            )
          }
        />
      )}


      {/* Tapping anywhere else closes the attach card. */}
      {isAttachOpen && (
        <Pressable style={styles.dismissLayer} onPress={() => setIsAttachOpen(false)} accessible={false} />
      )}

      {/* Above the composer rather than at the top, which sits under the translucent header. */}
      <View style={styles.noticeRow}>
        <Text style={[styles.notice, error && styles.error]}>
          {error ??
            toast ??
            (isReady && showConnecting ? 'Connecting…' : null) ??
            (isReady
              ? `🔒 End-to-end encrypted${burnSummary ? ` · 🔥 ${burnSummary}` : ''}`
              : 'Setting up encryption…')}
        </Text>
      </View>

      <View>
        {isAttachOpen && <AttachmentPanel onPick={pick} />}
        {/* Rides with the composer (and the keyboard), above the notice line. */}
        {isAwayFromBottom && (
          <Pressable
            style={styles.jumpDown}
            onPress={() => {
              setNewBelow(0);
              scrollToLatest(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={newBelow ? `${newBelow} new messages. Scroll to latest` : 'Scroll to latest'}>
            <Ionicons name="chevron-down" size={22} color={theme.colors.text} />
            {newBelow > 0 && (
              <View style={styles.jumpBadge}>
                <Text style={styles.jumpBadgeText}>{newBelow > 99 ? '99+' : newBelow}</Text>
              </View>
            )}
          </Pressable>
        )}
        <Animated.View style={[styles.composer, composerPadding]}>
          {editing && (
            <View style={styles.replyBar}>
              <Ionicons name="create-outline" size={18} color={theme.colors.tint} />
              <View style={styles.replyBarText}>
                <Text style={styles.replyAuthor} numberOfLines={1}>
                  Edit message
                </Text>
                <Text style={styles.replySnippet} numberOfLines={1}>
                  {describeForQuote(editing, mask)}
                </Text>
              </View>
              <Pressable
                onPress={finishEditing}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Cancel editing">
                <Ionicons name="close" size={20} color={theme.colors.textMuted} />
              </Pressable>
            </View>
          )}
          {replyTo && !editing && (
            <View style={styles.replyBar}>
              <View style={styles.replyBarText}>
                <Text style={styles.replyAuthor} numberOfLines={1}>
                  {replyTo.sender_id === myId ? 'You' : friendName}
                </Text>
                <Text style={styles.replySnippet} numberOfLines={1}>
                  {describeForQuote(replyTo, mask)}
                </Text>
              </View>
              <Pressable
                onPress={() => setReplyToId(null)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Cancel reply">
                <Ionicons name="close" size={20} color={theme.colors.textMuted} />
              </Pressable>
            </View>
          )}
          <View style={styles.composerRow}>
            <View style={styles.pill}>
              <Pressable
                style={styles.pillButton}
                onPress={toggleEmoji}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={isEmojiOpen ? 'Show keyboard' : 'Show emoji'}>
                <MaterialCommunityIcons
                  name={isEmojiOpen ? 'keyboard-outline' : 'emoticon-happy-outline'}
                  size={24}
                  color={theme.colors.textMuted}
                />
              </Pressable>
              <TextInput
                ref={inputRef}
                key={composerKey}
                // Refocus after a send, unless the emoji panel is in use.
                autoFocus={composerKey > 0 && !isEmojiOpen}
                style={styles.input}
                placeholder="Message"
                placeholderTextColor={theme.colors.placeholder}
                selectionColor={theme.colors.tint}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                multiline
                maxLength={4000}
                value={draft}
                onChangeText={(text) => {
                  setDraft(text);
                  selection.current = { start: text.length, end: text.length };
                  if (!editingId) onDraftChange(text);
                }}
                onSelectionChange={(e) => (selection.current = e.nativeEvent.selection)}
                onFocus={() => {
                  setIsAttachOpen(false);
                  setReactingId(null);
                }}
                onBlur={stopTyping}
              />
              {!editing && (
                <Pressable
                  style={[styles.pillButton, !isReady && styles.sendDisabled]}
                  disabled={!isReady}
                  onPress={() => {
                    setReactingId(null);
                    setIsAttachOpen((open) => !open);
                  }}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel="Attach">
                  <MaterialCommunityIcons name="paperclip" size={23} color={theme.colors.textMuted} />
                </Pressable>
              )}
              {!draft && !editing && (
                <Pressable
                  style={[styles.pillButton, !isReady && styles.sendDisabled]}
                  disabled={!isReady}
                  onPress={() => pick('camera')}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel="Take photo">
                  <MaterialCommunityIcons name="camera-outline" size={24} color={theme.colors.textMuted} />
                </Pressable>
              )}
            </View>
            <Pressable
              style={[styles.send, (!draft.trim() || !isReady || isSavingEdit) && styles.sendDisabled]}
              disabled={!draft.trim() || !isReady || isSavingEdit}
              onPress={submit}
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Save edit' : 'Send'}>
              {editing ? (
                <Ionicons name="checkmark" size={24} color={theme.colors.onAccent} />
              ) : (
                <Ionicons name="send" size={20} color={theme.colors.onAccent} style={styles.sendIcon} />
              )}
            </Pressable>
          </View>
        </Animated.View>
      </View>

      {isEmojiOpen && (
        <Animated.View style={[styles.emojiSlot, emojiSlide]}>
          <EmojiPanel height={emojiHeight} bottomInset={insets.bottom} onEmoji={insertEmoji} />
        </Animated.View>
      )}

      {reactionPickerId && (
        <>
          <Pressable
            style={styles.pickerBackdrop}
            onPress={() => setReactionPickerId(null)}
            accessibilityRole="button"
            accessibilityLabel="Close reactions"
          />
          <View style={styles.emojiSlot}>
            <EmojiPanel
              height={REACTION_PANEL_HEIGHT}
              bottomInset={insets.bottom}
              onEmoji={(emoji) => {
                const message = byId.get(reactionPickerId);
                setReactionPickerId(null);
                if (message) reactTo(message, emoji);
              }}
            />
          </View>
        </>
      )}

      {pickedImage && (
        <PhotoComposer image={pickedImage} onCancel={() => setPickedImage(null)} onSend={sendPickedImage} />
      )}
      {viewing && <ImageViewer message={viewing} sharedKey={sharedKey} onClose={closeViewer} />}
      {isBurnSheetOpen && settings && (
        <BurnSettingsSheet
          settings={settings}
          onChange={(seconds, mode) => setTimer(seconds, mode).catch((e: Error) => showError("Couldn't change timer", e))}
          onErase={() => eraseForEveryone().catch((e: Error) => showError("Couldn't erase chat", e))}
          onClose={() => setIsBurnSheetOpen(false)}
        />
      )}
    </Animated.View>
  );
}

const createStyles = ({ colors, chat }: AppTheme) => {
  const shadow = chatShadow(chat);
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.chatBackground },
    headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    timerButton: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8 },
    timerLabel: { color: '#ff7a1a', fontSize: 13, fontWeight: '700' },
    headerCode: { color: colors.text, fontSize: 17, fontWeight: '600' },
    headerTyping: { color: colors.tint, fontSize: 12, fontStyle: 'italic' },
    // Dims the chat behind the reaction emoji panel; tapping it closes the panel.
    pickerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.25)' },
    // A plain line, or a small yellow chip like WhatsApp's encryption notice.
    noticeRow: chat ? { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 5 } : {},
    notice: chat
      ? {
          color: chat.systemChip.text,
          fontSize: 12.5,
          textAlign: 'center',
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 7.5,
          overflow: 'hidden',
          backgroundColor: chat.systemChip.background,
          ...shadow,
        }
      : { color: colors.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 6 },
    error: { color: colors.danger },
    // Rows pad themselves, so a selected row's tint reaches both edges.
    list: { paddingVertical: 8 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { color: colors.textMuted },
    dismissLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    headerActions: { flexDirection: 'row', alignItems: 'center' },
    loadingOlder: { marginVertical: 12 },
    dayRow: { alignItems: 'center', marginVertical: 10 },
    dayLabel: chat
      ? {
          color: chat.dayChip.text,
          fontSize: 12.5,
          fontWeight: '500',
          paddingHorizontal: 12,
          paddingVertical: 5,
          borderRadius: 7.5,
          overflow: 'hidden',
          backgroundColor: chat.dayChip.background,
          ...shadow,
        }
      : {
          color: colors.textMuted,
          fontSize: 12,
          fontWeight: '600',
          paddingHorizontal: 12,
          paddingVertical: 4,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: colors.surface,
        },
    jumpDown: {
      position: 'absolute',
      right: 14,
      bottom: '100%',
      marginBottom: 44,
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    jumpBadge: {
      position: 'absolute',
      top: -6,
      right: -4,
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 5,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    jumpBadgeText: { color: colors.onAccent, fontSize: 11, fontWeight: '700' },
    headerAction: { paddingHorizontal: 10, paddingVertical: 4 },
    // WhatsApp's composer floats over the wallpaper; others sit on a bar.
    composer: chat?.floatingComposer
      ? { gap: 6, paddingHorizontal: 6, paddingTop: 2 }
      : {
          gap: 6,
          paddingHorizontal: 8,
          paddingTop: 8,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          backgroundColor: colors.composer,
        },
    composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    // The message being replied to, above the field.
    replyBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 12,
      borderLeftWidth: 4,
      borderLeftColor: chat?.quoteMine ?? colors.tint,
      backgroundColor: colors.input,
      ...shadow,
    },
    replyBarText: { flex: 1 },
    replyAuthor: { color: chat?.quoteMine ?? colors.tint, fontSize: 13, fontWeight: '700' },
    replySnippet: { color: colors.textMuted, fontSize: 14 },
    // WhatsApp-style rounded field holding the emoji, attach and camera buttons.
    pill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      minHeight: 46,
      borderRadius: 23,
      paddingHorizontal: 4,
      backgroundColor: colors.input,
      ...(chat?.floatingComposer ? shadow : { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }),
    },
    pillButton: { width: 38, height: 46, alignItems: 'center', justifyContent: 'center' },
    input: {
      flex: 1,
      maxHeight: 120,
      paddingHorizontal: 4,
      paddingTop: 12,
      paddingBottom: 12,
      fontSize: 16,
      color: colors.text,
    },
    send: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      ...shadow,
    },
    // The paper plane's visual centre sits left of its box.
    sendIcon: { marginLeft: 3 },
    sendDisabled: { opacity: 0.4 },
    // In the screen's bottom padding, which is the emoji panel's height while it is open.
    emojiSlot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  });
};

// Shared empty list, so rows without reactions keep a stable prop.
const NO_REACTIONS: readonly ReactionChip[] = [];
const REACTION_PANEL_HEIGHT = 320;

type Row =
  | { type: 'day'; key: string; label: string }
  // First in a run of messages from the same person on the same day.
  | { type: 'message'; key: string; message: DisplayMessage; isFirstInGroup: boolean };

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// "Today", "Yesterday", a weekday within the last week, else the date.
function dayLabel(iso: string) {
  const date = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

function withDayHeadings(messages: DisplayMessage[]): Row[] {
  const rows: Row[] = [];
  let lastDay: number | null = null;
  let lastSender: string | null = null;
  for (const message of messages) {
    const day = startOfDay(new Date(message.created_at));
    if (day !== lastDay) {
      rows.push({ type: 'day', key: `day-${day}`, label: dayLabel(message.created_at) });
      lastDay = day;
      lastSender = null;
    }
    rows.push({ type: 'message', key: message.id, message, isFirstInGroup: message.sender_id !== lastSender });
    lastSender = message.sender_id;
  }
  return rows;
}
