import { expect, test, type Request } from '@playwright/test';
import {
  addFromCatalog,
  openCatalog,
  openCheckout,
  openProduct,
  products,
  showCart,
} from './support/shop';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release };
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

    test.fail(true, 'QA-01: шаг «+» поднимает количество выше остатка');
    expect(await quantity.inputValue()).toBe(String(stock));
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

    test.fail(true, 'QA-02: запрос с количеством 0 добавляет одну единицу');
    await expect(page.getByTestId('cart-empty')).toBeVisible({ timeout: 1_000 });
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
    const firstRequest = gate();
    const allowFirst = gate();
    const firstSettled = gate();
    const matchesFirst = (url: URL) => url.pathname === '/api/products'
      && url.searchParams.get('search') === firstQuery;
    const markFirstSettled = (request: Request) => {
      if (matchesFirst(new URL(request.url()))) firstSettled.release();
    };

    await page.route(matchesFirst, async route => {
      firstRequest.release();
      await allowFirst.wait;
      try {
        await route.continue();
      } catch (error) {
        // Cancellation of a superseded request is also valid behavior.
        if (!route.request().failure()) throw error;
      }
    });

    page.on('requestfinished', markFirstSettled);
    page.on('requestfailed', markFirstSettled);
    const search = page.getByRole('searchbox', { name: 'Поиск' });
    const cards = page.getByTestId('product-card');

    try {
      await search.fill(firstQuery);
      await firstRequest.wait;
      await search.fill(latestQuery);
      await expect(cards).toHaveCount(1);
      await expect(cards.getByRole('link', { name: matcha, exact: true })).toBeVisible();
    } finally {
      allowFirst.release();
    }

    await firstSettled.wait;
    // Let the browser paint any update queued by the settled request.
    await page.evaluate(() => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
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
});
