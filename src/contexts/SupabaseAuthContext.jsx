
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { logAudit } from '@/lib/auditLog';
import { clearAdminImpersonationBackup } from '@/lib/adminImpersonation';
import {
	clearSessionLocation,
	isGpsExemptEmail,
	isSessionLocationReady,
	getSessionLocation,
	SESSION_LOCATION_MESSAGES,
} from '@/lib/geolocation';

/** Sign out after this long with no user input (mouse, keyboard, scroll, touch, wheel, focus). */
const IDLE_SESSION_MS = 5 * 60 * 1000;
const IDLE_ACTIVITY_THROTTLE_MS = 1000;

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  /** Row in public.users — source of truth for role when JWT user_metadata is missing/stale. */
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const pendingLoginAuditRef = useRef(false);

  const validateSignedInUser = useCallback(async (authUser) => {
    if (!authUser) {
      return { ok: false, message: 'Not authenticated' };
    }
    const confirmed = authUser.email_confirmed_at ?? authUser.confirmed_at;
    if (!confirmed) {
      return { ok: false, message: 'Please verify your email before signing in.' };
    }
    const { data: row, error } = await supabase
      .from('users')
      .select('is_active')
      .eq('id', authUser.id)
      .maybeSingle();
    if (error) {
      console.error('Auth eligibility check failed:', error.message);
    }
    if (row?.is_active === false) {
      return { ok: false, message: 'Your account has been deactivated. Contact an administrator.' };
    }
    return { ok: true };
  }, []);

  // Centralized session handler to ensure state consistency
  const handleSession = useCallback((currentSession) => {
    if (currentSession) {
      setSession(currentSession);
      setUser(currentSession.user ?? null);
    } else {
      setSession(null);
      setUser(null);
      setProfile(null);
    }
    setLoading(false);
  }, []);

  const rejectIneligibleSession = useCallback(async (message) => {
    await supabase.auth.signOut();
    handleSession(null);
    return { error: new Error(message) };
  }, [handleSession]);

  // Function to clear auth state completely
  const clearAuthState = useCallback(async () => {
    try {
      clearSessionLocation();
      // Attempt to sign out from Supabase to clear local storage tokens
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Error clearing auth state:", error);
    } finally {
      clearAdminImpersonationBackup();
      handleSession(null);
    }
  }, [handleSession]);

  const requireSessionGpsOrSignOut = useCallback(async (authSession, reason) => {
    const email = authSession?.user?.email;
    if (!authSession?.user || isGpsExemptEmail(email)) {
      return true;
    }
    if (!isSessionLocationReady()) {
      // ConsentGate captures session verification after sign-in; do not sign out on init.
      if (reason === 'init') {
        return true;
      }
      toast({
        variant: 'destructive',
        title: 'Session ended',
        description: SESSION_LOCATION_MESSAGES.NOT_READY,
      });
      await clearAuthState();
      navigate('/login', { replace: true });
      return false;
    }
    return true;
  }, [clearAuthState, navigate, toast]);

  const completeLoginAudit = useCallback(async () => {
    if (!pendingLoginAuditRef.current) return;
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession?.access_token) return;
    pendingLoginAuditRef.current = false;
    try {
      const loc = getSessionLocation();
      await logAudit(
        {
          action: 'auth.login',
          metadata: {
            email: currentSession?.user?.email ?? null,
            gps_captured_at: loc?.capturedAt ?? null,
          },
          location: loc,
        },
        currentSession,
      );
    } catch (e) {
      console.warn('[audit login]', e);
      throw e;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        // Check for existing session
        const { data: { session: initialSession }, error } = await supabase.auth.getSession();

        if (error) {
          console.error('Error getting session during initialization:', error.message);
          // If getSession fails (e.g., invalid refresh token), clear everything
          if (mounted) {
             await clearAuthState();
          }
        } else {
          if (mounted) {
            if (initialSession?.user) {
              const eligible = await validateSignedInUser(initialSession.user);
              if (!eligible.ok) {
                await clearAuthState();
                return;
              }
              const gpsOk = await requireSessionGpsOrSignOut(initialSession, 'init');
              if (!gpsOk) {
                return;
              }
            }
            handleSession(initialSession);
          }
        }
      } catch (error) {
        console.error('Unexpected auth initialization error:', error);
        if (mounted) {
          await clearAuthState();
        }
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        console.log('Auth state changed:', event);
        
        if (!mounted) return;

        if (event === 'SIGNED_OUT') {
          pendingLoginAuditRef.current = false;
          handleSession(null);
        } else if (event === 'TOKEN_REFRESHED') {
          console.log('Token refreshed successfully');
          handleSession(newSession);
        } else if (event === 'SIGNED_IN') {
          const eligible = await validateSignedInUser(newSession?.user);
          if (!eligible.ok) {
            toast({
              variant: 'destructive',
              title: 'Sign in blocked',
              description: eligible.message,
            });
            await clearAuthState();
            return;
          }
          handleSession(newSession);
          if (isGpsExemptEmail(newSession?.user?.email)) {
            try {
              await logAudit(
                {
                  action: 'auth.login',
                  metadata: { email: newSession?.user?.email ?? null },
                },
                newSession,
              );
            } catch (e) {
              console.warn('[audit login]', e);
            }
          } else {
            pendingLoginAuditRef.current = true;
          }
        } else if (event === 'USER_UPDATED') {
          handleSession(newSession);
        } else if (event === 'INITIAL_SESSION') {
          if (newSession?.user) {
            const gpsOk = await requireSessionGpsOrSignOut(newSession, 'init');
            if (!gpsOk) return;
          }
           handleSession(newSession);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [handleSession, clearAuthState, validateSignedInUser, toast, requireSessionGpsOrSignOut]);

  useEffect(() => {
    if (!user?.id) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from('users')
        .select('role, branch_id, full_name, is_active')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('Auth profile fetch failed:', error.message);
        setProfile(null);
      } else if (data?.is_active === false) {
        toast({
          variant: 'destructive',
          title: 'Account deactivated',
          description: 'Your session was ended because this account is inactive.',
        });
        await clearAuthState();
        navigate('/login', { replace: true });
      } else {
        setProfile(data ?? null);
      }
      setProfileLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, clearAuthState, navigate, toast]);

  const effectiveRole = useMemo(() => {
    const r = profile?.role ?? user?.user_metadata?.role;
    return typeof r === 'string' && r ? r : null;
  }, [profile?.role, user?.user_metadata?.role]);

  const signUp = useCallback(async (email, password, options) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options,
      });

      if (error) {
        toast({
          variant: "destructive",
          title: "Sign up Failed",
          description: error.message || "Something went wrong",
        });
        return { error };
      }

      return { data, error: null };
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Sign up Failed",
        description: error.message || "Something went wrong",
      });
      return { error };
    }
  }, [toast]);

  const signIn = useCallback(async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast({
          variant: "destructive",
          title: "Sign in Failed",
          description: error.message || "Something went wrong",
        });
        return { error };
      }

      const eligible = await validateSignedInUser(data.user);
      if (!eligible.ok) {
        toast({
          variant: 'destructive',
          title: 'Sign in blocked',
          description: eligible.message,
        });
        return rejectIneligibleSession(eligible.message);
      }

      return { data, error: null };
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Sign in Failed",
        description: error.message || "Something went wrong",
      });
      return { error };
    }
  }, [toast, validateSignedInUser, rejectIneligibleSession]);

  const signOut = useCallback(async (options = {}) => {
    const reason = options?.reason ?? 'manual';
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await logAudit({ action: 'auth.logout', metadata: { reason } });
      }
    } catch {
      /* still sign out */
    }
    clearSessionLocation();
    await clearAuthState();
  }, [clearAuthState]);

  useEffect(() => {
    if (!session) return;

    let timeoutId;
    let lastThrottle = 0;

    const armTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        void (async () => {
          await signOut({ reason: 'idle_timeout' });
          toast({
            title: 'Session ended',
            description: 'You were signed out after 5 minutes of inactivity.',
          });
          navigate('/login', { replace: true });
        })();
      }, IDLE_SESSION_MS);
    };

    const onActivity = () => {
      const now = Date.now();
      if (now - lastThrottle < IDLE_ACTIVITY_THROTTLE_MS) return;
      lastThrottle = now;
      armTimer();
    };

    armTimer();
    const passiveOpts = { passive: true };
    const passiveEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'wheel'];
    passiveEvents.forEach((e) => window.addEventListener(e, onActivity, passiveOpts));
    window.addEventListener('focus', onActivity);

    return () => {
      clearTimeout(timeoutId);
      passiveEvents.forEach((e) => window.removeEventListener(e, onActivity, passiveOpts));
      window.removeEventListener('focus', onActivity);
    };
  }, [session, signOut, navigate, toast]);

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      profile,
      profileLoading,
      effectiveRole,
      signUp,
      signIn,
      signOut,
      completeLoginAudit,
    }),
    [user, session, loading, profile, profileLoading, effectiveRole, signUp, signIn, signOut, completeLoginAudit],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
