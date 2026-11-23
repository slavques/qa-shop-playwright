import { expect, test, type Page } from '@playwright/test';
import { expectSignedIn, newCustomer, openCatalog, openRegistration, submitRegistration } from './support/shop';

async function registerCustomer(page: Page) {
  const customer = newCustomer();
  await openCatalog(page);
  await openRegistration(page);
  await submitRegistration(page, customer);
  await expectSignedIn(page, customer.name);
  await expect(page.getByRole('heading', { name: 'Каталог', exact: true })).toBeVisible();
  return customer;
}

async function signOut(page: Page) {
  const header = page.getByRole('banner');
  await header.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(header.getByRole('link', { name: 'Войти', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Каталог', exact: true })).toBeVisible();
}

test('QA-11 · после выхода в другой вкладке приложение восстанавливает гостевое состояние', async ({ page, context }) => {
  const customer = await registerCustomer(page);
  const secondTab = await context.newPage();
  await openCatalog(secondTab);
  const header = secondTab.getByRole('banner');
  const userName = header.getByText(customer.name, { exact: true });
  const orders = header.getByRole('link', { name: 'Мои заказы', exact: true });
  await expectSignedIn(secondTab, customer.name);
  await expect(orders).toHaveAttribute('href', '#/orders');
  const ordersUrl = new URL('#/orders', secondTab.url()).href;

  await signOut(page);

  let ordersStatus: number | undefined;
  secondTab.on('response', response => {
    if (response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/orders') {
      ordersStatus = response.status();
    }
  });
  // Use the known navigation destination even if a future fix hides the link immediately.
  await secondTab.goto(ordersUrl);
  const login = secondTab.getByRole('heading', { name: 'Вход', exact: true });
  const failure = secondTab.getByRole('heading', { name: 'Что-то пошло не так', exact: true });
  await expect(login.or(failure)).toBeVisible();

  if (await failure.isVisible()) {
    expect(ordersStatus).toBe(401);
    await expect(secondTab.getByText('Войдите, чтобы посмотреть заказы', { exact: true })).toBeVisible();
    await expect(userName).toBeVisible();
    await expect(orders).toBeVisible();
  }

  test.fail(true, 'QA-11: отказ в истории оставляет интерфейс авторизованного пользователя');
  const guestView = await login.isVisible() && !(await userName.isVisible()) && !(await orders.isVisible());
  expect(guestView).toBe(true);
});

test('QA-12 · кнопка браузера «Назад» после выхода не зацикливает вход', async ({ page }) => {
  await registerCustomer(page);
  await page.getByRole('banner').getByRole('link', { name: 'Мои заказы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои заказы', exact: true })).toBeVisible();
  await expect(page.getByText('У вас пока нет заказов.')).toBeVisible();
  await signOut(page);

  const changes: string[] = [];
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) changes.push(new URL(frame.url()).hash);
  });
  const landings: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const previousLength = changes.length;
    await page.goBack();
    await expect.poll(() => changes.length).toBeGreaterThan(previousLength);
    await expect.poll(() => new URL(page.url()).hash).not.toBe('#/orders');
    const location = new URL(page.url()).hash;
    landings.push(location);
    if (location !== '#/login') break;
    await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  }

  const escapedLogin = landings.some(location => location !== '#/login');
  if (!escapedLogin) {
    expect(changes).toEqual(['#/orders', '#/login', '#/orders', '#/login', '#/orders', '#/login']);
  }

  test.fail(true, 'QA-12: каждый шаг назад снова добавляет страницу входа');
  expect(escapedLogin).toBe(true);
});
