const fs = require('fs');
const path = require('path');

exports.up = async function (knex) {
  const sql = fs.readFileSync(path.join(__dirname, '002_indexes_and_optimistic_lock.sql'), 'utf8');
  await knex.raw(sql);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_inventory_movement_to;
    DROP INDEX IF EXISTS idx_inventory_movement_from;
    DROP INDEX IF EXISTS idx_inventory_movement_product_date;
    DROP INDEX IF EXISTS idx_inventory_stock_location;
    DROP INDEX IF EXISTS idx_supply_item_location;
    DROP INDEX IF EXISTS idx_supply_item_product;
    DROP INDEX IF EXISTS idx_supply_order_supplier;
    DROP INDEX IF EXISTS idx_supplier_deleted_at;
    ALTER TABLE supplier DROP COLUMN IF EXISTS deleted_at;
    ALTER TABLE supplier DROP COLUMN IF EXISTS version;
  `);
};