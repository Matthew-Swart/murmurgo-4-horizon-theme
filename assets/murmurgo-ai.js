/**
 * murmurgo-ai.js
 * AI Conversation App for Murmurgo Phase 5
 * Rich visual agent — NOT a chatbot.
 * Vanilla JS, mobile-first.
 */

(function (window) {
  'use strict';

  const config = window.MURMURGO_CONFIG || {};
  const API_BASE = config.apiBase || '/apps/murmurgo/api';
  const SHARED = window.Murmurgo || {};

  // ─── State ─────────────────────────────────────────────────────────

  const state = {
    // Phase 4 existing
    messages: [],
    suggestions: [],
    shortlist: [],
    previewEntity: null,
    isLoading: false,
    isVoiceActive: false,
    sessionId: generateId(),
    hasSubmitted: false,
    recognition: null,

    // Phase 5 new
    mode: 'chat', // 'chat' | 'shortlist' | 'day-assignment' | 'timeline'
    entityCache: {}, // id -> place object
    undoStack: [],
    dragItem: null,
    dragSource: null,
    itinerary: {
      id: null,
      name: 'Untitled Trip',
      startDate: null,
      endDate: null,
      totalNights: 0,
      travelers: { adults: 2, children: 0, infants: 0 },
      days: [],
    },
    aiSuggestions: [],
    activeTab: 'grid', // 'grid' | 'timeline' | 'map'
    activitySearchContext: null, // { day, timeSlot }
  };

  function generateId() {
    return `mg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function priceLabel(level) {
    const map = { 1: '·', 2: '··', 3: '···', 4: '····' };
    return map[level] || '';
  }

  // ─── DOM Refs ──────────────────────────────────────────────────────

  let root, hero, video, input, micBtn, chipsContainer, stickyBar,
      stickyInput, stickyMic, previewPane, previewBody, previewClose,
      shortlistBar, shortlistDrawer, shortlistList, shortlistClose,
      dayAssignmentView, assignmentMain, assignmentSidebar, assignmentShortlist,
      tripMapPanel, saveModal, undoToast, confirmDialog, activitySearchModal,
      recognitionInstance;

  function cacheDOM() {
    root = document.getElementById('murmurgo-conversation-root');
    hero = document.querySelector('[data-ai-hero]');
    video = document.querySelector('[data-hero-video]');
    input = document.querySelector('[data-ai-input]');
    micBtn = document.querySelector('[data-ai-mic]');
    chipsContainer = document.querySelector('[data-ai-chips]');
    stickyBar = document.querySelector('[data-ai-sticky]');
    stickyInput = document.querySelector('[data-ai-sticky-input]');
    stickyMic = document.querySelector('[data-ai-sticky-mic]');
    previewPane = document.getElementById('murmurgo-preview-pane');
    previewBody = document.querySelector('[data-preview-body]');
    previewClose = document.querySelector('[data-preview-close]');
    shortlistBar = document.getElementById('murmurgo-shortlist-bar');
    shortlistDrawer = document.getElementById('murmurgo-shortlist-drawer');
    shortlistList = document.querySelector('[data-shortlist-list]');
    shortlistClose = document.querySelector('[data-shortlist-close]');

    // Phase 5
    dayAssignmentView = document.getElementById('murmurgo-day-assignment');
    assignmentMain = document.querySelector('[data-assignment-main]');
    assignmentSidebar = document.querySelector('[data-assignment-sidebar]');
    assignmentShortlist = document.querySelector('[data-assignment-shortlist]');
    tripMapPanel = document.getElementById('murmurgo-trip-map-panel');
    saveModal = document.getElementById('murmurgo-save-modal');
    undoToast = document.getElementById('murmurgo-undo-toast');
    confirmDialog = document.getElementById('murmurgo-confirm-dialog');
    activitySearchModal = document.getElementById('murmurgo-activity-search');
  }

  // ─── Persistence ───────────────────────────────────────────────────

  const STORAGE_KEY = 'murmurgo_itinerary_v1';

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        shortlist: state.shortlist,
        itinerary: state.itinerary,
        entityCache: state.entityCache,
      }));
    } catch (e) { /* ignore */ }
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.shortlist) state.shortlist = data.shortlist;
      if (data.itinerary) state.itinerary = { ...state.itinerary, ...data.itinerary };
      if (data.entityCache) state.entityCache = data.entityCache;
    } catch (e) { /* ignore */ }
  }

  // ─── API ───────────────────────────────────────────────────────────

  async function sendMessage(message) {
    if (!message || !message.trim()) return;
    const text = message.trim();

    addMessage({ type: 'user', text });
    state.isLoading = true;
    render();

    try {
      const res = await fetch(`${API_BASE}/conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: state.sessionId,
          context: { shortlist: state.shortlist.map(s => s.id || s) },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      state.messages.push(data);
    } catch (err) {
      console.error('Conversation error:', err);
      state.messages.push({
        type: 'text',
        text: 'Connection issue. Please try again.',
      });
    } finally {
      state.isLoading = false;
      render();
    }
  }

  async function fetchPlace(id) {
    try {
      const res = await fetch(`${API_BASE}/places/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('Failed to fetch place:', err);
      return null;
    }
  }

  async function cachePlace(id) {
    if (state.entityCache[id]) return state.entityCache[id];
    const data = await fetchPlace(id);
    if (data && data.place) {
      state.entityCache[id] = data.place;
      return data.place;
    }
    return null;
  }

  async function saveItineraryToAPI() {
    if (!state.itinerary.id) {
      // Create new
      try {
        const body = {
          name: state.itinerary.name,
          shortlist: state.shortlist.map(s => ({
            handle: s.id || s,
            nights: s.nights || 2,
            location: s.location || '',
          })),
          startDate: state.itinerary.startDate,
          travelers: state.itinerary.travelers,
        };
        const res = await fetch(`${API_BASE}/itinerary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.itinerary) {
          state.itinerary.id = data.itinerary.id;
          state.itinerary.days = data.itinerary.days || state.itinerary.days;
        }
      } catch (err) {
        console.error('Save itinerary error:', err);
      }
    } else {
      // Update existing
      try {
        await fetch(`${API_BASE}/itinerary/${state.itinerary.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            days: state.itinerary.days,
            shortlist: state.shortlist,
            name: state.itinerary.name,
            startDate: state.itinerary.startDate,
            travelers: state.itinerary.travelers,
          }),
        });
      } catch (err) {
        console.error('Update itinerary error:', err);
      }
    }
    saveToStorage();
  }

  async function fetchSuggestions(day, type, lat, lng) {
    if (!state.itinerary.id) return [];
    try {
      const res = await fetch(`${API_BASE}/itinerary/${state.itinerary.id}/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, type, lat, lng }),
      });
      const data = await res.json();
      return data.suggestions || [];
    } catch (err) {
      console.error('Fetch suggestions error:', err);
      return [];
    }
  }

  // ─── Messages ──────────────────────────────────────────────────────

  function addMessage(msg) {
    state.messages.push({ ...msg, id: generateId(), ts: Date.now() });
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  function render() {
    if (!root) return;

    if (state.mode === 'chat') {
      renderChat();
    } else if (state.mode === 'day-assignment') {
      renderDayAssignment();
    } else if (state.mode === 'timeline') {
      renderTimeline();
    }

    updateShortlistBar();
    initEmbeddedMaps();
    renderTripMap();
  }

  function renderChat() {
    let html = '';
    state.messages.forEach((msg) => {
      html += renderMessage(msg);
    });
    if (state.isLoading) {
      html += `
        <div class="m-message m-message--loading">
          <div class="m-message__bubble">
            <span class="m-loading-dots"><span></span><span></span><span></span></span>
          </div>
        </div>
      `;
    }
    root.innerHTML = html;
    root.scrollTop = root.scrollHeight;
  }

  function renderMessage(msg) {
    if (msg.type === 'user') {
      return `<div class="m-message m-message--user"><div class="m-message__bubble">${escapeHtml(msg.text)}</div></div>`;
    }
    switch (msg.type) {
      case 'text': return renderTextMessage(msg);
      case 'entities': return renderEntitiesMessage(msg);
      case 'comparison': return renderComparisonMessage(msg);
      case 'itinerary': return renderItineraryMessage(msg);
      case 'map': return renderMapMessage(msg);
      case 'refine': return renderRefineMessage(msg);
      default: return renderTextMessage(msg);
    }
  }

  function renderTextMessage(msg) {
    let actions = '';
    if (msg.actions && msg.actions.length) {
      actions = `<div class="m-message__actions">
        ${msg.actions.map(a => `<button class="m-btn--action" data-action="${escapeHtml(a.value)}">${escapeHtml(a.label)}</button>`).join('')}
      </div>`;
    }
    return `<div class="m-message m-message--agent">
      <div class="m-message__bubble">${escapeHtml(msg.text)}</div>
      ${actions}
    </div>`;
  }

  function renderEntitiesMessage(msg) {
    const entities = msg.entities || [];
    if (!entities.length) return renderTextMessage(msg);
    const cards = entities.map(renderEntityCard).join('');
    const mapHtml = msg.map ? `<div class="m-embed-map" data-embed-map="${msg.id}"></div>` : '';
    return `<div class="m-message m-message--agent">
      <div class="m-message__bubble">${escapeHtml(msg.text)}</div>
      <div class="m-entity-grid">${cards}</div>
      ${mapHtml}
    </div>`;
  }

  function renderComparisonMessage(msg) {
    const pair = msg.comparison || (msg.entities || []).slice(0, 2);
    if (pair.length < 2) return renderEntitiesMessage(msg);
    const cards = pair.map((e, i) => `
      <div class="m-comparison__col">
        ${renderEntityCard(e, true)}
        <button class="m-btn--primary" data-add="${escapeHtml(e.id)}">Add ${escapeHtml(e.name)}</button>
      </div>
    `).join('');
    return `<div class="m-message m-message--agent">
      <div class="m-message__bubble">${escapeHtml(msg.text)}</div>
      <div class="m-comparison">${cards}</div>
    </div>`;
  }

  function renderItineraryMessage(msg) {
    const days = msg.itinerary || [];
    if (!days.length) return renderEntitiesMessage(msg);
    const timeline = days.map((day) => {
      const places = (day.places || []).map(renderEntityCard).join('');
      return `
        <div class="m-itinerary__day">
          <div class="m-itinerary__day-header">
            <span class="m-itinerary__day-num">Day ${day.day}</span>
            <span class="m-itinerary__day-note">${escapeHtml(day.notes || '')}</span>
          </div>
          <div class="m-itinerary__day-places">${places}</div>
        </div>
      `;
    }).join('');
    return `<div class="m-message m-message--agent">
      <div class="m-message__bubble">${escapeHtml(msg.text)}</div>
      <div class="m-itinerary">${timeline}</div>
      <button class="m-btn--secondary" data-adjust-days>Adjust days</button>
    </div>`;
  }

  function renderMapMessage(msg) {
    const mapData = msg.map || {};
    return `<div class="m-message m-message--agent">
      <div class="m-message__bubble">${escapeHtml(msg.text)}</div>
      <div class="m-embed-map" data-embed-map="${msg.id}" data-center="${JSON.stringify(mapData.center)}" data-pins='${JSON.stringify(mapData.pins || [])}'></div>
    </div>`;
  }

  function renderRefineMessage(msg) {
    const actions = (msg.actions || []).map(a =>
      `<button class="m-btn--action" data-action="${escapeHtml(a.value)}">${escapeHtml(a.label)}</button>`
    ).join('');
    return `<div class="m-message m-message--agent">
      <div class="m-message__bubble">${escapeHtml(msg.text)}</div>
      <div class="m-message__actions">${actions}</div>
    </div>`;
  }

  function renderEntityCard(entity, isComparison = false) {
    const photo = entity.hero_photo || (entity.photos && entity.photos[0] ? (entity.photos[0].master || entity.photos[0].source || entity.photos[0]) : '');
    const photoUrl = photo ? MG.imageUrl(photo, 400) : '';
    const srcset = photo ? MG.imageSrcset(photo, [200, 400]) : '';
    const rating = entity.rating != null ? `${entity.rating}★` : (entity.google_rating != null ? `${entity.google_rating}★` : '');
    const reviews = entity.google_review_count ? `from ${entity.google_review_count.toLocaleString()} Google reviews` : '';
    const location = [entity.city, entity.country].filter(Boolean).join(', ');
    const price = entity.price_level ? priceLabel(entity.price_level) : '';
    const typeLabel = entity.primary_type_display || entity.type || '';
    const id = entity.id || entity.handle;

    return `
      <article class="m-entity-card" data-id="${escapeHtml(id)}">
        <div class="m-entity-card__media">
          <img
            src="${escapeHtml(photoUrl)}"
            srcset="${escapeHtml(srcset)}"
            sizes="(max-width: 768px) 100vw, 280px"
            width="400"
            height="300"
            loading="lazy"
            alt="${escapeHtml(entity.name)}"
            onerror="this.style.display='none'"
          >
        </div>
        <div class="m-entity-card__body">
          <h3 class="m-entity-card__name">${escapeHtml(entity.name)}</h3>
          <p class="m-entity-card__location">${escapeHtml(location)}</p>
          <div class="m-entity-card__meta">
            ${rating ? `<span class="m-entity-card__rating">${rating} ${reviews}</span>` : ''}
            ${price ? `<span class="m-entity-card__price">${price}</span>` : ''}
            ${typeLabel ? `<span class="m-entity-card__type">${escapeHtml(typeLabel)}</span>` : ''}
          </div>
          <div class="m-entity-card__actions">
            <button class="m-btn--preview" data-preview="${escapeHtml(id)}">View</button>
            <button class="m-btn--add" data-add="${escapeHtml(id)}">Add to trip</button>
          </div>
        </div>
      </article>
    `;
  }

  // ─── Preview Pane ──────────────────────────────────────────────────

  async function openPreview(id) {
    if (!previewPane || !previewBody) return;
    state.previewEntity = id;

    previewBody.innerHTML = '<div class="m-preview-pane__loading">Loading…</div>';
    previewPane.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    const data = await fetchPlace(id);
    if (!data || !data.place) {
      previewBody.innerHTML = '<p class="m-preview-pane__error">Could not load details.</p>';
      return;
    }

    const p = data.place;
    const photos = (p.photos || []).slice(0, 5);
    const gallery = photos.length
      ? `<div class="m-preview-pane__gallery">
          ${photos.map(ph => {
            const src = ph.master || ph.source || ph;
            const url = src ? MG.imageUrl(src, 600) : '';
            const srcset = src ? MG.imageSrcset(src, [300, 600]) : '';
            return `<img src="${escapeHtml(url)}" srcset="${escapeHtml(srcset)}" sizes="(max-width: 768px) 100vw, 50vw" width="600" height="400" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.display='none'">`;
          }).join('')}
        </div>`
      : '';

    const location = [p.city, p.region, p.country].filter(Boolean).join(', ');
    const rating = p.google_rating != null ? `${p.google_rating}★ from ${(p.google_review_count || 0).toLocaleString()} Google reviews` : '';
    const mapHtml = p.latitude != null && p.longitude != null
      ? `<div class="m-preview-pane__map" id="preview-map-${id}"></div>`
      : '';

    const amenities = (p.amenities || []).slice(0, 8).map(a => `<span class="m-preview-pane__amenity">${escapeHtml(a)}</span>`).join('');

    previewBody.innerHTML = `
      ${gallery}
      <div class="m-preview-pane__info">
        <h2 class="m-preview-pane__title">${escapeHtml(p.name)}</h2>
        <p class="m-preview-pane__location">${escapeHtml(location)}</p>
        ${rating ? `<p class="m-preview-pane__rating">${rating}</p>` : ''}
        ${p.description ? `<div class="m-preview-pane__desc">${p.description}</div>` : ''}
        ${amenities ? `<div class="m-preview-pane__amenities">${amenities}</div>` : ''}
        ${mapHtml}
        <div class="m-preview-pane__cta">
          <button class="m-btn--primary" data-add="${escapeHtml(id)}">Add to trip</button>
          <a class="m-btn--secondary" href="${escapeHtml((window.Murmurgo && window.Murmurgo.router ? window.Murmurgo.router.property(p.slug || p.id) : '/pages/' + (p.slug || p.id)))}">View full page</a>
        </div>
      </div>
    `;

    if (mapHtml && window.maplibregl) {
      setTimeout(() => {
        const mapEl = document.getElementById(`preview-map-${id}`);
        if (!mapEl) return;
        const map = new window.maplibregl.Map({
          container: mapEl,
          style: config.maplibreStyle || 'https://demotiles.maplibre.org/style.json',
          center: [p.longitude, p.latitude],
          zoom: 12,
          attributionControl: false,
        });
        map.addControl(new window.maplibregl.AttributionControl({ compact: true }));
        new window.maplibregl.Marker()
          .setLngLat([p.longitude, p.latitude])
          .addTo(map);
      }, 100);
    }
  }

  function closePreview() {
    if (!previewPane) return;
    previewPane.classList.remove('is-open');
    document.body.style.overflow = '';
    state.previewEntity = null;
  }


  // ─── Enhanced Shortlist ────────────────────────────────────────────

  function addToShortlist(id) {
    const existing = state.shortlist.find(s => (s.id || s) === id);
    if (existing) return;

    // Try to get cached entity data
    const entity = state.entityCache[id];
    const item = {
      id,
      nights: 2,
      location: entity ? [entity.city, entity.country].filter(Boolean).join(', ') : '',
      type: entity ? (entity.primary_type_display || entity.type) : 'property',
    };

    state.shortlist.push(item);
    // Fetch full data asynchronously to enrich the card
    cachePlace(id).then(() => {
      renderShortlistDrawer();
      updateShortlistBar();
    });

    updateShortlistBar();
    renderShortlistDrawer();
    saveToStorage();
  }

  function removeFromShortlist(id) {
    const idx = state.shortlist.findIndex(s => (s.id || s) === id);
    if (idx === -1) return;

    const removed = state.shortlist[idx];
    state.shortlist.splice(idx, 1);

    // Show undo toast
    showUndoToast(`Removed ${state.entityCache[id]?.name || 'place'}`, () => {
      state.shortlist.splice(idx, 0, removed);
      updateShortlistBar();
      renderShortlistDrawer();
      if (state.mode !== 'chat') render();
      saveToStorage();
    });

    updateShortlistBar();
    renderShortlistDrawer();
    if (state.mode !== 'chat') render();
    saveToStorage();
  }

  function setNights(id, nights) {
    const item = state.shortlist.find(s => (s.id || s) === id);
    if (item) {
      item.nights = Math.max(1, Math.min(14, nights));
      updateShortlistBar();
      renderShortlistDrawer();
      saveToStorage();
    }
  }

  function moveShortlistItem(fromIndex, toIndex) {
    const item = state.shortlist.splice(fromIndex, 1)[0];
    state.shortlist.splice(toIndex, 0, item);
    renderShortlistDrawer();
    saveToStorage();
  }

  function clearAllShortlist() {
    showConfirmDialog(
      `Remove all ${state.shortlist.length} places?`,
      'Remove',
      () => {
        state.shortlist = [];
        updateShortlistBar();
        renderShortlistDrawer();
        if (state.mode !== 'chat') render();
        saveToStorage();
      }
    );
  }

  function updateShortlistBar() {
    if (!shortlistBar) return;
    const count = state.shortlist.length;
    const totalNights = state.shortlist.reduce((sum, s) => sum + (s.nights || 2), 0);
    const countEl = shortlistBar.querySelector('[data-shortlist-count]');
    const nightsEl = shortlistBar.querySelector('[data-shortlist-nights]');
    if (countEl) countEl.textContent = `${count} place${count !== 1 ? 's' : ''}`;
    if (nightsEl) nightsEl.textContent = count > 0 ? ` · ${totalNights} nights` : '';
    shortlistBar.classList.toggle('is-visible', count > 0);
  }

  function renderShortlistDrawer() {
    if (!shortlistList) return;
    if (state.shortlist.length === 0) {
      shortlistList.innerHTML = '<p class="m-shortlist-drawer__empty">No places yet. Tap "Add to trip" on any card.</p>';
      return;
    }

    shortlistList.innerHTML = state.shortlist.map((item, index) => {
      const id = item.id || item;
      const entity = state.entityCache[id];
      const photo = entity?.hero_photo || (entity?.photos?.[0] ? (entity.photos[0].master || entity.photos[0].source || entity.photos[0]) : '');
      const name = entity?.name || `Place #${id}`;
      const location = item.location || (entity ? [entity.city, entity.country].filter(Boolean).join(', ') : '');
      const isProperty = (item.type || entity?.primary_type_display || entity?.type || 'property').toLowerCase().includes('property') ||
                         (item.type || entity?.primary_type_display || entity?.type || 'property').toLowerCase().includes('hotel') ||
                         (item.type || entity?.primary_type_display || entity?.type || 'property').toLowerCase().includes('lodge');

      const nightPills = isProperty
        ? `<div class="m-shortlist-drawer__nights">
            <span class="m-shortlist-drawer__nights-label">Nights:</span>
            ${Array.from({ length: 14 }, (_, i) => {
              const n = i + 1;
              const selected = (item.nights || 2) === n ? 'is-selected' : '';
              return `<button class="m-shortlist-drawer__night-pill ${selected}" data-night-id="${escapeHtml(id)}" data-night-value="${n}">${n}</button>`;
            }).join('')}
          </div>`
        : '';

      const photoUrl = photo ? MG.imageUrl(photo, 200) : '';
      const photoSrcset = photo ? MG.imageSrcset(photo, [100, 200]) : '';

      return `
        <div class="m-shortlist-drawer__card" data-id="${escapeHtml(id)}" data-shortlist-index="${index}" draggable="true">
          <div class="m-shortlist-drawer__drag" data-drag-handle aria-label="Drag to reorder">≡</div>
          <div class="m-shortlist-drawer__media">
            <img
              src="${escapeHtml(photoUrl)}"
              srcset="${escapeHtml(photoSrcset)}"
              sizes="80px"
              width="200"
              height="150"
              loading="lazy"
              alt="${escapeHtml(name)}"
              onerror="this.style.display='none'"
            >
          </div>
          <div class="m-shortlist-drawer__info">
            <h4 class="m-shortlist-drawer__name">${escapeHtml(name)}</h4>
            <p class="m-shortlist-drawer__location">${escapeHtml(location)}</p>
            ${nightPills}
          </div>
          <button class="m-shortlist-drawer__remove" data-remove="${escapeHtml(id)}" aria-label="Remove">×</button>
        </div>
      `;
    }).join('') + `
      <div class="m-shortlist-drawer__clear">
        <button class="m-shortlist-drawer__clear-btn" data-clear-all>Clear all</button>
      </div>
    `;

    attachShortlistDragHandlers();
  }

  function attachShortlistDragHandlers() {
    if (!shortlistList) return;
    shortlistList.querySelectorAll('[data-shortlist-index]').forEach(el => {
      el.addEventListener('dragstart', onShortlistDragStart);
      el.addEventListener('dragover', onShortlistDragOver);
      el.addEventListener('drop', onShortlistDrop);
      el.addEventListener('dragend', onShortlistDragEnd);
    });
  }

  function onShortlistDragStart(e) {
    const card = e.currentTarget;
    state.dragItem = parseInt(card.dataset.shortlistIndex, 10);
    state.dragSource = 'shortlist';
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
  }

  function onShortlistDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.currentTarget.closest('[data-shortlist-index]');
    if (!card) return;
    card.classList.add('is-drop-target');
  }

  function onShortlistDrop(e) {
    e.preventDefault();
    const card = e.currentTarget.closest('[data-shortlist-index]');
    if (!card || state.dragSource !== 'shortlist') return;
    const toIndex = parseInt(card.dataset.shortlistIndex, 10);
    if (state.dragItem !== null && state.dragItem !== toIndex) {
      moveShortlistItem(state.dragItem, toIndex);
    }
  }

  function onShortlistDragEnd(e) {
    e.currentTarget.classList.remove('is-dragging');
    shortlistList.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    state.dragItem = null;
    state.dragSource = null;
  }

  function openShortlistDrawer() {
    if (shortlistDrawer) shortlistDrawer.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    renderShortlistDrawer();
  }

  function closeShortlistDrawer() {
    if (shortlistDrawer) shortlistDrawer.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  // ─── Day Assignment Mode ───────────────────────────────────────────

  function enterDayAssignmentMode() {
    state.mode = 'day-assignment';
    state.activeTab = 'grid';
    closeShortlistDrawer();

    // Build days from shortlist if empty
    if (!state.itinerary.days || state.itinerary.days.length === 0) {
      buildDaysFromShortlist();
    }

    if (root) root.style.display = 'none';
    if (hero) hero.style.display = 'none';
    if (stickyBar) stickyBar.style.display = 'none';
    if (shortlistBar) shortlistBar.style.display = 'none';
    if (dayAssignmentView) dayAssignmentView.style.display = '';

    renderDayAssignment();
    generateAISuggestions();
  }

  function exitDayAssignmentMode() {
    state.mode = 'chat';
    if (root) root.style.display = '';
    if (hero) hero.style.display = '';
    if (stickyBar) stickyBar.style.display = '';
    if (shortlistBar) shortlistBar.style.display = '';
    if (dayAssignmentView) dayAssignmentView.style.display = 'none';
    if (tripMapPanel) tripMapPanel.style.display = 'none';
    render();
  }

  function buildDaysFromShortlist() {
    const days = [];
    let dayNumber = 1;

    for (const item of state.shortlist) {
      const id = item.id || item;
      const entity = state.entityCache[id];
      const nights = item.nights || 2;
      const location = item.location || (entity ? [entity.city, entity.country].filter(Boolean).join(', ') : '');

      for (let n = 0; n < nights; n++) {
        days.push({
          dayNumber: dayNumber + n,
          date: '',
          location: n === 0 ? location : days[days.length - 1]?.location || location,
          accommodation: id,
          activities: [],
        });
      }
      dayNumber += nights;
    }

    state.itinerary.days = days;
    state.itinerary.totalNights = days.length;
  }

  function renderDayAssignment() {
    if (!dayAssignmentView) return;

    // Update tabs
    dayAssignmentView.querySelectorAll('[data-tab]').forEach(tab => {
      tab.classList.toggle('is-active', tab.dataset.tab === state.activeTab);
    });

    if (state.activeTab === 'grid') {
      renderDayGrid();
      if (assignmentSidebar) assignmentSidebar.style.display = '';
    } else if (state.activeTab === 'timeline') {
      renderTimelineView();
      if (assignmentSidebar) assignmentSidebar.style.display = '';
    } else if (state.activeTab === 'map') {
      renderMapView();
      if (assignmentSidebar) assignmentSidebar.style.display = 'none';
    }

    renderAssignmentShortlist();
  }

  function renderDayGrid() {
    if (!assignmentMain) return;
    const days = state.itinerary.days || [];

    const gridHtml = days.map((day) => {
      const entity = state.entityCache[day.accommodation];
      const location = day.location || (entity ? [entity.city, entity.country].filter(Boolean).join(', ') : '');
      const isDropTarget = day.dayNumber === state.dragItem ? 'is-drop-target' : '';

      const activitiesHtml = (day.activities || []).map(act => {
        const actEntity = state.entityCache[act.handle];
        return `<div class="m-day-grid__activity" data-activity-handle="${escapeHtml(act.handle)}">
          <span class="m-day-grid__activity-time">${escapeHtml(act.time)}</span>
          <span class="m-day-grid__activity-name">${escapeHtml(actEntity?.name || act.handle)}</span>
          <button class="m-day-grid__activity-remove" data-remove-activity="${escapeHtml(act.handle)}" data-day="${day.dayNumber}">×</button>
        </div>`;
      }).join('');

      return `
        <div class="m-day-grid__block ${isDropTarget}" data-day="${day.dayNumber}" data-drop-day>
          <div class="m-day-grid__header">
            <span class="m-day-grid__num">Day ${day.dayNumber}</span>
            <span class="m-day-grid__location">${escapeHtml(location || 'Drop stay here')}</span>
          </div>
          <div class="m-day-grid__stay">
            ${entity ? (() => {
              const src = entity.hero_photo || '';
              const url = src ? MG.imageUrl(src, 300) : '';
              const srcset = src ? MG.imageSrcset(src, [150, 300]) : '';
              return `<div class="m-day-grid__stay-card">
                <img src="${escapeHtml(url)}" srcset="${escapeHtml(srcset)}" sizes="120px" width="300" height="225" alt="${escapeHtml(entity.name)}" loading="lazy" onerror="this.style.display='none'">
                <span>${escapeHtml(entity.name)}</span>
              </div>`;
            })() : '<div class="m-day-grid__placeholder">Drop stay here</div>'}
          </div>
          <div class="m-day-grid__activities">${activitiesHtml}</div>
        </div>
      `;
    }).join('');

    assignmentMain.innerHTML = `
      <div class="m-day-grid">
        ${gridHtml}
        <div class="m-day-grid__add">
          <button class="m-day-grid__add-btn" data-add-day>+ Add day</button>
        </div>
      </div>
    `;

    attachDayDropHandlers();
  }

  function renderTimelineView() {
    if (!assignmentMain) return;
    const days = state.itinerary.days || [];

    const timelineHtml = days.map((day) => {
      const entity = state.entityCache[day.accommodation];
      const location = day.location || (entity ? [entity.city, entity.country].filter(Boolean).join(', ') : '');
      const timeSlots = ['morning', 'lunch', 'afternoon', 'evening', 'night'];

      const slotsHtml = timeSlots.map(slot => {
        const slotActivities = (day.activities || []).filter(a => a.time === slot);
        const itemsHtml = slotActivities.map(act => {
          const actEntity = state.entityCache[act.handle];
          return `<div class="m-timeline__slot-item" draggable="true" data-activity-handle="${escapeHtml(act.handle)}" data-day="${day.dayNumber}" data-time="${slot}">
            <span>${escapeHtml(actEntity?.name || act.handle)}</span>
            <button data-remove-activity="${escapeHtml(act.handle)}" data-day="${day.dayNumber}">×</button>
          </div>`;
        }).join('');

        const slotLabel = slot.charAt(0).toUpperCase() + slot.slice(1);

        return `
          <div class="m-timeline__slot" data-slot="${slot}" data-day="${day.dayNumber}">
            <div class="m-timeline__slot-header">
              <span class="m-timeline__slot-label">${slotLabel}</span>
              <button class="m-timeline__slot-add" data-add-activity="${day.dayNumber}" data-time-slot="${slot}" title="Add ${slotLabel.toLowerCase()}">+</button>
            </div>
            <div class="m-timeline__slot-items">${itemsHtml}</div>
          </div>
        `;
      }).join('');

      // Check for AI suggestions after this day
      const suggestions = state.aiSuggestions.filter(s => s.day === day.dayNumber);
      const suggestionsHtml = suggestions.map(s => {
        const sEntity = state.entityCache[s.entity];
        return `
          <div class="m-suggestion" data-suggestion-id="${s.id || generateId()}">
            <p class="m-suggestion__message">${escapeHtml(s.message)}</p>
            ${sEntity ? (() => {
              const src = sEntity.hero_photo || '';
              const url = src ? MG.imageUrl(src, 300) : '';
              const srcset = src ? MG.imageSrcset(src, [150, 300]) : '';
              return `<div class="m-suggestion__card">
                <img src="${escapeHtml(url)}" srcset="${escapeHtml(srcset)}" sizes="120px" width="300" height="225" alt="${escapeHtml(sEntity.name)}" loading="lazy" onerror="this.style.display='none'">
                <span>${escapeHtml(sEntity.name)}</span>
              </div>`;
            })() : ''}
            <div class="m-suggestion__actions">
              <button class="m-suggestion__add" data-add-suggestion="${escapeHtml(s.entity)}" data-suggestion-day="${day.dayNumber}">Add</button>
              <button class="m-suggestion__dismiss" data-dismiss-suggestion="${escapeHtml(s.id || '')}">Dismiss</button>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="m-timeline__day" data-day="${day.dayNumber}">
          <button class="m-timeline__day-header" data-toggle-day="${day.dayNumber}">
            <span class="m-timeline__day-num">Day ${day.dayNumber}</span>
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
          ${suggestionsHtml}
        </div>
      `;
    }).join('');

    assignmentMain.innerHTML = `<div class="m-timeline">${timelineHtml}</div>`;
    attachTimelineHandlers();
  }

  function renderMapView() {
    if (!assignmentMain) return;
    assignmentMain.innerHTML = `
      <div class="m-trip-map-wrapper">
        <div id="murmurgo-trip-map-embedded" class="m-trip-map-embedded"></div>
      </div>
    `;
    setTimeout(() => renderTripMap('murmurgo-trip-map-embedded'), 50);
  }

  function renderAssignmentShortlist() {
    if (!assignmentShortlist) return;
    if (state.shortlist.length === 0) {
      assignmentShortlist.innerHTML = '<p class="m-day-assignment__sidebar-empty">No places in shortlist</p>';
      return;
    }

    assignmentShortlist.innerHTML = state.shortlist.map((item) => {
      const id = item.id || item;
      const entity = state.entityCache[id];
      const isAssigned = isEntityAssigned(id);
      const statusDot = isAssigned
        ? '<span class="m-status-dot m-status-dot--assigned" title="Assigned">✓</span>'
        : '<span class="m-status-dot m-status-dot--unassigned" title="Unassigned">●</span>';

      return `
        <div class="m-assignment-shortlist__item" draggable="true" data-assignment-id="${escapeHtml(id)}">
          ${statusDot}
          <span class="m-assignment-shortlist__name">${escapeHtml(entity?.name || `Place #${id}`)}</span>
          <span class="m-assignment-shortlist__nights">${item.nights || 2}n</span>
        </div>
      `;
    }).join('');

    assignmentShortlist.querySelectorAll('[data-assignment-id]').forEach(el => {
      el.addEventListener('dragstart', onAssignmentDragStart);
      el.addEventListener('touchstart', onAssignmentTouchStart, { passive: false });
    });
  }

  function isEntityAssigned(id) {
    return (state.itinerary.days || []).some(d =>
      d.accommodation === id || (d.activities || []).some(a => a.handle === id)
    );
  }

  function attachDayDropHandlers() {
    if (!assignmentMain) return;
    assignmentMain.querySelectorAll('[data-drop-day]').forEach(el => {
      el.addEventListener('dragover', onDayDragOver);
      el.addEventListener('drop', onDayDrop);
      el.addEventListener('dragleave', onDayDragLeave);
    });
  }

  function onAssignmentDragStart(e) {
    const id = e.currentTarget.dataset.assignmentId;
    state.dragItem = id;
    state.dragSource = 'assignment-shortlist';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }

  function onDayDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('is-drop-target');
  }

  function onDayDragLeave(e) {
    e.currentTarget.classList.remove('is-drop-target');
  }

  function onDayDrop(e) {
    e.preventDefault();
    const block = e.currentTarget.closest('[data-drop-day]');
    if (!block) return;
    block.classList.remove('is-drop-target');

    const dayNumber = parseInt(block.dataset.day, 10);
    const id = e.dataTransfer.getData('text/plain');

    if (state.dragSource === 'assignment-shortlist') {
      assignEntityToDay(id, dayNumber);
    }
  }

  function assignEntityToDay(id, startDayNumber) {
    const item = state.shortlist.find(s => (s.id || s) === id);
    if (!item) return;

    const nights = item.nights || 2;
    const entity = state.entityCache[id];
    const location = item.location || (entity ? [entity.city, entity.country].filter(Boolean).join(', ') : '');

    // Ensure enough days exist
    while (state.itinerary.days.length < startDayNumber + nights - 1) {
      addDay();
    }

    for (let i = 0; i < nights; i++) {
      const dayIdx = startDayNumber - 1 + i;
      if (state.itinerary.days[dayIdx]) {
        state.itinerary.days[dayIdx].accommodation = id;
        state.itinerary.days[dayIdx].location = location;
      }
    }

    renderDayAssignment();
    saveToStorage();
  }

  function addDay() {
    const nextNum = (state.itinerary.days.length || 0) + 1;
    state.itinerary.days.push({
      dayNumber: nextNum,
      date: '',
      location: '',
      accommodation: null,
      activities: [],
    });
    state.itinerary.totalNights = state.itinerary.days.length;
  }

  function removeEmptyDays() {
    while (state.itinerary.days.length > 1) {
      const last = state.itinerary.days[state.itinerary.days.length - 1];
      if (!last.accommodation && (!last.activities || last.activities.length === 0)) {
        state.itinerary.days.pop();
      } else {
        break;
      }
    }
    // Renumber
    state.itinerary.days.forEach((d, i) => { d.dayNumber = i + 1; });
    state.itinerary.totalNights = state.itinerary.days.length;
  }

  // ─── Timeline Interactions ─────────────────────────────────────────

  function attachTimelineHandlers() {
    if (!assignmentMain) return;

    assignmentMain.querySelectorAll('[data-toggle-day]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const day = e.currentTarget.dataset.toggleDay;
        const body = assignmentMain.querySelector(`.m-timeline__day[data-day="${day}"] .m-timeline__day-body`);
        if (body) body.classList.toggle('is-collapsed');
        e.currentTarget.classList.toggle('is-collapsed');
      });
    });

    assignmentMain.querySelectorAll('[data-add-activity]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const day = parseInt(e.currentTarget.dataset.addActivity, 10);
        const slot = e.currentTarget.dataset.timeSlot;
        openActivitySearch(day, slot);
      });
    });

    assignmentMain.querySelectorAll('[data-remove-activity]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const handle = e.currentTarget.dataset.removeActivity;
        const dayNum = parseInt(e.currentTarget.dataset.day, 10);
        removeActivity(dayNum, handle);
      });
    });

    // Drag activities within/across days
    assignmentMain.querySelectorAll('[data-activity-handle]').forEach(el => {
      el.addEventListener('dragstart', onActivityDragStart);
    });

    assignmentMain.querySelectorAll('[data-slot]').forEach(el => {
      el.addEventListener('dragover', onActivityDragOver);
      el.addEventListener('drop', onActivityDrop);
      el.addEventListener('dragleave', onActivityDragLeave);
    });
  }

  function onActivityDragStart(e) {
    const el = e.currentTarget;
    state.dragItem = {
      handle: el.dataset.activityHandle,
      fromDay: parseInt(el.dataset.day, 10),
      fromTime: el.dataset.time,
    };
    state.dragSource = 'activity';
    el.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
  }

  function onActivityDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('is-drop-target');
  }

  function onActivityDragLeave(e) {
    e.currentTarget.classList.remove('is-drop-target');
  }

  function onActivityDrop(e) {
    e.preventDefault();
    const slot = e.currentTarget.closest('[data-slot]');
    if (!slot || state.dragSource !== 'activity') return;
    slot.classList.remove('is-drop-target');

    const toDay = parseInt(slot.dataset.day, 10);
    const toTime = slot.dataset.slot;
    const { handle, fromDay, fromTime } = state.dragItem;

    if (fromDay === toDay && fromTime === toTime) return;

    // Remove from old position
    const fromDayObj = state.itinerary.days.find(d => d.dayNumber === fromDay);
    if (fromDayObj) {
      fromDayObj.activities = (fromDayObj.activities || []).filter(a => !(a.handle === handle && a.time === fromTime));
    }

    // Add to new position
    const toDayObj = state.itinerary.days.find(d => d.dayNumber === toDay);
    if (toDayObj) {
      toDayObj.activities = toDayObj.activities || [];
      toDayObj.activities.push({ time: toTime, handle, type: 'experience' });
    }

    renderDayAssignment();
    generateAISuggestions();
    saveToStorage();
  }

  function removeActivity(dayNum, handle) {
    const day = state.itinerary.days.find(d => d.dayNumber === dayNum);
    if (!day) return;
    day.activities = (day.activities || []).filter(a => a.handle !== handle);
    renderDayAssignment();
    generateAISuggestions();
    saveToStorage();
  }

  // ─── Activity Search ───────────────────────────────────────────────

  function openActivitySearch(day, timeSlot) {
    state.activitySearchContext = { day, timeSlot };
    if (!activitySearchModal) return;

    const title = activitySearchModal.querySelector('[data-activity-search-title]');
    if (title) title.textContent = `Add ${timeSlot} for Day ${day}`;

    const input = activitySearchModal.querySelector('[data-activity-search-input]');
    if (input) input.value = '';

    const results = activitySearchModal.querySelector('[data-activity-search-results]');
    if (results) results.innerHTML = '';

    activitySearchModal.classList.add('is-open');
    if (input) setTimeout(() => input.focus(), 100);
  }

  function closeActivitySearch() {
    if (activitySearchModal) activitySearchModal.classList.remove('is-open');
    state.activitySearchContext = null;
  }

  async function searchActivities(query) {
    const ctx = state.activitySearchContext;
    if (!ctx) return;

    const day = state.itinerary.days.find(d => d.dayNumber === ctx.day);
    let lat, lng;
    if (day && day.accommodation && state.entityCache[day.accommodation]) {
      const acc = state.entityCache[day.accommodation];
      lat = acc.latitude;
      lng = acc.longitude;
    }

    try {
      const params = new URLSearchParams();
      params.set('limit', '8');
      params.set('type', 'activity');
      if (query) params.set('q', query);
      if (lat) params.set('lat', String(lat));
      if (lng) params.set('lng', String(lng));

      const res = await fetch(`${API_BASE}/places?${params.toString()}`);
      const data = await res.json();
      renderActivitySearchResults(data.places || []);
    } catch (err) {
      console.error('Activity search error:', err);
    }
  }

  function renderActivitySearchResults(places) {
    const results = activitySearchModal?.querySelector('[data-activity-search-results]');
    if (!results) return;

    if (!places.length) {
      results.innerHTML = '<p class="m-activity-search__empty">No results found</p>';
      return;
    }

    results.innerHTML = places.map(p => {
      const src = p.hero_photo || '';
      const url = src ? MG.imageUrl(src, 200) : '';
      const srcset = src ? MG.imageSrcset(src, [100, 200]) : '';
      return `
      <div class="m-activity-search__result" data-select-activity="${escapeHtml(p.id || p.handle)}">
        <img src="${escapeHtml(url)}" srcset="${escapeHtml(srcset)}" sizes="80px" width="200" height="150" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.display='none'">
        <div class="m-activity-search__result-info">
          <h4>${escapeHtml(p.name)}</h4>
          <p>${escapeHtml([p.city, p.country].filter(Boolean).join(', '))}</p>
        </div>
        <button class="m-activity-search__result-add">Add</button>
      </div>
    `}).join('');
  }

  function addActivityToSlot(handle) {
    const ctx = state.activitySearchContext;
    if (!ctx) return;

    const day = state.itinerary.days.find(d => d.dayNumber === ctx.day);
    if (!day) return;

    day.activities = day.activities || [];
    // Avoid duplicates in same slot
    const exists = day.activities.some(a => a.handle === handle && a.time === ctx.timeSlot);
    if (!exists) {
      day.activities.push({ time: ctx.timeSlot, handle, type: 'experience' });
    }

    // Cache the entity
    cachePlace(handle).then(() => {
      renderDayAssignment();
      generateAISuggestions();
      saveToStorage();
    });

    closeActivitySearch();
  }


  // ─── AI Gap Suggestions ────────────────────────────────────────────

  async function generateAISuggestions() {
    const days = state.itinerary.days || [];
    if (days.length < 2) return;

    const suggestions = [];

    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const nextDay = days[i + 1];

      // Check for gaps between destinations
      if (nextDay && day.accommodation && nextDay.accommodation) {
        const curr = state.entityCache[day.accommodation];
        const next = state.entityCache[nextDay.accommodation];
        if (curr && next && curr.latitude && next.latitude) {
          const dist = haversine(curr.latitude, curr.longitude, next.latitude, next.longitude);
          const driveHours = dist / 80; // rough km/h estimate
          if (driveHours > 4) {
            const midLat = (curr.latitude + next.latitude) / 2;
            const midLng = (curr.longitude + next.longitude) / 2;
            const stopoverPlaces = await fetchSuggestions(day.dayNumber, 'stopover', midLat, midLng);
            if (stopoverPlaces.length > 0) {
              suggestions.push({
                id: `gap_${day.dayNumber}`,
                type: 'gap',
                day: day.dayNumber,
                message: `You're driving ${Math.round(driveHours)} hours from ${curr.city || curr.name} to ${next.city || next.name}. Add a lunch stop?`,
                entity: stopoverPlaces[0].id || stopoverPlaces[0].handle,
                lat: midLat,
                lng: midLng,
              });
              state.entityCache[stopoverPlaces[0].id || stopoverPlaces[0].handle] = stopoverPlaces[0];
            }
          }
        }
      }

      // Check for missing lunch
      const hasLunch = (day.activities || []).some(a => a.time === 'lunch');
      if (!hasLunch && day.accommodation) {
        const acc = state.entityCache[day.accommodation];
        if (acc && acc.latitude) {
          const lunchPlaces = await fetchSuggestions(day.dayNumber, 'lunch', acc.latitude, acc.longitude);
          if (lunchPlaces.length > 0) {
            suggestions.push({
              id: `lunch_${day.dayNumber}`,
              type: 'lunch',
              day: day.dayNumber,
              message: `Day ${day.dayNumber} has no lunch planned. Try ${lunchPlaces[0].name}?`,
              entity: lunchPlaces[0].id || lunchPlaces[0].handle,
            });
            state.entityCache[lunchPlaces[0].id || lunchPlaces[0].handle] = lunchPlaces[0];
          }
        }
      }

      // Check for missing afternoon activity on full days
      const hasAfternoon = (day.activities || []).some(a => a.time === 'afternoon');
      if (!hasAfternoon && day.accommodation) {
        const acc = state.entityCache[day.accommodation];
        if (acc && acc.latitude) {
          const activityPlaces = await fetchSuggestions(day.dayNumber, 'activity', acc.latitude, acc.longitude);
          if (activityPlaces.length > 0) {
            suggestions.push({
              id: `activity_${day.dayNumber}`,
              type: 'activity',
              day: day.dayNumber,
              message: `Day ${day.dayNumber} has no afternoon activity. Visit ${activityPlaces[0].name}?`,
              entity: activityPlaces[0].id || activityPlaces[0].handle,
            });
            state.entityCache[activityPlaces[0].id || activityPlaces[0].handle] = activityPlaces[0];
          }
        }
      }
    }

    // Last day has no accommodation
    const lastDay = days[days.length - 1];
    if (lastDay && !lastDay.accommodation) {
      suggestions.push({
        id: `acc_last`,
        type: 'accommodation',
        day: lastDay.dayNumber,
        message: `Your last day ends without accommodation. Stay at an airport hotel?`,
        entity: null,
      });
    }

    state.aiSuggestions = suggestions.slice(0, 6);
    if (state.activeTab === 'timeline') {
      renderDayAssignment();
    }
  }

  function dismissSuggestion(id) {
    state.aiSuggestions = state.aiSuggestions.filter(s => s.id !== id);
    renderDayAssignment();
  }

  function addSuggestionToItinerary(entityHandle, dayNumber) {
    const suggestion = state.aiSuggestions.find(s => s.entity === entityHandle && s.day === dayNumber);
    if (!suggestion) return;

    const day = state.itinerary.days.find(d => d.dayNumber === dayNumber);
    if (!day) return;

    day.activities = day.activities || [];
    let timeSlot = 'afternoon';
    if (suggestion.type === 'lunch') timeSlot = 'lunch';
    if (suggestion.type === 'stopover') timeSlot = 'lunch';
    if (suggestion.type === 'accommodation') {
      day.accommodation = entityHandle;
      renderDayAssignment();
      saveToStorage();
      return;
    }

    day.activities.push({ time: timeSlot, handle: entityHandle, type: 'experience' });
    state.aiSuggestions = state.aiSuggestions.filter(s => s.id !== suggestion.id);

    cachePlace(entityHandle).then(() => {
      renderDayAssignment();
      saveToStorage();
    });
  }

  // ─── Trip Map ──────────────────────────────────────────────────────

  let tripMapInstance = null;

  function renderTripMap(containerId) {
    if (!window.maplibregl) return;
    const container = containerId ? document.getElementById(containerId) : document.getElementById('murmurgo-trip-map');
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

    tripMapInstance = new window.maplibregl.Map({
      container,
      style: config.maplibreStyle || 'https://demotiles.maplibre.org/style.json',
      center,
      zoom: stays.length > 1 ? 5 : 10,
      attributionControl: false,
    });
    tripMapInstance.addControl(new window.maplibregl.AttributionControl({ compact: true }));
    tripMapInstance.addControl(new window.maplibregl.NavigationControl());

    // Route line
    if (stays.length > 1) {
      const coords = stays.map(s => [s.entity.longitude, s.entity.latitude]);
      tripMapInstance.on('load', () => {
        tripMapInstance.addSource('trip-route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: coords },
          },
        });
        tripMapInstance.addLayer({
          id: 'trip-route-line',
          type: 'line',
          source: 'trip-route',
          paint: { 'line-color': '#D4A373', 'line-width': 3, 'line-dasharray': [1, 0] },
        });

        // Travel segment labels
        for (let i = 0; i < stays.length - 1; i++) {
          const a = stays[i].entity;
          const b = stays[i + 1].entity;
          const dist = haversine(a.latitude, a.longitude, b.latitude, b.longitude);
          const hours = Math.round(dist / 80);
          const mid = [(a.longitude + b.longitude) / 2, (a.latitude + b.latitude) / 2];

          // Add a small marker or popup for travel time
          const el = document.createElement('div');
          el.className = 'm-trip-map__segment-label';
          el.textContent = hours > 1 ? `~${hours}h drive` : '';
          if (hours > 1) {
            new window.maplibregl.Marker({ element: el, anchor: 'center' })
              .setLngLat(mid)
              .addTo(tripMapInstance);
          }
        }
      });
    }

    // Stay markers with day numbers
    stays.forEach((stay) => {
      const el = document.createElement('div');
      el.className = 'm-trip-map__pin';
      el.textContent = String(stay.dayNumber);
      el.addEventListener('click', () => {
        scrollToDay(stay.dayNumber);
      });

      new window.maplibregl.Marker({ element: el })
        .setLngLat([stay.entity.longitude, stay.entity.latitude])
        .setPopup(new window.maplibregl.Popup({ offset: 8 }).setText(stay.entity.name))
        .addTo(tripMapInstance);
    });

    // Activity markers (smaller dots)
    days.forEach(day => {
      (day.activities || []).forEach(act => {
        const entity = state.entityCache[act.handle];
        if (!entity || entity.latitude == null) return;
        const el = document.createElement('div');
        el.className = 'm-trip-map__pin m-trip-map__pin--activity';
        new window.maplibregl.Marker({ element: el })
          .setLngLat([entity.longitude, entity.latitude])
          .setPopup(new window.maplibregl.Popup({ offset: 6 }).setText(entity.name))
          .addTo(tripMapInstance);
      });
    });
  }

  function zoomToFitRoute() {
    if (!tripMapInstance) return;
    const days = state.itinerary.days || [];
    const stays = days.filter(d => d.accommodation).map(d => state.entityCache[d.accommodation]).filter(Boolean);
    if (stays.length === 0) return;

    const lats = stays.map(s => s.latitude).filter(Boolean);
    const lngs = stays.map(s => s.longitude).filter(Boolean);
    if (lats.length === 0) return;

    tripMapInstance.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60 }
    );
  }

  function scrollToDay(dayNumber) {
    if (state.activeTab !== 'timeline') {
      state.activeTab = 'timeline';
      renderDayAssignment();
    }
    setTimeout(() => {
      const el = document.querySelector(`.m-timeline__day[data-day="${dayNumber}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  // ─── Save & Share ──────────────────────────────────────────────────

  function openSaveModal() {
    if (!saveModal) return;
    const nameInput = saveModal.querySelector('[data-trip-name]');
    const dateInput = saveModal.querySelector('[data-trip-start-date]');
    const adultsInput = saveModal.querySelector('[data-travelers-adults]');
    const childrenInput = saveModal.querySelector('[data-travelers-children]');
    const infantsInput = saveModal.querySelector('[data-travelers-infants]');
    const budgetEl = saveModal.querySelector('[data-trip-budget]');
    const shareSection = saveModal.querySelector('[data-share-section]');

    if (nameInput) nameInput.value = state.itinerary.name;
    if (dateInput) dateInput.value = state.itinerary.startDate || '';
    if (adultsInput) adultsInput.value = state.itinerary.travelers?.adults || 2;
    if (childrenInput) childrenInput.value = state.itinerary.travelers?.children || 0;
    if (infantsInput) infantsInput.value = state.itinerary.travelers?.infants || 0;

    // Calculate rough budget
    const totalNights = state.itinerary.totalNights || 0;
    const avgPrice = 3500; // placeholder ZAR per night
    const budget = totalNights * avgPrice;
    if (budgetEl) budgetEl.textContent = budget > 0 ? `~R${budget.toLocaleString()}` : '—';

    if (shareSection) shareSection.style.display = state.itinerary.id ? '' : 'none';
    if (state.itinerary.id) {
      const linkInput = saveModal.querySelector('[data-share-link]');
      if (linkInput) linkInput.value = `https://${config.shopDomain}/pages/trip?id=${state.itinerary.id}`;
    }

    saveModal.classList.add('is-open');
  }

  function closeSaveModal() {
    if (saveModal) saveModal.classList.remove('is-open');
  }

  async function submitSaveModal() {
    const nameInput = saveModal?.querySelector('[data-trip-name]');
    const dateInput = saveModal?.querySelector('[data-trip-start-date]');
    const adultsInput = saveModal?.querySelector('[data-travelers-adults]');
    const childrenInput = saveModal?.querySelector('[data-travelers-children]');
    const infantsInput = saveModal?.querySelector('[data-travelers-infants]');

    state.itinerary.name = nameInput?.value || 'Untitled Trip';
    state.itinerary.startDate = dateInput?.value || null;
    state.itinerary.travelers = {
      adults: parseInt(adultsInput?.value || '2', 10),
      children: parseInt(childrenInput?.value || '0', 10),
      infants: parseInt(infantsInput?.value || '0', 10),
    };

    await saveItineraryToAPI();

    // Redirect to trip viewer on Shopify domain
    if (state.itinerary.id) {
      const tripUrl = (window.Murmurgo && window.Murmurgo.router)
        ? window.Murmurgo.router.trip(state.itinerary.id)
        : '/pages/trip?id=' + encodeURIComponent(state.itinerary.id);
      window.location.href = tripUrl;
      return;
    }

    // Show share section (fallback if no redirect)
    const shareSection = saveModal?.querySelector('[data-share-section]');
    if (shareSection) shareSection.style.display = '';
    const linkInput = saveModal?.querySelector('[data-share-link]');
    if (linkInput && state.itinerary.id) {
      linkInput.value = `https://${config.shopDomain}/pages/trip?id=${state.itinerary.id}`;
    }

    saveToStorage();
  }

  function copyShareLink() {
    const linkInput = saveModal?.querySelector('[data-share-link]');
    if (!linkInput) return;
    linkInput.select();
    document.execCommand('copy');
    const btn = saveModal?.querySelector('[data-copy-link]');
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = original, 2000);
    }
  }

  // ─── Undo Toast ────────────────────────────────────────────────────

  let undoTimer = null;

  function showUndoToast(message, onUndo) {
    if (!undoToast) return;
    const msgEl = undoToast.querySelector('[data-undo-message]');
    const btn = undoToast.querySelector('[data-undo-action]');

    if (msgEl) msgEl.textContent = message;
    undoToast.classList.add('is-visible');

    if (btn) {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', () => {
        onUndo();
        hideUndoToast();
      });
    }

    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndoToast, 3000);
  }

  function hideUndoToast() {
    if (undoToast) undoToast.classList.remove('is-visible');
  }

  // ─── Confirm Dialog ────────────────────────────────────────────────

  function showConfirmDialog(message, confirmLabel, onConfirm) {
    if (!confirmDialog) {
      if (window.confirm(message)) onConfirm();
      return;
    }

    const msgEl = confirmDialog.querySelector('[data-confirm-message]');
    const confirmBtn = confirmDialog.querySelector('[data-confirm-confirm]');

    if (msgEl) msgEl.textContent = message;
    if (confirmBtn) confirmBtn.textContent = confirmLabel;

    confirmDialog.classList.add('is-open');

    const handler = (e) => {
      if (e.target.closest('[data-confirm-confirm]')) {
        onConfirm();
        closeConfirmDialog();
      } else if (e.target.closest('[data-confirm-cancel]') || e.target.closest('[data-confirm-overlay]')) {
        closeConfirmDialog();
      }
    };

    confirmDialog.onclick = handler;
  }

  function closeConfirmDialog() {
    if (confirmDialog) confirmDialog.classList.remove('is-open');
  }

  // ─── Touch Drag Fallback ───────────────────────────────────────────

  let touchDragEl = null;
  let touchDragClone = null;
  let touchDragData = null;

  function onAssignmentTouchStart(e) {
    const item = e.currentTarget;
    touchDragData = item.dataset.assignmentId;

    const touch = e.touches[0];
    touchDragClone = item.cloneNode(true);
    touchDragClone.style.position = 'fixed';
    touchDragClone.style.zIndex = '9999';
    touchDragClone.style.width = item.offsetWidth + 'px';
    touchDragClone.style.opacity = '0.9';
    touchDragClone.style.pointerEvents = 'none';
    document.body.appendChild(touchDragClone);

    moveTouchClone(touch);

    document.addEventListener('touchmove', onAssignmentTouchMove, { passive: false });
    document.addEventListener('touchend', onAssignmentTouchEnd);
  }

  function onAssignmentTouchMove(e) {
    e.preventDefault();
    if (!touchDragClone) return;
    moveTouchClone(e.touches[0]);

    // Highlight drop targets
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    document.querySelectorAll('.is-drop-target').forEach(d => d.classList.remove('is-drop-target'));
    const block = el?.closest('[data-drop-day]');
    if (block) block.classList.add('is-drop-target');
  }

  function onAssignmentTouchEnd(e) {
    document.removeEventListener('touchmove', onAssignmentTouchMove);
    document.removeEventListener('touchend', onAssignmentTouchEnd);

    if (touchDragClone) {
      touchDragClone.remove();
      touchDragClone = null;
    }

    const touch = e.changedTouches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const block = el?.closest('[data-drop-day]');
    document.querySelectorAll('.is-drop-target').forEach(d => d.classList.remove('is-drop-target'));

    if (block && touchDragData) {
      const dayNumber = parseInt(block.dataset.day, 10);
      assignEntityToDay(touchDragData, dayNumber);
    }
    touchDragData = null;
  }

  function moveTouchClone(touch) {
    if (!touchDragClone) return;
    touchDragClone.style.left = (touch.clientX - touchDragClone.offsetWidth / 2) + 'px';
    touchDragClone.style.top = (touch.clientY - 20) + 'px';
  }


  // ─── Voice Input ───────────────────────────────────────────────────

  function initVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (micBtn) micBtn.style.display = 'none';
      if (stickyMic) stickyMic.style.display = 'none';
      return false;
    }

    state.recognition = new SpeechRecognition();
    state.recognition.continuous = false;
    state.recognition.interimResults = true;
    state.recognition.lang = 'en-ZA';

    let pauseTimer = null;

    state.recognition.onstart = () => {
      state.isVoiceActive = true;
      updateMicUI();
    };

    state.recognition.onend = () => {
      state.isVoiceActive = false;
      updateMicUI();
    };

    state.recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      const activeInput = state.hasSubmitted ? stickyInput : input;
      if (activeInput) {
        activeInput.value = final || interim;
      }

      clearTimeout(pauseTimer);
      pauseTimer = setTimeout(() => {
        if (final && activeInput) {
          activeInput.value = final;
          submitInput(activeInput.value);
          state.recognition.stop();
        }
      }, 1500);
    };

    state.recognition.onerror = (e) => {
      console.warn('Speech recognition error:', e.error);
      state.isVoiceActive = false;
      updateMicUI();
    };

    return true;
  }

  function toggleVoice() {
    if (!state.recognition) {
      initVoice();
      if (!state.recognition) return;
    }
    if (state.isVoiceActive) {
      state.recognition.stop();
    } else {
      try {
        state.recognition.start();
      } catch (e) {
        console.warn('Could not start recognition:', e);
      }
    }
  }

  function updateMicUI() {
    const pulse = document.querySelector('[data-mic-pulse]');
    if (pulse) pulse.classList.toggle('is-active', state.isVoiceActive);
    if (micBtn) micBtn.classList.toggle('is-listening', state.isVoiceActive);
    if (stickyMic) stickyMic.classList.toggle('is-listening', state.isVoiceActive);
  }

  // ─── Transitions ───────────────────────────────────────────────────

  function submitInput(text) {
    if (!text || !text.trim()) return;

    if (!state.hasSubmitted) {
      transitionToConversation();
    }

    const activeInput = state.hasSubmitted ? stickyInput : input;
    if (activeInput) activeInput.value = '';

    sendMessage(text);
  }

  function transitionToConversation() {
    state.hasSubmitted = true;

    if (hero) hero.classList.add('is-submitted');
    if (video) {
      video.style.transition = 'opacity 300ms';
      video.style.opacity = '0';
    }

    if (chipsContainer) chipsContainer.style.display = 'none';

    setTimeout(() => {
      if (video) video.style.display = 'none';
      if (stickyBar) stickyBar.classList.add('is-visible');
      if (root) root.classList.add('is-active');
      if (stickyInput) stickyInput.focus();
    }, 300);

    document.body.classList.add('m-ai-mode');
  }

  // ─── Event Delegation ──────────────────────────────────────────────

  function onClick(e) {
    const target = e.target.closest('[data-preview]');
    if (target) {
      e.preventDefault();
      openPreview(target.dataset.preview);
      return;
    }

    const addTarget = e.target.closest('[data-add]');
    if (addTarget) {
      e.preventDefault();
      addToShortlist(addTarget.dataset.add);
      return;
    }

    const removeTarget = e.target.closest('[data-remove]');
    if (removeTarget) {
      e.preventDefault();
      removeFromShortlist(removeTarget.dataset.remove);
      return;
    }

    const actionTarget = e.target.closest('[data-action]');
    if (actionTarget) {
      e.preventDefault();
      sendMessage(actionTarget.dataset.action);
      return;
    }

    const chipTarget = e.target.closest('[data-chip]');
    if (chipTarget) {
      e.preventDefault();
      const text = chipTarget.dataset.chip;
      if (!state.hasSubmitted) {
        if (input) input.value = text;
        submitInput(text);
      } else {
        if (stickyInput) stickyInput.value = text;
        submitInput(text);
      }
      return;
    }

    const buildTarget = e.target.closest('[data-shortlist-build], [data-shortlist-build-drawer]');
    if (buildTarget) {
      e.preventDefault();
      enterDayAssignmentMode();
      return;
    }

    const nightTarget = e.target.closest('[data-night-id]');
    if (nightTarget) {
      e.preventDefault();
      setNights(nightTarget.dataset.nightId, parseInt(nightTarget.dataset.nightValue, 10));
      return;
    }

    const clearTarget = e.target.closest('[data-clear-all]');
    if (clearTarget) {
      e.preventDefault();
      clearAllShortlist();
      return;
    }

    const tabTarget = e.target.closest('[data-tab]');
    if (tabTarget && dayAssignmentView?.contains(tabTarget)) {
      e.preventDefault();
      state.activeTab = tabTarget.dataset.tab;
      renderDayAssignment();
      return;
    }

    const addDayTarget = e.target.closest('[data-add-day]');
    if (addDayTarget) {
      e.preventDefault();
      addDay();
      renderDayAssignment();
      saveToStorage();
      return;
    }

    const saveTarget = e.target.closest('[data-save-trip]');
    if (saveTarget) {
      e.preventDefault();
      openSaveModal();
      return;
    }

    const shareTarget = e.target.closest('[data-share-trip]');
    if (shareTarget) {
      e.preventDefault();
      openSaveModal();
      return;
    }

    const saveModalSubmit = e.target.closest('[data-save-modal-submit]');
    if (saveModalSubmit) {
      e.preventDefault();
      submitSaveModal();
      return;
    }

    const saveModalClose = e.target.closest('[data-save-modal-close], [data-save-modal-overlay]');
    if (saveModalClose) {
      e.preventDefault();
      closeSaveModal();
      return;
    }

    const copyLinkTarget = e.target.closest('[data-copy-link]');
    if (copyLinkTarget) {
      e.preventDefault();
      copyShareLink();
      return;
    }

    const activitySearchClose = e.target.closest('[data-activity-search-close], [data-activity-search-overlay]');
    if (activitySearchClose) {
      e.preventDefault();
      closeActivitySearch();
      return;
    }

    const selectActivity = e.target.closest('[data-select-activity]');
    if (selectActivity) {
      e.preventDefault();
      addActivityToSlot(selectActivity.dataset.selectActivity);
      return;
    }

    const addSuggestion = e.target.closest('[data-add-suggestion]');
    if (addSuggestion) {
      e.preventDefault();
      addSuggestionToItinerary(addSuggestion.dataset.addSuggestion, parseInt(addSuggestion.dataset.suggestionDay, 10));
      return;
    }

    const dismissSuggestionBtn = e.target.closest('[data-dismiss-suggestion]');
    if (dismissSuggestionBtn) {
      e.preventDefault();
      dismissSuggestion(dismissSuggestionBtn.dataset.dismissSuggestion);
      return;
    }

    const removeActivityBtn = e.target.closest('[data-remove-activity]');
    if (removeActivityBtn) {
      e.preventDefault();
      removeActivity(parseInt(removeActivityBtn.dataset.day, 10), removeActivityBtn.dataset.removeActivity);
      return;
    }

    const zoomFitTarget = e.target.closest('[data-map-zoom-fit]');
    if (zoomFitTarget) {
      e.preventDefault();
      zoomToFitRoute();
      return;
    }

    const mapDayFilter = e.target.closest('[data-map-day-filter]');
    if (mapDayFilter) {
      // TODO: filter map pins by day range
      return;
    }

    const shortlistBarClick = e.target.closest('#murmurgo-shortlist-bar');
    if (shortlistBarClick && !e.target.closest('[data-shortlist-build]')) {
      e.preventDefault();
      openShortlistDrawer();
      return;
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      if (document.activeElement === input) {
        e.preventDefault();
        submitInput(input.value);
      } else if (document.activeElement === stickyInput) {
        e.preventDefault();
        submitInput(stickyInput.value);
      } else if (document.activeElement?.closest('[data-activity-search-input]')) {
        const val = document.activeElement.value;
        if (val) searchActivities(val);
      }
    }
    if (e.key === 'Escape') {
      closePreview();
      closeShortlistDrawer();
      closeSaveModal();
      closeActivitySearch();
      closeConfirmDialog();
    }
  }

  function onInput(e) {
    if (e.target.closest('[data-activity-search-input]')) {
      clearTimeout(e.target._searchTimer);
      e.target._searchTimer = setTimeout(() => {
        searchActivities(e.target.value);
      }, 300);
    }
  }

  // ─── Embedded Maps ─────────────────────────────────────────────────

  function initEmbeddedMaps() {
    if (!window.maplibregl) return;
    document.querySelectorAll('[data-embed-map]').forEach(el => {
      if (el.dataset.mapInit) return;
      el.dataset.mapInit = 'true';

      const centerRaw = el.dataset.center;
      const pinsRaw = el.dataset.pins;
      let center = [18.5, -33.9];
      let pins = [];

      try {
        if (centerRaw) center = [JSON.parse(centerRaw).lng, JSON.parse(centerRaw).lat];
        if (pinsRaw) pins = JSON.parse(pinsRaw);
      } catch (e) { /* ignore */ }

      const map = new window.maplibregl.Map({
        container: el,
        style: config.maplibreStyle || 'https://demotiles.maplibre.org/style.json',
        center,
        zoom: pins.length > 1 ? 5 : 10,
        attributionControl: false,
      });
      map.addControl(new window.maplibregl.AttributionControl({ compact: true }));

      if (pins.length > 1) {
        const coords = pins.map(p => [p.lng, p.lat]);
        map.on('load', () => {
          map.addSource('route', {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: coords },
            },
          });
          map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            paint: { 'line-color': '#D4A373', 'line-width': 2 },
          });
        });
      }

      pins.forEach(p => {
        const marker = new window.maplibregl.Marker()
          .setLngLat([p.lng, p.lat])
          .setPopup(new window.maplibregl.Popup({ offset: 8 }).setText(p.name))
          .addTo(map);
        marker.getElement().addEventListener('click', () => {
          openPreview(p.handle);
        });
      });
    });
  }

  // ─── Utilities ─────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ─── Init ──────────────────────────────────────────────────────────

  function init() {
    cacheDOM();
    loadFromStorage();

    if (!root) {
      console.warn('murmurgo-ai.js: #murmurgo-conversation-root not found');
      return;
    }

    initVoice();

    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('input', onInput);

    if (previewClose) previewClose.addEventListener('click', closePreview);
    if (shortlistClose) shortlistClose.addEventListener('click', closeShortlistDrawer);

    if (micBtn) micBtn.addEventListener('click', toggleVoice);
    if (stickyMic) stickyMic.addEventListener('click', toggleVoice);

    // Hide day assignment view initially
    if (dayAssignmentView) dayAssignmentView.style.display = 'none';
    if (tripMapPanel) tripMapPanel.style.display = 'none';

    // Observe DOM changes to init maps
    const observer = new MutationObserver(() => {
      initEmbeddedMaps();
    });
    if (root) observer.observe(root, { childList: true, subtree: true });

    updateShortlistBar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
