# Quipu Item Operations Architecture - Quick Start (5 Minutes)

## The Problem

Item operations (place, pickup, remove) are scattered throughout the code. When an item changes, multiple functions must be called manually, making it easy to miss updates.

## The Solution

A **three-layer event-driven architecture** that centralizes operations and automatically updates all listening modals.

## Three Layers

```
┌──────────────────────────────────────┐
│ Layer 3: Modal Listeners (UI)        │
│ • Items Modal                        │
│ • Inventory Modal                    │
│ • Portals Modal                      │
│ Subscribe to events → Auto re-render │
└─────────────────┬────────────────────┘
                  │ on() / off()
┌─────────────────▼────────────────────┐
│ Layer 1: EventEmitter (Pub/Sub Bus)  │
│ on() / off() / emit()                │
└─────────────────▲────────────────────┘
                  │ emit()
┌─────────────────┴────────────────────┐
│ Layer 2: ItemActions (Biz Logic)     │
│ • placeItemAtLocation()              │
│ • pickUpItemFromWorld()              │
│ • addToInventory()                   │
│ • And 5 more...                      │
└──────────────────────────────────────┘
```

## How It Works

### Before
```
User clicks button
    ↓
Call API directly
Call renderNearbyItemList()
Call renderInventory()
Manually update state
```

### After
```
User clicks button
    ↓
Call ItemActions.operation()
    ├─ Validates
    ├─ Calls API
    ├─ Updates state
    └─ emit('event')
        ├─ Items modal listens → auto renders
        ├─ Inventory modal listens → auto renders
        └─ Portals modal listens → auto renders
```

## 6 Event Types

1. **itemPlaced** - Something was placed in the world
2. **itemRemoved** - Something was removed
3. **inventoryChanged** - Inventory contents changed
4. **worldStateChanged** - Nearby items changed
5. **portalSelectionChanged** - User selected portals
6. **portalFavoritesChanged** - Favorites list changed

## 8 Operations

```javascript
ItemActions.placeItemAtLocation()      // Place item in world
ItemActions.removeItemFromWorld()      // Delete from world
ItemActions.pickUpItemFromWorld()      // Remove from world + add to inventory
ItemActions.addToInventory()           // Add to inventory
ItemActions.removeFromInventory()      // Remove from inventory
ItemActions.updateNearbyItems()        // Update nearby items list
ItemActions.setPortalSelection()       // Select portals
ItemActions.setPortalFavorites()       // Update favorites
```

## Example: Pick Up Item

```javascript
// 1. User clicks "Pick Up" button
button.addEventListener('click', async () => {
  const result = await ItemActions.pickUpItemFromWorld({
    itemId: item.id,
    location: state.physicalPosition,
    rootId: state.dimensionRootId
  });
  if (!result.success) showError(result.error);
});

// 2. ItemActions:
//    - Calls API to remove from world
//    - Adds to local inventory
//    - emit('itemRemoved')  ← Items Modal re-renders
//    - emit('inventoryChanged')  ← Inventory Modal re-renders

// 3. Result:
//    Item disappears from nearby list
//    Item appears in inventory
```

## 4 Implementation Phases

| Phase | What | Time | Risk |
|-------|------|------|------|
| **1** | Add EventEmitter + ItemActions | 1-2h | None |
| **2** | Wire up modal listeners | 2-3h | Low |
| **3** | Update operations to use ItemActions | 1-2h | Medium |
| **4** | Cleanup old code | 1h | Low |

**Total: 5-8 hours**

## Key Benefits

✅ **Cleaner** - Modals don't need to know about each other
✅ **Testable** - Business logic separate from UI
✅ **Maintainable** - Single place to change operations
✅ **Extensible** - Add features without touching existing code
✅ **Debuggable** - Clear cause-and-effect with events

## Example: Adding a Feature

Old way:
```javascript
// Must change 3 files and update multiple functions
```

New way:
```javascript
// 1. Add to ItemActions
const ItemActions = {
  async newFeature(params) {
    // ... do stuff ...
    eventEmitter.emit('featureHappened', {data});
    return {success: true};
  }
};

// 2. Listen in modal
eventEmitter.on('featureHappened', (data) => {
  renderModal(); // Re-render
});

// 3. Call from button
button.addEventListener('click', async () => {
  const result = await ItemActions.newFeature(params);
  if (!result.success) showError(result.error);
});

// Done! Other modals don't need to change.
```

## What Doesn't Change

- Backend API endpoints (same URLs)
- Storage layer (same format)
- Data models (same structure)
- HTML (no DOM changes)
- Existing features (all work as before)

You're just reorganizing existing code!

## Get Started

1. **Read** `ARCHITECTURE_SUMMARY.md` (10 min) - Understand the concepts
2. **Read** `IMPLEMENTATION_NOTES.md` (20 min) - See the actual code
3. **Use** `IMPLEMENTATION_CHECKLIST.md` - Track your progress
4. **Reference** `ARCHITECTURE.md` - Detailed pseudocode

Start with `ARCHITECTURE_README.md` for navigation.

## Quick Questions

**Q: Will this break existing code?**
A: No. You're adding new code alongside existing code.

**Q: Can I do this incrementally?**
A: Yes! Each phase can be done independently.

**Q: How much existing code changes?**
A: Mostly additions. Maybe 200 lines added, 100 lines modified.

**Q: Is the backend affected?**
A: Not at all. API endpoints stay exactly the same.

**Q: What if something breaks?**
A: Old code can coexist with new code. Easy to revert phase by phase.

## Success Looks Like

- Click button → multiple modals update automatically
- No manual render calls
- No console errors
- All features work
- Code is cleaner and more organized

---

**Ready to implement? Start with `ARCHITECTURE_README.md`**
