import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';

export default function SettingsScreen() {
  const { companyName, clearAuth } = useAuthStore();

  const logout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => {
          clearAuth();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <ScreenWrapper scroll>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.card}>
        <Text style={styles.lbl}>Active Company</Text>
        <Text style={styles.val}>{companyName}</Text>
      </View>
      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:      { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14 },
  card:       { marginHorizontal: 14, backgroundColor: colors.surf2, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.bdr },
  lbl:        { fontFamily: fonts.dmSansBold, fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', color: colors.txt3, marginBottom: 4 },
  val:        { fontFamily: fonts.dmSansBold, fontSize: 15, color: colors.txt },
  logoutBtn:  { marginHorizontal: 14, marginTop: 16, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: `${colors.red}40`, backgroundColor: `${colors.red}10`, alignItems: 'center' },
  logoutText: { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.red },
});
