/**
 * murmurgo-trip.js
 * Trip viewer (Command Center) for saved itineraries.
 * Reads trip ID from query param ?id= (Shopify) or path /trip/:id (Remix).
 * Vanilla JS, mobile-first.
 */

(function (window, document) {
  'use strict';

  const config = window.MURMURGO_CONFIG || {};
  const API_BASE = config.apiBase || '/apps/murmurgo/api';
  const MG = window.Murmurgo || {};

  // ─── Route Param Helper ──────────────────────────────────────────

  function getRouteParam(name) {
    // Try query param first (Shopify format: /pages/trip?id=abc)
    const params = new URLSearchParams(window.location.search);
    const queryValue = params.get(name);
    if (queryValue) return queryValue;

    // Try path param (Remix format: /trip/abc)
    const pathMatch = window.location.pathname.match(new RegExp(`/${name}/([^/]+)`));
    if (pathMatch) return pathMatch[1];

    // Try hash (fallback)
    const hashMatch = window.location.hash.match(new RegExp(`${name}=([^&]+)`));
    if (hashMatch) return decodeURIComponent(hashMatch[1]);

    return null;
  }

  function getTripId() {
    return getRouteParam('id') || getRouteParam('trip');
  }

  // ─── State ───────────────────────────────────────────────────────

  const state = {
    tripId: null,
    itinerary: null,
    entityCache: {},
    activeTab: 'timeline', // 'timeline' | 'grid' | 'map'
    loading: false,
    error: null,
  };

  // ─── DOM Refs ────────────────────────────────────────────────────

  let root, tabs, header, shareBtn;

  function cacheDOM() {
    root = document.getElementById('murmurgo-trip-root');
    tabs = document.getElementById('murmurgo-trip-tabs');
    header = document.getElementById('murmurgo-trip-header');
    shareBtn = document.getElementById('murmurgo-trip-share');
  }

  // ─── API ─────────────────────────────────────────────────────────

  async function fetchItinerary(id) {
    const res = await fetch(`${API_BASE}/itinerary/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchPlace(id) {
    try {
      const res = await fetch(`${API_BASE}/places/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.place) state.entityCache[id] = data.place;
      return data;
    } catch (err) {
      console.error('Failed to fetch place:', err);
      return null;
    }
  }

  async function cacheEntities(days) {
    const handles = new Set();
    days.forEach(d => {
      if (d.accommodation) handles.add(d.accommodation);
      (d.activities || []).forEach(a => { if (a.handle) handles.add(a.handle); });
    });
    const promises = Array.from(handles).map(h => {
      if (state.entityCache[h]) return Promise.resolve();
      return fetchPlace(h);
    });
    await Promise.all(promises);
  }

  // ─── Rendering ───────────────────────────────────────────────────

  function render() {
    if (!root) return;

    if (state.loading) {
      root.innerHTML = '<div class="m-trip__loading">Loading trip…</div>';
      return;
    }

    if (state.error) {
      root.innerHTML = `<div class="m-trip__error">${escapeHtml(state.error)}</div>`;
      return;
    }

    if (!state.itinerary) {
      root.innerHTML = '<div class="m-trip__error">Trip not found.</div>';
      return;
    }

    updateTabs();
    updateHeader();

    if (state.activeTab === 'grid') {
      renderDayGrid();
    } else if (state.activeTab === 'timeline') {
      renderTimeline();
    } else if (state.activeTab === 'map') {
      renderMapView();
    }
  }

  function updateHeader() {
    if (!header) return;
    const it = state.itinerary;
    const nights = it.days ? it.days.length : 0;
    const travelers = it.travelers ? `${it.travelers.adults || 2} adult${(it.travelers.adults || 2) !== 1 ? 's' : ''}` : '';
    header.innerHTML = `
      <h1 class="m-trip__title">${escapeHtml(it.name || 'Untitled Trip')}</h1>
      <p class="m-trip__meta">
        ${nights ? `${nights} night${nights !== 1 ? 's' : ''}` : ''}
        ${travelers ? ' · ' + travelers : ''}
        ${it.startDate ? ' · Starts ' + escapeHtml(it.startDate) : ''}
      </p>
    `;
  }

  function updateTabs() {
    if (!tabs) return;
    tabs.querySelectorAll('[data-tab]').forEach(tab => {
      tab.classList.toggle('is-active', tab.dataset.tab === state.activeTab);
    });
  }

  function renderDayGrid() {
    if (!root) return;
    const days = state.itinerary.days || [];

    const gridHtml = days.map((day) => {
      const entity = state.entityCache[day.accommodation];
      const location = day.location || (entity ? [entity.city, entity.country].filter(Boolean).join(', ') : '');

      const activitiesHtml = (day.activities || []).map(act => {
        const actEntity = state.entityCache[act.handle];
        return `<div class="m-day-grid__activity">
          <span class="m-day-grid__activity-time">${escapeHtml(act.time || '')}</span>
          <span class="m-day-grid__activity-name">${escapeHtml(actEntity?.name || act.handle)}</span>
        </div>`;
      }).join('');

      return `
        <div class="m-day-grid__block">
          <div class="m-day-grid__header">
            <span class="m-day-grid__num">Day ${day.dayNumber || day.day}</span>
            <span class="m-day-grid__location">${escapeHtml(location || '')}</span>
          </div>
          <div class="m-day-grid__stay">
            ${entity ? `<div class="m-day-grid__stay-card">
              <img src="${escapeHtml(entity.hero_photo || '')}" alt="${escapeHtml(entity.name)}" loading="lazy" onerror="this.style.display='none'">
              <span>${escapeHtml(entity.name)}</span>
            </div>` : '<div class="m-day-grid__placeholder">No stay planned</div>'}
          </div>
          <div class="m-day-grid__activities">${activitiesHtml}</div>
        </div>
      `;
    }).join('');

    root.innerHTML = `<div class="m-day-grid">${gridHtml}</div>`;
  }

  function renderTimeline() {
    if (!root) return;
    const days = state.itinerary.days || [];

    const timelineHtml = days.map((day) => {
      const entity = state.entityCache[day.accommodation];
      const location = day.location || (entity ? [entity.city, entity.country].filter(Boolean).join(', ') : '');
      const timeSlots = ['morning', 'lunch', 'afternoon', 'evening', 'night'];

      const slotsHtml = timeSlots.map(slot => {
        const slotActivities = (day.activities || []).filter(a => a.time === slot);
        const itemsHtml = slotActivities.map(act => {
          const actEntity = state.entityCache[act.handle];
          return `<div class="m-timeline__slot-item">
            <span>${escapeHtml(actEntity?.name || act.handle)}</span>
          </div>`;
        }).join('');

        const slotLabel = slot.charAt(0).toUpperCase() + slot.slice(1);
        return `
          <div class="m-timeline__slot">
            <div class="m-timeline__slot-header">
              <span class="m-timeline__slot-label">${slotLabel}</span>
            </div>
            <div class="m-timeline__slot-items">${itemsHtml}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="m-timeline__day">
          <button class="m-timeline__day-header" data-toggle-day="${day.dayNumber || day.day}">
            <span class="m-timeline__day-num">Day ${day.dayNumber || day.day}</span>
            <span class="m-timeline__day-location">${escapeHtml(location)}</span>
            <span class="m-timeline__day-chevron">▼</span>
          </button>
          <div class="m-timeline__day-body">
            <div class="m-timeline__sleep">
              <span class="m-timeline__sleep-label">Sleep:</span>
              <span class="m-timeline__sleep-name">${escapeHtml(entity?.name || 'Not set')}</span>
            </div>
            ${slotsHtml}
          </div>
        </div>
      `;
    }).join('');

    root.innerHTML = `<div class="m-timeline">${timelineHtml}</div>`;

    // Attach toggle handlers
    root.querySelectorAll('[data-toggle-day]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const day = e.currentTarget.dataset.toggleDay;
        const body = root.querySelector(`.m-timeline__day[data-day="${day}"] .m-timeline__day-body`);
        if (body) body.classList.toggle('is-collapsed');
        e.currentTarget.classList.toggle('is-collapsed');
      });
    });
  }

  function renderMapView() {
    if (!root) return;
    root.innerHTML = `
      <div class="m-trip-map-wrapper">
        <div id="murmurgo-trip-map-embedded" class="m-trip-map-embedded"></div>
      </div>
    `;
    setTimeout(() => renderTripMap(), 50);
  }

  function renderTripMap() {
    if (!window.maplibregl) return;
    const container = document.getElementById('murmurgo-trip-map-embedded');
    if (!container) return;
    if (container.dataset.mapInit) return;
    container.dataset.mapInit = 'true';

    const days = state.itinerary.days || [];
    const stays = days.filter(d => d.accommodation).map(d => ({
      ...d,
      entity: state.entityCache[d.accommodation],
    })).filter(d => d.entity && d.entity.latitude != null);

    if (stays.length === 0) {
      container.innerHTML = '<div class="m-trip-map__empty">Add stays to see the route</div>';
      return;
    }

    const lats = stays.map(s => s.entity.latitude);
    const lngs = stays.map(s => s.entity.longitude);
    const center = [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];

    const map = new window.maplibregl.Map({
      container,
      style: config.maplibreStyle || 'https://demotiles.maplibre.org/style.json',
      center,
      zoom: stays.length > 1 ? 5 : 10,
      attributionControl: false,
    });
    map.addControl(new window.maplibregl.AttributionControl({ compact: true }));
    map.addControl(new window.maplibregl.NavigationControl());

    // Route line
    if (stays.length > 1) {
      const coords = stays.map(s => [s.entity.longitude, s.entity.latitude]);
      map.on('load', () => {
        map.addSource('trip-route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: coords },
          },
        });
        map.addLayer({
          id: 'trip-route-line',
          type: 'line',
          source: 'trip-route',
          paint: { 'line-color': '#D4A373', 'line-width': 3 },
        });
      });
    }

    // Stay markers
    stays.forEach((stay) => {
      const el = document.createElement('div');
      el.className = 'm-trip-map__pin';
      el.textContent = String(stay.dayNumber || stay.day);
      new window.maplibregl.Marker({ element: el })
        .setLngLat([stay.entity.longitude, stay.entity.latitude])
        .setPopup(new window.maplibregl.Popup({ offset: 8 }).setText(stay.entity.name))
        .addTo(map);
    });

    // Activity markers
    days.forEach(day => {
      (day.activities || []).forEach(act => {
        const entity = state.entityCache[act.handle];
        if (!entity || entity.latitude == null) return;
        const el = document.createElement('div');
        el.className = 'm-trip-map__pin m-trip-map__pin--activity';
        new window.maplibregl.Marker({ element: el })
          .setLngLat([entity.longitude, entity.latitude])
          .setPopup(new window.maplibregl.Popup({ offset: 6 }).setText(entity.name))
          .addTo(map);
      });
    });
  }

  // ─── Share ───────────────────────────────────────────────────────

  function copyShareLink() {
    const url = (MG.router ? MG.router.absolute(MG.router.trip(state.tripId)) : `https://${config.shopDomain}/pages/trip?id=${state.tripId}`);
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('murmurgo-trip-share');
      if (btn) {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = original, 2000);
      }
    }).catch(() => {
      // Fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    });
  }

  // ─── Utilities ───────────────────────────────────────────────────

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Event Handlers ──────────────────────────────────────────────

  function onClick(e) {
    const tabTarget = e.target.closest('[data-tab]');
    if (tabTarget && tabs && tabs.contains(tabTarget)) {
      e.preventDefault();
      state.activeTab = tabTarget.dataset.tab;
      render();
      return;
    }

    const shareTarget = e.target.closest('#murmurgo-trip-share');
    if (shareTarget) {
      e.preventDefault();
      copyShareLink();
      return;
    }
  }

  // ─── Init ────────────────────────────────────────────────────────

  async function init() {
    cacheDOM();

    const tripId = getTripId();
    if (!tripId) {
      state.error = 'No trip ID found in URL. Use ?id=YOUR_TRIP_ID';
      render();
      return;
    }

    state.tripId = tripId;
    state.loading = true;
    render();

    try {
      const data = await fetchItinerary(tripId);
      state.itinerary = data.itinerary || data;
      if (state.itinerary.days) {
        await cacheEntities(state.itinerary.days);
      }
    } catch (err) {
      console.error('Failed to load trip:', err);
      state.error = 'Could not load this trip. It may have been removed or the ID is invalid.';
    } finally {
      state.loading = false;
      render();
    }

    document.addEventListener('click', onClick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
