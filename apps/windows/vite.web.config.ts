import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { supabaseCspPlugin } from './vite.supabase-csp';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), supabaseCspPlugin(env.VITE_SUPABASE_URL ?? '')],
  };
});
