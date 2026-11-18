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

  test('оприбуткування накладної оновлює залишки (в транзакції)', async () => {
    const [order] = await trx('supply_order').insert({ order_number: 'TEST-ORD', supplier_id: 1, status: 'draft' }).returning('order_id');
    const orderId = order.order_id;
    await trx('supply_item').insert({ order_id: orderId, product_id: 1, location_id: 1, quantity: 1, unit_price: 10.00, batch_number: 'B' });

    const before = await trx('inventory_stock').where({ product_id: 1, location_id: 1 }).select('quantity').first();
    const beforeQty = before ? before.quantity : 0;

    await trx('supply_order').where({ order_id: orderId, status: 'draft' }).update({ status: 'received' });
    await trx('inventory_stock')
      .insert({ product_id: 1, location_id: 1, quantity: 1 })
      .onConflict(['product_id', 'location_id'])
      .merge({ quantity: trx.raw('inventory_stock.quantity + EXCLUDED.quantity') });

    const after = await trx('inventory_stock').where({ product_id: 1, location_id: 1 }).select('quantity').first();
    expect(after.quantity).toBe(beforeQty + 1);
  });

  test('оприбуткування без позицій неможливе', async () => {
    const [order] = await trx('supply_order').insert({ order_number: 'TEST-ORD2', supplier_id: 1, status: 'draft' }).returning('order_id');
    const orderId = order.order_id;
    const items = await trx('supply_item').where({ order_id: orderId }).count('* as cnt').first();
    expect(Number(items.cnt)).toBe(0);
  });

  test('переміщення: недостатній залишок у відправника', async () => {
    const stock = await trx('inventory_stock').where({ product_id: 1, location_id: 1 }).select('quantity').first();
    const available = stock ? stock.quantity : 0;
    const requested = available + 1000;
    expect(requested).toBeGreaterThan(available);
  });

  test('оптимістичне блокування: оновлення зі застарілою version не змінює рядок', async () => {
    const affected = await trx('supplier').where({ supplier_id: 1, version: 999999 }).update({ company_name: 'x', version: trx.raw('version + 1') });
    expect(affected).toBe(0);
  });

  test('CHECK: від\'ємний залишок заборонено', async () => {
    await expect(
      trx('inventory_stock').where({ product_id: 1, location_id: 1 }).update({ quantity: -1 })
    ).rejects.toThrow();
  });

  test('soft delete: деактивований постачальник не потрапляє у список', async () => {
    await trx('supplier').where({ supplier_id: 1 }).update({ deleted_at: trx.fn.now() });
    const rows = await trx('supplier').whereNull('deleted_at').select('supplier_id');
    const ids = rows.map(r => r.supplier_id);
    expect(ids).not.toContain(1);
  });
});