import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const products = {
  ethiopia: { name: 'Кофе Эфиопия Иргачефф, 250 г', price: 890 },
  brazil: { name: 'Кофе Бразилия Сантос, 1 кг', price: 2150 },
  decaf: { name: 'Кофе Колумбия без кофеина, 250 г', price: 990 },
  oolong: { name: 'Чай Те Гуань Инь, 100 г', price: 640 },
  assam: { name: 'Чай Ассам крупнолистовой, 200 г', price: 480 },
  matcha: { name: 'Матча церемониальная, 30 г', price: 1750 },
  filters: { name: 'Фильтры бумажные V60, 100 шт', price: 450 },
  frenchPress: { name: 'Френч-пресс 600 мл', price: 1590 },
  kettle: { name: 'Чайник с гусиным носиком, 900 мл', price: 5600, stock: 3 },
  syrup: { name: 'Сироп карамельный, 250 мл', price: 390 },
  chocolate: { name: 'Шоколад тёмный 72 %, 90 г', price: 320 },
  giftSet: { name: 'Подарочный набор «Утро»', price: 3490 },
  giftCard: { name: 'Подарочный сертификат на 2000 ₽', price: 2000 },
} as const;

export function rubles(amount: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(amount)} ₽`;
}

export function productCard(page: Page, name: string) {
  return page.getByTestId('product-card').filter({
    has: page.getByRole('link', { name, exact: true }),
  });
}

export function cartRow(page: Page, name: string) {
  return page.getByTestId('cart-row').filter({
    has: page.getByRole('link', { name, exact: true }),
  });
}

export async function openCatalog(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Каталог' })).toBeVisible();
  await expect(page.getByTestId('product-card').first()).toBeVisible();
}

export async function openProduct(page: Page, name: string) {
  await productCard(page, name).getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

export async function addFromCatalog(page: Page, name: string, expectedCount: number) {
  await productCard(page, name).getByRole('button', { name: 'В корзину', exact: true }).click();
  await expect(page.getByTestId('cart-count')).toHaveText(String(expectedCount));
}

export async function showCart(page: Page) {
  await page.getByTestId('cart-link').click();
  await expect(page.getByRole('heading', { name: 'Корзина', exact: true })).toBeVisible();
}

export async function applyPromo(page: Page, code: string) {
  await page.getByRole('textbox', { name: 'Промокод' }).fill(code);
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
}

export async function openCheckout(page: Page) {
  await page.getByRole('link', { name: 'Оформить заказ' }).click();
  await expect(page.getByRole('heading', { name: 'Оформление заказа' })).toBeVisible();
  await expect(page.getByTestId('shipping')).toBeVisible();
}

export function newCustomer() {
  return {
    name: 'QA Покупатель',
    email: `qa-${randomUUID()}@example.test`,
    password: 'QaShop-demo-71',
  };
}

type Customer = ReturnType<typeof newCustomer>;

export async function fillCredentials(page: Page, customer: Pick<Customer, 'email' | 'password'>) {
  const form = page.getByRole('main');
  await form.getByLabel(/^E-mail/).fill(customer.email);
  await form.getByLabel(/^Пароль/).fill(customer.password);
}

export async function openRegistration(page: Page) {
  await page.getByRole('banner').getByRole('link', { name: 'Войти' }).click();
  await page.getByRole('link', { name: 'Зарегистрироваться' }).click();
  await expect(page.getByRole('heading', { name: 'Регистрация' })).toBeVisible();
}

export async function submitRegistration(page: Page, customer: Customer) {
  await page.getByLabel(/^Имя/).fill(customer.name);
  await fillCredentials(page, customer);
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
}

export async function expectSignedIn(page: Page, name: string) {
  const header = page.getByRole('banner');
  await expect(header.getByText(name, { exact: true })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Мои заказы' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Выйти' })).toBeVisible();
}
