/**
 * ============================================================================
 * WETU FULLSCREEN JOURNEY MAP V2
 * ============================================================================
 * 
 * An immersive, full-page interactive map with transparent overlay header.
 * Uses the same comprehensive functionality as V1 but with V2 element IDs.
 * 
 * Features:
 * - Mapbox GL JS integration
 * - 16:9 rectangle markers with thumbnail images
 * - Single popup mode (replaces previous popup)
 * - Popup arrows pointing close to exact location
 * - Popups for destinations, accommodations, activities, routes, and flights
 * - Driving routes via Mapbox Directions or GPS points
 * - Flight paths as curved arcs
 * - Synchronized day-by-day timeline panel
 * - Mobile-optimized layout (40% left timeline)
 * 
 * ============================================================================
 */

class WetuFullscreenMapV2 {
  constructor() {
    this.container = document.getElementById('wetu-fullscreen-map-v2-container');
    if (!this.container) return;

    this.canvas = document.getElementById('wetu-fullscreen-map-v2-canvas');
    if (!this.canvas) return;

    // Parse configuration
    this.config = {
      markers: this.parseJSON(this.canvas.dataset.markers, []),
      routes: this.parseJSON(this.canvas.dataset.routes, []),
      activities: this.parseJSON(this.canvas.dataset.activities, []),
      destinations: this.parseJSON(this.canvas.dataset.destinations, []),
      styleLight: this.canvas.dataset.styleLight || 'outdoors-v12',
      styleDark: this.canvas.dataset.styleDark || 'dark-v11',
      animate: this.canvas.dataset.animate === 'true',
      showActivities: this.canvas.dataset.showActivities === 'true',
      routeColors: {
        driving: this.canvas.dataset.routeColorDriving || '#10b981',
        flight: this.canvas.dataset.routeColorFlight || '#8b5cf6',
        transfer: this.canvas.dataset.routeColorTransfer || '#f59e0b'
      },
      accessToken: this.canvas.dataset.mapboxToken || ''
    };

    // State
    this.map = null;
    this.markerElements = new Map();
    this.activityMarkerElements = new Map();
    this.routeAnnotations = new Map();
    this.flightIconPositions = new Map();
    this.routeData = new Map();
    this.activeMarkerId = null;
    this.currentStopIndex = 0;
    this.popup = null;
    this.currentTheme = this.container.dataset.defaultTheme || 'light';
    this.currentMapStyle = this.config.styleLight;
    this.isTimelineCollapsed = false;
    this.isContentViewerOpen = false;
    
    // Content viewer elements (fetches full page HTML)
    this.contentViewer = this.container.querySelector('[data-content-viewer]');
    this.contentViewerBody = this.container.querySelector('[data-content-viewer-body]');
    this.contentViewerTitle = this.container.querySelector('[data-content-viewer-title]');
    this.contentViewerLoading = this.container.querySelector('[data-content-viewer-loading]');
    this.contentViewerBack = this.container.querySelector('[data-content-viewer-back]');
    this.contentViewerFullpage = this.container.querySelector('[data-content-viewer-fullpage]');
    this.contentViewerNavBack = this.container.querySelector('[data-content-viewer-nav-back]');
    this.showOnMapBtn = this.container.querySelector('[data-show-on-map]');
    
    // Store current content viewer data for "Show on Map" functionality
    this.currentViewerCoords = null;
    this.currentViewerData = null; // {title, url, image}
    
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
      console.warn('WetuFullscreenMapV2: Mapbox access token not configured');
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
      console.warn('WetuFullscreenMapV2: Failed to parse JSON', e.message);
      try {
        const simplified = str.replace(/,\s*\}/g, '}').replace(/,\s*\]/g, ']');
        const parsed = JSON.parse(simplified);
        return Array.isArray(parsed) ? parsed : fallback;
      } catch (e2) {
        console.warn('WetuFullscreenMapV2: JSON recovery failed', e2.message);
        return fallback;
      }
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    const loading = this.canvas.querySelector('.wetu-fullscreen-map-v2__loading');
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

      // Use Mapbox Outdoors style for full-color terrain visualization
      const mapStyle = this.mapStyles[this.config.styleLight] || 'mapbox://styles/mapbox/outdoors-v12';

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
        // Hide loading spinner
        const loading = this.canvas.querySelector('.wetu-fullscreen-map-v2__loading');
        if (loading) loading.style.display = 'none';
        
        this.addMarkers();
        this.addRoutes();
        if (this.config.showActivities) {
          this.addActivityMarkers();
        }
        this.bindEventListeners();
        
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
          const clickedMarker = e.originalEvent.target.closest('.wetu-map-marker, .wetu-activity-marker, .wetu-airport-marker, .wetu-flight-icon, .wetu-flight-label, .wetu-drive-label');
          if (!clickedMarker) {
            this.closePopup();
          }
        }
      });

    } catch (error) {
      console.error('WetuFullscreenMapV2: Initialization failed', error);
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
   * ============================================================================
   * CONTENT VIEWER - Load product pages in iframe
   * ============================================================================
   */

  /**
   * Open content viewer with a URL
   * @param {string} url - Product URL to load
   * @param {string} title - Title to display
   * @param {object} coords - Optional coordinates {lat, lng, markerId, image} for Show on Map functionality
   */
  openContentViewer(url, title = '', coords = null) {
    if (!this.contentViewer || !this.contentViewerBody) return;
    
    // Close any open popup first
    this.closePopup();
    
    // Set title
    if (this.contentViewerTitle) {
      this.contentViewerTitle.textContent = title;
    }
    
    // Set fullpage link
    if (this.contentViewerFullpage) {
      this.contentViewerFullpage.href = url;
    }
    
    // Store coordinates and viewer data for Show on Map functionality
    this.currentViewerCoords = coords;
    this.currentViewerData = { title, url, image: coords?.image || null };
    
    if (this.showOnMapBtn) {
      if (coords && (coords.lat || coords.lng || coords.markerId)) {
        this.showOnMapBtn.style.display = 'inline-flex';
      } else {
        this.showOnMapBtn.style.display = 'none';
      }
    }
    
    // Show loading
    if (this.contentViewerLoading) {
      this.contentViewerLoading.dataset.loading = 'true';
    }
    
    // Show content viewer
    this.contentViewer.dataset.visible = 'true';
    this.isContentViewerOpen = true;
    
    // Deactivate journey card
    const journeyCard = this.container.querySelector('.wetu-fullscreen-map-v2__journey-card');
    if (journeyCard) {
      journeyCard.classList.remove('wetu-fullscreen-map-v2__journey-card--active');
    }
    
    // Fetch the full product page and inject the main content
    this.fetchProductPage(url);
  }
  
  /**
   * Get coordinates and image from a card element for Show on Map functionality
   * @param {HTMLElement} card - The card element
   * @returns {object|null} - Coordinates object {lat, lng, markerId, image} or null
   */
  getCardCoordinates(card) {
    if (!card) return null;
    
    const lat = parseFloat(card.dataset.lat);
    const lng = parseFloat(card.dataset.lng);
    const markerId = card.dataset.markerId || card.dataset.entityId || card.dataset.focusMarker;
    
    // Try to get image from the card's thumbnail
    let image = null;
    const cardImg = card.querySelector('.wetu-event-card__compact-thumb img, .wetu-event-card__square-image, img');
    if (cardImg) {
      image = cardImg.src;
    }
    
    if (lat && lng) {
      return { lat, lng, markerId, image };
    } else if (markerId) {
      // Try to get coordinates and image from marker data
      const markerData = this.markerElements?.get(markerId);
      if (markerData?.data) {
        return { 
          lat: markerData.data.lat, 
          lng: markerData.data.lng, 
          markerId,
          image: image || markerData.data.image
        };
      }
    }
    
    return null;
  }
  
  /**
   * Fetch full product page HTML and inject main content
   * This loads the complete product experience without header/footer
   */
  async fetchProductPage(url) {
    try {
      // Fetch the full product page HTML
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to load page: ${url}`);
      }
      
      const html = await response.text();
      
      // Parse the HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Extract the main content (excludes header/footer)
      const mainContent = doc.querySelector('main');
      
      if (mainContent && this.contentViewerBody) {
        // Hide the simple product display
        if (this.productDisplay) {
          this.productDisplay.style.display = 'none';
        }
        
        // Inject the main content
        this.contentViewerBody.innerHTML = '';
        this.contentViewerBody.appendChild(mainContent.cloneNode(true));
        
        // Add a class for styling
        this.contentViewerBody.classList.add('wetu-content-viewer--full-product');
        
        // Reset zoom gallery state before reinitializing (important when switching products)
        this.resetZoomGallery();
        
        // Reset link interception (but keep history for back navigation)
        this._linkInterceptionInitialized = false;
        
        // Re-initialize any Shopify scripts that might be needed
        this.reinitializeProductScripts();
        
        // Inject "Show on Map" overlay on the hero image
        this.injectShowOnMapOverlay();
        
        // Hide loading
        if (this.contentViewerLoading) {
          this.contentViewerLoading.dataset.loading = 'false';
        }
      } else {
        throw new Error('Could not extract page content');
      }
      
    } catch (error) {
      console.error('Error fetching product page:', error);
      this.showContentError('Unable to load product details');
    }
  }
  
  /**
   * Inject "Show on Map" overlay button on the hero image of loaded product
   * This works across all product templates (wetu-property, wetu-destination, wetu-activity, etc.)
   */
  injectShowOnMapOverlay() {
    // Only inject if we have coordinates
    if (!this.currentViewerCoords || !this.contentViewerBody) return;
    
    // Remove any existing overlay first
    const existingOverlay = this.contentViewerBody.querySelector('.wetu-show-on-map-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }
    
    // Find the hero image container - try various selectors used in different templates
    const heroSelectors = [
      '.wetu-property-hero',
      '.wetu-destination-hero',
      '.wetu-activity-hero',
      '.wetu-hero',
      '.product-hero',
      '.hero-section',
      '[class*="hero"]',
      'section:first-child',
      '.product__media-wrapper:first-child',
      'main > section:first-child'
    ];
    
    let heroContainer = null;
    for (const selector of heroSelectors) {
      heroContainer = this.contentViewerBody.querySelector(selector);
      if (heroContainer) break;
    }
    
    // Fallback: find the first large image and use its parent
    if (!heroContainer) {
      const firstImage = this.contentViewerBody.querySelector('img');
      if (firstImage) {
        heroContainer = firstImage.closest('section') || firstImage.closest('div') || firstImage.parentElement;
      }
    }
    
    if (!heroContainer) return;
    
    // Ensure the hero container has position relative for absolute positioning
    const computedStyle = window.getComputedStyle(heroContainer);
    if (computedStyle.position === 'static') {
      heroContainer.style.position = 'relative';
    }
    
    // Create the overlay button
    const overlay = document.createElement('button');
    overlay.type = 'button';
    overlay.className = 'wetu-show-on-map-overlay';
    overlay.setAttribute('aria-label', 'Show on map');
    overlay.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
      <span>Show on Map</span>
    `;
    
    // Add click handler
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleShowOnMapClick();
    });
    
    // Insert the overlay
    heroContainer.appendChild(overlay);
  }
  
  /**
   * Handle "Show on Map" overlay click
   */
  handleShowOnMapClick() {
    if (!this.currentViewerCoords) return;
    
    // Store data before closing (closeContentViewer clears it)
    const coords = { ...this.currentViewerCoords };
    const viewerData = { ...this.currentViewerData };
    
    // Close content viewer
    this.closeContentViewer();
    
    // Remove journey card active state
    const journeyCardEl = this.container.querySelector('.wetu-fullscreen-map-v2__journey-card');
    if (journeyCardEl) {
      journeyCardEl.classList.remove('wetu-fullscreen-map-v2__journey-card--active');
    }
    
    const { lat, lng, markerId } = coords;
    
    if (markerId) {
      // Focus on marker and show thumbnail popup
      const markerData = this.markerElements.get(markerId);
      if (markerData) {
        this.map.flyTo({
          center: [markerData.data.lng, markerData.data.lat],
          zoom: 14, // Closer zoom for better context
          duration: 1500
        });
        // Show the new thumbnail-style popup
        this.showThumbnailPopup(markerData.data);
        this.setActiveMarker(markerId, false);
      }
    } else if (lat && lng) {
      // For destinations without markers - create popup data from viewer data
      this.map.flyTo({
        center: [lng, lat],
        zoom: 14, // Closer zoom for better context
        duration: 1500
      });
      
      // Show thumbnail popup with available data
      const popupData = {
        name: viewerData.title || 'Location',
        url: viewerData.url,
        image: viewerData.image,
        lat,
        lng
      };
      this.showThumbnailPopup(popupData);
    }
  }
  
  /**
   * Show a 16:9 thumbnail popup with title overlay and pointer
   * Small by default, expands on hover for better usability
   * Used when clicking "Show on Map" from the content viewer
   */
  showThumbnailPopup(data) {
    this.closePopup();
    
    const { name, url, image, lat, lng, id } = data;
    
    // Generate 16:9 image URL - larger size for crisp display on hover (440x248)
    const thumbnailUrl = image 
      ? image.replace(/width=\d+/, 'width=440').replace(/height=\d+/, 'height=248')
      : '';
    
    const popupContent = `
      <div class="wetu-thumbnail-popup">
        <div class="wetu-thumbnail-popup__card" ${url ? `data-popup-action="view" data-url="${url}" data-title="${name}" data-lat="${lat}" data-lng="${lng}" data-marker-id="${id || ''}"` : ''}>
          ${thumbnailUrl ? `
            <div class="wetu-thumbnail-popup__image-wrapper">
              <img src="${thumbnailUrl}" alt="${name}" class="wetu-thumbnail-popup__image">
              <div class="wetu-thumbnail-popup__gradient"></div>
              <h4 class="wetu-thumbnail-popup__title">${name}</h4>
            </div>
          ` : `
            <div class="wetu-thumbnail-popup__no-image">
              <h4 class="wetu-thumbnail-popup__title wetu-thumbnail-popup__title--no-image">${name}</h4>
            </div>
          `}
        </div>
        <div class="wetu-thumbnail-popup__pointer">
          <svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor">
            <path d="M8 10L0 0h16L8 10z"/>
          </svg>
        </div>
      </div>
    `;
    
    this.popup = new mapboxgl.Popup({
      offset: [0, 0],
      closeButton: false,
      closeOnClick: true,
      maxWidth: '240px',
      anchor: 'bottom',
      className: 'wetu-thumbnail-popup-container'
    })
      .setLngLat([lng, lat])
      .setHTML(popupContent)
      .addTo(this.map);
    
    // Bind click handler if URL exists
    if (url) {
      this.bindThumbnailPopupAction();
    }
  }
  
  /**
   * Bind click handler for thumbnail popup
   */
  bindThumbnailPopupAction() {
    setTimeout(() => {
      const card = document.querySelector('.wetu-thumbnail-popup__card[data-popup-action="view"]');
      if (card) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const url = card.dataset.url;
          const title = card.dataset.title;
          const lat = parseFloat(card.dataset.lat);
          const lng = parseFloat(card.dataset.lng);
          const markerId = card.dataset.markerId;
          const coords = (lat && lng) ? { lat, lng, markerId } : null;
          
          if (url) {
            this.closePopup();
            this.openContentViewer(url, title, coords);
          }
        });
      }
    }, 100);
  }
  
  /**
   * Reinitialize scripts for dynamically loaded content
   */
  reinitializeProductScripts() {
    // Find and execute any inline scripts in the content
    const scripts = this.contentViewerBody.querySelectorAll('script');
    scripts.forEach(oldScript => {
      // Skip external scripts that may cause issues
      if (oldScript.src) return;
      
      // Skip scripts with Shopify JSON data (often contain special characters)
      if (oldScript.type === 'application/json' || oldScript.type === 'application/ld+json') return;
      
      try {
        const newScript = document.createElement('script');
        newScript.textContent = oldScript.textContent;
        
        // Only replace if parent node exists
        if (oldScript.parentNode) {
          oldScript.parentNode.replaceChild(newScript, oldScript);
        }
      } catch (scriptError) {
        // Silently handle script re-initialization errors
        console.warn('Could not reinitialize script:', scriptError.message);
      }
    });
    
    // Dispatch a custom event that sections might listen for
    try {
      window.dispatchEvent(new CustomEvent('shopify:section:load'));
    } catch (e) {
      // Silently handle event dispatch errors
    }
    
    // Re-trigger lazy loading for images
    const lazyImages = this.contentViewerBody.querySelectorAll('img[loading="lazy"]');
    lazyImages.forEach(img => {
      if (img.dataset.src) {
        img.src = img.dataset.src;
      }
    });
    
    // Initialize any sliders/galleries
    this.initializeGalleries();
    
    // Intercept internal links to keep navigation within the 70% panel
    this.initializeLinkInterception();
  }
  
  /**
   * Intercept links within the content viewer to load them in the panel
   * instead of navigating the full page
   */
  initializeLinkInterception() {
    // Only set up once per content viewer instance
    if (this._linkInterceptionInitialized) return;
    
    this.contentViewerBody.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      
      const href = link.getAttribute('href');
      if (!href) return;
      
      // Skip external links, anchors, javascript:, mailto:, tel:, etc.
      if (href.startsWith('http') && !href.includes(window.location.hostname)) return;
      if (href.startsWith('#')) return;
      if (href.startsWith('javascript:')) return;
      if (href.startsWith('mailto:')) return;
      if (href.startsWith('tel:')) return;
      
      // Skip links that explicitly want a new tab/window
      if (link.target === '_blank') return;
      
      // Skip cart, checkout, and account links - these should navigate normally
      if (href.includes('/cart') || href.includes('/checkout') || href.includes('/account')) return;
      
      // Skip add to cart buttons/forms
      if (link.closest('form[action*="/cart"]')) return;
      
      // Get the full URL
      let fullUrl = href;
      if (href.startsWith('/')) {
        fullUrl = window.location.origin + href;
      }
      
      // Intercept the click and load in the panel
      e.preventDefault();
      e.stopPropagation();
      
      // Show loading state
      if (this.contentViewerLoading) {
        this.contentViewerLoading.dataset.loading = 'true';
      }
      
      // Update the fullpage link
      if (this.contentViewerFullpage) {
        this.contentViewerFullpage.href = fullUrl;
      }
      
      // Add back button functionality by storing history
      if (!this._navigationHistory) {
        this._navigationHistory = [];
      }
      this._navigationHistory.push(this.contentViewerBody.innerHTML);
      
      // Update nav back button visibility
      this.updateNavBackButton();
      
      // Fetch and load the new page
      this.fetchProductPage(fullUrl);
    });
    
    this._linkInterceptionInitialized = true;
  }
  
  /**
   * Reset link interception (call when content viewer is closed)
   */
  resetLinkInterception() {
    this._linkInterceptionInitialized = false;
    this._navigationHistory = [];
    this.updateNavBackButton();
  }
  
  /**
   * Navigate back within the content viewer panel
   */
  navigateBackInPanel() {
    if (!this._navigationHistory || this._navigationHistory.length === 0) return;
    
    // Get the previous content
    const previousContent = this._navigationHistory.pop();
    
    // Restore it
    if (previousContent && this.contentViewerBody) {
      this.contentViewerBody.innerHTML = previousContent;
      this.contentViewerBody.classList.add('wetu-content-viewer--full-product');
      
      // Reset and reinitialize
      this._linkInterceptionInitialized = false;
      this.resetZoomGallery();
      this.reinitializeProductScripts();
    }
    
    // Update button visibility
    this.updateNavBackButton();
  }
  
  /**
   * Update the visibility of the nav back button based on history
   */
  updateNavBackButton() {
    if (this.contentViewerNavBack) {
      const hasHistory = this._navigationHistory && this._navigationHistory.length > 0;
      this.contentViewerNavBack.dataset.visible = hasHistory ? 'true' : 'false';
    }
  }
  
  /**
   * Initialize gallery/slider functionality in loaded content
   * Including the Horizon zoom-dialog photo gallery
   */
  initializeGalleries() {
    // Find gallery containers and add basic navigation
    const galleries = this.contentViewerBody.querySelectorAll('.slider, .slideshow, [data-slider]');
    galleries.forEach(gallery => {
      // Trigger resize to help with initialization
      window.dispatchEvent(new Event('resize'));
    });
    
    // Handle thumbnail/dot navigation clicks
    this.contentViewerBody.querySelectorAll('[data-slide-to], .slider__navigation-button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const slideIndex = btn.dataset.slideTo || btn.dataset.index;
        const slider = btn.closest('.slider')?.querySelector('.slider__slide-list, .slideshow__slider');
        if (slider && slideIndex !== undefined) {
          const slides = slider.children;
          const targetSlide = slides[parseInt(slideIndex)];
          if (targetSlide) {
            targetSlide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
          }
        }
      });
    });
    
    // Initialize Horizon media gallery zoom functionality
    this.initializeZoomGallery();
  }
  
  /**
   * Initialize the Horizon zoom-dialog photo gallery for embedded product view
   * This ensures the gallery works within the confined 70% panel space
   */
  initializeZoomGallery() {
    // Clean up any previous handlers by using a unique ID on the content viewer
    if (this._zoomGalleryInitialized) {
      // Already initialized for this instance, skip
      return;
    }
    
    const mediaGallery = this.contentViewerBody.querySelector('media-gallery');
    const zoomDialog = this.contentViewerBody.querySelector('zoom-dialog');
    
    if (!mediaGallery) return;
    
    // Helper function to close any open dialog
    const closeAnyDialog = () => {
      const dialog = this.contentViewerBody.querySelector('zoom-dialog dialog[open], dialog[open]');
      if (dialog) {
        try {
          dialog.close();
        } catch (e) {
          // Fallback - force close by removing open attribute
          dialog.removeAttribute('open');
        }
      }
      
      // Also try the zoom-dialog close method
      const zd = this.contentViewerBody.querySelector('zoom-dialog');
      if (zd && typeof zd.close === 'function') {
        try { zd.close(); } catch (e) {}
      }
    };
    
    // Direct zoom function that opens the dialog
    const openZoom = (index, event) => {
      event?.preventDefault();
      event?.stopPropagation();
      event?.stopImmediatePropagation();
      
      const currentZoomDialog = this.contentViewerBody.querySelector('zoom-dialog');
      const dialog = currentZoomDialog?.querySelector('dialog');
      
      if (dialog) {
        // Try the custom element's open method first
        if (currentZoomDialog && typeof currentZoomDialog.open === 'function') {
          try {
            currentZoomDialog.open(index, event);
            return;
          } catch (e) {
            // Fallback below
          }
        }
        
        // Fallback: directly show the dialog
        try {
          dialog.showModal();
          
          // Scroll to the correct image
          const galleryImages = dialog.querySelectorAll('.dialog-zoomed-gallery__image, .dialog-zoomed-gallery img, .zoomed-image, ul li img');
          if (galleryImages[index]) {
            galleryImages[index].scrollIntoView({ behavior: 'instant', block: 'center' });
          }
        } catch (e) {
          console.log('Dialog showModal failed', e);
        }
      }
    };
    
    // Single event handler for ALL clicks in the content viewer body
    // This handles both opening and closing the gallery
    const handleContentViewerClick = (e) => {
      // Check if we're inside an open dialog
      const openDialog = this.contentViewerBody.querySelector('dialog[open]');
      
      if (openDialog) {
        // ===== CLOSE LOGIC =====
        
        // Close if clicking the close button
        const closeButton = e.target.closest(
          'button[aria-label="Close"], ' +
          '.dialog-zoomed-gallery__close-button, ' +
          '.close-button, ' +
          '[data-dialog-close]'
        );
        if (closeButton) {
          e.preventDefault();
          e.stopPropagation();
          closeAnyDialog();
          return;
        }
        
        // Close if clicking on a zoomed/expanded image (native behavior)
        const clickedImage = e.target.closest(
          '.dialog-zoomed-gallery img, ' +
          '.dialog-zoomed-gallery__image, ' +
          'dialog ul li img, ' +
          'dialog li img, ' +
          '.zoomed-image'
        );
        if (clickedImage) {
          e.preventDefault();
          e.stopPropagation();
          closeAnyDialog();
          return;
        }
        
        // Close if clicking the dialog backdrop
        if (e.target === openDialog || e.target.closest('dialog') === openDialog && !e.target.closest('ul, .dialog-zoomed-gallery, .dialog-thumbnails')) {
          closeAnyDialog();
          return;
        }
        
        // Don't process zoom buttons if dialog is already open
        return;
      }
      
      // ===== OPEN LOGIC =====
      
      // Check if clicking a zoom button
      const zoomButton = e.target.closest(
        '[on\\:click*="/zoom/"], ' +
        '.product-media-container__zoom-button, ' +
        'button[aria-label="Zoom"]'
      );
      
      if (zoomButton) {
        // Extract the index
        let index = 0;
        const onClickAttr = zoomButton.getAttribute('on:click');
        if (onClickAttr) {
          const match = onClickAttr.match(/\/zoom\/(\d+)/);
          if (match) {
            index = parseInt(match[1], 10);
          }
        }
        if (zoomButton.dataset?.index !== undefined) {
          index = parseInt(zoomButton.dataset.index, 10);
        }
        
        openZoom(index, e);
        return;
      }
      
      // Check if clicking on a gallery grid item (not a button)
      const gridItem = e.target.closest('.media-gallery__grid-item, .product-media-container--zoomable');
      if (gridItem && !e.target.closest('button')) {
        // Find the index of this item
        const allItems = this.contentViewerBody.querySelectorAll('.media-gallery__grid-item, .product-media-container--zoomable');
        let index = Array.from(allItems).indexOf(gridItem);
        if (index === -1) index = 0;
        
        openZoom(index, e);
        return;
      }
    };
    
    // Remove any existing handler and add new one
    this.contentViewerBody.removeEventListener('click', this._zoomClickHandler, true);
    this._zoomClickHandler = handleContentViewerClick;
    this.contentViewerBody.addEventListener('click', handleContentViewerClick, true);
    
    // Handle escape key globally
    if (!this._escapeHandlerAdded) {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const openDialog = this.contentViewerBody?.querySelector('dialog[open]');
          if (openDialog) {
            e.preventDefault();
            e.stopPropagation();
            closeAnyDialog();
          }
        }
      });
      this._escapeHandlerAdded = true;
    }
    
    this._zoomGalleryInitialized = true;
  }
  
  /**
   * Reset zoom gallery initialization (call when loading new content)
   */
  resetZoomGallery() {
    this._zoomGalleryInitialized = false;
  }
  
  /**
   * Show error message in content viewer
   */
  showContentError(message) {
    if (this.contentViewerLoading) {
      this.contentViewerLoading.dataset.loading = 'false';
    }
    
    if (this.contentViewerBody) {
      this.contentViewerBody.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 300px; padding: 40px; text-align: center;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.5" style="margin-bottom: 16px;">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p style="margin: 0; color: #666;">${message}</p>
        </div>
      `;
    }
  }

  /**
   * Get a clean product URL with view parameter if needed
   */
  /**
   * Close content viewer and return to map
   */
  closeContentViewer() {
    if (!this.contentViewer) return;
    
    // Hide content viewer
    this.contentViewer.dataset.visible = 'false';
    this.isContentViewerOpen = false;
    
    // Reset navigation history and hide nav back button
    this._navigationHistory = [];
    this.updateNavBackButton();
    
    // Clear stored coordinates/data and hide Show on Map button
    this.currentViewerCoords = null;
    this.currentViewerData = null;
    if (this.showOnMapBtn) {
      this.showOnMapBtn.style.display = 'none';
    }
    
    // Clear content after animation
    setTimeout(() => {
      if (this.contentViewerTitle) {
        this.contentViewerTitle.textContent = '';
      }
      if (this.contentViewerFullpage) {
        this.contentViewerFullpage.href = '#';
      }
      // Clear injected content
      if (this.contentViewerBody) {
        this.contentViewerBody.innerHTML = '';
        this.contentViewerBody.classList.remove('wetu-content-viewer--full-product');
      }
    }, 300);
  }

  /**
   * Show full itinerary map (called when clicking journey card)
   */
  showFullItineraryMap() {
    // Close content viewer if open
    this.closeContentViewer();
    
    // Close any popup
    this.closePopup();
    
    // Clear active marker
    this.markerElements.forEach((m) => m.element.classList.remove('active'));
    this.activeMarkerId = null;
    
    // Activate journey card
    const journeyCard = this.container.querySelector('.wetu-fullscreen-map-v2__journey-card');
    if (journeyCard) {
      journeyCard.classList.add('wetu-fullscreen-map-v2__journey-card--active');
    }
    
    // Fit bounds to show all markers
    this.fitBounds();
  }

  /**
   * Focus on a specific route and fit bounds to its start and end points
   */
  focusRouteWithBounds(route) {
    // Close content viewer if open
    this.closeContentViewer();
    
    // Close any popup
    this.closePopup();
    
    if (!route.startLat || !route.startLng || !route.endLat || !route.endLng) return;
    
    // Create bounds for just this route
    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend([route.startLng, route.startLat]);
    bounds.extend([route.endLng, route.endLat]);
    
    // Fit to these bounds with padding
    const isMobile = window.innerWidth < 900;
    const padding = isMobile ? 60 : 80;
    
    this.map.fitBounds(bounds, {
      padding: { top: padding + 20, bottom: padding, left: padding, right: padding },
      maxZoom: 12,
      duration: 1500
    });
    
    // Remove journey card active state
    const journeyCard = this.container.querySelector('.wetu-fullscreen-map-v2__journey-card');
    if (journeyCard) {
      journeyCard.classList.remove('wetu-fullscreen-map-v2__journey-card--active');
    }
    
    // Show route popup after animation
    setTimeout(() => {
      const midLat = (route.startLat + route.endLat) / 2;
      const midLng = (route.startLng + route.endLng) / 2;
      this.showRoutePopup(route, { lng: midLng, lat: midLat });
    }, 500);
  }

  /**
   * Get map padding based on viewport - equal padding on all sides for the map section
   * The map is now in a dedicated section (70% on desktop, 50% on mobile)
   * so we use equal padding to center all markers
   */
  getMapPadding() {
    const isMobile = window.innerWidth < 900;
    
    if (isMobile) {
      // Mobile: map is top 50%, use equal small padding
      const padding = 50;
      return { top: padding + 40, bottom: padding, left: padding, right: padding };
    }
    
    // Desktop: map is left 70%, use equal padding
    const padding = 60;
    return { 
      top: padding + 20, // Extra for logo overlay
      bottom: padding, 
      left: padding, 
      right: padding 
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
        this.scrollTimelineToDay(marker.day);
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

    // Generate square image URL
    const squareImageUrl = marker.image ? marker.image.replace(/width=\d+/, 'width=600').replace(/height=\d+/, 'height=600') : '';

    // Use data attributes for click handling instead of target="_blank"
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
                <button type="button" class="wetu-map-popup__link wetu-map-popup__link--viewer" data-popup-action="view" data-url="${marker.url}" data-title="${marker.name}" data-lat="${marker.lat}" data-lng="${marker.lng}" data-marker-id="${marker.id}">
                  View Property
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </button>
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
              <button type="button" class="wetu-map-popup__link wetu-map-popup__link--viewer" data-popup-action="view" data-url="${marker.url}" data-title="${marker.name}" data-lat="${marker.lat}" data-lng="${marker.lng}" data-marker-id="${marker.id}">
                View Property
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
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
    
    // Bind click handler for the view button
    this.bindPopupActions();
  }
  
  /**
   * Bind click handlers for popup action buttons
   */
  bindPopupActions() {
    // Wait for popup to be added to DOM
    setTimeout(() => {
      const viewButtons = document.querySelectorAll('[data-popup-action="view"]');
      viewButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const url = btn.dataset.url;
          const title = btn.dataset.title;
          
          // Get coordinates from popup button data attributes
          const lat = parseFloat(btn.dataset.lat);
          const lng = parseFloat(btn.dataset.lng);
          const markerId = btn.dataset.markerId;
          const coords = (lat && lng) ? { lat, lng, markerId } : null;
          
          if (url) {
            this.closePopup();
            this.openContentViewer(url, title, coords);
          }
        });
      });
    }, 100);
  }

  /**
   * Show activity popup
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
              <button type="button" class="wetu-map-popup__link wetu-map-popup__link--viewer" data-popup-action="view" data-url="${activity.url}" data-title="${activity.name}">
                Learn More
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
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
    
    // Bind click handler for the view button
    this.bindPopupActions();
  }

  /**
   * Show destination popup
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
              <button type="button" class="wetu-map-popup__link wetu-map-popup__link--viewer" data-popup-action="view" data-url="${destination.url}" data-title="${destination.name}">
                Explore Destination
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
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
    
    // Bind click handler for the view button
    this.bindPopupActions();
  }

  /**
   * Show route popup
   */
  showRoutePopup(route, lngLat) {
    this.closePopup();

    const isFlightMode = ['ScheduledFlight', 'CharterFlight', 'Helicopter'].includes(route.mode);
    const modeLower = (route.mode || '').toLowerCase();
    const isSelfDrive = modeLower.includes('self') || modeLower.includes('drive');
    
    const googleMapsUrl = !isFlightMode 
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(route.startLocation)}&destination=${encodeURIComponent(route.endLocation)}&travelmode=driving`
      : null;
    
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
          ${route.agency ? `<p style="font-size: 12px; color: rgba(255,255,255,0.7); margin: 0;">${route.agency}</p>` : ''}
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
    
    this.timelinePanel.querySelectorAll('.wetu-event-card--accommodation').forEach(card => {
      const isActive = card.dataset.markerId === markerId;
      card.classList.toggle('active', isActive);
    });
  }

  /**
   * Scroll timeline to day
   */
  scrollTimelineToDay(dayNumber) {
    if (!this.timelinePanel) return;
    
    const scrollContainer = this.timelinePanel.querySelector('[data-timeline-scroll]');
    if (!scrollContainer) return;
    
    const dayElement = this.timelinePanel.querySelector(`.wetu-journey-day[data-day="${dayNumber}"]`);
    if (dayElement) {
      dayElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

      const isFlightMode = route.isFlight || ['ScheduledFlight', 'CharterFlight', 'Helicopter'].includes(route.mode);

      if (isFlightMode) {
        this.addFlightRoute(route, sequenceNumber);
      } else {
        await this.addDrivingRoute(route, sequenceNumber);
      }
      sequenceNumber++;
    }
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
   */
  async addDrivingRoute(route, sequenceNumber) {
    const routeId = `route-driving-${route.id}`;
    let coordinates = null;
    let routeDistance = route.distanceKm;
    let routeDuration = route.duration;

    // Try Mapbox Directions API first
    try {
      const directions = await this.fetchMapboxDirections(
        route.startLng, route.startLat, 
        route.endLng, route.endLat
      );
      
      if (directions && directions.coordinates && directions.coordinates.length >= 2) {
        coordinates = directions.coordinates;
        if (directions.distance && directions.distance > 0) {
          routeDistance = directions.distance;
        }
        if (directions.duration) {
          routeDuration = directions.duration;
        }
      }
    } catch (e) {
      console.warn(`Mapbox Directions failed for route ${route.id}:`, e.message);
    }

    // Fallback to WETU polyline points
    if (!coordinates || coordinates.length < 2) {
      if (route.points && route.points.length > 0) {
        const wetuCoords = this.parseRoutePoints(route.points);
        if (wetuCoords && wetuCoords.length >= 2) {
          coordinates = wetuCoords;
        }
      }
    }

    // Ultimate fallback: straight line
    if (!coordinates || coordinates.length < 2) {
      coordinates = [
        [route.startLng, route.startLat],
        [route.endLng, route.endLat]
      ];
    }

    // Use #333333 for all driving routes with solid line
    const color = '#333333';

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

    // Border/glow layer for contrast
    this.map.addLayer({
      id: `${routeId}-border`,
      type: 'line',
      source: routeId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#fff',
        'line-width': 5,
        'line-opacity': 0.6
      }
    });

    // Main route line - solid #333333
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
        'line-width': 3,
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
   * Add drive label at midpoint
   */
  addDriveLabel(route, coordinates) {
    const midIndex = Math.floor(coordinates.length / 2);
    const position = coordinates[midIndex];
    
    this.routeData.set(route.id, route);
    if (!this.flightIconPositions.has(route.id)) {
      this.flightIconPositions.set(route.id, { lng: position[0], lat: position[1] });
    }
    
    // Build compact single-line label with all key info
    const fromName = this.getShortLocationName(route.fromName || route.startName || '');
    const toName = this.getShortLocationName(route.toName || route.endName || '');
    const dateLabel = route.dateLabel || (route.startDay ? `Day ${route.startDay}` : '');
    
    let infoText = '';
    if (dateLabel) infoText += dateLabel;
    if (fromName && toName) {
      if (infoText) infoText += ' · ';
      infoText += `${fromName} → ${toName}`;
    }
    if (route.duration) {
      if (infoText) infoText += ' · ';
      infoText += route.duration;
    }
    if (route.distanceKm && route.distanceKm > 0) {
      if (infoText) infoText += ' · ';
      infoText += `${route.distanceKm} km`;
    }

    const el = document.createElement('div');
    el.className = 'wetu-drive-label';
    el.innerHTML = `
      <svg class="wetu-drive-label__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>
        <path d="M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>
        <path d="M5 17H3v-6l2-5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0H9"/>
      </svg>
      <span class="wetu-drive-label__text">${infoText}</span>
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
   * Get short location name (first word or abbreviated)
   */
  getShortLocationName(location) {
    if (!location) return '';
    const clean = this.getCleanLocationName(location);
    // Common abbreviations for airports
    const airportMatch = clean.match(/\(([A-Z]{3})\)/);
    if (airportMatch) return airportMatch[1];
    // Get first meaningful word (skip articles)
    const words = clean.split(/[\s,]+/).filter(w => !['the', 'a', 'an', 'to', 'from'].includes(w.toLowerCase()));
    if (words.length === 0) return clean;
    // Return first word, max 12 chars
    return words[0].substring(0, 12);
  }

  /**
   * Decode Google's encoded polyline format
   */
  decodePolyline(encoded) {
    if (!encoded) return [];
    
    const coords = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    
    while (index < encoded.length) {
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
      
      shift = 0;
      result = 0;
      
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      
      const deltaLng = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lng += deltaLng;
      
      coords.push([lng / 1e5, lat / 1e5]);
    }
    
    return coords;
  }

  /**
   * Parse route points from WETU format
   */
  parseRoutePoints(pointsString) {
    if (!pointsString) return [];
    
    try {
      if (pointsString.startsWith('{') || pointsString.includes('"f":"polyline"')) {
        const parsed = JSON.parse(pointsString);
        if (parsed && parsed.f === 'polyline' && parsed.d) {
          const coords = this.decodePolyline(parsed.d);
          if (coords.length >= 2) {
            return coords;
          }
        }
      }
      
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
        return coords;
      }
      
      return [];
    } catch (e) {
      console.warn('Failed to parse route points', e);
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
        'line-color': '#333333',
        'line-width': 2,
        'line-dasharray': [6, 4],
        'line-opacity': 0.8
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
   * Add flight icon at midpoint
   */
  addFlightIcon(route, arcCoordinates) {
    const midIndex = Math.floor(arcCoordinates.length / 2);
    const position = arcCoordinates[midIndex];
    
    this.flightIconPositions.set(route.id, { lng: position[0], lat: position[1] });
    this.routeData.set(route.id, route);
    
    const prevPoint = arcCoordinates[midIndex - 1] || position;
    const nextPoint = arcCoordinates[midIndex + 1] || position;
    const angle = Math.atan2(
      nextPoint[1] - prevPoint[1],
      nextPoint[0] - prevPoint[0]
    ) * (180 / Math.PI);

    // Build compact single-line label with all key info
    const fromName = this.getShortLocationName(route.fromName || route.startName || '');
    const toName = this.getShortLocationName(route.toName || route.endName || '');
    const dateLabel = route.dateLabel || (route.startDay ? `Day ${route.startDay}` : '');
    
    let infoText = '';
    if (dateLabel) infoText += dateLabel;
    if (fromName && toName) {
      if (infoText) infoText += ' · ';
      infoText += `${fromName} → ${toName}`;
    }
    if (route.duration) {
      if (infoText) infoText += ' · ';
      infoText += route.duration;
    }
    if (route.distanceKm && route.distanceKm > 0) {
      if (infoText) infoText += ' · ';
      infoText += `${route.distanceKm} km`;
    }

    const el = document.createElement('div');
    el.className = 'wetu-flight-label';
    el.innerHTML = `
      <svg class="wetu-flight-label__icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="transform: rotate(${angle + 90}deg);">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
      </svg>
      <span class="wetu-flight-label__text">${infoText}</span>
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
   * Toggle timeline collapsed state
   */
  toggleTimelineCollapse() {
    if (!this.timelinePanel) return;
    
    this.isTimelineCollapsed = !this.isTimelineCollapsed;
    this.timelinePanel.dataset.collapsed = this.isTimelineCollapsed;
    
    setTimeout(() => {
      this.map.resize();
    }, 350);
  }

  /**
   * Find a route by ID from config
   */
  findRouteById(routeId) {
    return this.config.routes.find(r => 
      `route-${r.id}` === routeId || 
      r.id === routeId ||
      `route-driving-${r.id}` === routeId ||
      `route-flight-${r.id}` === routeId ||
      routeId === `route-${r.sequence}` ||
      routeId === r.sequence?.toString()
    );
  }

  /**
   * Focus on a route by ID
   */
  focusRoute(routeId) {
    const route = this.findRouteById(routeId);
    
    if (route) {
      const isFlightMode = route.isFlight || ['ScheduledFlight', 'CharterFlight', 'Helicopter'].includes(route.mode);
      
      let popupPosition;
      let zoomLevel = 8;
      
      if (isFlightMode) {
        const flightPos = this.flightIconPositions.get(route.id);
        if (flightPos) {
          popupPosition = flightPos;
        } else {
          const midLat = (route.startLat + route.endLat) / 2;
          const midLng = (route.startLng + route.endLng) / 2;
          const distance = Math.sqrt(
            Math.pow(route.endLng - route.startLng, 2) + 
            Math.pow(route.endLat - route.startLat, 2)
          );
          const arcHeight = distance * 0.12;
          const elevation = Math.sin(0.5 * Math.PI) * arcHeight;
          popupPosition = { lng: midLng, lat: midLat + elevation };
        }
        zoomLevel = 6;
      } else {
        const midLat = (route.startLat + route.endLat) / 2;
        const midLng = (route.startLng + route.endLng) / 2;
        popupPosition = { lng: midLng, lat: midLat };
      }
      
      this.map.flyTo({
        center: [popupPosition.lng, popupPosition.lat],
        zoom: zoomLevel,
        duration: 1500
      });
      
      setTimeout(() => {
        this.showRoutePopup(route, popupPosition);
      }, 500);
    }
  }

  /**
   * Bind event listeners
   */
  bindEventListeners() {
    // Timeline collapse
    const collapseBtn = this.container.querySelector('[data-timeline-collapse]');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => this.toggleTimelineCollapse());
    }

    // Map controls
    const fitBtn = this.container.querySelector('[data-map-fit]');
    if (fitBtn) {
      fitBtn.addEventListener('click', () => this.showFullItineraryMap());
    }

    const zoomInBtn = this.container.querySelector('[data-map-zoom-in]');
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => this.map.zoomIn());
    }

    const zoomOutBtn = this.container.querySelector('[data-map-zoom-out]');
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => this.map.zoomOut());
    }

    // Journey card - click to show full itinerary map
    const journeyCard = this.container.querySelector('[data-action="show-full-map"]');
    if (journeyCard) {
      journeyCard.addEventListener('click', () => this.showFullItineraryMap());
      journeyCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.showFullItineraryMap();
        }
      });
    }

    // Content viewer back button (returns to map)
    if (this.contentViewerBack) {
      this.contentViewerBack.addEventListener('click', () => this.closeContentViewer());
    }
    
    // Content viewer nav back button (navigates back within panel)
    if (this.contentViewerNavBack) {
      this.contentViewerNavBack.addEventListener('click', () => this.navigateBackInPanel());
    }
    
    // Show on Map button in content viewer header (uses same handler as hero overlay)
    if (this.showOnMapBtn) {
      this.showOnMapBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleShowOnMapClick();
      });
    }

    // Action buttons - View Product and Show on Map
    this.container.querySelectorAll('[data-action="view-product"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const url = btn.dataset.url;
        const title = btn.dataset.title || 'Details';
        
        // Get coordinates from the button or parent card
        const card = btn.closest('.wetu-event-card');
        const coords = this.getCardCoordinates(card);
        
        if (url) {
          this.openContentViewer(url, title, coords);
        }
      });
    });
    
    this.container.querySelectorAll('[data-action="show-on-map"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Close content viewer if open
        this.closeContentViewer();
        
        // Remove journey card active state
        const journeyCardEl = this.container.querySelector('.wetu-fullscreen-map-v2__journey-card');
        if (journeyCardEl) {
          journeyCardEl.classList.remove('wetu-fullscreen-map-v2__journey-card--active');
        }
        
        const markerId = btn.dataset.markerId;
        const lat = parseFloat(btn.dataset.lat);
        const lng = parseFloat(btn.dataset.lng);
        
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
        } else if (lat && lng) {
          // For destinations without markers
          this.map.flyTo({
            center: [lng, lat],
            zoom: 10,
            duration: 1500
          });
        }
      });
    });
    
    // Accommodation and destination arrival cards - clicking the card loads the product
    // Now cards have data-action="view-product" directly on them for cleaner interaction
    this.container.querySelectorAll('.wetu-event-card--clickable-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Get URL and title from card's data attributes
        const url = card.dataset.url;
        const title = card.dataset.title || card.querySelector('.wetu-event-card__compact-title')?.textContent || 'Details';
        
        // Get coordinates for Show on Map functionality
        const coords = this.getCardCoordinates(card);
        
        if (url) {
          this.openContentViewer(url, title, coords);
        }
      });
      
      // Keyboard accessibility
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });

    // Transit cards - click to show route on map (self-drive routes fit to bounds)
    this.container.querySelectorAll('.wetu-event-card--transit').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        
        // Close content viewer if open
        this.closeContentViewer();
        
        // Remove journey card active state
        const journeyCardEl = this.container.querySelector('.wetu-fullscreen-map-v2__journey-card');
        if (journeyCardEl) {
          journeyCardEl.classList.remove('wetu-fullscreen-map-v2__journey-card--active');
        }
        
        const routeId = card.dataset.routeId;
        if (routeId) {
          // Check if it's a self-drive route by looking at the card class or data
          const isSelfDrive = card.classList.contains('wetu-event-card--drive') || 
                             card.querySelector('.wetu-event-card__transit-type')?.textContent?.toLowerCase().includes('drive');
          
          // Find the route data
          const route = this.findRouteById(routeId);
          
          if (route && (isSelfDrive || !route.isFlight)) {
            // For self-drive routes, fit bounds to start and end points
            this.focusRouteWithBounds(route);
          } else {
            // For other routes (flights), use the existing focus method
            this.focusRoute(routeId);
          }
        }
      });
    });

    // Destination arrival cards - clicking the main area opens product if available
    this.container.querySelectorAll('.wetu-destination-arrival').forEach(card => {
      const mainArea = card.querySelector('.wetu-destination-arrival__main');
      if (mainArea) {
        mainArea.style.cursor = 'pointer';
        mainArea.addEventListener('click', (e) => {
          // If clicking action buttons, let their handlers work
          if (e.target.closest('[data-action]')) return;
          
          // Find the view-product button to get URL
          const viewBtn = card.querySelector('[data-action="view-product"]');
          if (viewBtn) {
            const url = viewBtn.dataset.url;
            const title = viewBtn.dataset.title || card.querySelector('.wetu-destination-arrival__name')?.textContent || 'Destination';
            const coords = this.getCardCoordinates(card);
            if (url) {
              this.openContentViewer(url, title, coords);
            }
          }
        });
      }
    });
    
    // Activity cards with images (A tags) - load in content viewer
    this.container.querySelectorAll('.wetu-event-card--activity').forEach(card => {
      if (card.tagName === 'A') {
        card.addEventListener('click', (e) => {
          e.preventDefault();
          const url = card.getAttribute('href');
          const title = card.querySelector('.wetu-event-card__overlay-title, .wetu-event-card__activity-link-name')?.textContent || 'Activity';
          const coords = this.getCardCoordinates(card);
          if (url) {
            this.openContentViewer(url, title, coords);
          }
        });
      }
    });

    // Route panel close
    const routePanelClose = this.container.querySelector('[data-route-panel-close]');
    if (routePanelClose && this.routePanel) {
      routePanelClose.addEventListener('click', () => {
        this.routePanel.dataset.visible = 'false';
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
          this.timelinePanel.dataset.collapsed = 'true';
          this.timelinePanel.style.height = '';
        } else {
          this.timelinePanel.dataset.collapsed = 'false';
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
        case 'Escape':
          // First close content viewer if open, then popup
          if (this.isContentViewerOpen) {
            this.closeContentViewer();
          } else {
            this.closePopup();
          }
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
  window.wetuFullscreenMapV2 = new WetuFullscreenMapV2();
});

// Export for external use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WetuFullscreenMapV2;
}

