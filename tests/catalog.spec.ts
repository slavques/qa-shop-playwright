import { expect, test } from '@playwright/test';
import { openCatalog, openProduct, productCard, products, rubles } from './support/shop';

test('CAT-01 Поиск по названию и описанию, сброс пустого результата', async ({ page }) => {
  await openCatalog(page);
  const search = page.getByRole('searchbox', { name: 'Поиск' });
  const cards = page.getByTestId('product-card');
  await expect(cards).toHaveCount(16);

  await search.fill('  ИРГАЧЕФФ  ');
  await expect(cards.getByRole('link')).toHaveText([products.ethiopia.name]);

  await search.fill('несуществующее название');
  await expect(page.getByTestId('empty-list')).toHaveText('Ничего не найдено. Попробуйте изменить запрос.');
  await expect(cards).toHaveCount(0);

  await search.fill('бергамота');
  await expect(cards.getByRole('link')).toHaveText([products.ethiopia.name]);
  await expect(page.getByTestId('empty-list')).toHaveCount(0);

  await search.clear();
  await expect(cards).toHaveCount(16);
});

test('CAT-02 Категория совместима с поиском и всеми сортировками', async ({ page }) => {
  await openCatalog(page);
  const category = page.getByRole('combobox', { name: 'Категория' });
  const sorting = page.getByRole('combobox', { name: 'Сортировка' });
  const names = page.getByTestId('product-card').getByRole('link');
  const { assam, matcha, oolong } = products;

  await category.selectOption({ label: 'Чай' });
  await expect(names).toHaveText([oolong.name, assam.name, matcha.name]);

  await sorting.selectOption({ label: 'Сначала дешёвые' });
  await expect(names).toHaveText([assam.name, oolong.name, matcha.name]);

  await sorting.selectOption({ label: 'Сначала дорогие' });
  await expect(names).toHaveText([matcha.name, oolong.name, assam.name]);

  await sorting.selectOption({ label: 'По названию' });
  await expect(names).toHaveText([matcha.name, assam.name, oolong.name]);

  await page.getByRole('searchbox', { name: 'Поиск' }).fill('цветочным');
  await expect(names).toHaveText([oolong.name]);
  await category.selectOption({ label: 'Кофе' });
  await expect(page.getByTestId('empty-list')).toBeVisible();
});

test('CAT-03 Карточку товара без остатка можно открыть, покупка недоступна', async ({ page }) => {
  await openCatalog(page);
  const { decaf } = products;
  const card = productCard(page, decaf.name);
  await expect(card.getByText('Нет в наличии')).toBeVisible();
  await expect(card.getByRole('button', { name: 'В корзину' })).toBeDisabled();

  await openProduct(page, decaf.name);
  const product = page.getByTestId('product-page');
  await expect(product.getByText(/Swiss Water/)).toBeVisible();
  await expect(product.getByTestId('product-price')).toHaveText(rubles(decaf.price));
  await expect(product.getByText('Нет в наличии')).toBeVisible();
  await expect(product.getByRole('button', { name: 'Добавить в корзину' })).toBeDisabled();
  await expect(page.getByTestId('cart-count')).toHaveText('0');
});

test('CAT-04 Несуществующая карточка предлагает вернуться в каталог', async ({ page }) => {
  await page.goto('/#/product/999999');
  await expect(page.getByRole('heading', { name: 'Товар не найден' })).toBeVisible();
  await page.getByRole('link', { name: 'Вернуться в каталог' }).click();
  await expect(page.getByTestId('product-card')).toHaveCount(16);
});
