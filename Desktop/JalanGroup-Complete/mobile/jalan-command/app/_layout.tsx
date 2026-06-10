import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  CormorantGaramond_600Italic,
  CormorantGaramond_700Italic,
} from '@expo-google-fonts/cormorant-garamond';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { useAuthStore } from '../src/store';
import { colors } from '../src/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_700Italic,
    CormorantGaramond_600Italic,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);

  useEffect(() => {
    loadFromStorage();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" backgroundColor={colors.bg} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </QueryClientProvider>
  );
}
