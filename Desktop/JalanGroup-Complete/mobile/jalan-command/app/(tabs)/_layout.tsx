import React from 'react';
import { Text, View } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import { colors, fonts } from '../../src/theme';
import { useAuthStore } from '../../src/store';

export default function TabLayout() {
  const token = useAuthStore((s) => s.token);
  const ready = useAuthStore((s) => s.ready);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!token) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surf,
          borderTopColor: colors.bdr,
          borderTopWidth: 1,
          height: 72,
          paddingBottom: 12,
        },
        tabBarActiveTintColor: colors.viGold,
        tabBarInactiveTintColor: colors.txt3,
        tabBarLabelStyle: {
          fontFamily: fonts.dmSans,
          fontSize: 9,
          letterSpacing: 0.5,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 20 }}>🏠</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="parties/index"
        options={{
          title: 'Parties',
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 20 }}>👤</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="orders/index"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 20 }}>📦</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="bot"
        options={{
          title: 'WA Bot',
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 20 }}>💬</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 20 }}>⚙️</Text>
          ),
        }}
      />
      <Tabs.Screen name="rates"            options={{ href: null }} />
      <Tabs.Screen name="parties/[id]"     options={{ href: null }} />
    </Tabs>
  );
}
