import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const staticRoutes = [
  'participants',
  'configurations',
  'config/new',
  'analytics',
  'monitor',
  'compare',
];

const targetRoot = resolve(process.argv[2] || 'dist');
const apiBaseUrl = process.env.SPA_FALLBACK_API_BASE_URL;
const indexPath = join(targetRoot, 'index.html');

if (!existsSync(indexPath)) {
  throw new Error(`Cannot generate SPA fallbacks: missing ${indexPath}`);
}

const routes = new Set(staticRoutes);

if (apiBaseUrl) {
  const [sessionsResponse, configurationsResponse] = await Promise.all([
    fetch(`${apiBaseUrl}/sessions`),
    fetch(`${apiBaseUrl}/configurations`),
  ]);

  if (!sessionsResponse.ok) {
    throw new Error(`Failed to fetch sessions: ${sessionsResponse.status} ${sessionsResponse.statusText}`);
  }

  if (!configurationsResponse.ok) {
    throw new Error(`Failed to fetch configurations: ${configurationsResponse.status} ${configurationsResponse.statusText}`);
  }

  const sessions = await sessionsResponse.json();
  const configurations = await configurationsResponse.json();

  for (const session of sessions) {
    const sessionId = String(session.sessionId || '');
    if (!sessionId || sessionId.includes('/')) continue;
    routes.add(`session/${sessionId}`);
    routes.add(`analytics/${sessionId}`);
    routes.add(`monitor/${sessionId}`);
  }

  for (const configuration of configurations) {
    const configId = String(configuration.configId || '');
    if (!configId || configId.includes('/')) continue;
    routes.add(`start/${configId}`);
    routes.add(`config/${configId}/edit`);
    routes.add(`config/${configId}/sessions`);
  }
}

for (const route of routes) {
  const routeDir = join(targetRoot, route);
  mkdirSync(routeDir, { recursive: true });
  copyFileSync(indexPath, join(routeDir, 'index.html'));
}

console.log(`Generated ${routes.size} SPA fallbacks in ${targetRoot}`);
