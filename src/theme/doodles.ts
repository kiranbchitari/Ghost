// Line doodles for chat wallpapers, each an SVG path in a 24×24 box, drawn
// with a round-capped stroke. Original artwork, themed on Ghost itself:
// chats, secrets, burning, photos and late nights.
export const DOODLES = [
  // Speech bubble
  'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z',
  // Heart
  'M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z',
  // Ghost
  'M6 20V10.5a6 6 0 0 1 12 0V20l-2-1.8-2 1.8-2-1.8-2 1.8-2-1.8z M9.8 10.5v.6 M14.2 10.5v.6',
  // Flame
  'M12 21a5.5 5.5 0 0 1-5.5-5.5c0-3.4 2.6-4.8 2.6-8.5 2.3 1.2 3.4 3.3 3.4 3.3s.6-2.4 2.4-4.3c.9 2.7 2.6 4.6 2.6 9.5A5.5 5.5 0 0 1 12 21z',
  // Padlock
  'M7 11h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z M8.5 11V8a3.5 3.5 0 0 1 7 0v3 M12 14.5v2',
  // Paper plane
  'M3.5 11.2 20.5 4l-6.8 16.5-2.6-6.8z M11.1 13.7 20.5 4',
  // Crescent moon
  'M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z',
  // Camera
  'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.6-2.2h5.2L16.2 7h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z M12 16.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
  // Music note
  'M9 17.5V6l10-2v11.5 M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M19 15.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  // Smiley
  'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z M8.5 14a4.2 4.2 0 0 0 7 0 M9.3 9.8v.4 M14.7 9.8v.4',
  // Star
  'M12 3.8l2.4 5 5.4.7-4 3.7 1 5.4L12 16l-4.8 2.6 1-5.4-4-3.7 5.4-.7z',
  // Cloud
  'M7.5 18h9.5a3.8 3.8 0 0 0 .4-7.6A5.5 5.5 0 0 0 6.8 11 3.5 3.5 0 0 0 7.5 18z',
  // Key
  'M8 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z M11.5 12H20 M17 12v2.5 M19.5 12v2',
  // Eye
  'M2.8 12S6.2 6 12 6s9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z',
  // Coffee cup
  'M5 9h11v5.5A4.5 4.5 0 0 1 11.5 19h-2A4.5 4.5 0 0 1 5 14.5z M16 10.5h1.5a2.3 2.3 0 0 1 0 4.6H16 M9 3.5c-.8 1 .8 2 0 3 M12.5 3.5c-.8 1 .8 2 0 3',
  // Sparkle
  'M12 4v5 M12 15v5 M4 12h5 M15 12h5 M7 7l2.2 2.2 M14.8 14.8 17 17 M17 7l-2.2 2.2 M9.2 14.8 7 17',
];

// Where each doodle sits: a staggered grid with a little rotation, size and
// position jitter so the pattern doesn't look stamped. Deterministic, so the
// wallpaper is identical on every render.
export type DoodlePlacement = { path: number; x: number; y: number; rotate: number; scale: number };

export const DOODLE_CELL = 50;

export function layoutDoodles(width: number, height: number): DoodlePlacement[] {
  const placements: DoodlePlacement[] = [];
  const cols = Math.ceil(width / DOODLE_CELL) + 1;
  const rows = Math.ceil(height / DOODLE_CELL) + 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const n = hash(row * 131 + col * 37);
      placements.push({
        path: Math.floor(hash(row * 17 + col * 59 + 7) * DOODLES.length),
        x: col * DOODLE_CELL + (row % 2 ? DOODLE_CELL / 2 : 0) + (n - 0.5) * 12 - DOODLE_CELL / 2,
        y: row * DOODLE_CELL + (hash(row * 71 + col * 13 + 3) - 0.5) * 12 - DOODLE_CELL / 2,
        rotate: (n - 0.5) * 50,
        scale: 0.95 + hash(row * 29 + col * 89 + 11) * 0.3,
      });
    }
  }
  return placements;
}

// Cheap repeatable pseudo-random number in [0, 1).
function hash(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
