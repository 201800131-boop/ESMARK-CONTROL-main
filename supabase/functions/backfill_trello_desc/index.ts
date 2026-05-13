import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function normalizeBoardId(rawValue: string | null): string {
  const value = (rawValue ?? '').trim();
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

function extractTrelloShortCode(value: string | null): string | null {
  const input = (value ?? '').trim();
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const trelloKey   = Deno.env.get('TRELLO_API_KEY') ?? '';
    const trelloToken = Deno.env.get('TRELLO_TOKEN') ?? '';

    if (!supabaseUrl || !serviceKey || !trelloKey || !trelloToken) {
      return new Response(JSON.stringify({ error: 'Missing env vars' }), { status: 500, headers: HEADERS });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // 1) Obtener registros que tienen tarjeta vinculada pero sin descripción
    const { data: pendientes, error: fetchErr } = await supabase
      .from('pedidos_danados')
      .select('id, trello_card_id, trello_card_url, trello_board_id')
      .not('trello_card_id', 'is', null)
      .or('trello_card_desc.is.null,trello_card_desc.eq.');

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers: HEADERS });
    }

    const rows = (pendientes ?? []) as Array<{
      id: string;
      trello_card_id: string;
      trello_card_url: string | null;
      trello_board_id: string | null;
    }>;

    if (rows.length === 0) {
      return new Response(JSON.stringify({ message: 'No hay registros pendientes de descripción', updated: 0 }), { status: 200, headers: HEADERS });
    }

    // 2) Agrupar por board_id para hacer una sola llamada a Trello por tablero
    const DEFAULT_BOARD = '3cv4PjjJ';
    const boardGroups = new Map<string, typeof rows>();
    for (const row of rows) {
      const bid = normalizeBoardId(row.trello_board_id) || DEFAULT_BOARD;
      const group = boardGroups.get(bid) ?? [];
      group.push(row);
      boardGroups.set(bid, group);
    }

    let totalUpdated = 0;
    const errors: string[] = [];

    for (const [boardId, boardRows] of boardGroups) {
      // 3) Obtener todas las tarjetas del tablero de Trello
      const cardsUrl = `https://api.trello.com/1/boards/${boardId}/cards?key=${trelloKey}&token=${trelloToken}&fields=id,name,url,desc`;
      const cardsRes = await fetch(cardsUrl);

      if (!cardsRes.ok) {
        errors.push(`Trello board ${boardId}: HTTP ${cardsRes.status}`);
        continue;
      }

      const trelloCards = (await cardsRes.json()) as Array<{ id: string; name: string; url: string; desc?: string }>;
      const cardMap = new Map<string, { id: string; name: string; url: string; desc?: string }>();
      for (const card of trelloCards) {
        cardMap.set(card.id.trim().toLowerCase(), card);
        const shortCode = extractTrelloShortCode(card.url);
        if (shortCode) cardMap.set(shortCode, card);
      }

      // 4) Para cada registro, buscar la tarjeta y actualizar la descripción
      for (const row of boardRows) {
        const rowCardKey = row.trello_card_id.trim().toLowerCase();
        const rowShortCode = extractTrelloShortCode(row.trello_card_url) ?? extractTrelloShortCode(row.trello_card_id);
        const card = cardMap.get(rowCardKey) ?? (rowShortCode ? cardMap.get(rowShortCode) : undefined);
        if (!card) {
          errors.push(`Tarjeta ${row.trello_card_id} no encontrada en tablero ${boardId}`);
          continue;
        }

        const desc = card.desc?.trim() ?? '';
        if (!desc) continue; // sin descripción en Trello, no hay nada que guardar

        const { error: updateErr } = await supabase
          .from('pedidos_danados')
          .update({ trello_card_desc: desc })
          .eq('id', row.id);

        if (updateErr) {
          errors.push(`Error actualizando ${row.id}: ${updateErr.message}`);
        } else {
          totalUpdated++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        message: `Backfill completado`,
        total_pendientes: rows.length,
        updated: totalUpdated,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: HEADERS },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: 'Exception', msg }), { status: 500, headers: HEADERS });
  }
});
