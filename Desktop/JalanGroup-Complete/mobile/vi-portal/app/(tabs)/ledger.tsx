import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getLedger } from '../../src/api';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';

const PERIODS = [
  { label: '3M',      from: () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10); } },
  { label: '6M',      from: () => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); } },
  { label: 'FY25-26', from: () => '2025-04-01', to: undefined as string | undefined },
  { label: 'FY24-25', from: () => '2024-04-01', to: '2025-03-31' },
  { label: 'All',     from: () => '2020-01-01' },
] as const;

export default function LedgerScreen() {
  const [periodIdx, setPeriodIdx] = useState(0);
  const period = PERIODS[periodIdx];

  const { data, isLoading } = useQuery({
    queryKey: ['ledger', periodIdx],
    queryFn: () =>
      getLedger({
        from: period.from(),
        to: 'to' in period ? period.to : undefined,
      }),
  });

  return (
    <ScreenWrapper>
      <Text style={styles.title}>Ledger</Text>
      <View style={styles.periodRow}>
        {PERIODS.map((p, i) => (
          <TouchableOpacity
            key={p.label}
            style={[styles.pBtn, periodIdx === i && styles.pActive]}
            onPress={() => setPeriodIdx(i)}
          >
            <Text style={[styles.pText, periodIdx === i && { color: colors.viGold }]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.viGold} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={data?.entries ?? []}
          keyExtractor={(_: any, i: number) => String(i)}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32 }}
          renderItem={({ item }: { item: any }) => (
            <View style={styles.row}>
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
      )}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:     { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10 },
  periodRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, marginBottom: 14, flexWrap: 'wrap' },
  pBtn:      { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.bdr },
  pActive:   { borderColor: `${colors.viGold}50`, backgroundColor: `${colors.viGold}12` },
  pText:     { fontFamily: fonts.dmSans, fontSize: 11, color: colors.txt3 },
  row:       { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  desc:      { fontFamily: fonts.dmSansBold, fontSize: 11, color: colors.txt },
  date:      { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 1 },
  amount:    { fontFamily: fonts.cormorantItalic, fontSize: 15 },
  bal:       { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3 },
});
