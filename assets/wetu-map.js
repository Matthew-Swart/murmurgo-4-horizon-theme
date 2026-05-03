/**
 * WETU Interactive Itinerary Map
 * ============================================================================
 * 
 * Mapbox GL JS integration for displaying itinerary maps with:
 * - Custom accommodation markers
 * - Driving routes (using Mapbox Directions API or provided GPS points)
 * - Flight routes (curved great circle arcs)
 * - Interactive popups and click handlers
 * - Fullscreen toggle and responsive design
 * 
 * DEPENDENCIES:
 * - Mapbox GL JS v3.x
 * - Mapbox Access Token (set in theme settings or data attribute)
 * 
 * ============================================================================
 */

class WetuItineraryMap {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn('WETU Map: Container not found');
      return;
    }

    // Parse data attributes
    this.markers = this.parseJSON(this.container.dataset.markers, []);
    this.routes = this.parseJSON(this.container.dataset.routes, []);
    this.mapStyle = this.container.dataset.style || 'outdoors-v12';
    this.animate = this.container.dataset.animate === 'true';
    this.accessToken = this.container.dataset.mapboxToken || '';

    // State
    this.map = null;
    this.markerElements = new Map();
    this.activeMarkerId = null;
    this.popup = null;
    this.isFullscreen = false;

    // Initialize
    if (this.accessToken) {
      this.init();
    } else {
      console.warn('WETU Map: Mapbox access token not configured');
      this.showError('Map configuration required. Please add your Mapbox access token in theme settings.');
    }
  }

  /**
   * Parse JSON data safely
   */
  parseJSON(jsonString, fallback = []) {
    try {
      return JSON.parse(jsonString) || fallback;
    } catch (e) {
      console.warn('WETU Map: Failed to parse JSON data', e);
      return fallback;
    }
  }

  /**
   * Show error message in map container
   */
  showError(message) {
    const loading = this.container.querySelector('.wetu-interactive-map__loading');
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
      mapboxgl.accessToken = this.accessToken;

      // Calculate initial bounds
      const bounds = this.calculateBounds();
      
      // Create map instance
      this.map = new mapboxgl.Map({
        container: this.container,
        style: `mapbox://styles/mapbox/${this.mapStyle}`,
        bounds: bounds,
        fitBoundsOptions: {
          padding: { top: 80, bottom: 80, left: 320, right: 80 },
          maxZoom: 12
        },
        attributionControl: false
      });

      // Add attribution in bottom right
      this.map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

      // Add navigation controls
      this.map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

      // Wait for map to load
      this.map.on('load', () => {
        this.container.classList.add('map-loaded');
        this.addMarkers();
        this.addRoutes();
        this.bindEventListeners();
      });

      // Handle resize
      this.map.on('resize', () => {
        this.fitBounds();
      });

    } catch (error) {
      console.error('WETU Map: Initialization failed', error);
      this.showError('Failed to load map. Please try again later.');
    }
  }

  /**
   * Calculate bounds from all markers
   */
  calculateBounds() {
    if (!this.markers.length) {
      // Default to Africa if no markers
      return [[-20, -35], [55, 40]];
    }

    const bounds = new mapboxgl.LngLatBounds();
    
    this.markers.forEach(marker => {
      if (marker.lat && marker.lng) {
        bounds.extend([marker.lng, marker.lat]);
      }
    });

    // Add route points to bounds
    this.routes.forEach(route => {
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
   * Add accommodation markers to the map
   */
  addMarkers() {
    // Sort markers by sequence
    const sortedMarkers = [...this.markers].sort((a, b) => a.sequence - b.sequence);

    sortedMarkers.forEach((marker, index) => {
      if (!marker.lat || !marker.lng) return;

      // Create custom marker element
      const el = document.createElement('div');
      el.className = 'wetu-map-marker';
      el.textContent = index + 1;
      el.dataset.markerId = marker.id;

      // Create the marker
      const mapMarker = new mapboxgl.Marker({
        element: el,
        anchor: 'center'
      })
        .setLngLat([marker.lng, marker.lat])
        .addTo(this.map);

      // Store reference
      this.markerElements.set(marker.id, { element: el, marker: mapMarker, data: marker });

      // Click handler
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showMarkerPopup(marker);
        this.setActiveMarker(marker.id);
      });
    });
  }

  /**
   * Show popup for a marker
   */
  showMarkerPopup(marker) {
    // Close existing popup
    if (this.popup) {
      this.popup.remove();
    }

    // Build popup content
    const popupContent = `
      <div class="wetu-map-popup">
        ${marker.image ? `<img src="${marker.image}" alt="${marker.name}" class="wetu-map-popup__image">` : ''}
        <div class="wetu-map-popup__content">
          <h4 class="wetu-map-popup__title">${marker.name}</h4>
          <div class="wetu-map-popup__meta">
            <span>Day ${marker.day}${marker.dayEnd > marker.day ? ` - ${marker.dayEnd}` : ''}</span>
            <span>•</span>
            <span>${marker.nights} ${marker.nights === 1 ? 'night' : 'nights'}</span>
          </div>
          ${marker.destination ? `<p style="margin: 0 0 8px; font-size: 0.85rem; color: #666;">${marker.destination}${marker.country ? `, ${marker.country}` : ''}</p>` : ''}
          <a href="#day-${marker.day}" class="wetu-map-popup__link" data-scroll-to-day="${marker.day}">
            View Details
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
        </div>
      </div>
    `;

    this.popup = new mapboxgl.Popup({
      offset: 25,
      closeButton: true,
      maxWidth: '280px'
    })
      .setLngLat([marker.lng, marker.lat])
      .setHTML(popupContent)
      .addTo(this.map);

    // Handle scroll link click
    setTimeout(() => {
      const scrollLink = this.popup.getElement()?.querySelector('[data-scroll-to-day]');
      if (scrollLink) {
        scrollLink.addEventListener('click', (e) => {
          e.preventDefault();
          const day = scrollLink.dataset.scrollToDay;
          this.scrollToDay(day);
          this.popup.remove();
        });
      }
    }, 0);
  }

  /**
   * Set active marker state
   */
  setActiveMarker(markerId) {
    // Remove active from previous
    if (this.activeMarkerId) {
      const prev = this.markerElements.get(this.activeMarkerId);
      if (prev) {
        prev.element.classList.remove('active');
      }
    }

    // Set new active
    const current = this.markerElements.get(markerId);
    if (current) {
      current.element.classList.add('active');
    }

    this.activeMarkerId = markerId;

    // Update sidebar
    this.updateSidebarActive(markerId);
  }

  /**
   * Update sidebar active state
   */
  updateSidebarActive(markerId) {
    const sidebar = document.querySelector('.wetu-interactive-map__sidebar');
    if (!sidebar) return;

    sidebar.querySelectorAll('.destination-item').forEach(item => {
      item.classList.toggle('active', item.dataset.markerId === markerId);
    });
  }

  /**
   * Add routes to the map
   */
  async addRoutes() {
    // Sort routes by sequence
    const sortedRoutes = [...this.routes].sort((a, b) => a.sequence - b.sequence);

    for (const route of sortedRoutes) {
      if (!route.startLat || !route.startLng || !route.endLat || !route.endLng) continue;

      const isFlightMode = ['ScheduledFlight', 'CharterFlight', 'Helicopter'].includes(route.mode);

      if (isFlightMode) {
        this.addFlightRoute(route);
      } else {
        await this.addDrivingRoute(route);
      }
    }
  }

  /**
   * Add driving route (road path)
   */
  async addDrivingRoute(route) {
    const routeId = `route-driving-${route.id}`;
    
    let coordinates;

    // Check if we have pre-defined points
    if (route.points && route.points.length > 0) {
      coordinates = this.parseRoutePoints(route.points);
    } else {
      // Use Mapbox Directions API
      try {
        const profile = route.mode === 'Selfdrive' ? 'driving' : 'driving-traffic';
        const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${route.startLng},${route.startLat};${route.endLng},${route.endLat}?geometries=geojson&access_token=${this.accessToken}`;
        
        const response = await fetch(directionsUrl);
        const data = await response.json();
        
        if (data.routes && data.routes[0]) {
          coordinates = data.routes[0].geometry.coordinates;
        }
      } catch (error) {
        console.warn('WETU Map: Failed to fetch directions, falling back to straight line', error);
      }
    }

    // Fallback to straight line if no coordinates
    if (!coordinates || coordinates.length === 0) {
      coordinates = [
        [route.startLng, route.startLat],
        [route.endLng, route.endLat]
      ];
    }

    // Add the route to the map
    this.map.addSource(routeId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {
          mode: route.mode,
          label: route.label
        },
        geometry: {
          type: 'LineString',
          coordinates: coordinates
        }
      }
    });

    // Add route line layer
    this.map.addLayer({
      id: routeId,
      type: 'line',
      source: routeId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#3b82f6',
        'line-width': 4,
        'line-opacity': 0.8
      }
    });

    // Add route border for better visibility
    this.map.addLayer({
      id: `${routeId}-border`,
      type: 'line',
      source: routeId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#1e3a5f',
        'line-width': 6,
        'line-opacity': 0.3
      }
    }, routeId);

    // Optional: Animate route drawing
    if (this.animate) {
      this.animateRoute(routeId, coordinates);
    }
  }

  /**
   * Parse route points string to coordinates array
   */
  parseRoutePoints(pointsString) {
    if (!pointsString) return [];
    
    try {
      // Points format: "lat,lng;lat,lng;..."
      return pointsString.split(';').map(point => {
        const [lat, lng] = point.split(',').map(Number);
        return [lng, lat]; // GeoJSON uses [lng, lat]
      }).filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
    } catch (e) {
      console.warn('WETU Map: Failed to parse route points', e);
      return [];
    }
  }

  /**
   * Add flight route (curved arc)
   */
  addFlightRoute(route) {
    const routeId = `route-flight-${route.id}`;
    
    // Create curved arc using great circle
    const arcCoordinates = this.createArc(
      [route.startLng, route.startLat],
      [route.endLng, route.endLat],
      50 // Number of points in arc
    );

    this.map.addSource(routeId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {
          mode: route.mode,
          label: route.label,
          agency: route.agency,
          vehicle: route.vehicle
        },
        geometry: {
          type: 'LineString',
          coordinates: arcCoordinates
        }
      }
    });

    // Add dashed flight line
    this.map.addLayer({
      id: routeId,
      type: 'line',
      source: routeId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#8b5cf6',
        'line-width': 3,
        'line-dasharray': [4, 4],
        'line-opacity': 0.9
      }
    });

    // Add plane icon at midpoint
    this.addFlightIcon(route, arcCoordinates);
  }

  /**
   * Create arc coordinates for flight path (great circle approximation)
   */
  createArc(start, end, numPoints = 50) {
    const coordinates = [];
    
    // Calculate arc with elevation
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      
      // Linear interpolation for base position
      const lng = start[0] + (end[0] - start[0]) * t;
      const lat = start[1] + (end[1] - start[1]) * t;
      
      // Add curvature (simple parabolic arc)
      // Peak height proportional to distance
      const distance = Math.sqrt(
        Math.pow(end[0] - start[0], 2) + 
        Math.pow(end[1] - start[1], 2)
      );
      const arcHeight = distance * 0.15; // 15% of distance
      const elevation = Math.sin(t * Math.PI) * arcHeight;
      
      // Apply elevation to latitude (creates visual arc effect)
      coordinates.push([lng, lat + elevation]);
    }
    
    return coordinates;
  }

  /**
   * Add airplane icon at flight midpoint
   */
  addFlightIcon(route, arcCoordinates) {
    const midIndex = Math.floor(arcCoordinates.length / 2);
    const midpoint = arcCoordinates[midIndex];
    
    // Calculate rotation angle
    const prevPoint = arcCoordinates[midIndex - 1] || midpoint;
    const nextPoint = arcCoordinates[midIndex + 1] || midpoint;
    const angle = Math.atan2(
      nextPoint[1] - prevPoint[1],
      nextPoint[0] - prevPoint[0]
    ) * (180 / Math.PI);

    // Create plane marker
    const el = document.createElement('div');
    el.className = 'wetu-flight-icon';
    el.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#8b5cf6" style="transform: rotate(${angle + 90}deg);">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
      </svg>
    `;
    el.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      background: white;
      border-radius: 50%;
      padding: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;

    new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat(midpoint)
      .addTo(this.map);
  }

  /**
   * Animate route drawing
   */
  animateRoute(routeId, coordinates) {
    let step = 0;
    const steps = coordinates.length;
    const animatedCoords = [];

    const animate = () => {
      if (step < steps) {
        animatedCoords.push(coordinates[step]);
        
        this.map.getSource(routeId).setData({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: animatedCoords
          }
        });

        step++;
        requestAnimationFrame(animate);
      }
    };

    animate();
  }

  /**
   * Bind event listeners
   */
  bindEventListeners() {
    const section = this.container.closest('.wetu-interactive-map');
    if (!section) return;

    // Fullscreen button
    const fullscreenBtn = section.querySelector('[data-map-fullscreen]');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    }

    // Fit bounds button
    const fitBtn = section.querySelector('[data-map-fit]');
    if (fitBtn) {
      fitBtn.addEventListener('click', () => this.fitBounds());
    }

    // Sidebar toggle
    const sidebarToggle = section.querySelector('[data-sidebar-toggle]');
    const sidebar = section.querySelector('.wetu-interactive-map__sidebar');
    if (sidebarToggle && sidebar) {
      sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        // Resize map after sidebar animation
        setTimeout(() => this.map.resize(), 300);
      });
    }

    // Sidebar destination clicks
    const destinationButtons = section.querySelectorAll('[data-focus-marker]');
    destinationButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const markerId = btn.dataset.focusMarker;
        const markerData = this.markerElements.get(markerId);
        
        if (markerData) {
          // Fly to marker
          this.map.flyTo({
            center: [markerData.data.lng, markerData.data.lat],
            zoom: 12,
            duration: 1000
          });
          
          // Show popup and set active
          this.showMarkerPopup(markerData.data);
          this.setActiveMarker(markerId);
        }
      });
    });

    // Keyboard navigation for fullscreen
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isFullscreen) {
        this.toggleFullscreen();
      }
    });

    // Close popup when clicking map
    this.map.on('click', () => {
      if (this.popup) {
        this.popup.remove();
        this.popup = null;
      }
    });
  }

  /**
   * Fit map bounds to show all markers
   */
  fitBounds() {
    const bounds = this.calculateBounds();
    
    this.map.fitBounds(bounds, {
      padding: { 
        top: 80, 
        bottom: 80, 
        left: this.isFullscreen ? 320 : 80, 
        right: 80 
      },
      maxZoom: 12,
      duration: 1000
    });
  }

  /**
   * Toggle fullscreen mode
   */
  toggleFullscreen() {
    const section = this.container.closest('.wetu-interactive-map');
    if (!section) return;

    this.isFullscreen = !this.isFullscreen;
    section.classList.toggle('wetu-interactive-map--fullscreen', this.isFullscreen);
    
    // Toggle body scroll
    document.body.style.overflow = this.isFullscreen ? 'hidden' : '';

    // Resize map after transition
    setTimeout(() => {
      this.map.resize();
      this.fitBounds();
    }, 300);
  }

  /**
   * Scroll to day section
   */
  scrollToDay(dayNumber) {
    // Close fullscreen if open
    if (this.isFullscreen) {
      this.toggleFullscreen();
    }

    // Find day section
    const daySection = document.querySelector(`#day-${dayNumber}`) ||
                      document.querySelector(`[data-day="${dayNumber}"]`) ||
                      document.querySelector(`.timeline-day[data-day="${dayNumber}"]`);
    
    if (daySection) {
      const headerOffset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height') || '80');
      const targetPosition = daySection.getBoundingClientRect().top + window.scrollY - headerOffset - 20;
      
      window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
      });
    }
  }

  /**
   * Focus on a specific marker
   */
  focusMarker(markerId) {
    const markerData = this.markerElements.get(markerId);
    if (!markerData) return;

    this.map.flyTo({
      center: [markerData.data.lng, markerData.data.lat],
      zoom: 14,
      duration: 1500
    });

    setTimeout(() => {
      this.showMarkerPopup(markerData.data);
      this.setActiveMarker(markerId);
    }, 1500);
  }

  /**
   * Destroy map instance
   */
  destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.markerElements.clear();
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const mapEl = document.getElementById('wetu-itinerary-map');
  if (mapEl) {
    window.wetuItineraryMap = new WetuItineraryMap('wetu-itinerary-map');
  }
});

// Export for external use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WetuItineraryMap;
}

