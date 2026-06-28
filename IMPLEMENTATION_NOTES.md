# Quipu Item Operations: Implementation Notes

## Quick Reference

### Core Files That Need Changes
- `/app/static/app.js` - Add EventEmitter, ItemActions, and modal listener patterns

### Storage Backend (No Changes Needed)
- `/app/main.py` - Existing endpoints stay the same (they're called by ItemActions)
- `/app/storage.py` - No changes needed
- `/app/models.py` - No changes needed

### Frontend Structure (Existing)
- `state` object - Global state (add event listeners/unsubscribers here if needed)
- `renderNearbyItemList()` - Already exists, will be called from event listener
- `renderInventory()` - Already exists, will be called from event listener
- `renderPortalModal()` - Already exists, will be called from event listener

---

## Concrete Code Examples

### 1. EventEmitter Implementation

```javascript
/**
 * Simple pub/sub event emitter.
 * 
 * Usage:
 *   emitter.on('event', handler);
 *   emitter.emit('event', data);
 *   emitter.off('event', handler);
 */
class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(eventName, listener) {
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, new Set());
    }
    this._listeners.get(eventName).add(listener);
  }

  off(eventName, listener) {
    if (!this._listeners.has(eventName)) {
      return;
    }
    this._listeners.get(eventName).delete(listener);
    if (this._listeners.get(eventName).size === 0) {
      this._listeners.delete(eventName);
    }
  }

  emit(eventName, data) {
    if (!this._listeners.has(eventName)) {
      return;
    }
    for (const listener of this._listeners.get(eventName)) {
      try {
        listener(data);
      } catch (err) {
        console.error(`Error in listener for event "${eventName}":`, err);
      }
    }
  }

  // Convenience: unsubscribe all listeners for an event
  clear(eventName) {
    this._listeners.delete(eventName);
  }

  // Debugging: list all event types with subscriber count
  debug() {
    const result = {};
    for (const [eventName, listeners] of this._listeners) {
      result[eventName] = listeners.size;
    }
    return result;
  }
}

// Global instance
const eventEmitter = new EventEmitter();
```

---

### 2. ItemActions Module (Simplified Examples)

```javascript
/**
 * Item operations with unified interface.
 * All operations emit events that trigger modal re-renders.
 */
const ItemActions = {

  // ── WORLD OPERATIONS ────────────────────────────────────────────────────────

  /**
   * Place any item type at a location in the world.
   * 
   * This is the main entry point for all item placement.
   * 
   * @example
   * const result = await ItemActions.placeItemAtLocation({
   *   item: mediaItem,
   *   location: { lat: 51.5, lng: -0.1 },
   *   rootId: state.dimensionRootId
   * });
   * if (!result.success) showNotification(result.error);
   */
  async placeItemAtLocation(params) {
    const { item, location, rootId } = params;

    // Validate
    if (!item || !item.id) {
      return { success: false, error: 'Invalid item' };
    }
    if (!location || location.lat === undefined || location.lng === undefined) {
      return { success: false, error: 'Invalid location' };
    }

    try {
      // Type-specific validation
      if (item.type === 'portal_marker') {
        // Would call backend validation here
        // For now, assume passed params are pre-validated
      }

      // Save to server (this already happens in existing POST /api/dimensions/{id}/items)
      // We're just adding event emission here:
      
      const response = await apiFetch(
        `/api/dimensions/${rootId}/items`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: item.type,
            latitude: location.lat,
            longitude: location.lng,
            // ... other fields
          })
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const savedItem = await response.json();

      // Emit event - items modal will listen and re-render
      eventEmitter.emit('itemPlaced', {
        item: savedItem,
        location: location,
        type: item.type
      });

      // Invalidate nearby cache
      localStorage.removeItem(cacheKey); // from existing code

      return { success: true, error: null, item: savedItem };

    } catch (err) {
      console.error('Error in placeItemAtLocation:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Remove item from world (delete permanently).
   * 
   * @example
   * const result = await ItemActions.removeItemFromWorld({
   *   itemId: '123',
   *   location: { lat: 51.5, lng: -0.1 },
   *   rootId: state.dimensionRootId
   * });
   */
  async removeItemFromWorld(params) {
    const { itemId, location, rootId } = params;

    try {
      // Delete from server
      const response = await apiFetch(
        `/api/dimensions/${rootId}/items/${itemId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      // Invalidate cache
      localStorage.removeItem(cacheKey);

      // Emit event
      eventEmitter.emit('itemRemoved', {
        itemId: itemId,
        wasFromWorld: true,
        location: location
      });

      return { success: true, error: null };

    } catch (err) {
      console.error('Error in removeItemFromWorld:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Pick up item from world: remove from world + add to inventory.
   * 
   * @example
   * const result = await ItemActions.pickUpItemFromWorld({
   *   itemId: '123',
   *   location: { lat: 51.5, lng: -0.1 },
   *   rootId: state.dimensionRootId
   * });
   */
  async pickUpItemFromWorld(params) {
    const { itemId, location, rootId } = params;

    try {
      // Fetch the item first
      const response = await apiFetch(`/api/items/${itemId}`);
      if (!response.ok) {
        return { success: false, error: 'Item not found' };
      }
      const item = await response.json();

      // Remove from world
      const removeResult = await this.removeItemFromWorld(params);
      if (!removeResult.success) {
        return removeResult;
      }

      // Add to inventory
      const inventoryResult = await this.addToInventory({ item });
      if (!inventoryResult.success) {
        console.warn('Item removed from world but inventory add failed:', inventoryResult.error);
        // Don't fail completely - item is removed from world at least
      }

      return { success: true, error: null };

    } catch (err) {
      console.error('Error in pickUpItemFromWorld:', err);
      return { success: false, error: err.message };
    }
  },

  // ── INVENTORY OPERATIONS ────────────────────────────────────────────────────

  /**
   * Add item to local inventory (client-side only).
   * 
   * @example
   * const result = await ItemActions.addToInventory({ item: mediaItem });
   * if (result.success) {
   *   // inventoryChanged event will trigger renderInventory()
   * }
   */
  async addToInventory(params) {
    const { item } = params;

    try {
      if (!item || !item.id) {
        return { success: false, error: 'Invalid item' };
      }

      // Check if already in inventory
      if (state.inventory.some(inv => inv.id === item.id)) {
        return { success: false, error: 'Item already in inventory' };
      }

      // Add to state
      state.inventory.push(item);

      // Persist to localStorage
      localStorage.setItem(
        inventoryKey,
        JSON.stringify(state.inventory.map(i => i.model_dump ? i.model_dump() : i))
      );

      // Emit event - inventory modal will listen and re-render
      eventEmitter.emit('inventoryChanged', {
        items: state.inventory
      });

      return { success: true, error: null };

    } catch (err) {
      console.error('Error in addToInventory:', err);
      state.inventory.pop(); // rollback
      return { success: false, error: err.message };
    }
  },

  /**
   * Remove item from local inventory (client-side only).
   * 
   * @example
   * const result = await ItemActions.removeFromInventory({ itemId: '123' });
   */
  async removeFromInventory(params) {
    const { itemId } = params;

    try {
      const index = state.inventory.findIndex(item => item.id === itemId);
      if (index === -1) {
        return { success: false, error: 'Item not in inventory' };
      }

      const removed = state.inventory.splice(index, 1);

      // Persist to localStorage
      localStorage.setItem(
        inventoryKey,
        JSON.stringify(state.inventory.map(i => i.model_dump ? i.model_dump() : i))
      );

      // Emit events
      eventEmitter.emit('itemRemoved', {
        itemId: itemId,
        wasFromWorld: false,
        location: null
      });

      eventEmitter.emit('inventoryChanged', {
        items: state.inventory
      });

      return { success: true, error: null };

    } catch (err) {
      console.error('Error in removeFromInventory:', err);
      return { success: false, error: err.message };
    }
  },

  // ── NEARBY ITEMS / WORLD STATE ──────────────────────────────────────────────

  /**
   * Update nearby items (called after fetching new cells).
   * This triggers the worldStateChanged event that the items modal listens to.
   * 
   * @example
   * await ItemActions.updateNearbyItems({
   *   nearbyItems: fetchedItems,
   *   userLocation: state.physicalPosition
   * });
   */
  async updateNearbyItems(params) {
    const { nearbyItems, userLocation } = params;

    try {
      // Filter and sort items
      const displayItems = nearbyItems
        .map(item => ({
          ...item,
          distance: haversine_meters(
            userLocation.lat, userLocation.lng,
            item.latitude, item.longitude
          )
        }))
        .sort((a, b) => a.distance - b.distance);

      // Update state
      state.nearbyItems = nearbyItems;
      state.displayItems = displayItems;

      // Emit event - items modal will listen and call renderNearbyItemList()
      eventEmitter.emit('worldStateChanged', {
        nearbyItems: nearbyItems,
        displayItems: displayItems
      });

      return { success: true, error: null };

    } catch (err) {
      console.error('Error in updateNearbyItems:', err);
      return { success: false, error: err.message };
    }
  },

  // ── PORTAL OPERATIONS ──────────────────────────────────────────────────────

  /**
   * Update portal selection (which local and remote portals are selected).
   * 
   * @example
   * await ItemActions.setPortalSelection({
   *   localPortalId: '123',
   *   remotePortalId: '456'
   * });
   */
  async setPortalSelection(params) {
    const { localPortalId, remotePortalId } = params;

    try {
      // Update state
      state.selectedLocalPortalId = localPortalId;
      state.selectedRemotePortalId = remotePortalId;

      // Optionally persist selection to localStorage
      // (existing code may already do this)

      // Emit event - portals modal will listen and update display
      eventEmitter.emit('portalSelectionChanged', {
        localId: localPortalId,
        remoteId: remotePortalId
      });

      return { success: true, error: null };

    } catch (err) {
      console.error('Error in setPortalSelection:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Update portal favorites list.
   * 
   * @example
   * const favorites = [
   *   { id: '123', name: 'Home', lat: 51.5, lng: -0.1 },
   *   { id: '456', name: 'Work', lat: 51.6, lng: -0.2 }
   * ];
   * await ItemActions.setPortalFavorites({ favorites });
   */
  async setPortalFavorites(params) {
    const { favorites } = params;

    try {
      if (!Array.isArray(favorites)) {
        return { success: false, error: 'Favorites must be an array' };
      }

      // Update state
      state.portalFavorites = favorites;

      // Persist to localStorage (existing code pattern)
      localStorage.setItem(portalFavoritesKey, JSON.stringify(favorites));

      // Emit event - portals modal will listen and re-render favorites list
      eventEmitter.emit('portalFavoritesChanged', {
        favorites: favorites
      });

      return { success: true, error: null };

    } catch (err) {
      console.error('Error in setPortalFavorites:', err);
      return { success: false, error: err.message };
    }
  },
};
```

---

### 3. Modal Listener Pattern: Items Modal

```javascript
// Keep track of event listeners for cleanup
let itemsModalEventListener = null;

/**
 * Open items modal and subscribe to world state changes.
 * 
 * Call this when user clicks "Show Nearby Items" button.
 */
function openItemsModal() {
  // Define the listener (must be stored so we can remove it later)
  itemsModalEventListener = (eventData) => {
    // eventData: { nearbyItems, displayItems }
    renderNearbyItemList(eventData.displayItems);
  };

  // Subscribe to world state changes
  eventEmitter.on('worldStateChanged', itemsModalEventListener);

  // Show modal
  itemsModalEl.classList.add('open');
  modalScrimEl.classList.add('open');

  // Initial render with current state
  renderNearbyItemList(state.displayItems);
}

/**
 * Close items modal and unsubscribe from events.
 */
function closeItemsModal() {
  if (itemsModalEventListener) {
    eventEmitter.off('worldStateChanged', itemsModalEventListener);
    itemsModalEventListener = null;
  }

  itemsModalEl.classList.remove('open');
  modalScrimEl.classList.remove('open');
}

/**
 * Render the list of nearby pickupable items.
 * Called by the worldStateChanged event listener.
 * 
 * This already exists in the codebase - we're just adding the event trigger.
 * No need to change this function itself, just ensure it's called from events.
 */
function renderNearbyItemList(displayItems) {
  // (existing implementation - keep as-is)
  // The only change is that this is now called from:
  //   1. The worldStateChanged event listener
  //   2. Modal open (for initial render)
  // Instead of directly after loadNearby()
}

// Wire up button handlers
if (locationAddItemButtonEl) {
  locationAddItemButtonEl.addEventListener('click', openItemsModal);
}

// Wire up modal close
if (itemsModalEl) {
  itemsModalEl.addEventListener('click', (e) => {
    if (e.target === itemsModalEl) closeItemsModal();
  });
}

// Also close on scrim click (existing pattern)
modalScrimEl.addEventListener('click', closeItemsModal);
```

---

### 4. Modal Listener Pattern: Inventory Modal

```javascript
let inventoryModalEventListener = null;

/**
 * Open inventory modal and subscribe to inventory changes.
 */
function openInventoryModal() {
  inventoryModalEventListener = (eventData) => {
    // eventData: { items: ItemDocument[] }
    renderInventory(eventData.items);
  };

  eventEmitter.on('inventoryChanged', inventoryModalEventListener);

  // Show modal
  inventoryItemsListEl.classList.add('open');
  modalScrimEl.classList.add('open');

  // Initial render
  renderInventory(state.inventory);
}

/**
 * Close inventory modal and unsubscribe.
 */
function closeInventoryModal() {
  if (inventoryModalEventListener) {
    eventEmitter.off('inventoryChanged', inventoryModalEventListener);
    inventoryModalEventListener = null;
  }

  inventoryItemsListEl.classList.remove('open');
  modalScrimEl.classList.remove('open');
}

/**
 * Render inventory items (existing implementation, unchanged).
 * Now called from inventoryChanged event listener.
 */
function renderInventory(items) {
  // (existing implementation - keep as-is)
}

// Wire up button
if (inventoryAddItemButtonEl) {
  inventoryAddItemButtonEl.addEventListener('click', openInventoryModal);
}

// Wire up close
inventoryItemsListEl.addEventListener('click', (e) => {
  if (e.target === inventoryItemsListEl) closeInventoryModal();
});

modalScrimEl.addEventListener('click', closeInventoryModal);
```

---

### 5. Modal Listener Pattern: Portals Modal

```javascript
let portalModalEventListeners = {};

/**
 * Open portals modal and subscribe to portal changes.
 */
function openPortalsModal() {
  // Create listeners (stored for cleanup)
  portalModalEventListeners.favorites = (eventData) => {
    renderPortalFavoritesList(eventData.favorites);
  };

  portalModalEventListeners.selection = (eventData) => {
    updatePortalSelectionDisplay(eventData.localId, eventData.remoteId);
  };

  // Subscribe
  eventEmitter.on('portalFavoritesChanged', portalModalEventListeners.favorites);
  eventEmitter.on('portalSelectionChanged', portalModalEventListeners.selection);

  // Show modal
  portalsModalEl.classList.add('open');
  modalScrimEl.classList.add('open');

  // Initial render (full modal)
  renderPortalModal();
}

/**
 * Close portals modal and unsubscribe.
 */
function closePortalsModal() {
  if (portalModalEventListeners.favorites) {
    eventEmitter.off('portalFavoritesChanged', portalModalEventListeners.favorites);
  }
  if (portalModalEventListeners.selection) {
    eventEmitter.off('portalSelectionChanged', portalModalEventListeners.selection);
  }
  portalModalEventListeners = {};

  portalsModalEl.classList.remove('open');
  modalScrimEl.classList.remove('open');
}

/**
 * Main portal modal render (existing, unchanged).
 * Calls renderNearbyPortalList(), updatePortalSelectionDisplay(), etc.
 */
function renderPortalModal() {
  // (existing implementation)
}

// Similar wiring as other modals
portalReturnButtonEl?.addEventListener('click', openPortalsModal);
portalsModalEl.addEventListener('click', (e) => {
  if (e.target === portalsModalEl) closePortalsModal();
});
```

---

### 6. Integration Point: Replacing Old Item Placement Call

**Before** (current code in app.js):
```javascript
// Scattered in form submission handlers
const response = await apiFetch('/api/dimensions/...' {
  method: 'POST',
  body: formData
});
const item = await response.json();
state.displayItems.push(item); // manual state update
renderNearbyItemList(); // manual render
```

**After** (with ItemActions):
```javascript
// In form submission handler
const result = await ItemActions.placeItemAtLocation({
  item: itemDocument,
  location: state.physicalPosition,
  rootId: state.dimensionRootId
});

if (!result.success) {
  showNotification(`Error: ${result.error}`);
} else {
  // Success - events handle the rest
  showNotification('Item placed!');
}
```

---

### 7. Integration Point: Replacing Old Item Pickup Call

**Before**:
```javascript
await apiFetch(`/api/dimensions/${rootId}/items/${itemId}`, {
  method: 'DELETE'
});
state.displayItems = state.displayItems.filter(i => i.id !== itemId);
state.inventory.push(item);
renderNearbyItemList();
renderInventory();
```

**After**:
```javascript
const result = await ItemActions.pickUpItemFromWorld({
  itemId: itemId,
  location: state.physicalPosition,
  rootId: state.dimensionRootId
});

if (!result.success) {
  showNotification(`Error: ${result.error}`);
}
// Events handle all rendering
```

---

## Key Integration Points in Existing Code

### 1. Location/Position Updates
**File:** app.js (in GPS update handler)

**Old Flow:**
```javascript
state.physicalPosition = newPosition;
loadNearby(); // fetches new items
renderNearbyItemList(); // manual render
```

**New Flow:**
```javascript
state.physicalPosition = newPosition;
loadNearby().then(() => {
  // worldStateChanged event from loadNearby triggers modal render
});
```

**Change in loadNearby():**
```javascript
async function loadNearby() {
  const items = await fetchNearbyItems();
  
  // OLD: Just update state and render
  // state.nearbyItems = items;
  // renderNearbyItemList();
  
  // NEW: Use ItemActions which emits event
  await ItemActions.updateNearbyItems({
    nearbyItems: items,
    userLocation: state.physicalPosition
  });
  // worldStateChanged event triggers modal render automatically
}
```

### 2. Form Submission Handlers
**File:** app.js (item creation form handlers)

Add calls to `ItemActions.placeItemAtLocation()` after successful item creation.

### 3. Item Click Handlers
**File:** app.js (existing nearby items list)

Replace direct API calls with `ItemActions.pickUpItemFromWorld()`.

---

## Migration Path (Recommended Order)

1. **Add EventEmitter class** - No breaking changes, just adds new capability
2. **Add ItemActions module** - No breaking changes, just adds new functions
3. **Wire up Items Modal** - Update how items modal subscribes to changes
4. **Wire up Inventory Modal** - Update how inventory modal subscribes to changes
5. **Wire up Portals Modal** - Update how portals modal subscribes to changes
6. **Update location tracking** - Call `ItemActions.updateNearbyItems()` instead of direct render
7. **Update item placement** - Call `ItemActions.placeItemAtLocation()` instead of direct API calls
8. **Update item removal** - Call `ItemActions.pickUpItemFromWorld()` and `removeFromInventory()`
9. **Remove old direct render calls** - Clean up old `renderNearbyItemList()` calls that are now replaced by events

---

## Testing the Architecture

### Unit Tests (if using Jest or similar)

```javascript
// Test EventEmitter
test('EventEmitter emits to all listeners', () => {
  const emitter = new EventEmitter();
  const listener1 = jest.fn();
  const listener2 = jest.fn();
  
  emitter.on('test', listener1);
  emitter.on('test', listener2);
  emitter.emit('test', { data: 'value' });
  
  expect(listener1).toHaveBeenCalledWith({ data: 'value' });
  expect(listener2).toHaveBeenCalledWith({ data: 'value' });
});

test('EventEmitter removes listener with off()', () => {
  const emitter = new EventEmitter();
  const listener = jest.fn();
  
  emitter.on('test', listener);
  emitter.emit('test', {});
  expect(listener).toHaveBeenCalledTimes(1);
  
  emitter.off('test', listener);
  emitter.emit('test', {});
  expect(listener).toHaveBeenCalledTimes(1); // Still 1, not 2
});
```

### Integration Tests (Manual)

1. **Test pick up flow:**
   - [ ] Open items modal (should show nearby items)
   - [ ] Click pick up button
   - [ ] Item disappears from nearby list
   - [ ] Item appears in inventory modal
   - [ ] Close inventory modal
   - [ ] Reopen items modal - item should be gone
   - [ ] Open inventory modal again - item still there

2. **Test inventory operations:**
   - [ ] Add item to inventory (pick up from world)
   - [ ] Close inventory modal
   - [ ] Reopen - item still there
   - [ ] Delete item from inventory
   - [ ] Reopen - item gone

3. **Test portal selection:**
   - [ ] Click nearby portal (select as local)
   - [ ] Click favorite portal (select as remote)
   - [ ] Check portal selection display updates
   - [ ] Close and reopen modal - selection persists

---

## Debugging Tips

### Log All Events
```javascript
// Add this to enable event logging during development
const originalEmit = eventEmitter.emit.bind(eventEmitter);
eventEmitter.emit = (eventName, data) => {
  console.log(`[EVENT] ${eventName}:`, data);
  return originalEmit(eventName, data);
};
```

### Check Event Subscribers
```javascript
// In browser console
eventEmitter.debug()
// Output: { itemPlaced: 1, inventoryChanged: 2, worldStateChanged: 1, ... }
```

### Test Modal Event Listeners
```javascript
// In browser console - manually open modal
openItemsModal();

// Then simulate world state change
eventEmitter.emit('worldStateChanged', {
  nearbyItems: [],
  displayItems: []
});

// Check if renderNearbyItemList was called (DOM should update)
```

---

## Common Pitfalls

### 1. Forgetting to Unsubscribe
If you don't call `eventEmitter.off()` when closing modals, listeners accumulate and cause memory leaks.

**Solution:** Always store the listener function and unsubscribe in the close handler.

```javascript
// WRONG - creates new function, can't unsubscribe
eventEmitter.on('event', (data) => { ... });

// RIGHT - store reference
const handler = (data) => { ... };
eventEmitter.on('event', handler);
eventEmitter.off('event', handler);
```

### 2. Calling Old Render Functions Directly
If you have old code that calls `renderNearbyItemList()` directly, it will run twice (old direct call + new event listener).

**Solution:** Search for direct render calls and replace with `ItemActions` calls.

### 3. Not Awaiting ItemActions
ItemActions are async but don't block the UI. Make sure error handling is in place.

```javascript
// Good - check result
const result = await ItemActions.pickUpItemFromWorld({...});
if (!result.success) {
  showNotification(result.error);
}

// Bad - ignoring result
ItemActions.pickUpItemFromWorld({...}); // fires but we don't check success
```

### 4. Assuming Event Data Structure
Event data shapes are defined in the architecture docs. Make sure listeners expect the correct structure.

```javascript
// The worldStateChanged event provides:
// { nearbyItems, displayItems }

// So listeners must expect both:
const handler = (data) => {
  const { nearbyItems, displayItems } = data;
  // ...
};

// NOT:
const handler = (items) => { ... }; // Wrong parameter name!
```

---

## Performance Notes

### DOM Rendering
The current implementation does full DOM rebuilds on each event:
```javascript
locationItemsListEl.innerHTML = ''; // Clear
// ... rebuild all items
```

For large item lists, consider optimizations:
- Virtual scrolling (only render visible items)
- Incremental updates (only update changed items)
- Debouncing rapid events

### Memory
Event listeners are stored in the EventEmitter's `_listeners` Map. They're cleaned up when modal closes, so no memory leaks if you follow the unsubscribe pattern.

### Network
`ItemActions` methods make async API calls to the backend. These are the same calls currently made by the old code - just wrapped with event emission.

---

## Future Enhancements

Once the basic architecture is working, consider:

1. **Event Logging** - Subscribe to all events for analytics
2. **Undo/Redo** - Track all ItemActions for easy undo
3. **Offline Support** - Queue ItemActions when offline, replay when online
4. **Real-time Sync** - Broadcast ItemActions via WebSocket to other players
5. **Optimistic Updates** - Update UI immediately, rollback on server error
6. **Batching** - Combine multiple itemRemoved events into single render

