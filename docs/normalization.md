# Нормалізація схеми WMS (до 3НФ)

## 1. Початкова (ненормалізована) схема

Припустимо, що всі дані зберігалися в одній таблиці `supply_full`:

| order_number | supplier_name | supplier_email | product_sku | product_name | location_code | zone | qty | unit_price | batch_number |
|---|---|---|---|---|---|---|---|---|---|

## 2. Функціональні залежності

- `order_number -> supplier_name, supplier_email, supply_date, status`
- `supplier_email -> supplier_name, phone, address`
- `product_sku -> product_name, unit, min_stock_level`
- `location_code -> zone, shelf_number, max_capacity`
- `(order_number, product_sku) -> location_code, qty, unit_price, batch_number, expiry_date`

## 3. Перевірка нормальних форм

- **1НФ**: усунуто повторювані групи — кожна позиція накладної в окремому рядку.
- **2НФ**: неключові атрибути залежать від усього складеного ключа `(order_id, product_id)`, а не від його частини.
- **3НФ**: неключові атрибути залежать лише від PK; транзитивні залежності (постачальник, товар, комірка) винесено в окремі таблиці.

## 4. Фінальна схема (3НФ)

Таблиці: `supplier`, `product`, `warehouse_location`, `supply_order`, `supply_item`, `inventory_stock`, `inventory_movement`.

- `supplier` (PK: supplier_id) — дані постачальника.
- `product` (PK: product_id) — каталог товарів.
- `warehouse_location` (PK: location_id) — комірки складу.
- `supply_order` (PK: order_id, FK: supplier_id) — накладна.
- `supply_item` (PK: (order_id, product_id), FK: order_id, product_id, location_id) — позиції.
- `inventory_stock` (PK: (product_id, location_id)) — залишки.
- `inventory_movement` (PK: movement_id) — журнал рухів.

## 5. Денормалізація (свідома)

- `supply_order.total_cost` — денормалізований кеш суми позицій для швидкого читання (перераховується застосунком).
- `inventory_stock` — матеріалізований оперативний стан залишків.