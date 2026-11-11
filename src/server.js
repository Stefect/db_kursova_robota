require('dotenv').config();
const path = require('path');
const express = require('express');
const { pool, query } = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Простий список сторінок: кожна таблиця читається одним SELECT
const lists = {
  products: {
    title: 'Товари',
    editBase: '/products',
    sql: `SELECT product_id, sku_code, name, unit, min_stock_level
          FROM product ORDER BY sku_code`,
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
    sql: `SELECT supplier_id, company_name, contact_person, phone, email
          FROM supplier ORDER BY company_name`,
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
    sql: `SELECT location_id, location_code, zone, shelf_number, max_capacity
          FROM warehouse_location ORDER BY location_code`,
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
    sql: `SELECT o.order_id, o.order_number, s.company_name AS supplier,
                 o.supply_date, o.total_cost, o.status
          FROM supply_order o
          JOIN supplier s ON s.supplier_id = o.supplier_id
          ORDER BY o.order_id`,
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
    sql: `SELECT p.sku_code, p.name, l.location_code, st.quantity
          FROM inventory_stock st
          JOIN product p ON p.product_id = st.product_id
          JOIN warehouse_location l ON l.location_id = st.location_id
          ORDER BY p.sku_code, l.location_code`,
    columns: [
      { key: 'sku_code', label: 'Артикул' },
      { key: 'name', label: 'Товар' },
      { key: 'location_code', label: 'Комірка' },
      { key: 'quantity', label: 'Кількість' },
    ],
  },
  movements: {
    title: 'Журнал переміщень і списань',
    sql: `SELECT m.movement_id, m.movement_type, p.sku_code,
                 fl.location_code AS from_loc, tl.location_code AS to_loc,
                 m.quantity, m.reason, m.movement_date, m.created_by
          FROM inventory_movement m
          JOIN product p ON p.product_id = m.product_id
          JOIN warehouse_location fl ON fl.location_id = m.from_location_id
          LEFT JOIN warehouse_location tl ON tl.location_id = m.to_location_id
          ORDER BY m.movement_date, m.movement_id`,
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
      query('SELECT COUNT(*)::int AS cnt FROM product'),
      query('SELECT COALESCE(SUM(quantity),0)::int AS total FROM inventory_stock'),
      query('SELECT COUNT(*)::int AS cnt FROM supply_order'),
      query('SELECT COUNT(*)::int AS cnt FROM inventory_movement'),
    ]);
    res.render('index', {
      productsCnt: p.rows[0].cnt,
      stockTotal: s.rows[0].total,
      ordersCnt: o.rows[0].cnt,
      movementsCnt: m.rows[0].cnt,
    });
  } catch (err) { next(err); }
});

app.get('/:name(products|suppliers|locations|orders|stock|movements)', async (req, res, next) => {
  try {
    const cfg = lists[req.params.name];
    const result = await query(cfg.sql);
    res.render('table', { action: null, ...cfg, rows: result.rows });
  } catch (err) {
    next(err);
  }
});

// Форма додавання товару
app.get('/products/new', (req, res) => {
  res.render('product_form', { error: null, values: {} });
});

app.post('/products', async (req, res, next) => {
  const { sku_code, name, description, unit, min_stock_level } = req.body;
  try {
    await query(
      `INSERT INTO product (sku_code, name, description, unit, min_stock_level)
       VALUES ($1, $2, $3, $4, $5)`,
      [sku_code.trim(), name.trim(), description || null, unit, Number(min_stock_level) || 0]
    );
    res.redirect('/products');
  } catch (err) {
    // 23505 - порушено UNIQUE, 23514 - порушено CHECK
    const messages = {
      '23505': 'Товар з таким артикулом уже існує',
      '23514': 'Мінімальний залишок не може бути від’ємним',
    };
    const error = messages[err.code];
    if (!error) return next(err);
    res.status(400).render('product_form', { error, values: req.body });
  }
});

// ---------------------------------------------------------------------
// CRUD: постачальники
// ---------------------------------------------------------------------
app.get('/suppliers/new', (req, res) => {
  res.render('supplier_form', { error: null, values: {} });
});

// ---------------------------------------------------------------------
// CRUD: постачальники (продовження)
// ---------------------------------------------------------------------
app.post('/suppliers', async (req, res, next) => {
  const { company_name, contact_person, phone, email, address } = req.body;
  try {
    await query(
      `INSERT INTO supplier (company_name, contact_person, phone, email, address)
       VALUES ($1, $2, $3, $4, $5)`,
      [company_name.trim(), contact_person.trim(), phone.trim(), email.trim(), address.trim()]
    );
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
    const r = await query('SELECT * FROM supplier WHERE supplier_id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).send('Не знайдено');
    res.render('supplier_form', { error: null, values: r.rows[0] });
  } catch (err) { next(err); }
});

app.post('/suppliers/:id', async (req, res, next) => {
  const { company_name, contact_person, phone, email, address } = req.body;
  try {
    await query(
      `UPDATE supplier SET company_name=$1, contact_person=$2, phone=$3, email=$4, address=$5
       WHERE supplier_id=$6`,
      [company_name.trim(), contact_person.trim(), phone.trim(), email.trim(), address.trim(), req.params.id]
    );
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
    await query('DELETE FROM supplier WHERE supplier_id = $1', [req.params.id]);
    res.redirect('/suppliers');
  } catch (err) {
    if (err.code === '23503') return res.status(400).send('Неможливо видалити: є пов\'язані накладні. <a href="/suppliers">Назад</a>');
    next(err);
  }
});

// ---------------------------------------------------------------------
// CRUD: комірки складу (продовження)
// ---------------------------------------------------------------------
app.get('/locations/new', (req, res) => {
  res.render('location_form', { error: null, values: {} });
});

app.post('/locations', async (req, res, next) => {
  const { location_code, zone, shelf_number, max_capacity } = req.body;
  try {
    await query(
      `INSERT INTO warehouse_location (location_code, zone, shelf_number, max_capacity)
       VALUES ($1, $2, $3, $4)`,
      [location_code.trim(), zone.trim(), shelf_number.trim(), Number(max_capacity)]
    );
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
    const r = await query('SELECT * FROM warehouse_location WHERE location_id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).send('Не знайдено');
    res.render('location_form', { error: null, values: r.rows[0] });
  } catch (err) { next(err); }
});

app.post('/locations/:id', async (req, res, next) => {
  const { location_code, zone, shelf_number, max_capacity } = req.body;
  try {
    await query(
      `UPDATE warehouse_location SET location_code=$1, zone=$2, shelf_number=$3, max_capacity=$4
       WHERE location_id=$5`,
      [location_code.trim(), zone.trim(), shelf_number.trim(), Number(max_capacity), req.params.id]
    );
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
    await query('DELETE FROM warehouse_location WHERE location_id = $1', [req.params.id]);
    res.redirect('/locations');
  } catch (err) {
    if (err.code === '23503') return res.status(400).send('Неможливо видалити: є пов\'язані залишки/рухи/позиції. <a href="/locations">Назад</a>');
    next(err);
  }
});

// ---------------------------------------------------------------------
// Редагування / видалення товарів (продовження)
// ---------------------------------------------------------------------
app.post('/products/:id', async (req, res, next) => {
  const { sku_code, name, description, unit, min_stock_level } = req.body;
  try {
    await query(
      `UPDATE product SET sku_code=$1, name=$2, description=$3, unit=$4, min_stock_level=$5
       WHERE product_id=$6`,
      [sku_code.trim(), name.trim(), description || null, unit, Number(min_stock_level) || 0, req.params.id]
    );
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
    await query('DELETE FROM product WHERE product_id = $1', [req.params.id]);
    res.redirect('/products');
  } catch (err) {
    if (err.code === '23503') return res.status(400).send('Неможливо видалити: є пов\'язані позиції/залишки/рухи. <a href="/products">Назад</a>');
    next(err);
  }
});

app.get('/products/:id/edit', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM product WHERE product_id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).send('Не знайдено');
    res.render('product_form', { error: null, values: r.rows[0] });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Накладні постачання
// ---------------------------------------------------------------------
app.get('/orders/new', async (req, res, next) => {
  try {
    const sup = await query('SELECT supplier_id, company_name FROM supplier ORDER BY company_name');
    res.render('order_form', { error: null, values: {}, suppliers: sup.rows });
  } catch (err) { next(err); }
});

app.post('/orders', async (req, res, next) => {
  const { order_number, supplier_id, supply_date, total_cost } = req.body;
  try {
    await query(
      `INSERT INTO supply_order (order_number, supplier_id, supply_date, total_cost, status)
       VALUES ($1, $2, $3, $4, 'draft')`,
      [order_number.trim(), Number(supplier_id), supply_date ? new Date(supply_date) : new Date(), Number(total_cost) || 0]
    );
    res.redirect('/orders');
  } catch (err) {
    const sup = await query('SELECT supplier_id, company_name FROM supplier ORDER BY company_name');
    const error = err.code === '23505' ? 'Накладна з таким номером вже існує' : err.message;
    res.status(400).render('order_form', { error, values: req.body, suppliers: sup.rows });
  }
});

app.get('/orders/:id', async (req, res, next) => {
  try {
    const o = await query(
      `SELECT o.order_id, o.order_number, s.company_name AS supplier, o.supply_date, o.total_cost, o.status
       FROM supply_order o JOIN supplier s ON s.supplier_id = o.supplier_id
       WHERE o.order_id = $1`, [req.params.id]);
    if (o.rows.length === 0) return res.status(404).send('Не знайдено');
    const items = await query(
      `SELECT si.order_id, si.product_id, p.sku_code, p.name, l.location_code,
              si.quantity, si.unit_price, si.batch_number, si.expiry_date
       FROM supply_item si
       JOIN product p ON p.product_id = si.product_id
       JOIN warehouse_location l ON l.location_id = si.location_id
       WHERE si.order_id = $1 ORDER BY p.sku_code`, [req.params.id]);
    res.render('order_detail', { order: o.rows[0], items: items.rows });
  } catch (err) { next(err); }
});

app.get('/orders/:id/items/new', async (req, res, next) => {
  try {
    const prods = await query('SELECT product_id, sku_code, name FROM product ORDER BY sku_code');
    const locs = await query('SELECT location_id, location_code FROM warehouse_location ORDER BY location_code');
    res.render('order_item_form', { error: null, values: {}, order_id: req.params.id, products: prods.rows, locations: locs.rows });
  } catch (err) { next(err); }
});

app.post('/orders/:id/items', async (req, res, next) => {
  const { product_id, location_id, quantity, unit_price, batch_number, expiry_date } = req.body;
  try {
    await query(
      `INSERT INTO supply_item (order_id, product_id, location_id, quantity, unit_price, batch_number, expiry_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.params.id, Number(product_id), Number(location_id), Number(quantity), Number(unit_price), batch_number.trim(), expiry_date || null]
    );
    // перерахунок total_cost
    await query(
      `UPDATE supply_order SET total_cost = (SELECT COALESCE(SUM(quantity*unit_price),0) FROM supply_item WHERE order_id=$1)
       WHERE order_id=$1`, [req.params.id]);
    res.redirect('/orders/' + req.params.id);
  } catch (err) {
    const prods = await query('SELECT product_id, sku_code, name FROM product ORDER BY sku_code');
    const locs = await query('SELECT location_id, location_code FROM warehouse_location ORDER BY location_code');
    const error = err.code === '23505' ? 'Цей товар вже є в накладній' : err.message;
    res.status(400).render('order_item_form', { error, values: req.body, order_id: req.params.id, products: prods.rows, locations: locs.rows });
  }
});

app.post('/orders/:id/receive', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`UPDATE supply_order SET status='received' WHERE order_id=$1 AND status='draft' RETURNING order_id`, [req.params.id]);
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).send('Накладну не можна оприбуткувати (не чернетка). <a href="/orders">Назад</a>');
    }
    const items = await client.query('SELECT product_id, location_id, quantity FROM supply_item WHERE order_id=$1', [req.params.id]);
    if (items.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).send('Накладну без позицій не можна оприбуткувати. <a href="/orders">Назад</a>');
    }
    for (const it of items.rows) {
      // перевірка місткості комірки (застосунковий контроль, як у ADR 0002)
      const cap = await client.query(
        `SELECT wl.max_capacity,
                COALESCE((SELECT SUM(quantity) FROM inventory_stock WHERE location_id = $1),0)::int AS used
         FROM warehouse_location wl WHERE wl.location_id = $1`, [it.location_id]);
      if (cap.rows.length) {
        const { max_capacity, used } = cap.rows[0];
        if (used + it.quantity > max_capacity) {
          await client.query('ROLLBACK');
          return res.status(400).send(`Перевищено місткість комірки (використано ${used} з ${max_capacity}). <a href="/orders">Назад</a>`);
        }
      }
      await client.query(
        `INSERT INTO inventory_stock (product_id, location_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = inventory_stock.quantity + EXCLUDED.quantity`,
        [it.product_id, it.location_id, it.quantity]
      );
    }
    await client.query('COMMIT');
    res.redirect('/orders/' + req.params.id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

app.post('/orders/:id/cancel', async (req, res, next) => {
  try {
    await query(`UPDATE supply_order SET status='cancelled' WHERE order_id=$1 AND status='draft'`, [req.params.id]);
    res.redirect('/orders/' + req.params.id);
  } catch (err) { next(err); }
});

app.post('/orders/:id/delete', async (req, res, next) => {
  try {
    await query('DELETE FROM supply_item WHERE order_id=$1', [req.params.id]);
    await query('DELETE FROM supply_order WHERE order_id=$1', [req.params.id]);
    res.redirect('/orders');
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Переміщення і списання
// ---------------------------------------------------------------------
app.get('/movements/new', async (req, res, next) => {
  try {
    const prods = await query('SELECT product_id, sku_code, name FROM product ORDER BY sku_code');
    const locs = await query('SELECT location_id, location_code FROM warehouse_location ORDER BY location_code');
    res.render('movement_form', { error: null, values: {}, products: prods.rows, locations: locs.rows });
  } catch (err) { next(err); }
});

app.post('/movements', async (req, res, next) => {
  const { movement_type, product_id, from_location_id, to_location_id, quantity, reason, created_by } = req.body;
  const pid = Number(product_id);
  const fromId = Number(from_location_id);
  const qty = Number(quantity);
  const toLoc = movement_type === 'transfer' ? Number(to_location_id) : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // перевірка наявності залишку у відправника
    const stockRow = await client.query(
      `SELECT quantity FROM inventory_stock WHERE product_id=$1 AND location_id=$2`, [pid, fromId]);
    const available = stockRow.rows.length ? stockRow.rows[0].quantity : 0;
    if (available < qty) {
      await client.query('ROLLBACK');
      const prods = await query('SELECT product_id, sku_code, name FROM product ORDER BY sku_code');
      const locs = await query('SELECT location_id, location_code FROM warehouse_location ORDER BY location_code');
      return res.status(400).render('movement_form', { error: `Недостатньо залишку у відправника (доступно ${available})`, values: req.body, products: prods.rows, locations: locs.rows });
    }
    if (movement_type === 'transfer') {
      // перевірка місткості отримувача
      const cap = await client.query(
        `SELECT wl.max_capacity, COALESCE((SELECT SUM(quantity) FROM inventory_stock WHERE location_id=$1),0)::int AS used
         FROM warehouse_location wl WHERE wl.location_id=$1`, [toLoc]);
      if (cap.rows.length) {
        const { max_capacity, used } = cap.rows[0];
        if (used + qty > max_capacity) {
          await client.query('ROLLBACK');
          const prods = await query('SELECT product_id, sku_code, name FROM product ORDER BY sku_code');
          const locs = await query('SELECT location_id, location_code FROM warehouse_location ORDER BY location_code');
          return res.status(400).render('movement_form', { error: `Перевищено місткість комірки-отримувача (використано ${used} з ${max_capacity})`, values: req.body, products: prods.rows, locations: locs.rows });
        }
      }
    }
    await client.query(
      `INSERT INTO inventory_movement (movement_type, product_id, from_location_id, to_location_id, quantity, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [movement_type, pid, fromId, toLoc, qty, reason || null, created_by.trim()]
    );
    if (movement_type === 'transfer') {
      await client.query(`INSERT INTO inventory_stock (product_id, location_id, quantity) VALUES ($1,$2,0) ON CONFLICT (product_id, location_id) DO NOTHING`, [pid, fromId]);
      await client.query(`INSERT INTO inventory_stock (product_id, location_id, quantity) VALUES ($1,$2,0) ON CONFLICT (product_id, location_id) DO NOTHING`, [pid, toLoc]);
      await client.query(`UPDATE inventory_stock SET quantity = quantity - $1 WHERE product_id=$2 AND location_id=$3`, [qty, pid, fromId]);
      await client.query(`UPDATE inventory_stock SET quantity = quantity + $1 WHERE product_id=$2 AND location_id=$3`, [qty, pid, toLoc]);
    } else {
      await client.query(`INSERT INTO inventory_stock (product_id, location_id, quantity) VALUES ($1,$2,0) ON CONFLICT (product_id, location_id) DO NOTHING`, [pid, fromId]);
      await client.query(`UPDATE inventory_stock SET quantity = quantity - $1 WHERE product_id=$2 AND location_id=$3`, [qty, pid, fromId]);
    }
    await client.query('COMMIT');
    res.redirect('/movements');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const prods = await query('SELECT product_id, sku_code, name FROM product ORDER BY sku_code');
    const locs = await query('SELECT location_id, location_code FROM warehouse_location ORDER BY location_code');
    const error = err.code === '23514' ? 'Перевірте обмеження (різні комірки, наявність отримувача для transfer)' : err.message;
    res.status(400).render('movement_form', { error, values: req.body, products: prods.rows, locations: locs.rows });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------
// Звіти (OLAP) - розширений набір аналітичних запитів (lab 4)
// ---------------------------------------------------------------------
app.get('/reports', async (req, res, next) => {
  try {
    const run = (sql) => query(sql);
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
