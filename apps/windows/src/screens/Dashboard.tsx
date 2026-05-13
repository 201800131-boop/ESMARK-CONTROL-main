import React from 'react';
import { signOut, updateLastSeen, type AuthUser, getAreaScope } from '../services/auth';
import { supabase } from '../core/supabase';
import { UserManagement } from './UserManagement';
import { PedidosDanadosScreen } from './PedidosDanadosScreen';
import { ReportesScreen } from './ReportesScreen';
import './Dashboard.css';

type Section = 'dashboard' | 'pedidos' | 'reportes' | 'usuarios';

const DASHBOARD_SECTION_KEY = 'esmark.dashboard.section';

interface DashboardProps {
  user: AuthUser;
  onSignOut: () => void;
}

interface AdminStats {
  totalPedidos: number;
  totalReportes: number;
  areasActivas: number;
  pendientes: number;
}

interface AreaStatRow {
  areaCode: string;
  areaName: string;
  pedidos: number;
  cierres: number;
}

type PeriodFilter = 'hoy' | 'semana' | 'mes' | 'todo';

const BRAND_LOGO_PRIMARY = 'esmark-logo.png';
const BRAND_LOGO_FALLBACK = 'esmark-logo-business.svg';

function normalizeAreaCode(area?: string): string {
  const clean = String(area ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (clean.startsWith('disen')) return 'diseno';
  if (clean.startsWith('impre')) return 'impresion';
  if (clean.startsWith('subli')) return 'sublimacion';
  if (clean.startsWith('admin')) return 'administracion';
  return clean;
}

function formatAreaLabel(area?: string): string {
  const code = normalizeAreaCode(area);
  if (code === 'impresion') return 'IMPRESIÓN';
  if (code === 'diseno') return 'DISEÑO';
  if (code === 'sublimacion') return 'SUBLIMACIÓN';
  if (code === 'administracion') return 'ADMINISTRACIÓN';
  return String(area ?? '');
}

export function Dashboard({ user, onSignOut }: DashboardProps): React.JSX.Element {
  const [section, setSection] = React.useState<Section>(() => {
    const stored = window.localStorage.getItem(DASHBOARD_SECTION_KEY);
    if (stored === 'dashboard' || stored === 'pedidos' || stored === 'reportes' || stored === 'usuarios') {
      return stored;
    }
    return 'dashboard';
  });
  const [signingOut, setSigningOut] = React.useState(false);
  const [loadingAdminStats, setLoadingAdminStats] = React.useState(false);
  const [adminStats, setAdminStats] = React.useState<AdminStats>({
    totalPedidos: 0,
    totalReportes: 0,
    areasActivas: 0,
    pendientes: 0,
  });
  const [areaStatsRows, setAreaStatsRows] = React.useState<AreaStatRow[]>([]);
  const [periodFilter, setPeriodFilter] = React.useState<PeriodFilter>('hoy');
  const [logoSrc, setLogoSrc] = React.useState(BRAND_LOGO_PRIMARY);
  const isAdmin = user.role === 'admin';
  const areaScope = getAreaScope(user);
  const displayName = user.fullName || user.username;

  React.useEffect(() => {
    window.localStorage.setItem(DASHBOARD_SECTION_KEY, section);
  }, [section]);

  // Heartbeat: actualiza last_seen cada 30s para presencia en tiempo real
  React.useEffect(() => {
    void updateLastSeen();
    const interval = setInterval(() => { void updateLastSeen(); }, 30_000);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    if (!isAdmin) return;

    async function loadAdminStats(): Promise<void> {
      setLoadingAdminStats(true);

      const [areasRes, pedidosRes, reportesRes] = await Promise.all([
        supabase.from('areas').select('id,code,nombre'),
        supabase.from('pedidos_danados').select('area_id,fecha,fecha_registro'),
        supabase.from('reportes_generados').select('area,created_at'),
      ]);

      const areas = (areasRes.data ?? []) as Array<{ id: string; code: string; nombre: string }>;
      const pedidosRaw = (pedidosRes.data ?? []) as Array<{ area_id?: string | null; fecha?: string | null; fecha_registro?: string | null }>;
      const reportesRaw = (reportesRes.data ?? []) as Array<{ area?: string | null; created_at?: string | null }>;

      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      const weekStart = startOfWeek.toISOString().slice(0, 10);
      const monthStart = `${today.slice(0, 7)}-01`;

      const isInPeriod = (dateValue: string | null | undefined): boolean => {
        if (!dateValue) return periodFilter === 'todo';
        const d = String(dateValue).slice(0, 10);
        if (periodFilter === 'todo') return true;
        if (periodFilter === 'hoy') return d === today;
        if (periodFilter === 'semana') return d >= weekStart && d <= today;
        if (periodFilter === 'mes') return d >= monthStart && d <= today;
        return true;
      };

      const pedidos = pedidosRaw.filter((p) => isInPeriod(p.fecha ?? p.fecha_registro));
      const reportes = reportesRaw.filter((r) => isInPeriod(r.created_at));

      const areaIdToCode = new Map<string, string>();
      const areaCodeToName = new Map<string, string>();

      for (const a of areas) {
        const code = normalizeAreaCode(a.code);
        areaIdToCode.set(a.id, code);
        areaCodeToName.set(code, a.nombre || code.toUpperCase());
      }

      const byArea = new Map<string, { pedidos: number; cierres: number }>();

      for (const pedido of pedidos) {
        const areaCode = areaIdToCode.get(String(pedido.area_id ?? '')) ?? 'sin_area';
        const current = byArea.get(areaCode) ?? { pedidos: 0, cierres: 0 };
        current.pedidos += 1;
        byArea.set(areaCode, current);
      }

      for (const rep of reportes) {
        const raw = normalizeAreaCode(rep.area ?? '');
        if (!raw || raw === 'all') continue;
        const current = byArea.get(raw) ?? { pedidos: 0, cierres: 0 };
        current.cierres += 1;
        byArea.set(raw, current);
      }

      const rows = Array.from(byArea.entries())
        .map(([areaCode, value]) => ({
          areaCode,
          areaName: areaCodeToName.get(areaCode) ?? areaCode.toUpperCase(),
          pedidos: value.pedidos,
          cierres: value.cierres,
        }))
        .sort((a, b) => b.pedidos - a.pedidos);

      const totalPedidos = pedidos.length;
      const totalReportes = reportes.length;
      const areasActivas = rows.filter((r) => r.pedidos > 0 || r.cierres > 0).length;
      const pendientes = Math.max(totalPedidos - totalReportes, 0);

      setAreaStatsRows(rows);
      setAdminStats({ totalPedidos, totalReportes, areasActivas, pendientes });
      setLoadingAdminStats(false);
    }

    void loadAdminStats();
    const intervalId = window.setInterval(() => {
      void loadAdminStats();
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAdmin, periodFilter]);

  const titleBySection: Record<Section, string> = {
    dashboard: isAdmin ? 'Panel de Control' : 'Inicio de Área',
    pedidos: 'Pedidos Dañados',
    reportes: 'Reportes',
    usuarios: 'Gestión de Usuarios',
  };

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      await signOut();
      window.localStorage.removeItem(DASHBOARD_SECTION_KEY);
      onSignOut();
    } catch {
      window.localStorage.removeItem(DASHBOARD_SECTION_KEY);
      onSignOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="dashboard-container">
      <aside className="dashboard-sidebar">
        <div className="dashboard-sidebar-logo">
          <img
            src={logoSrc}
            alt="Logo ESMARK Media"
            className="dashboard-sidebar-logo-image"
            onError={() => {
              if (logoSrc !== BRAND_LOGO_FALLBACK) setLogoSrc(BRAND_LOGO_FALLBACK);
            }}
          />
          <span className="dashboard-logo-text">ESMARK</span>
          <span className="dashboard-logo-sub">{isAdmin ? 'Control' : 'Área'}</span>
        </div>
        <nav className="dashboard-nav">
          <NavItem label={isAdmin ? 'Dashboard' : 'Inicio'} active={section === 'dashboard'} onClick={() => setSection('dashboard')} />
          <NavItem label="Pedidos Dañados" active={section === 'pedidos'} onClick={() => setSection('pedidos')} />
          <NavItem label="Reportes" active={section === 'reportes'} onClick={() => setSection('reportes')} />
          {isAdmin && <NavItem label="Usuarios" active={section === 'usuarios'} onClick={() => setSection('usuarios')} />}
        </nav>
        <button
          className={`dashboard-signout-btn${signingOut ? ' dashboard-signout-btn-disabled' : ''}`}
          onClick={() => void handleSignOut()}
          disabled={signingOut}
        >
          {signingOut ? 'Saliendo…' : 'Cerrar sesión'}
        </button>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-header">
          <h1 className="dashboard-header-title">{titleBySection[section]}</h1>
          <span className="dashboard-user-badge">
            {displayName} · {isAdmin ? 'Administrador' : `Área ${formatAreaLabel(areaScope)}`}
          </span>
        </header>

        {section === 'dashboard' && isAdmin && (
          <>
            <div className="dashboard-stats-grid">
              <StatCard title="Pedidos Dañados" value={loadingAdminStats ? '...' : String(adminStats.totalPedidos)} tone="red" />
              <StatCard title="Reportes Generados" value={loadingAdminStats ? '...' : String(adminStats.totalReportes)} tone="blue" />
              <StatCard title="Áreas Activas" value={loadingAdminStats ? '...' : String(adminStats.areasActivas)} tone="green" />
              <StatCard title="Pendientes" value={loadingAdminStats ? '...' : String(adminStats.pendientes)} tone="orange" />
            </div>

            <div className="dashboard-period-filter-row">
              <span className="dashboard-period-filter-label">Periodo:</span>
              <button
                type="button"
                className={`dashboard-period-filter-btn${periodFilter === 'hoy' ? ' dashboard-period-filter-btn-active' : ''}`}
                onClick={() => setPeriodFilter('hoy')}
              >
                Hoy
              </button>
              <button
                type="button"
                className={`dashboard-period-filter-btn${periodFilter === 'semana' ? ' dashboard-period-filter-btn-active' : ''}`}
                onClick={() => setPeriodFilter('semana')}
              >
                Semana
              </button>
              <button
                type="button"
                className={`dashboard-period-filter-btn${periodFilter === 'mes' ? ' dashboard-period-filter-btn-active' : ''}`}
                onClick={() => setPeriodFilter('mes')}
              >
                Mes
              </button>
              <button
                type="button"
                className={`dashboard-period-filter-btn${periodFilter === 'todo' ? ' dashboard-period-filter-btn-active' : ''}`}
                onClick={() => setPeriodFilter('todo')}
              >
                Todo
              </button>
            </div>

            <div className="dashboard-area-stats-section">
              <h3 className="dashboard-area-stats-title">Estadísticas por área</h3>
              <table className="dashboard-area-stats-table">
                <thead>
                  <tr>
                    <th className="dashboard-area-stats-th">Área</th>
                    <th className="dashboard-area-stats-th">Pedidos</th>
                    <th className="dashboard-area-stats-th">Cierres</th>
                  </tr>
                </thead>
                <tbody>
                  {areaStatsRows.map((row) => (
                    <tr key={row.areaCode}>
                      <td className="dashboard-area-stats-td">{row.areaName}</td>
                      <td className="dashboard-area-stats-td">{row.pedidos}</td>
                      <td className="dashboard-area-stats-td">{row.cierres}</td>
                    </tr>
                  ))}
                  {areaStatsRows.length === 0 && (
                    <tr>
                      <td className="dashboard-area-stats-td" colSpan={3}>Sin actividad registrada por área.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="dashboard-placeholder-section">
              <p className="dashboard-placeholder-text">
                Ves información de todas las áreas y control total del sistema.
              </p>
              <button type="button" className="dashboard-quick-action-btn" onClick={() => setSection('pedidos')}>
                Registrar daño
              </button>
            </div>
          </>
        )}

        {section === 'dashboard' && !isAdmin && (
          <AreaHome
            areaScope={areaScope}
            onRegisterDamage={() => setSection('pedidos')}
            onOpenReports={() => setSection('reportes')}
          />
        )}

        {section === 'pedidos' && <PedidosDanadosScreen user={user} />}
        {section === 'reportes' && <ReportesScreen user={user} />}
        {section === 'usuarios' && isAdmin && (
          <UserManagement currentUserId={user.id} currentUsername={user.username} />
        )}
      </main>
    </div>
  );
}

function NavItem({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <div className={`dashboard-nav-item${active ? ' dashboard-nav-item-active' : ''}`} onClick={onClick}>
      {label}
    </div>
  );
}

function StatCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone: 'red' | 'blue' | 'green' | 'orange';
}): React.JSX.Element {
  return (
    <div className={`dashboard-stat-card border-${tone}`}>
      <span className="dashboard-stat-value">{value}</span>
      <span className="dashboard-stat-label">{title}</span>
    </div>
  );
}

function AreaHome({
  areaScope,
  onRegisterDamage,
  onOpenReports,
}: {
  areaScope: string;
  onRegisterDamage: () => void;
  onOpenReports: () => void;
}): React.JSX.Element {
  return (
    <section className="dashboard-area-hero">
      <div className="dashboard-area-hero-top">
        <div>
          <div className="dashboard-area-kicker">Inicio de Área</div>
          <h2 className="dashboard-area-title">Centro de trabajo para {areaScope}</h2>
          <p className="dashboard-area-subtitle">
            Registro rápido, reportes claros y seguimiento de incidencias desde una sola vista.
          </p>
        </div>
        <div className="dashboard-area-badge">{areaScope}</div>
      </div>

      <div className="dashboard-area-actions">
        <button type="button" className="dashboard-area-primary-action" onClick={onRegisterDamage}>
          Registrar daño
        </button>
        <button type="button" className="dashboard-area-secondary-action" onClick={onOpenReports}>
          Ver reportes
        </button>
      </div>

      <div className="dashboard-area-clean-panel">
        <div className="dashboard-area-clean-item">
          <strong className="dashboard-area-clean-label">Enfoque</strong>
          <span className="dashboard-area-clean-text">Capturar daños de forma ordenada y verificable.</span>
        </div>
        <div className="dashboard-area-clean-divider" />
        <div className="dashboard-area-clean-item">
          <strong className="dashboard-area-clean-label">Control</strong>
          <span className="dashboard-area-clean-text">Mantener trazabilidad por responsable y por tarjeta.</span>
        </div>
      </div>
    </section>
  );
}
