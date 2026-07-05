# CoKarma Payment Reconciliation Bridge

A WhatsApp bot that lets CoKarma customers self-report payments (screenshot,
UPI reference, or cash) and routes each claim to an admin for manual bank
verification, maintaining a per-customer dues/balance ledger — without any
integration into CoKarma's own systems.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Postgres credentials.
3. Create the database: `createdb cokarma_bridge`
4. Run migrations: `npm run migrate`
5. Seed at least one admin: `node scripts/seed-admin.js <phone> "<name>"`
6. Start the bot: `npm start` (or `pm2 start ecosystem.config.js` for production)
7. Scan the printed QR code with WhatsApp (Linked Devices → Link a Device)

## Customer commands

- Any message from an unregistered number triggers a one-time name prompt.
- `PAID` starts the guided payment-report flow (amount, then proof).

## Admin commands

- `CONFIRM <claim-id>` / `REJECT <claim-id> [reason]`
- `PENDING` — list open claims
- `PENDING LINKS` — list customers not yet linked to an external reference id
- `BALANCE <name or phone>` — look up a customer's dues/paid/balance
- `IMPORT` — attach a CSV or Excel (`.xlsx`) file (columns: `name, phone_number, membership_id, description, amount_due, due_date`) to load dues or opening balances. Files over 5MB are rejected.

## Testing

`npm test` runs against `cokarma_bridge_test` (see `.env.test.example`).
Run `createdb cokarma_bridge_test && DB_NAME=cokarma_bridge_test npm run migrate` once before the first test run.

## Moving to the client's production number

Nothing in the code references a specific phone number. To switch from the
developer's number to the client's:
1. Stop the bot: `pm2 stop cokarma-bridge`
2. Delete the session: `rm -rf wa-sessions/`
3. Remove test admins: update the `admins` table (`active = false` or delete the rows)
4. Seed the client's real admin number(s): `node scripts/seed-admin.js <phone> "<name>"`
5. Restart: `pm2 start cokarma-bridge` and scan the new QR with the client's WhatsApp
