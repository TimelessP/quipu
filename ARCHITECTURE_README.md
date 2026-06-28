# Quipu Item Operations Architecture - Documentation Index

This directory contains comprehensive documentation for a new event-driven architecture for Quipu's item operations system.

## Quick Start (5 minutes)

Start here if you want the 30,000 foot view:
- **Read:** `ARCHITECTURE_SUMMARY.md` (this gives you the big picture)
- **Look at:** `ARCHITECTURE_DIAGRAM.md` (visual overview)

## Full Learning Path (45 minutes)

1. **ARCHITECTURE_SUMMARY.md** (5 min)
   - What problem does this solve?
   - How does it work at a high level?
   - What are the benefits?

2. **ARCHITECTURE_DIAGRAM.md** (10 min)
   - Three-layer architecture diagram
   - Data flow diagrams
   - Event sequences
   - Component interaction matrix

3. **IMPLEMENTATION_NOTES.md** (20 min)
   - Concrete JavaScript code examples
   - How to wire up each modal
   - Integration points with existing code
   - Common patterns

4. **ARCHITECTURE.md** (10 min)
   - Complete pseudocode for all classes/modules
   - Event type definitions
   - Modal listener patterns
   - Migration guide
   - Future extensions

## Document Descriptions

### ARCHITECTURE_SUMMARY.md
**Length:** ~400 lines
**Audience:** Developers, architects, decision-makers
**Content:**
- Problem statement
- Architecture layers explanation
- Event types overview
- Interaction patterns
- Migration path (4 steps)
- Key benefits
- Pitfalls and solutions
- Testing checklist

**Use this for:** Understanding the "why" and "what" before diving into "how"

---

### ARCHITECTURE_DIAGRAM.md
**Length:** ~500 lines
**Audience:** Visual learners, developers
**Content:**
- ASCII diagram of three layers
- Data flow diagrams
- Event sequence diagrams (pick up item, place item)
- State diagram (modal lifecycle)
- Component interaction matrix
- Success criteria

**Use this for:** Understanding relationships and flows visually

---

### IMPLEMENTATION_NOTES.md
**Length:** ~600 lines
**Audience:** Frontend developers
**Content:**
- EventEmitter class (full implementation)
- ItemActions module (all 8 operations)
- Modal listener patterns (items, inventory, portals)
- Integration points in existing code
- Before/after code examples
- Migration path with code examples
- Testing patterns
- Common pitfalls
- Debugging tips
- Performance notes
- Future enhancements

**Use this for:** Implementing the architecture step-by-step

---

### ARCHITECTURE.md
**Length:** ~800 lines
**Audience:** Architects, reviewers, documentation
**Content:**
- Layer 1: EventEmitter (detailed pseudocode)
- Layer 2: ItemActions (detailed pseudocode for all 8 operations)
- Layer 3: Modal listeners (detailed pseudocode)
- Event type definitions
- Migration guide
- Benefits analysis
- Example: complete "pick up item" flow
- Implementation checklist
- Performance considerations
- Future extensions (logging, undo/redo, offline, server sync)

**Use this for:** Reference, code review, comprehensive understanding

---

## The Three-Layer Architecture at a Glance

```
┌─────────────────────────────────────────────┐
│  Layer 3: Modal Listeners                   │
│  (Items Modal, Inventory Modal,             │
│   Portals Modal)                            │
│  Subscribe → Receive events → Render        │
└─────────────────┬───────────────────────────┘
                  │ on() / off()
                  │
┌─────────────────▼───────────────────────────┐
│  Layer 1: EventEmitter                      │
│  (Pub/Sub bus)                              │
│  on() / off() / emit()                      │
└─────────────────▲───────────────────────────┘
                  │ emit()
                  │
┌─────────────────┴───────────────────────────┐
│  Layer 2: ItemActions                       │
│  (Business logic)                           │
│  • placeItemAtLocation()                    │
│  • removeItemFromWorld()                    │
│  • pickUpItemFromWorld()                    │
│  • addToInventory()                         │
│  • updateNearbyItems()                      │
│  • setPortalSelection()                     │
│  • setPortalFavorites()                     │
└─────────────────────────────────────────────┘
```

## Event Types (6 Total)

1. `itemPlaced` - Item was placed in world
2. `itemRemoved` - Item was removed from world or inventory
3. `inventoryChanged` - Inventory contents changed
4. `worldStateChanged` - Nearby items list changed
5. `portalSelectionChanged` - User selected/deselected portals
6. `portalFavoritesChanged` - Portal favorites list changed

## Which Document for Which Task?

| Task | Document |
|------|----------|
| Quick 5-minute overview | ARCHITECTURE_SUMMARY.md |
| See visual flow diagrams | ARCHITECTURE_DIAGRAM.md |
| Write the EventEmitter class | IMPLEMENTATION_NOTES.md |
| Write the ItemActions module | ARCHITECTURE.md + IMPLEMENTATION_NOTES.md |
| Wire up modal listeners | IMPLEMENTATION_NOTES.md |
| Code review the architecture | ARCHITECTURE.md |
| Debug event flow issues | ARCHITECTURE_DIAGRAM.md + IMPLEMENTATION_NOTES.md |
| Plan the implementation | ARCHITECTURE_SUMMARY.md (migration path) |
| Write tests | IMPLEMENTATION_NOTES.md (testing section) |
| Add new features later | ARCHITECTURE.md (future extensions) |

## Key Concepts

### EventEmitter
A simple pub/sub message bus:
- `on(eventName, callback)` - Subscribe
- `off(eventName, callback)` - Unsubscribe
- `emit(eventName, data)` - Broadcast

### ItemActions
Unified module for all item operations:
- Each method returns `{success: boolean, error: string | null}`
- Calls storage/API
- Updates local state
- **Emits events**

### Modal Listeners
Modals subscribe to events:
- On open: subscribe to event(s)
- On event: re-render
- On close: unsubscribe

## Implementation Phases

### Phase 1: Add Infrastructure (Low Risk)
- Add EventEmitter class
- Add ItemActions module
- No breaking changes

### Phase 2: Wire Modals (Medium Risk)
- Update modals to subscribe to events
- Replace direct render calls
- All modals work independently

### Phase 3: Update Operations (Medium Risk)
- Replace item placement calls
- Replace item removal calls
- Replace inventory operations

### Phase 4: Cleanup (Low Risk)
- Remove old code
- Add error handling
- Documentation updates

## Migration Timeline

- **Phase 1:** 1-2 hours (add infrastructure)
- **Phase 2:** 2-3 hours (wire modals)
- **Phase 3:** 1-2 hours (update operations)
- **Phase 4:** 1 hour (cleanup)

**Total:** 5-8 hours of implementation time

## Benefits Summary

✓ Cleaner code - Modals don't need to know about each other
✓ More testable - Business logic separate from rendering
✓ More maintainable - Single place to change operations
✓ More extensible - Add new features without touching existing code
✓ More debuggable - Clear cause-and-effect with events
✓ Easier to add analytics/logging/offline support

## Success Criteria

You'll know the implementation is successful when:

1. EventEmitter class exists and works
2. ItemActions module exists and all 8 operations work
3. Modal listeners are registered/unregistered correctly
4. Events are emitted when ItemActions run
5. Modals re-render when events fire
6. Complete flow works: place item → see nearby → pick up → see in inventory
7. Error messages show when operations fail
8. No memory leaks from event listeners
9. No console errors or warnings
10. All existing features still work

## Troubleshooting

### Events not firing?
- Check that ItemActions is calling emit()
- Check that listener is registered with eventEmitter.on()
- Use `eventEmitter.debug()` to see registered listeners

### Render not being called?
- Check that event handler is calling render function
- Check that modal is still open (listeners unsubscribe on close)
- Check browser console for errors

### Memory leaks?
- Check that eventEmitter.off() is called on modal close
- Check that no listeners are created inside loops
- Use browser DevTools to check retained objects

### Listeners accumulating?
- Check that old render calls aren't still happening
- Check that listener is stored and removed properly
- Search for direct render calls in button handlers

## Related Files in Codebase

### Backend (No Changes)
- `app/main.py` - Endpoints stay same
- `app/models.py` - Models stay same
- `app/storage.py` - Storage layer stays same

### Frontend (Will be modified)
- `app/static/app.js` - Add EventEmitter, ItemActions, update modals
- `app/static/index.html` - No changes needed (class addition only)

## Glossary

- **EventEmitter** - Pub/sub message bus
- **ItemActions** - Module with unified item operations
- **Event** - Named message broadcast to subscribers
- **Listener** - Function that receives events
- **Subscribe** - Register a listener with `on()`
- **Unsubscribe** - Remove a listener with `off()`
- **Emit** - Broadcast an event to all listeners
- **Modal** - Dialog/popup (items, inventory, portals)
- **State** - Global `state` object with app data
- **Render** - Update DOM based on current state

## Contact & Questions

For questions about this architecture, check:
1. The relevant document (see "Which Document for Which Task" above)
2. The Glossary section
3. The Common Pitfalls section in IMPLEMENTATION_NOTES.md
4. The FAQ in ARCHITECTURE_SUMMARY.md

## Document Maintenance

Last updated: June 28, 2026
Architecture version: 1.0
Status: Complete specification, ready for implementation

To update these docs:
1. Edit the relevant document
2. Update the "Last updated" date in this file
3. If major changes: update the version number

---

**Start with ARCHITECTURE_SUMMARY.md for the big picture!**

