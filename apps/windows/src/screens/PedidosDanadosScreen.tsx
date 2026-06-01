import React from 'react';
import { supabase } from '../core/supabase';
import type { AuthUser } from '../services/auth';

interface Props {
  user: AuthUser;
}

type AnyRow = Record<string, unknown>;
type AnyObject = Record<string, unknown>;

interface TrelloCardItem {
  id: string;
  name: string;
  url: string;
  idList: string;
  listName: string;
  listPos: number;
  pos: number;
  desc?: string;
  attachmentCount?: number;
}

function normalizeTrelloCard(item: AnyObject): TrelloCardItem {
  const descValue = typeof item.desc === 'string'
    ? item.desc
    : (typeof item.description === 'string' ? item.description : undefined);

  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    url: String(item.url ?? ''),
    idList: String(item.idList ?? ''),
    listName: String(item.listName ?? ''),
    listPos: Number(item.listPos ?? 0),
    pos: Number(item.pos ?? 0),
    desc: descValue,
    attachmentCount: typeof item.attachmentCount === 'number' ? item.attachmentCount : undefined,
  };
}

const DEFAULT_TRELLO_BOARD_ID = import.meta.env.VITE_TRELLO_BOARD_ID ?? '3cv4PjjJ';
const TRELLO_FAVORITES_KEY = 'esmark.trello.favoriteLists';
type ResponsableTipo = 'responsable' | 'area_responsable' | 'problemas_tecnicos' | 'otros';

function normalizeBoardId(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) return '';

  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const url = new URL(value);
      const match = url.pathname.match(/\/b\/([^/]+)/i);
      if (match?.[1]) return match[1];
    } catch {
      return value;
    }
  }

  return value;
}

function toUserError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('could not find the table') && lower.includes('pedidos_danados')) {
    return 'La tabla pedidos_danados no existe en tu base de datos. Ejecuta la migración 20240101000004_full_control_errores_schema.sql y vuelve a intentar.';
  }
  return message;
}

function isMissingTrelloDescColumn(message?: string): boolean {
  return String(message ?? '').toLowerCase().includes('trello_card_desc');
}

function extractTrelloShortCode(value: string): string | null {
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

  const plain = input.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (plain.length >= 8 && plain.length <= 12) return plain;
  return null;
}

function findCardByReference(reference: string, cards: TrelloCardItem[]): TrelloCardItem | null {
  const text = reference.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const shortCode = extractTrelloShortCode(text);

  const exactById = cards.find((card) => String(card.id).toLowerCase() === lower);
  if (exactById) return exactById;

  if (shortCode) {
    const byShort = cards.find((card) => extractTrelloShortCode(card.url) === shortCode);
    if (byShort) return byShort;
  }

  return null;
}

function normalizeAreaCode(area?: string): string | null {
  if (!area) return null;
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

export function PedidosDanadosScreen({ user }: Props): React.JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<AnyRow[]>([]);

  const [nombrePedido, setNombrePedido] = React.useState('');
  const [cantidadDanada, setCantidadDanada] = React.useState('1');
  const [tipoTrabajo, setTipoTrabajo] = React.useState('');
  const [tipoDano, setTipoDano] = React.useState('');
  const [responsableTipo, setResponsableTipo] = React.useState<ResponsableTipo>('responsable');
  const [personaDano, setPersonaDano] = React.useState('');
  const [motivoDano, setMotivoDano] = React.useState('');
  const [observacion, setObservacion] = React.useState('');

  const [boardId, setBoardId] = React.useState(DEFAULT_TRELLO_BOARD_ID);
  const [trelloLoading, setTrelloLoading] = React.useState(false);
  const [trelloCards, setTrelloCards] = React.useState<TrelloCardItem[]>([]);
  const [selectedCardId, setSelectedCardId] = React.useState('');
  const [trelloSearch, setTrelloSearch] = React.useState('');
  const [cardReference, setCardReference] = React.useState('');
  const [selectedListFilter, setSelectedListFilter] = React.useState('all');
  const [expandedListName, setExpandedListName] = React.useState<string | null>(null);
  const [favoriteListNames, setFavoriteListNames] = React.useState<string[]>([]);
  const [loadingFavorites, setLoadingFavorites] = React.useState(true);

  const selectedCard = React.useMemo(
    () => trelloCards.find((c) => c.id === selectedCardId) ?? null,
    [trelloCards, selectedCardId],
  );

  const selectedCardUrl = selectedCard?.url ?? '';

  // Cargar favoritos desde Supabase al montar o cuando cambia boardId
  React.useEffect(() => {
    async function loadFavoritesFromSupabase(): Promise<void> {
      setLoadingFavorites(true);
      try {
        const { data, error: err } = await supabase
          .from('user_favorite_trello_lists')
          .select('list_name')
          .eq('board_id', boardId);

        if (err) {
          console.error('Error loading favorites:', err);
          // Fallback a localStorage
          const stored = window.localStorage.getItem(TRELLO_FAVORITES_KEY);
          const parsed = stored ? (JSON.parse(stored) as unknown) : [];
          const fallback = Array.isArray(parsed)
            ? parsed.filter((value): value is string => typeof value === 'string')
            : [];
          setFavoriteListNames(fallback);
        } else {
          const favorites = (data ?? []).map((row) => row.list_name);
          setFavoriteListNames(favorites);
        }
      } catch (e) {
        console.error('Exception loading favorites:', e);
        // Fallback a localStorage
        const stored = window.localStorage.getItem(TRELLO_FAVORITES_KEY);
        const parsed = stored ? (JSON.parse(stored) as unknown) : [];
        const fallback = Array.isArray(parsed)
          ? parsed.filter((value): value is string => typeof value === 'string')
          : [];
        setFavoriteListNames(fallback);
      } finally {
        setLoadingFavorites(false);
      }
    }

    loadFavoritesFromSupabase();
  }, [boardId]);

  // Sincronizar favoritos a localStorage como respaldo
  React.useEffect(() => {
    window.localStorage.setItem(TRELLO_FAVORITES_KEY, JSON.stringify(favoriteListNames));
  }, [favoriteListNames]);

  function toggleFavoriteList(listName: string): void {
    setFavoriteListNames((current) => {
      const isCurrentlyFavorited = current.includes(listName);
      let updated: string[];

      if (isCurrentlyFavorited) {
        updated = current.filter((value) => value !== listName);
        // Eliminar favorito en background
        void (async () => {
          const { error } = await supabase
            .from('user_favorite_trello_lists')
            .delete()
            .eq('list_name', listName)
            .eq('board_id', boardId);
          if (error) {
            console.error('Error removing favorite from Supabase:', error);
          } else {
            console.log('Favorite removed from Supabase');
          }
        })();
      } else {
        updated = [listName, ...current].slice(0, 30);
        // Agregar favorito en background
        void (async () => {
          const { error } = await supabase
            .from('user_favorite_trello_lists')
            .insert({ list_name: listName, board_id: boardId, user_id: user.id });
          if (error) {
            console.error('Error adding favorite to Supabase:', error);
          } else {
            console.log('Favorite added to Supabase');
          }
        })();
      }

      return updated;
    });
  }

  const cardsByList = React.useMemo(() => {
    const grouped = new Map<string, TrelloCardItem[]>();

    for (const card of trelloCards) {
      const groupKey = card.listName || 'Sin ubicación';
      const items = grouped.get(groupKey) ?? [];
      items.push(card);
      grouped.set(groupKey, items);
    }

    return Array.from(grouped.entries()).sort((a, b) => {
      const firstA = a[1][0];
      const firstB = b[1][0];
      if ((firstA?.listPos ?? 0) === (firstB?.listPos ?? 0)) {
        return a[0].localeCompare(b[0]);
      }
      return (firstA?.listPos ?? 0) - (firstB?.listPos ?? 0);
    });
  }, [trelloCards]);

  const favoriteLists = React.useMemo(
    () => favoriteListNames.filter((listName) => cardsByList.some(([currentListName]) => currentListName === listName)),
    [cardsByList, favoriteListNames],
  );

  const filteredCardsByList = React.useMemo(() => {
    const search = trelloSearch.trim().toLowerCase();
    const listFilter = selectedListFilter;

    let grouped = cardsByList;

    if (listFilter !== 'all') {
      grouped = grouped.filter(([listName]) => listName === listFilter);
    }

    if (!search) return grouped;

    return grouped
      .map(([listName, cards]) => {
        const filtered = cards.filter((card) => {
          const haystack = `${card.name} ${card.id} ${card.url} ${listName} ${card.desc ?? ''}`.toLowerCase();
          return haystack.includes(search);
        });
        return [listName, filtered] as [string, TrelloCardItem[]];
      })
      .filter(([, cards]) => cards.length > 0);
  }, [cardsByList, selectedListFilter, trelloSearch]);

  const trelloStats = React.useMemo(() => {
    return {
      cards: trelloCards.length,
      lists: cardsByList.length,
      filteredCards: filteredCardsByList.reduce((total, [, cards]) => total + cards.length, 0),
    };
  }, [cardsByList.length, filteredCardsByList, trelloCards.length]);

  async function loadRows(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      // Try direct query without RLS by using low-level select
      const { data, error: qErr } = await supabase
        .from('pedidos_danados')
        .select('id')
        .order('fecha_registro', { ascending: false })
        .limit(100);

      if (qErr) {
        setError('No se pudieron cargar los registros. Intenta de nuevo.');
        setRows([]);
      } else {
        setRows((data ?? []) as AnyRow[]);
      }
    } catch (e) {
      setError('Error al cargar registros');
    }
    setLoading(false);
  }

  React.useEffect(() => {
    void loadRows();
  }, []);

  React.useEffect(() => {
    if (boardId.trim()) {
      void loadTrelloCards();
    }
  }, [boardId]);

  async function loadTrelloCards(): Promise<void> {
    const normalizedBoardId = normalizeBoardId(boardId);

    if (!normalizedBoardId) {
      setError('Ingresa el Board ID de Trello para cargar tarjetas.');
      return;
    }
    setError(null);
    setTrelloLoading(true);

    const { data, error: fnErr } = await supabase.functions.invoke('trello_cards_by_my_area', {
      body: { boardId: normalizedBoardId },
    });
    setTrelloLoading(false);

    if (fnErr) {
      console.error('[TRELLO_CLIENT] Function error:', fnErr);
      console.error('[TRELLO_CLIENT] Response data:', data);
      const errorMsg = data?.error 
        ? `${data.error}${data.msg ? ` - ${data.msg}` : ''}${data.status ? ` (status: ${data.status})` : ''}`
        : fnErr.message;
      setError(`Error al consultar Trello: ${errorMsg}`);
      setTrelloCards([]);
      setSelectedCardId('');
      return;
    }

    const rawCards = ((data as { cards?: AnyObject[] } | null)?.cards ?? []) as AnyObject[];
    const cards = rawCards.map(normalizeTrelloCard).filter((card) => card.id && card.name);
    const previousSelected = selectedCardId;
    const stillExists = previousSelected && cards.some((card) => card.id === previousSelected);
    setTrelloCards(cards);
    setSelectedCardId(stillExists ? previousSelected : '');
    setExpandedListName(null);
    setSelectedListFilter('all');

    if (cards.length === 0) {
      setError('Trello respondió sin tarjetas para este tablero. Verifica que el tablero tenga tarjetas visibles y que la función tenga credenciales válidas.');
    }
  }

  function handleFindCardByReference(): void {
    const matched = findCardByReference(cardReference, trelloCards);
    if (!matched) {
      setError('No se encontró una tarjeta con esa referencia. Usa la URL completa o el ID exacto de la tarjeta de Trello.');
      return;
    }

    setError(null);
    setSelectedCardId(matched.id);
    setSelectedListFilter(matched.listName || 'all');
    setExpandedListName(matched.listName || null);
    setTrelloSearch(matched.id);
    if (!nombrePedido.trim()) {
      setNombrePedido(matched.name);
    }
  }

  async function resolveAreaIdForInsert(): Promise<string | null> {
    if (user.role !== 'admin') {
      const code = normalizeAreaCode(user.area);
      if (code) {
        const byUserArea = await supabase.from('areas').select('id').eq('code', code).maybeSingle();
        if (byUserArea.data?.id) return byUserArea.data.id as string;
      }
    } else {
      const adminArea = await supabase.from('areas').select('id').eq('code', 'administracion').maybeSingle();
      if (adminArea.data?.id) return adminArea.data.id as string;
    }

    const fallback = await supabase.from('areas').select('id').limit(1).maybeSingle();
    return (fallback.data?.id as string | undefined) ?? null;
  }

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const qty = Number(cantidadDanada);
    const responsableValue =
      responsableTipo === 'responsable'
        ? `Responsable: ${personaDano.trim()}`
        : responsableTipo === 'area_responsable'
          ? `Área responsable: ${personaDano.trim()}`
          : responsableTipo === 'problemas_tecnicos'
            ? 'Problemas técnicos'
            : 'Otros';

    if (!nombrePedido.trim() || !motivoDano.trim()) {
      setError('Completa los campos obligatorios: nombre del pedido y motivo.');
      return;
    }
    if (
      (responsableTipo === 'responsable' || responsableTipo === 'area_responsable') &&
      !personaDano.trim()
    ) {
      setError(
        responsableTipo === 'responsable'
          ? 'Ingresa el nombre del responsable.'
          : 'Ingresa el área responsable.',
      );
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Ingresa una cantidad dañada válida.');
      return;
    }

    setSaving(true);
    const areaId = await resolveAreaIdForInsert();
    if (!areaId) {
      setError('No hay áreas configuradas en la base de datos. Crea al menos una fila en la tabla areas.');
      setSaving(false);
      return;
    }

    // Absolute minimal payload - only required fields
    const payloadNew = {
      nombre_pedido: nombrePedido.trim(),
      cantidad_danada: qty,
      motivo_dano: motivoDano.trim(),
      tipo_trabajo: tipoTrabajo.trim() || undefined,
      tipo_dano: tipoDano.trim() || undefined,
      persona_dano: responsableValue,
      observacion: observacion.trim() || undefined,
      area_id: areaId,
      trello_card_id: selectedCard?.id || undefined,
      trello_card_name: selectedCard?.name || undefined,
      trello_card_desc: selectedCard?.desc || undefined,
      trello_card_url: selectedCard?.url || undefined,
      trello_list_id: selectedCard?.idList || undefined,
      trello_list_name: selectedCard?.listName || undefined,
      trello_board_id: boardId || undefined,
      trello_card_pos: selectedCard?.pos ?? undefined,
    };

    let savedWithoutTrelloDescription = false;
    let firstTry = await supabase.from('pedidos_danados').insert(payloadNew).select().maybeSingle();

    if (isMissingTrelloDescColumn(firstTry.error?.message)) {
      const { trello_card_desc: _discard, ...payloadWithoutDesc } = payloadNew;
      firstTry = await supabase.from('pedidos_danados').insert(payloadWithoutDesc).select().maybeSingle();
      savedWithoutTrelloDescription = !firstTry.error;
    }

    if (firstTry.error) {
      // Fallback with additional fields
      const payloadExtended = {
        area_id: areaId,
        nombre_pedido: nombrePedido.trim(),
        cantidad_danada: qty,
        motivo_dano: motivoDano.trim(),
        tipo_trabajo: tipoTrabajo.trim() || undefined,
        tipo_dano: tipoDano.trim() || undefined,
        persona_dano: responsableValue,
        observacion: observacion.trim() || undefined,
        trello_card_id: selectedCard?.id || undefined,
        trello_card_name: selectedCard?.name || undefined,
        trello_card_desc: selectedCard?.desc || undefined,
        trello_card_url: selectedCard?.url || undefined,
        trello_list_id: selectedCard?.idList || undefined,
        trello_list_name: selectedCard?.listName || undefined,
        trello_board_id: boardId || undefined,
        trello_card_pos: selectedCard?.pos ?? undefined,
      };
      let secondTry = await supabase.from('pedidos_danados').insert(payloadExtended);

      if (isMissingTrelloDescColumn(secondTry.error?.message)) {
        const { trello_card_desc: _discard, ...payloadExtendedWithoutDesc } = payloadExtended;
        secondTry = await supabase.from('pedidos_danados').insert(payloadExtendedWithoutDesc);
        savedWithoutTrelloDescription = !secondTry.error;
      }
      
      if (secondTry.error) {
        setError(toUserError(secondTry.error.message));
        setSaving(false);
        return;
      }
    }

    setNombrePedido('');
    setCantidadDanada('1');
    setTipoTrabajo('');
    setTipoDano('');
    setResponsableTipo('responsable');
    setPersonaDano('');
    setMotivoDano('');
    setObservacion('');
    setSelectedCardId('');
    setSaving(false);
    
    setSuccess(
      savedWithoutTrelloDescription
        ? 'Registro guardado. La descripción de Trello no se guardó porque falta la columna trello_card_desc en Supabase.'
        : 'Registro guardado correctamente',
    );
    setTimeout(() => setSuccess(null), 3000);
  }

  return (
    <div>
      <div style={styles.hero}>
        <div>
          <h2 style={styles.heroTitle}>Registro Diario de Pedidos Dañados</h2>
          <p style={styles.heroText}>Acceso directo desde inicio. Registra, valida y consulta en un solo flujo.</p>
        </div>
        <div style={styles.heroBadge}>{rows.length} registros visibles</div>
      </div>

      <div style={styles.card}>
        <h3 style={styles.h3}>Registrar Pedido Dañado</h3>

        <div style={styles.trelloBox}>
          <div style={styles.trelloHeaderRow}>
            <div>
              <div style={styles.trelloHeader}>Trello (solo lectura)</div>
              <h4 style={styles.trelloHeaderTitle}>Explorador de tarjetas por ubicación</h4>
            </div>
            <button type="button" style={styles.secondaryBtn} onClick={() => void loadTrelloCards()} disabled={trelloLoading}>
              {trelloLoading ? 'Consultando...' : 'Actualizar tarjetas'}
            </button>
          </div>

          <div style={styles.trelloStatsRow}>
            <div style={styles.trelloStatCard}><strong>{trelloStats.cards}</strong><span>Tarjetas</span></div>
            <div style={styles.trelloStatCard}><strong>{trelloStats.lists}</strong><span>Listas</span></div>
            <div style={styles.trelloStatCard}><strong>{trelloStats.filteredCards}</strong><span>Resultados</span></div>
          </div>

          <div style={styles.trelloToolbar}>
            <input
              style={{ ...styles.input, ...styles.trelloSearch }}
              placeholder="Buscar por nombre, ID, lista o URL"
              value={trelloSearch}
              onChange={(e) => setTrelloSearch(e.target.value)}
            />
            {favoriteLists.length > 0 && (
              <select
                style={{ ...styles.input, ...styles.trelloBoardInput }}
                value=""
                onChange={(e) => {
                  const listName = e.target.value;
                  if (listName) {
                    setSelectedListFilter(listName);
                    setExpandedListName(listName);
                    setTrelloSearch('');
                    e.target.value = '';
                  }
                }}
              >
                <option value="">Favoritas ({favoriteLists.length})</option>
                {favoriteLists.map((listName) => (
                  <option key={listName} value={listName}>
                    ★ {listName}
                  </option>
                ))}
              </select>
            )}
            <select
              style={{ ...styles.input, ...styles.trelloBoardInput }}
              value={selectedListFilter}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedListFilter(next);
                setExpandedListName(next === 'all' ? null : next);
              }}
            >
              <option value="all">Todas las clasificaciones</option>
              {cardsByList.map(([listName]) => (
                <option key={listName} value={listName}>
                  {listName}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.trelloToolbarSecondary}>
            <input
              style={{ ...styles.input, ...styles.trelloBoardInput }}
              placeholder="Board ID o URL de Trello"
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
            />
            <button type="button" style={styles.ghostBtn} onClick={() => { setTrelloSearch(''); setSelectedListFilter('all'); setExpandedListName(null); }}>
              Limpiar filtros
            </button>
          </div>

          <div style={styles.trelloToolbarSecondary}>
            <input
              style={{ ...styles.input, ...styles.trelloBoardInput }}
              placeholder="Pega URL o ID exacto de la tarjeta de Trello"
              value={cardReference}
              onChange={(e) => setCardReference(e.target.value)}
            />
            <button type="button" style={styles.secondaryBtn} onClick={handleFindCardByReference}>
              Encontrar vinculada
            </button>
          </div>

          {favoriteLists.length > 0 && (
            <div style={styles.favoritesShell}>
              <div style={styles.favoritesHeaderRow}>
                <div>
                  <div style={styles.trelloHeader}>Favoritos</div>
                  <h4 style={styles.trelloHeaderTitle}>Acceso rápido a clasificaciones marcadas</h4>
                </div>
                <span style={styles.favoritesCount}>{favoriteLists.length} guardadas</span>
              </div>

              <div style={styles.favoriteChips}>
                {favoriteLists.map((listName) => {
                  const active = selectedListFilter === listName;
                  const listCount = cardsByList.find(([currentListName]) => currentListName === listName)?.[1].length ?? 0;
                  return (
                    <button
                      key={listName}
                      type="button"
                      style={{ ...styles.favoriteChip, ...(active ? styles.favoriteChipActive : {}) }}
                      onClick={() => {
                        setSelectedListFilter(listName);
                        setExpandedListName(listName);
                        setTrelloSearch('');
                      }}
                    >
                      <span style={styles.favoriteChipName}>{listName}</span>
                      <span style={styles.favoriteChipMeta}>{listCount} tarjetas</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={styles.trelloExplorer}>
            {selectedListFilter !== 'all' ? (
              // Mostrar solo la categoría seleccionada
              filteredCardsByList.length > 0 ? (
                <>
                  {filteredCardsByList.map(([listName]) => (
                    <div key={`header-${listName}`} style={styles.trelloListHeader}>
                      <h4 style={styles.trelloListTitle}>{listName}</h4>
                      <button
                        type="button"
                        style={{ ...styles.favoriteStarBtn, ...(favoriteListNames.includes(listName) ? styles.favoriteStarBtnActive : {}) }}
                        onClick={() => toggleFavoriteList(listName)}
                        aria-label={favoriteListNames.includes(listName) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                        title={favoriteListNames.includes(listName) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                      >
                        {favoriteListNames.includes(listName) ? '★' : '☆'}
                      </button>
                    </div>
                  ))}
                  {filteredCardsByList.map(([listName, cards]) => (
                    <section key={listName} style={styles.trelloGroup}>
                      <div style={styles.trelloCardGrid}>
                        {cards.map((card) => {
                          const active = card.id === selectedCardId;
                          return (
                            <button
                              key={card.id}
                              type="button"
                              style={{ ...styles.trelloCardPill, ...(active ? styles.trelloCardPillActive : {}) }}
                              onClick={() => {
                                setSelectedCardId(card.id);
                                setCardReference(card.id);
                                setNombrePedido(card.name);
                              }}
                            >
                              <div style={styles.trelloCardPillTopRow}>
                                <span style={styles.trelloCardPillName}>{card.name}</span>
                              </div>
                              <span style={styles.trelloCardPillMeta}>#{card.pos} · {card.id.slice(-6)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </>
              ) : (
                <div style={styles.trelloEmptyState}>
                  <strong>No hay tarjetas en esta clasificación</strong>
                  <span>Selecciona otra categoría o actualiza las tarjetas.</span>
                </div>
              )
            ) : (
              // Si no hay categoría seleccionada, mostrar mensaje
              <div style={styles.trelloEmptyState}>
                <strong>Selecciona una clasificación</strong>
                <span>Usa el dropdown de arriba o marca una como favorita para empezar.</span>
              </div>
            )}
          </div>

          {selectedCard && (
            <div style={styles.trelloMeta}>
              <div style={styles.trelloDetailCard}>
                <div style={styles.trelloDetailHeader}>
                  <strong style={styles.trelloDetailTitle}>{selectedCard.name}</strong>
                  <button
                    type="button"
                    style={styles.trelloLinkBtn}
                    onClick={() => {
                      if (selectedCardUrl) {
                        window.open(selectedCardUrl, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    disabled={!selectedCardUrl}
                  >
                    Ver tarjeta
                  </button>
                  <button
                    type="button"
                    style={styles.historyLinkBtn}
                    onClick={() => {
                      setSelectedListFilter(selectedCard.listName || 'all');
                      setExpandedListName(selectedCard.listName || null);
                      setTrelloSearch(selectedCard.id);
                      setCardReference(selectedCard.id);
                    }}
                  >
                    Ubicar en listado
                  </button>
                </div>

                <div style={styles.trelloDetailGrid}>
                  <div style={styles.trelloDetailItem}>
                    <span style={styles.trelloDetailLabel}>ID</span>
                    <span style={styles.trelloDetailValue}>{selectedCard.id}</span>
                  </div>
                  <div style={styles.trelloDetailItem}>
                    <span style={styles.trelloDetailLabel}>Lista</span>
                    <span style={styles.trelloDetailValue}>{selectedCard.listName}</span>
                  </div>
                  <div style={styles.trelloDetailItem}>
                    <span style={styles.trelloDetailLabel}>Posición</span>
                    <span style={styles.trelloDetailValue}>{selectedCard.pos}</span>
                  </div>
                  <div style={styles.trelloDetailItem}>
                    <span style={styles.trelloDetailLabel}>URL</span>
                    <span style={styles.trelloDetailValue}>{selectedCard.url}</span>
                  </div>
                  <div style={{ ...styles.trelloDetailItem, gridColumn: '1 / -1' }}>
                    <span style={styles.trelloDetailLabel}>Descripción</span>
                    <span style={styles.trelloDetailDescription}>
                      {selectedCard.desc?.trim() ? selectedCard.desc : 'Sin descripción en Trello.'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={(e) => void handleCreate(e)} style={styles.formShell}>
          <div style={styles.formSection}>
            <div style={styles.sectionHeader}>
              <span style={styles.sectionKicker}>1. Datos del pedido</span>
              <h4 style={styles.sectionTitle}>Información principal</h4>
            </div>

            <div style={styles.gridForm}>
              <input style={{ ...styles.input, ...styles.span2 }} placeholder="Nombre del pedido *" value={nombrePedido} onChange={(e) => setNombrePedido(e.target.value)} />
              <input
                style={styles.input}
                type="number"
                min="1"
                step="1"
                placeholder="Cantidad dañada *"
                value={cantidadDanada}
                onChange={(e) => setCantidadDanada(e.target.value)}
              />
              <input style={styles.input} placeholder="Tipo de trabajo" value={tipoTrabajo} onChange={(e) => setTipoTrabajo(e.target.value)} />
              <input style={styles.input} placeholder="Tipo de daño" value={tipoDano} onChange={(e) => setTipoDano(e.target.value)} />
              <select
                style={{ ...styles.input, ...styles.selectInput }}
                value={responsableTipo}
                onChange={(e) => {
                  const next = e.target.value as ResponsableTipo;
                  setResponsableTipo(next);
                  if (next === 'problemas_tecnicos' || next === 'otros') {
                    setPersonaDano('');
                  }
                }}
              >
                <option value="responsable">Responsable</option>
                <option value="area_responsable">Área responsable</option>
                <option value="problemas_tecnicos">Problemas técnicos</option>
                <option value="otros">Otros</option>
              </select>
              {(responsableTipo === 'responsable' || responsableTipo === 'area_responsable') && (
                <input
                  style={styles.input}
                  placeholder={responsableTipo === 'responsable' ? 'Nombre del responsable *' : 'Área responsable *'}
                  value={personaDano}
                  onChange={(e) => setPersonaDano(e.target.value)}
                  required
                />
              )}
            </div>

            {selectedCard && (
              <div style={styles.linkedCardPanel}>
                <div style={styles.linkedCardPanelHeader}>
                  <h4 style={styles.linkedCardPanelTitle}>Tarjeta Trello adjunta</h4>
                  <button
                    type="button"
                    style={styles.ghostBtn}
                    onClick={() => {
                      setSelectedCardId('');
                      setNombrePedido('');
                    }}
                  >
                    Desvincular
                  </button>
                </div>

                <div style={styles.linkedCardGrid}>
                  <div style={styles.linkedCardField}>
                    <span style={styles.linkedCardFieldLabel}>Nombre</span>
                    <span style={styles.linkedCardFieldValue}>{selectedCard.name}</span>
                  </div>
                  <div style={styles.linkedCardField}>
                    <span style={styles.linkedCardFieldLabel}>Clasificación</span>
                    <span style={styles.linkedCardFieldValue}>{selectedCard.listName}</span>
                  </div>
                  <div style={styles.linkedCardField}>
                    <span style={styles.linkedCardFieldLabel}>Posición</span>
                    <span style={styles.linkedCardFieldValue}>#{selectedCard.pos}</span>
                  </div>
                  {selectedCard.attachmentCount !== undefined && (
                    <div style={styles.linkedCardField}>
                      <span style={styles.linkedCardFieldLabel}>Archivos</span>
                      <span style={styles.linkedCardFieldValue}>{selectedCard.attachmentCount} adjuntos</span>
                    </div>
                  )}
                  {selectedCard.desc && (
                    <div style={{ ...styles.linkedCardField, gridColumn: '1 / -1' }}>
                      <span style={styles.linkedCardFieldLabel}>Descripción</span>
                      <span style={styles.linkedCardFieldDescription}>{selectedCard.desc}</span>
                    </div>
                  )}
                  <div style={{ ...styles.linkedCardField, gridColumn: '1 / -1' }}>
                    <span style={styles.linkedCardFieldLabel}>URL</span>
                    <a
                      href={selectedCard.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={styles.linkedCardFieldLink}
                    >
                      Ver tarjeta en Trello →
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={styles.formSection}>
            <div style={styles.sectionHeader}>
              <span style={styles.sectionKicker}>2. Detalle del daño</span>
              <h4 style={styles.sectionTitle}>Registro y seguimiento</h4>
            </div>

            <div style={styles.detailGrid}>
              <input
                style={{ ...styles.input, ...styles.fullWidth }}
                placeholder="Motivo del daño *"
                value={motivoDano}
                onChange={(e) => setMotivoDano(e.target.value)}
              />
              <textarea
                style={{ ...styles.textarea, ...styles.fullWidth }}
                placeholder="Observaciones / lo que pasó / qué se dañó / datos útiles para seguimiento"
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
                rows={6}
              />
            </div>
          </div>

          <div style={styles.formActions}>
            <button type="submit" style={styles.primaryBtn} disabled={saving}>{saving ? 'Guardando...' : 'Guardar registro'}</button>
          </div>
        </form>
        {success && <p style={styles.success}>{success}</p>}
        {error && <p style={styles.error}>{error}</p>}
      </div>

    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  hero: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)',
    color: '#fff', borderRadius: 12, padding: 14, marginBottom: 12,
  },
  heroTitle: { fontSize: 19, marginBottom: 3 },
  heroText: { color: 'rgba(255,255,255,.85)', fontSize: 12 },
  heroBadge: { background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.24)', borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 700 },
  card: { background: '#fff', borderRadius: 12, padding: 12, marginBottom: 12, boxShadow: '0 4px 18px rgba(15,23,42,.08)' },
  h3: { marginBottom: 10, color: '#111827', fontSize: 18 },
  trelloBox: { border: '1px dashed #93c5fd', background: '#eff6ff', borderRadius: 10, padding: 9, marginBottom: 10 },
  trelloHeader: { fontSize: 11, fontWeight: 700, color: '#1d4ed8', marginBottom: 5, textTransform: 'uppercase' },
  trelloHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  trelloHeaderTitle: { fontSize: 15, color: '#0f172a', fontWeight: 800, marginTop: 1 },
  trelloStatsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 8 },
  trelloStatCard: {
    background: '#fff',
    border: '1px solid #dbeafe',
    borderRadius: 10,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    color: '#0f172a',
  },
  trelloToolbar: { display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 8, marginBottom: 8 },
  trelloToolbarSecondary: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 8 },
  trelloSearch: { minWidth: 0 },
  trelloBoardInput: { minWidth: 0 },
  favoritesShell: {
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
    border: '1px solid #c7d2fe',
    borderRadius: 10,
    padding: 9,
    marginBottom: 10,
  },
  favoritesHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  favoritesCount: { background: '#e0e7ff', color: '#312e81', borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 700 },
  favoriteChips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  favoriteChip: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    border: '1px solid #cbd5e1',
    background: '#fff',
    borderRadius: 9,
    padding: '8px 10px',
    cursor: 'pointer',
    minWidth: 170,
    textAlign: 'left',
  },
  favoriteChipActive: {
    borderColor: '#1d4ed8',
    boxShadow: '0 6px 18px rgba(29, 78, 216, 0.12)',
  },
  favoriteChipName: { fontSize: 13, fontWeight: 700, color: '#0f172a' },
  favoriteChipMeta: { fontSize: 11, color: '#64748b' },
  trelloExplorer: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 },
  trelloGroup: { background: '#fff', border: '1px solid #bfdbfe', borderRadius: 10, overflow: 'hidden' },
  trelloGroupHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    gap: 10,
    width: '100%',
    padding: 0,
    background: '#f8fbff',
  },
  trelloGroupExpandBtn: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    padding: '9px 11px',
    border: 'none',
    background: 'linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%)',
    cursor: 'pointer',
    textAlign: 'left',
    color: '#0f172a',
    fontWeight: 800,
  },
  trelloGroupHeaderActions: { display: 'flex', alignItems: 'center', gap: 8 },
  trelloGroupCount: { background: '#1d4ed8', color: '#fff', borderRadius: 999, padding: '3px 8px', fontSize: 11 },
  trelloCardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8, padding: 9 },
  trelloCardPill: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    textAlign: 'left',
    borderRadius: 9,
    border: '1px solid #dbeafe',
    background: '#fff',
    padding: '8px 10px',
    cursor: 'pointer',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, background-color 0.15s ease',
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
  },
  trelloCardPillActive: { borderColor: '#1d4ed8', backgroundColor: '#eff6ff', boxShadow: '0 0 0 3px rgba(29, 78, 216, 0.1), 0 6px 20px rgba(29, 78, 216, 0.15)', transform: 'translateY(-2px)' },
  trelloCardPillTopRow: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' },
  trelloCardPillName: { fontSize: 13, fontWeight: 700, color: '#0f172a' },
  trelloCardPillMeta: { fontSize: 11, color: '#64748b' },
  favoriteStarBtn: {
    border: 'none',
    background: 'transparent',
    color: '#94a3b8',
    fontSize: 18,
    lineHeight: 1,
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
  favoriteStarBtnActive: { color: '#f59e0b' },
  trelloEmptyState: {
    background: '#fff',
    border: '1px dashed #cbd5e1',
    color: '#475569',
    borderRadius: 10,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  trelloMeta: { marginTop: 8, display: 'flex', gap: 10, fontSize: 12, color: '#334155', flexDirection: 'column' },
  trelloDetailCard: {
    background: '#fff',
    border: '1px solid #bfdbfe',
    borderRadius: 10,
    padding: 10,
    boxShadow: '0 2px 10px rgba(37, 99, 235, 0.08)',
  },
  trelloDetailHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  trelloDetailTitle: { fontSize: 14, color: '#0f172a', lineHeight: 1.25 },
  trelloLinkBtn: {
    padding: '7px 10px',
    borderRadius: 8,
    border: '1px solid #1d4ed8',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  historyLinkBtn: {
    padding: '6px 9px',
    borderRadius: 8,
    border: '1px solid #93c5fd',
    background: '#ffffff',
    color: '#1d4ed8',
    fontWeight: 700,
    cursor: 'pointer',
  },
  trelloLinkBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  ghostBtn: {
    padding: '8px 11px',
    borderRadius: 9,
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#334155',
    fontWeight: 700,
    cursor: 'pointer',
  },
  trelloDetailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 8,
  },
  trelloDetailItem: {
    background: '#f8fbff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '7px 9px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  trelloDetailLabel: { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 },
  trelloDetailValue: { fontSize: 13, color: '#0f172a', wordBreak: 'break-word' },
  trelloDetailDescription: { fontSize: 13, color: '#0f172a', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  trelloListHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e0e7ff' },
  trelloListTitle: { fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 },
  linkedCardSummary: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10 },
  linkedCardLabel: { fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 0.5 },
  linkedCardContent: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  linkedCardName: { fontSize: 13, fontWeight: 700, color: '#15803d' },
  linkedCardMeta: { fontSize: 12, color: '#65a30d' },
  linkedCardPanel: { marginTop: 10, padding: 10, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10 },
  linkedCardPanelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #86efac' },
  linkedCardPanelTitle: { fontSize: 14, fontWeight: 700, color: '#166534', margin: 0 },
  linkedCardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 },
  linkedCardField: { display: 'flex', flexDirection: 'column', gap: 3, padding: 8, background: '#fff', borderRadius: 8, border: '1px solid #d1fae5' },
  linkedCardFieldLabel: { fontSize: 11, fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: 0.4 },
  linkedCardFieldValue: { fontSize: 13, color: '#065f46', fontWeight: 600, wordBreak: 'break-word' },
  linkedCardFieldDescription: { fontSize: 13, color: '#065f46', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontStyle: 'italic' },
  linkedCardFieldLink: { fontSize: 13, color: '#059669', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' },
  formShell: { display: 'flex', flexDirection: 'column', gap: 10 },
  formSection: {
    background: '#f8fafc',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 11,
  },
  sectionHeader: { display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 8 },
  sectionKicker: { fontSize: 11, fontWeight: 800, color: '#1d4ed8', letterSpacing: 0.5, textTransform: 'uppercase' },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#111827' },
  gridForm: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8,
    alignItems: 'center',
  },
  detailGrid: { display: 'grid', gridTemplateColumns: '1fr', gap: 8 },
  input: { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, background: '#fff' },
  selectInput: {
    paddingRight: 40,
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundImage:
      "linear-gradient(45deg, transparent 50%, #0f172a 50%), linear-gradient(135deg, #0f172a 50%, transparent 50%)",
    backgroundPosition: 'calc(100% - 22px) 50%, calc(100% - 16px) 50%',
    backgroundSize: '6px 6px, 6px 6px',
    backgroundRepeat: 'no-repeat',
  },
  textarea: {
    padding: '9px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 13,
    background: '#fff',
    resize: 'vertical',
    minHeight: 96,
    lineHeight: 1.45,
  },
  span2: { gridColumn: 'span 2' },
  fullWidth: { width: '100%' },
  formActions: { display: 'flex', justifyContent: 'flex-end', paddingTop: 4 },
  primaryBtn: { padding: '9px 12px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  secondaryBtn: { padding: '9px 12px', borderRadius: 8, border: '1px solid #93c5fd', background: '#fff', color: '#1e40af', fontWeight: 700, cursor: 'pointer' },
  success: { marginTop: 10, color: '#166534', background: '#dcfce7', padding: '8px 10px', borderRadius: 8 },
  error: { marginTop: 10, color: '#b91c1c', background: '#fee2e2', padding: '8px 10px', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 12, color: '#6b7280', borderBottom: '1px solid #e5e7eb', padding: '8px 6px' },
  td: { fontSize: 13, color: '#1f2937', borderBottom: '1px solid #f3f4f6', padding: '8px 6px' },
};
