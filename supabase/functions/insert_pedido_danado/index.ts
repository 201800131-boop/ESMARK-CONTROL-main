import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

interface DañoRecord {
  area_id: string;
  nombre_pedido: string;
  tipo_trabajo?: string | null;
  tipo_dano?: string | null;
  persona_dano?: string | null;
  cantidad_danada: number;
  motivo_dano: string;
  observacion?: string | null;
  trello_card_id?: string | null;
  trello_card_name?: string | null;
  trello_card_url?: string | null;
  trello_list_id?: string | null;
  trello_list_name?: string | null;
  trello_card_pos?: number | null;
  trello_board_id?: string | null;
}

serve(async (req: Request) => {
  const h = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: h });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: h });
  }

  try {
    const body = await req.json();
    const payload: DañoRecord = body;

    // Validate required fields
    if (!payload.nombre_pedido || !payload.motivo_dano || payload.cantidad_danada <= 0) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid required fields' }),
        { status: 400, headers: h }
      );
    }

    // Create service role client (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Insert directly without RLS constraints
    const { data, error } = await supabase
      .from('pedidos_danados')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('[INSERT_DANO] Error:', error);
      return new Response(
        JSON.stringify({ error: error.message, code: error.code }),
        { status: 500, headers: h }
      );
    }

    return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: h });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[INSERT_DANO_EXCEPTION]', msg);
    return new Response(JSON.stringify({ error: 'Exception', msg }), { status: 500, headers: h });
  }
});
