import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { signIn } from '../../services/auth';

export function LoginScreenAndroid(): React.JSX.Element {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function handleLogin(): Promise<void> {
    if (!email || !password) {
      Alert.alert('Error', 'Por favor ingresa tu correo y contraseña.');
      return;
    }
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Error al iniciar sesión';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ESMARK Control</Text>
      <TextInput
        style={styles.input}
        placeholder="Correo electrónico"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        placeholder="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={() => void handleLogin()}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? 'Ingresando…' : 'Ingresar'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 32,
    textAlign: 'center',
    color: '#1a1a2e',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
