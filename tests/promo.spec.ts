import { expect, test } from '@playwright/test';
import { addFromCatalog, applyPromo, cartRow, openCatalog, products, rubles, showCart } from './support/shop';

test('PROMO-01 SALE10 принимает регистр и пробелы, скидка пересчитывается и сбрасывается', async ({ page }) => {
  await openCatalog(page);
  await addFromCatalog(page, products.ethiopia.name, 1);
  await showCart(page);

  await applyPromo(page, '  sAle10  ');
  await expect(page.getByText('Скидка (SALE10)')).toBeVisible();
  await expect(page.getByTestId('subtotal')).toHaveText(rubles(890));
  await expect(page.getByTestId('discount')).toHaveText(`−${rubles(89)}`);
  await expect(page.getByTestId('total')).toHaveText(rubles(801));

  await page.getByRole('button', { name: 'Увеличить количество' }).click();
  await expect(page.getByTestId('subtotal')).toHaveText(rubles(1780));
  await expect(page.getByTestId('discount')).toHaveText(`−${rubles(178)}`);
  await expect(page.getByTestId('total')).toHaveText(rubles(1602));

  await applyPromo(page, '');
  await expect(page.getByRole('status')).toHaveText('Промокод сброшен');
  await expect(page.getByTestId('discount')).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText(rubles(1780));
});

test('PROMO-02 WELCOME500 недоступен при 1 990 ₽', async ({ page }) => {
  await openCatalog(page);
  await addFromCatalog(page, products.oolong.name, 1);
  await addFromCatalog(page, products.filters.name, 2);
  await addFromCatalog(page, products.filters.name, 3);
  await addFromCatalog(page, products.filters.name, 4);
  await showCart(page);
  await expect(page.getByTestId('subtotal')).toHaveText(rubles(1990));

  await applyPromo(page, 'WELCOME500');
  await expect(page.getByRole('status')).toHaveText('Промокод действует при заказе от 2000 ₽');
  await expect(page.getByTestId('discount')).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText(rubles(1990));
});

test('PROMO-03 WELCOME500 действует на пороге, неизвестный код не заменяет скидку', async ({ page }) => {
  await openCatalog(page);
  await addFromCatalog(page, products.giftCard.name, 1);
  await showCart(page);

  await applyPromo(page, 'WELCOME500');
  await expect(page.getByTestId('subtotal')).toHaveText(rubles(2000));
  await expect(page.getByTestId('discount')).toHaveText(`−${rubles(500)}`);
  await expect(page.getByTestId('total')).toHaveText(rubles(1500));

  await applyPromo(page, 'NOT-A-PROMO');
  await expect(page.getByRole('status')).toHaveText('Промокод не найден');
  await expect(page.getByRole('textbox', { name: 'Промокод' })).toHaveValue('WELCOME500');
  await expect(page.getByTestId('discount')).toHaveText(`−${rubles(500)}`);
  await expect(page.getByTestId('total')).toHaveText(rubles(1500));
});

test('PROMO-04 Скидка перестаёт действовать при снижении суммы ниже порога', async ({ page }) => {
  const { giftCard, ethiopia } = products;
  await openCatalog(page);
  await addFromCatalog(page, giftCard.name, 1);
  await addFromCatalog(page, ethiopia.name, 2);
  await showCart(page);
  await applyPromo(page, 'WELCOME500');
  await expect(page.getByTestId('total')).toHaveText(rubles(2390));

  await cartRow(page, giftCard.name).getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByTestId('cart-row')).toHaveCount(1);
  await expect(page.getByTestId('discount')).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText(rubles(890));
});

test('PROMO-05 Второй промокод заменяет первый, очистка корзины сбрасывает скидку', async ({ page }) => {
  const { giftCard } = products;
  await openCatalog(page);
  await addFromCatalog(page, giftCard.name, 1);
  await showCart(page);

  await applyPromo(page, 'SALE10');
  await expect(page.getByTestId('total')).toHaveText(rubles(1800));

  await applyPromo(page, 'WELCOME500');
  await expect(page.getByText('Скидка (WELCOME500)', { exact: true })).toBeVisible();
  await expect(page.getByTestId('discount')).toHaveText(`−${rubles(500)}`);
  await expect(page.getByTestId('total')).toHaveText(rubles(1500));

  await page.getByRole('button', { name: 'Очистить корзину' }).click();
  await expect(page.getByTestId('cart-empty')).toBeVisible();
  await page.getByRole('link', { name: 'Перейти в каталог' }).click();
  await addFromCatalog(page, giftCard.name, 1);
  await showCart(page);
  await expect(page.getByRole('textbox', { name: 'Промокод' })).toHaveValue('');
  await expect(page.getByTestId('discount')).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText(rubles(2000));
});
