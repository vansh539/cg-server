import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { sendPaymentNotification, BASE } from '../../src/api';
import { useClientStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';

export default function AccountScreen() {
  const { partyName, companyName, token, clearAuth } = useClientStore();
  const [amount, setAmount] = useState('');
  const [upiRef, setUpiRef] = useState('');
  const [note, setNote] = useState('');
  const [stmtFrom, setStmtFrom] = useState('2025-04-01');
  const [stmtTo, setStmtTo] = useState(new Date().toISOString().slice(0, 10));

  const { mutate: notify, isPending: notifyPending } = useMutation({
    mutationFn: () =>
      sendPaymentNotification({ amount: parseFloat(amount), upi_ref: upiRef, note }),
    onSuccess: () => {
      Alert.alert('Sent!', 'Jalan Group has been notified.');
      setAmount('');
      setUpiRef('');
      setNote('');
    },
    onError: () => Alert.alert('Failed', 'Could not send notification'),
  });

  const downloadStmt = async () => {
    try {
      const url = `${BASE}/portal/statement/download?from=${stmtFrom}&to=${stmtTo}`;
      const path = `${FileSystem.documentDirectory}statement_${stmtFrom}_${stmtTo}.pdf`;
      const { uri } = await FileSystem.downloadAsync(url, path, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch {
      Alert.alert('Failed', 'Could not download statement');
    }
  };

  return (
    <ScreenWrapper scroll>
      <Text style={styles.title}>Account</Text>

      <View style={styles.card}>
        <Text style={styles.lbl}>Party</Text>
        <Text style={styles.val}>{partyName}</Text>
        <Text style={[styles.lbl, { marginTop: 8 }]}>Company</Text>
        <Text style={styles.val}>{companyName}</Text>
      </View>

      {/* Payment notification */}
      <Text style={styles.sectionTitle}>Notify a Payment</Text>
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Amount (₹)"
          placeholderTextColor={colors.txt3}
          keyboardType="numeric"
          value={amount}
          onChangeText={setAmount}
        />
        <TextInput
          style={styles.input}
          placeholder="UPI Reference / Transaction ID"
          placeholderTextColor={colors.txt3}
          value={upiRef}
          onChangeText={setUpiRef}
        />
        <TextInput
          style={styles.input}
          placeholder="Note (optional)"
          placeholderTextColor={colors.txt3}
          value={note}
          onChangeText={setNote}
        />
        <TouchableOpacity
          style={[styles.btn, (!amount || !upiRef) && { opacity: 0.5 }]}
          onPress={() => notify()}
          disabled={notifyPending || !amount || !upiRef}
        >
          <Text style={styles.btnText}>{notifyPending ? '…' : 'Send Notification'}</Text>
        </TouchableOpacity>
      </View>

      {/* Statement download */}
      <Text style={styles.sectionTitle}>Download Statement</Text>
      <View style={styles.form}>
        <Text style={styles.lbl}>From</Text>
        <TextInput
          style={styles.input}
          value={stmtFrom}
          onChangeText={setStmtFrom}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.txt3}
        />
        <Text style={styles.lbl}>To</Text>
        <TextInput
          style={styles.input}
          value={stmtTo}
          onChangeText={setStmtTo}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.txt3}
        />
        <TouchableOpacity
          style={[styles.btn, styles.outlineBtn]}
          onPress={downloadStmt}
        >
          <Text style={[styles.btnText, { color: colors.viGold }]}>Download PDF</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={() => {
          clearAuth();
          router.replace('/(auth)/login');
        }}
      >
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:        { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14 },
  card:         { marginHorizontal: 14, backgroundColor: colors.surf2, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.bdr },
  lbl:          { fontFamily: fonts.dmSansBold, fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', color: colors.txt3, marginBottom: 2 },
  val:          { fontFamily: fonts.dmSansBold, fontSize: 15, color: colors.txt },
  sectionTitle: { fontFamily: fonts.cormorantItalic, fontSize: 20, color: colors.txt, paddingHorizontal: 18, marginBottom: 10, marginTop: 4 },
  form:         { marginHorizontal: 14, marginBottom: 16 },
  input:        { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontFamily: fonts.dmSans, fontSize: 13, color: colors.txt, marginBottom: 10 },
  btn:          { backgroundColor: colors.viGold, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  outlineBtn:   { backgroundColor: colors.surf3, borderWidth: 1, borderColor: `${colors.viGold}40` },
  btnText:      { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.bg },
  logoutBtn:    { marginHorizontal: 14, marginTop: 8, marginBottom: 32, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: `${colors.red}35`, backgroundColor: `${colors.red}08`, alignItems: 'center' },
  logoutText:   { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.red },
});
