import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import { Upload, Loader2 } from 'lucide-react';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].substring(0, 2).toUpperCase();
}

const Profile = () => {
  const { user, effectiveRole } = useAuth();
  const { toast } = useToast();
  const photoInputRef = useRef(null);

  const [profileData, setProfileData] = useState({ full_name: '', email: '', phone_number: '', photoUrl: '' });
  const [passwordData, setPasswordData] = useState({ newPassword: '' });
  const [branchName, setBranchName] = useState('N/A');
  const [loading, setLoading] = useState(true);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoCacheBust, setPhotoCacheBust] = useState(0);

  const role = (effectiveRole || user?.user_metadata?.role || '').toString().trim().toLowerCase();
  const canUploadProfilePhoto = role === 'admin' || role === 'manager';

  const avatarSrc = useMemo(() => {
    const u = profileData.photoUrl;
    if (!u) return '';
    const base = u.split('?')[0];
    return `${base}?v=${photoCacheBust}`;
  }, [profileData.photoUrl, photoCacheBust]);

  const fetchProfileData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setProfileData({
      full_name: user.user_metadata.full_name || '',
      email: user.email || '',
      phone_number: user.phone || '',
      photoUrl: user.user_metadata.photoUrl || '',
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
    } else {
      setBranchName('N/A');
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
      data: {
        ...user.user_metadata,
        full_name: profileData.full_name,
        photoUrl: profileData.photoUrl || null,
      },
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
      password: passwordData.newPassword,
    });

    if (error) {
      toast({ title: 'Error', description: `Failed to change password. ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Password changed successfully.' });
      setPasswordData({ newPassword: '' });
    }
  };

  const handlePhotoFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    if (!canUploadProfilePhoto) {
      toast({
        title: 'Not available',
        description: 'Profile photo upload is only available for administrators and managers.',
        variant: 'destructive',
      });
      e.target.value = '';
      return;
    }

    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      toast({ title: 'Invalid file', description: 'Please use JPEG, PNG, or WebP.', variant: 'destructive' });
      e.target.value = '';
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast({ title: 'File too large', description: 'Maximum size is 2 MB.', variant: 'destructive' });
      e.target.value = '';
      return;
    }

    setUploadingPhoto(true);
    try {
      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
      const path = `${user.id}/avatar.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('profile-photos')
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });

      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('profile-photos').getPublicUrl(path);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) throw new Error('Could not get public URL for photo.');

      const { error: metaErr } = await supabase.auth.updateUser({
        data: {
          ...user.user_metadata,
          photoUrl: publicUrl,
        },
      });
      if (metaErr) throw metaErr;

      setProfileData((prev) => ({ ...prev, photoUrl: publicUrl }));
      setPhotoCacheBust((v) => v + 1);
      toast({ title: 'Photo updated', description: 'Your profile photo has been saved.' });
    } catch (err) {
      const msg = err?.message || String(err);
      toast({ title: 'Upload failed', description: msg, variant: 'destructive' });
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  if (loading || !user) {
    return (
      <DashboardLayout>
        <div className="text-center">Loading profile...</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Profile Settings">
      <div className="grid gap-8 md:grid-cols-3">
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
                  <div className="flex flex-wrap items-center gap-4">
                    <Avatar className="h-20 w-20 border border-neutral-200 dark:border-neutral-700">
                      <AvatarImage src={avatarSrc} alt="" />
                      <AvatarFallback className="bg-green-100 text-2xl font-semibold text-green-700">
                        {getInitials(profileData.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        aria-hidden
                        tabIndex={-1}
                        onChange={handlePhotoFileChange}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!canUploadProfilePhoto || uploadingPhoto}
                        onClick={() => photoInputRef.current?.click()}
                      >
                        {uploadingPhoto ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Uploading…
                          </>
                        ) : (
                          <>
                            <Upload className="mr-2 h-4 w-4" />
                            Upload photo
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  {!canUploadProfilePhoto && (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      Profile photo upload is only available for administrators and managers.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    value={profileData.full_name}
                    onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={profileData.email}
                    onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={profileData.phone_number}
                    onChange={(e) => setProfileData({ ...profileData, phone_number: e.target.value })}
                  />
                </div>
                <Button type="submit">Save changes</Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Role & Branch</CardTitle>
              <CardDescription>Your assigned role and branch.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Role</Label>
                <Input
                  value={
                    effectiveRole || user?.user_metadata?.role
                      ? (effectiveRole || user.user_metadata.role).charAt(0).toUpperCase() +
                        (effectiveRole || user.user_metadata.role).slice(1)
                      : 'N/A'
                  }
                  readOnly
                  disabled
                />
              </div>
              <div>
                <Label>Branch</Label>
                <Input value={branchName} readOnly disabled />
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
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="Enter new password"
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  />
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
