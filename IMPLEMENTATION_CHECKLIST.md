# Quipu Item Operations Architecture - Implementation Checklist

Use this checklist to track implementation progress.

## Phase 1: Infrastructure Setup (Estimated: 1-2 hours)

### EventEmitter Class
- [ ] Create EventEmitter class in app.js
  - [ ] Constructor with `_listeners` Map
  - [ ] `on(eventName, listener)` method
  - [ ] `off(eventName, listener)` method
  - [ ] `emit(eventName, data)` method
  - [ ] Optional: `debug()` and `clear()` helper methods
- [ ] Create global `eventEmitter` instance
- [ ] Test EventEmitter independently
  - [ ] Test `on()` subscribes listener
  - [ ] Test `off()` unsubscribes listener
  - [ ] Test `emit()` calls all listeners
  - [ ] Test listener receives correct data
  - [ ] Test unsubscribed listener doesn't get called

### ItemActions Module
- [ ] Create ItemActions object in app.js
- [ ] Implement `placeItemAtLocation(params)`
  - [ ] Validate inputs
  - [ ] Call API
  - [ ] emit('itemPlaced')
  - [ ] Return {success, error, item}
- [ ] Implement `removeItemFromWorld(params)`
  - [ ] Validate item exists
  - [ ] Call API
  - [ ] emit('itemRemoved')
  - [ ] Return {success, error}
- [ ] Implement `pickUpItemFromWorld(params)`
  - [ ] Call removeItemFromWorld()
  - [ ] Call addToInventory()
  - [ ] Return {success, error}
- [ ] Implement `addToInventory(params)`
  - [ ] Validate item
  - [ ] Add to state.inventory
  - [ ] Persist to localStorage
  - [ ] emit('inventoryChanged')
  - [ ] Return {success, error}
- [ ] Implement `removeFromInventory(params)`
  - [ ] Find and remove item
  - [ ] Persist to localStorage
  - [ ] emit('itemRemoved', 'inventoryChanged')
  - [ ] Return {success, error}
- [ ] Implement `updateNearbyItems(params)`
  - [ ] Filter items by distance
  - [ ] Sort by distance
  - [ ] Update state
  - [ ] emit('worldStateChanged')
  - [ ] Return {success, error}
- [ ] Implement `setPortalSelection(params)`
  - [ ] Update state
  - [ ] emit('portalSelectionChanged')
  - [ ] Return {success, error}
- [ ] Implement `setPortalFavorites(params)`
  - [ ] Validate favorites array
  - [ ] Update state
  - [ ] Persist to localStorage
  - [ ] emit('portalFavoritesChanged')
  - [ ] Return {success, error}

### Testing Phase 1
- [ ] No console errors
- [ ] ItemActions methods callable
- [ ] Each method returns {success, error}
- [ ] Events are emitted from ItemActions

---

## Phase 2: Modal Listeners (Estimated: 2-3 hours)

### Items Modal
- [ ] Create `openItemsModal()` function
  - [ ] Define event listener function
  - [ ] Store listener reference for cleanup
  - [ ] Call `eventEmitter.on('worldStateChanged', listener)`
  - [ ] Show modal element
  - [ ] Call initial `renderNearbyItemList(state.displayItems)`
- [ ] Create `closeItemsModal()` function
  - [ ] Call `eventEmitter.off('worldStateChanged', listener)`
  - [ ] Clear listener reference
  - [ ] Hide modal element
- [ ] Wire button to open modal
  - [ ] Find location add item button
  - [ ] Add click listener calling openItemsModal()
- [ ] Wire modal close handlers
  - [ ] Modal background click closes modal
  - [ ] Keyboard escape closes modal (if applicable)
- [ ] Test Items Modal
  - [ ] Modal opens without errors
  - [ ] Listener registered (check eventEmitter.debug())
  - [ ] renderNearbyItemList called on open
  - [ ] Modal closes without errors
  - [ ] Listener unregistered on close

### Inventory Modal
- [ ] Create `openInventoryModal()` function
  - [ ] Define event listener function
  - [ ] Store listener reference
  - [ ] Call `eventEmitter.on('inventoryChanged', listener)`
  - [ ] Show modal element
  - [ ] Call initial `renderInventory(state.inventory)`
- [ ] Create `closeInventoryModal()` function
  - [ ] Call `eventEmitter.off('inventoryChanged', listener)`
  - [ ] Clear listener reference
  - [ ] Hide modal element
- [ ] Wire button to open modal
  - [ ] Find inventory add item button
  - [ ] Add click listener
- [ ] Wire modal close handlers
  - [ ] Background click closes modal
  - [ ] Keyboard escape closes modal (if applicable)
- [ ] Test Inventory Modal
  - [ ] Modal opens without errors
  - [ ] Listener registered
  - [ ] renderInventory called on open
  - [ ] Modal closes without errors
  - [ ] Listener unregistered

### Portals Modal
- [ ] Create `openPortalsModal()` function
  - [ ] Define two event listener functions
  - [ ] Store listener references
  - [ ] Call `eventEmitter.on('portalSelectionChanged', listener1)`
  - [ ] Call `eventEmitter.on('portalFavoritesChanged', listener2)`
  - [ ] Show modal element
  - [ ] Call initial `renderPortalModal()`
- [ ] Create `closePortalsModal()` function
  - [ ] Call `eventEmitter.off()` for both listeners
  - [ ] Clear listener references
  - [ ] Hide modal element
- [ ] Wire button to open modal
- [ ] Wire modal close handlers
- [ ] Test Portals Modal
  - [ ] Modal opens without errors
  - [ ] Both listeners registered
  - [ ] renderPortalModal called on open
  - [ ] Modal closes without errors
  - [ ] Both listeners unregistered

### Testing Phase 2
- [ ] All three modals open/close without errors
- [ ] No memory leaks (open/close 10 times, check DevTools)
- [ ] Listeners are registered (eventEmitter.debug() shows entries)
- [ ] Listeners are unregistered on close
- [ ] No console errors

---

## Phase 3: Integration with Existing Code (Estimated: 1-2 hours)

### Item Placement Integration
- [ ] Find all `POST /api/dimensions/{root_id}/items` calls
- [ ] For each call:
  - [ ] Create ItemDocument from form data
  - [ ] Call `ItemActions.placeItemAtLocation({item, location, rootId})`
  - [ ] Check result for success/error
  - [ ] Show error notification if failed
  - [ ] Remove old state mutation code
  - [ ] Remove old renderNearbyItemList() calls
- [ ] Update location change handler
  - [ ] Call `ItemActions.updateNearbyItems()` after fetching items
  - [ ] Remove old renderNearbyItemList() call
- [ ] Test item placement
  - [ ] [ ] Place item from form
  - [ ] [ ] Item appears in nearby items modal (auto-renders from event)
  - [ ] [ ] Error shown if placement fails

### Item Pickup Integration
- [ ] Find all item pickup/delete handlers
- [ ] For each handler:
  - [ ] Call `ItemActions.pickUpItemFromWorld({itemId, location, rootId})`
  - [ ] Check result for success/error
  - [ ] Show error notification if failed
  - [ ] Remove old API call
  - [ ] Remove old state mutation code
  - [ ] Remove old render calls
- [ ] Test item pickup
  - [ ] [ ] Click pickup button
  - [ ] [ ] Item disappears from nearby list (auto-renders from itemRemoved event)
  - [ ] [ ] Item appears in inventory (auto-renders from inventoryChanged event)
  - [ ] [ ] Error shown if pickup fails

### Inventory Integration
- [ ] Find all inventory add handlers
  - [ ] Replace with `ItemActions.addToInventory({item})`
  - [ ] Remove old state mutations
  - [ ] Remove old renderInventory() calls
- [ ] Find all inventory remove handlers
  - [ ] Replace with `ItemActions.removeFromInventory({itemId})`
  - [ ] Remove old state mutations
  - [ ] Remove old render calls
- [ ] Test inventory operations
  - [ ] [ ] Add item to inventory
  - [ ] [ ] Inventory modal shows item (auto-renders)
  - [ ] [ ] Remove item from inventory
  - [ ] [ ] Inventory modal updates (auto-renders)

### Portal Integration
- [ ] Find all portal selection handlers
  - [ ] Replace with `ItemActions.setPortalSelection({localPortalId, remotePortalId})`
  - [ ] Remove old state mutations
  - [ ] Remove old render calls
- [ ] Find all portal favorites handlers
  - [ ] Replace with `ItemActions.setPortalFavorites({favorites})`
  - [ ] Remove old state mutations
  - [ ] Remove old render calls
- [ ] Test portal operations
  - [ ] [ ] Select portal
  - [ ] [ ] Selection updates in modal (auto-renders)
  - [ ] [ ] Update favorites
  - [ ] [ ] Favorites list updates (auto-renders)

### Testing Phase 3
- [ ] Complete item placement flow
  - [ ] [ ] Open items form
  - [ ] [ ] Fill form
  - [ ] [ ] Submit
  - [ ] [ ] Item appears in nearby list automatically
  - [ ] [ ] Error handled if placement fails
- [ ] Complete item pickup flow
  - [ ] [ ] Item visible in nearby list
  - [ ] [ ] Click pickup
  - [ ] [ ] Item disappears from nearby
  - [ ] [ ] Item appears in inventory
  - [ ] [ ] Error handled if pickup fails
- [ ] Complete inventory flow
  - [ ] [ ] Open inventory modal
  - [ ] [ ] Modal shows items
  - [ ] [ ] Remove item
  - [ ] [ ] Inventory updates automatically
  - [ ] [ ] Place item from inventory
  - [ ] [ ] Item appears in world and nearby list
- [ ] Complete portal flow
  - [ ] [ ] Select local portal
  - [ ] [ ] Selection displays in modal
  - [ ] [ ] Select remote portal
  - [ ] [ ] Link displays
  - [ ] [ ] Add to favorites
  - [ ] [ ] Favorites list updates
- [ ] No console errors
- [ ] No broken existing features

---

## Phase 4: Cleanup & Optimization (Estimated: 1 hour)

### Code Cleanup
- [ ] Search for and remove old render() direct calls
- [ ] Search for and remove old state mutations (replaced by ItemActions)
- [ ] Search for and remove old cache invalidation code (now in ItemActions)
- [ ] Remove any duplicate code
- [ ] Check for unused variables

### Error Handling
- [ ] ItemActions errors show in UI
  - [ ] Add `showNotification()` calls for all errors
  - [ ] Test error paths
- [ ] Network errors handled
- [ ] Validation errors shown to user

### Documentation
- [ ] Add JSDoc comments to EventEmitter
- [ ] Add JSDoc comments to ItemActions methods
- [ ] Add JSDoc comments to modal functions
- [ ] Document event payloads in code
- [ ] Update existing code comments

### Performance Review
- [ ] Check for event listener leaks (open/close modals 20 times)
- [ ] Check for memory leaks in DevTools
- [ ] Check for redundant DOM updates
- [ ] Check for redundant API calls
- [ ] Consider debouncing if rapid events cause issues

### Testing Phase 4
- [ ] No console errors or warnings
- [ ] No memory leaks
- [ ] All features work as before
- [ ] New event system works reliably
- [ ] Code is documented

---

## Post-Implementation Tasks

### Monitoring
- [ ] Add event logging for debugging
  - [ ] Optional: log all events in dev mode
  - [ ] Check event.emitter.debug() in console
- [ ] Monitor error rates in production
- [ ] Monitor performance metrics

### Future Enhancements
- [ ] Plan: Add event logging to analytics
- [ ] Plan: Add undo/redo system
- [ ] Plan: Add offline support
- [ ] Plan: Add real-time sync
- [ ] Plan: Add server-side event broadcast

### Documentation Updates
- [ ] Update user-facing docs if UI changed
- [ ] Update API docs if endpoints changed
- [ ] Update deployment docs
- [ ] Add troubleshooting guide

---

## Rollback Plan (If Needed)

If issues occur, you can rollback by:

1. Keep the EventEmitter and ItemActions code (it's additive)
2. Remove modal listener subscriptions
3. Restore old direct render calls
4. Restore old API call patterns

The architecture is designed to be backwards compatible, so old code can coexist with new code.

---

## Sign-Off

- [ ] All phases complete
- [ ] All tests pass
- [ ] No console errors
- [ ] No memory leaks
- [ ] Features work as before
- [ ] New event system reliable
- [ ] Code documented
- [ ] Ready for production

**Implementation Start Date:** _______________
**Phase 1 Complete Date:** _______________
**Phase 2 Complete Date:** _______________
**Phase 3 Complete Date:** _______________
**Phase 4 Complete Date:** _______________
**Overall Complete Date:** _______________

---

## Notes & Issues

```
Use this section to track issues, blockers, or notes during implementation:

Issue #1:
[Description]
Resolution:
[How it was resolved]

Issue #2:
[Description]
Resolution:
[How it was resolved]
```

---

## Common Mistakes to Avoid

- [ ] **Forgetting to unsubscribe** - Always call eventEmitter.off() in close handlers
- [ ] **Wrong event names** - Use exact names from ARCHITECTURE.md
- [ ] **Wrong event data** - Check structure in ARCHITECTURE_SUMMARY.md
- [ ] **Direct DOM manipulation** - Use render functions, not direct DOM changes
- [ ] **Old code still running** - Search for old renderNearbyItemList() calls
- [ ] **No error handling** - Always check ItemActions return value
- [ ] **Async/await confusion** - ItemActions are async, use await
- [ ] **Multiple listeners for same event** - Ok, but only if modals are open
- [ ] **Creating listeners in loops** - Create once, use many times
- [ ] **Not persisting to localStorage** - Do it in ItemActions, not in modals

---

## Useful Debugging Commands

Run these in browser console:

```javascript
// See all registered event listeners
eventEmitter.debug()

// Manually emit an event
eventEmitter.emit('worldStateChanged', {
  nearbyItems: state.nearbyItems,
  displayItems: state.displayItems
});

// Test a specific ItemAction
await ItemActions.addToInventory({ item: state.nearbyItems[0] });

// Check if modal listeners are registered
eventEmitter.debug();  // Should show entries while modals are open

// Manually call render
renderNearbyItemList(state.displayItems);
renderInventory(state.inventory);
renderPortalModal();
```

---

## Quick Reference

### Commands to Remember
- `openItemsModal()` / `closeItemsModal()`
- `openInventoryModal()` / `closeInventoryModal()`
- `openPortalsModal()` / `closePortalsModal()`
- `eventEmitter.on(event, handler)`
- `eventEmitter.off(event, handler)`
- `eventEmitter.emit(event, data)`
- `await ItemActions.placeItemAtLocation(params)`
- `await ItemActions.pickUpItemFromWorld(params)`
- `await ItemActions.addToInventory(params)`

### Event Names
- `itemPlaced`
- `itemRemoved`
- `inventoryChanged`
- `worldStateChanged`
- `portalSelectionChanged`
- `portalFavoritesChanged`

### ItemActions Methods
- `placeItemAtLocation()`
- `removeItemFromWorld()`
- `pickUpItemFromWorld()`
- `addToInventory()`
- `removeFromInventory()`
- `updateNearbyItems()`
- `setPortalSelection()`
- `setPortalFavorites()`

