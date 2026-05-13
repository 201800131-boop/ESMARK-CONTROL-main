import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

interface PedidoDanado {
  id: string;
  area: string;
  descripcion: string;
  fecha: string;
  trello_card_id: string | null;
  trello_card_url: string | null;
}

function toCsv(rows: PedidoDanado[]): string {
  const headers = [
    'id',
    'area',
    'descripcion',
    'fecha',
    'trello_card_id',
    'trello_card_url',
  ];
  const escape = (v: string | null): string => {
    if (v === null || v === undefined) return '';
    const str = String(v);
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.id,
        r.area,
        r.descripcion,
        r.fecha,
        r.trello_card_id,
        r.trello_card_url,
      ]
        .map(escape)
        .join(','),
    ),
  ];
  return lines.join('\r\n');
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const jwt = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(jwt);

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json() as {
    area?: string;
    fecha_inicio?: string;
    fecha_fin?: string;
  };
  const { area, fecha_inicio, fecha_fin } = body;

  let query = supabase
    .from('pedidos_danados')
    .select(
      'id, area, descripcion, fecha, trello_card_id, trello_card_url',
    )
    .order('fecha', { ascending: false });

  if (area) query = query.eq('area', area);
  if (fecha_inicio) query = query.gte('fecha', fecha_inicio);
  if (fecha_fin) query = query.lte('fecha', fecha_fin);

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const csv = toCsv((data ?? []) as PedidoDanado[]);

  // Persist a record in reportes_generados
  await supabase.from('reportes_generados').insert({
    area: area ?? 'all',
    generado_por: user.id,
    fecha_inicio: fecha_inicio ?? new Date().toISOString().slice(0, 10),
    fecha_fin: fecha_fin ?? new Date().toISOString().slice(0, 10),
  });

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reporte_${area ?? 'all'}.csv"`,
    },
  });
});
