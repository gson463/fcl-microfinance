// This file is no longer used for authentication. 
// It is kept for reference or if a non-database auth is needed again.
// The primary authentication is now handled by SupabaseAuthContext.
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const AuthContext = createContext(null);

export const useOldAuth = () => {
  return useContext(AuthContext);
};

export const OldAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  const login = (email, password) => {
    console.log("LocalStorage login is deprecated.");
    return { success: false, message: "System uses database authentication." };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('currentUser');
    navigate('/login');
  };

  const updateProfile = (updates) => {
    // This would need to be reimplemented with API calls if needed.
    return false;
  };

  const changePassword = (currentPassword, newPassword) => {
    // This would need to be reimplemented with API calls if needed.
    return { success: false, message: 'Password changes happen via database auth.'};
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, updateProfile, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
};