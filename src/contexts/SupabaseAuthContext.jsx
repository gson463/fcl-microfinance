
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { logAudit } from '@/lib/auditLog';

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

  // Centralized session handler to ensure state consistency
  const handleSession = useCallback((currentSession) => {
    if (currentSession) {
      setSession(currentSession);
      setUser(currentSession.user ?? null);
    } else {
      setSession(null);
      setUser(null);
    }
    setLoading(false);
  }, []);

  // Function to clear auth state completely
  const clearAuthState = useCallback(async () => {
    try {
      // Attempt to sign out from Supabase to clear local storage tokens
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Error clearing auth state:", error);
    } finally {
      handleSession(null);
    }
  }, [handleSession]);

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
          // Clear state immediately
          handleSession(null);
        } else if (event === 'TOKEN_REFRESHED') {
          console.log('Token refreshed successfully');
          handleSession(newSession);
        } else if (event === 'SIGNED_IN') {
          handleSession(newSession);
          void logAudit({ action: 'auth.login' }, newSession);
        } else if (event === 'USER_UPDATED') {
          handleSession(newSession);
        } else if (event === 'INITIAL_SESSION') {
           handleSession(newSession);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [handleSession, clearAuthState]);

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

      return { data, error: null };
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Sign in Failed",
        description: error.message || "Something went wrong",
      });
      return { error };
    }
  }, [toast]);

  const signOut = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await logAudit({ action: 'auth.logout' });
      }
    } catch {
      /* still sign out */
    }
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
          await signOut();
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

  const value = useMemo(() => ({
    user,
    session,
    loading,
    signUp,
    signIn,
    signOut,
  }), [user, session, loading, signUp, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
