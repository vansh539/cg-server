import React, { useEffect, Component } from 'react';
import { View, Text, ScrollView } from 'react-native';
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
import { useAuthStore } from '../src/store';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: any) {
    return { error: String(e?.message ?? e) };
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#06100A', padding: 24, paddingTop: 60 }}>
          <Text style={{ color: '#C9A44A', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>
            App Crash — Copy this error:
          </Text>
          <ScrollView>
            <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'monospace' }} selectable>
              {this.state.error}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);

  useEffect(() => {
    Font.loadAsync({
      'CormorantGaramond_700Italic': CormorantGaramond_700Bold_Italic,
      'CormorantGaramond_600Italic': CormorantGaramond_600SemiBold_Italic,
      DMSans_400Regular,
      DMSans_500Medium,
      DMSans_700Bold,
    }).catch(() => {});
    loadFromStorage().catch(() => {});
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
