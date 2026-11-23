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

test('QA-23 · при ошибке регистрации клавиатурный фокус переходит на первое неверное поле', async ({ page }) => {
  await openCatalog(page);
  await openRegistration(page);
  const name = page.getByLabel(/^Имя/);
  const email = page.getByLabel(/^E-mail/);
  const password = page.getByLabel(/^Пароль/);
  const submit = page.getByRole('button', { name: 'Зарегистрироваться', exact: true });

  await name.focus();
  await page.keyboard.press('Tab');
  await expect(email).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');

  const form = page.getByRole('main');
  await expect(page.getByRole('alert')).toHaveText('Проверьте поля формы');
  await expect(form.getByText('Укажите имя', { exact: true })).toBeVisible();
  await expect(form.getByText('Укажите корректный e-mail', { exact: true })).toBeVisible();
  await expect(form.getByText('Пароль должен быть не короче 6 символов', { exact: true })).toBeVisible();
  const nameFocused = await name.evaluate(element => element === document.activeElement);
  if (!nameFocused) await expect(submit).toBeFocused();

  test.fail(true, 'QA-23: после ошибок фокус остаётся на кнопке отправки');
  expect(nameFocused).toBe(true);
});

test('QA-24 · заголовки вкладок различают каталог, вход и регистрацию', async ({ page }) => {
  await openCatalog(page);
  const catalogTitle = await page.title();

  await page.getByRole('banner').getByRole('link', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  const loginTitle = await page.title();

  await page.getByRole('link', { name: 'Зарегистрироваться', exact: true }).click();
  await expect(page).toHaveURL(/#\/register$/);
  await expect(page.getByRole('heading', { name: 'Регистрация', exact: true })).toBeVisible();
  const registerTitle = await page.title();
  const titles = [catalogTitle, loginTitle, registerTitle];
  expect(titles.every(title => title.trim().length > 0)).toBe(true);
  const distinctTitles = new Set(titles).size;
  expect([1, titles.length]).toContain(distinctTitles);
  if (distinctTitles === titles.length) {
    expect(loginTitle).toMatch(/вход|войти|авторизаци/i);
    expect(registerTitle).toMatch(/регистраци|зарегистрир/i);
  }

  test.fail(true, 'QA-24: разные страницы остаются под одним заголовком вкладки');
  expect(distinctTitles).toBe(titles.length);
});
