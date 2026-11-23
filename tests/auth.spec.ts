import { expect, test } from '@playwright/test';
import {
  expectSignedIn, fillCredentials, newCustomer, openCatalog, openRegistration, submitRegistration,
} from './support/shop';

test('AUTH-01 Регистрация, выход и вход с нормализацией e-mail', async ({ page }) => {
  const customer = newCustomer();
  const header = page.getByRole('banner');
  await openCatalog(page);
  await openRegistration(page);
  await submitRegistration(page, customer);
  await expectSignedIn(page, customer.name);
  await expect(page.getByRole('heading', { name: 'Каталог' })).toBeVisible();

  await header.getByRole('link', { name: 'Мои заказы' }).click();
  await expect(page.getByText('У вас пока нет заказов.')).toBeVisible();
  await header.getByRole('button', { name: 'Выйти' }).click();
  await expect(header.getByRole('link', { name: 'Мои заказы' })).toBeHidden();
  await expect(header.getByText(customer.name, { exact: true })).toBeHidden();

  await header.getByRole('link', { name: 'Войти' }).click();
  await fillCredentials(page, { ...customer, email: customer.email.toUpperCase() });
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expectSignedIn(page, customer.name);

  await page.reload();
  await expectSignedIn(page, customer.name);
});

test('AUTH-02 Ошибки имени, e-mail и минимальной длины пароля показываются у полей', async ({ page }) => {
  await openCatalog(page);
  await openRegistration(page);
  await submitRegistration(page, { name: 'Q', email: 'broken-address', password: '12345' });

  await expect(page.getByRole('alert')).toHaveText('Проверьте поля формы');
  await expect(page.getByLabel(/^Имя/)).toHaveAccessibleName(/Укажите имя/);
  await expect(page.getByLabel(/^E-mail/)).toHaveAccessibleName(/Укажите корректный e-mail/);
  await expect(page.getByLabel(/^Пароль/)).toHaveAccessibleName(/Пароль должен быть не короче 6 символов/);
  await expect(page.getByRole('link', { name: 'Мои заказы' })).toBeHidden();

  const customer = { ...newCustomer(), name: 'QA', password: 'Qashop' };
  await submitRegistration(page, customer);
  await expectSignedIn(page, customer.name);
});

test('AUTH-03 Повторная регистрация того же нормализованного e-mail отклоняется', async ({ page }) => {
  const customer = newCustomer();
  await openCatalog(page);
  await openRegistration(page);
  await submitRegistration(page, customer);
  await expectSignedIn(page, customer.name);
  await page.getByRole('button', { name: 'Выйти' }).click();
  await openRegistration(page);

  await submitRegistration(page, { ...customer, email: customer.email.toUpperCase() });
  await expect(page.getByRole('alert')).toHaveText('Пользователь с таким e-mail уже зарегистрирован');
  await expect(page.getByLabel(/^E-mail/)).toHaveAccessibleName(/E-mail уже занят/);
  await expect(page.getByRole('link', { name: 'Мои заказы' })).toBeHidden();
});

test('AUTH-04 Неверный пароль отклоняется, повторный вход с верным паролем работает', async ({ page }) => {
  const customer = newCustomer();
  await openCatalog(page);
  await openRegistration(page);
  await submitRegistration(page, customer);
  await expectSignedIn(page, customer.name);
  await page.getByRole('button', { name: 'Выйти' }).click();
  await page.getByRole('banner').getByRole('link', { name: 'Войти' }).click();

  await fillCredentials(page, { ...customer, password: 'Wrong-demo-password' });
  const signIn = page.getByRole('button', { name: 'Войти', exact: true });
  await signIn.click();
  await expect(page.getByRole('alert')).toHaveText('Неверный e-mail или пароль');
  await expect(page.getByRole('link', { name: 'Мои заказы' })).toBeHidden();
  await expect(page).toHaveURL(/#\/login$/);

  await fillCredentials(page, customer);
  await signIn.click();
  await expectSignedIn(page, customer.name);
});

test('AUTH-05 Гость перенаправляется на вход при переходе к истории', async ({ page }) => {
  await page.goto('/#/orders');
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await expect(page.getByTestId('orders-table')).toHaveCount(0);
});
