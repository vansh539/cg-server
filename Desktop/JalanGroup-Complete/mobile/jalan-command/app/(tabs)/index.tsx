import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { getDashboard, sendReminders } from '../../src/api';
import { useAuthStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';
import { GoldShimmerText } from '../../src/components/GoldShimmerText';
import { HexBg } from '../../src/components/HexBg';
import { ActivityItem } from '../../src/components/ActivityItem';

export default function DashboardScreen() {
  const companyName = useAuthStore((s) => s.companyName);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
  });
  const { mutate: remind } = useMutation({
    mutationFn: sendReminders,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  });

  const glowAnim = useSharedValue(0.2);
  useEffect(() => {
    glowAnim.value = withRepeat(
      withSequence(
        withTiming(0.6, { duration: 2000 }),
        withTiming(0.2, { duration: 2000 })
      ),
      -1,
      false
    );
  }, []);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glowAnim.value }));

  const fmt = (n: number) =>
    n >= 100000
      ? `₹${(n / 100000).toFixed(1)}L`
      : `₹${(n ?? 0).toLocaleString('en-IN')}`;

  return (
    <ScreenWrapper scroll>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Animated.Text style={[styles.brandName, glowStyle]}>
            {companyName ?? 'Vansh Iron'}
          </Animated.Text>
          <Text style={styles.brandSub}>Command Centre</Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>V</Text>
        </View>
      </View>

      {/* Hero card */}
      <View style={styles.heroCard}>
        <HexBg />
        <Text style={styles.cardLbl}>Total Outstanding</Text>
        <GoldShimmerText style={styles.heroAmount}>
          {isLoading ? '₹—' : fmt(data?.total_outstanding ?? 0)}
        </GoldShimmerText>
        <View style={styles.divider} />
        <View style={styles.statsRow}>
          <View>
            <Text style={[styles.statVal, { color: colors.red }]}>
              {fmt(data?.overdue ?? 0)}
            </Text>
            <Text style={styles.statLbl}>Overdue</Text>
          </View>
          <View>
            <Text style={[styles.statVal, { color: colors.amber }]}>
              {fmt(data?.due_soon ?? 0)}
            </Text>
            <Text style={styles.statLbl}>Due Soon</Text>
          </View>
          <View>
            <Text style={[styles.statVal, { color: colors.ok }]}>
              {fmt(data?.collected_this_month ?? 0)}
            </Text>
            <Text style={styles.statLbl}>Collected</Text>
          </View>
        </View>
      </View>

      {/* Quick actions */}
      <View style={styles.qaGrid}>
        {[
          { icon: '📣', label: 'Remind All', onPress: () => remind() },
          { icon: '💰', label: 'Live Rates',  onPress: () => router.push('/(tabs)/rates') },
          { icon: '💬', label: 'WA Bot',      onPress: () => router.push('/(tabs)/bot') },
          { icon: '📦', label: 'Orders',      onPress: () => router.push('/(tabs)/orders/') },
        ].map((a) => (
          <TouchableOpacity key={a.label} style={styles.qaBtn} onPress={a.onPress}>
            <Text style={styles.qaIcon}>{a.icon}</Text>
            <Text style={styles.qaLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent activity */}
      <Text style={styles.secLabel}>RECENT ACTIVITY</Text>
      <View style={styles.actList}>
        {(data?.recent_activity ?? []).slice(0, 5).map((item: any, i: number) => (
          <ActivityItem
            key={i}
            icon={
              item.type === 'payment' ? '💸' : item.type === 'order' ? '📦' : '💬'
            }
            name={item.party_name ?? item.description ?? '—'}
            sub={item.sub ?? ''}
            tag={item.status ?? 'Info'}
            tagVariant={
              item.status === 'overdue'
                ? 'overdue'
                : item.status === 'done'
                ? 'done'
                : 'pending'
            }
          />
        ))}
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10 },
  brandName:  { fontFamily: fonts.cormorantItalic, fontSize: 24, color: colors.viGold, letterSpacing: 1 },
  brandSub:   { fontFamily: fonts.dmSans, fontSize: 7.5, letterSpacing: 2.5, textTransform: 'uppercase', color: colors.txt3, marginTop: 2 },
  avatar:     { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.viGreenMd, borderWidth: 1.5, borderColor: `${colors.viGold}50`, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.cormorantItalic, fontSize: 16, color: colors.viGold },
  heroCard:   { marginHorizontal: 14, marginBottom: 14, backgroundColor: colors.surf3, borderWidth: 1, borderColor: `${colors.viGold}30`, borderRadius: 24, padding: 18, overflow: 'hidden' },
  cardLbl:    { fontFamily: fonts.dmSansBold, fontSize: 8, letterSpacing: 2.5, textTransform: 'uppercase', color: `${colors.viGold}80`, marginBottom: 4 },
  heroAmount: { fontSize: 36, marginBottom: 6 },
  divider:    { height: 1, backgroundColor: `${colors.viGold}30`, marginVertical: 12 },
  statsRow:   { flexDirection: 'row', justifyContent: 'space-between' },
  statVal:    { fontFamily: fonts.cormorantItalic, fontSize: 19, letterSpacing: -0.5 },
  statLbl:    { fontFamily: fonts.dmSansBold, fontSize: 7, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.txt3, marginTop: 2 },
  qaGrid:     { flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginBottom: 14 },
  qaBtn:      { flex: 1, backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 18, paddingVertical: 13, alignItems: 'center', gap: 6 },
  qaIcon:     { fontSize: 20 },
  qaLabel:    { fontFamily: fonts.dmSansBold, fontSize: 8, color: colors.txt2, textAlign: 'center' },
  secLabel:   { fontFamily: fonts.dmSansBold, fontSize: 8, letterSpacing: 2.5, color: colors.txt3, paddingHorizontal: 18, marginBottom: 8 },
  actList:    { paddingHorizontal: 14 },
});
