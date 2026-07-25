import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as Font from 'expo-font';
import {
  CormorantGaramond_600SemiBold_Italic,
  CormorantGaramond_700Bold_Italic,
} from '@expo-google-fonts/cormorant-garamond';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { useClientStore } from '../src/store';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
});

export default function RootLayout() {
  const loadFromStorage = useClientStore((s) => s.loadFromStorage);

  useEffect(() => {
    Font.loadAsync({
      'CormorantGaramond_700Italic': CormorantGaramond_700Bold_Italic,
      'CormorantGaramond_600Italic': CormorantGaramond_600SemiBold_Italic,
      DMSans_400Regular,
      DMSans_500Medium,
      DMSans_700Bold,
    }).catch(() => {});
    loadFromStorage();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
