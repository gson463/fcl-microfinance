import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { validatePasswordStrength, passwordStrengthHint } from '@/lib/passwordPolicy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ready, setReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (mounted) {
        setReady(!!session);
      }
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setReady(true);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const check = validatePasswordStrength(password);
    if (!check.ok) {
      toast({ variant: 'destructive', title: 'Weak password', description: check.message });
      return;
    }
    if (password !== confirm) {
      toast({ variant: 'destructive', title: 'Passwords do not match', description: 'Please re-enter the same password.' });
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({ title: 'Password updated', description: 'You can sign in with your new password.' });
      await supabase.auth.signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not update password',
        description: error.message || 'The reset link may have expired.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Set new password — Fahari Credit Limited</title>
      </Helmet>
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-2xl shadow-black/30 border border-white/10"
        >
          {!ready ? (
            <div className="space-y-4 text-center">
              <h2 className="text-xl font-bold text-gray-800">Invalid or expired link</h2>
              <p className="text-sm text-gray-600">
                Request a new password reset from the sign-in page.
              </p>
              <Button asChild className="w-full">
                <Link to="/forgot-password">Request reset link</Link>
              </Button>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Choose a new password</h2>
                <p className="mt-2 text-sm text-gray-600">{passwordStrengthHint()}</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={12}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={12}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving…' : 'Update password'}
                </Button>
              </form>
            </>
          )}
        </motion.div>
      </div>
    </>
  );
};

export default ResetPassword;
