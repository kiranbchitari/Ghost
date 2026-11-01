import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef } from 'react';

// The game's chiptune effects, made by scripts/make-snake-sounds.py. They mix
// with whatever else is playing and stay quiet when the phone is on silent.

const SOURCES = {
  eat: require('../../../../assets/sounds/eat.wav'),
  bonus: require('../../../../assets/sounds/bonus.wav'),
  golden: require('../../../../assets/sounds/golden.wav'),
  poison: require('../../../../assets/sounds/poison.wav'),
  power: require('../../../../assets/sounds/power.wav'),
  shield: require('../../../../assets/sounds/shield.wav'),
  crash: require('../../../../assets/sounds/crash.wav'),
  win: require('../../../../assets/sounds/win.wav'),
} as const;

export type SoundName = keyof typeof SOURCES;

let isModeSet = false;

// Loads every effect while the game is on screen; play() does nothing while sound is off.
export function useSounds(enabled: boolean) {
  const players = useRef<Partial<Record<SoundName, AudioPlayer>>>({});
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!isModeSet) {
      isModeSet = true;
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false }).catch(
        () => (isModeSet = false),
      );
    }
    const loaded = players.current;
    for (const name of Object.keys(SOURCES) as SoundName[]) {
      try {
        loaded[name] = createAudioPlayer(SOURCES[name]);
      } catch {
        // A missing effect just stays silent.
      }
    }
    return () => {
      for (const player of Object.values(loaded)) player.remove();
      players.current = {};
    };
  }, []);

  return (name: SoundName) => {
    const player = players.current[name];
    if (!enabledRef.current || !player) return;
    try {
      player.seekTo(0).catch(() => {});
      player.play();
    } catch {
      // Sound is a nicety; the game carries on without it.
    }
  };
}
