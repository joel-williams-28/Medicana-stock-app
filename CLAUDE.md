# Medicana Stock App

Pharmaceutical inventory management system built with React (CDN), Netlify Functions, and Neon PostgreSQL.

## Neon Database Schema (actual types from production)

**IMPORTANT:** Many columns that look like IDs use TEXT, not INTEGER. Always check this table before writing SQL.

### activity_log
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | int4 | NO | nextval('activity_log_id_seq') |
| user_id | int4 | YES | |
| action_type | text | NO | |
| entity_type | text | YES | |
| entity_id | text | YES | |
| location_id | text | YES | |
| details | jsonb | YES | '{}' |
| occurred_at | timestamptz | NO | now() |

### batches
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | int4 | NO | nextval('batches_id_seq') |
| medication_id | text | NO | |
| batch_code | text | NO | |
| expiry_date | date | YES | |
| brand | text | YES | |
| items_per_box | int4 | YES | |
| serial | text | YES | |

### draft_orders
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | int4 | NO | nextval('draft_orders_id_seq') |
| medication_id | text | NO | |
| location_id | text | YES | |
| current_stock_boxes | numeric | NO | 0 |
| min_level_boxes | int4 | NO | 0 |
| suggested_quantity | int4 | NO | |
| approved_quantity | int4 | YES | |
| urgency | varchar | NO | 'routine' |
| intelligence_snapshot | jsonb | YES | |
| source | varchar | NO | 'auto' |
| status | varchar | NO | 'pending_review' |
| generated_by | int4 | YES | |
| approved_by | int4 | YES | |
| generated_at | timestamptz | NO | now() |
| approved_at | timestamptz | YES | |
| rejected_at | timestamptz | YES | |
| order_id | int4 | YES | |
| batch_ref | uuid | NO | |
| notes | text | YES | |

### intelligence_config
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| key | varchar | NO | |
| value | text | NO | '' |
| updated_at | timestamptz | YES | now() |

### inventory
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| location_id | text | NO | |
| batch_id | int4 | NO | |
| on_hand | int4 | NO | 0 |

### location_min_levels
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| medication_id | text | NO | |
| location_id | text | NO | |
| min_level_boxes | int4 | NO | 0 |
| updated_at | timestamptz | YES | now() |
| updated_by | text | YES | |

### locations
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | NO | |
| display_name | text | NO | |
| group_name | text | YES | |

### medications
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | NO | |
| name | text | NO | |
| strength | text | YES | |
| form | text | YES | |
| fefo | bool | NO | TRUE |
| min_level_boxes | int4 | YES | 0 |
| standard_items_per_box | int4 | YES | |
| barcode | text | YES | |
| is_active | bool | NO | TRUE |
| slug | text | YES | |

### orders
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | int4 | NO | nextval('orders_id_seq') |
| medication_id | text | NO | |
| user_id | int4 | YES | |
| quantity | int4 | NO | |
| urgency | varchar | NO | 'routine' |
| notes | text | YES | |
| pharmacist_email | varchar | NO | |
| status | varchar | NO | 'pending' |
| ordered_at | timestamptz | NO | now() |
| fulfilled_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| quantity_fulfilled | int4 | YES | 0 |

### transactions
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | int8 | NO | nextval('transactions_id_seq') |
| occurred_at | timestamptz | NO | now() |
| user_id | int4 | NO | |
| location_id | text | NO | |
| batch_id | int4 | YES | |
| medication_id | text | NO | |
| delta | int4 | NO | |
| reason | text | NO | '' |
| type | text | YES | |

### users
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | int4 | NO | nextval('users_id_seq') |
| username | text | NO | |
| password_hash | text | NO | |
| email | text | NO | |
| first_name | text | NO | |
| full_name | text | NO | |
| role | text | NO | |
| active | bool | NO | TRUE |
| location | text | YES | |

### pipeline_snapshots
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | int4 | NO | nextval('pipeline_snapshots_id_seq') |
| snapshot | jsonb | NO | |
| generated_at | timestamptz | NO | now() |
| generated_by | int4 | YES | |

### Key Constraints
- `intelligence_config.key` — PRIMARY KEY (used in ON CONFLICT upserts)
- `inventory (location_id, batch_id)` — composite PRIMARY KEY
- `location_min_levels (medication_id, location_id)` — composite PRIMARY KEY
- `batches (medication_id, batch_code)` — UNIQUE constraint
- `users.username` — UNIQUE constraint

### Foreign Keys
- `activity_log.user_id` → `users.id`
- `batches.medication_id` → `medications.id`
- `inventory.location_id` → `locations.id`
- `inventory.batch_id` → `batches.id`
- `orders.medication_id` → `medications.id`
- `orders.user_id` → `users.id`
- `transactions.user_id` → `users.id`
- `transactions.location_id` → `locations.id`
- `transactions.batch_id` → `batches.id`
- `transactions.medication_id` → `medications.id`

## Key Type Notes
- `medications.id` is **TEXT** (not integer)
- `locations.id` is **TEXT** (not integer)
- `orders.medication_id` is **TEXT** (references medications.id)
- `batches.medication_id` is **TEXT** (references medications.id)
- `inventory.location_id` is **TEXT** (references locations.id)
- `users.id` is **int4** (serial/integer)
- `orders.id` is **int4** (serial/integer)
- `batches.id` is **int4** (serial/integer)
- `transactions.id` is **int8** (bigserial/bigint)

## Architecture
- **Frontend:** React via CDN (single index.html ~7700 lines), Babel, TailwindCSS
- **Backend:** Netlify Functions (serverless), Node.js
- **Database:** Neon PostgreSQL with SSL
- **API Layer:** api.js (frontend abstraction)
- **Shared helpers:** `_db.js` (pool + response helpers), `_activity-log.js`, `_intelligence-core.js`
