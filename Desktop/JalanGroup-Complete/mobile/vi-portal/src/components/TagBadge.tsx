import React from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { colors, fonts } from '../theme';

export type TagVariant = 'pending' | 'done' | 'overdue' | 'gold';

const variantMap: Record<TagVariant, { bg: string; border: string; text: string }> = {
  pending: { bg: 'rgba(232,168,48,0.10)',  border: 'rgba(232,168,48,0.25)', text: colors.amber },
  done:    { bg: 'rgba(93,200,122,0.10)',  border: 'rgba(93,200,122,0.25)', text: colors.ok   },
  overdue: { bg: 'rgba(240,112,112,0.10)', border: 'rgba(240,112,112,0.25)',text: colors.red  },
  gold:    { bg: 'rgba(201,164,74,0.12)',  border: 'rgba(201,164,74,0.30)', text: colors.viGold },
};

interface Props {
  label: string;
  variant: TagVariant;
}

export function TagBadge({ label, variant }: Props) {
  const v = variantMap[variant];
  return (
    <View style={[styles.base, { backgroundColor: v.bg, borderColor: v.border }]}>
      <Text style={[styles.text, { color: v.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7, borderWidth: 1 },
  text: { fontFamily: fonts.dmSansBold, fontSize: 9, letterSpacing: 0.3 },
});
