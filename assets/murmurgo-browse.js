/**
 * murmurgo-browse.js
 * Browse page app: MapLibre map + card grid + infinite scroll + filters.
 * Reads config from window.MURMURGO_CONFIG.
 */

(function (window, document) {
  'use strict';

  const MG = window.Murmurgo || {};
  const config = window.MURMURGO_CONFIG || {};

  // ─── State ───────────────────────────────────────────────────────
  let state = {
    places: [],
    offset: 0,
    limit: 50,
    loading: false,
    hasMore: true,
    filters: {
      type: '',
      country: '',
      region: '',
      city: '',
    },
    map: null,
    clusterSource: null,
  };

  // ─── DOM ─────────────────────────────────────────────────────────
  const root = document.getElementById('murmurgo-browse-root');
  if (!root) return;

  if (!config.apiBase) {
    console.error('MURMURGO_CONFIG missing — murmurgo-config snippet not loaded');
    root.innerHTML = '<p class="m-browse__loader m-error">Configuration error. Please refresh.</p>';
    return;
  }

  // ─── Layout ──────────────────────────────────────────────────────
  function buildLayout() {
    root.innerHTML = `
      <div class="m-browse">
        <aside class="m-browse__sidebar">
          <div class="m-browse__search">
            <input type="search" id="mg-search" placeholder="Search places..." class="m-browse__input">
          </div>
          <div class="m-browse__filters">
            <select id="mg-filter-type" class="m-browse__select">
              <option value="">All types</option>
              <option value="lodging">Places to Stay</option>
              <option value="restaurant">Restaurants & Bars</option>
              <option value="nature">Wildlife & Nature</option>
              <option value="attraction">Attractions & Activities</option>
              <option value="spa">Spas & Wellness</option>
              <option value="park">Parks & Reserves</option>
            </select>
          </div>
          <div class="m-browse__results-info" id="mg-results-info"></div>
          <div class="m-browse__cards" id="mg-cards"></div>
          <div class="m-browse__ sentinel" id="mg-sentinel"></div>
        </aside>
        <div class="m-browse__map-wrap">
          <div id="mg-map" class="m-browse__map"></div>
        </div>
      </div>
    `;
  }

  // ─── Styles (injected) ───────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('mg-browse-styles')) return;
    const css = document.createElement('style');
    css.id = 'mg-browse-styles';
    css.textContent = `
      .m-browse-shell { width: 100%; min-height: calc(100vh - 120px); }
      #murmurgo-browse-root { width: 100%; height: 100%; }
      .m-browse { display: flex; flex-direction: column; width: 100%; height: 100%; }
      @media (min-width: 768px) { .m-browse { flex-direction: row; } }
      .m-browse__sidebar { flex: 0 0 100%; max-height: 50vh; overflow-y: auto; padding: 1rem; border-bottom: 1px solid #e0e0e0; }
      @media (min-width: 768px) { .m-browse__sidebar { flex: 0 0 400px; max-height: none; border-bottom: none; border-right: 1px solid #e0e0e0; } }
      .m-browse__search { margin-bottom: 0.75rem; }
      .m-browse__input { width: 100%; padding: 0.6rem 0.8rem; border: 1px solid #e0e0e0; font-size: 1rem; }
      .m-browse__filters { margin-bottom: 0.75rem; }
      .m-browse__select { width: 100%; padding: 0.6rem 0.8rem; border: 1px solid #e0e0e0; font-size: 1rem; background: #fff; }
      .m-browse__results-info { font-size: 0.85rem; color: #555; margin-bottom: 0.5rem; }
      .m-browse__cards { display: grid; grid-template-columns: 1fr; gap: 1rem; }
      @media (min-width: 768px) { .m-browse__cards { grid-template-columns: 1fr; } }
      .m-browse__map-wrap { flex: 1 1 auto; position: relative; min-height: 50vh; min-width: 0; }
      .m-browse__map { position: absolute; inset: 0; width: 100%; height: 100%; }
      .m-browse__card { display: flex; gap: 0.75rem; text-decoration: none; color: inherit; border: 1px solid #e0e0e0; padding: 0.5rem; }
      .m-browse__card-img { width: 80px; height: 80px; object-fit: cover; flex-shrink: 0; background: #f5f5f5; }
      .m-browse__card-body { min-width: 0; }
      .m-browse__card-name { font-weight: 500; font-size: 0.95rem; margin: 0 0 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .m-browse__card-meta { font-size: 0.8rem; color: #555; }
      .m-browse__loader { text-align: center; padding: 1rem; color: #555; }
      .mg-marker__pin { width: 12px; height: 12px; background: #D4A373; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.3); cursor: pointer; }
    `;
    document.head.appendChild(css);
  }

  // ─── Card Rendering ──────────────────────────────────────────────
  function renderBrowseCard(place) {
    const photo = place.photos && place.photos[0]
      ? (place.photos[0].master || place.photos[0].source || place.photos[0])
      : '';
    const photoUrl = photo ? `${photo}?w=400` : '';
    const srcset = photo ? `${photo}?w=200 200w, ${photo}?w=400 400w` : '';
    const rating = place.google_rating != null ? `${place.google_rating}★` : '';
    const location = [place.city, place.country].filter(Boolean).join(', ');
    return `
      <a href="${MG.router ? MG.router.property(place.slug || place.id) : '/pages/' + (place.slug || place.id)}" class="m-browse__card">
        <img
          src="${photoUrl}"
          srcset="${srcset}"
          sizes="80px"
          width="400"
          height="300"
          loading="lazy"
          alt="${MG.escapeHtml ? MG.escapeHtml(place.name) : place.name}"
          class="m-browse__card-img"
          onerror="this.style.display='none'"
        >
        <div class="m-browse__card-body">
          <h3 class="m-browse__card-name">${MG.escapeHtml ? MG.escapeHtml(place.name) : place.name}</h3>
          <p class="m-browse__card-meta">${MG.escapeHtml ? MG.escapeHtml(location) : location} · ${rating}</p>
        </div>
      </a>
    `;
  }

  function appendCards(places) {
    const container = document.getElementById('mg-cards');
    if (!container) return;
    if (places.length === 0 && state.offset === 0) {
      container.innerHTML = '<p class="m-browse__loader">No places found.</p>';
      return;
    }
    const html = places.map(renderBrowseCard).join('');
    if (state.offset === 0) container.innerHTML = html;
    else container.insertAdjacentHTML('beforeend', html);
  }

  // ─── Map ─────────────────────────────────────────────────────────
  function initMap() {
    if (!window.maplibregl) {
      console.warn('MapLibre not loaded');
      return;
    }
    state.map = MG.initMapLibre('mg-map', {
      center: [24, -22],
      zoom: 4,
      style: config.maplibreStyle || 'https://demotiles.maplibre.org/style.json',
    });
    if (!state.map) return;

    state.map.on('load', () => {
      state.map.addSource('places', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });
      state.map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'places',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#D4A373',
          'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 50, 25],
          'circle-opacity': 0.85,
        },
      });
      state.map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'places',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
        },
        paint: { 'text-color': '#fff' },
      });
      state.map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'places',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#D4A373',
          'circle-radius': 6,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });
      state.map.on('click', 'clusters', (e) => {
        const features = state.map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0].properties.cluster_id;
        state.map.getSource('places').getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          state.map.easeTo({ center: features[0].geometry.coordinates, zoom });
        });
      });
      state.map.on('click', 'unclustered-point', (e) => {
        const props = e.features[0].properties;
        new window.maplibregl.Popup()
          .setLngLat(e.features[0].geometry.coordinates)
          .setHTML(`<strong>${props.name}</strong><br><a href="${props.url}">View</a>`)
          .addTo(state.map);
      });
      state.map.on('mouseenter', 'clusters', () => { state.map.getCanvas().style.cursor = 'pointer'; });
      state.map.on('mouseleave', 'clusters', () => { state.map.getCanvas().style.cursor = ''; });
      state.map.on('mouseenter', 'unclustered-point', () => { state.map.getCanvas().style.cursor = 'pointer'; });
      state.map.on('mouseleave', 'unclustered-point', () => { state.map.getCanvas().style.cursor = ''; });
    });
  }

  function updateMap(places) {
    if (!state.map) return;
    const source = state.map.getSource('places');
    if (!source) return;
    const features = places
      .filter(p => p.latitude != null && p.longitude != null)
      .map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
        properties: { name: p.name, url: (window.Murmurgo && window.Murmurgo.router ? window.Murmurgo.router.property(p.slug || p.id) : '/pages/' + (p.slug || p.id)) },
      }));
    source.setData({ type: 'FeatureCollection', features });
  }

  // ─── Data Loading ────────────────────────────────────────────────
  async function loadPlaces(reset = false) {
    if (state.loading) return;
    if (!state.hasMore && !reset) return;
    state.loading = true;
    if (reset) {
      state.offset = 0;
      state.places = [];
      state.hasMore = true;
    }

    const info = document.getElementById('mg-results-info');
    if (info) info.textContent = 'Loading...';

    try {
      const params = {
        limit: state.limit,
        offset: state.offset,
        ...state.filters,
      };
      const data = await MG.getPlaces(params);
      const places = data.places || [];
      state.hasMore = data.hasMore !== false && places.length === state.limit;
      state.places = reset ? places : state.places.concat(places);
      state.offset += places.length;
      appendCards(places);
      updateMap(state.places);
      if (info) info.textContent = `${state.places.length}${state.hasMore ? '+' : ''} places`;
    } catch (e) {
      console.error('Browse load error:', e);
      if (info) info.textContent = 'Failed to load places.';
    } finally {
      state.loading = false;
    }
  }

  // ─── Infinite Scroll ─────────────────────────────────────────────
  function initInfiniteScroll() {
    const sentinel = document.getElementById('mg-sentinel');
    if (!sentinel || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadPlaces(false);
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  }

  // ─── Search & Filters ────────────────────────────────────────────
  function initFilters() {
    const searchInput = document.getElementById('mg-search');
    const typeSelect = document.getElementById('mg-filter-type');

    if (searchInput) {
      searchInput.addEventListener('input', MG.debounce ? MG.debounce((e) => {
        const q = e.target.value.trim();
        if (q.length < 2) return;
        MG.searchPlaces(q, { limit: 50 }).then(data => {
          state.places = data.places || [];
          state.hasMore = false;
          state.offset = state.places.length;
          appendCards(state.places);
          updateMap(state.places);
          const info = document.getElementById('mg-results-info');
          if (info) info.textContent = `${state.places.length} results for "${q}"`;
        }).catch(console.error);
      }, 400) : () => {});
    }

    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        state.filters.type = e.target.value;
        loadPlaces(true);
      });
    }
  }

  // ─── Hydrate Entity Pages ────────────────────────────────────────
  function hydrateEntityPages() {
    document.querySelectorAll('[data-nearby-container]').forEach(el => {
      const section = el.closest('[data-lat]');
      if (section && MG.hydrateNearby) MG.hydrateNearby(section);
    });
    document.querySelectorAll('[data-properties-container]').forEach(el => {
      const section = el.closest('[data-city], [data-region]');
      if (section && section.dataset.city && MG.hydratePropertiesByCity) {
        MG.hydratePropertiesByCity(section);
      } else if (section && section.dataset.region && MG.hydratePropertiesByRegion) {
        MG.hydratePropertiesByRegion(section);
      }
    });
    document.querySelectorAll('[data-activities-container]').forEach(el => {
      const section = el.closest('[data-city]');
      if (section && MG.hydrateActivitiesByCity) MG.hydrateActivitiesByCity(section);
    });
  }

  // ─── Amenities Toggle ────────────────────────────────────────────
  function initAmenitiesToggle() {
    document.querySelectorAll('[data-toggle-amenities]').forEach(btn => {
      btn.addEventListener('click', () => {
        const all = btn.previousElementSibling;
        if (!all) return;
        const hidden = all.hasAttribute('hidden');
        if (hidden) {
          all.removeAttribute('hidden');
          btn.textContent = 'Show fewer';
        } else {
          all.setAttribute('hidden', '');
          btn.textContent = btn.dataset.originalText || 'Show all amenities';
        }
      });
    });
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    buildLayout();
    initMap();
    loadPlaces(true);
    initInfiniteScroll();
    initFilters();
    hydrateEntityPages();
    initAmenitiesToggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
