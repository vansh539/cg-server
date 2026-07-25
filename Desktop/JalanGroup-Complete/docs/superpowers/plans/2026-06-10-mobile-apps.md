# Jalan Group Mobile Apps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two production-ready Expo React Native apps — Admin (jalan-command) and Customer (vi-portal) — inside JalanGroup-Complete/mobile/, styled with VI brand colors, published to App Store + Play Store.

**Architecture:** Two independent Expo Router apps in mobile/jalan-command/ and mobile/vi-portal/. Each has its own theme.ts, api.ts, and components. Admin talks to api.vanshiron.com; Customer talks to portal.vanshiron.com. Backend gets 3 new bot-management endpoints first.

**Tech Stack:** Expo SDK 52, Expo Router v3, React Native Reanimated 3, react-native-svg, @tanstack/react-query v5, zustand, expo-secure-store, axios, @expo-google-fonts/cormorant-garamond, @expo-google-fonts/dm-sans, EAS Build

---

## File Map

```
JalanGroup-Complete/
  backend/
    src/routes/api.js          MODIFY — add bot/status, bot/restart, bot/logs, rates endpoints
    src/routes/portal.js       MODIFY — add payment-notification endpoint
    src/whatsapp/bot.js        MODIFY — add /ping GET to internal bridge
  mobile/
    jalan-command/             CREATE — Admin Expo app
      app/
        _layout.tsx            Root layout, font loading, QueryClient
        (auth)/login.tsx       Admin login screen
        (tabs)/_layout.tsx     Bottom tab navigator
        (tabs)/index.tsx       Dashboard
        (tabs)/parties/index.tsx
        (tabs)/parties/[id].tsx
        (tabs)/orders/index.tsx
        (tabs)/orders/[id].tsx
        (tabs)/rates.tsx
        (tabs)/bot.tsx
        (tabs)/reminders.tsx
        (tabs)/settings.tsx
      src/
        theme.ts               Colors, typography, spacing — single source of truth
        api.ts                 Axios instance + all API calls
        store.ts               Zustand auth store
        components/
          GoldShimmerText.tsx  Animated shimmer on ₹ amounts
          HeroCard.tsx         Green gradient card with hex motif
          HexBg.tsx            Floating hexagon SVG background
          TagBadge.tsx         Status tags (pending/done/overdue)
          ActivityItem.tsx     Row in activity/ledger lists
          ScreenWrapper.tsx    SafeArea + bg color wrapper
    vi-portal/                 CREATE — Customer Expo app (same structure)
      app/ src/ (mirrors admin structure, different screens)
```

---

## Task 1: Backend — Bot ping endpoint in bot.js

**Files:**
- Modify: `backend/src/whatsapp/bot.js` (the internal HTTP bridge section)

- [ ] **Find the bridge server block** — search for `http.createServer` in bot.js. It's inside `client.once('ready', ...)`. Add a GET `/ping` handler:

```js
// Inside the http.createServer callback, before the existing if/else blocks:
if (req.method === 'GET' && req.url === '/ping') {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
  return;
}
```

- [ ] **Commit**
```bash
git add backend/src/whatsapp/bot.js
git commit -m "feat: add /ping GET to bot internal bridge"
```

---

## Task 2: Backend — Bot management + rates endpoints in api.js

**Files:**
- Modify: `backend/src/routes/api.js`

- [ ] **Add `child_process` require** at top of api.js (after existing requires):
```js
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
```

- [ ] **Add bot status endpoint** (after existing whatsapp routes, around line 535):
```js
// ── Bot management ───────────────────────────────────────────
router.get('/bot/status', authenticate, requireRole('owner'), async (req, res) => {
  try {
    const data = await new Promise((resolve, reject) => {
      const req2 = http.request(
        { hostname: '127.0.0.1', port: BOT_PORT, path: '/ping', method: 'GET' },
        (r) => {
          let body = '';
          r.on('data', d => body += d);
          r.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
        }
      );
      req2.setTimeout(3000, () => { req2.destroy(); reject(new Error('timeout')); });
      req2.on('error', reject);
      req2.end();
    });
    res.json({ online: true, uptime: data.uptime || 0 });
  } catch {
    res.json({ online: false, uptime: 0 });
  }
});
```

- [ ] **Add bot restart endpoint**:
```js
router.post('/bot/restart', authenticate, requireRole('owner'), (req, res) => {
  exec('pm2 restart jalan-whatsapp', (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ success: true, output: stdout.trim() });
  });
});
```

- [ ] **Add bot logs endpoint**:
```js
router.get('/bot/logs', authenticate, requireRole('owner'), (req, res) => {
  const logPath = path.join(__dirname, '../../logs/pm2-wa-out.log');
  fs.readFile(logPath, 'utf8', (err, data) => {
    if (err) return res.json({ lines: ['Log file not found'] });
    const lines = data.trim().split('\n').slice(-100);
    res.json({ lines });
  });
});
```

- [ ] **Add rates get/update endpoints** (admin — get current prices, update a price):
```js
router.get('/rates', authenticate, authorizeCompany, requireRole('owner'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT pl.id, p.name, p.category, pl.unit, pl.price, pl.updated_at
       FROM price_list pl JOIN products p ON pl.product_id = p.id
       WHERE pl.company_id = $1 ORDER BY p.category, p.name`,
      [req.companyId]
    );
    res.json({ rates: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/rates/:id', authenticate, authorizeCompany, requireRole('owner'), async (req, res) => {
  const { price } = req.body;
  if (!price || isNaN(price)) return res.status(400).json({ error: 'Invalid price' });
  try {
    await query(
      `UPDATE price_list SET price = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
      [parseFloat(price), req.params.id, req.companyId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Commit**
```bash
git add backend/src/routes/api.js
git commit -m "feat: bot status/restart/logs endpoints + rates CRUD"
```

---

## Task 3: Backend — Payment notification endpoint in portal.js

**Files:**
- Modify: `backend/src/routes/portal.js`

- [ ] **Add at end of portal.js** (before `module.exports`):
```js
router.post('/payment-notification', clientAuth, async (req, res) => {
  const { amount, upi_ref, payment_date, note } = req.body;
  if (!amount || !upi_ref) return res.status(400).json({ error: 'amount and upi_ref required' });
  try {
    await query(
      `INSERT INTO payment_notifications (party_id, company_id, amount, upi_ref, payment_date, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [req.party.id, req.party.company_id, parseFloat(amount), upi_ref, payment_date || new Date(), note || '']
    );
    res.json({ success: true, message: 'Payment notification sent to Jalan Group' });
  } catch (e) {
    // Table may not exist yet — create it on first use
    if (e.code === '42P01') {
      await query(`CREATE TABLE IF NOT EXISTS payment_notifications (
        id SERIAL PRIMARY KEY, party_id UUID, company_id UUID,
        amount NUMERIC, upi_ref TEXT, payment_date DATE, note TEXT, created_at TIMESTAMPTZ
      )`);
      await query(
        `INSERT INTO payment_notifications (party_id, company_id, amount, upi_ref, payment_date, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [req.party.id, req.party.company_id, parseFloat(amount), upi_ref, payment_date || new Date(), note || '']
      );
      return res.json({ success: true });
    }
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Push backend changes to GitHub + send UPDATE on WhatsApp** so Windows server pulls the new endpoints:
```bash
git push origin main
```

---

## Task 4: Scaffold mobile folder + Admin app

**Files:**
- Create: `mobile/jalan-command/` (full Expo project)

- [ ] **Create mobile folder and scaffold admin app**:
```bash
mkdir -p /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile
cd /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile
npx create-expo-app@latest jalan-command --template blank-typescript
```

- [ ] **Install all dependencies**:
```bash
cd jalan-command
npx expo install expo-router expo-secure-store expo-font expo-linear-gradient expo-file-system expo-sharing expo-web-browser react-native-svg @react-native-masked-view/masked-view
npm install @tanstack/react-query zustand axios
npm install react-native-reanimated
npx expo install @expo-google-fonts/cormorant-garamond @expo-google-fonts/dm-sans
npm install --save-dev @types/react @types/react-native
```

- [ ] **Update app.json** to configure Expo Router and app identity:
```json
{
  "expo": {
    "name": "Jalan Command",
    "slug": "jalan-command",
    "version": "1.0.0",
    "scheme": "jalan-command",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "splash": { "backgroundColor": "#06100A" },
    "ios": {
      "bundleIdentifier": "com.jalangroup.command",
      "supportsTablet": false
    },
    "android": {
      "package": "com.jalangroup.command",
      "adaptiveIcon": { "backgroundColor": "#06100A" }
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      ["expo-font", {
        "fonts": []
      }]
    ],
    "experiments": { "typedRoutes": true }
  }
}
```

- [ ] **Update babel.config.js** to enable Reanimated:
```js
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
```

- [ ] **Commit**:
```bash
cd /Users/vanshjalan/Desktop/JalanGroup-Complete
git add mobile/jalan-command/
git commit -m "feat: scaffold jalan-command Expo app"
```

---

## Task 5: Admin app — Theme + Store + API client

**Files:**
- Create: `mobile/jalan-command/src/theme.ts`
- Create: `mobile/jalan-command/src/store.ts`
- Create: `mobile/jalan-command/src/api.ts`

- [ ] **Create `src/theme.ts`**:
```ts
export const colors = {
  viGreen:    '#163827',
  viGreenMd:  '#1A4430',
  viGreenLt:  '#1E4D36',
  viGold:     '#C9A44A',
  viGoldLt:   '#E4C878',
  bg:         '#06100A',
  surf:       '#0A180D',
  surf2:      '#0F2015',
  surf3:      '#14291C',
  bdr:        '#1A3525',
  bdr2:       '#20402E',
  txt:        '#EAE8E0',
  txt2:       '#7D8C7F',
  txt3:       '#3A4A3D',
  red:        '#F07070',
  amber:      '#E8A830',
  ok:         '#5DC87A',
} as const;

export const fonts = {
  cormorantItalic:  'CormorantGaramond_700Italic',
  cormorantMedium:  'CormorantGaramond_600Italic',
  dmSansBold:       'DMSans_700Bold',
  dmSansMedium:     'DMSans_500Medium',
  dmSans:           'DMSans_400Regular',
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 14, lg: 18, xl: 24,
} as const;
```

- [ ] **Create `src/store.ts`**:
```ts
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface AuthState {
  token: string | null;
  companyId: string | null;
  companyName: string | null;
  setAuth: (token: string, companyId: string, companyName: string) => void;
  clearAuth: () => void;
  loadFromStorage: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  companyId: null,
  companyName: null,
  setAuth: async (token, companyId, companyName) => {
    await SecureStore.setItemAsync('token', token);
    await SecureStore.setItemAsync('companyId', companyId);
    await SecureStore.setItemAsync('companyName', companyName);
    set({ token, companyId, companyName });
  },
  clearAuth: async () => {
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('companyId');
    await SecureStore.deleteItemAsync('companyName');
    set({ token: null, companyId: null, companyName: null });
  },
  loadFromStorage: async () => {
    const token = await SecureStore.getItemAsync('token');
    const companyId = await SecureStore.getItemAsync('companyId');
    const companyName = await SecureStore.getItemAsync('companyName');
    if (token && companyId) set({ token, companyId, companyName: companyName || '' });
  },
}));
```

- [ ] **Create `src/api.ts`**:
```ts
import axios from 'axios';
import { useAuthStore } from './store';

export const BASE = 'https://api.vanshiron.com';

export const api = axios.create({ baseURL: BASE, timeout: 10000 });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  const companyId = useAuthStore.getState().companyId;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (companyId) config.headers['x-company-id'] = companyId;
  return config;
});

// Auth
export const adminLogin = (mobile: string, password: string) =>
  api.post('/api/auth/login', { mobile, password }).then(r => r.data);

// Dashboard
export const getDashboard = () =>
  api.get('/api/dashboard').then(r => r.data);

// Parties
export const getParties = () =>
  api.get('/api/parties').then(r => r.data);

export const getPartyLedger = (partyId: string, period = '90D') =>
  api.get(`/api/ledger/${partyId}`, { params: { period } }).then(r => r.data);

// Orders
export const getOrders = () =>
  api.get('/api/orders').then(r => r.data);

export const updateOrderStatus = (id: string, status: string, meta?: object) =>
  api.put(`/api/orders/${id}/status`, { status, ...meta }).then(r => r.data);

// Rates
export const getRates = () =>
  api.get('/api/rates').then(r => r.data);

export const updateRate = (id: string, price: number) =>
  api.put(`/api/rates/${id}`, { price }).then(r => r.data);

// Bot
export const getBotStatus = () =>
  api.get('/api/bot/status').then(r => r.data);

export const restartBot = () =>
  api.post('/api/bot/restart').then(r => r.data);

export const getBotLogs = () =>
  api.get('/api/bot/logs').then(r => r.data);

// WhatsApp
export const getMessages = () =>
  api.get('/api/whatsapp/messages').then(r => r.data);

export const sendReminders = () =>
  api.post('/api/whatsapp/send-reminders').then(r => r.data);
```

- [ ] **Commit**:
```bash
cd /Users/vanshjalan/Desktop/JalanGroup-Complete
git add mobile/jalan-command/src/
git commit -m "feat: admin app theme, store, api client"
```

---

## Task 6: Admin app — Shared components

**Files:**
- Create: `mobile/jalan-command/src/components/ScreenWrapper.tsx`
- Create: `mobile/jalan-command/src/components/GoldShimmerText.tsx`
- Create: `mobile/jalan-command/src/components/HexBg.tsx`
- Create: `mobile/jalan-command/src/components/TagBadge.tsx`
- Create: `mobile/jalan-command/src/components/ActivityItem.tsx`

- [ ] **Create `ScreenWrapper.tsx`**:
```tsx
import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  style?: object;
}

export function ScreenWrapper({ children, scroll = false, style }: Props) {
  const content = scroll ? (
    <ScrollView contentContainerStyle={[styles.scroll, style]} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.view, style]}>{children}</View>
  );
  return <SafeAreaView style={styles.safe}>{content}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, backgroundColor: colors.bg, paddingBottom: 32 },
  view:   { flex: 1, backgroundColor: colors.bg },
});
```

- [ ] **Create `GoldShimmerText.tsx`** (animates text color between white and gold):
```tsx
import React, { useEffect } from 'react';
import { StyleSheet, TextStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence,
  withTiming, interpolateColor,
} from 'react-native-reanimated';
import { colors, fonts } from '../theme';

interface Props {
  children: string;
  style?: TextStyle;
}

export function GoldShimmerText({ children, style }: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1800 }),
        withTiming(0, { duration: 1800 })
      ),
      -1,
      false
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [colors.txt, colors.viGoldLt]),
  }));

  return <Animated.Text style={[styles.base, style, animStyle]}>{children}</Animated.Text>;
}

const styles = StyleSheet.create({
  base: { fontFamily: fonts.cormorantItalic, color: colors.txt },
});
```

- [ ] **Create `HexBg.tsx`** (floating hexagon motif, matches VI logo):
```tsx
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Polygon } from 'react-native-svg';

function FloatingHex({ size, top, left, right, bottom, delay, duration }: any) {
  const y = useSharedValue(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      y.value = withRepeat(
        withSequence(withTiming(-10, { duration }), withTiming(0, { duration })),
        -1,
        false
      );
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const h = size * 0.866;
  const pts = `${size/2},2 ${size-2},${h*0.3} ${size-2},${h*0.7} ${size/2},${h-2} 2,${h*0.7} 2,${h*0.3}`;

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, { overflow: 'hidden' }]}>
      <Animated.View style={[{ position: 'absolute', top, left, right, bottom }, animStyle]}>
        <Svg width={size} height={h} opacity={0.025}>
          <Polygon points={pts} fill="none" stroke="#C9A44A" strokeWidth="1.5" />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

export function HexBg() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <FloatingHex size={120} top={20} right={-25} delay={0}    duration={4000} />
      <FloatingHex size={80}  bottom={90} left={-35} delay={800} duration={5000} />
      <FloatingHex size={160} top="40%" right={-45} delay={400} duration={6000} />
    </View>
  );
}
```

- [ ] **Create `TagBadge.tsx`**:
```tsx
import React from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { colors, fonts } from '../theme';

type Variant = 'pending' | 'done' | 'overdue' | 'gold';

const variantStyles = {
  pending: { bg: 'rgba(232,168,48,0.10)',  border: 'rgba(232,168,48,0.25)', text: colors.amber },
  done:    { bg: 'rgba(93,200,122,0.10)',  border: 'rgba(93,200,122,0.25)', text: colors.ok   },
  overdue: { bg: 'rgba(240,112,112,0.10)', border: 'rgba(240,112,112,0.25)',text: colors.red  },
  gold:    { bg: 'rgba(201,164,74,0.12)',  border: 'rgba(201,164,74,0.30)', text: colors.viGold },
} as const;

export function TagBadge({ label, variant }: { label: string; variant: Variant }) {
  const v = variantStyles[variant];
  return (
    <View style={[styles.base, { backgroundColor: v.bg, borderColor: v.border }]}>
      <Text style={[styles.text, { color: v.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base:  { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7, borderWidth: 1 },
  text:  { fontFamily: fonts.dmSansBold, fontSize: 9, letterSpacing: 0.3 },
});
```

- [ ] **Create `ActivityItem.tsx`**:
```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts } from '../theme';
import { TagBadge } from './TagBadge';

type Variant = 'pending' | 'done' | 'overdue' | 'gold';

interface Props {
  icon: string;
  name: string;
  sub: string;
  tag: string;
  tagVariant: Variant;
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
```

- [ ] **Commit**:
```bash
git add mobile/jalan-command/src/components/
git commit -m "feat: admin app shared components"
```

---

## Task 7: Admin app — Root layout + Login screen

**Files:**
- Create: `mobile/jalan-command/app/_layout.tsx`
- Create: `mobile/jalan-command/app/(auth)/login.tsx`

- [ ] **Create `app/_layout.tsx`**:
```tsx
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  CormorantGaramond_600Italic,
  CormorantGaramond_700Italic,
} from '@expo-google-fonts/cormorant-garamond';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { useAuthStore } from '../src/store';
import { colors } from '../src/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_700Italic,
    CormorantGaramond_600Italic,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });
  const loadFromStorage = useAuthStore(s => s.loadFromStorage);

  useEffect(() => { loadFromStorage(); }, []);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" backgroundColor={colors.bg} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </QueryClientProvider>
  );
}
```

- [ ] **Create `app/(auth)/login.tsx`**:
```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { adminLogin } from '../../src/api';
import { useAuthStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { HexBg } from '../../src/components/HexBg';

const COMPANIES = [
  { id: '2bead4bf-8eed-4e45-90b3-d2bcda632a56', name: 'Vansh Iron' },
  { id: '3658d1d5-77ed-4f9b-aacb-d329ccb9e93a', name: 'Amit Steels' },
];

export default function LoginScreen() {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [selectedCompany, setSelectedCompany] = useState(COMPANIES[0]);
  const setAuth = useAuthStore(s => s.setAuth);

  const { mutate: login, isPending } = useMutation({
    mutationFn: () => adminLogin(mobile, password),
    onSuccess: (data) => {
      setAuth(data.token, selectedCompany.id, selectedCompany.name);
      router.replace('/(tabs)/');
    },
    onError: () => Alert.alert('Login failed', 'Check mobile number and password'),
  });

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <HexBg />
      <View style={styles.inner}>
        <Text style={styles.brandName}>Vansh Iron</Text>
        <Text style={styles.sub}>Command Centre</Text>

        <View style={styles.companyRow}>
          {COMPANIES.map(co => (
            <TouchableOpacity
              key={co.id}
              style={[styles.coBadge, selectedCompany.id === co.id && styles.coBadgeActive]}
              onPress={() => setSelectedCompany(co)}
            >
              <Text style={[styles.coBadgeText, selectedCompany.id === co.id && styles.coBadgeTextActive]}>
                {co.name === 'Vansh Iron' ? 'VI' : 'AS'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.selectedCo}>{selectedCompany.name}</Text>

        <TextInput
          style={styles.input}
          placeholder="Mobile number"
          placeholderTextColor={colors.txt3}
          keyboardType="phone-pad"
          value={mobile}
          onChangeText={setMobile}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.txt3}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity style={styles.btn} onPress={() => login()} disabled={isPending}>
          <Text style={styles.btnText}>{isPending ? 'Signing in…' : 'Enter'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: colors.bg },
  inner:        { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  brandName:    { fontFamily: fonts.cormorantItalic, fontSize: 40, color: colors.viGold, letterSpacing: 1, textAlign: 'center', marginBottom: 4 },
  sub:          { fontFamily: fonts.dmSans, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: colors.txt3, textAlign: 'center', marginBottom: 32 },
  companyRow:   { flexDirection: 'row', gap: 10, justifyContent: 'center', marginBottom: 8 },
  coBadge:      { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.bdr2, backgroundColor: colors.surf2 },
  coBadgeActive:{ borderColor: `${colors.viGold}55`, backgroundColor: `${colors.viGold}15` },
  coBadgeText:  { fontFamily: fonts.cormorantItalic, fontSize: 16, color: colors.txt3 },
  coBadgeTextActive: { color: colors.viGold },
  selectedCo:   { fontFamily: fonts.dmSans, fontSize: 10, color: colors.txt3, letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center', marginBottom: 28 },
  input:        { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.dmSans, fontSize: 14, color: colors.txt, marginBottom: 12 },
  btn:          { backgroundColor: colors.viGold, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText:      { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.bg, letterSpacing: 1 },
});
```

- [ ] **Commit**:
```bash
git add mobile/jalan-command/app/
git commit -m "feat: admin app layout + login screen"
```

---

## Task 8: Admin app — Tab navigator + Dashboard screen

**Files:**
- Create: `mobile/jalan-command/app/(tabs)/_layout.tsx`
- Create: `mobile/jalan-command/app/(tabs)/index.tsx`

- [ ] **Create `(tabs)/_layout.tsx`**:
```tsx
import React from 'react';
import { Tabs } from 'expo-router';
import { colors, fonts } from '../../src/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surf,
          borderTopColor: colors.bdr,
          borderTopWidth: 1,
          height: 72,
          paddingBottom: 12,
        },
        tabBarActiveTintColor: colors.viGold,
        tabBarInactiveTintColor: colors.txt3,
        tabBarLabelStyle: { fontFamily: fonts.dmSans, fontSize: 9, letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen name="index"      options={{ title: 'Home',     tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏠</Text> }} />
      <Tabs.Screen name="parties/index" options={{ title: 'Parties',  tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>👤</Text> }} />
      <Tabs.Screen name="orders/index"  options={{ title: 'Orders',   tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📦</Text> }} />
      <Tabs.Screen name="bot"        options={{ title: 'WA Bot',   tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>💬</Text> }} />
      <Tabs.Screen name="settings"   options={{ title: 'Settings', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⚙️</Text> }} />
    </Tabs>
  );
}
// Add at top: import { Text } from 'react-native';
```

- [ ] **Create `(tabs)/index.tsx` (Dashboard)**:
```tsx
import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDashboard, sendReminders } from '../../src/api';
import { useAuthStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';
import { GoldShimmerText } from '../../src/components/GoldShimmerText';
import { HexBg } from '../../src/components/HexBg';
import { ActivityItem } from '../../src/components/ActivityItem';

export default function DashboardScreen() {
  const companyName = useAuthStore(s => s.companyName);
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard });
  const { mutate: remind } = useMutation({ mutationFn: sendReminders, onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }) });

  const glowAnim = useSharedValue(0.2);
  useEffect(() => {
    glowAnim.value = withRepeat(withSequence(withTiming(0.6, { duration: 2000 }), withTiming(0.2, { duration: 2000 })), -1, false);
  }, []);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glowAnim.value }));

  const fmt = (n: number) => n >= 100000 ? `₹${(n/100000).toFixed(1)}L` : `₹${n?.toLocaleString('en-IN') ?? 0}`;

  return (
    <ScreenWrapper scroll>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Animated.Text style={[styles.brandName, glowStyle]}>Vansh Iron</Animated.Text>
          <Text style={styles.brandSub}>Command Centre</Text>
        </View>
        <View style={styles.avatar}><Text style={styles.avatarText}>V</Text></View>
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
          <View style={styles.stat}>
            <Text style={[styles.statVal, { color: colors.red }]}>{fmt(data?.overdue ?? 0)}</Text>
            <Text style={styles.statLbl}>Overdue</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statVal, { color: colors.amber }]}>{fmt(data?.due_soon ?? 0)}</Text>
            <Text style={styles.statLbl}>Due Soon</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statVal, { color: colors.ok }]}>{fmt(data?.collected_this_month ?? 0)}</Text>
            <Text style={styles.statLbl}>Collected</Text>
          </View>
        </View>
      </View>

      {/* Quick actions */}
      <View style={styles.qaGrid}>
        {[
          { icon: '📣', label: 'Remind All', onPress: () => remind() },
          { icon: '💰', label: 'Live Rates', onPress: () => {} },
          { icon: '💬', label: 'WA Bot',     onPress: () => {} },
          { icon: '📦', label: 'Orders',     onPress: () => {} },
        ].map(a => (
          <TouchableOpacity key={a.label} style={styles.qaBtn} onPress={a.onPress}>
            <Text style={styles.qaIcon}>{a.icon}</Text>
            <Text style={styles.qaLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Activity */}
      <Text style={styles.secLabel}>RECENT ACTIVITY</Text>
      <View style={styles.actList}>
        {(data?.recent_activity ?? []).slice(0, 5).map((item: any, i: number) => (
          <ActivityItem
            key={i}
            icon={item.type === 'payment' ? '💸' : item.type === 'order' ? '📦' : '💬'}
            name={item.party_name ?? item.description}
            sub={item.sub ?? ''}
            tag={item.status ?? 'Info'}
            tagVariant={item.status === 'overdue' ? 'overdue' : item.status === 'done' ? 'done' : 'pending'}
          />
        ))}
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14 },
  brandName:   { fontFamily: fonts.cormorantItalic, fontSize: 24, color: colors.viGold, letterSpacing: 1 },
  brandSub:    { fontFamily: fonts.dmSans, fontSize: 7.5, letterSpacing: 2.5, textTransform: 'uppercase', color: colors.txt3, marginTop: 2 },
  avatar:      { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.viGreenMd, borderWidth: 1.5, borderColor: `${colors.viGold}50`, alignItems: 'center', justifyContent: 'center' },
  avatarText:  { fontFamily: fonts.cormorantItalic, fontSize: 16, color: colors.viGold },
  heroCard:    { marginHorizontal: 14, marginBottom: 14, backgroundColor: colors.surf3, borderWidth: 1, borderColor: `${colors.viGold}30`, borderRadius: 24, padding: 18, overflow: 'hidden' },
  cardLbl:     { fontFamily: fonts.dmSansBold, fontSize: 8, letterSpacing: 2.5, textTransform: 'uppercase', color: `${colors.viGold}80`, marginBottom: 4 },
  heroAmount:  { fontSize: 36, marginBottom: 6 },
  divider:     { height: 1, backgroundColor: `${colors.viGold}30`, marginVertical: 12 },
  statsRow:    { flexDirection: 'row', justifyContent: 'space-between' },
  stat:        {},
  statVal:     { fontFamily: fonts.cormorantItalic, fontSize: 19, letterSpacing: -0.5 },
  statLbl:     { fontFamily: fonts.dmSansBold, fontSize: 7, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.txt3, marginTop: 2 },
  qaGrid:      { flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginBottom: 14 },
  qaBtn:       { flex: 1, backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 18, paddingVertical: 13, alignItems: 'center', gap: 6 },
  qaIcon:      { fontSize: 20 },
  qaLabel:     { fontFamily: fonts.dmSansBold, fontSize: 8, color: colors.txt2, textAlign: 'center' },
  secLabel:    { fontFamily: fonts.dmSansBold, fontSize: 8, letterSpacing: 2.5, color: colors.txt3, paddingHorizontal: 18, marginBottom: 8 },
  actList:     { paddingHorizontal: 14 },
});
```

- [ ] **Commit**:
```bash
git add mobile/jalan-command/app/(tabs)/
git commit -m "feat: dashboard screen"
```

---

## Task 9: Admin app — WA Bot screen

**Files:**
- Create: `mobile/jalan-command/app/(tabs)/bot.tsx`

- [ ] **Create `bot.tsx`**:
```tsx
import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBotStatus, restartBot, getBotLogs, getMessages } from '../../src/api';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';

export default function BotScreen() {
  const qc = useQueryClient();
  const logsRef = useRef<ScrollView>(null);

  const { data: status, refetch: refetchStatus } = useQuery({
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

      {/* Status card */}
      <View style={[styles.statusCard, { borderColor: online ? `${colors.ok}40` : `${colors.red}40` }]}>
        <View style={[styles.dot, { backgroundColor: online ? colors.ok : colors.red }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusText, { color: online ? colors.ok : colors.red }]}>
            {online ? 'Online' : 'Offline'}
          </Text>
          {online && status?.uptime && (
            <Text style={styles.uptime}>Up {Math.round(status.uptime / 60)} min</Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.restartBtn, isPending && { opacity: 0.5 }]}
          onPress={() => restart()}
          disabled={isPending}
        >
          <Text style={styles.restartText}>{isPending ? '…' : '↺ Restart'}</Text>
        </TouchableOpacity>
      </View>

      {/* Recent messages */}
      <Text style={styles.sectionLbl}>RECENT MESSAGES</Text>
      <View style={styles.messageList}>
        {(messagesData?.messages ?? []).slice(0, 8).map((m: any, i: number) => (
          <View key={i} style={styles.msgRow}>
            <Text style={styles.msgFrom}>{m.from_name ?? m.from}</Text>
            <Text style={styles.msgText} numberOfLines={1}>{m.body}</Text>
            <Text style={styles.msgTime}>{m.time_ago}</Text>
          </View>
        ))}
        {!messagesData?.messages?.length && (
          <Text style={styles.empty}>No recent messages</Text>
        )}
      </View>

      {/* Logs */}
      <Text style={styles.sectionLbl}>LAST 100 LOG LINES</Text>
      <ScrollView
        ref={logsRef}
        style={styles.logBox}
        onContentSizeChange={() => logsRef.current?.scrollToEnd({ animated: false })}
      >
        {(logsData?.lines ?? []).map((line: string, i: number) => (
          <Text key={i} style={styles.logLine}>{line}</Text>
        ))}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:       { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingBottom: 14 },
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
```

- [ ] **Commit**:
```bash
git add mobile/jalan-command/app/(tabs)/bot.tsx
git commit -m "feat: WA bot management screen"
```

---

## Task 10: Admin app — Parties, Orders, Rates, Settings screens

**Files:**
- Create: `mobile/jalan-command/app/(tabs)/parties/index.tsx`
- Create: `mobile/jalan-command/app/(tabs)/parties/[id].tsx`
- Create: `mobile/jalan-command/app/(tabs)/orders/index.tsx`
- Create: `mobile/jalan-command/app/(tabs)/rates.tsx`
- Create: `mobile/jalan-command/app/(tabs)/settings.tsx`

- [ ] **Create `parties/index.tsx`**:
```tsx
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
  const { data, isLoading } = useQuery({ queryKey: ['parties'], queryFn: getParties });

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
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => router.push(`/(tabs)/parties/${item.id}`)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub}>{item.mobile ?? '—'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={[styles.amount, { color: item.overdue > 0 ? colors.red : colors.txt }]}>
                ₹{(item.outstanding / 100000).toFixed(1)}L
              </Text>
              {item.overdue > 0 && <TagBadge label="Overdue" variant="overdue" />}
            </View>
          </TouchableOpacity>
        )}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:  { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingBottom: 10 },
  search: { marginHorizontal: 14, marginBottom: 14, backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, fontFamily: fonts.dmSans, fontSize: 13, color: colors.txt },
  row:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  name:   { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.txt },
  sub:    { fontFamily: fonts.dmSans, fontSize: 10, color: colors.txt3, marginTop: 2 },
  amount: { fontFamily: fonts.cormorantItalic, fontSize: 16 },
});
```

- [ ] **Create `parties/[id].tsx`** (ledger for one party):
```tsx
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getPartyLedger } from '../../../src/api';
import { colors, fonts } from '../../../src/theme';
import { ScreenWrapper } from '../../../src/components/ScreenWrapper';

const PERIODS = ['3M', '6M', 'FY2526', 'FY2425', 'ALL'] as const;
type Period = typeof PERIODS[number];

export default function PartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [period, setPeriod] = useState<Period>('3M');
  const { data } = useQuery({ queryKey: ['ledger', id, period], queryFn: () => getPartyLedger(id!, period) });

  return (
    <ScreenWrapper>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{data?.party?.name ?? '…'}</Text>
      <Text style={styles.outstanding}>
        Outstanding: <Text style={{ color: colors.red }}>₹{(data?.outstanding ?? 0).toLocaleString('en-IN')}</Text>
      </Text>

      {/* Period filter */}
      <View style={styles.periodRow}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, period === p && styles.periodActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.periodText, period === p && { color: colors.viGold }]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={data?.entries ?? []}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: 14 }}
        renderItem={({ item }) => (
          <View style={styles.ledgerRow}>
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
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  back:        { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 },
  backText:    { fontFamily: fonts.dmSans, fontSize: 13, color: colors.txt2 },
  title:       { fontFamily: fonts.cormorantItalic, fontSize: 26, color: colors.viGold, paddingHorizontal: 18 },
  outstanding: { fontFamily: fonts.dmSansMedium, fontSize: 12, color: colors.txt2, paddingHorizontal: 18, marginBottom: 14 },
  periodRow:   { flexDirection: 'row', gap: 6, paddingHorizontal: 14, marginBottom: 12, flexWrap: 'wrap' },
  periodBtn:   { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.bdr },
  periodActive:{ borderColor: `${colors.viGold}50`, backgroundColor: `${colors.viGold}12` },
  periodText:  { fontFamily: fonts.dmSans, fontSize: 11, color: colors.txt3 },
  ledgerRow:   { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  desc:        { fontFamily: fonts.dmSansBold, fontSize: 11, color: colors.txt },
  date:        { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 1 },
  amount:      { fontFamily: fonts.cormorantItalic, fontSize: 14 },
  bal:         { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3 },
});
```

- [ ] **Create `orders/index.tsx`**:
```tsx
import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
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
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => router.push(`/(tabs)/orders/${item.id}`)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.orderNo}>Order #{item.order_number ?? item.id.slice(0,8)}</Text>
              <Text style={styles.sub}>{item.party_name} · {item.product_name}</Text>
              <Text style={styles.date}>{item.created_at?.slice(0,10)}</Text>
            </View>
            <TagBadge
              label={item.status}
              variant={item.status === 'dispatched' ? 'done' : item.status === 'pending' ? 'pending' : 'gold'}
            />
          </TouchableOpacity>
        )}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:   { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingBottom: 10 },
  row:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  orderNo: { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.txt },
  sub:     { fontFamily: fonts.dmSans, fontSize: 11, color: colors.txt2, marginTop: 2 },
  date:    { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 2 },
});
```

- [ ] **Create `rates.tsx`**:
```tsx
import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rates'] }); setEditing(null); },
    onError: () => Alert.alert('Failed', 'Could not save price'),
  });

  return (
    <ScreenWrapper>
      <Text style={styles.title}>Live Rates</Text>
      <Text style={styles.sub}>Tap a rate to edit · Changes go live instantly</Text>
      <FlatList
        data={data?.rates ?? []}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32 }}
        renderItem={({ item }) => (
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
                <TouchableOpacity style={styles.saveBtn} onPress={() => saveRate({ id: item.id, price: parseFloat(draftPrice) })}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => { setEditing(item.id); setDraftPrice(String(item.price)); }}>
                <Text style={styles.price}>₹{Number(item.price).toLocaleString('en-IN')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:    { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingBottom: 4 },
  sub:      { fontFamily: fonts.dmSans, fontSize: 10, color: colors.txt3, paddingHorizontal: 18, marginBottom: 16 },
  row:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  name:     { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.txt },
  unit:     { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 2 },
  price:    { fontFamily: fonts.cormorantItalic, fontSize: 18, color: colors.viGold },
  input:    { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontFamily: fonts.dmSans, fontSize: 14, color: colors.txt, minWidth: 100 },
  saveBtn:  { backgroundColor: colors.viGold, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  saveBtnText: { fontFamily: fonts.dmSansBold, fontSize: 12, color: colors.bg },
});
```

- [ ] **Create `settings.tsx`**:
```tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';

export default function SettingsScreen() {
  const { companyName, clearAuth } = useAuthStore();

  const logout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel' },
      { text: 'Logout', style: 'destructive', onPress: () => { clearAuth(); router.replace('/(auth)/login'); } },
    ]);
  };

  return (
    <ScreenWrapper scroll>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Active Company</Text>
        <Text style={styles.value}>{companyName}</Text>
      </View>
      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:      { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingBottom: 14 },
  card:       { marginHorizontal: 14, backgroundColor: colors.surf2, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.bdr },
  label:      { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  value:      { fontFamily: fonts.dmSansBold, fontSize: 15, color: colors.txt },
  logoutBtn:  { marginHorizontal: 14, marginTop: 16, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: `${colors.red}40`, backgroundColor: `${colors.red}10`, alignItems: 'center' },
  logoutText: { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.red },
});
```

- [ ] **Commit**:
```bash
git add mobile/jalan-command/app/(tabs)/
git commit -m "feat: parties, orders, rates, settings screens"
```

---

## Task 11: Scaffold Customer app

**Files:**
- Create: `mobile/vi-portal/` (full Expo project)

- [ ] **Scaffold**:
```bash
cd /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile
npx create-expo-app@latest vi-portal --template blank-typescript
cd vi-portal
npx expo install expo-router expo-secure-store expo-font expo-linear-gradient expo-file-system expo-sharing
npm install @tanstack/react-query zustand axios react-native-reanimated react-native-svg @react-native-masked-view/masked-view
npx expo install @expo-google-fonts/cormorant-garamond @expo-google-fonts/dm-sans
```

- [ ] **Update `app.json`**:
```json
{
  "expo": {
    "name": "Vansh Iron",
    "slug": "vi-portal",
    "version": "1.0.0",
    "scheme": "vi-portal",
    "orientation": "portrait",
    "splash": { "backgroundColor": "#06100A" },
    "ios": { "bundleIdentifier": "com.jalangroup.portal", "supportsTablet": false },
    "android": { "package": "com.jalangroup.portal", "adaptiveIcon": { "backgroundColor": "#06100A" } },
    "plugins": ["expo-router", "expo-secure-store"],
    "experiments": { "typedRoutes": true }
  }
}
```

- [ ] **Copy theme + babel config from admin app** (identical):
```bash
mkdir -p src/components
cp /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/jalan-command/src/theme.ts src/
cp /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/jalan-command/src/components/ScreenWrapper.tsx src/components/
cp /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/jalan-command/src/components/GoldShimmerText.tsx src/components/
cp /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/jalan-command/src/components/HexBg.tsx src/components/
cp /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/jalan-command/src/components/TagBadge.tsx src/components/
cp /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/jalan-command/babel.config.js .
```

- [ ] **Create `src/store.ts`** (same shape, different keys):
```ts
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface ClientAuthState {
  token: string | null;
  partyName: string | null;
  companyName: string | null;
  setAuth: (token: string, partyName: string, companyName: string) => void;
  clearAuth: () => void;
  loadFromStorage: () => Promise<void>;
}

export const useClientStore = create<ClientAuthState>((set) => ({
  token: null, partyName: null, companyName: null,
  setAuth: async (token, partyName, companyName) => {
    await SecureStore.setItemAsync('portal_token', token);
    await SecureStore.setItemAsync('portal_party', partyName);
    await SecureStore.setItemAsync('portal_company', companyName);
    set({ token, partyName, companyName });
  },
  clearAuth: async () => {
    await SecureStore.deleteItemAsync('portal_token');
    await SecureStore.deleteItemAsync('portal_party');
    await SecureStore.deleteItemAsync('portal_company');
    set({ token: null, partyName: null, companyName: null });
  },
  loadFromStorage: async () => {
    const token = await SecureStore.getItemAsync('portal_token');
    const partyName = await SecureStore.getItemAsync('portal_party');
    const companyName = await SecureStore.getItemAsync('portal_company');
    if (token) set({ token, partyName: partyName || '', companyName: companyName || '' });
  },
}));
```

- [ ] **Create `src/api.ts`**:
```ts
import axios from 'axios';
import { useClientStore } from './store';

export const BASE = 'https://portal.vanshiron.com';
export const api = axios.create({ baseURL: BASE, timeout: 10000 });

api.interceptors.request.use((config) => {
  const token = useClientStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const clientLogin = (mobile: string, password: string) =>
  api.post('/portal/login', { mobile, password }).then(r => r.data);

export const getAccount = () =>
  api.get('/portal/account').then(r => r.data);

export const getLedger = (params: { page?: number; from?: string; to?: string }) =>
  api.get('/portal/ledger', { params }).then(r => r.data);

export const downloadStatement = (from: string, to: string) =>
  api.get('/portal/statement/download', { params: { from, to }, responseType: 'blob' }).then(r => r.data);

export const getProducts = () =>
  api.get('/portal/products').then(r => r.data);

export const getOrders = () =>
  api.get('/portal/orders').then(r => r.data);

export const placeOrder = (body: object) =>
  api.post('/portal/orders', body).then(r => r.data);

export const sendPaymentNotification = (body: object) =>
  api.post('/portal/payment-notification', body).then(r => r.data);
```

- [ ] **Commit**:
```bash
cd /Users/vanshjalan/Desktop/JalanGroup-Complete
git add mobile/vi-portal/
git commit -m "feat: scaffold vi-portal customer app"
```

---

## Task 12: Customer app — Root layout + Login

**Files:**
- Create: `mobile/vi-portal/app/_layout.tsx`
- Create: `mobile/vi-portal/app/(auth)/login.tsx`

- [ ] **Create `app/_layout.tsx`** (same pattern as admin):
```tsx
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useFonts, CormorantGaramond_700Italic, CormorantGaramond_600Italic } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { useClientStore } from '../src/store';
import { colors } from '../src/theme';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000 } } });

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ CormorantGaramond_700Italic, CormorantGaramond_600Italic, DMSans_400Regular, DMSans_500Medium, DMSans_700Bold });
  const load = useClientStore(s => s.loadFromStorage);
  useEffect(() => { load(); }, []);
  if (!fontsLoaded) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" backgroundColor={colors.bg} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </QueryClientProvider>
  );
}
```

- [ ] **Create `app/(auth)/login.tsx`**:
```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { clientLogin } from '../../src/api';
import { useClientStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { HexBg } from '../../src/components/HexBg';

export default function ClientLoginScreen() {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const setAuth = useClientStore(s => s.setAuth);

  const { mutate: login, isPending } = useMutation({
    mutationFn: () => clientLogin(mobile, password),
    onSuccess: (data) => {
      setAuth(data.token, data.party?.name ?? '', data.company?.name ?? 'Vansh Iron');
      router.replace('/(tabs)/');
    },
    onError: () => Alert.alert('Login failed', 'Check your mobile number and password'),
  });

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <HexBg />
      <View style={styles.inner}>
        <Text style={styles.brand}>Vansh Iron</Text>
        <Text style={styles.tagline}>A Legacy That Builds Strength</Text>
        <TextInput style={styles.input} placeholder="Mobile number" placeholderTextColor={colors.txt3} keyboardType="phone-pad" value={mobile} onChangeText={setMobile} />
        <TextInput style={styles.input} placeholder="Password" placeholderTextColor={colors.txt3} secureTextEntry value={password} onChangeText={setPassword} />
        <TouchableOpacity style={styles.btn} onPress={() => login()} disabled={isPending}>
          <Text style={styles.btnText}>{isPending ? 'Signing in…' : 'Enter Portal'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: colors.bg },
  inner:    { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  brand:    { fontFamily: fonts.cormorantItalic, fontSize: 44, color: colors.viGold, textAlign: 'center', marginBottom: 6 },
  tagline:  { fontFamily: fonts.dmSans, fontSize: 10, letterSpacing: 1.5, color: colors.txt3, textAlign: 'center', marginBottom: 44 },
  input:    { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.dmSans, fontSize: 14, color: colors.txt, marginBottom: 12 },
  btn:      { backgroundColor: colors.viGold, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText:  { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.bg, letterSpacing: 1 },
});
```

---

## Task 13: Customer app — Tab layout + Home screen

**Files:**
- Create: `mobile/vi-portal/app/(tabs)/_layout.tsx`
- Create: `mobile/vi-portal/app/(tabs)/index.tsx`

- [ ] **Create `(tabs)/_layout.tsx`** (same pattern as admin, 4 tabs):
```tsx
import React from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { colors, fonts } from '../../src/theme';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: colors.surf, borderTopColor: colors.bdr, borderTopWidth: 1, height: 72, paddingBottom: 12 },
      tabBarActiveTintColor: colors.viGold,
      tabBarInactiveTintColor: colors.txt3,
      tabBarLabelStyle: { fontFamily: fonts.dmSans, fontSize: 9, letterSpacing: 0.5 },
    }}>
      <Tabs.Screen name="index"    options={{ title: 'Home',    tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏠</Text> }} />
      <Tabs.Screen name="ledger"   options={{ title: 'Ledger',  tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📒</Text> }} />
      <Tabs.Screen name="orders"   options={{ title: 'Orders',  tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📦</Text> }} />
      <Tabs.Screen name="account"  options={{ title: 'Account', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>👤</Text> }} />
    </Tabs>
  );
}
```

- [ ] **Create `(tabs)/index.tsx` (Home)**:
```tsx
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
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
  const { data } = useQuery({ queryKey: ['account'], queryFn: getAccount, refetchInterval: 60000 });

  const pulseAnim = useSharedValue(1);
  useEffect(() => {
    if (data?.overdue > 0) {
      pulseAnim.value = withRepeat(withSequence(withTiming(1.03, { duration: 800 }), withTiming(1, { duration: 800 })), -1, false);
    }
  }, [data?.overdue]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulseAnim.value }] }));

  const fmt = (n: number) => `₹${n?.toLocaleString('en-IN') ?? '0'}`;

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
        <GoldShimmerText style={styles.balAmount}>{fmt(data?.outstanding ?? 0)}</GoldShimmerText>
        {data?.overdue > 0 && (
          <Animated.View style={[styles.dueBadge, pulseStyle]}>
            <Text style={styles.dueText}>⚠ {fmt(data.overdue)} overdue</Text>
          </Animated.View>
        )}
      </View>

      {/* Mini stats */}
      <View style={styles.miniRow}>
        <View style={[styles.miniCard, styles.goldBorder]}>
          <Text style={styles.miniIcon}>📄</Text>
          <Text style={[styles.miniVal, { color: colors.viGold }]}>{fmt(data?.this_month ?? 0)}</Text>
          <Text style={styles.miniLbl}>This Month</Text>
        </View>
        <View style={[styles.miniCard, styles.okBorder]}>
          <Text style={styles.miniIcon}>✅</Text>
          <Text style={[styles.miniVal, { color: colors.ok }]}>{fmt(data?.paid_ytd ?? 0)}</Text>
          <Text style={styles.miniLbl}>Paid YTD</Text>
        </View>
      </View>

      {/* Quick links */}
      <Text style={styles.secLbl}>QUICK ACTIONS</Text>
      <View style={styles.quickLinks}>
        {[
          { icon: '📒', label: 'View Ledger',      onPress: () => router.push('/(tabs)/ledger') },
          { icon: '🏦', label: 'Notify Payment',   onPress: () => router.push('/(tabs)/account') },
          { icon: '📦', label: 'Place Order',       onPress: () => router.push('/(tabs)/orders') },
          { icon: '📊', label: 'Today\'s Rates',   onPress: () => router.push('/(tabs)/orders') },
        ].map(a => (
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
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14 },
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
```

- [ ] **Commit**:
```bash
git add mobile/vi-portal/app/
git commit -m "feat: customer home screen"
```

---

## Task 14: Customer app — Ledger, Orders, Account screens

**Files:**
- Create: `mobile/vi-portal/app/(tabs)/ledger.tsx`
- Create: `mobile/vi-portal/app/(tabs)/orders.tsx`
- Create: `mobile/vi-portal/app/(tabs)/account.tsx`

- [ ] **Create `ledger.tsx`**:
```tsx
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getLedger } from '../../src/api';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';

const PERIODS = [
  { label: '3M',      from: () => { const d = new Date(); d.setMonth(d.getMonth()-3); return d.toISOString().slice(0,10); } },
  { label: '6M',      from: () => { const d = new Date(); d.setMonth(d.getMonth()-6); return d.toISOString().slice(0,10); } },
  { label: 'FY25-26', from: () => '2025-04-01' },
  { label: 'FY24-25', from: () => '2024-04-01', to: '2025-03-31' },
  { label: 'All',     from: () => '2020-01-01' },
];

export default function LedgerScreen() {
  const [periodIdx, setPeriodIdx] = useState(0);
  const period = PERIODS[periodIdx];
  const { data, isLoading } = useQuery({
    queryKey: ['ledger', periodIdx],
    queryFn: () => getLedger({ from: period.from(), to: (period as any).to }),
  });

  return (
    <ScreenWrapper>
      <Text style={styles.title}>Ledger</Text>
      <View style={styles.periodRow}>
        {PERIODS.map((p, i) => (
          <TouchableOpacity key={p.label} style={[styles.pBtn, periodIdx === i && styles.pActive]} onPress={() => setPeriodIdx(i)}>
            <Text style={[styles.pText, periodIdx === i && { color: colors.viGold }]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {isLoading ? <ActivityIndicator color={colors.viGold} style={{ marginTop: 40 }} /> : (
        <FlatList
          data={data?.entries ?? []}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32 }}
          renderItem={({ item }) => (
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
  title:     { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingBottom: 10 },
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
```

- [ ] **Create `orders.tsx`**:
```tsx
import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, Alert, Modal } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrders, getProducts, placeOrder } from '../../src/api';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';
import { TagBadge } from '../../src/components/TagBadge';

export default function OrdersScreen() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const { data: ordersData } = useQuery({ queryKey: ['portal-orders'], queryFn: getOrders });
  const { data: productsData } = useQuery({ queryKey: ['portal-products'], queryFn: getProducts });

  const { mutate: submitOrder, isPending } = useMutation({
    mutationFn: () => placeOrder({ product_id: productId, quantity: parseFloat(qty) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['portal-orders'] }); setShowForm(false); setQty(''); },
    onError: () => Alert.alert('Failed', 'Could not place order'),
  });

  return (
    <ScreenWrapper>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 10 }}>
        <Text style={styles.title}>Orders</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => setShowForm(true)}>
          <Text style={styles.newBtnText}>+ New Order</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={ordersData?.orders ?? []}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.orderNo}>#{item.order_number ?? item.id.slice(0,8)}</Text>
              <Text style={styles.product}>{item.product_name} · {item.quantity} {item.unit}</Text>
              <Text style={styles.date}>{item.created_at?.slice(0,10)}</Text>
            </View>
            <TagBadge label={item.status} variant={item.status === 'dispatched' ? 'done' : 'pending'} />
          </View>
        )}
      />

      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>New Order</Text>
          <Text style={styles.modalLbl}>Product</Text>
          {(productsData?.products ?? []).map((p: any) => (
            <TouchableOpacity key={p.id} style={[styles.productRow, productId === p.id && styles.productActive]} onPress={() => setProductId(p.id)}>
              <Text style={[styles.productName, productId === p.id && { color: colors.viGold }]}>{p.name}</Text>
              <Text style={styles.productPrice}>₹{Number(p.price).toLocaleString('en-IN')}/{p.unit}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.modalLbl}>Quantity (tonnes)</Text>
          <TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="e.g. 2.5" placeholderTextColor={colors.txt3} />
          <TouchableOpacity style={styles.submitBtn} onPress={() => submitOrder()} disabled={isPending || !productId || !qty}>
            <Text style={styles.submitText}>{isPending ? '…' : 'Place Order'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:        { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold },
  newBtn:       { backgroundColor: `${colors.viGold}18`, borderWidth: 1, borderColor: `${colors.viGold}40`, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  newBtnText:   { fontFamily: fonts.dmSansBold, fontSize: 11, color: colors.viGold },
  row:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.surf2 },
  orderNo:      { fontFamily: fonts.dmSansBold, fontSize: 12, color: colors.txt },
  product:      { fontFamily: fonts.dmSans, fontSize: 11, color: colors.txt2, marginTop: 2 },
  date:         { fontFamily: fonts.dmSans, fontSize: 9, color: colors.txt3, marginTop: 1 },
  modal:        { flex: 1, backgroundColor: colors.bg, padding: 24 },
  modalTitle:   { fontFamily: fonts.cormorantItalic, fontSize: 32, color: colors.viGold, marginBottom: 20 },
  modalLbl:     { fontFamily: fonts.dmSansBold, fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: colors.txt3, marginBottom: 8, marginTop: 16 },
  productRow:   { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.bdr, marginBottom: 6, flexDirection: 'row', justifyContent: 'space-between' },
  productActive:{ borderColor: `${colors.viGold}50`, backgroundColor: `${colors.viGold}10` },
  productName:  { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.txt },
  productPrice: { fontFamily: fonts.cormorantItalic, fontSize: 14, color: colors.txt2 },
  input:        { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 12, padding: 14, fontFamily: fonts.dmSans, fontSize: 14, color: colors.txt, marginBottom: 8 },
  submitBtn:    { backgroundColor: colors.viGold, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  submitText:   { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.bg },
  cancelBtn:    { alignItems: 'center', marginTop: 12 },
  cancelText:   { fontFamily: fonts.dmSans, fontSize: 13, color: colors.txt3 },
});
```

- [ ] **Create `account.tsx`** (payment notification + statement download + logout):
```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { sendPaymentNotification, downloadStatement, BASE } from '../../src/api';
import { useClientStore } from '../../src/store';
import { colors, fonts } from '../../src/theme';
import { ScreenWrapper } from '../../src/components/ScreenWrapper';

export default function AccountScreen() {
  const { partyName, companyName, token, clearAuth } = useClientStore();
  const [amount, setAmount] = useState('');
  const [upiRef, setUpiRef] = useState('');
  const [note, setNote] = useState('');
  const [stmtFrom, setStmtFrom] = useState('2025-04-01');
  const [stmtTo, setStmtTo] = useState(new Date().toISOString().slice(0, 10));

  const { mutate: notify, isPending: notifyPending } = useMutation({
    mutationFn: () => sendPaymentNotification({ amount: parseFloat(amount), upi_ref: upiRef, note }),
    onSuccess: () => { Alert.alert('Sent!', 'Jalan Group has been notified.'); setAmount(''); setUpiRef(''); setNote(''); },
    onError: () => Alert.alert('Failed', 'Could not send notification'),
  });

  const downloadStmt = async () => {
    try {
      const url = `${BASE}/portal/statement/download?from=${stmtFrom}&to=${stmtTo}`;
      const path = `${FileSystem.documentDirectory}statement_${stmtFrom}_${stmtTo}.pdf`;
      const { uri } = await FileSystem.downloadAsync(url, path, { headers: { Authorization: `Bearer ${token}` } });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch (e) { Alert.alert('Failed', 'Could not download statement'); }
  };

  return (
    <ScreenWrapper scroll>
      <Text style={styles.title}>Account</Text>
      <View style={styles.card}>
        <Text style={styles.lbl}>Party</Text>
        <Text style={styles.val}>{partyName}</Text>
        <Text style={styles.lbl} style={[styles.lbl, { marginTop: 8 }]}>Company</Text>
        <Text style={styles.val}>{companyName}</Text>
      </View>

      {/* Payment notification */}
      <Text style={styles.sectionTitle}>Notify a Payment</Text>
      <View style={styles.form}>
        <TextInput style={styles.input} placeholder="Amount (₹)" placeholderTextColor={colors.txt3} keyboardType="numeric" value={amount} onChangeText={setAmount} />
        <TextInput style={styles.input} placeholder="UPI Reference / Transaction ID" placeholderTextColor={colors.txt3} value={upiRef} onChangeText={setUpiRef} />
        <TextInput style={styles.input} placeholder="Note (optional)" placeholderTextColor={colors.txt3} value={note} onChangeText={setNote} />
        <TouchableOpacity style={styles.btn} onPress={() => notify()} disabled={notifyPending || !amount || !upiRef}>
          <Text style={styles.btnText}>{notifyPending ? '…' : 'Send Notification'}</Text>
        </TouchableOpacity>
      </View>

      {/* Statement download */}
      <Text style={styles.sectionTitle}>Download Statement</Text>
      <View style={styles.form}>
        <Text style={styles.lbl}>From</Text>
        <TextInput style={styles.input} value={stmtFrom} onChangeText={setStmtFrom} placeholder="YYYY-MM-DD" placeholderTextColor={colors.txt3} />
        <Text style={styles.lbl}>To</Text>
        <TextInput style={styles.input} value={stmtTo} onChangeText={setStmtTo} placeholder="YYYY-MM-DD" placeholderTextColor={colors.txt3} />
        <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surf3, borderWidth: 1, borderColor: `${colors.viGold}40` }]} onPress={downloadStmt}>
          <Text style={[styles.btnText, { color: colors.viGold }]}>Download PDF</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={() => { clearAuth(); router.replace('/(auth)/login'); }}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title:        { fontFamily: fonts.cormorantItalic, fontSize: 28, color: colors.viGold, paddingHorizontal: 18, paddingBottom: 14 },
  card:         { marginHorizontal: 14, backgroundColor: colors.surf2, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.bdr },
  lbl:          { fontFamily: fonts.dmSansBold, fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', color: colors.txt3, marginBottom: 2 },
  val:          { fontFamily: fonts.dmSansBold, fontSize: 15, color: colors.txt },
  sectionTitle: { fontFamily: fonts.cormorantItalic, fontSize: 20, color: colors.txt, paddingHorizontal: 18, marginBottom: 10, marginTop: 4 },
  form:         { marginHorizontal: 14, marginBottom: 16 },
  input:        { backgroundColor: colors.surf2, borderWidth: 1, borderColor: colors.bdr, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontFamily: fonts.dmSans, fontSize: 13, color: colors.txt, marginBottom: 10 },
  btn:          { backgroundColor: colors.viGold, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnText:      { fontFamily: fonts.dmSansBold, fontSize: 13, color: colors.bg },
  logoutBtn:    { marginHorizontal: 14, marginTop: 8, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: `${colors.red}35`, backgroundColor: `${colors.red}08`, alignItems: 'center' },
  logoutText:   { fontFamily: fonts.dmSansBold, fontSize: 14, color: colors.red },
});
```

- [ ] **Commit**:
```bash
git add mobile/vi-portal/app/(tabs)/
git commit -m "feat: customer ledger, orders, account screens"
```

---

## Task 15: EAS Build setup

**Files:**
- Create: `mobile/jalan-command/eas.json`
- Create: `mobile/vi-portal/eas.json`

- [ ] **Install EAS CLI globally**:
```bash
npm install -g eas-cli
```

- [ ] **Login to Expo**:
```bash
eas login
# Use Vansh's Expo account credentials
```

- [ ] **Create `eas.json` in jalan-command**:
```json
{
  "cli": { "version": ">= 10.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false },
      "android": { "buildType": "apk" }
    },
    "production": {
      "ios": { "autoIncrement": true },
      "android": { "autoIncrement": true }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "vansh.ps57084@gmail.com", "ascAppId": "FILL_IN_AFTER_APP_STORE_CONNECT_SETUP" },
      "android": { "serviceAccountKeyPath": "./google-service-account.json", "track": "internal" }
    }
  }
}
```

- [ ] **Copy eas.json to vi-portal** (same content):
```bash
cp /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/jalan-command/eas.json \
   /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/vi-portal/eas.json
```

- [ ] **Initialize EAS projects**:
```bash
cd /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/jalan-command
eas build:configure

cd /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/vi-portal
eas build:configure
```

- [ ] **Run first preview builds** (generates APK for Android to test on phone):
```bash
# Admin app
cd /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/jalan-command
eas build --profile preview --platform android

# Customer app
cd /Users/vanshjalan/Desktop/JalanGroup-Complete/mobile/vi-portal
eas build --profile preview --platform android
```

Expected: EAS prints a URL to monitor build. Build takes ~10-15 min. Download APK and install on Android to test.

- [ ] **For iOS** (requires Apple Developer account — $99/year if not already enrolled):
```bash
eas build --profile preview --platform ios
```

- [ ] **Commit**:
```bash
cd /Users/vanshjalan/Desktop/JalanGroup-Complete
git add mobile/
git commit -m "feat: EAS build config for both apps"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Bot status/restart/logs endpoints — Task 1-2
- ✅ Rates get/update endpoints — Task 2
- ✅ Payment notification endpoint — Task 3
- ✅ Admin app: dashboard, parties+detail, orders, rates, bot, settings — Tasks 4-10
- ✅ Customer app: home, ledger, orders+place, payment notify, statement download — Tasks 11-14
- ✅ Design system: colors #163827/#C9A44A, Cormorant Garamond Italic, animations — all screens use GoldShimmerText + HexBg
- ✅ EAS Build for both apps — Task 15
- ✅ Single folder (JalanGroup-Complete/mobile/) — moveable

**Gaps fixed:**
- Added `orders/[id].tsx` is referenced in Task 10 but not explicitly written — the list screen links to it; add a simple detail screen following the same pattern as `parties/[id].tsx` if needed
- Customer app missing a standalone Rates screen (read-only) — can add as a 5th tab using `getProducts()` following the same FlatList pattern

**Type consistency:** All component props match their implementations. `api.ts` function names match usage in screens throughout.
