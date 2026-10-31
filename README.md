# Ghost

Expo (SDK 58, Expo Router) + Supabase mobile app.

## Getting started

1. Install dependencies: `npm install`
2. Configure Supabase: `cp .env.example .env.local`, then fill in the project URL and publishable key
   (or run Supabase locally with `npx supabase start`, which needs Docker, and use the URL/key it prints).
3. Start the app: `npm run ios` / `npm run android` / `npm start`

Use `npx expo install <package>` (not `npm install`) to add packages, so versions match the SDK.

Every user is anonymous: on first launch the app calls `supabase.auth.signInAnonymously()`
(`src/hooks/use-session.tsx`). Enable **Authentication → Sign In / Providers → Allow anonymous sign-ins**
in the Supabase dashboard. "Reset identity" in Settings signs out and mints a fresh anonymous user.

### Messaging

Each user gets an 8-character Ghost code (`profiles.ghost_code`, created by a trigger on sign-up).
Entering a friend's code calls `start_conversation(code)`, which opens or reuses the one-to-one chat;
codes can't be listed. Messages arrive live via Supabase Realtime. Schema and RLS:
`supabase/migrations/20261031090000_messaging.sql`; client code: `src/features/messaging/`.

### Hero avatars

Everyone gets a Marvel/DC-inspired badge picked from their Ghost code, and can choose another in
Settings (`profiles.avatar`, set via `set_avatar`; null means automatic). Badges are original
artwork; the character names in `src/features/profile/heroes.ts` are Marvel and DC trademarks, so
rename them before publishing. Migration: `supabase/migrations/20261031130000_avatars.sql`.

### Themes

Settings → Theme: System, Light, Dark, WhatsApp (beige chat background, green bubbles), Ghost
(spectral, translucent, glowing) and Stealth (anti shoulder-surfing: low contrast, messages masked as
`••••` until pressed and held). Tokens live in `src/theme/themes.ts`; screens build styles with
`useThemedStyles(createStyles)`. The choice is saved on the device.

In every theme, a blank cover (`src/theme/privacy-cover.tsx`) replaces the app whenever it isn't in
the foreground, so the app switcher snapshot never shows chats or codes.

### Photos, view once and burning

The **+** button takes a photo or picks one from the library. Photos are resized, encrypted on the
device with the chat key and uploaded as ciphertext to the private `attachments` bucket
(`<conversation_id>/<random id>`). Temporary picker/resizer files are deleted immediately, camera
shots are never saved to Photos, and decrypted images live only in memory
(`src/features/messaging/attachments.ts`).

- **View once**: the recipient can open it one time with screen capture blocked; on close it burns
  and the file is deleted (`mark_message_viewed`). Senders can't reopen it.
- **Delete for everyone**: long-press your own message. `delete_message` wipes the content and the
  file, and both phones play the burn effect (`src/features/burn-photo/burn-effect.tsx`): the
  bubble is snapshotted with Skia and burned by a shader (noisy front, white-hot rim, char), with
  embers, smoke and haptics.

Migration: `supabase/migrations/20261031120000_attachments.sql`.

### Disappearing messages, erase and screenshots

The 🔥 button in a chat's header (or tapping the contact's name) opens burn settings: a timer (off, 5s, 10s, 30s, 1 min, 1 hour)
that starts after a message is read or as soon as it's sent, and **Erase chat for everyone**.
Each new message copies the chat's timer server-side (`apply_burn_timer` trigger). Expired
messages burn on screen and are deleted by `burn_expired_messages`; a pg_cron job sweeps them
when no one has the chat open (enable pg_cron under Database → Extensions). Screenshots and
screen recordings are blocked app-wide (`src/features/security/screen-protection.tsx`).
Migration: `supabase/migrations/20261031140000_burn_timers.sql`.

### Receipts

Sent messages show ✓ (stored), grey ✓✓ (delivered to the other app) and blue ✓✓ (read). Only the
recipient can set `delivered_at` / `read_at`, through `mark_messages_delivered()` and
`mark_conversation_read()` (`supabase/migrations/20261031110000_receipts.sql`). Delivery is only
recorded while the recipient's app is open; there are no push notifications yet.

### End-to-end encryption

Messages are encrypted on the device with NaCl `box` (X25519 + XSalsa20-Poly1305, via `tweetnacl`).
Each identity's private key is created on first sign-in and kept in SecureStore
(`src/services/encryption/device-keys.ts`); only the public key is uploaded (`profiles.public_key`).
The database rejects new plaintext messages (`messages_must_be_encrypted`). Reset identity destroys
the private key. Not yet covered: key verification (safety numbers) and forward secrecy.
Migration: `supabase/migrations/20261031100000_e2e_encryption.sql`.

Sessions are stored encrypted: an AES key in SecureStore, ciphertext in AsyncStorage
(`src/services/storage/large-secure-store.ts`). Without a session, `app/_layout.tsx` renders
`src/features/security/connect-screen.tsx` instead of the router, so no route is reachable.

## Project structure

```
ghost/
├── app/                    # Routes (file-based routing)
│   ├── (auth)/             # Sign-in / sign-up flow
│   ├── (tabs)/             # Main tab navigator
│   ├── chat/               # Chat screens
│   └── settings/           # Settings screens
├── src/
│   ├── components/         # Shared UI components
│   ├── features/           # Feature modules
│   │   ├── agents/
│   │   ├── messaging/
│   │   ├── burn-mode/
│   │   ├── burn-photo/
│   │   └── security/
│   ├── services/
│   │   ├── supabase/       # Supabase client and queries
│   │   ├── encryption/     # Encryption helpers
│   │   ├── storage/        # Local/secure storage
│   │   └── sync/           # Local ↔ remote sync
│   ├── database/           # Local database schema and access
│   ├── hooks/              # Shared React hooks
│   ├── theme/              # Colors, typography, spacing
│   └── utils/              # Generic helpers
├── supabase/
│   ├── migrations/         # SQL migrations
│   └── functions/          # Edge functions
├── assets/                 # Images, fonts, icons
└── README.md
```
