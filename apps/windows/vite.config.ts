import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      electron([
        {
          entry: 'electron/main.ts',
        },
        {
          entry: 'electron/preload.ts',
          onstart(options) {
            options.reload();
          },
        },
      ]),
    ],
    define: {
      'process.env.SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL ?? ''),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY ?? ''),
    },
    optimizeDeps: {
      exclude: ['electron'],
    },
  };
});
