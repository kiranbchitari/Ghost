import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BURN_OPTIONS, describeBurn } from '@/features/burn-mode/timer';
import type { BurnMode, ConversationSettings } from '@/features/messaging/api';
import { useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

type Props = {
  settings: ConversationSettings;
  onChange: (seconds: number | null, mode: BurnMode) => void;
  onErase: () => void;
  onClose: () => void;
};

const MODES: { mode: BurnMode; label: string; hint: string }[] = [
  { mode: 'read', label: 'After reading', hint: 'Timer starts when they see it' },
  { mode: 'sent', label: 'After sending', hint: 'Timer starts right away' },
];

export function BurnSettingsSheet({ settings, onChange, onErase, onClose }: Props) {
  const styles = useThemedStyles(createStyles);
  // Native SafeAreaView doesn't measure reliably inside a Modal.
  const insets = useSafeAreaInsets();
  const summary = describeBurn(settings.burn_seconds, settings.burn_mode);

  function confirmErase() {
    Alert.alert(
      'Erase chat for everyone?',
      'Every message and photo in this chat burns on both phones and is deleted from the server. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase',
          style: 'destructive',
          onPress: () => {
            onClose();
            onErase();
          },
        },
      ],
    );
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.topBar}>
          <Text style={styles.title}>Burn settings</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.body}>
          <Text style={styles.section}>Disappearing messages</Text>
          <View style={styles.chips}>
            {BURN_OPTIONS.map((option) => {
              const selected = option.seconds === settings.burn_seconds;
              return (
                <Pressable
                  key={option.label}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => onChange(option.seconds, settings.burn_mode)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {option.seconds === null ? 'Off' : `🔥 ${option.label}`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>Start the timer</Text>
          <View style={styles.modes}>
            {MODES.map(({ mode, label, hint }) => {
              const selected = mode === settings.burn_mode;
              return (
                <Pressable
                  key={mode}
                  style={[styles.mode, selected && styles.chipSelected]}
                  onPress={() => onChange(settings.burn_seconds, mode)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}>
                  <Text style={[styles.modeLabel, selected && styles.chipTextSelected]}>{label}</Text>
                  <Text style={styles.modeHint}>{hint}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.summary}>
            {summary ? `${summary}.` : 'Messages stay until someone deletes them.'} Applies to new messages, for both of you.
          </Text>

          <View style={styles.spacer} />

          <Pressable style={styles.erase} onPress={confirmErase} accessibilityRole="button">
            <Ionicons name="flame" size={18} color="#fff" />
            <Text style={styles.eraseText}>Erase chat for everyone</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: { color: colors.text, fontSize: 17, fontWeight: '600' },
    // Kept clear of the top-right corner, where Expo Go's dev button sits.
    done: { color: colors.tint, fontSize: 17, fontWeight: '600', marginRight: 64 },
    body: { flex: 1, padding: 16 },
    section: {
      color: colors.textMuted,
      fontSize: 13,
      textTransform: 'uppercase',
      marginTop: 12,
      marginBottom: 10,
      marginLeft: 4,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 20,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipSelected: { borderColor: '#ff7a1a', backgroundColor: 'rgba(255,122,26,0.12)' },
    chipText: { color: colors.text, fontSize: 15, fontWeight: '500' },
    chipTextSelected: { color: '#ff7a1a', fontWeight: '700' },
    modes: { flexDirection: 'row', gap: 8 },
    mode: {
      flex: 1,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 2,
    },
    modeLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
    modeHint: { color: colors.textMuted, fontSize: 12 },
    summary: { color: colors.textMuted, fontSize: 13, marginTop: 16, lineHeight: 18 },
    spacer: { flex: 1 },
    erase: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: '#c2410c',
      borderRadius: 12,
      paddingVertical: 14,
    },
    eraseText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
