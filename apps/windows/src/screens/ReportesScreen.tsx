import React from 'react';
import { supabase } from '../core/supabase';
import type { AuthUser } from '../services/auth';

interface Props {
  user: AuthUser;
}

type AnyRow = Record<string, unknown>;
type TrelloLookupCard = Record<string, unknown>;

function normalizeLookupCard(item: Record<string, unknown>): TrelloLookupCard {
  const descValue = typeof item.desc === 'string'
    ? item.desc
    : (typeof item.description === 'string' ? item.description : undefined);

  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    url: String(item.url ?? ''),
    idList: String(item.idList ?? ''),
    listName: String(item.listName ?? ''),
    desc: descValue,
  };
}

function normalizeAreaCode(area: string): string {
  const clean = area
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
  const code = normalizeAreaCode(String(area ?? ''));
  if (code === 'impresion') return 'IMPRESIÓN';
  if (code === 'diseno') return 'DISEÑO';
  if (code === 'sublimacion') return 'SUBLIMACIÓN';
  if (code === 'administracion') return 'ADMINISTRACIÓN';
  return String(area ?? '-');
}

function toCsv(rows: AnyRow[]): string {
  const headers = ['fecha', 'area_id', 'nombre_pedido', 'cantidad_danada', 'motivo_dano', 'tipo_dano', 'persona_dano'];
  const escape = (v: unknown): string => {
    const value = v == null ? '' : String(v);
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const body = rows.map((row) => [
    escape(row.fecha ?? row.fecha_registro ?? ''),
    escape(row.area_id ?? ''),
    escape(row.nombre_pedido ?? ''),
    escape(row.cantidad_danada ?? ''),
    escape(row.motivo_dano ?? ''),
    escape(row.tipo_dano ?? ''),
    escape(row.persona_dano ?? ''),
  ].join(','));

  return [headers.join(','), ...body].join('\r\n');
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDetailValue(key: string, value: unknown): string {
  if (value == null) return '-';
  if (key.includes('fecha')) {
    const raw = String(value);
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('es-MX', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
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

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function resolveTrelloUrl(row: AnyRow): string | null {
  const directUrl = getRowString(row, 'trello_card_url');
  if (directUrl) return directUrl;

  const cardId = getRowString(row, 'trello_card_id');
  if (cardId) return `https://trello.com/c/${cardId}`;

  return null;
}

function extractTrelloShortCode(value: string | null): string | null {
  if (!value) return null;
  const input = value.trim();
  if (!input) return null;

  if (input.startsWith('http://') || input.startsWith('https://')) {
    try {
      const url = new URL(input);
      const match = url.pathname.match(/\/c\/([^/]+)/i);
      if (match?.[1]) return match[1].toLowerCase();
    } catch {
      return null;
    }
    return null;
  }

  const normalized = input.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (normalized.length >= 8 && normalized.length <= 12) return normalized;
  return null;
}

export function ReportesScreen({ user }: Props): React.JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [loadingClosures, setLoadingClosures] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<AnyRow[]>([]);
  const [closureRows, setClosureRows] = React.useState<AnyRow[]>([]);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [areaIdByCode, setAreaIdByCode] = React.useState<Record<string, string>>({});
  const [areaNameById, setAreaNameById] = React.useState<Record<string, string>>({});
  const [userAreaId, setUserAreaId] = React.useState<string | null>(null);
  const [selectedRow, setSelectedRow] = React.useState<AnyRow | null>(null);
  const [trelloCatalog, setTrelloCatalog] = React.useState<TrelloLookupCard[] | null>(null);
  const [trelloMatchedCard, setTrelloMatchedCard] = React.useState<TrelloLookupCard | null>(null);
  const [trelloLookupLoading, setTrelloLookupLoading] = React.useState(false);
  const [trelloAutoSaved, setTrelloAutoSaved] = React.useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [fechaInicio, setFechaInicio] = React.useState(today);
  const [fechaFin, setFechaFin] = React.useState(today);
  const [area, setArea] = React.useState('all');

  const selectedAreaId = String(selectedRow?.area_id ?? '');
  const selectedAreaName = selectedRow
    ? (areaNameById[selectedAreaId] ? areaNameById[selectedAreaId] : (selectedAreaId || '-'))
    : '-';

  const hiddenDetailKeys = React.useMemo(
    () => new Set(['id', 'area_id', 'trello_card_id', 'trello_card_url', 'trello_list_id', 'trello_card_name', 'trello_list_name', 'trello_board_id', 'trello_board_name', 'trello_card_desc']),
    [],
  );

  const now = new Date();
  const day = now.getDate();
  const canGenerateToday = day === 15 || day === 30;
  const canGenerateExcel = user.role === 'admin' && canGenerateToday;

  React.useEffect(() => {
    async function loadAreaCatalog(): Promise<void> {
      const { data } = await supabase.from('areas').select('id,code');
      const map: Record<string, string> = {};
      const namesById: Record<string, string> = {};
      for (const item of data ?? []) {
        const keyRaw = String(item.code ?? '');
        const key = normalizeAreaCode(keyRaw);
        const value = String(item.id ?? '');
        if (key && value) {
          map[key] = value;
          namesById[value] = formatAreaLabel(key);
        }
      }
      setAreaIdByCode(map);
      setAreaNameById(namesById);

      if (user.role !== 'admin' && user.area) {
        const code = normalizeAreaCode(user.area);
        setUserAreaId(map[code] ?? null);
      }
    }

    void loadAreaCatalog();
  }, [user.area, user.role]);

  const loadRows = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const selectWithDesc = 'id,fecha,fecha_registro,area_id,nombre_pedido,cantidad_danada,motivo_dano,trello_card_id,trello_card_name,trello_card_url,trello_list_id,trello_list_name,trello_board_id,trello_board_name,trello_card_desc';
    const selectWithoutDesc = 'id,fecha,fecha_registro,area_id,nombre_pedido,cantidad_danada,motivo_dano,trello_card_id,trello_card_name,trello_card_url,trello_list_id,trello_list_name,trello_board_id,trello_board_name';

    const buildQuery = (selectText: string) => {
      let q = supabase
        .from('pedidos_danados')
        .select(selectText)
        .order('fecha_registro', { ascending: false })
        .limit(300);

      if (user.role !== 'admin' && userAreaId) {
        q = q.eq('area_id', userAreaId);
      }

      if (user.role === 'admin' && area !== 'all') {
        const selectedAreaId = areaIdByCode[area];
        if (selectedAreaId) {
          q = q.eq('area_id', selectedAreaId);
        }
      }

      return q;
    };

    let missingTrelloDescColumn = false;
    let { data, error: qErr } = await buildQuery(selectWithDesc);
    if (qErr && qErr.message.toLowerCase().includes('trello_card_desc')) {
      missingTrelloDescColumn = true;
      const fallback = await buildQuery(selectWithoutDesc);
      data = fallback.data;
      qErr = fallback.error;
    }

    if (!qErr) {
      const from = fechaInicio;
      const to = fechaFin;
      const filtered = ((data ?? []) as unknown as AnyRow[]).filter((row) => {
        const raw = row.fecha ?? row.fecha_registro;
        if (!raw) return true;
        const normalized = String(raw).slice(0, 10);
        if (from && normalized < from) return false;
        if (to && normalized > to) return false;
        return true;
      });
      setRows(filtered);
      if (missingTrelloDescColumn) {
        setError('La descripcion de Trello no aparece porque falta la columna trello_card_desc en Supabase. Ejecuta la migracion 20240101000009_add_trello_card_desc_to_pedidos.sql.');
      }
    } else {
      setError(qErr.message);
      setRows([]);
    }
    setLoading(false);
  }, [area, areaIdByCode, fechaFin, fechaInicio, user.role, userAreaId]);

  const loadClosures = React.useCallback(async (): Promise<void> => {
    setLoadingClosures(true);

    let query = supabase
      .from('reportes_generados')
      .select('id,created_at,area,fecha_inicio,fecha_fin,generado_por')
      .order('created_at', { ascending: false })
      .limit(300);

    if (user.role !== 'admin' && user.area) {
      const areaCode = normalizeAreaCode(user.area);
      query = query.eq('area', areaCode);
    }

    if (user.role === 'admin' && area !== 'all') {
      query = query.eq('area', area);
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
      .channel('reportes-pedidos-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos_danados' },
        () => {
          void loadRows();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reportes_generados' },
        () => {
          void loadClosures();
        },
      )
      .subscribe();

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
          getRowString(selectedRow, 'trello_card_id'),
          getRowString(selectedRow, 'trello_card_url'),
        ),
      );
      const hasDescription = Boolean(
        getFirstNonEmpty(
          getRowString(selectedRow, 'trello_card_desc'),
          getRowString(selectedRow, 'trello_description'),
        ),
      );

      if (hasTrelloData && hasDescription) {
        setTrelloMatchedCard(null);
        setTrelloLookupLoading(false);
        setTrelloAutoSaved(false);
        return;
      }

      const rowCardId = getRowString(selectedRow, 'trello_card_id');
      const rowUrl = getRowString(selectedRow, 'trello_card_url');
      const rowShortCode = extractTrelloShortCode(rowUrl) ?? extractTrelloShortCode(rowCardId);
      const hasExplicitTrelloReference = Boolean(rowCardId || rowUrl || rowShortCode);
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
            getRowString(selectedRow, 'trello_board_id'),
            String(import.meta.env.VITE_TRELLO_BOARD_ID ?? '3cv4PjjJ'),
          ) ?? '3cv4PjjJ',
        ).trim();
        const { data, error: fnErr } = await supabase.functions.invoke('trello_cards_by_my_area', {
          body: { boardId },
        });

        if (fnErr) {
          if (active) {
            setTrelloLookupLoading(false);
            setTrelloMatchedCard(null);
          }
          return;
        }

        const rawCards = ((data as { cards?: Record<string, unknown>[] } | null)?.cards ?? []) as Record<string, unknown>[];
        cards = rawCards.map(normalizeLookupCard).filter((card) => getRowString(card, 'id') && getRowString(card, 'name'));
        if (active) setTrelloCatalog(cards);
      }

      const exactById = rowCardId
        ? (cards ?? []).find((card) => String(card.id ?? '').trim() === rowCardId)
        : null;
      const exactByShortCode = rowShortCode
        ? (cards ?? []).find((card) => extractTrelloShortCode(getRowString(card, 'url')) === rowShortCode)
        : null;
      const matched = exactById ?? exactByShortCode ?? null;

      if (matched) {
        const recordId = getRowString(selectedRow, 'id');
        if (recordId) {
          // No sobreescribir trello_card_desc si ya existe en el registro o si matched no tiene desc
          const existingDesc = getRowString(selectedRow, 'trello_card_desc');
          const matchedDesc = getRowString(matched, 'desc');
          const descToSave = matchedDesc ?? existingDesc ?? undefined;

          const updatePayload: AnyRow = {
            trello_card_id: getRowString(matched, 'id') ?? undefined,
            trello_card_name: getRowString(matched, 'name') ?? undefined,
            trello_card_url: getRowString(matched, 'url') ?? undefined,
            trello_list_id: getRowString(matched, 'idList') ?? undefined,
            trello_list_name: getRowString(matched, 'listName') ?? undefined,
            trello_board_id: getFirstNonEmpty(getRowString(matched, 'idBoard'), getRowString(matched, 'boardId')) ?? undefined,
            trello_board_name: getRowString(matched, 'boardName') ?? undefined,
          };

          // Solo incluir trello_card_desc en el update si hay un valor real que guardar
          if (descToSave) {
            updatePayload.trello_card_desc = descToSave;
          }

          const { error: updateError } = await supabase
            .from('pedidos_danados')
            .update(updatePayload)
            .eq('id', recordId);

          if (!updateError && active) {
            // Preservar trello_card_desc existente si el updatePayload no lo incluye
            const nextSelected = {
              ...selectedRow,
              ...updatePayload,
              trello_card_desc: descToSave ?? getRowString(selectedRow, 'trello_card_desc') ?? undefined,
            };
            setSelectedRow(nextSelected);
            setRows((current) => current.map((row) => (String(row.id ?? '') === recordId ? { ...row, ...updatePayload } : row)));
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

  async function handleGenerateCsv(): Promise<void> {
    if (!canGenerateExcel) {
      if (user.role !== 'admin') {
        setError('Solo el administrador puede generar Excel de cierre.');
      } else {
        setError('El Excel de cierre solo puede generarse los días 15 y 30 a las 8:00 AM.');
      }
      return;
    }

    setGenerating(true);
    setError(null);

    const csvText = toCsv(rows);

    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cierre_quincenal_${fechaInicio}_${fechaFin}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const reportArea = area === 'all' ? 'all' : area;
    const saveMeta = await supabase.from('reportes_generados').insert({
      area: reportArea,
      generado_por: user.id,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
    });

    if (saveMeta.error) {
      setError(`Excel generado, pero no se guardó historial de cierre: ${saveMeta.error.message}`);
    } else {
      setSuccess('Cierre generado y guardado en historial.');
      window.setTimeout(() => setSuccess(null), 3000);
    }

    setGenerating(false);
    void loadRows();
    void loadClosures();
  }

  return (
    <div>
      <div style={styles.hero}>
        <div>
          <h2 style={styles.heroTitle}>Centro de Reportes</h2>
          <p style={styles.heroText}>Genera CSV por rango de fechas y revisa historial de reportes emitidos.</p>
        </div>
        <div style={styles.heroBadge}>{rows.length} reportes</div>
      </div>

      <div style={styles.card}>
        <h3 style={styles.h3}>Tabla de registros (actualiza al instante)</h3>
        <div style={styles.filters}>
          <label style={styles.label}>Desde</label>
          <input style={{ ...styles.input, ...styles.filterInput }} type="date" title="Fecha de inicio" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
          <label style={styles.label}>Hasta</label>
          <input style={{ ...styles.input, ...styles.filterInput }} type="date" title="Fecha de fin" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />

          {user.role === 'admin' && (
            <>
              <label style={styles.label}>Área</label>
              <select style={{ ...styles.input, ...styles.filterInput }} title="Seleccionar área" value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="all">Todas</option>
                <option value="impresion">IMPRESIÓN</option>
                <option value="diseno">DISEÑO</option>
                <option value="sublimacion">SUBLIMACIÓN</option>
              </select>
            </>
          )}

          <button style={{ ...styles.secondaryBtn, ...styles.filterBtn }} onClick={() => void loadRows()}>Filtrar</button>
          <button style={{ ...styles.primaryBtn, ...styles.filterBtn }} onClick={() => void handleGenerateCsv()} disabled={generating || !canGenerateExcel}>
            {generating ? 'Generando...' : 'Generar CSV'}
          </button>
        </div>
        {!canGenerateExcel && (
          <p style={styles.info}>
            {user.role === 'admin'
              ? 'El botón de Excel se habilita solo el 15 y 30 a las 8:00 AM.'
              : 'Solo el administrador puede generar el Excel quincenal (15 y 30 a las 8:00 AM).'}
          </p>
        )}
        {success && <p style={styles.success}>{success}</p>}
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
                  <td style={styles.td}>{String(r.fecha ?? r.fecha_registro ?? '-')}</td>
                  <td style={styles.td}>{areaNameById[String(r.area_id ?? '')] ?? String(r.area_id ?? '-')}</td>
                  <td style={styles.td}>{String(r.nombre_pedido ?? '-')}</td>
                  <td style={styles.td}>{String(r.cantidad_danada ?? '-')}</td>
                  <td style={styles.td}>{String(r.motivo_dano ?? '-')}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td style={styles.td} colSpan={5}>Sin registros para el filtro actual.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {selectedRow && (
        <div style={styles.modalBackdrop} onClick={() => setSelectedRow(null)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>Detalle del registro</h3>
                <p style={styles.modalSubtitle}>Revisa la información general y la referencia de Trello asociada.</p>
              </div>
              <button style={styles.modalCloseBtn} onClick={() => setSelectedRow(null)}>Cerrar</button>
            </div>

            {(() => {
              const matchedCardId = trelloMatchedCard ? getRowString(trelloMatchedCard, 'id') : null;
              const matchedCardName = trelloMatchedCard ? getRowString(trelloMatchedCard, 'name') : null;
              const matchedCardUrl = trelloMatchedCard ? getRowString(trelloMatchedCard, 'url') : null;
              const matchedListId = trelloMatchedCard ? getRowString(trelloMatchedCard, 'idList') : null;
              const matchedListName = trelloMatchedCard ? getRowString(trelloMatchedCard, 'listName') : null;
              const matchedBoard = trelloMatchedCard
                ? getFirstNonEmpty(getRowString(trelloMatchedCard, 'boardName'), getRowString(trelloMatchedCard, 'idBoard'))
                : null;

              const trelloCardId = getFirstNonEmpty(getRowString(selectedRow, 'trello_card_id'), matchedCardId);
              const trelloCardName = getFirstNonEmpty(getRowString(selectedRow, 'trello_card_name'), matchedCardName);
              const trelloListId = getFirstNonEmpty(getRowString(selectedRow, 'trello_list_id'), matchedListId);
              const trelloListName = getFirstNonEmpty(getRowString(selectedRow, 'trello_list_name'), matchedListName);
              const trelloBoard = getFirstNonEmpty(
                getRowString(selectedRow, 'trello_board_name'),
                getRowString(selectedRow, 'trello_board_id'),
                matchedBoard,
              );
              const trelloDescription = getFirstNonEmpty(
                getRowString(selectedRow, 'trello_card_desc'),
                getRowString(selectedRow, 'trello_description'),
                trelloMatchedCard ? getRowString(trelloMatchedCard, 'desc') : null,
              );
              const trelloUrl = getFirstNonEmpty(
                resolveTrelloUrl(selectedRow),
                matchedCardUrl,
                trelloCardId ? `https://trello.com/c/${trelloCardId}` : null,
              );
              const hasTrelloData = Boolean(trelloCardId || trelloCardName || trelloListId || trelloListName || trelloBoard || trelloUrl);
              return (
                <>
                  <div style={styles.modalSectionLabel}>Tarjeta de Trello</div>
                  <div style={styles.trelloInfoBox}>
                    <div style={styles.trelloInfoHeader}>
                      <div style={styles.trelloInfoTitle}>Información anexada automáticamente</div>
                      <span
                        style={{
                          ...styles.trelloStatus,
                          ...(hasTrelloData ? styles.trelloStatusConnected : styles.trelloStatusEmpty),
                        }}
                      >
                        {hasTrelloData ? 'Conectada' : 'Sin tarjeta'}
                      </span>
                    </div>

                    {trelloAutoSaved && !trelloLookupLoading && (
                      <div style={styles.trelloLookupHint}>
                        La tarjeta vinculada ya se sincronizó automáticamente y quedó guardada en este registro.
                      </div>
                    )}

                    <div style={styles.trelloInfoGrid}>
                      <div style={styles.trelloInfoItem}>
                        <div style={styles.trelloInfoKey}>Tarjeta</div>
                        <div style={styles.trelloInfoValue}>{trelloCardName ?? '-'}</div>
                      </div>
                      <div style={styles.trelloInfoItem}>
                        <div style={styles.trelloInfoKey}>Lista</div>
                        <div style={styles.trelloInfoValue}>{trelloListName ?? '-'}</div>
                      </div>
                      <div style={styles.trelloInfoItem}>
                        <div style={styles.trelloInfoKey}>Tablero</div>
                        <div style={styles.trelloInfoValue}>{trelloBoard ?? '-'}</div>
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
                            'No disponible'
                          )}
                        </div>
                      </div>
                      <div style={styles.trelloInfoItemWide}>
                        <div style={styles.trelloInfoKey}>Descripción</div>
                        <div style={styles.trelloInfoDescription}>
                          {trelloDescription ?? 'Sin descripción en Trello.'}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}

            <div style={styles.modalSectionLabel}>Datos del registro</div>
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
                  <div style={styles.modalValue}>{formatDetailValue(key, value)}</div>
                </div>
                ))}
            </div>
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
              </tr>
            </thead>
            <tbody>
              {closureRows.map((r, idx) => (
                <tr key={`${String(r.id ?? idx)}-closure-${idx}`}>
                  <td style={styles.td}>{String(r.created_at ?? '-')}</td>
                  <td style={styles.td}>{formatAreaLabel(String(r.area ?? '-'))}</td>
                  <td style={styles.td}>{String(r.fecha_inicio ?? '-')}</td>
                  <td style={styles.td}>{String(r.fecha_fin ?? '-')}</td>
                  <td style={styles.td}>{String(r.generado_por ?? '-')}</td>
                </tr>
              ))}
              {closureRows.length === 0 && (
                <tr>
                  <td style={styles.td} colSpan={5}>Sin cierres guardados para el filtro actual.</td>
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
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'linear-gradient(135deg, #14532d 0%, #15803d 100%)',
    color: '#fff', borderRadius: 14, padding: 18, marginBottom: 14,
  },
  heroTitle: { fontSize: 22, marginBottom: 4 },
  heroText: { color: 'rgba(255,255,255,.86)', fontSize: 13 },
  heroBadge: { background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.24)', borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700 },
  card: { background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 4px 18px rgba(15,23,42,.08)' },
  h3: { marginBottom: 12, color: '#111827' },
  filters: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  label: { fontSize: 13, color: '#4b5563', fontWeight: 600 },
  input: { padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: '#fff' },
  filterInput: { minWidth: 180 },
  primaryBtn: { padding: '10px 14px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontWeight: 600, cursor: 'pointer' },
  filterBtn: { whiteSpace: 'nowrap' },
  info: { marginTop: 10, color: '#1e3a8a', background: '#dbeafe', padding: '8px 10px', borderRadius: 8 },
  success: { marginTop: 10, color: '#166534', background: '#dcfce7', padding: '8px 10px', borderRadius: 8 },
  error: { marginTop: 10, color: '#b91c1c', background: '#fee2e2', padding: '8px 10px', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse' },
  clickableRow: { cursor: 'pointer' },
  th: { textAlign: 'left', fontSize: 12, color: '#6b7280', borderBottom: '1px solid #e5e7eb', padding: '8px 6px' },
  td: { fontSize: 13, color: '#1f2937', borderBottom: '1px solid #f3f4f6', padding: '8px 6px' },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: 16,
  },
  modalCard: {
    width: 'min(920px, 96vw)',
    maxHeight: '86vh',
    overflow: 'auto',
    background: '#fff',
    borderRadius: 16,
    padding: 16,
    border: '1px solid #e2e8f0',
    boxShadow: '0 20px 48px rgba(2, 6, 23, 0.24)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  modalTitle: { margin: 0, color: '#0f172a', fontSize: 18 },
  modalSubtitle: { margin: '6px 0 0 0', fontSize: 13, color: '#64748b' },
  modalCloseBtn: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#334155',
    fontWeight: 600,
    cursor: 'pointer',
  },
  modalSectionLabel: {
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    fontWeight: 800,
    color: '#475569',
    marginBottom: 8,
    marginTop: 4,
  },
  modalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
  },
  trelloInfoBox: {
    border: '1px solid #93c5fd',
    background: 'linear-gradient(180deg, #eff6ff 0%, #f8fbff 100%)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  trelloInfoHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  trelloLookupHint: {
    fontSize: 12,
    color: '#1e3a8a',
    background: '#dbeafe',
    border: '1px solid #93c5fd',
    borderRadius: 8,
    padding: '6px 8px',
    marginBottom: 8,
  },
  trelloInfoTitle: { fontSize: 14, fontWeight: 800, color: '#1e40af' },
  trelloStatus: {
    fontSize: 11,
    fontWeight: 800,
    borderRadius: 999,
    padding: '4px 10px',
    border: '1px solid transparent',
  },
  trelloStatusConnected: {
    color: '#166534',
    background: '#dcfce7',
    borderColor: '#86efac',
  },
  trelloStatusEmpty: {
    color: '#92400e',
    background: '#fef3c7',
    borderColor: '#fcd34d',
  },
  trelloInfoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 8,
  },
  trelloInfoItem: {
    border: '1px solid #bfdbfe',
    borderRadius: 10,
    padding: '8px 10px',
    background: '#ffffffcc',
  },
  trelloInfoItemWide: {
    border: '1px solid #bfdbfe',
    borderRadius: 10,
    padding: '8px 10px',
    background: '#ffffffcc',
    gridColumn: '1 / -1',
  },
  trelloInfoKey: { fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 },
  trelloInfoValue: { fontSize: 13, color: '#0f172a', wordBreak: 'break-word' },
  trelloInfoDescription: { fontSize: 13, color: '#0f172a', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  trelloInfoLinkBtn: {
    display: 'inline-block',
    padding: '6px 10px',
    borderRadius: 8,
    color: '#1e3a8a',
    border: '1px solid #93c5fd',
    textDecoration: 'none',
    background: '#eff6ff',
    fontWeight: 700,
  },
  modalItem: {
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: 10,
    background: '#f8fafc',
  },
  modalKey: { fontSize: 11, textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: 4 },
  modalValue: { fontSize: 13, color: '#0f172a', wordBreak: 'break-word' },
};
