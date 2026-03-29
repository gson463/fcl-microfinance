export const initializeDefaultData = () => {
  if (!localStorage.getItem('users')) {
    const defaultUsers = [
      {
        id: '1',
        name: 'System Admin',
        email: 'admin@microfinance.com',
        password: 'admin123',
        role: 'admin',
        phone: '+1234567890',
        status: 'active',
        createdAt: new Date().toISOString()
      }
    ];
    localStorage.setItem('users', JSON.stringify(defaultUsers));
  }

  if (!localStorage.getItem('branches')) {
    localStorage.setItem('branches', JSON.stringify([]));
  }

  if (!localStorage.getItem('loanProducts')) {
    localStorage.setItem('loanProducts', JSON.stringify([]));
  }

  if (!localStorage.getItem('centers')) {
    localStorage.setItem('centers', JSON.stringify([]));
  }

  if (!localStorage.getItem('groups')) {
    localStorage.setItem('groups', JSON.stringify([]));
  }

  if (!localStorage.getItem('borrowers')) {
    localStorage.setItem('borrowers', JSON.stringify([]));
  }

  if (!localStorage.getItem('loans')) {
    localStorage.setItem('loans', JSON.stringify([]));
  }

  if (!localStorage.getItem('repayments')) {
    localStorage.setItem('repayments', JSON.stringify([]));
  }

  if (!localStorage.getItem('expenses')) {
    localStorage.setItem('expenses', JSON.stringify([]));
  }

  if (!localStorage.getItem('loanHistory')) {
    localStorage.setItem('loanHistory', JSON.stringify([]));
  }
};