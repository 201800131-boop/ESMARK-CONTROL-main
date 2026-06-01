import React from "react";
import {
  signOut,
  updateLastSeen,
  type AuthUser,
  getAreaScope,
} from "../services/auth";
import { supabase } from "../core/supabase";
import { UserManagement } from "./UserManagement";
import { PedidosDanadosScreen } from "./PedidosDanadosScreen";
import { ReportesScreen } from "./ReportesScreen";
import "./Dashboard.css";

type Section =
  | "dashboard"
  | "pedidos"
  | "reportes"
  | "historial"
  | "usuarios";
type PeriodFilter = "hoy" | "semana" | "mes" | "todo";
type AdminDetailMode = "pedidos" | "reportes" | "areas" | "unidades";

const DASHBOARD_SECTION_KEY = "esmark.dashboard.section";
const BRAND_LOGO_PRIMARY = "esmark-logo.png";
const BRAND_LOGO_FALLBACK = "esmark-logo-business.svg";

interface DashboardProps {
  user: AuthUser;
  onSignOut: () => void;
}

interface AdminStats {
  totalPedidos: number;
  totalReportes: number;
  areasActivas: number;
  unidadesDanadas: number;
}

interface AreaStatRow {
  areaCode: string;
  areaName: string;
  pedidos: number;
  cierres: number;
}

interface AdminPedidoDetailRow {
  id: string;
  fecha: string;
  areaName: string;
  nombrePedido: string;
  cantidadDanada: number;
  tipoDano: string;
  tipoTrabajo: string;
}

interface AdminReporteDetailRow {
  id: string;
  fecha: string;
  areaName: string;
  periodo: string;
  generadoPor: string;
}

interface AreaDamageRow {
  id: string;
  fecha: string;
  nombrePedido: string;
  motivoDano: string;
  cantidadDanada: number;
}

interface AreaHomeStats {
  loading: boolean;
  todayDamages: number;
  monthDamages: number;
  monthClosures: number;
  lastClosureDate?: string;
  recentDamages: AreaDamageRow[];
}

interface OnlinePresence {
  userId?: string;
  username?: string;
  fullName?: string;
  role?: string;
  area?: string;
  onlineAt?: string;
}

interface NextClosureInfo {
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
}

interface ClosureDateSource {
  fecha_fin?: string | null;
}

function normalizeAreaCode(area?: string): string {
  const clean = String(area ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (clean.startsWith("disen")) return "diseno";
  if (clean.startsWith("impre")) return "impresion";
  if (clean.startsWith("subli")) return "sublimacion";
  if (clean.startsWith("alma")) return "almacen";
  if (clean.startsWith("admin")) return "administracion";
  return clean;
}

function formatAreaLabel(area?: string): string {
  const code = normalizeAreaCode(area);
  if (code === "impresion") return "IMPRESIÓN";
  if (code === "diseno") return "DISEÑO";
  if (code === "sublimacion") return "SUBLIMACIÓN";
  if (code === "almacen") return "ALMACÉN";
  if (code === "administracion") return "ADMINISTRACIÓN";
  return String(area ?? "").toUpperCase();
}

function getPeriodLabel(period: PeriodFilter): string {
  if (period === "hoy") return "Hoy";
  if (period === "semana") return "Semana";
  if (period === "mes") return "Mes";
  return "Todo";
}

function formatClosingDate(value: Date): string {
  return new Intl.DateTimeFormat("es-HN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

function parseClosureDate(value?: string | null): Date | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function getPeriodStart(value: Date): Date {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate() <= 15 ? 1 : 16,
  );
}

function getPeriodEnd(value: Date): Date {
  if (value.getDate() <= 15) {
    return new Date(value.getFullYear(), value.getMonth(), 15);
  }
  return new Date(value.getFullYear(), value.getMonth() + 1, 0);
}

function computeNextClosureInfo(
  latestClosure?: ClosureDateSource | null,
): NextClosureInfo {
  const today = new Date();
  let start = getPeriodStart(today);
  const latestEnd = parseClosureDate(latestClosure?.fecha_fin);

  if (latestEnd) {
    start = addDays(latestEnd, 1);
  }

  let end = getPeriodEnd(start);
  while (end < getPeriodStart(today)) {
    start = addDays(end, 1);
    end = getPeriodEnd(start);
  }

  return {
    fecha_inicio: toDateKey(start),
    fecha_fin: toDateKey(end),
  };
}

function isClosureInfoExpired(info?: NextClosureInfo | null): boolean {
  const end = parseClosureDate(info?.fecha_fin);
  if (!end) return true;
  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return end < todayStart;
}

function formatNextClosureLabel(info?: NextClosureInfo | null): string {
  const end = parseClosureDate(info?.fecha_fin);
  if (end) return formatClosingDate(end);
  return "Pendiente de cierre";
}

function formatShortDate(value?: string): string {
  if (!value) return "Sin registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("es-HN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getAreaInitial(area?: string): string {
  const code = normalizeAreaCode(area);
  if (code === "impresion") return "I";
  if (code === "diseno") return "D";
  if (code === "sublimacion") return "S";
  if (code === "almacen") return "A";
  if (code === "administracion") return "A";
  return (
    String(area ?? "N")
      .trim()
      .charAt(0)
      .toUpperCase() || "N"
  );
}

export function Dashboard({
  user,
  onSignOut,
}: DashboardProps): React.JSX.Element {
  const [section, setSection] = React.useState<Section>(() => {
    const stored = window.localStorage.getItem(DASHBOARD_SECTION_KEY);
    if (
      stored === "dashboard" ||
      stored === "pedidos" ||
      stored === "reportes" ||
      stored === "historial" ||
      stored === "usuarios"
    ) {
      return stored;
    }
    return "dashboard";
  });
  const [signingOut, setSigningOut] = React.useState(false);
  const [loadingAdminStats, setLoadingAdminStats] = React.useState(false);
  const [adminStats, setAdminStats] = React.useState<AdminStats>({
    totalPedidos: 0,
    totalReportes: 0,
    areasActivas: 0,
    unidadesDanadas: 0,
  });
  const [areaStatsRows, setAreaStatsRows] = React.useState<AreaStatRow[]>([]);
  const [adminPedidoDetails, setAdminPedidoDetails] = React.useState<
    AdminPedidoDetailRow[]
  >([]);
  const [adminReporteDetails, setAdminReporteDetails] = React.useState<
    AdminReporteDetailRow[]
  >([]);
  const [activeAdminDetail, setActiveAdminDetail] =
    React.useState<AdminDetailMode | null>(null);
  const [periodFilter, setPeriodFilter] = React.useState<PeriodFilter>("todo");
  const [logoSrc, setLogoSrc] = React.useState(BRAND_LOGO_PRIMARY);
  const [onlineUserIds, setOnlineUserIds] = React.useState<Set<string>>(
    () => new Set([user.id]),
  );
  const [areaHomeStats, setAreaHomeStats] = React.useState<AreaHomeStats>({
    loading: true,
    todayDamages: 0,
    monthDamages: 0,
    monthClosures: 0,
    recentDamages: [],
  });
  const [nextClosingLabel, setNextClosingLabel] =
    React.useState("Calculando...");

  const isAdmin = user.role === "admin";
  const areaScope = getAreaScope(user);
  const displayName = user.fullName || user.username;
  const completionRate =
    adminStats.totalPedidos > 0
      ? Math.min(
          100,
          Math.round(
            (adminStats.totalReportes / adminStats.totalPedidos) * 100,
          ),
        )
      : 0;

  const loadNextClosureFromVisibleReports =
    React.useCallback(async (): Promise<NextClosureInfo> => {
      let query = supabase
        .from("reportes_generados")
        .select("fecha_fin,created_at,area")
        .not("fecha_fin", "is", null)
        .order("fecha_fin", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);

      if (isAdmin) {
        query = query.neq("area", "administracion");
      } else {
        query = query.eq("area", normalizeAreaCode(areaScope));
      }

      const { data, error } = await query;
      if (error) {
        return computeNextClosureInfo(null);
      }

      return computeNextClosureInfo(
        ((data ?? [])[0] ?? null) as ClosureDateSource | null,
      );
    }, [areaScope, isAdmin]);

  const loadNextClosureInfo = React.useCallback(async (): Promise<void> => {
    const { data, error } = await supabase.rpc("obtener_info_proximo_cierre");
    const rpcInfo = data as NextClosureInfo | null;

    if (error || isClosureInfoExpired(rpcInfo)) {
      const fallbackInfo = await loadNextClosureFromVisibleReports();
      setNextClosingLabel(formatNextClosureLabel(fallbackInfo));
      return;
    }

    setNextClosingLabel(formatNextClosureLabel(rpcInfo));
  }, [loadNextClosureFromVisibleReports]);

  React.useEffect(() => {
    window.localStorage.setItem(DASHBOARD_SECTION_KEY, section);
  }, [section]);

  React.useEffect(() => {
    void loadNextClosureInfo();

    const intervalId = window.setInterval(() => {
      void loadNextClosureInfo();
    }, 30_000);

    const channel = supabase
      .channel("dashboard-next-closure")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ultimo_cierre_quincenal" },
        () => {
          void loadNextClosureInfo();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reportes_generados" },
        () => {
          void loadNextClosureInfo();
        },
      )
      .subscribe();

    return () => {
      window.clearInterval(intervalId);
      void supabase.removeChannel(channel);
    };
  }, [loadNextClosureInfo]);

  React.useEffect(() => {
    void updateLastSeen();
    const interval = setInterval(() => {
      void updateLastSeen();
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    const channel = supabase.channel("online-users", {
      config: { presence: { key: user.id } },
    });

    const syncOnlineUsers = (): void => {
      const state = channel.presenceState() as Record<string, OnlinePresence[]>;
      const nextOnline = new Set<string>();

      for (const [presenceKey, presences] of Object.entries(state)) {
        if (presenceKey) nextOnline.add(presenceKey);
        for (const presence of presences) {
          if (presence.userId) nextOnline.add(presence.userId);
        }
      }

      nextOnline.add(user.id);
      setOnlineUserIds(nextOnline);
    };

    channel
      .on("presence", { event: "sync" }, syncOnlineUsers)
      .on("presence", { event: "join" }, syncOnlineUsers)
      .on("presence", { event: "leave" }, syncOnlineUsers)
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;

        void channel.track({
          userId: user.id,
          username: user.username,
          fullName: user.fullName,
          role: user.role,
          area: user.area,
          onlineAt: new Date().toISOString(),
        });
        syncOnlineUsers();
      });

    return () => {
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [user.area, user.fullName, user.id, user.role, user.username]);

  React.useEffect(() => {
    if (!isAdmin) return;

    async function loadAdminStats(): Promise<void> {
      setLoadingAdminStats(true);

      const [areasRes, pedidosRes, reportesRes] = await Promise.all([
        supabase.from("areas").select("id,code,nombre"),
        supabase
          .from("pedidos_danados")
          .select(
            "id,area_id,fecha,fecha_registro,nombre_pedido,cantidad_danada,tipo_dano,tipo_trabajo",
          ),
        supabase
          .from("reportes_generados")
          .select(
            "id,area,created_at,fecha_inicio,fecha_fin,generado_por_nombre",
          ),
      ]);

      const areas = (areasRes.data ?? []) as Array<{
        id: string;
        code: string;
        nombre: string;
      }>;
      const pedidosRaw = (pedidosRes.data ?? []) as Array<{
        id?: string | null;
        area_id?: string | null;
        fecha?: string | null;
        fecha_registro?: string | null;
        nombre_pedido?: string | null;
        cantidad_danada?: number | null;
        tipo_dano?: string | null;
        tipo_trabajo?: string | null;
      }>;
      const reportesRaw = (reportesRes.data ?? []) as Array<{
        id?: string | null;
        area?: string | null;
        created_at?: string | null;
        fecha_inicio?: string | null;
        fecha_fin?: string | null;
        generado_por_nombre?: string | null;
      }>;

      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      const weekStart = startOfWeek.toISOString().slice(0, 10);
      const monthStart = `${today.slice(0, 7)}-01`;

      const isInPeriod = (dateValue: string | null | undefined): boolean => {
        if (!dateValue) return periodFilter === "todo";
        const d = String(dateValue).slice(0, 10);
        if (periodFilter === "todo") return true;
        if (periodFilter === "hoy") return d === today;
        if (periodFilter === "semana") return d >= weekStart && d <= today;
        if (periodFilter === "mes") return d >= monthStart && d <= today;
        return true;
      };

      const pedidos = pedidosRaw.filter((p) =>
        isInPeriod(p.fecha ?? p.fecha_registro),
      );
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
        const areaCode =
          areaIdToCode.get(String(pedido.area_id ?? "")) ?? "sin_area";
        const current = byArea.get(areaCode) ?? { pedidos: 0, cierres: 0 };
        current.pedidos += 1;
        byArea.set(areaCode, current);
      }

      for (const report of reportes) {
        const areaCode = normalizeAreaCode(report.area ?? "");
        if (!areaCode || areaCode === "all") continue;
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
      const areasActivas = rows.filter(
        (row) => row.pedidos > 0 || row.cierres > 0,
      ).length;
      const unidadesDanadas = pedidos.reduce(
        (total, pedido) => total + Number(pedido.cantidad_danada ?? 0),
        0,
      );
      const pedidoDetails = pedidos.map((pedido) => {
        const areaCode =
          areaIdToCode.get(String(pedido.area_id ?? "")) ?? "sin_area";
        return {
          id: String(pedido.id ?? `${areaCode}-${pedido.fecha_registro ?? ""}`),
          fecha: String(pedido.fecha ?? pedido.fecha_registro ?? ""),
          areaName: areaCodeToName.get(areaCode) ?? formatAreaLabel(areaCode),
          nombrePedido: String(pedido.nombre_pedido ?? "Sin nombre"),
          cantidadDanada: Number(pedido.cantidad_danada ?? 0),
          tipoDano: String(pedido.tipo_dano ?? ""),
          tipoTrabajo: String(pedido.tipo_trabajo ?? ""),
        };
      });
      const reporteDetails = reportes.map((report) => {
        const areaCode = normalizeAreaCode(report.area ?? "");
        const fechaInicio = String(report.fecha_inicio ?? "").slice(0, 10);
        const fechaFin = String(report.fecha_fin ?? "").slice(0, 10);
        return {
          id: String(report.id ?? `${areaCode}-${report.created_at ?? ""}`),
          fecha: String(report.created_at ?? ""),
          areaName: areaCodeToName.get(areaCode) ?? formatAreaLabel(areaCode),
          periodo:
            fechaInicio || fechaFin
              ? `${fechaInicio || "?"} a ${fechaFin || "?"}`
              : "Sin periodo",
          generadoPor: String(report.generado_por_nombre ?? "Sin usuario"),
        };
      });

      setAreaStatsRows(rows);
      setAdminPedidoDetails(pedidoDetails);
      setAdminReporteDetails(reporteDetails);
      setAdminStats({
        totalPedidos,
        totalReportes,
        areasActivas,
        unidadesDanadas,
      });
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

  React.useEffect(() => {
    if (isAdmin) return;

    let active = true;

    async function loadAreaHomeStats(): Promise<void> {
      setAreaHomeStats((current) => ({ ...current, loading: true }));

      const areaCode = normalizeAreaCode(areaScope);
      const today = new Date().toISOString().slice(0, 10);
      const monthStart = `${today.slice(0, 7)}-01`;

      const areasRes = await supabase
        .from("areas")
        .select("id,code")
        .eq("code", areaCode)
        .maybeSingle();

      const areaId = String(areasRes.data?.id ?? "");
      if (!areaId) {
        if (active) {
          setAreaHomeStats({
            loading: false,
            todayDamages: 0,
            monthDamages: 0,
            monthClosures: 0,
            recentDamages: [],
          });
        }
        return;
      }

      const [todayRes, monthRes, recentRes, closuresRes] = await Promise.all([
        supabase
          .from("pedidos_danados")
          .select("id", { count: "exact", head: true })
          .eq("area_id", areaId)
          .gte("fecha", today),
        supabase
          .from("pedidos_danados")
          .select("id", { count: "exact", head: true })
          .eq("area_id", areaId)
          .gte("fecha", monthStart),
        supabase
          .from("pedidos_danados")
          .select(
            "id,fecha,fecha_registro,nombre_pedido,motivo_dano,cantidad_danada",
          )
          .eq("area_id", areaId)
          .order("fecha_registro", { ascending: false })
          .limit(5),
        supabase
          .from("reportes_generados")
          .select("id,created_at")
          .eq("area", areaCode)
          .gte("created_at", `${monthStart}T00:00:00`)
          .order("created_at", { ascending: false }),
      ]);

      if (!active) return;

      setAreaHomeStats({
        loading: false,
        todayDamages: todayRes.count ?? 0,
        monthDamages: monthRes.count ?? 0,
        monthClosures: closuresRes.data?.length ?? 0,
        lastClosureDate: closuresRes.data?.[0]?.created_at
          ? String(closuresRes.data[0].created_at)
          : undefined,
        recentDamages: (
          (recentRes.data ?? []) as Array<{
            id?: string;
            fecha?: string | null;
            fecha_registro?: string | null;
            nombre_pedido?: string | null;
            motivo_dano?: string | null;
            cantidad_danada?: number | null;
          }>
        ).map((row) => ({
          id: String(row.id ?? ""),
          fecha: String(row.fecha ?? row.fecha_registro ?? ""),
          nombrePedido: String(row.nombre_pedido ?? "Pedido sin nombre"),
          motivoDano: String(row.motivo_dano ?? "Sin motivo"),
          cantidadDanada: Number(row.cantidad_danada ?? 0),
        })),
      });
    }

    void loadAreaHomeStats();
    const intervalId = window.setInterval(() => {
      void loadAreaHomeStats();
    }, 30_000);

    const channel = supabase
      .channel(`area-home-${normalizeAreaCode(areaScope)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos_danados" },
        () => {
          void loadAreaHomeStats();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reportes_generados" },
        () => {
          void loadAreaHomeStats();
        },
      )
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(intervalId);
      void supabase.removeChannel(channel);
    };
  }, [areaScope, isAdmin]);

  const titleBySection: Record<Section, string> = {
    dashboard: isAdmin ? "Panel de Control" : "Inicio de Área",
    pedidos: "Pedidos Dañados",
    reportes: "Reportes",
    historial: "Historial",
    usuarios: "Gestión de Usuarios",
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
              if (logoSrc !== BRAND_LOGO_FALLBACK)
                setLogoSrc(BRAND_LOGO_FALLBACK);
            }}
          />
          <span className="dashboard-logo-text">ESMARK</span>
          <span className="dashboard-logo-sub">
            {isAdmin ? "Control" : "Área"}
          </span>
        </div>
        <nav className="dashboard-nav">
          <NavItem
            icon={<GaugeIcon />}
            label={isAdmin ? "Panel de control" : "Inicio"}
            active={section === "dashboard"}
            onClick={() => setSection("dashboard")}
          />
          <NavItem
            icon={<AlertFileIcon />}
            label="Pedidos Dañados"
            active={section === "pedidos"}
            onClick={() => setSection("pedidos")}
          />
          <NavItem
            icon={<ReportIcon />}
            label="Reportes"
            active={section === "reportes"}
            onClick={() => setSection("reportes")}
          />
          {isAdmin && (
            <NavItem
              icon={<HistoryIcon />}
              label="Historial"
              active={section === "historial"}
              onClick={() => setSection("historial")}
            />
          )}
          {isAdmin && (
            <NavItem
              icon={<UsersIcon />}
              label="Usuarios"
              active={section === "usuarios"}
              onClick={() => setSection("usuarios")}
            />
          )}
        </nav>
        <button
          className={`dashboard-signout-btn${signingOut ? " dashboard-signout-btn-disabled" : ""}`}
          onClick={() => void handleSignOut()}
          disabled={signingOut}
        >
          {signingOut ? "Saliendo..." : "Cerrar sesión"}
        </button>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <span className="dashboard-header-kicker">
              {isAdmin ? "Administración" : formatAreaLabel(areaScope)}
            </span>
            <h1 className="dashboard-header-title">
              {titleBySection[section]}
            </h1>
          </div>
          <span className="dashboard-user-badge">
            {displayName} ·{" "}
            {isAdmin ? "Administrador" : `Área ${formatAreaLabel(areaScope)}`}
          </span>
        </header>

        {section === "dashboard" && isAdmin && (
          <>
            <section className="dashboard-admin-hero">
              <div className="dashboard-admin-hero-copy">
                <span className="dashboard-admin-kicker">
                  Operación en tiempo real
                </span>
                <h2 className="dashboard-admin-title">
                  Resumen ejecutivo de incidencias
                </h2>
                <p className="dashboard-admin-subtitle">
                  Controla pedidos dañados, cierres y actividad por área desde
                  una vista compacta y lista para decisiones.
                </p>
              </div>
              <div className="dashboard-admin-hero-side">
                <div
                  className="dashboard-admin-ring"
                  style={
                    {
                      "--ring-progress": `${completionRate}%`,
                    } as React.CSSProperties
                  }
                >
                  <span>
                    {loadingAdminStats ? "..." : `${completionRate}%`}
                  </span>
                </div>
                <div>
                  <span className="dashboard-admin-side-label">
                    Cobertura de cierre
                  </span>
                  <strong className="dashboard-admin-side-value">
                    {adminStats.totalReportes}/{adminStats.totalPedidos}
                  </strong>
                  <p className="dashboard-admin-side-copy">
                    Reportes generados contra pedidos del periodo.
                  </p>
                  <div className="dashboard-next-close">
                    <span>Próximo cierre por área</span>
                    <strong>{nextClosingLabel}</strong>
                  </div>
                </div>
              </div>
            </section>

            <div className="dashboard-admin-toolbar">
              <div className="dashboard-period-filter-row">
                <span className="dashboard-period-filter-label">Periodo</span>
                {(["hoy", "semana", "mes", "todo"] as PeriodFilter[]).map(
                  (option) => (
                    <button
                      key={option}
                      type="button"
                      className={`dashboard-period-filter-btn${periodFilter === option ? " dashboard-period-filter-btn-active" : ""}`}
                      onClick={() => setPeriodFilter(option)}
                    >
                      {getPeriodLabel(option)}
                    </button>
                  ),
                )}
              </div>
              <div className="dashboard-admin-actions">
                <button
                  type="button"
                  className="dashboard-secondary-action"
                  onClick={() => setSection("reportes")}
                >
                  Ver reportes
                </button>
                <button
                  type="button"
                  className="dashboard-primary-action"
                  onClick={() => setSection("pedidos")}
                >
                  Registrar daño
                </button>
              </div>
            </div>

            <div className="dashboard-stats-grid">
              <StatCard
                title="Pedidos dañados"
                value={
                  loadingAdminStats ? "..." : String(adminStats.totalPedidos)
                }
                tone="red"
                icon={<DamageIcon />}
                detail="Incidencias registradas"
                active={activeAdminDetail === "pedidos"}
                onClick={() => setActiveAdminDetail("pedidos")}
              />
              <StatCard
                title="Reportes generados"
                value={
                  loadingAdminStats ? "..." : String(adminStats.totalReportes)
                }
                tone="blue"
                icon={<ReportIcon />}
                detail="Cierres guardados"
                active={activeAdminDetail === "reportes"}
                onClick={() => setActiveAdminDetail("reportes")}
              />
              <StatCard
                title="Áreas activas"
                value={
                  loadingAdminStats ? "..." : String(adminStats.areasActivas)
                }
                tone="green"
                icon={<AreasIcon />}
                detail="Con movimiento"
                active={activeAdminDetail === "areas"}
                onClick={() => setActiveAdminDetail("areas")}
              />
              <StatCard
                title="Unidades dañadas"
                value={
                  loadingAdminStats
                    ? "..."
                    : String(adminStats.unidadesDanadas)
                }
                tone="orange"
                icon={<PendingIcon />}
                detail="Cantidad total afectada"
                active={activeAdminDetail === "unidades"}
                onClick={() => setActiveAdminDetail("unidades")}
              />
            </div>

            {activeAdminDetail && (
              <section className="dashboard-stat-detail-panel">
                <div className="dashboard-section-heading">
                  <div>
                    <h3 className="dashboard-area-stats-title">
                      {activeAdminDetail === "pedidos" &&
                        "Detalle de pedidos dañados"}
                      {activeAdminDetail === "reportes" &&
                        "Detalle de reportes generados"}
                      {activeAdminDetail === "areas" &&
                        "Detalle de áreas activas"}
                      {activeAdminDetail === "unidades" &&
                        "Detalle de unidades dañadas"}
                    </h3>
                    <p className="dashboard-section-subtitle">
                      Periodo seleccionado: {getPeriodLabel(periodFilter)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="dashboard-detail-close"
                    onClick={() => setActiveAdminDetail(null)}
                    aria-label="Cerrar detalle"
                  >
                    Cerrar
                  </button>
                </div>

                {(activeAdminDetail === "pedidos" ||
                  activeAdminDetail === "unidades") && (
                  <table className="dashboard-area-stats-table">
                    <thead>
                      <tr>
                        <th className="dashboard-area-stats-th">Fecha</th>
                        <th className="dashboard-area-stats-th">Área</th>
                        <th className="dashboard-area-stats-th">Pedido</th>
                        <th className="dashboard-area-stats-th">Cantidad</th>
                        <th className="dashboard-area-stats-th">Tipo daño</th>
                        <th className="dashboard-area-stats-th">Trabajo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminPedidoDetails.map((row) => (
                        <tr key={row.id}>
                          <td className="dashboard-area-stats-td">
                            {String(row.fecha).slice(0, 10) || "-"}
                          </td>
                          <td className="dashboard-area-stats-td">
                            {row.areaName}
                          </td>
                          <td className="dashboard-area-stats-td">
                            {row.nombrePedido}
                          </td>
                          <td className="dashboard-area-stats-td dashboard-number-cell">
                            {row.cantidadDanada}
                          </td>
                          <td className="dashboard-area-stats-td">
                            {row.tipoDano || "-"}
                          </td>
                          <td className="dashboard-area-stats-td">
                            {row.tipoTrabajo || "-"}
                          </td>
                        </tr>
                      ))}
                      {adminPedidoDetails.length === 0 && (
                        <tr>
                          <td className="dashboard-area-stats-td" colSpan={6}>
                            Sin pedidos dañados en este periodo.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}

                {activeAdminDetail === "reportes" && (
                  <table className="dashboard-area-stats-table">
                    <thead>
                      <tr>
                        <th className="dashboard-area-stats-th">Fecha</th>
                        <th className="dashboard-area-stats-th">Área</th>
                        <th className="dashboard-area-stats-th">Periodo</th>
                        <th className="dashboard-area-stats-th">
                          Generado por
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminReporteDetails.map((row) => (
                        <tr key={row.id}>
                          <td className="dashboard-area-stats-td">
                            {formatShortDate(row.fecha)}
                          </td>
                          <td className="dashboard-area-stats-td">
                            {row.areaName}
                          </td>
                          <td className="dashboard-area-stats-td">
                            {row.periodo}
                          </td>
                          <td className="dashboard-area-stats-td">
                            {row.generadoPor}
                          </td>
                        </tr>
                      ))}
                      {adminReporteDetails.length === 0 && (
                        <tr>
                          <td className="dashboard-area-stats-td" colSpan={4}>
                            Sin reportes generados en este periodo.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}

                {activeAdminDetail === "areas" && (
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
                          <td className="dashboard-area-stats-td">
                            {formatAreaLabel(row.areaName)}
                          </td>
                          <td className="dashboard-area-stats-td dashboard-number-cell">
                            {row.pedidos}
                          </td>
                          <td className="dashboard-area-stats-td dashboard-number-cell">
                            {row.cierres}
                          </td>
                        </tr>
                      ))}
                      {areaStatsRows.length === 0 && (
                        <tr>
                          <td className="dashboard-area-stats-td" colSpan={3}>
                            Sin áreas activas en este periodo.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            <div className="dashboard-admin-grid">
              <section className="dashboard-area-stats-section">
                <div className="dashboard-section-heading">
                  <div>
                    <h3 className="dashboard-area-stats-title">
                      Actividad por área
                    </h3>
                    <p className="dashboard-section-subtitle">
                      Comparativo de pedidos y cierres del periodo.
                    </p>
                  </div>
                  <span className="dashboard-section-count">
                    {areaStatsRows.length} áreas
                  </span>
                </div>
                <table className="dashboard-area-stats-table">
                  <thead>
                    <tr>
                      <th className="dashboard-area-stats-th">Área</th>
                      <th className="dashboard-area-stats-th">Pedidos</th>
                      <th className="dashboard-area-stats-th">Cierres</th>
                      <th className="dashboard-area-stats-th">Avance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {areaStatsRows.map((row) => {
                      const rowRate =
                        row.pedidos > 0
                          ? Math.min(
                              100,
                              Math.round((row.cierres / row.pedidos) * 100),
                            )
                          : 0;
                      return (
                        <tr key={row.areaCode}>
                          <td className="dashboard-area-stats-td">
                            <span
                              className={`dashboard-area-chip area-${normalizeAreaCode(row.areaCode)}`}
                            >
                              <span className="dashboard-area-chip-mark">
                                {getAreaInitial(row.areaCode)}
                              </span>
                              {formatAreaLabel(row.areaName)}
                            </span>
                          </td>
                          <td className="dashboard-area-stats-td dashboard-number-cell">
                            {row.pedidos}
                          </td>
                          <td className="dashboard-area-stats-td dashboard-number-cell">
                            {row.cierres}
                          </td>
                          <td className="dashboard-area-stats-td">
                            <div className="dashboard-table-progress">
                              <div
                                className="dashboard-table-progress-fill"
                                style={{ width: `${rowRate}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {areaStatsRows.length === 0 && (
                      <tr>
                        <td className="dashboard-area-stats-td" colSpan={4}>
                          Sin actividad registrada por área.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>

              <aside className="dashboard-control-panel">
                <div className="dashboard-section-heading">
                  <div>
                    <h3 className="dashboard-area-stats-title">
                      Accesos de control
                    </h3>
                    <p className="dashboard-section-subtitle">
                      Operaciones frecuentes de administración.
                    </p>
                  </div>
                </div>
                <ControlLink
                  tone="users"
                  icon={<UsersIcon />}
                  label="Usuarios"
                  title="Gestionar accesos"
                  onClick={() => setSection("usuarios")}
                />
                <ControlLink
                  tone="reports"
                  icon={<ReportIcon />}
                  label="Reportes"
                  title="Editar o eliminar registros"
                  onClick={() => setSection("reportes")}
                />
                <ControlLink
                  tone="trello"
                  icon={<BoardIcon />}
                  label="Trello"
                  title="Vincular tarjetas"
                  onClick={() => setSection("pedidos")}
                />
              </aside>
            </div>
          </>
        )}

        {section === "dashboard" && !isAdmin && (
          <AreaHome
            areaScope={areaScope}
            stats={areaHomeStats}
            nextClosingLabel={nextClosingLabel}
            onRegisterDamage={() => setSection("pedidos")}
            onOpenReports={() => setSection("reportes")}
          />
        )}

        {section === "pedidos" && <PedidosDanadosScreen user={user} />}
        {section === "reportes" && (
          <ReportesScreen
            user={user}
            onClosureComplete={() => void loadNextClosureInfo()}
          />
        )}
        {section === "historial" && isAdmin && (
          <ReportesScreen
            user={user}
            historyOnly
            onClosureComplete={() => void loadNextClosureInfo()}
          />
        )}
        {section === "usuarios" && isAdmin && (
          <UserManagement
            currentUserId={user.id}
            currentUsername={user.username}
            onlineUserIds={onlineUserIds}
          />
        )}
      </main>
    </div>
  );
}

function AreaWidget({
  title,
  value,
  detail,
  tone,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  tone: "blue" | "red" | "green" | "orange";
  icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={`dashboard-area-widget widget-${tone}`}>
      <span className="dashboard-area-widget-icon">{icon}</span>
      <span className="dashboard-area-widget-title">{title}</span>
      <strong className="dashboard-area-widget-value">{value}</strong>
      <span className="dashboard-area-widget-detail">{detail}</span>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`dashboard-nav-item${active ? " dashboard-nav-item-active" : ""}`}
      onClick={onClick}
    >
      <span className="dashboard-nav-icon">{icon}</span>
      {label}
    </button>
  );
}

function StatCard({
  title,
  value,
  tone,
  icon,
  detail,
  active,
  onClick,
}: {
  title: string;
  value: string;
  tone: "red" | "blue" | "green" | "orange";
  icon: React.ReactNode;
  detail?: string;
  active?: boolean;
  onClick?: () => void;
}): React.JSX.Element {
  const cardClassName = `dashboard-stat-card border-${tone}${active ? " dashboard-stat-card-active" : ""}${onClick ? " dashboard-stat-card-clickable" : ""}`;

  return (
    <button type="button" className={cardClassName} onClick={onClick}>
      <div className="dashboard-stat-topline">
        <span className="dashboard-stat-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="dashboard-stat-value">{value}</span>
      </div>
      <span className="dashboard-stat-label">{title}</span>
      {detail && <span className="dashboard-stat-detail">{detail}</span>}
    </button>
  );
}

function DamageIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M12 3 3 20h18L12 3Z" />
      <path d="M12 9v5" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function AreasIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M4 4h7v7H4V4Z" />
      <path d="M13 4h7v7h-7V4Z" />
      <path d="M4 13h7v7H4v-7Z" />
      <path d="M13 13h7v7h-7v-7Z" />
    </svg>
  );
}

function PendingIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ControlLink({
  tone,
  icon,
  label,
  title,
  onClick,
}: {
  tone: "users" | "reports" | "trello";
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`dashboard-control-link control-${tone}`}
      onClick={onClick}
    >
      <span className="dashboard-control-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
      <strong>{title}</strong>
    </button>
  );
}

function UsersIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4" />
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M20 18c0-1.7-1-3.1-2.5-3.7" />
      <path d="M17 5.1a3 3 0 0 1 0 5.8" />
    </svg>
  );
}

function GaugeIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M4 14a8 8 0 0 1 16 0" />
      <path d="M12 14l4-4" />
      <path d="M8 18h8" />
      <path d="M6.4 11.5l1.4.8" />
      <path d="M17.6 11.5l-1.4.8" />
      <path d="M12 6v2" />
    </svg>
  );
}

function AlertFileIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v5h5" />
      <path d="M12 11v4" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function ReportIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v5h5" />
      <path d="M10 13h6" />
      <path d="M10 17h4" />
    </svg>
  );
}

function HistoryIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M12 8v5l3 2" />
      <path d="M4 12a8 8 0 1 0 2.3-5.7" />
      <path d="M4 4v5h5" />
    </svg>
  );
}

function BoardIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M4 5h16v14H4V5Z" />
      <path d="M9 5v14" />
      <path d="M15 5v14" />
      <path d="M6 8h1" />
      <path d="M11 8h2" />
      <path d="M17 8h1" />
    </svg>
  );
}

function AreaHome({
  areaScope,
  stats,
  nextClosingLabel,
  onRegisterDamage,
  onOpenReports,
}: {
  areaScope: string;
  stats: AreaHomeStats;
  nextClosingLabel: string;
  onRegisterDamage: () => void;
  onOpenReports: () => void;
}): React.JSX.Element {
  const areaCode = normalizeAreaCode(areaScope);
  const progress =
    stats.monthDamages > 0
      ? Math.min(
          100,
          Math.round(
            (stats.monthClosures / Math.max(stats.monthDamages, 1)) * 100,
          ),
        )
      : 0;
  const statusLabel =
    stats.monthClosures > 0 ? "Cierre registrado" : "Cierre pendiente";

  return (
    <div className="dashboard-area-workspace">
      <section className={`dashboard-area-hero area-home-${areaCode}`}>
        <div className="dashboard-area-hero-top">
          <div>
            <div className="dashboard-area-kicker">Inicio de Área</div>
            <h2 className="dashboard-area-title">
              {formatAreaLabel(areaScope)}
            </h2>
            <p className="dashboard-area-subtitle">
              Monitorea incidencias, registra danos y prepara el cierre del
              periodo desde una vista compacta.
            </p>
          </div>
          <div className="dashboard-area-badge">
            <span className="dashboard-area-badge-mark">
              {getAreaInitial(areaScope)}
            </span>
            <span>{statusLabel}</span>
          </div>
        </div>

        <div className="dashboard-area-actions">
          <button
            type="button"
            className="dashboard-area-primary-action"
            onClick={onRegisterDamage}
          >
            Registrar daño
          </button>
          <button
            type="button"
            className="dashboard-area-secondary-action"
            onClick={onOpenReports}
          >
            Ver reportes
          </button>
        </div>

        <div className="dashboard-area-clean-panel">
          <div className="dashboard-area-clean-item">
            <strong className="dashboard-area-clean-label">Enfoque</strong>
            <span className="dashboard-area-clean-text">
              Capturar daños de forma ordenada y verificable.
            </span>
          </div>
          <div className="dashboard-area-clean-divider" />
          <div className="dashboard-area-clean-item">
            <strong className="dashboard-area-clean-label">Control</strong>
            <span className="dashboard-area-clean-text">
              Mantener trazabilidad por responsable y por tarjeta.
            </span>
          </div>
        </div>
      </section>

      <div className="dashboard-area-widget-grid">
        <AreaWidget
          title="Danos hoy"
          value={stats.loading ? "..." : String(stats.todayDamages)}
          detail="Registros del dia"
          tone="blue"
          icon={<DamageIcon />}
        />
        <AreaWidget
          title="Danos del mes"
          value={stats.loading ? "..." : String(stats.monthDamages)}
          detail="Acumulado actual"
          tone="red"
          icon={<AlertFileIcon />}
        />
        <AreaWidget
          title="Cierres del mes"
          value={stats.loading ? "..." : String(stats.monthClosures)}
          detail={
            stats.lastClosureDate
              ? `Ultimo: ${formatShortDate(stats.lastClosureDate)}`
              : "Aun sin cierre"
          }
          tone="green"
          icon={<ReportIcon />}
        />
        <AreaWidget
          title="Proximo cierre"
          value={nextClosingLabel.split(",")[0] ?? nextClosingLabel}
          detail={nextClosingLabel}
          tone="orange"
          icon={<PendingIcon />}
        />
      </div>

      <div className="dashboard-area-layout">
        <section className="dashboard-area-panel">
          <div className="dashboard-section-heading">
            <div>
              <h3 className="dashboard-area-stats-title">Actividad reciente</h3>
              <p className="dashboard-section-subtitle">
                Ultimos registros capturados por tu area.
              </p>
            </div>
            <span className="dashboard-section-count">
              {stats.recentDamages.length} visibles
            </span>
          </div>

          <div className="dashboard-area-timeline">
            {stats.recentDamages.map((row) => (
              <button
                key={row.id}
                type="button"
                className="dashboard-area-timeline-item"
                onClick={onOpenReports}
              >
                <span className="dashboard-area-timeline-date">
                  {formatShortDate(row.fecha)}
                </span>
                <strong>{row.nombrePedido}</strong>
                <span>{row.motivoDano}</span>
                <em>{row.cantidadDanada} und.</em>
              </button>
            ))}
            {!stats.loading && stats.recentDamages.length === 0 && (
              <div className="dashboard-area-empty-state">
                No hay danos registrados recientemente para esta area.
              </div>
            )}
            {stats.loading && (
              <div className="dashboard-area-empty-state">
                Cargando actividad...
              </div>
            )}
          </div>
        </section>

        <aside className="dashboard-area-panel dashboard-area-focus-panel">
          <div className="dashboard-area-progress-head">
            <span>Preparacion del cierre</span>
            <strong>{progress}%</strong>
          </div>
          <div className="dashboard-progress-track">
            <div
              className="dashboard-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="dashboard-area-focus-list">
            <div>
              <strong>Captura ordenada</strong>
              <span>Registra danos con pedido, cantidad y motivo claro.</span>
            </div>
            <div>
              <strong>Revision continua</strong>
              <span>
                Consulta reportes antes del cierre para detectar faltantes.
              </span>
            </div>
            <div>
              <strong>Trazabilidad</strong>
              <span>
                Conserva relacion con Trello cuando exista tarjeta vinculada.
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
