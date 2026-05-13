import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    const key = Deno.env.get('TRELLO_API_KEY');
    const token = Deno.env.get('TRELLO_TOKEN');
    
    return new Response(
      JSON.stringify({ ok: true, hasKey: !!key, hasToken: !!token }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
});
