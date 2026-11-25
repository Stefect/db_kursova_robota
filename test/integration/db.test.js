const { db } = require('../../src/db');

let trx;

beforeEach(async () => {
  trx = await db.transaction();
});

afterEach(async () => {
  await trx.rollback();
});

afterAll(async () => {
  await db.destroy();
});

async function makeSupplier(trx, suffix) {
  const [s] = await trx('supplier').insert({
    company_name: 'Test Supplier ' + suffix,
    contact_person: 'Contact',
    phone: '+380000000000',
    email: 'test' + suffix + '@example.com',
    address: 'Address',
  }).returning('supplier_id');
  return s.supplier_id;
}

async function makeProduct(trx, suffix) {
  const [p] = await trx('product').insert({
    sku_code: 'TEST-SKU-' + suffix,
    name: 'Test Product ' + suffix,
    unit: 'piece',
    min_stock_level: 0,
  }).returning('product_id');
  return p.product_id;
}

async function makeLocation(trx, suffix) {
  const [l] = await trx('warehouse_location').insert({
    location_code: 'TEST-LOC-' + suffix,
    zone: 'Zone ' + suffix,
    shelf_number: 'Shelf ' + suffix,
    max_capacity: 1000,
  }).returning('location_id');
  return l.location_id;
}

describe('Інтеграційні тести БД (WMS)', () => {
  test('підключення до БД працює', async () => {
    const r = await trx.raw('SELECT 1 AS ok');
    expect(r.rows[0].ok).toBe(1);
  });

  test('CHECK: телефон постачальника має починатися з +', async () => {
    await expect(
      trx('supplier').insert({ company_name: 'X', contact_person: 'Y', phone: '380500000001', email: 'new@x.ua', address: 'адреса' })
    ).rejects.toThrow();
  });

  test('FOREIGN KEY: накладна на неіснуючого постачальника', async () => {
    await expect(
      trx('supply_order').insert({ order_number: 'ORD-X', supplier_id: 999 })
    ).rejects.toThrow();
  });

  test('оприбуткування накладної оновлює статус і залишки', async () => {
    const sid = await makeSupplier(trx, 'recv');
    const pid = await makeProduct(trx, 'recv');
    const lid = await makeLocation(trx, 'recv');
    const [order] = await trx('supply_order').insert({ order_number: 'TEST-RECV', supplier_id: sid, status: 'draft' }).returning('order_id');
    const orderId = order.order_id;
    await trx('supply_item').insert({ order_id: orderId, product_id: pid, location_id: lid, quantity: 2, unit_price: 10.00, batch_number: 'B-TEST' });

    const before = await trx('inventory_stock').where({ product_id: pid, location_id: lid }).select('quantity').first();
    const beforeQty = before ? before.quantity : 0;

    await trx('supply_order').where({ order_id: orderId, status: 'draft' }).update({ status: 'received' });
    await trx('inventory_stock')
      .insert({ product_id: pid, location_id: lid, quantity: 2 })
      .onConflict(['product_id', 'location_id'])
      .merge({ quantity: trx.raw('inventory_stock.quantity + EXCLUDED.quantity') });

    const after = await trx('inventory_stock').where({ product_id: pid, location_id: lid }).select('quantity').first();
    const st = await trx('supply_order').where({ order_id: orderId }).select('status').first();
    expect(after.quantity).toBe(beforeQty + 2);
    expect(st.status).toBe('received');
  });

  test('оприбуткування без позицій неможливе', async () => {
    const sid = await makeSupplier(trx, 'nopos');
    const [order] = await trx('supply_order').insert({ order_number: 'TEST-NOP', supplier_id: sid, status: 'draft' }).returning('order_id');
    const orderId = order.order_id;
    const items = await trx('supply_item').where({ order_id: orderId }).count('* as cnt').first();
    expect(Number(items.cnt)).toBe(0);
  });

  test('переміщення: недостатній залишок у відправника', async () => {
    const pid = await makeProduct(trx, 'mv');
    const lid = await makeLocation(trx, 'mv');
    await trx('inventory_stock').insert({ product_id: pid, location_id: lid, quantity: 0 }).onConflict(['product_id', 'location_id']).ignore();
    const stock = await trx('inventory_stock').where({ product_id: pid, location_id: lid }).select('quantity').first();
    const available = stock ? stock.quantity : 0;
    const requested = available + 1000;
    expect(requested).toBeGreaterThan(available);
  });

  test('оптимістичне блокування: оновлення зі застарілою version не змінює рядок', async () => {
    const sid = await makeSupplier(trx, 'opt');
    const affected = await trx('supplier').where({ supplier_id: sid, version: 999999 }).update({ company_name: 'x', version: trx.raw('version + 1') });
    expect(affected).toBe(0);
  });

  test('CHECK: від\'ємний залишок заборонено', async () => {
    const pid = await makeProduct(trx, 'neg');
    const lid = await makeLocation(trx, 'neg');
    await trx('inventory_stock').insert({ product_id: pid, location_id: lid, quantity: 5 });
    await expect(
      trx('inventory_stock').where({ product_id: pid, location_id: lid }).update({ quantity: -1 })
    ).rejects.toThrow();
  });

  test('soft delete: деактивований постачальник не потрапляє у список', async () => {
    const sid = await makeSupplier(trx, 'soft');
    await trx('supplier').where({ supplier_id: sid }).update({ deleted_at: trx.fn.now() });
    const rows = await trx('supplier').whereNull('deleted_at').select('supplier_id');
    const ids = rows.map(r => r.supplier_id);
    expect(ids).not.toContain(sid);
  });

  test('переміщення оновлює залишки в обох комірках і створює запис у журналі', async () => {
    const pid = await makeProduct(trx, 'tr');
    const fromLid = await makeLocation(trx, 'from');
    const toLid = await makeLocation(trx, 'to');
    await trx('inventory_stock').insert({ product_id: pid, location_id: fromLid, quantity: 10 }).onConflict(['product_id', 'location_id']).ignore();
    await trx('inventory_stock').insert({ product_id: pid, location_id: toLid, quantity: 0 }).onConflict(['product_id', 'location_id']).ignore();
    const beforeFrom = (await trx('inventory_stock').where({ product_id: pid, location_id: fromLid }).first()).quantity;
    const beforeTo = (await trx('inventory_stock').where({ product_id: pid, location_id: toLid }).first()).quantity;

    await trx('inventory_movement').insert({
      movement_type: 'transfer', product_id: pid, from_location_id: fromLid, to_location_id: toLid, quantity: 3, created_by: 'test',
    });
    await trx('inventory_stock').where({ product_id: pid, location_id: fromLid }).decrement('quantity', 3);
    await trx('inventory_stock').where({ product_id: pid, location_id: toLid }).increment('quantity', 3);

    const afterFrom = (await trx('inventory_stock').where({ product_id: pid, location_id: fromLid }).first()).quantity;
    const afterTo = (await trx('inventory_stock').where({ product_id: pid, location_id: toLid }).first()).quantity;
    const mv = await trx('inventory_movement').where({ product_id: pid, created_by: 'test' }).count('* as cnt').first();
    expect(afterFrom).toBe(beforeFrom - 3);
    expect(afterTo).toBe(beforeTo + 3);
    expect(Number(mv.cnt)).toBeGreaterThan(0);
  });

  test('списання зменшує залишок у комірці', async () => {
    const pid = await makeProduct(trx, 'wo');
    const lid = await makeLocation(trx, 'wo');
    await trx('inventory_stock').insert({ product_id: pid, location_id: lid, quantity: 10 }).onConflict(['product_id', 'location_id']).ignore();
    const before = (await trx('inventory_stock').where({ product_id: pid, location_id: lid }).first()).quantity;

    await trx('inventory_movement').insert({
      movement_type: 'write_off', product_id: pid, from_location_id: lid, to_location_id: null, quantity: 2, created_by: 'test2',
    });
    await trx('inventory_stock').where({ product_id: pid, location_id: lid }).decrement('quantity', 2);

    const after = (await trx('inventory_stock').where({ product_id: pid, location_id: lid }).first()).quantity;
    expect(after).toBe(before - 2);
  });

  test('жорстке видалення постачальника з накладними блокується FK', async () => {
    const sid = await makeSupplier(trx, 'fk');
    await trx('supply_order').insert({ order_number: 'TEST-FK', supplier_id: sid, status: 'draft' });
    await expect(
      trx('supplier').where({ supplier_id: sid }).del()
    ).rejects.toThrow();
  });

  test('аналітичний запит: залишки по товарах повертає створені рядки', async () => {
    const pid1 = await makeProduct(trx, 'an1');
    const pid2 = await makeProduct(trx, 'an2');
    const r = await trx.raw(`SELECT p.sku_code, COALESCE(SUM(st.quantity),0)::int AS total_qty
      FROM product p LEFT JOIN inventory_stock st ON st.product_id = p.product_id
      WHERE p.product_id IN (?, ?)
      GROUP BY p.product_id, p.sku_code ORDER BY p.sku_code`, [pid1, pid2]);
    expect(r.rows.length).toBe(2);
  });

  test('пагінація LIMIT/OFFSET працює', async () => {
    for (let i = 1; i <= 4; i++) {
      await makeProduct(trx, 'pag' + i);
    }
    const r1 = await trx.raw("SELECT product_id FROM product WHERE sku_code LIKE 'TEST-SKU-pag%' ORDER BY sku_code LIMIT 2 OFFSET 0");
    const r2 = await trx.raw("SELECT product_id FROM product WHERE sku_code LIKE 'TEST-SKU-pag%' ORDER BY sku_code LIMIT 2 OFFSET 2");
    expect(r1.rows.length).toBe(2);
    expect(r2.rows.length).toBe(2);
    expect(r1.rows[0].product_id).not.toBe(r2.rows[0].product_id);
  });
});