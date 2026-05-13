import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[ESMARK] Credenciales de Supabase no configuradas. ' +
      'Crea un archivo .env con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.',
  );
}

export const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '');
