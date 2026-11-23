import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(() => {
  const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return {
    plugins: [react()],
    base: '/ironpulse-workout-tracker/',
    define: {
      __APP_BUILD__: JSON.stringify(
        process.env.VITE_APP_BUILD || 'v1.4.0 · tasks-sync-polish'
      ),
      __APP_BUILD_TIME__: JSON.stringify(buildTime),
    },
  };
});
