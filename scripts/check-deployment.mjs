import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

const shop = 'http://127.0.0.1:13101';
const token = process.env.GRAFANA_PUBLIC_DASHBOARD_TOKEN;
assert.match(token ?? '', /^[a-f0-9]{32}$/, 'CI requires a public dashboard token');
const dashboard = `http://127.0.0.1:13100/api/public/dashboards/${token}`;

async function createDemoOrder() {
  const cart = await fetch(`${shop}/api/cart/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: 1, qty: 1 }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(cart.status, 201, 'Demo product must be added to a new cart');
  const session = cart.headers.getSetCookie().find((cookie) => cookie.startsWith('sid='));
  assert.ok(session, 'Cart response must set a session cookie');

  const order = await fetch(`${shop}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.split(';')[0] },
    body: JSON.stringify({
      name: 'Демо QA CI',
      phone: '+7 900 000-00-00',
      delivery: 'pickup',
      payment: 'cash',
    }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(order.status, 201, 'Demo pickup order must be created');
  const { total, shipping } = await order.json();
  assert.equal(shipping, 0, 'Pickup delivery must be free');
  assert.equal(total, 890, 'Demo order must have the expected total');
}

async function queryPanel(panelId) {
  const now = Date.now();
  const response = await fetch(`${dashboard}/panels/${panelId}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeRange: { from: String(now - 5 * 60_000), to: String(now), timezone: 'utc' },
      intervalMs: 15_000,
      maxDataPoints: 25,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200, `Public panel ${panelId} must answer without login`);
  const { results } = await response.json();
  assert.ok(Object.keys(results).length, `Public panel ${panelId} must return query results`);
  for (const [refId, result] of Object.entries(results)) {
    assert.equal(result.status ?? 200, 200, `Public panel ${panelId}/${refId} query failed`);
    assert.ok(!result.error, `Public panel ${panelId}/${refId} query returned an error`);
  }
  return results.A?.frames[0]?.data.values.at(-1)?.at(-1);
}

const dashboardModel = await fetch(dashboard, { signal: AbortSignal.timeout(5_000) });
assert.equal(dashboardModel.status, 200, 'Public dashboard must answer without login');
const { dashboard: { uid, panels } } = await dashboardModel.json();
assert.equal(uid, 'qa-shop-observability');
const dataPanels = panels.filter(({ type }) => type !== 'row');
const expected = [1, 1, 890];
const metricPanels = [2, 9, 10]; // Scrape health, order count, order total.

await createDemoOrder();

let actual;
for (let attempt = 0; attempt < 15; attempt++) {
  actual = await Promise.all(metricPanels.map(queryPanel));
  if (actual.every((value, index) => value === expected[index])) break;
  if (attempt < 14) await setTimeout(2_000); // Prometheus scrapes every 15 seconds.
}
assert.deepEqual(actual, expected, 'Grafana must reflect the scrape and synthetic order');

for (const { id } of dataPanels) {
  if (!metricPanels.includes(id)) await queryPanel(id);
}
console.log(`Public Grafana returned all ${dataPanels.length} panels, including one 890 RUB order`);
