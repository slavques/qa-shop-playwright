import { expect, request, type FullConfig } from '@playwright/test';

export default async function waitForPublicShop(config: FullConfig) {
  const api = await request.newContext({ baseURL: config.projects[0].use.baseURL, timeout: 5_000 });

  try {
    await expect.poll(async () => {
      try {
        const response = await api.get('/api/health');
        if (!response.ok()) return false;

        const health = await response.json();
        return health.app === 'qa-shop' && health.status === 'ok';
      } catch {
        // A cold instance may return a loading page or refuse the first connection.
        return false;
      }
    }, {
      message: 'Public shop did not become ready at /api/health',
      timeout: 90_000,
      intervals: [1_000, 2_000, 4_000],
    }).toBe(true);
  } finally {
    await api.dispose();
  }
}
