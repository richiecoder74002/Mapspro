const APP_CONFIG = window.APP_CONFIG || {};
const DEFAULT_ROAD_STYLE_URL = "https://demotiles.maplibre.org/style.json";
const MAP_STYLES = {
  road: APP_CONFIG.MAP_STYLES?.road || APP_CONFIG.MAP_STYLE_URL || DEFAULT_ROAD_STYLE_URL,
  satellite: APP_CONFIG.MAP_STYLES?.satellite || APP_CONFIG.SATELLITE_STYLE_URL || APP_CONFIG.MAP_STYLE_URL || DEFAULT_ROAD_STYLE_URL
};
const CAMERA_PRESETS = {
  "2d": { pitch: 0, bearing: 0 },
  "3d": { pitch: 58, bearing: -18 }
};
const STYLE_LABELS = {
  road: "Road",
  satellite: "Satellite"
};
const DEFAULT_CENTER = [-0.09, 51.505];
const DEFAULT_ZOOM = 14;
const ROUTE_SOURCE_ID = "route";
const ROUTE_LAYER_ID = "route-line";
const BUILDINGS_LAYER_ID = "3d-buildings";

const searchForm = document.getElementById("searchForm");
const searchBox = document.getElementById("searchBox");
const shareButton = document.getElementById("shareButton");
const statusMessage = document.getElementById("statusMessage");
const transportButtons = Array.from(document.querySelectorAll("[data-transport]"));
const styleButtons = Array.from(document.querySelectorAll("[data-style]"));
const cameraButtons = Array.from(document.querySelectorAll("[data-camera]"));

const initialView = getInitialView();

const state = {
  transport: "driving",
  routeStart: null,
  searchMarker: null,
  routeData: null,
  mapStyle: initialView.style,
  cameraMode: initialView.camera,
  routeMarkers: {
    start: null,
    end: null
  }
};

const map = new maplibregl.Map({
  container: "map",
  style: getStyleUrl(state.mapStyle),
  center: initialView.center,
  zoom: initialView.zoom,
  pitch: CAMERA_PRESETS[state.cameraMode].pitch,
  bearing: CAMERA_PRESETS[state.cameraMode].bearing,
  antialias: false,
  attributionControl: false
});

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
  showUserHeading: true
}), "top-right");
map.addControl(new maplibregl.AttributionControl({ compact: true }));

map.on("style.load", syncMapPresentation);

map.on("contextmenu", handleRouteSelection);

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await searchLocation();
});

shareButton.addEventListener("click", shareLocation);

transportButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setTransport(button.dataset.transport);
  });
});

styleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMapStyle(button.dataset.style);
  });
});

cameraButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setCameraMode(button.dataset.camera);
  });
});

updateStyleButtons();
updateCameraButtons();

function getInitialView() {
  const params = new URLSearchParams(window.location.search);
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const zoom = Number(params.get("zoom"));
  const style = params.get("style");
  const camera = params.get("camera");

  return {
    center: Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : DEFAULT_CENTER,
    zoom: Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM,
    style: MAP_STYLES[style] ? style : "road",
    camera: CAMERA_PRESETS[camera] ? camera : "3d"
  };
}

function getStyleUrl(styleId) {
  return MAP_STYLES[styleId] || MAP_STYLES.road;
}

function setStatus(message) {
  statusMessage.textContent = message;
}

function updateStyleButtons() {
  styleButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.style === state.mapStyle);
  });
}

function updateCameraButtons() {
  cameraButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.camera === state.cameraMode);
  });
}

function setMapStyle(styleId) {
  if (!MAP_STYLES[styleId] || state.mapStyle === styleId) {
    return;
  }

  state.mapStyle = styleId;
  updateStyleButtons();
  map.setStyle(getStyleUrl(styleId));
  setStatus(`${STYLE_LABELS[styleId]} view enabled.`);
}

function setCameraMode(cameraMode) {
  if (!CAMERA_PRESETS[cameraMode]) {
    return;
  }

  state.cameraMode = cameraMode;
  updateCameraButtons();

  map.easeTo({
    pitch: CAMERA_PRESETS[cameraMode].pitch,
    bearing: CAMERA_PRESETS[cameraMode].bearing,
    duration: 1200,
    essential: true
  });

  syncMapPresentation();
  setStatus(cameraMode === "3d" ? "3D perspective enabled." : "2D planning view enabled.");
}

function setTransport(type) {
  state.transport = type;

  transportButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.transport === type);
  });

  const label = type === "driving" ? "Car" : type === "walking" ? "Walk" : "Bike";
  setStatus(`${label} mode selected. Right-click once to choose a start point, then again for the destination.`);
}

function syncMapPresentation() {
  if (state.cameraMode === "3d") {
    addBuildingsLayer();
  } else {
    removeBuildingsLayer();
  }

  if (state.routeData) {
    drawRoute(state.routeData);
  }
}

function addBuildingsLayer() {
  if (map.getLayer(BUILDINGS_LAYER_ID)) {
    return;
  }

  const buildingLayer = map.getStyle().layers.find((layer) => layer.source && layer["source-layer"] === "building");

  if (!buildingLayer) {
    return;
  }

  const firstLabelLayerId = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;

  map.addLayer({
    id: BUILDINGS_LAYER_ID,
    source: buildingLayer.source,
    "source-layer": buildingLayer["source-layer"],
    type: "fill-extrusion",
    minzoom: 14,
    paint: {
      "fill-extrusion-color": [
        "interpolate", ["linear"], ["zoom"],
        14, "#d8dee8",
        16, "#edf7ff"
      ],
      "fill-extrusion-height": [
        "interpolate", ["linear"], ["zoom"],
        14, 0,
        16, ["coalesce", ["get", "height"], 30]
      ],
      "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
      "fill-extrusion-opacity": 0.68
    }
  }, firstLabelLayerId);
}

function removeBuildingsLayer() {
  if (map.getLayer(BUILDINGS_LAYER_ID)) {
    map.removeLayer(BUILDINGS_LAYER_ID);
  }
}

async function searchLocation() {
  const query = searchBox.value.trim();

  if (!query) {
    setStatus("Enter a place, address, or landmark to search.");
    return;
  }

  setStatus(`Searching for ${query}...`);

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      setStatus(`No locations found for ${query}.`);
      return;
    }

    const [result] = data;
    const latitude = Number(result.lat);
    const longitude = Number(result.lon);

    map.flyTo({
      center: [longitude, latitude],
      zoom: 16,
      speed: 0.9,
      essential: true
    });

    if (!state.searchMarker) {
      state.searchMarker = new maplibregl.Marker({ element: createMarkerElement("marker-pin") });
    }

    state.searchMarker
      .setLngLat([longitude, latitude])
      .setPopup(new maplibregl.Popup({ offset: 14 }).setHTML(`<strong>${escapeHtml(result.display_name.split(",")[0])}</strong><br>${escapeHtml(result.display_name)}`))
      .addTo(map);

    setStatus(`Showing ${result.display_name}.`);
  } catch (error) {
    setStatus("Search is temporarily unavailable. Please try again.");
  }
}

async function handleRouteSelection(event) {
  if (!state.routeStart) {
    state.routeStart = event.lngLat;
    updateRouteMarker("start", event.lngLat, "start");
    updateRouteMarker("end", null, "end");
    setStatus("Start point locked. Right-click a destination to draw the route.");
    return;
  }

  const start = state.routeStart;
  const end = event.lngLat;
  setStatus("Fetching route...");

  try {
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/${state.transport}/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`
    );
    const data = await response.json();
    const route = data.routes?.[0]?.geometry?.coordinates;

    if (!route) {
      setStatus("No route was returned for that selection.");
      return;
    }

    state.routeData = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: route
      }
    };

    drawRoute(state.routeData);
    updateRouteMarker("end", end, "end");
    map.fitBounds([start.toArray(), end.toArray()], {
      padding: { top: 180, right: 56, bottom: 140, left: 56 },
      duration: 1200,
      essential: true
    });

    const modeLabel = state.transport === "driving" ? "Driving" : state.transport === "walking" ? "Walking" : "Cycling";
    setStatus(`${modeLabel} route ready. Right-click again to start a new route.`);
  } catch (error) {
    setStatus("Routing is temporarily unavailable. Try again in a moment.");
  } finally {
    state.routeStart = null;
  }
}

function drawRoute(routeData) {
  if (map.getSource(ROUTE_SOURCE_ID)) {
    map.getSource(ROUTE_SOURCE_ID).setData(routeData);
    return;
  }

  map.addSource(ROUTE_SOURCE_ID, {
    type: "geojson",
    data: routeData
  });

  map.addLayer({
    id: ROUTE_LAYER_ID,
    type: "line",
    source: ROUTE_SOURCE_ID,
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": "#8be0ff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 16, 7],
      "line-opacity": 0.92,
      "line-blur": 0.15
    }
  });
}

async function shareLocation() {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const url = new URL(window.location.href);

  url.searchParams.set("lat", center.lat.toFixed(6));
  url.searchParams.set("lon", center.lng.toFixed(6));
  url.searchParams.set("zoom", zoom.toFixed(2));
  url.searchParams.set("style", state.mapStyle);
  url.searchParams.set("camera", state.cameraMode);

  try {
    await navigator.clipboard.writeText(url.toString());
    setStatus("Sharable map link copied to your clipboard.");
  } catch (error) {
    setStatus("Copy failed. You can still use the current page URL to share this view.");
  }
}

function updateRouteMarker(key, lngLat, variant) {
  if (!lngLat) {
    if (state.routeMarkers[key]) {
      state.routeMarkers[key].remove();
      state.routeMarkers[key] = null;
    }
    return;
  }

  if (!state.routeMarkers[key]) {
    state.routeMarkers[key] = new maplibregl.Marker({
      element: createMarkerElement(`route-marker ${variant}`)
    });
  }

  state.routeMarkers[key].setLngLat(lngLat).addTo(map);
}

function createMarkerElement(className) {
  const element = document.createElement("div");
  element.className = className;
  return element;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}