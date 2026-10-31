import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

import { supabase } from '@/services/supabase/client';

type SessionState = {
  session: Session | null;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
};

const SessionContext = createContext<SessionState>({
  session: null,
  isLoading: true,
  error: null,
  retry: () => {},
});

// Every user is anonymous: if there is no stored session, create a new
// anonymous identity. Signing out discards the identity and mints a new one.
export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const signInAnonymously = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInAnonymously();
    if (error) setError(error.message);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setSession(data.session);
        setIsLoading(false);
      } else {
        signInAnonymously();
      }
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      // Calling auth methods inside this callback can deadlock, so defer.
      if (event === 'SIGNED_OUT') setTimeout(signInAnonymously, 0);
    });

    return () => data.subscription.unsubscribe();
  }, [signInAnonymously]);

  return (
    <SessionContext.Provider value={{ session, isLoading, error, retry: signInAnonymously }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
