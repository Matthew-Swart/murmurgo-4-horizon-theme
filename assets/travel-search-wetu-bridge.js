(function () {
  'use strict';

  const DATA_SCRIPT_ID = 'travel-search-wetu-bridge-data';
  const WRAPPER_SELECTOR = '.travel-search-main-wrapper';
  const CARD_SELECTOR = '.accommodation-card';
  const BUTTON_SELECTOR = '.accommodation-btn';

  const wrapperState = new WeakMap();
  const initializedWrappers = new WeakSet();
  const instanceState = new WeakMap();
  const cardImagePoolState = new WeakMap();
  const globalAssignmentsBySourceId = new Map();
  const assignmentsByVariantId = new Map();
  let lastClickedAssignment = null;
  const galleryOverlayState = {
    root: null,
    track: null,
    closeButton: null,
  };

  function hasText(value) {
    return String(value ?? '').trim().length > 0;
  }

  function normalizeMatchKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function normalizeSourceId(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getAccommodationMatchPayload(accommodation) {
    const sourceId = normalizeSourceId(
      accommodation?.source_id || accommodation?.accommodation_id || accommodation?.accommodationId
    );
    const handleKey = normalizeMatchKey(accommodation?.handle || accommodation?.accommodation_handle);
    const nameKey = normalizeMatchKey(
      accommodation?.name || accommodation?.accommodation_name || accommodation?.room_name || accommodation?.title
    );
    const propertyKey = normalizeMatchKey(
      accommodation?.context_property_handle
      || accommodation?.property_handle
      || accommodation?.context_property_name
      || accommodation?.property_name
      || accommodation?.property_title
      || accommodation?.property
    );

    return {
      sourceId,
      handleKey,
      nameKey,
      propertyKey,
      propertyAndNameKey: propertyKey && nameKey ? `${propertyKey}::${nameKey}` : '',
    };
  }

  function normalizeVariantId(value) {
    if (!hasText(value)) return '';

    const normalized = String(value).trim();
    const gidMatch = normalized.match(/\/ProductVariant\/(\d+)(?:\D.*)?$/i);
    if (gidMatch && gidMatch[1]) return gidMatch[1];

    const trailingDigitsMatch = normalized.match(/(\d+)(?!.*\d)/);
    return trailingDigitsMatch && trailingDigitsMatch[1] ? trailingDigitsMatch[1] : normalized;
  }

  function registerAssignment(assignment) {
    const variantId = String(assignment?.variant_id || assignment?.variantId || '').trim();
    if (!variantId) return;

    assignmentsByVariantId.set(variantId, assignment);

    const normalizedVariantId = normalizeVariantId(variantId);
    if (normalizedVariantId && normalizedVariantId !== variantId) {
      assignmentsByVariantId.set(normalizedVariantId, assignment);
    }
  }

  function findAssignmentByVariantId(variantId) {
    if (!hasText(variantId)) return null;

    const rawValue = String(variantId).trim();
    if (assignmentsByVariantId.has(rawValue)) {
      return assignmentsByVariantId.get(rawValue);
    }

    const normalizedVariantId = normalizeVariantId(rawValue);
    if (normalizedVariantId && assignmentsByVariantId.has(normalizedVariantId)) {
      return assignmentsByVariantId.get(normalizedVariantId);
    }

    return null;
  }

  function cleanPropertyLabel(value) {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '';

    const withoutPrefix = rawValue.replace(/^at\s+/i, '').trim();
    return withoutPrefix;
  }

  function getTextContent(element) {
    if (!(element instanceof Element)) return '';
    return String(element.textContent || '').trim();
  }

  function inferPropertyNameFromCard(card) {
    if (!(card instanceof Element)) return '';

    const dataCandidates = [
      card.dataset.wetuBridgePropertyName,
      card.dataset.propertyName,
      card.dataset.wetuPropertyName,
      card.dataset.propertyTitle,
    ];

    for (const candidate of dataCandidates) {
      const propertyName = cleanPropertyLabel(candidate);
      if (propertyName) return propertyName;
    }

    const selectorCandidates = [
      '.accommodation-property-link',
      '.accommodation-property-context a',
      '.accommodation-property-context',
      '[data-property-name]',
      '.accommodation-location',
    ];

    for (const selector of selectorCandidates) {
      const element = card.querySelector(selector);
      const propertyName = cleanPropertyLabel(getTextContent(element));
      if (propertyName) return propertyName;
    }

    return '';
  }

  function inferAccommodationNameFromCard(card) {
    if (!(card instanceof Element)) return '';

    const dataCandidates = [
      card.dataset.wetuBridgeName,
      card.dataset.accommodationName,
      card.dataset.roomName,
    ];

    for (const candidate of dataCandidates) {
      const accommodationName = String(candidate || '').trim();
      if (accommodationName) return accommodationName;
    }

    const selectorCandidates = ['.accommodation-name-link', '.accommodation-name', '[data-accommodation-name]'];
    for (const selector of selectorCandidates) {
      const element = card.querySelector(selector);
      const accommodationName = getTextContent(element);
      if (accommodationName) return accommodationName;
    }

    return '';
  }

  function rememberCardAssignment(card) {
    if (!(card instanceof Element)) return null;

    const variantId = String(card.dataset.wetuBridgeVariantId || card.dataset.variantId || '').trim();
    const title = inferAccommodationNameFromCard(card);
    const propertyTitle = inferPropertyNameFromCard(card);

    if (!title && !propertyTitle) return null;

    const assignment = {
      variant_id: variantId,
      title,
      property_title: propertyTitle,
    };

    if (variantId) {
      registerAssignment(assignment);
    }

    lastClickedAssignment = assignment;
    return assignment;
  }

  function findAssignmentByPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;

    const sourceId = payload.source_id || payload.sourceId || payload.accommodation_id || payload.accommodationId;
    if (hasText(sourceId) && globalAssignmentsBySourceId.has(String(sourceId))) {
      return globalAssignmentsBySourceId.get(String(sourceId));
    }

    const variantCandidates = [payload.variant_id, payload.variantId, payload.merchandiseId, payload.id];
    for (const variantCandidate of variantCandidates) {
      const assignment = findAssignmentByVariantId(variantCandidate);
      if (assignment) return assignment;
    }

    if (Array.isArray(payload.items)) {
      for (const item of payload.items) {
        const assignment = findAssignmentByPayload(item);
        if (assignment) return assignment;
      }
    }

    if (payload.item && typeof payload.item === 'object') {
      return findAssignmentByPayload(payload.item);
    }

    return null;
  }

  function getBestAvailableAssignment(variantId, options) {
    const resolvedOptions = options && typeof options === 'object' ? options : {};
    const allowLastClicked = resolvedOptions.allowLastClicked === true;

    const assignmentFromVariant = findAssignmentByVariantId(variantId);
    if (assignmentFromVariant) return assignmentFromVariant;

    if (allowLastClicked && lastClickedAssignment && (hasText(lastClickedAssignment.property_title) || hasText(lastClickedAssignment.title))) {
      return lastClickedAssignment;
    }

    return null;
  }

  function hasReservationMarkersInPayload(payload) {
    if (!payload || typeof payload !== 'object') return false;

    const directKeys = ['reservation_id', '_reservation_id', 'check_in', 'checkin', 'check_out', 'checkout', 'nights', 'guests', 'rooms'];
    if (directKeys.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
      return true;
    }

    const properties = payload.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      const propertyKeys = ['_reservation_id', 'Reservation ID', 'Check-in', 'Check-out', 'Nights', 'Guests', 'Rooms'];
      if (propertyKeys.some((key) => Object.prototype.hasOwnProperty.call(properties, key))) {
        return true;
      }
    }

    if (Array.isArray(payload.items)) {
      return payload.items.some((item) => hasReservationMarkersInPayload(item));
    }

    return false;
  }

  function hasReservationMarkersInParams(params) {
    if (!(params instanceof URLSearchParams)) return false;

    const markerPattern = /(reservation|check-?in|check-?out|nights|guests|rooms)/i;
    for (const [key, value] of params.entries()) {
      if (markerPattern.test(key) && hasText(value)) {
        return true;
      }
    }

    return false;
  }

  function setValueIfMissing(container, key, value) {
    if (!container || !hasText(value)) return false;
    if (hasText(container[key])) return false;

    container[key] = value;
    return true;
  }

  function applyCheckoutLabels(target, assignment) {
    if (!target || typeof target !== 'object' || !assignment) return false;

    const accommodationName = String(assignment.title || '').trim();
    const propertyName = String(assignment.property_title || '').trim();
    const accommodationDisplayName =
      accommodationName && propertyName
        ? `${accommodationName} at ${propertyName}`
        : accommodationName;
    if (!accommodationName && !propertyName) return false;

    let changed = false;

    if (!target.properties || Array.isArray(target.properties) || typeof target.properties !== 'object') {
      target.properties = {};
      changed = true;
    }

    if (propertyName) {
      changed = setValueIfMissing(target.properties, 'Property', propertyName) || changed;
      changed = setValueIfMissing(target.properties, '_property_name', propertyName) || changed;

      changed = setValueIfMissing(target, 'property_name', propertyName) || changed;
      changed = setValueIfMissing(target, 'propertyName', propertyName) || changed;
      changed = setValueIfMissing(target, 'property_title', propertyName) || changed;
      changed = setValueIfMissing(target, 'wetu_property_name', propertyName) || changed;
    }

    if (accommodationName) {
      changed = setValueIfMissing(target.properties, 'Accommodation', accommodationDisplayName || accommodationName) || changed;
      changed = setValueIfMissing(target.properties, '_accommodation_name', accommodationName) || changed;

      changed = setValueIfMissing(target, 'accommodation_name', accommodationDisplayName || accommodationName) || changed;
      changed = setValueIfMissing(target, 'accommodationName', accommodationName) || changed;
      changed = setValueIfMissing(target, 'room_name', accommodationName) || changed;
    }

    return changed;
  }

  function decorateCartPayload(payload, options) {
    if (!payload || typeof payload !== 'object') return false;

    const resolvedOptions = options && typeof options === 'object' ? options : {};
    const allowLastClicked = resolvedOptions.allowLastClicked === true;

    let changed = false;
    const fallbackAssignment =
      findAssignmentByPayload(payload) ||
      getBestAvailableAssignment(payload.variant_id || payload.variantId || payload.id, { allowLastClicked });

    if (Array.isArray(payload.items) && payload.items.length) {
      payload.items.forEach((item) => {
        const assignment =
          findAssignmentByPayload(item) ||
          getBestAvailableAssignment(item.variant_id || item.variantId || item.id || item.merchandiseId, { allowLastClicked }) ||
          fallbackAssignment;
        if (assignment && applyCheckoutLabels(item, assignment)) {
          changed = true;
        }
      });
      return changed;
    }

    if (fallbackAssignment && applyCheckoutLabels(payload, fallbackAssignment)) {
      changed = true;
    }

    return changed;
  }

  function findVariantIdInParams(params) {
    const directKeys = ['variant_id', 'variantId', 'id', 'merchandiseId'];

    for (const directKey of directKeys) {
      const candidate = params.get(directKey);
      if (hasText(candidate)) {
        return candidate;
      }
    }

    for (const [key, value] of params.entries()) {
      if (!hasText(value)) continue;
      if (/\[(?:variant_id|variantId|id|merchandiseId)\]$/i.test(key)) {
        return value;
      }
    }

    return '';
  }

  function setParamIfMissing(params, key, value) {
    if (!hasText(value)) return false;

    const existingValue = params.get(key);
    if (hasText(existingValue)) return false;

    params.set(key, value);
    return true;
  }

  function decorateParamsPayload(params, assignment) {
    if (!(params instanceof URLSearchParams) || !assignment) return false;

    const propertyName = String(assignment.property_title || '').trim();
    const accommodationName = String(assignment.title || '').trim();
    const accommodationDisplayName =
      accommodationName && propertyName
        ? `${accommodationName} at ${propertyName}`
        : accommodationName;

    let changed = false;

    changed = setParamIfMissing(params, 'property_name', propertyName) || changed;
    changed = setParamIfMissing(params, 'wetu_property_name', propertyName) || changed;
    changed = setParamIfMissing(params, 'accommodation_name', accommodationDisplayName || accommodationName) || changed;

    changed = setParamIfMissing(params, 'properties[Property]', propertyName) || changed;
    changed = setParamIfMissing(params, 'properties[_property_name]', propertyName) || changed;
    changed = setParamIfMissing(params, 'properties[Accommodation]', accommodationDisplayName || accommodationName) || changed;
    changed = setParamIfMissing(params, 'properties[_accommodation_name]', accommodationName) || changed;

    const itemPrefixes = new Set();
    for (const [key] of params.entries()) {
      const match = key.match(/^(items\[\d+\])\[(?:variant_id|variantId|id|merchandiseId)\]$/i);
      if (match && match[1]) {
        itemPrefixes.add(match[1]);
      }
    }

    itemPrefixes.forEach((itemPrefix) => {
      changed = setParamIfMissing(params, `${itemPrefix}[property_name]`, propertyName) || changed;
      changed = setParamIfMissing(params, `${itemPrefix}[wetu_property_name]`, propertyName) || changed;
      changed = setParamIfMissing(params, `${itemPrefix}[accommodation_name]`, accommodationDisplayName || accommodationName) || changed;

      changed = setParamIfMissing(params, `${itemPrefix}[properties][Property]`, propertyName) || changed;
      changed = setParamIfMissing(params, `${itemPrefix}[properties][_property_name]`, propertyName) || changed;
      changed = setParamIfMissing(params, `${itemPrefix}[properties][Accommodation]`, accommodationDisplayName || accommodationName) || changed;
      changed = setParamIfMissing(params, `${itemPrefix}[properties][_accommodation_name]`, accommodationName) || changed;
    });

    return changed;
  }

  function isCartAddEndpoint(url) {
    if (!hasText(url)) return false;

    const normalizedUrl = String(url).toLowerCase();
    return (
      /\/cart\/add(?:\.js)?(?:[/?#]|$)/.test(normalizedUrl) ||
      /\/apps\/plekify\/api\/cart\/add(?:[/?#]|$)/.test(normalizedUrl) ||
      /\/api\/cart\/add(?:[/?#]|$)/.test(normalizedUrl)
    );
  }

  function isPlekifyCartAddEndpoint(url) {
    if (!hasText(url)) return false;
    const normalizedUrl = String(url).toLowerCase();
    return /\/apps\/plekify\/api\/cart\/add(?:[/?#]|$)/.test(normalizedUrl) || /\/api\/cart\/add(?:[/?#]|$)/.test(normalizedUrl);
  }

  function installCartPayloadBridge() {
    if (window.__wetuBridgeCartPayloadPatched) return;
    if (typeof window.fetch !== 'function') return;

    const originalFetch = window.fetch.bind(window);

    window.fetch = function patchedFetch(input, init) {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : typeof Request !== 'undefined' && input instanceof Request
              ? input.url
              : String(input || '');

      if (!isCartAddEndpoint(requestUrl) || !init || typeof init !== 'object' || !Object.prototype.hasOwnProperty.call(init, 'body')) {
        return originalFetch(input, init);
      }

      const nextInit = { ...init };
      const body = nextInit.body;
      const allowLastClickedFromUrl = isPlekifyCartAddEndpoint(requestUrl);

      try {
        if (typeof body === 'string') {
          try {
            const payload = JSON.parse(body);
            const allowLastClicked = allowLastClickedFromUrl || hasReservationMarkersInPayload(payload);
            if (decorateCartPayload(payload, { allowLastClicked })) {
              nextInit.body = JSON.stringify(payload);
            }
          } catch (_jsonParseError) {
            const params = new URLSearchParams(body);
            const allowLastClicked = allowLastClickedFromUrl || hasReservationMarkersInParams(params);
            const assignment = getBestAvailableAssignment(findVariantIdInParams(params), { allowLastClicked });

            if (assignment && decorateParamsPayload(params, assignment)) {
              nextInit.body = params.toString();
            }
          }
        } else if (body instanceof URLSearchParams) {
          const params = new URLSearchParams(body.toString());
          const allowLastClicked = allowLastClickedFromUrl || hasReservationMarkersInParams(params);
          const assignment = getBestAvailableAssignment(findVariantIdInParams(params), { allowLastClicked });

          if (assignment && decorateParamsPayload(params, assignment)) {
            nextInit.body = params;
          }
        } else if (typeof FormData !== 'undefined' && body instanceof FormData) {
          const params = new URLSearchParams();
          body.forEach((value, key) => {
            if (typeof value === 'string') {
              params.append(key, value);
            }
          });

          const allowLastClicked = allowLastClickedFromUrl || hasReservationMarkersInParams(params);
          const assignment = getBestAvailableAssignment(findVariantIdInParams(params), { allowLastClicked });
          if (assignment && decorateParamsPayload(params, assignment)) {
            const nextFormData = new FormData();
            params.forEach((value, key) => {
              nextFormData.append(key, value);
            });
            nextInit.body = nextFormData;
          }
        }
      } catch (error) {
        console.warn('[WetuBridge] Unable to enrich cart payload with property context', error);
      }

      return originalFetch(input, nextInit);
    };

    window.__wetuBridgeCartPayloadPatched = true;
  }

  function normalizeImageList(candidates) {
    if (!Array.isArray(candidates)) return [];
    return uniqueImageSources(candidates);
  }

  function buildGalleryPools(item) {
    const accommodationImages = normalizeImageList([
      ...(Array.isArray(item?.accommodation_images) ? item.accommodation_images : []),
      item?.image_url,
      item?.secondary_image_url,
      item?.tertiary_image_url,
    ]);

    const propertyImages = normalizeImageList([
      ...(Array.isArray(item?.property_images) ? item.property_images : []),
      item?.property_image_url,
    ]);

    return {
      accommodation_images: accommodationImages,
      property_images: propertyImages,
    };
  }

  function parseBridgeData() {
    const script = document.getElementById(DATA_SCRIPT_ID);
    if (!script) return null;

    try {
      const raw = JSON.parse(script.textContent || '{}');
      const accommodations = Array.isArray(raw.accommodations) ? raw.accommodations : [];
      const properties = Array.isArray(raw.properties) ? raw.properties : [];

      const normalizedAccommodations = accommodations
        .filter((item) => item && item.title && item.image_url && item.variant_id)
        .map((item) => {
          const matchPayload = getAccommodationMatchPayload(item);
          const nextItem = {
            ...item,
            ...buildGalleryPools(item),
            source_id: matchPayload.sourceId,
            _source_id: matchPayload.sourceId,
            _handle_key: matchPayload.handleKey,
            _name_key: matchPayload.nameKey,
            _property_key: matchPayload.propertyKey,
            _property_and_name_key: matchPayload.propertyAndNameKey,
          };

          if (nextItem._source_id) {
            globalAssignmentsBySourceId.set(nextItem._source_id, nextItem);
          }

          registerAssignment(nextItem);
          return nextItem;
        });

      const normalizedProperties = properties
        .filter((item) => item && item.title && item.url)
        .map((item) => {
          return {
            ...item,
            gallery_images: normalizeImageList([...(Array.isArray(item.gallery_images) ? item.gallery_images : []), item.image_url]),
          };
        });

      return {
        accommodations: normalizedAccommodations,
        properties: normalizedProperties,
      };
    } catch (error) {
      console.error('[WetuBridge] Failed to parse bridge data', error);
      return null;
    }
  }

  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function buildSpreadQueue(accommodations, properties) {
    if (!accommodations.length) return [];

    const propertyFallbacks = properties.length ? shuffle([...properties]) : [];
    let propertyFallbackIndex = 0;

    const enriched = accommodations.map((item, index) => {
      const nextItem = { ...item };

      if (!nextItem.property_url && propertyFallbacks.length) {
        const fallbackProperty = propertyFallbacks[propertyFallbackIndex % propertyFallbacks.length];
        propertyFallbackIndex += 1;

        nextItem.property_title = fallbackProperty.title;
        nextItem.property_handle = fallbackProperty.handle;
        nextItem.property_url = fallbackProperty.url;

        if (!nextItem.property_images?.length) {
          nextItem.property_images = Array.isArray(fallbackProperty.gallery_images) ? [...fallbackProperty.gallery_images] : [];
        }
      }

      if (!nextItem.property_image_url && nextItem.property_images?.length) {
        nextItem.property_image_url = nextItem.property_images[0];
      }

      nextItem._group_key = nextItem.property_handle || nextItem.property_url || `ungrouped-${index}`;
      return nextItem;
    });

    const groups = new Map();
    enriched.forEach((item) => {
      if (!groups.has(item._group_key)) {
        groups.set(item._group_key, []);
      }
      groups.get(item._group_key).push(item);
    });

    const groupKeys = shuffle(Array.from(groups.keys()));
    groupKeys.forEach((key) => shuffle(groups.get(key)));

    const queue = [];
    let hasItems = true;

    while (hasItems) {
      hasItems = false;

      for (const key of groupKeys) {
        const group = groups.get(key);
        if (!group || !group.length) continue;
        queue.push(group.shift());
        hasItems = true;
      }
    }

    return queue;
  }

  function getTravelSearchInstances() {
    const registry = window.travelSearchInstances;

    if (registry instanceof Map) return Array.from(registry.values());
    if (Array.isArray(registry)) return registry;
    if (registry && typeof registry === 'object' && registry.state) return [registry];

    return [];
  }

  function getOrCreateInstanceState(instance, bridgeData) {
    let state = instanceState.get(instance);
    if (state) return state;

    state = {
      bySourceId: new Map(),
      byHandleKey: new Map(),
      byNameKey: new Map(),
      byPropertyAndNameKey: new Map(),
    };

    (Array.isArray(bridgeData?.accommodations) ? bridgeData.accommodations : []).forEach((assignment) => {
      const sourceId = normalizeSourceId(assignment?._source_id || assignment?.source_id);
      const handleKey = normalizeMatchKey(assignment?._handle_key || assignment?.handle);
      const nameKey = normalizeMatchKey(assignment?._name_key || assignment?.title);
      const propertyAndNameKey = String(assignment?._property_and_name_key || '').trim();

      if (sourceId && !state.bySourceId.has(sourceId)) {
        state.bySourceId.set(sourceId, assignment);
      }

      if (handleKey && !state.byHandleKey.has(handleKey)) {
        state.byHandleKey.set(handleKey, assignment);
      }

      if (nameKey) {
        if (!state.byNameKey.has(nameKey)) {
          state.byNameKey.set(nameKey, []);
        }
        state.byNameKey.get(nameKey).push(assignment);
      }

      if (propertyAndNameKey && !state.byPropertyAndNameKey.has(propertyAndNameKey)) {
        state.byPropertyAndNameKey.set(propertyAndNameKey, assignment);
      }
    });

    instanceState.set(instance, state);
    return state;
  }

  function getAssignmentForAccommodation(instance, bridgeData, accommodation) {
    if (!accommodation) return null;

    const state = getOrCreateInstanceState(instance, bridgeData);
    const matchPayload = getAccommodationMatchPayload(accommodation);
    let assignment = null;

    if (matchPayload.sourceId && state.bySourceId.has(matchPayload.sourceId)) {
      assignment = state.bySourceId.get(matchPayload.sourceId);
    }

    if (!assignment && matchPayload.propertyAndNameKey && state.byPropertyAndNameKey.has(matchPayload.propertyAndNameKey)) {
      assignment = state.byPropertyAndNameKey.get(matchPayload.propertyAndNameKey);
    }

    if (!assignment && matchPayload.handleKey && state.byHandleKey.has(matchPayload.handleKey)) {
      assignment = state.byHandleKey.get(matchPayload.handleKey);
    }

    if (!assignment && matchPayload.nameKey && state.byNameKey.has(matchPayload.nameKey)) {
      const nameMatches = state.byNameKey.get(matchPayload.nameKey);
      if (Array.isArray(nameMatches) && nameMatches.length === 1) {
        assignment = nameMatches[0];
      } else if (Array.isArray(nameMatches) && nameMatches.length > 1 && matchPayload.propertyKey) {
        assignment = nameMatches.find((candidate) => normalizeMatchKey(candidate?._property_key) === matchPayload.propertyKey) || null;
      }
    }

    if (!assignment) {
      return null;
    }

    if (matchPayload.sourceId) {
      state.bySourceId.set(matchPayload.sourceId, assignment);
      globalAssignmentsBySourceId.set(matchPayload.sourceId, assignment);
    }

    registerAssignment(assignment);

    return assignment;
  }

  function decorateAccommodationsForRender(instance, bridgeData, accommodations) {
    if (!Array.isArray(accommodations) || !accommodations.length) return accommodations;

    return accommodations.map((accommodation) => {
      const assignment = getAssignmentForAccommodation(instance, bridgeData, accommodation);
      if (!assignment) return accommodation;

      return {
        ...accommodation,
        name: assignment.title || accommodation.name,
        image: assignment.image_url || accommodation.image,
        concise_location: assignment.location_display || accommodation.concise_location,
        handle: assignment.handle || accommodation.handle,
        variant_id: assignment.variant_id || accommodation.variant_id,
        accommodation_name: assignment.title || accommodation.accommodation_name || accommodation.name,
        accommodation: assignment.title || accommodation.accommodation || accommodation.name,
        room_name: assignment.title || accommodation.room_name || accommodation.name,
        wetu_property_name: assignment.property_title || accommodation.wetu_property_name || accommodation.property_name,
        property_name: assignment.property_title || accommodation.property_name,
        property: assignment.property_title || accommodation.property,
        property_title: assignment.property_title || accommodation.property_title,
        property_handle: assignment.property_handle || accommodation.property_handle,
        _wetu_bridge: assignment,
      };
    });
  }

  function patchTravelSearchPrototype(bridgeData) {
    const Component = window.TravelSearchComponent;
    if (!Component || !Component.prototype) return false;

    const proto = Component.prototype;
    if (proto.__wetuBridgePatched) return true;

    if (typeof proto.displayResults === 'function') {
      const originalDisplayResults = proto.displayResults;

      proto.displayResults = function patchedDisplayResults(accommodations) {
        let nextAccommodations = accommodations;

        try {
          nextAccommodations = decorateAccommodationsForRender(this, bridgeData, accommodations);
        } catch (error) {
          console.error('[WetuBridge] Failed to decorate render payload', error);
        }

        return originalDisplayResults.call(this, nextAccommodations);
      };
    }

    proto.__wetuBridgePatched = true;
    return true;
  }

  function patchResultPayloadFromCard(card) {
    const sourceId = card.dataset.accommodationId;
    if (!sourceId) return;

    const rememberedAssignment = rememberCardAssignment(card);

    const nextVariantId = card.dataset.wetuBridgeVariantId;
    const nextProductId = card.dataset.wetuBridgeProductId;
    const nextName = card.dataset.wetuBridgeName || rememberedAssignment?.title;
    const nextImage = card.dataset.wetuBridgeImage;
    const nextHandle = card.dataset.wetuBridgeHandle;
    const nextPropertyName = card.dataset.wetuBridgePropertyName || rememberedAssignment?.property_title;
    const nextPropertyHandle = card.dataset.wetuBridgePropertyHandle;

    if (!nextVariantId || !nextName) return;

    getTravelSearchInstances().forEach((instance) => {
      const results = instance?.state?.results;
      if (!Array.isArray(results) || !results.length) return;

      const result = results.find((item) => String(item?.source_id) === String(sourceId));
      if (!result) return;

      result.name = nextName;
      result.variant_id = nextVariantId;
      result.accommodation_name = nextName;
      result.accommodation = nextName;
      result.room_name = nextName;

      if (nextImage) result.image = nextImage;
      if (nextHandle) result.handle = nextHandle;
      if (nextProductId) result.id = nextProductId;

      if (nextPropertyName) {
        result.wetu_property_name = nextPropertyName;
        result.property_name = nextPropertyName;
        result.property = nextPropertyName;
        result.property_title = nextPropertyName;

        if (!result.properties || Array.isArray(result.properties) || typeof result.properties !== 'object') {
          result.properties = {};
        }

        result.properties.Property = nextPropertyName;
        if (!hasText(result.properties.Accommodation)) {
          const nextAccommodationDisplayName = `${nextName} at ${nextPropertyName}`;
          result.properties.Accommodation = nextAccommodationDisplayName;
        }
      }

      if (nextPropertyHandle) {
        result.property_handle = nextPropertyHandle;
        result.propertyHandle = nextPropertyHandle;
      }
    });
  }

  function setPropertyContext(titleSection, assignment) {
    let propertyContext = titleSection.querySelector('.accommodation-property-context');

    if (!propertyContext) {
      propertyContext = document.createElement('p');
      propertyContext.className = 'accommodation-property-context';
      titleSection.appendChild(propertyContext);
    }

    propertyContext.textContent = '';

    const propertyName = assignment.property_title || '';
    if (!propertyName) return;

    propertyContext.append(document.createTextNode('at '));

    if (assignment.property_url) {
      const propertyLink = document.createElement('a');
      propertyLink.className = 'accommodation-property-link';
      propertyLink.href = assignment.property_url;
      propertyLink.textContent = propertyName;
      propertyContext.append(propertyLink);
      return;
    }

    propertyContext.append(document.createTextNode(propertyName));
  }

  function setTagline(titleSection, assignment) {
    const unitTagline = titleSection.querySelector('.accommodation-unit-tagline');
    const tagline = [
      assignment?.tagline,
      assignment?.accommodation_tagline,
      assignment?.wetu_tagline,
      assignment?.property_tagline,
      unitTagline?.textContent,
    ]
      .map((value) => String(value || '').trim())
      .find((value) => value.length > 0) || '';

    let taglineElement = titleSection.querySelector('.wetu-bridge-tagline');

    if (!taglineElement && unitTagline) {
      taglineElement = unitTagline;
      taglineElement.classList.remove('accommodation-unit-tagline');
      taglineElement.classList.add('wetu-bridge-tagline');
    }

    if (!tagline) {
      titleSection.querySelectorAll('.wetu-bridge-tagline, .accommodation-unit-tagline').forEach((element) => {
        element.remove();
      });
      return;
    }

    if (!taglineElement) {
      taglineElement = document.createElement('p');
      taglineElement.className = 'wetu-bridge-tagline';
      titleSection.appendChild(taglineElement);
    }

    titleSection.querySelectorAll('.wetu-bridge-tagline, .accommodation-unit-tagline').forEach((element) => {
      if (element !== taglineElement) {
        element.remove();
      }
    });

    taglineElement.textContent = tagline;
  }

  function setSummary(card, assignment) {
    const overlayContent = card.querySelector('.accommodation-overlay-content');
    if (!overlayContent) return;

    const summaryText = String(assignment.summary || '').trim();
    let summaryElement = overlayContent.querySelector('.wetu-bridge-summary');

    if (!summaryText) {
      if (summaryElement) summaryElement.remove();
      return;
    }

    if (!summaryElement) {
      summaryElement = document.createElement('p');
      summaryElement.className = 'wetu-bridge-summary';

      const actionsSection = overlayContent.querySelector('.accommodation-actions-section');
      if (actionsSection) {
        overlayContent.insertBefore(summaryElement, actionsSection);
      } else {
        overlayContent.appendChild(summaryElement);
      }
    }

    summaryElement.textContent = summaryText;
  }

  function toPositiveInt(value) {
    const numericValue = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
  }

  function collectDisplayDetailRows(assignment) {
    const rows = [];
    const pushRow = (label, value) => {
      const normalized = String(value ?? '').trim();
      if (!normalized) return;
      rows.push({ label, value: normalized });
    };

    const maxOccupancy = toPositiveInt(assignment?.max_occupancy);
    const maxAdults = toPositiveInt(assignment?.max_adults);
    const maxChildren = toPositiveInt(assignment?.max_children);

    let occupancyLabel = '';
    if (maxAdults && maxChildren) {
      occupancyLabel = `${maxAdults} adults, ${maxChildren} children`;
    } else if (maxAdults) {
      occupancyLabel = `${maxAdults} adults`;
    } else if (maxOccupancy) {
      occupancyLabel = `Up to ${maxOccupancy} guests`;
    }

    pushRow('Occupancy', occupancyLabel);
    pushRow('Room type', assignment?.room_type);
    pushRow('Meal plan', assignment?.room_basis);
    pushRow('Beds', assignment?.beds_summary);
    pushRow('Room size', assignment?.room_size);
    pushRow('View', assignment?.view_type);
    pushRow('Property type', assignment?.property_category);

    const checkIn = String(assignment?.property_check_in_time || '').trim();
    const checkOut = String(assignment?.property_check_out_time || '').trim();
    if (checkIn || checkOut) {
      const checkInOut = [checkIn ? `In: ${checkIn}` : '', checkOut ? `Out: ${checkOut}` : ''].filter(Boolean).join(' · ');
      pushRow('Check-in/out', checkInOut);
    }

    const starRating = String(assignment?.property_star_rating || '').trim();
    if (starRating) {
      pushRow('Rating', `${starRating}-star`);
    }

    return rows.slice(0, 8);
  }

  function setCardLocation(card, assignment) {
    const locationElement = card.querySelector('.accommodation-location');
    if (!locationElement) return;

    const nextLocation = String(assignment?.location_display || '').trim();
    if (nextLocation) {
      locationElement.textContent = nextLocation;
      locationElement.hidden = false;
      return;
    }

    if (!String(locationElement.textContent || '').trim()) {
      locationElement.hidden = true;
    }
  }

  function setRichDetails(card, assignment) {
    const overlayContent = card.querySelector('.accommodation-overlay-content');
    if (!overlayContent) return;

    const detailRows = collectDisplayDetailRows(assignment);
    const amenities = Array.isArray(assignment?.amenities)
      ? assignment.amenities
          .map((amenity) => String(amenity || '').trim())
          .filter(Boolean)
      : [];

    let detailsRoot = overlayContent.querySelector('.wetu-bridge-rich-details');
    if (!detailRows.length && !amenities.length) {
      if (detailsRoot) detailsRoot.remove();
      return;
    }

    if (!detailsRoot) {
      detailsRoot = document.createElement('div');
      detailsRoot.className = 'wetu-bridge-rich-details';

      const actionsSection = overlayContent.querySelector('.accommodation-actions-section');
      if (actionsSection) {
        overlayContent.insertBefore(detailsRoot, actionsSection);
      } else {
        overlayContent.appendChild(detailsRoot);
      }
    }

    detailsRoot.innerHTML = '';

    if (detailRows.length) {
      const detailList = document.createElement('dl');
      detailList.className = 'wetu-bridge-details-grid';

      detailRows.forEach((row) => {
        const label = document.createElement('dt');
        label.className = 'wetu-bridge-detail-label';
        label.textContent = row.label;

        const value = document.createElement('dd');
        value.className = 'wetu-bridge-detail-value';
        value.textContent = row.value;

        detailList.appendChild(label);
        detailList.appendChild(value);
      });

      detailsRoot.appendChild(detailList);
    }

    if (amenities.length) {
      const amenityList = document.createElement('ul');
      amenityList.className = 'wetu-bridge-amenities';

      amenities.slice(0, 8).forEach((amenity) => {
        const amenityItem = document.createElement('li');
        amenityItem.className = 'wetu-bridge-amenity-chip';
        amenityItem.textContent = amenity;
        amenityList.appendChild(amenityItem);
      });

      detailsRoot.appendChild(amenityList);
    }
  }

  function uniqueImageSources(sourceCandidates) {
    const seen = new Set();

    return sourceCandidates.filter((source) => {
      const nextSource = String(source || '').trim();
      if (!nextSource || seen.has(nextSource)) return false;

      seen.add(nextSource);
      return true;
    });
  }

  function getAssignmentImageSources(assignment) {
    const accommodationImages = uniqueImageSources([
      ...(Array.isArray(assignment?.accommodation_images) ? assignment.accommodation_images : []),
      assignment?.image_url,
      assignment?.secondary_image_url,
      assignment?.tertiary_image_url,
    ]);

    const propertyImages = uniqueImageSources([
      ...(Array.isArray(assignment?.property_images) ? assignment.property_images : []),
      assignment?.property_image_url,
    ]);

    return {
      accommodationImages,
      propertyImages,
      allImages: uniqueImageSources([...accommodationImages, ...propertyImages]),
    };
  }

  function getCardImageSources(card) {
    const cachedImagePool = cardImagePoolState.get(card);
    if (Array.isArray(cachedImagePool) && cachedImagePool.length) {
      return cachedImagePool;
    }

    const primaryImage = card.querySelector('.accommodation-image.primary, .accommodation-image');
    const secondaryImage = card.querySelector('.accommodation-image.secondary');

    return uniqueImageSources([
      primaryImage?.currentSrc || primaryImage?.src,
      secondaryImage?.currentSrc || secondaryImage?.src,
      card.dataset.wetuBridgeSecondaryImage,
      card.dataset.wetuBridgeTertiaryImage,
      card.dataset.wetuBridgePropertyImage,
    ]);
  }

  function closeResultGallery() {
    if (!galleryOverlayState.root) return;

    galleryOverlayState.root.classList.remove('is-open');
    galleryOverlayState.root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('wetu-result-gallery-open');

    if (galleryOverlayState.track) {
      galleryOverlayState.track.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }

  function ensureGalleryOverlay() {
    if (galleryOverlayState.root && galleryOverlayState.track) {
      return galleryOverlayState;
    }

    const track = document.createElement('div');
    const overlay = document.createElement('div');
    const closeButton = document.createElement('button');

    overlay.className = 'wetu-result-gallery-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Accommodation and property gallery');

    track.className = 'wetu-result-gallery-track';

    closeButton.type = 'button';
    closeButton.className = 'wetu-result-gallery-close';
    closeButton.setAttribute('aria-label', 'Close gallery');
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', closeResultGallery);

    overlay.appendChild(closeButton);
    overlay.appendChild(track);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeResultGallery();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeResultGallery();
      }
    });

    document.body.appendChild(overlay);
    galleryOverlayState.root = overlay;
    galleryOverlayState.track = track;
    galleryOverlayState.closeButton = closeButton;

    return galleryOverlayState;
  }

  function openResultGallery(card, nextIndex) {
    const imageSources = getCardImageSources(card);
    if (!imageSources.length) return;

    const overlay = ensureGalleryOverlay();
    const signature = imageSources.join('|');

    if (overlay.track.dataset.sources !== signature) {
      overlay.track.dataset.sources = signature;
      overlay.track.innerHTML = '';

      imageSources.forEach((source, index) => {
        const slide = document.createElement('figure');
        slide.className = 'wetu-result-gallery-slide';

        const image = document.createElement('img');
        image.src = source;
        image.alt = `${card.dataset.wetuBridgeName || 'Accommodation'} full screen image ${index + 1}`;
        image.loading = 'lazy';
        image.addEventListener('click', (event) => {
          event.preventDefault();
          closeResultGallery();
        });

        slide.appendChild(image);
        overlay.track.appendChild(slide);
      });
    }

    const safeIndex = Number.isInteger(nextIndex) && nextIndex >= 0 && nextIndex < imageSources.length ? nextIndex : 0;

    overlay.root.classList.add('is-open');
    overlay.root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('wetu-result-gallery-open');

    window.requestAnimationFrame(() => {
      const targetSlide = overlay.track.children[safeIndex];

      if (targetSlide instanceof HTMLElement) {
        targetSlide.scrollIntoView({ behavior: 'auto', block: 'start' });
      } else {
        overlay.track.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    });
  }

  function setActiveCardImage(card, imageSources, nextIndex) {
    if (!Array.isArray(imageSources) || !imageSources.length) return;

    const primaryImage = card.querySelector('.accommodation-image.primary, .accommodation-image');
    if (!primaryImage) return;

    const safeIndex = Number.isInteger(nextIndex) && nextIndex >= 0 && nextIndex < imageSources.length ? nextIndex : 0;
    const selectedImage = imageSources[safeIndex];

    if (selectedImage) {
      primaryImage.src = selectedImage;
      primaryImage.removeAttribute('srcset');
      primaryImage.classList.remove('error');
      primaryImage.classList.add('loaded');
    }

    card.dataset.wetuActiveImageIndex = String(safeIndex);
    card.querySelectorAll('.wetu-card-thumbnail').forEach((thumbnail, index) => {
      thumbnail.classList.toggle('is-active', index === safeIndex);
      thumbnail.setAttribute('aria-pressed', index === safeIndex ? 'true' : 'false');
    });
  }

  function buildCardThumbnailRail(card) {
    const imageContainer = card.querySelector('.accommodation-image-container');
    const primaryImage = card.querySelector('.accommodation-image.primary, .accommodation-image');
    if (!imageContainer || !primaryImage) return;

    const imageSources = getCardImageSources(card);

    if (!imageSources.length) return;

    let activeIndex = Number.parseInt(card.dataset.wetuActiveImageIndex || '0', 10);
    if (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= imageSources.length) {
      activeIndex = 0;
    }

    const maxThumbCount = Math.min(imageSources.length, 4);
    if (activeIndex >= maxThumbCount) {
      activeIndex = 0;
    }

    if (imageSources.length < 2) {
      const existingRail = card.querySelector('.wetu-card-thumbnails');
      if (existingRail) existingRail.remove();
      setActiveCardImage(card, imageSources, activeIndex);
      return;
    }

    let thumbnailRail = card.querySelector('.wetu-card-thumbnails');
    if (!thumbnailRail) {
      thumbnailRail = document.createElement('div');
      thumbnailRail.className = 'wetu-card-thumbnails';
      imageContainer.appendChild(thumbnailRail);
    }

    const railSignature = imageSources.join('|');
    if (thumbnailRail.dataset.sources !== railSignature) {
      thumbnailRail.dataset.sources = railSignature;
      thumbnailRail.innerHTML = '';

      imageSources.slice(0, 4).forEach((source, index) => {
        const thumbnailButton = document.createElement('button');
        thumbnailButton.type = 'button';
        thumbnailButton.className = 'wetu-card-thumbnail';
        thumbnailButton.dataset.imageIndex = String(index);
        thumbnailButton.setAttribute('aria-label', `View image ${index + 1}`);

        const thumbnailImage = document.createElement('img');
        thumbnailImage.src = source;
        thumbnailImage.alt = `${card.dataset.wetuBridgeName || 'Accommodation'} photo ${index + 1}`;
        thumbnailImage.loading = 'lazy';
        thumbnailButton.appendChild(thumbnailImage);

        thumbnailButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          setActiveCardImage(card, imageSources, index);
          openResultGallery(card, index);
        });

        thumbnailRail.appendChild(thumbnailButton);
      });
    }

    setActiveCardImage(card, imageSources, activeIndex);

    if (!primaryImage.dataset.wetuGalleryBound) {
      primaryImage.dataset.wetuGalleryBound = 'true';
      primaryImage.addEventListener('click', (event) => {
        event.preventDefault();
        const currentIndex = Number.parseInt(card.dataset.wetuActiveImageIndex || '0', 10);
        const safeIndex = Number.isInteger(currentIndex) ? currentIndex : 0;
        openResultGallery(card, safeIndex);
      });
    }
  }

  function enhanceCardPresentation(card) {
    card.classList.add('wetu-card-enhanced');
  }

  function applyAssignmentToCard(card, assignment) {
    if (!assignment) return;

    registerAssignment(assignment);

    const imagePool = getAssignmentImageSources(assignment);
    const accommodationPrimaryImage = imagePool.accommodationImages[0] || assignment.image_url;
    const accommodationSecondaryImage = imagePool.accommodationImages[1] || assignment.secondary_image_url;
    const combinedGalleryImages = imagePool.allImages;

    cardImagePoolState.set(card, combinedGalleryImages);

    const primaryImage = card.querySelector('.accommodation-image.primary, .accommodation-image');
    if (primaryImage && accommodationPrimaryImage) {
      primaryImage.src = accommodationPrimaryImage;
      primaryImage.alt = assignment.title;
      primaryImage.classList.remove('error');
      primaryImage.classList.add('loaded');
      primaryImage.removeAttribute('srcset');
    }

    const secondaryImage = card.querySelector('.accommodation-image.secondary');
    if (secondaryImage && accommodationSecondaryImage) {
      secondaryImage.src = accommodationSecondaryImage;
      secondaryImage.alt = assignment.title;
      secondaryImage.removeAttribute('srcset');
    }

    const imageContainer = card.querySelector('.accommodation-image-container');
    if (imageContainer) {
      imageContainer.classList.remove('has-secondary', 'hover');
    }

    if (secondaryImage) {
      secondaryImage.remove();
    }

    const nameHeading = card.querySelector('.accommodation-name');
    let nameLink = card.querySelector('.accommodation-name-link');

    if (!nameLink && nameHeading) {
      nameLink = document.createElement('a');
      nameLink.className = 'accommodation-name-link';
      nameHeading.textContent = '';
      nameHeading.appendChild(nameLink);
    }

    if (nameLink) {
      nameLink.textContent = assignment.title;
      if (assignment.url) nameLink.href = assignment.url;
    } else if (nameHeading) {
      nameHeading.textContent = assignment.title;
    }

    const titleSection = card.querySelector('.accommodation-title-section');
    if (titleSection) {
      setPropertyContext(titleSection, assignment);
      setTagline(titleSection, assignment);
    }

    setCardLocation(card, assignment);
    setSummary(card, assignment);
    setRichDetails(card, assignment);

    if (assignment.variant_id) {
      card.dataset.variantId = assignment.variant_id;
      card.querySelectorAll(BUTTON_SELECTOR).forEach((button) => {
        button.dataset.variantId = assignment.variant_id;
      });
    }

    card.dataset.wetuBridgeName = assignment.title || '';
    card.dataset.wetuBridgeHandle = assignment.handle || '';
    card.dataset.wetuBridgeImage = accommodationPrimaryImage || '';
    card.dataset.wetuBridgeSecondaryImage = accommodationSecondaryImage || '';
    card.dataset.wetuBridgeTertiaryImage = imagePool.accommodationImages[2] || assignment.tertiary_image_url || '';
    card.dataset.wetuBridgePropertyImage = imagePool.propertyImages[0] || assignment.property_image_url || '';
    card.dataset.wetuBridgeGalleryCount = String(combinedGalleryImages.length || 0);
    card.dataset.wetuBridgeSummary = assignment.summary || '';
    card.dataset.wetuBridgeVariantId = assignment.variant_id || '';
    card.dataset.wetuBridgeProductId = assignment.product_id || '';
    card.dataset.wetuBridgePropertyName = assignment.property_title || '';
    card.dataset.wetuBridgePropertyHandle = assignment.property_handle || '';
    card.dataset.wetuBridgePropertyUrl = assignment.property_url || '';
    card.dataset.wetuBridgeLocation = assignment.location_display || '';
    card.dataset.wetuBridgeRoomType = assignment.room_type || '';
    card.dataset.wetuBridgeRoomBasis = assignment.room_basis || '';
    card.dataset.wetuBridgeBeds = assignment.beds_summary || '';
    card.dataset.wetuBridgeReady = 'true';
  }

  function applyBridgeAssignments(wrapper, bridgeData) {
    const cards = Array.from(wrapper.querySelectorAll(CARD_SELECTOR));
    if (!cards.length) return;

    const signature = cards.map((card) => card.dataset.accommodationId || '').join('|');
    const state = wrapperState.get(wrapper) || {};
    const needsRefresh = cards.some((card) => !card.dataset.wetuBridgeReady);

    if (state.signature === signature && !needsRefresh) return;

    cards.forEach((card) => {
      const sourceId = normalizeSourceId(card.dataset.accommodationId || '');

      let assignment = sourceId ? globalAssignmentsBySourceId.get(sourceId) : null;

      if (!assignment) {
        const matchPayload = getAccommodationMatchPayload({
          source_id: sourceId,
          handle: card.dataset.accommodationHandle || card.dataset.handle,
          name: inferAccommodationNameFromCard(card),
          property_handle: card.dataset.wetuBridgePropertyHandle || card.dataset.propertyHandle,
          property_name: inferPropertyNameFromCard(card),
        });

        assignment = (Array.isArray(bridgeData?.accommodations) ? bridgeData.accommodations : []).find((candidate) => {
          if (matchPayload.sourceId && normalizeSourceId(candidate?._source_id || candidate?.source_id) === matchPayload.sourceId) {
            return true;
          }

          if (matchPayload.propertyAndNameKey && String(candidate?._property_and_name_key || '').trim() === matchPayload.propertyAndNameKey) {
            return true;
          }

          if (matchPayload.handleKey && normalizeMatchKey(candidate?._handle_key || candidate?.handle) === matchPayload.handleKey) {
            return true;
          }

          return false;
        }) || null;
      }

      applyAssignmentToCard(card, assignment);
      enhanceCardPresentation(card);

      if (!card.dataset.wetuBridgeReady) {
        card.dataset.wetuBridgeReady = 'true';
      }
    });

    wrapperState.set(wrapper, { signature });
  }

  function setupWrapper(wrapper, bridgeData) {
    if (initializedWrappers.has(wrapper)) return;
    initializedWrappers.add(wrapper);

    wrapper.classList.add('wetu-bridge-active');

    let rafToken = null;
    const scheduleApply = function () {
      if (rafToken !== null) return;

      rafToken = window.requestAnimationFrame(() => {
        rafToken = null;
        applyBridgeAssignments(wrapper, bridgeData);
      });
    };

    wrapper.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest(BUTTON_SELECTOR);
        if (!button) return;

        const card = button.closest(CARD_SELECTOR);
        if (!card) return;

        rememberCardAssignment(card);

        if (card.dataset.wetuBridgeVariantId) {
          button.dataset.variantId = card.dataset.wetuBridgeVariantId;
          card.dataset.variantId = card.dataset.wetuBridgeVariantId;
        }

        patchResultPayloadFromCard(card);
      },
      true
    );

    const observer = new MutationObserver((mutations) => {
      const hasStructuralChange = mutations.some((mutation) => {
        return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
      });

      if (hasStructuralChange) scheduleApply();
    });

    observer.observe(wrapper, { childList: true, subtree: true });
    scheduleApply();
  }

  function startPrototypePatchLoop(bridgeData) {
    const maxAttempts = 120;
    let attempts = 0;

    const attemptPatch = function () {
      if (patchTravelSearchPrototype(bridgeData)) return;

      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(attemptPatch, 150);
      }
    };

    attemptPatch();
  }

  function boot() {
    const bridgeData = parseBridgeData();
    if (!bridgeData || !bridgeData.accommodations.length) return;

    installCartPayloadBridge();
    startPrototypePatchLoop(bridgeData);

    const bindWrappers = function (root) {
      if (!(root instanceof Element || root instanceof Document)) return;

      const wrappers = root.querySelectorAll(WRAPPER_SELECTOR);
      wrappers.forEach((wrapper) => setupWrapper(wrapper, bridgeData));
    };

    bindWrappers(document);

    const rootObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;

          if (node.matches(WRAPPER_SELECTOR)) {
            setupWrapper(node, bridgeData);
            continue;
          }

          if (node.querySelector(WRAPPER_SELECTOR)) {
            bindWrappers(node);
          }
        }
      }
    });

    rootObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
