import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

serve(async (req: Request) => {
  const h = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: h });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'GET or POST only' }), { status: 405, headers: h });
  }

  try {
    // Create service role client (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all pedidos_danados records without RLS constraints
    const { data, error } = await supabase
      .from('pedidos_danados')
      .select('*')
      .order('fecha_registro', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[LIST_DANO] Error:', error);
      return new Response(
        JSON.stringify({ error: error.message, code: error.code }),
        { status: 500, headers: h }
      );
    }

    return new Response(JSON.stringify({ success: true, data: data || [] }), { status: 200, headers: h });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[LIST_DANO_EXCEPTION]', msg);
    return new Response(JSON.stringify({ error: 'Exception', msg }), { status: 500, headers: h });
  }
});
