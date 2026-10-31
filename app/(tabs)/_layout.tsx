import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { useAppTheme } from '@/theme/theme-provider';

type IconName = ComponentProps<typeof Ionicons>['name'];

// The tab bar passes a ColorValue; Ionicons only takes colour strings. Themes
// with a chat style (WhatsApp) put a pill behind the active icon.
function TabIcon({
  name,
  color,
  size,
  pill,
}: {
  name: IconName;
  color: ColorValue;
  size: number;
  pill?: string | null;
}) {
  const icon = <Ionicons name={name} size={size} color={typeof color === 'string' ? color : undefined} />;
  if (pill === undefined) return icon;
  return <View style={[styles.pill, pill ? { backgroundColor: pill } : null]}>{icon}</View>;
}

export default function TabsLayout() {
  const { theme } = useAppTheme();
  const chat = theme.chat;
  // undefined: no pill at all; null: room for one, not active.
  const pillFor = (focused: boolean) => (chat ? (focused ? chat.tabPill : null) : undefined);

  return (
    <Tabs
      screenOptions={
        chat
          ? {
              tabBarActiveTintColor: chat.tabActive,
              tabBarInactiveTintColor: chat.tabInactive,
              tabBarLabelStyle: styles.label,
              tabBarStyle: { borderTopColor: theme.colors.border },
              tabBarIconStyle: styles.iconSlot,
              headerShadowVisible: false,
            }
          : undefined
      }>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              name={focused ? 'chatbubbles' : 'chatbubbles-outline'}
              color={color}
              size={chat ? 22 : size}
              pill={pillFor(focused)}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              name={focused ? 'settings' : 'settings-outline'}
              color={color}
              size={chat ? 22 : size}
              pill={pillFor(focused)}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  pill: { width: 58, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  // Room for the pill above the label.
  iconSlot: { width: 58, height: 30 },
  label: { fontSize: 12, fontWeight: '600' },
});
