# Quipu Item Operations Architecture - Executive Summary

## What This Architecture Solves

**Current Problem:** Item operations (place, pickup, remove) are scattered throughout the codebase. When an item changes, multiple functions must be called manually in the right order, making it easy to miss updates or cause inconsistencies.

**Solution:** A three-layer event-driven architecture that:
1. Centralizes all item operations in `ItemActions` module
2. Uses `EventEmitter` to broadcast changes
3. Lets modals automatically render based on events

**Result:** Add a feature → emit an event → all listening modals update automatically, without touching their code.

---

## Architecture Layers (Bottom to Top)

### Layer 1: EventEmitter (Pub/Sub Bus)
A simple event system with three methods:
- `on(eventName, callback)` - Subscribe to events
- `off(eventName, callback)` - Unsubscribe
- `emit(eventName, data)` - Broadcast an event

**Used by:** Everything else
**Knows about:** Nothing (it's just a message bus)

### Layer 2: ItemActions (Business Logic)
Unified commands for all item operations:
- `placeItemAtLocation()` - Place item in world
- `removeItemFromWorld()` - Delete item from world
- `pickUpItemFromWorld()` - Remove from world + add to inventory
- `addToInventory()` - Add to local inventory
- `removeFromInventory()` - Remove from local inventory
- `updateNearbyItems()` - Update nearby items list
- `setPortalSelection()` - Select portals
- `setPortalFavorites()` - Update favorites

Each operation:
1. Validates inputs
2. Makes API calls (if needed)
3. Updates local state
4. Persists to localStorage
5. **Emits events** for subscribers
6. Returns `{success: bool, error: string | null}`

**Used by:** UI button handlers and other ItemActions
**Calls:** Storage/API, then emits to EventEmitter

### Layer 3: Modal Listeners (UI)
Three modals subscribe to events:
- **Items Modal**: Listens to `worldStateChanged` → calls `renderNearbyItemList()`
- **Inventory Modal**: Listens to `inventoryChanged` → calls `renderInventory()`
- **Portals Modal**: Listens to `portalSelectionChanged` & `portalFavoritesChanged` → calls render functions

Each modal:
1. Opens → subscribe to events
2. Receives event → re-render DOM
3. Closes → unsubscribe from events

**Used by:** User clicks buttons to open/close
**Calls:** ItemActions to make changes, renders when events arrive

---

## Event Types (6 Total)

```javascript
// Emitted when item placed in world
itemPlaced: { item, location, type }

// Emitted when item removed from world or inventory
itemRemoved: { itemId, wasFromWorld, location }

// Emitted when inventory contents change
inventoryChanged: { items }

// Emitted when nearby items change (triggers items modal re-render)
worldStateChanged: { nearbyItems, displayItems }

// Emitted when user selects/deselects portals
portalSelectionChanged: { localId, remoteId }

// Emitted when portal favorites list changes
portalFavoritesChanged: { favorites }
```

---

## Core Interaction Pattern

### How It Works
```
User clicks button
    ↓
Button handler calls ItemActions.operation()
    ↓
ItemActions:
  • Validates
  • Makes API calls
  • Updates state
  • emit('eventName', {data})
    ↓
EventEmitter broadcasts to all subscribed listeners
    ↓
Modal listener receives event
    ↓
Modal calls renderNearbyItemList() or similar
    ↓
User sees updated UI
```

### Example: Pick Up Item

```javascript
// 1. User clicks "Pick Up" button
button.addEventListener('click', async () => {
  const result = await ItemActions.pickUpItemFromWorld({
    itemId: '123',
    location: state.physicalPosition,
    rootId: state.dimensionRootId
  });
  if (!result.success) showNotification(result.error);
});

// 2. ItemActions.pickUpItemFromWorld:
//    - Calls removeItemFromWorld()
//      - API DELETE /api/dimensions/.../items/123
//      - emit('itemRemoved', {itemId, wasFromWorld: true, location})
//    - Calls addToInventory()
//      - state.inventory.push(item)
//      - localStorage.setItem(...)
//      - emit('inventoryChanged', {items})
//    - Returns {success: true}

// 3. itemRemoved event triggers:
//    Items Modal listener → renderNearbyItemList()
//    → Item disappears from DOM

// 4. inventoryChanged event triggers:
//    Inventory Modal listener → renderInventory()
//    → Item appears in inventory DOM

// Result: Item gone from nearby, appears in inventory ✓
```

---

## Migration Path (4 Steps)

### Step 1: Add Infrastructure (No Breaking Changes)
- [ ] Add `EventEmitter` class to app.js
- [ ] Add `ItemActions` module to app.js
- Cost: ~150 lines of code
- Risk: None - just adds new capabilities

### Step 2: Wire Modal Listeners
- [ ] Update items modal: subscribe to `worldStateChanged`
- [ ] Update inventory modal: subscribe to `inventoryChanged`
- [ ] Update portals modal: subscribe to portal events
- Cost: ~100 lines of code
- Risk: Low - replaces existing direct render calls

### Step 3: Update Item Operations
- [ ] Replace item placement calls with `ItemActions.placeItemAtLocation()`
- [ ] Replace item removal with `ItemActions.removeItemFromWorld()` / `pickUpItemFromWorld()`
- [ ] Replace inventory ops with `ItemActions.addToInventory()` / `removeFromInventory()`
- Cost: Update ~10 call sites across app
- Risk: Medium - touches multiple features, but safer with tests

### Step 4: Cleanup (Optional)
- [ ] Remove old direct render calls
- [ ] Remove duplicate state mutation code
- [ ] Add error notifications
- Cost: Refactoring, no new features
- Risk: Low

**Total Time Estimate:** 4-8 hours for full implementation

---

## Key Benefits

### 1. Testability
- Mock EventEmitter to test modal rendering
- Test ItemActions without needing DOM
- Test event flow independently
- No DOM manipulation required for business logic tests

### 2. Maintainability
- Clear data flow: mutation → event → render
- Single place to change operations (ItemActions)
- Easy to find where events are emitted
- Easy to add error handling consistently

### 3. Extensibility
- Add new listeners without touching existing code
- Add new events without affecting existing listeners
- Easy to add analytics (subscribe to all events)
- Easy to add offline support (queue ItemActions)

### 4. Debugging
- All state changes emit events (visible in console)
- Easy to log all events: `eventEmitter.debug()`
- Clear cause-and-effect: action → event → render
- No mysterious DOM updates

### 5. Scalability
- Event system can broadcast to server (WebSocket)
- Can add offline queuing easily
- Can add undo/redo by tracking events
- Can add real-time sync between players

---

## What Doesn't Change

- **Backend API** - All endpoints stay the same
- **Storage layer** - No changes to FileStorage
- **Data models** - ItemDocument, etc. unchanged
- **HTML structure** - No DOM changes needed
- **Existing functionality** - Everything works as before

You're just **reorganizing** existing code, not rewriting features.

---

## Common Patterns

### Opening a Modal (e.g., Items Modal)
```javascript
function openItemsModal() {
  // Subscribe to events
  const handler = (eventData) => renderNearbyItemList(eventData.displayItems);
  eventEmitter.on('worldStateChanged', handler);
  
  // Store unsubscriber for cleanup
  itemsModalUnsubscriber = () => eventEmitter.off('worldStateChanged', handler);
  
  // Show modal
  itemsModalEl.classList.add('open');
  
  // Initial render
  renderNearbyItemList(state.displayItems);
}

function closeItemsModal() {
  // Unsubscribe
  if (itemsModalUnsubscriber) itemsModalUnsubscriber();
  
  // Hide modal
  itemsModalEl.classList.remove('open');
}
```

### Performing an Action (e.g., Pick Up Item)
```javascript
const result = await ItemActions.pickUpItemFromWorld({
  itemId: item.id,
  location: state.physicalPosition,
  rootId: state.dimensionRootId
});

if (!result.success) {
  showNotification(`Error: ${result.error}`);
  return;
}

// If we get here, events have been emitted and modals are rendering
// No need to manually update anything
```

### Adding a New Feature
```javascript
// 1. Add a method to ItemActions
const ItemActions = {
  async newFeature(params) {
    // ... do stuff ...
    eventEmitter.emit('newFeatureHappened', { data });
    return { success: true, error: null };
  }
};

// 2. Add a listener in any modal that cares
eventEmitter.on('newFeatureHappened', (eventData) => {
  // re-render
});

// 3. Call it from UI
button.addEventListener('click', async () => {
  const result = await ItemActions.newFeature(params);
  if (!result.success) showNotification(result.error);
});

// Done! No need to touch other modals or update multiple places.
```

---

## Potential Pitfalls & Solutions

### Pitfall 1: Forgetting to Unsubscribe
**Problem:** Listeners accumulate, memory leaks, events fire multiple times
**Solution:** Always store listener and call `eventEmitter.off()` in close handler

### Pitfall 2: Wrong Event Data Structure
**Problem:** Listener expects different fields than emitted
**Solution:** Define event payloads in comments, copy structure from architecture doc

### Pitfall 3: Assuming Synchronous Events
**Problem:** Trying to immediately check state after calling ItemActions
**Solution:** ItemActions are async; use `await` and check the return value

### Pitfall 4: Multiple Listeners for Same Event
**Problem:** If multiple modals listen to same event, all render
**Solution:** This is intentional! Only open modals should be listening (unsubscribe on close)

### Pitfall 5: Calling Old Render Functions Directly
**Problem:** Render function called twice (old code + new event listener)
**Solution:** Search codebase for direct render calls, replace with ItemActions

---

## Quick Reference: Event Subscriptions

| Modal | Listens To | Calls | Render Function |
|-------|-----------|-------|-----------------|
| **Items Modal** | `worldStateChanged` | `ItemActions.updateNearbyItems()` | `renderNearbyItemList()` |
| **Inventory Modal** | `inventoryChanged` | `ItemActions.addToInventory()`, `removeFromInventory()`, `pickUpItemFromWorld()` | `renderInventory()` |
| **Portals Modal** | `portalSelectionChanged`, `portalFavoritesChanged` | `ItemActions.setPortalSelection()`, `setPortalFavorites()` | `updatePortalSelectionDisplay()`, `renderPortalFavoritesList()` |

---

## Testing Checklist

- [ ] EventEmitter creates without errors
- [ ] `on()` and `off()` work correctly
- [ ] `emit()` calls all registered listeners
- [ ] ItemActions module loads without errors
- [ ] ItemActions methods return `{success, error}`
- [ ] Modal open/close works without errors
- [ ] Modal listeners are registered on open
- [ ] Modal listeners are unregistered on close
- [ ] Events are emitted after ItemActions
- [ ] Modal rerenders when events fire
- [ ] No console errors
- [ ] Complete flow: place → nearby → pickup → inventory
- [ ] Error handling: failed operations show error message
- [ ] No memory leaks: open/close modals many times

---

## Files to Create/Modify

### Files to Modify
- `app/static/app.js` - Add EventEmitter, ItemActions, update modals

### Files NOT to Modify
- `app/main.py` - Endpoints stay the same
- `app/models.py` - Models unchanged
- `app/storage.py` - Storage unchanged
- `app/static/index.html` - HTML structure unchanged

### New Documentation Files (Already Created)
- `ARCHITECTURE.md` - Full detailed design
- `IMPLEMENTATION_NOTES.md` - Code examples
- `ARCHITECTURE_DIAGRAM.md` - Visual diagrams
- `ARCHITECTURE_SUMMARY.md` - This file

---

## Success Definition

The architecture is working when you can:

1. Click a button to perform an action
2. See automatic UI updates in all open modals
3. No manual render calls in button handlers
4. No console errors or warnings
5. All modals update in sync
6. No memory leaks when opening/closing modals

---

## Next Steps

1. **Review** - Read ARCHITECTURE.md for full design
2. **Understand** - Study the concrete code examples in IMPLEMENTATION_NOTES.md
3. **Plan** - Create implementation tasks using the migration path above
4. **Implement** - Follow the 4-step migration path
5. **Test** - Use the testing checklist
6. **Document** - Add JSDoc comments to code

---

## Questions?

### "Do I need to change the backend?"
No. All API endpoints stay the same. ItemActions just wraps existing calls.

### "Can I do this incrementally?"
Yes! You can add EventEmitter and ItemActions without changing anything else, then gradually wire up modals.

### "What if a modal isn't open?"
Unsubscribe when the modal closes. If no listeners are registered, `emit()` does nothing.

### "Can I test this?"
Yes! You can mock EventEmitter, test ItemActions independently, and test event flows without a DOM.

### "Does this break existing code?"
No. You're adding new code alongside existing code. Existing features keep working.

### "How much code needs to change?"
Mostly additions. Maybe 200 lines added, 100 lines modified. No major rewrites.

### "Is this production-ready?"
This is pseudocode/architecture. Implementation will require careful testing and integration. But the pattern is battle-tested (pub/sub is fundamental to many systems).

---

## Related Documents

- **ARCHITECTURE.md** - Deep dive with all pseudocode
- **IMPLEMENTATION_NOTES.md** - Concrete JavaScript examples
- **ARCHITECTURE_DIAGRAM.md** - Visual diagrams and flows

Read these in order: Diagram → Summary (this) → Implementation Notes → Architecture

