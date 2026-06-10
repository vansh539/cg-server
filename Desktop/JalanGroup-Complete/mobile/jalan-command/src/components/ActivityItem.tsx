import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts } from '../theme';
import { TagBadge, TagVariant } from './TagBadge';

interface Props {
  icon: string;
  name: string;
  sub: string;
  tag: string;
  tagVariant: TagVariant;
}

export function ActivityItem({ icon, name, sub, tag, tagVariant }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <TagBadge label={tag} variant={tagVariant} />
    </View>
  );
}

const styles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  iconWrap: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.surf3, borderWidth: 1, borderColor: colors.bdr, alignItems: 'center', justifyContent: 'center' },
  icon:     { fontSize: 15 },
  info:     { flex: 1 },
  name:     { fontFamily: fonts.dmSansBold, fontSize: 11, color: colors.txt },
  sub:      { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 2 },
});
