import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRates, updateRate } from '../../src/api';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';

export default function RatesScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['rates'], queryFn: getRates });
  const [editing, setEditing] = useState<string | null>(null);
  const [draftPrice, setDraftPrice] = useState('');

  const { mutate: saveRate } = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) => updateRate(id, price),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rates'] });
      setEditing(null);
    },
    onError: () => Alert.alert('Failed', 'Could not save price'),
  });

  return (
    <ScreenWrapper>
      <Text style={styles.title}>Live Rates</Text>
      <Text style={styles.sub}>Tap a rate to edit · Changes go live instantly</Text>
      <FlatList
        data={data?.rates ?? []}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32 }}
        renderItem={({ item }: { item: any }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.unit}>per {item.unit}</Text>
            </View>
            {editing === item.id ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput
                  style={styles.input}
                  value={draftPrice}
                  onChangeText={setDraftPrice}
                  keyboardType="numeric"
                  autoFocus
                />
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={() =>
                    saveRate({ id: item.id, price: parseFloat(draftPrice) })
                  }
                >
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  setEditing(item.id);
                  setDraftPrice(String(item.price));
                }}
              >
                <Text style={styles.price}>
                  ₹{Number(item.price).toLocaleString('en-IN')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:       { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  sub:         { fontFamily: fonts.dmSans, fontSize: 10, color: colors.txt3, paddingHorizontal: 18, marginBottom: 16 },
  row:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  name:        { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.txt },
  unit:        { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 2 },
  price:       { fontFamily: fonts.cormorantItalic, fontSize: 18, color: colors.viGold },
  input:       { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontFamily: fonts.dmSans, fontSize: 14, color: colors.txt, minWidth: 100 },
  saveBtn:     { backgroundColor: colors.viGold, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  saveBtnText: { fontFamily: fonts.dmSansBold, fontSize: 12, color: colors.bg },
});
