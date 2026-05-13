import React from 'react';
import { signIn } from '../services/auth';
import './LoginScreen.css';

const REMEMBER_KEY = 'esmark.rememberedCredentials';
const BRAND_LOGO_PRIMARY = 'esmark-logo.png';
const BRAND_LOGO_FALLBACK = 'esmark-logo-business.svg';

type RememberedCredentials = {
  username: string;
  password: string;
};

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps): React.JSX.Element {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [rememberCredentials, setRememberCredentials] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [logoSrc, setLogoSrc] = React.useState(BRAND_LOGO_PRIMARY);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(REMEMBER_KEY);
      if (!stored) return;

      const parsed = JSON.parse(stored) as Partial<RememberedCredentials>;
      if (typeof parsed.username === 'string') {
        setUsername(parsed.username);
      }
      if (typeof parsed.password === 'string') {
        setPassword(parsed.password);
      }
      setRememberCredentials(true);
    } catch {
      window.localStorage.removeItem(REMEMBER_KEY);
    }
  }, []);

  function persistCredentials(nextRemember: boolean): void {
    if (!nextRemember) {
      window.localStorage.removeItem(REMEMBER_KEY);
      return;
    }

    window.localStorage.setItem(
      REMEMBER_KEY,
      JSON.stringify({ username, password } satisfies RememberedCredentials),
    );
  }

  async function handleLogin(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!username || !password) {
      setError('Por favor ingresa tu usuario y contraseña.');
      return;
    }

    setLoading(true);
    try {
      persistCredentials(rememberCredentials);
      await signIn(username, password);
      onLoginSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <img
          src={logoSrc}
          alt="Logo ESMARK Media"
          className="login-brand-logo"
          onError={() => {
            if (logoSrc !== BRAND_LOGO_FALLBACK) setLogoSrc(BRAND_LOGO_FALLBACK);
          }}
        />
        <h1 className="login-title">ESMARK Control</h1>
        <p className="login-subtitle">Sistema de Gestión</p>

        <form onSubmit={(e) => void handleLogin(e)} className="login-form">
          <input
            className="login-input"
            type="text"
            placeholder="Usuario"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            disabled={loading}
          />
          <input
            className="login-input"
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
          />

          <label className="login-remember-row">
            <input
              type="checkbox"
              checked={rememberCredentials}
              onChange={(e) => {
                const nextValue = e.target.checked;
                setRememberCredentials(nextValue);
                if (!nextValue) {
                  window.localStorage.removeItem(REMEMBER_KEY);
                } else {
                  window.localStorage.setItem(
                    REMEMBER_KEY,
                    JSON.stringify({ username, password } satisfies RememberedCredentials),
                  );
                }
              }}
              disabled={loading}
            />
            <span className="login-remember-text">Recordar usuario y contraseña</span>
          </label>

          {error && <p className="login-error-text">{error}</p>}

          <button
            type="submit"
            className={`login-button${loading ? ' login-button-disabled' : ''}`}
            disabled={loading}
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
