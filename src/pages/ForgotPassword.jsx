import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { ArrowLeft } from 'lucide-react';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo,
      });
      if (error) throw error;
      setSent(true);
      toast({
        title: 'Check your email',
        description: 'If an account exists for that address, you will receive a reset link shortly.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not send reset email',
        description: error.message || 'Please try again later.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Forgot password — Fahari Credit Limited</title>
      </Helmet>
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-2xl shadow-black/30 border border-white/10"
        >
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Reset your password</h2>
            <p className="mt-2 text-sm text-gray-600">
              Enter your work email and we will send you a link to choose a new password.
            </p>
          </div>

          {sent ? (
            <div className="space-y-4 text-sm text-gray-600">
              <p>If an account exists for <strong>{email}</strong>, check your inbox for the reset link.</p>
              <Button asChild className="w-full">
                <Link to="/login">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          )}

          <Link
            to="/login"
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </motion.div>
      </div>
    </>
  );
};

export default ForgotPassword;
