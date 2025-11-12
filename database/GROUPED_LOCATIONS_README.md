# Grouped Locations Implementation

## Overview

This update adds support for grouped locations in the Medicana Stock App, allowing you to organize related storage areas under common headings and view combined stock levels across all locations in a group.

## Database Changes

### SQL Migration

Run the SQL script in `add_location_groups.sql` to update the locations table with group names:

```sql
-- Update Theatre locations to be part of "Theatres" group
UPDATE locations
SET group_name = 'Theatres'
WHERE display_name IN ('Theatre 1', 'Theatre 2', 'Theatre 3');

-- Update Ward locations to be part of "Wards" group
UPDATE locations
SET group_name = 'Wards'
WHERE display_name IN ('Ward 1', 'Ward 2', 'Ward 3');

-- Update Cupboard locations to be part of "Medication Stock L1" group
UPDATE locations
SET group_name = 'Medication Stock L1'
WHERE display_name IN ('Cupboard 1', 'Cupboard 2', 'Cupboard 3');
```

### Location Structure

After running the migration, your locations will have the following grouped structure:

**Medication Stock L1 (Group)**
- Cupboard 1
- Cupboard 2
- Cupboard 3

**Theatres (Group)**
- Theatre 1
- Theatre 2
- Theatre 3

**Wards (Group)**
- Ward 1
- Ward 2
- Ward 3

**Ungrouped Locations:**
- PACU
- Sapphire Clinic
- Radiology
- Pharmacy

## Frontend Features

### Location Dropdown

The location selector now displays grouped locations with:
- Group headings (e.g., "Theatres")
- An option to view all locations in a group (e.g., "Theatres (All)")
- Indented sub-locations (e.g., "Theatre 1", "Theatre 2", "Theatre 3")

### Combined Stock Views

When selecting a group heading (e.g., "Theatres"), the app displays:
- Combined stock levels from all locations in that group
- A location column showing which specific location each item is in
- The description text shows "Viewing combined stock for [Group Name]"

### Individual Location Views

When selecting a specific location (e.g., "Theatre 1"), the app displays:
- Stock only for that specific location
- No location column (since all items are in the same location)
- The description text shows "Viewing stock for [Location Name]"

## Implementation Details

### Helper Functions

Three new helper functions were added to support grouped locations:

1. **`getLocationNamesToCheck(currentLocationValue, locationsArray)`**
   - Returns an array of location names to check based on the current selection
   - If a group is selected, returns all locations in that group
   - If a specific location is selected, returns just that location

2. **`matchesLocationFilter(med, currentLocationValue, locationsArray)`**
   - Checks if a medication matches the current location filter
   - Handles both individual locations and groups

3. **`isGroupName(value, locationsArray)`**
   - Checks if a value is a group name
   - Used to determine when to show combined views vs. specific location views

### Updated Filtering Logic

All location filtering logic throughout the application has been updated to use the new helper functions, including:
- Medication list filtering
- Low stock filtering
- Transaction filtering
- Filter dropdown options
- Default location selection

## Benefits

1. **Better Organization**: Related locations are grouped together for easier navigation
2. **Combined Views**: Quickly see stock across multiple related locations
3. **Flexible**: Can view either combined group stock or individual location stock
4. **Scalable**: Easy to add new groups or locations in the future
5. **Backward Compatible**: Existing ungrouped locations continue to work as before

## How to Use

1. **Run the SQL migration** in your Neon database console or using a SQL client
2. **Refresh the application** to load the updated location structure
3. **Select a group** from the location dropdown to view combined stock
4. **Select a specific location** to view stock for that location only

## Future Enhancements

Possible future improvements:
- Allow users to create custom location groups via the UI
- Add color coding or icons for different location groups
- Support multi-level grouping (e.g., Building > Floor > Room)
- Add group-level stock transfer functionality
