import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from "@/components/ui/use-toast";

const AdminSignup = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
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
    setIsSigningUp(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-admin-user', {
        body: { email, password, fullName },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      setSignupSuccess(true);
      toast({
        title: "Registration successful",
        description: "Admin account created. You can sign in now.",
      });

    } catch (error) {
      toast({
        variant: "destructive",
        title: "Registration failed",
        description: error.message || "Something went wrong. Please try again.",
      });
    } finally {
      setIsSigningUp(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <>
      <Helmet>
        <title>Admin Signup — Loan Management</title>
        <meta name="description" content="Register an admin account" />
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
                Your admin account has been created and verified. You can sign in now.
              </p>
              <Button asChild className="mt-6 w-full font-semibold">
                <Link to="/login">Go to login</Link>
              </Button>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-center text-gray-800">Register admin account</h2>
              <form onSubmit={handleSubmit} className="space-y-5">
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
                  />
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
