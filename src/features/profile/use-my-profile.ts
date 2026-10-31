import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { getMyProfile, setAvatar as setAvatarRpc, type MyProfile } from '@/features/messaging/api';
import { heroFor } from '@/features/profile/heroes';
import { useSession } from '@/hooks/use-session';

// One shared copy of the signed-in user's profile, so the Chats card and
// Settings update together when the avatar changes.
type State = { userId: string | null; profile: MyProfile | null; error: string | null };

let state: State = { userId: null, profile: null, error: null };
const listeners = new Set<() => void>();

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMyProfile() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const { profile, error, userId: loadedFor } = useSyncExternalStore(subscribe, () => state);

  useEffect(() => {
    if (!userId || loadedFor === userId) return;
    // A new identity (e.g. after Reset identity) starts from scratch.
    setState({ userId, profile: null, error: null });
    getMyProfile()
      .then((loaded) => state.userId === userId && setState({ profile: loaded }))
      .catch((e: Error) => state.userId === userId && setState({ error: e.message }));
  }, [userId, loadedFor]);

  const setAvatar = useCallback(async (avatar: string | null) => {
    const previous = state.profile;
    if (previous) setState({ profile: { ...previous, avatar } });
    try {
      await setAvatarRpc(avatar);
    } catch (e) {
      setState({ profile: previous });
      throw e;
    }
  }, []);

  const current = loadedFor === userId ? profile : null;
  return {
    code: current?.ghost_code ?? null,
    avatar: current?.avatar ?? null,
    hero: current ? heroFor(current.avatar, current.ghost_code) : null,
    error: loadedFor === userId ? error : null,
    setAvatar,
  };
}
