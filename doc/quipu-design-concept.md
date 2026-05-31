# Quipu

### A Shared Spatial Canvas for Human Presence

*Named for the knotted cords of the Inca — a system for recording where things were, what mattered, and who was counted. And for the largest known structure in the universe: 1.3 billion light-years of matter, threaded and patient, carrying the memory of where everything fell.*

---

## 1. What Quipu Is

Quipu is a persistent, shared spatial canvas — a world that exists only where people have stood.

Users leave things: letters, photographs, objects. Others find them. The canvas accumulates over time, growing from the sum of human presence and attention. No place exists in Quipu until someone has physically been there and chosen to mark it. The world is autobiographical.

Portals connect places. A portal is a window: hold your device up and look through it into a canvas anchored somewhere else. Your physical steps translate to movement across that remote canvas. You can pick things up there, leave things behind. You cannot place a portal remotely. You can only open a door where you have already stood.

Quipu asks, quietly but persistently, that you go outside.

---

## 2. Core Design Principles

**Presence is earned.** No location exists in the shared world until a human body has been there and made a mark. Remote placement is never permitted — not for items, not for portals. The network can only be as large as the sum of places people have actually gone.

**The world remembers. Connections are personal.** Items placed in the canvas are persisted globally. Portal connections — which door leads where — are ephemeral, held only at the client. The same portal means different things to different people. The world holds what was placed. Meaning is yours to carry.

**The dimension is the root.** A dimension is identified by a single UUID. Share it and you share a world. The structure needs no central authority to arbitrate membership — possession of the root is participation. Dimensions can be forked: copy the tree, host it elsewhere, and a new world branches from the old one at the moment of forking.

**The tree grows where life grows.** Storage exists only where items exist. The vast majority of planetary surface costs nothing. The system is sparse by design, and that sparseness is honest — it reflects the actual distribution of human attention across the Earth.

**Spoofing is not the enemy.** Location spoofing is acknowledged and not defended against in this design. The social fabric of Quipu — the trust between people who know where portals were actually placed — is the defence. Bad actors harm their own experience most.

---

## 3. Spatial Data Architecture

### Coordinate System

All positions are expressed in **polar coordinates** (latitude, longitude) at up to **1 metre resolution**.

### Tree Structure

The world is represented as a **binary spatial tree**, navigated by halving:

- Begin at the full planetary extent (the root node)
- At each level, determine which half of the current bounding region contains the target coordinate
- Fetch the node for that half
- Repeat, halving resolution each time, until 1 metre resolution is reached

Approximately **25 traversal steps** take you from planetary scale to metre resolution. Each step is a single document fetch. No query. No predicate. No index scan. The path from coordinates to document is computed locally and traversed directly.

### Node Documents

Each node is a small **JSON document**, identified by a **UUID4**, containing:

```json
{
  "id": "uuid4",
  "children": {
    "nw": "uuid4 | null",
    "ne": "uuid4 | null",
    "sw": "uuid4 | null",
    "se": "uuid4 | null"
  },
  "items": [ ...item references... ]
}
```

Nodes that have never had an item placed within their region **do not exist**. The tree is sparse. Empty space has no representation.

### Dimensions

A **dimension** is simply a root UUID4. The entire tree for a given dimension is addressable from this single identifier. To participate in a shared world, share the root UUID. To create a private world, generate a new root.

Dimensions can coexist silently. The same physical location can contain items in any number of independent dimensions simultaneously.

### Items

Items are persisted at their metre-resolution node address. Each item is a JSON document containing:

- A UUID4 identifier
- Item type (letter, photograph, object, portal marker, ...)
- Owner identifier (public key or similar, TBD)
- Placement timestamp
- Content or content reference
- Permission metadata (MVP: open; elaborated later)

### Portals

Portal markers are items — persisted in the tree at their physical placement location like any other object. They carry no information about their destination. **Portal connections are ephemeral**, computed and held at the client only.

A client may connect a local portal to any other portal visible on the map, by:
- Selecting a local portal (one the user has physically reached)
- Panning and zooming the map to locate a remote portal
- Confirming the connection

The connection exists only for that session, on that device. It is not transmitted or stored. Two users standing at the same portal may be looking through it into entirely different places.

---

## 4. Client Architecture

### Rendering

The canvas is rendered as a **flat texture in 3D space**. The device camera shows the physical world; the canvas layer is a positioned plane within that same 3D space, tiltable and navigable by physically moving the device.

Looking through a portal: the remote canvas renders into the portal frame as a window. Physical steps translate to canvas movement at the remote location.

### Caching

The client maintains an **LRU cache** of recently fetched nodes. Hot areas — frequently visited local spaces — are served from device memory after first fetch. Cache invalidation is handled by TTL and explicit refresh on write.

The tree structure means cache coherence is tractable: a write at metre resolution invalidates only the path from that node to the root — a known, bounded set of documents.

### Location

Physical location is provided by device GPS. The system takes location at face value. No verification layer is implemented in MVP.

### Offline Behaviour

Cached regions are navigable offline. Item placement queues locally and syncs on reconnection. Portal connections, being ephemeral and client-side only, require no connectivity to compute.

---

## 5. Storage Considerations

### Format

All data is flat JSON documents, UUID4-named, with no dependency on any database engine, schema, or query language. The format is self-describing and human-readable. Any system capable of storing and retrieving a file by name can host Quipu.

### Scale Estimate (to be calculated)

Key variables for estimation:
- Expected number of active users in first year
- Average items placed per user per week
- Average item document size (bytes)
- Average tree depth populated per item placement (path length × node size)
- Cache hit ratio reducing write amplification

Storage requirements grow only with item placement activity, not with the size of the Earth.

### Hosting Criteria

A suitable storage backend must satisfy:

- **Key-value retrieval by opaque name** — UUID4 keys, no query capability required
- **HTTP GET accessibility** — clients fetch documents directly; no application server in the read path
- **Low per-request latency** — tree traversal chains 25 sequential fetches; each must be fast
- **No egress cost at scale** — or egress must remain within free tier for MVP traffic
- **Static file semantics** — documents are written once and read many times; update semantics are simple overwrite
- **Fork-friendly export** — the full tree must be exportable as a flat file archive, suitable for re-hosting elsewhere or archiving permanently
- **Long-term availability** — ideally outliving any individual account or organisation
- **Free or near-free at MVP scale** — with a credible path to affordable cost at growth

### Longevity and Forking

The system is designed to survive the loss of any particular host:

- Periodic **flat archive exports** (the full tree as a directory of JSON files) enable re-hosting
- Archives submitted to **permanent archival services** preserve the world as it existed at a given moment
- Anyone holding an archive can **resurrect the world** under a new host, with the same root UUID (continuing the dimension) or a new one (forking it)
- The fork is clean: copy the tree, host it, share the new root. No migration tooling required.

The world can be inherited.

---

## 6. Item Types (MVP)

- **Letter** — freeform text, written in-app
- **Photograph** — image from device camera roll or camera
- **Portal marker** — a door, placement only; connection is the user's own

Future item types, permission models, carry mechanics, and inventory systems are explicitly deferred.

---

## 7. Portal Mechanics (Detail)

**Placement rules:**
- A portal may only be placed at the user's current physical location
- Placement requires GPS lock within acceptable accuracy threshold
- No remote placement. Ever.

**Connection rules:**
- A connection may be made from any portal the user has physically reached (is within range of)
- The destination may be any other portal visible on the map, at any distance
- Connections are not stored, not shared, not synchronised
- The connection dissolves when the session ends

**Navigation through a portal:**
- The user steps through by confirming connection and beginning to walk
- Physical steps translate to movement on the remote canvas
- Items on the remote canvas are findable, readable, and interactable
- Items may be left on the remote canvas
- New portals may **not** be placed on a remote canvas — only at physical location

**Why this constraint holds:**
Chaining portals remotely would dissolve the relationship between the canvas and the physical world. The game's central invitation — *go somewhere, earn the connection* — depends on this constraint being absolute.

---

## 8. The Name

**Quipu** /ˈkiːpuː/

From Quechua: *knot*. The Incan recording system — knotted cords encoding census, calendar, narrative. A distributed, tactile database carried in the hands of runners across a continent.

Also: the largest known structure in the observable universe. A filamentary supercluster 1.3 billion light-years long, named for the resemblance of its branching threads to those same knotted cords.

Quipu the system is both of these things. A knotted record of where people have been, branching and persistent, carried forward by whoever chooses to hold it.

The tree grows where life grows.

---

*Document version: MVP concept, pre-implementation.*
*Storage provider decisions deferred pending scale estimation.*
*Object permissions, carry mechanics, and inventory systems deferred to post-MVP.*
