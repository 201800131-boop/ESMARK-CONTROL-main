import React from "react";
import * as XLSX from "xlsx-js-style/dist/xlsx.bundle.js";
import { supabase } from "../core/supabase";
import type { AuthUser } from "../services/auth";

interface Props {
  user: AuthUser;
  historyOnly?: boolean;
}

type AnyRow = Record<string, unknown>;
type TrelloLookupCard = Record<string, unknown>;

interface ReportEditForm {
  fecha: string;
  area: string;
  nombrePedido: string;
  cantidadDanada: string;
  motivoDano: string;
  tipoTrabajo: string;
  tipoDano: string;
  personaDano: string;
  observacion: string;
}

interface AreaReportSection {
  code: string;
  label: string;
  rows: AnyRow[];
  closures: AnyRow[];
}

interface AreaOption {
  code: string;
  label: string;
}

interface ClosureGroup {
  date: string;
  rows: AnyRow[];
}

function normalizeLookupCard(item: Record<string, unknown>): TrelloLookupCard {
  const descValue =
    typeof item.desc === "string"
      ? item.desc
      : typeof item.description === "string"
        ? item.description
        : undefined;

  return {
    id: String(item.id ?? ""),
    name: String(item.name ?? ""),
    url: String(item.url ?? ""),
    idList: String(item.idList ?? ""),
    listName: String(item.listName ?? ""),
    desc: descValue,
  };
}

function normalizeAreaCode(area: string): string {
  const clean = area
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
  const code = normalizeAreaCode(String(area ?? ""));
  if (code === "impresion") return "IMPRESIÓN";
  if (code === "diseno") return "DISEÑO";
  if (code === "sublimacion") return "SUBLIMACIÓN";
  if (code === "almacen") return "ALMACÉN";
  if (code === "administracion") return "ADMINISTRACIÓN";
  return String(area ?? "-");
}

function getLatestClosureCreatedAt(rows: AnyRow[]): string | null {
  return (
    rows
      .map((row) => String(row.created_at ?? ""))
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))[0] ?? null
  );
}

const REPORT_HEADERS = [
  "Fecha",
  "Area",
  "Pedido",
  "Cantidad danada",
  "Motivo dano",
  "Tipo trabajo",
  "Tipo dano",
  "Persona dano",
  "Observacion",
] as const;

function toReportRows(
  rows: AnyRow[],
  areaNameById: Record<string, string>,
): string[][] {
  const orderedRows = [...rows].sort((a, b) => {
    const left = String(a.fecha ?? a.fecha_registro ?? "");
    const right = String(b.fecha ?? b.fecha_registro ?? "");
    return right.localeCompare(left);
  });

  return orderedRows.map((row) => {
    const areaId = String(row.area_id ?? "");
    const areaFromId = areaNameById[areaId];
    const areaFromCode = formatAreaLabel(String(row.area ?? ""));
    const areaLabel =
      areaFromId || (areaFromCode !== "-" ? areaFromCode : "Sin area");

    return [
      String(row.fecha ?? row.fecha_registro ?? "").slice(0, 10),
      areaLabel,
      String(row.nombre_pedido ?? ""),
      String(row.cantidad_danada ?? ""),
      String(row.motivo_dano ?? ""),
      String(row.tipo_trabajo ?? ""),
      String(row.tipo_dano ?? ""),
      String(row.persona_dano ?? ""),
      String(row.observacion ?? ""),
    ];
  });
}

function exportReportToExcel(
  rows: AnyRow[],
  areaNameById: Record<string, string>,
  filename: string,
  title: string,
  subtitle: string,
): void {
  const worksheet = createReportWorksheet(rows, areaNameById, title, subtitle);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Reporte");
  downloadWorkbook(workbook, filename);
}

function createReportWorksheet(
  rows: AnyRow[],
  areaNameById: Record<string, string>,
  title: string,
  subtitle: string,
): AnyRow {
  const bodyRows = toReportRows(rows, areaNameById);
  const headerRowIndex = 3;
  const worksheet = XLSX.utils.aoa_to_sheet([
    [title],
    [subtitle],
    [],
    REPORT_HEADERS as unknown as string[],
    ...bodyRows,
  ]);

  const headerStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1D4ED8" } },
    alignment: { horizontal: "center", vertical: "center" },
  };

  const titleStyle = {
    font: { bold: true, sz: 16, color: { rgb: "0F172A" } },
    alignment: { horizontal: "left", vertical: "center" },
  };

  const subtitleStyle = {
    font: { bold: true, sz: 11, color: { rgb: "475569" } },
    alignment: { horizontal: "left", vertical: "center" },
  };

  const titleCell = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (worksheet[titleCell]) worksheet[titleCell].s = titleStyle;
  const subtitleCell = XLSX.utils.encode_cell({ r: 1, c: 0 });
  if (worksheet[subtitleCell]) worksheet[subtitleCell].s = subtitleStyle;

  for (let col = 0; col < REPORT_HEADERS.length; col += 1) {
    const address = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
    if (worksheet[address]) {
      worksheet[address].s = headerStyle;
    }
  }

  const colWidths = [14, 18, 30, 18, 30, 22, 18, 22, 36].map((width) => ({
    wch: width,
  }));

  worksheet["!cols"] = colWidths;
  worksheet["!autofilter"] = {
    ref: `A${headerRowIndex + 1}:${XLSX.utils.encode_col(REPORT_HEADERS.length - 1)}${headerRowIndex + 1}`,
  };
  worksheet["!merges"] = [
    {
      s: { r: 0, c: 0 },
      e: { r: 0, c: REPORT_HEADERS.length - 1 },
    },
    {
      s: { r: 1, c: 0 },
      e: { r: 1, c: REPORT_HEADERS.length - 1 },
    },
  ];

  return worksheet;
}

function downloadWorkbook(workbook: AnyRow, filename: string): void {
  const workbookData = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });
  const blob = new Blob([workbookData], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sanitizeSheetName(value: string): string {
  const clean = value.replace(/[\\/?*[\]:]/g, " ").trim();
  return (clean || "Hoja").slice(0, 31);
}

function groupClosuresByDate(rows: AnyRow[]): ClosureGroup[] {
  const map = new Map<string, AnyRow[]>();
  for (const row of rows) {
    const date = String(row.created_at ?? "").slice(0, 10) || "Sin fecha";
    map.set(date, [...(map.get(date) ?? []), row]);
  }

  return Array.from(map.entries())
    .map(([date, groupRows]) => ({
      date,
      rows: groupRows.sort((a, b) =>
        String(a.area ?? "").localeCompare(String(b.area ?? "")),
      ),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDetailValue(key: string, value: unknown): string {
  if (value == null) return "-";
  if (key.includes("fecha")) {
    const raw = String(value);
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString("es-MX", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
  return String(value);
}

function getRowString(row: AnyRow, key: string): string | null {
  const value = row[key];
  if (value == null) return null;
  const asText = String(value).trim();
  return asText ? asText : null;
}

function getFirstNonEmpty(...values: Array<string | null>): string | null {
  for (const value of values) {
    if (value) return value;
  }
  return null;
}

function getRowNumber(row: AnyRow, key: string): number | null {
  const value = row[key];
  if (value == null) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function resolveTrelloUrl(row: AnyRow): string | null {
  const directUrl = getRowString(row, "trello_card_url");
  if (directUrl) return directUrl;

  const cardId = getRowString(row, "trello_card_id");
  if (cardId) return `https://trello.com/c/${cardId}`;

  return null;
}

function extractTrelloShortCode(value: string | null): string | null {
  if (!value) return null;
  const input = value.trim();
  if (!input) return null;

  if (input.startsWith("http://") || input.startsWith("https://")) {
    try {
      const url = new URL(input);
      const match = url.pathname.match(/\/c\/([^/]+)/i);
      if (match?.[1]) return match[1].toLowerCase();
    } catch {
      return null;
    }
    return null;
  }

  const normalized = input.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (normalized.length >= 8 && normalized.length <= 12) return normalized;
  return null;
}

function formatDateShort(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("es-HN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function ReportesScreen({ user, historyOnly = false }: Props): React.JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [loadingClosures, setLoadingClosures] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [executingManualClosure, setExecutingManualClosure] =
    React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<AnyRow[]>([]);
  const [closureRows, setClosureRows] = React.useState<AnyRow[]>([]);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [areaIdByCode, setAreaIdByCode] = React.useState<
    Record<string, string>
  >({});
  const [areaNameById, setAreaNameById] = React.useState<
    Record<string, string>
  >({});
  const [areaOptions, setAreaOptions] = React.useState<AreaOption[]>([]);
  const [userAreaId, setUserAreaId] = React.useState<string | null>(null);
  const [selectedRow, setSelectedRow] = React.useState<AnyRow | null>(null);
  const [selectedClosureGroup, setSelectedClosureGroup] =
    React.useState<ClosureGroup | null>(null);
  const [editingRow, setEditingRow] = React.useState<AnyRow | null>(null);
  const [editForm, setEditForm] = React.useState<ReportEditForm>({
    fecha: "",
    area: "impresion",
    nombrePedido: "",
    cantidadDanada: "1",
    motivoDano: "",
    tipoTrabajo: "",
    tipoDano: "",
    personaDano: "",
    observacion: "",
  });
  const [mutatingReport, setMutatingReport] = React.useState(false);
  const [downloadingClosureId, setDownloadingClosureId] = React.useState<
    string | null
  >(null);
  const [trelloCatalog, setTrelloCatalog] = React.useState<
    TrelloLookupCard[] | null
  >(null);
  const [trelloMatchedCard, setTrelloMatchedCard] =
    React.useState<TrelloLookupCard | null>(null);
  const [trelloLookupLoading, setTrelloLookupLoading] = React.useState(false);
  const [trelloAutoSaved, setTrelloAutoSaved] = React.useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  const [fechaInicio, setFechaInicio] = React.useState(monthStart);
  const [fechaFin, setFechaFin] = React.useState(today);
  const [area, setArea] = React.useState("all");
  const latestClosureCreatedAt = React.useMemo(
    () => getLatestClosureCreatedAt(closureRows),
    [closureRows],
  );
  const closureGroups = React.useMemo(
    () => groupClosuresByDate(closureRows),
    [closureRows],
  );

  const selectedAreaId = String(selectedRow?.area_id ?? "");
  const selectedAreaName = selectedRow
    ? areaNameById[selectedAreaId]
      ? areaNameById[selectedAreaId]
      : selectedAreaId || "-"
    : "-";
  const areaCodeById = React.useMemo(() => {
    const next: Record<string, string> = {};
    for (const [code, id] of Object.entries(areaIdByCode)) {
      next[id] = code;
    }
    return next;
  }, [areaIdByCode]);
  const areaSections = React.useMemo<AreaReportSection[]>(() => {
    const sections = areaOptions
      .filter(
        (option) =>
          user.role === "admin" ||
          normalizeAreaCode(user.area ?? "") === option.code,
      )
      .map((option) => {
        const areaRows = rows.filter(
          (row) => areaCodeById[String(row.area_id ?? "")] === option.code,
        );
        const areaClosures = closureRows.filter(
          (row) => normalizeAreaCode(String(row.area ?? "")) === option.code,
        );
        return {
          code: option.code,
          label: option.label,
          rows: areaRows,
          closures: areaClosures,
        };
      });

    if (user.role === "admin" && area !== "all") {
      return sections.filter((section) => section.code === area);
    }

    return sections;
  }, [
    area,
    areaCodeById,
    areaOptions,
    closureRows,
    rows,
    user.area,
    user.role,
  ]);

  const hiddenDetailKeys = React.useMemo(
    () =>
      new Set([
        "id",
        "area_id",
        "trello_card_id",
        "trello_card_url",
        "trello_list_id",
        "trello_card_name",
        "trello_list_name",
        "trello_board_id",
        "trello_board_name",
        "trello_card_desc",
      ]),
    [],
  );

  const canGenerateExcel = user.role === "admin";

  React.useEffect(() => {
    async function loadAreaCatalog(): Promise<void> {
      const { data } = await supabase
        .from("areas")
        .select("id,code,nombre")
        .order("nombre", { ascending: true });
      const map: Record<string, string> = {};
      const namesById: Record<string, string> = {};
      const options: AreaOption[] = [];
      for (const item of data ?? []) {
        const keyRaw = String(item.code ?? "");
        const key = normalizeAreaCode(keyRaw);
        const value = String(item.id ?? "");
        if (key && value) {
          map[key] = value;
          const label =
            String(item.nombre ?? "").trim() || formatAreaLabel(key);
          namesById[value] = label;
          options.push({ code: key, label });
        }
      }
      setAreaIdByCode(map);
      setAreaNameById(namesById);
      setAreaOptions(options);

      if (user.role !== "admin" && user.area) {
        const code = normalizeAreaCode(user.area);
        setUserAreaId(map[code] ?? null);
      }
    }

    void loadAreaCatalog();
  }, [user.area, user.role]);

  const loadRows = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const selectWithDesc =
      "id,fecha,fecha_registro,area_id,nombre_pedido,cantidad_danada,motivo_dano,tipo_trabajo,tipo_dano,persona_dano,observacion,trello_card_id,trello_card_name,trello_card_url,trello_list_id,trello_list_name,trello_board_id,trello_board_name,trello_card_desc";
    const selectWithoutDesc =
      "id,fecha,fecha_registro,area_id,nombre_pedido,cantidad_danada,motivo_dano,tipo_trabajo,tipo_dano,persona_dano,observacion,trello_card_id,trello_card_name,trello_card_url,trello_list_id,trello_list_name,trello_board_id,trello_board_name";

    const buildQuery = (selectText: string) => {
      let q = supabase
        .from("pedidos_danados")
        .select(selectText)
        .order("fecha_registro", { ascending: false })
        .limit(300);

      if (user.role !== "admin" && userAreaId) {
        q = q.eq("area_id", userAreaId);
      }

      if (user.role === "admin" && area !== "all") {
        const selectedAreaId = areaIdByCode[area];
        if (selectedAreaId) {
          q = q.eq("area_id", selectedAreaId);
        }
      }

      return q;
    };

    let missingTrelloDescColumn = false;
    let { data, error: qErr } = await buildQuery(selectWithDesc);
    if (qErr && qErr.message.toLowerCase().includes("trello_card_desc")) {
      missingTrelloDescColumn = true;
      const fallback = await buildQuery(selectWithoutDesc);
      data = fallback.data;
      qErr = fallback.error;
    }

    if (!qErr) {
      const from = fechaInicio;
      const to = fechaFin;
      const filtered = ((data ?? []) as unknown as AnyRow[]).filter((row) => {
        const registeredAt = String(row.fecha_registro ?? "");
        if (
          latestClosureCreatedAt &&
          registeredAt &&
          registeredAt <= latestClosureCreatedAt
        ) {
          return false;
        }

        const raw = row.fecha ?? row.fecha_registro;
        if (!raw) return true;
        const normalized = String(raw).slice(0, 10);
        if (from && normalized < from) return false;
        if (to && normalized > to) return false;
        return true;
      });
      setRows(filtered);
      if (missingTrelloDescColumn) {
        setNotice(
          "La descripción de Trello no aparece porque falta la columna trello_card_desc en Supabase.",
        );
      } else {
        setNotice(null);
      }
    } else {
      setError(qErr.message);
      setRows([]);
    }
    setLoading(false);
  }, [
    area,
    areaIdByCode,
    fechaFin,
    fechaInicio,
    latestClosureCreatedAt,
    user.role,
    userAreaId,
  ]);

  const loadClosures = React.useCallback(async (): Promise<void> => {
    setLoadingClosures(true);

    let query = supabase
      .from("reportes_generados")
      .select(
        "id,created_at,area,fecha_inicio,fecha_fin,generado_por,generado_por_nombre",
      )
      .order("created_at", { ascending: false })
      .limit(300);

    if (user.role !== "admin" && user.area) {
      const areaCode = normalizeAreaCode(user.area);
      query = query.eq("area", areaCode);
    }

    if (user.role === "admin" && area !== "all") {
      query = query.eq("area", area);
    }

    const { data, error: qErr } = await query;
    if (qErr) {
      setClosureRows([]);
      setError((prev) => prev ?? qErr.message);
    } else {
      setClosureRows((data ?? []) as AnyRow[]);
    }

    setLoadingClosures(false);
  }, [area, user.area, user.role]);

  React.useEffect(() => {
    void loadRows();
  }, [loadRows]);

  React.useEffect(() => {
    void loadClosures();
  }, [loadClosures]);

  React.useEffect(() => {
    const channel = supabase
      .channel("reportes-pedidos-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos_danados" },
        () => {
          void loadRows();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reportes_generados" },
        () => {
          void loadClosures();
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          setNotice(
            "La actualización en tiempo real no pudo conectarse. Puedes usar Filtrar para refrescar manualmente.",
          );
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadClosures, loadRows]);

  React.useEffect(() => {
    let active = true;

    async function findTrelloCardForSelectedRow(): Promise<void> {
      if (!selectedRow) {
        setTrelloMatchedCard(null);
        setTrelloLookupLoading(false);
        setTrelloAutoSaved(false);
        return;
      }

      const hasTrelloData = Boolean(
        getFirstNonEmpty(
          getRowString(selectedRow, "trello_card_id"),
          getRowString(selectedRow, "trello_card_url"),
        ),
      );
      const hasDescription = Boolean(
        getFirstNonEmpty(
          getRowString(selectedRow, "trello_card_desc"),
          getRowString(selectedRow, "trello_description"),
        ),
      );

      if (hasTrelloData && hasDescription) {
        setTrelloMatchedCard(null);
        setTrelloLookupLoading(false);
        setTrelloAutoSaved(false);
        return;
      }

      const rowCardId = getRowString(selectedRow, "trello_card_id");
      const rowUrl = getRowString(selectedRow, "trello_card_url");
      const rowShortCode =
        extractTrelloShortCode(rowUrl) ?? extractTrelloShortCode(rowCardId);
      const hasExplicitTrelloReference = Boolean(
        rowCardId || rowUrl || rowShortCode,
      );
      if (!hasExplicitTrelloReference) {
        setTrelloMatchedCard(null);
        setTrelloLookupLoading(false);
        setTrelloAutoSaved(false);
        return;
      }

      setTrelloLookupLoading(true);

      let cards = trelloCatalog;
      if (!cards) {
        const boardId = String(
          getFirstNonEmpty(
            getRowString(selectedRow, "trello_board_id"),
            String(import.meta.env.VITE_TRELLO_BOARD_ID ?? "3cv4PjjJ"),
          ) ?? "3cv4PjjJ",
        ).trim();
        const { data, error: fnErr } = await supabase.functions.invoke(
          "trello_cards_by_my_area",
          {
            body: { boardId },
          },
        );

        if (fnErr) {
          if (active) {
            setTrelloLookupLoading(false);
            setTrelloMatchedCard(null);
          }
          return;
        }

        const rawCards = ((data as { cards?: Record<string, unknown>[] } | null)
          ?.cards ?? []) as Record<string, unknown>[];
        cards = rawCards
          .map(normalizeLookupCard)
          .filter(
            (card) => getRowString(card, "id") && getRowString(card, "name"),
          );
        if (active) setTrelloCatalog(cards);
      }

      const exactById = rowCardId
        ? (cards ?? []).find(
            (card) => String(card.id ?? "").trim() === rowCardId,
          )
        : null;
      const exactByShortCode = rowShortCode
        ? (cards ?? []).find(
            (card) =>
              extractTrelloShortCode(getRowString(card, "url")) ===
              rowShortCode,
          )
        : null;
      const matched = exactById ?? exactByShortCode ?? null;

      if (matched) {
        const recordId = getRowString(selectedRow, "id");
        if (recordId) {
          // No sobreescribir trello_card_desc si ya existe en el registro o si matched no tiene desc
          const existingDesc = getRowString(selectedRow, "trello_card_desc");
          const matchedDesc = getRowString(matched, "desc");
          const descToSave = matchedDesc ?? existingDesc ?? undefined;

          const updatePayload: AnyRow = {
            trello_card_id: getRowString(matched, "id") ?? undefined,
            trello_card_name: getRowString(matched, "name") ?? undefined,
            trello_card_url: getRowString(matched, "url") ?? undefined,
            trello_list_id: getRowString(matched, "idList") ?? undefined,
            trello_list_name: getRowString(matched, "listName") ?? undefined,
            trello_board_id:
              getFirstNonEmpty(
                getRowString(matched, "idBoard"),
                getRowString(matched, "boardId"),
              ) ?? undefined,
            trello_board_name: getRowString(matched, "boardName") ?? undefined,
          };

          // Solo incluir trello_card_desc en el update si hay un valor real que guardar
          if (descToSave) {
            updatePayload.trello_card_desc = descToSave;
          }

          const { error: updateError } = await supabase
            .from("pedidos_danados")
            .update(updatePayload)
            .eq("id", recordId);

          if (!updateError && active) {
            // Preservar trello_card_desc existente si el updatePayload no lo incluye
            const nextSelected = {
              ...selectedRow,
              ...updatePayload,
              trello_card_desc:
                descToSave ??
                getRowString(selectedRow, "trello_card_desc") ??
                undefined,
            };
            setSelectedRow(nextSelected);
            setRows((current) =>
              current.map((row) =>
                String(row.id ?? "") === recordId
                  ? { ...row, ...updatePayload }
                  : row,
              ),
            );
            setTrelloAutoSaved(true);
          }
        }
      }

      if (active) {
        setTrelloMatchedCard(matched);
        setTrelloLookupLoading(false);
      }
    }

    void findTrelloCardForSelectedRow();

    return () => {
      active = false;
    };
  }, [selectedRow, trelloCatalog]);

  async function handleStartClosure(): Promise<void> {
    if (user.role !== "admin") {
      setError("Solo administradores pueden iniciar un cierre.");
      return;
    }

    const confirmed = window.confirm(
      "¿Iniciar cierre manual ahora? Se generará el reporte de los últimos 15 días y todo lo nuevo será para el siguiente cierre.",
    );
    if (!confirmed) return;

    setExecutingManualClosure(true);
    setError(null);
    setSuccess(null);

    try {
      const generatedByName =
        (user.fullName || user.username || "").trim() || user.id;
      const { data, error: rpcError } = await supabase.rpc(
        "ejecutar_cierre_quincenal_manual",
        {
          p_realizado_por: user.id,
          p_realizado_por_nombre: generatedByName,
        },
      );

      if (rpcError) {
        setError(`Error al ejecutar cierre: ${rpcError.message}`);
        setExecutingManualClosure(false);
        return;
      }

      if (data && !data.success) {
        setError(
          `Error al ejecutar cierre: ${data.error ?? "Error desconocido"}`,
        );
        setExecutingManualClosure(false);
        return;
      }

      const dateRange =
        data?.fecha_inicio && data?.fecha_fin
          ? `${String(data.fecha_inicio).slice(0, 10)} al ${String(data.fecha_fin).slice(0, 10)}`
          : "";
      setSuccess(
        `Cierre realizado exitosamente${dateRange ? ": " + dateRange : ""}`,
      );
      window.setTimeout(() => setSuccess(null), 5000);
      void loadClosures();
      setRows([]);
    } catch (err) {
      setError(
        `Error: ${err instanceof Error ? err.message : "Error desconocido"}`,
      );
    } finally {
      setExecutingManualClosure(false);
    }
  }

  async function handleGenerateExcel(
    targetArea = area,
    targetRows = rows,
  ): Promise<void> {
    if (!canGenerateExcel) {
      setError("Solo el administrador puede descargar Excel.");
      return;
    }

    setGenerating(true);
    setError(null);

    const fileArea = targetArea === "all" ? "todas_las_areas" : targetArea;
    const selectedAreaLabel =
      targetArea === "all"
        ? "Todas las áreas"
        : (areaOptions.find((option) => option.code === targetArea)?.label ??
          formatAreaLabel(targetArea));
    exportReportToExcel(
      targetRows,
      areaNameById,
      `cierre_${fileArea}_${fechaInicio}_${fechaFin}.xlsx`,
      "Reporte de Pedidos Dañados - ESMARK Control",
      `Área: ${selectedAreaLabel} | Rango: ${fechaInicio} a ${fechaFin} | Registros: ${targetRows.length}`,
    );

    setSuccess("Excel descargado.");
    window.setTimeout(() => setSuccess(null), 3000);
    setGenerating(false);
  }

  function startEditReport(row: AnyRow): void {
    if (user.role !== "admin") return;
    const rowAreaId = String(row.area_id ?? "");
    const areaCode =
      Object.entries(areaIdByCode).find(([, id]) => id === rowAreaId)?.[0] ??
      "impresion";
    setSelectedRow(row);
    setEditingRow(row);
    setEditForm({
      fecha: String(row.fecha ?? row.fecha_registro ?? "").slice(0, 10),
      area: areaCode,
      nombrePedido: getRowString(row, "nombre_pedido") ?? "",
      cantidadDanada: String(getRowNumber(row, "cantidad_danada") ?? 1),
      motivoDano: getRowString(row, "motivo_dano") ?? "",
      tipoTrabajo: getRowString(row, "tipo_trabajo") ?? "",
      tipoDano: getRowString(row, "tipo_dano") ?? "",
      personaDano: getRowString(row, "persona_dano") ?? "",
      observacion: getRowString(row, "observacion") ?? "",
    });
  }

  async function handleSaveReport(): Promise<void> {
    if (user.role !== "admin" || !editingRow) return;

    const recordId = getRowString(editingRow, "id");
    const qty = Number(editForm.cantidadDanada);
    const areaId = areaIdByCode[editForm.area];
    if (!recordId) {
      setError("No se encontro el ID del reporte.");
      return;
    }
    if (!areaId) {
      setError("Selecciona un area valida.");
      return;
    }
    if (
      !editForm.nombrePedido.trim() ||
      !editForm.motivoDano.trim() ||
      !Number.isFinite(qty) ||
      qty <= 0
    ) {
      setError("Completa pedido, motivo y una cantidad valida.");
      return;
    }

    setMutatingReport(true);
    setError(null);
    const payload = {
      fecha: editForm.fecha || undefined,
      area_id: areaId,
      nombre_pedido: editForm.nombrePedido.trim(),
      cantidad_danada: qty,
      motivo_dano: editForm.motivoDano.trim(),
      tipo_trabajo: editForm.tipoTrabajo.trim() || null,
      tipo_dano: editForm.tipoDano.trim() || null,
      persona_dano: editForm.personaDano.trim() || null,
      observacion: editForm.observacion.trim() || null,
    };

    const { data, error: updateError } = await supabase
      .from("pedidos_danados")
      .update(payload)
      .eq("id", recordId)
      .select("*")
      .maybeSingle();

    if (updateError) {
      setError(updateError.message);
      setMutatingReport(false);
      return;
    }

    const updatedRow = (data ?? { ...editingRow, ...payload }) as AnyRow;
    setRows((current) =>
      current.map((row) =>
        String(row.id ?? "") === recordId ? { ...row, ...updatedRow } : row,
      ),
    );
    setSelectedRow((current) =>
      current && String(current.id ?? "") === recordId
        ? { ...current, ...updatedRow }
        : current,
    );
    setEditingRow(null);
    setSuccess("Reporte actualizado.");
    window.setTimeout(() => setSuccess(null), 3000);
    setMutatingReport(false);
    void loadRows();
  }

  async function handleDeleteReport(row: AnyRow): Promise<void> {
    if (user.role !== "admin") return;
    const recordId = getRowString(row, "id");
    if (!recordId) {
      setError("No se encontro el ID del reporte.");
      return;
    }
    const label = getRowString(row, "nombre_pedido") ?? "este reporte";
    const confirmed = window.confirm(
      `Eliminar "${label}"? Esta accion no se puede deshacer.`,
    );
    if (!confirmed) return;

    setMutatingReport(true);
    setError(null);
    setSuccess(null);
    const { data: deletedRows, error: deleteError } = await supabase
      .from("pedidos_danados")
      .delete()
      .eq("id", recordId)
      .select("id");

    if (deleteError) {
      setError(deleteError.message);
      setMutatingReport(false);
      return;
    }

    if (!deletedRows || deletedRows.length === 0) {
      setError(
        "Supabase no eliminó el registro. Revisa permisos de administrador o políticas RLS.",
      );
      setMutatingReport(false);
      return;
    }

    if (!deleteError) {
      const { data: existsAfterDelete } = await supabase
        .from("pedidos_danados")
        .select("id")
        .eq("id", recordId)
        .maybeSingle();

      if (existsAfterDelete) {
        setError(
          "Supabase no eliminó el registro. Revisa permisos de administrador o políticas RLS.",
        );
        setMutatingReport(false);
        return;
      }
    }

    setRows((current) =>
      current.filter((currentRow) => String(currentRow.id ?? "") !== recordId),
    );
    if (selectedRow && String(selectedRow.id ?? "") === recordId)
      setSelectedRow(null);
    if (editingRow && String(editingRow.id ?? "") === recordId)
      setEditingRow(null);
    setSuccess("Reporte eliminado.");
    window.setTimeout(() => setSuccess(null), 3000);
    setMutatingReport(false);
    void loadRows();
  }

  async function handleDeleteClosure(row: AnyRow): Promise<void> {
    if (user.role !== "admin") return;
    const recordId = getRowString(row, "id");
    if (!recordId) {
      setError("No se encontro el ID del cierre.");
      return;
    }

    const label =
      `${formatAreaLabel(String(row.area ?? ""))} ${String(row.fecha_inicio ?? "")} - ${String(row.fecha_fin ?? "")}`.trim();
    const confirmed = window.confirm(
      `Eliminar cierre "${label}"? Esta accion no se puede deshacer.`,
    );
    if (!confirmed) return;

    setMutatingReport(true);
    setError(null);
    setSuccess(null);

    const { data: deletedRows, error: deleteError } = await supabase
      .from("reportes_generados")
      .delete()
      .eq("id", recordId)
      .select("id");

    if (deleteError) {
      setError(deleteError.message);
      setMutatingReport(false);
      return;
    }

    if (!deletedRows || deletedRows.length === 0) {
      setError(
        "Supabase no elimino el cierre. Revisa permisos de administrador o politicas RLS.",
      );
      setMutatingReport(false);
      return;
    }

    setClosureRows((current) =>
      current.filter((currentRow) => String(currentRow.id ?? "") !== recordId),
    );
    setSuccess("Cierre eliminado de Supabase.");
    window.setTimeout(() => setSuccess(null), 3000);
    setMutatingReport(false);
    void loadClosures();
  }

  async function handleDownloadClosure(row: AnyRow): Promise<void> {
    const closureId = getRowString(row, "id") ?? "";
    const from = String(row.fecha_inicio ?? "").slice(0, 10);
    const to = String(row.fecha_fin ?? "").slice(0, 10);
    const areaCode = normalizeAreaCode(String(row.area ?? ""));
    const areaId = areaCode === "all" ? null : areaIdByCode[areaCode];

    if (!from || !to) {
      setError("Este cierre no tiene rango de fechas para descargar.");
      return;
    }

    if (areaCode !== "all" && !areaId) {
      setError("No se encontro el area del cierre para descargar.");
      return;
    }

    setDownloadingClosureId(closureId || `${areaCode}-${from}-${to}`);
    setError(null);

    let query = supabase
      .from("pedidos_danados")
      .select(
        "id,fecha,fecha_registro,area_id,nombre_pedido,cantidad_danada,motivo_dano,tipo_trabajo,tipo_dano,persona_dano,observacion",
      )
      .order("fecha_registro", { ascending: false })
      .limit(1000);

    if (areaId) {
      query = query.eq("area_id", areaId);
    }

    const { data, error: qErr } = await query;
    if (qErr) {
      setError(qErr.message);
      setDownloadingClosureId(null);
      return;
    }

    const closureRows = ((data ?? []) as unknown as AnyRow[]).filter((item) => {
      const raw = item.fecha ?? item.fecha_registro;
      if (!raw) return true;
      const normalized = String(raw).slice(0, 10);
      return normalized >= from && normalized <= to;
    });
    const areaLabel =
      areaCode === "all"
        ? "Todas las areas"
        : (areaOptions.find((option) => option.code === areaCode)?.label ??
          formatAreaLabel(areaCode));

    exportReportToExcel(
      closureRows,
      areaNameById,
      `cierre_${areaCode || "area"}_${from}_${to}.xlsx`,
      "Reporte de Pedidos Danados - ESMARK Control",
      `Area: ${areaLabel} | Rango: ${from} a ${to} | Registros: ${closureRows.length}`,
    );

    setSuccess("Excel descargado.");
    window.setTimeout(() => setSuccess(null), 3000);
    setDownloadingClosureId(null);
  }

  async function handleDownloadClosureGroup(group: ClosureGroup): Promise<void> {
    const groupKey = `group-${group.date}`;
    const dates = group.rows.flatMap((row) => [
      String(row.fecha_inicio ?? "").slice(0, 10),
      String(row.fecha_fin ?? "").slice(0, 10),
    ]).filter(Boolean);
    const from = dates.sort((a, b) => a.localeCompare(b))[0];
    const to = dates.sort((a, b) => b.localeCompare(a))[0];

    if (!from || !to) {
      setError("Este grupo no tiene rango de fechas para descargar.");
      return;
    }

    setDownloadingClosureId(groupKey);
    setError(null);

    const { data, error: qErr } = await supabase
      .from("pedidos_danados")
      .select(
        "id,fecha,fecha_registro,area_id,nombre_pedido,cantidad_danada,motivo_dano,tipo_trabajo,tipo_dano,persona_dano,observacion",
      )
      .order("fecha_registro", { ascending: false })
      .limit(5000);

    if (qErr) {
      setError(qErr.message);
      setDownloadingClosureId(null);
      return;
    }

    const allRows = ((data ?? []) as unknown as AnyRow[]).filter((item) => {
      const raw = item.fecha ?? item.fecha_registro;
      if (!raw) return true;
      const normalized = String(raw).slice(0, 10);
      return normalized >= from && normalized <= to;
    });

    const workbook = XLSX.utils.book_new();
    const summaryRows = group.rows.map((row) => [
      String(row.created_at ?? "").slice(0, 10),
      formatAreaLabel(String(row.area ?? "-")),
      String(row.fecha_inicio ?? "-"),
      String(row.fecha_fin ?? "-"),
      String(row.generado_por_nombre ?? row.generado_por ?? "-"),
    ]);
    const summarySheet = XLSX.utils.aoa_to_sheet([
      ["Historial de Cierres - ESMARK Control"],
      [`Fecha de cierre: ${group.date} | Areas: ${group.rows.length}`],
      [],
      ["Fecha de cierre", "Area", "Desde", "Hasta", "Generado por"],
      ...summaryRows,
    ]);
    summarySheet["!cols"] = [
      { wch: 18 },
      { wch: 20 },
      { wch: 14 },
      { wch: 14 },
      { wch: 28 },
    ];
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen");

    for (const closure of group.rows) {
      const areaCode = normalizeAreaCode(String(closure.area ?? ""));
      const areaId = areaIdByCode[areaCode];
      const areaLabel =
        areaOptions.find((option) => option.code === areaCode)?.label ??
        formatAreaLabel(areaCode);
      const areaRows = areaId
        ? allRows.filter((item) => String(item.area_id ?? "") === areaId)
        : [];
      const sheet = createReportWorksheet(
        areaRows,
        areaNameById,
        "Reporte de Pedidos Danados - ESMARK Control",
        `Area: ${areaLabel} | Rango: ${from} a ${to} | Registros: ${areaRows.length}`,
      );
      XLSX.utils.book_append_sheet(
        workbook,
        sheet,
        sanitizeSheetName(areaLabel),
      );
    }

    downloadWorkbook(workbook, `cierres_${group.date}.xlsx`);
    setSuccess("Excel de cierres descargado.");
    window.setTimeout(() => setSuccess(null), 3000);
    setDownloadingClosureId(null);
  }

  if (historyOnly) {
    return (
      <div>
        <div style={styles.hero}>
          <div>
            <div style={styles.heroKicker}>Historial administrativo</div>
            <h2 style={styles.heroTitle}>Historial de Cierres</h2>
            <p style={styles.heroText}>
              Consulta los cierres generados, revisa el responsable y descarga
              los Excel guardados por area.
            </p>
          </div>
          <div style={styles.heroStats}>
            <span style={styles.heroBadge}>{closureGroups.length} fechas</span>
            <span style={styles.heroBadge}>{closureRows.length} areas</span>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.h3}>Cierres registrados</h3>
          {loadingClosures ? (
            <p>Cargando cierres...</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Fecha de cierre</th>
                  <th style={styles.th}>Areas incluidas</th>
                  <th style={styles.th}>Rango</th>
                  <th style={styles.th}>Generado por</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {closureGroups.map((group) => {
                  const from = group.rows
                    .map((row) => String(row.fecha_inicio ?? "").slice(0, 10))
                    .filter(Boolean)
                    .sort((a, b) => a.localeCompare(b))[0] ?? "-";
                  const to = group.rows
                    .map((row) => String(row.fecha_fin ?? "").slice(0, 10))
                    .filter(Boolean)
                    .sort((a, b) => b.localeCompare(a))[0] ?? "-";
                  const areas = group.rows
                    .map((row) => formatAreaLabel(String(row.area ?? "")))
                    .join(", ");
                  const generatedBy = String(
                    group.rows[0]?.generado_por_nombre ??
                      group.rows[0]?.generado_por ??
                      "-",
                  );
                  return (
                  <tr key={`closure-group-${group.date}`}>
                    <td style={styles.td}>{group.date}</td>
                    <td style={styles.td}>{areas}</td>
                    <td style={styles.td}>{from} - {to}</td>
                    <td style={styles.td}>{generatedBy}</td>
                    <td style={styles.td}>
                      <div style={styles.rowActions}>
                        <button
                          type="button"
                          style={styles.inlineBtn}
                          onClick={() => setSelectedClosureGroup(group)}
                          disabled={mutatingReport}
                        >
                          Ver detalle
                        </button>
                        <button
                          type="button"
                          style={styles.inlineBtn}
                          onClick={() => void handleDownloadClosureGroup(group)}
                          disabled={
                            mutatingReport ||
                            downloadingClosureId === `group-${group.date}`
                          }
                        >
                          {downloadingClosureId === `group-${group.date}`
                            ? "Descargando..."
                            : "Descargar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {closureGroups.length === 0 && (
                  <tr>
                    <td style={styles.td} colSpan={5}>
                      Aun no hay cierres manuales registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {selectedClosureGroup && (
          <div style={styles.modalBackdrop}>
            <div style={styles.modalCard}>
              <div style={styles.modalHeader}>
                <div>
                  <h3 style={styles.modalTitle}>
                    Cierres del {selectedClosureGroup.date}
                  </h3>
                  <p style={styles.modalSubtitle}>
                    Areas incluidas en este cierre manual.
                  </p>
                </div>
                <button
                  type="button"
                  style={styles.modalCloseBtn}
                  onClick={() => setSelectedClosureGroup(null)}
                >
                  Cerrar
                </button>
              </div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Area</th>
                    <th style={styles.th}>Desde</th>
                    <th style={styles.th}>Hasta</th>
                    <th style={styles.th}>Generado por</th>
                    <th style={styles.th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedClosureGroup.rows.map((row, idx) => (
                    <tr key={`${String(row.id ?? idx)}-closure-detail`}>
                      <td style={styles.td}>
                        {formatAreaLabel(String(row.area ?? "-"))}
                      </td>
                      <td style={styles.td}>{String(row.fecha_inicio ?? "-")}</td>
                      <td style={styles.td}>{String(row.fecha_fin ?? "-")}</td>
                      <td style={styles.td}>
                        {String(row.generado_por_nombre ?? row.generado_por ?? "-")}
                      </td>
                      <td style={styles.td}>
                        <div style={styles.rowActions}>
                          <button
                            type="button"
                            style={styles.inlineBtn}
                            onClick={() => void handleDownloadClosure(row)}
                            disabled={
                              mutatingReport ||
                              downloadingClosureId === String(row.id ?? "")
                            }
                          >
                            {downloadingClosureId === String(row.id ?? "")
                              ? "Descargando..."
                              : "Descargar area"}
                          </button>
                          <button
                            type="button"
                            style={styles.inlineDangerBtn}
                            onClick={() => void handleDeleteClosure(row)}
                            disabled={mutatingReport}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={styles.hero}>
        <div>
          <div style={styles.heroKicker}>Cierres operativos</div>
          <h2 style={styles.heroTitle}>
            Centro profesional de reportes por área
          </h2>
          <p style={styles.heroText}>
            Revisa incidencias, divide el trabajo por área y genera cierres
            separados para administración.
          </p>
        </div>
        <div style={styles.heroStats}>
          <span style={styles.heroBadge}>{rows.length} registros</span>
          <span style={styles.heroBadge}>
            {areaSections.filter((section) => section.rows.length > 0).length}{" "}
            áreas activas
          </span>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <h3 style={styles.h3}>Filtros de cierre</h3>
            <p style={styles.cardSubtext}>
              Selecciona rango y área para preparar la información antes de
              generar el CSV.
            </p>
          </div>
        </div>
        <div style={styles.filters}>
          <label style={styles.label}>Desde</label>
          <input
            style={{ ...styles.input, ...styles.filterInput }}
            type="date"
            title="Fecha de inicio"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
          />
          <label style={styles.label}>Hasta</label>
          <input
            style={{ ...styles.input, ...styles.filterInput }}
            type="date"
            title="Fecha de fin"
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
          />

          {user.role === "admin" && (
            <>
              <label style={styles.label}>Área</label>
              <select
                style={{ ...styles.input, ...styles.filterInput }}
                title="Seleccionar área"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                <option value="all">Todas</option>
                {areaOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            style={{ ...styles.secondaryBtn, ...styles.filterBtn }}
            onClick={() => void loadRows()}
          >
            Filtrar
          </button>
          {user.role === "admin" && (
            <button
              style={{
                ...styles.primaryBtn,
                ...styles.filterBtn,
                backgroundColor: "#d4a574",
              }}
              onClick={() => void handleStartClosure()}
              disabled={executingManualClosure}
            >
              {executingManualClosure
                ? "Iniciando cierre..."
                : "Empezar Cierre"}
            </button>
          )}
          <button
            style={{ ...styles.primaryBtn, ...styles.filterBtn }}
            onClick={() => void handleGenerateExcel()}
            disabled={generating || !canGenerateExcel}
          >
            {generating ? "Generando..." : "Generar Excel"}
          </button>
        </div>
        {success && <p style={styles.success}>{success}</p>}
        {notice && <p style={styles.info}>{notice}</p>}
        {error && <p style={styles.error}>{error}</p>}
      </div>

      <div style={styles.card}>
        <h3 style={styles.h3}>Previsualización / Historial en tabla</h3>
        {loading ? (
          <p>Cargando...</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Fecha</th>
                <th style={styles.th}>Área</th>
                <th style={styles.th}>Pedido</th>
                <th style={styles.th}>Cantidad</th>
                <th style={styles.th}>Motivo</th>
                {user.role === "admin" && <th style={styles.th}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={`${String(r.id ?? idx)}-${idx}`}
                  style={styles.clickableRow}
                  onClick={() => setSelectedRow(r)}
                  title="Ver detalle del registro"
                >
                  <td style={styles.td}>
                    {String(r.fecha ?? r.fecha_registro ?? "-")}
                  </td>
                  <td style={styles.td}>
                    {areaNameById[String(r.area_id ?? "")] ??
                      String(r.area_id ?? "-")}
                  </td>
                  <td style={styles.td}>{String(r.nombre_pedido ?? "-")}</td>
                  <td style={styles.td}>{String(r.cantidad_danada ?? "-")}</td>
                  <td style={styles.td}>{String(r.motivo_dano ?? "-")}</td>
                  {user.role === "admin" && (
                    <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                      <div style={styles.rowActions}>
                        <button
                          type="button"
                          style={styles.inlineBtn}
                          onClick={() => startEditReport(r)}
                          disabled={mutatingReport}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          style={styles.inlineDangerBtn}
                          onClick={() => void handleDeleteReport(r)}
                          disabled={mutatingReport}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td style={styles.td} colSpan={user.role === "admin" ? 6 : 5}>
                    Sin registros para el filtro actual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div style={styles.areaSectionsGrid}>
        {areaSections.map((section) => {
          const lastClosure = section.closures[0];
          const latestRow = section.rows[0];
          return (
            <section
              key={section.code}
              style={{
                ...styles.areaReportCard,
                ...styles[`areaReportCard_${section.code}`],
              }}
            >
              <div style={styles.areaReportHeader}>
                <div>
                  <span style={styles.areaReportKicker}>Sección por área</span>
                  <h3 style={styles.areaReportTitle}>{section.label}</h3>
                </div>
                <span style={styles.areaReportBadge}>
                  {section.rows.length}
                </span>
              </div>
              <div style={styles.areaReportMetrics}>
                <div style={styles.areaReportMetric}>
                  <span>Registros</span>
                  <strong>{section.rows.length}</strong>
                </div>
                <div style={styles.areaReportMetric}>
                  <span>Último pedido</span>
                  <strong>
                    {formatDateShort(
                      latestRow?.fecha ?? latestRow?.fecha_registro,
                    )}
                  </strong>
                </div>
                <div style={styles.areaReportMetric}>
                  <span>Último cierre</span>
                  <strong>{formatDateShort(lastClosure?.created_at)}</strong>
                </div>
              </div>
              <div style={styles.areaReportPreview}>
                {section.rows.slice(0, 3).map((row, index) => (
                  <button
                    key={`${section.code}-${String(row.id ?? index)}`}
                    type="button"
                    style={styles.areaReportItem}
                    onClick={() => setSelectedRow(row)}
                  >
                    <span>
                      {String(row.nombre_pedido ?? "Pedido sin nombre")}
                    </span>
                    <strong>{String(row.motivo_dano ?? "Sin motivo")}</strong>
                  </button>
                ))}
                {section.rows.length === 0 && (
                  <div style={styles.areaReportEmpty}>
                    Sin registros en el rango seleccionado.
                  </div>
                )}
              </div>
              <div style={styles.areaReportActions}>
                <button
                  type="button"
                  style={styles.hidden}
                  onClick={() => setArea(section.code)}
                >
                  Ver solo esta área
                </button>
                <button
                  type="button"
                  style={{ ...styles.primaryBtn, ...styles.areaGenerateBtn }}
                  onClick={() =>
                    void handleGenerateExcel(section.code, section.rows)
                  }
                  disabled={
                    generating || !canGenerateExcel || section.rows.length === 0
                  }
                >
                  Generar Excel del área
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {selectedRow && (
        <div style={styles.modalBackdrop} onClick={() => setSelectedRow(null)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>Detalle del registro</h3>
                <p style={styles.modalSubtitle}>
                  Revisa la información general y la referencia de Trello
                  asociada.
                </p>
              </div>
              <div style={styles.modalActions}>
                {user.role === "admin" && (
                  <>
                    <button
                      type="button"
                      style={styles.secondaryBtn}
                      onClick={() => startEditReport(selectedRow)}
                      disabled={mutatingReport}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      style={styles.dangerBtn}
                      onClick={() => void handleDeleteReport(selectedRow)}
                      disabled={mutatingReport}
                    >
                      Eliminar
                    </button>
                  </>
                )}
                <button
                  style={styles.modalCloseBtn}
                  onClick={() => {
                    setSelectedRow(null);
                    setEditingRow(null);
                  }}
                >
                  Cerrar
                </button>
              </div>
            </div>

            {(() => {
              const matchedCardId = trelloMatchedCard
                ? getRowString(trelloMatchedCard, "id")
                : null;
              const matchedCardName = trelloMatchedCard
                ? getRowString(trelloMatchedCard, "name")
                : null;
              const matchedCardUrl = trelloMatchedCard
                ? getRowString(trelloMatchedCard, "url")
                : null;
              const matchedListId = trelloMatchedCard
                ? getRowString(trelloMatchedCard, "idList")
                : null;
              const matchedListName = trelloMatchedCard
                ? getRowString(trelloMatchedCard, "listName")
                : null;
              const matchedBoard = trelloMatchedCard
                ? getFirstNonEmpty(
                    getRowString(trelloMatchedCard, "boardName"),
                    getRowString(trelloMatchedCard, "idBoard"),
                  )
                : null;

              const trelloCardId = getFirstNonEmpty(
                getRowString(selectedRow, "trello_card_id"),
                matchedCardId,
              );
              const trelloCardName = getFirstNonEmpty(
                getRowString(selectedRow, "trello_card_name"),
                matchedCardName,
              );
              const trelloListId = getFirstNonEmpty(
                getRowString(selectedRow, "trello_list_id"),
                matchedListId,
              );
              const trelloListName = getFirstNonEmpty(
                getRowString(selectedRow, "trello_list_name"),
                matchedListName,
              );
              const trelloBoard = getFirstNonEmpty(
                getRowString(selectedRow, "trello_board_name"),
                getRowString(selectedRow, "trello_board_id"),
                matchedBoard,
              );
              const trelloDescription = getFirstNonEmpty(
                getRowString(selectedRow, "trello_card_desc"),
                getRowString(selectedRow, "trello_description"),
                trelloMatchedCard
                  ? getRowString(trelloMatchedCard, "desc")
                  : null,
              );
              const trelloUrl = getFirstNonEmpty(
                resolveTrelloUrl(selectedRow),
                matchedCardUrl,
                trelloCardId ? `https://trello.com/c/${trelloCardId}` : null,
              );
              const hasTrelloData = Boolean(
                trelloCardId ||
                trelloCardName ||
                trelloListId ||
                trelloListName ||
                trelloBoard ||
                trelloUrl,
              );
              return (
                <>
                  <div style={styles.modalSectionLabel}>Tarjeta de Trello</div>
                  <div style={styles.trelloInfoBox}>
                    <div style={styles.trelloInfoHeader}>
                      <div style={styles.trelloInfoTitle}>
                        Información anexada automáticamente
                      </div>
                      <span
                        style={{
                          ...styles.trelloStatus,
                          ...(hasTrelloData
                            ? styles.trelloStatusConnected
                            : styles.trelloStatusEmpty),
                        }}
                      >
                        {hasTrelloData ? "Conectada" : "Sin tarjeta"}
                      </span>
                    </div>

                    {trelloAutoSaved && !trelloLookupLoading && (
                      <div style={styles.trelloLookupHint}>
                        La tarjeta vinculada ya se sincronizó automáticamente y
                        quedó guardada en este registro.
                      </div>
                    )}

                    <div style={styles.trelloInfoGrid}>
                      <div style={styles.trelloInfoItem}>
                        <div style={styles.trelloInfoKey}>Tarjeta</div>
                        <div style={styles.trelloInfoValue}>
                          {trelloCardName ?? "-"}
                        </div>
                      </div>
                      <div style={styles.trelloInfoItem}>
                        <div style={styles.trelloInfoKey}>Lista</div>
                        <div style={styles.trelloInfoValue}>
                          {trelloListName ?? "-"}
                        </div>
                      </div>
                      <div style={styles.trelloInfoItem}>
                        <div style={styles.trelloInfoKey}>Tablero</div>
                        <div style={styles.trelloInfoValue}>
                          {trelloBoard ?? "-"}
                        </div>
                      </div>
                      <div style={styles.trelloInfoItemWide}>
                        <div style={styles.trelloInfoKey}>Enlace</div>
                        <div style={styles.trelloInfoValue}>
                          {trelloUrl ? (
                            <a
                              href={trelloUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={styles.trelloInfoLinkBtn}
                            >
                              Abrir tarjeta en Trello
                            </a>
                          ) : (
                            "No disponible"
                          )}
                        </div>
                      </div>
                      <div style={styles.trelloInfoItemWide}>
                        <div style={styles.trelloInfoKey}>Descripción</div>
                        <div style={styles.trelloInfoDescription}>
                          {trelloDescription ?? "Sin descripción en Trello."}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}

            <div style={styles.modalSectionLabel}>Datos del registro</div>
            {editingRow &&
              String(editingRow.id ?? "") === String(selectedRow.id ?? "") && (
                <div style={styles.editPanel}>
                  <div style={styles.editGrid}>
                    <label style={styles.editField}>
                      <span style={styles.modalKey}>Fecha</span>
                      <input
                        type="date"
                        style={styles.input}
                        value={editForm.fecha}
                        onChange={(e) =>
                          setEditForm((current) => ({
                            ...current,
                            fecha: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label style={styles.editField}>
                      <span style={styles.modalKey}>Area</span>
                      <select
                        style={styles.input}
                        value={editForm.area}
                        onChange={(e) =>
                          setEditForm((current) => ({
                            ...current,
                            area: e.target.value,
                          }))
                        }
                      >
                        {areaOptions.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label
                      style={{ ...styles.editField, gridColumn: "1 / -1" }}
                    >
                      <span style={styles.modalKey}>Pedido</span>
                      <input
                        style={styles.input}
                        value={editForm.nombrePedido}
                        onChange={(e) =>
                          setEditForm((current) => ({
                            ...current,
                            nombrePedido: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label style={styles.editField}>
                      <span style={styles.modalKey}>Cantidad</span>
                      <input
                        style={styles.input}
                        value={editForm.cantidadDanada}
                        onChange={(e) =>
                          setEditForm((current) => ({
                            ...current,
                            cantidadDanada: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label style={styles.editField}>
                      <span style={styles.modalKey}>Persona</span>
                      <input
                        style={styles.input}
                        value={editForm.personaDano}
                        onChange={(e) =>
                          setEditForm((current) => ({
                            ...current,
                            personaDano: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label style={styles.editField}>
                      <span style={styles.modalKey}>Tipo trabajo</span>
                      <input
                        style={styles.input}
                        value={editForm.tipoTrabajo}
                        onChange={(e) =>
                          setEditForm((current) => ({
                            ...current,
                            tipoTrabajo: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label style={styles.editField}>
                      <span style={styles.modalKey}>Tipo dano</span>
                      <input
                        style={styles.input}
                        value={editForm.tipoDano}
                        onChange={(e) =>
                          setEditForm((current) => ({
                            ...current,
                            tipoDano: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label
                      style={{ ...styles.editField, gridColumn: "1 / -1" }}
                    >
                      <span style={styles.modalKey}>Motivo</span>
                      <input
                        style={styles.input}
                        value={editForm.motivoDano}
                        onChange={(e) =>
                          setEditForm((current) => ({
                            ...current,
                            motivoDano: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label
                      style={{ ...styles.editField, gridColumn: "1 / -1" }}
                    >
                      <span style={styles.modalKey}>Observacion</span>
                      <textarea
                        style={styles.textarea}
                        value={editForm.observacion}
                        onChange={(e) =>
                          setEditForm((current) => ({
                            ...current,
                            observacion: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div style={styles.editActions}>
                    <button
                      type="button"
                      style={styles.primaryBtn}
                      onClick={() => void handleSaveReport()}
                      disabled={mutatingReport}
                    >
                      {mutatingReport ? "Guardando..." : "Guardar cambios"}
                    </button>
                    <button
                      type="button"
                      style={styles.secondaryBtn}
                      onClick={() => setEditingRow(null)}
                      disabled={mutatingReport}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            {!(
              editingRow &&
              String(editingRow.id ?? "") === String(selectedRow.id ?? "")
            ) && (
              <div style={styles.modalGrid}>
                <div style={styles.modalItem}>
                  <div style={styles.modalKey}>Área</div>
                  <div style={styles.modalValue}>{selectedAreaName}</div>
                </div>
                {Object.entries(selectedRow)
                  .filter(([key]) => !hiddenDetailKeys.has(key))
                  .map(([key, value]) => (
                    <div key={key} style={styles.modalItem}>
                      <div style={styles.modalKey}>{humanizeKey(key)}</div>
                      <div style={styles.modalValue}>
                        {formatDetailValue(key, value)}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={styles.card}>
        <h3 style={styles.h3}>Registro de cierres guardados por área</h3>
        {loadingClosures ? (
          <p>Cargando cierres...</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Fecha de cierre</th>
                <th style={styles.th}>Área</th>
                <th style={styles.th}>Desde</th>
                <th style={styles.th}>Hasta</th>
                <th style={styles.th}>Generado por</th>
                {user.role === "admin" && <th style={styles.th}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {closureRows.map((r, idx) => (
                <tr key={`${String(r.id ?? idx)}-closure-${idx}`}>
                  <td style={styles.td}>
                    {String(r.created_at ?? "-").slice(0, 10)}
                  </td>
                  <td style={styles.td}>
                    {formatAreaLabel(String(r.area ?? "-"))}
                  </td>
                  <td style={styles.td}>{String(r.fecha_inicio ?? "-")}</td>
                  <td style={styles.td}>{String(r.fecha_fin ?? "-")}</td>
                  <td style={styles.td}>
                    {String(r.generado_por_nombre ?? r.generado_por ?? "-")}
                  </td>
                  {user.role === "admin" && (
                    <td style={styles.td}>
                      <div style={styles.rowActions}>
                        <button
                          type="button"
                          style={styles.inlineBtn}
                          onClick={() => void handleDownloadClosure(r)}
                          disabled={
                            mutatingReport ||
                            downloadingClosureId === String(r.id ?? "")
                          }
                        >
                          {downloadingClosureId === String(r.id ?? "")
                            ? "Descargando..."
                            : "Descargar"}
                        </button>
                        <button
                          type="button"
                          style={styles.inlineDangerBtn}
                          onClick={() => void handleDeleteClosure(r)}
                          disabled={mutatingReport}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {closureRows.length === 0 && (
                <tr>
                  <td style={styles.td} colSpan={user.role === "admin" ? 6 : 5}>
                    Sin cierres guardados para el filtro actual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  hero: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background:
      "linear-gradient(135deg, #0f172a 0%, #1d4ed8 52%, #0891b2 100%)",
    color: "#fff",
    borderRadius: 18,
    padding: 22,
    marginBottom: 14,
    boxShadow: "0 18px 42px rgba(15,23,42,.18)",
  },
  heroKicker: {
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    color: "#bfdbfe",
    marginBottom: 6,
  },
  heroTitle: { fontSize: 28, marginBottom: 6, lineHeight: 1.08 },
  heroText: { color: "rgba(255,255,255,.86)", fontSize: 13 },
  heroStats: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    alignItems: "flex-end",
  },
  heroBadge: {
    background: "rgba(255,255,255,.15)",
    border: "1px solid rgba(255,255,255,.24)",
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 700,
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    boxShadow: "0 10px 28px rgba(15,23,42,.08)",
    border: "1px solid #e2e8f0",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  cardSubtext: { margin: "4px 0 0", color: "#64748b", fontSize: 13 },
  h3: { marginBottom: 12, color: "#111827" },
  filters: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  label: { fontSize: 13, color: "#4b5563", fontWeight: 600 },
  input: {
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 14,
    background: "#fff",
  },
  filterInput: { minWidth: 180 },
  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  },
  secondaryBtn: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#334155",
    fontWeight: 600,
    cursor: "pointer",
  },
  dangerBtn: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #fecaca",
    background: "#fee2e2",
    color: "#991b1b",
    fontWeight: 700,
    cursor: "pointer",
  },
  filterBtn: { whiteSpace: "nowrap" },
  info: {
    marginTop: 10,
    color: "#1e3a8a",
    background: "#dbeafe",
    padding: "8px 10px",
    borderRadius: 8,
  },
  success: {
    marginTop: 10,
    color: "#166534",
    background: "#dcfce7",
    padding: "8px 10px",
    borderRadius: 8,
  },
  error: {
    marginTop: 10,
    color: "#b91c1c",
    background: "#fee2e2",
    padding: "8px 10px",
    borderRadius: 8,
  },
  areaSectionsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  areaReportCard: {
    background: "#2563eb",
    border: "1px solid rgba(255,255,255,.28)",
    borderRadius: 14,
    padding: 13,
    boxShadow: "0 10px 24px rgba(15,23,42,.12)",
    minHeight: 150,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  areaReportCard_impresion: {
    background: "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)",
  },
  areaReportCard_diseno: {
    background: "linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)",
  },
  areaReportCard_sublimacion: {
    background: "linear-gradient(135deg, #15803d 0%, #16a34a 100%)",
  },
  areaReportCard_administracion: {
    background: "linear-gradient(135deg, #b45309 0%, #f59e0b 100%)",
  },
  areaReportHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  areaReportKicker: {
    color: "rgba(255,255,255,.82)",
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
  },
  areaReportTitle: { margin: "3px 0 0", color: "#fff", fontSize: 18 },
  areaReportBadge: {
    background: "rgba(255,255,255,.18)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,.34)",
    borderRadius: 999,
    padding: "5px 10px",
    fontSize: 12,
    fontWeight: 900,
  },
  areaReportMetrics: { display: "none" },
  areaReportMetric: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: 9,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  areaReportPreview: { display: "none" },
  areaReportItem: {
    border: "1px solid #e2e8f0",
    background: "#fff",
    borderRadius: 12,
    padding: "9px 10px",
    textAlign: "left",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  areaReportEmpty: {
    border: "1px dashed #cbd5e1",
    background: "#f8fafc",
    borderRadius: 12,
    padding: 12,
    color: "#64748b",
    fontSize: 13,
  },
  areaReportActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  areaGenerateBtn: {
    background: "#fff",
    color: "#0f172a",
    border: "1px solid rgba(255,255,255,.5)",
    boxShadow: "none",
  },
  hidden: { display: "none" },
  table: { width: "100%", borderCollapse: "collapse" },
  clickableRow: { cursor: "pointer" },
  rowActions: { display: "flex", gap: 6, flexWrap: "wrap" },
  inlineBtn: {
    padding: "6px 9px",
    borderRadius: 7,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 12,
  },
  inlineDangerBtn: {
    padding: "6px 9px",
    borderRadius: 7,
    border: "1px solid #fecaca",
    background: "#fff1f2",
    color: "#be123c",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 12,
  },
  th: {
    textAlign: "left",
    fontSize: 12,
    color: "#6b7280",
    borderBottom: "1px solid #e5e7eb",
    padding: "8px 6px",
  },
  td: {
    fontSize: 13,
    color: "#1f2937",
    borderBottom: "1px solid #f3f4f6",
    padding: "8px 6px",
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    padding: 16,
  },
  modalCard: {
    width: "min(920px, 96vw)",
    maxHeight: "86vh",
    overflow: "auto",
    background: "#fff",
    borderRadius: 16,
    padding: 16,
    border: "1px solid #e2e8f0",
    boxShadow: "0 20px 48px rgba(2, 6, 23, 0.24)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
  },
  modalActions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  modalTitle: { margin: 0, color: "#0f172a", fontSize: 18 },
  modalSubtitle: { margin: "6px 0 0 0", fontSize: 13, color: "#64748b" },
  modalCloseBtn: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#334155",
    fontWeight: 600,
    cursor: "pointer",
  },
  modalSectionLabel: {
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    fontWeight: 800,
    color: "#475569",
    marginBottom: 8,
    marginTop: 4,
  },
  modalGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 10,
  },
  editPanel: {
    border: "1px solid #bfdbfe",
    borderRadius: 12,
    background: "#f8fbff",
    padding: 12,
    marginBottom: 12,
  },
  editGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 10,
  },
  editField: { display: "flex", flexDirection: "column", gap: 5 },
  editActions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 12,
    flexWrap: "wrap",
  },
  textarea: {
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 14,
    background: "#fff",
    minHeight: 90,
    resize: "vertical",
  },
  trelloInfoBox: {
    border: "1px solid #93c5fd",
    background: "linear-gradient(180deg, #eff6ff 0%, #f8fbff 100%)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  trelloInfoHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  },
  trelloLookupHint: {
    fontSize: 12,
    color: "#1e3a8a",
    background: "#dbeafe",
    border: "1px solid #93c5fd",
    borderRadius: 8,
    padding: "6px 8px",
    marginBottom: 8,
  },
  trelloInfoTitle: { fontSize: 14, fontWeight: 800, color: "#1e40af" },
  trelloStatus: {
    fontSize: 11,
    fontWeight: 800,
    borderRadius: 999,
    padding: "4px 10px",
    border: "1px solid transparent",
  },
  trelloStatusConnected: {
    color: "#166534",
    background: "#dcfce7",
    borderColor: "#86efac",
  },
  trelloStatusEmpty: {
    color: "#92400e",
    background: "#fef3c7",
    borderColor: "#fcd34d",
  },
  trelloInfoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 8,
  },
  trelloInfoItem: {
    border: "1px solid #bfdbfe",
    borderRadius: 10,
    padding: "8px 10px",
    background: "#ffffffcc",
  },
  trelloInfoItemWide: {
    border: "1px solid #bfdbfe",
    borderRadius: 10,
    padding: "8px 10px",
    background: "#ffffffcc",
    gridColumn: "1 / -1",
  },
  trelloInfoKey: {
    fontSize: 11,
    fontWeight: 800,
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  trelloInfoValue: { fontSize: 13, color: "#0f172a", wordBreak: "break-word" },
  trelloInfoDescription: {
    fontSize: 13,
    color: "#0f172a",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  trelloInfoLinkBtn: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 8,
    color: "#1e3a8a",
    border: "1px solid #93c5fd",
    textDecoration: "none",
    background: "#eff6ff",
    fontWeight: 700,
  },
  modalItem: {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: 10,
    background: "#f8fafc",
  },
  modalKey: {
    fontSize: 11,
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 700,
    marginBottom: 4,
  },
  modalValue: { fontSize: 13, color: "#0f172a", wordBreak: "break-word" },
};
