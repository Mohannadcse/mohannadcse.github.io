(function () {
  if (window.__visitorMapInit) return;
  window.__visitorMapInit = true;

  var cfg = window.__visitorMapConfig || {};
  var workerBase = cfg.workerBase || "";
  var collectPath = cfg.collectPath || "/collect";
  var pointsPath = cfg.pointsPath || "/points";
  var breakpoint = Number(cfg.breakpoint || 925);
  var vectorLibUrl = cfg.vectorLibUrl || "https://cdn.jsdelivr.net/npm/jsvectormap@1.7.0/dist/jsvectormap.min.js";
  var worldMapUrl = cfg.worldMapUrl || "https://cdn.jsdelivr.net/npm/jsvectormap@1.7.0/dist/maps/world.js";
  var hasBackend = Boolean(workerBase);

  var points = null;
  var mapInstance = null;
  var lastMobile = null;
  var countryVisits = {};

  function isMobile() {
    return window.innerWidth < breakpoint;
  }

  function placeMap() {
    var wrap = document.getElementById("visitor-map-wrap");
    var section = document.getElementById("map-mobile-section");
    var target = document.getElementById(isMobile() ? "map-mobile-placeholder" : "visitor-map-sidebar-home");

    if (wrap && target && wrap.parentNode !== target) {
      target.appendChild(wrap);
    }

    if (section) {
      section.style.display = isMobile() ? "block" : "none";
    }
  }

  function radiusFor(count, maxCount) {
    var minR = 2.5;
    var maxR = 7;

    if (maxCount <= 1) return (minR + maxR) / 2;

    return minR + (maxR - minR) * ((count || 1) / maxCount);
  }

  function colorFor(count, maxCount) {
    if (maxCount <= 1) return "#cc7c5e";

    var ratio = (count || 1) / maxCount;
    if (ratio <= 1 / 3) return "#cc7c5e";
    if (ratio <= 2 / 3) return "#7c8c62";

    return "#b86b86";
  }

  function styledMarkers(items) {
    var maxCount = items.reduce(function (acc, item) {
      return Math.max(acc, item.count || 1);
    }, 1);

    return items.map(function (item) {
      return {
        name: item.name,
        coords: item.coords,
        style: {
          initial: {
            r: radiusFor(item.count, maxCount),
            fill: colorFor(item.count, maxCount),
          },
        },
      };
    });
  }

  function normalizeCountryName(name) {
    return String(name || "")
      .trim()
      .toLowerCase();
  }

  function pluralizeVisits(count) {
    return count === 1 ? "visit" : "visits";
  }

  function rebuildCountryVisits(entries) {
    countryVisits = {};

    entries.forEach(function (entry) {
      var key = normalizeCountryName(entry.country);
      if (!key) return;
      countryVisits[key] = (countryVisits[key] || 0) + Number(entry.count || 1);
    });
  }

  function renderMap() {
    if (typeof jsVectorMap === "undefined") return;

    if (mapInstance) {
      try {
        mapInstance.destroy();
      } catch (err) {
        // Ignore map destroy errors and continue with a new instance.
      }
      mapInstance = null;
    }

    var inner = document.getElementById("visitor-map");
    if (!inner) return;
    inner.innerHTML = "";

    var entries = (points || []).filter(function (p) {
      return p && p.lat != null && p.lng != null;
    });

    rebuildCountryVisits(entries);

    var cityItems = entries.map(function (p) {
      var place = [p.city, p.region, p.country].filter(Boolean).join(", ");
      var count = Number(p.count || 1);
      var label = count + " " + pluralizeVisits(count) + " from " + place;
      return {
        name: label,
        coords: [p.lat, p.lng],
        count: count,
      };
    });

    mapInstance = new jsVectorMap({
      selector: "#visitor-map",
      map: "world",
      zoomOnScroll: false,
      zoomButtons: true,
      zoomMax: 8,
      backgroundColor: "transparent",
      regionStyle: {
        initial: {
          fill: "#e1dbcd",
          stroke: "#faf9f6",
          strokeWidth: 0.4,
        },
      },
      markers: styledMarkers(cityItems),
      markerStyle: {
        initial: {
          fill: "#cc7c5e",
          stroke: "#ffffff",
          strokeWidth: 0.6,
          r: 3,
          fillOpacity: 0.9,
        },
        hover: {
          fill: "#141413",
        },
      },
      onRegionTooltipShow: function (_event, tooltip) {
        var countryName = tooltip && typeof tooltip.text === "function" ? tooltip.text() : "";
        var total = countryVisits[normalizeCountryName(countryName)] || 0;
        var suffix = total > 0 ? total + " " + pluralizeVisits(total) : "no visits yet";
        if (tooltip && typeof tooltip.text === "function") {
          tooltip.text(countryName + ": " + suffix);
        }
      },
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function loadPoints() {
    if (!hasBackend) {
      points = [];
      renderMap();
      return Promise.resolve();
    }

    return fetch(workerBase + pointsPath)
      .then(function (res) {
        if (!res.ok) throw new Error("Points endpoint unavailable");
        return res.json();
      })
      .then(function (payload) {
        points = Array.isArray(payload) ? payload : [];
        renderMap();
      })
      .catch(function () {
        points = [];
        renderMap();
      });
  }

  function beaconVisit() {
    if (!hasBackend) return;

    try {
      if (sessionStorage.getItem("vm_beaconed")) return;

      fetch(workerBase + collectPath, {
        method: "POST",
        keepalive: true,
      }).catch(function () {});

      sessionStorage.setItem("vm_beaconed", "1");
    } catch (err) {
      // Ignore storage/network failures.
    }
  }

  function init() {
    lastMobile = isMobile();
    placeMap();
    beaconVisit();

    loadScript(vectorLibUrl)
      .then(function () {
        return loadScript(worldMapUrl);
      })
      .then(loadPoints)
      .catch(function () {
        // Ignore script load failures and keep page usable.
      });

    var timer;
    window.addEventListener("resize", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var mobile = isMobile();
        if (mobile !== lastMobile) {
          lastMobile = mobile;
          placeMap();
          renderMap();
        }
      }, 200);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
