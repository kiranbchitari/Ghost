import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { View } from 'react-native';

import { segmentStyle, useLook } from '@/features/disguise/game/look';
import { ITEM_BLINK_STEPS, type GameState, type ItemKind, type Point } from '@/features/disguise/snake-logic';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export const ITEM_ICONS: Record<ItemKind, IconName> = {
  apple: 'food-apple',
  cherry: 'fruit-cherries',
  golden: 'food-apple',
  poison: 'skull',
  speed: 'lightning-bolt',
  shield: 'shield',
  magnet: 'magnet',
  phase: 'blur',
};

export const ITEM_NAMES: Record<ItemKind, string> = {
  apple: 'APPLE',
  cherry: 'CHERRY',
  golden: 'GOLDEN',
  poison: 'POISON',
  speed: 'SPEED',
  shield: 'SHIELD',
  magnet: 'MAGNET',
  phase: 'PHASE',
};

const GOLD = '#c99a06';

const Walls = memo(function Walls({ walls, cell }: { walls: Point[]; cell: number }) {
  const { s } = useLook();
  return (
    <>
      {walls.map((w) => (
        <View key={`${w.x},${w.y}`} style={[s.wall, { left: w.x * cell, top: w.y * cell, width: cell, height: cell }]}>
          <View style={s.wallCore} />
        </View>
      ))}
    </>
  );
});

// Draws a game: walls, food, power-ups and the snakes.
export function Board({ game, cell, skin }: { game: GameState; cell: number; skin?: string }) {
  const { p, s, skin: chosenSkin } = useLook();
  const look = (skin ?? chosenSkin) as typeof chosenSkin;
  return (
    <View
      style={[
        s.board,
        // Dashed walls let the snake through.
        game.config.wrapsWalls && s.boardWrap,
        { width: game.config.cols * cell, height: game.config.rows * cell },
      ]}>
      <Walls walls={game.walls} cell={cell} />
      {game.items.map((item) => {
        // Extras blink just before they vanish.
        if (item.stepsLeft !== null && item.stepsLeft <= ITEM_BLINK_STEPS && item.stepsLeft % 2 === 1) return null;
        const isPower = item.kind === 'speed' || item.kind === 'shield' || item.kind === 'magnet' || item.kind === 'phase';
        const size = isPower ? cell * 0.75 : cell * 0.95;
        return (
          <View
            key={`${item.kind}${item.x},${item.y}`}
            style={[
              s.abs,
              { left: item.x * cell, top: item.y * cell, width: cell, height: cell },
              isPower && { borderWidth: Math.max(1, cell / 10), borderColor: p.ink, borderRadius: cell },
            ]}>
            <MaterialCommunityIcons
              name={ITEM_ICONS[item.kind]}
              size={size}
              color={item.kind === 'golden' ? GOLD : p.ink}
            />
          </View>
        );
      })}
      {game.snakes.map((snake, player) =>
        snake.body.map((part, i) => (
          <View
            key={`${player}-${i}`}
            style={[
              { position: 'absolute', left: part.x * cell, top: part.y * cell, width: cell, height: cell },
              segmentStyle(look, p, i, cell, player === 1),
              // Phasing and shielded snakes show it.
              !!snake.effects.phase && { opacity: 0.55 },
              !!snake.effects.shield && i === 0 && { borderColor: GOLD, borderWidth: Math.max(2, cell / 6) },
              !snake.alive && i === 0 && { transform: [{ rotate: '45deg' }, { scale: 0.85 }] },
            ]}
          />
        )),
      )}
    </View>
  );
}
