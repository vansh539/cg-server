import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, Alert, Modal } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPartyLedger, updatePartyContact } from '../../../src/api';
import { colors, fonts } from '../../../src/theme';
import { ScreenWrapper } from '../../../src/components/ScreenWrapper';

const PERIODS = ['3M', '6M', 'FY2526', 'FY2425', 'ALL'] as const;
type Period = typeof PERIODS[number];

export default function PartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [period, setPeriod] = useState<Period>('3M');
  const [showPhone, setShowPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['ledger', id, period],
    queryFn: () => getPartyLedger(id!, period),
  });

  const { mutate: savePhone } = useMutation({
    mutationFn: () => updatePartyContact(id!, { mobile: phoneDraft }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parties'] });
      setShowPhone(false);
      Alert.alert('Saved', `Mobile set to ${phoneDraft}. Portal login: ${phoneDraft} / ${phoneDraft}`);
    },
    onError: () => Alert.alert('Failed', 'Could not save'),
  });

  return (
    <ScreenWrapper>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, justifyContent: 'space-between' }}>
        <Text style={styles.title}>{data?.party?.name ?? '…'}</Text>
        <TouchableOpacity
          style={styles.phoneBtn}
          onPress={() => { setPhoneDraft(data?.party?.mobile ?? ''); setShowPhone(true); }}
        >
          <Text style={styles.phoneBtnText}>{data?.party?.mobile ? '✏ Phone' : '+ Phone'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.outstanding}>
        Outstanding:{' '}
        <Text style={{ color: colors.red }}>
          ₹{(data?.outstanding ?? 0).toLocaleString('en-IN')}
        </Text>
      </Text>

      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, period === p && styles.periodActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.periodText, period === p && { color: colors.viGold }]}>
              {p}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={data?.entries ?? []}
        keyExtractor={(_: any, i: number) => String(i)}
        contentContainerStyle={{ paddingHorizontal: 14 }}
        renderItem={({ item }: { item: any }) => (
          <View style={styles.ledgerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.desc}>{item.description}</Text>
              <Text style={styles.date}>{item.date}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.amount, { color: item.debit ? colors.red : colors.ok }]}>
                {item.debit ? '−' : '+'}₹{(item.debit || item.credit)?.toLocaleString('en-IN')}
              </Text>
              <Text style={styles.bal}>Bal ₹{item.balance?.toLocaleString('en-IN')}</Text>
            </View>
          </View>
        )}
      />
      <Modal visible={showPhone} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Set Portal Phone</Text>
          <Text style={styles.modalSub}>This number becomes the login for the customer portal.</Text>
          <TextInput
            style={styles.phoneInput}
            value={phoneDraft}
            onChangeText={setPhoneDraft}
            placeholder="e.g. 9876543210"
            placeholderTextColor={colors.txt3}
            keyboardType="phone-pad"
            autoFocus
          />
          <TouchableOpacity
            style={[styles.savePhoneBtn, !phoneDraft && { opacity: 0.5 }]}
            onPress={() => savePhone()}
            disabled={!phoneDraft}
          >
            <Text style={styles.savePhoneText}>Save & Enable Portal</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ alignItems: 'center', marginTop: 12 }} onPress={() => setShowPhone(false)}>
            <Text style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.txt3 }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  back:        { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 },
  backText:    { fontFamily: fonts.dmSans, fontSize: 13, color: colors.txt2 },
  title:       { fontFamily: fonts.cormorantItalic, fontSize: 26, color: colors.viGold, flex: 1 },
  outstanding: { fontFamily: fonts.dmSansMedium, fontSize: 12, color: colors.txt2, paddingHorizontal: 18, marginBottom: 14 },
  periodRow:   { flexDirection: 'row', gap: 6, paddingHorizontal: 14, marginBottom: 12, flexWrap: 'wrap' },
  periodBtn:   { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.bdr },
  periodActive:{ borderColor: `${colors.viGold}50`, backgroundColor: `${colors.viGold}12` },
  periodText:  { fontFamily: fonts.dmSans, fontSize: 11, color: colors.txt3 },
  ledgerRow:   { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  desc:        { fontFamily: fonts.dmSansBold, fontSize: 11, color: colors.txt },
  date:        { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 1 },
  amount:      { fontFamily: fonts.cormorantItalic, fontSize: 14 },
  bal:         { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3 },
  phoneBtn:    { backgroundColor: `${colors.viGold}15`, borderWidth: 1, borderColor: `${colors.viGold}40`, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  phoneBtnText:{ fontFamily: fonts.dmSansBold, fontSize: 10, color: colors.viGold },
  modal:       { flex: 1, backgroundColor: colors.bg, padding: 28 },
  modalTitle:  { fontFamily: fonts.cormorantItalic, fontSize: 30, color: colors.viGold, marginBottom: 6 },
  modalSub:    { fontFamily: fonts.dmSans, fontSize: 12, color: colors.txt3, marginBottom: 20, lineHeight: 18 },
  phoneInput:  { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.dmSans, fontSize: 16, color: colors.txt, marginBottom: 14, letterSpacing: 1.5 },
  savePhoneBtn:{ backgroundColor: colors.viGold, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  savePhoneText:{ fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.bg },
});
