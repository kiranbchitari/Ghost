import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme, useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

// Themed replacements for Alert.alert and ActionSheetIOS. Call showAlert /
// showActionSheet from anywhere; a <DialogHost /> draws them. Like the panic
// button, render a host at the root and inside every Modal (Modals draw above
// the root): the most recently mounted host, i.e. the topmost screen, shows them.

export type DialogIcon = ComponentProps<typeof Ionicons>['name'];

export type DialogButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

export type SheetOption = {
  text: string;
  icon?: DialogIcon;
  style?: 'default' | 'destructive';
  onPress: () => void;
};

type Request =
  | { kind: 'alert'; id: number; title: string; message?: string; icon?: DialogIcon; buttons: DialogButton[] }
  | { kind: 'sheet'; id: number; title?: string; options: SheetOption[] };

let queue: Request[] = [];
let hosts: number[] = [];
let nextId = 1;
let snapshot = { request: null as Request | null, host: null as number | null };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { request: queue[0] ?? null, host: hosts.at(-1) ?? null };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Dialogs show one at a time, in order.
function enqueue(request: Request) {
  queue = [...queue, request];
  emit();
}

function dismiss(request: Request, then?: () => void) {
  queue = queue.filter((r) => r !== request);
  emit();
  then?.();
}

export function showAlert(
  title: string,
  message?: string,
  buttons: DialogButton[] = [{ text: 'OK' }],
  options: { icon?: DialogIcon } = {},
) {
  enqueue({ kind: 'alert', id: nextId++, title, message, icon: options.icon, buttons });
}

export function showError(title: string, error: unknown) {
  showAlert(title, (error as Error)?.message ?? String(error), undefined, { icon: 'alert-circle-outline' });
}

export function showActionSheet(options: SheetOption[], title?: string) {
  enqueue({ kind: 'sheet', id: nextId++, title, options });
}

// What tapping outside or pressing Android's back button does: the cancel
// button, or the only button. Null means the dialog needs an explicit choice.
function dismissAction(request: Request): (() => void) | null {
  if (request.kind === 'sheet') return () => dismiss(request);
  const fallback = request.buttons.find((b) => b.style === 'cancel') ?? (request.buttons.length === 1 ? request.buttons[0] : null);
  return fallback ? () => dismiss(request, fallback.onPress) : null;
}

export function DialogHost() {
  const [hostId] = useState(() => nextId++);
  const { request, host } = useSyncExternalStore(subscribe, () => snapshot);
  const shown = host === hostId ? request : null;

  useEffect(() => {
    hosts = [...hosts, hostId];
    emit();
    return () => {
      hosts = hosts.filter((h) => h !== hostId);
      emit();
    };
  }, [hostId]);

  useEffect(() => {
    if (!shown) return;
    const onBack = dismissAction(shown);
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack?.();
      return true;
    });
    return () => subscription.remove();
  }, [shown]);

  if (!shown) return null;
  return shown.kind === 'alert' ? <AlertDialog key={shown.id} request={shown} /> : <ActionSheet key={shown.id} request={shown} />;
}

// Scale up from slightly small with a soft spring, like a native alert.
function popIn() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
    animations: {
      opacity: withTiming(1, { duration: 160 }),
      transform: [{ scale: withSpring(1, { damping: 16, stiffness: 240 }) }],
    },
  };
}

function AlertDialog({ request }: { request: Extract<Request, { kind: 'alert' }> }) {
  const { theme } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const onScrimPress = dismissAction(request);
  const isDanger = request.buttons.some((b) => b.style === 'destructive');
  // Side by side for two buttons with Cancel on the left; stacked with Cancel last otherwise.
  const isRow = request.buttons.length <= 2;
  const cancel = request.buttons.filter((b) => b.style === 'cancel');
  const others = request.buttons.filter((b) => b.style !== 'cancel');
  const ordered = isRow ? [...cancel, ...others] : [...others, ...cancel];

  return (
    <Animated.View style={[styles.layer, styles.center]} entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)}>
      <Pressable style={styles.scrim} onPress={onScrimPress ?? undefined} accessible={false} />
      <Animated.View entering={popIn} style={styles.card} accessibilityRole="alert" accessibilityViewIsModal>
        {request.icon && (
          <View style={[styles.iconWrap, isDanger && styles.iconWrapDanger]}>
            <Ionicons name={request.icon} size={26} color={isDanger ? theme.colors.danger : theme.colors.tint} />
          </View>
        )}
        <Text style={styles.title}>{request.title}</Text>
        {request.message ? <Text style={styles.message}>{request.message}</Text> : null}
        <View style={[styles.buttons, isRow && styles.buttonsRow]}>
          {ordered.map((button) => (
            <Pressable
              key={button.text}
              onPress={() => dismiss(request, button.onPress)}
              style={({ pressed }) => [
                styles.button,
                isRow && styles.buttonInRow,
                button.style === 'cancel' && styles.buttonCancel,
                button.style === 'destructive' && styles.buttonDanger,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button">
              <Text
                style={[
                  styles.buttonText,
                  button.style === 'cancel' && styles.buttonCancelText,
                  button.style === 'destructive' && styles.buttonDangerText,
                ]}>
                {button.text}
              </Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function ActionSheet({ request }: { request: Extract<Request, { kind: 'sheet' }> }) {
  const { theme } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();

  return (
    <Animated.View style={[styles.layer, styles.bottom]} entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)}>
      <Pressable style={styles.scrim} onPress={() => dismiss(request)} accessible={false} />
      <Animated.View
        entering={SlideInDown.springify().damping(20).stiffness(220)}
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}
        accessibilityViewIsModal>
        <View style={styles.sheetGroup}>
          {request.title ? <Text style={styles.sheetTitle}>{request.title}</Text> : null}
          {request.options.map((option, index) => {
            const color = option.style === 'destructive' ? theme.colors.danger : theme.colors.text;
            return (
              <Pressable
                key={option.text}
                onPress={() => dismiss(request, option.onPress)}
                style={({ pressed }) => [
                  styles.sheetRow,
                  (index > 0 || request.title) && styles.sheetRowDivider,
                  pressed && styles.sheetRowPressed,
                ]}
                accessibilityRole="button">
                {option.icon && <Ionicons name={option.icon} size={22} color={color} />}
                <Text style={[styles.sheetRowText, { color }]}>{option.text}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => dismiss(request)}
          style={({ pressed }) => [styles.sheetGroup, styles.sheetCancel, pressed && styles.sheetRowPressed]}
          accessibilityRole="button">
          <Text style={styles.sheetCancelText}>Cancel</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const createStyles = ({ colors, glow, isDark }: AppTheme) =>
  StyleSheet.create({
    // Just under the panic button (999), which must stay reachable.
    layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998, elevation: 998 },
    center: { alignItems: 'center', justifyContent: 'center', padding: 28 },
    bottom: { justifyContent: 'flex-end' },
    scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)' },
    card: {
      width: '100%',
      maxWidth: 340,
      alignItems: 'center',
      paddingHorizontal: 22,
      paddingTop: 24,
      paddingBottom: 18,
      borderRadius: 24,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glow ? colors.codeCardBorder : colors.border,
      shadowColor: glow ?? '#000',
      shadowOpacity: glow ? 0.5 : 0.18,
      shadowRadius: glow ? 24 : 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
    iconWrap: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    iconWrapDanger: { borderColor: colors.danger },
    title: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
    message: { color: colors.textMuted, fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 8 },
    buttons: { alignSelf: 'stretch', gap: 10, marginTop: 22 },
    buttonsRow: { flexDirection: 'row' },
    button: {
      minHeight: 46,
      paddingHorizontal: 14,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    buttonInRow: { flex: 1 },
    buttonCancel: {
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    buttonDanger: { backgroundColor: colors.danger },
    buttonText: { color: colors.onAccent, fontSize: 16, fontWeight: '600' },
    buttonCancelText: { color: colors.text },
    buttonDangerText: { color: colors.onDanger },
    pressed: { opacity: 0.7 },
    sheet: { paddingHorizontal: 10, gap: 8 },
    sheetGroup: {
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glow ? colors.codeCardBorder : colors.border,
    },
    sheetTitle: {
      color: colors.textMuted,
      fontSize: 13,
      textAlign: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, minHeight: 56 },
    sheetRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    sheetRowPressed: { backgroundColor: colors.background },
    sheetRowText: { fontSize: 17 },
    sheetCancel: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
    sheetCancelText: { color: colors.tint, fontSize: 17, fontWeight: '600' },
  });
