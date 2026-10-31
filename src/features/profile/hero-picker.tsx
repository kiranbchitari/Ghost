import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DialogHost } from '@/components/dialog';
import { HeroAvatar } from '@/features/profile/hero-avatar';
import { HEROES, heroFor, type Hero } from '@/features/profile/heroes';
import { PanicButton } from '@/features/security/panic-button';
import { useAppTheme, useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

type Props = {
  ghostCode: string;
  // null = automatic.
  selected: string | null;
  onSelect: (avatar: string | null) => void;
  onClose: () => void;
};

const UNIVERSES: Hero['universe'][] = ['Marvel', 'DC'];

export function HeroPicker({ ghostCode, selected, onSelect, onClose }: Props) {
  const { theme } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  // Native SafeAreaView doesn't measure reliably inside a Modal.
  const insets = useSafeAreaInsets();
  const autoHero = heroFor(null, ghostCode);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* Android has no page sheets: the Modal is full screen and starts under the status bar. */}
      <View
        style={[
          styles.container,
          { paddingTop: Platform.OS === 'android' ? insets.top : 0, paddingBottom: insets.bottom },
        ]}>
        <View style={styles.topBar}>
          <Text style={styles.title}>Choose your hero</Text>
          <Pressable onPress={onClose} accessibilityRole="button">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Pressable
            style={[styles.autoRow, selected === null && styles.autoRowSelected]}
            onPress={() => onSelect(null)}
            accessibilityRole="radio"
            accessibilityState={{ selected: selected === null }}>
            <HeroAvatar hero={autoHero} size={48} selected={selected === null} ringColor={theme.colors.tint} />
            <View style={styles.autoText}>
              <Text style={styles.autoTitle}>Automatic</Text>
              <Text style={styles.autoHint}>Picked from your Ghost code: {autoHero.name}</Text>
            </View>
          </Pressable>

          {UNIVERSES.map((universe) => (
            <View key={universe}>
              <Text style={styles.section}>{universe}</Text>
              <View style={styles.grid}>
                {HEROES.filter((hero) => hero.universe === universe).map((hero) => (
                  <Pressable
                    key={hero.id}
                    style={styles.cell}
                    onPress={() => onSelect(hero.id)}
                    accessibilityRole="radio"
                    accessibilityLabel={hero.name}
                    accessibilityState={{ selected: selected === hero.id }}>
                    <HeroAvatar hero={hero} size={64} selected={selected === hero.id} ringColor={theme.colors.tint} />
                    <Text style={styles.name} numberOfLines={2}>
                      {hero.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}

          <Text style={styles.footnote}>
            Character names belong to Marvel and DC. Badges are original artwork.
          </Text>
        </ScrollView>
      </View>
      <DialogHost />
      <PanicButton />
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
    done: { color: colors.tint, fontSize: 17, fontWeight: '600' },
    content: { padding: 16, gap: 8 },
    autoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    autoRowSelected: { borderColor: colors.tint },
    autoText: { flex: 1 },
    autoTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
    autoHint: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    section: {
      color: colors.textMuted,
      fontSize: 13,
      textTransform: 'uppercase',
      marginTop: 16,
      marginBottom: 8,
      marginLeft: 4,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
    cell: { width: '25%', alignItems: 'center', gap: 6 },
    name: { color: colors.text, fontSize: 12, textAlign: 'center', paddingHorizontal: 2 },
    footnote: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 20 },
  });
