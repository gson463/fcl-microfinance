import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { supabase, ALLOW_ADMIN_SIGNUP } from '@/lib/customSupabaseClient';
import { validatePasswordStrength, passwordStrengthHint } from '@/lib/passwordPolicy';
import { useToast } from '@/components/ui/use-toast';

const AdminSignup = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const pwdCheck = validatePasswordStrength(password);
    if (!pwdCheck.ok) {
      toast({ variant: 'destructive', title: 'Weak password', description: pwdCheck.message });
      return;
    }
    if (!setupSecret.trim()) {
      toast({ variant: 'destructive', title: 'Setup key required', description: 'Enter the admin setup secret from your deployment.' });
      return;
    }

    setIsSigningUp(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-admin-user', {
        body: { email, password, fullName, setup_secret: setupSecret.trim() },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setSignupSuccess(true);
      toast({
        title: 'Registration successful',
        description: 'Admin account created. You can sign in now.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Registration failed',
        description: error.message || 'Something went wrong. Please try again.',
      });
    } finally {
      setIsSigningUp(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  if (!ALLOW_ADMIN_SIGNUP) {
    return (
      <>
        <Helmet>
          <title>Admin signup disabled — Loan Management</title>
        </Helmet>
        <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4">
          <div className="w-full max-w-md p-8 space-y-4 bg-white rounded-2xl shadow-2xl text-center">
            <h2 className="text-2xl font-bold text-gray-800">Admin signup is disabled</h2>
            <p className="text-sm text-gray-600">
              Create administrators with{' '}
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">scripts/create-admin-user.mjs</code>{' '}
              or enable bootstrap temporarily with <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">VITE_ALLOW_ADMIN_SIGNUP=true</code>.
            </p>
            <Button asChild className="w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>Admin Signup — Loan Management</title>
        <meta name="description" content="Register an admin account (bootstrap only)" />
      </Helmet>

      <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-2xl shadow-black/30 border border-white/10"
        >
          {signupSuccess ? (
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-800">You are registered</h2>
              <p className="mt-4 text-gray-600">
                Your admin account has been created. You can sign in now.
              </p>
              <Button asChild className="mt-6 w-full font-semibold">
                <Link to="/login">Go to login</Link>
              </Button>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-center text-gray-800">Register admin account</h2>
              <p className="text-center text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Bootstrap only — disable this route in production after the first admin exists.
              </p>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="setupSecret">Setup key</Label>
                  <Input
                    id="setupSecret"
                    type="password"
                    autoComplete="off"
                    value={setupSecret}
                    onChange={(e) => setSetupSecret(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={12}
                  />
                  <p className="text-xs text-gray-500">{passwordStrengthHint()}</p>
                </div>
                <Button type="submit" className="w-full h-11 font-semibold" disabled={isSigningUp}>
                  {isSigningUp ? 'Registering…' : 'Register'}
                </Button>
              </form>
              <p className="text-center text-sm text-gray-600">
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </motion.div>
      </div>
    </>
  );
};

export default AdminSignup;
