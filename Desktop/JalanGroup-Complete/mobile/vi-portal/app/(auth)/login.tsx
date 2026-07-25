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
import { clientLogin } from '../../src/api';
import { useClientStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { HexBg } from '../../src/components/HexBg';

export default function ClientLoginScreen() {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const setAuth = useClientStore((s) => s.setAuth);

  const { mutate: login, isPending } = useMutation({
    mutationFn: () => clientLogin(mobile, password),
    onSuccess: (data) => {
      setAuth(
        data.token,
        data.party?.name ?? '',
        data.company?.name ?? 'Vansh Iron'
      );
      router.replace('/');
    },
    onError: () => Alert.alert('Login failed', 'Check your mobile number and password'),
  });

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <HexBg />
      <View style={styles.inner}>
        <Text style={styles.brand}>Vansh Iron</Text>
        <Text style={styles.tagline}>A Legacy That Builds Strength</Text>

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
          <Text style={styles.btnText}>{isPending ? 'Signing in…' : 'Enter Portal'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: colors.bg },
  inner:   { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  brand:   { fontFamily: fonts.cormorantItalic, fontSize: 44, color: colors.viGold, textAlign: 'center', marginBottom: 6 },
  tagline: { fontFamily: fonts.dmSans, fontSize: 10, letterSpacing: 1.5, color: colors.txt3, textAlign: 'center', marginBottom: 44 },
  input:   { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.dmSans, fontSize: 14, color: colors.txt, marginBottom: 12 },
  btn:     { backgroundColor: colors.viGold, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText: { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.bg, letterSpacing: 1 },
});
