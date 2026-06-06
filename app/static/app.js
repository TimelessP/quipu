const state = {
  ownerId: localStorage.getItem("quipuOwnerId") || crypto.randomUUID(),
  dimensionRootId: null,
  physicalPosition: null,
  lastRealPosition: null,
  gpsMode: "real",
  gpsSpoofLabel: null,
  gpsAccuracyOverrideMeters: null,
  currentHeading: null,
  mapRotationMode: "heading",
  virtualOffset: { lat: 0, lng: 0 },
  followPlayer: true,
  sharedPortalFocusActive: false,
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
  visitCounterViewedIds: new Set(),
};

const AREA_OF_EFFECT_RADIUS_METERS = 15; // central interaction/ring radius
const PICKUP_RANGE_METERS = AREA_OF_EFFECT_RADIUS_METERS;
const RANGE_RING_VISIBLE_ZOOM = 18;
const INVENTORY_TEXTAREA_MIN_ROWS = 4;
const INVENTORY_TEXTAREA_MAX_ROWS = 12;
const PORTAL_VIEWPORT_FETCH_ZOOM = 18;
const PORTAL_CACHE_TTL_MS = 5 * 60 * 1000;
const WALK_SPEED_MPS = 1.4;
const PLACEMENT_ACCURACY_THRESHOLD_METERS = 50;
const H3_RESOLUTION = 12;
// Hard cap on viewport cell fan-out. At res 12 a zoom-18 mobile viewport is ~10-40 cells;
// 200 is a comfortable ceiling that prevents accidental global queries.
const MAX_VIEWPORT_CELLS = 200;
const MIN_PORTAL_SPACING_METERS = 8;
const PORTAL_INTERACTION_RANGE_METERS = AREA_OF_EFFECT_RADIUS_METERS;
const PORTAL_REMOVE_RANGE_METERS = PORTAL_INTERACTION_RANGE_METERS;
const SHARED_PORTAL_LAT_PARAM = "portal_lat";
const SHARED_PORTAL_LNG_PARAM = "portal_lng";
const inventoryKey = "quipuInventoryV2";

// Restore persisted inventory
const _savedInventory = localStorage.getItem(inventoryKey);
if (_savedInventory) {
  try { state.inventory = JSON.parse(_savedInventory).map((item) => normalizeInventoryItem(item)); } catch { state.inventory = []; }
}

localStorage.setItem("quipuOwnerId", state.ownerId);

const cacheKey = "quipuNearbyCacheV1";
const queueKey = "quipuWriteQueueV1";
const customLocCKey = "quipuGpsLocC";
const themeChoiceKey = "quipuThemeChoiceV1";
const portalFavoritesKey = "quipuPortalFavoritesV1";
const clientStateKey = "quipuClientStateV1";
const followRepairKey = "quipuFollowRepairV1";

hydrateClientState();

const GPS_PRESETS = {
  A: { label: "Loc A", lat: 51.507351, lng: -0.127758 },
  B: { label: "Loc B", lat: 35.6762, lng: 139.6503 },
};

const networkStatusEl = document.getElementById("network-status");
const dimensionStatusEl = document.getElementById("dimension-status");
const menuShareQrEl = document.getElementById("menu-share-qr");
const menuShareUrlEl = document.getElementById("menu-share-url");
const menuShareCopyButtonEl = document.getElementById("menu-share-copy");
const locationStatusEl = document.getElementById("location-status");
const itemsEl = document.getElementById("location-items-list");
const portalSelectionEl = document.getElementById("portal-link-summary");
const followToggleButtonEl = document.getElementById("follow-toggle");
const gpsSpooferStatusEl = document.getElementById("gps-spoofer-status");
const gpsWalkMetersEl = document.getElementById("gps-walk-meters");
const mapRotationToggleButtonEl = document.getElementById("map-rotation-toggle");
const portalReturnButtonEl = document.getElementById("portal-return-top");
const portalUseNearestButtonEl = document.getElementById("portal-use-nearest-top");
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
const itemAddTypeEl = document.getElementById("item-add-type");
const itemAddMediaFieldsEl = document.getElementById("item-add-media-fields");
const itemAddNameEl = document.getElementById("item-add-name");
const itemAddTextEl = document.getElementById("item-add-text");
const itemAddUrlEl = document.getElementById("item-add-url");
const itemAddPhotoEl = document.getElementById("item-add-photo");
const settingsModalEl = document.getElementById("settings-modal");
const aboutModalEl = document.getElementById("about-modal");
const settingsThemeCycleButtonEl = document.getElementById("settings-theme-cycle");
const settingsFollowPlayerButtonEl = document.getElementById("settings-follow-player");
const portalNameInputEl = document.getElementById("portal-name-input");
const portalContentTextEl = document.getElementById("portal-content-text");
const portalContentUrlEl = document.getElementById("portal-content-url");
const portalContentImageEl = document.getElementById("portal-content-image");
const portalContentImageRemoveButtonEl = document.getElementById("portal-content-image-remove");
const portalEditorTargetEl = document.getElementById("portal-editor-target");
const portalLoadNearestButtonEl = document.getElementById("portal-load-nearest");
const portalContentUrlPreviewEl = document.getElementById("portal-content-url-preview");
const portalContentImagePreviewEl = document.getElementById("portal-content-image-preview");
const portalNearbyListEl = document.getElementById("portal-nearby-list");
const gpsAccuracyOverrideInputEl = document.getElementById("gps-accuracy-override");

let prefersDarkMediaQuery = null;
let noticeTimerId = null;
let itemAddTarget = "location";
let persistClientStateTimerId = null;
let followRestoreFrameId = null;
let portalEditorTargetId = null;
let portalEditorBaseline = null;
let portalEditorImageClearRequested = false;
let menuShareQrCode = null;
// Two-level concurrency guard for loadNearby:
// - loadNearbyFreshGeneration: incremented whenever a network fetch starts;
//   only a newer network fetch supersedes an older one.
// - loadNearbyFreshInFlight: count of in-progress network fetches;
//   cache-path renders are suppressed while this is non-zero so they
//   never clobber a pending authoritative result (including remote players' items).
let loadNearbyFreshGeneration = 0;
let loadNearbyFreshInFlight = 0;
let menuShareLastUrl = "";
const uiSessionId = crypto.randomUUID();
let uiStack = [];
let syncingUiFromHistory = false;

function getClientShareUrl() {
  return window.location.href;
}

function renderMenuShareQr(force = false) {
  if (!menuShareQrEl || !menuShareUrlEl) return;

  const shareUrl = getClientShareUrl();
  if (!force && shareUrl === menuShareLastUrl) return;
  menuShareLastUrl = shareUrl;

  menuShareUrlEl.href = shareUrl;
  menuShareUrlEl.textContent = shareUrl;

  if (typeof window.QRCode !== "function") {
    menuShareQrEl.textContent = "QR unavailable";
    return;
  }

  if (!menuShareQrCode) {
    menuShareQrEl.innerHTML = "";
    menuShareQrCode = new window.QRCode(menuShareQrEl, {
      text: shareUrl,
      width: 140,
      height: 140,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    return;
  }

  menuShareQrCode.makeCode(shareUrl);
}

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
  renderMenuShareQr();
}

function persistClientStateNow() {
  const snapshot = {
    gpsMode: state.gpsMode,
    gpsSpoofLabel: state.gpsSpoofLabel,
    gpsAccuracyOverrideMeters: Number.isFinite(state.gpsAccuracyOverrideMeters) ? state.gpsAccuracyOverrideMeters : null,
    currentHeading: Number.isFinite(state.currentHeading) ? state.currentHeading : null,
    mapRotationMode: state.mapRotationMode,
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

  if (!parsed) return;

  if (parsed.gpsMode === "real" || parsed.gpsMode === "spoof") {
    state.gpsMode = parsed.gpsMode;
  }
  if (typeof parsed.gpsSpoofLabel === "string" || parsed.gpsSpoofLabel === null) {
    state.gpsSpoofLabel = parsed.gpsSpoofLabel;
  }
  if (Number.isFinite(parsed.gpsAccuracyOverrideMeters) || parsed.gpsAccuracyOverrideMeters === null) {
    state.gpsAccuracyOverrideMeters = parsed.gpsAccuracyOverrideMeters;
  }
  if (Number.isFinite(parsed.currentHeading) || parsed.currentHeading === null) {
    state.currentHeading = parsed.currentHeading;
  }
  if (parsed.mapRotationMode === "heading" || parsed.mapRotationMode === "north") {
    state.mapRotationMode = parsed.mapRotationMode;
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

async function validateLinkedPortalSession() {
  const selectedIds = [state.selectedLocalPortalId, state.selectedRemotePortalId]
    .filter((id) => typeof id === "string" && id);
  if (!selectedIds.length || !state.dimensionRootId) return;

  const uniqueIds = Array.from(new Set(selectedIds));
  const checks = await Promise.all(
    uniqueIds.map(async (itemId) => {
      try {
        const response = await fetch(`/api/items/${itemId}`, { cache: "no-store" });
        if (!response.ok) {
          return { itemId, missing: response.status === 404, invalid: true };
        }
        const item = await response.json();
        const invalid =
          !item ||
          item.type !== "portal_marker" ||
          item.dimension_root_id !== state.dimensionRootId;
        return { itemId, item, invalid, missing: false };
      } catch {
        return { itemId, missing: false, invalid: false };
      }
    })
  );

  let hadInvalid = false;
  for (const check of checks) {
    if (!check.invalid) {
      if (check.item) updatePortalItemsInState(check.item);
      continue;
    }
    hadInvalid = true;
    reconcileMissingItem(check.itemId);
  }

  if (hadInvalid && (!state.selectedLocalPortalId || !state.selectedRemotePortalId)) {
    clearPortalLink(false);
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

function getSpoofAccuracyMeters() {
  if (state.gpsMode !== "spoof") return null;
  if (Number.isFinite(state.gpsAccuracyOverrideMeters) && state.gpsAccuracyOverrideMeters >= 0) {
    return state.gpsAccuracyOverrideMeters;
  }
  return 3;
}

function getPlacementAccuracyMeters() {
  if (!state.physicalPosition) return null;
  const spoofAccuracy = getSpoofAccuracyMeters();
  if (spoofAccuracy !== null) return spoofAccuracy;

  const reportedAccuracy = state.physicalPosition.accuracy ?? null;
  if (!Number.isFinite(reportedAccuracy)) return null;

  // Desktop browsers commonly provide coarse Wi-Fi geolocation that is good enough
  // for user-directed placement but exceeds the strict mobile GPS threshold.
  const isDesktopLike = !window.matchMedia("(pointer: coarse)").matches;
  if (isDesktopLike && reportedAccuracy > PLACEMENT_ACCURACY_THRESHOLD_METERS) {
    return PLACEMENT_ACCURACY_THRESHOLD_METERS;
  }

  return reportedAccuracy;
}

function setSpoofAccuracyOverrideMeters(value) {
  if (value === null) {
    state.gpsAccuracyOverrideMeters = null;
  } else if (Number.isFinite(value) && value >= 0) {
    state.gpsAccuracyOverrideMeters = value;
  } else {
    return;
  }

  if (state.gpsMode === "spoof" && state.physicalPosition) {
    state.physicalPosition = {
      ...state.physicalPosition,
      accuracy: getSpoofAccuracyMeters() ?? state.physicalPosition.accuracy,
    };
    refreshLocationAndNearby(false);
  }

  schedulePersistClientState();
  refreshGpsSpooferStatus();
  renderDebugModal();
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
  if (state.map) {
    updatePlayerMarkers();
    renderMapItems();
    drawPortalLink();
  }
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
let deviceOrientationBound = false;
let lastDeviceHeadingAt = 0;
let targetHeading = null;
let headingAnimationFrameId = null;
let headingAnimationLastTs = 0;
let preferredOrientationSource = null;
let lastOrientationSourceAt = 0;

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
    const accuracyLabel = Number.isFinite(state.physicalPosition.accuracy)
      ? `${state.physicalPosition.accuracy.toFixed(1)}m`
      : "n/a";
    const overrideLabel = Number.isFinite(state.gpsAccuracyOverrideMeters)
      ? `${state.gpsAccuracyOverrideMeters.toFixed(1)}m override`
      : "default spoof accuracy";
    gpsSpooferStatusEl.textContent =
      `GPS Debug: SPOOF ON (${state.gpsSpoofLabel || "manual"}) at ${formatLatLng(state.physicalPosition.lat, state.physicalPosition.lng)}. ` +
      `Accuracy: ${accuracyLabel} (${overrideLabel}). Saved Loc C: ${locCLabel}`;
    return;
  }

  gpsSpooferStatusEl.textContent = `GPS Debug: using real GPS. Saved Loc C: ${locCLabel}`;
}

function syncSpoofAccuracyInput() {
  if (!gpsAccuracyOverrideInputEl) return;
  gpsAccuracyOverrideInputEl.value = Number.isFinite(state.gpsAccuracyOverrideMeters)
    ? String(state.gpsAccuracyOverrideMeters)
    : "";
  gpsAccuracyOverrideInputEl.disabled = state.gpsMode !== "spoof";
}

function setSpoofPosition(lat, lng, label) {
  state.gpsMode = "spoof";
  state.gpsSpoofLabel = label || "manual";
  state.currentHeading = null;
  state.physicalPosition = {
    lat,
    lng,
    accuracy: getSpoofAccuracyMeters() ?? 3,
  };
  schedulePersistClientState();
  refreshGpsSpooferStatus();
  syncSpoofAccuracyInput();
  refreshLocationAndNearby(false);
}

function setPresetSpoof(key) {
  updateTopOverlayButtons();
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
  syncSpoofAccuracyInput();
  updateTopOverlayButtons();
  applyMapRotation();
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

function getEffectiveActorPosition() {
  return getVirtualPosition() || state.physicalPosition;
}

function isFollowingPlayer() {
  return Boolean(state.followPlayer) && !state.sharedPortalFocusActive;
}

function updateFollowIndicator() {
  if (!followToggleButtonEl) return;
  const isFollowing = isFollowingPlayer();
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
    return parsed
      .filter((f) => Number.isFinite(f?.latitude) && Number.isFinite(f?.longitude))
      .map((favorite) => normalizePortalFavorite(favorite));
  } catch {
    return [];
  }
}

function savePortalFavorites(favorites) {
  localStorage.setItem(portalFavoritesKey, JSON.stringify(favorites.map((favorite) => normalizePortalFavorite(favorite))));
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sanitizeExternalHttpUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function normalizeInventoryItem(item) {
  const type = typeof item?.type === "string" ? item.type : "media";
  return {
    id: typeof item?.id === "string" && item.id ? item.id : crypto.randomUUID(),
    type,
    owner: typeof item?.owner === "string" && item.owner ? item.owner : state.ownerId,
    placement_timestamp: item?.placement_timestamp || new Date().toISOString(),
    content_name: normalizeOptionalText(item?.content_name),
    content_text: normalizeOptionalText(item?.content_text),
    content_url: normalizeOptionalUrl(item?.content_url),
    content_upload_path: typeof item?.content_upload_path === "string" && item.content_upload_path ? item.content_upload_path : null,
    content_data_url: typeof item?.content_data_url === "string" && item.content_data_url ? item.content_data_url : null,
    favorite_portal_id: typeof item?.favorite_portal_id === "string" && item.favorite_portal_id ? item.favorite_portal_id : null,
    favorite_portal_latitude: Number.isFinite(item?.favorite_portal_latitude) ? Number(item.favorite_portal_latitude) : null,
    favorite_portal_longitude: Number.isFinite(item?.favorite_portal_longitude) ? Number(item.favorite_portal_longitude) : null,
    favorite_portal_name: normalizeOptionalText(item?.favorite_portal_name),
    visit_counter_name: normalizeOptionalText(item?.visit_counter_name),
    visit_count: Number.isFinite(item?.visit_count) ? Math.max(0, Math.floor(Number(item.visit_count))) : 0,
  };
}

function removePortalFavoriteById(portalId) {
  if (typeof portalId !== "string" || !portalId) return false;
  const favorites = loadPortalFavorites();
  const nextFavorites = favorites.filter((favorite) => favorite.id !== portalId);
  if (nextFavorites.length === favorites.length) return false;
  savePortalFavorites(nextFavorites);
  return true;
}

function normalizePortalFavorite(favorite) {
  return {
    id: typeof favorite?.id === "string" ? favorite.id : null,
    latitude: Number(favorite?.latitude),
    longitude: Number(favorite?.longitude),
    portal_name: typeof favorite?.portal_name === "string" && favorite.portal_name.trim() ? favorite.portal_name.trim() : null,
    content_name: normalizeOptionalText(favorite?.content_name),
    content_text: normalizeOptionalText(favorite?.content_text),
    content_url: normalizeOptionalUrl(favorite?.content_url),
    content_upload_path: typeof favorite?.content_upload_path === "string" && favorite.content_upload_path ? favorite.content_upload_path : null,
    content_data_url: typeof favorite?.content_data_url === "string" && favorite.content_data_url ? favorite.content_data_url : null,
  };
}

function updatePortalFavorite(portalId, patch) {
  if (typeof portalId !== "string" || !portalId) return;
  const nextFavorites = loadPortalFavorites().map((favorite) => {
    if (favorite.id !== portalId) return favorite;
    return normalizePortalFavorite({ ...favorite, ...patch });
  });
  savePortalFavorites(nextFavorites);
}

function updateInventoryItem(itemId, patch) {
  state.inventory = state.inventory.map((item) => {
    if (item.id !== itemId) return item;
    return normalizeInventoryItem({ ...item, ...patch });
  });
  saveInventory();
}

function inventoryHasFavoritePortal(portalId) {
  if (typeof portalId !== "string" || !portalId) return false;
  return loadPortalFavorites().some((favorite) => favorite.id === portalId);
}

function getInventoryEntries() {
  const favoriteEntries = loadPortalFavorites().map((favorite) => ({
    inventorySource: "favorite",
    id: `favorite:${favorite.id}`,
    portalId: favorite.id,
    type: "favorite_portal_item",
    owner: state.ownerId,
    placement_timestamp: null,
    favorite_portal_id: favorite.id,
    favorite_portal_latitude: favorite.latitude,
    favorite_portal_longitude: favorite.longitude,
    favorite_portal_name: favorite.portal_name ?? null,
    content_name: favorite.content_name ?? null,
    content_text: favorite.content_text ?? null,
    content_url: favorite.content_url ?? null,
    content_data_url: favorite.content_data_url ?? null,
    content_upload_path: favorite.content_upload_path ?? null,
  }));

  const inventoryEntries = state.inventory.map((item) => ({
    ...normalizeInventoryItem(item),
    inventorySource: "inventory",
    portalId: item.favorite_portal_id ?? null,
  }));

  return [...favoriteEntries, ...inventoryEntries];
}

function getDisplayItemTypeLabel(item) {
  if (item.type === "favorite_portal_item") return "Favourite Portal";
  if (item.type === "portal_marker") return "Portal";
  if (item.type === "visit_counter") return "Visit Counter";
  if (item.type === "media") return "Media";
  return item.type;
}

function getItemTypeBadgeInfo(item) {
  if (item?.type === "favorite_portal_item") {
    return { code: "FAV", label: "Favourite Portal", modifier: "item-type-badge--portal" };
  }
  if (item?.type === "visit_counter") {
    return { code: "CNT", label: "Visit Counter", modifier: "item-type-badge--counter" };
  }
  if (item?.type === "portal_marker") {
    return { code: "PRT", label: "Portal", modifier: "item-type-badge--portal" };
  }
  if (item?.type === "media") {
    return { code: "MED", label: "Media", modifier: "item-type-badge--media" };
  }
  return { code: "MED", label: "Media", modifier: "item-type-badge--media" };
}

function getInventoryEntryTitle(item) {
  if (item.type === "favorite_portal_item") {
    return item.favorite_portal_name || item.portal_name || "Favourite Portal";
  }
  if (item.type === "visit_counter") {
    return item.visit_counter_name || "Visit Counter";
  }
  if (item.type === "media") {
    return item.content_name || "Media";
  }
  return getDisplayItemTypeLabel(item);
}

const ITEM_CARD_RENDERERS = {
  media: {
    title: (item) => item.content_name || "Media",
    locationBodyHtml: (item) => {
      const parts = [];
      if (item.content_text) parts.push(`<div class="item-content-text">${escapeHtml(item.content_text)}</div>`);
      const safeContentUrl = sanitizeExternalHttpUrl(item.content_url);
      if (safeContentUrl) {
        parts.push(`<div class="item-content-url"><a href="${escapeHtml(safeContentUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeContentUrl)}</a></div>`);
      }
      if (item.content_upload_path) {
        parts.push(`<img class="item-photo" src="${item.content_upload_path}" alt="media" />`);
      }
      return parts.join("");
    },
    inventoryDetailHtml: () => null,
  },
  visit_counter: {
    title: (item) => item.visit_counter_name || "Visit Counter",
    locationBodyHtml: (item) => {
      const count = Number.isFinite(item.visit_count) ? item.visit_count : 0;
      return `<div class="visit-counter-count">Viewed <strong>${count}</strong> time${count === 1 ? "" : "s"}</div>`;
    },
    inventoryDetailHtml: (item) => `<small>Picked up ${new Date(item.placement_timestamp).toLocaleString()} • Count ${Number.isFinite(item.visit_count) ? item.visit_count : 0}</small>`,
    showDownload: false,
  },
  favorite_portal_item: {
    title: (item) => item.content_name || item.favorite_portal_name || "Favourite Portal",
    locationBodyHtml: () => "",
    inventoryDetailHtml: (item) => `<small>Local favourite • ${escapeHtml((item.portalId || "unknown").slice(0, 8))}...</small>`,
  },
  portal_marker: {
    title: () => "Portal",
    locationBodyHtml: () => "",
    inventoryDetailHtml: (item) => `<small>Picked up ${new Date(item.placement_timestamp).toLocaleString()}</small>`,
  },
  default: {
    title: (item) => getDisplayItemTypeLabel(item),
    locationBodyHtml: () => "",
    inventoryDetailHtml: (item) => `<small>Picked up ${new Date(item.placement_timestamp).toLocaleString()}</small>`,
  },
};

function buildMediaReplayActions(item, editedName, editedText, editedUrl) {
  const finalName = normalizeOptionalText(editedName ?? item.content_name);
  const finalText = normalizeOptionalText(editedText ?? item.content_text);
  const finalUrl = normalizeOptionalUrl(editedUrl ?? item.content_url);
  const hasImage = Boolean(item.content_upload_path || item.content_data_url);
  const isFavoriteItem = item.type === "favorite_portal_item" && item.favorite_portal_id;

  return {
    finalName,
    finalText,
    finalUrl,
    hasImage,
    isFavoriteItem,
  };
}

const ITEM_FLOW_BEHAVIORS = {
  media: {
    validateAdd: ({ name, text, url, photoFile }) => {
      if (!name && !text && !url && !photoFile) {
        return "Add a media name, text, URL, or image.";
      }
      return null;
    },
    buildAddDraftItem: async ({ name, text, url, photoFile }) => ({
      type: "media",
      content_name: name || null,
      content_text: text || null,
      content_url: url || null,
      content_data_url: photoFile ? await fileToDataUrl(photoFile) : null,
    }),
    buildInventoryItem: async ({ state, name, text, url, photoFile }) => normalizeInventoryItem({
      id: crypto.randomUUID(),
      type: "media",
      owner: state.ownerId,
      placement_timestamp: new Date().toISOString(),
      content_name: name || null,
      content_text: text || null,
      content_url: url || null,
      content_data_url: photoFile ? await fileToDataUrl(photoFile) : null,
    }),
    placeAtLocation: async ({ state, virtual, item, getPlacementAccuracyMeters, editedName, editedText, editedUrl }) => {
      const { finalName, finalText, finalUrl, hasImage, isFavoriteItem } = buildMediaReplayActions(item, editedName, editedText, editedUrl);
      if (!finalName && !finalText && !finalUrl && !hasImage) {
        return "Item has no text, URL, or image.";
      }

      if (hasImage && item.content_data_url) {
        const form = new FormData();
        form.append("owner", state.ownerId);
        form.append("latitude", String(virtual.lat));
        form.append("longitude", String(virtual.lng));
        form.append("accuracy_meters", String(getPlacementAccuracyMeters()));
        form.append("item_type", isFavoriteItem ? "favorite_portal_item" : "media");
        if (finalName) form.append("content_name", finalName);
        if (finalText) form.append("content_text", finalText);
        if (finalUrl) form.append("content_url", finalUrl);
        if (isFavoriteItem) {
          form.append("favorite_portal_id", item.favorite_portal_id);
          form.append("favorite_portal_latitude", String(item.favorite_portal_latitude));
          form.append("favorite_portal_longitude", String(item.favorite_portal_longitude));
          if (item.favorite_portal_name) form.append("favorite_portal_name", item.favorite_portal_name);
        }
        form.append("file", dataUrlToFile(item.content_data_url, `${item.id}.png`, "image/png"));
        const response = await fetch(`/api/dimensions/${state.dimensionRootId}/media`, {
          method: "POST",
          body: form,
        });
        if (!response.ok) throw new Error(await response.text());
        return null;
      }

      await sendJson(`/api/dimensions/${state.dimensionRootId}/items`, {
        type: isFavoriteItem ? "favorite_portal_item" : "media",
        owner: state.ownerId,
        latitude: virtual.lat,
        longitude: virtual.lng,
        accuracy_meters: getPlacementAccuracyMeters(),
        content_name: finalName || null,
        content_text: finalText,
        content_url: finalUrl,
        content_upload_path: hasImage ? item.content_upload_path : null,
        favorite_portal_id: isFavoriteItem ? item.favorite_portal_id : null,
        favorite_portal_latitude: isFavoriteItem ? item.favorite_portal_latitude : null,
        favorite_portal_longitude: isFavoriteItem ? item.favorite_portal_longitude : null,
        favorite_portal_name: isFavoriteItem ? item.favorite_portal_name : null,
      });
      return null;
    },
  },
  visit_counter: {
    buildAddDraftItem: async () => ({
      type: "visit_counter",
      visit_counter_name: null,
    }),
    buildInventoryItem: async ({ state }) => normalizeInventoryItem({
      id: crypto.randomUUID(),
      type: "visit_counter",
      owner: state.ownerId,
      placement_timestamp: new Date().toISOString(),
      visit_count: 0,
    }),
    placeAtLocation: async ({ state, virtual, item, getPlacementAccuracyMeters }) => {
      await sendJson(`/api/dimensions/${state.dimensionRootId}/items`, {
        type: "visit_counter",
        owner: state.ownerId,
        latitude: virtual.lat,
        longitude: virtual.lng,
        accuracy_meters: getPlacementAccuracyMeters(),
        visit_counter_name: item.visit_counter_name || null,
      });
      return null;
    },
  },
  favorite_portal_item: {
    placeAtLocation: async ({ state, virtual, item, getPlacementAccuracyMeters, editedName, editedText, editedUrl }) => {
      const { finalName, finalText, finalUrl, hasImage } = buildMediaReplayActions(item, editedName, editedText, editedUrl);
      if (!finalName && !finalText && !finalUrl && !hasImage) {
        return "Item has no text, URL, or image.";
      }

      if (hasImage && item.content_data_url) {
        const form = new FormData();
        form.append("owner", state.ownerId);
        form.append("latitude", String(virtual.lat));
        form.append("longitude", String(virtual.lng));
        form.append("accuracy_meters", String(getPlacementAccuracyMeters()));
        form.append("item_type", "favorite_portal_item");
        if (finalName) form.append("content_name", finalName);
        if (finalText) form.append("content_text", finalText);
        if (finalUrl) form.append("content_url", finalUrl);
        form.append("favorite_portal_id", item.favorite_portal_id);
        form.append("favorite_portal_latitude", String(item.favorite_portal_latitude));
        form.append("favorite_portal_longitude", String(item.favorite_portal_longitude));
        if (item.favorite_portal_name) form.append("favorite_portal_name", item.favorite_portal_name);
        form.append("file", dataUrlToFile(item.content_data_url, `${item.id}.png`, "image/png"));
        const response = await fetch(`/api/dimensions/${state.dimensionRootId}/media`, {
          method: "POST",
          body: form,
        });
        if (!response.ok) throw new Error(await response.text());
        return null;
      }

      await sendJson(`/api/dimensions/${state.dimensionRootId}/items`, {
        type: "favorite_portal_item",
        owner: state.ownerId,
        latitude: virtual.lat,
        longitude: virtual.lng,
        accuracy_meters: getPlacementAccuracyMeters(),
        content_name: finalName || null,
        content_text: finalText,
        content_url: finalUrl,
        favorite_portal_id: item.favorite_portal_id,
        favorite_portal_latitude: item.favorite_portal_latitude,
        favorite_portal_longitude: item.favorite_portal_longitude,
        favorite_portal_name: item.favorite_portal_name,
      });
      return null;
    },
  },
  portal_marker: {
    placeAtLocation: async () => "Cannot re-place this item type.",
  },
  default: {
    buildAddDraftItem: async () => null,
    placeAtLocation: async () => null,
  },
};

function getItemFlowBehavior(type) {
  return ITEM_FLOW_BEHAVIORS[type] || ITEM_FLOW_BEHAVIORS.default;
}

function getItemCardRenderer(item) {
  return ITEM_CARD_RENDERERS[item?.type] || ITEM_CARD_RENDERERS.default;
}

function getItemCardTitle(item) {
  return getItemCardRenderer(item).title(item);
}

function getItemCardLocationBodyHtml(item) {
  return getItemCardRenderer(item).locationBodyHtml(item);
}

function getItemCardInventoryDetailHtml(item) {
  const detailHtml = getItemCardRenderer(item).inventoryDetailHtml(item);
  return detailHtml || `<small>Picked up ${new Date(item.placement_timestamp).toLocaleString()}</small>`;
}

function appendItemActionButton(actionsEl, label, onClick, disabled = false) {
  const button = document.createElement("button");
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  actionsEl.appendChild(button);
  return button;
}

function appendDownloadItemAction(actionsEl, item, sourceLabel) {
  if (getItemCardRenderer(item).showDownload === false) return;
  appendItemActionButton(actionsEl, "Download", () => downloadItem(item, sourceLabel));
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

function getAddItemType() {
  return itemAddTypeEl?.value === "visit_counter" ? "visit_counter" : "media";
}

function syncItemAddFieldsForType() {
  const isVisitCounter = getAddItemType() === "visit_counter";
  if (itemAddMediaFieldsEl) itemAddMediaFieldsEl.hidden = isVisitCounter;
  if (itemAddNameEl) itemAddNameEl.required = false;
  if (itemAddNameEl && isVisitCounter) itemAddNameEl.value = "";
  if (itemAddTextEl) itemAddTextEl.value = isVisitCounter ? "" : itemAddTextEl.value;
  if (itemAddUrlEl) itemAddUrlEl.value = isVisitCounter ? "" : itemAddUrlEl.value;
  if (itemAddPhotoEl) itemAddPhotoEl.value = isVisitCounter ? "" : itemAddPhotoEl.value;
}

itemAddTypeEl?.addEventListener("change", syncItemAddFieldsForType);
syncItemAddFieldsForType();

function autoResizeTextareaWithinRows(textarea, minRows, maxRows) {
  if (!textarea) return;
  const styles = getComputedStyle(textarea);
  const lineHeight = parseFloat(styles.lineHeight) || 20;
  const verticalPadding = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
  const verticalBorder = (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);

  const minHeight = (lineHeight * minRows) + verticalPadding + verticalBorder;
  const maxHeight = (lineHeight * maxRows) + verticalPadding + verticalBorder;

  textarea.style.height = "auto";
  const nextHeight = Math.max(minHeight, Math.min(maxHeight, textarea.scrollHeight));
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
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
  updateTopOverlayButtons();
}

function getScreenOrientationAngle() {
  if (typeof screen !== "undefined" && Number.isFinite(screen?.orientation?.angle)) {
    return screen.orientation.angle;
  }
  if (typeof window !== "undefined" && Number.isFinite(window.orientation)) {
    return window.orientation;
  }
  return 0;
}

function normalizeHeading(heading) {
  if (!Number.isFinite(heading)) return null;
  const normalized = heading % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function normalizeHeadingDelta(fromHeading, toHeading) {
  const from = normalizeHeading(fromHeading);
  const to = normalizeHeading(toHeading);
  if (from === null || to === null) return null;
  return ((((to - from) % 360) + 540) % 360) - 180;
}

function stopHeadingAnimation() {
  if (headingAnimationFrameId !== null) {
    cancelAnimationFrame(headingAnimationFrameId);
    headingAnimationFrameId = null;
  }
  headingAnimationLastTs = 0;
}

function stepHeadingAnimation(timestamp) {
  headingAnimationFrameId = null;

  const current = normalizeHeading(state.currentHeading);
  const target = normalizeHeading(targetHeading);
  if (current === null || target === null) {
    stopHeadingAnimation();
    return;
  }

  if (!headingAnimationLastTs) {
    headingAnimationLastTs = timestamp;
  }
  const dt = Math.min(64, Math.max(8, timestamp - headingAnimationLastTs));
  headingAnimationLastTs = timestamp;

  const delta = normalizeHeadingDelta(current, target);
  if (delta === null) {
    stopHeadingAnimation();
    return;
  }

  const distance = Math.abs(delta);
  if (distance < 0.15) {
    state.currentHeading = target;
    applyMapRotation();
    stopHeadingAnimation();
    return;
  }

  // Time-based easing instead of event-step snapping.
  // Small jitter moves very gently; large turns accelerate, but still settle smoothly.
  const normalizedDistance = Math.min(1, distance / 180);
  const baseStrength = 0.035;
  const adaptiveStrength = normalizedDistance * 0.165;
  const perFrameStrength = baseStrength + adaptiveStrength;
  const easedStrength = 1 - Math.pow(1 - perFrameStrength, dt / 16.6667);

  state.currentHeading = normalizeHeading(current + delta * easedStrength);
  applyMapRotation();
  headingAnimationFrameId = requestAnimationFrame(stepHeadingAnimation);
}

function queueHeadingTarget(nextHeading) {
  const normalizedNext = normalizeHeading(nextHeading);
  if (normalizedNext === null) return;

  targetHeading = normalizedNext;
  if (!Number.isFinite(state.currentHeading)) {
    state.currentHeading = normalizedNext;
    applyMapRotation();
    stopHeadingAnimation();
    return;
  }

  if (headingAnimationFrameId === null) {
    headingAnimationFrameId = requestAnimationFrame(stepHeadingAnimation);
  }
}

function getOrientationSourcePriority(source) {
  if (source === "webkit") return 3;
  if (source === "absolute") return 2;
  return 1;
}

function classifyOrientationSource(event, sourceHint = "relative") {
  if (Number.isFinite(event?.webkitCompassHeading)) return "webkit";
  if (sourceHint === "absolute" || event?.absolute) return "absolute";
  return "relative";
}

function shouldUseOrientationSource(source, now = Date.now()) {
  if (!preferredOrientationSource || (now - lastOrientationSourceAt) > 4000) {
    preferredOrientationSource = source;
    lastOrientationSourceAt = now;
    return true;
  }

  if (source === preferredOrientationSource) {
    lastOrientationSourceAt = now;
    return true;
  }

  if (getOrientationSourcePriority(source) > getOrientationSourcePriority(preferredOrientationSource)) {
    preferredOrientationSource = source;
    lastOrientationSourceAt = now;
    return true;
  }

  return false;
}

function extractDeviceHeading(event, source = "relative") {
  if (!event) return null;
  if (Number.isFinite(event.webkitCompassHeading)) {
    // Safari's webkitCompassHeading is already north-relative for the device heading.
    // Adding screen orientation here can create 90-degree quadrant errors.
    return normalizeHeading(event.webkitCompassHeading);
  }
  if (!Number.isFinite(event.alpha)) return null;
  const compassHeading = 360 - event.alpha;
  return normalizeHeading(compassHeading + getScreenOrientationAngle());
}

function handleDeviceOrientation(event, sourceHint = "relative") {
  const source = classifyOrientationSource(event, sourceHint);
  const now = Date.now();
  if (!shouldUseOrientationSource(source, now)) return;

  const heading = extractDeviceHeading(event, source);
  if (!Number.isFinite(heading)) return;
  queueHeadingTarget(heading);
  lastDeviceHeadingAt = now;
  schedulePersistClientState();
}

async function beginDeviceOrientation() {
  if (deviceOrientationBound) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;

  const requestPermission = window.DeviceOrientationEvent?.requestPermission;
  if (typeof requestPermission === "function") {
    try {
      const permission = await requestPermission.call(window.DeviceOrientationEvent);
      if (permission !== "granted") return;
    } catch {
      return;
    }
  }

  window.addEventListener("deviceorientationabsolute", (event) => handleDeviceOrientation(event, "absolute"), true);
  window.addEventListener("deviceorientation", (event) => handleDeviceOrientation(event, "relative"), true);
  deviceOrientationBound = true;
}

function getMapRotationAngle() {
  if (state.mapRotationMode === "north") return 0;
  const heading = normalizeHeading(state.currentHeading);
  if (heading === null) return 0;
  return -heading;
}

function updateMapRotationButton() {
  if (!mapRotationToggleButtonEl) return;
  const northUp = state.mapRotationMode === "north";
  mapRotationToggleButtonEl.dataset.rotation = northUp ? "north" : "heading";
  const label = northUp ? "Map rotation: North up" : "Map rotation: Facing direction";
  mapRotationToggleButtonEl.setAttribute("aria-label", label);
  mapRotationToggleButtonEl.setAttribute("title", label);
  mapRotationToggleButtonEl.style.setProperty("--compass-angle", `${getMapRotationAngle()}deg`);
}

function updateTopOverlayButtons() {
  updateMapRotationButton();
  if (portalReturnButtonEl) {
    portalReturnButtonEl.hidden = !isVirtualShiftActive();
  }
  if (portalUseNearestButtonEl) {
    portalUseNearestButtonEl.hidden = !canUseNearestLinkedPortal();
  }
}

function applyMapRotation() {
  if (!state.map) return;

  const angle = getMapRotationAngle();
  const scale = state.mapRotationMode === "north" ? 1 : 1.45;
  const mapPane = state.map.getPanes().mapPane;
  if (!mapPane) return;
  const mapContainer = state.map.getContainer?.() || document.getElementById("map");
  const containerRect = mapContainer?.getBoundingClientRect?.();
  const mapSize = containerRect && containerRect.width > 0 && containerRect.height > 0
    ? { x: containerRect.width, y: containerRect.height }
    : state.map.getSize();

  const baseTransform = stripRotationTransform(mapPane.style.transform);
  if (mapSize?.x > 0 && mapSize?.y > 0) {
    mapPane.style.width = `${mapSize.x}px`;
    mapPane.style.height = `${mapSize.y}px`;
    mapPane.style.transformOrigin = `${mapSize.x / 2}px ${mapSize.y / 2}px`;
  } else {
    mapPane.style.transformOrigin = "50% 50%";
  }
  // Keep Leaflet's translate transform isolated from custom heading transform.
  mapPane.style.transform = baseTransform;
  mapPane.style.rotate = angle ? `${angle}deg` : "0deg";
  mapPane.style.scale = String(scale);

  updateMapRotationButton();
}

function stripRotationTransform(transform) {
  if (!transform) return "";
  return transform
    .replace(/\s*rotate\([^)]*\)/g, "")
    .replace(/\s*scale\([^)]*\)/g, "")
    .trim();
}

function toggleMapRotationMode() {
  state.mapRotationMode = state.mapRotationMode === "north" ? "heading" : "north";
  schedulePersistClientState();
  applyMapRotation();
  updatePortalHud();
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

  const theme = getMapThemeColors();
  const ringStyle = {
    radius: PICKUP_RANGE_METERS,
    color: theme.range,
    weight: 2,
    opacity: 0.8,
    fillColor: theme.range,
    fillOpacity: 0.08,
    interactive: false,
  };

  if (!state.rangeRing) {
    state.rangeRing = L.circle([virtual.lat, virtual.lng], ringStyle).addTo(state.map);
    return;
  }

  state.rangeRing.setStyle(ringStyle);
  state.rangeRing.setLatLng([virtual.lat, virtual.lng]);
  state.rangeRing.setRadius(PICKUP_RANGE_METERS);
}

function applyVirtualOffset(nextOffset, options = {}) {
  const { recenterFollow = false, preferCache = true, persist = true } = options;
  state.virtualOffset = {
    lat: Number.isFinite(nextOffset?.lat) ? nextOffset.lat : 0,
    lng: Number.isFinite(nextOffset?.lng) ? nextOffset.lng : 0,
  };
  if (recenterFollow) {
    state.sharedPortalFocusActive = false;
    state.followPlayer = true;
    // Reuse the same initial-center branch that is stable on page reload.
    // This avoids diverging travel-time pan/rotation behavior.
    state.hasInitialCenter = false;
    updateFollowIndicator();
  }
  if (persist) {
    schedulePersistClientState();
  }
  refreshLocationAndNearby(preferCache);
  drawPortalLink();
  renderNearbyItemList();
  updatePortalHud();
}

function resolveSelectedPortalPair() {
  if (!state.selectedLocalPortalId || !state.selectedRemotePortalId) return null;
  const local = state.displayItems.find((i) => i.id === state.selectedLocalPortalId) || state.selectedLocalPortalPos;
  const remote = state.displayItems.find((i) => i.id === state.selectedRemotePortalId) || state.selectedRemotePortalPos;
  if (!local || !remote) return null;
  return { local, remote };
}

function syncSelectedPortalSnapshots(local, remote) {
  state.selectedLocalPortalPos = {
    id: state.selectedLocalPortalId,
    latitude: local.latitude,
    longitude: local.longitude,
    portal_name: local.portal_name ?? null,
    content_text: local.content_text ?? null,
    content_url: local.content_url ?? null,
    content_upload_path: local.content_upload_path ?? null,
  };
  state.selectedRemotePortalPos = {
    id: state.selectedRemotePortalId,
    latitude: remote.latitude,
    longitude: remote.longitude,
    portal_name: remote.portal_name ?? null,
    content_text: remote.content_text ?? null,
    content_url: remote.content_url ?? null,
    content_upload_path: remote.content_upload_path ?? null,
  };
  savePortalSession();
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
  updatePortalOffsetFromSelection({ activate: true, recenterFollow: true });
  notify("Jumped through portal link.", "success", 2200);
}

function returnToPhysicalPosition() {
  if (!isVirtualShiftActive()) {
    notify("Already at physical position.", "info", 1800);
    return;
  }
  applyVirtualOffset({ lat: 0, lng: 0 }, { recenterFollow: true, preferCache: true, persist: true });
  notify("Returned to physical position.", "success", 2200);
}

function clearPortalLink(showNotice = true) {
  state.selectedLocalPortalId = null;
  state.selectedRemotePortalId = null;
  state.selectedLocalPortalPos = null;
  state.selectedRemotePortalPos = null;
  if (state.portalLine) {
    state.map.removeLayer(state.portalLine);
    state.portalLine = null;
  }
  applyVirtualOffset({ lat: 0, lng: 0 }, { recenterFollow: false, preferCache: true, persist: true });
  renderPortalSelection();
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

function centerMapOnPlayerVirtual(forceZoom = false, options = {}) {
  const { initialize = false } = options;
  const virtual = getVirtualPosition();
  if (!virtual || !state.map) return;

  const currentZoom = state.map.getZoom();
  const nextZoom = forceZoom ? Math.max(currentZoom, 18) : currentZoom;
  if (state.mapRotationMode !== "north") {
    const mapPane = state.map.getPanes().mapPane;
    if (mapPane) {
      // Leaflet computes translate on mapPane. During portal travel in heading mode,
      // pre-existing rotate/scale can skew recenter math. Normalize before setView.
      const baseTransform = stripRotationTransform(mapPane.style.transform);
      mapPane.style.transform = baseTransform;
      mapPane.style.rotate = "";
      mapPane.style.scale = "";
    }
  }
  // Animated setView can drift when mapPane is already rotated/scaled in heading mode.
  // Keep recenter deterministic for portal jumps/returns by disabling pan animation there.
  const animate = initialize ? false : state.mapRotationMode === "north";
  state.programmaticMapMove = true;
  state.map.setView([virtual.lat, virtual.lng], nextZoom, { animate });
}

function restoreFollowOnNextFrame() {
  if (!state.map || !isFollowingPlayer() || !getVirtualPosition()) return;

  if (followRestoreFrameId !== null) {
    cancelAnimationFrame(followRestoreFrameId);
    followRestoreFrameId = null;
  }

  followRestoreFrameId = requestAnimationFrame(() => {
    followRestoreFrameId = null;
    if (!state.map || !isFollowingPlayer() || !getVirtualPosition()) return;
    state.map.invalidateSize();
    centerMapOnPlayerVirtual(true);
  });
}

function updatePlayerMarkers() {
  const virtual = getVirtualPosition();
  const physical = state.physicalPosition;
  if (!state.map) return;
  const theme = getMapThemeColors();

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
        color: theme.anchor,
        fillColor: theme.anchor,
        fillOpacity: 0.3,
        weight: 2,
      }).addTo(state.map);
    } else {
      state.bodyAnchorMarker.setLatLng([physical.lat, physical.lng]);
      state.bodyAnchorMarker.setStyle({ color: theme.anchor, fillColor: theme.anchor });
    }
  } else if (state.bodyAnchorMarker) {
    state.map.removeLayer(state.bodyAnchorMarker);
    state.bodyAnchorMarker = null;
  }

  updatePlayerRangeRing();
}

function getCssVar(name, fallback = "") {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function getMapThemeColors() {
  return {
    range: getCssVar("--map-range", "#138c64"),
    anchor: getCssVar("--map-anchor", "#606975"),
    portal: getCssVar("--map-portal", "#6d3ef5"),
    favorite: getCssVar("--map-favorite", getCssVar("--accent", "#0073ff")),
    media: getCssVar("--map-media", "#f38b2a"),
    visitCounter: getCssVar("--map-visit-counter", "#0e7a56"),
    portalLine: getCssVar("--portal-line", "#341a8d"),
  };
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

  if (isFollowingPlayer()) {
    if (!state.hasInitialCenter) {
      centerMapOnPlayerVirtual(true, { initialize: true });
      state.hasInitialCenter = true;
    } else {
      centerMapOnPlayerVirtual(false);
    }
  }
}

function updatePortalOffsetFromSelection(options = {}) {
  const { activate = true, recenterFollow = false } = options;
  const pair = resolveSelectedPortalPair();
  if (!pair) {
    if (activate) {
      applyVirtualOffset({ lat: 0, lng: 0 }, { recenterFollow, preferCache: true, persist: true });
    } else {
      schedulePersistClientState();
      updatePortalHud();
    }
    return false;
  }

  const { local, remote } = pair;
  syncSelectedPortalSnapshots(local, remote);

  if (!activate) {
    schedulePersistClientState();
    updatePortalHud();
    return true;
  }

  applyVirtualOffset(
    { lat: remote.latitude - local.latitude, lng: remote.longitude - local.longitude },
    { recenterFollow, preferCache: true, persist: true }
  );
  return true;
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

function cachePeekEntry(key) {
  const raw = localStorage.getItem(cacheKey);
  if (!raw) return null;
  const data = JSON.parse(raw);
  return data[key] || null;
}

function cacheTouch(key) {
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

function invalidateItemCache(itemId) {
  if (!itemId) return;

  const raw = localStorage.getItem(cacheKey);
  if (!raw) return;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  let changed = false;
  const directItemKey = `item:${itemId}`;
  if (data[directItemKey]) {
    delete data[directItemKey];
    changed = true;
  }

  for (const [key, entry] of Object.entries(data)) {
    const value = entry?.value;
    if (!value) continue;

    const hasItemInItems = Array.isArray(value.items) && value.items.some((item) => item?.id === itemId);
    const hasItemInItemIds = Array.isArray(value.item_ids) && value.item_ids.includes(itemId);
    if (!hasItemInItems && !hasItemInItemIds) continue;

    delete data[key];
    changed = true;
  }

  if (changed) {
    localStorage.setItem(cacheKey, JSON.stringify(data));
  }
}

function invalidatePortalCache(portalId) {
  invalidateItemCache(portalId);
}

function getCacheAgeMs(key) {
  const entry = cachePeekEntry(key);
  if (!entry || !Number.isFinite(entry.touched)) return null;
  return Date.now() - entry.touched;
}

async function fetchJsonWithCache(key, url, preferCache = true, options = null) {
  const maxAgeMs = Number.isFinite(options?.maxAgeMs) && options.maxAgeMs >= 0 ? options.maxAgeMs : null;

  if (preferCache) {
    if (maxAgeMs === null) {
      const cached = cacheRead(key);
      if (cached) return cached;
    } else {
      const cachedEntry = cachePeekEntry(key);
      const cachedValue = cachedEntry?.value;
      const cacheAgeMs = cachedEntry ? getCacheAgeMs(key) : null;
      if (cachedValue && cacheAgeMs !== null && cacheAgeMs <= maxAgeMs) {
        cacheTouch(key);
        return cachedValue;
      }
    }
  }
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(await response.text());
    error.status = response.status;
    error.url = url;
    throw error;
  }
  const payload = await response.json();
  cacheWrite(key, payload);
  return payload;
}

function getDistanceAwareCellCacheTtlMs(cellId, originLat, originLng, h3Api) {
  if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) return PORTAL_CACHE_TTL_MS;
  if (!h3Api || typeof h3Api.cellToLatLng !== "function") return PORTAL_CACHE_TTL_MS;

  try {
    const [cellLat, cellLng] = h3Api.cellToLatLng(cellId);
    if (!Number.isFinite(cellLat) || !Number.isFinite(cellLng)) return PORTAL_CACHE_TTL_MS;
    const distanceMeters = haversineMeters(originLat, originLng, cellLat, cellLng);
    const walkTimeMs = Math.max(0, (distanceMeters / WALK_SPEED_MPS) * 1000);
    return PORTAL_CACHE_TTL_MS + walkTimeMs;
  } catch {
    return PORTAL_CACHE_TTL_MS;
  }
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
  const initialVirtual = getVirtualPosition();
  const initialCenter = initialVirtual ? [initialVirtual.lat, initialVirtual.lng] : [0, 0];
  const initialZoom = initialVirtual ? 18 : 2;
  state.hasInitialCenter = Boolean(initialVirtual);
  state.map = L.map("map", { maxZoom: 22 }).setView(initialCenter, initialZoom, { animate: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: "&copy; OpenStreetMap contributors",
    className: "map-tiles",
  }).addTo(state.map);

  state.map.on("movestart", () => {
    if (state.programmaticMapMove) return;
    state.sharedPortalFocusActive = false;
    state.followPlayer = false;
    schedulePersistClientState();
    updateFollowIndicator();
  });

  state.map.on("moveend", () => {
    if (state.programmaticMapMove) {
      state.programmaticMapMove = false;
      applyMapRotation();
      return;
    }

    if (!state.physicalPosition) {
      updatePlayerMarkers();
    }
    updatePlayerRangeRing();
    const virtual = getVirtualPosition();
    if (virtual) loadNearby(virtual.lat, virtual.lng, false);
    loadViewportPortals(false);
  });

  state.map.on("zoomend", updatePlayerRangeRing);

  state.map.on("move", () => {
    if (state.programmaticMapMove) return;
    applyMapRotation();
  });
  state.map.on("zoom", () => {
    if (state.programmaticMapMove) return;
    applyMapRotation();
  });
  state.map.on("zoomend", () => {
    if (state.programmaticMapMove) return;
    applyMapRotation();
  });
  state.map.on("resize", applyMapRotation);

  state.map.on("click", () => {
    setPlayerActionsOpen(false);
    if (!devMenuEl) return;
    if (window.innerWidth >= 980) return;
    if (getTopUiLayer() !== "menu") return;
    closeTopUiLayer();
  });
}

function drawItems(items) {
  const theme = getMapThemeColors();
  for (const marker of state.itemMarkers.values()) {
    state.map.removeLayer(marker);
  }
  state.itemMarkers.clear();

  items.forEach((item) => {
    const color =
      item.type === "portal_marker"
        ? theme.portal
        : item.type === "favorite_portal_item"
          ? theme.favorite
          : item.type === "visit_counter"
            ? theme.visitCounter
            : theme.media;

    const marker = L.circleMarker([item.latitude, item.longitude], {
      radius: item.type === "portal_marker" ? 12 : item.type === "favorite_portal_item" ? 10 : item.type === "visit_counter" ? 9 : 8,
      color,
      fillColor: color,
      fillOpacity: item.type === "portal_marker" ? 0.95 : item.type === "favorite_portal_item" ? 0.82 : item.type === "visit_counter" ? 0.88 : 0.9,
      weight: item.type === "portal_marker" ? 3 : item.type === "favorite_portal_item" ? 2.5 : item.type === "visit_counter" ? 2.25 : 2,
    }).addTo(state.map);

    if (item.type === "portal_marker") {
      marker.bindTooltip(formatPortalLabel(item), { direction: "top", opacity: 0.9 });
    }

    marker.on("click", () => onItemClicked(item));
    state.itemMarkers.set(item.id, marker);
  });
}

function formatPortalLabel(portal) {
  if (!portal) return "Portal";
  const name = typeof portal.portal_name === "string" ? portal.portal_name.trim() : "";
  if (name) return name;
  if (typeof portal.id === "string" && portal.id) return `Portal ${portal.id.slice(0, 8)}...`;
  if (Number.isFinite(portal.latitude) && Number.isFinite(portal.longitude)) {
    return `Portal ${portal.latitude.toFixed(4)}, ${portal.longitude.toFixed(4)}`;
  }
  return "Portal";
}

function updatePortalItemsInState(updatedItem) {
  if (!updatedItem) return;

  for (const listName of ["nearbyItems", "viewportPortalItems", "displayItems"]) {
    const list = state[listName];
    const index = list.findIndex((item) => item.id === updatedItem.id);
    if (index >= 0) {
      list[index] = updatedItem;
    }
  }

  if (state.selectedLocalPortalId === updatedItem.id) {
    state.selectedLocalPortalPos = {
      id: updatedItem.id,
      latitude: updatedItem.latitude,
      longitude: updatedItem.longitude,
      portal_name: updatedItem.portal_name ?? null,
      content_text: updatedItem.content_text ?? null,
      content_url: updatedItem.content_url ?? null,
      content_upload_path: updatedItem.content_upload_path ?? null,
    };
  }
  if (state.selectedRemotePortalId === updatedItem.id) {
    state.selectedRemotePortalPos = {
      id: updatedItem.id,
      latitude: updatedItem.latitude,
      longitude: updatedItem.longitude,
      portal_name: updatedItem.portal_name ?? null,
      content_text: updatedItem.content_text ?? null,
      content_url: updatedItem.content_url ?? null,
      content_upload_path: updatedItem.content_upload_path ?? null,
    };
  }

  syncPortalFavoritesFromItem(updatedItem);
}

function removeItemFromClientState(itemId) {
  if (!itemId) return false;

  let changed = false;
  const listNames = ["nearbyItems", "viewportPortalItems", "displayItems", "inventory"];
  for (const listName of listNames) {
    const list = state[listName];
    if (!Array.isArray(list) || !list.length) continue;
    const next = list.filter((item) => item?.id !== itemId);
    if (next.length !== list.length) {
      state[listName] = next;
      changed = true;
    }
  }

  const marker = state.itemMarkers.get(itemId);
  if (marker) {
    state.map?.removeLayer(marker);
    state.itemMarkers.delete(itemId);
    changed = true;
  }

  if (state.visitCounterViewedIds.delete(itemId)) {
    changed = true;
  }

  if (state.selectedLocalPortalId === itemId) {
    state.selectedLocalPortalId = null;
    state.selectedLocalPortalPos = null;
    changed = true;
  }
  if (state.selectedRemotePortalId === itemId) {
    state.selectedRemotePortalId = null;
    state.selectedRemotePortalPos = null;
    changed = true;
  }

  const favorites = loadPortalFavorites();
  const nextFavorites = favorites.filter((favorite) => favorite?.id !== itemId);
  if (nextFavorites.length !== favorites.length) {
    savePortalFavorites(nextFavorites);
    changed = true;
  }

  if (changed) {
    updatePortalOffsetFromSelection({ activate: false });
    saveInventory();
  }

  return changed;
}

function purgePortalFromClientState(portalId) {
  if (!portalId) return false;

  let changed = false;
  const listNames = ["nearbyItems", "viewportPortalItems", "displayItems"];
  for (const listName of listNames) {
    const list = state[listName];
    if (!Array.isArray(list) || !list.length) continue;
    const next = list.filter((item) => item?.id !== portalId);
    if (next.length !== list.length) {
      state[listName] = next;
      changed = true;
    }
  }

  const marker = state.itemMarkers.get(portalId);
  if (marker) {
    state.map?.removeLayer(marker);
    state.itemMarkers.delete(portalId);
    changed = true;
  }

  let clearedLink = false;
  if (state.selectedLocalPortalId === portalId) {
    state.selectedLocalPortalId = null;
    state.selectedLocalPortalPos = null;
    clearedLink = true;
    changed = true;
  }
  if (state.selectedRemotePortalId === portalId) {
    state.selectedRemotePortalId = null;
    state.selectedRemotePortalPos = null;
    clearedLink = true;
    changed = true;
  }

  if (clearedLink && state.portalLine) {
    state.map?.removeLayer(state.portalLine);
    state.portalLine = null;
  }

  if (removePortalFavoriteById(portalId)) {
    changed = true;
  }

  if (changed) {
    savePortalSession();
    state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems, getLinkedPortalItems());
    renderMapItems();
    renderNearbyItemList();
    renderPortalSelection();
    renderPortalModal();
    updatePortalHud();
    updateTopOverlayButtons();
    drawPortalLink();
  }

  return changed;
}

function reconcileMissingItem(itemId) {
  if (!itemId) return;
  invalidateItemCache(itemId);
  const changed = removeItemFromClientState(itemId);
  if (!changed) return;

  state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems, getLinkedPortalItems());
  renderMapItems();
  renderNearbyItemList();
  renderInventory();
  renderPortalSelection();
  renderPortalModal();
  updatePortalHud();
  updateTopOverlayButtons();
  drawPortalLink();
}

function syncPortalFavoritesFromItem(updatedItem) {
  if (!updatedItem?.id) return;

  const favorites = loadPortalFavorites();
  let changed = false;
  const nextFavorites = favorites.map((favorite) => {
    if (favorite.id !== updatedItem.id) return favorite;
    changed = true;
    return {
      ...favorite,
      id: updatedItem.id,
      latitude: updatedItem.latitude,
      longitude: updatedItem.longitude,
      portal_name: updatedItem.portal_name ?? favorite.portal_name ?? null,
    };
  });

  if (changed) {
    savePortalFavorites(nextFavorites);
  }
}

function getLinkedPortalItems() {
  const linked = [];

  if (state.selectedLocalPortalId && state.selectedLocalPortalPos) {
    linked.push({
      id: state.selectedLocalPortalId,
      type: "portal_marker",
      latitude: state.selectedLocalPortalPos.latitude,
      longitude: state.selectedLocalPortalPos.longitude,
      portal_name: state.selectedLocalPortalPos.portal_name ?? null,
      content_text: state.selectedLocalPortalPos.content_text ?? null,
      content_url: state.selectedLocalPortalPos.content_url ?? null,
      content_upload_path: state.selectedLocalPortalPos.content_upload_path ?? null,
    });
  }

  if (state.selectedRemotePortalId && state.selectedRemotePortalPos) {
    linked.push({
      id: state.selectedRemotePortalId,
      type: "portal_marker",
      latitude: state.selectedRemotePortalPos.latitude,
      longitude: state.selectedRemotePortalPos.longitude,
      portal_name: state.selectedRemotePortalPos.portal_name ?? null,
      content_text: state.selectedRemotePortalPos.content_text ?? null,
      content_url: state.selectedRemotePortalPos.content_url ?? null,
      content_upload_path: state.selectedRemotePortalPos.content_upload_path ?? null,
    });
  }

  return linked;
}

function mergeDisplayItems(nearbyItems, viewportPortalItems, linkedPortalItems = []) {
  const mergePortalMarkerContent = (existing, incoming) => {
    const hasContentText = Object.prototype.hasOwnProperty.call(incoming, "content_text");
    const hasContentUrl = Object.prototype.hasOwnProperty.call(incoming, "content_url");
    const hasContentUploadPath = Object.prototype.hasOwnProperty.call(incoming, "content_upload_path");
    return {
      ...existing,
      ...incoming,
      content_text: hasContentText ? (incoming.content_text ?? null) : (existing.content_text ?? null),
      content_url: hasContentUrl ? (incoming.content_url ?? null) : (existing.content_url ?? null),
      content_upload_path: hasContentUploadPath ? (incoming.content_upload_path ?? null) : (existing.content_upload_path ?? null),
    };
  };

  const merged = new Map();
  for (const item of nearbyItems) {
    merged.set(item.id, item);
  }
  for (const item of viewportPortalItems) {
    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, item);
      continue;
    }
    if (item.type === "portal_marker" && existing.type === "portal_marker") {
      merged.set(item.id, mergePortalMarkerContent(existing, item));
      continue;
    }
    merged.set(item.id, item);
  }
  for (const item of linkedPortalItems) {
    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, item);
      continue;
    }
    if (item.type === "portal_marker" && existing.type === "portal_marker") {
      merged.set(item.id, mergePortalMarkerContent(existing, item));
      continue;
    }
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
  const actor = state.physicalPosition;
  if (!actor) return;
  const portals = state.displayItems.filter((i) => i.type === "portal_marker");
  const nearby = portals
    .map((portal) => ({
      portal,
      distance: haversineMeters(actor.lat, actor.lng, portal.latitude, portal.longitude),
    }))
    .filter((entry) => entry.distance <= maxMeters)
    .sort((a, b) => a.distance - b.distance);
  return nearby;
}

function setRemotePortal(item) {
  if (!item || item.type !== "portal_marker") return;

  if (isVirtualShiftActive()) {
    notify("Linking is only allowed when not teleported and physically near a portal.", "error", 3200);
    return;
  }

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
  state.selectedLocalPortalPos = {
    id: localPortal.id,
    latitude: localPortal.latitude,
    longitude: localPortal.longitude,
    portal_name: localPortal.portal_name ?? null,
  };
  state.selectedRemotePortalId = item.id;
  state.selectedRemotePortalPos = {
    id: item.id,
    latitude: item.latitude,
    longitude: item.longitude,
    portal_name: item.portal_name ?? null,
  };
  savePortalSession();
  renderPortalSelection();
  drawPortalLink();
  applyMapRotation();
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

function canUseNearestLinkedPortal() {
  if (!canUseCurrentPortalLink()) return false;
  const nearestPhysical = getPhysicalNearbyPortals(PICKUP_RANGE_METERS)?.[0] || null;
  if (!nearestPhysical?.portal?.id) return false;
  return nearestPhysical.portal.id === state.selectedLocalPortalId;
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

function getNearbyPortalsAtVirtualPosition(maxMeters = PICKUP_RANGE_METERS) {
  const virtual = getVirtualPosition();
  if (!virtual) return [];
  const portals = state.displayItems.filter((i) => i.type === "portal_marker");
  return portals
    .map((portal) => ({
      portal,
      distance: haversineMeters(virtual.lat, virtual.lng, portal.latitude, portal.longitude),
    }))
    .filter((entry) => entry.distance <= maxMeters)
    .sort((a, b) => a.distance - b.distance);
}

function getPortalRemovalTarget() {
  const editorTarget = getPortalEditorTargetPortal();
  if (editorTarget && editorTarget.type === "portal_marker") {
    return editorTarget;
  }
  return getPhysicalNearbyPortals(PORTAL_REMOVE_RANGE_METERS)?.[0]?.portal || null;
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
    { color: getMapThemeColors().portalLine, weight: 3, dashArray: "8,6" }
  ).addTo(state.map);

  state.portalLine.bringToFront();
  state.portalLine.redraw();
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
    const local = state.displayItems.find((item) => item.id === state.selectedLocalPortalId) || state.selectedLocalPortalPos;
    const remote = state.displayItems.find((item) => item.id === state.selectedRemotePortalId) || state.selectedRemotePortalPos;
    const localLabel = local ? formatPortalLabel(local) : (state.selectedLocalPortalId || "-");
    const remoteLabel = remote ? formatPortalLabel(remote) : (state.selectedRemotePortalId || "-");
    portalSelectionEl.textContent = `Local: ${localLabel} | Remote: ${remoteLabel}`;
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
    portal_name: nearest.portal.portal_name ?? null,
    content_text: nearest.portal.content_text ?? null,
    content_url: nearest.portal.content_url ?? null,
    content_upload_path: nearest.portal.content_upload_path ?? null,
  });
  savePortalFavorites(favorites);
  notify("Portal added to favourites.", "success", 2200);
}

function createPortalListSummary({
  portalName,
  portalId,
  latitude,
  longitude,
  distanceMeters = null,
  contentText = null,
  contentUrl = null,
  imageUrl = null,
}) {
  const summary = document.createElement("div");
  summary.className = "portal-list-summary";

  const thumbWrap = document.createElement("div");
  thumbWrap.className = "portal-list-thumb-wrap";

  if (imageUrl) {
    const thumb = document.createElement("img");
    thumb.className = "portal-list-thumb";
    thumb.alt = "Portal thumbnail";
    thumb.src = imageUrl;
    thumb.loading = "lazy";
    thumbWrap.appendChild(thumb);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "portal-list-thumb portal-list-thumb-placeholder";
    placeholder.textContent = "No image";
    thumbWrap.appendChild(placeholder);
  }

  const body = document.createElement("div");
  body.className = "portal-list-body";

  const title = document.createElement("strong");
  title.textContent = portalName || "Unnamed portal";
  body.appendChild(title);

  const meta = document.createElement("small");
  const idPart = portalId ? `${portalId.slice(0, 8)}...` : "unknown";
  const coordPart = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
    : "Unknown position";
  const distancePart = Number.isFinite(distanceMeters) ? `${distanceMeters.toFixed(1)}m away` : null;
  meta.textContent = distancePart ? `${distancePart} • ${coordPart} • ${idPart}` : `${coordPart} • ${idPart}`;
  body.appendChild(meta);

  if (typeof contentText === "string" && contentText.trim()) {
    const text = document.createElement("p");
    text.className = "portal-list-content-text";
    text.textContent = contentText.trim();
    body.appendChild(text);
  }

  const safeContentUrl = sanitizeExternalHttpUrl(contentUrl);
  if (safeContentUrl) {
    const link = document.createElement("a");
    link.className = "portal-list-content-url";
    link.href = safeContentUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = safeContentUrl;
    body.appendChild(link);
  }

  summary.append(thumbWrap, body);
  return summary;
}

function renderPortalModal() {
  renderNearbyPortalList();

  const addHereButton = document.getElementById("portal-add-here");
  const addFavoriteButton = document.getElementById("portal-add-favorite");
  const clearButton = document.getElementById("portal-clear-link");
  const removeNearbyButton = document.getElementById("portal-remove-nearby");

  const shifted = isVirtualShiftActive();
  if (addHereButton) addHereButton.disabled = shifted;
  if (addFavoriteButton) addFavoriteButton.disabled = !getNearestPortalAtVirtualPosition(PICKUP_RANGE_METERS);
  if (clearButton) clearButton.disabled = !canClearCurrentPortalLink();
  if (removeNearbyButton) removeNearbyButton.disabled = !getPortalRemovalTarget();

  const hasSelectedReplacementImage = Boolean(portalContentImageEl?.files?.length);
  const hasCurrentPortalImage = Boolean(getPortalEditorTargetPortal()?.content_upload_path);
  if (portalContentImageRemoveButtonEl) {
    portalContentImageRemoveButtonEl.disabled = !hasSelectedReplacementImage && !hasCurrentPortalImage && !portalEditorImageClearRequested;
  }

  const targetPortal = getPortalEditorTargetPortal();
  if (!targetPortal) {
    setPortalEditorTarget(null);
  } else if (!portalEditorBaseline || portalEditorBaseline.id !== targetPortal.id) {
    setPortalEditorTarget(targetPortal, { prefill: true });
  } else {
    renderPortalEditorPreview(targetPortal);
  }

  if (!portalFavoritesListEl) return;
  portalFavoritesListEl.innerHTML = "";
  const favorites = loadPortalFavorites();
  let favoritesChanged = false;

  const hydratedFavorites = favorites.map((favorite) => {
    const livePortal = state.displayItems.find((item) => item.id === favorite.id);
    if (!livePortal) return favorite;

    const nextName = livePortal.portal_name ?? favorite.portal_name ?? null;
    const nextFavorite = {
      ...favorite,
      latitude: livePortal.latitude,
      longitude: livePortal.longitude,
      portal_name: nextName,
      content_text: livePortal.content_text ?? favorite.content_text ?? null,
      content_url: livePortal.content_url ?? favorite.content_url ?? null,
      content_upload_path: livePortal.content_upload_path ?? favorite.content_upload_path ?? null,
    };

    if (
      nextFavorite.latitude !== favorite.latitude ||
      nextFavorite.longitude !== favorite.longitude ||
      nextFavorite.portal_name !== favorite.portal_name ||
      nextFavorite.content_text !== favorite.content_text ||
      nextFavorite.content_url !== favorite.content_url ||
      nextFavorite.content_upload_path !== favorite.content_upload_path
    ) {
      favoritesChanged = true;
    }

    return nextFavorite;
  });

  if (favoritesChanged) {
    savePortalFavorites(hydratedFavorites);
  }

  const renderedFavorites = favoritesChanged ? hydratedFavorites : favorites;
  if (!renderedFavorites.length) {
    const empty = document.createElement("li");
    empty.textContent = "No favourite portals yet.";
    portalFavoritesListEl.appendChild(empty);
    return;
  }

  for (const favorite of renderedFavorites) {
    const li = document.createElement("li");
    li.className = "portal-favorite-item";
    const portalName = typeof favorite.portal_name === "string" && favorite.portal_name.trim()
      ? favorite.portal_name.trim()
      : "Unnamed portal";
    li.appendChild(createPortalListSummary({
      portalName,
      portalId: typeof favorite.id === "string" && favorite.id ? favorite.id : null,
      latitude: Number(favorite.latitude),
      longitude: Number(favorite.longitude),
      contentText: favorite.content_text ?? null,
      contentUrl: favorite.content_url ?? null,
      imageUrl: favorite.content_upload_path ?? null,
    }));

    const actions = document.createElement("div");
    actions.className = "favorite-actions";

    const removeButton = document.createElement("button");
    removeButton.textContent = "Remove Favourite";
    removeButton.addEventListener("click", () => {
      removePortalFavoriteById(favorite.id);
      renderPortalModal();
    });
    actions.appendChild(removeButton);

    const viewButton = document.createElement("button");
    viewButton.textContent = "View on Map";
    viewButton.addEventListener("click", () => {
      if (!state.map) return;
      state.followPlayer = false;
      updateFollowIndicator();
      closeUiLayer("portals");
      state.map.setView([favorite.latitude, favorite.longitude], Math.max(state.map.getZoom(), 16));
    });
    actions.appendChild(viewButton);

    actions.appendChild(createPortalShareButton(favorite));

    li.appendChild(actions);
    portalFavoritesListEl.appendChild(li);
  }
}

function renderNearbyPortalList() {
  if (!portalNearbyListEl) return;

  portalNearbyListEl.innerHTML = "";
  const nearby = isVirtualShiftActive()
    ? getNearbyPortalsAtVirtualPosition(PICKUP_RANGE_METERS)
    : (getPhysicalNearbyPortals(PICKUP_RANGE_METERS) || []);

  if (!nearby.length) {
    const empty = document.createElement("li");
    empty.textContent = "No nearby portals to update.";
    portalNearbyListEl.appendChild(empty);
    return;
  }

  for (const entry of nearby) {
    const { portal, distance } = entry;
    const li = document.createElement("li");
    li.className = "portal-nearby-item";
    li.appendChild(createPortalListSummary({
      portalName: formatPortalLabel(portal),
      portalId: portal.id,
      latitude: Number(portal.latitude),
      longitude: Number(portal.longitude),
      distanceMeters: distance,
      contentText: portal.content_text ?? null,
      contentUrl: portal.content_url ?? null,
      imageUrl: portal.content_upload_path ?? null,
    }));

    const actions = document.createElement("div");
    actions.className = "portal-nearby-actions";

    const loadButton = document.createElement("button");
    loadButton.textContent = "Load";
    loadButton.addEventListener("click", () => {
      setPortalEditorTarget(portal, { prefill: true });
      notify("Loaded portal details into editor.", "info", 1800);
    });
    actions.appendChild(loadButton);

    const updateButton = document.createElement("button");
    updateButton.textContent = "Update";
    updateButton.addEventListener("click", () => {
      if (portalEditorTargetId !== portal.id || !portalEditorBaseline) {
        setPortalEditorTarget(portal, { prefill: false });
      }
      updatePortalDetails(portal);
    });
    actions.appendChild(updateButton);

    actions.appendChild(createPortalShareButton(portal));

    li.appendChild(actions);
    portalNearbyListEl.appendChild(li);
  }
}

async function updatePortalDetails(portal) {
  const targetPortal = portal && portal.type === "portal_marker" ? portal : getPortalEditorTargetPortal();
  if (!targetPortal || targetPortal.type !== "portal_marker") {
    notify("No nearby portal selected for update.", "error");
    return;
  }

  const actor = getEffectiveActorPosition();
  if (!actor) return;

  const portalNameRaw = portalNameInputEl?.value?.trim?.() ?? "";
  const portalTextRaw = portalContentTextEl?.value ?? "";
  const portalUrlRaw = portalContentUrlEl?.value?.trim?.() ?? "";
  const portalImageFile = portalContentImageEl?.files?.[0] || null;

  const baseline = portalEditorBaseline && portalEditorBaseline.id === targetPortal.id
    ? portalEditorBaseline
    : {
      id: targetPortal.id,
      portal_name: targetPortal.portal_name || "",
      content_text: targetPortal.content_text || "",
      content_url: targetPortal.content_url || "",
      content_upload_path: targetPortal.content_upload_path || "",
    };

  const changedName = portalNameRaw !== baseline.portal_name;
  const changedText = portalTextRaw !== baseline.content_text;
  const changedUrl = portalUrlRaw !== baseline.content_url;
  const changedImage = Boolean(portalImageFile) || (portalEditorImageClearRequested && Boolean(baseline.content_upload_path));

  if (!changedName && !changedText && !changedUrl && !changedImage) {
    notify("No portal changes to apply.", "info", 2200);
    return;
  }

  if (changedName && !portalNameRaw) {
    notify("Portal name cannot be blank.", "error");
    return;
  }

  if (portalUrlRaw) {
    try {
      // Basic URL validity guard before submit.
      // eslint-disable-next-line no-new
      new URL(portalUrlRaw);
    } catch {
      notify("Portal URL must be a valid absolute URL.", "error");
      return;
    }
  }

  try {
    const form = new FormData();
    form.append("actor_latitude", String(actor.lat));
    form.append("actor_longitude", String(actor.lng));
    if (changedName) form.append("portal_name", portalNameRaw);
    if (changedText) form.append("content_text", portalTextRaw);
    if (changedUrl) {
      if (portalUrlRaw) form.append("content_url", portalUrlRaw);
      else form.append("content_url_clear", "true");
    }
    if (portalEditorImageClearRequested && !portalImageFile) {
      form.append("content_upload_clear", "true");
    }
    if (portalImageFile) form.append("file", portalImageFile);

    const response = await fetch(`/api/dimensions/${state.dimensionRootId}/items/${targetPortal.id}/portal-details`, {
      method: "PATCH",
      body: form,
    });

    if (!response.ok) {
      if (response.status === 404) {
        reconcileMissingItem(targetPortal.id);
        notify("Portal no longer exists. Removed stale portal from your view.", "info", 2800);
        return;
      }
      throw new Error(await response.text());
    }
    const updated = await response.json();
    if (portalContentImageEl) portalContentImageEl.value = "";
    portalEditorImageClearRequested = false;
    invalidatePortalCache(updated.id || targetPortal.id);
    updatePortalItemsInState(updated);
    setPortalEditorTarget(updated, { prefill: true });
    renderMapItems();
    drawPortalLink();
    renderPortalModal();
    notify("Portal updated.", "success", 2200);
  } catch (err) {
    console.error(err);
    notify(parseErrorMessage(err) || "Failed to update portal.", "error");
  }
}

function renderDebugModal() {
  const spoofHereButton = document.getElementById("debug-spoof-here");
  const useRealButton = document.getElementById("debug-use-real");
  if (spoofHereButton) spoofHereButton.disabled = !getMapCenterOrPhysical();
  if (useRealButton) useRealButton.disabled = state.gpsMode === "real";
  syncSpoofAccuracyInput();
}

function savePortalSession() {
  schedulePersistClientState();
}

function loadPortalSession() {
  if (!state.selectedLocalPortalId && !state.selectedRemotePortalId) return;
  updatePortalOffsetFromSelection({ activate: false });
  renderPortalSelection();
  updateTopOverlayButtons();
}

function renderNearbyItemList() {
  const locationItems = state.nearbyItems.filter((item) => item.type !== "portal_marker");
  renderItemList(locationItems);
}

async function incrementVisitCounterView(item) {
  if (!item?.id || state.visitCounterViewedIds.has(item.id)) return;
  state.visitCounterViewedIds.add(item.id);

  try {
    const response = await fetch(`/api/dimensions/${state.dimensionRootId}/items/${item.id}/visit-counter`, {
      method: "POST",
    });
    if (!response.ok) throw new Error(await response.text());
    const updatedItem = await response.json();
    updatePortalItemsInState(updatedItem);
    renderNearbyItemList();
  } catch {
    state.visitCounterViewedIds.delete(item.id);
  }
}

async function deleteWorldItemSilently(itemId) {
  if (!itemId || !state.dimensionRootId) return false;
  try {
    const response = await fetch(`/api/dimensions/${state.dimensionRootId}/items/${itemId}`, { method: "DELETE" });
    if (!response.ok) return false;
  } catch {
    return false;
  }
  invalidateItemCache(itemId);
  removeItemFromClientState(itemId);
  return true;
}

async function reconcileNearbyFavoritePortalItems(items, h3Api) {
  const favoriteItems = items.filter(
    (item) => item.type === "favorite_portal_item" && item.favorite_portal_id && Number.isFinite(item.favorite_portal_latitude) && Number.isFinite(item.favorite_portal_longitude)
  );
  if (!favoriteItems.length || !h3Api?.latLngToCell) return items;

  const cellIds = Array.from(new Set(favoriteItems.map((item) => h3Api.latLngToCell(item.favorite_portal_latitude, item.favorite_portal_longitude, H3_RESOLUTION))));
  const cellPayloads = await Promise.all(
    cellIds.map(async (cellId) => {
      const key = `${state.dimensionRootId}:cell:${cellId}`;
      const url = `/api/dimensions/${state.dimensionRootId}/cells/${cellId}/item-ids`;
      try {
        const payload = await fetchJsonWithCache(key, url, false);
        return [cellId, new Set(payload.item_ids || [])];
      } catch {
        return [cellId, new Set()];
      }
    })
  );
  const portalIdsByCell = new Map(cellPayloads);

  const staleItems = favoriteItems.filter((item) => {
    const cellId = h3Api.latLngToCell(item.favorite_portal_latitude, item.favorite_portal_longitude, H3_RESOLUTION);
    return !portalIdsByCell.get(cellId)?.has(item.favorite_portal_id);
  });
  if (!staleItems.length) return items;

  void Promise.all(staleItems.map((item) => deleteWorldItemSilently(item.id)));
  return items.filter((item) => !staleItems.some((staleItem) => staleItem.id === item.id));
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
    const alreadyFavorite = item.type === "favorite_portal_item" && inventoryHasFavoritePortal(item.favorite_portal_id);
    const canPickUp = dist !== null && dist <= PICKUP_RANGE_METERS && !alreadyFavorite;

    if (item.type === "visit_counter") {
      void incrementVisitCounterView(item);
    }

    const li = document.createElement("li");
    li.className = "inventory-item";
    const badgeInfo = getItemTypeBadgeInfo(item);
    const title = escapeHtml(getItemCardTitle(item));
    const bodyHtml = getItemCardLocationBodyHtml(item);
    const distancePart = distLabel ? `<div class="item-distance">${escapeHtml(distLabel.slice(3))}</div>` : "";
    li.innerHTML = `
      <div class="item-title-row">
        <span class="item-type-badge ${badgeInfo.modifier}" title="${escapeHtml(badgeInfo.label)}" aria-label="${escapeHtml(badgeInfo.label)}">${badgeInfo.code}</span>
        <strong>${title}</strong>
      </div>
      ${distancePart}
      <small class="item-meta">${new Date(item.placement_timestamp).toLocaleString()}</small>
      ${bodyHtml}
    `;

    const photoEl = li.querySelector(".item-photo");
    if (photoEl) {
      photoEl.addEventListener("error", () => reconcileMissingItem(item.id), { once: true });
    }

    const actions = document.createElement("div");
    actions.className = "location-item-actions";

    appendItemActionButton(
      actions,
      alreadyFavorite
        ? "Already In Favourites"
        : canPickUp
          ? "Move To Inventory"
          : "Move Closer To Pick Up",
      () => pickUpItem(item),
      !canPickUp
    );

    appendDownloadItemAction(actions, item, "location");

    appendItemActionButton(actions, "Delete", () => deleteLocationItem(item));

    li.appendChild(actions);

    itemsEl.appendChild(li);
  }
}

async function loadNearby(lat, lng, preferCache = true) {
  if (!state.dimensionRootId) return;

  const maxRangeMeters = PICKUP_RANGE_METERS;
  const nearbyKey = `${state.dimensionRootId}:nearby:${lat.toFixed(4)}:${lng.toFixed(4)}:${maxRangeMeters}`;

  // Cache fast-path: skip rendering if a network fetch is already in-flight so
  // we don't flash stale data (which would be missing another player's just-placed item)
  // over a pending authoritative result.
  if (preferCache) {
    const cached = cacheRead(nearbyKey);
    if (cached) {
      if (loadNearbyFreshInFlight > 0) return;
      const h3Api = window.h3;
      const reconciledItems = await reconcileNearbyFavoritePortalItems(cached.items || [], h3Api);
      // Re-check after the async reconcile step.
      if (loadNearbyFreshInFlight > 0) return;
      state.nearbyItems = reconciledItems;
      for (const item of state.nearbyItems) {
        if (item.type === "portal_marker") updatePortalItemsInState(item);
      }
      state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems, getLinkedPortalItems());
      renderMapItems();
      renderNearbyItemList();
      renderPortalSelection();
      updatePortalHud();
      drawPortalLink();
      return;
    }
  }

  // Network path: take a generation ticket so a newer network fetch (e.g. a second
  // placement or explicit refresh) supersedes this one, but a cache-path call cannot.
  const freshGeneration = ++loadNearbyFreshGeneration;
  const isSuperseded = () => freshGeneration !== loadNearbyFreshGeneration;
  loadNearbyFreshInFlight++;

  try {
    const h3Api = window.h3;
    if (!h3Api || !h3Api.latLngToCell || !h3Api.gridDisk) {
      throw new Error("H3 client library unavailable");
    }

    const centerCell = h3Api.latLngToCell(lat, lng, H3_RESOLUTION);
    const edgeMeters = getH3EdgeMeters(h3Api);

    const k = Math.max(1, Math.ceil(maxRangeMeters / edgeMeters));
    const candidateCells = h3Api.gridDisk(centerCell, k);

    const cellPayloads = await Promise.all(
      candidateCells.map((cellId) => {
        const key = `${state.dimensionRootId}:cell:${cellId}`;
        const url = `/api/dimensions/${state.dimensionRootId}/cells/${cellId}/item-ids`;
        const maxAgeMs = getDistanceAwareCellCacheTtlMs(cellId, lat, lng, h3Api);
        return fetchJsonWithCache(key, url, preferCache, { maxAgeMs }).catch(() => ({ item_ids: [] }));
      })
    );

    if (isSuperseded()) return;

    const itemIds = Array.from(new Set(cellPayloads.flatMap((payload) => payload.item_ids || [])));
    const items = (
      await Promise.all(
        itemIds.map((itemId) => {
          const key = `item:${itemId}`;
          const url = `/api/items/${itemId}`;
          return fetchJsonWithCache(key, url, preferCache).catch((error) => {
            if (error?.status === 404) {
              reconcileMissingItem(itemId);
            }
            return null;
          });
        })
      )
    ).filter(Boolean);

    const reconciledItems = await reconcileNearbyFavoritePortalItems(items, h3Api);

    if (isSuperseded()) return;

    const nearbyItems = reconciledItems.filter(
      (item) => haversineMeters(lat, lng, item.latitude, item.longitude) <= maxRangeMeters
    );
    cacheWrite(nearbyKey, { items: nearbyItems });

    state.nearbyItems = nearbyItems;
    for (const item of state.nearbyItems) {
      if (item.type === "portal_marker") updatePortalItemsInState(item);
    }
    state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems, getLinkedPortalItems());
    renderMapItems();
    renderNearbyItemList();
    renderPortalSelection();
    updatePortalHud();
    drawPortalLink();
  } catch (err) {
    console.error("Failed to load nearby items", err);
    if (isSuperseded()) return;
    const cached = cacheRead(nearbyKey);
    if (cached) {
      state.nearbyItems = cached.items || [];
      for (const item of state.nearbyItems) {
        if (item.type === "portal_marker") updatePortalItemsInState(item);
      }
      state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems, getLinkedPortalItems());
      renderMapItems();
      renderNearbyItemList();
      renderPortalSelection();
      updatePortalHud();
      drawPortalLink();
    }
  } finally {
    loadNearbyFreshInFlight--;
  }
}

async function loadViewportPortals(preferCache = true) {
  if (!state.map || !state.dimensionRootId) return;

  const zoom = state.map.getZoom();
  const bounds = state.map.getBounds();

  // Below the fetch zoom, preserve whatever we have in the viewport set (avoids
  // wiping portal markers while zoomed out) but don't issue new requests.
  if (zoom < PORTAL_VIEWPORT_FETCH_ZOOM) {
    state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems, getLinkedPortalItems());
    renderMapItems();
    renderPortalSelection();
    updatePortalHud();
    drawPortalLink();
    return;
  }

  const h3Api = window.h3;
  if (!h3Api || !h3Api.polygonToCells) {
    console.warn("H3 client library unavailable — viewport portal load skipped");
    return;
  }

  // Client computes the covering cells deterministically — no query logic on the server.
  // polygonToCells expects [[lat, lng], ...] vertices; Leaflet bounds give us the four corners.
  const viewportPoly = [
    [bounds.getSouth(), bounds.getWest()],
    [bounds.getSouth(), bounds.getEast()],
    [bounds.getNorth(), bounds.getEast()],
    [bounds.getNorth(), bounds.getWest()],
  ];
  const center = bounds.getCenter();
  const viewportRadiusMeters = Math.max(
    haversineMeters(center.lat, center.lng, bounds.getNorth(), bounds.getEast()),
    haversineMeters(center.lat, center.lng, bounds.getNorth(), bounds.getWest()),
    haversineMeters(center.lat, center.lng, bounds.getSouth(), bounds.getEast()),
    haversineMeters(center.lat, center.lng, bounds.getSouth(), bounds.getWest())
  );
  let cells;
  let viewportMode = "full";
  try {
    cells = h3Api.polygonToCells(viewportPoly, H3_RESOLUTION);
  } catch (e) {
    console.warn("polygonToCells failed:", e);
    return;
  }
  const requestedCellCount = cells.length;

  if (cells.length > MAX_VIEWPORT_CELLS) {
    // Fall back to a bounded local disk centered on the viewport midpoint. This keeps
    // the fan-out deterministic and capped while still showing portals local to the user.
    const maxRingK = Math.max(1, Math.floor((Math.sqrt(12 * MAX_VIEWPORT_CELLS - 3) - 3) / 6));
    const edgeMeters = getH3EdgeMeters(h3Api);
    const desiredK = Math.max(1, Math.ceil(viewportRadiusMeters / edgeMeters));
    const fallbackK = Math.min(desiredK, maxRingK);
    const centerCell = h3Api.latLngToCell(center.lat, center.lng, H3_RESOLUTION);
    cells = h3Api.gridDisk(centerCell, fallbackK);
    viewportMode = "local";
  }

  // Stable cache key for the whole viewport: sort cells so pan order doesn't create duplicates.
  const viewportKey = `${state.dimensionRootId}:vp:${viewportMode}:${cells.slice().sort().join(",")}`;
  const cachedEntry = cachePeekEntry(viewportKey);
  const cached = cachedEntry?.value || null;
  const cacheAgeMs = cachedEntry ? getCacheAgeMs(viewportKey) : null;
  const cacheIsFresh = cached && cacheAgeMs !== null && cacheAgeMs <= PORTAL_CACHE_TTL_MS;
  const cacheOrigin = getVirtualPosition() || state.physicalPosition || { lat: center.lat, lng: center.lng };

  if (cacheIsFresh) {
    state.viewportPortalItems = cached.items || [];
    cacheTouch(viewportKey);
    for (const item of state.viewportPortalItems) updatePortalItemsInState(item);
    state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems, getLinkedPortalItems());
    renderMapItems();
    renderPortalSelection();
    updatePortalHud();
    drawPortalLink();
    return;
  }

  try {
    // One keyed GET per cell — server is a pure object store, no query logic.
    const cellPayloads = await Promise.all(
      cells.map((cellId) => {
        const cellKey = `${state.dimensionRootId}:cell:${cellId}`;
        const url = `/api/dimensions/${state.dimensionRootId}/cells/${cellId}/item-ids`;
        const maxAgeMs = getDistanceAwareCellCacheTtlMs(cellId, cacheOrigin.lat, cacheOrigin.lng, h3Api);
        return fetchJsonWithCache(cellKey, url, preferCache, { maxAgeMs }).catch(() => ({ item_ids: [] }));
      })
    );

    const itemIds = Array.from(new Set(cellPayloads.flatMap((p) => p.item_ids || [])));
    const items = (
      await Promise.all(
        itemIds.map((itemId) => {
          const itemKey = `item:${itemId}`;
          const url = `/api/items/${itemId}`;
          return fetchJsonWithCache(itemKey, url, preferCache).catch((error) => {
            if (error?.status === 404) reconcileMissingItem(itemId);
            return null;
          });
        })
      )
    ).filter(Boolean);

    const portalItems = items.filter((item) => {
      if (item.type !== "portal_marker") return false;
      if (viewportMode === "full") {
        return bounds.contains([item.latitude, item.longitude]);
      }
      return haversineMeters(center.lat, center.lng, item.latitude, item.longitude) <= viewportRadiusMeters;
    });
    cacheWrite(viewportKey, { items: portalItems });

    state.viewportPortalItems = portalItems;
    for (const item of state.viewportPortalItems) updatePortalItemsInState(item);
    state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems, getLinkedPortalItems());
    renderMapItems();
    renderPortalSelection();
    updatePortalHud();
    drawPortalLink();
  } catch (err) {
    console.error("Failed to load viewport portals", err);
    const fallback = cachePeekEntry(viewportKey)?.value || null;
    if (fallback) {
      state.viewportPortalItems = fallback.items || [];
      cacheTouch(viewportKey);
      for (const item of state.viewportPortalItems) updatePortalItemsInState(item);
      state.displayItems = mergeDisplayItems(state.nearbyItems, state.viewportPortalItems, getLinkedPortalItems());
      renderMapItems();
      renderPortalSelection();
      updatePortalHud();
      drawPortalLink();
    }
  }
}

function getH3EdgeMeters(h3Api) {
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
  return edgeMeters;
}

function updatePosition(lat, lng, accuracy, heading = null, speed = null) {
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
  applyMapRotation();
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
      updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.heading, pos.coords.speed);
    },
    (err) => {
      locationStatusEl.textContent = `Location error: ${explainGeoError(err)}`;
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );

  geolocationWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      clearFirstFixTimeout();
      updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.heading, pos.coords.speed);
    },
    (err) => {
      locationStatusEl.textContent = `Location error: ${explainGeoError(err)}`;
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );
}

async function placePortal() {
  if (!state.physicalPosition) return;
  const portalName = getPortalNameInputValue();
  const portalTextRaw = portalContentTextEl?.value ?? "";
  const portalUrlRaw = portalContentUrlEl?.value?.trim?.() ?? "";
  const portalImageFile = portalContentImageEl?.files?.[0] || null;

  const tooClose = (getPhysicalNearbyPortals(MIN_PORTAL_SPACING_METERS) || []).length > 0;

  if (tooClose) {
    notify(`Portal too close to an existing portal. Keep at least ${MIN_PORTAL_SPACING_METERS}m spacing.`, "error");
    return;
  }

  if (portalUrlRaw) {
    try {
      // Keep Add Portal Here URL validation consistent with portal update flow.
      // eslint-disable-next-line no-new
      new URL(portalUrlRaw);
    } catch {
      notify("Portal URL must be a valid absolute URL.", "error");
      return;
    }
  }

  const body = {
    type: "portal_marker",
    owner: state.ownerId,
    latitude: state.physicalPosition.lat,
    longitude: state.physicalPosition.lng,
    accuracy_meters: getPlacementAccuracyMeters(),
  };
  if (portalName) {
    body.portal_name = portalName;
  }

  const portalText = portalTextRaw.trim();
  if (portalText) {
    body.content_text = portalTextRaw;
  }
  if (portalUrlRaw) {
    body.content_url = portalUrlRaw;
  }

  const url = `/api/dimensions/${state.dimensionRootId}/items`;
  let created = null;

  try {
    if (!navigator.onLine) throw new Error("offline");
    created = await sendJson(url, body);

    if (portalImageFile && created?.id) {
      const form = new FormData();
      form.append("actor_latitude", String(state.physicalPosition.lat));
      form.append("actor_longitude", String(state.physicalPosition.lng));
      form.append("file", portalImageFile);

      const updateResponse = await fetch(
        `/api/dimensions/${state.dimensionRootId}/items/${created.id}/portal-details`,
        {
          method: "PATCH",
          body: form,
        }
      );

      if (!updateResponse.ok) {
        throw new Error(await updateResponse.text());
      }

      created = await updateResponse.json();
    }

    updatePortalItemsInState(created);
    portalEditorImageClearRequested = false;
    if (portalContentImageEl) portalContentImageEl.value = "";
  } catch (err) {
    const message = parseErrorMessage(err);
    if (message) {
      const timeoutMs = /accuracy/i.test(message) ? 5000 : 2600;
      notify(message, "error", timeoutMs);
    }
    if ((/^offline$/i.test(message) || /fetch/i.test(message)) && !portalImageFile) {
      queueWrite({ kind: "json", url, body });
    } else if ((/^offline$/i.test(message) || /fetch/i.test(message)) && portalImageFile) {
      notify("Portal image upload requires network connectivity.", "error", 3200);
    }
    return;
  }

  await replayQueue();
  const virtual = getVirtualPosition();
  if (virtual) {
    await loadNearby(virtual.lat, virtual.lng, false);
  }
  renderPortalModal();
}

function getPortalNameInputValue() {
  return portalNameInputEl ? portalNameInputEl.value.trim() : "";
}

function getNearestPhysicalPortal() {
  return getPhysicalNearbyPortals(PICKUP_RANGE_METERS)?.[0]?.portal || null;
}

function getPortalEditorTargetPortal() {
  const nearby = isVirtualShiftActive()
    ? getNearbyPortalsAtVirtualPosition(PICKUP_RANGE_METERS)
    : (getPhysicalNearbyPortals(PICKUP_RANGE_METERS) || []);
  if (!portalEditorTargetId) return nearby[0]?.portal || null;
  return nearby.find((entry) => entry.portal.id === portalEditorTargetId)?.portal || nearby[0]?.portal || null;
}

function renderPortalEditorPreview(portal) {
  if (!portalEditorTargetEl) return;

  if (!portal) {
    portalEditorTargetEl.textContent = "Target: no nearby portal selected";
    if (portalContentUrlPreviewEl) {
      portalContentUrlPreviewEl.hidden = true;
      portalContentUrlPreviewEl.href = "#";
      portalContentUrlPreviewEl.textContent = "";
    }
    if (portalContentImagePreviewEl) {
      portalContentImagePreviewEl.hidden = true;
      portalContentImagePreviewEl.src = "";
    }
    return;
  }

  portalEditorTargetEl.textContent = `Target: ${formatPortalLabel(portal)} (${portal.id.slice(0, 8)}...)`;

  if (portalContentUrlPreviewEl) {
    const previewUrl = sanitizeExternalHttpUrl(portal.content_url || "");
    if (previewUrl) {
      portalContentUrlPreviewEl.href = previewUrl;
      portalContentUrlPreviewEl.textContent = previewUrl;
      portalContentUrlPreviewEl.hidden = false;
    } else {
      portalContentUrlPreviewEl.hidden = true;
      portalContentUrlPreviewEl.href = "#";
      portalContentUrlPreviewEl.textContent = "";
    }
  }

  if (portalContentImagePreviewEl) {
    if (portalContentImageEl?.files?.length) {
      return;
    }
    if (portalEditorImageClearRequested) {
      portalContentImagePreviewEl.hidden = true;
      portalContentImagePreviewEl.src = "";
      return;
    }
    const previewImage = portal.content_upload_path || "";
    if (previewImage) {
      portalContentImagePreviewEl.src = previewImage;
      portalContentImagePreviewEl.hidden = false;
    } else {
      portalContentImagePreviewEl.hidden = true;
      portalContentImagePreviewEl.src = "";
    }
  }
}

function setPortalEditorTarget(portal, { prefill = true } = {}) {
  if (!portal || portal.type !== "portal_marker") {
    portalEditorTargetId = null;
    portalEditorBaseline = null;
    portalEditorImageClearRequested = false;
    renderPortalEditorPreview(null);
    return;
  }

  if (portalEditorTargetId !== portal.id) {
    portalEditorImageClearRequested = false;
  }

  const existingBaseline = (portalEditorBaseline && portalEditorBaseline.id === portal.id)
    ? portalEditorBaseline
    : null;
  const hasIncomingContentUploadPath = Object.prototype.hasOwnProperty.call(portal, "content_upload_path");

  portalEditorTargetId = portal.id;
  portalEditorBaseline = {
    id: portal.id,
    portal_name: portal.portal_name || "",
    content_text: portal.content_text || "",
    content_url: portal.content_url || "",
    content_upload_path: hasIncomingContentUploadPath
      ? (portal.content_upload_path || "")
      : (existingBaseline?.content_upload_path || ""),
  };

  if (prefill) {
    portalEditorImageClearRequested = false;
    if (portalNameInputEl) portalNameInputEl.value = portalEditorBaseline.portal_name;
    if (portalContentTextEl) portalContentTextEl.value = portalEditorBaseline.content_text;
    if (portalContentUrlEl) portalContentUrlEl.value = portalEditorBaseline.content_url;
    if (portalContentImageEl) portalContentImageEl.value = "";
  }

  renderPortalEditorPreview(portal);
}

function parseErrorMessage(err) {
  const raw = err instanceof Error ? err.message : String(err || "");
  try {
    const parsed = JSON.parse(raw);
    return parsed?.detail || raw;
  } catch {
    return raw;
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
  if (value == null) return "";
  const s = typeof value === "string" ? value : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildPortalShareUrl(portalLike) {
  const latitude = Number(portalLike?.latitude);
  const longitude = Number(portalLike?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const url = new URL(window.location.href);
  url.searchParams.set(SHARED_PORTAL_LAT_PARAM, latitude.toFixed(6));
  url.searchParams.set(SHARED_PORTAL_LNG_PARAM, longitude.toFixed(6));
  return url.toString();
}

function createPortalShareButton(portalLike) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "portal-share-button";
  button.setAttribute("aria-label", "Share portal link");
  button.setAttribute("title", "Share portal link");
  button.innerHTML = `<svg class="icon-svg icon-svg--stroke" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="6" cy="12" r="1.75"></circle><circle cx="17.5" cy="6" r="1.75"></circle><circle cx="17.5" cy="18" r="1.75"></circle><path d="M7.6 11.15 15.9 6.85M7.6 12.85l8.3 4.3"></path></svg><span>Share</span>`;
  button.addEventListener("click", async () => {
    const shareUrl = buildPortalShareUrl(portalLike);
    if (!shareUrl) {
      notify("Could not build share link for this portal.", "error", 2600);
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({ url: shareUrl });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        notify("Portal link copied.", "success", 2200);
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(shareUrl);
          notify("Portal link copied.", "success", 2200);
          return;
        } catch {
          // Fall through to prompt.
        }
      }
    }

    window.prompt("Copy portal link:", shareUrl);
  });
  return button;
}

function getSharedPortalTargetFromUrl() {
  const url = new URL(window.location.href);
  const latitudeRaw = url.searchParams.get(SHARED_PORTAL_LAT_PARAM);
  const longitudeRaw = url.searchParams.get(SHARED_PORTAL_LNG_PARAM);
  if (latitudeRaw === null || longitudeRaw === null) return null;
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { lat: latitude, lng: longitude };
}

function clearSharedPortalParamsFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete(SHARED_PORTAL_LAT_PARAM);
  url.searchParams.delete(SHARED_PORTAL_LNG_PARAM);
  history.replaceState(history.state, "", url.toString());
  renderMenuShareQr(true);
}

function repairFollowStateAfterSharedPortalRegression() {
  if (localStorage.getItem(followRepairKey) === "done") return;
  if (getSharedPortalTargetFromUrl()) return;
  if (state.followPlayer) {
    localStorage.setItem(followRepairKey, "done");
    return;
  }

  state.sharedPortalFocusActive = false;
  state.followPlayer = true;
  persistClientStateNow();
  localStorage.setItem(followRepairKey, "done");
}

async function applySharedPortalLocationFromUrl() {
  const target = getSharedPortalTargetFromUrl();
  if (!target || !state.map) return;

  if (document.readyState !== "complete") {
    await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
  }

  state.sharedPortalFocusActive = true;
  updateFollowIndicator();
  state.programmaticMapMove = true;
  state.map.setView([target.lat, target.lng], Math.max(state.map.getZoom(), 18), { animate: true });
  clearSharedPortalParamsFromUrl();
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
  state.sharedPortalFocusActive = false;
  state.followPlayer = true;
  schedulePersistClientState();
  updateFollowIndicator();
  centerMapOnPlayerVirtual(true);
});

mapRotationToggleButtonEl?.addEventListener("click", () => {
  toggleMapRotationMode();
});

portalReturnButtonEl?.addEventListener("click", () => {
  returnToPhysicalPosition();
});

portalUseNearestButtonEl?.addEventListener("click", () => {
  if (!canUseNearestLinkedPortal()) {
    notify("Stand by the linked nearest portal to use it.", "error", 2800);
    return;
  }
  jumpThroughPortalLink();
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

portalLoadNearestButtonEl?.addEventListener("click", () => {
  const nearest = getNearestPhysicalPortal();
  if (!nearest) {
    notify("No nearby portal to load.", "error", 2200);
    return;
  }
  setPortalEditorTarget(nearest, { prefill: true });
  notify("Loaded nearest portal into editor.", "info", 1800);
});

portalContentImageEl?.addEventListener("change", () => {
  const picked = portalContentImageEl.files?.[0] || null;
  if (!portalContentImagePreviewEl) return;
  if (!picked) {
    const target = getPortalEditorTargetPortal();
    renderPortalEditorPreview(target);
    return;
  }
  portalEditorImageClearRequested = false;
  portalContentImagePreviewEl.src = URL.createObjectURL(picked);
  portalContentImagePreviewEl.hidden = false;
});

portalContentImageRemoveButtonEl?.addEventListener("click", () => {
  const target = getPortalEditorTargetPortal();
  if (!target) {
    notify("No nearby portal selected for image removal.", "error", 2200);
    return;
  }
  portalEditorImageClearRequested = true;
  if (portalContentImageEl) portalContentImageEl.value = "";
  renderPortalEditorPreview(target);
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
  const targetPortal = getPortalRemovalTarget();
  if (!targetPortal) {
    notify("Move physically within range of a portal to remove it.", "error", 2800);
    return;
  }

  await removePortalItem(targetPortal);
  renderPortalModal();
});

document.getElementById("debug-spoof-here")?.addEventListener("click", () => {
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
gpsAccuracyOverrideInputEl?.addEventListener("change", () => {
  const rawValue = gpsAccuracyOverrideInputEl.value.trim();
  if (!rawValue) {
    setSpoofAccuracyOverrideMeters(null);
    return;
  }
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    notify("Spoof accuracy must be a non-negative number.", "error");
    syncSpoofAccuracyInput();
    return;
  }
  setSpoofAccuracyOverrideMeters(parsedValue);
});

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

menuShareCopyButtonEl?.addEventListener("click", async () => {
  const shareUrl = getClientShareUrl();

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      notify("Current URL copied.", "success", 2200);
      return;
    }
  } catch {
    // Fall back to prompt.
  }

  window.prompt("Copy page URL:", shareUrl);
});

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
    state.sharedPortalFocusActive = false;
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
  state.sharedPortalFocusActive = false;
  state.followPlayer = true;
  schedulePersistClientState();
  updateFollowIndicator();
  centerMapOnPlayerVirtual(true);
});

// ── Inventory ─────────────────────────────────────────────────────────────────

function saveInventory() {
  localStorage.setItem(inventoryKey, JSON.stringify(state.inventory.map((item) => normalizeInventoryItem(item))));
}

async function resolveItemImageDataUrl(item) {
  if (item?.content_data_url) return item.content_data_url;
  if (!item?.content_upload_path) return null;
  try {
    const response = await fetch(item.content_upload_path);
    if (!response.ok) throw new Error("download failed");
    const blob = await response.blob();
    return await fileToDataUrl(blob);
  } catch {
    return null;
  }
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
  if (item.inventorySource === "favorite") {
    removePortalFavoriteById(item.portalId);
    renderPortalModal();
  } else {
    removeFromInventory(item.id);
  }
  renderInventory();
  notify("Item deleted.", "success", 2000);
}

async function pickUpItem(item) {
  if (item.type === "favorite_portal_item" && inventoryHasFavoritePortal(item.favorite_portal_id)) {
    notify("This portal is already in your favourites.", "info", 2600);
    return;
  }

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

  if (item.type === "favorite_portal_item") {
    const favorites = loadPortalFavorites();
    favorites.push({
      id: item.favorite_portal_id,
      latitude: item.favorite_portal_latitude,
      longitude: item.favorite_portal_longitude,
      portal_name: item.favorite_portal_name ?? null,
      content_name: item.content_name ?? null,
      content_text: item.content_text ?? null,
      content_url: item.content_url ?? null,
      content_data_url: await resolveItemImageDataUrl(item),
    });
    savePortalFavorites(favorites);
    renderPortalModal();
  } else {
    state.inventory.push(normalizeInventoryItem({ ...item }));
    saveInventory();
  }

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

  invalidatePortalCache(item.id);

  if (state.selectedLocalPortalId === item.id || state.selectedRemotePortalId === item.id) {
    clearPortalLink(false);
  }

  reconcileMissingItem(item.id);

  const virtual = getVirtualPosition();
  if (virtual) {
    await loadNearby(virtual.lat, virtual.lng, false);
  }
  notify("Portal removed.", "success", 2200);
}

async function replayInventoryItem(item, editedName, editedText, editedUrl) {
  const virtual = getVirtualPosition();
  if (!virtual || !state.physicalPosition) {
    notify("GPS position needed to place an item.", "error");
    return;
  }

  try {
    if (!navigator.onLine) throw new Error("offline");
    const behavior = getItemFlowBehavior(item.type);
    const placeError = await behavior.placeAtLocation({
      state,
      virtual,
      item,
      getPlacementAccuracyMeters,
      editedName,
      editedText,
      editedUrl,
    });
    if (placeError) {
      notify(placeError, "error");
      return;
    }
  } catch (err) {
    notify(parseErrorMessage(err) || "Could not place inventory item. Try again when online.", "error", 3200);
    return;
  }

  if (item.inventorySource === "favorite") {
    removePortalFavoriteById(item.portalId);
    renderPortalModal();
  } else {
    removeFromInventory(item.id);
  }
  await replayQueue();
  const virtual2 = getVirtualPosition();
  if (virtual2) await loadNearby(virtual2.lat, virtual2.lng, false);
  renderInventory();
}

function renderInventory() {
  const inventoryEl = inventoryItemsListEl;
  const inventoryCountEl = null;
  if (!inventoryEl) return;
  const entries = getInventoryEntries();
  if (inventoryCountEl) inventoryCountEl.textContent = String(entries.length);

  inventoryEl.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.textContent = "Nothing held.";
    inventoryEl.appendChild(empty);
    return;
  }

  for (const item of entries) {
    const li = document.createElement("li");
    li.className = "inventory-item";

    const header = document.createElement("div");
    header.className = "inventory-meta";
    const badgeInfo = getItemTypeBadgeInfo(item);
    header.innerHTML = `<div class="item-title-row"><span class="item-type-badge ${badgeInfo.modifier}" title="${escapeHtml(badgeInfo.label)}" aria-label="${escapeHtml(badgeInfo.label)}">${badgeInfo.code}</span><strong>${escapeHtml(getInventoryEntryTitle(item))}</strong></div> — ${getItemCardInventoryDetailHtml(item)}`;
    li.appendChild(header);

    if (item.type === "favorite_portal_item") {
      const portalMeta = document.createElement("div");
      portalMeta.className = "inventory-favorite-meta";
      portalMeta.innerHTML = `<small>Portal ${escapeHtml((item.favorite_portal_name || item.portalId || "unknown"))}</small>`;
      li.appendChild(portalMeta);
    }

    let nameInputEl = null;
    let textareaEl = null;
    let urlInputEl = null;

    if (item.type === "visit_counter") {
      const counterMeta = document.createElement("div");
      counterMeta.className = "visit-counter-card";
      counterMeta.innerHTML = `<div class="visit-counter-count">Viewed <strong>${Number.isFinite(item.visit_count) ? item.visit_count : 0}</strong> time${(Number.isFinite(item.visit_count) ? item.visit_count : 0) === 1 ? "" : "s"}</div>`;
      li.appendChild(counterMeta);
    } else {
      nameInputEl = document.createElement("input");
      nameInputEl.type = "text";
      nameInputEl.className = "inventory-name-input";
      nameInputEl.placeholder = item.type === "favorite_portal_item" ? "Optional title" : "Optional name";
      nameInputEl.value = item.content_name || "";
      nameInputEl.addEventListener("input", () => {
        const nextValue = nameInputEl.value;
        if (item.inventorySource === "favorite") updatePortalFavorite(item.portalId, { content_name: nextValue });
        else updateInventoryItem(item.id, { content_name: nextValue });
      });
      li.appendChild(nameInputEl);

      textareaEl = document.createElement("textarea");
      textareaEl.className = "inventory-textarea";
      textareaEl.rows = INVENTORY_TEXTAREA_MIN_ROWS;
      textareaEl.placeholder = item.type === "favorite_portal_item" ? "Optional note for this favourite portal" : "Optional note";
      textareaEl.value = item.content_text || "";
      const applyBounds = () => autoResizeTextareaWithinRows(
        textareaEl,
        INVENTORY_TEXTAREA_MIN_ROWS,
        INVENTORY_TEXTAREA_MAX_ROWS
      );
      textareaEl.addEventListener("input", () => {
        applyBounds();
        const nextValue = textareaEl.value;
        if (item.inventorySource === "favorite") updatePortalFavorite(item.portalId, { content_text: nextValue });
        else updateInventoryItem(item.id, { content_text: nextValue });
      });
      li.appendChild(textareaEl);
      requestAnimationFrame(applyBounds);

      urlInputEl = document.createElement("input");
      urlInputEl.type = "url";
      urlInputEl.className = "inventory-url-input";
      urlInputEl.placeholder = "Optional URL";
      urlInputEl.value = item.content_url || "";
      urlInputEl.addEventListener("input", () => {
        const nextValue = urlInputEl.value;
        if (item.inventorySource === "favorite") updatePortalFavorite(item.portalId, { content_url: nextValue });
        else updateInventoryItem(item.id, { content_url: nextValue });
      });
      li.appendChild(urlInputEl);

      const safeInventoryUrl = sanitizeExternalHttpUrl(item.content_url);
      if (safeInventoryUrl) {
        const link = document.createElement("a");
        link.className = "inventory-preview-link";
        link.href = safeInventoryUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = safeInventoryUrl;
        li.appendChild(link);
      }

      if (item.content_upload_path || item.content_data_url) {
        const img = document.createElement("img");
        img.src = item.content_upload_path || item.content_data_url;
        img.alt = "media";
        img.style.cssText = "max-width:100%; border-radius:8px; display:block; margin:0.25rem 0;";
        if (item.content_upload_path) {
          img.addEventListener("error", () => reconcileMissingItem(item.id), { once: true });
        }
        li.appendChild(img);
      }

      const imageInputEl = document.createElement("input");
      imageInputEl.type = "file";
      imageInputEl.accept = "image/*";
      imageInputEl.className = "inventory-image-input";
      imageInputEl.addEventListener("change", async () => {
        const file = imageInputEl.files?.[0] || null;
        if (!file) return;
        const dataUrl = await fileToDataUrl(file);
        if (item.inventorySource === "favorite") updatePortalFavorite(item.portalId, { content_data_url: dataUrl });
        else updateInventoryItem(item.id, { content_data_url: dataUrl, content_upload_path: null });
        renderInventory();
      });
      li.appendChild(imageInputEl);

      if (item.content_upload_path || item.content_data_url) {
        const clearImageButton = document.createElement("button");
        clearImageButton.type = "button";
        clearImageButton.textContent = "Remove Image";
        clearImageButton.addEventListener("click", () => {
          if (item.inventorySource === "favorite") updatePortalFavorite(item.portalId, { content_data_url: null });
          else updateInventoryItem(item.id, { content_data_url: null, content_upload_path: null });
          renderInventory();
        });
        li.appendChild(clearImageButton);
      }
    }

    const actions = document.createElement("div");
    actions.className = "inventory-actions";

    appendItemActionButton(actions, "Place here", () => {
      replayInventoryItem(item, nameInputEl?.value, textareaEl?.value, urlInputEl?.value);
    });

    appendItemActionButton(actions, "Delete", () => deleteInventoryItem(item));

    appendDownloadItemAction(actions, item, "inventory");

    li.appendChild(actions);

    inventoryEl.appendChild(li);
  }
}

itemAddFormEl?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const virtual = getVirtualPosition();
  const itemType = getAddItemType();
  const behavior = getItemFlowBehavior(itemType);
  const name = (itemAddNameEl?.value || "").trim();
  const text = (itemAddTextEl?.value || "").trim();
  const url = (itemAddUrlEl?.value || "").trim();
  const photoFile = itemAddPhotoEl?.files?.[0] || null;

  const validationError = behavior.validateAdd?.({ name, text, url, photoFile });
  if (validationError) {
    notify(validationError, "error");
    return;
  }

  const draftItem = await behavior.buildAddDraftItem?.({ name, text, url, photoFile });
  if (!draftItem) {
    notify("Could not add item.", "error");
    return;
  }

  if (itemAddTarget === "inventory") {
    const newItem = await behavior.buildInventoryItem?.({ state, name, text, url, photoFile });
    if (!newItem) {
      notify("Could not add inventory item.", "error");
      return;
    }
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
      const placeError = await behavior.placeAtLocation({
        state,
        virtual,
        item: draftItem,
        getPlacementAccuracyMeters,
      });
      if (placeError) {
        notify(placeError, "error");
        return;
      }
    } catch {
      notify("Could not add location item. Try again.", "error");
      return;
    }

    await loadNearby(virtual.lat, virtual.lng, false);
    notify("Item added at this location.", "success", 2000);
  }

  if (itemAddTextEl) itemAddTextEl.value = "";
  if (itemAddNameEl) itemAddNameEl.value = "";
  if (itemAddUrlEl) itemAddUrlEl.value = "";
  if (itemAddPhotoEl) itemAddPhotoEl.value = "";
  closeTopUiLayer();
});

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  repairFollowStateAfterSharedPortalRegression();
  initThemeMode();
  setNetworkStatus();
  initLocCInputs();
  refreshGpsSpooferStatus();
  initMap();
  await beginDeviceOrientation();
  applyMapRotation();
  history.replaceState({ uiSessionId, uiStack: [] }, "", window.location.href);
  syncUiStack([]);
  renderMenuShareQr(true);
  updatePlayerMarkers();
  updateFollowIndicator();
  updateTopOverlayButtons();
  updatePortalHud();
  renderInventory();
  await getDefaultDimension();
  await validateLinkedPortalSession();
  await loadViewportPortals(true);
  loadPortalSession();
  restoreFollowOnNextFrame();
  if (state.followPlayer && getVirtualPosition()) {
    refreshLocationAndNearby(true);
  }
  beginGeolocation();
  await replayQueue();
  await applySharedPortalLocationFromUrl();
  renderMenuShareQr(true);
}

boot();

window.addEventListener("load", restoreFollowOnNextFrame);
