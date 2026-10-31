import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { formatBurn } from '@/features/burn-mode/timer';
import { BurnEffect } from '@/features/burn-photo/burn-effect';
import { useDecryptedImage } from '@/features/messaging/attachments';
import { maskText } from '@/features/messaging/mask';
import type { Quote } from '@/features/messaging/reply';
import type { DisplayMessage } from '@/features/messaging/use-messages';
import { useAppTheme, useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

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
};

const IMAGE_WIDTH = 230;
const IMAGE_MAX_HEIGHT = 300;
// How far to swipe right before letting go replies.
const REPLY_DISTANCE = 64;

export function MessageBubble({
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
}: Props) {
  const styles = useThemedStyles(createStyles);

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

  const isLive = !burning && !aboutToBurn && !message.isDeleted;

  return (
    <SwipeToReply enabled={isLive} onReply={() => onReply(message)} styles={styles}>
      <View style={[styles.row, isMine ? styles.rowMine : styles.rowTheirs, isSelected && styles.rowSelected]}>
        {burning ? (
          // The wrapper takes the bubble's max width so the text wraps exactly as
          // it did before burning; the bubble then fills it.
          <BurnEffect onDone={finishBurning} style={styles.burnWrapper}>
            <Bubble message={burning} isMine={isMine} sharedKey={sharedKey} styles={styles} fill />
          </BurnEffect>
        ) : aboutToBurn ? (
          <Bubble message={aboutToBurn} isMine={isMine} sharedKey={sharedKey} styles={styles} />
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
          />
        )}
      </View>
    </SwipeToReply>
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
  fill,
}: BubbleProps) {
  const { theme } = useAppTheme();
  // Stealth: content stays masked until the bubble is pressed and held.
  const [isRevealed, setIsRevealed] = useState(false);
  const isMasked = !!theme.privacy?.maskMessages && !isRevealed;

  const isPhoto = message.kind === 'image' && !message.isDeleted;
  const isViewOnceUnopened = isPhoto && message.view_once && !message.viewed_at;
  const isPlainPhoto = isPhoto && !message.view_once;
  // Senders can't reopen their own view-once photos.
  const canOpen = isPlainPhoto || (isViewOnceUnopened && !isMine);

  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const meta = message.isEncrypted || message.isDeleted ? time : `Unencrypted · ${time}`;
  const metaStyle = isMine ? styles.metaMine : styles.metaTheirs;
  const textStyle = [
    isMine ? styles.textMine : styles.textTheirs,
    isRevealed && theme.privacy && { color: theme.privacy.revealedText },
  ];

  let content;
  if (message.isDeleted) {
    content = (
      <Text style={[styles.placeholder, metaStyle]}>
        🔥 {isMine ? 'You burned this message' : 'This message was burned'}
      </Text>
    );
  } else if (isPhoto && message.view_once) {
    content = (
      <Text style={[styles.placeholder, metaStyle]}>
        {message.viewed_at
          ? '◎ Photo · Opened'
          : isMine
            ? '◎ Photo · View once'
            : '◎ Tap to view photo · View once'}
      </Text>
    );
  } else if (isPhoto) {
    content = (
      <BubblePhoto message={message} sharedKey={sharedKey} isMasked={isMasked} styles={styles} />
    );
  } else if (message.text === null) {
    content = <Text style={[styles.placeholder, metaStyle]}>Couldn't decrypt this message</Text>;
  } else {
    content = <Text style={textStyle}>{isMasked ? maskText(message.text) : message.text}</Text>;
  }

  const canSelect = !message.isDeleted && !!onSelect;
  const onPress = isSelecting
    ? canSelect
      ? () => onSelect(message)
      : undefined
    : canOpen && onOpenImage
      ? () => onOpenImage(message)
      : undefined;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={theme.privacy?.maskMessages ? () => setIsRevealed(true) : undefined}
      onPressOut={theme.privacy?.maskMessages ? () => setIsRevealed(false) : undefined}
      // Like WhatsApp on Android: hold to select, then act from the header.
      onLongPress={canSelect ? () => onSelect(message) : undefined}
      delayLongPress={350}
      style={[
        styles.bubble,
        isMine ? styles.bubbleMine : styles.bubbleTheirs,
        isPlainPhoto && styles.bubblePhoto,
        fill && styles.bubbleFill,
      ]}>
      {quote && (
        <Pressable
          onPress={quote.targetId && onQuotePress ? () => onQuotePress(quote.targetId!) : undefined}
          disabled={isSelecting}
          style={[styles.quote, { borderLeftColor: isMine ? styles.textMine.color : styles.textTheirs.color }]}
          accessibilityRole="button"
          accessibilityLabel={`Reply to ${quote.author || 'a message'}: ${quote.text}`}>
          {quote.author ? (
            <Text style={[styles.quoteAuthor, isMine ? styles.textMine : styles.textTheirs]} numberOfLines={1}>
              {quote.author}
            </Text>
          ) : null}
          <Text style={[styles.quoteText, metaStyle]} numberOfLines={2}>
            {quote.text}
          </Text>
        </Pressable>
      )}
      {content}
      <View style={styles.metaRow}>
        <Text style={[styles.meta, metaStyle]}>{meta}</Text>
        {!message.isDeleted && <BurnCountdown message={message} styles={styles} isMine={isMine} />}
        {isMine && message.isEncrypted && !message.isDeleted && <Ticks message={message} styles={styles} />}
      </View>
    </Pressable>
  );
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

// 🔥 4s while counting down; the timer length (dimmed) while waiting to be read.
function BurnCountdown({ message, styles, isMine }: { message: DisplayMessage; styles: Styles; isMine: boolean }) {
  if (message.burn_seconds === null) return null;
  const metaStyle = isMine ? styles.metaMine : styles.metaTheirs;
  if (message.burnIn === null) {
    return <Text style={[styles.meta, metaStyle]}>🔥 {formatBurn(message.burn_seconds)}</Text>;
  }
  return <Text style={[styles.meta, styles.burnLive]}>🔥 {formatBurn(message.burnIn)}</Text>;
}

// ✓ sent · ✓✓ delivered · coloured ✓✓ read
function Ticks({ message, styles }: { message: DisplayMessage; styles: Styles }) {
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

const createStyles = ({ colors, glow }: AppTheme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 12 },
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
      borderRadius: 8,
      borderLeftWidth: 3,
      backgroundColor: 'rgba(127,127,127,0.18)',
    },
    quoteAuthor: { fontSize: 13, fontWeight: '700' },
    quoteText: { fontSize: 13 },
    rowMine: { justifyContent: 'flex-end' },
    rowTheirs: { justifyContent: 'flex-start' },
    bubble: {
      maxWidth: '78%',
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: StyleSheet.hairlineWidth,
    },
    bubbleMine: {
      backgroundColor: colors.bubbleMine,
      borderColor: colors.bubbleMineBorder,
      borderBottomRightRadius: 4,
      ...(glow && { shadowColor: glow, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } }),
    },
    bubbleTheirs: {
      backgroundColor: colors.bubbleTheirs,
      borderColor: colors.bubbleTheirsBorder,
      borderBottomLeftRadius: 4,
    },
    bubblePhoto: { padding: 4, paddingBottom: 6 },
    burnWrapper: { maxWidth: '78%' },
    bubbleFill: { maxWidth: '100%' },
    photoFrame: {
      borderRadius: 12,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.avatar,
    },
    textMine: { color: colors.bubbleMineText, fontSize: 16 },
    textTheirs: { color: colors.bubbleTheirsText, fontSize: 16 },
    placeholder: { fontSize: 15, fontStyle: 'italic' },
    burnLive: { color: '#ff7a1a', fontWeight: '700' },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-end',
      gap: 4,
      marginTop: 2,
      paddingHorizontal: 4,
    },
    meta: { fontSize: 11 },
    metaMine: { color: colors.metaMine },
    metaTheirs: { color: colors.metaTheirs },
    // Negative spacing overlaps the two checks like WhatsApp's double tick.
    ticks: { fontSize: 12, fontWeight: '700', letterSpacing: -4, color: colors.tick, paddingRight: 4 },
    ticksRead: { color: colors.tickRead },
  });
