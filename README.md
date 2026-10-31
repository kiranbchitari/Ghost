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

Each user gets a Ghost code made of a hero name and four digits, like `Thor4821`
(`profiles.ghost_code`, created by a trigger on sign-up; matched case-insensitively). Entering a
friend's code calls `start_conversation(code)`, which opens or reuses the one-to-one chat; codes
can't be listed, and 20 wrong codes in an hour block further tries. The hero names live in both
`generate_ghost_code()` (`supabase/migrations/20261031150000_hero_codes.sql`) and
`src/features/profile/heroes.ts`; keep them in step. Messages arrive live via Supabase Realtime. Schema and RLS:
`supabase/migrations/20261031090000_messaging.sql`; client code: `src/features/messaging/`.

### Hero avatars

Everyone gets a Marvel/DC-inspired badge picked from their Ghost code, and can choose another in
Settings (`profiles.avatar`, set via `set_avatar`; null means automatic). Badges are original
artwork; the character names in `src/features/profile/heroes.ts` are Marvel and DC trademarks, so
rename them before publishing. Migration: `supabase/migrations/20261031130000_avatars.sql`.

### Themes

Settings → Theme: System, Light, Dark, WhatsApp (see below), Ghost
(spectral, translucent, glowing) and Stealth (anti shoulder-surfing: low contrast, messages masked as
`••••` until pressed and held). Tokens live in `src/theme/themes.ts`; screens build styles with
`useThemedStyles(createStyles)`. The choice is saved on the device.

The WhatsApp theme copies WhatsApp's light look closely, through an optional `chat` block on the
theme (`ChatStyle` in `themes.ts`; themes without it keep the default bubbles):

- **Bubbles:** mint and white bubbles with a tail on the first message of each run, and consecutive
  messages packed together.
- **Time and ticks:** tucked into the end of the last line when they fit, otherwise on their own line
  below. Double-check tick icons, blue once read.
- **Chat screen:** a doodle wallpaper, white date chips, a yellow encryption notice, and a composer
  floating over the wallpaper.
- **Tabs and list:** a green pill behind the active tab, and a search-style code field in the chat list.

The wallpaper doodles are original line art (`src/theme/doodles.ts`), drawn with Skia
(`src/theme/chat-wallpaper.tsx`); they are not WhatsApp's wallpaper.

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

### Panic lock

A red power button floats over every screen, including photo/settings modals
(`src/features/security/panic-button.tsx`). No confirmation, so it's fast in a panic. Drag the
button if it covers something.

- **Tap**: hides Ghost behind the Snake game. Keys are wiped from memory and every chat screen
  unmounts, exactly as when the app locks; the master key opens it again (see Game disguise).
- **Hold**: closes the app outright and kills its process so decrypted messages and keys leave
  RAM; the identity and chats are untouched. This needs the local native module
  `modules/panic-lock` (autolinked), so it works in a development build, not Expo Go (Android
  falls back to `BackHandler.exitApp()`, iOS does nothing beyond clearing in-memory keys). On
  Android the task is also removed from Recents.

### Game disguise

The app installs as **Snake** (name and pixel-art icon) and always opens as a real, playable
Snake game (`src/features/disguise/`); there is no setting to turn that off. Ghost is locked on
every launch and every time it goes to the background. While locked only the game is mounted (no
chats or panic button to give it away). Screen capture is blocked while Ghost is unlocked and
stays blocked after it locks on the way to the background until the app is opened again, because
Android takes the Recents snapshot after the app has left the screen: leaving from a chat gives a
blank thumbnail, leaving from the game shows the game. iOS also blurs its app switcher snapshot
while Ghost is unlocked. In the game, Settings → Redeem code takes the master key; anything else
is an "Invalid code". After 5 wrong keys every try fails for a minute; the count is kept in
SecureStore, so restarting the app doesn't reset it. Every lock (background, Lock now, panic) also
wipes keys, decrypted photos and open dialogs from memory. The camera and photo picker don't count
as leaving the app (on Android they are separate screens), so attaching a photo doesn't lock Ghost.

Until a master key is set, the starting key `ghost` opens Ghost, which then nudges the person to
set their own (Settings → Game disguise; `ghost` itself isn't accepted as a key). Only a salted,
stretched SHA-512 hash of the key is kept, in SecureStore (`src/services/security/master-key.ts`).
If that can't be read, nothing opens Ghost: it fails closed rather than falling back to `ghost`.

The game's Reset game data erases the scores and, out of sight, the Ghost identity with its keys
and chats, but keeps the master key: the app stays Snake, and Redeem code leads to a fresh, empty
Ghost. A forgotten key has no recovery other than reinstalling, which wipes everything and brings
back the starting key; because the iOS keychain survives an uninstall, a fresh install (no
AsyncStorage marker) drops any master key left behind. Icons are generated:
`python3 scripts/make-snake-icons.py assets` redraws `assets/icon.png`, the `android-icon-*.png`
files, the splash icon and the favicon.

### Receipts

Sent messages show ✓ (stored), grey ✓✓ (delivered to the other app) and blue ✓✓ (read). Only the
recipient can set `delivered_at` / `read_at`, through `mark_messages_delivered()` and
`mark_conversation_read()` (`supabase/migrations/20261031110000_receipts.sql`). Delivery is only
recorded while the recipient's app is open; there are no push notifications yet.

### Reactions

Double-tap a message (or hold it) to open a WhatsApp-style tray: 👍 ❤️ 😂 😮 😢 🙏, or **+** for any
emoji. Each person has one reaction per message; picking it again, or tapping the reactions under
the bubble, takes it back. The emoji is encrypted with the chat key like a message, so the server
only stores ciphertext (`message_reactions`, written through `set_reaction`). Removing a reaction
clears its ciphertext rather than deleting the row, so the change reaches the other phone through
Realtime. Deleting a message for everyone, burning it or erasing the chat removes its reactions.
Stealth masks them as `•`. Client: `src/features/messaging/use-reactions.ts`.
Migration: `supabase/migrations/20261031180000_reactions.sql`.

### Typing indicators

While the other person types, the chat header shows "typing…" and three dots bounce at the bottom
of the chat. Nothing is stored: each chat has a private Realtime broadcast channel,
`typing:<conversation_id>`, and Realtime Authorization policies on `realtime.messages` let only that
chat's two members join it. The indicator refreshes every 2.5 s while typing, stops after 4 s idle,
on send, or on leaving the app, and fades by itself after 6 s if the other phone goes quiet.
Client: `src/features/messaging/use-typing.ts`.
Migration: `supabase/migrations/20261031200000_typing_indicators.sql`.

### Drafts

Whatever is left unsent in a chat's composer (and the message it replies to) is kept per chat,
across leaving the chat and restarting the app, and shows in the chat list as **Draft:** like
WhatsApp. Drafts never leave the phone: each is sealed with NaCl `secretbox` under a per-identity key
in SecureStore, and only ciphertext is written to AsyncStorage
(`src/services/storage/encrypted-drafts.ts`). Reset identity and the game's Reset game data destroy
the key and every draft; the panic button drops the key from memory and doesn't read it back as the
chat closes.

### Editing messages

Hold one of your own text messages and tap the pencil to change it, for 5 minutes after sending.
The new text is encrypted on the phone; `edit_message` swaps the ciphertext and stamps `edited_at`,
and both phones show **Edited** next to the time. The server enforces the window (with 30 s of
grace for network lag), and only for the sender's undeleted text messages. Whatever you were typing
is set aside while you edit and comes back afterwards.
Migration: `supabase/migrations/20261031190000_message_edits.sql`.

All four degrade gracefully: until their migrations are applied, the app works as before and the
feature simply doesn't show (reacting or editing then reports the server's error).

Two later migrations are safe to paste into the SQL Editor as they are:
`20261031210000_burn_checks.sql` (burned messages can't be edited or reacted to) and
`20261031220000_harden_messages.sql`. The second makes the server set the columns only it should:
receipts, timestamps and the view-once/deleted state of new messages, so a modified app can't
fake blue ticks or dodge a burn timer. It also enforces that photos live in their own chat's
folder, gives one chat per pair even when both add each other at once, and queues the photos of
messages burned by the background sweep for the app to delete from Storage.

To apply all three from the dashboard instead of the CLI, paste
`supabase/sql-editor/2026-10-31_reactions_edits_typing.sql` into **SQL Editor** and run it. It makes
the same changes as the three migrations, in one transaction, and is safe to run more than once.

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
