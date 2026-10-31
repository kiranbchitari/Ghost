import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { showAlert, showError } from '@/components/dialog';
import { DisguiseSettings } from '@/features/disguise/disguise-settings';
import { HeroAvatar } from '@/features/profile/hero-avatar';
import { HeroPicker } from '@/features/profile/hero-picker';
import { useMyProfile } from '@/features/profile/use-my-profile';
import { useSession } from '@/hooks/use-session';
import { resetIdentity } from '@/services/security/reset-identity';
import { useAppTheme, useThemedStyles } from '@/theme/theme-provider';
import { themePreferences, themes, type AppTheme, type ThemePreference } from '@/theme/themes';

const SYSTEM_OPTION = { label: 'System', description: 'Light or dark, following your phone.' };

export default function SettingsScreen() {
  const { code, avatar, hero, setAvatar } = useMyProfile();
  const [isPicking, setIsPicking] = useState(false);
  const { session } = useSession();
  const { preference, setPreference } = useAppTheme();
  const styles = useThemedStyles(createStyles);

  async function reset() {
    // Destroys the private key first, then signs out (locally if need be).
    try {
      await resetIdentity(session?.user.id);
    } catch (e) {
      showError("Couldn't reset identity", e);
    }
  }

  function chooseHero(next: string | null) {
    setAvatar(next).catch((e: Error) => showError("Couldn't change hero", e));
  }

  function confirmReset() {
    showAlert(
      'Reset identity?',
      'You will get a new anonymous identity and Ghost code. Your encryption key is destroyed, so your current chats are gone for good.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: reset },
      ],
      { icon: 'refresh' },
    );
  }

  return (
    <KeyboardAwareScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}>
      <View style={styles.identity}>
        <Pressable
          onPress={() => setIsPicking(true)}
          disabled={!hero}
          accessibilityRole="button"
          accessibilityLabel="Change profile hero">
          {hero && <HeroAvatar hero={hero} size={96} />}
          <View style={styles.editBadge}>
            <Text style={styles.editBadgeText}>Edit</Text>
          </View>
        </Pressable>
        {hero && (
          <Text style={styles.heroName}>
            {hero.name}
            {avatar === null ? ' · auto' : ''}
          </Text>
        )}
        <Text style={styles.label}>Your Ghost code</Text>
        <Text style={styles.code} numberOfLines={1} adjustsFontSizeToFit>
          {code ?? '········'}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Theme</Text>
      <View style={styles.group}>
        {themePreferences.map((option, index) => (
          <ThemeRow
            key={option}
            option={option}
            isSelected={option === preference}
            isLast={index === themePreferences.length - 1}
            onPress={() => setPreference(option)}
            styles={styles}
          />
        ))}
      </View>

      <Text style={styles.sectionTitle}>Game disguise</Text>
      <DisguiseSettings />

      <Pressable style={styles.danger} onPress={confirmReset}>
        <Text style={styles.dangerText}>Reset identity</Text>
      </Pressable>

      {isPicking && code && (
        <HeroPicker
          ghostCode={code}
          selected={avatar}
          onSelect={chooseHero}
          onClose={() => setIsPicking(false)}
        />
      )}
    </KeyboardAwareScrollView>
  );
}

type RowProps = {
  option: ThemePreference;
  isSelected: boolean;
  isLast: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
};

function ThemeRow({ option, isSelected, isLast, onPress, styles }: RowProps) {
  const { label, description } = option === 'system' ? SYSTEM_OPTION : themes[option];
  // System previews light and dark side by side.
  const previews = option === 'system' ? [themes.light, themes.dark] : [themes[option]];

  return (
    <Pressable
      style={[styles.row, !isLast && styles.rowDivider]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}>
      <View style={styles.swatches}>
        {previews.map((preview) => (
          <View
            key={preview.name}
            style={[
              styles.swatch,
              { backgroundColor: preview.colors.chatBackground, borderColor: preview.colors.border },
            ]}>
            <View style={[styles.swatchBubble, { backgroundColor: preview.colors.bubbleTheirs }]} />
            <View
              style={[
                styles.swatchBubble,
                styles.swatchBubbleMine,
                { backgroundColor: preview.colors.bubbleMine, borderColor: preview.colors.bubbleMineBorder },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <Text style={styles.check}>{isSelected ? '✓' : ''}</Text>
    </Pressable>
  );
}

const createStyles = ({ colors, glow }: AppTheme) =>
  StyleSheet.create({
    screen: { backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    identity: { alignItems: 'center', paddingVertical: 16, gap: 4 },
    editBadge: {
      position: 'absolute',
      right: -6,
      bottom: -2,
      backgroundColor: colors.tint,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderWidth: 2,
      borderColor: colors.background,
    },
    editBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    heroName: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: 8, marginBottom: 8 },
    label: { color: colors.textMuted },
    code: {
      fontSize: 26,
      fontWeight: '700',
      letterSpacing: 0.5,
      marginTop: 4,
      color: colors.text,
      // Padding gives the glow room: iOS clips text shadows to the Text frame.
      ...(glow && {
        textShadowColor: glow,
        textShadowRadius: 12,
        textShadowOffset: { width: 0, height: 0 },
        padding: 14,
        marginVertical: -10,
      }),
    },
    sectionTitle: { color: colors.textMuted, fontSize: 13, textTransform: 'uppercase', marginLeft: 4 },
    group: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    swatches: { flexDirection: 'row', gap: 4, width: 76, justifyContent: 'center' },
    swatch: {
      width: 36,
      height: 44,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 5,
      gap: 4,
      justifyContent: 'center',
    },
    swatchBubble: { height: 9, width: 18, borderRadius: 4 },
    swatchBubbleMine: { alignSelf: 'flex-end', borderWidth: StyleSheet.hairlineWidth },
    rowText: { flex: 1 },
    rowLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
    rowDescription: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    check: { color: colors.tint, fontSize: 18, fontWeight: '700', width: 20, textAlign: 'center' },
    danger: {
      backgroundColor: colors.danger,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 12,
    },
    dangerText: { color: colors.onDanger, fontWeight: '600', fontSize: 16 },
  });
