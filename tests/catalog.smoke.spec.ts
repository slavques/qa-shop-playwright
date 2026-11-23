import { expect, test } from '@playwright/test';
import { openCatalog, openProduct, products, rubles } from './support/shop';

test('SMK-01 Магазин отвечает и отдаёт каталог по публичному HTTP', async ({ request }) => {
  const [health, catalog] = await Promise.all([
    request.get('/api/health'),
    request.get('/api/products'),
  ]);
  await expect(health).toBeOK();
  await expect(catalog).toBeOK();
  expect(await health.json()).toMatchObject({ app: 'qa-shop', status: 'ok' });
  expect(await catalog.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: products.ethiopia.name, price: products.ethiopia.price, category: 'coffee' }),
  ]));
});

test('SMK-02 Каталог, поиск и карточка открываются на узком экране', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCatalog(page);
  await expect(page).toHaveTitle(/Лавка/);
  await page.getByRole('searchbox', { name: 'Поиск' }).fill('иргачефф');
  await expect(page.getByTestId('product-card').getByRole('link')).toHaveText([products.ethiopia.name]);
  await openProduct(page, products.ethiopia.name);
  await expect(page.getByTestId('product-price')).toHaveText(rubles(products.ethiopia.price));
});
