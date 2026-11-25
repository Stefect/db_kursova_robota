-- Міграція 002: індекси та оптимістичне блокування

ALTER TABLE supplier ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_supply_order_supplier ON supply_order (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supply_item_product ON supply_item (product_id);
CREATE INDEX IF NOT EXISTS idx_supply_item_location ON supply_item (location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_location ON inventory_stock (location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movement_product_date ON inventory_movement (product_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_inventory_movement_from ON inventory_movement (from_location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movement_to ON inventory_movement (to_location_id);
CREATE INDEX IF NOT EXISTS idx_supplier_deleted_at ON supplier (deleted_at);