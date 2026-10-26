require('dotenv').config();
const path = require('path');
const express = require('express');
const { query } = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Простий список сторінок: кожна таблиця читається одним SELECT
const lists = {
  products: {
    title: 'Товари',
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

app.get('/', (req, res) => res.render('index'));

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

// Обробка помилок
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(`<h1>Помилка</h1><pre>${err.message}</pre><a href="/">На головну</a>`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`WMS працює: http://localhost:${port}`);
});
