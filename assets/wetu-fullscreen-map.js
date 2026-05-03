/**
 * ============================================================================
 * WETU FULLSCREEN JOURNEY MAP
 * ============================================================================
 * 
 * An immersive, full-page interactive map for WETU itinerary products.
 * Features:
 * - Mapbox GL JS integration
 * - 16:9 rectangle markers with thumbnail images
 * - Single popup mode (replaces previous popup)
 * - Popup arrows pointing close to exact location
 * - Popups for destinations, accommodations, activities, routes, and flights
 * - Driving routes via Mapbox Directions or GPS points
 * - Flight paths as curved arcs
 * - Light/Dark theme toggle
 * - Synchronized timeline panel with horizontal mobile scroll
 * - Mobile-optimized drawer with swipe navigation
 * 
 * ============================================================================
 */

class WetuFullscreenMap {
  constructor() {
    this.container = document.getElementById('wetu-fullscreen-map-container');
    if (!this.container) return;

    this.canvas = document.getElementById('wetu-fullscreen-map-canvas');
    if (!this.canvas) return;

    // Parse configuration
    this.config = {
      markers: this.parseJSON(this.canvas.dataset.markers, []),
      routes: this.parseJSON(this.canvas.dataset.routes, []),
      activities: this.parseJSON(this.canvas.dataset.activities, []),
      destinations: this.parseJSON(this.canvas.dataset.destinations, []),
      styleLight: this.canvas.dataset.styleLight || 'outdoors-v12',
      styleDark: this.canvas.dataset.styleDark || 'outdoors-v12',
      animate: this.canvas.dataset.animate === 'true',
      showActivities: this.canvas.dataset.showActivities === 'true',
      routeColors: {
        driving: this.canvas.dataset.routeColorDriving || '#3b82f6',
        flight: this.canvas.dataset.routeColorFlight || '#8b5cf6',
        transfer: this.canvas.dataset.routeColorTransfer || '#10b981'
      },
      accessToken: this.canvas.dataset.mapboxToken || ''
    };

    // State
    this.map = null;
    this.markerElements = new Map();
    this.activityMarkerElements = new Map();
    this.routeAnnotations = new Map();
    this.flightIconPositions = new Map(); // Store flight icon positions for popup positioning
    this.routeData = new Map(); // Store route data for later lookup
    this.activeMarkerId = null;
    this.currentStopIndex = 0;
    this.popup = null; // Single popup instance
    this.currentTheme = this.container.dataset.defaultTheme || 'light';
    this.currentMapStyle = this.config.styleLight;
    this.isTimelineCollapsed = false;
    
    // Available Mapbox styles
    this.mapStyles = {
      'streets-v12': 'mapbox://styles/mapbox/streets-v12',
      'outdoors-v12': 'mapbox://styles/mapbox/outdoors-v12',
      'light-v11': 'mapbox://styles/mapbox/light-v11',
      'dark-v11': 'mapbox://styles/mapbox/dark-v11',
      'satellite-v9': 'mapbox://styles/mapbox/satellite-v9',
      'satellite-streets-v12': 'mapbox://styles/mapbox/satellite-streets-v12',
      'navigation-day-v1': 'mapbox://styles/mapbox/navigation-day-v1',
      'navigation-night-v1': 'mapbox://styles/mapbox/navigation-night-v1'
    };

    // Elements
    this.timelinePanel = this.container.querySelector('[data-timeline-panel]');
    this.routePanel = this.container.querySelector('[data-route-panel]');

    // Initialize
    if (this.config.accessToken) {
      this.init();
    } else {
      console.warn('WetuFullscreenMap: Mapbox access token not configured');
      this.showError('Map configuration required. Please add your Mapbox access token in theme settings.');
    }
  }

  /**
   * Parse JSON safely with better error handling
   */
  parseJSON(str, fallback = []) {
    if (!str || str === '' || str === 'null' || str === 'undefined') {
      return fallback;
    }
    
    try {
      const cleanedStr = str
        .replace(/[\x00-\x1F\x7F]/g, '')
        .replace(/\\/g, '\\\\')
        .replace(/\\\\"/g, '\\"');
      
      const parsed = JSON.parse(str);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (e) {
      console.warn('WetuFullscreenMap: Failed to parse JSON', e.message);
      try {
        const simplified = str.replace(/,\s*\}/g, '}').replace(/,\s*\]/g, ']');
        const parsed = JSON.parse(simplified);
        return Array.isArray(parsed) ? parsed : fallback;
      } catch (e2) {
        console.warn('WetuFullscreenMap: JSON recovery failed', e2.message);
        return fallback;
      }
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    const loading = this.canvas.querySelector('.wetu-fullscreen-map__loading');
    if (loading) {
      loading.innerHTML = `
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
        <span>${message}</span>
      `;
    }
  }

  /**
   * Initialize the map
   */
  async init() {
    try {
      mapboxgl.accessToken = this.config.accessToken;

      // ALWAYS use Mapbox Outdoors style for full-color terrain visualization
      // This overrides any theme customizer settings to ensure the colorful map is shown
      const mapStyle = 'mapbox://styles/mapbox/outdoors-v12';

      const bounds = this.calculateBounds();

      this.map = new mapboxgl.Map({
        container: this.canvas,
        style: mapStyle,
        bounds: bounds,
        fitBoundsOptions: {
          padding: this.getMapPadding(),
          maxZoom: 10
        },
        attributionControl: false
      });

      this.map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

      this.map.on('load', () => {
        this.canvas.classList.add('map-loaded');
        this.addMarkers();
        this.addRoutes();
        if (this.config.showActivities) {
          this.addActivityMarkers();
        }
        this.bindEventListeners();
        
        const styleSelect = this.container.querySelector('[data-map-style-select]');
        if (styleSelect) {
          styleSelect.value = this.config.styleLight;
        }
        
        if (this.config.markers.length > 0) {
          this.setActiveMarker(this.config.markers[0].id, false);
        }
      });

      this.map.on('resize', () => {
        this.fitBounds();
      });

      // Close popup when clicking on empty map area
      this.map.on('click', (e) => {
        const features = this.map.queryRenderedFeatures(e.point);
        const isInteractiveFeature = features.some(f => 
          f.layer.id.includes('route-')
        );
        
        if (!isInteractiveFeature) {
          // Don't close if clicked on a marker element
          const clickedMarker = e.originalEvent.target.closest('.wetu-map-marker, .wetu-activity-marker, .wetu-airport-marker, .wetu-flight-icon, .wetu-flight-label, .wetu-drive-label');
          if (!clickedMarker) {
            this.closePopup();
          }
        }
      });

    } catch (error) {
      console.error('WetuFullscreenMap: Initialization failed', error);
      this.showError('Failed to load map. Please try again later.');
    }
  }

  /**
   * Close any open popup
   */
  closePopup() {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
  }

  /**
   * Get map padding based on viewport
   */
  getMapPadding() {
    const isMobile = window.innerWidth < 900;
    const timelineWidth = this.isTimelineCollapsed ? 48 : 380;
    
    if (isMobile) {
      return { top: 100, bottom: 360, left: 40, right: 40 };
    }
    
    return { 
      top: 100, 
      bottom: 100, 
      left: timelineWidth + 40, 
      right: 80 
    };
  }

  /**
   * Calculate bounds from markers
   */
  calculateBounds() {
    if (!this.config.markers.length) {
      return [[-20, -35], [55, 40]];
    }

    const bounds = new mapboxgl.LngLatBounds();
    
    this.config.markers.forEach(marker => {
      if (marker.lat && marker.lng) {
        bounds.extend([marker.lng, marker.lat]);
      }
    });

    this.config.routes.forEach(route => {
      if (route.startLat && route.startLng) {
        bounds.extend([route.startLng, route.startLat]);
      }
      if (route.endLat && route.endLng) {
        bounds.extend([route.endLng, route.endLat]);
      }
    });

    return bounds;
  }

  /**
   * Fit map to bounds
   */
  fitBounds() {
    const bounds = this.calculateBounds();
    this.map.fitBounds(bounds, {
      padding: this.getMapPadding(),
      maxZoom: 10,
      duration: 1000
    });
  }

  /**
   * Add accommodation markers - 16:9 Rectangle Thumbnails
   */
  addMarkers() {
    const sorted = [...this.config.markers].sort((a, b) => a.sequence - b.sequence);

    sorted.forEach((marker, index) => {
      if (!marker.lat || !marker.lng) return;

      const el = document.createElement('div');
      el.dataset.markerId = marker.id;
      
      // Use 16:9 thumbnail if image available
      if (marker.imageThumb) {
        el.className = 'wetu-map-marker wetu-map-marker--thumbnail';
        el.innerHTML = `
          <img src="${marker.imageThumb}" alt="${marker.name}" />
          <span class="wetu-map-marker__number">${index + 1}</span>
        `;
      } else {
        el.className = 'wetu-map-marker';
        el.textContent = index + 1;
      }

      const mapMarker = new mapboxgl.Marker({
        element: el,
        anchor: 'bottom'
      })
        .setLngLat([marker.lng, marker.lat])
        .addTo(this.map);

      this.markerElements.set(marker.id, { element: el, marker: mapMarker, data: marker, index });

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showMarkerPopup(marker);
        this.setActiveMarker(marker.id);
        this.scrollTimelineToIndex(index);
      });
    });
  }

  /**
   * Add activity markers
   */
  addActivityMarkers() {
    this.config.activities.forEach(activity => {
      if (!activity.lat || !activity.lng) return;
      
      // Skip if same location as parent
      if (activity.parentLat && activity.parentLng) {
        const latDiff = Math.abs(activity.lat - activity.parentLat);
        const lngDiff = Math.abs(activity.lng - activity.parentLng);
        if (latDiff < 0.01 && lngDiff < 0.01) {
          return;
        }
      }

      const el = document.createElement('div');
      el.className = 'wetu-activity-marker';
      el.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      `;

      const mapMarker = new mapboxgl.Marker({
        element: el,
        anchor: 'center'
      })
        .setLngLat([activity.lng, activity.lat])
        .addTo(this.map);

      this.activityMarkerElements.set(activity.id, { element: el, marker: mapMarker, data: activity });

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showActivityPopup(activity);
      });
    });
  }

  /**
   * Show marker popup - REPLACES any existing popup
   * Uses square image with text overlay and white outline button
   */
  showMarkerPopup(marker) {
    this.closePopup();

    const nightsText = marker.nights === 1 ? '1 night' : `${marker.nights} nights`;
    const daysText = marker.day === marker.dayEnd 
      ? `Day ${marker.day}` 
      : `Days ${marker.day}-${marker.dayEnd}`;
    
    const locationText = [marker.destination, marker.country]
      .filter(Boolean)
      .join(', ');

    // Generate square image URL (600x600 for better quality)
    const squareImageUrl = marker.image ? marker.image.replace(/width=\d+/, 'width=600').replace(/height=\d+/, 'height=600') : '';

    const popupContent = marker.image ? `
      <div class="wetu-map-popup">
        <div class="wetu-map-popup__image-container">
          <img src="${squareImageUrl}" alt="${marker.name}" class="wetu-map-popup__image">
          <div class="wetu-map-popup__content">
            <h4 class="wetu-map-popup__title">${marker.name}</h4>
            <div class="wetu-map-popup__meta">
              <span>${daysText}</span>
              <span>•</span>
              <span>${nightsText}</span>
            </div>
            ${locationText ? `<p class="wetu-map-popup__location">${locationText}</p>` : ''}
            <div class="wetu-map-popup__actions">
              ${marker.url ? `
                <a href="${marker.url}" class="wetu-map-popup__link" target="_blank" rel="noopener">
                  View Property
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    ` : `
      <div class="wetu-map-popup wetu-map-popup--no-image">
        <div class="wetu-map-popup__content">
          <h4 class="wetu-map-popup__title">${marker.name}</h4>
          <div class="wetu-map-popup__meta">
            <span>${daysText}</span>
            <span>•</span>
            <span>${nightsText}</span>
          </div>
          ${locationText ? `<p class="wetu-map-popup__location">${locationText}</p>` : ''}
          <div class="wetu-map-popup__actions">
            ${marker.url ? `
              <a href="${marker.url}" class="wetu-map-popup__link" target="_blank" rel="noopener">
                View Property
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    this.popup = new mapboxgl.Popup({
      offset: [0, -10],
      closeButton: true,
      closeOnClick: false,
      maxWidth: '320px',
      anchor: 'bottom'
    })
      .setLngLat([marker.lng, marker.lat])
      .setHTML(popupContent)
      .addTo(this.map);
  }

  /**
   * Show activity popup - REPLACES any existing popup
   */
  showActivityPopup(activity) {
    this.closePopup();

    const popupContent = `
      <div class="wetu-map-popup">
        ${activity.image ? `<img src="${activity.image}" alt="${activity.name}" class="wetu-map-popup__image">` : ''}
        <div class="wetu-map-popup__content">
          <h4 class="wetu-map-popup__title">${activity.name}</h4>
          <div class="wetu-map-popup__meta">
            <span>${activity.category || 'Activity'}</span>
            <span>•</span>
            <span>${activity.type || 'Included'}</span>
          </div>
          ${activity.url ? `
            <div class="wetu-map-popup__actions">
              <a href="${activity.url}" class="wetu-map-popup__link" target="_blank" rel="noopener">
                Learn More
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </a>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this.popup = new mapboxgl.Popup({
      offset: [0, -10],
      closeButton: true,
      closeOnClick: false,
      maxWidth: '300px',
      anchor: 'bottom'
    })
      .setLngLat([activity.lng, activity.lat])
      .setHTML(popupContent)
      .addTo(this.map);
  }

  /**
   * Show destination popup - REPLACES any existing popup
   */
  showDestinationPopup(destination) {
    this.closePopup();

    const popupContent = `
      <div class="wetu-map-popup">
        ${destination.image ? `<img src="${destination.image}" alt="${destination.name}" class="wetu-map-popup__image">` : ''}
        <div class="wetu-map-popup__content">
          <h4 class="wetu-map-popup__title">${destination.name}</h4>
          <div class="wetu-map-popup__meta">
            ${destination.region ? `<span>${destination.region}</span>` : ''}
            ${destination.region && destination.country ? '<span>•</span>' : ''}
            ${destination.country ? `<span>${destination.country}</span>` : ''}
          </div>
          ${destination.description ? `<p class="wetu-map-popup__description">${destination.description}</p>` : ''}
          ${destination.url ? `
            <div class="wetu-map-popup__actions">
              <a href="${destination.url}" class="wetu-map-popup__link" target="_blank" rel="noopener">
                Explore Destination
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this.popup = new mapboxgl.Popup({
      offset: [0, -10],
      closeButton: true,
      closeOnClick: false,
      maxWidth: '340px',
      anchor: 'bottom'
    })
      .setLngLat([destination.lng, destination.lat])
      .setHTML(popupContent)
      .addTo(this.map);
  }

  /**
   * Show route popup - REPLACES any existing popup
   * Self-drive routes: NO image, just text info
   * Flights: Show at flight icon position
   */
  showRoutePopup(route, lngLat) {
    this.closePopup();

    const isFlightMode = ['ScheduledFlight', 'CharterFlight', 'Helicopter'].includes(route.mode);
    const modeLower = (route.mode || '').toLowerCase();
    const isSelfDrive = modeLower.includes('self') || modeLower.includes('drive');
    
    const googleMapsUrl = !isFlightMode 
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(route.startLocation)}&destination=${encodeURIComponent(route.endLocation)}&travelmode=driving`
      : null;
    
    // Get route type label
    let modeLabel = route.mode;
    if (modeLower.includes('flight') || modeLower.includes('scheduled') || modeLower.includes('charter')) {
      modeLabel = 'Flight';
    } else if (modeLower.includes('helicopter')) {
      modeLabel = 'Helicopter';
    } else if (isSelfDrive) {
      modeLabel = 'Self-Drive';
    } else if (modeLower.includes('transfer')) {
      modeLabel = 'Transfer';
    }

    // Self-drive routes: NO image (clean text-only design)
    // Flights and other routes: Also no image to keep consistent
    const popupContent = `
      <div class="wetu-map-popup wetu-map-popup--route">
        <div class="wetu-map-popup__content">
          <h4 class="wetu-map-popup__title">${modeLabel}</h4>
          <div class="wetu-map-popup__meta">
            ${route.duration ? `<span>${route.duration}</span>` : ''}
            ${route.duration && route.distanceKm ? `<span>•</span>` : ''}
            ${route.distanceKm ? `<span>${route.distanceKm} km</span>` : ''}
          </div>
          <p class="wetu-map-popup__location">${this.getCleanLocationName(route.startLocation)} → ${this.getCleanLocationName(route.endLocation)}</p>
          ${route.agency ? `<p style="font-size: 0.8rem; color: var(--wfm-text-muted); margin: 0;">${route.agency}</p>` : ''}
          <div class="wetu-map-popup__actions" style="margin-top: 12px;">
            ${googleMapsUrl ? `
              <a href="${googleMapsUrl}" class="wetu-map-popup__link" target="_blank" rel="noopener">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                Open in Google Maps
              </a>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    this.popup = new mapboxgl.Popup({
      offset: [0, 10],
      closeButton: true,
      closeOnClick: false,
      maxWidth: '320px'
    })
      .setLngLat(lngLat)
      .setHTML(popupContent)
      .addTo(this.map);
  }

  /**
   * Set active marker
   */
  setActiveMarker(markerId, animate = true) {
    if (this.activeMarkerId) {
      const prev = this.markerElements.get(this.activeMarkerId);
      if (prev) {
        prev.element.classList.remove('active');
      }
    }

    const current = this.markerElements.get(markerId);
    if (current) {
      current.element.classList.add('active');
      this.currentStopIndex = current.index;
      
      this.updateNavigationDots();
      this.updateTimelineActive(markerId);

      if (animate && this.config.animate) {
        this.map.flyTo({
          center: [current.data.lng, current.data.lat],
          zoom: 11,
          duration: 1500
        });
      }
    }

    this.activeMarkerId = markerId;
  }

  /**
   * Update timeline active state
   */
  updateTimelineActive(markerId) {
    if (!this.timelinePanel) return;
    
    this.timelinePanel.querySelectorAll('[data-timeline-card]').forEach(card => {
      card.classList.toggle('active', card.dataset.markerId === markerId);
    });
    
    this.timelinePanel.querySelectorAll('.wetu-event-card--accommodation').forEach(card => {
      const isActive = card.dataset.markerId === markerId;
      card.classList.toggle('active', isActive);
    });
  }

  /**
   * Update navigation dots
   */
  updateNavigationDots() {
    const dots = this.container.querySelectorAll('[data-nav-dot]');
    dots.forEach((dot, index) => {
      dot.classList.toggle('active', index === this.currentStopIndex);
    });

    const prevBtn = this.container.querySelector('[data-nav-prev]');
    const nextBtn = this.container.querySelector('[data-nav-next]');
    
    if (prevBtn) {
      prevBtn.disabled = this.currentStopIndex === 0;
    }
    if (nextBtn) {
      nextBtn.disabled = this.currentStopIndex >= this.config.markers.length - 1;
    }
  }

  /**
   * Scroll timeline to index
   */
  scrollTimelineToIndex(index) {
    if (!this.timelinePanel) return;
    
    const scrollContainer = this.timelinePanel.querySelector('[data-timeline-scroll]');
    if (!scrollContainer) return;
    
    const isMobile = window.innerWidth < 900;
    
    const journeyDays = this.timelinePanel.querySelectorAll('.wetu-journey-day');
    if (journeyDays.length > 0 && journeyDays[index]) {
      const targetDay = journeyDays[index];
      if (isMobile) {
        targetDay.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      } else {
        targetDay.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    
    const cards = this.timelinePanel.querySelectorAll('[data-timeline-card]');
    const card = cards[index];
    
    if (card) {
      if (isMobile) {
        card.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      } else {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  /**
   * Navigate to stop
   */
  navigateToStop(index) {
    if (index < 0 || index >= this.config.markers.length) return;
    
    const marker = this.config.markers[index];
    if (marker) {
      this.setActiveMarker(marker.id);
      this.showMarkerPopup(marker);
      this.scrollTimelineToIndex(index);
    }
  }

  /**
   * Add routes to the map
   */
  async addRoutes() {
    const sorted = [...this.config.routes].sort((a, b) => a.sequence - b.sequence);
    let sequenceNumber = 1;

    for (const route of sorted) {
      if (!route.startLat || !route.startLng || !route.endLat || !route.endLng) continue;

      const isFlightMode = ['ScheduledFlight', 'CharterFlight', 'Helicopter'].includes(route.mode);

      if (isFlightMode) {
        this.addFlightRoute(route, sequenceNumber);
      } else {
        await this.addDrivingRoute(route, sequenceNumber);
      }
      sequenceNumber++;
    }
  }

  /**
   * Change map style
   */
  changeMapStyle(styleId) {
    if (!this.mapStyles[styleId]) return;
    
    this.currentMapStyle = styleId;
    const newStyle = this.mapStyles[styleId];
    
    const center = this.map.getCenter();
    const zoom = this.map.getZoom();
    
    this.map.setStyle(newStyle);
    
    this.map.once('style.load', () => {
      this.routeAnnotations.forEach(({ marker }) => marker.remove());
      this.routeAnnotations.clear();
      
      this.markerElements.forEach(({ marker }) => marker.remove());
      this.markerElements.clear();
      
      if (this.config.showActivities) {
        this.activityMarkerElements.forEach(({ marker }) => marker.remove());
        this.activityMarkerElements.clear();
      }
      
      this.addMarkers();
      this.addRoutes();
      if (this.config.showActivities) {
        this.addActivityMarkers();
      }
      
      this.map.setCenter(center);
      this.map.setZoom(zoom);
      
      if (this.activeMarkerId) {
        this.setActiveMarker(this.activeMarkerId, false);
      }
    });
  }

  /**
   * Fetch real road directions from Mapbox Directions API
   */
  async fetchMapboxDirections(startLng, startLat, endLng, endLat) {
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${startLng},${startLat};${endLng},${endLat}?geometries=geojson&overview=full&access_token=${this.config.accessToken}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Directions API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.routes && data.routes.length > 0) {
        const routeData = data.routes[0];
        return {
          coordinates: routeData.geometry.coordinates,
          distance: Math.round(routeData.distance / 1000 * 10) / 10,
          duration: this.formatDuration(routeData.duration)
        };
      }
      
      return null;
    } catch (error) {
      console.warn('Failed to fetch Mapbox directions:', error.message);
      return null;
    }
  }
  
  /**
   * Format duration from seconds to human readable
   */
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}`;
    }
    return `0:${minutes.toString().padStart(2, '0')}`;
  }

  /**
   * Add driving route
   * PRIORITY ORDER:
   * 1. Mapbox Directions API - for accurate road-following routes
   * 2. WETU encoded polyline points - if Mapbox fails
   * 3. Straight line fallback - if both fail
   */
  async addDrivingRoute(route, sequenceNumber) {
    const routeId = `route-driving-${route.id}`;
    let coordinates = null;
    let routeDistance = route.distanceKm;
    let routeDuration = route.duration;
    let routeSource = 'fallback';

    // First, try Mapbox Directions API for accurate driving route
    // This gives us actual road-following geometry
    try {
      const directions = await this.fetchMapboxDirections(
        route.startLng, route.startLat, 
        route.endLng, route.endLat
      );
      
      if (directions && directions.coordinates && directions.coordinates.length >= 2) {
        coordinates = directions.coordinates;
        routeSource = 'mapbox';
        // Update distance/duration from Mapbox if we got them
        if (directions.distance && directions.distance > 0) {
          routeDistance = directions.distance;
        }
        if (directions.duration) {
          routeDuration = directions.duration;
        }
        console.log(`WetuFullscreenMap: Route ${route.id} using Mapbox Directions (${coordinates.length} points)`);
      }
    } catch (e) {
      console.warn(`WetuFullscreenMap: Mapbox Directions failed for route ${route.id}:`, e.message);
    }

    // Fallback to WETU polyline points if Mapbox Directions failed
    if (!coordinates || coordinates.length < 2) {
      if (route.points && route.points.length > 0) {
        const wetuCoords = this.parseRoutePoints(route.points);
        if (wetuCoords && wetuCoords.length >= 2) {
          coordinates = wetuCoords;
          routeSource = 'wetu';
          console.log(`WetuFullscreenMap: Route ${route.id} using WETU polyline (${coordinates.length} points)`);
        }
      }
    }

    // Ultimate fallback: straight line between points
    if (!coordinates || coordinates.length < 2) {
      coordinates = [
        [route.startLng, route.startLat],
        [route.endLng, route.endLat]
      ];
      routeSource = 'straight';
      console.log(`WetuFullscreenMap: Route ${route.id} using straight line fallback`);
    }

    let color = this.config.routeColors.driving;
    const modeLower = (route.mode || '').toLowerCase();
    if (modeLower.includes('transfer')) {
      color = this.config.routeColors.transfer;
    }

    if (this.map.getSource(routeId)) {
      this.map.removeLayer(routeId);
      this.map.removeLayer(`${routeId}-border`);
      this.map.removeSource(routeId);
    }

    this.map.addSource(routeId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {
          mode: route.mode,
          label: route.routeLabel || route.label,
          distance: routeDistance,
          duration: routeDuration
        },
        geometry: {
          type: 'LineString',
          coordinates: coordinates
        }
      }
    });

    this.map.addLayer({
      id: `${routeId}-border`,
      type: 'line',
      source: routeId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': this.currentTheme === 'dark' ? '#000' : '#fff',
        'line-width': 7,
        'line-opacity': 0.5
      }
    });

    this.map.addLayer({
      id: routeId,
      type: 'line',
      source: routeId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': color,
        'line-width': 4,
        'line-opacity': 0.9
      }
    });

    const enhancedRoute = {
      ...route,
      distanceKm: routeDistance,
      duration: routeDuration
    };

    // Add label at midpoint
    this.addDriveLabel(enhancedRoute, coordinates);

    this.map.on('click', routeId, (e) => {
      this.showRoutePopup(enhancedRoute, e.lngLat);
    });

    this.map.on('mouseenter', routeId, () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', routeId, () => {
      this.map.getCanvas().style.cursor = '';
    });
  }

  /**
   * Add drive label at midpoint and store position for later use
   * Now includes date/day label to distinguish duplicate routes (A→B and B→A)
   */
  addDriveLabel(route, coordinates) {
    const midIndex = Math.floor(coordinates.length / 2);
    const position = coordinates[midIndex];
    
    // Store the drive label position and route data for use when clicking from timeline
    // Use the same ID format as the route source
    const routeIdKey = route.id.replace('route-', '').replace('driving-', '').replace('flight-', '');
    this.routeData.set(routeIdKey, route);
    // Don't overwrite flight positions with drive positions
    if (!this.flightIconPositions.has(routeIdKey)) {
      this.flightIconPositions.set(routeIdKey, { lng: position[0], lat: position[1] });
    }
    
    let infoText = '';
    if (route.duration) {
      infoText += route.duration;
    }
    if (route.distanceKm && route.distanceKm > 0) {
      if (infoText) infoText += ' · ';
      infoText += `${route.distanceKm} km`;
    }
    
    // Get date label for distinguishing duplicate routes
    const dateLabel = route.dateLabel || (route.startDay ? `Day ${route.startDay}` : '');

    const el = document.createElement('div');
    el.className = 'wetu-drive-label';
    el.innerHTML = `
      <div class="wetu-drive-label__top">
        <svg class="wetu-drive-label__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>
          <path d="M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>
          <path d="M5 17H3v-6l2-5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0H9"/>
        </svg>
        ${infoText ? `<span>${infoText}</span>` : ''}
      </div>
      ${dateLabel ? `<span class="wetu-drive-label__date">${dateLabel}</span>` : ''}
    `;

    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat(position)
      .addTo(this.map);
    
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showRoutePopup(route, { lng: position[0], lat: position[1] });
    });
  }

  /**
   * Get clean location name
   */
  getCleanLocationName(location) {
    if (!location) return '';
    return location.replace(/\s*\[.*?\]\s*/, '').trim();
  }

  /**
   * Decode Google's encoded polyline format to coordinate array
   * Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
   */
  decodePolyline(encoded) {
    if (!encoded) return [];
    
    const coords = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    
    while (index < encoded.length) {
      // Decode latitude
      let shift = 0;
      let result = 0;
      let byte;
      
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      
      const deltaLat = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lat += deltaLat;
      
      // Decode longitude
      shift = 0;
      result = 0;
      
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      
      const deltaLng = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lng += deltaLng;
      
      // Add coordinate (Mapbox uses [lng, lat] format)
      coords.push([lng / 1e5, lat / 1e5]);
    }
    
    return coords;
  }

  /**
   * Parse route points from WETU format
   * Handles both JSON-wrapped encoded polylines and legacy semicolon-separated format
   */
  parseRoutePoints(pointsString) {
    if (!pointsString) return [];
    
    try {
      // Try to parse as JSON first (WETU's new format)
      // Format: {"v":1,"f":"polyline","d":"encoded_polyline_string"}
      if (pointsString.startsWith('{') || pointsString.includes('"f":"polyline"')) {
        const parsed = JSON.parse(pointsString);
        if (parsed && parsed.f === 'polyline' && parsed.d) {
          const coords = this.decodePolyline(parsed.d);
          if (coords.length >= 2) {
            console.log(`WetuFullscreenMap: Decoded ${coords.length} points from WETU polyline`);
            return coords;
          }
        }
      }
      
      // Legacy format: semicolon-separated lat;lng pairs
      const parts = pointsString.split(';');
      const coords = [];
      
      for (let i = 0; i < parts.length - 1; i += 2) {
        const lat = parseFloat(parts[i]);
        const lng = parseFloat(parts[i + 1]);
        if (!isNaN(lat) && !isNaN(lng)) {
          coords.push([lng, lat]);
        }
      }
      
      if (coords.length >= 2) {
        console.log(`WetuFullscreenMap: Parsed ${coords.length} points from semicolon format`);
        return coords;
      }
      
      return [];
    } catch (e) {
      console.warn('WetuFullscreenMap: Failed to parse route points', e);
      return [];
    }
  }

  /**
   * Add flight route
   */
  addFlightRoute(route, sequenceNumber) {
    const routeId = `route-flight-${route.id}`;
    
    const arcCoordinates = this.createArc(
      [route.startLng, route.startLat],
      [route.endLng, route.endLat],
      50
    );

    this.map.addSource(routeId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {
          mode: route.mode,
          label: route.routeLabel || route.label,
          agency: route.agency,
          vehicle: route.vehicle,
          duration: route.duration
        },
        geometry: {
          type: 'LineString',
          coordinates: arcCoordinates
        }
      }
    });

    this.map.addLayer({
      id: routeId,
      type: 'line',
      source: routeId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': this.config.routeColors.flight,
        'line-width': 3,
        'line-dasharray': [4, 4],
        'line-opacity': 0.9
      }
    });

    this.addFlightIcon(route, arcCoordinates);
    this.addAirportMarker(route, 'start');
    this.addAirportMarker(route, 'end');

    this.map.on('click', routeId, (e) => {
      this.showRoutePopup(route, e.lngLat);
    });

    this.map.on('mouseenter', routeId, () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', routeId, () => {
      this.map.getCanvas().style.cursor = '';
    });
  }

  /**
   * Add airport marker
   */
  addAirportMarker(route, position) {
    const coords = position === 'start' 
      ? [route.startLng, route.startLat]
      : [route.endLng, route.endLat];
    
    const location = position === 'start' 
      ? route.startLocation 
      : route.endLocation;
    
    const isAirport = /airport|airstrip|\[.*\]/i.test(location);
    if (!isAirport) return;

    const el = document.createElement('div');
    el.className = 'wetu-airport-marker';
    el.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
      </svg>
    `;
    el.title = location;

    const marker = new mapboxgl.Marker({
      element: el,
      anchor: 'center'
    })
      .setLngLat(coords)
      .addTo(this.map);
    
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showRoutePopup(route, { lng: coords[0], lat: coords[1] });
    });
  }

  /**
   * Create arc coordinates
   */
  createArc(start, end, numPoints = 50) {
    const coordinates = [];
    
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const lng = start[0] + (end[0] - start[0]) * t;
      const lat = start[1] + (end[1] - start[1]) * t;
      
      const distance = Math.sqrt(
        Math.pow(end[0] - start[0], 2) + 
        Math.pow(end[1] - start[1], 2)
      );
      const arcHeight = distance * 0.12;
      const elevation = Math.sin(t * Math.PI) * arcHeight;
      
      coordinates.push([lng, lat + elevation]);
    }
    
    return coordinates;
  }

  /**
   * Add flight icon at midpoint and store position for later use
   * Now includes date/day label to distinguish duplicate routes
   */
  addFlightIcon(route, arcCoordinates) {
    const midIndex = Math.floor(arcCoordinates.length / 2);
    const position = arcCoordinates[midIndex];
    
    // Store the flight icon position for use when clicking from timeline
    this.flightIconPositions.set(route.id, { lng: position[0], lat: position[1] });
    // Also store route data for lookup
    this.routeData.set(route.id, route);
    
    const prevPoint = arcCoordinates[midIndex - 1] || position;
    const nextPoint = arcCoordinates[midIndex + 1] || position;
    const angle = Math.atan2(
      nextPoint[1] - prevPoint[1],
      nextPoint[0] - prevPoint[0]
    ) * (180 / Math.PI);

    let infoText = '';
    if (route.duration) {
      infoText += route.duration;
    }
    if (route.distanceKm && route.distanceKm > 0) {
      if (infoText) infoText += ' · ';
      infoText += `${route.distanceKm} km`;
    }
    
    // Get date label for distinguishing duplicate routes
    const dateLabel = route.dateLabel || (route.startDay ? `Day ${route.startDay}` : '');

    const el = document.createElement('div');
    el.className = 'wetu-flight-label';
    el.innerHTML = `
      <div class="wetu-flight-label__top">
        <svg class="wetu-flight-label__icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="transform: rotate(${angle + 90}deg);">
          <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
        </svg>
        ${infoText ? `<span>${infoText}</span>` : ''}
      </div>
      ${dateLabel ? `<span class="wetu-flight-label__date">${dateLabel}</span>` : ''}
    `;

    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat(position)
      .addTo(this.map);
    
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showRoutePopup(route, { lng: position[0], lat: position[1] });
    });
  }

  /**
   * Toggle theme
   * Only toggles the UI color scheme (header, timeline, controls) - map style stays the same
   * The Mapbox Outdoors style is used for both light and dark modes to show full-color terrain
   */
  toggleTheme() {
    this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.container.dataset.currentTheme = this.currentTheme;
    
    const lightScheme = this.container.dataset.colorSchemeLight;
    const darkScheme = this.container.dataset.colorSchemeDark;
    
    this.container.classList.remove(`color-${lightScheme}`, `color-${darkScheme}`);
    this.container.classList.add(`color-${this.currentTheme === 'light' ? lightScheme : darkScheme}`);
    
    // Map style intentionally NOT changed - Outdoors style provides full-color terrain for both themes
  }

  /**
   * Toggle timeline collapsed state
   */
  toggleTimelineCollapse() {
    if (!this.timelinePanel) return;
    
    this.isTimelineCollapsed = !this.isTimelineCollapsed;
    this.timelinePanel.classList.toggle('collapsed', this.isTimelineCollapsed);
    
    setTimeout(() => {
      this.map.resize();
    }, 350);
  }

  /**
   * Focus on a route by ID
   * For flights: Opens popup at the flight icon position
   * For drives: Opens popup at route midpoint
   */
  focusRoute(routeId) {
    // Try to find route with various ID formats
    const route = this.config.routes.find(r => 
      `route-${r.id}` === routeId || 
      r.id === routeId ||
      `route-driving-${r.id}` === routeId ||
      `route-flight-${r.id}` === routeId
    );
    
    if (route) {
      const isFlightMode = ['ScheduledFlight', 'CharterFlight', 'Helicopter'].includes(route.mode);
      
      let popupPosition;
      let zoomLevel = 8;
      
      if (isFlightMode) {
        // For flights, use the stored flight icon position
        const flightPos = this.flightIconPositions.get(route.id);
        if (flightPos) {
          popupPosition = flightPos;
        } else {
          // Fallback: calculate arc midpoint
          const midLat = (route.startLat + route.endLat) / 2;
          const midLng = (route.startLng + route.endLng) / 2;
          // Add arc elevation like we do for the flight path
          const distance = Math.sqrt(
            Math.pow(route.endLng - route.startLng, 2) + 
            Math.pow(route.endLat - route.startLat, 2)
          );
          const arcHeight = distance * 0.12;
          const elevation = Math.sin(0.5 * Math.PI) * arcHeight;
          popupPosition = { lng: midLng, lat: midLat + elevation };
        }
        zoomLevel = 6; // Zoom out more for flights
      } else {
        // For driving routes, use midpoint
        const midLat = (route.startLat + route.endLat) / 2;
        const midLng = (route.startLng + route.endLng) / 2;
        popupPosition = { lng: midLng, lat: midLat };
      }
      
      this.map.flyTo({
        center: [popupPosition.lng, popupPosition.lat],
        zoom: zoomLevel,
        duration: 1500
      });
      
      // Small delay to let map animation complete before showing popup
      setTimeout(() => {
        this.showRoutePopup(route, popupPosition);
      }, 500);
    }
  }

  /**
   * Focus on an activity by coordinates
   */
  focusActivity(lat, lng, activityId) {
    if (lat && lng) {
      this.map.flyTo({
        center: [lng, lat],
        zoom: 13,
        duration: 1500
      });
      
      // Find and show activity popup
      const activity = this.config.activities.find(a => a.id === activityId);
      if (activity) {
        this.showActivityPopup(activity);
      }
    }
  }

  /**
   * Focus on a destination by coordinates
   */
  focusDestination(lat, lng, destinationId) {
    if (lat && lng) {
      this.map.flyTo({
        center: [lng, lat],
        zoom: 10,
        duration: 1500
      });
      
      // Find and show destination popup
      const destination = this.config.destinations.find(d => d.id === destinationId);
      if (destination) {
        this.showDestinationPopup(destination);
      }
    }
  }

  /**
   * Bind event listeners
   */
  bindEventListeners() {
    // Theme toggle
    const themeToggle = this.container.querySelector('[data-theme-toggle]');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => this.toggleTheme());
    }

    // Map style selector
    const styleSelect = this.container.querySelector('[data-map-style-select]');
    if (styleSelect) {
      styleSelect.addEventListener('change', (e) => {
        this.changeMapStyle(e.target.value);
      });
    }

    // Timeline collapse
    const collapseBtn = this.container.querySelector('[data-timeline-collapse]');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => this.toggleTimelineCollapse());
    }

    // Map controls
    const fitBtn = this.container.querySelector('[data-map-fit]');
    if (fitBtn) {
      fitBtn.addEventListener('click', () => this.fitBounds());
    }

    const zoomInBtn = this.container.querySelector('[data-map-zoom-in]');
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => this.map.zoomIn());
    }

    const zoomOutBtn = this.container.querySelector('[data-map-zoom-out]');
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => this.map.zoomOut());
    }

    // Accommodation cards - focus marker
    this.container.querySelectorAll('[data-focus-marker]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (!e.target.closest('a')) {
          e.preventDefault();
        }
        const markerId = btn.dataset.focusMarker;
        const markerData = this.markerElements.get(markerId);
        
        if (markerData) {
          this.map.flyTo({
            center: [markerData.data.lng, markerData.data.lat],
            zoom: 12,
            duration: 1500
          });
          this.showMarkerPopup(markerData.data);
          this.setActiveMarker(markerId, false);
        }
      });
    });

    // Transit cards - focus route
    this.container.querySelectorAll('[data-focus-route]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const routeId = btn.dataset.focusRoute;
        this.focusRoute(routeId);
      });
    });

    // Activity cards - focus activity
    this.container.querySelectorAll('[data-focus-activity]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const activityId = btn.dataset.focusActivity;
        const lat = parseFloat(btn.dataset.lat);
        const lng = parseFloat(btn.dataset.lng);
        this.focusActivity(lat, lng, activityId);
      });
    });

    // Destination cards - click anywhere on card
    this.container.querySelectorAll('.wetu-event-card--destination').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        const lat = parseFloat(card.dataset.lat);
        const lng = parseFloat(card.dataset.lng);
        const entityId = card.dataset.entityId;
        
        if (lat && lng) {
          this.map.flyTo({
            center: [lng, lat],
            zoom: 10,
            duration: 1500
          });
          
          const destination = this.config.destinations.find(d => `destination-${d.id}` === entityId || d.id === entityId);
          if (destination) {
            this.showDestinationPopup(destination);
          }
        }
      });
    });

    // Transit cards - click anywhere on card shows route
    this.container.querySelectorAll('.wetu-event-card--transit').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const routeId = card.dataset.routeId;
        if (routeId) {
          this.focusRoute(routeId);
        }
      });
    });

    // Accommodation cards - click to show on map
    this.container.querySelectorAll('.wetu-event-card--accommodation').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const markerId = card.dataset.markerId;
        if (markerId) {
          const markerData = this.markerElements.get(markerId);
          if (markerData) {
            this.map.flyTo({
              center: [markerData.data.lng, markerData.data.lat],
              zoom: 12,
              duration: 1500
            });
            this.showMarkerPopup(markerData.data);
            this.setActiveMarker(markerId, false);
          }
        }
      });
    });

    // Activity cards - click to show on map
    this.container.querySelectorAll('.wetu-event-card--activity').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const lat = parseFloat(card.dataset.lat);
        const lng = parseFloat(card.dataset.lng);
        const entityId = card.dataset.entityId;
        
        if (lat && lng) {
          this.focusActivity(lat, lng, entityId);
        }
      });
    });

    // Navigation arrows
    const prevBtn = this.container.querySelector('[data-nav-prev]');
    const nextBtn = this.container.querySelector('[data-nav-next]');
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        this.navigateToStop(this.currentStopIndex - 1);
      });
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.navigateToStop(this.currentStopIndex + 1);
      });
    }

    // Navigation dots
    this.container.querySelectorAll('[data-nav-dot]').forEach((dot, index) => {
      dot.addEventListener('click', () => {
        this.navigateToStop(parseInt(dot.dataset.navDot));
      });
    });

    // Route panel close
    const routePanelClose = this.container.querySelector('[data-route-panel-close]');
    if (routePanelClose && this.routePanel) {
      routePanelClose.addEventListener('click', () => {
        this.routePanel.classList.remove('open');
      });
    }

    // Mobile drawer handle
    const handle = this.container.querySelector('[data-timeline-handle]');
    if (handle && this.timelinePanel) {
      let startY = 0;
      let startHeight = 0;
      
      handle.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        startHeight = this.timelinePanel.offsetHeight;
      });
      
      handle.addEventListener('touchmove', (e) => {
        const deltaY = startY - e.touches[0].clientY;
        const newHeight = Math.max(80, Math.min(window.innerHeight * 0.7, startHeight + deltaY));
        this.timelinePanel.style.height = `${newHeight}px`;
      });
      
      handle.addEventListener('touchend', () => {
        const currentHeight = this.timelinePanel.offsetHeight;
        const threshold = 180;
        
        if (currentHeight < threshold) {
          this.timelinePanel.classList.add('collapsed');
          this.timelinePanel.style.height = '';
        } else {
          this.timelinePanel.classList.remove('collapsed');
          this.timelinePanel.style.height = '';
        }
        
        setTimeout(() => this.map.resize(), 350);
      });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!this.container.contains(document.activeElement) && 
          document.activeElement !== document.body) return;
      
      switch (e.key) {
        case 'ArrowLeft':
          this.navigateToStop(this.currentStopIndex - 1);
          break;
        case 'ArrowRight':
          this.navigateToStop(this.currentStopIndex + 1);
          break;
        case 'Escape':
          this.closePopup();
          break;
      }
    });

    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.map.resize();
      }, 250);
    });
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.wetuFullscreenMap = new WetuFullscreenMap();
});

// Export for external use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WetuFullscreenMap;
}
