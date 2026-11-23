import { expect, test, type APIResponse, type Request, type Response } from '@playwright/test';
import { addFromCatalog, cartRow, openCatalog, productCard, products, showCart } from './support/shop';

function latch<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}

test('QA-20 · временная ошибка поиска видна и поиск можно повторить', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Поиск', exact: true });
  const names = page.getByTestId('product-card').getByRole('link');
  const failureMessage = 'Временная ошибка каталога';
  const matchesSearch = (url: URL) => url.pathname === '/api/products'
    && url.searchParams.get('search') === 'матча';
  await openCatalog(page);
  await expect(names).toHaveCount(16);
  const previousResults = await names.allTextContents();

  await page.route(matchesSearch, route => route.fulfill({
    status: 503,
    json: { error: failureMessage },
  }), { times: 1 });
  const failedSearch = page.waitForResponse(response =>
    matchesSearch(new URL(response.url())) && response.status() === 503);
  await search.fill('матча');
  await (await failedSearch).finished();
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

  await expect(search).toHaveValue('матча');
  const status = page.getByRole('status');
  const statusVisible = await status.isVisible() && Boolean((await status.textContent())?.trim());
  const errorVisible = await page.getByRole('alert').isVisible() || statusVisible
    || await page.getByText(failureMessage, { exact: true }).isVisible();
  if (!errorVisible) expect(await names.allTextContents()).toEqual(previousResults);

  await search.clear();
  await search.fill('матча');
  await expect(names).toHaveText([products.matcha.name]);

  test.fail(true, 'QA-20: после HTTP 503 остаётся предыдущая выдача без сообщения');
  expect(errorVisible).toBe(true);
});

test('QA-21 · два быстрых нажатия «+» не теряют изменение количества', async ({ page }) => {
  const product = products.ethiopia.name;
  await openCatalog(page);
  await addFromCatalog(page, product, 1);
  await showCart(page);
  const row = cartRow(page, product);
  const plus = row.getByRole('button', { name: 'Увеличить количество', exact: true });
  const qty = row.getByRole('spinbutton', { name: 'Количество', exact: true });
  await expect(qty).toHaveValue('1');

  const firstArrived = latch<APIResponse>();
  const release = latch();
  const firstSettled = latch();
  const path = '/api/cart/items/1';
  let held: Request | undefined;
  function markFirstSettled(request: Request) {
    if (request !== held) return;
    page.off('requestfinished', markFirstSettled);
    page.off('requestfailed', markFirstSettled);
    firstSettled.resolve();
  }
  page.on('requestfinished', markFirstSettled);
  page.on('requestfailed', markFirstSettled);
  await page.route(url => url.pathname === path, async route => {
    if (held || route.request().method() !== 'PATCH') return route.continue();
    held = route.request();
    const response = await route.fetch();
    firstArrived.resolve(response);
    await release.promise;
    try {
      await route.fulfill({ response });
    } catch (error) {
      if (!held.failure()) throw error;
    }
  });

  let second: Promise<Response> | undefined;
  try {
    await plus.click();
    const first = await firstArrived.promise;
    expect(first.status()).toBe(200);
    expect(await first.json()).toMatchObject({ count: 2 });
    if (await plus.isEnabled()) {
      second = page.waitForResponse(response => response.request() !== held
        && response.request().method() === 'PATCH' && new URL(response.url()).pathname === path);
      await plus.click();
    } else {
      await expect(plus).toBeDisabled();
    }
  } finally {
    release.resolve();
  }

  await firstSettled.promise;
  const secondResponse = await second;
  if (secondResponse) {
    expect(secondResponse.status()).toBe(200);
    await secondResponse.finished();
  }
  const saved = await page.request.get('/api/cart');
  expect(saved.status()).toBe(200);
  const cart = await saved.json();
  expect([2, 3]).toContain(cart.count);
  expect(cart.items).toMatchObject([{ name: product, qty: cart.count }]);
  await expect(qty).toHaveValue(String(cart.count));
  await expect(page.getByTestId('cart-count')).toHaveText(String(cart.count));
  if (!secondResponse) {
    expect(cart.count).toBe(2);
  } else if (cart.count === 2) {
    expect([held?.postDataJSON()?.qty, secondResponse.request().postDataJSON()?.qty]).toEqual([2, 2]);
  }

  test.fail(true, 'QA-21: два принятых нажатия отправляют одинаковое количество');
  expect(!secondResponse || cart.count === 3).toBe(true);
});

test('QA-25 · содержимое карточки товара остаётся внутри рамки на ширине 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openCatalog(page);
  await productCard(page, products.ethiopia.name)
    .getByRole('link', { name: products.ethiopia.name, exact: true }).click();

  const card = page.getByTestId('product-page');
  const add = card.getByRole('button', { name: 'Добавить в корзину', exact: true });
  await expect(card).toBeVisible();
  await expect(add).toBeEnabled();
  const geometry = await card.evaluate(element => ({
    cardRight: element.getBoundingClientRect().right,
    buttonRight: element.querySelector('#add')!.getBoundingClientRect().right,
    iconRight: element.querySelector('.product__icon')!.getBoundingClientRect().right,
    viewport: document.documentElement.clientWidth,
  }));
  expect(geometry.viewport).toBe(320);

  test.fail(true, 'QA-25: кнопка и иллюстрация выступают за правую границу карточки');
  expect(Math.max(geometry.buttonRight, geometry.iconRight)).toBeLessThanOrEqual(geometry.cardRight + 1);
});
