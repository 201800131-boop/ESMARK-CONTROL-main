import React from 'react';
import { getCurrentUser, type AuthUser } from './services/auth';
import { supabase } from './core/supabase';
import { LoginScreen } from './screens/LoginScreen';
import { Dashboard } from './screens/Dashboard';

type AppState = 'loading' | 'login' | 'dashboard';

const UPDATE_NOTICE_VERSION = 'manual-closures-v1';
const UPDATE_NOTICE_KEY = `esmark-update-notice-${UPDATE_NOTICE_VERSION}`;

export function App(): React.JSX.Element {
  const [state, setState] = React.useState<AppState>('loading');
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [showUpdateNotice, setShowUpdateNotice] = React.useState(false);

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

  React.useEffect(() => {
    if (state !== 'dashboard') return;
    const alreadySeen = window.localStorage.getItem(UPDATE_NOTICE_KEY);
    setShowUpdateNotice(alreadySeen !== 'seen');
  }, [state]);

  function closeUpdateNotice(): void {
    window.localStorage.setItem(UPDATE_NOTICE_KEY, 'seen');
    setShowUpdateNotice(false);
  }

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
    <>
      <Dashboard
        user={user!}
        onSignOut={() => {
          setUser(null);
          setState('login');
        }}
      />
      {showUpdateNotice && <UpdateNotice onClose={closeUpdateNotice} />}
    </>
  );
}

function UpdateNotice({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div style={noticeStyles.backdrop} role="dialog" aria-modal="true">
      <section style={noticeStyles.panel}>
        <div style={noticeStyles.header}>
          <span style={noticeStyles.kicker}>Actualizacion disponible</span>
          <h1 style={noticeStyles.title}>Nuevas mejoras en Reportes</h1>
          <p style={noticeStyles.text}>
            Los cierres ahora quedan bajo control manual para que administracion
            decida cuando generar y guardar cada cierre.
          </p>
        </div>

        <div style={noticeStyles.grid}>
          <NoticeItem
            title="Cierres manuales"
            text="Ya no se generan cierres automaticos. La tabla permanecera vacia hasta usar Empezar Cierre."
          />
          <NoticeItem
            title="Excel sin guardar cierre"
            text="Generar Excel ahora solo descarga el archivo y no crea registros nuevos en el historial."
          />
          <NoticeItem
            title="Acciones de cierre"
            text="Cuando exista un cierre manual, podras descargar su Excel o eliminarlo desde Acciones."
          />
        </div>

        <div style={noticeStyles.footer}>
          <button type="button" style={noticeStyles.primaryButton} onClick={onClose}>
            Entendido
          </button>
        </div>
      </section>
    </div>
  );
}

function NoticeItem({
  title,
  text,
}: {
  title: string;
  text: string;
}): React.JSX.Element {
  return (
    <article style={noticeStyles.item}>
      <div style={noticeStyles.itemMark} />
      <div>
        <h2 style={noticeStyles.itemTitle}>{title}</h2>
        <p style={noticeStyles.itemText}>{text}</p>
      </div>
    </article>
  );
}

const noticeStyles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: 'rgba(15, 23, 42, 0.56)',
    backdropFilter: 'blur(5px)',
  },
  panel: {
    width: 'min(760px, 100%)',
    maxHeight: 'calc(100vh - 48px)',
    overflow: 'auto',
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: '0 28px 80px rgba(15, 23, 42, 0.28)',
  },
  header: {
    padding: '30px 32px 20px',
    background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 52%, #0891b2 100%)',
    color: '#ffffff',
  },
  kicker: {
    display: 'block',
    marginBottom: 8,
    fontSize: 12,
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: 0,
    opacity: 0.82,
  },
  title: {
    margin: 0,
    fontSize: 28,
    lineHeight: 1.15,
    letterSpacing: 0,
  },
  text: {
    maxWidth: 620,
    margin: '12px 0 0',
    fontSize: 15,
    lineHeight: 1.6,
    color: '#dbeafe',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 12,
    padding: 24,
  },
  item: {
    display: 'flex',
    gap: 12,
    minHeight: 118,
    padding: 16,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    background: '#f8fafc',
  },
  itemMark: {
    flex: '0 0 10px',
    width: 10,
    height: 48,
    borderRadius: 999,
    background: '#0891b2',
  },
  itemTitle: {
    margin: '0 0 8px',
    color: '#0f172a',
    fontSize: 15,
    lineHeight: 1.25,
    letterSpacing: 0,
  },
  itemText: {
    margin: 0,
    color: '#475569',
    fontSize: 13,
    lineHeight: 1.5,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '0 24px 24px',
  },
  primaryButton: {
    minWidth: 130,
    padding: '11px 18px',
    border: 0,
    borderRadius: 8,
    background: '#1d4ed8',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
  },
};
