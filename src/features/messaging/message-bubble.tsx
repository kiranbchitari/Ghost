import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, interpolate, useAnimatedStyle, useSharedValue, withTiming, ZoomIn } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { formatBurn } from '@/features/burn-mode/timer';
import { BurnEffect } from '@/features/burn-photo/burn-effect';
import { useDecryptedImage } from '@/features/messaging/attachments';
import { maskText } from '@/features/messaging/mask';
import type { Quote } from '@/features/messaging/reply';
import { QUICK_REACTIONS, type ReactionChip } from '@/features/messaging/use-reactions';
import type { DisplayMessage } from '@/features/messaging/use-messages';
import { useAppTheme, useThemedStyles } from '@/theme/theme-provider';
import { bubbleTail, chatShadow, type AppTheme } from '@/theme/themes';

type Props = {
  message: DisplayMessage;
  isMine: boolean;
  sharedKey: Uint8Array | null;
  quote: Quote | null;
  // Selected for the header's actions (or briefly highlighted after jumping to it).
  isSelected: boolean;
  // While a message is selected, a tap selects instead of opening.
  isSelecting: boolean;
  onOpenImage: (message: DisplayMessage) => void;
  onSelect: (message: DisplayMessage) => void;
  onReply: (message: DisplayMessage) => void;
  onQuotePress: (messageId: string) => void;
  // A message of yours that failed to send was tapped.
  onFailedPress: (message: DisplayMessage) => void;
  // Everyone's reactions to this message (undefined or empty for none).
  reactions?: readonly ReactionChip[];
  // The reaction tray is open above this message.
  isReacting?: boolean;
  // Double tap: open the reaction tray.
  onOpenReactions?: (message: DisplayMessage) => void;
  // An emoji was picked in the tray; null takes your reaction back.
  onReact?: (message: DisplayMessage, emoji: string | null) => void;
  // The tray's + button: pick any emoji.
  onMoreReactions?: (message: DisplayMessage) => void;
  // The reactions under the bubble were tapped.
  onReactionsPress?: (message: DisplayMessage) => void;
  // Any single tap on the bubble (closes an open tray).
  onTap?: () => void;
  // First of a run of messages from the same person (themes with bubble
  // tails show the tail here and pack the rest of the run closely).
  isFirstInGroup?: boolean;
};

const IMAGE_WIDTH = 230;
const IMAGE_MAX_HEIGHT = 300;
// How far to swipe right before letting go replies.
const REPLY_DISTANCE = 64;
// Two taps closer together than this are a double tap (react).
const DOUBLE_TAP_MS = 280;

// Memoised: in a long chat only rows whose props change re-render, so pass
// stable callbacks.
export const MessageBubble = memo(function MessageBubble({
  message,
  isMine,
  sharedKey,
  quote,
  isSelected,
  isSelecting,
  onOpenImage,
  onSelect,
  onReply,
  onQuotePress,
  onFailedPress,
  reactions,
  isReacting = false,
  onOpenReactions,
  onReact,
  onMoreReactions,
  onReactionsPress,
  onTap,
  isFirstInGroup = true,
}: Props) {
  const styles = useThemedStyles(createStyles);
  const { theme } = useAppTheme();
  const hasTails = !!theme.chat?.tails;
  const tail = hasTails && isFirstInGroup;

  // When a message is deleted, or a view-once photo is opened, keep showing
  // its previous state long enough to burn it away.
  const previous = useRef(message);
  const [burning, setBurning] = useState<DisplayMessage | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = message;
    if (startsBurning(before, message)) setBurning(before);
  }, [message]);
  const finishBurning = useCallback(() => setBurning(null), []);

  // On the render where the change arrives, the effect above hasn't run yet:
  // keep showing the old bubble so nothing flickers before the burn starts.
  const aboutToBurn = !burning && startsBurning(previous.current, message) ? previous.current : null;

  // Expired by a timer or an erase: after burning, nothing is left behind.
  if (!burning && !aboutToBurn && message.isExpired) return null;

  // Unsent messages have nothing on the server yet to reply to (or react to).
  const isLive = !burning && !aboutToBurn && !message.isDeleted && !message.sendState;
  const canReact = isLive && !message.isExpired && !!onReact;
  const myReaction = reactions?.find((r) => r.isMine)?.emoji ?? null;

  return (
    <SwipeToReply enabled={isLive} onReply={() => onReply(message)} styles={styles}>
      {isReacting && canReact && (
        <View style={[styles.trayRow, isMine ? styles.rowMine : styles.rowTheirs]}>
          <ReactionTray
            mine={myReaction}
            onPick={(emoji) => onReact(message, emoji === myReaction ? null : emoji)}
            onMore={onMoreReactions ? () => onMoreReactions(message) : undefined}
            styles={styles}
          />
        </View>
      )}
      <View
        style={[
          styles.row,
          isMine ? styles.rowMine : styles.rowTheirs,
          tail && styles.rowGroupStart,
          isSelected && styles.rowSelected,
        ]}>
        {burning ? (
          // The wrapper takes the bubble's max width so the text wraps exactly as
          // it did before burning; the bubble then fills it.
          <BurnEffect onDone={finishBurning} style={styles.burnWrapper}>
            <Bubble message={burning} isMine={isMine} sharedKey={sharedKey} styles={styles} tail={tail} fill />
          </BurnEffect>
        ) : aboutToBurn ? (
          <Bubble message={aboutToBurn} isMine={isMine} sharedKey={sharedKey} styles={styles} tail={tail} />
        ) : (
          <Bubble
            message={message}
            isMine={isMine}
            sharedKey={sharedKey}
            styles={styles}
            quote={quote}
            isSelecting={isSelecting}
            onOpenImage={onOpenImage}
            onSelect={onSelect}
            onQuotePress={onQuotePress}
            onFailedPress={onFailedPress}
            onDoubleTap={canReact && onOpenReactions ? () => onOpenReactions(message) : undefined}
            onTap={onTap}
            tail={tail}
          />
        )}
      </View>
      {canReact && reactions && reactions.length > 0 && (
        <ReactionChips
          reactions={reactions}
          isMine={isMine}
          isMasked={!!theme.privacy?.maskMessages}
          onPress={onReactionsPress ? () => onReactionsPress(message) : undefined}
          styles={styles}
        />
      )}
    </SwipeToReply>
  );
});

// WhatsApp's reaction tray: the quick emoji, plus + for any other. Your
// current reaction is highlighted; picking it again takes it back.
function ReactionTray({
  mine,
  onPick,
  onMore,
  styles,
}: {
  mine: string | null;
  onPick: (emoji: string) => void;
  onMore?: () => void;
  styles: Styles;
}) {
  const { theme } = useAppTheme();
  return (
    <Animated.View entering={ZoomIn.duration(160)} style={styles.tray}>
      {QUICK_REACTIONS.map((emoji) => (
        <Pressable
          key={emoji}
          onPress={() => onPick(emoji)}
          style={({ pressed }) => [styles.trayItem, (emoji === mine || pressed) && styles.trayItemActive]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={emoji === mine ? `Remove reaction ${emoji}` : `React with ${emoji}`}
          accessibilityState={{ selected: emoji === mine }}>
          <Text style={styles.trayEmoji}>{emoji}</Text>
        </Pressable>
      ))}
      {/* A reaction picked from the full panel shows here too, highlighted. */}
      {mine && !QUICK_REACTIONS.includes(mine) && (
        <Pressable
          onPress={() => onPick(mine)}
          style={[styles.trayItem, styles.trayItemActive]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Remove reaction ${mine}`}
          accessibilityState={{ selected: true }}>
          <Text style={styles.trayEmoji}>{mine}</Text>
        </Pressable>
      )}
      {onMore && (
        <Pressable
          onPress={onMore}
          style={styles.trayMore}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="More reactions">
          <Ionicons name="add" size={22} color={theme.colors.textMuted} />
        </Pressable>
      )}
    </Animated.View>
  );
}

// The reactions pill under a bubble: each distinct emoji, and how many when
// there's more than one. Stealth masks the emoji like it masks text.
function ReactionChips({
  reactions,
  isMine,
  isMasked,
  onPress,
  styles,
}: {
  reactions: readonly ReactionChip[];
  isMine: boolean;
  isMasked: boolean;
  onPress?: () => void;
  styles: Styles;
}) {
  // Stealth: masked until pressed and held, like message text.
  const [isRevealed, setIsRevealed] = useState(false);
  const hide = isMasked && !isRevealed;
  const emojis = [...new Set(reactions.map((r) => r.emoji))];
  const label = hide
    ? `${reactions.length} reactions`
    : reactions.map((r) => `${r.isMine ? 'You' : 'They'} reacted ${r.emoji}`).join(', ');
  return (
    <View style={[styles.chipsRow, isMine ? styles.rowMine : styles.rowTheirs]}>
      <Animated.View entering={FadeIn.duration(150)}>
        <Pressable
          onPress={onPress}
          onPressIn={isMasked ? () => setIsRevealed(true) : undefined}
          onPressOut={isMasked ? () => setIsRevealed(false) : undefined}
          style={styles.chips}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={label}>
          <Text style={styles.chipEmoji}>{hide ? emojis.map(() => '•').join(' ') : emojis.join('')}</Text>
          {reactions.length > 1 && <Text style={styles.chipCount}>{reactions.length}</Text>}
        </Pressable>
      </Animated.View>
    </View>
  );
}

// WhatsApp's swipe to reply: drag a message right until the reply arrow fills
// in (with a tick of haptics), then let go. Vertical drags still scroll.
function SwipeToReply({
  enabled,
  onReply,
  styles,
  children,
}: {
  enabled: boolean;
  onReply: () => void;
  styles: Styles;
  children: ReactNode;
}) {
  const { theme } = useAppTheme();
  const offset = useSharedValue(0);
  const armed = useSharedValue(false);
  const tick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

  const pan = usePanGesture({
    enabled,
    // Only a rightward drag starts it; a vertical one leaves it to the list.
    activeOffsetX: [-10000, 12],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      'worklet';
      const x = Math.max(0, event.translationX);
      // Follows the finger, then resists past the reply point.
      offset.value = x < REPLY_DISTANCE ? x : REPLY_DISTANCE + (x - REPLY_DISTANCE) * 0.25;
      const reached = x >= REPLY_DISTANCE;
      if (reached !== armed.value) {
        armed.value = reached;
        if (reached) scheduleOnRN(tick);
      }
    },
    onDeactivate: (event) => {
      'worklet';
      if (armed.value && !event.canceled) scheduleOnRN(onReply);
    },
    onFinalize: () => {
      'worklet';
      armed.value = false;
      offset.value = withTiming(0, { duration: 180 });
    },
  });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const icon = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [16, REPLY_DISTANCE], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(offset.value, [16, REPLY_DISTANCE], [0.5, 1], 'clamp') }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View>
        <Animated.View style={[styles.replyIcon, icon]}>
          <Ionicons name="arrow-undo" size={18} color={theme.colors.text} />
        </Animated.View>
        <Animated.View style={slide}>{children}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

// Deleted (for everyone, by a timer or an erase), or a view-once photo opened.
function startsBurning(before: DisplayMessage, after: DisplayMessage) {
  const wasDeleted = !before.isDeleted && after.isDeleted;
  const wasOpened = before.view_once && !before.viewed_at && !!after.viewed_at;
  return wasDeleted || wasOpened;
}

type BubbleProps = {
  message: DisplayMessage;
  isMine: boolean;
  sharedKey: Uint8Array | null;
  styles: Styles;
  quote?: Quote | null;
  isSelecting?: boolean;
  onOpenImage?: (message: DisplayMessage) => void;
  onSelect?: (message: DisplayMessage) => void;
  onQuotePress?: (messageId: string) => void;
  onFailedPress?: (message: DisplayMessage) => void;
  // Set when the message can be reacted to.
  onDoubleTap?: () => void;
  onTap?: () => void;
  // Draw a tail at the top corner (themes with tails, first of a run).
  tail?: boolean;
  fill?: boolean;
};

function Bubble({
  message,
  isMine,
  sharedKey,
  styles,
  quote,
  isSelecting,
  onOpenImage,
  onSelect,
  onQuotePress,
  onFailedPress,
  onDoubleTap,
  onTap,
  tail = false,
  fill,
}: BubbleProps) {
  const { theme } = useAppTheme();
  const chat = theme.chat;
  const lastTapAt = useRef(0);
  const pendingTap = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pendingTap.current), []);
  // Stealth: content stays masked until the bubble is pressed and held.
  const [isRevealed, setIsRevealed] = useState(false);
  const isMasked = !!theme.privacy?.maskMessages && !isRevealed;

  const isPhoto = message.kind === 'image' && !message.isDeleted;
  const isViewOnceUnopened = isPhoto && message.view_once && !message.viewed_at;
  const isPlainPhoto = isPhoto && !message.view_once;
  // Senders can't reopen their own view-once photos.
  const canOpen = isPlainPhoto || (isViewOnceUnopened && !isMine);

  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const stamp = message.edited_at && !message.isDeleted ? `Edited ${time}` : time;
  const meta = message.isEncrypted || message.isDeleted ? stamp : `Unencrypted · ${stamp}`;
  const metaStyle = isMine ? styles.metaMine : styles.metaTheirs;
  const textStyle = [
    isMine ? styles.textMine : styles.textTheirs,
    isRevealed && theme.privacy && { color: theme.privacy.revealedText },
  ];

  // Text, a placeholder, or (plain photos) the picture.
  let body: { style: StyleProp<TextStyle>; text: string } | null = null;
  if (message.isDeleted) {
    body = {
      style: [styles.placeholder, metaStyle],
      text: `🔥 ${isMine ? 'You burned this message' : 'This message was burned'}`,
    };
  } else if (isPhoto && message.view_once) {
    body = {
      style: [styles.placeholder, metaStyle],
      text: message.viewed_at
        ? '◎ Photo · Opened'
        : isMine
          ? '◎ Photo · View once'
          : '◎ Tap to view photo · View once',
    };
  } else if (!isPhoto && message.text === null) {
    body = { style: [styles.placeholder, metaStyle], text: "Couldn't decrypt this message" };
  } else if (!isPhoto) {
    body = { style: textStyle, text: isMasked ? maskText(message.text ?? '') : (message.text ?? '') };
  }

  const showTicks = isMine && message.isEncrypted && !message.isDeleted && !message.sendState;
  const burn = message.isDeleted ? null : burnLabel(message);
  // WhatsApp's trick: the time and ticks sit at the bottom right, and an
  // invisible copy of them ends the text, so the last line leaves room for
  // them when it can and wraps below when it can't. Not for "Not sent".
  const inlineMeta = !!chat?.inlineMeta && message.sendState !== 'failed';
  const photoOverlay = inlineMeta && isPlainPhoto;

  let content;
  if (body) {
    content = (
      <Text style={body.style}>
        {body.text}
        {inlineMeta && (
          <Text style={styles.metaSpacer} accessible={false}>
            {metaSpacer(meta, burn, showTicks || message.sendState === 'sending')}
          </Text>
        )}
      </Text>
    );
  } else {
    content = <BubblePhoto message={message} sharedKey={sharedKey} isMasked={isMasked} styles={styles} />;
  }

  const canSelect = !message.isDeleted && !message.sendState && !!onSelect;
  const action =
    message.sendState === 'failed' && onFailedPress
      ? () => onFailedPress(message)
      : isSelecting
        ? canSelect
          ? () => onSelect(message)
          : undefined
        : canOpen && onOpenImage
          ? () => onOpenImage(message)
          : undefined;

  // Double tap reacts, like WhatsApp. A single tap's own action (opening a
  // photo) waits a moment, in case a second tap follows.
  const canDoubleTap = !!onDoubleTap && !isSelecting;
  const onPress = canDoubleTap
    ? () => {
        const now = Date.now();
        if (now - lastTapAt.current < DOUBLE_TAP_MS) {
          lastTapAt.current = 0;
          clearTimeout(pendingTap.current);
          Haptics.selectionAsync().catch(() => {});
          onDoubleTap();
          return;
        }
        lastTapAt.current = now;
        onTap?.();
        if (action) {
          clearTimeout(pendingTap.current);
          pendingTap.current = setTimeout(action, DOUBLE_TAP_MS);
        }
      }
    : action;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={theme.privacy?.maskMessages ? () => setIsRevealed(true) : undefined}
      onPressOut={theme.privacy?.maskMessages ? () => setIsRevealed(false) : undefined}
      // Like WhatsApp on Android: hold to select, then act from the header.
      onLongPress={canSelect ? () => onSelect(message) : undefined}
      delayLongPress={350}
      accessibilityActions={canDoubleTap ? [{ name: 'react', label: 'React' }] : undefined}
      onAccessibilityAction={
        canDoubleTap ? (e) => e.nativeEvent.actionName === 'react' && onDoubleTap() : undefined
      }
      style={[
        styles.bubble,
        isMine ? styles.bubbleMine : styles.bubbleTheirs,
        tail && (isMine ? styles.bubbleTailMine : styles.bubbleTailTheirs),
        isPlainPhoto && styles.bubblePhoto,
        fill && styles.bubbleFill,
      ]}>
      {tail && <View style={isMine ? styles.tailMine : styles.tailTheirs} />}
      {quote && (
        <Pressable
          onPress={quote.targetId && onQuotePress ? () => onQuotePress(quote.targetId!) : undefined}
          disabled={isSelecting}
          style={[
            styles.quote,
            {
              borderLeftColor: chat
                ? quote.byMe
                  ? chat.quoteMine
                  : chat.quoteTheirs
                : isMine
                  ? styles.textMine.color
                  : styles.textTheirs.color,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Reply to ${quote.author || 'a message'}: ${quote.text}`}>
          {quote.author ? (
            <Text
              style={[
                styles.quoteAuthor,
                isMine ? styles.textMine : styles.textTheirs,
                chat && { color: quote.byMe ? chat.quoteMine : chat.quoteTheirs },
              ]}
              numberOfLines={1}>
              {quote.author}
            </Text>
          ) : null}
          <Text style={[styles.quoteText, metaStyle]} numberOfLines={2}>
            {quote.text}
          </Text>
        </Pressable>
      )}
      {content}
      <View style={inlineMeta ? (photoOverlay ? styles.metaOverlay : styles.metaFloat) : styles.metaRow}>
        <Text style={[styles.meta, photoOverlay ? styles.metaOnPhoto : metaStyle]}>{meta}</Text>
        {burn && (
          <Text style={[styles.meta, message.burnIn === null ? (photoOverlay ? styles.metaOnPhoto : metaStyle) : styles.burnLive]}>
            {burn}
          </Text>
        )}
        {message.sendState === 'sending' && (
          <Ionicons
            name="time-outline"
            size={12}
            style={[styles.meta, photoOverlay ? styles.metaOnPhoto : metaStyle]}
            accessibilityLabel="Sending"
          />
        )}
        {message.sendState === 'failed' && (
          <Text style={[styles.meta, styles.failed]} accessibilityLabel="Not sent. Tap to retry.">
            ⚠ Not sent · Tap to retry
          </Text>
        )}
        {showTicks && <Ticks message={message} styles={styles} onPhoto={photoOverlay} />}
      </View>
    </Pressable>
  );
}

// 🔥 4s while counting down; the timer length (dimmed) while waiting to be read.
function burnLabel(message: DisplayMessage) {
  if (message.burn_seconds === null) return null;
  return `🔥 ${formatBurn(message.burnIn ?? message.burn_seconds)}`;
}

// Invisible stand-in for the time, burn timer and ticks at the end of the
// text. Non-breaking spaces keep it in one piece; the leading space lets it
// wrap to its own line as a whole.
function metaSpacer(meta: string, burn: string | null, hasIcon: boolean) {
  const label = [meta, burn].filter(Boolean).join(' ');
  return ` \u00a0\u00a0${label.replace(/ /g, '\u00a0')}${hasIcon ? '\u00a0\u2003\u2002' : ''}`;
}

function BubblePhoto({
  message,
  sharedKey,
  isMasked,
  styles,
}: {
  message: DisplayMessage;
  sharedKey: Uint8Array | null;
  isMasked: boolean;
  styles: Styles;
}) {
  const { uri, error } = useDecryptedImage(message.id, message.attachment_path, message.image, sharedKey);
  const ratio = message.image ? message.image.height / message.image.width : 1;
  const size = { width: IMAGE_WIDTH, height: Math.min(IMAGE_MAX_HEIGHT, IMAGE_WIDTH * ratio) };

  if (error || !message.image) {
    return <Text style={[styles.placeholder, styles.metaTheirs]}>{error ?? "Couldn't decrypt this photo"}</Text>;
  }
  return (
    <View style={[styles.photoFrame, size]}>
      {uri ? (
        // Stealth blurs photos until the bubble is held, like masked text.
        <Image source={{ uri }} style={size} blurRadius={isMasked ? 40 : 0} />
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}

// ✓ sent · ✓✓ delivered · coloured ✓✓ read
function Ticks({ message, styles, onPhoto = false }: { message: DisplayMessage; styles: Styles; onPhoto?: boolean }) {
  const { theme } = useAppTheme();
  if (theme.chat?.tickIcons) {
    const state = message.read_at ? 'Read' : message.delivered_at ? 'Delivered' : 'Sent';
    const color =
      state === 'Read' ? theme.colors.tickRead : onPhoto ? '#ffffff' : theme.colors.tick;
    return (
      <MaterialCommunityIcons
        name={state === 'Sent' ? 'check' : 'check-all'}
        size={16}
        color={color}
        accessibilityLabel={state}
      />
    );
  }
  if (message.read_at) {
    return (
      <Text style={[styles.ticks, styles.ticksRead]} accessibilityLabel="Read">
        ✓✓
      </Text>
    );
  }
  if (message.delivered_at) {
    return (
      <Text style={styles.ticks} accessibilityLabel="Delivered">
        ✓✓
      </Text>
    );
  }
  return (
    <Text style={styles.ticks} accessibilityLabel="Sent">
      ✓
    </Text>
  );
}

type Styles = ReturnType<typeof createStyles>;

const createStyles = ({ colors, glow, chat }: AppTheme) => {
  const shadow = chatShadow(chat);
  const radius = chat?.bubbleRadius ?? 16;
  return StyleSheet.create({
    // With tails, a run from one person is packed tight and runs are spaced.
    row: { flexDirection: 'row', paddingVertical: chat?.tails ? 1 : 3, paddingHorizontal: chat?.tails ? 16 : 12 },
    rowGroupStart: { marginTop: 6 },
    // A tint across the whole row, like WhatsApp's selection.
    rowSelected: { backgroundColor: `${colors.tint}33` },
    // Revealed behind the message as it is swiped right.
    replyIcon: {
      position: 'absolute',
      left: 14,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
    },
    quote: {
      alignSelf: 'stretch',
      minWidth: 120,
      marginBottom: 4,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: chat ? 6 : 8,
      borderLeftWidth: chat ? 4 : 3,
      backgroundColor: chat?.quoteBackground ?? 'rgba(127,127,127,0.18)',
      overflow: 'hidden',
    },
    quoteAuthor: { fontSize: 13, fontWeight: '700' },
    quoteText: { fontSize: 13 },
    rowMine: { justifyContent: 'flex-end' },
    rowTheirs: { justifyContent: 'flex-start' },
    // Above the bubble, on its side, while picking a reaction.
    trayRow: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 4 },
    tray: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 6,
      paddingVertical: 4,
      borderRadius: 24,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    trayItem: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    trayItemActive: { backgroundColor: `${colors.tint}33` },
    trayEmoji: { fontSize: 24 },
    trayMore: {
      width: 34,
      height: 34,
      borderRadius: 17,
      marginLeft: 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.input,
    },
    // Overlaps the bottom edge of the bubble, like WhatsApp.
    chipsRow: { flexDirection: 'row', paddingHorizontal: 22, marginTop: -8, marginBottom: 3 },
    chips: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 12,
      backgroundColor: colors.surface,
      // WhatsApp rings the pill in the wallpaper colour so it sits on the bubble's edge.
      ...(chat
        ? { borderWidth: 1.5, borderColor: colors.chatBackground, ...shadow }
        : { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }),
    },
    chipEmoji: { fontSize: 14, color: colors.textMuted },
    chipCount: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    bubble: {
      maxWidth: chat ? '80%' : '78%',
      borderRadius: radius,
      ...(chat
        ? { paddingLeft: 9, paddingRight: 8, paddingTop: 6, paddingBottom: 7 }
        : { paddingHorizontal: 12, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth }),
    },
    bubbleMine: {
      backgroundColor: colors.bubbleMine,
      borderColor: colors.bubbleMineBorder,
      ...(chat ? shadow : { borderBottomRightRadius: 4 }),
      ...(glow && { shadowColor: glow, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } }),
    },
    bubbleTheirs: {
      backgroundColor: colors.bubbleTheirs,
      borderColor: colors.bubbleTheirsBorder,
      ...(chat ? shadow : { borderBottomLeftRadius: 4 }),
    },
    // The corner the tail grows from is square.
    bubbleTailMine: { borderTopRightRadius: 0 },
    bubbleTailTheirs: { borderTopLeftRadius: 0 },
    tailMine: bubbleTail('right', colors.bubbleMine),
    tailTheirs: bubbleTail('left', colors.bubbleTheirs),
    bubblePhoto: chat ? { padding: 3, paddingBottom: 3 } : { padding: 4, paddingBottom: 6 },
    burnWrapper: { maxWidth: '78%' },
    bubbleFill: { maxWidth: '100%' },
    photoFrame: {
      borderRadius: chat ? Math.max(radius - 2, 4) : 12,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.avatar,
    },
    textMine: { color: colors.bubbleMineText, fontSize: 16 },
    textTheirs: { color: colors.bubbleTheirsText, fontSize: 16 },
    placeholder: { fontSize: 15, fontStyle: 'italic' },
    burnLive: { color: '#ff7a1a', fontWeight: '700' },
    failed: { color: colors.danger, fontWeight: '700' },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-end',
      gap: 4,
      marginTop: 2,
      paddingHorizontal: 4,
    },
    meta: { fontSize: 11 },
    // Inline meta: pinned to the bottom right, over the room the spacer keeps.
    metaFloat: {
      position: 'absolute',
      right: 8,
      bottom: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    metaSpacer: { fontSize: 11, color: 'transparent' },
    // On a photo: white on a soft dark pill.
    metaOverlay: {
      position: 'absolute',
      right: 8,
      bottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 10,
      backgroundColor: 'rgba(11,20,26,0.35)',
    },
    metaOnPhoto: { color: '#ffffff' },
    metaMine: { color: colors.metaMine },
    metaTheirs: { color: colors.metaTheirs },
    // Negative spacing overlaps the two checks like WhatsApp's double tick.
    ticks: { fontSize: 12, fontWeight: '700', letterSpacing: -4, color: colors.tick, paddingRight: 4 },
    ticksRead: { color: colors.tickRead },
  });
};
