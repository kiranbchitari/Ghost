import { useEffect, useRef, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';

import { Board } from '@/features/disguise/game/board';
import { clock, GameButton, Header, pad, Tabs, useLook } from '@/features/disguise/game/look';
import type { Replay } from '@/features/disguise/game/progress';
import { applyRecordedTurns, newGame, step, stepInterval, type GameState } from '@/features/disguise/snake-logic';

// Plays back the best Classic run, move for move: the engine is deterministic,
// so the recorded seed and turns rebuild the exact same game.
export function ReplayScreen({ replay, onBack }: { replay: Replay | null; onBack: () => void }) {
  const { s } = useLook();
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ width, height });
  };

  return (
    <View style={[s.page, { flex: 1 }]}>
      <Header title="REPLAY" onBack={onBack} />
      {!replay ? (
        <Text style={s.muted}>No replay yet. Your best Classic run is saved here so you can watch it back.</Text>
      ) : (
        <>
          <Text style={s.muted}>
            BEST RUN · {replay.score} POINTS{replay.date ? ` · ${replay.date}` : ''}
          </Text>
          <View style={{ flex: 1 }} onLayout={onLayout}>
            {area && <Player replay={replay} width={area.width} height={area.height - 120} />}
          </View>
        </>
      )}
    </View>
  );
}

function Player({ replay, width, height }: { replay: Replay; width: number; height: number }) {
  const { s } = useLook();
  const [game, setGame] = useState<GameState>(() => newGame(replay.config));
  const [speed, setSpeed] = useState<'1' | '2' | '4'>('1');
  const [isPlaying, setIsPlaying] = useState(true);
  const cursor = useRef(0);
  const gameRef = useRef(game);
  gameRef.current = game;

  const cell = Math.max(4, Math.floor(Math.min(width / replay.config.cols, height / replay.config.rows)));
  const done = game.isOver || game.tick >= replay.ticks;

  useEffect(() => {
    if (!isPlaying || done) return;
    const timer = setTimeout(
      () => {
        const turned = applyRecordedTurns(gameRef.current, replay.turns, cursor.current);
        cursor.current = turned.next;
        setGame(step(turned.state).state);
      },
      stepInterval(game) / Number(speed),
    );
    return () => clearTimeout(timer);
  }, [game, isPlaying, speed, done, replay]);

  const restart = () => {
    cursor.current = 0;
    setGame(newGame(replay.config));
    setIsPlaying(true);
  };

  return (
    <View style={{ gap: 10, alignItems: 'center' }}>
      <View style={[s.row, { alignSelf: 'stretch' }]}>
        <Text style={s.hud}>SCORE {pad(game.snakes[0].score)}</Text>
        <Text style={s.hud}>{clock(game.elapsedMs)}</Text>
      </View>
      <View>
        <Board game={game} cell={cell} skin={replay.skin} />
        {done && (
          <View style={s.overlay}>
            <Text style={s.overlayTitle}>END OF REPLAY</Text>
          </View>
        )}
      </View>
      <View style={{ alignSelf: 'stretch', gap: 8 }}>
        <Tabs
          options={[
            ['1', '1x'],
            ['2', '2x'],
            ['4', '4x'],
          ]}
          value={speed}
          onChange={setSpeed}
        />
        <View style={s.confirmButtons}>
          {done ? (
            <GameButton small label="WATCH AGAIN" icon="replay" onPress={restart} />
          ) : (
            <GameButton
              small
              label={isPlaying ? 'PAUSE' : 'PLAY'}
              icon={isPlaying ? 'pause' : 'play'}
              onPress={() => setIsPlaying((p) => !p)}
            />
          )}
        </View>
      </View>
    </View>
  );
}
