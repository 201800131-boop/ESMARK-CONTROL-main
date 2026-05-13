import React from 'react';
import { signOut, updateLastSeen, type AuthUser, getAreaScope } from '../services/auth';
import { supabase } from '../core/supabase';
import { UserManagement } from './UserManagement';
import { PedidosDanadosScreen } from './PedidosDanadosScreen';
import { ReportesScreen } from './ReportesScreen';
import './Dashboard.css';

type Section = 'dashboard' | 'pedidos' | 'reportes' | 'usuarios';
type PeriodFilter = 'hoy' | 'semana' | 'mes' | 'todo';

const DASHBOARD_SECTION_KEY = 'esmark.dashboard.section';
const BRAND_LOGO_PRIMARY = 'esmark-logo.png';
const BRAND_LOGO_FALLBACK = 'esmark-logo-business.svg';

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
  if (code === 'impresion') return 'IMPRESION';
  if (code === 'diseno') return 'DISENO';
  if (code === 'sublimacion') return 'SUBLIMACION';
  if (code === 'administracion') return 'ADMINISTRACION';
  return String(area ?? '').toUpperCase();
}

function getPeriodLabel(period: PeriodFilter): string {
  if (period === 'hoy') return 'Hoy';
  if (period === 'semana') return 'Semana';
  if (period === 'mes') return 'Mes';
  return 'Todo';
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
  const completionRate = adminStats.totalPedidos > 0
    ? Math.min(100, Math.round((adminStats.totalReportes / adminStats.totalPedidos) * 100))
    : 0;

  React.useEffect(() => {
    window.localStorage.setItem(DASHBOARD_SECTION_KEY, section);
  }, [section]);

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

      for (const area of areas) {
        const code = normalizeAreaCode(area.code);
        areaIdToCode.set(area.id, code);
        areaCodeToName.set(code, area.nombre || formatAreaLabel(code));
      }

      const byArea = new Map<string, { pedidos: number; cierres: number }>();

      for (const pedido of pedidos) {
        const areaCode = areaIdToCode.get(String(pedido.area_id ?? '')) ?? 'sin_area';
        const current = byArea.get(areaCode) ?? { pedidos: 0, cierres: 0 };
        current.pedidos += 1;
        byArea.set(areaCode, current);
      }

      for (const report of reportes) {
        const areaCode = normalizeAreaCode(report.area ?? '');
        if (!areaCode || areaCode === 'all') continue;
        const current = byArea.get(areaCode) ?? { pedidos: 0, cierres: 0 };
        current.cierres += 1;
        byArea.set(areaCode, current);
      }

      const rows = Array.from(byArea.entries())
        .map(([areaCode, value]) => ({
          areaCode,
          areaName: areaCodeToName.get(areaCode) ?? formatAreaLabel(areaCode),
          pedidos: value.pedidos,
          cierres: value.cierres,
        }))
        .sort((a, b) => b.pedidos - a.pedidos);

      const totalPedidos = pedidos.length;
      const totalReportes = reportes.length;
      const areasActivas = rows.filter((row) => row.pedidos > 0 || row.cierres > 0).length;
      const pendientes = Math.max(totalPedidos - totalReportes, 0);

      setAreaStatsRows(rows);
      setAdminStats({ totalPedidos, totalReportes, areasActivas, pendientes });
      setLoadingAdminStats(false);
    }

    void loadAdminStats();
    const intervalId = window.setInterval(() => {
      void loadAdminStats();
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAdmin, periodFilter]);

  const titleBySection: Record<Section, string> = {
    dashboard: isAdmin ? 'Panel de Control' : 'Inicio de Area',
    pedidos: 'Pedidos Danados',
    reportes: 'Reportes',
    usuarios: 'Gestion de Usuarios',
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
          <span className="dashboard-logo-sub">{isAdmin ? 'Control' : 'Area'}</span>
        </div>
        <nav className="dashboard-nav">
          <NavItem label={isAdmin ? 'Dashboard' : 'Inicio'} active={section === 'dashboard'} onClick={() => setSection('dashboard')} />
          <NavItem label="Pedidos Danados" active={section === 'pedidos'} onClick={() => setSection('pedidos')} />
          <NavItem label="Reportes" active={section === 'reportes'} onClick={() => setSection('reportes')} />
          {isAdmin && <NavItem label="Usuarios" active={section === 'usuarios'} onClick={() => setSection('usuarios')} />}
        </nav>
        <button
          className={`dashboard-signout-btn${signingOut ? ' dashboard-signout-btn-disabled' : ''}`}
          onClick={() => void handleSignOut()}
          disabled={signingOut}
        >
          {signingOut ? 'Saliendo...' : 'Cerrar sesion'}
        </button>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <span className="dashboard-header-kicker">{isAdmin ? 'Administracion' : formatAreaLabel(areaScope)}</span>
            <h1 className="dashboard-header-title">{titleBySection[section]}</h1>
          </div>
          <span className="dashboard-user-badge">
            {displayName} · {isAdmin ? 'Administrador' : `Area ${formatAreaLabel(areaScope)}`}
          </span>
        </header>

        {section === 'dashboard' && isAdmin && (
          <>
            <section className="dashboard-admin-hero">
              <div className="dashboard-admin-hero-copy">
                <span className="dashboard-admin-kicker">Operacion en tiempo real</span>
                <h2 className="dashboard-admin-title">Resumen ejecutivo de incidencias</h2>
                <p className="dashboard-admin-subtitle">
                  Controla pedidos danados, cierres y actividad por area desde una vista compacta y lista para decisiones.
                </p>
              </div>
              <div className="dashboard-admin-hero-side">
                <span className="dashboard-admin-side-label">Cobertura de cierre</span>
                <strong className="dashboard-admin-side-value">{loadingAdminStats ? '...' : `${completionRate}%`}</strong>
                <div className="dashboard-progress-track">
                  <div className="dashboard-progress-fill" style={{ width: `${completionRate}%` }} />
                </div>
              </div>
            </section>

            <div className="dashboard-admin-toolbar">
              <div className="dashboard-period-filter-row">
                <span className="dashboard-period-filter-label">Periodo</span>
                {(['hoy', 'semana', 'mes', 'todo'] as PeriodFilter[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`dashboard-period-filter-btn${periodFilter === option ? ' dashboard-period-filter-btn-active' : ''}`}
                    onClick={() => setPeriodFilter(option)}
                  >
                    {getPeriodLabel(option)}
                  </button>
                ))}
              </div>
              <div className="dashboard-admin-actions">
                <button type="button" className="dashboard-secondary-action" onClick={() => setSection('reportes')}>
                  Ver reportes
                </button>
                <button type="button" className="dashboard-primary-action" onClick={() => setSection('pedidos')}>
                  Registrar dano
                </button>
              </div>
            </div>

            <div className="dashboard-stats-grid">
              <StatCard title="Pedidos danados" value={loadingAdminStats ? '...' : String(adminStats.totalPedidos)} tone="red" detail="Incidencias registradas" />
              <StatCard title="Reportes generados" value={loadingAdminStats ? '...' : String(adminStats.totalReportes)} tone="blue" detail="Cierres guardados" />
              <StatCard title="Areas activas" value={loadingAdminStats ? '...' : String(adminStats.areasActivas)} tone="green" detail="Con movimiento" />
              <StatCard title="Pendientes" value={loadingAdminStats ? '...' : String(adminStats.pendientes)} tone="orange" detail="Sin cierre asociado" />
            </div>

            <div className="dashboard-admin-grid">
              <section className="dashboard-area-stats-section">
                <div className="dashboard-section-heading">
                  <div>
                    <h3 className="dashboard-area-stats-title">Actividad por area</h3>
                    <p className="dashboard-section-subtitle">Comparativo de pedidos y cierres del periodo.</p>
                  </div>
                  <span className="dashboard-section-count">{areaStatsRows.length} areas</span>
                </div>
                <table className="dashboard-area-stats-table">
                  <thead>
                    <tr>
                      <th className="dashboard-area-stats-th">Area</th>
                      <th className="dashboard-area-stats-th">Pedidos</th>
                      <th className="dashboard-area-stats-th">Cierres</th>
                      <th className="dashboard-area-stats-th">Avance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {areaStatsRows.map((row) => {
                      const rowRate = row.pedidos > 0 ? Math.min(100, Math.round((row.cierres / row.pedidos) * 100)) : 0;
                      return (
                        <tr key={row.areaCode}>
                          <td className="dashboard-area-stats-td">{formatAreaLabel(row.areaName)}</td>
                          <td className="dashboard-area-stats-td dashboard-number-cell">{row.pedidos}</td>
                          <td className="dashboard-area-stats-td dashboard-number-cell">{row.cierres}</td>
                          <td className="dashboard-area-stats-td">
                            <div className="dashboard-table-progress">
                              <div className="dashboard-table-progress-fill" style={{ width: `${rowRate}%` }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {areaStatsRows.length === 0 && (
                      <tr>
                        <td className="dashboard-area-stats-td" colSpan={4}>Sin actividad registrada por area.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>

              <aside className="dashboard-control-panel">
                <div className="dashboard-section-heading">
                  <div>
                    <h3 className="dashboard-area-stats-title">Accesos de control</h3>
                    <p className="dashboard-section-subtitle">Operaciones frecuentes de administracion.</p>
                  </div>
                </div>
                <button type="button" className="dashboard-control-link" onClick={() => setSection('usuarios')}>
                  <span>Usuarios</span>
                  <strong>Gestionar accesos</strong>
                </button>
                <button type="button" className="dashboard-control-link" onClick={() => setSection('reportes')}>
                  <span>Reportes</span>
                  <strong>Editar o eliminar registros</strong>
                </button>
                <button type="button" className="dashboard-control-link" onClick={() => setSection('pedidos')}>
                  <span>Trello</span>
                  <strong>Vincular tarjetas</strong>
                </button>
              </aside>
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
    <button type="button" className={`dashboard-nav-item${active ? ' dashboard-nav-item-active' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}

function StatCard({
  title,
  value,
  tone,
  detail,
}: {
  title: string;
  value: string;
  tone: 'red' | 'blue' | 'green' | 'orange';
  detail?: string;
}): React.JSX.Element {
  return (
    <div className={`dashboard-stat-card border-${tone}`}>
      <span className="dashboard-stat-value">{value}</span>
      <span className="dashboard-stat-label">{title}</span>
      {detail && <span className="dashboard-stat-detail">{detail}</span>}
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
          <div className="dashboard-area-kicker">Inicio de Area</div>
          <h2 className="dashboard-area-title">Centro de trabajo para {formatAreaLabel(areaScope)}</h2>
          <p className="dashboard-area-subtitle">
            Registro rapido, reportes claros y seguimiento de incidencias desde una sola vista.
          </p>
        </div>
        <div className="dashboard-area-badge">{formatAreaLabel(areaScope)}</div>
      </div>

      <div className="dashboard-area-actions">
        <button type="button" className="dashboard-area-primary-action" onClick={onRegisterDamage}>
          Registrar dano
        </button>
        <button type="button" className="dashboard-area-secondary-action" onClick={onOpenReports}>
          Ver reportes
        </button>
      </div>

      <div className="dashboard-area-clean-panel">
        <div className="dashboard-area-clean-item">
          <strong className="dashboard-area-clean-label">Enfoque</strong>
          <span className="dashboard-area-clean-text">Capturar danos de forma ordenada y verificable.</span>
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
