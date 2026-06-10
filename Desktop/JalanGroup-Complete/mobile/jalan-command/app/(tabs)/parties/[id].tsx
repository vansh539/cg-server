import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getPartyLedger } from '../../../src/api';
import { colors, fonts } from '../../../src/theme';
import { ScreenWrapper } from '../../../src/components/ScreenWrapper';

const PERIODS = ['3M', '6M', 'FY2526', 'FY2425', 'ALL'] as const;
type Period = typeof PERIODS[number];

export default function PartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [period, setPeriod] = useState<Period>('3M');
  const { data } = useQuery({
    queryKey: ['ledger', id, period],
    queryFn: () => getPartyLedger(id!, period),
  });

  return (
    <ScreenWrapper>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{data?.party?.name ?? '…'}</Text>
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
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  back:        { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 },
  backText:    { fontFamily: fonts.dmSans, fontSize: 13, color: colors.txt2 },
  title:       { fontFamily: fonts.cormorantItalic, fontSize: 26, color: colors.viGold, paddingHorizontal: 18 },
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
});
