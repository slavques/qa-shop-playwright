import type { Page } from '@playwright/test';
import { expect, test } from './support/isolated-shop';
import {
  addFromCatalog, applyPromo, cartRow, expectSignedIn, fillCredentials, newCustomer,
  openCatalog, openCheckout, openProduct, openRegistration, products, rubles, showCart,
  submitRegistration,
} from './support/shop';

const guest = { name: 'Тестовый Покупатель', phone: '+7 900 000-00-00', address: 'Тестовая улица, дом 10' };

async function fillGuestContact(page: Page) {
  await page.getByLabel(/^Имя получателя/).fill(guest.name);
  await page.getByLabel(/^Телефон/).fill(guest.phone);
}

test('ORD-01 Гость исправляет поля и оформляет заказ курьером; корзина и остаток обновляются', async ({ page }) => {
  const item = products.frenchPress;
  await openCatalog(page);
  await openProduct(page, item.name);
  await expect(page.getByText('В наличии: 9 шт.')).toBeVisible();
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText('1');
  await showCart(page);
  await openCheckout(page);

  await expect(page.getByRole('radio', { name: 'Курьером' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Картой при получении' })).toBeChecked();
  await expect(page.getByTestId('shipping')).toHaveText(rubles(300));
  await expect(page.getByTestId('total')).toHaveText(rubles(1890));

  const submit = page.getByRole('button', { name: 'Подтвердить заказ' });
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('Проверьте поля формы');
  for (const message of [
    'Укажите имя получателя', 'Укажите телефон в формате +7 900 000-00-00', 'Укажите адрес доставки',
  ]) {
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  }
  await expect(page.getByTestId('cart-count')).toHaveText('1');
  await expect(submit).toBeEnabled();

  await page.getByLabel(/^Имя получателя/).fill(guest.name);
  await page.getByLabel(/^Телефон/).fill('123456789');
  await page.getByLabel(/^Адрес доставки/).fill('Дом');
  await submit.click();
  await expect(page.getByText('Укажите имя получателя', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Укажите телефон в формате +7 900 000-00-00', { exact: true })).toBeVisible();
  await expect(page.getByText('Укажите адрес доставки', { exact: true })).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveText('1');

  await page.getByLabel(/^Телефон/).fill(guest.phone);
  await page.getByLabel(/^Адрес доставки/).fill(guest.address);
  await submit.click();
  await expect(page.getByTestId('order-success')).toBeVisible();
  await expect(page.getByTestId('order-id')).toHaveText(/^\d+$/);
  await expect(page.getByRole('cell', { name: item.name, exact: true })).toBeVisible();
  await expect(page.getByText(/Доставка курьером:/)).toContainText(guest.address);
  await expect(page.getByText(/Оплата:/)).toContainText('картой при получении');
  await expect(page.getByTestId('shipping')).toHaveText(rubles(300));
  await expect(page.getByTestId('total')).toHaveText(rubles(1890));
  await expect(page.getByTestId('cart-count')).toHaveText('0');

  await page.reload();
  await expect(page.getByTestId('order-success')).toBeVisible();
  await showCart(page);
  await expect(page.getByTestId('cart-empty')).toBeVisible();
  await page.getByRole('link', { name: 'Перейти в каталог' }).click();
  await openProduct(page, item.name);
  await expect(page.getByText('В наличии: 8 шт.')).toBeVisible();
});

test('ORD-02 Бесплатная доставка срабатывает ровно на 3 000 ₽', async ({ page }) => {
  await openCatalog(page);
  await addFromCatalog(page, products.oolong.name, 1);
  await addFromCatalog(page, products.filters.name, 2);
  await addFromCatalog(page, products.frenchPress.name, 3);
  await addFromCatalog(page, products.chocolate.name, 4);
  await showCart(page);
  await openCheckout(page);

  await expect(page.getByTestId('subtotal')).toHaveText(rubles(3000));
  await expect(page.getByTestId('shipping')).toHaveText('бесплатно');
  await expect(page.getByTestId('total')).toHaveText(rubles(3000));
});

test('ORD-03 Скидка и платная доставка сохраняются в оформленном заказе', async ({ page }) => {
  await openCatalog(page);
  await addFromCatalog(page, products.giftSet.name, 1);
  await showCart(page);
  await openCheckout(page);
  await expect(page.getByTestId('shipping')).toHaveText('бесплатно');
  await expect(page.getByTestId('total')).toHaveText(rubles(3490));

  await showCart(page);
  await applyPromo(page, 'WELCOME500');
  await expect(page.getByTestId('total')).toHaveText(rubles(2990));
  await openCheckout(page);
  await expect(page.getByTestId('discount')).toHaveText(`−${rubles(500)}`);
  await expect(page.getByTestId('shipping')).toHaveText(rubles(300));
  await expect(page.getByTestId('total')).toHaveText(rubles(3290));

  await fillGuestContact(page);
  await page.getByLabel('Адрес доставки').fill(guest.address);
  await page.getByRole('button', { name: 'Подтвердить заказ' }).click();
  await expect(page.getByTestId('order-success')).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveText('0');

  await page.reload();
  await expect(page.getByTestId('order-success')).toBeVisible();
  await expect(page.getByRole('cell', { name: products.giftSet.name, exact: true })).toBeVisible();
  await expect(page.getByTestId('subtotal')).toHaveText(rubles(3490));
  await expect(page.getByText('Скидка (WELCOME500)', { exact: true })).toBeVisible();
  await expect(page.getByTestId('discount')).toHaveText(`−${rubles(500)}`);
  await expect(page.getByTestId('shipping')).toHaveText(rubles(300));
  await expect(page.getByTestId('total')).toHaveText(rubles(3290));

  const orderId = page.getByTestId('order-id');
  await expect(orderId).toHaveText(/^\d+$/);
  const savedOrder = await page.request.get(`/api/orders/${await orderId.innerText()}`);
  expect(savedOrder.status()).toBe(200);
  expect(await savedOrder.json()).toMatchObject({
    promo: 'WELCOME500', subtotal: 3490, discount: 500, shipping: 300, total: 3290,
  });
});

test('ORD-04 Самовывоз с оплатой наличными сохраняется в истории аккаунта', async ({ page, browser, baseURL }) => {
  const customer = newCustomer();
  const item = products.syrup;
  await openCatalog(page);
  await openRegistration(page);
  await submitRegistration(page, customer);
  await expectSignedIn(page, customer.name);
  await addFromCatalog(page, item.name, 1);
  await showCart(page);
  await openCheckout(page);

  await expect(page.getByLabel('Имя получателя')).toHaveValue(customer.name);
  await page.getByLabel('Телефон').fill(guest.phone);
  await page.getByRole('radio', { name: 'Самовывоз' }).check();
  await page.getByRole('radio', { name: 'Наличными' }).check();
  await expect(page.getByTestId('shipping')).toHaveText('бесплатно');
  await expect(page.getByTestId('total')).toHaveText(rubles(390));
  await page.getByRole('button', { name: 'Подтвердить заказ' }).click();
  const id = page.getByTestId('order-id');
  await expect(id).toHaveText(/^\d+$/);
  const orderNumber = `№${await id.innerText()}`;
  await expect(page.getByText(/Оплата:/)).toContainText('Самовывоз. Оплата: наличными.');
  await expect(page.getByTestId('cart-count')).toHaveText('0');

  const newContext = await browser.newContext({ baseURL });
  try {
    const returning = await newContext.newPage();
    await returning.goto('/#/login');
    await fillCredentials(returning, customer);
    await returning.getByRole('button', { name: 'Войти', exact: true }).click();
    await expectSignedIn(returning, customer.name);
    await returning.getByRole('link', { name: 'Мои заказы' }).click();
    const rows = returning.getByTestId('order-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.getByRole('cell', { name: rubles(390), exact: true })).toBeVisible();
    await rows.getByRole('link', { name: orderNumber }).click();
    await expect(returning.getByTestId('order-success')).toContainText(orderNumber);
    await expect(returning.getByRole('cell', { name: item.name, exact: true })).toBeVisible();
  } finally {
    await newContext.close();
  }
});

test('ORD-05 Изменение остатка блокирует заказ до исправления корзины', async ({ page, browser, baseURL }) => {
  const item = { name: 'Кофемолка ручная', price: 4200, stock: 5 };
  const remaining = item.stock - 1;

  await openCatalog(page);
  await openProduct(page, item.name);
  await expect(page.getByText(`В наличии: ${item.stock} шт.`)).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Количество' }).fill(String(item.stock));
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText(String(item.stock));
  await showCart(page);
  await openCheckout(page);
  await fillGuestContact(page);
  await page.getByRole('radio', { name: 'Самовывоз' }).check();

  const otherContext = await browser.newContext({ baseURL });
  try {
    await test.step('Покупатель из другой сессии забирает одну кофемолку', async () => {
      const otherPage = await otherContext.newPage();
      await openCatalog(otherPage);
      await addFromCatalog(otherPage, item.name, 1);
      await showCart(otherPage);
      await openCheckout(otherPage);
      await fillGuestContact(otherPage);
      await otherPage.getByRole('radio', { name: 'Самовывоз' }).check();
      await otherPage.getByRole('button', { name: 'Подтвердить заказ' }).click();
      await expect(otherPage.getByTestId('order-success')).toBeVisible();
    });

    const submit = page.getByRole('button', { name: 'Подтвердить заказ' });
    await submit.click();
    await expect(page.getByRole('alert')).toHaveText(`Товара «${item.name}» осталось ${remaining} шт.`);
    await expect(page).toHaveURL(/#\/checkout$/);
    await expect(page.getByTestId('cart-count')).toHaveText(String(item.stock));
    await expect(submit).toBeEnabled();
  } finally {
    await otherContext.close();
  }

  await showCart(page);
  const row = cartRow(page, item.name);
  await expect(row.getByRole('spinbutton', { name: 'Количество' })).toHaveValue(String(item.stock));
  await row.getByRole('button', { name: 'Уменьшить количество' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText(String(remaining));
  await expect(page.getByTestId('total')).toHaveText(rubles(item.price * remaining));
  await openCheckout(page);
  await fillGuestContact(page);
  await page.getByRole('radio', { name: 'Самовывоз' }).check();
  await page.getByRole('button', { name: 'Подтвердить заказ' }).click();
  await expect(page.getByTestId('order-success')).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveText('0');
  await expect(page.getByTestId('total')).toHaveText(rubles(item.price * remaining));

  await openCatalog(page);
  await openProduct(page, item.name);
  await expect(page.getByText('Нет в наличии')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить в корзину' })).toBeDisabled();
});
