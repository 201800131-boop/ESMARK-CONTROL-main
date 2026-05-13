import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

function getCorsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

serve(async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders();

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const apiKey = Deno.env.get('TRELLO_API_KEY') ?? '';
    const token = Deno.env.get('TRELLO_TOKEN') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const status = {
      trello_api_key_exists: apiKey.length > 0,
      trello_token_exists: token.length > 0,
      supabase_url_exists: supabaseUrl.length > 0,
      service_key_exists: serviceKey.length > 0,
      api_key_preview: apiKey.length > 0 ? apiKey.substring(0, 10) + '...' : 'NOT SET',
      token_preview: token.length > 0 ? token.substring(0, 10) + '...' : 'NOT SET',
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(status), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: String(error),
        stack: error instanceof Error ? error.stack : '',
      }),
      {
        status: 500,
        headers: getCorsHeaders(),
      }
    );
  }
});
