import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';

import { MAZE_LEVELS } from '@/features/disguise/game/levels';
import {
  GameButton,
  Header,
  Icon,
  pad,
  ProgressBar,
  segmentStyle,
  SKINS,
  Tabs,
  THEMES,
  useLook,
  type SkinId,
  type ThemeId,
} from '@/features/disguise/game/look';
import {
  ACHIEVEMENT_XP,
  ACHIEVEMENTS,
  currentMissions,
  DAILY_XP,
  dailyChallenge,
  dailyTitle,
  levelFromXp,
  MISSION_XP,
  today,
  xpForLevel,
  type Leaderboard,
  type LeaderboardMode,
  type Profile,
} from '@/features/disguise/game/progress';
import type { Mode } from '@/features/disguise/snake-logic';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export type Screen =
  | 'menu'
  | 'modes'
  | 'levels'
  | 'play'
  | 'achievements'
  | 'daily'
  | 'missions'
  | 'skins'
  | 'themes'
  | 'leaderboard'
  | 'replay'
  | 'settings';

function LevelBadge({ profile }: { profile: Profile }) {
  const { s } = useLook();
  const level = levelFromXp(profile.xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return (
    <View style={{ alignSelf: 'stretch', gap: 2 }}>
      <View style={s.row}>
        <Text style={s.bold}>LV {level}</Text>
        <Text style={s.muted}>
          {profile.xp - from}/{to - from} XP
        </Text>
      </View>
      <ProgressBar value={profile.xp - from} max={to - from} />
    </View>
  );
}

export function Menu({
  profile,
  best,
  canContinue,
  onContinue,
  onOpen,
}: {
  profile: Profile;
  best: number;
  canContinue: boolean;
  onContinue: () => void;
  onOpen: (screen: Screen) => void;
}) {
  const { s } = useLook();
  const dailyDone = profile.daily.date === today() && profile.daily.completed;
  const missionsLeft = currentMissions(profile).some((m) => !m.done);
  const smallButtons: [Screen, IconName, string][] = [
    ['skins', 'snake', 'SKINS'],
    ['themes', 'palette', 'THEMES'],
    ['replay', 'replay', 'REPLAY'],
    ['settings', 'cog', 'SETTINGS'],
  ];
  return (
    <ScrollView contentContainerStyle={s.menu}>
      <Icon name="snake" size={64} />
      <Text style={s.title}>SNAKE</Text>
      <Text style={s.subtitle}>HI-SCORE {pad(best)}</Text>
      <View style={[s.menuButtons, { marginTop: 18 }]}>
        <LevelBadge profile={profile} />
      </View>
      <View style={s.menuButtons}>
        {canContinue && <GameButton label="CONTINUE" icon="play" onPress={onContinue} />}
        <GameButton label="PLAY" icon="gamepad-variant" onPress={() => onOpen('modes')} />
        <GameButton label="DAILY CHALLENGE" icon="calendar-star" dot={!dailyDone} onPress={() => onOpen('daily')} />
        <GameButton label="MISSIONS" icon="format-list-checks" dot={missionsLeft} onPress={() => onOpen('missions')} />
        <GameButton label="ACHIEVEMENTS" icon="trophy" onPress={() => onOpen('achievements')} />
        <GameButton label="LEADERBOARD" icon="crown" onPress={() => onOpen('leaderboard')} />
        <View style={s.iconRow}>
          {smallButtons.map(([screen, icon, label]) => (
            <Pressable
              key={screen}
              onPress={() => onOpen(screen)}
              style={({ pressed }) => [s.iconButton, pressed && s.buttonPressed]}
              accessibilityRole="button"
              accessibilityLabel={label}>
              <Icon name={icon} size={22} />
              <Text style={s.iconButtonText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const MODES: { mode: Mode; icon: IconName; title: string; description: string }[] = [
  { mode: 'classic', icon: 'snake', title: 'CLASSIC', description: 'Endless gameplay' },
  { mode: 'time', icon: 'timer-outline', title: 'TIME ATTACK', description: 'High score in 120s' },
  { mode: 'maze', icon: 'grid', title: 'MAZE', description: 'Clear challenging levels' },
  { mode: 'survival', icon: 'infinity', title: 'SURVIVAL', description: 'Obstacles & increasing speed' },
  { mode: 'duel', icon: 'account-multiple', title: 'TWO PLAYER', description: 'Play with a friend' },
];

export function Card({
  icon,
  title,
  description,
  right,
  onPress,
  selected,
  children,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  selected?: boolean;
  children?: React.ReactNode;
}) {
  const { s } = useLook();
  const body = (
    <>
      {icon && <Icon name={icon} size={30} />}
      <View style={s.cardBody}>
        <Text style={s.cardTitle}>{title}</Text>
        {description ? <Text style={s.muted}>{description}</Text> : null}
        {children}
      </View>
      {right}
    </>
  );
  if (!onPress) return <View style={[s.card, selected && s.cardOn]}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.card, (pressed || selected) && s.cardOn]}
      accessibilityRole="button">
      {body}
    </Pressable>
  );
}

export function Modes({
  profile,
  onPick,
  onBack,
}: {
  profile: Profile;
  onPick: (mode: Mode) => void;
  onBack: () => void;
}) {
  const { s } = useLook();
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Header title="GAME MODES" onBack={onBack} />
      {MODES.map((m) => (
        <Card
          key={m.mode}
          icon={m.icon}
          title={m.title}
          description={m.description}
          onPress={() => onPick(m.mode)}
          right={
            m.mode !== 'duel' && profile.stats.best[m.mode] ? (
              <Text style={s.muted}>HI {pad(profile.stats.best[m.mode] ?? 0)}</Text>
            ) : null
          }
        />
      ))}
    </ScrollView>
  );
}

export function Levels({ profile, onPick, onBack }: { profile: Profile; onPick: (level: number) => void; onBack: () => void }) {
  const { s } = useLook();
  // Each level opens once the one before it is cleared.
  const unlocked = Math.min(MAZE_LEVELS, profile.mazeStars.filter((n) => n > 0).length + 1);
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Header title="MAZE" onBack={onBack} />
      <Text style={s.muted}>Eat enough apples to clear a level. Clear it quickly for three stars.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {Array.from({ length: MAZE_LEVELS }, (_, i) => {
          const level = i + 1;
          const stars = profile.mazeStars[i] ?? 0;
          const open = level <= unlocked;
          return (
            <Pressable
              key={level}
              disabled={!open}
              onPress={() => onPick(level)}
              style={({ pressed }) => [
                s.card,
                { width: '30%', flexGrow: 1, flexDirection: 'column', gap: 4, paddingVertical: 14 },
                pressed && s.cardOn,
                !open && s.buttonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Level ${level}${open ? '' : ', locked'}`}>
              <Text style={s.cardTitle}>{pad(level, 2)}</Text>
              {open ? (
                <View style={{ flexDirection: 'row' }}>
                  {[1, 2, 3].map((n) => (
                    <Icon key={n} name={n <= stars ? 'star' : 'star-outline'} size={14} />
                  ))}
                </View>
              ) : (
                <Icon name="lock" size={16} />
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function Achievements({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const { s } = useLook();
  const count = ACHIEVEMENTS.filter((a) => profile.achievements[a.id]).length;
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Header title="ACHIEVEMENTS" onBack={onBack} />
      <Text style={s.muted}>
        {count}/{ACHIEVEMENTS.length} UNLOCKED · +{ACHIEVEMENT_XP} XP EACH
      </Text>
      {ACHIEVEMENTS.map((a) => {
        const done = !!profile.achievements[a.id];
        const [value, target] = a.progress(profile);
        return (
          <Card
            key={a.id}
            icon={a.icon as IconName}
            title={a.title}
            description={target > 1 && !done ? `${a.description} (${Math.min(value, target)}/${target})` : a.description}
            right={<Icon name={done ? 'check' : 'lock'} size={20} />}>
            {target > 1 && !done && <ProgressBar value={value} max={target} />}
          </Card>
        );
      })}
    </ScrollView>
  );
}

export function Daily({ profile, onPlay, onBack }: { profile: Profile; onPlay: () => void; onBack: () => void }) {
  const { s } = useLook();
  const challenge = dailyChallenge();
  const todays = profile.daily.date === challenge.date ? profile.daily : null;
  const challengeFriend = () => {
    const message = todays?.best
      ? `Snake daily challenge (${challenge.date}): ${dailyTitle(challenge)}. My best today is ${todays.best}. Can you beat it?`
      : `Snake daily challenge (${challenge.date}): ${dailyTitle(challenge)}. Think you can do it?`;
    Share.share({ message }).catch(() => {});
  };
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Header title="DAILY CHALLENGE" onBack={onBack} />
      <View style={{ alignItems: 'center', gap: 10 }}>
        <Icon name="calendar-star" size={48} />
        <Text style={s.bold}>TODAY&apos;S CHALLENGE</Text>
      </View>
      <View style={s.dashedBox}>
        <Icon name="star" size={24} />
        <Text style={[s.bold, { textAlign: 'center' }]}>{dailyTitle(challenge)}</Text>
        <Text style={s.muted}>{challenge.wrapsWalls ? 'Walls let you through' : 'Solid walls'} · same board for everyone today</Text>
      </View>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Text style={s.bold}>REWARD</Text>
        <View style={s.effect}>
          <Icon name="gift-outline" size={20} />
          <Text style={s.text}> {DAILY_XP} XP</Text>
        </View>
        <View style={s.effect}>
          <Icon name="fire" size={20} />
          <Text style={s.text}>
            {' '}
            {profile.streak.count} DAY STREAK{profile.streak.lastDate === challenge.date ? '' : ' · PLAY TODAY TO KEEP IT'}
          </Text>
        </View>
        {todays && <Text style={s.muted}>Best today: {todays.best}</Text>}
      </View>
      {todays?.completed ? (
        <View style={s.badge}>
          <Text style={s.badgeText}>COMPLETED</Text>
        </View>
      ) : null}
      <GameButton label={todays?.completed ? 'PLAY AGAIN' : 'PLAY NOW'} icon="play" onPress={onPlay} />
      <GameButton label="CHALLENGE A FRIEND" icon="share-variant" onPress={challengeFriend} />
    </ScrollView>
  );
}

export function Missions({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const { s } = useLook();
  const missions = currentMissions(profile);
  const level = levelFromXp(profile.xp);
  const nextUnlocks = [
    ...Object.values(SKINS).map((x) => ({ name: `${x.name} skin`, level: x.unlockLevel })),
    ...Object.values(THEMES).map((x) => ({ name: `${x.name} theme`, level: x.unlockLevel })),
  ]
    .filter((u) => u.level > level)
    .sort((a, b) => a.level - b.level)
    .slice(0, 2);
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Header title="MISSIONS" onBack={onBack} />
      <LevelBadge profile={profile} />
      {nextUnlocks.length > 0 && (
        <Text style={s.muted}>Next: {nextUnlocks.map((u) => `${u.name} at LV ${u.level}`).join(', ')}</Text>
      )}
      <Text style={[s.settingLabel, s.sectionGap]}>TODAY · +{MISSION_XP} XP EACH</Text>
      {missions.map((m, i) => (
        <Card
          key={i}
          icon={m.done ? 'checkbox-marked-circle-outline' : 'clipboard-list-outline'}
          title={m.title}
          description={`${Math.min(m.progress, m.target)}/${m.target}`}
          right={m.done ? <Icon name="check" size={20} /> : undefined}>
          {!m.done && <ProgressBar value={m.progress} max={m.target} />}
        </Card>
      ))}
      <Text style={s.muted}>New missions every day.</Text>
      <Text style={[s.settingLabel, s.sectionGap]}>STREAK</Text>
      <Card
        icon="fire"
        title={`${profile.streak.count} DAY${profile.streak.count === 1 ? '' : 'S'}`}
        description="Play every day for bonus XP: +10 XP per day in a row, up to +70."
      />
      <Text style={[s.settingLabel, s.sectionGap]}>STATS</Text>
      <View>
        {(
          [
            ['Games played', profile.stats.games],
            ['Apples eaten', profile.stats.apples],
            ['Power-ups', profile.stats.powerUps],
            ['Longest snake', profile.stats.longestSnake],
          ] as const
        ).map(([label, value]) => (
          <View key={label} style={s.row}>
            <Text style={s.text}>{label}</Text>
            <Text style={s.bold}>{value}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function Skins({ profile, onPick, onBack }: { profile: Profile; onPick: (skin: SkinId) => void; onBack: () => void }) {
  const { p, s } = useLook();
  const level = levelFromXp(profile.xp);
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Header title="SNAKE SKINS" onBack={onBack} />
      {(Object.keys(SKINS) as SkinId[]).map((id) => {
        const skin = SKINS[id];
        const open = level >= skin.unlockLevel;
        return (
          <Card
            key={id}
            title={skin.name}
            description={open ? undefined : `Unlocks at LV ${skin.unlockLevel}`}
            selected={profile.skin === id}
            onPress={open ? () => onPick(id) : undefined}
            right={<Icon name={profile.skin === id ? 'check' : open ? 'chevron-right' : 'lock'} size={20} />}>
            <View style={[s.skinPreview, { marginTop: 6 }]}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={[{ width: 16, height: 16 }, segmentStyle(id, p, i, 16)]} />
              ))}
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

export function Themes({ profile, onPick, onBack }: { profile: Profile; onPick: (theme: ThemeId) => void; onBack: () => void }) {
  const { s } = useLook();
  const level = levelFromXp(profile.xp);
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Header title="THEMES" onBack={onBack} />
      {(Object.keys(THEMES) as ThemeId[]).map((id) => {
        const theme = THEMES[id];
        const open = level >= theme.unlockLevel;
        return (
          <Card
            key={id}
            title={theme.name}
            description={open ? undefined : `Unlocks at LV ${theme.unlockLevel}`}
            selected={profile.theme === id}
            onPress={open ? () => onPick(id) : undefined}
            right={<Icon name={profile.theme === id ? 'check' : open ? 'chevron-right' : 'lock'} size={20} />}>
            <View style={[s.swatch, { backgroundColor: theme.bg, borderColor: theme.ink, marginTop: 6 }]}>
              <View style={{ width: 10, height: 10, backgroundColor: theme.ink }} />
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const BOARD_TABS: [LeaderboardMode, string][] = [
  ['classic', 'CLASSIC'],
  ['time', 'TIME'],
  ['survival', 'SURVIVAL'],
];

export function LeaderboardScreen({ leaderboard, onBack }: { leaderboard: Leaderboard; onBack: () => void }) {
  const { s } = useLook();
  const [tab, setTab] = useState<LeaderboardMode>('classic');
  const entries = leaderboard[tab];
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Header title="LEADERBOARD" onBack={onBack} />
      <Tabs options={BOARD_TABS} value={tab} onChange={setTab} />
      <Text style={s.muted}>Top 10 runs on this phone. Set your player name in Settings.</Text>
      {entries.length === 0 ? (
        <Text style={s.muted}>No scores yet. Go play!</Text>
      ) : (
        entries.map((entry, i) => (
          <View key={i} style={[s.card, { paddingVertical: 8 }, i === 0 && s.cardOn]}>
            <View style={{ width: 26, alignItems: 'center' }}>
              {i === 0 ? <Icon name="crown" size={20} /> : <Text style={s.bold}>{i + 1}</Text>}
            </View>
            <View style={s.cardBody}>
              <Text style={s.cardTitle} numberOfLines={1}>
                {entry.name}
              </Text>
              {entry.date ? <Text style={s.muted}>{entry.date}</Text> : null}
            </View>
            <Text style={s.bold}>{entry.score.toLocaleString()}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}
