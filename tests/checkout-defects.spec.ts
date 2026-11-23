import type { Page } from '@playwright/test';
import { expect, test } from './support/isolated-shop';
import { addFromCatalog, openCatalog, openCheckout, products, rubles, showCart } from './support/shop';

const coffee = products.ethiopia;
const originalTotal = coffee.price + 300;
const updatedTotal = coffee.price * 2 + 300;
const normalizeSpacing = (text: string) => text.replace(/\s+/g, ' ').trim();

async function prepareCourierCheckout(page: Page, phone: string) {
  await openCatalog(page);
  await addFromCatalog(page, coffee.name, 1);
  await showCart(page);
  await openCheckout(page);
  await expect(page.getByTestId('total')).toHaveText(rubles(originalTotal));
  await page.getByLabel('Имя получателя').fill('Тестовый Покупатель');
  await page.getByLabel('Телефон').fill(phone);
  await page.getByLabel('Адрес доставки').fill('Тестовая улица, дом 10');
}

async function confirmCheckout(page: Page) {
  const confirmation = page.getByTestId('order-success');
  const alert = page.getByRole('alert');
  await page.getByRole('button', { name: 'Подтвердить заказ' }).click();
  await expect(confirmation.or(alert)).toBeVisible();
  return confirmation.isVisible();
}

async function readConfirmedOrder(page: Page) {
  const id = page.getByTestId('order-id');
  await expect(id).toHaveText(/^\d+$/);
  const response = await page.request.get(`/api/orders/${await id.innerText()}`);
  await expect(response).toBeOK();
  return response.json();
}

test('QA-07 · изменение корзины в другой вкладке требует подтверждения нового итога', async ({ page, context }) => {
  await prepareCourierCheckout(page, '+7 900 000-00-00');

  const secondTab = await context.newPage();
  try {
    await secondTab.goto('/#/cart');
    await expect(secondTab.getByTestId('cart-count')).toHaveText('1');
    await secondTab.getByRole('button', { name: 'Увеличить количество' }).click();
    await expect(secondTab.getByTestId('cart-count')).toHaveText('2');
    await expect(secondTab.getByTestId('total')).toHaveText(rubles(coffee.price * 2));
  } finally {
    await secondTab.close();
  }

  const reviewedTotal = normalizeSpacing(await page.getByTestId('total').innerText());
  expect([originalTotal, updatedTotal].map(total => normalizeSpacing(rubles(total)))).toContain(reviewedTotal);
  const confirmed = await confirmCheckout(page);

  let unreviewedChange = false;
  if (confirmed) {
    const order = await readConfirmedOrder(page);
    expect([originalTotal, updatedTotal]).toContain(order.total);
    const quantity = order.total === originalTotal ? 1 : 2;
    expect(order).toMatchObject({ delivery: 'courier', shipping: 300 });
    expect(order.items).toMatchObject([{ name: coffee.name, qty: quantity }]);
    await expect(page.getByTestId('total')).toHaveText(rubles(order.total));
    unreviewedChange = normalizeSpacing(rubles(order.total)) !== reviewedTotal;
    if (unreviewedChange) {
      expect(reviewedTotal).toBe(normalizeSpacing(rubles(originalTotal)));
      expect(order).toMatchObject({ total: updatedTotal, items: [{ name: coffee.name, qty: 2 }] });
    }
  }

  test.fail(true, 'QA-07: оформляется заказ на 2 080 ₽, хотя покупатель видел 1 190 ₽');
  expect(unreviewedChange).toBe(false);
});

test('QA-08 · телефон с одной цифрой и разделителями отклоняется', async ({ page }) => {
  const invalidPhone = '7---------';
  await prepareCourierCheckout(page, invalidPhone);
  const confirmed = await confirmCheckout(page);

  if (confirmed) {
    const order = await readConfirmedOrder(page);
    expect(order).toMatchObject({ customer: { phone: invalidPhone } });
    await expect(page.getByTestId('order-success')).toContainText(invalidPhone);
  } else {
    await expect(page.getByText('Укажите телефон в формате +7 900 000-00-00', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
  }

  test.fail(true, 'QA-08: сервер оформляет заказ с недействительным номером из одной цифры');
  expect(confirmed).toBe(false);
});

test('QA-22 · после сбоя расчёта доставки нельзя подтвердить старую стоимость молча', async ({ page }) => {
  await prepareCourierCheckout(page, '+7 900 000-00-00');
  await expect(page.getByRole('status')).toBeHidden();

  const pickupQuote = (url: URL) => url.pathname === '/api/delivery'
    && url.searchParams.get('method') === 'pickup';
  await page.route(pickupQuote, route => route.abort('failed'), { times: 1 });
  const failure = page.waitForEvent('requestfailed', request => pickupQuote(new URL(request.url())));
  const pickup = page.getByRole('radio', { name: 'Самовывоз' });
  await pickup.check();
  expect((await failure).failure()).not.toBeNull();

  // Allow the browser to commit the UI update caused by the rejected fetch.
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await expect(pickup).toBeChecked();
  const shipping = page.getByTestId('shipping');
  const total = page.getByTestId('total');
  const submit = page.getByRole('button', { name: 'Подтвердить заказ' });
  const quote = {
    shipping: await shipping.isVisible() ? normalizeSpacing(await shipping.innerText()) : null,
    total: await total.isVisible() ? normalizeSpacing(await total.innerText()) : null,
    submitEnabled: await submit.isVisible() && await submit.isEnabled(),
    feedbackVisible: await page.getByRole('alert').isVisible() || await page.getByRole('status').isVisible(),
  };
  const silentStaleQuote = quote.shipping === normalizeSpacing(rubles(300))
    && quote.total === normalizeSpacing(rubles(originalTotal))
    && quote.submitEnabled
    && !quote.feedbackVisible;

  if (silentStaleQuote) {
    await page.getByRole('radio', { name: 'Курьером' }).check();
    await pickup.check();
    await expect(shipping).toHaveText('бесплатно');
    await expect(total).toHaveText(rubles(coffee.price));
  }

  test.fail(true, 'QA-22: при выбранном самовывозе остаётся 300 ₽ доставки без сообщения о сбое');
  expect(silentStaleQuote).toBe(false);
});
