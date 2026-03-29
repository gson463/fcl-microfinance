import React, { createContext, useContext, useState, useEffect } from 'react';

const DateContext = createContext();

export const useDate = () => useContext(DateContext);

export const DateProvider = ({ children }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDate(new Date());
    }, 300000); // Update every 5 minutes to ensure date is fresh
    return () => clearInterval(timer);
  }, []);


  const setDate = (newDate) => {
    console.warn("Manually setting date is for testing purposes only and is disabled in production builds.");
  };

  const value = {
    currentDate,
    setDate, // Kept for API consistency but logic is now internal
  };

  return <DateContext.Provider value={value}>{children}</DateContext.Provider>;
};