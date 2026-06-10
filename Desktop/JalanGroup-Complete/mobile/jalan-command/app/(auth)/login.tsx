import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { adminLogin } from '../../src/api';
import { useAuthStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { HexBg } from '../../src/components/HexBg';

const COMPANIES = [
  { id: '2bead4bf-8eed-4e45-90b3-d2bcda632a56', name: 'Vansh Iron' },
  { id: '3658d1d5-77ed-4f9b-aacb-d329ccb9e93a', name: 'Amit Steels' },
];

export default function LoginScreen() {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [selectedCompany, setSelectedCompany] = useState(COMPANIES[0]);
  const setAuth = useAuthStore((s) => s.setAuth);

  const { mutate: login, isPending } = useMutation({
    mutationFn: () => adminLogin(mobile, password),
    onSuccess: (data) => {
      setAuth(data.token, selectedCompany.id, selectedCompany.name);
      router.replace('/(tabs)/');
    },
    onError: () => Alert.alert('Login failed', 'Check mobile number and password'),
  });

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <HexBg />
      <View style={styles.inner}>
        <Text style={styles.brandName}>Vansh Iron</Text>
        <Text style={styles.sub}>Command Centre</Text>

        <View style={styles.companyRow}>
          {COMPANIES.map((co) => (
            <TouchableOpacity
              key={co.id}
              style={[
                styles.coBadge,
                selectedCompany.id === co.id && styles.coBadgeActive,
              ]}
              onPress={() => setSelectedCompany(co)}
            >
              <Text
                style={[
                  styles.coBadgeText,
                  selectedCompany.id === co.id && styles.coBadgeTextActive,
                ]}
              >
                {co.name === 'Vansh Iron' ? 'VI' : 'AS'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.selectedCo}>{selectedCompany.name}</Text>

        <TextInput
          style={styles.input}
          placeholder="Mobile number"
          placeholderTextColor={colors.txt3}
          keyboardType="phone-pad"
          value={mobile}
          onChangeText={setMobile}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.txt3}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity
          style={styles.btn}
          onPress={() => login()}
          disabled={isPending}
        >
          <Text style={styles.btnText}>{isPending ? 'Signing in…' : 'Enter'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen:            { flex: 1, backgroundColor: colors.bg },
  inner:             { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  brandName:         { fontFamily: fonts.cormorantItalic, fontSize: 40, color: colors.viGold, letterSpacing: 1, textAlign: 'center', marginBottom: 4 },
  sub:               { fontFamily: fonts.dmSans, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: colors.txt3, textAlign: 'center', marginBottom: 32 },
  companyRow:        { flexDirection: 'row', gap: 10, justifyContent: 'center', marginBottom: 8 },
  coBadge:           { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.bdr2, backgroundColor: colors.surf2 },
  coBadgeActive:     { borderColor: `${colors.viGold}55`, backgroundColor: `${colors.viGold}15` },
  coBadgeText:       { fontFamily: fonts.cormorantItalic, fontSize: 16, color: colors.txt3 },
  coBadgeTextActive: { color: colors.viGold },
  selectedCo:        { fontFamily: fonts.dmSans, fontSize: 10, color: colors.txt3, letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center', marginBottom: 28 },
  input:             { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.dmSans, fontSize: 14, color: colors.txt, marginBottom: 12 },
  btn:               { backgroundColor: colors.viGold, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText:           { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.bg, letterSpacing: 1 },
});
