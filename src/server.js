require('dotenv').config();
const path = require('path');
const express = require('express');
const { db } = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Простий список сторінок: кожна таблиця читається через Knex (SQL builder)
const lists = {
  products: {
    title: 'Товари',
    editBase: '/products',
    fetch: () => db('product')
      .select('product_id', 'sku_code', 'name', 'unit', 'min_stock_level')
      .orderBy('sku_code'),
    columns: [
      { key: 'product_id', label: 'ID' },
      { key: 'sku_code', label: 'Артикул' },
      { key: 'name', label: 'Назва' },
      { key: 'unit', label: 'Од. виміру' },
      { key: 'min_stock_level', label: 'Мін. залишок' },
    ],
    action: { href: '/products/new', label: '+ Додати товар' },
  },
  suppliers: {
    title: 'Постачальники',
    editBase: '/suppliers',
    action: { href: '/suppliers/new', label: '+ Новий постачальник' },
    fetch: () => db('supplier')
      .select('supplier_id', 'company_name', 'contact_person', 'phone', 'email')
      .whereNull('deleted_at')
      .orderBy('company_name'),
    columns: [
      { key: 'supplier_id', label: 'ID' },
      { key: 'company_name', label: 'Компанія' },
      { key: 'contact_person', label: 'Контакт' },
      { key: 'phone', label: 'Телефон' },
      { key: 'email', label: 'Email' },
    ],
  },
  locations: {
    title: 'Комірки складу',
    editBase: '/locations',
    action: { href: '/locations/new', label: '+ Нова комірка' },
    fetch: () => db('warehouse_location')
      .select('location_id', 'location_code', 'zone', 'shelf_number', 'max_capacity')
      .orderBy('location_code'),
    columns: [
      { key: 'location_id', label: 'ID' },
      { key: 'location_code', label: 'Код' },
      { key: 'zone', label: 'Зона' },
      { key: 'shelf_number', label: 'Стелаж' },
      { key: 'max_capacity', label: 'Місткість' },
    ],
  },
  orders: {
    title: 'Накладні постачання',
    viewBase: '/orders',
    viewKey: 'order_id',
    fetch: () => db('supply_order as o')
      .join('supplier as s', 's.supplier_id', 'o.supplier_id')
      .select('o.order_id', 'o.order_number', 's.company_name as supplier', 'o.supply_date', 'o.total_cost', 'o.status')
      .orderBy('o.order_id'),
    columns: [
      { key: 'order_number', label: 'Номер' },
      { key: 'supplier', label: 'Постачальник' },
      { key: 'supply_date', label: 'Дата' },
      { key: 'total_cost', label: 'Сума' },
      { key: 'status', label: 'Статус' },
    ],
  },
  stock: {
    title: 'Залишки по комірках',
    fetch: () => db('inventory_stock as st')
      .join('product as p', 'p.product_id', 'st.product_id')
      .join('warehouse_location as l', 'l.location_id', 'st.location_id')
      .select('p.sku_code', 'p.name', 'l.location_code', 'st.quantity')
      .orderBy('p.sku_code', 'l.location_code'),
    columns: [
      { key: 'sku_code', label: 'Артикул' },
      { key: 'name', label: 'Товар' },
      { key: 'location_code', label: 'Комірка' },
      { key: 'quantity', label: 'Кількість' },
    ],
  },
  movements: {
    title: 'Журнал переміщень і списань',
    fetch: () => db('inventory_movement as m')
      .join('product as p', 'p.product_id', 'm.product_id')
      .join('warehouse_location as fl', 'fl.location_id', 'm.from_location_id')
      .leftJoin('warehouse_location as tl', 'tl.location_id', 'm.to_location_id')
      .select('m.movement_id', 'm.movement_type', 'p.sku_code', 'fl.location_code as from_loc', 'tl.location_code as to_loc', 'm.quantity', 'm.reason', 'm.movement_date', 'm.created_by')
      .orderBy('m.movement_date', 'm.movement_id'),
    columns: [
      { key: 'movement_id', label: 'ID' },
      { key: 'movement_type', label: 'Тип' },
      { key: 'sku_code', label: 'Артикул' },
      { key: 'from_loc', label: 'Звідки' },
      { key: 'to_loc', label: 'Куди' },
      { key: 'quantity', label: 'Кількість' },
      { key: 'reason', label: 'Причина' },
      { key: 'movement_date', label: 'Дата' },
      { key: 'created_by', label: 'Автор' },
    ],
  },
};

app.get('/', async (req, res, next) => {
  try {
    const [p, s, o, m] = await Promise.all([
      db('product').count('* as cnt').first(),
      db('inventory_stock').sum('quantity as total').first(),
      db('supply_order').count('* as cnt').first(),
      db('inventory_movement').count('* as cnt').first(),
    ]);
    res.render('index', {
      productsCnt: Number(p.cnt),
      stockTotal: Number(s.total || 0),
      ordersCnt: Number(o.cnt),
      movementsCnt: Number(m.cnt),
    });
  } catch (err) { next(err); }
});

app.get('/:name(products|suppliers|locations|orders|stock|movements)', async (req, res, next) => {
  try {
    const cfg = lists[req.params.name];
    const rows = await cfg.fetch();
    res.render('table', { action: cfg.action || null, ...cfg, rows });
  } catch (err) { next(err); }
});

// Форма додавання товару
app.get('/products/new', (req, res) => {
  res.render('product_form', { error: null, values: {} });
});

app.post('/products', async (req, res, next) => {
  const { sku_code, name, description, unit, min_stock_level } = req.body;
  try {
    await db('product').insert({
      sku_code: sku_code.trim(),
      name: name.trim(),
      description: description || null,
      unit,
      min_stock_level: Number(min_stock_level) || 0,
    });
    res.redirect('/products');
  } catch (err) {
    const messages = { '23505': 'Товар з таким артикулом уже існує', '23514': 'Мінімальний залишок не може бути від’ємним' };
    const error = messages[err.code];
    if (!error) return next(err);
    res.status(400).render('product_form', { error, values: req.body });
  }
});

// CRUD: постачальники
app.get('/suppliers/new', (req, res) => {
  res.render('supplier_form', { error: null, values: {} });
});

app.post('/suppliers', async (req, res, next) => {
  const { company_name, contact_person, phone, email, address } = req.body;
  try {
    await db('supplier').insert({
      company_name: company_name.trim(),
      contact_person: contact_person.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
    });
    res.redirect('/suppliers');
  } catch (err) {
    const messages = { '23505': 'Постачальник з таким email вже існує', '23514': 'Телефон має починатися з +' };
    const error = messages[err.code];
    if (!error) return next(err);
    res.status(400).render('supplier_form', { error, values: req.body });
  }
});

app.get('/suppliers/:id/edit', async (req, res, next) => {
  try {
    const row = await db('supplier').where({ supplier_id: req.params.id }).first();
    if (!row) return res.status(404).send('Не знайдено');
    res.render('supplier_form', { error: null, values: row });
  } catch (err) { next(err); }
});

app.post('/suppliers/:id', async (req, res, next) => {
  const { company_name, contact_person, phone, email, address, version } = req.body;
  try {
    const affected = await db('supplier')
      .where({ supplier_id: req.params.id, version: Number(version) || 1 })
      .update({
        company_name: company_name.trim(),
        contact_person: contact_person.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        version: db.raw('version + 1'),
      });
    if (affected === 0) {
      return res.status(409).send('Конфлікт оновлення: запис змінено іншим користувачем (оптимістичне блокування). <a href="/suppliers">Назад</a>');
    }
    res.redirect('/suppliers');
  } catch (err) {
    const messages = { '23505': 'Постачальник з таким email вже існує', '23514': 'Телефон має починатися з +' };
    const error = messages[err.code];
    if (!error) return next(err);
    res.status(400).render('supplier_form', { error, values: { ...req.body, supplier_id: req.params.id } });
  }
});

app.post('/suppliers/:id/delete', async (req, res, next) => {
  try {
    await db('supplier').where({ supplier_id: req.params.id }).del();
    res.redirect('/suppliers');
  } catch (err) {
    if (err.code === '23503') return res.status(400).send('Неможливо видалити: є пов\'язані накладні. <a href="/suppliers">Назад</a>');
    next(err);
  }
});

app.post('/suppliers/:id/soft-delete', async (req, res, next) => {
  try {
    await db('supplier').where({ supplier_id: req.params.id }).whereNull('deleted_at').update({ deleted_at: db.fn.now() });
    res.redirect('/suppliers');
  } catch (err) { next(err); }
});

// CRUD: комірки складу
app.get('/locations/new', (req, res) => {
  res.render('location_form', { error: null, values: {} });
});

app.post('/locations', async (req, res, next) => {
  const { location_code, zone, shelf_number, max_capacity } = req.body;
  try {
    await db('warehouse_location').insert({
      location_code: location_code.trim(),
      zone: zone.trim(),
      shelf_number: shelf_number.trim(),
      max_capacity: Number(max_capacity),
    });
    res.redirect('/locations');
  } catch (err) {
    const messages = { '23505': 'Комірка з таким кодом або (зона, стелаж) вже існує', '23514': 'Місткість має бути > 0' };
    const error = messages[err.code];
    if (!error) return next(err);
    res.status(400).render('location_form', { error, values: req.body });
  }
});

app.get('/locations/:id/edit', async (req, res, next) => {
  try {
    const row = await db('warehouse_location').where({ location_id: req.params.id }).first();
    if (!row) return res.status(404).send('Не знайдено');
    res.render('location_form', { error: null, values: row });
  } catch (err) { next(err); }
});

app.post('/locations/:id', async (req, res, next) => {
  const { location_code, zone, shelf_number, max_capacity } = req.body;
  try {
    await db('warehouse_location').where({ location_id: req.params.id }).update({
      location_code: location_code.trim(),
      zone: zone.trim(),
      shelf_number: shelf_number.trim(),
      max_capacity: Number(max_capacity),
    });
    res.redirect('/locations');
  } catch (err) {
    const messages = { '23505': 'Комірка з таким кодом або (зона, стелаж) вже існує', '23514': 'Місткість має бути > 0' };
    const error = messages[err.code];
    if (!error) return next(err);
    res.status(400).render('location_form', { error, values: { ...req.body, location_id: req.params.id } });
  }
});

app.post('/locations/:id/delete', async (req, res, next) => {
  try {
    await db('warehouse_location').where({ location_id: req.params.id }).del();
    res.redirect('/locations');
  } catch (err) {
    if (err.code === '23503') return res.status(400).send('Неможливо видалити: є пов\'язані залишки/рухи/позиції. <a href="/locations">Назад</a>');
    next(err);
  }
});

// Редагування / видалення товарів
app.post('/products/:id', async (req, res, next) => {
  const { sku_code, name, description, unit, min_stock_level } = req.body;
  try {
    await db('product').where({ product_id: req.params.id }).update({
      sku_code: sku_code.trim(),
      name: name.trim(),
      description: description || null,
      unit,
      min_stock_level: Number(min_stock_level) || 0,
    });
    res.redirect('/products');
  } catch (err) {
    const messages = { '23505': 'Товар з таким артикулом вже існує', '23514': 'Мінімальний залишок має бути >= 0' };
    const error = messages[err.code];
    if (!error) return next(err);
    res.status(400).render('product_form', { error, values: { ...req.body, product_id: req.params.id } });
  }
});

app.post('/products/:id/delete', async (req, res, next) => {
  try {
    await db('product').where({ product_id: req.params.id }).del();
    res.redirect('/products');
  } catch (err) {
    if (err.code === '23503') return res.status(400).send('Неможливо видалити: є пов\'язані позиції/залишки/рухи. <a href="/products">Назад</a>');
    next(err);
  }
});

app.get('/products/:id/edit', async (req, res, next) => {
  try {
    const row = await db('product').where({ product_id: req.params.id }).first();
    if (!row) return res.status(404).send('Не знайдено');
    res.render('product_form', { error: null, values: row });
  } catch (err) { next(err); }
});

// Накладні постачання
app.get('/orders/new', async (req, res, next) => {
  try {
    const suppliers = await db('supplier').select('supplier_id', 'company_name').whereNull('deleted_at').orderBy('company_name');
    res.render('order_form', { error: null, values: {}, suppliers });
  } catch (err) { next(err); }
});

app.post('/orders', async (req, res, next) => {
  const { order_number, supplier_id, supply_date, total_cost } = req.body;
  try {
    await db('supply_order').insert({
      order_number: order_number.trim(),
      supplier_id: Number(supplier_id),
      supply_date: supply_date ? new Date(supply_date) : new Date(),
      total_cost: Number(total_cost) || 0,
      status: 'draft',
    });
    res.redirect('/orders');
  } catch (err) {
    const suppliers = await db('supplier').select('supplier_id', 'company_name').whereNull('deleted_at').orderBy('company_name');
    const error = err.code === '23505' ? 'Накладна з таким номером вже існує' : err.message;
    res.status(400).render('order_form', { error, values: req.body, suppliers });
  }
});

app.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await db('supply_order as o')
      .join('supplier as s', 's.supplier_id', 'o.supplier_id')
      .select('o.order_id', 'o.order_number', 's.company_name as supplier', 'o.supply_date', 'o.total_cost', 'o.status')
      .where('o.order_id', req.params.id)
      .first();
    if (!order) return res.status(404).send('Не знайдено');
    const items = await db('supply_item as si')
      .join('product as p', 'p.product_id', 'si.product_id')
      .join('warehouse_location as l', 'l.location_id', 'si.location_id')
      .select('si.order_id', 'si.product_id', 'p.sku_code', 'p.name', 'l.location_code', 'si.quantity', 'si.unit_price', 'si.batch_number', 'si.expiry_date')
      .where('si.order_id', req.params.id)
      .orderBy('p.sku_code');
    res.render('order_detail', { order, items });
  } catch (err) { next(err); }
});

app.get('/orders/:id/items/new', async (req, res, next) => {
  try {
    const products = await db('product').select('product_id', 'sku_code', 'name').orderBy('sku_code');
    const locations = await db('warehouse_location').select('location_id', 'location_code').orderBy('location_code');
    res.render('order_item_form', { error: null, values: {}, order_id: req.params.id, products, locations });
  } catch (err) { next(err); }
});

app.post('/orders/:id/items', async (req, res, next) => {
  const { product_id, location_id, quantity, unit_price, batch_number, expiry_date } = req.body;
  try {
    await db('supply_item').insert({
      order_id: req.params.id,
      product_id: Number(product_id),
      location_id: Number(location_id),
      quantity: Number(quantity),
      unit_price: Number(unit_price),
      batch_number: batch_number.trim(),
      expiry_date: expiry_date || null,
    });
    await db('supply_order').where({ order_id: req.params.id }).update({
      total_cost: db('supply_item').where('order_id', req.params.id).sum(db.raw('quantity * unit_price')),
    });
    res.redirect('/orders/' + req.params.id);
  } catch (err) {
    const products = await db('product').select('product_id', 'sku_code', 'name').orderBy('sku_code');
    const locations = await db('warehouse_location').select('location_id', 'location_code').orderBy('location_code');
    const error = err.code === '23505' ? 'Цей товар вже є в накладній' : err.message;
    res.status(400).render('order_item_form', { error, values: req.body, order_id: req.params.id, products, locations });
  }
});

app.post('/orders/:id/receive', async (req, res, next) => {
  const trx = await db.transaction();
  try {
    const r = await trx('supply_order').where({ order_id: req.params.id, status: 'draft' }).update({ status: 'received' }).returning('order_id');
    if (!r || r.length === 0) {
      await trx.rollback();
      return res.status(400).send('Накладну не можна оприбуткувати (не чернетка). <a href="/orders">Назад</a>');
    }
    const items = await trx('supply_item').where({ order_id: req.params.id }).select('product_id', 'location_id', 'quantity');
    if (items.length === 0) {
      await trx.rollback();
      return res.status(400).send('Накладну без позицій не можна оприбуткувати. <a href="/orders">Назад</a>');
    }
    const planned = {};
    for (const it of items) {
      planned[it.location_id] = (planned[it.location_id] || 0) + it.quantity;
    }
    for (const [locId, addQty] of Object.entries(planned)) {
      const cap = await trx('warehouse_location as wl')
        .leftJoin('inventory_stock as st', 'st.location_id', 'wl.location_id')
        .where('wl.location_id', locId)
        .select('wl.max_capacity', trx.raw('COALESCE(SUM(st.quantity), 0)::int as used'))
        .first();
      if (cap) {
        if (cap.used + addQty > cap.max_capacity) {
          await trx.rollback();
          return res.status(400).send(`Перевищено місткість комірки (використано ${cap.used} з ${cap.max_capacity}). <a href="/orders">Назад</a>`);
        }
      }
    }
    for (const it of items) {
      await trx('inventory_stock')
        .insert({ product_id: it.product_id, location_id: it.location_id, quantity: it.quantity })
        .onConflict(['product_id', 'location_id'])
        .merge({ quantity: trx.raw('inventory_stock.quantity + EXCLUDED.quantity') });
    }
    await trx.commit();
    res.redirect('/orders/' + req.params.id);
  } catch (err) {
    await trx.rollback();
    next(err);
  }
});

app.post('/orders/:id/cancel', async (req, res, next) => {
  try {
    await db('supply_order').where({ order_id: req.params.id, status: 'draft' }).update({ status: 'cancelled' });
    res.redirect('/orders/' + req.params.id);
  } catch (err) { next(err); }
});

app.post('/orders/:id/items/:productId/delete', async (req, res, next) => {
  const trx = await db.transaction();
  try {
    const o = await trx('supply_order').where({ order_id: req.params.id }).select('status').first();
    if (!o) { await trx.rollback(); return res.status(404).send('Не знайдено. <a href="/orders">Назад</a>'); }
    if (o.status !== 'draft') { await trx.rollback(); return res.status(400).send('Видаляти позиції можна лише з чернетки. <a href="/orders">Назад</a>'); }
    await trx('supply_item').where({ order_id: req.params.id, product_id: req.params.productId }).del();
    await trx('supply_order').where({ order_id: req.params.id }).update({
      total_cost: trx('supply_item').where('order_id', req.params.id).sum(db.raw('quantity * unit_price')),
    });
    await trx.commit();
    res.redirect('/orders/' + req.params.id);
  } catch (err) {
    await trx.rollback();
    next(err);
  }
});

app.post('/orders/:id/delete', async (req, res, next) => {
  const trx = await db.transaction();
  try {
    const o = await trx('supply_order').where({ order_id: req.params.id }).select('status').first();
    if (!o) { await trx.rollback(); return res.status(404).send('Не знайдено. <a href="/orders">Назад</a>'); }
    if (o.status === 'received') { await trx.rollback(); return res.status(400).send('Неможливо видалити оприбутковану накладну (залишки вже змінено). <a href="/orders">Назад</a>'); }
    await trx('supply_item').where({ order_id: req.params.id }).del();
    await trx('supply_order').where({ order_id: req.params.id }).del();
    await trx.commit();
    res.redirect('/orders');
  } catch (err) {
    await trx.rollback();
    next(err);
  }
});

// Переміщення і списання
app.get('/movements/new', async (req, res, next) => {
  try {
    const products = await db('product').select('product_id', 'sku_code', 'name').orderBy('sku_code');
    const locations = await db('warehouse_location').select('location_id', 'location_code').orderBy('location_code');
    res.render('movement_form', { error: null, values: {}, products, locations });
  } catch (err) { next(err); }
});

app.post('/movements', async (req, res, next) => {
  const { movement_type, product_id, from_location_id, to_location_id, quantity, reason, created_by } = req.body;
  const pid = Number(product_id);
  const fromId = Number(from_location_id);
  const qty = Number(quantity);
  const toLoc = movement_type === 'transfer' ? Number(to_location_id) : null;
  const trx = await db.transaction();
  try {
    const stockRow = await trx('inventory_stock').where({ product_id: pid, location_id: fromId }).select('quantity').first();
    const available = stockRow ? stockRow.quantity : 0;
    if (available < qty) {
      await trx.rollback();
      const products = await db('product').select('product_id', 'sku_code', 'name').orderBy('sku_code');
      const locations = await db('warehouse_location').select('location_id', 'location_code').orderBy('location_code');
      return res.status(400).render('movement_form', { error: `Недостатньо залишку у відправника (доступно ${available})`, values: req.body, products, locations });
    }
    if (movement_type === 'transfer' && fromId === toLoc) {
      await trx.rollback();
      const products = await db('product').select('product_id', 'sku_code', 'name').orderBy('sku_code');
      const locations = await db('warehouse_location').select('location_id', 'location_code').orderBy('location_code');
      return res.status(400).render('movement_form', { error: 'Відправник і отримувач мають бути різними комірками', values: req.body, products, locations });
    }
    if (movement_type === 'transfer') {
      const cap = await trx('warehouse_location as wl')
        .where('wl.location_id', toLoc)
        .select('wl.max_capacity', trx.raw('COALESCE((SELECT SUM(quantity) FROM inventory_stock WHERE location_id = ?), 0)::int as used', [toLoc]))
        .first();
      if (cap) {
        if (cap.used + qty > cap.max_capacity) {
          await trx.rollback();
          const products = await db('product').select('product_id', 'sku_code', 'name').orderBy('sku_code');
          const locations = await db('warehouse_location').select('location_id', 'location_code').orderBy('location_code');
          return res.status(400).render('movement_form', { error: `Перевищено місткість комірки-отримувача (використано ${cap.used} з ${cap.max_capacity})`, values: req.body, products, locations });
        }
      }
    }
    await trx('inventory_movement').insert({
      movement_type,
      product_id: pid,
      from_location_id: fromId,
      to_location_id: toLoc,
      quantity: qty,
      reason: reason || null,
      created_by: (created_by || '').trim(),
    });
    if (movement_type === 'transfer') {
      await trx('inventory_stock').insert({ product_id: pid, location_id: fromId, quantity: 0 }).onConflict(['product_id', 'location_id']).ignore();
      await trx('inventory_stock').insert({ product_id: pid, location_id: toLoc, quantity: 0 }).onConflict(['product_id', 'location_id']).ignore();
      await trx('inventory_stock').where({ product_id: pid, location_id: fromId }).decrement('quantity', qty);
      await trx('inventory_stock').where({ product_id: pid, location_id: toLoc }).increment('quantity', qty);
    } else {
      await trx('inventory_stock').insert({ product_id: pid, location_id: fromId, quantity: 0 }).onConflict(['product_id', 'location_id']).ignore();
      await trx('inventory_stock').where({ product_id: pid, location_id: fromId }).decrement('quantity', qty);
    }
    await trx.commit();
    res.redirect('/movements');
  } catch (err) {
    await trx.rollback();
    const products = await db('product').select('product_id', 'sku_code', 'name').orderBy('sku_code');
    const locations = await db('warehouse_location').select('location_id', 'location_code').orderBy('location_code');
    const error = err.code === '23514' ? 'Перевірте обмеження (різні комірки, наявність отримувача для transfer)' : err.message;
    res.status(400).render('movement_form', { error, values: req.body, products, locations });
  }
});

// Звіти (OLAP) - використовуємо knex.raw для складних аналітичних запитів
app.get('/reports', async (req, res, next) => {
  try {
    const run = (sql) => db.raw(sql).then(r => ({ rows: r.rows }));
    const [
      totalProducts, totalStock, avgMinStock, capacityStats, ordersByStatus,
      stockByProduct, locationsByZone, movementsByTypeAuthor, avgPriceByProduct,
      locationsStockOver100, suppliersOver30000, productsInMultipleLocations,
      innerOrdersSuppliers, leftSuppliers, rightLocationsItems, fullProductsStockMovements, crossMissingPairs,
      shareByProduct, productsFromCancelled, productsNoMovements, productsBelowAvgStock, productsInMultipleWithAvg,
      receivedBySupplier, valueByLocation, movementsByFromLocation,
      denseRankByStock, lowStock,
    ] = await Promise.all([
      run(`SELECT COUNT(*)::int AS cnt FROM product`),
      run(`SELECT COALESCE(SUM(quantity),0)::int AS total FROM inventory_stock`),
      run(`SELECT ROUND(AVG(min_stock_level)::numeric,2) AS avg FROM product`),
      run(`SELECT MIN(max_capacity)::int AS mn, MAX(max_capacity)::int AS mx, ROUND(AVG(max_capacity)::numeric,2) AS avg FROM warehouse_location`),
      run(`SELECT status, COUNT(*)::int AS cnt, COALESCE(SUM(total_cost),0)::numeric AS total_cost FROM supply_order GROUP BY status ORDER BY status`),
      run(`SELECT p.sku_code, p.name, COALESCE(SUM(st.quantity),0)::int AS total_qty FROM product p LEFT JOIN inventory_stock st ON st.product_id = p.product_id GROUP BY p.product_id, p.sku_code, p.name ORDER BY total_qty DESC`),
      run(`SELECT zone, COUNT(*)::int AS locations_cnt, SUM(max_capacity)::int AS total_cap FROM warehouse_location GROUP BY zone ORDER BY zone`),
      run(`SELECT movement_type, created_by, COUNT(*)::int AS cnt, COALESCE(SUM(quantity),0)::int AS total_qty FROM inventory_movement GROUP BY movement_type, created_by ORDER BY movement_type, created_by`),
      run(`SELECT p.sku_code, p.name, COUNT(si.order_id)::int AS supplies_cnt, COALESCE(ROUND(AVG(si.unit_price)::numeric,2),0) AS avg_price, COALESCE(SUM(si.quantity*si.unit_price),0)::numeric AS total_value FROM product p LEFT JOIN supply_item si ON si.product_id = p.product_id LEFT JOIN supply_order o ON o.order_id = si.order_id AND o.status = 'received' GROUP BY p.product_id, p.sku_code, p.name ORDER BY p.sku_code`),
      run(`SELECT l.location_code, l.zone, COALESCE(SUM(st.quantity),0)::int AS total_qty FROM warehouse_location l LEFT JOIN inventory_stock st ON st.location_id = l.location_id GROUP BY l.location_id, l.location_code, l.zone HAVING COALESCE(SUM(st.quantity),0) > 100 ORDER BY total_qty DESC`),
      run(`SELECT s.company_name, COUNT(o.order_id)::int AS orders_cnt, COALESCE(SUM(o.total_cost),0)::numeric AS total_cost FROM supplier s LEFT JOIN supply_order o ON o.supplier_id = s.supplier_id GROUP BY s.supplier_id, s.company_name HAVING COALESCE(SUM(o.total_cost),0) > 30000 ORDER BY total_cost DESC`),
      run(`SELECT p.sku_code, p.name, COUNT(st.location_id)::int AS locs_cnt FROM product p JOIN inventory_stock st ON st.product_id = p.product_id GROUP BY p.product_id, p.sku_code, p.name HAVING COUNT(st.location_id) > 1 ORDER BY locs_cnt DESC, p.sku_code`),
      run(`SELECT o.order_number, s.company_name, o.total_cost, o.status FROM supply_order o INNER JOIN supplier s ON s.supplier_id = o.supplier_id ORDER BY o.order_id`),
      run(`SELECT s.company_name, COUNT(o.order_id)::int AS orders_cnt FROM supplier s LEFT JOIN supply_order o ON o.supplier_id = s.supplier_id GROUP BY s.supplier_id, s.company_name ORDER BY s.company_name`),
      run(`SELECT l.location_code, si.order_id, si.quantity FROM warehouse_location l RIGHT JOIN supply_item si ON si.location_id = l.location_id ORDER BY l.location_code NULLS LAST, si.order_id`),
      run(`SELECT p.sku_code, COALESCE(s.total_qty,0)::int AS stock_qty, COALESCE(m.moves_cnt,0)::int AS moves_cnt FROM product p LEFT JOIN (SELECT product_id, SUM(quantity) AS total_qty FROM inventory_stock GROUP BY product_id) s ON s.product_id = p.product_id LEFT JOIN (SELECT product_id, COUNT(*) AS moves_cnt FROM inventory_movement GROUP BY product_id) m ON m.product_id = p.product_id ORDER BY p.sku_code`),
      run(`SELECT p.sku_code, l.location_code FROM product p CROSS JOIN warehouse_location l WHERE NOT EXISTS (SELECT 1 FROM inventory_stock st WHERE st.product_id = p.product_id AND st.location_id = l.location_id) ORDER BY p.sku_code, l.location_code`),
      run(`SELECT p.sku_code, p.name, COALESCE(SUM(st.quantity),0)::int AS total_qty, ROUND(100.0 * COALESCE(SUM(st.quantity),0) / NULLIF((SELECT COALESCE(SUM(quantity),0) FROM inventory_stock),0), 2) AS share_pct FROM product p LEFT JOIN inventory_stock st ON st.product_id = p.product_id GROUP BY p.product_id, p.sku_code, p.name ORDER BY share_pct DESC NULLS LAST`),
      run(`SELECT DISTINCT p.sku_code, p.name FROM product p WHERE p.product_id IN (SELECT si.product_id FROM supply_item si JOIN supply_order o ON o.order_id = si.order_id WHERE o.status = 'cancelled') ORDER BY p.sku_code`),
      run(`SELECT p.sku_code, p.name FROM product p WHERE NOT EXISTS (SELECT 1 FROM inventory_movement m WHERE m.product_id = p.product_id) ORDER BY p.sku_code`),
      run(`SELECT p.sku_code, p.name, COALESCE(SUM(st.quantity),0)::int AS total_qty FROM product p LEFT JOIN inventory_stock st ON st.product_id = p.product_id GROUP BY p.product_id, p.sku_code, p.name HAVING COALESCE(SUM(st.quantity),0) < (SELECT AVG(t) FROM (SELECT COALESCE(SUM(quantity),0) AS t FROM inventory_stock GROUP BY product_id) x) ORDER BY total_qty`),
      run(`SELECT sku_code, name, locs_cnt, avg_qty FROM (SELECT p.sku_code, p.name, COUNT(st.location_id)::int AS locs_cnt, ROUND(AVG(st.quantity)::numeric,2) AS avg_qty FROM product p JOIN inventory_stock st ON st.product_id = p.product_id GROUP BY p.product_id, p.sku_code, p.name) x WHERE locs_cnt > 1 ORDER BY locs_cnt DESC, sku_code`),
      run(`SELECT s.company_name, COUNT(DISTINCT o.order_id)::int AS orders_cnt, COALESCE(SUM(si.quantity*si.unit_price),0)::numeric AS total_value FROM supplier s JOIN supply_order o ON o.supplier_id = s.supplier_id AND o.status = 'received' JOIN supply_item si ON si.order_id = o.order_id GROUP BY s.supplier_id, s.company_name ORDER BY total_value DESC`),
      run(`SELECT l.location_code, l.zone, COALESCE(SUM(si.quantity*si.unit_price),0)::numeric AS total_value FROM warehouse_location l JOIN supply_item si ON si.location_id = l.location_id JOIN supply_order o ON o.order_id = si.order_id AND o.status = 'received' GROUP BY l.location_id, l.location_code, l.zone ORDER BY total_value DESC`),
      run(`SELECT fl.location_code, m.movement_type, COUNT(*)::int AS cnt, COALESCE(SUM(m.quantity),0)::int AS total_qty FROM inventory_movement m JOIN warehouse_location fl ON fl.location_id = m.from_location_id GROUP BY fl.location_id, fl.location_code, m.movement_type ORDER BY fl.location_code, m.movement_type`),
      run(`SELECT p.sku_code, p.name, COALESCE(SUM(st.quantity),0)::int AS total_qty, DENSE_RANK() OVER (ORDER BY COALESCE(SUM(st.quantity),0) DESC)::int AS rnk FROM product p LEFT JOIN inventory_stock st ON st.product_id = p.product_id GROUP BY p.product_id, p.sku_code, p.name ORDER BY rnk, p.sku_code`),
      run(`SELECT p.sku_code, p.name, p.min_stock_level, COALESCE(SUM(st.quantity),0)::int AS total_qty FROM product p LEFT JOIN inventory_stock st ON st.product_id = p.product_id GROUP BY p.product_id, p.sku_code, p.name, p.min_stock_level HAVING COALESCE(SUM(st.quantity),0) < p.min_stock_level ORDER BY total_qty`),
    ]);
    res.render('reports', {
      totalProducts: totalProducts.rows[0],
      totalStock: totalStock.rows[0],
      avgMinStock: avgMinStock.rows[0],
      capacityStats: capacityStats.rows[0],
      ordersByStatus: ordersByStatus.rows,
      stockByProduct: stockByProduct.rows,
      locationsByZone: locationsByZone.rows,
      movementsByTypeAuthor: movementsByTypeAuthor.rows,
      avgPriceByProduct: avgPriceByProduct.rows,
      locationsStockOver100: locationsStockOver100.rows,
      suppliersOver30000: suppliersOver30000.rows,
      productsInMultipleLocations: productsInMultipleLocations.rows,
      innerOrdersSuppliers: innerOrdersSuppliers.rows,
      leftSuppliers: leftSuppliers.rows,
      rightLocationsItems: rightLocationsItems.rows,
      fullProductsStockMovements: fullProductsStockMovements.rows,
      crossMissingPairs: crossMissingPairs.rows,
      shareByProduct: shareByProduct.rows,
      productsFromCancelled: productsFromCancelled.rows,
      productsNoMovements: productsNoMovements.rows,
      productsBelowAvgStock: productsBelowAvgStock.rows,
      productsInMultipleWithAvg: productsInMultipleWithAvg.rows,
      receivedBySupplier: receivedBySupplier.rows,
      valueByLocation: valueByLocation.rows,
      movementsByFromLocation: movementsByFromLocation.rows,
      denseRankByStock: denseRankByStock.rows,
      lowStock: lowStock.rows,
    });
  } catch (err) { next(err); }
});

// Обробка помилок
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(`<h1>Помилка</h1><pre>${err.message}</pre><a href="/">На головну</a>`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`WMS працює: http://localhost:${port}`);
});