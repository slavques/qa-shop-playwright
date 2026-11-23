import { request as apiRequest } from '@playwright/test';
import { expect, test } from './support/isolated-shop';
import { newCustomer, products } from './support/shop';

const apiCheckoutCustomer = {
  name: 'Тестовый Покупатель',
  phone: '+7 900 000-00-00',
  address: 'Тестовая улица, дом 10',
};

test('API-01 Категории, фильтр, порядок цен и контракт карточки товара', async ({ request }) => {
  const categories = await request.get('/api/categories');
  expect(categories.status()).toBe(200);
  expect(await categories.json()).toEqual([
    { id: 'coffee', name: 'Кофе' },
    { id: 'tea', name: 'Чай' },
    { id: 'gear', name: 'Аксессуары' },
    { id: 'sweets', name: 'Сладости' },
    { id: 'gifts', name: 'Подарки' },
  ]);

  const list = await request.get('/api/products', {
    params: { category: 'coffee', search: '  КОФЕ  ', sort: 'price_asc' },
  });
  expect(list.status()).toBe(200);
  const items = await list.json();
  expect(items).toMatchObject(
    [products.ethiopia, products.decaf, products.brazil].map(({ name, price }) => ({
      category: 'coffee', name, price,
    })),
  );

  const [details, missing] = await Promise.all([
    request.get(`/api/products/${items[0].id}`),
    request.get('/api/products/0'),
  ]);
  expect(details.status()).toBe(200);
  expect(await details.json()).toEqual(items[0]);
  expect(items[0]).toMatchObject({
    id: expect.any(Number),
    description: expect.any(String),
    stock: 25,
  });
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: 'Товар не найден' });
});

test('API-02 Ошибки количества и промокодов сохраняют корректную корзину', async ({ request }) => {
  const itemPath = '/api/cart/items/1';
  const add = await request.post('/api/cart/items', { data: { productId: 1, qty: 1 } });
  expect(add.status()).toBe(201);
  const discounted = await request.post('/api/cart/promo', { data: { code: ' sale10 ' } });
  expect(discounted.status()).toBe(200);
  const before = await discounted.json();
  expect(before).toMatchObject({
    items: [{ productId: 1, qty: 1, sum: 890 }],
    count: 1, subtotal: 890, promo: { code: 'SALE10' }, discount: 89, total: 801,
  });

  for (const { qty, status, error } of [
    { qty: -1, status: 400, error: 'Некорректное количество' },
    { qty: 1.5, status: 400, error: 'Некорректное количество' },
    { qty: 26, status: 409, error: 'В наличии только 25 шт.' },
  ]) {
    const rejected = await request.patch(itemPath, { data: { qty } });
    expect(rejected.status()).toBe(status);
    expect(await rejected.json()).toEqual({ error });
  }

  const [unknown, belowMinimum] = await Promise.all([
    request.post('/api/cart/promo', { data: { code: 'UNKNOWN' } }),
    request.post('/api/cart/promo', { data: { code: 'WELCOME500' } }),
  ]);
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({ error: 'Промокод не найден' });
  expect(belowMinimum.status()).toBe(409);
  expect(await belowMinimum.json()).toEqual({ error: 'Промокод действует при заказе от 2000 ₽' });
  const saved = await request.get('/api/cart');
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toEqual(before);

  const updated = await request.patch(itemPath, { data: { qty: 2 } });
  expect(updated.status()).toBe(200);
  expect(await updated.json()).toMatchObject({ count: 2, discount: 178, total: 1602 });
  const removed = await request.delete(itemPath);
  expect(removed.status()).toBe(200);
  expect(await removed.json()).toMatchObject({ items: [], count: 0, total: 0 });
  const cleared = await request.delete('/api/cart');
  expect(cleared.status()).toBe(200);
  expect(await cleared.json()).toMatchObject({ items: [], count: 0, discount: 0, promo: null });
});

test('API-03 Ошибки оформления сохраняют корзину и остаток, валидный заказ сохраняет расчёт', async ({ request }) => {
  const productId = 6;
  const quantity = 2;
  const checkout = { ...apiCheckoutCustomer, delivery: 'courier', payment: 'cash' };
  const emptyOrder = await request.post('/api/orders', { data: checkout });
  expect(emptyOrder.status()).toBe(400);
  expect(await emptyOrder.json()).toEqual({ error: 'Корзина пуста' });

  const initialProduct = await request.get(`/api/products/${productId}`);
  await expect(initialProduct).toBeOK();
  const product = await initialProduct.json();
  expect(product).toMatchObject({ id: productId, price: 1750, stock: 7 });

  const add = await request.post('/api/cart/items', { data: { productId, qty: quantity } });
  expect(add.status()).toBe(201);
  const promo = await request.post('/api/cart/promo', { data: { code: 'WELCOME500' } });
  await expect(promo).toBeOK();
  const cart = await promo.json();
  expect(cart).toMatchObject({ count: quantity, subtotal: 3500, discount: 500, total: 3000 });

  const invalidFields = await request.post('/api/orders', {
    data: { ...checkout, name: ' ', phone: '123456789', address: 'Дом' },
  });
  expect(invalidFields.status()).toBe(400);
  expect(await invalidFields.json()).toEqual({
    error: 'Проверьте поля формы',
    fields: {
      name: 'Укажите имя получателя',
      phone: 'Укажите телефон в формате +7 900 000-00-00',
      address: 'Укажите адрес доставки',
    },
  });

  const invalidOptions = await request.post('/api/orders', {
    data: { ...checkout, delivery: 'mail', payment: 'invoice' },
  });
  expect(invalidOptions.status()).toBe(400);
  expect(await invalidOptions.json()).toEqual({
    error: 'Проверьте поля формы',
    fields: { delivery: 'Выберите способ доставки', payment: 'Выберите способ оплаты' },
  });

  const [cartAfterRejection, productAfterRejection] = await Promise.all([
    request.get('/api/cart'),
    request.get(`/api/products/${productId}`),
  ]);
  await expect(cartAfterRejection).toBeOK();
  await expect(productAfterRejection).toBeOK();
  expect(await cartAfterRejection.json()).toEqual(cart);
  expect(await productAfterRejection.json()).toMatchObject({ stock: 7 });

  const courierQuote = await request.get('/api/delivery', { params: { method: 'courier' } });
  await expect(courierQuote).toBeOK();
  expect(await courierQuote.json()).toEqual({ method: 'courier', cost: 0, freeFrom: 3000 });

  const create = await request.post('/api/orders', { data: { ...checkout, comment: 'Позвонить перед доставкой' } });
  expect(create.status()).toBe(201);
  const order = await create.json();
  expect(order).toMatchObject({
    id: expect.any(Number), status: 'new', delivery: 'courier', payment: 'cash',
    subtotal: 3500, promo: 'WELCOME500', discount: 500, shipping: 0, total: 3000,
    items: [{ productId, qty: quantity, price: 1750, sum: 3500 }],
    customer: { ...apiCheckoutCustomer, comment: 'Позвонить перед доставкой' },
  });

  const [saved, cartAfterPurchase, productAfterPurchase] = await Promise.all([
    request.get(`/api/orders/${order.id}`),
    request.get('/api/cart'),
    request.get(`/api/products/${productId}`),
  ]);
  await expect(saved).toBeOK();
  await expect(cartAfterPurchase).toBeOK();
  await expect(productAfterPurchase).toBeOK();
  expect(await saved.json()).toEqual(order);
  expect(await cartAfterPurchase.json()).toMatchObject({ items: [], count: 0, promo: null, total: 0 });
  expect(await productAfterPurchase.json()).toMatchObject({ stock: 5 });
});

test('API-04 Регистрация, сессия, выход и повторный вход через API', async ({ request }) => {
  const customer = newCustomer();
  const auth = '/api/auth';
  const anonymous = await request.get(`${auth}/me`);
  expect(anonymous.status()).toBe(200);
  expect(await anonymous.json()).toEqual({ user: null });
  const privateHistory = await request.get('/api/orders');
  expect(privateHistory.status()).toBe(401);

  const invalid = await request.post(`${auth}/register`, { data: { name: 'Я', email: 'invalid', password: '12345' } });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toEqual({
    error: 'Проверьте поля формы',
    fields: {
      email: 'Укажите корректный e-mail',
      name: 'Укажите имя',
      password: 'Пароль должен быть не короче 6 символов',
    },
  });
  const registered = await request.post(`${auth}/register`, { data: customer });
  expect(registered.status()).toBe(201);
  const user = await registered.json();
  expect(user).toEqual({ id: expect.any(Number), name: customer.name, email: customer.email });
  const history = await request.get('/api/orders');
  expect(history.status()).toBe(200);
  expect(await history.json()).toEqual([]);
  const duplicate = await request.post(`${auth}/register`, { data: { ...customer, email: customer.email.toUpperCase() } });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toMatchObject({ fields: { email: 'E-mail уже занят' } });

  const logout = await request.post(`${auth}/logout`);
  expect(logout.status()).toBe(200);
  expect(await logout.json()).toEqual({ ok: true });
  const loggedOut = await request.get(`${auth}/me`);
  expect(loggedOut.status()).toBe(200);
  expect(await loggedOut.json()).toEqual({ user: null });
  const historyAfterLogout = await request.get('/api/orders');
  expect(historyAfterLogout.status()).toBe(401);

  const wrongPassword = await request.post(`${auth}/login`, { data: { email: customer.email, password: 'demo-incorrect' } });
  expect(wrongPassword.status()).toBe(401);
  expect(await wrongPassword.json()).toEqual({ error: 'Неверный e-mail или пароль' });
  const login = await request.post(`${auth}/login`, { data: { email: customer.email.toUpperCase(), password: customer.password } });
  expect(login.status()).toBe(200);
  expect(await login.json()).toEqual(user);
  const me = await request.get(`${auth}/me`);
  expect(me.status()).toBe(200);
  expect(await me.json()).toEqual({ user });
});

test('API-05 Два параллельных заказа при ограниченном остатке создают только одну покупку', async ({ request, baseURL }) => {
  const productId = 11;
  const quantity = 2;
  const secondBuyer = await apiRequest.newContext({ baseURL });

  try {
    const buyers = [request, secondBuyer];
    const initialProduct = await request.get(`/api/products/${productId}`);
    await expect(initialProduct).toBeOK();
    expect(await initialProduct.json()).toMatchObject({ stock: 3, price: 5600 });

    const carts = await Promise.all(buyers.map(buyer => buyer.post('/api/cart/items', {
      data: { productId, qty: quantity },
    })));
    for (const cart of carts) {
      expect(cart.status()).toBe(201);
      expect(await cart.json()).toMatchObject({ count: quantity, total: 11200 });
    }

    const checkout = { ...apiCheckoutCustomer, delivery: 'pickup', payment: 'cash' };
    const orders = await Promise.all(buyers.map(buyer => buyer.post('/api/orders', { data: checkout })));
    expect(orders.map(order => order.status()).sort((a, b) => a - b)).toEqual([201, 409]);
    const winnerIndex = orders.findIndex(order => order.status() === 201);
    const loserIndex = 1 - winnerIndex;
    expect(await orders[winnerIndex].json()).toMatchObject({
      delivery: 'pickup', payment: 'cash', shipping: 0, total: 11200,
      items: [{ productId, qty: quantity }],
    });
    expect(await orders[loserIndex].json()).toEqual({
      error: 'Товара «Чайник с гусиным носиком, 900 мл» осталось 1 шт.',
    });

    const [winnerCart, loserCart, product] = await Promise.all([
      buyers[winnerIndex].get('/api/cart'),
      buyers[loserIndex].get('/api/cart'),
      request.get(`/api/products/${productId}`),
    ]);
    await expect(winnerCart).toBeOK();
    await expect(loserCart).toBeOK();
    await expect(product).toBeOK();
    expect(await winnerCart.json()).toMatchObject({ count: 0, items: [] });
    expect(await loserCart.json()).toMatchObject({ count: quantity, items: [{ productId, qty: quantity, stock: 1 }] });
    expect(await product.json()).toMatchObject({ stock: 1 });
  } finally {
    await secondBuyer.dispose();
  }
});
