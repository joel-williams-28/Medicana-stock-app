# Neon Database - Table Structure Reference

## Complete Table List

This document provides a complete reference of all tables in your Neon database and their columns.

---

## Core Tables

### 1. medications

Stores medication master data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `name` | VARCHAR | Medication name |
| `strength` | VARCHAR | Medication strength |
| `form` | VARCHAR | Form type (tablet, capsule, etc.) |
| `fefo` | BOOLEAN | First-Expire-First-Out flag |
| `min_level_boxes` | INTEGER | Minimum stock level in boxes |
| `standard_items_per_box` | INTEGER | Standard items per box |
| `barcode` | VARCHAR | Barcode identifier |
| `is_active` | BOOLEAN | Whether medication is active |
| `slug` | VARCHAR | URL-friendly identifier |

---

### 2. batches

Stores batch information for medications.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `medication_id` | INTEGER | Foreign key to medications.id |
| `batch_code` | VARCHAR | Batch/lot number |
| `expiry_date` | DATE | Expiration date |
| `brand` | VARCHAR | Brand/manufacturer name |
| `items_per_box` | INTEGER | Number of items per box for this batch |

---

### 3. locations

Stores storage location information.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `display_name` | VARCHAR | Location display name |
| `group_name` | VARCHAR | Location group/category |

---

### 4. inventory

Stores current stock levels for each batch at each location.

| Column | Type | Description |
|--------|------|-------------|
| `location_id` | INTEGER | Foreign key to locations.id |
| `batch_id` | INTEGER | Foreign key to batches.id |
| `on_hand` | INTEGER | Current quantity on hand |

---

### 5. transactions

Stores all stock movement history (additions, removals, transfers).

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `occurred_at` | TIMESTAMP | When the transaction occurred |
| `user_id` | INTEGER | Foreign key to users.id |
| `location_id` | INTEGER | Foreign key to locations.id |
| `batch_id` | INTEGER | Foreign key to batches.id |
| `medication_id` | INTEGER | Foreign key to medications.id |
| `delta` | INTEGER | Change in quantity (positive = addition, negative = removal) |
| `reason` | TEXT | Transaction description/reason |

---

### 6. users

Stores user account information.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `username` | VARCHAR | Unique username |
| `password_hash` | VARCHAR | Hashed password |
| `email` | VARCHAR | User email address |
| `first_name` | VARCHAR | User first name |
| `full_name` | VARCHAR | User full name |
| `role` | VARCHAR | User role (Administrator, Pharmacist, Stock Manager, etc.) |
| `active` | BOOLEAN | Whether account is active |
| `location` | VARCHAR | User's primary location |

---

### 7. orders (NEW)

**NEW TABLE** - Stores medication order requests.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `medication_id` | INTEGER | Foreign key to medications.id |
| `user_id` | INTEGER | Foreign key to users.id (nullable) |
| `quantity` | INTEGER | Number of items ordered |
| `urgency` | VARCHAR(20) | Order priority: 'urgent', 'routine', or 'non-urgent' |
| `notes` | TEXT | Additional notes about the order |
| `pharmacist_email` | VARCHAR(255) | Email address where order was sent |
| `status` | VARCHAR(20) | Order status: 'pending', 'fulfilled', or 'cancelled' |
| `ordered_at` | TIMESTAMP | When the order was placed |
| `fulfilled_at` | TIMESTAMP | When the order was fulfilled (nullable) |
| `created_at` | TIMESTAMP | Record creation timestamp |
| `updated_at` | TIMESTAMP | Record last update timestamp |

---

## Views

### inventory_full (Reporting View)

Denormalized view combining inventory, batch, medication, and location data for reporting.

| Column | Type | Description |
|--------|------|-------------|
| `batch_id` | INTEGER | Batch identifier |
| `location_id` | INTEGER | Location identifier |
| `location_name` | VARCHAR | Location display name |
| `location_group` | VARCHAR | Location group name |
| `medication_id` | INTEGER | Medication identifier |
| `medication_name` | VARCHAR | Medication name |
| `medication_display_id` | VARCHAR | Medication display identifier |
| `barcode` | VARCHAR | Medication barcode |
| `batch_code` | VARCHAR | Batch/lot number |
| `brand` | VARCHAR | Brand/manufacturer |
| `expiry_date` | DATE | Expiration date |
| `on_hand` | INTEGER | Current quantity on hand |
| `items_per_box` | INTEGER | Items per box for this batch |
| `number_of_boxes` | DECIMAL | Calculated: on_hand / items_per_box |
| `type` | VARCHAR | Medication form type |
| `strength_raw` | VARCHAR | Raw strength value |
| `strength_clean` | VARCHAR | Cleaned strength value |
| `min_level_boxes` | INTEGER | Minimum stock level in boxes |
| `min_level_items` | INTEGER | Minimum stock level in items |

---

## Table Relationships

```
medications (1) ─────┬──────> (M) batches
                     │
                     └──────> (M) inventory ────> (1) locations
                     │
                     └──────> (M) transactions
                     │
                     └──────> (M) orders (NEW)

batches (1) ─────────┬──────> (M) inventory
                     │
                     └──────> (M) transactions

users (1) ───────────┬──────> (M) transactions
                     │
                     └──────> (M) orders (NEW)

locations (1) ───────┬──────> (M) inventory
                     │
                     └──────> (M) transactions
```

---

## Changes Summary

### What Changed?

**Added:**
- New `orders` table to track medication order requests

**Unchanged:**
- All existing tables remain exactly the same:
  - `medications` - No changes
  - `batches` - No changes
  - `locations` - No changes
  - `inventory` - No changes
  - `transactions` - No changes
  - `users` - No changes
  - `inventory_full` (view) - No changes

### Why This Change?

Previously, order information was only stored in the frontend and would disappear when the page refreshed. The new `orders` table persists order information to the database so it survives refreshes and polling cycles.

---

## SQL Reference

### Create the orders table

See `/database/create_orders_table.sql` for the complete SQL script.

### Query Examples

**Get all pending orders:**
```sql
SELECT * FROM orders WHERE status = 'pending' ORDER BY ordered_at DESC;
```

**Get pending orders for a specific medication:**
```sql
SELECT o.*, m.name, m.strength
FROM orders o
JOIN medications m ON m.id = o.medication_id
WHERE o.status = 'pending' AND o.medication_id = 123;
```

**Mark an order as fulfilled:**
```sql
UPDATE orders
SET status = 'fulfilled', fulfilled_at = NOW()
WHERE id = 1;
```

**Get order history with user and medication details:**
```sql
SELECT
  o.id,
  o.quantity,
  o.urgency,
  o.status,
  o.ordered_at,
  o.fulfilled_at,
  m.name AS medication_name,
  m.strength,
  u.full_name AS ordered_by
FROM orders o
LEFT JOIN medications m ON m.id = o.medication_id
LEFT JOIN users u ON u.id = o.user_id
ORDER BY o.ordered_at DESC;
```

---

## Migration Notes

### Before Migration
- Orders existed only in frontend localStorage
- Orders disappeared on page refresh
- No order history available

### After Migration
- Orders persist in Neon database
- Orders survive page refreshes
- Full order history available
- Order status can be tracked (pending/fulfilled/cancelled)

### No Breaking Changes
- All existing functionality continues to work
- All existing tables are unchanged
- Only addition is the new `orders` table

---

## Index Information

The `orders` table includes the following indexes for optimal performance:

1. `idx_orders_medication_id` - Fast lookups by medication
2. `idx_orders_user_id` - Fast lookups by user
3. `idx_orders_status` - Fast filtering by status
4. `idx_orders_ordered_at` - Fast sorting by date

---

## Maintenance

### Regular Maintenance Tasks

1. **Archive old fulfilled orders** (optional):
   ```sql
   -- Archive orders fulfilled more than 1 year ago
   DELETE FROM orders
   WHERE status = 'fulfilled'
   AND fulfilled_at < NOW() - INTERVAL '1 year';
   ```

2. **Monitor pending orders**:
   ```sql
   -- Find old pending orders that might need attention
   SELECT * FROM orders
   WHERE status = 'pending'
   AND ordered_at < NOW() - INTERVAL '7 days';
   ```

---

## Backup Considerations

The `orders` table should be included in your regular database backups. Neon automatically handles backups, but you may want to export order data periodically for record-keeping purposes.

**Export orders to CSV:**
```sql
COPY (
  SELECT
    o.id,
    m.name AS medication,
    o.quantity,
    o.urgency,
    o.status,
    o.ordered_at,
    o.fulfilled_at,
    u.username AS ordered_by
  FROM orders o
  LEFT JOIN medications m ON m.id = o.medication_id
  LEFT JOIN users u ON u.id = o.user_id
  ORDER BY o.ordered_at DESC
) TO '/tmp/orders_export.csv' WITH CSV HEADER;
```

---

## Support

If you need to make additional changes to the database schema:

1. Always test changes in a development environment first
2. Back up your database before making schema changes
3. Document any new columns or tables
4. Update this reference document

For questions or issues, refer to the main implementation guide at `/database/IMPLEMENTATION_GUIDE.md`.
