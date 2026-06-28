# Quipu Item Operations: Architecture Diagram

## Three-Layer Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         USER INTERACTIONS                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Click "Pick  │  │ Click "Add   │  │ Click Portal │  │ Scroll      │   │
│  │  Up Item"    │  │  to Inventory"│ │ Favorite"    │  │  Inventory  │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘   │
└─────────┼──────────────────┼──────────────────┼──────────────────┼──────────┘
          │                  │                  │                  │
          │ Button handler   │ Button handler   │ Button handler   │ Event
          │ triggers         │ triggers         │ triggers         │ listener
          ▼                  ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LAYER 2: ItemActions (Business Logic)                     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ pickUpItemFromWorld({itemId, location, rootId})                       │ │
│  │   1. Validates item exists                                            │ │
│  │   2. Calls API to remove from world                                   │ │
│  │   3. Updates local inventory state                                    │ │
│  │   4. Persists inventory to localStorage                               │ │
│  │   5. Emits: itemRemoved, inventoryChanged                             │ │
│  │   6. Returns {success: bool, error: string|null}                      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ addToInventory({item})                                               │ │
│  │   1. Validates item                                                  │ │
│  │   2. Adds to state.inventory                                         │ │
│  │   3. Persists to localStorage                                        │ │
│  │   4. Emits: inventoryChanged                                         │ │
│  │   5. Returns {success, error}                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ placeItemAtLocation({item, location, rootId})                        │ │
│  │   1. Validates location and type-specific rules                      │ │
│  │   2. Calls API to save item to world                                 │ │
│  │   3. Invalidates nearby cache                                        │ │
│  │   4. Emits: itemPlaced                                               │ │
│  │   5. Returns {success, error, item}                                  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ removeItemFromWorld({itemId, location, rootId})                      │ │
│  │   1. Fetches item, validates ownership                               │ │
│  │   2. Calls API to delete from world                                  │ │
│  │   3. Invalidates nearby cache                                        │ │
│  │   4. Emits: itemRemoved                                              │ │
│  │   5. Returns {success, error}                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ updateNearbyItems({nearbyItems, userLocation})                       │ │
│  │   1. Filters and sorts items by distance                             │ │
│  │   2. Updates state.nearbyItems and state.displayItems                │ │
│  │   3. Emits: worldStateChanged                                        │ │
│  │   4. Returns {success, error}                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ setPortalSelection({localPortalId, remotePortalId})                  │ │
│  │   1. Updates state.selectedLocalPortalId/remotePortalId              │ │
│  │   2. Emits: portalSelectionChanged                                   │ │
│  │   3. Returns {success, error}                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ setPortalFavorites({favorites})                                      │ │
│  │   1. Updates state.portalFavorites                                   │ │
│  │   2. Persists to localStorage                                        │ │
│  │   3. Emits: portalFavoritesChanged                                   │ │
│  │   4. Returns {success, error}                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               │ emit()
                               │
┌──────────────────────────────▼──────────────────────────────────────────────┐
│                   LAYER 1: EventEmitter (Pub/Sub Bus)                       │
│                                                                              │
│  Events broadcast to all subscribers:                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ • itemPlaced {item, location, type}                                 │  │
│  │ • itemRemoved {itemId, wasFromWorld, location}                      │  │
│  │ • inventoryChanged {items}                                          │  │
│  │ • worldStateChanged {nearbyItems, displayItems}                     │  │
│  │ • portalSelectionChanged {localId, remoteId}                        │  │
│  │ • portalFavoritesChanged {favorites}                                │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────┬──────────────────────────┬──────────────────────────┘
                       │                          │
                       │ on()                     │ on()
                       │                          │
        ┌──────────────▼────────────┐   ┌────────▼────────────────────────┐
        │                           │   │                                 │
┌───────▼──────────────────────┐   │   │   ┌────────────────────────────▼──┐
│  LAYER 3: Items Modal        │   │   │   │  Inventory Modal             │
├──────────────────────────────┤   │   │   ├─────────────────────────────┤
│ Listens: worldStateChanged   │   │   │   │ Listens: inventoryChanged   │
│ Renders: nearbyItemList      │   │   │   │ Renders: inventory items    │
│ Show: Pickupable items       │   │   │   │ Show: Carried items         │
│                              │   │   │   │                             │
│ Handler:                     │   │   │   │ Handler:                    │
│   renderNearbyItemList(      │   │   │   │   renderInventory(          │
│     eventData.displayItems   │   │   │   │     eventData.items)        │
│   )                          │   │   │   │                             │
└──────────────────────────────┘   │   │   └─────────────────────────────┘
                                   │   │
                                   │   └────────────────────────────────┐
                                   │                                    │
                                   └───────────────────────┬────────────┤
                                                          │            │
                        ┌─────────────────────────────────▼──┐   ┌──────▼─────────┐
                        │    Portals Modal                 │   │  (Future:      │
                        ├──────────────────────────────────┤   │   Analytics,   │
                        │ Listens:                         │   │   Logging,     │
                        │   • portalSelectionChanged       │   │   Undo/Redo)   │
                        │   • portalFavoritesChanged       │   └────────────────┘
                        │ Renders:                         │
                        │   • nearby portals list          │
                        │   • portal selection display     │
                        │   • portal favorites list        │
                        │                                  │
                        │ Handlers:                        │
                        │   updatePortalSelectionDisplay() │
                        │   renderPortalFavoritesList()    │
                        └──────────────────────────────────┘
```

---

## Complete Data Flow: "Pick Up Item" Example

```
1. USER CLICKS "PICK UP" BUTTON
   │
   ├─► Button click handler calls:
   │   await ItemActions.pickUpItemFromWorld({
   │     itemId: '123',
   │     location: { lat: 51.5, lng: -0.1 },
   │     rootId: 'root-abc'
   │   })
   │
2. ITEMACTIONS PROCESSING
   │
   ├─► Fetches item data: GET /api/items/123
   │
   ├─► Calls removeItemFromWorld():
   │   ├─► DELETE /api/dimensions/root-abc/items/123
   │   ├─► Invalidates cache
   │   └─► emit('itemRemoved', {itemId, wasFromWorld: true, location})
   │
   ├─► Calls addToInventory():
   │   ├─► state.inventory.push(item)
   │   ├─► localStorage.setItem(inventoryKey, JSON.stringify(...))
   │   └─► emit('inventoryChanged', {items: state.inventory})
   │
   └─► Returns {success: true}
       │
3. EVENTS BROADCAST TO SUBSCRIBERS
   │
   ├─► itemRemoved event:
   │   └─► Items Modal listener calls renderNearbyItemList()
   │       └─► DOM: Item disappears from nearby list
   │
   └─► inventoryChanged event:
       └─► Inventory Modal listener calls renderInventory()
           └─► DOM: Item appears in inventory list

4. USER SEES
   ├─► Item gone from "Nearby Items" modal
   └─► Item appears in "Inventory" modal
```

---

## Data Flow Diagram: State Changes → Events → Rendering

```
┌─────────────────────┐
│  STATE MUTATION     │
│  (in ItemActions)   │
│                     │
│ state.inventory     │
│ state.displayItems  │
│ state.portalFavs    │
│ state.selectedLocal │
│ state.selectedRemote│
└──────────┬──────────┘
           │
           │ Always followed by emit()
           ▼
┌─────────────────────────────────────┐
│  EVENT EMISSION (EventEmitter)      │
│                                     │
│  emit('eventName', {data: ...})    │
│                                     │
│  Events emitted:                    │
│  • itemPlaced                       │
│  • itemRemoved                      │
│  • inventoryChanged                 │
│  • worldStateChanged                │
│  • portalSelectionChanged           │
│  • portalFavoritesChanged           │
└──────────┬──────────────────────────┘
           │
           │ Calls all registered listeners synchronously
           │
    ┌──────┴─────────┬─────────────┬─────────────┐
    │                │             │             │
    ▼                ▼             ▼             ▼
┌─────────┐    ┌──────────┐   ┌──────────┐  ┌────────────┐
│Items    │    │Inventory │   │ Portals  │  │  (Future:  │
│Modal    │    │ Modal    │   │ Modal    │  │  Analytics)│
│Handler  │    │Handler   │   │Handler   │  └────────────┘
└────┬────┘    └────┬─────┘   └────┬─────┘
     │              │              │
     │ if open      │ if open      │ if open
     │              │              │
     ▼              ▼              ▼
┌──────────────────────────────────────────────┐
│  RENDER FUNCTIONS (DOM Updates)              │
│                                              │
│  renderNearbyItemList()                      │
│    → Clear locationItemsListEl               │
│    → Rebuild with current displayItems       │
│                                              │
│  renderInventory()                           │
│    → Clear inventoryItemsListEl              │
│    → Rebuild with current inventory          │
│                                              │
│  updatePortalSelectionDisplay()              │
│    → Update portal selection summary         │
│                                              │
│  renderPortalFavoritesList()                 │
│    → Rebuild favorites list in DOM           │
└──────────────────────────────────────────────┘
```

---

## Key Principles

### 1. Single Responsibility
- **ItemActions**: Business logic & mutations only
- **EventEmitter**: Notification bus only
- **Modal Listeners**: UI rendering only

### 2. Decoupling
- ItemActions don't know about modals
- Modals don't know about each other
- EventEmitter is just a dumb message bus

### 3. Unidirectional Data Flow
```
User Action → ItemActions → Event → Modal Listener → DOM Render
```

Not:
```
User Action → DOM directly ✗
User Action → ItemActions → Direct DOM manipulation ✗
Modal directly mutating state ✗
```

### 4. Event-Driven Updates
- Modals don't poll for changes
- Modals don't call functions directly
- Modals subscribe to events and react

---

## Event Sequence Diagrams

### Pick Up Item Sequence

```
┌──────────┐              ┌──────────────┐          ┌────────────┐
│   User   │              │ ItemActions  │          │ EventEmitter
│          │              │              │          │
│──────────┼──────────────┼──────────────┼──────────┼──────────
│          │              │              │          │
│ Click    │              │              │          │
│ Pick Up  │──────────────────────────────────────────────────>
│          │  pickUpItemFromWorld()      │          │
│          │              │              │          │
│          │              │ Fetch item   │          │
│          │              │ from API     │          │
│          │              │              │          │
│          │              │ Remove from  │          │
│          │              │ world API    │          │
│          │              │              │          │
│          │              │ Add to local │          │
│          │              │ inventory    │          │
│          │              │              │          │
│          │              │ itemRemoved  │          │
│          │              │ event        │──────────────────────>
│          │              │              │                      │
│          │              │ inventory    │                      │
│          │              │ Changed      │──────────────────────>
│          │              │ event        │          │
│          │              │              │          │
│          │<─────────────────────────────────────────────────
│          │   {success}  │              │          │
│          │              │              │          │
│──────────────────────────────────────────────────────────────
```

### Place Item Sequence

```
┌──────────┐              ┌──────────────┐          ┌────────────┐
│   User   │              │ ItemActions  │          │ EventEmitter
│          │              │              │          │
│ Submit   │              │              │          │
│ Form     │──────────────────────────────────────────────────>
│          │ placeItemAtLocation()       │          │
│          │              │              │          │
│          │              │ Save to API  │          │
│          │              │              │          │
│          │              │ itemPlaced   │          │
│          │              │ event        │──────────────────────>
│          │              │              │                      │
│          │              │ worldState   │                      │
│          │              │ Changed      │──────────────────────>
│          │              │ event        │          │
│          │<─────────────────────────────────────────────────
│          │   {success}  │              │          │
│          │              │              │          │
└──────────┘              └──────────────┘          └────────────┘
```

---

## Component Interaction Matrix

|          | EventEmitter | ItemActions | Items Modal | Inventory Modal | Portals Modal |
|----------|:------------:|:-----------:|:-----------:|:---------------:|:-------------:|
| **EventEmitter** | - | Emitted by | Subscribes | Subscribes | Subscribes |
| **ItemActions** | Emits to | - | Calls | Calls | Calls |
| **Items Modal** | Listens | Calls | - | Independent | Independent |
| **Inventory Modal** | Listens | Calls | Independent | - | Independent |
| **Portals Modal** | Listens | Calls | Independent | Independent | - |

---

## State Diagram: Items Modal Lifecycle

```
                 ┌──────────┐
                 │  Closed  │
                 └────┬─────┘
                      │
                      │ openItemsModal()
                      │ • eventEmitter.on('worldStateChanged')
                      │ • renderNearbyItemList(current state)
                      ▼
              ┌────────────────┐
              │  Open/Active   │
              │                │
              │ Listens to:    │
              │ worldStateChanged
              └────┬───────┬──┬┘
                   │       │  │
        Keyboard   │   API  │  │ Event: worldStateChanged
        Escape     │ Update │  │ from ItemActions
                   │       │  │
                   │       │  ├─► renderNearbyItemList()
                   │       │  │    updates DOM
                   │       │  │
                   │       └──┘
                   │
                   │ closeItemsModal()
                   │ • eventEmitter.off('worldStateChanged')
                   │ • DOM hidden
                   ▼
              ┌──────────┐
              │  Closed  │
              └──────────┘
```

---

## Benefits Visualization

### Before (Tightly Coupled)
```
User Action
    │
    ├─► Directly call renderNearbyItemList()
    ├─► Directly call renderInventory()
    ├─► Directly call renderPortalModal()
    ├─► State mutations scattered
    └─► Cache invalidation scattered
    
Result: Hard to trace, easy to miss updates, lots of duplication
```

### After (Event-Driven)
```
User Action
    │
    └─► ItemActions.operation()
        ├─► Validate
        ├─► Mutate state
        ├─► Persist
        └─► emit('event')
            ├─► Items Modal listener
            │   └─► renderNearbyItemList()
            ├─► Inventory Modal listener
            │   └─► renderInventory()
            └─► Analytics listener
                └─► track(event)
    
Result: Clear flow, automatic updates, easy to add new listeners
```

---

## Migration Impact

### Files Modified
- `app/static/app.js` - Add EventEmitter, ItemActions, update modal handlers

### Files NOT Modified
- `app/main.py` - No backend changes needed
- `app/models.py` - No data model changes
- `app/storage.py` - No storage layer changes
- `app/static/index.html` - No HTML structure changes

### Existing Functionality
- All API endpoints stay the same
- All storage logic unchanged
- All existing validation rules unchanged
- Backward compatible (old code can run alongside new code)

---

## Success Criteria

You'll know the architecture is working when:

1. ✅ EventEmitter is created with no errors
2. ✅ ItemActions module is added and callable
3. ✅ Modals open/close without errors
4. ✅ Event listeners are registered on modal open
5. ✅ Events are emitted when ItemActions run
6. ✅ Modal renders are triggered by events
7. ✅ Events are unsubscribed on modal close
8. ✅ No memory leaks (check in dev tools)
9. ✅ Complete flow works: place item → see in nearby → pick up → see in inventory
10. ✅ Error messages show up when operations fail

