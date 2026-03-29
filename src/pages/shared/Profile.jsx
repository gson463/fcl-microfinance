import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { motion } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Upload } from 'lucide-react';

const Profile = () => {
  const { user, session } = useAuth();
  const { toast } = useToast();
  
  const [profileData, setProfileData] = useState({ full_name: '', email: '', phone_number: '', photoUrl: '' });
  const [passwordData, setPasswordData] = useState({ newPassword: '' });
  const [branchName, setBranchName] = useState('N/A');
  const [loading, setLoading] = useState(true);

  const fetchProfileData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    // The user object from useAuth already contains the necessary info
    setProfileData({
      full_name: user.user_metadata.full_name || '',
      email: user.email || '',
      phone_number: user.phone || '',
      photoUrl: user.user_metadata.photoUrl || ''
    });

    if (user.user_metadata.branch_id) {
        const { data: branchData, error } = await supabase
            .from('branches')
            .select('name')
            .eq('id', user.user_metadata.branch_id)
            .single();
        if (error) {
            console.error('Error fetching branch name:', error);
        } else {
            setBranchName(branchData.name);
        }
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchProfileData();
  }, [fetchProfileData]);

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({
        email: profileData.email,
        phone: profileData.phone_number,
        data: { full_name: profileData.full_name }
    });

    if (error) {
      toast({ title: 'Error', description: `Failed to update profile. ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Profile updated successfully. You may need to refresh to see all changes.' });
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (!passwordData.newPassword) {
        toast({ title: 'Error', description: 'New password cannot be empty.', variant: 'destructive' });
        return;
    }
    const { error } = await supabase.auth.updateUser({
      password: passwordData.newPassword
    });

    if (error) {
      toast({ title: 'Error', description: `Failed to change password. ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Password changed successfully.' });
      setPasswordData({ newPassword: '' });
    }
  };
  
  const handlePhotoUpload = () => {
    toast({
      title: '🚧 Feature Not Implemented',
      description: 'Profile photo upload is not yet available. 🚀',
    });
  }
  
  const getInitials = (name) => {
    if (!name) return 'U';
    const parts = name.split(' ');
    if (parts.length > 1) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  };
  
  if (loading || !user) {
    return <DashboardLayout><div className="text-center">Loading profile...</div></DashboardLayout>
  }

  return (
    <DashboardLayout title="Profile Settings">
      <div className="grid gap-8 md:grid-cols-3">
        {/* Profile Info Card */}
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>Update your personal details here.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleProfileUpdate} className="space-y-4">
                 <div className="space-y-2">
                  <Label>Profile Photo</Label>
                  <div className="flex items-center space-x-4">
                    <Avatar className="h-20 w-20">
                      <AvatarImage src={profileData.photoUrl} alt={profileData.full_name} />
                      <AvatarFallback className="bg-green-100 text-green-700 font-semibold text-2xl">{getInitials(profileData.full_name)}</AvatarFallback>
                    </Avatar>
                    <Button type="button" variant="outline" onClick={handlePhotoUpload}>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Photo
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input id="name" value={profileData.full_name} onChange={e => setProfileData({ ...profileData, full_name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={profileData.email} onChange={e => setProfileData({ ...profileData, email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={profileData.phone_number} onChange={e => setProfileData({ ...profileData, phone_number: e.target.value })} />
                </div>
                <Button type="submit">Save Changes</Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>

        {/* Other Info & Password */}
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle>Role & Branch</CardTitle>
                    <CardDescription>Your assigned role and branch.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label>Role</Label>
                        <Input value={user.user_metadata.role ? (user.user_metadata.role.charAt(0).toUpperCase() + user.user_metadata.role.slice(1)) : 'N/A'} readOnly disabled/>
                    </div>
                     <div>
                        <Label>Branch</Label>
                        <Input value={branchName} readOnly disabled/>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                <CardTitle>Change Password</CardTitle>
                <CardDescription>Enter a new password to update it.</CardDescription>
                </CardHeader>
                <CardContent>
                <form onSubmit={handlePasswordChange} className="space-y-4">
                    <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input id="newPassword" type="password" placeholder="Enter new password" value={passwordData.newPassword} onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })} />
                    </div>
                    <Button type="submit">Update Password</Button>
                </form>
                </CardContent>
            </Card>
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default Profile;