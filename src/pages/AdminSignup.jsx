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
        title: "Usajili Umefanikiwa!",
        description: "Akaunti ya admin imetengenezwa. Sasa unaweza kuingia.",
      });

    } catch (error) {
      toast({
        variant: "destructive",
        title: "Usajili Umefeli",
        description: error.message || "Kuna kosa limetokea. Jaribu tena.",
      });
    } finally {
      setIsSigningUp(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Inapakia...</div>;
  }

  return (
    <>
      <Helmet>
        <title>Admin Signup - Mfumo wa Mikopo</title>
        <meta name="description" content="Sajili akaunti ya Admin" />
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
              <h2 className="text-2xl font-bold text-gray-800">Umefanikiwa Kujisajili!</h2>
              <p className="mt-4 text-gray-600">
                Akaunti yako ya admin imetengenezwa na kuthibitishwa. Sasa unaweza kuingia.
              </p>
              <Button asChild className="mt-6 w-full font-semibold">
                <Link to="/login">Nenda Kwenye Login</Link>
              </Button>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-center text-gray-800">Sajili Akaunti ya Admin</h2>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Jina Kamili</Label>
                  <Input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Barua Pepe</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Nenosiri</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full h-11 font-semibold" disabled={isSigningUp}>
                  {isSigningUp ? 'Inasajili...' : 'Sajili'}
                </Button>
              </form>
              <p className="text-center text-sm text-gray-600">
                Tayari una akaunti?{' '}
                <Link to="/login" className="font-medium text-primary hover:underline">
                  Ingia hapa
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