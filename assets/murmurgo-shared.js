/**
 * murmurgo-shared.js
 * Shared utilities for all Murmurgo JS apps.
 * Card rendering, API helpers, map utilities.
 * Vanilla JS — can be replaced with React/Preact components later.
 */

(function (window) {
  'use strict';

  const config = window.MURMURGO_CONFIG || {};
  const API_BASE = config.apiBase || '/apps/murmurgo/api';

  // ─── Router ──────────────────────────────────────────────────────

  const MurmurgoRouter = {
    trip(id) { return '/pages/trip?id=' + encodeURIComponent(id); },
    browse(params) {
      const q = new URLSearchParams(params || {}).toString();
      return q ? '/pages/browse?' + q : '/pages/browse';
    },
    ai() { return '/pages/ai'; },
    property(handle) { return '/pages/' + encodeURIComponent(handle); },
    city(handle) { return '/pages/' + encodeURIComponent(handle); },
    claim() { return '/pages/claim'; },
    supplier() { return '/pages/supplier'; },
    absolute(path) {
      return 'https://' + (config.shopDomain || window.location.host) + path;
    }
  };

  // ─── API Helpers ─────────────────────────────────────────────────

  async function api(path, opts = {}) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', ...opts.headers },
      ...opts,
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
    return res.json();
  }

  async function getPlaces(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return api(`/places?${qs}`);
  }

  async function getPlace(id) {
    return api(`/places/${id}`);
  }

  async function searchPlaces(q, params = {}) {
    const qs = new URLSearchParams({ q, ...params }).toString();
    return api(`/places/search?${qs}`);
  }

  async function getNearby(lat, lng, radius = 50000, limit = 6) {
    return api(`/places/nearby?lat=${lat}&lng=${lng}&radius=${radius}&limit=${limit}`);
  }

  // ─── Image Helpers ───────────────────────────────────────────────
  // NOTE: Cloudflare Image Resizing requires Pro/Business plan.
  // Zone is currently Free. Using ?w= params (ignored by R2, but harmless).

  function imageUrl(url, width) {
    if (!url) return '';
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}w=${width}`;
  }

  function imageSrcset(url, widths) {
    if (!url) return '';
    return widths.map(w => `${imageUrl(url, w)} ${w}w`).join(', ');
  }

  // ─── Card Component ──────────────────────────────────────────────

  function renderCard(place) {
    const photo = place.photos && place.photos[0]
      ? (place.photos[0].master || place.photos[0].source || place.photos[0])
      : '';
    const photoUrl = imageUrl(photo, 400);
    const srcset = imageSrcset(photo, [200, 400, 600]);
    const rating = place.google_rating != null ? `${place.google_rating}★` : '';
    const reviews = place.google_review_count ? `from ${place.google_review_count} reviews` : '';
    const location = [place.city, place.region].filter(Boolean).join(', ');

    return `
      <a href="${MurmurgoRouter.property(place.slug || place.id)}" class="mg-card">
        <img
          src="${photoUrl}"
          srcset="${srcset}"
          sizes="(max-width: 768px) 50vw, 300px"
          alt="${escapeHtml(place.name)}"
          loading="lazy"
          width="400"
          height="300"
          class="mg-card__img"
          onerror="this.style.display='none'"
        >
        <div class="mg-card__body">
          <h3 class="mg-card__name">${escapeHtml(place.name)}</h3>
          <p class="mg-card__meta">
            ${location ? escapeHtml(location) + ' · ' : ''}${rating} ${reviews}
          </p>
        </div>
      </a>
    `;
  }

  function renderCards(places, container) {
    if (!places || places.length === 0) {
      container.innerHTML = '<p class="mg-empty">No places found.</p>';
      return;
    }
    container.innerHTML = places.map(renderCard).join('');
  }

  // ─── Map Utilities ───────────────────────────────────────────────

  function initMapLibre(containerId, options = {}) {
    if (!window.maplibregl) {
      console.warn('MapLibre GL JS not loaded');
      return null;
    }
    const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el) return null;

    const map = new window.maplibregl.Map({
      container: el,
      style: options.style || config.maplibreStyle || 'https://demotiles.maplibre.org/style.json',
      center: options.center || [0, 0],
      zoom: options.zoom || 2,
      attributionControl: false,
      ...options,
    });
    map.addControl(new window.maplibregl.AttributionControl({ compact: true }));
    if (options.nav !== false) {
      map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    }
    return map;
  }

  function addPlaceMarkers(map, places, options = {}) {
    if (!map || !places) return;
    places.forEach((place, i) => {
      if (place.latitude == null || place.longitude == null) return;
      const el = document.createElement('div');
      el.className = 'mg-marker';
      el.innerHTML = '<div class="mg-marker__pin"></div>';
      const popup = new window.maplibregl.Popup({ offset: 8 }).setHTML(
        `<strong>${escapeHtml(place.name)}</strong><br>${escapeHtml(place.primary_type_display || '')}`
      );
      new window.maplibregl.Marker(el)
        .setLngLat([place.longitude, place.latitude])
        .setPopup(popup)
        .addTo(map);
    });
  }

  // ─── Entity Page Hydration ───────────────────────────────────────

  async function hydrateNearby(container) {
    const lat = parseFloat(container.dataset.lat);
    const lng = parseFloat(container.dataset.lng);
    const exclude = container.dataset.exclude;
    if (!lat || !lng) return;
    try {
      const data = await getNearby(lat, lng, 50000, 6);
      const places = (data.places || []).filter(p => String(p.id) !== String(exclude));
      const track = container.querySelector('[data-nearby-container]');
      if (track) renderCards(places.slice(0, 6), track);
    } catch (e) {
      console.error('Failed to load nearby:', e);
    }
  }

  async function hydratePropertiesByCity(container) {
    const city = container.dataset.city;
    if (!city) return;
    try {
      const data = await getPlaces({ city, limit: 8, offset: 0 });
      const track = container.querySelector('[data-properties-container]');
      if (track) renderCards(data.places || [], track);
    } catch (e) {
      console.error('Failed to load city properties:', e);
    }
  }

  async function hydratePropertiesByRegion(container) {
    const region = container.dataset.region;
    if (!region) return;
    try {
      const data = await getPlaces({ region, limit: 8, offset: 0 });
      const track = container.querySelector('[data-properties-container]');
      if (track) renderCards(data.places || [], track);
    } catch (e) {
      console.error('Failed to load region properties:', e);
    }
  }

  async function hydrateActivitiesByCity(container) {
    const city = container.dataset.city;
    if (!city) return;
    try {
      const data = await getPlaces({ city, type: 'activity', limit: 6, offset: 0 });
      const track = container.querySelector('[data-activities-container]');
      if (track) renderCards(data.places || [], track);
    } catch (e) {
      console.error('Failed to load city activities:', e);
    }
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

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // ─── Exports ─────────────────────────────────────────────────────

  window.Murmurgo = {
    config,
    api,
    getPlaces,
    getPlace,
    searchPlaces,
    getNearby,
    renderCard,
    renderCards,
    initMapLibre,
    addPlaceMarkers,
    hydrateNearby,
    hydratePropertiesByCity,
    hydratePropertiesByRegion,
    hydrateActivitiesByCity,
    escapeHtml,
    debounce,
    imageUrl,
    imageSrcset,
    router: MurmurgoRouter,
  };

})(window);
