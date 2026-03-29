
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { logAudit } from '@/lib/auditLog';

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

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
