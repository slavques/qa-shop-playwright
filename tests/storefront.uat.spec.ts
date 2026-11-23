import {
  applyPromo, fillCredentials, newCustomer, openCatalog, openCheckout, openProduct,
  openRegistration, products, rubles, showCart, submitRegistration,
} from './support/shop';
import { expect, test } from './support/isolated-shop';

test('UAT-01 Каталог, корзина и оформление с ошибкой и исправлением', async ({ page }, testInfo) => {
  await openCatalog(page);
  await showCart(page);
  await expect(page.getByTestId('cart-empty')).toBeVisible();
  await page.getByRole('link', { name: 'Перейти в каталог' }).click();

  await page.getByRole('combobox', { name: 'Категория' }).selectOption({ label: 'Кофе' });
  const search = page.getByRole('searchbox', { name: 'Поиск' });
  await search.fill('несуществующий товар');
  await expect(page.getByTestId('empty-list')).toBeVisible();
  await search.fill('иргачефф');
  await openProduct(page, products.ethiopia.name);
  await page.getByRole('button', { name: 'Увеличить количество' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Количество' })).toHaveValue('2');
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText('2');

  await showCart(page);
  await expect(page.getByTestId('total')).toHaveText(rubles(1780));
  await applyPromo(page, 'WELCOME500');
  await expect(page.getByRole('status')).toHaveText('Промокод действует при заказе от 2000 ₽');
  await applyPromo(page, 'SALE10');
  await expect(page.getByTestId('total')).toHaveText(rubles(1602));

  await openCheckout(page);
  await expect(page.getByRole('radio', { name: 'Курьером' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Картой при получении' })).toBeChecked();
  await expect(page.getByTestId('total')).toHaveText(rubles(1902));
  const confirm = page.getByRole('button', { name: 'Подтвердить заказ' });
  await confirm.click();
  await expect(page.getByRole('alert')).toHaveText('Проверьте поля формы');
  await expect(page.getByText('Укажите имя получателя', { exact: true })).toBeVisible();
  await expect(page.getByText('Укажите телефон в формате +7 900 000-00-00', { exact: true })).toBeVisible();
  await expect(page.getByText('Укажите адрес доставки', { exact: true })).toBeVisible();
  await testInfo.attach('checkout-errors', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await page.getByLabel(/^Имя получателя/).fill('Тестовый Покупатель');
  await page.getByLabel(/^Адрес доставки/).fill('Тестовая улица, дом 10');
  const phone = page.getByLabel(/^Телефон/);
  await phone.fill('номер 900 000 00 00');
  const validation = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/orders');
  await confirm.click();
  expect((await validation).status()).toBe(400);
  await expect(page.getByText('Укажите телефон в формате +7 900 000-00-00', { exact: true })).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveText('2');
  await phone.fill('+7 900 000-00-00');
  await page.getByLabel('Комментарий к заказу').fill('Тестовый комментарий');
  await page.getByRole('radio', { name: 'Самовывоз' }).check();
  await page.getByRole('radio', { name: 'Наличными' }).check();
  await expect(page.getByTestId('shipping')).toHaveText('бесплатно');
  await confirm.click();
  await expect(page.getByTestId('order-success')).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveText('0');
  await expect(page.getByTestId('total')).toHaveText(rubles(1602));
  await expect(page.getByText(/Оплата:/)).toContainText('Самовывоз. Оплата: наличными.');

  const orderId = await page.getByTestId('order-id').innerText();
  const order = await page.request.get(`/api/orders/${orderId}`);
  expect(order.status()).toBe(200);
  expect(await order.json()).toMatchObject({
    delivery: 'pickup', payment: 'cash', promo: 'SALE10', total: 1602,
    customer: { address: '', comment: 'Тестовый комментарий' },
  });
  await page.reload();
  await expect(page.getByTestId('order-success')).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText(rubles(1602));
  await testInfo.attach('confirmed-order', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('UAT-02 Пустая регистрация, исправление, выход и повторный вход', async ({ page }, testInfo) => {
  const customer = { ...newCustomer(), name: 'Анна' };
  const header = page.getByRole('banner');
  await openCatalog(page);
  await openRegistration(page);
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Проверьте поля формы');
  const form = page.getByRole('main');
  await expect(form.getByText('Укажите имя', { exact: true })).toBeVisible();
  await expect(form.getByText('Укажите корректный e-mail', { exact: true })).toBeVisible();
  await expect(form.getByText('Пароль должен быть не короче 6 символов', { exact: true })).toBeVisible();
  await testInfo.attach('registration-errors', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await submitRegistration(page, customer);
  await expect(header.getByText(customer.name, { exact: true })).toBeVisible();
  await header.getByRole('button', { name: 'Выйти', exact: true }).click();
  await header.getByRole('link', { name: 'Войти', exact: true }).click();
  const signIn = page.getByRole('button', { name: 'Войти', exact: true });
  await fillCredentials(page, { ...customer, password: 'wrong-password' });
  await signIn.click();
  await expect(page.getByRole('alert')).toHaveText('Неверный e-mail или пароль');
  await fillCredentials(page, customer);
  await signIn.click();
  await expect(header.getByText(customer.name, { exact: true })).toBeVisible();
  await page.reload();
  await expect(header.getByText(customer.name, { exact: true })).toBeVisible();
});
