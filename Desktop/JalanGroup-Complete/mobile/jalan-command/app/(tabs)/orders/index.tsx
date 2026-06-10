import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getOrders } from '../../../src/api';
import { colors, fonts } from '../../../src/theme';
import { ScreenWrapper } from '../../../src/components/ScreenWrapper';
import { TagBadge } from '../../../src/components/TagBadge';

export default function OrdersScreen() {
  const { data } = useQuery({ queryKey: ['orders'], queryFn: getOrders });

  return (
    <ScreenWrapper>
      <Text style={styles.title}>Orders</Text>
      <FlatList
        data={data?.orders ?? []}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32 }}
        renderItem={({ item }: { item: any }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.orderNo}>
                Order #{item.order_number ?? item.id.slice(0, 8)}
              </Text>
              <Text style={styles.sub}>
                {item.party_name} · {item.product_name}
              </Text>
              <Text style={styles.date}>{item.created_at?.slice(0, 10)}</Text>
            </View>
            <TagBadge
              label={item.status}
              variant={
                item.status === 'dispatched'
                  ? 'done'
                  : item.status === 'pending'
                  ? 'pending'
                  : 'gold'
              }
            />
          </View>
        )}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:   { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10 },
  row:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  orderNo: { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.txt },
  sub:     { fontFamily: fonts.dmSans, fontSize: 11, color: colors.txt2, marginTop: 2 },
  date:    { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 2 },
});
