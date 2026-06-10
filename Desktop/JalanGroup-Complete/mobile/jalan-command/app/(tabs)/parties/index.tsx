import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { getParties } from '../../../src/api';
import { colors, fonts } from '../../../src/theme';
import { ScreenWrapper } from '../../../src/components/ScreenWrapper';
import { TagBadge } from '../../../src/components/TagBadge';

export default function PartiesScreen() {
  const [search, setSearch] = useState('');
  const { data } = useQuery({ queryKey: ['parties'], queryFn: getParties });

  const parties = (data?.parties ?? []).filter((p: any) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <ScreenWrapper>
      <Text style={styles.title}>Parties</Text>
      <TextInput
        style={styles.search}
        placeholder="Search parties…"
        placeholderTextColor={colors.txt3}
        value={search}
        onChangeText={setSearch}
      />
      <FlatList
        data={parties}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32 }}
        renderItem={({ item }: { item: any }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push(`/(tabs)/parties/${item.id}`)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub}>{item.mobile ?? '—'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={[styles.amount, { color: (item.overdue ?? 0) > 0 ? colors.red : colors.txt }]}>
                ₹{((item.outstanding ?? 0) / 100000).toFixed(1)}L
              </Text>
              {(item.overdue ?? 0) > 0 && <TagBadge label="Overdue" variant="overdue" />}
            </View>
          </TouchableOpacity>
        )}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:  { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10 },
  search: { marginHorizontal: 14, marginBottom: 14, backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, fontFamily: fonts.dmSans, fontSize: 13, color: colors.txt },
  row:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  name:   { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.txt },
  sub:    { fontFamily: fonts.dmSans, fontSize: 10, color: colors.txt3, marginTop: 2 },
  amount: { fontFamily: fonts.cormorantItalic, fontSize: 16 },
});
