import React from 'react';
import { getCurrentUser, type AuthUser } from './services/auth';
import { cleanupBackedUpRecords, createAdminBackup } from './services/admin-backup';
import { supabase } from './core/supabase';
import { LoginScreen } from './screens/LoginScreen';
import { Dashboard } from './screens/Dashboard';

type AppState = 'loading' | 'login' | 'dashboard';

const UPDATE_NOTICE_VERSION = 'cloud-supabase-v1-0-42';
const UPDATE_NOTICE_KEY = `esmark-update-notice-${UPDATE_NOTICE_VERSION}`;
const SUPABASE_SPACE_NOTICE_KEY = 'esmark.supabaseSpace.last90Notice';
const SUPABASE_SPACE_CHECK_MS = 30 * 60 * 1000;
const SUPABASE_SPACE_NOTICE_MS = 24 * 60 * 60 * 1000;
const MANDATORY_BACKUP_KEY = 'esmark.adminBackup.lastMandatoryDownload.v1';
const MANDATORY_BACKUP_INTERVAL_MS = 15 * 24 * 60 * 60 * 1000;
const MANDATORY_BACKUP_CHECK_MS = 15 * 60 * 1000;

type ClosureNotice = {
  id: string;
  title: string;
  text: string;
};

type ClosureNotificationRow = {
  area?: string | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  created_at?: string | null;
};

type SupabaseSpaceUsage = {
  success?: boolean;
  error?: string;
  database_mb?: number;
  limit_mb?: number;
  percent_used?: number;
  warning?: boolean;
};

function normalizeAreaCode(area?: string | null): string {
  return String(area ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function formatDate(value?: string | null): string {
  if (!value) return '';
  const [datePart] = String(value).split('T');
  return datePart;
}

function formatClosureNotice(row: ClosureNotificationRow, isAdmin: boolean): ClosureNotice {
  const from = formatDate(row.fecha_inicio);
  const to = formatDate(row.fecha_fin);
  const range = from && to ? `${from} al ${to}` : 'rango registrado';
  const area = normalizeAreaCode(row.area);
  const areaLabel = area ? area.replace(/_/g, ' ') : '';
  const areaText = isAdmin && areaLabel ? ` (${areaLabel})` : '';

  return {
    id: `${row.created_at ?? Date.now()}-${row.fecha_inicio ?? ''}-${row.fecha_fin ?? ''}-${area}`,
    title: 'Cierre de mes realizado',
    text: `Se generó el cierre${areaText}: ${range}.`,
  };
}

function sendBrowserNotification(title: string, body: string): void {
  if (!('Notification' in window) || window.Notification.permission !== 'granted') return;
  try {
    new window.Notification(title, { body });
  } catch {
    // La notificación visual dentro de la app sigue activa aunque el sistema la rechace.
  }
}

function shouldNotifySupabaseSpace(): boolean {
  const raw = window.localStorage.getItem(SUPABASE_SPACE_NOTICE_KEY);
  if (!raw) return true;
  const last = new Date(raw);
  if (Number.isNaN(last.getTime())) return true;
  return Date.now() - last.getTime() >= SUPABASE_SPACE_NOTICE_MS;
}

function isMandatoryBackupDue(): boolean {
  const raw = window.localStorage.getItem(MANDATORY_BACKUP_KEY);
  if (!raw) return true;
  const lastDownload = new Date(raw);
  if (Number.isNaN(lastDownload.getTime())) return true;
  const elapsed = Date.now() - lastDownload.getTime();
  return elapsed < 0 || elapsed >= MANDATORY_BACKUP_INTERVAL_MS;
}

export function App(): React.JSX.Element {
  const [state, setState] = React.useState<AppState>('loading');
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [showUpdateNotice, setShowUpdateNotice] = React.useState(false);
  const [closureNotice, setClosureNotice] = React.useState<ClosureNotice | null>(null);
  const [spaceNotice, setSpaceNotice] = React.useState<ClosureNotice | null>(null);
  const [backupNotice, setBackupNotice] = React.useState<ClosureNotice | null>(null);
  const lastClosureNoticeKey = React.useRef<string | null>(null);
  const backedUpAdminRef = React.useRef<string | null>(null);
  const adminBackupInFlightRef = React.useRef(false);

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

  React.useEffect(() => {
    if (state !== 'dashboard' || !user) return;

    const userArea = normalizeAreaCode(user.area);
    const isAdmin = user.role === 'admin';
    const channel = supabase
      .channel(`closure-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'reportes_generados',
          ...(isAdmin || !userArea ? {} : { filter: `area=eq.${userArea}` }),
        },
        (payload) => {
          const row = (payload.new ?? {}) as ClosureNotificationRow;
          const notice = formatClosureNotice(row, isAdmin);
          const groupedKey = `${row.fecha_inicio ?? ''}-${row.fecha_fin ?? ''}`;

          if (isAdmin && lastClosureNoticeKey.current === groupedKey) return;
          lastClosureNoticeKey.current = groupedKey;

          setClosureNotice(notice);
          sendBrowserNotification(notice.title, notice.text);
          window.setTimeout(() => {
            setClosureNotice((current) => (current?.id === notice.id ? null : current));
          }, 8000);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [state, user]);

  React.useEffect(() => {
    if (state !== 'dashboard' || !user || user.role !== 'admin') return;

    let active = true;

    async function checkSupabaseSpace(): Promise<void> {
      const { data, error } = await supabase.rpc('obtener_uso_espacio_supabase');
      if (!active || error) return;

      const usage = data as SupabaseSpaceUsage | null;
      if (!usage?.success || !usage.warning || !shouldNotifySupabaseSpace()) return;

      const percent = Number(usage.percent_used ?? 0).toFixed(2);
      const used = Number(usage.database_mb ?? 0).toFixed(2);
      const limit = Number(usage.limit_mb ?? 0).toFixed(0);
      const notice = {
        id: `supabase-space-${Date.now()}`,
        title: 'Supabase cerca del límite',
        text: `La base está usando ${percent}% del espacio configurado (${used} MB de ${limit} MB). Haz respaldo y revisa el plan.`,
      };

      window.localStorage.setItem(SUPABASE_SPACE_NOTICE_KEY, new Date().toISOString());
      setSpaceNotice(notice);
      sendBrowserNotification(notice.title, notice.text);
    }

    void checkSupabaseSpace();
    const intervalId = window.setInterval(() => {
      void checkSupabaseSpace();
    }, SUPABASE_SPACE_CHECK_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [state, user]);

  React.useEffect(() => {
    if (state !== 'dashboard' || !user || user.role !== 'admin') return;
    const adminUser = user;
    let active = true;

    async function runAdminBackup(alwaysStore: boolean): Promise<void> {
      const downloadToDevice = isMandatoryBackupDue();
      if ((!alwaysStore && !downloadToDevice) || adminBackupInFlightRef.current) return;

      adminBackupInFlightRef.current = true;
      try {
        const result = await createAdminBackup(adminUser, {
          downloadToDevice,
          reason: downloadToDevice ? 'mandatory-15-days' : 'admin-login',
        });
        if (!active) return;

        let cleanupText = '';
        if (result.downloadedToDevice) {
          const cleanupResult = await cleanupBackedUpRecords(adminUser);
          if (!active) return;
          window.localStorage.setItem(MANDATORY_BACKUP_KEY, new Date().toISOString());
          cleanupText = ` Limpieza segura: ${cleanupResult.total_deleted ?? 0} registros anteriores a ${cleanupResult.cutoff_date ?? 'la fecha limite'}.`;
        }
        const notice = result.downloadedToDevice
          ? {
              id: `admin-backup-download-${Date.now()}`,
              title: 'Respaldo obligatorio descargado',
              text: `Se descargaron ${result.totalRecords} registros y cierres en ${result.fileName}.${cleanupText}`,
            }
          : {
              id: `admin-backup-${Date.now()}`,
              title: 'Respaldo guardado en Supabase',
              text: `Se protegieron ${result.totalRecords} registros en ${result.objectPath}.`,
            };
        setBackupNotice(notice);
        sendBrowserNotification(notice.title, notice.text);
      } catch (error: unknown) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Error desconocido.';
        const notice = {
          id: `admin-backup-error-${Date.now()}`,
          title: 'No se pudo completar el respaldo',
          text: `${message} Se volverá a intentar automáticamente.`,
        };
        setBackupNotice(notice);
        sendBrowserNotification(notice.title, notice.text);
      } finally {
        adminBackupInFlightRef.current = false;
      }
    }

    if (backedUpAdminRef.current !== user.id) {
      backedUpAdminRef.current = user.id;
      void runAdminBackup(true);
    }
    const intervalId = window.setInterval(() => {
      void runAdminBackup(false);
    }, MANDATORY_BACKUP_CHECK_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [state, user?.id, user?.role]);

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
          backedUpAdminRef.current = null;
          adminBackupInFlightRef.current = false;
          setUser(null);
          setState('login');
        }}
      />
      {showUpdateNotice && <UpdateNotice onClose={closeUpdateNotice} />}
      {closureNotice && (
        <ClosureToast notice={closureNotice} onClose={() => setClosureNotice(null)} />
      )}
      {spaceNotice && (
        <ClosureToast notice={spaceNotice} onClose={() => setSpaceNotice(null)} />
      )}
      {backupNotice && (
        <ClosureToast notice={backupNotice} onClose={() => setBackupNotice(null)} />
      )}
    </>
  );
}

function ClosureToast({
  notice,
  onClose,
}: {
  notice: ClosureNotice;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <aside style={closureToastStyles.panel} role="status" aria-live="polite">
      <div>
        <strong style={closureToastStyles.title}>{notice.title}</strong>
        <p style={closureToastStyles.text}>{notice.text}</p>
      </div>
      <button type="button" style={closureToastStyles.closeButton} onClick={onClose}>
        Cerrar
      </button>
    </aside>
  );
}

function UpdateNotice({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div style={noticeStyles.backdrop} role="dialog" aria-modal="true">
      <section style={noticeStyles.panel}>
        <div style={noticeStyles.header}>
          <span style={noticeStyles.kicker}>Actualización disponible</span>
          <h1 style={noticeStyles.title}>Respaldo obligatorio cada 15 días</h1>
          <p style={noticeStyles.text}>
            Al iniciar como administrador, Supabase guarda una copia completa. Cada
            15 días también se descarga automáticamente al equipo administrativo.
          </p>
        </div>

        <div style={noticeStyles.grid}>
          <NoticeItem
            title="Panel con detalle"
            text="Las tarjetas del panel ahora se pueden abrir para revisar pedidos, reportes, áreas y unidades dañadas."
          />
          <NoticeItem
            title="Registro de daños"
            text="Se agregó cantidad dañada, tipo de daño, responsable por categoría y mejor guardado de observaciones."
          />
          <NoticeItem
            title="Copia quincenal"
            text="La descarga incluye todos los registros y cierres, con conteos y verificación SHA-256. Si falla, se vuelve a intentar."
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

const closureToastStyles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed',
    right: 20,
    bottom: 20,
    zIndex: 1100,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
    width: 'min(420px, calc(100vw - 32px))',
    padding: '16px 16px 14px',
    border: '1px solid #bfdbfe',
    borderLeft: '5px solid #1d4ed8',
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: '0 18px 50px rgba(15, 23, 42, 0.22)',
  },
  title: {
    display: 'block',
    marginBottom: 5,
    color: '#0f172a',
    fontSize: 14,
    lineHeight: 1.3,
  },
  text: {
    margin: 0,
    color: '#475569',
    fontSize: 13,
    lineHeight: 1.45,
  },
  closeButton: {
    flex: '0 0 auto',
    padding: '7px 10px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#f8fafc',
    color: '#334155',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
  },
};
