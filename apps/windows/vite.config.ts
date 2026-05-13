import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      electron({
        main: {
          entry: 'electron/main.ts',
        },
        preload: {
          input: 'electron/preload.ts',
        },
      }),
    ],
    define: {
      'process.env.SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL ?? ''),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY ?? ''),
    },
  };
});
