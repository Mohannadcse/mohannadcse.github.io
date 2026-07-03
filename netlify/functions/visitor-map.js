const { connectLambda, getStore } = require("@netlify/blobs");

const STORE_NAME = "visitor-map";
const KEY = "points-v1";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
    body: JSON.stringify(body),
  };
}

function routeOf(path) {
  const p = String(path || "").replace(/\/+$/, "");
  if (p.endsWith("/collect")) return "collect";
  if (p.endsWith("/points")) return "points";
  return "unknown";
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseGeoHeader(rawHeader) {
  if (!rawHeader) return null;

  try {
    return JSON.parse(rawHeader);
  } catch (_err) {
    // Continue with base64 fallback.
  }

  try {
    const decoded = Buffer.from(rawHeader, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch (_err) {
    return null;
  }
}

function extractGeo(event) {
  const headers = event.headers || {};
  const rawGeo = headers["x-nf-geo"] || headers["X-Nf-Geo"];
  const geo = parseGeoHeader(rawGeo) || {};

  const lat = num(geo.latitude || geo.lat);
  const lng = num(geo.longitude || geo.lng || geo.lon);

  if (lat == null || lng == null) return null;

  return {
    country: geo.country?.name || geo.country?.code || geo.country || "Unknown",
    region: geo.subdivision?.name || geo.region || "",
    city: geo.city || "Unknown",
    lat,
    lng,
  };
}

function pointKey(p) {
  return [p.country, p.region, p.city, p.lat.toFixed(3), p.lng.toFixed(3)].join("|").toLowerCase();
}

async function loadPoints(store) {
  const points = await store.get(KEY, { type: "json" });
  return Array.isArray(points) ? points : [];
}

async function savePoints(store, points) {
  await store.setJSON(KEY, points);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(204, { ok: true });
  }

  const route = routeOf(event.path);
  connectLambda(event);
  const store = getStore(STORE_NAME);

  if (route === "points") {
    const points = await loadPoints(store);
    return json(200, points);
  }

  if (route === "collect") {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const geo = extractGeo(event);
    if (!geo) {
      return json(200, { ok: true, ignored: true, reason: "missing_geo" });
    }

    const points = await loadPoints(store);
    const idx = new Map(points.map((p, i) => [pointKey(p), i]));
    const key = pointKey(geo);
    const existing = idx.get(key);

    if (existing == null) {
      points.push({ ...geo, count: 1 });
    } else {
      points[existing].count = Number(points[existing].count || 0) + 1;
    }

    await savePoints(store, points);
    return json(200, { ok: true });
  }

  return json(404, { error: "Not found" });
};
