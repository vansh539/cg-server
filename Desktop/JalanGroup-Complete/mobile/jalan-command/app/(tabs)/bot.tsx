import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBotStatus, restartBot, getBotLogs, getMessages } from '../../src/api';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';

export default function BotScreen() {
  const qc = useQueryClient();
  const logsRef = useRef<ScrollView>(null);

  const { data: status } = useQuery({
    queryKey: ['bot-status'],
    queryFn: getBotStatus,
    refetchInterval: 10000,
  });

  const { data: logsData } = useQuery({
    queryKey: ['bot-logs'],
    queryFn: getBotLogs,
    refetchInterval: 15000,
  });

  const { data: messagesData } = useQuery({
    queryKey: ['wa-messages'],
    queryFn: getMessages,
    refetchInterval: 10000,
  });

  const { mutate: restart, isPending } = useMutation({
    mutationFn: restartBot,
    onSuccess: () => {
      Alert.alert('Restarting', 'Bot is restarting. Takes ~30 seconds.');
      setTimeout(() => qc.invalidateQueries({ queryKey: ['bot-status'] }), 35000);
    },
    onError: () => Alert.alert('Failed', 'Could not restart bot'),
  });

  const online = status?.online ?? false;

  return (
    <ScreenWrapper scroll>
      <Text style={styles.title}>WA Bot</Text>

      <View style={[styles.statusCard, { borderColor: online ? `${colors.ok}40` : `${colors.red}40` }]}>
        <View style={[styles.dot, { backgroundColor: online ? colors.ok : colors.red }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusText, { color: online ? colors.ok : colors.red }]}>
            {online ? 'Online' : 'Offline'}
          </Text>
          {online && status?.uptime ? (
            <Text style={styles.uptime}>Up {Math.round(status.uptime / 60)} min</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={[styles.restartBtn, isPending && { opacity: 0.5 }]}
          onPress={() => restart()}
          disabled={isPending}
        >
          <Text style={styles.restartText}>{isPending ? '…' : '↺ Restart'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLbl}>RECENT MESSAGES</Text>
      <View style={styles.messageList}>
        {(messagesData?.messages ?? []).slice(0, 8).map((m: any, i: number) => (
          <View key={i} style={styles.msgRow}>
            <Text style={styles.msgFrom}>{m.from_name ?? m.from}</Text>
            <Text style={styles.msgText} numberOfLines={1}>{m.body}</Text>
            <Text style={styles.msgTime}>{m.time_ago}</Text>
          </View>
        ))}
        {!(messagesData?.messages?.length) && (
          <Text style={styles.empty}>No recent messages</Text>
        )}
      </View>

      <Text style={styles.sectionLbl}>LAST 100 LOG LINES</Text>
      <ScrollView
        ref={logsRef}
        style={styles.logBox}
        onContentSizeChange={() => logsRef.current?.scrollToEnd({ animated: false })}
      >
        {(logsData?.lines ?? []).map((line: string, i: number) => (
          <Text key={i} style={styles.logLine}>{line}</Text>
        ))}
        {!(logsData?.lines?.length) && (
          <Text style={styles.logLine}>No logs available</Text>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:       { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14 },
  statusCard:  { marginHorizontal: 14, marginBottom: 14, backgroundColor: colors.surf2, borderWidth: 1, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot:         { width: 10, height: 10, borderRadius: 5 },
  statusText:  { fontFamily: fonts.dmSansBold, fontSize: 14 },
  uptime:      { fontFamily: fonts.dmSans, fontSize: 11, color: colors.txt3, marginTop: 2 },
  restartBtn:  { backgroundColor: colors.surf3, borderWidth: 1, borderColor: colors.bdr2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  restartText: { fontFamily: fonts.dmSansBold, fontSize: 11, color: colors.txt2 },
  sectionLbl:  { fontFamily: fonts.dmSansBold, fontSize: 8, letterSpacing: 2.5, color: colors.txt3, paddingHorizontal: 18, marginBottom: 8, marginTop: 4 },
  messageList: { paddingHorizontal: 14, marginBottom: 14 },
  msgRow:      { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  msgFrom:     { fontFamily: fonts.dmSansBold, fontSize: 11, color: colors.txt },
  msgText:     { fontFamily: fonts.dmSans, fontSize: 11, color: colors.txt2, marginTop: 1 },
  msgTime:     { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 1 },
  logBox:      { marginHorizontal: 14, backgroundColor: colors.surf2, borderRadius: 12, padding: 12, maxHeight: 300 },
  logLine:     { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, lineHeight: 16 },
  empty:       { fontFamily: fonts.dmSans, fontSize: 12, color: colors.txt3, padding: 12 },
});
