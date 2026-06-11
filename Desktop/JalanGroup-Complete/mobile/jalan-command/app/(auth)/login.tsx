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
  Modal,
  FlatList,
} from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { adminLogin } from '../../src/api';
import { useAuthStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { HexBg } from '../../src/components/HexBg';

export default function LoginScreen() {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [companies, setCompanies] = useState<any[]>([]);
  const [token, setToken] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);

  const { mutate: login, isPending } = useMutation({
    mutationFn: () => adminLogin(mobile, password),
    onSuccess: (data) => {
      if (!data.companies?.length) {
        Alert.alert('Error', 'No companies found for this account');
        return;
      }
      if (data.companies.length === 1) {
        const co = data.companies[0];
        setAuth(data.token, co.id, co.name);
        router.replace('/(tabs)/');
      } else {
        setToken(data.token);
        setCompanies(data.companies);
        setShowPicker(true);
      }
    },
    onError: () => Alert.alert('Login failed', 'Check mobile number and password'),
  });

  const selectCompany = (co: any) => {
    setAuth(token, co.id, co.name);
    setShowPicker(false);
    router.replace('/(tabs)/');
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <HexBg />
      <View style={styles.inner}>
        <Text style={styles.brandName}>Vansh Iron</Text>
        <Text style={styles.sub}>Command Centre</Text>

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

      <Modal visible={showPicker} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Select Company</Text>
          <FlatList
            data={companies}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.coRow} onPress={() => selectCompany(item)}>
                <Text style={styles.coName}>{item.name}</Text>
                <Text style={styles.coCode}>{item.code}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen:     { flex: 1, backgroundColor: colors.bg },
  inner:      { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  brandName:  { fontFamily: fonts.cormorantItalic, fontSize: 40, color: colors.viGold, letterSpacing: 1, textAlign: 'center', marginBottom: 4 },
  sub:        { fontFamily: fonts.dmSans, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: colors.txt3, textAlign: 'center', marginBottom: 44 },
  input:      { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.dmSans, fontSize: 14, color: colors.txt, marginBottom: 12 },
  btn:        { backgroundColor: colors.viGold, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText:    { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.bg, letterSpacing: 1 },
  modal:      { flex: 1, backgroundColor: colors.bg, padding: 28 },
  modalTitle: { fontFamily: fonts.cormorantItalic, fontSize: 32, color: colors.viGold, marginBottom: 24 },
  coRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  coName:     { fontFamily: fonts.dmSansBold, fontSize: 15, color: colors.txt },
  coCode:     { fontFamily: fonts.cormorantItalic, fontSize: 14, color: colors.txt3 },
});
