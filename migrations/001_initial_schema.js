const fs = require('fs');
const path = require('path');

exports.up = async function (knex) {
  const sql = fs.readFileSync(path.join(__dirname, '001_initial_schema.sql'), 'utf8');
  await knex.raw(sql);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS inventory_movement;
    DROP TABLE IF EXISTS inventory_stock;
    DROP TABLE IF EXISTS supply_item;
    DROP TABLE IF EXISTS supply_order;
    DROP TABLE IF EXISTS warehouse_location;
    DROP TABLE IF EXISTS product;
    DROP TABLE IF EXISTS supplier;
    DROP TYPE IF EXISTS movement_kind;
    DROP TYPE IF EXISTS order_status;
    DROP TYPE IF EXISTS unit_type;
  `);
};