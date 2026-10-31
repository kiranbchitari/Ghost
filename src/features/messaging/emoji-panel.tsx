import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState, type ComponentProps } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { EMOJI_CATEGORIES } from '@/features/messaging/emoji-data';
import { useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

type Glyph = ComponentProps<typeof MaterialCommunityIcons>['name'];

type Props = {
  height: number;
  bottomInset: number;
  onEmoji: (emoji: string) => void;
};

const COLUMNS = 8;
const ROW_HEIGHT = 46;
const MAX_RECENT = 32;

const ICONS: Record<string, Glyph> = {
  recent: 'clock-outline',
  smileys_emotion: 'emoticon-outline',
  people_body: 'account-outline',
  animals_nature: 'paw',
  food_drink: 'food-apple-outline',
  travel_places: 'airplane',
  activities: 'soccer',
  objects: 'lightbulb-outline',
  symbols: 'heart-outline',
  flags: 'flag-outline',
};

// Kept in memory only, never written to disk.
let recent: string[] = [];

// WhatsApp-style emoji panel shown in place of the keyboard, at its height.
export function EmojiPanel({ height, bottomInset, onEmoji }: Props) {
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const categories = recent.length ? [{ id: 'recent', emoji: recent }, ...EMOJI_CATEGORIES] : EMOJI_CATEGORIES;
  const [activeId, setActiveId] = useState(categories[0].id);
  const active = categories.find((c) => c.id === activeId) ?? categories[0];
  const cell = width / COLUMNS;

  function pick(emoji: string) {
    recent = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    onEmoji(emoji);
  }

  return (
    <View style={[styles.panel, { height, paddingBottom: bottomInset }]}>
      <View style={styles.tabs}>
        {categories.map(({ id }) => (
          <Pressable
            key={id}
            style={[styles.tab, id === active.id && styles.tabActive]}
            onPress={() => setActiveId(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: id === active.id }}
            accessibilityLabel={id.replace('_', ' and ')}>
            <MaterialCommunityIcons
              name={ICONS[id]}
              size={20}
              style={id === active.id ? styles.tabIconActive : styles.tabIcon}
            />
          </Pressable>
        ))}
      </View>
      <FlatList
        // A fresh list per category, starting at the top.
        key={active.id}
        data={active.emoji}
        keyExtractor={(emoji) => emoji}
        numColumns={COLUMNS}
        // With columns, FlatList counts (and lays out) rows, not cells.
        initialNumToRender={8}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        keyboardShouldPersistTaps="always"
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.cell, { width: cell }, pressed && styles.cellPressed]}
            onPress={() => pick(item)}
            accessibilityLabel={item}>
            <Text style={styles.emoji}>{item}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const createStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    panel: { backgroundColor: colors.composer },
    tabs: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabActive: { borderBottomColor: colors.tint },
    tabIcon: { color: colors.textMuted },
    tabIconActive: { color: colors.tint },
    cell: { height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    cellPressed: { backgroundColor: colors.surface },
    emoji: { fontSize: 28 },
  });
