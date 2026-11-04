import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import React from 'react';
import type { ColorValue } from 'react-native';

import { useTotalNew } from '../../store/library';
import { colors } from '../../theme';

type IconName = keyof typeof Ionicons.glyphMap;

function icon(active: IconName, inactive: IconName) {
  function TabIcon({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) {
    return <Ionicons name={focused ? active : inactive} color={color as string} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const totalNew = useTotalNew();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '800', fontSize: 20 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Discover', headerShown: false, tabBarIcon: icon('moon', 'moon-outline') }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: icon('search', 'search-outline') }} />
      <Tabs.Screen name="library" options={{ title: 'Library', tabBarIcon: icon('library', 'library-outline') }} />
      <Tabs.Screen
        name="updates"
        options={{
          title: 'Updates',
          tabBarIcon: icon('notifications', 'notifications-outline'),
          tabBarBadge: totalNew > 0 ? (totalNew > 99 ? '99+' : totalNew) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, color: '#fff' },
        }}
      />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings', 'settings-outline') }} />
    </Tabs>
  );
}
