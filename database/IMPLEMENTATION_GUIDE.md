# Medication Order Persistence - Implementation Guide

## Problem Summary

Previously, when you placed an order by clicking "Order" and then "Copy to Clipboard" or "Send Email," the order status would only persist temporarily in the frontend. When the data refreshed (every 20 seconds), the order status would disappear because it wasn't saved to the backend database.

## Solution Overview

This implementation adds full backend persistence for medication orders by:

1. **Creating a new `orders` table** in Neon to track order requests
2. **Adding a backend API endpoint** to save orders to the database
3. **Updating the data polling system** to include orders from the database
4. **Modifying the frontend** to persist orders and check order status from the database

---

## Implementation Steps

### Step 1: Create the Orders Table in Neon

Run the SQL script located at `/database/create_orders_table.sql` in your Neon database console.

**What it creates:**
- A new `orders` table with columns for tracking medication orders
- Indexes for efficient querying
- A trigger to automatically update the `updated_at` timestamp

**To execute:**
1. Log into your Neon console
2. Select your database
3. Open the SQL editor
4. Copy and paste the contents of `create_orders_table.sql`
5. Execute the script

### Step 2: Deploy the Backend Changes

The following backend files have been added/modified:

**New Files:**
- `/netlify/functions/order-place.js` - API endpoint to save orders to the database

**Modified Files:**
- `/netlify/functions/meds-get.js` - Now includes pending orders in the response

These changes will be automatically deployed when you push to your repository (if you're using Netlify's continuous deployment).

### Step 3: Deploy the Frontend Changes

**Modified Files:**
- `/api.js` - Added `placeOrder()` function
- `/index.html` - Updated order handling logic

These changes persist orders to the backend and retrieve them during polling.

---

## Database Schema Reference

### New Table: `orders`

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | Unique order identifier |
| `medication_id` | INTEGER | Foreign key to `medications.id` |
| `user_id` | INTEGER | Foreign key to `users.id` (nullable) |
| `quantity` | INTEGER | Number of items ordered |
| `urgency` | VARCHAR(20) | Order priority: 'urgent', 'routine', or 'non-urgent' |
| `notes` | TEXT | Additional notes about the order |
| `pharmacist_email` | VARCHAR(255) | Email address where order was sent |
| `status` | VARCHAR(20) | Order status: 'pending', 'fulfilled', or 'cancelled' |
| `ordered_at` | TIMESTAMP | When the order was placed |
| `fulfilled_at` | TIMESTAMP | When the order was fulfilled (nullable) |
| `created_at` | TIMESTAMP | Record creation timestamp |
| `updated_at` | TIMESTAMP | Record last update timestamp |

### Updated Tables Summary

**All existing tables remain unchanged:**
- `medications` - No changes
- `batches` - No changes
- `locations` - No changes
- `inventory` - No changes
- `transactions` - No changes
- `users` - No changes
- `inventory_full` (view) - No changes

**Only addition:**
- `orders` (new table) - Tracks medication order requests

---

## How It Works

### 1. Order Placement Flow

**Before (Old Behavior):**
```
User clicks Order → Opens form → Clicks "Copy to Clipboard" or "Send Email"
  ↓
Order stored in frontend state only (transactions array with type='order')
  ↓
Data polls after 20 seconds → Overwrites frontend state → Order disappears
```

**After (New Behavior):**
```
User clicks Order → Opens form → Clicks "Copy to Clipboard" or "Send Email"
  ↓
Order saved to database via API call (/.netlify/functions/order-place)
  ↓
Frontend refreshes to show updated order status
  ↓
Data polls after 20 seconds → Loads orders from database → Order persists ✓
```

### 2. Order Status Checking

**Before:**
```javascript
// Checked transactions array for type='order'
hasPendingOrder(medId) {
  return transactions.some(t => t.medId === medId && t.type === 'order');
}
```

**After:**
```javascript
// Checks orders from database for status='pending'
hasPendingOrder(medId) {
  return orders.some(o => o.medId === medId && o.status === 'pending');
}
```

### 3. Data Polling

**Updated polling includes orders:**
```javascript
// meds-get.js now returns:
{
  medications: [...],
  transactions: [...],
  locations: [...],
  orders: [...]  // ← New addition
}
```

---

## API Reference

### POST `/.netlify/functions/order-place`

Creates a new medication order in the database.

**Request Body:**
```json
{
  "medicationId": 123,
  "userId": 5,
  "quantity": 100,
  "urgency": "routine",
  "notes": "Additional notes here",
  "pharmacistEmail": "pharmacist@example.com"
}
```

**Response (Success):**
```json
{
  "success": true,
  "order": {
    "id": 1,
    "medicationId": 123,
    "userId": 5,
    "quantity": 100,
    "urgency": "routine",
    "notes": "Additional notes here",
    "pharmacistEmail": "pharmacist@example.com",
    "status": "pending",
    "orderedAt": "2025-01-10T12:00:00Z",
    "createdAt": "2025-01-10T12:00:00Z"
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Error description"
}
```

### GET `/.netlify/functions/meds-get`

Now includes pending orders in the response.

**Response:**
```json
{
  "medications": [...],
  "transactions": [...],
  "locations": [...],
  "orders": [
    {
      "id": 1,
      "medId": 123,
      "medName": "Paracetamol 500mg",
      "quantity": 100,
      "urgency": "routine",
      "notes": "...",
      "pharmacistEmail": "...",
      "status": "pending",
      "orderedAt": "2025-01-10T12:00:00Z",
      "fulfilledAt": null,
      "user": "John Doe"
    }
  ]
}
```

---

## Testing

### Test Checklist

- [ ] Run the SQL script in Neon database
- [ ] Verify `orders` table was created successfully
- [ ] Deploy backend changes (push to Git)
- [ ] Deploy frontend changes (push to Git)
- [ ] Wait for Netlify deployment to complete
- [ ] Test order placement:
  - [ ] Navigate to a low-stock medication
  - [ ] Click "Order" button
  - [ ] Fill in order details
  - [ ] Click "Copy to Clipboard"
  - [ ] Verify "Ordered" badge appears on medication
  - [ ] Wait 20+ seconds for data to poll
  - [ ] Verify "Ordered" badge still shows (order persisted!)
- [ ] Test with "Send Email" option as well
- [ ] Verify orders appear in Neon database

---

## Troubleshooting

### Issue: Orders disappear after refresh

**Possible causes:**
1. SQL script not executed - orders table doesn't exist
2. Backend deployment not complete
3. Database connection issue

**Solution:**
- Check Neon console to verify `orders` table exists
- Check Netlify deployment logs for errors
- Verify DATABASE_URL environment variable is set

### Issue: "Order placement failed" error

**Possible causes:**
1. Missing required fields (medicationId, quantity, urgency, pharmacistEmail)
2. Invalid urgency value (must be 'urgent', 'routine', or 'non-urgent')
3. Database connection issue

**Solution:**
- Check browser console for detailed error message
- Verify order form has all required fields filled
- Check Netlify function logs for backend errors

### Issue: Orders don't show "Ordered" badge

**Possible causes:**
1. Order saved with wrong medication ID
2. Frontend not loading orders from database
3. Polling not including orders

**Solution:**
- Check Neon database to verify order was saved with correct medication_id
- Check browser console for data polling response
- Verify `orders` array is populated in state

---

## Future Enhancements

Potential improvements for the order system:

1. **Order Fulfillment**: Add UI to mark orders as fulfilled when stock arrives
2. **Order History**: Show all orders (including fulfilled/cancelled) in a separate view
3. **Order Notifications**: Email notifications when orders are placed
4. **Order Analytics**: Track order frequency and supplier response times
5. **Batch Ordering**: Allow ordering multiple medications at once
6. **Order Approval Workflow**: Require approval for large orders

---

## Support

If you encounter any issues with this implementation:

1. Check the troubleshooting section above
2. Review Netlify function logs: `netlify functions:log`
3. Check Neon database logs in the Neon console
4. Verify all files were deployed correctly

---

## Summary

This implementation solves the order persistence issue by creating a proper backend storage system for medication orders. Orders are now saved to the Neon database and persist across page refreshes and data polling cycles.

**Key files to review:**
- `/database/create_orders_table.sql` - Database schema
- `/netlify/functions/order-place.js` - Order creation API
- `/netlify/functions/meds-get.js` - Order retrieval API
- `/api.js` - Frontend API client
- `/index.html` - Order handling logic
