import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { showAlert } from '@/components/dialog';
import { useDisguise } from '@/features/disguise/disguise-provider';
import { DEFAULT_MASTER_KEY, MIN_MASTER_KEY_LENGTH } from '@/services/security/master-key';
import { useAppTheme, useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

// Settings → Game disguise: Ghost always opens as Snake. Here the master key
// is set or changed (warning while it's still the starting key), and Ghost
// can be locked straight away.
export function DisguiseSettings() {
  const { theme } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const { isDefaultKey, changeKey, lock } = useDisguise();
  const [isEditing, setIsEditing] = useState(false);
  const [key, setKey] = useState('');
  const [confirmKey, setConfirmKey] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function startEditing() {
    setKey('');
    setConfirmKey('');
    setProblem(null);
    setIsEditing(true);
  }

  async function save() {
    if (key.length < MIN_MASTER_KEY_LENGTH) {
      setProblem(`Use at least ${MIN_MASTER_KEY_LENGTH} characters.`);
      return;
    }
    if (key !== confirmKey) {
      setProblem("The two keys don't match.");
      return;
    }
    setIsSaving(true);
    try {
      await changeKey(key);
      setIsEditing(false);
      showAlert(
        'Master key saved',
        'From now on only this key opens Ghost: in the Snake game, open Settings and enter it under Redeem code.\n\nIf you forget it, the only way back is to uninstall and reinstall, which erases your chats.',
        undefined,
        { icon: 'key-outline' },
      );
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  const inputProps = {
    style: styles.input,
    placeholderTextColor: theme.colors.placeholder,
    selectionColor: theme.colors.tint,
    keyboardAppearance: theme.isDark ? ('dark' as const) : ('light' as const),
    secureTextEntry: true,
    autoCapitalize: 'none' as const,
    autoCorrect: false,
  };

  return (
    <View style={styles.group}>
      <Text style={styles.description}>
        Ghost always opens as a Snake game. To get back here, open Settings in the game and enter your master key under
        Redeem code.
      </Text>

      {isDefaultKey && !isEditing && (
        <View style={styles.warning}>
          <Ionicons name="warning-outline" size={18} color={theme.colors.danger} />
          <Text style={styles.warningText}>
            You're still using the starting key "{DEFAULT_MASTER_KEY}". Anyone who knows Ghost could open it. Set your
            own key.
          </Text>
        </View>
      )}

      {isEditing ? (
        <View style={styles.form}>
          <TextInput {...inputProps} placeholder="New master key" value={key} onChangeText={setKey} autoFocus />
          <TextInput
            {...inputProps}
            placeholder="Repeat new master key"
            value={confirmKey}
            onChangeText={setConfirmKey}
            onSubmitEditing={save}
          />
          {problem && <Text style={styles.problem}>{problem}</Text>}
          <View style={styles.buttons}>
            <Pressable style={[styles.button, styles.secondary]} onPress={() => setIsEditing(false)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.primary]} onPress={save} disabled={isSaving}>
              <Text style={styles.primaryText}>{isSaving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.buttons}>
          <Pressable style={[styles.button, styles.primary]} onPress={startEditing}>
            <Text style={styles.primaryText}>{isDefaultKey ? 'Set master key' : 'Change key'}</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondary]} onPress={lock}>
            <Text style={styles.secondaryText}>Lock now</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const createStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    group: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 14,
      gap: 12,
    },
    description: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
    warning: {
      flexDirection: 'row',
      gap: 8,
      padding: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.danger,
    },
    warningText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
    form: { gap: 10 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.input,
    },
    problem: { color: colors.danger, fontSize: 13 },
    buttons: { flexDirection: 'row', gap: 8 },
    button: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
    primary: { backgroundColor: colors.accent },
    primaryText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
    secondary: { backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    secondaryText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  });
