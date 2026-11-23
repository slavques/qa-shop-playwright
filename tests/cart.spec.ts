import { expect, test } from '@playwright/test';
import { addFromCatalog, cartRow, openCatalog, openProduct, products, rubles, showCart } from './support/shop';

test('CART-01 Корзина объединяет товар, пересчитывает количества и итог', async ({ page }) => {
  const { ethiopia, oolong } = products;
  await openCatalog(page);
  await addFromCatalog(page, ethiopia.name, 1);
  await addFromCatalog(page, oolong.name, 2);
  await openProduct(page, ethiopia.name);

  await page.getByRole('button', { name: 'Увеличить количество' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Количество' })).toHaveValue('2');
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText('4');
  await showCart(page);
  await expect(page.getByTestId('cart-row')).toHaveCount(2);

  const row = cartRow(page, ethiopia.name);
  const quantity = row.getByRole('spinbutton', { name: 'Количество' });
  await expect(quantity).toHaveValue('3');
  await expect(row.getByRole('cell', { name: rubles(2670), exact: true })).toBeVisible();
  await expect(page.getByTestId('subtotal')).toHaveText(rubles(3310));

  await row.getByRole('button', { name: 'Уменьшить количество' }).click();
  await expect(quantity).toHaveValue('2');
  await expect(page.getByTestId('total')).toHaveText(rubles(2420));

  await row.getByRole('button', { name: 'Увеличить количество' }).click();
  await expect(quantity).toHaveValue('3');
  await expect(page.getByTestId('total')).toHaveText(rubles(3310));

  await quantity.fill('4');
  await quantity.press('Tab');
  await expect(page.getByTestId('cart-count')).toHaveText('5');
  await expect(page.getByTestId('total')).toHaveText(rubles(4200));

  await cartRow(page, oolong.name).getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByTestId('cart-row')).toHaveCount(1);
  await expect(page.getByTestId('cart-count')).toHaveText('4');
  await expect(page.getByTestId('total')).toHaveText(rubles(3560));

  await page.getByRole('button', { name: 'Очистить корзину' }).click();
  await expect(page.getByTestId('cart-empty')).toContainText('В корзине пока пусто');
  await expect(page.getByTestId('cart-count')).toHaveText('0');
});

test('CART-02 Ровно весь остаток доступен, превышение не меняет корзину', async ({ page }) => {
  const { kettle } = products;
  await openCatalog(page);
  await openProduct(page, kettle.name);
  const quantity = page.getByRole('spinbutton', { name: 'Количество' });
  await expect(quantity).toHaveAttribute('max', String(kettle.stock));
  await quantity.fill(String(kettle.stock));
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText(String(kettle.stock));

  await showCart(page);
  const row = cartRow(page, kettle.name);
  await row.getByRole('button', { name: 'Увеличить количество' }).click();
  await expect(page.getByRole('status')).toHaveText(`В наличии только ${kettle.stock} шт.`);
  await expect(row.getByRole('spinbutton', { name: 'Количество' })).toHaveValue(String(kettle.stock));
  await expect(page.getByTestId('cart-count')).toHaveText(String(kettle.stock));
  await expect(page.getByTestId('total')).toHaveText(rubles(16800));
});

test('CART-03 Корзина сохраняется после обновления и изолирована по сессиям', async ({ page, browser, baseURL }) => {
  await openCatalog(page);
  await addFromCatalog(page, products.ethiopia.name, 1);
  await showCart(page);
  await page.reload();
  await expect(cartRow(page, products.ethiopia.name)).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText(rubles(890));

  const otherContext = await browser.newContext({ baseURL });
  try {
    const otherPage = await otherContext.newPage();
    await openCatalog(otherPage);
    await showCart(otherPage);
    await expect(otherPage.getByTestId('cart-empty')).toBeVisible();
    await expect(otherPage.getByTestId('cart-count')).toHaveText('0');
  } finally {
    await otherContext.close();
  }
});

test('CART-04 Пустая корзина блокирует переход к оформлению', async ({ page }) => {
  await page.goto('/#/checkout');
  await expect(page).toHaveURL(/#\/cart$/);
  await expect(page.getByTestId('cart-empty')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Оформить заказ' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Перейти в каталог' }).click();
  await expect(page.getByTestId('product-card').first()).toBeVisible();
});
