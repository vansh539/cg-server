import React from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { colors, fonts } from '../../src/theme';

export default function TabLayout() {
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
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏠</Text>,
        }}
      />
      <Tabs.Screen
        name="ledger"
        options={{
          title: 'Ledger',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📒</Text>,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📦</Text>,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>👤</Text>,
        }}
      />
    </Tabs>
  );
}
