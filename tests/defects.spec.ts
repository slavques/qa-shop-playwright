import { expect, test, type Page, type Request } from '@playwright/test';
import {
  addFromCatalog,
  openCatalog,
  openCheckout,
  openProduct,
  products,
  rubles,
  showCart,
} from './support/shop';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release };
}

async function delayRequest(page: Page, matches: (url: URL) => boolean) {
  const intercepted = gate();
  const release = gate();
  const settled = gate();
  const markSettled = (request: Request) => {
    if (matches(new URL(request.url()))) settled.release();
  };

  await page.route(matches, async route => {
    intercepted.release();
    await release.wait;
    try {
      await route.continue();
    } catch (error) {
      // Cancellation of a superseded request is also valid behavior.
      if (!route.request().failure()) throw error;
    }
  });
  page.on('requestfinished', markSettled);
  page.on('requestfailed', markSettled);

  return { intercepted: intercepted.wait, release: release.release, settled: settled.wait };
}

async function waitForPaint(page: Page) {
  // Let the browser paint any update queued by the settled request.
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

test.describe('Регрессии по известным дефектам', () => {
  test('QA-01 · шаг «+» ограничен остатком товара', async ({ page }) => {
    await openCatalog(page);
    await openProduct(page, products.kettle.name);

    const quantity = page.getByRole('spinbutton', { name: 'Количество', exact: true });
    const increase = page.getByRole('button', { name: 'Увеличить количество' });
    const stock = products.kettle.stock;
    await expect(quantity).toHaveValue('1');
    await expect(quantity).toHaveAttribute('max', String(stock));
    for (let current = 1; current < stock; current++) {
      await increase.click();
    }
    await expect(quantity).toHaveValue(String(stock));

    if (await increase.isEnabled()) {
      await increase.click();
    }
    const displayedQuantity = await quantity.inputValue();

    test.fail(true, 'QA-01: шаг «+» поднимает количество выше остатка');
    expect(displayedQuantity).toBe(String(stock));
  });

  test('QA-02 · нулевое количество не добавляет товар', async ({ page }) => {
    await openCatalog(page);
    await openProduct(page, products.kettle.name);
    await expect(page.getByTestId('cart-count')).toHaveText('0');

    const quantity = page.getByRole('spinbutton', { name: 'Количество', exact: true });
    const add = page.getByRole('button', { name: 'Добавить в корзину' });
    await quantity.fill('0');
    if (await quantity.inputValue() === '0' && await add.isEnabled()) {
      await add.click();
      await expect(page.getByRole('status')).toBeVisible();
    }
    await showCart(page);
    const empty = page.getByTestId('cart-empty');
    await expect(empty.or(page.getByTestId('cart-row').first())).toBeVisible();

    test.fail(true, 'QA-02: запрос с количеством 0 добавляет одну единицу');
    await expect(empty).toBeVisible({ timeout: 1_000 });
  });

  test('QA-03 · при самовывозе адрес доставки скрыт', async ({ page }) => {
    await openCatalog(page);
    await addFromCatalog(page, products.ethiopia.name, 1);
    await showCart(page);
    await openCheckout(page);

    const address = page.getByLabel('Адрес доставки', { exact: true });
    await expect(address).toBeVisible();
    await page.getByRole('radio', { name: 'Самовывоз' }).check();
    await expect(page.getByTestId('shipping')).toHaveText('бесплатно');

    test.fail(true, 'QA-03: поле адреса визуально остаётся в форме при самовывозе');
    await expect(address).toBeHidden({ timeout: 1_000 });
  });

  test('QA-04 · запоздавший ответ не перезаписывает результаты поиска', async ({ page }) => {
    await openCatalog(page);

    const firstQuery = 'Эфиопия';
    const latestQuery = 'матча';
    const matcha = products.matcha.name;
    const firstRequest = await delayRequest(page, url => url.pathname === '/api/products'
      && url.searchParams.get('search') === firstQuery);
    const search = page.getByRole('searchbox', { name: 'Поиск' });
    const cards = page.getByTestId('product-card');

    try {
      await search.fill(firstQuery);
      await firstRequest.intercepted;
      await search.fill(latestQuery);
      await expect(cards).toHaveCount(1);
      await expect(cards.getByRole('link', { name: matcha, exact: true })).toBeVisible();
    } finally {
      firstRequest.release();
    }

    await firstRequest.settled;
    await waitForPaint(page);
    await expect(search).toHaveValue(latestQuery);

    test.fail(true, 'QA-04: поздний ответ предыдущего поиска заменяет актуальную выдачу');
    await expect(cards).toHaveCount(1, { timeout: 1_000 });
    await expect(cards.getByRole('link', { name: matcha, exact: true })).toBeVisible();
  });

  test('QA-05 · гостю доступен вход, кнопка выхода скрыта', async ({ page }) => {
    await openCatalog(page);

    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: 'Войти', exact: true })).toBeVisible();
    const logout = header.getByText('Выйти', { exact: true });

    test.fail(true, 'QA-05: гостю видна кнопка выхода из аккаунта');
    await expect(logout).toBeHidden({ timeout: 1_000 });
  });

  test('QA-06 · медленный расчёт самовывоза не меняет итог для курьера', async ({ page }) => {
    await openCatalog(page);
    await addFromCatalog(page, products.ethiopia.name, 1);
    await showCart(page);
    await openCheckout(page);

    const courier = page.getByRole('radio', { name: 'Курьером' });
    const shipping = page.getByTestId('shipping');
    await expect(courier).toBeChecked();
    await expect(shipping).toHaveText(rubles(300));
    const pickupRequest = await delayRequest(page, url => url.pathname === '/api/delivery'
      && url.searchParams.get('method') === 'pickup');

    try {
      await page.getByRole('radio', { name: 'Самовывоз' }).check();
      await pickupRequest.intercepted;
      const courierResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/delivery' && url.searchParams.get('method') === 'courier';
      });
      await courier.check();
      const response = await courierResponse;
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ method: 'courier', cost: 300 });
    } finally {
      pickupRequest.release();
    }

    await pickupRequest.settled;
    await waitForPaint(page);
    await expect(courier).toBeChecked();

    test.fail(true, 'QA-06: поздний расчёт самовывоза занижает сумму для курьера');
    await expect.soft(shipping).toHaveText(rubles(300), { timeout: 1_000 });
    await expect.soft(page.getByTestId('total')).toHaveText(rubles(1190), { timeout: 1_000 });
  });
});
