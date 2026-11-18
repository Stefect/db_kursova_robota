-- Міграція 001: початкова схема (labs 2-3)
-- Застосовується до порожньої бази. Створює типи та таблиці.

CREATE TYPE unit_type AS ENUM ('piece', 'kg', 'liter', 'box', 'pallet');
CREATE TYPE order_status AS ENUM ('draft', 'received', 'cancelled');
CREATE TYPE movement_kind AS ENUM ('transfer', 'write_off');

CREATE TABLE supplier (
    supplier_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_name   VARCHAR(100) NOT NULL,
    contact_person VARCHAR(100) NOT NULL,
    phone          VARCHAR(20)  NOT NULL CHECK (phone LIKE '+%'),
    email          VARCHAR(100) NOT NULL UNIQUE,
    address        VARCHAR(255) NOT NULL
);

CREATE TABLE product (
    product_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku_code        VARCHAR(50)  NOT NULL UNIQUE,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    unit            unit_type    NOT NULL DEFAULT 'piece',
    min_stock_level INTEGER      NOT NULL DEFAULT 0 CHECK (min_stock_level >= 0)
);

CREATE TABLE warehouse_location (
    location_id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    location_code VARCHAR(50) NOT NULL UNIQUE,
    zone          VARCHAR(50) NOT NULL,
    shelf_number  VARCHAR(50) NOT NULL,
    max_capacity  INTEGER     NOT NULL CHECK (max_capacity > 0),
    CONSTRAINT uk_zone_shelf UNIQUE (zone, shelf_number)
);

CREATE TABLE supply_order (
    order_id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_number VARCHAR(50)   NOT NULL UNIQUE,
    supplier_id  INTEGER       NOT NULL REFERENCES supplier (supplier_id),
    supply_date  TIMESTAMP     NOT NULL DEFAULT now(),
    total_cost   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
    status       order_status  NOT NULL DEFAULT 'draft'
);

CREATE TABLE supply_item (
    order_id     INTEGER       NOT NULL REFERENCES supply_order (order_id),
    product_id   INTEGER       NOT NULL REFERENCES product (product_id),
    location_id  INTEGER       NOT NULL REFERENCES warehouse_location (location_id),
    quantity     INTEGER       NOT NULL CHECK (quantity > 0),
    unit_price   NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    batch_number VARCHAR(50)   NOT NULL,
    expiry_date  DATE,
    PRIMARY KEY (order_id, product_id)
);

CREATE TABLE inventory_stock (
    product_id  INTEGER NOT NULL REFERENCES product (product_id),
    location_id INTEGER NOT NULL REFERENCES warehouse_location (location_id),
    quantity    INTEGER NOT NULL CHECK (quantity >= 0),
    PRIMARY KEY (product_id, location_id)
);

CREATE TABLE inventory_movement (
    movement_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    movement_type    movement_kind NOT NULL,
    product_id       INTEGER       NOT NULL REFERENCES product (product_id),
    from_location_id INTEGER       NOT NULL REFERENCES warehouse_location (location_id),
    to_location_id   INTEGER       REFERENCES warehouse_location (location_id),
    quantity         INTEGER       NOT NULL CHECK (quantity > 0),
    reason           VARCHAR(255),
    movement_date    TIMESTAMP     NOT NULL DEFAULT now(),
    created_by       VARCHAR(100)  NOT NULL,
    CONSTRAINT chk_different_locations CHECK (from_location_id <> to_location_id),
    CONSTRAINT chk_movement_target CHECK (
        (movement_type = 'transfer'  AND to_location_id IS NOT NULL)
        OR (movement_type = 'write_off' AND to_location_id IS NULL)
    )
);