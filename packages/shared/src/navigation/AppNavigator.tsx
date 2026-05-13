import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { getCurrentUser } from '../services/auth';
import { LoginScreenAndroid } from '../screens/login/LoginScreenAndroid';

// Lazy imports allow platform-specific resolution at runtime
const AdminDashboard = React.lazy(
  () => import('../screens/dashboard/AdminDashboard'),
);
const AreaDashboard = React.lazy(
  () => import('../screens/dashboard/AreaDashboard'),
);

type UserRole = 'admin' | 'area' | null;

export function AppNavigator(): React.JSX.Element {
  const [role, setRole] = React.useState<UserRole>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getCurrentUser()
      .then((user) => {
        // Role resolution: extend this when user profiles table is ready
        if (user) {
          setRole('area'); // default; swap to 'admin' per your auth claims
        }
      })
      .catch(() => {
        setRole(null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!role) return <LoginScreenAndroid />;

  return (
    <React.Suspense fallback={<ActivityIndicator size="large" />}>
      {role === 'admin' ? <AdminDashboard /> : <AreaDashboard />}
    </React.Suspense>
  );
}
