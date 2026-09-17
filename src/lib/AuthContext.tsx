import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './types';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
  signUp: (username: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function usernameToEmail(username: string): string {
  const clean = username.trim().toLowerCase().replace(/\s+/g, '_');
  return `${clean}@monitor.local`;
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
  return data as Profile | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshProfile() {
    if (user) {
      const p = await fetchProfile(user.id);
      setProfile(p);
    }
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile(s.user.id).then((p) => {
          if (mounted) {
            setProfile(p);
            setLoading(false);
          }
        });
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (!s?.user) {
        setProfile(null);
        setLoading(false);
      } else {
        (async () => {
          let p = await fetchProfile(s.user.id);
          if (!p) {
            await new Promise((r) => setTimeout(r, 500));
            p = await fetchProfile(s.user.id);
          }
          if (mounted) {
            setProfile(p);
            setLoading(false);
          }
        })();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (username: string, password: string) => {
    const email = usernameToEmail(username);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Not signed in yet, so this goes through the anon/login_failed policy (no user_id).
      await supabase.from('audit_logs').insert({
        action: 'login_failed',
        entity_type: 'auth',
        new_data: { username: username.trim() },
      });
      return { error: error.message };
    }
    if (data.user) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.user.id).maybeSingle();
      await supabase.from('audit_logs').insert({
        user_id: data.user.id,
        user_name: prof?.full_name || username,
        action: 'login',
        entity_type: 'auth',
        entity_id: data.user.id,
      });
    }
    return { error: null };
  };

  const signUp = async (username: string, password: string, fullName: string) => {
    // Call edge function which uses service role key to bypass password strength check
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        username: username.trim(),
        password,
        fullName: fullName.trim(),
      }),
    });

    const result = await response.json();
    if (!response.ok || result.error) {
      return { error: result.error || `Request failed (${response.status})` };
    }

    // Auto sign in after successful creation
    const email = usernameToEmail(username);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) return { error: signInError.message };

    return { error: null };
  };

  const signOut = async () => {
    if (user && profile) {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        user_name: profile.full_name,
        action: 'logout',
        entity_type: 'auth',
        entity_id: user.id,
      });
    }
    await supabase.auth.signOut();
    setProfile(null);
    setUser(null);
    setSession(null);
  };

  // Auto sign-out after 5 minutes of no user activity.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  useEffect(() => {
    if (!user) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }

    let lastReset = 0;
    function resetIdleTimer() {
      const now = Date.now();
      if (now - lastReset < 1000) return; // throttle: at most once per second
      lastReset = now;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        signOutRef.current();
      }, IDLE_TIMEOUT_MS);
    }

    const events: (keyof WindowEventMap)[] = [
      'mousemove', 'mousedown', 'keydown', 'touchstart', 'touchmove',
      'scroll', 'click', 'wheel', 'input', 'change', 'focusin',
    ];
    events.forEach((evt) => window.addEventListener(evt, resetIdleTimer, { passive: true }));
    resetIdleTimer();

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [user]);

  return (
    <AuthContext.Provider
      value={{ user, profile, session, loading, signIn, signUp, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
