import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

type Glyph = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type Hero = {
  id: string;
  name: string;
  universe: 'Marvel' | 'DC';
  // Badge gradient, top-left to bottom-right, and the symbol drawn on it.
  colors: [string, string];
  glyph: Glyph;
  glyphColor: string;
};

// Original badges in each character's colours with a generic symbol: no
// studio logos or artwork. Character names are trademarks of Marvel and DC;
// rename these before shipping publicly.
//
// Ids are stored in profiles.avatar, so never change or reuse one.
export const HEROES: Hero[] = [
  // Marvel
  { id: 'spider-man', name: 'Spider-Man', universe: 'Marvel', colors: ['#e23636', '#1c3f94'], glyph: 'spider', glyphColor: '#ffffff' },
  { id: 'iron-man', name: 'Iron Man', universe: 'Marvel', colors: ['#b11313', '#f2b705'], glyph: 'atom', glyphColor: '#fff4c2' },
  { id: 'captain-america', name: 'Captain America', universe: 'Marvel', colors: ['#1f3c88', '#c8102e'], glyph: 'shield-star', glyphColor: '#ffffff' },
  { id: 'thor', name: 'Thor', universe: 'Marvel', colors: ['#2b4c7e', '#9bb4d6'], glyph: 'hammer', glyphColor: '#f4f6fa' },
  { id: 'hulk', name: 'Hulk', universe: 'Marvel', colors: ['#3f8f29', '#5b2c83'], glyph: 'arm-flex', glyphColor: '#eaffd9' },
  { id: 'black-panther', name: 'Black Panther', universe: 'Marvel', colors: ['#1a1a1a', '#6a3fa0'], glyph: 'paw', glyphColor: '#c9b6ff' },
  { id: 'black-widow', name: 'Black Widow', universe: 'Marvel', colors: ['#111111', '#b3001b'], glyph: 'spider-web', glyphColor: '#ff4d5e' },
  { id: 'doctor-strange', name: 'Doctor Strange', universe: 'Marvel', colors: ['#16367a', '#d1342f'], glyph: 'eye-circle', glyphColor: '#ffd36b' },
  { id: 'captain-marvel', name: 'Captain Marvel', universe: 'Marvel', colors: ['#c8102e', '#1f3c88'], glyph: 'star-four-points', glyphColor: '#ffd23f' },
  { id: 'scarlet-witch', name: 'Scarlet Witch', universe: 'Marvel', colors: ['#7a0019', '#e0115f'], glyph: 'creation', glyphColor: '#ffd1e0' },
  { id: 'hawkeye', name: 'Hawkeye', universe: 'Marvel', colors: ['#4b1f6f', '#2a2a2a'], glyph: 'bow-arrow', glyphColor: '#d9b8ff' },
  { id: 'groot', name: 'Groot', universe: 'Marvel', colors: ['#5a3d1e', '#4f7f2a'], glyph: 'tree', glyphColor: '#d8f0b0' },
  { id: 'wolverine', name: 'Wolverine', universe: 'Marvel', colors: ['#f2c200', '#1d3f8f'], glyph: 'sword-cross', glyphColor: '#ffffff' },
  { id: 'deadpool', name: 'Deadpool', universe: 'Marvel', colors: ['#a80000', '#1a1a1a'], glyph: 'ninja', glyphColor: '#ffffff' },
  // DC
  { id: 'batman', name: 'Batman', universe: 'DC', colors: ['#1b1b1b', '#3d4250'], glyph: 'bat', glyphColor: '#f2c94c' },
  { id: 'superman', name: 'Superman', universe: 'DC', colors: ['#0b4ea2', '#d0021b'], glyph: 'shield-half-full', glyphColor: '#ffd700' },
  { id: 'wonder-woman', name: 'Wonder Woman', universe: 'DC', colors: ['#a3001b', '#123f8c'], glyph: 'crown', glyphColor: '#ffd23f' },
  { id: 'flash', name: 'The Flash', universe: 'DC', colors: ['#c4000d', '#f6b500'], glyph: 'lightning-bolt', glyphColor: '#fff3b0' },
  { id: 'aquaman', name: 'Aquaman', universe: 'DC', colors: ['#e48b00', '#0a7a5c'], glyph: 'waves', glyphColor: '#ffffff' },
  { id: 'green-lantern', name: 'Green Lantern', universe: 'DC', colors: ['#0a6b2a', '#121212'], glyph: 'ring', glyphColor: '#7dff8a' },
  { id: 'cyborg', name: 'Cyborg', universe: 'DC', colors: ['#5d6670', '#b3001b'], glyph: 'robot', glyphColor: '#ff6b6b' },
  { id: 'shazam', name: 'Shazam', universe: 'DC', colors: ['#c8102e', '#f6c100'], glyph: 'weather-lightning', glyphColor: '#ffffff' },
  { id: 'martian-manhunter', name: 'Martian Manhunter', universe: 'DC', colors: ['#1f7a3b', '#1c3f94'], glyph: 'eye', glyphColor: '#ff5a5a' },
  { id: 'nightwing', name: 'Nightwing', universe: 'DC', colors: ['#0d0d0d', '#1565c0'], glyph: 'shield-moon', glyphColor: '#7cc4ff' },
];

const BY_ID = new Map(HEROES.map((hero) => [hero.id, hero]));

// Ghost codes are a hero's name plus four digits (Thor4821, SpiderMan0397).
// generate_ghost_code() in supabase/migrations/20261031150000_hero_codes.sql
// holds the same names, so add a hero there too.
const codeName = (hero: Hero) => hero.name.replace(/^The /, '').replace(/[^A-Za-z]/g, '').toLowerCase();
const BY_CODE_NAME = new Map(HEROES.map((hero) => [codeName(hero), hero]));

// The chosen hero, else the one in the Ghost code, else (older random codes)
// one picked from the code, so everyone gets a stable avatar before choosing
// and both sides of a chat agree on it.
export function heroFor(avatar: string | null | undefined, ghostCode: string | null | undefined) {
  const chosen = avatar ? BY_ID.get(avatar) : undefined;
  if (chosen) return chosen;

  const inCode = /^([a-z]+)\d{4}$/i.exec(ghostCode ?? '');
  const named = inCode ? BY_CODE_NAME.get(inCode[1].toLowerCase()) : undefined;
  if (named) return named;

  let hash = 0;
  for (const char of ghostCode ?? '') hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HEROES[hash % HEROES.length];
}
