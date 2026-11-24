import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

function getGitBuildLabel(): string {
  try {
    const subject = execSync('git log -1 --pretty=%s', { encoding: 'utf8' }).trim();
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    if (subject && sha) return `${subject} (${sha})`;
    if (sha) return sha;
  } catch {
    // Fallback when git metadata is unavailable
  }
  return process.env.VITE_APP_BUILD || 'v1.5.0';
}

function getShortAppVersion(): string {
  try {
    const subject = execSync('git log -1 --pretty=%s', { encoding: 'utf8' }).trim();
    const match = subject.match(/v\d+\.\d+\.\d+/i);
    if (match) return match[0].toLowerCase();
  } catch {
    // Fallback when git metadata is unavailable
  }
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    if (pkg.version && /^\d+\.\d+\.\d+/.test(pkg.version) && pkg.version !== '1.0.0') {
      return `v${pkg.version}`;
    }
  } catch {
    // Ignore package.json fallback errors
  }
  return 'v1.5.0';
}

// https://vite.dev/config/
export default defineConfig(() => {
  const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return {
    plugins: [react()],
    base: '/ironpulse-workout-tracker/',
    define: {
      __APP_VERSION__: JSON.stringify(getShortAppVersion()),
      __APP_BUILD__: JSON.stringify(getGitBuildLabel()),
      __APP_BUILD_TIME__: JSON.stringify(buildTime),
    },
  };
});
