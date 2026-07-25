import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { getAccount } from '../../src/api';
import { useClientStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';
import { GoldShimmerText } from '../../src/components/GoldShimmerText';
import { HexBg } from '../../src/components/HexBg';

export default function HomeScreen() {
  const { partyName, companyName } = useClientStore();
  const { data } = useQuery({
    queryKey: ['account'],
    queryFn: getAccount,
    refetchInterval: 60000,
  });

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if ((data?.overdue ?? 0) > 0) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.03, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      pulseAnim.setValue(1);
    }
    return () => loopRef.current?.stop();
  }, [data?.overdue]);

  const fmt = (n: number) => `₹${(n ?? 0).toLocaleString('en-IN')}`;

  return (
    <ScreenWrapper scroll>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>{companyName ?? 'Vansh Iron'}</Text>
          <Text style={styles.party}>{partyName}</Text>
        </View>
      </View>

      {/* Balance hero */}
      <View style={styles.balanceCard}>
        <HexBg />
        <Text style={styles.balLbl}>Your Outstanding Balance</Text>
        <GoldShimmerText style={styles.balAmount}>
          {fmt(data?.outstanding ?? 0)}
        </GoldShimmerText>
        {(data?.overdue ?? 0) > 0 && (
          <Animated.View style={[styles.dueBadge, { transform: [{ scale: pulseAnim }] }]}>
            <Text style={styles.dueText}>⚠ {fmt(data!.overdue)} overdue</Text>
          </Animated.View>
        )}
      </View>

      {/* Mini stats */}
      <View style={styles.miniRow}>
        <View style={[styles.miniCard, styles.goldBorder]}>
          <Text style={styles.miniIcon}>📄</Text>
          <Text style={[styles.miniVal, { color: colors.viGold }]}>
            {fmt(data?.this_month ?? 0)}
          </Text>
          <Text style={styles.miniLbl}>This Month</Text>
        </View>
        <View style={[styles.miniCard, styles.okBorder]}>
          <Text style={styles.miniIcon}>✅</Text>
          <Text style={[styles.miniVal, { color: colors.ok }]}>
            {fmt(data?.paid_ytd ?? 0)}
          </Text>
          <Text style={styles.miniLbl}>Paid YTD</Text>
        </View>
      </View>

      {/* Quick actions */}
      <Text style={styles.secLbl}>QUICK ACTIONS</Text>
      <View style={styles.quickLinks}>
        {[
          { icon: '📒', label: 'View Ledger',    onPress: () => router.push('/(tabs)/ledger') },
          { icon: '🏦', label: 'Notify Payment', onPress: () => router.push('/(tabs)/account') },
          { icon: '📦', label: 'Place Order',    onPress: () => router.push('/(tabs)/orders') },
          { icon: '📊', label: "Today's Rates",  onPress: () => router.push('/(tabs)/orders') },
        ].map((a) => (
          <TouchableOpacity key={a.label} style={styles.qlBtn} onPress={a.onPress}>
            <Text style={styles.qlIcon}>{a.icon}</Text>
            <Text style={styles.qlLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent transactions */}
      <Text style={styles.secLbl}>RECENT TRANSACTIONS</Text>
      <View style={styles.txList}>
        {(data?.recent_transactions ?? []).slice(0, 5).map((tx: any, i: number) => (
          <View key={i} style={styles.txRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.txDesc}>{tx.description}</Text>
              <Text style={styles.txDate}>{tx.date}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.txAmt, { color: tx.debit ? colors.red : colors.ok }]}>
                {tx.debit ? '−' : '+'}₹{(tx.debit || tx.credit)?.toLocaleString('en-IN')}
              </Text>
              <Text style={styles.txBal}>Bal ₹{tx.balance?.toLocaleString('en-IN')}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10 },
  brand:       { fontFamily: fonts.cormorantItalic, fontSize: 24, color: colors.viGold, letterSpacing: 1 },
  party:       { fontFamily: fonts.dmSans, fontSize: 10, color: colors.txt3, marginTop: 2, letterSpacing: 1 },
  balanceCard: { marginHorizontal: 14, marginBottom: 12, backgroundColor: colors.surf3, borderWidth: 1, borderColor: `${colors.viGold}30`, borderRadius: 24, padding: 20, alignItems: 'center', overflow: 'hidden' },
  balLbl:      { fontFamily: fonts.dmSansBold, fontSize: 8, letterSpacing: 2.5, textTransform: 'uppercase', color: `${colors.viGold}70`, marginBottom: 8 },
  balAmount:   { fontSize: 42, marginBottom: 10 },
  dueBadge:    { backgroundColor: `${colors.red}15`, borderWidth: 1, borderColor: `${colors.red}35`, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  dueText:     { fontFamily: fonts.dmSansBold, fontSize: 11, color: colors.red },
  miniRow:     { flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginBottom: 14 },
  miniCard:    { flex: 1, backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 20, padding: 14 },
  goldBorder:  { borderColor: `${colors.viGold}35` },
  okBorder:    { borderColor: `${colors.ok}25` },
  miniIcon:    { fontSize: 16, marginBottom: 7 },
  miniVal:     { fontFamily: fonts.cormorantItalic, fontSize: 19 },
  miniLbl:     { fontFamily: fonts.dmSansBold, fontSize: 8, color: colors.txt3, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 3 },
  secLbl:      { fontFamily: fonts.dmSansBold, fontSize: 8, letterSpacing: 2.5, color: colors.txt3, paddingHorizontal: 18, marginBottom: 8, marginTop: 4 },
  quickLinks:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, marginBottom: 14 },
  qlBtn:       { width: '47%', backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 18, paddingVertical: 14, alignItems: 'center', gap: 6 },
  qlIcon:      { fontSize: 22 },
  qlLabel:     { fontFamily: fonts.dmSansBold, fontSize: 9, color: colors.txt2 },
  txList:      { paddingHorizontal: 14 },
  txRow:       { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  txDesc:      { fontFamily: fonts.dmSansBold, fontSize: 11, color: colors.txt },
  txDate:      { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 1 },
  txAmt:       { fontFamily: fonts.cormorantItalic, fontSize: 14 },
  txBal:       { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3 },
});
