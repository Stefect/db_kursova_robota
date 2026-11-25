# Документація складних аналітичних запитів (OLAP)

## Запит 1: Залишки по товарах

Бізнес-питання: Скільки одиниць кожного товару є на складі (з урахуванням усіх комірок)?

SQL-запит:
```sql
SELECT p.sku_code, p.name,
       COALESCE(SUM(st.quantity), 0)::int AS total_qty
FROM product p
LEFT JOIN inventory_stock st ON st.product_id = p.product_id
GROUP BY p.product_id, p.sku_code, p.name
ORDER BY total_qty DESC;
```

Пояснення:
- LEFT JOIN, щоб показати товари без залишків.
- Групування за товаром, сума кількостей по всіх комірках.
- COALESCE для нульових значень.

Приклад виводу:
| sku_code | name | total_qty |
|----------|------|-----------|
| SKU-UTP-5E | Кабель вита пара UTP Cat5e | 30 |
| SKU-RJ45-100 | Конектори RJ-45 | 100 |

---

## Запит 2: Товари нижче мінімального залишку

Бізнес-питання: Які товари мають залишок менший за встановлений мінімум?

SQL-запит:
```sql
SELECT p.sku_code, p.name, p.min_stock_level,
       COALESCE(SUM(st.quantity), 0)::int AS total_qty
FROM product p
LEFT JOIN inventory_stock st ON st.product_id = p.product_id
GROUP BY p.product_id, p.sku_code, p.name, p.min_stock_level
HAVING COALESCE(SUM(st.quantity), 0) < p.min_stock_level
ORDER BY total_qty;
```

Пояснення:
- HAVING фільтрує групи за умовою порівняння суми залишків з мінімумом.
- Використовується у звіті "Товари нижче мінімуму".

---

## Запит 3: Вартість постачань за постачальниками (лише отримані)

Бізнес-питання: Які постачальники принесли найбільшу вартість отриманих накладних?

SQL-запит:
```sql
SELECT s.company_name,
       COUNT(DISTINCT o.order_id)::int AS orders_cnt,
       COALESCE(SUM(si.quantity * si.unit_price), 0)::numeric AS total_value
FROM supplier s
JOIN supply_order o ON o.supplier_id = s.supplier_id AND o.status = 'received'
JOIN supply_item si ON si.order_id = o.order_id
GROUP BY s.supplier_id, s.company_name
ORDER BY total_value DESC;
```

Пояснення:
- JOIN трьох таблиць (supplier, supply_order, supply_item).
- Фільтр за статусом 'received' у JOIN-умові.
- Агрегація SUM(quantity * unit_price) за постачальником.

---

## Запит 4: Частка товару у загальному залишку (віконна функція)

Бізнес-питання: Яку частку загального залишку складає кожен товар?

SQL-запит:
```sql
SELECT p.sku_code, p.name,
       COALESCE(SUM(st.quantity), 0)::int AS total_qty,
       ROUND(100.0 * COALESCE(SUM(st.quantity), 0)
             / NULLIF((SELECT COALESCE(SUM(quantity), 0) FROM inventory_stock), 0), 2) AS share_pct
FROM product p
LEFT JOIN inventory_stock st ON st.product_id = p.product_id
GROUP BY p.product_id, p.sku_code, p.name
ORDER BY share_pct DESC NULLS LAST;
```

Пояснення:
- Підзапит обчислює загальний залишок по складу.
- NULLIF захищає від ділення на нуль.
- Результат — відсоток частки кожного товару.

---

## Запит 5: Товари, що зберігаються у кількох комірках (з середнім залишком)

Бізнес-питання: Які товари розміщені більше ніж в одній комірці і який їхній середній залишок на комірку?

SQL-запит:
```sql
SELECT sku_code, name, locs_cnt, avg_qty
FROM (
  SELECT p.sku_code, p.name,
         COUNT(st.location_id)::int AS locs_cnt,
         ROUND(AVG(st.quantity)::numeric, 2) AS avg_qty
  FROM product p
  JOIN inventory_stock st ON st.product_id = p.product_id
  GROUP BY p.product_id, p.sku_code, p.name
) x
WHERE locs_cnt > 1
ORDER BY locs_cnt DESC, sku_code;
```

Пояснення:
- Підзапит (derived table) агрегує за товаром.
- Зовнішній запит фільтрує товари з більш ніж однією коміркою.
- Використовується для аналізу розподілу запасів.

---

## Запит 6: Рейтинг товарів за залишком (DENSE_RANK)

Бізнес-питання: Як ранжуються товари за загальним залишком?

SQL-запит:
```sql
SELECT p.sku_code, p.name,
       COALESCE(SUM(st.quantity), 0)::int AS total_qty,
       DENSE_RANK() OVER (ORDER BY COALESCE(SUM(st.quantity), 0) DESC)::int AS rnk
FROM product p
LEFT JOIN inventory_stock st ON st.product_id = p.product_id
GROUP BY p.product_id, p.sku_code, p.name
ORDER BY rnk, p.sku_code;
```

Пояснення:
- Віконна функція DENSE_RANK присвоює ранг без пропусків.
- Агрегація виконується в GROUP BY, ранжування — поверх результату.

---

## Запит 7: Щомісячна вартість отриманих постачань (CTE)

Бізнес-питання: Яка щомісячна вартість отриманих постачань за постачальниками?

SQL-запит:
```sql
WITH monthly AS (
  SELECT o.supplier_id,
         DATE_TRUNC('month', o.supply_date) AS month,
         SUM(si.quantity * si.unit_price) AS total_value
  FROM supply_order o
  JOIN supply_item si ON si.order_id = o.order_id
  WHERE o.status = 'received'
  GROUP BY o.supplier_id, DATE_TRUNC('month', o.supply_date)
)
SELECT s.company_name, m.month, m.total_value
FROM monthly m
JOIN supplier s ON s.supplier_id = m.supplier_id
ORDER BY m.month DESC, m.total_value DESC;
```

Пояснення:
- CTE `monthly` обчислює агрегат по місяцях і постачальниках.
- Зовнішній запит приєднує назву постачальника.
- Демонструє використання `WITH` (Common Table Expression).

---

## Запит 8: Товари з рухами або залишками (UNION)

Бізнес-питання: Які товари мають або залишки, або рухи по складу?

SQL-запит:
```sql
SELECT p.sku_code, p.name
FROM product p
JOIN inventory_stock st ON st.product_id = p.product_id
UNION
SELECT p.sku_code, p.name
FROM product p
JOIN inventory_movement m ON m.product_id = p.product_id
ORDER BY sku_code;
```

Пояснення:
- UNION об'єднує результати двох запитів без дублікатів.
- Демонструє операцію над множинами (set operation).