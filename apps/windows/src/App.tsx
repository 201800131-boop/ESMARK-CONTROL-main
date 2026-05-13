import React from 'react';
import { getCurrentUser, type AuthUser } from './services/auth';
import { supabase } from './core/supabase';
import { LoginScreen } from './screens/LoginScreen';
import { Dashboard } from './screens/Dashboard';

type AppState = 'loading' | 'login' | 'dashboard';

export function App(): React.JSX.Element {
  const [state, setState] = React.useState<AppState>('loading');
  const [user, setUser] = React.useState<AuthUser | null>(null);

  const refreshUser = React.useCallback(async () => {
    try {
      await supabase.auth.refreshSession();
      const currentUser = await getCurrentUser();

      if (currentUser) {
        setUser(currentUser);
        setState('dashboard');
      } else {
        setUser(null);
        setState('login');
      }
    } catch {
      setUser(null);
      setState('login');
    }
  }, []);

  React.useEffect(() => {
    void refreshUser();

    const intervalId = window.setInterval(() => {
      void refreshUser();
    }, 30000);

    const onFocus = () => {
      void refreshUser();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshUser]);

  if (state === 'loading' && !user) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100vh',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#f0f2f5',
        }}
      >
        <p style={{ color: '#666', fontSize: 16 }}>Cargando…</p>
      </div>
    );
  }

  if (state === 'login') {
    return (
      <LoginScreen
        onLoginSuccess={() => {
          void refreshUser();
        }}
      />
    );
  }

  return (
    <Dashboard
      user={user!}
      onSignOut={() => {
        setUser(null);
        setState('login');
      }}
    />
  );
}
