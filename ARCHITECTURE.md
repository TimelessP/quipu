# Quipu Item Operations Architecture

## Overview

This document outlines a new event-driven architecture for Quipu's item operations. The design separates concerns into three layers:

1. **EventEmitter** - A simple pub/sub system for broadcasting state changes
2. **ItemActions** - A command layer with unified operations for all item types
3. **Modal Listeners** - Event subscribers that render UI in response to state changes

This architecture decouples item operations from rendering, making the codebase more testable, maintainable, and extensible.

---

## Layer 1: EventEmitter (Simple Pub/Sub System)

### Purpose
Provides a lightweight event system with `emit()`, `on()`, `off()` methods. No state is managed here—it's purely a notification bus.

### Pseudocode Structure

```javascript
class EventEmitter {
  constructor() {
    // Map: eventName -> Set of listener functions
    this._listeners = new Map();
  }

  /**
   * Register a listener for an event.
   * 
   * @param {string} eventName - The event to listen for
   * @param {Function} listener - Callback that receives event data
   * @returns {void}
   */
  on(eventName, listener) {
    // PSEUDOCODE
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, new Set());
    }
    this._listeners.get(eventName).add(listener);
  }

  /**
   * Unregister a listener for an event.
   * 
   * @param {string} eventName - The event to stop listening to
   * @param {Function} listener - The specific listener to remove
   * @returns {void}
   */
  off(eventName, listener) {
    // PSEUDOCODE
    if (!this._listeners.has(eventName)) {
      return;
    }
    this._listeners.get(eventName).delete(listener);
    // Clean up empty sets to prevent memory leaks
    if (this._listeners.get(eventName).size === 0) {
      this._listeners.delete(eventName);
    }
  }

  /**
   * Broadcast an event to all registered listeners.
   * Listeners are called synchronously in registration order.
   * 
   * @param {string} eventName - The event to emit
   * @param {*} data - Data to pass to listeners
   * @returns {void}
   */
  emit(eventName, data) {
    // PSEUDOCODE
    if (!this._listeners.has(eventName)) {
      return;
    }
    for (const listener of this._listeners.get(eventName)) {
      listener(data);
    }
  }
}

// Global singleton instance
const eventEmitter = new EventEmitter();
```

### Usage Example

```javascript
// Subscribe to an event
eventEmitter.on('itemPlaced', (eventData) => {
  console.log('Item placed:', eventData);
});

// Emit an event
eventEmitter.emit('itemPlaced', {
  item: { id: '123', type: 'media' },
  location: { lat: 51.5, lng: -0.1 },
  type: 'media'
});

// Unsubscribe
const handler = (data) => console.log(data);
eventEmitter.on('itemRemoved', handler);
eventEmitter.off('itemRemoved', handler);
```

---

## Layer 2: ItemActions Module

### Purpose
Encapsulates all item operations with a unified interface. Each action:
- Performs business logic validation
- Calls storage APIs
- Invalidates caches
- Emits events for subscribers
- Returns `{success: bool, error: string | null}`

### Event Types Emitted

```javascript
/**
 * itemPlaced
 * Emitted when an item is placed in the world or inventory.
 * 
 * @property {ItemDocument} item - The placed item
 * @property {object} location - {lat, lng} where item was placed
 * @property {string} type - Item type (media, portal_marker, etc.)
 */

/**
 * itemRemoved
 * Emitted when an item is removed from world or inventory.
 * 
 * @property {string} itemId - ID of removed item
 * @property {boolean} wasFromWorld - True if removed from world, false if from inventory
 * @property {object} location - {lat, lng} where item was removed from (world only)
 */

/**
 * inventoryChanged
 * Emitted when inventory contents change (add, remove, or full refresh).
 * 
 * @property {ItemDocument[]} items - Current inventory contents
 */

/**
 * worldStateChanged
 * Emitted when nearby items in the world have changed (e.g., new cell fetched).
 * This should trigger full rerender of the items list.
 * 
 * @property {ItemDocument[]} nearbyItems - All items in nearby cells
 * @property {ItemDocument[]} displayItems - Filtered/processed items ready for display
 */

/**
 * portalSelectionChanged
 * Emitted when portal selection state changes (user picks a local and remote portal).
 * 
 * @property {string|null} localId - ID of selected local portal (or null)
 * @property {string|null} remoteId - ID of selected remote portal (or null)
 */

/**
 * portalFavoritesChanged
 * Emitted when portal favorites list is updated.
 * 
 * @property {object[]} favorites - Array of {id, name, lat, lng}
 */
```

### ItemActions Pseudocode

```javascript
// Namespace for all item operations
const ItemActions = {

  /**
   * Place an item at a location (unified for all item types).
   * 
   * This is the single entry point for placing any item type. It handles:
   * - Type-specific creation logic (delegated to factories)
   * - Cell insertion (spatial indexing)
   * - Cache invalidation
   * - Event emission
   * 
   * @param {object} params
   *   - item: ItemDocument (media, portal_marker, favorite_portal_item, lock_box, visit_counter)
   *   - location: {lat, lng} where to place
   *   - rootId: dimension root ID
   * @returns {Promise<{success: boolean, error: string|null, item?: ItemDocument}>}
   */
  async placeItemAtLocation(params) {
    // PSEUDOCODE
    const { item, location, rootId } = params;

    // Validate location is reachable
    if (!isValidLocation(location)) {
      return { success: false, error: 'Invalid location coordinates' };
    }

    // Type-specific validation
    if (item.type === 'portal_marker') {
      // Check minimum spacing constraint
      const spacing = await checkPortalSpacing(rootId, location);
      if (spacing < MIN_PORTAL_SPACING_METERS) {
        return { success: false, error: `Portal too close (${spacing}m)` };
      }
    }

    // Save to persistent storage
    const saveResult = await storage.saveItem(item);
    if (!saveResult.success) {
      return { success: false, error: 'Storage failed' };
    }

    // Add to spatial index (H3 cell)
    const cellId = h3.latlng_to_cell(location.lat, location.lng, H3_RESOLUTION);
    const cellResult = await storage.addItemToCell(rootId, cellId, item.id);
    if (!cellResult.success) {
      // Rollback: delete the item we just saved
      await storage.deleteItem(item.id);
      return { success: false, error: 'Spatial indexing failed' };
    }

    // Invalidate any cached nearby items for this location
    invalidateNearbyCache(location);

    // Emit event for subscribers
    eventEmitter.emit('itemPlaced', {
      item: item,
      location: location,
      type: item.type
    });

    return { success: true, error: null, item: item };
  },

  /**
   * Remove an item from the world (discard/delete).
   * 
   * Handles:
   * - Validating item exists and belongs to user
   * - Removing from spatial index
   * - Deleting from storage
   * - Cache invalidation
   * - Event emission
   * 
   * @param {object} params
   *   - itemId: string
   *   - location: {lat, lng} where item is currently located
   *   - rootId: dimension root ID
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async removeItemFromWorld(params) {
    // PSEUDOCODE
    const { itemId, location, rootId } = params;

    // Fetch item to verify it exists
    const item = await storage.getItem(itemId);
    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    // Verify ownership (client should enforce, but server validates)
    if (item.owner !== state.ownerId) {
      return { success: false, error: 'You do not own this item' };
    }

    // Remove from spatial index
    const cellId = h3.latlng_to_cell(item.latitude, item.longitude, H3_RESOLUTION);
    const cellRemoveResult = await storage.removeItemFromCell(rootId, cellId, itemId);
    if (!cellRemoveResult.success) {
      return { success: false, error: 'Failed to remove from spatial index' };
    }

    // Delete from storage
    const deleteResult = await storage.deleteItem(itemId);
    if (!deleteResult.success) {
      return { success: false, error: 'Storage deletion failed' };
    }

    // Invalidate nearby cache
    invalidateNearbyCache(location);

    // Emit event
    eventEmitter.emit('itemRemoved', {
      itemId: itemId,
      wasFromWorld: true,
      location: location
    });

    return { success: true, error: null };
  },

  /**
   * Pick up an item from the world (remove from world, add to inventory).
   * 
   * Combines:
   * 1. Remove from world (via removeItemFromWorld)
   * 2. Add to inventory (via addToInventory)
   * 3. Emit unified 'itemRemoved' event
   * 
   * @param {object} params
   *   - itemId: string
   *   - location: {lat, lng} where item is
   *   - rootId: dimension root ID
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async pickUpItemFromWorld(params) {
    // PSEUDOCODE
    const { itemId, location, rootId } = params;

    // Get the item
    const item = await storage.getItem(itemId);
    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    // Remove from world
    const worldRemoveResult = await this.removeItemFromWorld(params);
    if (!worldRemoveResult.success) {
      return worldRemoveResult;
    }

    // Add to inventory (update local state, persist to localStorage)
    const inventoryResult = await this.addToInventory({ item: item });
    if (!inventoryResult.success) {
      // Optionally: rollback and place back in world?
      // For now, just warn and continue
      console.warn('Added to inventory but failed to persist locally');
    }

    // itemRemoved event is already emitted by removeItemFromWorld
    return { success: true, error: null };
  },

  /**
   * Remove an item from inventory (discard locally stored item).
   * 
   * Updates:
   * - Local state.inventory array
   * - localStorage
   * - Emits inventoryChanged event
   * 
   * Note: Does NOT affect server/world; purely client-side.
   * 
   * @param {object} params
   *   - itemId: string
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async removeFromInventory(params) {
    // PSEUDOCODE
    const { itemId } = params;

    // Find and remove from state.inventory
    const index = state.inventory.findIndex(item => item.id === itemId);
    if (index === -1) {
      return { success: false, error: 'Item not in inventory' };
    }

    const removedItem = state.inventory.splice(index, 1)[0];

    // Persist to localStorage
    const persistResult = persistInventoryToStorage();
    if (!persistResult.success) {
      // Rollback: add it back
      state.inventory.splice(index, 0, removedItem);
      return { success: false, error: 'Failed to persist inventory' };
    }

    // Emit event
    eventEmitter.emit('itemRemoved', {
      itemId: itemId,
      wasFromWorld: false,
      location: null
    });

    eventEmitter.emit('inventoryChanged', {
      items: state.inventory
    });

    return { success: true, error: null };
  },

  /**
   * Add an item to inventory (store locally).
   * 
   * Updates:
   * - Local state.inventory array
   * - localStorage
   * - Emits inventoryChanged event
   * 
   * Note: Does NOT affect server/world; purely client-side.
   * 
   * @param {object} params
   *   - item: ItemDocument
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async addToInventory(params) {
    // PSEUDOCODE
    const { item } = params;

    // Validate item
    if (!item || !item.id) {
      return { success: false, error: 'Invalid item' };
    }

    // Check if already in inventory
    const exists = state.inventory.some(inv => inv.id === item.id);
    if (exists) {
      return { success: false, error: 'Item already in inventory' };
    }

    // Add to state
    state.inventory.push(item);

    // Persist to localStorage
    const persistResult = persistInventoryToStorage();
    if (!persistResult.success) {
      // Rollback
      state.inventory.pop();
      return { success: false, error: 'Failed to persist inventory' };
    }

    // Emit event
    eventEmitter.emit('inventoryChanged', {
      items: state.inventory
    });

    return { success: true, error: null };
  },

  /**
   * Update nearby items list (called after fetching new cells).
   * 
   * This is not a "place item" operation, but rather a "render nearby items" trigger.
   * Called when:
   * - User location changes (new cells fetched)
   * - A nearby item is placed/removed
   * 
   * @param {object} params
   *   - nearbyItems: ItemDocument[] (from storage)
   *   - userLocation: {lat, lng}
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async updateNearbyItems(params) {
    // PSEUDOCODE
    const { nearbyItems, userLocation } = params;

    // Filter and process items (e.g., sort by distance)
    const displayItems = nearbyItems
      .map(item => ({
        ...item,
        distance: haversine(userLocation, { lat: item.latitude, lng: item.longitude })
      }))
      .filter(item => item.distance <= PICKUP_RANGE_METERS)
      .sort((a, b) => a.distance - b.distance);

    // Update state
    state.nearbyItems = nearbyItems;
    state.displayItems = displayItems;

    // Emit event (items modal should listen)
    eventEmitter.emit('worldStateChanged', {
      nearbyItems: nearbyItems,
      displayItems: displayItems
    });

    return { success: true, error: null };
  },

  /**
   * Update portal selection state.
   * 
   * Called when user selects a local and/or remote portal in the portal modal.
   * 
   * @param {object} params
   *   - localPortalId: string|null
   *   - remotePortalId: string|null
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async setPortalSelection(params) {
    // PSEUDOCODE
    const { localPortalId, remotePortalId } = params;

    // Update state
    state.selectedLocalPortalId = localPortalId;
    state.selectedRemotePortalId = remotePortalId;

    // Persist if needed (portals modal may use localStorage)
    const persistResult = persistPortalSelectionToStorage();
    if (!persistResult.success) {
      return { success: false, error: 'Failed to persist portal selection' };
    }

    // Emit event
    eventEmitter.emit('portalSelectionChanged', {
      localId: localPortalId,
      remoteId: remotePortalId
    });

    return { success: true, error: null };
  },

  /**
   * Update portal favorites list.
   * 
   * @param {object} params
   *   - favorites: {id, name, lat, lng}[]
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async setPortalFavorites(params) {
    // PSEUDOCODE
    const { favorites } = params;

    // Validate
    if (!Array.isArray(favorites)) {
      return { success: false, error: 'Favorites must be an array' };
    }

    // Update state
    state.portalFavorites = favorites;

    // Persist to localStorage
    const persistResult = persistPortalFavoritesToStorage();
    if (!persistResult.success) {
      return { success: false, error: 'Failed to persist favorites' };
    }

    // Emit event
    eventEmitter.emit('portalFavoritesChanged', {
      favorites: favorites
    });

    return { success: true, error: null };
  },
};
```

---

## Layer 3: Modal Listeners Pattern

### Overview

Modals subscribe to events on startup and unsubscribe on close. This decouples modal rendering from item operations.

### Items Modal (World Items List)

```javascript
/**
 * Items Modal Handler
 * 
 * Listens to: worldStateChanged
 * Renders: List of nearby pickupable items
 */

let itemsModalUnsubscribe = null;

function openItemsModal() {
  // Subscribe to world state changes
  const handleWorldStateChanged = (eventData) => {
    // eventData: { nearbyItems, displayItems }
    renderNearbyItemList(eventData.displayItems);
  };

  eventEmitter.on('worldStateChanged', handleWorldStateChanged);

  // Store unsubscriber for cleanup
  itemsModalUnsubscribe = () => {
    eventEmitter.off('worldStateChanged', handleWorldStateChanged);
  };

  // Show modal element
  itemsModalEl.classList.add('open');
  modalScrimEl.classList.add('open');
}

function closeItemsModal() {
  // Unsubscribe from events
  if (itemsModalUnsubscribe) {
    itemsModalUnsubscribe();
    itemsModalUnsubscribe = null;
  }

  // Hide modal element
  itemsModalEl.classList.remove('open');
  modalScrimEl.classList.remove('open');
}

/**
 * renderNearbyItemList
 * Rebuilds the DOM list of nearby items.
 * Called by worldStateChanged event listener.
 * 
 * @param {ItemDocument[]} displayItems - Filtered items to show
 */
function renderNearbyItemList(displayItems) {
  // PSEUDOCODE
  locationItemsListEl.innerHTML = '';

  if (displayItems.length === 0) {
    locationItemsListEl.innerHTML = '<p>No items nearby</p>';
    return;
  }

  for (const item of displayItems) {
    const el = createItemListElement(item);
    locationItemsListEl.appendChild(el);

    // Attach pick-up handler
    el.addEventListener('click', async () => {
      const result = await ItemActions.pickUpItemFromWorld({
        itemId: item.id,
        location: { lat: item.latitude, lng: item.longitude },
        rootId: state.dimensionRootId
      });

      if (!result.success) {
        showNotification(`Error: ${result.error}`);
      }
      // Success: inventoryChanged event will trigger inventory render
      // and worldStateChanged will re-render this list
    });
  }
}
```

### Inventory Modal

```javascript
/**
 * Inventory Modal Handler
 * 
 * Listens to: inventoryChanged
 * Renders: List of items in local inventory
 */

let inventoryModalUnsubscribe = null;

function openInventoryModal() {
  // Subscribe to inventory changes
  const handleInventoryChanged = (eventData) => {
    // eventData: { items: ItemDocument[] }
    renderInventory(eventData.items);
  };

  eventEmitter.on('inventoryChanged', handleInventoryChanged);

  // Store unsubscriber
  inventoryModalUnsubscribe = () => {
    eventEmitter.off('inventoryChanged', handleInventoryChanged);
  };

  // Initial render
  renderInventory(state.inventory);

  // Show modal
  inventoryItemsListEl.classList.add('open');
}

function closeInventoryModal() {
  if (inventoryModalUnsubscribe) {
    inventoryModalUnsubscribe();
    inventoryModalUnsubscribe = null;
  }

  inventoryItemsListEl.classList.remove('open');
}

/**
 * renderInventory
 * Rebuilds the inventory list DOM.
 * Called by inventoryChanged event listener (and on modal open).
 * 
 * @param {ItemDocument[]} items - Items in inventory
 */
function renderInventory(items) {
  // PSEUDOCODE
  const container = document.getElementById('inventory-items');
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<p>Inventory empty</p>';
    return;
  }

  for (const item of items) {
    const el = createInventoryItemElement(item);
    container.appendChild(el);

    // Attach delete handler
    const deleteButton = el.querySelector('.delete-btn');
    deleteButton.addEventListener('click', async () => {
      const result = await ItemActions.removeFromInventory({
        itemId: item.id
      });

      if (!result.success) {
        showNotification(`Error: ${result.error}`);
      }
      // Success: inventoryChanged event triggers re-render
    });

    // Attach place in world handler
    const placeButton = el.querySelector('.place-btn');
    placeButton.addEventListener('click', async () => {
      const result = await ItemActions.placeItemAtLocation({
        item: item,
        location: state.physicalPosition,
        rootId: state.dimensionRootId
      });

      if (!result.success) {
        showNotification(`Error: ${result.error}`);
      }
      // Success: itemPlaced event emitted, worldStateChanged triggers items list re-render
      // Remove from inventory
      await ItemActions.removeFromInventory({ itemId: item.id });
    });
  }
}
```

### Portals Modal

```javascript
/**
 * Portals Modal Handler
 * 
 * Listens to: portalFavoritesChanged, portalSelectionChanged
 * Renders: Portal selection and favorites list
 */

let portalModalUnsubscribes = [];

function openPortalsModal() {
  // Subscribe to portal changes
  const handlePortalFavoritesChanged = (eventData) => {
    // eventData: { favorites: {id, name, lat, lng}[] }
    renderPortalFavoritesList(eventData.favorites);
  };

  const handlePortalSelectionChanged = (eventData) => {
    // eventData: { localId: string|null, remoteId: string|null }
    updatePortalSelectionDisplay(eventData.localId, eventData.remoteId);
  };

  eventEmitter.on('portalFavoritesChanged', handlePortalFavoritesChanged);
  eventEmitter.on('portalSelectionChanged', handlePortalSelectionChanged);

  // Store unsubscribers
  portalModalUnsubscribes = [
    () => eventEmitter.off('portalFavoritesChanged', handlePortalFavoritesChanged),
    () => eventEmitter.off('portalSelectionChanged', handlePortalSelectionChanged),
  ];

  // Initial render
  renderPortalModal();

  // Show modal
  portalsModalEl.classList.add('open');
}

function closePortalsModal() {
  for (const unsub of portalModalUnsubscribes) {
    unsub();
  }
  portalModalUnsubscribes = [];

  portalsModalEl.classList.remove('open');
}

/**
 * renderPortalModal
 * Full portal modal render (combines portal list, selection, favorites).
 * 
 * Called on modal open and whenever portal state changes.
 */
function renderPortalModal() {
  // PSEUDOCODE
  // 1. Render nearby portals (from state.displayPortals or state.nearbyItems filtered)
  renderNearbyPortalList(state.nearbyItems.filter(i => i.type === 'portal_marker'));

  // 2. Render portal selection display
  updatePortalSelectionDisplay(
    state.selectedLocalPortalId,
    state.selectedRemotePortalId
  );

  // 3. Render favorites list
  renderPortalFavoritesList(state.portalFavorites || []);
}

/**
 * renderNearbyPortalList
 * Renders list of portal markers near player.
 * 
 * @param {PortalMarkerItemDocument[]} portals
 */
function renderNearbyPortalList(portals) {
  // PSEUDOCODE
  const container = document.getElementById('portal-nearby-list');
  container.innerHTML = '';

  if (portals.length === 0) {
    container.innerHTML = '<p>No portals nearby</p>';
    return;
  }

  for (const portal of portals) {
    const el = createPortalListElement(portal);
    container.appendChild(el);

    el.addEventListener('click', async () => {
      // Set as selected local portal
      const result = await ItemActions.setPortalSelection({
        localPortalId: portal.id,
        remotePortalId: state.selectedRemotePortalId
      });

      if (!result.success) {
        showNotification(`Error: ${result.error}`);
      }
      // portalSelectionChanged event triggers updatePortalSelectionDisplay
    });
  }
}

/**
 * updatePortalSelectionDisplay
 * Shows currently selected local and remote portals.
 * 
 * @param {string|null} localId
 * @param {string|null} remoteId
 */
function updatePortalSelectionDisplay(localId, remoteId) {
  // PSEUDOCODE
  const localPortal = localId ? state.nearbyItems.find(i => i.id === localId) : null;
  const remotePortal = remoteId ? state.nearbyItems.find(i => i.id === remoteId) : null;

  // Update UI display elements with selected portals
  const summaryEl = document.getElementById('portal-link-summary');
  if (localPortal && remotePortal) {
    summaryEl.innerHTML = `
      Link: "${localPortal.portal_name}" <-> "${remotePortal.portal_name}"
    `;
  } else if (localPortal) {
    summaryEl.innerHTML = `Selected local: "${localPortal.portal_name}"`;
  } else {
    summaryEl.innerHTML = 'No portals selected';
  }
}

/**
 * renderPortalFavoritesList
 * Renders list of favorite portals.
 * 
 * @param {object[]} favorites - Array of {id, name, lat, lng}
 */
function renderPortalFavoritesList(favorites) {
  // PSEUDOCODE
  const container = portalFavoritesListEl;
  container.innerHTML = '';

  if (favorites.length === 0) {
    container.innerHTML = '<p>No favorite portals saved</p>';
    return;
  }

  for (const fav of favorites) {
    const el = createFavoritePortalElement(fav);
    container.appendChild(el);

    el.addEventListener('click', async () => {
      // Set as selected remote portal
      const result = await ItemActions.setPortalSelection({
        localPortalId: state.selectedLocalPortalId,
        remotePortalId: fav.id
      });

      if (!result.success) {
        showNotification(`Error: ${result.error}`);
      }
    });

    // Attach remove from favorites handler
    const removeBtn = el.querySelector('.remove-btn');
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const updated = favorites.filter(f => f.id !== fav.id);
      const result = await ItemActions.setPortalFavorites({
        favorites: updated
      });

      if (!result.success) {
        showNotification(`Error: ${result.error}`);
      }
      // portalFavoritesChanged event triggers re-render
    });
  }
}
```

---

## Migration Guide: How to Integrate into Existing Code

### Phase 1: Setup (No Breaking Changes)

1. **Add EventEmitter to app.js** (at the top, after state declaration)
   ```javascript
   // Add EventEmitter class and global instance
   const eventEmitter = new EventEmitter();
   ```

2. **Add ItemActions namespace**
   ```javascript
   // Add ItemActions module with all methods (see Layer 2 above)
   const ItemActions = { /* ... */ };
   ```

### Phase 2: Integrate Modal Listeners (Incremental)

1. **Update Items Modal**
   - Replace direct `renderNearbyItemList()` calls with event-driven version
   - Add `openItemsModal()` and `closeItemsModal()` handlers
   - Attach event listener in `openItemsModal()`

   **Before:**
   ```javascript
   // Old: called directly whenever nearby items changed
   async function loadNearby() {
     const items = await fetchNearby();
     state.displayItems = items;
     renderNearbyItemList();  // Direct call
   }
   ```

   **After:**
   ```javascript
   // New: triggered by event
   async function loadNearby() {
     const items = await fetchNearby();
     await ItemActions.updateNearbyItems({
       nearbyItems: items,
       userLocation: state.physicalPosition
     });
     // worldStateChanged event triggers renderNearbyItemList()
   }

   function openItemsModal() {
     eventEmitter.on('worldStateChanged', handleWorldStateChanged);
     // ... show modal
   }
   ```

2. **Update Inventory Modal**
   - Replace direct calls to `renderInventory()` with event-driven version
   - Wire up add/remove inventory operations to use `ItemActions`

   **Before:**
   ```javascript
   // Old: direct state mutation
   state.inventory.push(item);
   saveInventory();
   renderInventory();
   ```

   **After:**
   ```javascript
   // New: delegated to ItemActions
   await ItemActions.addToInventory({ item });
   // inventoryChanged event triggers renderInventory()
   ```

3. **Update Portals Modal**
   - Replace portal selection UI with event-driven version
   - Use `ItemActions.setPortalSelection()` and `setPortalFavorites()`

### Phase 3: Unify Item Placement (Breaking Change, but Planned)

Replace all `POST /api/dimensions/{root_id}/items` calls with `ItemActions.placeItemAtLocation()`:

**Before:**
```javascript
// Old: direct API calls scattered everywhere
const response = await apiFetch('/api/dimensions/...', {
  method: 'POST',
  body: formData
});
const item = await response.json();
// Need to manually update nearby items, invalidate cache, render, etc.
```

**After:**
```javascript
// New: unified action
const result = await ItemActions.placeItemAtLocation({
  item: itemDocument,
  location: state.physicalPosition,
  rootId: state.dimensionRootId
});

// Event system handles rendering updates automatically
```

### Phase 4: Remove Item Operations (Breaking Change)

Replace all direct item removal with `ItemActions.removeItemFromWorld()` or `removeFromInventory()`:

**Before:**
```javascript
// Old: scattered delete logic
await apiFetch(`/api/dimensions/${rootId}/items/${itemId}`, {
  method: 'DELETE'
});
// Manual state update
state.displayItems = state.displayItems.filter(i => i.id !== itemId);
renderNearbyItemList();
```

**After:**
```javascript
// New: unified action
await ItemActions.removeItemFromWorld({
  itemId,
  location: state.physicalPosition,
  rootId: state.dimensionRootId
});

// Event system handles updates
```

---

## Benefits of This Architecture

### Separation of Concerns
- **ItemActions**: Business logic and data mutations
- **EventEmitter**: State change notifications
- **Modal Listeners**: UI rendering in response to events

### Testability
- Mock `eventEmitter.emit()` to test modal rendering
- Test ItemActions without needing DOM
- Test event flow independently

### Extensibility
- Add new listeners without touching existing code
- Add new events without affecting existing listeners
- Easy to log all state changes (add a universal listener)

### Maintainability
- Clear data flow: mutation → event → render
- Single source of truth for each operation
- Easier to add error handling (already in each ItemAction)
- Cache invalidation is explicit and centralized

### Scalability
- Event system can be extended to server sync (WebSocket messages)
- Can add offline queuing (queue ItemActions, replay when online)
- Easy to add analytics (subscribe to all events)

---

## Example: Complete "Pick Up Item" Flow

### User Action
```
User clicks "Pick Up" button on nearby item
  ↓
Button click handler calls:
  ItemActions.pickUpItemFromWorld({itemId, location, rootId})
```

### ItemActions Processing
```
pickUpItemFromWorld()
  ├─ Validates item exists
  ├─ Calls removeItemFromWorld()
  │   ├─ Removes from spatial index (H3 cell)
  │   ├─ Deletes from storage
  │   ├─ Invalidates cache
  │   └─ Emits itemRemoved event
  ├─ Calls addToInventory()
  │   ├─ Adds to state.inventory
  │   ├─ Persists to localStorage
  │   └─ Emits inventoryChanged event
  └─ Returns {success: true}
```

### Event Broadcasting
```
itemRemoved event
  └─ Items modal's listener calls renderNearbyItemList()
       └─ Removes item from DOM, removes pick-up button

inventoryChanged event
  └─ Inventory modal's listener calls renderInventory()
       └─ Adds item to inventory list in DOM
```

### Result
```
User sees:
1. Item disappears from nearby items list
2. Item appears in inventory
```

---

## Implementation Checklist

- [ ] Add EventEmitter class to app.js
- [ ] Add ItemActions module to app.js
- [ ] Create openItemsModal() / closeItemsModal() with event listeners
- [ ] Create openInventoryModal() / closeInventoryModal() with event listeners
- [ ] Create openPortalsModal() / closePortalsModal() with event listeners
- [ ] Update renderNearbyItemList() to be called from event, not directly
- [ ] Update renderInventory() to be called from event, not directly
- [ ] Update renderPortalModal() to be called from event, not directly
- [ ] Wire up item placement to use ItemActions.placeItemAtLocation()
- [ ] Wire up item removal to use ItemActions.removeItemFromWorld()
- [ ] Wire up inventory operations to use ItemActions
- [ ] Test full flow: place → nearby render → pick up → inventory render → remove → nearby render
- [ ] Add error notifications for failed operations
- [ ] Document event payloads in code comments
- [ ] Add optional event logging/debugging (log all emitted events in dev mode)

---

## Performance Considerations

### Event Emission
- Events are emitted synchronously (caller waits for all listeners)
- Consider debouncing rapid events if performance becomes an issue
- Can be easily switched to async/queued if needed

### DOM Rendering
- Each event listener does a full DOM rebuild (innerHTML = '')
- If modal has many items, consider:
  - Virtual scrolling (render only visible items)
  - Incremental updates (only update changed items) via event data
  - Memoization of list elements

### Cache Invalidation
- `invalidateNearbyCache()` currently just clears the cache
- Consider time-based TTL (cache expires after N seconds)
- Consider distance-based TTL (cache expires if user moves >X meters)

---

## Future Extensions

### 1. Logging & Analytics
```javascript
// Add a universal logger
const analyticsListener = (eventName, data) => {
  console.log(`[EVENT] ${eventName}`, data);
  // Send to analytics service
};

// Subscribe to all events
const allEventTypes = ['itemPlaced', 'itemRemoved', 'inventoryChanged', ...];
for (const event of allEventTypes) {
  eventEmitter.on(event, (data) => analyticsListener(event, data));
}
```

### 2. Undo/Redo
```javascript
// Track all ItemActions
const history = [];
const originalEmit = itemEmitter.emit.bind(itemEmitter);
itemEmitter.emit = (eventName, data) => {
  history.push({ event: eventName, data, timestamp: Date.now() });
  return originalEmit(eventName, data);
};

function undo() {
  const last = history.pop();
  // Replay inverse operation
}
```

### 3. Offline Queuing
```javascript
// Queue ItemActions when offline, replay when online
let pendingActions = [];

async function queueAction(action, params) {
  if (!navigator.onLine) {
    pendingActions.push({ action, params });
    localStorage.setItem('pendingActions', JSON.stringify(pendingActions));
  } else {
    await action(params);
  }
}

window.addEventListener('online', async () => {
  while (pendingActions.length > 0) {
    const { action, params } = pendingActions.shift();
    await action(params);
  }
});
```

### 4. Server Sync
```javascript
// Emit ItemActions to server via WebSocket for real-time sync
const wsEmit = itemEmitter.emit.bind(itemEmitter);
itemEmitter.emit = (eventName, data) => {
  wsEmit(eventName, data);
  // Also send to server for sync
  websocket.send(JSON.stringify({ type: eventName, data }));
};
```

