const state = {
  ownerId: localStorage.getItem("quipuOwnerId") || crypto.randomUUID(),
  dimensionRootId: null,
  physicalPosition: null,
  lastRealPosition: null,
  gpsMode: "real",
  gpsSpoofLabel: null,
  virtualOffset: { lat: 0, lng: 0 },
  followPlayer: true,
  hasInitialCenter: false,
  programmaticMapMove: false,
  map: null,
  selfMarker: null,
  bodyAnchorMarker: null,
  rangeRing: null,
  itemMarkers: new Map(),
  nearbyItems: [],
  viewportPortalItems: [],
  displayItems: [],
  selectedLocalPortalId: null,
  selectedRemotePortalId: null,
  selectedLocalPortalPos: null,
  selectedRemotePortalPos: null,
  inventory: [],
};

const PICKUP_RANGE_METERS = 30; // range for item pickup AND local portal selection
const RANGE_RING_VISIBLE_ZOOM = 18;
const H3_RESOLUTION = 12;
const MIN_PORTAL_SPACING_METERS = 8;
const PORTAL_REMOVE_RANGE_METERS = 8;
const inventoryKey = "quipuInventoryV1";

// Restore persisted inventory
const _savedInventory = localStorage.getItem(inventoryKey);
if (_savedInventory) {
  try { state.inventory = JSON.parse(_savedInventory); } catch { state.inventory = []; }
}

localStorage.setItem("quipuOwnerId", state.ownerId);

const cacheKey = "quipuNearbyCacheV1";
const queueKey = "quipuWriteQueueV1";
const legacyPortalSessionKey = "quipuPortalLinkV1";
const customLocCKey = "quipuGpsLocC";
const themeChoiceKey = "quipuThemeChoiceV1";
const portalFavoritesKey = "quipuPortalFavoritesV1";
const clientStateKey = "quipuClientStateV1";

hydrateClientState();

const GPS_PRESETS = {
  A: { label: "Loc A", lat: 51.507351, lng: -0.127758 },
  B: { label: "Loc B", lat: 35.6762, lng: 139.6503 },
};

const networkStatusEl = document.getElementById("network-status");
const dimensionStatusEl = document.getElementById("dimension-status");
const locationStatusEl = document.getElementById("location-status");
const itemsEl = document.getElementById("location-items-list");
const portalSelectionEl = document.getElementById("portal-link-summary");
const followToggleButtonEl = document.getElementById("follow-toggle");
const gpsSpooferStatusEl = document.getElementById("gps-spoofer-status");
const gpsWalkMetersEl = document.getElementById("gps-walk-meters");
const menuToggleButtonEl = document.getElementById("menu-toggle");
const themeCycleButtonEl = document.getElementById("theme-cycle");
const devMenuEl = document.getElementById("dev-menu");
const menuCloseButtonEl = document.getElementById("menu-close");
const menuScrimEl = document.getElementById("menu-scrim");
const appShellEl = document.querySelector(".app-shell");
const playerActionsEl = document.getElementById("player-actions");
const noticeBannerEl = document.getElementById("notice-banner");
const modalScrimEl = document.getElementById("modal-scrim");
const itemsModalEl = document.getElementById("items-modal");
const portalsModalEl = document.getElementById("portals-modal");
const debugModalEl = document.getElementById("debug-modal");
const itemAddModalEl = document.getElementById("item-add-modal");
const locationAddItemButtonEl = document.getElementById("location-add-item");
const inventoryAddItemButtonEl = document.getElementById("inventory-add-item");
const locationItemsListEl = document.getElementById("location-items-list");
const inventoryItemsListEl = document.getElementById("inventory-items");
const portalFavoritesListEl = document.getElementById("portal-favorites-list");
const itemAddFormEl = document.getElementById("item-add-form");
const itemAddTextEl = document.getElementById("item-add-text");
const itemAddPhotoEl = document.getElementById("item-add-photo");
const settingsModalEl = document.getElementById("settings-modal");
const aboutModalEl = document.getElementById("about-modal");
const settingsThemeCycleButtonEl = document.getElementById("settings-theme-cycle");
const settingsFollowPlayerButtonEl = document.getElementById("settings-follow-player");

let prefersDarkMediaQuery = null;
let noticeTimerId = null;
let itemAddTarget = "location";
let persistClientStateTimerId = null;
let followRestoreFrameId = null;
const uiSessionId = crypto.randomUUID();
let uiStack = [];
let syncingUiFromHistory = false;

function isFiniteLatLng(value) {
  if (!value) return false;
  return Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

function isFinitePortalPos(value) {
  if (!value) return false;
  return Number.isFinite(value.latitude) && Number.isFinite(value.longitude);
}

function getUiStackFromHistory(state = history.state) {
  if (!state || state.uiSessionId !== uiSessionId || !Array.isArray(state.uiStack)) {
    return [];
  }
  return state.uiStack.filter((layer) => layer === "menu" || layer === "items" || layer === "portals" || layer === "debug" || layer === "settings" || layer === "about" || layer === "item-add");
}

function getLayerElement(layerId) {
  switch (layerId) {
    case "menu": return devMenuEl;
    case "items": return itemsModalEl;
    case "portals": return portalsModalEl;
    case "debug": return debugModalEl;
    case "settings": return settingsModalEl;
    case "about": return aboutModalEl;
    case "item-add": return itemAddModalEl;
    default: return null;
  }
}

function getTopUiLayer() {
  return uiStack.length ? uiStack[uiStack.length - 1] : null;
}

function setLayerVisible(layerId, visible) {
  if (layerId === "menu") {
    if (!devMenuEl || !menuToggleButtonEl) return;
    devMenuEl.classList.toggle("is-collapsed", !visible);
    appShellEl?.classList.toggle("menu-open", visible);
    menuScrimEl?.setAttribute("aria-hidden", visible ? "false" : "true");
    menuToggleButtonEl.setAttribute("aria-expanded", visible ? "true" : "false");
    updateMenuToggleLabel(visible);
    return;
  }

  const modalEl = getLayerElement(layerId);
  if (!modalEl) return;
  modalEl.classList.toggle("is-open", visible);
  modalEl.setAttribute("aria-hidden", visible ? "false" : "true");
}

function syncUiStack(nextStack) {
  syncingUiFromHistory = true;
  uiStack = [...nextStack];

  setLayerVisible("menu", uiStack.includes("menu"));
  for (const layerId of ["items", "portals", "debug", "settings", "about", "item-add"]) {
    setLayerVisible(layerId, uiStack.includes(layerId));
  }

  const hasModalLayer = ["items", "portals", "debug", "settings", "about", "item-add"].some((layerId) => uiStack.includes(layerId));
  modalScrimEl?.classList.toggle("is-open", hasModalLayer);
  modalScrimEl?.setAttribute("aria-hidden", hasModalLayer ? "false" : "true");

  syncingUiFromHistory = false;
}

function commitUiStack(nextStack, mode = "push") {
  const snapshot = { uiSessionId, uiStack: nextStack };
  if (mode === "replace") {
    history.replaceState(snapshot, "", window.location.href);
  } else {
    history.pushState(snapshot, "", window.location.href);
  }
  syncUiStack(nextStack);
}

function openUiLayer(layerId) {
  const stack = getUiStackFromHistory();
  if (stack[stack.length - 1] === layerId) return;
  commitUiStack([...stack, layerId]);
}

function closeTopUiLayer() {
  if (uiStack.length) {
    history.back();
    return;
  }
  syncUiStack([]);
}

function closeUiLayer(layerId) {
  if (getTopUiLayer() === layerId) {
    closeTopUiLayer();
  }
}

function updateUiHistoryOnPop(event) {
  const stack = getUiStackFromHistory(event.state);
  syncUiStack(stack);
}

function persistClientStateNow() {
  const snapshot = {
    gpsMode: state.gpsMode,
    gpsSpoofLabel: state.gpsSpoofLabel,
    physicalPosition: isFiniteLatLng(state.physicalPosition) ? state.physicalPosition : null,
    lastRealPosition: isFiniteLatLng(state.lastRealPosition) ? state.lastRealPosition : null,
    virtualOffset: {
      lat: Number.isFinite(state.virtualOffset?.lat) ? state.virtualOffset.lat : 0,
      lng: Number.isFinite(state.virtualOffset?.lng) ? state.virtualOffset.lng : 0,
    },
    followPlayer: Boolean(state.followPlayer),
    selectedLocalPortalId: state.selectedLocalPortalId,
    selectedRemotePortalId: state.selectedRemotePortalId,
    selectedLocalPortalPos: isFinitePortalPos(state.selectedLocalPortalPos) ? state.selectedLocalPortalPos : null,
    selectedRemotePortalPos: isFinitePortalPos(state.selectedRemotePortalPos) ? state.selectedRemotePortalPos : null,
  };
  localStorage.setItem(clientStateKey, JSON.stringify(snapshot));
}

function schedulePersistClientState() {
  if (persistClientStateTimerId !== null) return;
  persistClientStateTimerId = window.setTimeout(() => {
    persistClientStateTimerId = null;
    persistClientStateNow();
  }, 0);
}

function hydrateClientState() {
  let parsed = null;
  const raw = localStorage.getItem(clientStateKey);
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  // One-time migration path from old session portal link storage.
  if (!parsed) {
    const legacy = sessionStorage.getItem(legacyPortalSessionKey);
    if (legacy) {
      try {
        const old = JSON.parse(legacy);
        parsed = {
          selectedLocalPortalId: old.local ?? null,
          selectedRemotePortalId: old.remote ?? null,
          selectedLocalPortalPos: old.localPos ?? null,
          selectedRemotePortalPos: old.remotePos ?? null,
        };
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed) return;

  if (parsed.gpsMode === "real" || parsed.gpsMode === "spoof") {
    state.gpsMode = parsed.gpsMode;
  }
  if (typeof parsed.gpsSpoofLabel === "string" || parsed.gpsSpoofLabel === null) {
    state.gpsSpoofLabel = parsed.gpsSpoofLabel;
  }
  if (isFiniteLatLng(parsed.physicalPosition)) {
    state.physicalPosition = parsed.physicalPosition;
  } else if (parsed.gpsMode === "real" && isFiniteLatLng(parsed.lastRealPosition)) {
    // Mobile reloads can briefly come up before the next GPS fix arrives.
    // Reuse the last real fix so follow restoration has something stable to center on.
    state.physicalPosition = parsed.lastRealPosition;
  }
  if (isFiniteLatLng(parsed.lastRealPosition)) {
    state.lastRealPosition = parsed.lastRealPosition;
  }
  if (Number.isFinite(parsed?.virtualOffset?.lat) && Number.isFinite(parsed?.virtualOffset?.lng)) {
    state.virtualOffset = {
      lat: parsed.virtualOffset.lat,
      lng: parsed.virtualOffset.lng,
    };
  }
  if (typeof parsed.followPlayer === "boolean") {
    state.followPlayer = parsed.followPlayer;
  }
  if (typeof parsed.selectedLocalPortalId === "string" || parsed.selectedLocalPortalId === null) {
    state.selectedLocalPortalId = parsed.selectedLocalPortalId;
  }
  if (typeof parsed.selectedRemotePortalId === "string" || parsed.selectedRemotePortalId === null) {
    state.selectedRemotePortalId = parsed.selectedRemotePortalId;
  }
  if (isFinitePortalPos(parsed.selectedLocalPortalPos) || parsed.selectedLocalPortalPos === null) {
    state.selectedLocalPortalPos = parsed.selectedLocalPortalPos;
  }
  if (isFinitePortalPos(parsed.selectedRemotePortalPos) || parsed.selectedRemotePortalPos === null) {
    state.selectedRemotePortalPos = parsed.selectedRemotePortalPos;
  }
}

function notify(message, kind = "info", timeoutMs = 2600) {
  if (!noticeBannerEl) return;

  if (noticeTimerId) {
    clearTimeout(noticeTimerId);
    noticeTimerId = null;
  }

  noticeBannerEl.textContent = message;
  noticeBannerEl.classList.remove("is-error", "is-success");

  if (kind === "error") {
    noticeBannerEl.classList.add("is-error");
  } else if (kind === "success") {
    noticeBannerEl.classList.add("is-success");
  }

  noticeBannerEl.classList.add("is-visible");
  noticeTimerId = window.setTimeout(() => {
    noticeBannerEl.classList.remove("is-visible");
    noticeTimerId = null;
  }, timeoutMs);
}

function getThemeChoice() {
  const saved = localStorage.getItem(themeChoiceKey);
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "system";
}

function updateThemeButtons(choice) {
  if (!themeCycleButtonEl) return;
  themeCycleButtonEl.dataset.choice = choice;
  const labels = {
    system: "Theme: System",
    light: "Theme: Light",
    dark: "Theme: Dark",
  };
  const label = labels[choice] || labels.system;
  themeCycleButtonEl.setAttribute("aria-label", label);
  themeCycleButtonEl.setAttribute("title", label);
}

function cycleThemeChoice() {
  const current = getThemeChoice();
  const next = current === "system" ? "light" : current === "light" ? "dark" : "system";
  applyThemeChoice(next);
}

function getMenuToggleLabel(isOpen) {
  return isOpen ? "Close main menu" : "Open main menu";
}

function updateMenuToggleLabel(isOpen) {
  if (!menuToggleButtonEl) return;
  const label = getMenuToggleLabel(isOpen);
  menuToggleButtonEl.setAttribute("aria-label", label);
  menuToggleButtonEl.setAttribute("title", label);
}

function applyThemeChoice(choice) {
  const safeChoice = (choice === "light" || choice === "dark" || choice === "system") ? choice : "system";
  localStorage.setItem(themeChoiceKey, safeChoice);

  if (safeChoice === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", safeChoice);
  }

  updateThemeButtons(safeChoice);
}

function initThemeMode() {
  prefersDarkMediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)") || null;
  if (prefersDarkMediaQuery) {
    const handlePrefersChange = () => {
      if (getThemeChoice() === "system") {
        applyThemeChoice("system");
      }
    };

    if (typeof prefersDarkMediaQuery.addEventListener === "function") {
      prefersDarkMediaQuery.addEventListener("change", handlePrefersChange);
    } else if (typeof prefersDarkMediaQuery.addListener === "function") {
      prefersDarkMediaQuery.addListener(handlePrefersChange);
    }
  }

  applyThemeChoice(getThemeChoice());
}

let geolocationWatchId = null;
let firstFixTimeoutId = null;

function loadCustomLocC() {
  const raw = localStorage.getItem(customLocCKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.lat) || !Number.isFinite(parsed?.lng)) return null;
    return {
      label: "Loc C",
      lat: parsed.lat,
      lng: parsed.lng,
    };
  } catch {
    return null;
  }
}

function initLocCInputs() {
  // Retained for startup flow compatibility; Loc C is now set from map context.
}

function saveCustomLocC(lat, lng) {
  localStorage.setItem(customLocCKey, JSON.stringify({ lat, lng }));
}

function formatLatLng(lat, lng) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function getWalkStepMeters() {
  const n = Number(gpsWalkMetersEl?.value ?? 10);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return n;
}

function refreshGpsSpooferStatus() {
  if (!gpsSpooferStatusEl) return;
  const customC = loadCustomLocC();
  const locCLabel = customC ? formatLatLng(customC.lat, customC.lng) : "not set";

  if (state.gpsMode === "spoof" && state.physicalPosition) {
    gpsSpooferStatusEl.textContent =
      `GPS Debug: SPOOF ON (${state.gpsSpoofLabel || "manual"}) at ${formatLatLng(state.physicalPosition.lat, state.physicalPosition.lng)}. ` +
      `Saved Loc C: ${locCLabel}`;
    return;
  }

  gpsSpooferStatusEl.textContent = `GPS Debug: using real GPS. Saved Loc C: ${locCLabel}`;
}

function setSpoofPosition(lat, lng, label) {
  state.gpsMode = "spoof";
  state.gpsSpoofLabel = label || "manual";
  state.physicalPosition = {
    lat,
    lng,
    accuracy: 3,
  };
  schedulePersistClientState();
  refreshGpsSpooferStatus();
  refreshLocationAndNearby(false);
}

function setPresetSpoof(key) {
  if (key === "C") {
    const custom = loadCustomLocC();
    if (!custom) {
      notify("Loc C is not set yet. Use Set Loc C first.", "error");
      return;
    }
    setSpoofPosition(custom.lat, custom.lng, custom.label);
    return;
  }

  const preset = GPS_PRESETS[key];
  if (!preset) return;
  setSpoofPosition(preset.lat, preset.lng, preset.label);
}

function setLocCFromPrompt() {
  const source = state.map ? state.map.getCenter() : (state.physicalPosition || state.lastRealPosition);
  if (!source) {
    notify("No map position available to set Loc C.", "error");
    return;
  }

  saveCustomLocC(source.lat, source.lng);
  refreshGpsSpooferStatus();
  notify(`Loc C saved at ${formatLatLng(source.lat, source.lng)}.`, "success", 2400);
}

function moveByMeters(lat, lng, northMeters, eastMeters) {
  const earthRadius = 6378137;
  const dLat = (northMeters / earthRadius) * (180 / Math.PI);
  const dLng = (eastMeters / (earthRadius * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return {
    lat: lat + dLat,
    lng: lng + dLng,
  };
}

function walkSpoof(northMeters, eastMeters, directionLabel) {
  const step = getWalkStepMeters();
  const base = state.physicalPosition || state.lastRealPosition || GPS_PRESETS.A;

  if (state.gpsMode !== "spoof") {
    setSpoofPosition(base.lat, base.lng, "walk start");
  }

  const moved = moveByMeters(state.physicalPosition.lat, state.physicalPosition.lng, northMeters * step, eastMeters * step);
  setSpoofPosition(moved.lat, moved.lng, `walk ${directionLabel}`);
}

function useRealGpsMode() {
  state.gpsMode = "real";
  state.gpsSpoofLabel = null;
  if (state.lastRealPosition) {
    state.physicalPosition = { ...state.lastRealPosition };
    refreshLocationAndNearby(true);
  }
  schedulePersistClientState();
  refreshGpsSpooferStatus();
  beginGeolocation();
}

function setNetworkStatus() {
  networkStatusEl.textContent = `Network: ${navigator.onLine ? "online" : "offline"}`;
}

function isSecureEnoughForGeolocation() {
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function explainGeoError(err) {
  if (!err) return "Unknown geolocation error.";
  if (err.code === 1) {
    return "Location permission denied. Allow location access in Chrome site settings and retry.";
  }
  if (err.code === 2) {
    return "Location unavailable. Check GPS signal and device location services.";
  }
  if (err.code === 3) {
    return "Location request timed out. Move to open sky and retry.";
  }
  return err.message || "Unknown geolocation error.";
}

function clearFirstFixTimeout() {
  if (firstFixTimeoutId) {
    clearTimeout(firstFixTimeoutId);
    firstFixTimeoutId = null;
  }
}

function setFirstFixTimeout() {
  clearFirstFixTimeout();
  firstFixTimeoutId = setTimeout(() => {
    if (!state.physicalPosition) {
      locationStatusEl.textContent =
        "Location: still waiting for GPS fix. On Android Chrome over LAN IP, geolocation requires HTTPS. Tap Retry GPS after checking permissions.";
    }
  }, 15000);
}

async function updatePermissionHint() {
  if (!navigator.permissions?.query) return;
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state === "denied") {
      locationStatusEl.textContent =
        "Location: blocked by browser permission. Enable Location for this site and tap Retry GPS.";
    }
  } catch {
    // Ignore permissions API issues on browsers that partially implement it.
  }
}

function getVirtualPosition() {
  if (!state.physicalPosition) return null;
  return {
    lat: state.physicalPosition.lat + state.virtualOffset.lat,
    lng: state.physicalPosition.lng + state.virtualOffset.lng,
    accuracy: state.physicalPosition.accuracy,
  };
}

function updateFollowIndicator() {
  if (!followToggleButtonEl) return;
  const isFollowing = Boolean(state.followPlayer);
  followToggleButtonEl.dataset.follow = isFollowing ? "on" : "off";
  const label = isFollowing ? "Following player" : "Center on player";
  followToggleButtonEl.setAttribute("aria-label", label);
  followToggleButtonEl.setAttribute("title", label);
}

function setDevMenuOpen(open) {
  if (!devMenuEl || !menuToggleButtonEl) return;
  devMenuEl.classList.toggle("is-collapsed", !open);
  appShellEl?.classList.toggle("menu-open", open);
  menuScrimEl?.setAttribute("aria-hidden", open ? "false" : "true");
  menuToggleButtonEl.setAttribute("aria-expanded", open ? "true" : "false");
  updateMenuToggleLabel(open);
}

function setPlayerActionsOpen(open) {
  if (!playerActionsEl) return;
  playerActionsEl.classList.toggle("is-open", open);
}

function getActiveModalEls() {
  return [itemsModalEl, portalsModalEl, debugModalEl, itemAddModalEl].filter(Boolean);
}

function closeAllModals() {
  for (const modal of getActiveModalEls()) {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }
  modalScrimEl?.classList.remove("is-open");
  modalScrimEl?.setAttribute("aria-hidden", "true");
}

function openModal(modalEl) {
  if (!modalEl) return;
  if (modalEl === itemsModalEl) openUiLayer("items");
  else if (modalEl === portalsModalEl) openUiLayer("portals");
  else if (modalEl === debugModalEl) openUiLayer("debug");
  else if (modalEl === settingsModalEl) openUiLayer("settings");
  else if (modalEl === aboutModalEl) openUiLayer("about");
  else if (modalEl === itemAddModalEl) openUiLayer("item-add");
}

function closeModal(modalEl) {
  if (!modalEl) return;
  if (modalEl === itemsModalEl) closeUiLayer("items");
  else if (modalEl === portalsModalEl) closeUiLayer("portals");
  else if (modalEl === debugModalEl) closeUiLayer("debug");
  else if (modalEl === settingsModalEl) closeUiLayer("settings");
  else if (modalEl === aboutModalEl) closeUiLayer("about");
  else if (modalEl === itemAddModalEl) closeUiLayer("item-add");
}

function loadPortalFavorites() {
  const raw = localStorage.getItem(portalFavoritesKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f) => Number.isFinite(f?.latitude) && Number.isFinite(f?.longitude));
  } catch {
    return [];
  }
}

function savePortalFavorites(favorites) {
  localStorage.setItem(portalFavoritesKey, JSON.stringify(favorites));
}

function getMapCenterOrPhysical() {
  if (state.map) {
    const center = state.map.getCenter();
    return { lat: center.lat, lng: center.lng };
  }
  if (state.physicalPosition) {
    return { lat: state.physicalPosition.lat, lng: state.physicalPosition.lng };
  }
  return null;
}

function classifyItemType(contentText, hasImage) {
  if (hasImage) return "photograph";
  return "letter";
}

function isVirtualShiftActive() {
  return Math.abs(state.virtualOffset.lat) > 1e-12 || Math.abs(state.virtualOffset.lng) > 1e-12;
}

function findSelectedPortalPosition(portalId, fallbackPos) {
  if (!portalId) return fallbackPos || null;
  const fromItems = state.displayItems.find((item) => item.id === portalId);
  if (fromItems) {
    return { latitude: fromItems.latitude, longitude: fromItems.longitude };
  }
  return fallbackPos || null;
}

function updatePortalHud() {
  if (portalsModalEl?.classList.contains("is-open")) {
    renderPortalModal();
  }
}

function updatePlayerRangeRing() {
  if (!state.map) return;

  const virtual = getVirtualPosition();
  const zoom = state.map.getZoom();
  const shouldShow = Boolean(virtual) && zoom >= RANGE_RING_VISIBLE_ZOOM;

  if (!shouldShow) {
    if (state.rangeRing) {
      state.map.removeLayer(state.rangeRing);
      state.rangeRing = null;
    }
    return;
  }

  const ringStyle = {
    radius: PICKUP_RANGE_METERS,
    color: "#138c64",
    weight: 2,
    opacity: 0.8,
    fillColor: "#138c64",
    fillOpacity: 0.08,
    interactive: false,
  };

  if (!state.rangeRing) {
    state.rangeRing = L.circle([virtual.lat, virtual.lng], ringStyle).addTo(state.map);
    return;
  }

  state.rangeRing.setLatLng([virtual.lat, virtual.lng]);
  state.rangeRing.setRadius(PICKUP_RANGE_METERS);
}

function jumpThroughPortalLink() {
  if (!state.selectedLocalPortalId || !state.selectedRemotePortalId) {
    notify("Set local and remote portals before jumping.", "error");
    return;
  }
  if (!canUseCurrentPortalLink()) {
    notify("Stand by the linked source portal before using this portal.", "error", 2800);
    return;
  }
  updatePortalOffsetFromSelection();
  state.followPlayer = true;
  schedulePersistClientState();
  updateFollowIndicator();
  refreshLocationAndNearby(true);
  drawPortalLink();
  renderNearbyItemList();
  updatePortalHud();
  notify("Jumped through portal link.", "success", 2200);
}

function returnToPhysicalPosition() {
  if (!isVirtualShiftActive()) {
    notify("Already at physical position.", "info", 1800);
    return;
  }
  state.virtualOffset = { lat: 0, lng: 0 };
  state.followPlayer = true;
  schedulePersistClientState();
  updateFollowIndicator();
  refreshLocationAndNearby(true);
  drawPortalLink();
  renderNearbyItemList();
  updatePortalHud();
  notify("Returned to physical position.", "success", 2200);
}

function clearPortalLink(showNotice = true) {
  state.selectedLocalPortalId = null;
  state.selectedRemotePortalId = null;
  state.selectedLocalPortalPos = null;
  state.selectedRemotePortalPos = null;
  state.virtualOffset = { lat: 0, lng: 0 };
  schedulePersistClientState();
  if (state.portalLine) {
    state.map.removeLayer(state.portalLine);
    state.portalLine = null;
  }
  refreshLocationAndNearby(true);
  renderPortalSelection();
  renderNearbyItemList();
  updatePortalHud();
  if (showNotice) {
    notify("Portal link cleared.", "info", 1800);
  }
}

function toggleDevMenu() {
  if (getTopUiLayer() === "menu") {
    closeTopUiLayer();
    return;
  }
  openUiLayer("menu");
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function centerMapOnPlayerVirtual(forceZoom = false) {
  const virtual = getVirtualPosition();
  if (!virtual || !state.map) return;

  const currentZoom = state.map.getZoom();
  const nextZoom = forceZoom ? Math.max(currentZoom, 18) : currentZoom;
  state.programmaticMapMove = true;
  state.map.setView([virtual.lat, virtual.lng], nextZoom, { animate: true });
}

function restoreFollowOnNextFrame() {
  if (!state.map || !state.followPlayer || !getVirtualPosition()) return;

  if (followRestoreFrameId !== null) {
    cancelAnimationFrame(followRestoreFrameId);
    followRestoreFrameId = null;
  }

  followRestoreFrameId = requestAnimationFrame(() => {
    followRestoreFrameId = null;
    if (!state.map || !state.followPlayer || !getVirtualPosition()) return;
    state.map.invalidateSize();
    centerMapOnPlayerVirtual(true);
  });
}

function updatePlayerMarkers() {
  const virtual = getVirtualPosition();
  const physical = state.physicalPosition;
  if (!state.map) return;

  const markerPosition = virtual || (state.map ? state.map.getCenter() : null);
  if (!markerPosition) return;

  if (!state.selfMarker) {
    state.selfMarker = L.marker([markerPosition.lat, markerPosition.lng]).addTo(state.map);
    state.selfMarker.on("click", (event) => {
      if (event?.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
      setPlayerActionsOpen(true);
    });
  } else {
    state.selfMarker.setLatLng([markerPosition.lat, markerPosition.lng]);
  }

  const isVirtualShifted = Boolean(physical) && (Math.abs(state.virtualOffset.lat) > 1e-12 || Math.abs(state.virtualOffset.lng) > 1e-12);
  if (isVirtualShifted) {
    // Keep the body location visible while projected, but keep interactions on one marker type.
    if (!state.bodyAnchorMarker) {
      state.bodyAnchorMarker = L.circleMarker([physical.lat, physical.lng], {
        radius: 7,
        color: "#606975",
        fillColor: "#606975",
        fillOpacity: 0.3,
        weight: 2,
      }).addTo(state.map);
    } else {
      state.bodyAnchorMarker.setLatLng([physical.lat, physical.lng]);
    }
  } else if (state.bodyAnchorMarker) {
    state.map.removeLayer(state.bodyAnchorMarker);
    state.bodyAnchorMarker = null;
  }

  updatePlayerRangeRing();
}

function getMapItemsForRender() {
  return state.displayItems;
}

function renderMapItems() {
  drawItems(getMapItemsForRender());
}

function refreshLocationAndNearby(preferCache = true) {
  const physical = state.physicalPosition;
  const virtual = getVirtualPosition();
  if (!physical || !virtual) return;

  const sourceLabel = state.gpsMode === "spoof"
    ? `Spoof (${state.gpsSpoofLabel || "manual"})`
    : "GPS";

  locationStatusEl.textContent =
    `Physical [${sourceLabel}]: ${physical.lat.toFixed(6)}, ${physical.lng.toFixed(6)} (±${Math.round(physical.accuracy)}m)` +
    ` | Virtual: ${virtual.lat.toFixed(6)}, ${virtual.lng.toFixed(6)}`;

  updatePlayerMarkers();
  updatePlayerRangeRing();
  updatePortalHud();
  loadNearby(virtual.lat, virtual.lng, preferCache);

  if (state.followPlayer) {
    if (!state.hasInitialCenter) {
      state.programmaticMapMove = true;
      state.map.setView([virtual.lat, virtual.lng], 18, { animate: false });
      state.hasInitialCenter = true;
    } else {
      centerMapOnPlayerVirtual(false);
    }
  }
}

function updatePortalOffsetFromSelection() {
  if (!state.selectedLocalPortalId || !state.selectedRemotePortalId) {
    state.virtualOffset = { lat: 0, lng: 0 };
    schedulePersistClientState();
    updatePortalHud();
    return;
  }

  const localFromItems = state.displayItems.find((i) => i.id === state.selectedLocalPortalId);
  const remoteFromItems = state.displayItems.find((i) => i.id === state.selectedRemotePortalId);
  const local = localFromItems || state.selectedLocalPortalPos;
  const remote = remoteFromItems || state.selectedRemotePortalPos;

  if (!local || !remote) {
    state.virtualOffset = { lat: 0, lng: 0 };
    schedulePersistClientState();
    updatePortalHud();
    return;
  }

  state.selectedLocalPortalPos = { latitude: local.latitude, longitude: local.longitude };
  state.selectedRemotePortalPos = { latitude: remote.latitude, longitude: remote.longitude };
  savePortalSession();

  state.virtualOffset = {
    lat: remote.latitude - local.latitude,
    lng: remote.longitude - local.longitude,
  };
  schedulePersistClientState();
  updatePortalHud();
}

function cacheRead(key) {
  const raw = localStorage.getItem(cacheKey);
  if (!raw) return null;
  const data = JSON.parse(raw);
  const entry = data[key];
  if (!entry) return null;
  entry.touched = Date.now();
  data[key] = entry;
  localStorage.setItem(cacheKey, JSON.stringify(data));
  return entry.value;
}

function cacheWrite(key, value) {
  const raw = localStorage.getItem(cacheKey);
  const data = raw ? JSON.parse(raw) : {};
  data[key] = { touched: Date.now(), value };

  const keys = Object.keys(data);
  if (keys.length > 50) {
    keys
      .sort((a, b) => data[a].touched - data[b].touched)
      .slice(0, keys.length - 50)
      .forEach((k) => delete data[k]);
  }

  localStorage.setItem(cacheKey, JSON.stringify(data));
}

async function fetchJsonWithCache(key, url, preferCache = true) {
  if (preferCache) {
    const cached = cacheRead(key);
    if (cached) return cached;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  cacheWrite(key, payload);
  return payload;
}

function queueWrite(payload) {
  const raw = localStorage.getItem(queueKey);
  const q = raw ? JSON.parse(raw) : [];
  q.push(payload);
  localStorage.setItem(queueKey, JSON.stringify(q));
}

async function replayQueue() {
  const raw = localStorage.getItem(queueKey);
  const q = raw ? JSON.parse(raw) : [];
  if (!q.length || !navigator.onLine) return;

  const remaining = [];
  for (const payload of q) {
    try {
      if (!payload.kind || payload.kind === "json") {
        await sendJson(payload.url, payload.body);
      } else if (payload.kind === "photo") {
        await sendQueuedPhoto(payload);
      } else {
        throw new Error("Unknown queue payload kind");
      }
    } catch {
      remaining.push(payload);
    }
  }
  localStorage.setItem(queueKey, JSON.stringify(remaining));
}

async function sendQueuedPhoto(payload) {
  const form = new FormData();
  form.append("owner", payload.owner);
  form.append("latitude", String(payload.latitude));
  form.append("longitude", String(payload.longitude));
  form.append("accuracy_meters", String(payload.accuracy_meters));
  form.append("file", dataUrlToFile(payload.fileDataUrl, payload.fileName, payload.fileType));

  const response = await fetch(payload.url, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function dataUrlToFile(dataUrl, filename, contentType) {
  const base64 = dataUrl.split(",")[1];
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    arr[i] = bytes.charCodeAt(i);
  }
  return new File([arr], filename, { type: contentType });
}

async function sendJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function getDefaultDimension() {
  const response = await fetch("/api/dimensions/default");
  const payload = await response.json();
  state.dimensionRootId = payload.root_id;
  dimensionStatusEl.textContent = `Dimension: ${state.dimensionRootId}`;
}

function initMap() {
  state.map = L.map("map", { maxZoom: 22 }).setView([0, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(state.map);

  state.map.on("movestart", () => {
    if (state.programmaticMapMove) return;
    state.followPlayer = false;
    schedulePersistClientState();
    updateFollowIndicator();
  });

  state.map.on("moveend", () => {
    if (state.programmaticMapMove) {
      state.programmaticMapMove = false;
      return;
    }
  });

  state.map.on("zoomend", updatePlayerRangeRing);

  state.map.on("moveend", () => {
    if (!state.physicalPosition) {
      updatePlayerMarkers();
    }
    updatePlayerRangeRing();
    const virtual = getVirtualPosition();
    if (virtual) loadNearby(virtual.lat, virtual.lng, false);
    loadViewportPortals(false);
  });

  state.map.on("click", () => {
    setPlayerActionsOpen(false);
    if (!devMenuEl) return;
    if (window.innerWidth >= 980) return;
    if (getTopUiLayer() !== "menu") return;
    closeTopUiLayer();
  });
}

function drawItems(items) {
  for (const marker of state.itemMarkers.values()) {
    state.map.removeLayer(marker);
  }
  state.itemMarkers.clear();

  items.forEach((item) => {
    const color =
      item.type === "portal_marker" ? "#6d3ef5" : item.type === "photograph" ? "#f38b2a" : "#0e7a56";

    const marker = L.circleMarker([item.latitude, item.longitude], {
      radius: item.type === "portal_marker" ? 12 : 8,
      color,
      fillColor: color,
      fillOpacity: item.type === "portal_marker" ? 0.95 : 0.9,
      weight: item.type === "portal_marker" ? 3 : 2,
    }).addTo(state.map);

    marker.on("click", () => onItemClicked(item));
    state.itemMarkers.set(item.id, marker);
  });
}

function mergeDisplayItems(nearbyItems, viewportPortalItems) {
  const merged = new Map();
  for (const item of nearbyItems) {
    merged.set(item.id, item);
  }
  for (const item of viewportPortalItems) {
    merged.set(item.id, item);
  }
  return Array.from(merged.values());
}

function onItemClicked(item) {
  if (item.type !== "portal_marker") return;

  if (!state.physicalPosition) {
    notify("Physical position required for portal linking.", "error");
    return;
  }

  setRemotePortal(item);
}

function getPhysicalNearbyPortals(maxMeters = PICKUP_RANGE_METERS) {
  if (!state.physicalPosition) return;
  const physical = state.physicalPosition;
  const portals = state.displayItems.filter((i) => i.type === "portal_marker");
  const nearby = portals
    .map((portal) => ({
      portal,
      distance: haversineMeters(physical.lat, physical.lng, portal.latitude, portal.longitude),
    }))
    .filter((entry) => entry.distance <= maxMeters)
    .sort((a, b) => a.distance - b.distance);
  return nearby;
}

function setRemotePortal(item) {
  if (!item || item.type !== "portal_marker") return;

  const physicalNearby = getPhysicalNearbyPortals(PICKUP_RANGE_METERS);
  if (!physicalNearby || !physicalNearby.length) {
    notify("A source portal must be near your physical location to link a remote portal.", "error", 3200);
    return;
  }

  const localPortal = physicalNearby[0].portal;
  if (localPortal.id === item.id) {
    notify("Remote portal must be different from your nearby source portal.", "error");
    return;
  }

  state.selectedLocalPortalId = localPortal.id;
  state.selectedLocalPortalPos = { latitude: localPortal.latitude, longitude: localPortal.longitude };
  state.selectedRemotePortalId = item.id;
  state.selectedRemotePortalPos = { latitude: item.latitude, longitude: item.longitude };
  savePortalSession();
  updatePortalOffsetFromSelection();
  renderPortalSelection();
  updatePortalHud();
  notify("Portal link configured. Use Portal when standing by the source portal.", "success", 2600);
}

function canUseCurrentPortalLink() {
  if (!state.selectedLocalPortalId || !state.selectedRemotePortalId) return false;
  if (!state.physicalPosition || isVirtualShiftActive()) return false;
  const local = findSelectedPortalPosition(state.selectedLocalPortalId, state.selectedLocalPortalPos);
  if (!local) return false;
  const d = haversineMeters(
    state.physicalPosition.lat,
    state.physicalPosition.lng,
    local.latitude,
    local.longitude
  );
  return d <= PICKUP_RANGE_METERS;
}

function canClearCurrentPortalLink() {
  return canUseCurrentPortalLink() && !isVirtualShiftActive();
}

function getNearestPortalAtVirtualPosition(maxMeters = PICKUP_RANGE_METERS) {
  const virtual = getVirtualPosition();
  if (!virtual) return null;
  const portals = state.displayItems.filter((i) => i.type === "portal_marker");
  let best = null;
  for (const portal of portals) {
    const d = haversineMeters(virtual.lat, virtual.lng, portal.latitude, portal.longitude);
    if (d > maxMeters) continue;
    if (!best || d < best.distance) {
      best = { portal, distance: d };
    }
  }
  return best;
}

function drawPortalLink() {
  if (!state.selectedLocalPortalId || !state.selectedRemotePortalId) return;
  const local =
    state.displayItems.find((i) => i.id === state.selectedLocalPortalId) || state.selectedLocalPortalPos;
  const remote =
    state.displayItems.find((i) => i.id === state.selectedRemotePortalId) || state.selectedRemotePortalPos;
  if (!local || !remote) return;

  if (state.portalLine) {
    state.map.removeLayer(state.portalLine);
  }

  state.portalLine = L.polyline(
    [
      [local.latitude, local.longitude],
      [remote.latitude, remote.longitude],
    ],
    { color: "#341a8d", weight: 3, dashArray: "8,6" }
  ).addTo(state.map);
}

function renderPortalSelection() {
  if (!state.selectedLocalPortalId && !state.selectedRemotePortalId) {
    if (portalSelectionEl) {
      portalSelectionEl.textContent = "No linked portal.";
    }
    updatePortalHud();
    return;
  }

  if (portalSelectionEl) {
    portalSelectionEl.textContent = `Local: ${state.selectedLocalPortalId || "-"} | Remote: ${state.selectedRemotePortalId || "-"}`;
  }
  updatePortalHud();
}

function addNearestPortalToFavorites() {
  const nearest = getNearestPortalAtVirtualPosition(PICKUP_RANGE_METERS);
  if (!nearest) {
    notify("Move closer to a portal to add it to favourites.", "error", 2600);
    return;
  }

  const favorites = loadPortalFavorites();
  if (favorites.some((f) => f.id === nearest.portal.id)) {
    notify("Portal already in favourites.", "info", 2200);
    return;
  }

  favorites.push({
    id: nearest.portal.id,
    latitude: nearest.portal.latitude,
    longitude: nearest.portal.longitude,
  });
  savePortalFavorites(favorites);
  notify("Portal added to favourites.", "success", 2200);
}

function renderPortalModal() {
  const addHereButton = document.getElementById("portal-add-here");
  const addFavoriteButton = document.getElementById("portal-add-favorite");
  const useButton = document.getElementById("portal-use-link");
  const returnButton = document.getElementById("portal-return-physical");
  const clearButton = document.getElementById("portal-clear-link");
  const removeNearbyButton = document.getElementById("portal-remove-nearby");

  const shifted = isVirtualShiftActive();
  if (addHereButton) addHereButton.disabled = shifted;
  if (addFavoriteButton) addFavoriteButton.disabled = !getNearestPortalAtVirtualPosition(PICKUP_RANGE_METERS);
  if (useButton) useButton.disabled = !canUseCurrentPortalLink();
  if (returnButton) returnButton.disabled = !shifted;
  if (clearButton) clearButton.disabled = !canClearCurrentPortalLink();
  if (removeNearbyButton) removeNearbyButton.disabled = !(getPhysicalNearbyPortals(PORTAL_REMOVE_RANGE_METERS)?.length);

  if (!portalFavoritesListEl) return;
  portalFavoritesListEl.innerHTML = "";
  const favorites = loadPortalFavorites();
  if (!favorites.length) {
    const empty = document.createElement("li");
    empty.textContent = "No favourite portals yet.";
    portalFavoritesListEl.appendChild(empty);
    return;
  }

  for (const favorite of favorites) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${favorite.id.slice(0, 8)}...</strong><br /><small>${favorite.latitude.toFixed(6)}, ${favorite.longitude.toFixed(6)}</small>`;

    const actions = document.createElement("div");
    actions.className = "favorite-actions";

    const selectButton = document.createElement("button");
    selectButton.textContent = "Use As Remote";
    selectButton.addEventListener("click", () => {
      setRemotePortal({
        id: favorite.id,
        type: "portal_marker",
        latitude: favorite.latitude,
        longitude: favorite.longitude,
      });
      renderPortalModal();
    });
    actions.appendChild(selectButton);

    const removeButton = document.createElement("button");
      removeButton.textContent = "Remove Favourite";
    removeButton.addEventListener("click", () => {
      savePortalFavorites(loadPortalFavorites().filter((f) => f.id !== favorite.id));
      renderPortalModal();
    });
    actions.appendChild(removeButton);

    li.appendChild(actions);
    portalFavoritesListEl.appendChild(li);
  }
}

function renderDebugModal() {
  const spoofHereButton = document.getElementById("debug-spoof-here");
  const useRealButton = document.getElementById("debug-use-real");
  if (spoofHereButton) spoofHereButton.disabled = state.gpsMode === "spoof";
  if (useRealButton) useRealButton.disabled = state.gpsMode === "real";
}

function savePortalSession() {
  schedulePersistClientState();
}

function loadPortalSession() {
  if (!state.selectedLocalPortalId && !state.selectedRemotePortalId) return;
  updatePortalOffsetFromSelection();
  renderPortalSelection();
}

function renderNearbyItemList() {
  const locationItems = state.nearbyItems.filter((item) => item.type !== "portal_marker");
  renderItemList(locationItems);
}

function renderItemList(items) {
  if (!itemsEl) return;
  itemsEl.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.textContent = "Nothing at this location.";
    itemsEl.appendChild(empty);
    return;
  }

  const virtual = getVirtualPosition();
  for (const item of items) {
    const dist = virtual
      ? Math.round(haversineMeters(virtual.lat, virtual.lng, item.latitude, item.longitude))
      : null;
    const distLabel = dist !== null ? ` — ${dist}m away` : "";
    const canPickUp = dist !== null && dist <= PICKUP_RANGE_METERS;

    const li = document.createElement("li");
    li.className = "inventory-item";
    const textPart = item.content_text ? `<div>${escapeHtml(item.content_text)}</div>` : "";
    const photoPart = item.content_upload_path
      ? `<img src="${item.content_upload_path}" alt="photo" style="max-width:100%; border-radius:8px;" />`
      : "";
    li.innerHTML = `
      <strong>${item.type}</strong> by ${escapeHtml(item.owner)}${distLabel}<br />
      <small>${new Date(item.placement_timestamp).toLocaleString()}</small>
      ${textPart}
      ${photoPart}
    `;

    const actions = document.createElement("div");
    actions.className = "location-item-actions";

    const moveBtn = document.createElement("button");
    moveBtn.textContent = canPickUp ? "Move To Inventory" : "Move Closer To Pick Up";
    moveBtn.disabled = !canPickUp;
    moveBtn.addEventListener("click", () => pickUpItem(item));
    actions.appendChild(moveBtn);

    const downloadBtn = document.createElement("button");
    downloadBtn.textContent = "Download";
    downloadBtn.addEventListener("click", () => downloadItem(item, "location"));
    actions.appendChild(downloadBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteLocationItem(item));
    actions.appendChild(deleteBtn);

    li.appendChild(actions);

    itemsEl.appendChild(li);
  }
}

async function loadNearby(lat, lng, preferCache = true) {
  const maxRangeMeters = PICKUP_RANGE_METERS;
  const nearbyKey = `${state.dimensionRootId}:nearby:${lat.toFixed(4)}:${lng.toFixed(4)}:${maxRangeMeters}`;

  if (preferCache) {
    const cached = cacheRead(nearbyKey);
    if (cached) {
      state.nearbyItems = cached.items || [];
      state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems);
      renderMapItems();
      renderNearbyItemList();
      drawPortalLink();
      return;
    }
  }

  try {
    const h3Api = window.h3;
    if (!h3Api || !h3Api.latLngToCell || !h3Api.gridDisk) {
      throw new Error("H3 client library unavailable");
    }

    const centerCell = h3Api.latLngToCell(lat, lng, H3_RESOLUTION);
    let edgeMeters = 10;
    if (typeof h3Api.getHexagonEdgeLengthAvg === "function") {
      const directMeters = Number(h3Api.getHexagonEdgeLengthAvg(H3_RESOLUTION, "m"));
      if (Number.isFinite(directMeters) && directMeters > 0) {
        edgeMeters = directMeters;
      } else {
        const km = Number(h3Api.getHexagonEdgeLengthAvg(H3_RESOLUTION, "km"));
        if (Number.isFinite(km) && km > 0) {
          edgeMeters = km * 1000;
        }
      }
    }

    const k = Math.max(1, Math.ceil(maxRangeMeters / edgeMeters));
    const candidateCells = h3Api.gridDisk(centerCell, k);

    const cellPayloads = await Promise.all(
      candidateCells.map((cellId) => {
        const key = `${state.dimensionRootId}:cell:${cellId}`;
        const url = `/api/dimensions/${state.dimensionRootId}/cells/${cellId}/item-ids`;
        return fetchJsonWithCache(key, url, preferCache).catch(() => ({ item_ids: [] }));
      })
    );

    const itemIds = Array.from(new Set(cellPayloads.flatMap((payload) => payload.item_ids || [])));
    const items = (
      await Promise.all(
        itemIds.map((itemId) => {
          const key = `item:${itemId}`;
          const url = `/api/items/${itemId}`;
          return fetchJsonWithCache(key, url, preferCache).catch(() => null);
        })
      )
    ).filter(Boolean);

    const nearbyItems = items.filter(
      (item) => haversineMeters(lat, lng, item.latitude, item.longitude) <= maxRangeMeters
    );
    cacheWrite(nearbyKey, { items: nearbyItems });

    state.nearbyItems = nearbyItems;
    state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems);
    renderMapItems();
    renderNearbyItemList();
    drawPortalLink();
  } catch (err) {
    console.error("Failed to load nearby items", err);
    const cached = cacheRead(nearbyKey);
    if (cached) {
      state.nearbyItems = cached.items || [];
      state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems);
      renderMapItems();
      renderNearbyItemList();
      drawPortalLink();
    }
  }
}

async function loadViewportPortals(preferCache = true) {
  if (!state.map || !state.dimensionRootId) return;

  const bounds = state.map.getBounds();
  const key = `${state.dimensionRootId}:bbox:${bounds.getSouth().toFixed(3)}:${bounds.getWest().toFixed(3)}:${bounds.getNorth().toFixed(3)}:${bounds.getEast().toFixed(3)}`;
  if (preferCache) {
    const cached = cacheRead(key);
    if (cached) {
      state.viewportPortalItems = cached.items;
      state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems);
      renderMapItems();
      drawPortalLink();
      return;
    }
  }

  const query = new URLSearchParams({
    min_lat: String(bounds.getSouth()),
    max_lat: String(bounds.getNorth()),
    min_lng: String(bounds.getWest()),
    max_lng: String(bounds.getEast()),
    item_type: "portal_marker",
  });

  try {
    const response = await fetch(`/api/dimensions/${state.dimensionRootId}/items-in-bbox?${query.toString()}`);
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    state.viewportPortalItems = payload.items || [];
    cacheWrite(key, payload);
    state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems);
    renderMapItems();
    drawPortalLink();
  } catch {
    const cached = cacheRead(key);
    if (cached) {
      state.viewportPortalItems = cached.items || [];
      state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems);
      renderMapItems();
      drawPortalLink();
    }
  }
}

function updatePosition(lat, lng, accuracy) {
  state.lastRealPosition = { lat, lng, accuracy };
  if (state.gpsMode === "spoof") {
    schedulePersistClientState();
    return;
  }
  state.physicalPosition = { lat, lng, accuracy };
  schedulePersistClientState();
  refreshGpsSpooferStatus();
  refreshLocationAndNearby(true);
  restoreFollowOnNextFrame();
}

function beginGeolocation() {
  if (!navigator.geolocation) {
    locationStatusEl.textContent = "Location: geolocation unavailable";
    return;
  }

  if (!isSecureEnoughForGeolocation()) {
    locationStatusEl.textContent =
      "Location blocked: Android Chrome requires HTTPS for GPS on non-localhost URLs. Use HTTPS tunnel or localhost.";
    return;
  }

  updatePermissionHint();

  if (geolocationWatchId !== null) {
    navigator.geolocation.clearWatch(geolocationWatchId);
    geolocationWatchId = null;
  }

  locationStatusEl.textContent = "Location: requesting GPS...";
  setFirstFixTimeout();

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      clearFirstFixTimeout();
      updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    (err) => {
      locationStatusEl.textContent = `Location error: ${explainGeoError(err)}`;
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );

  geolocationWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      clearFirstFixTimeout();
      updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    (err) => {
      locationStatusEl.textContent = `Location error: ${explainGeoError(err)}`;
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );
}

async function placePortal() {
  if (!state.physicalPosition) return;

  const tooClose = state.displayItems.some((item) => {
    if (item.type !== "portal_marker") return false;
    const d = haversineMeters(
      state.physicalPosition.lat,
      state.physicalPosition.lng,
      item.latitude,
      item.longitude
    );
    return d < MIN_PORTAL_SPACING_METERS;
  });

  if (tooClose) {
    notify(`Portal too close to an existing portal. Keep at least ${MIN_PORTAL_SPACING_METERS}m spacing.`, "error");
    return;
  }

  const body = {
    type: "portal_marker",
    owner: state.ownerId,
    latitude: state.physicalPosition.lat,
    longitude: state.physicalPosition.lng,
    accuracy_meters: state.physicalPosition.accuracy,
  };

  const url = `/api/dimensions/${state.dimensionRootId}/items`;

  try {
    if (!navigator.onLine) throw new Error("offline");
    await sendJson(url, body);
  } catch {
    queueWrite({ kind: "json", url, body });
  }

  await replayQueue();
  const virtual = getVirtualPosition();
  if (virtual) {
    await loadNearby(virtual.lat, virtual.lng, false);
  }
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const r = 6371000;
  const dLat = degToRad(lat2 - lat1);
  const dLng = degToRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function degToRad(x) {
  return (x * Math.PI) / 180;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("online", async () => {
  setNetworkStatus();
  await replayQueue();
  const virtual = getVirtualPosition();
  if (virtual) await loadNearby(virtual.lat, virtual.lng, false);
});
window.addEventListener("offline", setNetworkStatus);
window.addEventListener("beforeunload", persistClientStateNow);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    persistClientStateNow();
  }
});

followToggleButtonEl?.addEventListener("click", () => {
  state.followPlayer = true;
  schedulePersistClientState();
  updateFollowIndicator();
  centerMapOnPlayerVirtual(true);
});

document.getElementById("action-open-items")?.addEventListener("click", () => {
  openModal(itemsModalEl);
  renderNearbyItemList();
  renderInventory();
  setPlayerActionsOpen(false);
});

document.getElementById("action-open-settings")?.addEventListener("click", () => {
  openModal(settingsModalEl);
  setPlayerActionsOpen(false);
});

document.getElementById("action-open-about")?.addEventListener("click", () => {
  openModal(aboutModalEl);
  setPlayerActionsOpen(false);
});

document.getElementById("action-open-portals")?.addEventListener("click", () => {
  openModal(portalsModalEl);
  renderPortalModal();
  setPlayerActionsOpen(false);
});

document.getElementById("action-open-debug")?.addEventListener("click", () => {
  openModal(debugModalEl);
  renderDebugModal();
  setPlayerActionsOpen(false);
});

document.getElementById("action-close-player-menu")?.addEventListener("click", () => {
  setPlayerActionsOpen(false);
});

modalScrimEl?.addEventListener("click", () => {
  closeTopUiLayer();
});

for (const [id, modal] of [["items-modal-close", itemsModalEl], ["portals-modal-close", portalsModalEl], ["debug-modal-close", debugModalEl], ["settings-modal-close", settingsModalEl], ["about-modal-close", aboutModalEl], ["item-add-close", itemAddModalEl]]) {
  document.getElementById(id)?.addEventListener("click", () => closeModal(modal));
}

document.getElementById("item-add-cancel")?.addEventListener("click", () => {
  closeTopUiLayer();
});

locationAddItemButtonEl?.addEventListener("click", () => {
  itemAddTarget = "location";
  openModal(itemAddModalEl);
  itemAddTextEl?.focus();
});

inventoryAddItemButtonEl?.addEventListener("click", () => {
  itemAddTarget = "inventory";
  openModal(itemAddModalEl);
  itemAddTextEl?.focus();
});

document.getElementById("portal-add-here")?.addEventListener("click", async () => {
  await placePortal();
  renderPortalModal();
});

document.getElementById("portal-add-favorite")?.addEventListener("click", () => {
  addNearestPortalToFavorites();
  renderPortalModal();
});

document.getElementById("portal-use-link")?.addEventListener("click", () => {
  if (!canUseCurrentPortalLink()) {
    notify("Stand by the linked source portal to use this portal.", "error", 2800);
    return;
  }
  jumpThroughPortalLink();
  renderPortalModal();
});

document.getElementById("portal-return-physical")?.addEventListener("click", () => {
  returnToPhysicalPosition();
  renderPortalModal();
});

document.getElementById("portal-clear-link")?.addEventListener("click", () => {
  if (!canClearCurrentPortalLink()) {
    notify("Clear link requires standing by the linked source portal while not teleported.", "error", 3200);
    return;
  }
  clearPortalLink(true);
  renderPortalModal();
});

document.getElementById("portal-remove-nearby")?.addEventListener("click", async () => {
  const nearby = getPhysicalNearbyPortals(PORTAL_REMOVE_RANGE_METERS);
  if (!nearby || !nearby.length) {
    notify("Move physically within range of a portal to remove it.", "error", 2800);
    return;
  }
  await removePortalItem(nearby[0].portal);
  renderPortalModal();
});

document.getElementById("debug-spoof-here")?.addEventListener("click", () => {
  if (state.gpsMode === "spoof") return;
  const p = getMapCenterOrPhysical();
  if (!p) {
    notify("No map position available.", "error");
    return;
  }
  setSpoofPosition(p.lat, p.lng, "map center");
  renderDebugModal();
});

document.getElementById("debug-use-real")?.addEventListener("click", () => {
  if (state.gpsMode === "real") return;
  useRealGpsMode();
  renderDebugModal();
});

document.getElementById("debug-set-loc-c")?.addEventListener("click", setLocCFromPrompt);
document.getElementById("debug-loc-a")?.addEventListener("click", () => setPresetSpoof("A"));
document.getElementById("debug-loc-b")?.addEventListener("click", () => setPresetSpoof("B"));
document.getElementById("debug-loc-c")?.addEventListener("click", () => setPresetSpoof("C"));
document.getElementById("debug-walk-north")?.addEventListener("click", () => walkSpoof(1, 0, "north"));
document.getElementById("debug-walk-east")?.addEventListener("click", () => walkSpoof(0, 1, "east"));
document.getElementById("debug-walk-south")?.addEventListener("click", () => walkSpoof(-1, 0, "south"));
document.getElementById("debug-walk-west")?.addEventListener("click", () => walkSpoof(0, -1, "west"));

menuToggleButtonEl?.addEventListener("click", () => {
  toggleDevMenu();
});

menuCloseButtonEl?.addEventListener("click", () => {
  closeTopUiLayer();
});

menuScrimEl?.addEventListener("click", () => {
  closeTopUiLayer();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (uiStack.length) {
    closeTopUiLayer();
    return;
  }
});

window.addEventListener("popstate", updateUiHistoryOnPop);

window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) return;

  if (event.key === "m" || event.key === "M") {
    event.preventDefault();
    toggleDevMenu();
    return;
  }

  if (event.key === "1") {
    event.preventDefault();
    setPresetSpoof("A");
    return;
  }

  if (event.key === "2") {
    event.preventDefault();
    setPresetSpoof("B");
    return;
  }

  if (event.key === "3") {
    event.preventDefault();
    setPresetSpoof("C");
    return;
  }

  if (event.key === "r" || event.key === "R") {
    event.preventDefault();
    state.followPlayer = true;
    schedulePersistClientState();
    updateFollowIndicator();
    centerMapOnPlayerVirtual(true);
    return;
  }

  if (event.key === "0") {
    event.preventDefault();
    returnToPhysicalPosition();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    walkSpoof(1, 0, "north");
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    walkSpoof(0, 1, "east");
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    walkSpoof(-1, 0, "south");
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    walkSpoof(0, -1, "west");
  }
});

themeCycleButtonEl?.addEventListener("click", cycleThemeChoice);
settingsThemeCycleButtonEl?.addEventListener("click", cycleThemeChoice);
settingsFollowPlayerButtonEl?.addEventListener("click", () => {
  state.followPlayer = true;
  schedulePersistClientState();
  updateFollowIndicator();
  centerMapOnPlayerVirtual(true);
});

// ── Inventory ─────────────────────────────────────────────────────────────────

function saveInventory() {
  localStorage.setItem(inventoryKey, JSON.stringify(state.inventory));
}

async function deleteLocationItem(item) {
  try {
    const response = await fetch(
      `/api/dimensions/${state.dimensionRootId}/items/${item.id}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      notify(`Could not remove item: ${await response.text()}`, "error", 4000);
      return;
    }
  } catch {
    notify("Network error removing item. Try again.", "error");
    return;
  }

  const virtual = getVirtualPosition();
  if (virtual) await loadNearby(virtual.lat, virtual.lng, false);
  notify("Item deleted.", "success", 2000);
}

async function downloadItem(item, sourceLabel) {
  const ts = new Date().toISOString().replaceAll(":", "-");

  if (item.content_upload_path) {
    try {
      const response = await fetch(item.content_upload_path);
      if (!response.ok) throw new Error("download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ext = blob.type.includes("png") ? "png" : blob.type.includes("jpeg") ? "jpg" : "bin";
      a.href = url;
      a.download = `quipu-${sourceLabel}-${item.id}-${ts}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      notify("Could not download image for this item.", "error");
    }
  }

  if (item.content_data_url) {
    const a = document.createElement("a");
    a.href = item.content_data_url;
    a.download = `quipu-${sourceLabel}-${item.id}-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (item.content_text) {
    const blob = new Blob([item.content_text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quipu-${sourceLabel}-${item.id}-${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

function removeFromInventory(itemId) {
  state.inventory = state.inventory.filter((i) => i.id !== itemId);
  saveInventory();
}

function deleteInventoryItem(item) {
  removeFromInventory(item.id);
  renderInventory();
  notify("Item deleted.", "success", 2000);
}

async function pickUpItem(item) {
  try {
    const response = await fetch(
      `/api/dimensions/${state.dimensionRootId}/items/${item.id}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      notify(`Could not pick up item: ${await response.text()}`, "error", 4000);
      return;
    }
  } catch {
    notify("Network error picking up item. Try again.", "error");
    return;
  }
  state.inventory.push({ ...item });
  saveInventory();
  renderInventory();
  const virtual = getVirtualPosition();
  if (virtual) await loadNearby(virtual.lat, virtual.lng, false);
}

async function removePortalItem(item) {
  if (!state.physicalPosition) {
    notify("GPS position needed to remove a portal.", "error");
    return;
  }

  const distance = haversineMeters(
    state.physicalPosition.lat,
    state.physicalPosition.lng,
    item.latitude,
    item.longitude
  );
  if (distance > PORTAL_REMOVE_RANGE_METERS) {
    notify(`Move physically to within ${PORTAL_REMOVE_RANGE_METERS}m to remove this portal.`, "error", 3200);
    return;
  }

  const params = new URLSearchParams({
    actor_latitude: String(state.physicalPosition.lat),
    actor_longitude: String(state.physicalPosition.lng),
  });

  try {
    const response = await fetch(
      `/api/dimensions/${state.dimensionRootId}/items/${item.id}?${params.toString()}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      notify(`Could not remove portal: ${await response.text()}`, "error", 4200);
      return;
    }
  } catch {
    notify("Network error removing portal. Try again.", "error");
    return;
  }

  if (state.selectedLocalPortalId === item.id || state.selectedRemotePortalId === item.id) {
    clearPortalLink(false);
  }

  const virtual = getVirtualPosition();
  if (virtual) {
    await loadNearby(virtual.lat, virtual.lng, false);
  }
  notify("Portal removed.", "success", 2200);
}

async function replayInventoryItem(item, editedText) {
  const virtual = getVirtualPosition();
  if (!virtual || !state.physicalPosition) {
    notify("GPS position needed to place an item.", "error");
    return;
  }

  const finalText = (editedText ?? item.content_text ?? "").trim();
  const hasImage = Boolean(item.content_upload_path || item.content_data_url);

  if (!finalText && !hasImage) {
    notify("Item has no text or image.", "error");
    return;
  }

  if (item.type === "portal_marker") {
    notify("Cannot re-place this item type.", "error");
    return;
  }

  try {
    if (!navigator.onLine) throw new Error("offline");
    if (hasImage && item.content_data_url) {
      const form = new FormData();
      form.append("owner", state.ownerId);
      form.append("latitude", String(virtual.lat));
      form.append("longitude", String(virtual.lng));
      form.append("accuracy_meters", String(state.physicalPosition.accuracy));
      form.append("content_text", finalText);
      form.append("file", dataUrlToFile(item.content_data_url, `${item.id}.png`, "image/png"));
      const response = await fetch(`/api/dimensions/${state.dimensionRootId}/photos`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error(await response.text());
    } else if (hasImage && item.content_upload_path) {
      await sendJson(`/api/dimensions/${state.dimensionRootId}/items`, {
        type: "photograph",
        owner: state.ownerId,
        latitude: virtual.lat,
        longitude: virtual.lng,
        accuracy_meters: state.physicalPosition.accuracy,
        content_text: finalText || null,
        content_upload_path: item.content_upload_path,
      });
    } else {
      await sendJson(`/api/dimensions/${state.dimensionRootId}/items`, {
        type: "letter",
        owner: state.ownerId,
        latitude: virtual.lat,
        longitude: virtual.lng,
        accuracy_meters: state.physicalPosition.accuracy,
        content_text: finalText,
      });
    }
  } catch {
    notify("Could not place inventory item. Try again when online.", "error", 3200);
    return;
  }

  removeFromInventory(item.id);
  await replayQueue();
  const virtual2 = getVirtualPosition();
  if (virtual2) await loadNearby(virtual2.lat, virtual2.lng, false);
  renderInventory();
}

function renderInventory() {
  const inventoryEl = inventoryItemsListEl;
  const inventoryCountEl = null;
  if (!inventoryEl) return;
  if (inventoryCountEl) inventoryCountEl.textContent = String(state.inventory.length);

  inventoryEl.innerHTML = "";
  if (!state.inventory.length) {
    const empty = document.createElement("li");
    empty.textContent = "Nothing held.";
    inventoryEl.appendChild(empty);
    return;
  }

  for (const item of state.inventory) {
    const li = document.createElement("li");
    li.className = "inventory-item";

    const header = document.createElement("div");
    header.innerHTML = `<strong>${item.type}</strong> — picked up <small>${new Date(item.placement_timestamp).toLocaleString()}</small>`;
    li.appendChild(header);

    let textareaEl = null;
    if (item.content_text) {
      textareaEl = document.createElement("textarea");
      textareaEl.rows = 3;
      textareaEl.style.width = "100%";
      textareaEl.value = item.content_text || "";
      li.appendChild(textareaEl);
    }

    if ((item.type === "photograph" && item.content_upload_path) || item.content_data_url) {
      const img = document.createElement("img");
      img.src = item.content_upload_path || item.content_data_url;
      img.alt = "photo";
      img.style.cssText = "max-width:100%; border-radius:8px; display:block; margin:0.25rem 0;";
      li.appendChild(img);
    }

    const actions = document.createElement("div");
    actions.className = "inventory-actions";

    const placeBtn = document.createElement("button");
    placeBtn.textContent = "Place here";
    placeBtn.addEventListener("click", () => {
      replayInventoryItem(item, textareaEl ? textareaEl.value : null);
    });
    actions.appendChild(placeBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteInventoryItem(item));
    actions.appendChild(deleteBtn);

    const downloadBtn = document.createElement("button");
    downloadBtn.textContent = "Download";
    downloadBtn.addEventListener("click", () => downloadItem(item, "inventory"));
    actions.appendChild(downloadBtn);

    li.appendChild(actions);

    inventoryEl.appendChild(li);
  }
}

itemAddFormEl?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const virtual = getVirtualPosition();
  const text = (itemAddTextEl?.value || "").trim();
  const photoFile = itemAddPhotoEl?.files?.[0] || null;

  if (!text && !photoFile) {
    notify("Add text and/or image.", "error");
    return;
  }

  if (itemAddTarget === "inventory") {
    const newItem = {
      id: crypto.randomUUID(),
      type: classifyItemType(text, Boolean(photoFile)),
      owner: state.ownerId,
      placement_timestamp: new Date().toISOString(),
      content_text: text || null,
      content_data_url: photoFile ? await fileToDataUrl(photoFile) : null,
    };
    state.inventory.push(newItem);
    saveInventory();
    renderInventory();
    notify("Item added to inventory.", "success", 2000);
  } else {
    if (!virtual || !state.physicalPosition) {
      notify("GPS position needed to add a location item.", "error");
      return;
    }

    try {
      if (photoFile) {
        const form = new FormData();
        form.append("owner", state.ownerId);
        form.append("latitude", String(virtual.lat));
        form.append("longitude", String(virtual.lng));
        form.append("accuracy_meters", String(state.physicalPosition.accuracy));
        form.append("content_text", text);
        form.append("file", photoFile);
        const response = await fetch(`/api/dimensions/${state.dimensionRootId}/photos`, {
          method: "POST",
          body: form,
        });
        if (!response.ok) {
          notify(await response.text(), "error", 4000);
          return;
        }
      } else {
        await sendJson(`/api/dimensions/${state.dimensionRootId}/items`, {
          type: "letter",
          owner: state.ownerId,
          latitude: virtual.lat,
          longitude: virtual.lng,
          accuracy_meters: state.physicalPosition.accuracy,
          content_text: text,
        });
      }
    } catch {
      notify("Could not add location item. Try again.", "error");
      return;
    }

    await loadNearby(virtual.lat, virtual.lng, false);
    notify("Item added at this location.", "success", 2000);
  }

  if (itemAddTextEl) itemAddTextEl.value = "";
  if (itemAddPhotoEl) itemAddPhotoEl.value = "";
  closeTopUiLayer();
});

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  initThemeMode();
  setNetworkStatus();
  initLocCInputs();
  refreshGpsSpooferStatus();
  initMap();
  history.replaceState({ uiSessionId, uiStack: [] }, "", window.location.href);
  syncUiStack([]);
  updatePlayerMarkers();
  updateFollowIndicator();
  updatePortalHud();
  renderInventory();
  await getDefaultDimension();
  await loadViewportPortals(true);
  loadPortalSession();
  restoreFollowOnNextFrame();
  if (state.followPlayer && getVirtualPosition()) {
    refreshLocationAndNearby(true);
  }
  beginGeolocation();
  await replayQueue();
}

boot();

window.addEventListener("load", restoreFollowOnNextFrame);
