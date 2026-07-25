import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, Modal, Share } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../src/store';
import { getCompanies } from '../../src/api';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';

export default function SettingsScreen() {
  const { companyName, clearAuth } = useAuthStore();
  const [showTally, setShowTally] = useState(false);
  const [selectedCo, setSelectedCo] = useState<any>(null);

  const { data } = useQuery({ queryKey: ['companies'], queryFn: getCompanies });

  const logout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => {
          clearAuth();
          router.replace('/login');
        },
      },
    ]);
  };

  const showConfig = (co: any) => {
    setSelectedCo(co);
    setShowTally(true);
  };

  const configJson = selectedCo ? JSON.stringify({
    server_url: 'https://api.vanshiron.com',
    api_key: selectedCo.agent_key,
    company_code: selectedCo.code,
    tally_company: selectedCo.tally_company_name ?? selectedCo.name,
    tally_port: 9000,
    sync_interval_minutes: 15,
  }, null, 2) : '';

  return (
    <ScreenWrapper scroll>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.lbl}>Active Company</Text>
        <Text style={styles.val}>{companyName}</Text>
      </View>

      {/* Tally Sync Setup */}
      <Text style={styles.sectionTitle}>Tally Sync Setup</Text>
      <Text style={styles.hint}>
        Tap a company below to get the config file for the Tally laptop.
        Copy it into config.json on the Tally machine, then run install.bat.
      </Text>
      {(data?.companies ?? []).map((co: any) => (
        <TouchableOpacity key={co.id} style={styles.coRow} onPress={() => showConfig(co)}>
          <View>
            <Text style={styles.coName}>{co.name}</Text>
            <Text style={styles.coCode}>{co.code}</Text>
          </View>
          <Text style={styles.viewConfig}>View Config →</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      <Modal visible={showTally} animationType="slide" presentationStyle="pageSheet">
        <ScrollView style={styles.modal} contentContainerStyle={{ padding: 24 }}>
          <Text style={styles.modalTitle}>{selectedCo?.name} — Tally Config</Text>
          <Text style={styles.modalStep}>
            1. On the Tally laptop, find the folder:{'\n'}
            <Text style={styles.code}>tally-agent-laptop\</Text>
          </Text>
          <Text style={styles.modalStep}>
            2. Create a file named <Text style={styles.code}>config.json</Text> and paste this:
          </Text>
          <View style={styles.configBox}>
            <Text style={styles.configText} selectable>{configJson}</Text>
          </View>
          <TouchableOpacity
            style={styles.copyBtn}
            onPress={() => Share.share({ message: configJson })}
          >
            <Text style={styles.copyBtnText}>Copy Config</Text>
          </TouchableOpacity>
          <Text style={styles.modalStep}>
            3. Open Command Prompt in that folder and run:{'\n'}
            <Text style={styles.code}>install.bat</Text>
          </Text>
          <Text style={styles.modalStep}>
            4. Data will start syncing every 15 minutes automatically.
          </Text>
          <TouchableOpacity style={styles.doneBtn} onPress={() => setShowTally(false)}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:        { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14 },
  card:         { marginHorizontal: 14, backgroundColor: colors.surf2, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.bdr },
  lbl:          { fontFamily: fonts.dmSansBold, fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', color: colors.txt3, marginBottom: 4 },
  val:          { fontFamily: fonts.dmSansBold, fontSize: 15, color: colors.txt },
  sectionTitle: { fontFamily: fonts.cormorantItalic, fontSize: 20, color: colors.txt, paddingHorizontal: 18, marginBottom: 6 },
  hint:         { fontFamily: fonts.dmSans, fontSize: 11, color: colors.txt3, paddingHorizontal: 18, marginBottom: 14, lineHeight: 17 },
  coRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  coName:       { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.txt },
  coCode:       { fontFamily: fonts.dmSans, fontSize: 10, color: colors.txt3, marginTop: 2 },
  viewConfig:   { fontFamily: fonts.dmSansBold, fontSize: 11, color: colors.viGold },
  logoutBtn:    { marginHorizontal: 14, marginTop: 24, marginBottom: 32, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: `${colors.red}40`, backgroundColor: `${colors.red}10`, alignItems: 'center' },
  logoutText:   { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.red },
  modal:        { flex: 1, backgroundColor: colors.bg },
  modalTitle:   { fontFamily: fonts.cormorantItalic, fontSize: 26, color: colors.viGold, marginBottom: 20 },
  modalStep:    { fontFamily: fonts.dmSans, fontSize: 12, color: colors.txt2, marginBottom: 14, lineHeight: 20 },
  code:         { fontFamily: 'Courier', fontSize: 12, color: colors.viGold },
  configBox:    { backgroundColor: colors.surf2, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.bdr },
  configText:   { fontFamily: 'Courier', fontSize: 10, color: colors.txt2, lineHeight: 18 },
  copyBtn:      { backgroundColor: `${colors.viGold}20`, borderWidth: 1, borderColor: `${colors.viGold}50`, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  copyBtnText:  { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.viGold },
  doneBtn:      { backgroundColor: colors.viGold, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8, marginBottom: 32 },
  doneBtnText:  { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.bg },
});
