import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';

import {
  themePreferences,
  themes,
  type AppTheme,
  type ThemePreference,
} from '@/theme/themes';

const STORAGE_KEY = 'ghost.theme';

type ThemeState = {
  theme: AppTheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeState>({
  theme: themes.light,
  preference: 'system',
  setPreference: () => {},
});

function isPreference(value: string | null): value is ThemePreference {
  return themePreferences.includes(value as ThemePreference);
}

export function AppThemeProvider({ children }: PropsWithChildren) {
  const scheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (isPreference(stored)) setPreferenceState(stored);
      })
      .catch(() => {})
      .finally(() => setIsLoaded(true));
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const theme = themes[preference === 'system' ? (scheme === 'dark' ? 'dark' : 'light') : preference];

  // Headers and the tab bar read colors from the navigation theme.
  const navigationTheme = useMemo(() => {
    const base = theme.isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.tint,
        background: theme.colors.background,
        card: theme.colors.surface,
        text: theme.colors.text,
        border: theme.colors.border,
        notification: theme.colors.danger,
      },
    };
  }, [theme]);

  const value = useMemo(() => ({ theme, preference, setPreference }), [theme, preference, setPreference]);

  // Render nothing until the saved theme is known, so Stealth never flashes a
  // readable theme on launch.
  if (!isLoaded) return null;

  return (
    <ThemeContext.Provider value={value}>
      <ThemeProvider value={navigationTheme}>{children}</ThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeContext);
}

// Pass a module-level factory so styles are only rebuilt when the theme changes.
export function useThemedStyles<T>(factory: (theme: AppTheme) => T) {
  const { theme } = useAppTheme();
  return useMemo(() => factory(theme), [factory, theme]);
}
