import { expect, test, type APIResponse, type Page, type Request } from '@playwright/test';
import {
  addFromCatalog, cartRow, newCustomer, openCatalog, openRegistration,
  productCard, products, showCart, submitRegistration,
} from './support/shop';

function latch<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}

async function holdResponse(page: Page, path: string, matches: (request: Request) => boolean) {
  const upstream = latch<APIResponse>();
  const release = latch();
  const finished = latch<Request>();
  let held: Request | undefined;

  function markFinished(request: Request) {
    if (request !== held) return;
    page.off('requestfinished', markFinished);
    page.off('requestfailed', markFinished);
    finished.resolve(request);
  }

  page.on('requestfinished', markFinished);
  page.on('requestfailed', markFinished);
  await page.route(url => url.pathname === path, async route => {
    const request = route.request();
    if (held || !matches(request)) return route.continue();
    held = request;
    const response = await route.fetch();
    upstream.resolve(response);
    await release.promise;
    try {
      await route.fulfill({ response });
    } catch (error) {
      if (!request.failure()) throw error;
    }
  });

  return { upstream: upstream.promise, release: release.resolve, finished: finished.promise };
}

async function waitForRender(page: Page, finished: Promise<Request>) {
  const request = await finished;
  const failure = request.failure();
  if (failure) {
    expect(failure.errorText, 'A superseded request may be cancelled').toMatch(/abort|cancel/i);
  } else {
    expect((await request.response())?.ok(), 'The held request must succeed').toBe(true);
  }
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

test('QA-09 · история заказов доступна из шапки на мобильной ширине', async ({ page }) => {
  const customer = newCustomer();
  const header = page.getByRole('banner');
  const orders = header.getByRole('link', { name: 'Мои заказы', exact: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await openCatalog(page);
  await openRegistration(page);
  await submitRegistration(page, customer);
  await expect(header.getByText(customer.name, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Каталог', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 920, height: 844 });
  await expect(orders).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const canOpenOrders = await orders.isVisible();
  if (canOpenOrders) {
    await orders.click();
    await expect(page.getByRole('heading', { name: 'Мои заказы', exact: true })).toBeVisible();
  }

  test.fail(true, 'QA-09: мобильная шапка скрывает переход в историю заказов');
  expect(canOpenOrders).toBe(true);
});

test('QA-10 · поздняя загрузка товара оставляет открытым текущий каталог', async ({ page }) => {
  const product = products.ethiopia;
  const delayed = await holdResponse(page, '/api/products/1', request => request.method() === 'GET');
  await openCatalog(page);

  try {
    await productCard(page, product.name).getByRole('link', { name: product.name, exact: true }).click();
    expect((await delayed.upstream).ok()).toBe(true);
    await expect(page).toHaveURL(/#\/product\/1$/);
    const catalogResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/products' && response.request().method() === 'GET');
    await page.getByRole('banner').getByRole('link', { name: 'Каталог', exact: true }).click();
    expect((await catalogResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByTestId('product-card')).toHaveCount(16);
  } finally {
    delayed.release();
  }

  await waitForRender(page, delayed.finished);
  await expect(page).toHaveURL(/#\/$/);
  const heading = await page.getByRole('heading', { level: 1 }).innerText();
  expect(['Каталог', product.name]).toContain(heading);

  test.fail(true, 'QA-10: поздний ответ открывает карточку при URL каталога');
  expect(heading).toBe('Каталог');
});

test('QA-13 · предыдущий ответ добавления не уменьшает счётчик корзины', async ({ page }) => {
  const delayed = await holdResponse(page, '/api/cart/items', request =>
    request.method() === 'POST' && request.postDataJSON()?.productId === 1);
  const badge = page.getByTestId('cart-count');
  const addButton = (name: string) => productCard(page, name)
    .getByRole('button', { name: 'В корзину', exact: true });
  await openCatalog(page);

  try {
    await addButton(products.ethiopia.name).click();
    const first = await delayed.upstream;
    expect(first.status()).toBe(201);
    expect(await first.json()).toMatchObject({ count: 1 });

    const secondResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/cart/items'
      && response.request().method() === 'POST' && response.request().postDataJSON()?.productId === 4);
    await addButton(products.oolong.name).click();
    const second = await secondResponse;
    expect(second.status()).toBe(201);
    expect(await second.json()).toMatchObject({ count: 2 });
    await expect(badge).toHaveText('2');
  } finally {
    delayed.release();
  }

  await waitForRender(page, delayed.finished);
  const cart = await page.request.get('/api/cart');
  expect(cart.status()).toBe(200);
  expect(await cart.json()).toMatchObject({
    count: 2,
    items: [{ name: products.ethiopia.name, qty: 1 }, { name: products.oolong.name, qty: 1 }],
  });
  const shownCount = await badge.innerText();
  expect(['2', '1']).toContain(shownCount);

  test.fail(true, 'QA-13: после позднего ответа показана одна позиция вместо двух');
  expect(shownCount).toBe('2');
});

test('QA-16 · пустое поле количества не удаляет товар из корзины', async ({ page }) => {
  const name = products.ethiopia.name;
  await openCatalog(page);
  await addFromCatalog(page, name, 1);
  await showCart(page);

  const row = cartRow(page, name);
  const quantity = row.getByRole('spinbutton', { name: 'Количество', exact: true });
  const empty = page.getByTestId('cart-empty');
  const validation = page.getByText('Некорректное количество', { exact: true });
  await expect(row.getByRole('button', { name: 'Удалить', exact: true })).toBeVisible();
  await expect(quantity).toHaveAttribute('min', '1');
  await expect(quantity).toHaveValue('1');
  await quantity.fill('');
  await expect(quantity).toHaveValue('');
  await quantity.press('Tab');

  await expect.poll(async () => {
    if (await empty.isVisible() || await validation.isVisible()) return true;
    const values = await quantity.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
    return values[0] === '1';
  }, { message: 'Корзина должна завершить обработку пустого поля' }).toBe(true);

  const cart = await page.request.get('/api/cart');
  expect(cart.status()).toBe(200);
  const model = await cart.json();
  expect([0, 1]).toContain(model.count);
  if (model.count === 0) {
    expect(model.items).toEqual([]);
    await expect(empty).toBeVisible();
    await expect(validation).toBeHidden();
  } else {
    expect(model.items).toMatchObject([{ name, qty: 1 }]);
  }

  test.fail(true, 'QA-16: пустой ввод удаляет единственный товар без ошибки');
  expect(model.count).toBe(1);
});
