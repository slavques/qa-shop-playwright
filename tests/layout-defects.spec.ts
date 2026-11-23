import { expect, test } from '@playwright/test';
import {
  addFromCatalog, newCustomer, openCatalog, openRegistration, products, rubles, showCart, submitRegistration,
} from './support/shop';

test('QA-15 · мобильная шапка удерживает ссылку корзины в пределах экрана', async ({ page }) => {
  const customer = { ...newCustomer(), name: 'Александра Константинопольская' };
  await page.setViewportSize({ width: 390, height: 844 });
  await openCatalog(page);
  await openRegistration(page);
  await submitRegistration(page, customer);
  await expect(page.getByRole('heading', { name: 'Каталог', exact: true })).toBeVisible();
  await expect(page.getByRole('banner').getByText(customer.name, { exact: true })).toBeVisible();

  const cart = page.getByTestId('cart-link');
  await expect(cart).toBeVisible();
  const layout = await cart.evaluate(link => ({
    right: Math.ceil(link.getBoundingClientRect().right),
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  if (layout.right > layout.viewport + 1) {
    expect(layout.documentWidth).toBeGreaterThan(layout.viewport);
  }

  test.fail(true, 'QA-15: длинное имя выталкивает ссылку корзины за край окна');
  expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1);
});

test('QA-18 · изменение количества с клавиатуры сохраняет фокус в корзине', async ({ page }) => {
  await openCatalog(page);
  await addFromCatalog(page, products.ethiopia.name, 1);
  await showCart(page);

  const quantity = page.getByRole('spinbutton', { name: 'Количество' });
  await quantity.fill('2');
  await expect(quantity).toBeFocused();
  await quantity.press('Tab');
  await expect(page.getByTestId('cart-count')).toHaveText('2');
  await expect(page.getByTestId('total')).toHaveText(rubles(1780));

  const focus = await page.evaluate(() => ({
    inCart: Boolean(document.activeElement?.closest('main')),
    onBody: document.activeElement === document.body,
  }));
  if (!focus.inCart) expect(focus.onBody).toBe(true);

  test.fail(true, 'QA-18: после успешного пересчёта корзины фокус сбрасывается на документ');
  expect(focus.inCart).toBe(true);
});
