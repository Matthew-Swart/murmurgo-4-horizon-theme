/**
 * ============================================================================
 * WETU ITINERARY MAP V2 - FULLSCREEN IMMERSIVE EXPERIENCE
 * ============================================================================
 * 
 * JavaScript controller for the fullscreen map with:
 * - Mapbox GL JS map initialization
 * - Accommodation markers with numbered badges
 * - Route lines (driving and flight)
 * - Card-marker interaction sync
 * - Timeline collapse/expand
 * - Map controls (fit bounds, zoom)
 * 
 * ============================================================================
 */

(function() {
  'use strict';

  // ============================================================================
  // CONFIGURATION
  // ============================================================================
  
  const CONFIG = {
    // Route colors
    routeColors: {
      driving: '#10b981',  // Emerald green
      flight: '#8b5cf6',   // Purple
      transfer: '#f59e0b', // Amber
      default: '#6b7280'   // Gray
    },
    // Route styles
    routeWidth: 3,
    routeWidthFlight: 2,
    flightDashArray: [4, 4],
    // Marker colors
    markerColor: '#10b981',
    markerActiveColor: '#059669',
    // Animation
    flyToDuration: 1500,
    fitBoundsPadding: { top: 120, bottom: 80, left: 420, right: 80 },
    fitBoundsPaddingMobile: { top: 80, bottom: 80, left: 280, right: 40 },
    // Map defaults
    defaultCenter: [25, -29], // Africa centered
    defaultZoom: 5
  };

  // ============================================================================
  // STATE
  // ============================================================================
  
  let map = null;
  let markers = [];
  let markersData = [];
  let routesData = [];
  let activeCardIndex = null;
  let popup = null;

  // DOM Elements
  let container = null;
  let mapCanvas = null;
  let timeline = null;
  let loadingEl = null;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  
  function init() {
    container = document.getElementById('itinerary-map-v2');
    if (!container) return;

    mapCanvas = document.getElementById('itinerary-map-canvas');
    timeline = container.querySelector('[data-timeline]');
    loadingEl = container.querySelector('.itinerary-map-v2__loading');

    // Parse data from DOM
    try {
      const markersAttr = mapCanvas.getAttribute('data-markers');
      const routesAttr = mapCanvas.getAttribute('data-routes');
      
      markersData = markersAttr ? JSON.parse(markersAttr) : [];
      routesData = routesAttr ? JSON.parse(routesAttr) : [];
    } catch (e) {
      console.error('Error parsing map data:', e);
      markersData = [];
      routesData = [];
    }

    // Get Mapbox token
    const mapboxToken = container.getAttribute('data-mapbox-token');
    if (!mapboxToken) {
      console.error('Mapbox token not found');
      hideLoading();
      return;
    }

    // Initialize Mapbox
    mapboxgl.accessToken = mapboxToken;

    // Get map style
    const mapStyleLight = container.getAttribute('data-map-style-light') || 'outdoors-v12';
    const mapStyle = `mapbox://styles/mapbox/${mapStyleLight}`;

    // Calculate initial bounds from markers
    const bounds = calculateBounds(markersData);
    
    // Create map
    map = new mapboxgl.Map({
      container: mapCanvas,
      style: mapStyle,
      center: bounds ? bounds.getCenter() : CONFIG.defaultCenter,
      zoom: CONFIG.defaultZoom,
      attributionControl: false,
      logoPosition: 'bottom-right'
    });

    // Add attribution control in custom position
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    // Wait for map to load
    map.on('load', () => {
      hideLoading();
      addRoutes();
      addMarkers();
      fitBoundsToAll(false);
      setupEventListeners();
    });

    // Handle map errors
    map.on('error', (e) => {
      console.error('Map error:', e);
      hideLoading();
    });
  }

  // ============================================================================
  // LOADING STATE
  // ============================================================================
  
  function hideLoading() {
    if (loadingEl) {
      loadingEl.classList.add('is-hidden');
    }
  }

  // ============================================================================
  // BOUNDS CALCULATION
  // ============================================================================
  
  function calculateBounds(markersArray) {
    if (!markersArray || markersArray.length === 0) return null;

    const bounds = new mapboxgl.LngLatBounds();
    
    markersArray.forEach(marker => {
      if (marker.lng && marker.lat) {
        bounds.extend([marker.lng, marker.lat]);
      }
    });

    // Also include route endpoints
    routesData.forEach(route => {
      if (route.startLng && route.startLat) {
        bounds.extend([route.startLng, route.startLat]);
      }
      if (route.endLng && route.endLat) {
        bounds.extend([route.endLng, route.endLat]);
      }
    });

    return bounds.isEmpty() ? null : bounds;
  }

  function fitBoundsToAll(animate = true) {
    const bounds = calculateBounds(markersData);
    if (!bounds) return;

    const isMobile = window.innerWidth <= 768;
    const padding = isMobile ? CONFIG.fitBoundsPaddingMobile : CONFIG.fitBoundsPadding;

    map.fitBounds(bounds, {
      padding: padding,
      maxZoom: 12,
      duration: animate ? CONFIG.flyToDuration : 0
    });
  }

  // ============================================================================
  // MARKERS
  // ============================================================================
  
  function addMarkers() {
    // Clear existing markers
    markers.forEach(m => m.remove());
    markers = [];

    markersData.forEach((data, index) => {
      const el = createMarkerElement(index + 1, data);
      
      const marker = new mapboxgl.Marker({
        element: el,
        anchor: 'center'
      })
        .setLngLat([data.lng, data.lat])
        .addTo(map);

      // Store reference
      marker._data = data;
      marker._index = index;
      markers.push(marker);

      // Marker click handler
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveCard(index);
        showPopup(data, [data.lng, data.lat]);
      });
    });
  }

  function createMarkerElement(number, data) {
    const el = document.createElement('div');
    el.className = 'marker-accommodation';
    el.setAttribute('data-content-id', data.contentId);
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${data.name} - Day ${data.day}`);

    const numberEl = document.createElement('span');
    numberEl.className = 'marker-accommodation__number';
    numberEl.textContent = number;
    el.appendChild(numberEl);

    return el;
  }

  function setActiveMarker(index) {
    markers.forEach((marker, i) => {
      const el = marker.getElement();
      if (i === index) {
        el.classList.add('is-active');
      } else {
        el.classList.remove('is-active');
      }
    });
  }

  // ============================================================================
  // POPUP
  // ============================================================================
  
  function showPopup(data, lngLat) {
    // Close existing popup
    if (popup) {
      popup.remove();
    }

    const html = createPopupHTML(data);
    
    popup = new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: '280px',
      offset: 20
    })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);

    popup.on('close', () => {
      popup = null;
    });
  }

  function createPopupHTML(data) {
    let html = '<div class="popup-content">';
    
    if (data.imageThumb) {
      html += `<img class="popup-content__image" src="${data.imageThumb}" alt="${escapeHtml(data.name)}">`;
    }
    
    html += '<div class="popup-content__body">';
    html += `<h3 class="popup-content__name">${escapeHtml(data.name)}</h3>`;
    
    const location = data.destination || data.region || data.country;
    if (location) {
      html += `<p class="popup-content__location">${escapeHtml(location)}</p>`;
    }
    
    html += '<div class="popup-content__meta">';
    
    if (data.nights) {
      html += `<span class="popup-content__nights">${data.nights} Night${data.nights !== 1 ? 's' : ''}</span>`;
    }
    
    if (data.url) {
      html += `<a href="${data.url}" class="popup-content__link" target="_blank" rel="noopener">View Details</a>`;
    }
    
    html += '</div></div></div>';
    
    return html;
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================================
  // ROUTES
  // ============================================================================
  
  function addRoutes() {
    routesData.forEach((route, index) => {
      const sourceId = `route-${index}`;
      const layerId = `route-line-${index}`;

      // Determine route type and color
      const isFlight = route.isFlight || isFlightRoute(route.mode);
      const color = isFlight ? CONFIG.routeColors.flight : CONFIG.routeColors.driving;

      // Build line coordinates
      let coordinates = [];
      
      // Try to use encoded polyline points first
      if (route.points && route.points.length > 10) {
        try {
          coordinates = decodePolyline(route.points);
        } catch (e) {
          console.warn('Failed to decode polyline for route', index);
        }
      }

      // Fallback to straight line between start and end
      if (coordinates.length < 2) {
        if (route.startLng && route.startLat && route.endLng && route.endLat) {
          if (isFlight) {
            // Create arc for flight
            coordinates = createFlightArc(
              [route.startLng, route.startLat],
              [route.endLng, route.endLat]
            );
          } else {
            coordinates = [
              [route.startLng, route.startLat],
              [route.endLng, route.endLat]
            ];
          }
        }
      }

      if (coordinates.length < 2) return;

      // Add source
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {
            mode: route.mode,
            label: route.label,
            duration: route.duration,
            distance: route.distanceKm
          },
          geometry: {
            type: 'LineString',
            coordinates: coordinates
          }
        }
      });

      // Add layer
      const layerConfig = {
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': color,
          'line-width': isFlight ? CONFIG.routeWidthFlight : CONFIG.routeWidth,
          'line-opacity': 0.8
        }
      };

      if (isFlight) {
        layerConfig.paint['line-dasharray'] = CONFIG.flightDashArray;
      }

      map.addLayer(layerConfig);
    });
  }

  function isFlightRoute(mode) {
    if (!mode) return false;
    const modeLower = mode.toLowerCase();
    return modeLower.includes('flight') || 
           modeLower.includes('scheduled') || 
           modeLower.includes('charter') || 
           modeLower.includes('helicopter');
  }

  function createFlightArc(start, end, numPoints = 50) {
    const coordinates = [];
    const startLng = start[0];
    const startLat = start[1];
    const endLng = end[0];
    const endLat = end[1];

    // Calculate distance for arc height
    const dx = endLng - startLng;
    const dy = endLat - startLat;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const arcHeight = distance * 0.15; // Arc height relative to distance

    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const lng = startLng + t * dx;
      const lat = startLat + t * dy;
      
      // Add arc (parabolic)
      const arc = Math.sin(Math.PI * t) * arcHeight;
      
      coordinates.push([lng, lat + arc]);
    }

    return coordinates;
  }

  // Decode Google-style encoded polyline
  function decodePolyline(encoded) {
    const coordinates = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
      let b;
      let shift = 0;
      let result = 0;

      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);

      const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lat += dlat;

      shift = 0;
      result = 0;

      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);

      const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lng += dlng;

      coordinates.push([lng / 1e5, lat / 1e5]);
    }

    return coordinates;
  }

  // ============================================================================
  // CARD-MARKER INTERACTION
  // ============================================================================
  
  function setActiveCard(index) {
    activeCardIndex = index;
    
    // Update card UI
    const cards = container.querySelectorAll('.itinerary-card');
    cards.forEach((card, i) => {
      if (i === index) {
        card.classList.add('is-active');
        // Scroll card into view
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        card.classList.remove('is-active');
      }
    });

    // Update marker UI
    setActiveMarker(index);

    // Fly to marker location
    const markerData = markersData[index];
    if (markerData) {
      map.flyTo({
        center: [markerData.lng, markerData.lat],
        zoom: Math.max(map.getZoom(), 10),
        duration: CONFIG.flyToDuration
      });
    }
  }

  // ============================================================================
  // EVENT LISTENERS
  // ============================================================================
  
  function setupEventListeners() {
    // Card click handlers
    const cards = container.querySelectorAll('.itinerary-card');
    cards.forEach((card, index) => {
      card.addEventListener('click', () => {
        setActiveCard(index);
        const data = markersData[index];
        if (data) {
          showPopup(data, [data.lng, data.lat]);
        }
      });

      // Keyboard accessibility
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setActiveCard(index);
          const data = markersData[index];
          if (data) {
            showPopup(data, [data.lng, data.lat]);
          }
        }
      });
    });

    // Timeline toggle
    const toggleBtn = container.querySelector('[data-timeline-toggle]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        timeline.classList.toggle('is-collapsed');
      });
    }

    // Map controls
    const fitBtn = container.querySelector('[data-map-fit]');
    if (fitBtn) {
      fitBtn.addEventListener('click', () => {
        fitBoundsToAll(true);
        // Close popup and deselect
        if (popup) popup.remove();
        setActiveMarker(-1);
        activeCardIndex = null;
        container.querySelectorAll('.itinerary-card.is-active').forEach(c => c.classList.remove('is-active'));
      });
    }

    const zoomInBtn = container.querySelector('[data-map-zoom-in]');
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        map.zoomIn({ duration: 300 });
      });
    }

    const zoomOutBtn = container.querySelector('[data-map-zoom-out]');
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        map.zoomOut({ duration: 300 });
      });
    }

    // Close popup on map click
    map.on('click', (e) => {
      // Check if click was on a marker
      const targetClasses = e.originalEvent.target.classList;
      if (!targetClasses.contains('marker-accommodation') && 
          !targetClasses.contains('marker-accommodation__number')) {
        if (popup) popup.remove();
      }
    });

    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        map.resize();
      }, 250);
    });
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  
  // Wait for DOM and Mapbox to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

