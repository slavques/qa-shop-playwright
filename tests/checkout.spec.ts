import { expect, test } from '@playwright/test';
import {
  addFromCatalog, applyPromo, expectSignedIn, fillCredentials, newCustomer, openCatalog,
  openCheckout, openProduct, openRegistration, products, rubles, showCart, submitRegistration,
} from './support/shop';

const guest = { name: 'Тестовый Покупатель', phone: '+7 900 000-00-00', address: 'Тестовая улица, дом 10' };

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

test('ORD-03 Промокод снижает сумму ниже порога бесплатной доставки', async ({ page }) => {
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
