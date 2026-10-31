import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, View } from 'react-native';

import type { Hero } from '@/features/profile/heroes';

type Props = { hero: Hero; size?: number; selected?: boolean; ringColor?: string };

// Circular badge: two-tone split in the hero's colours with their symbol.
export function HeroAvatar({ hero, size = 44, selected = false, ringColor = '#fff' }: Props) {
  const [top, bottom] = hero.colors;

  return (
    <View
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2 },
        selected && { borderColor: ringColor, borderWidth: Math.max(2, size * 0.06) },
      ]}>
      <View style={[styles.badge, { backgroundColor: top, borderRadius: size / 2 }]}>
        {/* Lower half in the second colour, cut diagonally for a little energy. */}
        <View
          style={[
            styles.diagonal,
            { backgroundColor: bottom, width: size * 2, height: size, top: size * 0.55 },
          ]}
        />
        <MaterialCommunityIcons name={hero.glyph} size={size * 0.56} color={hero.glyphColor} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { overflow: 'hidden', borderColor: 'transparent' },
  badge: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  diagonal: { position: 'absolute', left: '-50%', transform: [{ rotate: '-18deg' }] },
});
