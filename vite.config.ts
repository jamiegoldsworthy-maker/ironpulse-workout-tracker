import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

function getGitBuildLabel(): string {
  try {
    const subject = execSync('git log -1 --pretty=%s', { encoding: 'utf8' }).trim();
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    if (subject && sha) return `${subject} (${sha})`;
    if (sha) return sha;
  } catch {
    // Fallback when git metadata is unavailable
  }
  return process.env.VITE_APP_BUILD || 'v1.4.1';
}

// https://vite.dev/config/
export default defineConfig(() => {
  const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return {
    plugins: [react()],
    base: '/ironpulse-workout-tracker/',
    define: {
      __APP_BUILD__: JSON.stringify(getGitBuildLabel()),
      __APP_BUILD_TIME__: JSON.stringify(buildTime),
    },
  };
});
