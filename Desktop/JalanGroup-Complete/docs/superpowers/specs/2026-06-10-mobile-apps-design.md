# Jalan Group Mobile Apps — Design Spec
**Date:** 2026-06-10  
**Status:** Approved  
**Author:** Vansh Jalan + Claude

---

## 1. Overview

Two native mobile apps built with **Expo React Native + EAS Build**, published to App Store and Google Play Store.

| App | Name | Audience | Auth |
|-----|------|----------|------|
| Admin | Jalan Command | Vansh (owner) | JWT — Owner role (mobile 9999999999) |
| Customer | Vansh Iron | Customers of VI / AS | Party auth — mobile + password |

Both apps talk to the existing backend at `api.vanshiron.com` and `portal.vanshiron.com`. No new server infrastructure required.

---

## 2. Design System

### 2.1 Colours

All colors are defined once in `src/theme/colors.ts` and referenced everywhere.

| Token | Hex | Usage |
|-------|-----|-------|
| `viGreen` | `#163827` | Letterhead forest green — card surfaces, hero backgrounds |
| `viGold` | `#C9A44A` | Letterhead champagne gold — brand name, accents, CTAs |
| `viGoldLight` | `#E4C878` | Shimmer highlight on gold |
| `bg` | `#06100A` | Deep green-black — screen background |
| `surf` | `#0A180D` | Component background |
| `surf2` | `#0F2015` | Card surface |
| `surf3` | `#14291C` | Hero card inner |
| `bdr` | `#1A3525` | Default border |
| `bdr2` | `#20402E` | Elevated border |
| `txt` | `#EAE8E0` | Primary text |
| `txt2` | `#7D8C7F` | Secondary text |
| `txt3` | `#3A4A3D` | Muted / labels |
| `red` | `#F07070` | Overdue / debit |
| `amber` | `#E8A830` | Due soon / warning |
| `ok` | `#5DC87A` | Collected / credit |

### 2.2 Typography

| Font | Style | Weight | Usage |
|------|-------|--------|-------|
| Cormorant Garamond | **Italic** | 700 | Brand name "Vansh Iron", all ₹ amounts |
| Cormorant Garamond | Italic | 600 | Section stats, mini-card values |
| DM Sans | Regular | 400–700 | All body text, labels, descriptions |

Loaded via `expo-font` / `@expo-google-fonts/cormorant-garamond` and `@expo-google-fonts/dm-sans`.

### 2.3 Animations (React Native Reanimated 3)

| Animation | Trigger | Detail |
|-----------|---------|--------|
| Gold shimmer | On mount | Linear sweep on all ₹ amount text using gradient mask |
| Hexagon float | Continuous | Brand hexagon SVG motif, slow translateY + rotation loop |
| Scan line | Continuous | Thin gold line traversing hero cards top→bottom |
| Gold glow breathe | Continuous | Brand name text shadow pulses |
| Overdue badge pulse | Continuous | Red ring pulse on all overdue tags |
| Notification dot pulse | Continuous | Gold ring pulse on bell icon when unread |
| Fade-up stagger | On mount | List items fade + translateY in sequence (100ms delay between) |
| Live ticker scroll | Continuous | Steel price ticker scrolling horizontally |

### 2.4 Brand Motifs

- **Hexagonal outline** (from VI logo) used as semi-transparent background texture on hero cards and screen backgrounds. Implemented as SVG at ~2.5% opacity, animated with float.
- **Thin gold divider lines** matching letterhead gold separator.
- Deep green-black background = digital extension of the physical letterhead.

---

## 3. Admin App — Jalan Command

### 3.1 Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Login | `/login` | Mobile + password auth, JWT stored in SecureStore |
| Dashboard | `/` | Hero card (VI + AS combined outstanding), live ticker, quick actions, activity feed |
| Parties | `/parties` | Searchable list of all customers, outstanding per party |
| Party Detail | `/parties/:id` | Ledger, balance, reminders, send WA |
| Orders | `/orders` | Active + recent orders, dispatch action |
| Order Detail | `/orders/:id` | Confirm, dispatch with truck/driver, status |
| Live Rates | `/rates` | Edit prices per product per company, save goes live instantly |
| WA Bot | `/bot` | Bot status (online/offline), restart button, last 100 log lines, live conversation feed |
| Reminders | `/reminders` | Trigger bulk reminder to all overdue, or one-off message to any party |
| Settings | `/settings` | Company switcher (VI / AS), profile, logout |

### 3.2 Key Features

**Dashboard Hero Card**
- Combined VI + AS outstanding with company badge pills
- Three stat slots: Overdue (red) / Due Soon (amber) / Collected (green)
- Gold shimmer on total amount
- Trend vs last month

**Live Price Ticker**
- Horizontal scrolling ticker at top showing current rates for all products
- Pulls from `GET /api/products` — refreshes every 5 minutes

**Quick Actions (4 buttons)**
1. Remind All — triggers bulk WA reminder to all overdue parties
2. Live Rates — jumps to rates editor
3. WA Bot — jumps to bot management
4. Orders — jumps to active orders

**WA Bot Management**
- `GET /api/bot/status` — online/offline indicator with last ping time
- `POST /api/bot/restart` — triggers PM2 restart
- `GET /api/bot/logs` — streams last 100 log lines (scrollable, auto-scroll to bottom)
- Real-time activity feed of inbound/outbound messages (polling every 10s)

**Party Detail / Ledger**
- Full ledger with date, description, debit/credit, running balance
- Date range filter (3M / 6M / FY2526 / FY2425 / All)
- Download PDF (uses existing `/api/reports/ledger`)
- Send via WhatsApp button (calls `/api/parties/:id/send-ledger`)
- Manual reminder button

### 3.3 API Endpoints Used

All existing endpoints at `api.vanshiron.com`. New endpoints required:
- `GET /api/bot/status` — bot online check
- `POST /api/bot/restart` — PM2 restart via exec
- `GET /api/bot/logs` — last 100 lines from PM2 log file

---

## 4. Customer App — Vansh Iron

### 4.1 Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Login | `/login` | Mobile number + password, party auth |
| Home | `/` | Outstanding balance hero, overdue badge, mini stats, transaction list |
| Ledger | `/ledger` | Full paginated ledger with date filter |
| Statement | `/statement` | Generate + download PDF statement for any range |
| Live Rates | `/rates` | Today's prices — read only |
| Orders | `/orders` | Place new order, track existing orders |
| Payment Notify | `/payment` | Submit UPI ref + amount to notify Jalan Group of payment made |

### 4.2 Key Features

**Balance Hero Card**
- Large italic Cormorant Garamond ₹ amount with gold shimmer
- Pulsing red overdue badge if any amount overdue
- Pulls from `GET /portal/summary`

**Ledger**
- Same date range filter as admin
- Debit in red, credit in green
- Running balance column
- Pull-to-refresh

**Payment Notification**
- Form: amount + UPI ref number + date + optional note
- Submits to `POST /portal/payment-notification`
- This creates a pending record; admin sees it in dashboard activity feed

**Order Placement**
- Select product (TMT / Pipe / Sheet etc.), specify quantity
- Order confirmed via `POST /portal/orders`
- Status tracking: Placed → Confirmed → Dispatched

### 4.3 API Endpoints Used

All existing endpoints at `portal.vanshiron.com`. No new endpoints required for customer app.

---

## 5. Technical Architecture

### 5.1 Project Structure

```
mobile/
  admin/                    # Expo app — Jalan Command
    app/                    # Expo Router file-based routes
    src/
      components/           # Shared UI components
      theme/
        colors.ts           # Single source of truth for all colors
        typography.ts       # Font config
        animations.ts       # Reanimated shared animation hooks
      api/                  # API client (axios + react-query)
      store/                # Zustand for auth state
    assets/
      fonts/                # Cormorant Garamond + DM Sans
      vi-hex.svg            # Brand hexagon motif

  customer/                 # Expo app — Vansh Iron portal
    (same structure)
```

### 5.2 Key Libraries

| Library | Purpose |
|---------|---------|
| Expo SDK 52 | Base framework |
| Expo Router | File-based navigation |
| React Native Reanimated 3 | All animations |
| React Native Skia | Shimmer + glow effects |
| @expo-google-fonts | Cormorant Garamond + DM Sans |
| React Query (TanStack) | API data fetching + caching |
| Zustand | Auth state management |
| Expo SecureStore | JWT token storage |
| Expo FileSystem | PDF download |
| EAS Build | App Store + Play Store builds |

### 5.3 Backend Changes Required

Three new endpoints in `src/routes/api.js`:

```js
// Bot management
GET  /api/bot/status   → { online: bool, lastEvent: timestamp, uptime: string }
POST /api/bot/restart  → { success: bool } (runs: pm2 restart jalan-whatsapp)
GET  /api/bot/logs     → { lines: string[] } (last 100 lines from logs/whatsapp.log)
```

### 5.4 Auth Flow

**Admin app:** Uses existing `/api/auth/login` with `{ mobile, password }`. Returns JWT. Stored in `expo-secure-store`. All requests use `Authorization: Bearer <token>`.

**Customer app:** Uses existing `/portal/auth/login` with `{ mobile, password }`. Returns party JWT. Same storage pattern.

---

## 6. App Store Publishing

| | Admin | Customer |
|-|-------|----------|
| App name | Jalan Command | Vansh Iron |
| Bundle ID (iOS) | `com.jalangroup.command` | `com.jalangroup.portal` |
| Package (Android) | `com.jalangroup.command` | `com.jalangroup.portal` |
| Distribution | App Store + Play Store | App Store + Play Store |
| Build tool | EAS Build | EAS Build |

EAS config (`eas.json`) with `production` profile for both.

---

## 7. What Can Be Changed Later

Everything visual is in `src/theme/`:
- **Colors**: Change `viGold` to anything — updates across both apps instantly
- **Fonts**: Swap font family in `typography.ts` — one line
- **Animations**: Each animation is an isolated hook — disable, tweak timing, or remove individually
- **Screen layout**: Each screen is a standalone component — redesign any screen without touching others

---

## 8. Build Order

1. Add 3 bot management endpoints to backend (`api.js`) + push to GitHub
2. Scaffold both Expo projects with shared theme
3. Build Admin app screens (Dashboard → Bot → Parties → Orders → Rates)
4. Build Customer app screens (Home → Ledger → Statement → Rates → Orders → Payment)
5. EAS Build setup + test builds
6. App Store + Play Store submission
