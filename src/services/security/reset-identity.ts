import { deleteDeviceKeyPair } from '@/services/encryption/device-keys';
import { supabase } from '@/services/supabase/client';

// Ends this anonymous identity on this phone: destroys its private key (and
// drafts), then signs out, which makes the app mint a fresh identity.
//
// Signing out must not depend on the network: with an expired token and no
// connection, a normal sign-out returns an error and keeps the session, so the
// old identity would quietly survive a reset. Falls back to a local sign-out,
// which always forgets the session on this phone.
export async function resetIdentity(userId: string | undefined) {
  try {
    if (userId) await deleteDeviceKeyPair(userId);
  } catch (e) {
    console.warn('Deleting the identity key failed:', (e as Error).message);
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    const local = await supabase.auth.signOut({ scope: 'local' });
    if (local.error) throw new Error(local.error.message);
  }
}
