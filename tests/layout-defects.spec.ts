import { expect, test } from '@playwright/test';
import {
  addFromCatalog, newCustomer, openCatalog, openCheckout, openRegistration, products, rubles, showCart, submitRegistration,
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

test('QA-19 · после отправки пустого заказа сообщение об ошибке видно на телефоне', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await openCatalog(page);
  await addFromCatalog(page, products.ethiopia.name, 1);
  await showCart(page);
  await openCheckout(page);

  const confirm = page.getByRole('button', { name: 'Подтвердить заказ' });
  await confirm.scrollIntoViewIfNeeded();
  await confirm.click();
  const summary = page.getByRole('alert');
  await expect(summary).toHaveText('Проверьте поля формы');
  await expect(page.getByText('Укажите имя получателя', { exact: true })).toBeVisible();
  await expect(confirm).toBeEnabled();

  const layout = await summary.evaluate(element => {
    const headerBottom = document.querySelector('header')!.getBoundingClientRect().bottom;
    const rect = element.getBoundingClientRect();
    const firstError = document.querySelector('.field-error')!.getBoundingClientRect();
    const feedbackVisible = [rect, firstError].some(box => box.top >= headerBottom && box.bottom <= window.innerHeight);
    return { feedbackVisible, firstErrorBottom: firstError.bottom, summaryBottom: rect.bottom, headerBottom };
  });
  if (!layout.feedbackVisible) {
    expect(Math.max(layout.firstErrorBottom, layout.summaryBottom)).toBeLessThan(layout.headerBottom);
  }

  test.fail(true, 'QA-19: сводка и первая ошибка остаются выше видимой области');
  expect(layout.feedbackVisible).toBe(true);
});

function relativeLuminance([red, green, blue]: number[]): number {
  const linear = [red, green, blue].map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastAgainst(color: string, background: string): number {
  const [red, green, blue, alpha = 1] = color.match(/[\d.]+/g)!.map(Number);
  const backdrop = background.match(/[\d.]+/g)!.map(Number);
  const composite = [red, green, blue].map((channel, index) =>
    channel * alpha + backdrop[index] * (1 - alpha));
  const surface = relativeLuminance(composite);
  const surrounding = relativeLuminance(backdrop);
  return (Math.max(surface, surrounding) + 0.05) / (Math.min(surface, surrounding) + 0.05);
}

test('QA-26 · пустое поле различимо до фокуса с контрастом не ниже 3:1', async ({ page }) => {
  await openCatalog(page);
  await openRegistration(page);
  const name = page.getByRole('textbox', { name: 'Имя', exact: true });
  await expect(name).toBeVisible();
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue('');
  await expect(name).not.toBeFocused();

  const colors = await name.evaluate(element => {
    const field = getComputedStyle(element);
    const form = getComputedStyle(element.closest('form')!);
    return {
      boundary: field.borderTopStyle === 'none' || field.borderTopWidth === '0px'
        ? field.backgroundColor
        : field.borderTopColor,
      fill: field.backgroundColor,
      surrounding: form.backgroundColor,
    };
  });
  const contrast = Math.max(
    contrastAgainst(colors.boundary, colors.surrounding),
    contrastAgainst(colors.fill, colors.surrounding),
  );

  test.fail(true, 'QA-26: у пустого поля белая заливка и малоконтрастная рамка на белом фоне');
  expect(contrast).toBeGreaterThanOrEqual(3);
});
