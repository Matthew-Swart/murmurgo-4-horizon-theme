/**
 * Plekify Chat Interface
 * Version: 1.0.0-phase5-20260429
 *
 * A conversational travel planning interface with:
 * - Voice + text input
 * - Rich inline media (property cards, thumbnails)
 * - Full-screen gallery with contextual overlays
 * - Progressive trip building with selection states
 * - Persistent trip sidebar
 */

class PlekifyChatInterface extends HTMLElement {
  constructor() {
    super();

    // State
    this.state = {
      messages: [],
      confirmedItems: [],
      exploringItems: [],
      isRecording: false,
      isLoading: false,
      galleryOpen: false,
      galleryImages: [],
      galleryIndex: 0,
      galleryContext: null,
      sidebarOpen: false,
      hasStartedConversation: false, // Iteration 5: tracks landing → conversation transition
      sessionId: null, // Briefing session ID
      extractedSignals: {}, // Store extracted signals for match rationale
      itineraryId: null, // Generated itinerary ID for four views
      // Property Popup state
      popupOpen: false,
      popupContext: null,
      popupData: null,
      popupPlaceId: null,
      popupImages: [],
      popupHeroIndex: 0
    };

    // Refs
    this.refs = {};

    // Config from attributes
    this.config = {
      apiBase: this.getAttribute('api-base') || '/api',
      briefingApiBase: this.getAttribute('briefing-api-base') || '/api/briefing',
      cdnBase: this.getAttribute('cdn-base') || 'https://cdn.plekify.com',
      placeholder: this.getAttribute('placeholder') || 'Describe your dream trip...',
      welcomeMessage: this.getAttribute('welcome-message') || "Hi! I'm your travel planning assistant. Tell me about your dream trip - where you'd like to go, who's traveling, and what experiences matter most to you."
    };

    // Bind methods
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleVoiceToggle = this.handleVoiceToggle.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleCardClick = this.handleCardClick.bind(this);
    this.handleGalleryNav = this.handleGalleryNav.bind(this);
    this.handleGalleryClose = this.handleGalleryClose.bind(this);
    this.handleSidebarToggle = this.handleSidebarToggle.bind(this);
    this.handlePromptClick = this.handlePromptClick.bind(this);
  }

  connectedCallback() {
    this.render();
    this.bindRefs();
    this.attachEventListeners();
    this.addWelcomeMessage();
    this.checkMobileView();

    // Listen for resize
    window.addEventListener('resize', () => this.checkMobileView());
  }

  disconnectedCallback() {
    window.removeEventListener('resize', () => this.checkMobileView());
    this.stopVoiceRecording();
  }

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  render() {
    // Iteration 6: Parse pipe-separated aspirational briefs (or fallback to comma-separated for backwards compat)
    const rawTags = this.getAttribute('quick-tags') || '';
    const quickTags = rawTags.includes('|')
      ? rawTags.split('|').map(t => t.trim()).filter(Boolean)
      : rawTags.split(',').map(t => t.trim()).filter(Boolean);

    // Fallback to 5 aspirational briefs if no tags provided
    const defaultTags = quickTags.length > 0 ? quickTags : [
      "My parents are turning 70 and we want to surprise them with the trip of a lifetime. Big Five safari, maybe Victoria Falls, finishing at a quiet beach lodge. Budget around $80k for 8 people.",
      "We're relocating to Dubai and have 3 weeks to show our kids (8 and 11) what Africa is about before we leave. Mix of wildlife, culture, and adventure. Malaria-free if possible.",
      "I'm planning a proposal. She loves wine, architecture, and giraffes. I need something that looks effortless but is actually meticulously planned. Secret itinerary.",
      "Corporate retreat for 12 executives. 4 nights max. Needs to feel exclusive, with game drives and a private chef. Connectivity for one half-day meeting essential.",
      "Solo photography trip. I want to spend 10 days chasing the best light — Namibia's dunes, Botswana's elephants, maybe the Drakensberg. Off-grid is fine."
    ];

    // Get video URL for landing background
    const videoUrl = this.getAttribute('video-url') || 'https://cdn.shopify.com/videos/c/o/v/9a699ef836da4143881c5ef33479d146.mp4';

    // Iteration 5: Reusable input area (moved between landing and conversation on transition)
    const inputAreaHtml = `
      <div class="chat-input-area" data-input-area>
        <div class="chat-input-container">
          <textarea
            class="chat-input"
            data-input
            placeholder="${this.config.placeholder}"
            rows="1"
            aria-label="Type your message"
          ></textarea>

          <button
            class="chat-voice-btn"
            data-voice-btn
            aria-label="Start voice input"
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>

          <button
            class="chat-send-btn"
            data-send-btn
            aria-label="Send message"
            type="button"
            disabled
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    this.innerHTML = `
      <div class="plekify-chat chat-interface" data-chat-interface>

        <!-- Landing State (Iteration 6: cinematic video background with liquid glass UI) -->
        <div class="chat-landing" data-state="landing" data-chat-landing>
          <!-- Video Background -->
          <div class="chat-landing__video-bg" data-video-bg>
            <video
              class="chat-landing__video"
              autoplay
              muted
              loop
              playsinline
              data-landing-video
            >
              <source src="${videoUrl}" type="video/mp4">
            </video>
            <div class="chat-landing__scrim"></div>
          </div>

          <!-- Content overlay -->
          <div class="chat-landing__content">
            <!-- Phase 3: Translucent frosted-glass text card -->
            <div class="chat-welcome__header">
              <h1 class="chat-welcome__title">Design your journey</h1>
              <p class="chat-welcome__subtitle">describe what you're dreaming of.</p>
            </div>

            ${inputAreaHtml}

            <div class="chat-examples" data-prompts>
              <p class="chat-examples__label">Try an example:</p>
              <div class="chat-examples__list">
                ${defaultTags.map(tag => `
                  <button class="chat-example" data-prompt="${tag.replace(/"/g, '&quot;')}" type="button">
                    ${tag}
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- Conversation State (Iteration 5: revealed on first message) -->
        <div class="chat-conversation" data-state="hidden" data-chat-conversation>
          <!-- Main Chat Area -->
          <div class="chat-main">
            <!-- Messages -->
            <div class="chat-messages" data-messages aria-live="polite" aria-label="Chat messages">
            </div>

            <!-- Input area slot (input moves here on transition) -->
            <div class="chat-input-slot" data-input-slot></div>
          </div>

          <!-- Trip Sidebar (Desktop) - hidden until selections exist -->
          <aside class="chat-sidebar chat-sidebar--hidden" data-sidebar aria-label="Your trip selections">
            <div class="chat-sidebar__header">
              <h2 class="chat-sidebar__title">Your Trip</h2>
              <p class="chat-sidebar__subtitle" data-sidebar-subtitle>No selections yet</p>
            </div>

            <div class="chat-sidebar__content" data-sidebar-content>
              <!-- Confirmed items render here -->
            </div>

            <div class="chat-sidebar__footer">
              <div class="sidebar-summary">
                <span class="sidebar-summary__label">Selections</span>
                <span class="sidebar-summary__value" data-selection-count>0</span>
              </div>
              <button class="sidebar-cta" data-sidebar-cta disabled>
                Continue to Itinerary
              </button>
            </div>
          </aside>

          <!-- Mobile Trip Indicator -->
          <button class="chat-trip-indicator" data-trip-indicator style="display: none;" type="button">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            <span class="chat-trip-indicator__count" data-indicator-count>0</span>
          </button>
        </div>

        <!-- Gallery Overlay -->
        <div class="gallery-overlay" data-gallery aria-hidden="true" role="dialog" aria-label="Image gallery">
          <div class="gallery-overlay__main">
            <button class="gallery-overlay__close" data-gallery-close aria-label="Close gallery">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>

            <button class="gallery-overlay__nav gallery-overlay__nav--prev" data-gallery-prev aria-label="Previous image">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>

            <img class="gallery-overlay__image" data-gallery-image src="" alt="">

            <button class="gallery-overlay__nav gallery-overlay__nav--next" data-gallery-next aria-label="Next image">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>

            <!-- Context overlay (bottom-left) -->
            <div class="gallery-overlay__context" data-gallery-context>
              <h3 class="gallery-overlay__title" data-gallery-title></h3>
              <p class="gallery-overlay__subtitle" data-gallery-subtitle></p>
              <div class="gallery-overlay__actions">
                <button class="gallery-overlay__btn gallery-overlay__btn--primary" data-gallery-confirm>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Add to Trip
                </button>
                <button class="gallery-overlay__btn gallery-overlay__btn--secondary" data-gallery-explore>
                  Learn More
                </button>
              </div>
            </div>
          </div>

          <!-- Thumbnail strip -->
          <div class="gallery-overlay__strip" data-gallery-strip>
          </div>
        </div>

        <!-- Rich Property Popup (Grootbos-style) -->
        <div class="property-popup-overlay" data-property-popup aria-hidden="true" role="dialog" aria-modal="true" aria-label="Property details">
          <div class="property-popup">
            <button class="property-popup__close" data-popup-close aria-label="Close property details">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>

            <!-- Loading State -->
            <div class="property-popup__loading" data-popup-loading>
              <div class="property-popup__spinner"></div>
              <p>Loading property details...</p>
            </div>

            <!-- Content (hidden until loaded) -->
            <div class="property-popup__content" data-popup-content style="display: none;">
              <!-- Hero Image + Gallery -->
              <div class="property-popup__gallery">
                <img class="property-popup__hero" data-popup-hero src="" alt="">
                <button class="property-popup__fullscreen" data-popup-fullscreen aria-label="View fullscreen">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 3 21 3 21 9"/>
                    <polyline points="9 21 3 21 3 15"/>
                    <line x1="21" y1="3" x2="14" y2="10"/>
                    <line x1="3" y1="21" x2="10" y2="14"/>
                  </svg>
                </button>
                <div class="property-popup__thumbs" data-popup-thumbs></div>
              </div>

              <!-- Property Info -->
              <div class="property-popup__info">
                <div class="property-popup__header">
                  <h2 class="property-popup__title" data-popup-title></h2>
                  <div class="property-popup__meta">
                    <span class="property-popup__rating" data-popup-rating>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                      <span data-popup-rating-value></span>
                      <span class="property-popup__reviews" data-popup-reviews></span>
                    </span>
                    <span class="property-popup__location" data-popup-location>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                        <circle cx="12" cy="10" r="3"/>
                      </svg>
                      <span data-popup-location-text></span>
                    </span>
                  </div>
                </div>

                <!-- Match Rationale Section -->
                <div class="property-popup__match" data-popup-match style="display: none;">
                  <h3 class="property-popup__section-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Why this matches your brief
                  </h3>
                  <div class="property-popup__match-items" data-popup-match-items></div>
                </div>

                <!-- Description -->
                <div class="property-popup__description">
                  <p data-popup-description></p>
                </div>

                <!-- Contact Info -->
                <div class="property-popup__contact" data-popup-contact>
                  <a class="property-popup__link" data-popup-website href="#" target="_blank" rel="noopener" style="display: none;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="2" y1="12" x2="22" y2="12"/>
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                    Visit Website
                  </a>
                  <a class="property-popup__link" data-popup-phone href="#" style="display: none;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                    <span data-popup-phone-text></span>
                  </a>
                </div>

                <!-- Actions -->
                <div class="property-popup__actions">
                  <button class="property-popup__btn property-popup__btn--primary" data-popup-add type="button">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Add to Trip
                  </button>
                  <button class="property-popup__btn property-popup__btn--secondary" data-popup-reject type="button">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    Not for us
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  bindRefs() {
    this.refs = {
      interface: this.querySelector('[data-chat-interface]'),
      landing: this.querySelector('[data-chat-landing]'),
      conversation: this.querySelector('[data-chat-conversation]'),
      inputArea: this.querySelector('[data-input-area]'),
      inputSlot: this.querySelector('[data-input-slot]'),
      messages: this.querySelector('[data-messages]'),
      input: this.querySelector('[data-input]'),
      voiceBtn: this.querySelector('[data-voice-btn]'),
      sendBtn: this.querySelector('[data-send-btn]'),
      prompts: this.querySelector('[data-prompts]'),
      sidebar: this.querySelector('[data-sidebar]'),
      sidebarSubtitle: this.querySelector('[data-sidebar-subtitle]'),
      sidebarContent: this.querySelector('[data-sidebar-content]'),
      sidebarCta: this.querySelector('[data-sidebar-cta]'),
      selectionCount: this.querySelector('[data-selection-count]'),
      tripIndicator: this.querySelector('[data-trip-indicator]'),
      indicatorCount: this.querySelector('[data-indicator-count]'),
      gallery: this.querySelector('[data-gallery]'),
      galleryImage: this.querySelector('[data-gallery-image]'),
      galleryTitle: this.querySelector('[data-gallery-title]'),
      gallerySubtitle: this.querySelector('[data-gallery-subtitle]'),
      galleryStrip: this.querySelector('[data-gallery-strip]'),
      galleryClose: this.querySelector('[data-gallery-close]'),
      galleryPrev: this.querySelector('[data-gallery-prev]'),
      galleryNext: this.querySelector('[data-gallery-next]'),
      galleryConfirm: this.querySelector('[data-gallery-confirm]'),
      galleryExplore: this.querySelector('[data-gallery-explore]'),
      // Property Popup refs
      propertyPopup: this.querySelector('[data-property-popup]'),
      popupClose: this.querySelector('[data-popup-close]'),
      popupLoading: this.querySelector('[data-popup-loading]'),
      popupContent: this.querySelector('[data-popup-content]'),
      popupHero: this.querySelector('[data-popup-hero]'),
      popupFullscreen: this.querySelector('[data-popup-fullscreen]'),
      popupThumbs: this.querySelector('[data-popup-thumbs]'),
      popupTitle: this.querySelector('[data-popup-title]'),
      popupRating: this.querySelector('[data-popup-rating]'),
      popupRatingValue: this.querySelector('[data-popup-rating-value]'),
      popupReviews: this.querySelector('[data-popup-reviews]'),
      popupLocation: this.querySelector('[data-popup-location]'),
      popupLocationText: this.querySelector('[data-popup-location-text]'),
      popupMatch: this.querySelector('[data-popup-match]'),
      popupMatchItems: this.querySelector('[data-popup-match-items]'),
      popupDescription: this.querySelector('[data-popup-description]'),
      popupWebsite: this.querySelector('[data-popup-website]'),
      popupPhone: this.querySelector('[data-popup-phone]'),
      popupPhoneText: this.querySelector('[data-popup-phone-text]'),
      popupAdd: this.querySelector('[data-popup-add]'),
      popupReject: this.querySelector('[data-popup-reject]')
    };
  }

  attachEventListeners() {
    // Input handling
    this.refs.input.addEventListener('input', () => this.handleInputChange());
    this.refs.input.addEventListener('keydown', this.handleKeyDown);
    this.refs.sendBtn.addEventListener('click', this.handleSubmit);
    this.refs.voiceBtn.addEventListener('click', this.handleVoiceToggle);

    // Prompt chips
    this.refs.prompts.addEventListener('click', this.handlePromptClick);

    // Sidebar
    this.refs.tripIndicator.addEventListener('click', this.handleSidebarToggle);
    this.refs.sidebarCta.addEventListener('click', () => this.handleContinue());

    // Gallery
    this.refs.galleryClose.addEventListener('click', this.handleGalleryClose);
    this.refs.galleryPrev.addEventListener('click', () => this.handleGalleryNav(-1));
    this.refs.galleryNext.addEventListener('click', () => this.handleGalleryNav(1));
    this.refs.galleryConfirm.addEventListener('click', () => this.confirmGalleryItem());
    this.refs.galleryExplore.addEventListener('click', () => this.exploreGalleryItem());

    // Keyboard navigation for gallery
    document.addEventListener('keydown', (e) => {
      if (this.state.popupOpen) {
        if (e.key === 'Escape') this.closePropertyPopup();
        return;
      }
      if (!this.state.galleryOpen) return;
      if (e.key === 'Escape') this.handleGalleryClose();
      if (e.key === 'ArrowLeft') this.handleGalleryNav(-1);
      if (e.key === 'ArrowRight') this.handleGalleryNav(1);
    });

    // Property Popup events
    this.refs.popupClose.addEventListener('click', () => this.closePropertyPopup());
    this.refs.popupAdd.addEventListener('click', () => this.handlePopupAddToTrip());
    this.refs.popupReject.addEventListener('click', () => this.handlePopupReject());
    this.refs.popupFullscreen.addEventListener('click', () => this.openPopupFullscreen());
    this.refs.propertyPopup.addEventListener('click', (e) => {
      if (e.target === this.refs.propertyPopup) this.closePropertyPopup();
    });

    // Click outside sidebar to close (mobile)
    this.refs.interface.addEventListener('click', (e) => {
      if (this.state.sidebarOpen && !this.refs.sidebar.contains(e.target) && !this.refs.tripIndicator.contains(e.target)) {
        this.closeSidebar();
      }
    });
  }

  // --------------------------------------------------------------------------
  // Input Handling
  // --------------------------------------------------------------------------

  handleInputChange() {
    const value = this.refs.input.value.trim();
    this.refs.sendBtn.disabled = value.length === 0;

    // Auto-resize textarea
    this.refs.input.style.height = 'auto';
    this.refs.input.style.height = Math.min(this.refs.input.scrollHeight, 120) + 'px';
  }

  handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSubmit();
    }
  }

  handlePromptClick(e) {
    const chip = e.target.closest('[data-prompt]');
    if (!chip) return;

    const prompt = chip.dataset.prompt;
    this.refs.input.value = prompt;
    this.handleInputChange();
    this.refs.input.focus();
  }

  async handleSubmit() {
    const message = this.refs.input.value.trim();
    if (!message || this.state.isLoading) return;

    // Clear input
    this.refs.input.value = '';
    this.refs.input.style.height = 'auto';
    this.refs.sendBtn.disabled = true;

    // Iteration 5: Transition from landing to conversation on first message
    if (!this.state.hasStartedConversation) {
      this.transitionToConversation();
    }

    // Add user message
    this.addMessage('user', message);

    // Extract signals from user message immediately (instant feedback)
    const clientSignals = this.extractSignalsFromMessage(message);
    if (Object.keys(clientSignals).length > 0) {
      // Store signals in state for match rationale
      this.state.extractedSignals = { ...this.state.extractedSignals, ...clientSignals };
      this.renderSignalChips(clientSignals);
    }

    // Show typing indicator
    this.showTypingIndicator();

    try {
      // Call briefing API
      const response = await this.callBriefingAPI(message);
      this.hideTypingIndicator();

      // Debug logging
      if (this.hasAttribute('data-debug')) {
        console.log('[Plekify Chat] API Response:', response);
      }

      // Process response - render additional API signals only if not already shown from client
      const clientSignalCount = Object.keys(clientSignals).length;
      if (response.signals && Object.keys(response.signals).length > clientSignalCount) {
        // API has more signals than client extraction - show API signals (replaces client display)
        this.renderSignalChips(response.signals);
      } else if (clientSignalCount === 0 && response.extractions && response.extractions.length > 0) {
        // No client signals and API has extractions - show those
        this.renderExtractions(response.extractions);
      }
      // If client already extracted signals, skip API signals to avoid duplicates

      // Render MVB progress - prefer client signals if we have them
      if (clientSignalCount > 0) {
        // Always use client-calculated MVB progress when we have signals
        const estimatedProgress = this.estimateMVBProgress(this.state.extractedSignals);
        this.renderMVBProgress(estimatedProgress);
      } else if (response.mvbProgress && response.mvbProgress.score > 0) {
        // Fallback to API progress only if we have no client signals
        this.renderMVBProgress(response.mvbProgress);
      }

      if (response.message) {
        this.addMessage('assistant', response.message, response.properties || []);
      }

      // If we have destinations, fetch and show properties for them
      if (response.destinations && response.destinations.length > 0) {
        // Fetch properties for the first destination
        for (const dest of response.destinations.slice(0, 2)) {
          await this.fetchAndDisplayProperties(dest);
        }
      }

      // If we already have properties in the response, show them
      if (response.properties?.length) {
        this.renderPropertyCards(response.properties);
      }

    } catch (error) {
      console.error('[Plekify Chat] Error:', error);
      this.hideTypingIndicator();
      this.addMessage('assistant', "I'm sorry, I encountered an issue. Could you try rephrasing that?");
    }
  }

  // --------------------------------------------------------------------------
  // Voice Input
  // --------------------------------------------------------------------------

  handleVoiceToggle() {
    if (this.state.isRecording) {
      this.stopVoiceRecording();
    } else {
      this.startVoiceRecording();
    }
  }

  startVoiceRecording() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Voice input is not supported in your browser.');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.state.isRecording = true;
      this.refs.voiceBtn.classList.add('chat-voice-btn--recording');
      this.refs.voiceBtn.setAttribute('aria-label', 'Stop recording');
    };

    this.recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(result => result[0].transcript)
        .join('');

      this.refs.input.value = transcript;
      this.handleInputChange();
    };

    this.recognition.onend = () => {
      this.state.isRecording = false;
      this.refs.voiceBtn.classList.remove('chat-voice-btn--recording');
      this.refs.voiceBtn.setAttribute('aria-label', 'Start voice input');
    };

    this.recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      this.stopVoiceRecording();
    };

    this.recognition.start();
  }

  stopVoiceRecording() {
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
    this.state.isRecording = false;
    this.refs.voiceBtn.classList.remove('chat-voice-btn--recording');
  }

  // --------------------------------------------------------------------------
  // Messages
  // --------------------------------------------------------------------------

  addWelcomeMessage() {
    this.addMessage('assistant', this.config.welcomeMessage);
  }

  addMessage(role, content, properties = []) {
    const message = {
      id: Date.now(),
      role,
      content,
      properties,
      timestamp: new Date()
    };

    this.state.messages.push(message);
    this.renderMessage(message);
    this.scrollToBottom();
  }

  renderMessage(message) {
    const div = document.createElement('div');
    div.className = `chat-message chat-message--${message.role}`;
    div.setAttribute('data-message-id', message.id);

    div.innerHTML = `
      <div class="chat-message__content">
        ${this.formatMessageContent(message.content)}
      </div>
    `;

    this.refs.messages.appendChild(div);
  }

  formatMessageContent(content) {
    // Basic markdown-like formatting
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  showTypingIndicator() {
    this.state.isLoading = true;
    const indicator = document.createElement('div');
    indicator.className = 'chat-message chat-message--assistant';
    indicator.setAttribute('data-typing', 'true');
    indicator.innerHTML = `
      <div class="chat-typing">
        <span class="chat-typing__dot"></span>
        <span class="chat-typing__dot"></span>
        <span class="chat-typing__dot"></span>
      </div>
    `;
    this.refs.messages.appendChild(indicator);
    this.scrollToBottom();
  }

  hideTypingIndicator() {
    this.state.isLoading = false;
    const indicator = this.refs.messages.querySelector('[data-typing]');
    if (indicator) indicator.remove();
  }

  scrollToBottom() {
    this.refs.messages.scrollTop = this.refs.messages.scrollHeight;
  }

  // --------------------------------------------------------------------------
  // "I Heard" Extractions & Signal Chips
  // --------------------------------------------------------------------------

  // Iteration 6: Signal type grayscale configuration (Apple-grade, no colors)
  getSignalConfig(type) {
    const configs = {
      'DEST': { color: '#1a1a1a', bg: '#f5f5f5', border: '#e5e5e5', label: 'Destination', icon: '' },
      'GOAL': { color: '#1a1a1a', bg: '#fafafa', border: '#ececec', label: 'Goal', icon: '' },
      'LOG':  { color: '#4a4a4a', bg: '#f5f5f5', border: '#e5e5e5', label: 'Logistics', icon: '' },
      'BUD':  { color: '#4a4a4a', bg: '#fafafa', border: '#ececec', label: 'Budget', icon: '' },
      'PREF': { color: '#4a4a4a', bg: '#f5f5f5', border: '#e5e5e5', label: 'Preferred', icon: '' },
      'SOFT': { color: '#8a8a8a', bg: '#fafafa', border: '#ececec', label: 'Nice to have', icon: '' },
      'HARD': { color: '#7a3a3a', bg: '#fbf3f3', border: '#f0d8d8', label: 'Required', icon: '' }, // subtle warm tint for required
      'FEAR': { color: '#8a8a8a', bg: '#fafafa', border: '#ececec', label: 'Concern', icon: '' }
    };
    return configs[type] || configs['DEST'];
  }

  // Client-side signal extraction for instant feedback
  extractSignalsFromMessage(message) {
    const signals = {};
    const lowerMsg = message.toLowerCase();

    // African destinations (countries and regions)
    const destinations = [];
    const destPatterns = [
      { pattern: /\bsouth africa\b/i, name: 'South Africa' },
      { pattern: /\bkenya\b/i, name: 'Kenya' },
      { pattern: /\btanzania\b/i, name: 'Tanzania' },
      { pattern: /\bbotswana\b/i, name: 'Botswana' },
      { pattern: /\bnamibia\b/i, name: 'Namibia' },
      { pattern: /\bzimbabwe\b/i, name: 'Zimbabwe' },
      { pattern: /\bzambia\b/i, name: 'Zambia' },
      { pattern: /\brwanda\b/i, name: 'Rwanda' },
      { pattern: /\buganda\b/i, name: 'Uganda' },
      { pattern: /\bmorocco\b/i, name: 'Morocco' },
      { pattern: /\bkruger\b/i, name: 'Kruger' },
      { pattern: /\bserengeti\b/i, name: 'Serengeti' },
      { pattern: /\bmasai mara\b/i, name: 'Masai Mara' },
      { pattern: /\bvictoria falls\b/i, name: 'Victoria Falls' },
      { pattern: /\bcape town\b/i, name: 'Cape Town' },
      { pattern: /\bfranschhoek\b/i, name: 'Franschhoek' },
      { pattern: /\bwinelands\b/i, name: 'Winelands' },
      { pattern: /\bsabi sands?\b/i, name: 'Sabi Sands' },
      { pattern: /\bokavango\b/i, name: 'Okavango Delta' },
      { pattern: /\bngorongoro\b/i, name: 'Ngorongoro' },
      { pattern: /\bzanzibar\b/i, name: 'Zanzibar' }
    ];
    destPatterns.forEach(({ pattern, name }) => {
      if (pattern.test(message)) destinations.push(name);
    });
    if (destinations.length > 0) signals.DEST = destinations;

    // Travel goals/types (trip objectives)
    const goals = [];
    if (/\bhoneymoon\b/i.test(message)) goals.push('Honeymoon');
    if (/\banniversary\b/i.test(message)) goals.push('Anniversary');
    if (/\bcelebrat(e|ing|ion)\s+(?:our\s+)?([^,.!?]+)/i.test(message)) {
      const celebMatch = message.match(/celebrat(?:e|ing|ion)\s+(?:our\s+)?([^,.!?]+)/i);
      if (celebMatch) goals.push('Celebrating ' + celebMatch[1].trim());
    }
    if (/\bromantic\b/i.test(message)) goals.push('Romantic getaway');
    if (/\bfamily\b/i.test(message)) goals.push('Family trip');
    if (/\badventure\b/i.test(message)) goals.push('Adventure');
    if (/\bsafari\b/i.test(message)) goals.push('Safari');
    if (/\bwildlife\b/i.test(message)) goals.push('Wildlife experience');
    if (/\bbeach\b/i.test(message)) goals.push('Beach time');
    if (/\bcultur(e|al)\b/i.test(message)) goals.push('Cultural experience');
    if (/\brelax/i.test(message)) goals.push('Relaxation');
    if (/\bbig five\b/i.test(message)) goals.push('Big Five');
    if (/\bbirthday\b/i.test(message)) goals.push('Birthday celebration');
    if (/\bretire(ment|d|ing)?\b/i.test(message)) goals.push('Retirement trip');
    if (/\bbucket\s*list\b/i.test(message)) goals.push('Bucket list');
    if (/\bonce\s+in\s+a\s+lifetime\b/i.test(message)) goals.push('Once-in-a-lifetime');
    if (/\bpropos(e|al|ing)\b/i.test(message)) goals.push('Proposal trip');
    if (/\bfirst\s+(safari|trip|time)\b/i.test(message)) goals.push('First safari');
    if (/\bkids[''']?\s+(first|first\s+time)\b/i.test(message)) goals.push("Kids' first safari");
    if (/\bphotograph(y|ic|er)\b/i.test(message)) goals.push('Photography trip');
    if (/\bcorporate\s+(retreat|event|trip)\b/i.test(message)) goals.push('Corporate retreat');
    if (/\bwedding\b/i.test(message)) goals.push('Wedding celebration');
    if (goals.length > 0) signals.GOAL = [...new Set(goals)];

    // Logistics - duration, dates, origin, party
    const logistics = [];
    const durationMatch = message.match(/(\d+)[\s-]*(day|night|week)s?/i);
    if (durationMatch) {
      logistics.push(`${durationMatch[1]} ${durationMatch[2]}s`);
    }
    // Dates
    const monthMatch = message.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
    if (monthMatch) logistics.push(monthMatch[1]);
    const yearMatch = message.match(/\b(202\d)\b/);
    if (yearMatch) logistics.push(yearMatch[1]);
    if (/\bnext (month|year)\b/i.test(message)) logistics.push('Next ' + message.match(/next (month|year)/i)[1]);
    // Origin cities/airports
    const originPatterns = [
      { pattern: /\bfrom\s+(boston|new\s+york|nyc|los\s+angeles|la|chicago|miami|dallas|houston|atlanta|denver|seattle|san\s+francisco|washington|london|dubai|johannesburg|cape\s+town)\b/i, extract: 1 },
      { pattern: /\bflying\s+(?:from|out\s+of)\s+([a-zA-Z\s]+)\b/i, extract: 1 },
      { pattern: /\bdeparting\s+(?:from\s+)?([a-zA-Z\s]+)\b/i, extract: 1 }
    ];
    for (const { pattern, extract } of originPatterns) {
      const match = message.match(pattern);
      if (match && match[extract]) {
        logistics.push('Flying from ' + match[extract].trim());
        break;
      }
    }
    // Party composition
    const partyMatch = message.match(/(\d+)\s*(people|persons?|adults?|couples?|guests?|pax)\b/i);
    if (partyMatch) logistics.push(`${partyMatch[1]} ${partyMatch[2]}`);
    if (/\bcouple\b/i.test(message) && !/\d+\s*couples?\b/i.test(message)) logistics.push('Couple');
    if (/\bsolo\b/i.test(message)) logistics.push('Solo traveler');
    if (logistics.length > 0) signals.LOG = [...new Set(logistics)];

    // Budget signals
    const budget = [];
    // Match budget with context (per night, per person, total)
    const budgetPerNightMatch = message.match(/\$\s*([\d,]+)\s*(?:per|a|\/)\s*night/i);
    const budgetPerPersonMatch = message.match(/\$\s*([\d,]+)\s*(?:per|a|\/)\s*(?:person|pax|pp)/i);
    const budgetTotalMatch = message.match(/(?:budget|total|around|about)\s*(?:of\s*)?\$\s*([\d,]+)(k)?/i);
    const budgetSimpleMatch = message.match(/\$\s*([\d,]+)k?\b/i);

    if (budgetPerNightMatch) {
      budget.push('$' + budgetPerNightMatch[1] + ' per night');
    } else if (budgetPerPersonMatch) {
      budget.push('$' + budgetPerPersonMatch[1] + ' per person');
    } else if (budgetTotalMatch) {
      const amt = budgetTotalMatch[1].replace(/,/g, '');
      const suffix = budgetTotalMatch[2] ? '000' : '';
      budget.push('Budget: $' + Number(amt + suffix).toLocaleString());
    } else if (budgetSimpleMatch) {
      const amt = budgetSimpleMatch[1].replace(/,/g, '');
      const suffix = message.match(/\$\s*[\d,]+k/i) ? '000' : '';
      budget.push('$' + Number(amt + suffix).toLocaleString());
    }

    if (/\bluxury\b/i.test(message)) budget.push('Luxury');
    if (/\bhigh-?end\b/i.test(message)) budget.push('High-end');
    if (/\bpremium\b/i.test(message)) budget.push('Premium');
    if (/\bbudget\b/i.test(message) && !/budget\s*(?:of|around|is)/i.test(message)) budget.push('Budget-conscious');
    if (/\bmid-?range\b/i.test(message)) budget.push('Mid-range');
    if (/\bsplurge\b/i.test(message)) budget.push('Ready to splurge');
    if (/\baffordable\b/i.test(message)) budget.push('Affordable');
    if (/\bno\s+(?:expense|cost)\s+spared\b/i.test(message)) budget.push('No expense spared');
    if (budget.length > 0) signals.BUD = [...new Set(budget)];

    // Hard constraints (non-negotiable requirements)
    const hard = [];
    if (/\bmust\s+(have|see|be|include)\b/i.test(message)) {
      const mustMatch = message.match(/must\s+(?:have|see|be|include)\s+([^,.!?]+)/i);
      if (mustMatch) hard.push(mustMatch[1].trim());
      else hard.push('Must-have items');
    }
    if (/\bnon-?negotiable\b/i.test(message)) hard.push('Non-negotiables');
    if (/\brequire[ds]?\b/i.test(message)) hard.push('Requirements');
    if (/\bwheelchair\b/i.test(message)) hard.push('Wheelchair accessible');
    if (/\baccessib(le|ility)\b/i.test(message)) hard.push('Accessibility needs');
    if (/\bdisab(led|ility)\b/i.test(message)) hard.push('Accessibility needs');
    if (/\bmobility\s+(issues?|needs?|requirements?)\b/i.test(message)) hard.push('Mobility requirements');
    if (/\bdietary\b/i.test(message)) hard.push('Dietary requirements');
    if (/\bvegetarian\b/i.test(message)) hard.push('Vegetarian');
    if (/\bvegan\b/i.test(message)) hard.push('Vegan');
    if (/\ballerg(y|ies|ic)\b/i.test(message)) hard.push('Allergy considerations');
    if (hard.length > 0) signals.HARD = [...new Set(hard)];

    // Preferences (strong preferences - would prefer, ideally)
    const prefs = [];
    if (/\bprefer\s+([^,.!?]+)/i.test(message)) {
      const prefMatch = message.match(/prefer\s+([^,.!?]+)/i);
      if (prefMatch) prefs.push(prefMatch[1].trim());
    }
    if (/\b(?:would\s+)?prefer\b/i.test(message) && prefs.length === 0) prefs.push('Preferences noted');
    if (/\bideally\b/i.test(message)) {
      const idealMatch = message.match(/ideally\s+([^,.!?]+)/i);
      if (idealMatch) prefs.push(idealMatch[1].trim());
    }
    if (/\bboutique\s+(lodge|hotel|accommodation)s?\b/i.test(message)) prefs.push('Boutique lodges');
    if (/\bboutique\b/i.test(message) && prefs.length === 0) prefs.push('Boutique style');
    if (/\bprivate\s+(villa|lodge|suite|pool)\b/i.test(message)) prefs.push('Private accommodation');
    if (/\bprivacy\b/i.test(message)) prefs.push('Privacy');
    if (/\bintimate\b/i.test(message)) prefs.push('Intimate setting');
    if (/\bsmall(er)?\s+(camps?|lodges?|groups?)\b/i.test(message)) prefs.push('Smaller camps');
    if (/\blike\s+([^,.!?]+)/i.test(message) && /\bi\s+like\b/i.test(message)) {
      const likeMatch = message.match(/i\s+like\s+([^,.!?]+)/i);
      if (likeMatch) prefs.push(likeMatch[1].trim());
    }
    if (prefs.length > 0) signals.PREF = [...new Set(prefs)];

    // Soft signals (nice-to-haves - would be nice, if possible)
    const soft = [];
    if (/\bwould\s+be\s+nice\s+(?:to\s+)?([^,.!?]+)/i.test(message)) {
      const niceMatch = message.match(/would\s+be\s+nice\s+(?:to\s+)?([^,.!?]+)/i);
      if (niceMatch) soft.push(niceMatch[1].trim());
    }
    if (/\bif\s+possible\b/i.test(message)) {
      const possMatch = message.match(/([^,.!?]+)\s+if\s+possible/i);
      if (possMatch) soft.push(possMatch[1].trim());
      else soft.push('If possible');
    }
    if (/\bmaybe\s+([^,.!?]+)/i.test(message)) {
      const maybeMatch = message.match(/maybe\s+([^,.!?]+)/i);
      if (maybeMatch) soft.push(maybeMatch[1].trim());
    }
    if (/\b(?:nice|great)\s+to\s+(?:see|have|do)\b/i.test(message)) {
      const niceToMatch = message.match(/(?:nice|great)\s+to\s+(?:see|have|do)\s+([^,.!?]+)/i);
      if (niceToMatch) soft.push(niceToMatch[1].trim());
    }
    if (/\bsee\s+elephants?\b/i.test(message)) soft.push('See elephants');
    if (/\bsee\s+lions?\b/i.test(message)) soft.push('See lions');
    if (/\bsee\s+leopards?\b/i.test(message)) soft.push('See leopards');
    if (/\bsee\s+rhinos?\b/i.test(message)) soft.push('See rhinos');
    if (/\bsee\s+whales?\b/i.test(message)) soft.push('See whales');
    if (/\bsee\s+gorillas?\b/i.test(message)) soft.push('See gorillas');
    if (/\bbonus\b/i.test(message)) soft.push('Bonus experience');
    if (/\boptional\b/i.test(message)) soft.push('Optional extras');
    if (soft.length > 0) signals.SOFT = [...new Set(soft)];

    // Fears/concerns (anxieties to address)
    const fears = [];
    if (/\bworried\s+(?:about\s+)?([^,.!?]+)/i.test(message)) {
      const worryMatch = message.match(/worried\s+(?:about\s+)?([^,.!?]+)/i);
      if (worryMatch) fears.push(worryMatch[1].trim());
    }
    if (/\bafraid\s+(?:of\s+)?([^,.!?]+)/i.test(message)) {
      const afraidMatch = message.match(/afraid\s+(?:of\s+)?([^,.!?]+)/i);
      if (afraidMatch) fears.push(afraidMatch[1].trim());
    }
    if (/\bmalaria\b/i.test(message)) fears.push('Malaria concerns');
    if (/\bmalaria-?free\b/i.test(message)) fears.push('Malaria-free preferred');
    if (/\bheights?\b/i.test(message) && /\b(afraid|fear|don't like|scared)\b/i.test(message)) fears.push('Fear of heights');
    if (/\bflying\b/i.test(message) && /\b(afraid|fear|don't like|scared|nervous)\b/i.test(message)) fears.push('Fear of flying');
    if (/\bsafety\b/i.test(message)) fears.push('Safety concerns');
    if (/\bsecur(e|ity)\b/i.test(message)) fears.push('Security considerations');
    if (/\bhealth\s+(concern|issue|problem)/i.test(message)) fears.push('Health concerns');
    if (/\bdon't\s+(?:like|want)\s+([^,.!?]+)/i.test(message)) {
      const dontMatch = message.match(/don't\s+(?:like|want)\s+([^,.!?]+)/i);
      if (dontMatch) fears.push('Avoid: ' + dontMatch[1].trim());
    }
    if (/\bavoid(?:ing)?\s+([^,.!?]+)/i.test(message)) {
      const avoidMatch = message.match(/avoid(?:ing)?\s+([^,.!?]+)/i);
      if (avoidMatch) fears.push('Avoid: ' + avoidMatch[1].trim());
    }
    if (/\bno\s+crowds?\b/i.test(message)) fears.push('Avoid crowds');
    if (/\bconcern(?:ed|s)?\b/i.test(message) && fears.length === 0) fears.push('Concerns noted');
    if (fears.length > 0) signals.FEAR = [...new Set(fears)];

    // Travelers - add to LOG if not already captured
    if (/\bkids?\b|\bchildren\b/i.test(message)) {
      if (!signals.LOG) signals.LOG = [];
      if (!signals.LOG.some(l => l.toLowerCase().includes('children'))) {
        signals.LOG.push('Traveling with children');
      }
    }

    return signals;
  }

  // Estimate MVB progress from client-extracted signals
  estimateMVBProgress(signals) {
    if (!signals || Object.keys(signals).length === 0) {
      return {
        score: 0,
        missing: ['Destination', 'Party size', 'Budget', 'Trip purpose'],
        found: [],
        complete: false
      };
    }

    const found = [];
    const missing = [];
    let score = 0;

    // MVB field weights
    // Core required fields (must sum to 1.0)
    const weights = {
      destination: { weight: 0.25, label: 'Destination' },
      travelers: { weight: 0.25, label: 'Party size' },
      budget: { weight: 0.25, label: 'Budget' },
      purpose: { weight: 0.25, label: 'Trip purpose' }
    };
    // Optional bonus fields (do not penalise if missing)
    const bonuses = {
      dates: { weight: 0.10, label: 'Travel dates' },
      duration: { weight: 0.10, label: 'Trip duration' },
      constraints: { weight: 0.10, label: 'Special requirements' }
    };

    // Check destination
    if (signals.DEST && signals.DEST.length > 0) {
      score += weights.destination.weight;
      found.push('destination');
    } else {
      missing.push(weights.destination.label);
    }

    // Check dates (in LOG signals) — optional bonus only
    const logSignals = signals.LOG || [];
    const logTexts = logSignals.map(l => typeof l === 'string' ? l : (l.text || '')).join(' ');

    const hasDate = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec|202\d|next month|next year)\b/i.test(logTexts);
    if (hasDate) {
      score += bonuses.dates.weight;
      found.push('dates');
    }

    // Check duration — optional bonus only
    const hasDuration = /\b(\d+\s*(days?|nights?|weeks?))\b/i.test(logTexts);
    if (hasDuration) {
      score += bonuses.duration.weight;
      found.push('duration');
    }

    // Check travelers/party size (check LOG and GOAL for family indicators)
    const goalTexts = (signals.GOAL || []).map(g => typeof g === 'string' ? g : (g.text || '')).join(' ');
    const hasTravelers = /\b(\d+\s*(people|persons?|adults?|kids?|children|travelers?|guests?|pax)|family|couple|solo|honeymoon|traveling with)\b/i.test(logTexts + ' ' + goalTexts);
    if (hasTravelers) {
      score += weights.travelers.weight;
      found.push('travelers');
    } else {
      missing.push(weights.travelers.label);
    }

    // Check budget
    if (signals.BUD && signals.BUD.length > 0) {
      score += weights.budget.weight;
      found.push('budget');
    } else {
      missing.push(weights.budget.label);
    }

    // Check trip purpose/goals
    if (signals.GOAL && signals.GOAL.length > 0) {
      score += weights.purpose.weight;
      found.push('purpose');
    } else {
      missing.push(weights.purpose.label);
    }

    // Check constraints (HARD signals) — optional bonus only
    if (signals.HARD && signals.HARD.length > 0) {
      score += bonuses.constraints.weight;
      found.push('constraints');
    }

    console.log('[Plekify MVB] Calculation:', { signals, score: Math.round(score * 100), found, missing });

    return {
      score: Math.min(score, 1),
      missing: missing.slice(0, 3), // Show max 3 missing items
      found,
      complete: missing.length === 0
    };
  }

  renderExtractions(extractions) {
    const container = document.createElement('div');
    container.className = 'chat-message chat-message--assistant';

    const badges = extractions.map(ext => {
      const config = this.getSignalConfig(ext.type || 'DEST');
      return `
        <div class="chat-extraction chat-extraction--${(ext.type || 'DEST').toLowerCase()}"
             style="background: ${config.bg}; border-color: ${config.color};">
          <span class="chat-extraction__type">${config.icon}</span>
          <span class="chat-extraction__label">${ext.label}</span>
          ${ext.source ? `<span class="chat-extraction__source">from "${ext.source}"</span>` : ''}
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="chat-message__content">
        <p style="margin-bottom: 8px; opacity: 0.8; font-size: 13px;">I understood:</p>
        ${badges}
      </div>
    `;

    this.refs.messages.appendChild(container);
    this.scrollToBottom();
  }

  // Render full signal taxonomy with grouped display - with editable chips
  renderSignalChips(signals) {
    if (!signals || Object.keys(signals).length === 0) return;

    const container = document.createElement('div');
    container.className = 'chat-message chat-message--assistant';
    container.setAttribute('data-signal-container', 'true');

    // Group signals by type
    const groups = [];
    const typeOrder = ['DEST', 'HARD', 'PREF', 'GOAL', 'LOG', 'BUD', 'FEAR', 'SOFT'];

    typeOrder.forEach(type => {
      const items = signals[type] || [];
      if (items.length > 0) {
        const config = this.getSignalConfig(type);
        const chips = items.map((item, index) => {
          const value = typeof item === 'string' ? item : item.value;
          const label = typeof item === 'string' ? item : (item.label || item.value);
          // Iteration 6: Grayscale styling with border
          return `
            <span class="signal-chip signal-chip--${type.toLowerCase()} signal-chip--editable"
                  style="background: ${config.bg}; border: 1px solid ${config.border}; color: ${config.color};"
                  data-signal-type="${type}"
                  data-signal-index="${index}"
                  data-signal-value="${value}">
              <span class="chip-text">${label}</span>
              <button class="chip-remove" data-remove-signal="${type}" data-remove-index="${index}" aria-label="Remove ${label}" type="button">×</button>
            </span>
          `;
        }).join('');

        // Iteration 6: No emoji icons, uppercase label only
        groups.push(`
          <div class="signal-group" data-signal-group="${type}">
            <span class="signal-group__label">${config.label}</span>
            <div class="signal-group__chips">${chips}</div>
          </div>
        `);
      }
    });

    if (groups.length === 0) return;

    container.innerHTML = `
      <div class="chat-message__content">
        <p style="margin-bottom: 12px; opacity: 0.8; font-size: 13px;">I understood from your brief:</p>
        <div class="signal-groups" data-signals-wrapper>
          ${groups.join('')}
        </div>
      </div>
    `;

    this.refs.messages.appendChild(container);

    // Attach event listeners for editable chips
    this.attachSignalChipListeners(container);

    this.scrollToBottom();
  }

  // Attach edit/remove listeners to signal chips
  attachSignalChipListeners(container) {
    // Remove button click
    container.querySelectorAll('.chip-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = btn.dataset.removeSignal;
        const index = parseInt(btn.dataset.removeIndex);
        this.removeSignal(type, index, btn.closest('.signal-chip'));
      });
    });

    // Chip text click to edit (specific to text element)
    container.querySelectorAll('.signal-chip--editable .chip-text').forEach(textEl => {
      textEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const chip = textEl.closest('.signal-chip');
        this.handleChipTextClick(e, chip);
      });
    });
  }

  // Handle click on chip text to make editable
  handleChipTextClick(event, chip) {
    const textEl = chip.querySelector('.chip-text');
    if (!textEl || textEl.contentEditable === 'true') return;

    const originalText = textEl.textContent;
    const type = chip.dataset.signalType;
    const index = parseInt(chip.dataset.signalIndex);

    // Make editable
    textEl.contentEditable = true;
    textEl.focus();
    chip.classList.add('signal-chip--editing');

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    // Save handler
    const saveHandler = () => {
      textEl.contentEditable = false;
      chip.classList.remove('signal-chip--editing');
      const newText = textEl.textContent.trim();

      if (newText && newText !== originalText) {
        this.updateSignalText(type, index, newText);
        chip.dataset.signalValue = newText;

        // Debug logging
        if (this.hasAttribute('data-debug')) {
          console.log('[Plekify Chat] Chip edited:', type, index, originalText, '→', newText);
        }
      } else if (!newText) {
        // Empty text = remove chip
        this.removeSignal(type, index, chip);
      }

      textEl.removeEventListener('blur', saveHandler);
    };

    // Keydown handler
    const keydownHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        textEl.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        textEl.textContent = originalText;
        textEl.contentEditable = false;
        chip.classList.remove('signal-chip--editing');
        textEl.removeEventListener('blur', saveHandler);
        textEl.removeEventListener('keydown', keydownHandler);
      }
    };

    textEl.addEventListener('blur', saveHandler);
    textEl.addEventListener('keydown', keydownHandler);
  }

  // Update signal text value
  updateSignalText(signalType, index, newText) {
    if (this.state.extractedSignals[signalType] && this.state.extractedSignals[signalType][index] !== undefined) {
      this.state.extractedSignals[signalType][index] = newText;
    }
  }

  // Legacy method for backwards compatibility
  editSignalChip(chip) {
    this.handleChipTextClick(null, chip);
  }

  // Update a signal value
  updateSignal(type, index, newValue) {
    if (this.state.extractedSignals[type] && this.state.extractedSignals[type][index] !== undefined) {
      this.state.extractedSignals[type][index] = newValue;

      // Debug logging
      if (this.hasAttribute('data-debug')) {
        console.log('[Plekify Chat] Signal updated:', type, index, newValue);
      }
    }
  }

  // Remove a signal
  removeSignal(type, index, chipElement) {
    if (this.state.extractedSignals[type]) {
      // Remove from state
      this.state.extractedSignals[type].splice(index, 1);

      // Remove chip from DOM with animation
      chipElement.style.transform = 'scale(0.8)';
      chipElement.style.opacity = '0';
      setTimeout(() => {
        chipElement.remove();

        // Check if group is now empty
        const group = this.querySelector(`[data-signal-group="${type}"]`);
        if (group) {
          const remainingChips = group.querySelectorAll('.signal-chip');
          if (remainingChips.length === 0) {
            group.remove();
          } else {
            // Re-index remaining chips
            remainingChips.forEach((chip, newIndex) => {
              chip.dataset.signalIndex = newIndex;
              const removeBtn = chip.querySelector('.chip-remove');
              if (removeBtn) {
                removeBtn.dataset.removeIndex = newIndex;
              }
            });
          }
        }
      }, 150);

      // Debug logging
      if (this.hasAttribute('data-debug')) {
        console.log('[Plekify Chat] Signal removed:', type, index);
      }
    }
  }

  // Render MVB progress indicator
  renderMVBProgress(mvbProgress) {
    if (!mvbProgress) return;

    const score = mvbProgress.score || 0;
    const missing = mvbProgress.missing || [];
    const found = mvbProgress.found || [];
    const percentage = Math.round(score * 100);

    // Determine color based on completeness
    let barColor = 'var(--text-muted, #8a8a8a)';
    if (percentage >= 80) {
      barColor = 'var(--accent-success, #22c55e)';
    } else if (percentage >= 50) {
      barColor = 'var(--accent-warning, #f59e0b)';
    }

    // Format field names for display
    const formatFieldName = (field) => {
      const names = {
        destination: 'Destination',
        dates: 'Travel dates',
        duration: 'Trip duration',
        travelers: 'Party size',
        budget: 'Budget',
        purpose: 'Trip purpose',
        constraints: 'Special requirements'
      };
      return names[field] || field;
    };

    const container = document.createElement('div');
    container.className = 'chat-message chat-message--assistant';

    // Build found items display
    const foundItems = found.length > 0 ? `
      <div class="mvb-found" style="margin-bottom: 8px;">
        ${found.map(item => `<span class="mvb-found__item" style="color: var(--accent-success, #22c55e); font-size: 12px; margin-right: 8px;">✓ ${formatFieldName(item)}</span>`).join('')}
      </div>
    ` : '';

    // Build missing items display
    const missingItems = missing.length > 0 ? `
      <div class="mvb-missing">
        <span style="opacity: 0.7; font-size: 12px;">To complete your brief:</span>
        ${missing.map(item => `<span class="mvb-missing__item">○ ${item}</span>`).join('')}
      </div>
    ` : '<div style="color: var(--accent-success, #22c55e); font-size: 12px;">✓ Brief complete!</div>';

    container.innerHTML = `
      <div class="chat-message__content">
        <div class="mvb-progress">
          <div class="mvb-progress__header">
            <span class="mvb-progress__label">Brief Completeness</span>
            <span class="mvb-progress__value" style="color: ${barColor}; font-weight: 600;">${percentage}%</span>
          </div>
          <div class="mvb-progress__bar">
            <div class="mvb-progress__fill" style="width: ${percentage}%; background: ${barColor};"></div>
          </div>
          ${foundItems}
          ${missingItems}
        </div>
      </div>
    `;

    this.refs.messages.appendChild(container);
    this.scrollToBottom();
  }

  // --------------------------------------------------------------------------
  // Property Cards
  // --------------------------------------------------------------------------

  // Generate match rationale for a property based on extracted signals
  generateMatchRationale(property) {
    const matches = [];
    const signals = this.state.extractedSignals || {};

    // Check destination match
    if (signals.DEST && signals.DEST.length > 0) {
      const propLocation = (property.location || '').toLowerCase();
      const propName = (property.name || '').toLowerCase();
      for (const dest of signals.DEST) {
        const destLower = dest.toLowerCase();
        if (propLocation.includes(destLower) || propName.includes(destLower) || destLower.includes(propLocation.split(',')[0])) {
          matches.push({ text: `In ${dest}`, status: 'confirmed' });
          break;
        }
      }
    }

    // Check goal matches
    if (signals.GOAL && signals.GOAL.length > 0) {
      const propType = (property.type || '').toLowerCase();
      const propTags = (property.tags || []).map(t => t.toLowerCase());
      const propName = (property.name || '').toLowerCase();

      for (const goal of signals.GOAL) {
        const goalLower = goal.toLowerCase();
        if (goalLower.includes('safari') && (propType.includes('safari') || propType.includes('lodge') || propTags.includes('big five') || propTags.includes('wildlife'))) {
          matches.push({ text: 'Safari experience', status: 'confirmed' });
        } else if (goalLower.includes('honeymoon') || goalLower.includes('romantic')) {
          matches.push({ text: 'Romantic setting', status: 'checking' });
        } else if (goalLower.includes('family')) {
          matches.push({ text: 'Family-friendly', status: 'checking' });
        } else if (goalLower.includes('big five')) {
          matches.push({ text: 'Big Five reserve', status: 'confirmed' });
        } else if (goalLower.includes('beach')) {
          if (propTags.includes('beach') || propType.includes('beach')) {
            matches.push({ text: 'Beach access', status: 'confirmed' });
          }
        }
      }
    }

    // Check budget match
    if (signals.BUD && signals.BUD.length > 0) {
      for (const bud of signals.BUD) {
        if (bud.toLowerCase().includes('luxury')) {
          matches.push({ text: 'Luxury property', status: 'confirmed' });
        }
      }
    }

    // Check constraint matches
    if (signals.HARD && signals.HARD.length > 0) {
      matches.push({ text: 'Checking requirements', status: 'checking' });
    }

    // Limit to 3 matches max
    return matches.slice(0, 3);
  }

  // Phase 3: Feature flag for inline thumbnails (set to true for new compact mode)
  static INLINE_THUMBNAILS_ENABLED = true;

  renderPropertyCards(properties, context = {}) {
    // Phase 3: Use inline thumbnails by default, fallback to old compact cards
    if (PlekifyChatInterface.INLINE_THUMBNAILS_ENABLED) {
      this.renderInlinePropertyThumbnails(properties, context);
    } else {
      this.renderCompactPropertyCards(properties, context);
    }
  }

  // Phase 3: NEW inline thumbnails (160×90px, multi-per-row, WhatsApp-style)
  renderInlinePropertyThumbnails(properties, context = {}) {
    if (!properties || !properties.length) return;

    // Create container - sits directly in the chat flow
    const container = document.createElement('div');
    container.className = 'property-thumbnails-inline';
    container.setAttribute('data-destination', context.destinationName || '');

    properties.forEach(property => {
      const state = this.getPropertyState(property.id);
      const thumb = document.createElement('div');
      thumb.className = `property-thumb ${state === 'confirmed' ? 'property-thumb--confirmed' : ''}`;
      thumb.setAttribute('data-property-id', property.id);
      thumb.setAttribute('data-place-id', property.place_id || property.id);
      thumb.setAttribute('tabindex', '0');
      thumb.setAttribute('role', 'button');
      thumb.setAttribute('aria-label', `View ${property.name}`);

      // Phase 3: Image with fallback for missing URLs (~89% of lodges have no CDN image)
      const rawImageUrl = property.image || property.hero_image || (property.images && property.images[0]);
      const hasImage = rawImageUrl && rawImageUrl.trim() !== '';

      let imageHtml;
      if (hasImage) {
        const imageUrl = this.getOptimizedImageUrl(rawImageUrl, 320, 180);
        imageHtml = `<img class="property-thumb__image" src="${imageUrl}" alt="${this.escapeHtml(property.name)}" loading="lazy" onerror="this.outerHTML='<div class=\\'property-thumb__placeholder\\'>${this.escapeHtml(property.name).slice(0, 30)}</div>'">`;
      } else {
        // Fallback: gray placeholder with property name
        const shortName = (property.name || 'Property').slice(0, 25);
        imageHtml = `<div class="property-thumb__placeholder">${this.escapeHtml(shortName)}</div>`;
      }

      // Location: extract region/destination
      const location = property.location || property.region || context.destinationName || '';

      thumb.innerHTML = `
        ${imageHtml}
        <div class="property-thumb__content">
          <p class="property-thumb__name">${this.escapeHtml(property.name || 'Unknown')}</p>
          <p class="property-thumb__location">${this.escapeHtml(location)}</p>
        </div>
      `;

      // Store property data for click handlers
      thumb._propertyData = property;

      // Click handler: open property popup
      thumb.addEventListener('click', () => this.handleCardClick(property));
      thumb.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.handleCardClick(property);
        }
      });

      container.appendChild(thumb);
    });

    // Append to messages area
    this.refs.messages.appendChild(container);
    this.scrollToBottom();
  }

  // Phase 3: Render skeleton placeholders while properties load
  renderPropertySkeletons(count = 4, destinationName = '') {
    const container = document.createElement('div');
    container.className = 'property-thumbnails-inline';
    container.setAttribute('data-skeleton', 'true');
    container.setAttribute('data-destination', destinationName);

    for (let i = 0; i < count; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'property-thumb property-thumb--skeleton';
      skeleton.innerHTML = `
        <div class="property-thumb__image"></div>
        <div class="property-thumb__content">
          <div class="property-thumb__name"></div>
          <div class="property-thumb__location"></div>
        </div>
      `;
      container.appendChild(skeleton);
    }

    this.refs.messages.appendChild(container);
    return container;
  }

  // Phase 3: Replace skeleton with actual properties
  replaceSkeletonWithProperties(skeletonContainer, properties, context = {}) {
    if (!skeletonContainer || !skeletonContainer.parentNode) return;

    // Create new container with real data
    const container = document.createElement('div');
    container.className = 'property-thumbnails-inline';

    properties.forEach(property => {
      const state = this.getPropertyState(property.id);
      const thumb = document.createElement('div');
      thumb.className = `property-thumb ${state === 'confirmed' ? 'property-thumb--confirmed' : ''}`;
      thumb.setAttribute('data-property-id', property.id);
      thumb.setAttribute('data-place-id', property.place_id || property.id);
      thumb.setAttribute('tabindex', '0');
      thumb.setAttribute('role', 'button');

      const rawImageUrl = property.image || property.hero_image || (property.images && property.images[0]);
      const hasImage = rawImageUrl && rawImageUrl.trim() !== '';

      let imageHtml;
      if (hasImage) {
        const imageUrl = this.getOptimizedImageUrl(rawImageUrl, 320, 180);
        imageHtml = `<img class="property-thumb__image" src="${imageUrl}" alt="${this.escapeHtml(property.name)}" loading="lazy">`;
      } else {
        const shortName = (property.name || 'Property').slice(0, 25);
        imageHtml = `<div class="property-thumb__placeholder">${this.escapeHtml(shortName)}</div>`;
      }

      const location = property.location || property.region || context.destinationName || '';

      thumb.innerHTML = `
        ${imageHtml}
        <div class="property-thumb__content">
          <p class="property-thumb__name">${this.escapeHtml(property.name || 'Unknown')}</p>
          <p class="property-thumb__location">${this.escapeHtml(location)}</p>
        </div>
      `;

      thumb._propertyData = property;
      thumb.addEventListener('click', () => this.handleCardClick(property));
      thumb.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.handleCardClick(property);
        }
      });

      container.appendChild(thumb);
    });

    // Replace skeleton with real content
    skeletonContainer.parentNode.replaceChild(container, skeletonContainer);
  }

  // Legacy: Compact property cards (kept for backwards compatibility, gated by flag)
  renderCompactPropertyCards(properties, context = {}) {
    const propertiesWithImages = properties.filter(property => property.image || property.hero_image || (Array.isArray(property.images) && property.images.length > 0));
    const propertiesToRender = propertiesWithImages.length > 0 ? propertiesWithImages : properties;
    if (!propertiesToRender.length) return;

    const section = document.createElement('section');
    section.className = 'property-results';

    if (context.destinationName || context.searchMethod) {
      const searchLabel = {
        qmd: 'Semantic shortlist',
        'qmd+postgis': 'Semantic shortlist + nearby stays',
        postgis: 'Nearby stays'
      }[context.searchMethod] || 'Property options';

      const header = document.createElement('div');
      header.className = 'property-results__header';
      header.innerHTML = `
        <div>
          <p class="property-results__eyebrow">Properties</p>
          <h3 class="property-results__title">${this.escapeHtml(context.destinationName || 'Recommended stays')}</h3>
        </div>
        <p class="property-results__meta">${this.escapeHtml(searchLabel)}</p>
      `;
      section.appendChild(header);
    }

    const container = document.createElement('div');
    container.className = 'property-cards-compact';

    propertiesToRender.forEach(property => {
      const state = this.getPropertyState(property.id);
      const card = document.createElement('div');
      card.className = `property-card ${state === 'confirmed' ? 'property-card--confirmed' : ''}`;
      card.setAttribute('data-property-id', property.id);
      card.setAttribute('data-state', state);

      const imageUrl = this.getOptimizedImageUrl(property.image || property.hero_image, 640, 420);

      // Generate match rationale (Iteration 6: grayscale symbols, no colored emoji)
      const matchRationale = this.generateMatchRationale(property);
      const rationaleHtml = matchRationale.length > 0 ? `
        <div class="match-rationale">
          ${matchRationale.map(m => `
            <span class="match-item match-${m.status}">
              <span class="match-symbol">${m.status === 'confirmed' ? '·' : m.status === 'checking' ? '–' : '×'}</span> ${m.text}
            </span>
          `).join('')}
        </div>
      ` : '';

      const reviewCount = Number(property.reviews_count || 0);
      const stats = [];
      if (property.rating) stats.push(`${Number(property.rating).toFixed(1)} rating`);
      if (reviewCount) stats.push(`${reviewCount.toLocaleString()} reviews`);
      const statsHtml = stats.length > 0 ? `<p class="property-card__stats">${this.escapeHtml(stats.join(' · '))}</p>` : '';

      const summarySource = property.description || '';
      const summary = summarySource.length > 160 ? `${summarySource.slice(0, 157)}...` : summarySource;
      const summaryHtml = summary ? `<p class="property-card__summary">${this.escapeHtml(summary)}</p>` : '';

      card.innerHTML = `
        <img class="property-card__image" src="${imageUrl}" alt="${this.escapeHtml(property.name)}" loading="lazy" data-gallery-trigger>
        <div class="property-card__content">
          <h4 class="property-card__title">${this.escapeHtml(property.name)}</h4>
          <p class="property-card__location">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            ${this.escapeHtml(property.location || '')}
          </p>
          ${statsHtml}
          ${summaryHtml}
          ${rationaleHtml}
        </div>
        <div class="property-card__actions">
          <button class="property-card__action property-card__action--add" title="Add to trip" type="button" data-action="add">✓</button>
          <button class="property-card__action property-card__action--dismiss" title="Not interested" type="button" data-action="dismiss">×</button>
        </div>
      `;

      // Store property data on card for handlers
      card._propertyData = property;

      container.appendChild(card);
    });

    section.appendChild(container);
    this.refs.messages.appendChild(section);

    // Attach action handlers
    this.attachCardActionListeners(container);

    this.scrollToBottom();
  }

  renderDestinationCard(destination, fallbackName = null) {
    const name = destination.name || fallbackName;
    if (!name) return;

    const section = document.createElement('section');
    section.className = 'destination-card';
    section.setAttribute('data-destination-id', destination.id || name.toLowerCase().replace(/\s+/g, '-'));

    const imageUrl = this.getOptimizedImageUrl(destination.hero_image || destination.image || (destination.images && destination.images[0]), 1200, 700);
    const location = destination.location || '';
    const description = destination.description || '';
    const level = destination.level || 'Destination';
    const mapHtml = destination.map_url
      ? `<a class="destination-card__map" href="${destination.map_url}" target="_blank" rel="noopener noreferrer">View map</a>`
      : '';
    const matches = Array.isArray(destination.matches) ? destination.matches.slice(0, 3) : [];

    section.innerHTML = `
      <div class="destination-card__media">
        <img class="destination-card__image" src="${imageUrl}" alt="${this.escapeHtml(name)}" loading="lazy">
      </div>
      <div class="destination-card__content">
        <p class="destination-card__eyebrow">${this.escapeHtml(level)}</p>
        <h3 class="destination-card__title">${this.escapeHtml(name)}</h3>
        <p class="destination-card__location">${this.escapeHtml(location)}</p>
        <p class="destination-card__description">${this.escapeHtml(description)}</p>
        <div class="destination-card__footer">
          <div class="destination-card__chips">
            ${matches.map(match => `<span class="destination-card__chip">${this.escapeHtml(match)}</span>`).join('')}
          </div>
          ${mapHtml}
        </div>
      </div>
    `;

    this.refs.messages.appendChild(section);
    this.scrollToBottom();
  }

  // Attach event listeners to property card actions
  attachCardActionListeners(container) {
    // Add button handlers
    container.querySelectorAll('.property-card__action--add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.property-card');
        const property = card._propertyData;
        if (property) {
          this.addToTrip(property, card);
        }
      });
    });

    // Dismiss button handlers
    container.querySelectorAll('.property-card__action--dismiss').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.property-card');
        this.dismissProperty(card);
      });
    });

    // Image click opens gallery
    container.querySelectorAll('.property-card__image').forEach(img => {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.property-card');
        const property = card._propertyData;
        if (property) {
          this.handleCardClick(property);
        }
      });
    });
  }

  // Add property to trip from compact card
  addToTrip(property, cardElement) {
    this.confirmItem(property);
    cardElement.classList.add('property-card--confirmed');
    cardElement.setAttribute('data-state', 'confirmed');
  }

  // Dismiss a property (fade and remove)
  dismissProperty(cardElement) {
    cardElement.classList.add('property-card--dismissed');
    // Remove after animation
    setTimeout(() => {
      cardElement.remove();
    }, 300);
  }

  // Legacy carousel rendering (kept for backwards compatibility)
  renderPropertyCardsCarousel(properties) {
    const container = document.createElement('div');
    container.className = 'chat-cards';

    properties.forEach(property => {
      const state = this.getPropertyState(property.id);
      const card = document.createElement('div');
      card.className = `chat-card chat-card--${state}`;
      card.setAttribute('data-property-id', property.id);
      card.setAttribute('data-state', state);
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${property.name}, ${property.location}`);

      // Use Cloudflare CDN transform for 280x147 images
      const imageUrl = this.getOptimizedImageUrl(property.image, 280, 147);

      // Generate match rationale
      const matchRationale = this.generateMatchRationale(property);
      const rationaleHtml = matchRationale.length > 0 ? `
        <div class="match-rationale">
          ${matchRationale.map(m => `
            <div class="match-item match-${m.status}">
              ${m.status === 'confirmed' ? '✓' : m.status === 'checking' ? '⚠️' : '✗'} ${m.text}
            </div>
          `).join('')}
        </div>
      ` : '';

      card.innerHTML = `
        <img class="chat-card__image" src="${imageUrl}" alt="${property.name}" loading="lazy">
        <div class="chat-card__content">
          <h4 class="chat-card__name">${property.name}</h4>
          <div class="chat-card__meta">
            <span class="chat-card__location">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              ${property.location}
            </span>
            ${property.rating ? `
              <span class="chat-card__rating">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
                ${property.rating}
              </span>
            ` : ''}
          </div>
          ${rationaleHtml}
        </div>
        <div class="chat-card__state-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      `;

      card.addEventListener('click', () => this.handleCardClick(property));
      container.appendChild(card);
    });

    this.refs.messages.appendChild(container);
    this.scrollToBottom();
  }

  getOptimizedImageUrl(url, width, height) {
    // If no URL, return a placeholder SVG
    if (!url) {
      return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%23d8cfbe'/%3E%3Cstop offset='100%25' style='stop-color:%23b39e79'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='${width}' height='${height}' fill='url(%23g)'/%3E%3C/svg%3E`;
    }
    // cdn.plekify.com is fronted by Cloudflare Image Resizing.
    // Query strings are silently ignored by R2 - we MUST use the
    // /cdn-cgi/image/ path syntax to get a resized derivative.
    if (url.includes('cdn.plekify.com/')) {
      if (url.includes('/cdn-cgi/image/')) return url; // already transformed
      const dpr = (window.devicePixelRatio || 1) > 1 ? 2 : 1;
      const w = Math.round(width * dpr);
      const h = Math.round(height * dpr);
      return url.replace(
        'https://cdn.plekify.com/',
        `https://cdn.plekify.com/cdn-cgi/image/width=${w},height=${h},fit=cover,quality=85,format=auto/`
      );
    }
    // imagedelivery.net (Cloudflare Images) uses query-string transforms
    if (url.includes('imagedelivery.net')) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}width=${width}&height=${height}&fit=cover`;
    }
    // If Shopify CDN URL, add transforms
    if (url.includes('cdn.shopify.com')) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}width=${width}&height=${height}&crop=center`;
    }
    // Fallback to original
    return url;
  }

  getPropertyState(propertyId) {
    if (this.state.confirmedItems.find(item => item.id === propertyId)) {
      return 'confirmed';
    }
    if (this.state.exploringItems.find(item => item.id === propertyId)) {
      return 'exploring';
    }
    return 'suggested';
  }

  handleCardClick(property) {
    // If property has a place_id, open the rich popup
    const placeId = property.id || property.place_id;
    if (placeId) {
      this.openPropertyPopup(placeId, property);
      return;
    }

    // Fallback: Open gallery with property images if no place_id
    // Handle case where images array is empty or image is undefined
    let images = property.images;
    if (!images || images.length === 0) {
      images = property.image ? [property.image] : [];
    }
    // Filter out undefined/null images
    images = images.filter(img => img);

    // If still no images, create a placeholder and open anyway
    if (images.length === 0) {
      images = [null]; // Will be handled by getOptimizedImageUrl
    }

    this.openGallery(images, property);
  }

  // --------------------------------------------------------------------------
  // Gallery
  // --------------------------------------------------------------------------

  openGallery(images, context) {
    // Allow opening even with placeholder images (null values)
    if (!images || images.length === 0) {
      images = [null]; // Placeholder will be generated by getOptimizedImageUrl
    }

    this.state.galleryOpen = true;
    this.state.galleryImages = images;
    this.state.galleryIndex = 0;
    this.state.galleryContext = context;

    // Render thumbnails
    this.refs.galleryStrip.innerHTML = images.map((img, i) => {
      const thumbUrl = this.getOptimizedImageUrl(img, 80, 45);
      return `
        <button
          class="gallery-overlay__thumb ${i === 0 ? 'gallery-overlay__thumb--active' : ''}"
          data-gallery-thumb="${i}"
          type="button"
        >
          <img src="${thumbUrl}" alt="Thumbnail ${i + 1}">
        </button>
      `;
    }).join('');

    // Attach thumb click listeners
    this.refs.galleryStrip.querySelectorAll('[data-gallery-thumb]').forEach(thumb => {
      thumb.addEventListener('click', () => {
        this.goToGalleryImage(parseInt(thumb.dataset.galleryThumb));
      });
    });

    // Set context
    if (context) {
      this.refs.galleryTitle.textContent = context.name || '';
      this.refs.gallerySubtitle.textContent = context.location || '';
    }

    // Show first image
    this.updateGalleryImage();

    // Show overlay
    this.refs.gallery.classList.add('gallery-overlay--active');
    this.refs.gallery.setAttribute('aria-hidden', 'false');

    // Trap focus
    this.refs.galleryClose.focus();
  }

  handleGalleryClose() {
    this.state.galleryOpen = false;
    this.refs.gallery.classList.remove('gallery-overlay--active');
    this.refs.gallery.setAttribute('aria-hidden', 'true');
  }

  handleGalleryNav(direction) {
    const newIndex = this.state.galleryIndex + direction;
    if (newIndex >= 0 && newIndex < this.state.galleryImages.length) {
      this.goToGalleryImage(newIndex);
    }
  }

  goToGalleryImage(index) {
    this.state.galleryIndex = index;
    this.updateGalleryImage();

    // Update active thumb
    this.refs.galleryStrip.querySelectorAll('[data-gallery-thumb]').forEach((thumb, i) => {
      thumb.classList.toggle('gallery-overlay__thumb--active', i === index);
    });
  }

  updateGalleryImage() {
    const imageUrl = this.state.galleryImages[this.state.galleryIndex];
    const optimizedUrl = this.getOptimizedImageUrl(imageUrl, 1600, 900);

    // Fade transition
    this.refs.galleryImage.style.opacity = '0';
    setTimeout(() => {
      this.refs.galleryImage.src = optimizedUrl;
      this.refs.galleryImage.alt = this.state.galleryContext?.name || 'Gallery image';
      this.refs.galleryImage.style.opacity = '1';
    }, 150);
  }

  confirmGalleryItem() {
    if (!this.state.galleryContext) return;

    this.confirmItem(this.state.galleryContext);
    this.handleGalleryClose();
  }

  exploreGalleryItem() {
    if (!this.state.galleryContext) return;

    this.setItemState(this.state.galleryContext, 'exploring');
    this.handleGalleryClose();

    // Open rich property popup instead of just showing a message
    const placeId = this.state.galleryContext.id || this.state.galleryContext.place_id;
    if (placeId) {
      this.openPropertyPopup(placeId, this.state.galleryContext);
    } else {
      // Fallback for properties without place_id
      this.addMessage('assistant', `Great choice! **${this.state.galleryContext.name}** is a wonderful property. ${this.state.galleryContext.description || 'Would you like me to tell you more about it?'}`);
    }
  }

  // --------------------------------------------------------------------------
  // Rich Property Popup
  // --------------------------------------------------------------------------

  async openPropertyPopup(placeId, fallbackContext = null) {
    // Store context for actions
    this.state.popupOpen = true;
    this.state.popupContext = fallbackContext;
    this.state.popupPlaceId = placeId;

    // Show popup with loading state
    this.refs.popupLoading.style.display = 'flex';
    this.refs.popupContent.style.display = 'none';
    this.refs.propertyPopup.classList.add('property-popup-overlay--active');
    this.refs.propertyPopup.setAttribute('aria-hidden', 'false');

    try {
      // Fetch detailed property data from API
      const apiBase = this.config.briefingApiBase.replace('/api/briefing', '/api');
      const response = await fetch(`${apiBase}/places/${encodeURIComponent(placeId)}/detail?session_id=${this.state.sessionId || ''}`);

      if (!response.ok) {
        throw new Error(`Failed to load property: ${response.status}`);
      }

      const data = await response.json();

      // Store full data for actions
      this.state.popupData = data;

      // Populate popup content
      this.populatePropertyPopup(data);

      // Show content, hide loading
      this.refs.popupLoading.style.display = 'none';
      this.refs.popupContent.style.display = 'block';

    } catch (error) {
      console.error('[Plekify Chat] Failed to load property details:', error);

      // Show fallback content from context if available
      if (fallbackContext) {
        this.populatePropertyPopupFallback(fallbackContext);
        this.refs.popupLoading.style.display = 'none';
        this.refs.popupContent.style.display = 'block';
      } else {
        this.closePropertyPopup();
        this.addMessage('assistant', 'Sorry, I could not load the property details. Please try again.');
      }
    }
  }

  populatePropertyPopup(data) {
    // Title
    this.refs.popupTitle.textContent = data.name || 'Property';

    // Rating
    if (data.rating) {
      this.refs.popupRatingValue.textContent = data.rating.toFixed(1);
      this.refs.popupReviews.textContent = data.review_count ? `(${data.review_count.toLocaleString()} reviews)` : '';
      this.refs.popupRating.style.display = 'flex';
    } else {
      this.refs.popupRating.style.display = 'none';
    }

    // Location
    if (data.location || data.address) {
      this.refs.popupLocationText.textContent = data.location || data.address;
      this.refs.popupLocation.style.display = 'flex';
    } else {
      this.refs.popupLocation.style.display = 'none';
    }

    // Description
    this.refs.popupDescription.textContent = data.description || '';

    // Hero image
    if (data.images?.hero) {
      this.refs.popupHero.src = data.images.hero;
      this.refs.popupHero.alt = data.name;
      this.state.popupImages = data.images.gallery || [];
      this.state.popupHeroIndex = 0;
    }

    // Thumbnail strip
    if (data.images?.gallery?.length > 1) {
      this.refs.popupThumbs.innerHTML = data.images.gallery.slice(0, 8).map((img, i) => `
        <button class="property-popup__thumb ${i === 0 ? 'property-popup__thumb--active' : ''}"
                data-popup-thumb="${i}" type="button">
          <img src="${img.thumb || img.card}" alt="${img.alt || 'Property image'}">
        </button>
      `).join('');

      // Attach click handlers to thumbnails
      this.refs.popupThumbs.querySelectorAll('[data-popup-thumb]').forEach(thumb => {
        thumb.addEventListener('click', () => {
          const idx = parseInt(thumb.dataset.popupThumb);
          this.setPopupHeroImage(idx);
        });
      });
    } else {
      this.refs.popupThumbs.innerHTML = '';
    }

    // Match rationale - supports both old array format and new structured format
    const rationale = data.match_rationale;
    if (rationale) {
      let rationaleHtml = '';

      // Check for new structured format (has matches/warnings/personalized)
      if (typeof rationale === 'object' && !Array.isArray(rationale) && rationale.matches) {
        const { matches, warnings, personalized } = rationale;

        // Header based on personalization status
        rationaleHtml += `<div class="property-popup__rationale-header">${
          personalized ? 'Why this matches your brief:' : 'Property highlights:'
        }</div>`;

        // Display matches
        if (matches && matches.length > 0) {
          rationaleHtml += '<ul class="property-popup__rationale-matches">';
          matches.forEach(match => {
            rationaleHtml += `<li class="property-popup__rationale-match property-popup__rationale-match--${match.type?.toLowerCase() || 'info'}">${match.text}</li>`;
          });
          rationaleHtml += '</ul>';
        }

        // Display warnings
        if (warnings && warnings.length > 0) {
          rationaleHtml += '<ul class="property-popup__rationale-warnings">';
          warnings.forEach(warning => {
            rationaleHtml += `<li class="property-popup__rationale-warning">${warning.text}</li>`;
          });
          rationaleHtml += '</ul>';
        }

        this.refs.popupMatchItems.innerHTML = rationaleHtml;
        this.refs.popupMatch.style.display = (matches?.length > 0 || warnings?.length > 0) ? 'block' : 'none';
      }
      // Fallback: old array format
      else if (Array.isArray(rationale) && rationale.length > 0) {
        this.refs.popupMatchItems.innerHTML = rationale.map(match => `
          <div class="property-popup__match-item property-popup__match-item--${match.status}">
            <span class="property-popup__match-icon">${match.status === 'confirmed' ? '✓' : '⚠'}</span>
            <span class="property-popup__match-signal">${match.signal}</span>
            <span class="property-popup__match-type">${match.type}</span>
          </div>
        `).join('');
        this.refs.popupMatch.style.display = 'block';
      } else {
        this.refs.popupMatch.style.display = 'none';
      }
    } else {
      this.refs.popupMatch.style.display = 'none';
    }

    // Contact info
    if (data.website) {
      this.refs.popupWebsite.href = data.website;
      this.refs.popupWebsite.style.display = 'flex';
    } else {
      this.refs.popupWebsite.style.display = 'none';
    }

    if (data.phone) {
      this.refs.popupPhone.href = `tel:${data.phone}`;
      this.refs.popupPhoneText.textContent = data.phone;
      this.refs.popupPhone.style.display = 'flex';
    } else {
      this.refs.popupPhone.style.display = 'none';
    }
  }

  populatePropertyPopupFallback(context) {
    // Use basic context data as fallback
    this.refs.popupTitle.textContent = context.name || 'Property';
    this.refs.popupLocationText.textContent = context.location || '';
    this.refs.popupDescription.textContent = context.description || '';

    if (context.rating) {
      this.refs.popupRatingValue.textContent = context.rating;
      this.refs.popupReviews.textContent = '';
      this.refs.popupRating.style.display = 'flex';
    } else {
      this.refs.popupRating.style.display = 'none';
    }

    // Use available images
    if (context.image || context.images?.[0]) {
      this.refs.popupHero.src = context.image || context.images[0];
      this.refs.popupHero.alt = context.name;
    }

    // Hide sections we don't have data for
    this.refs.popupMatch.style.display = 'none';
    this.refs.popupThumbs.innerHTML = '';
    this.refs.popupWebsite.style.display = 'none';
    this.refs.popupPhone.style.display = 'none';
  }

  setPopupHeroImage(index) {
    if (!this.state.popupImages || index >= this.state.popupImages.length) return;

    const img = this.state.popupImages[index];
    this.state.popupHeroIndex = index;

    // Update hero image with fade
    this.refs.popupHero.style.opacity = '0';
    setTimeout(() => {
      this.refs.popupHero.src = img.hero || img.large || img.medium;
      this.refs.popupHero.style.opacity = '1';
    }, 150);

    // Update active thumbnail
    this.refs.popupThumbs.querySelectorAll('[data-popup-thumb]').forEach((thumb, i) => {
      thumb.classList.toggle('property-popup__thumb--active', i === index);
    });
  }

  closePropertyPopup() {
    this.state.popupOpen = false;
    this.refs.propertyPopup.classList.remove('property-popup-overlay--active');
    this.refs.propertyPopup.setAttribute('aria-hidden', 'true');
  }

  handlePopupAddToTrip() {
    if (!this.state.popupContext && !this.state.popupData) return;

    // Build item from popup data or fallback context
    const data = this.state.popupData || this.state.popupContext;
    const item = {
      id: data.place_id || this.state.popupPlaceId,
      name: data.name,
      location: data.location || data.address,
      image: data.images?.hero || data.image,
      rating: data.rating,
      description: data.description
    };

    this.confirmItem(item);
    this.closePropertyPopup();
  }

  handlePopupReject() {
    const name = this.state.popupData?.name || this.state.popupContext?.name || 'This property';
    this.closePropertyPopup();
    this.addMessage('assistant', `No problem! I've noted that ${name} isn't right for this trip. Would you like me to suggest some alternatives?`);
  }

  openPopupFullscreen() {
    // Open the full gallery overlay with popup images
    if (this.state.popupImages && this.state.popupImages.length > 0) {
      const images = this.state.popupImages.map(img => img.hero || img.large);
      const context = {
        name: this.state.popupData?.name || this.state.popupContext?.name,
        location: this.state.popupData?.location || this.state.popupContext?.location
      };
      this.closePropertyPopup();
      this.openGallery(images, context);
    }
  }

  // --------------------------------------------------------------------------
  // Selection State Management
  // --------------------------------------------------------------------------

  setItemState(item, state) {
    // Remove from other states
    this.state.confirmedItems = this.state.confirmedItems.filter(i => i.id !== item.id);
    this.state.exploringItems = this.state.exploringItems.filter(i => i.id !== item.id);

    // Add to new state
    if (state === 'confirmed') {
      this.state.confirmedItems.push(item);
    } else if (state === 'exploring') {
      this.state.exploringItems.push(item);
    }

    // Update card UI
    const card = this.querySelector(`[data-property-id="${item.id}"]`);
    if (card) {
      card.className = `chat-card chat-card--${state}`;
      card.setAttribute('data-state', state);
    }

    this.updateSidebar();
  }

  confirmItem(item) {
    this.setItemState(item, 'confirmed');

    // Notify user
    this.addMessage('assistant', `**${item.name}** has been added to your trip!`);

    // Show route visualization if 2+ items confirmed
    if (this.state.confirmedItems.length >= 2) {
      this.showRouteVisualization();
    }
  }

  removeItem(itemId) {
    this.state.confirmedItems = this.state.confirmedItems.filter(i => i.id !== itemId);
    this.state.exploringItems = this.state.exploringItems.filter(i => i.id !== itemId);

    // Update card UI
    const card = this.querySelector(`[data-property-id="${itemId}"]`);
    if (card) {
      card.className = 'chat-card chat-card--suggested';
      card.setAttribute('data-state', 'suggested');
    }

    this.updateSidebar();
  }

  // --------------------------------------------------------------------------
  // Sidebar
  // --------------------------------------------------------------------------

  updateSidebar() {
    const count = this.state.confirmedItems.length;

    // Iteration 5: Conditional sidebar - only show when selections exist
    if (count > 0) {
      this.refs.sidebar.classList.remove('chat-sidebar--hidden');
    } else {
      this.refs.sidebar.classList.add('chat-sidebar--hidden');
    }

    // Update counts
    this.refs.selectionCount.textContent = count;
    this.refs.indicatorCount.textContent = count;

    // Update subtitle
    this.refs.sidebarSubtitle.textContent = count === 0
      ? 'No selections yet'
      : `${count} selection${count !== 1 ? 's' : ''}`;

    // Enable/disable CTA
    this.refs.sidebarCta.disabled = count === 0;

    // Show/hide trip indicator on mobile
    if (this.isMobile) {
      this.refs.tripIndicator.style.display = count > 0 ? 'flex' : 'none';
    }

    // Render items
    this.refs.sidebarContent.innerHTML = this.state.confirmedItems.map(item => {
      const thumbUrl = this.getOptimizedImageUrl(item.image, 60, 60);
      return `
        <div class="sidebar-item" data-sidebar-item="${item.id}">
          <img class="sidebar-item__image" src="${thumbUrl}" alt="${item.name}">
          <div class="sidebar-item__content">
            <h4 class="sidebar-item__name">${item.name}</h4>
            <p class="sidebar-item__meta">${item.location || ''}</p>
            ${item.dates ? `<p class="sidebar-item__dates">${item.dates}</p>` : ''}
          </div>
          <button class="sidebar-item__remove" data-remove="${item.id}" aria-label="Remove ${item.name}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      `;
    }).join('') || '<p style="text-align: center; opacity: 0.5; padding: 20px;">Click "Add to Trip" on any property to start building your journey.</p>';

    // Attach remove listeners
    this.refs.sidebarContent.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeItem(btn.dataset.remove);
      });
    });
  }

  handleSidebarToggle() {
    if (this.state.sidebarOpen) {
      this.closeSidebar();
    } else {
      this.openSidebar();
    }
  }

  // --------------------------------------------------------------------------
  // Route Visualization
  // --------------------------------------------------------------------------

  // Show route visualization when 2+ items are confirmed
  showRouteVisualization() {
    // Remove existing route visualization if present
    const existingRoute = this.querySelector('.route-visualization');
    if (existingRoute) {
      existingRoute.remove();
    }

    const routeHtml = this.renderRouteVisualization();
    if (!routeHtml) return;

    const container = document.createElement('div');
    container.className = 'chat-message chat-message--assistant';
    container.innerHTML = `<div class="chat-message__content">${routeHtml}</div>`;

    this.refs.messages.appendChild(container);
    this.scrollToBottom();

    // Attach event listener for generate button
    const generateBtn = container.querySelector('.btn-generate-itinerary');
    if (generateBtn) {
      generateBtn.addEventListener('click', () => this.handleGenerateItinerary());
    }
  }

  // Render the route visualization HTML
  renderRouteVisualization() {
    const confirmed = this.state.confirmedItems;
    if (confirmed.length < 2) return '';

    const nodes = confirmed.map((item, i) => {
      const isFirst = i === 0;
      const isLast = i === confirmed.length - 1;
      const icon = this.getLocationIcon(item.type || item.category);

      return `
        <div class="route-node ${isFirst ? 'route-node--origin' : ''} ${isLast ? 'route-node--destination' : ''}">
          <div class="route-node-marker">
            <span class="route-icon">${icon}</span>
            ${!isLast ? '<div class="route-line"></div>' : ''}
          </div>
          <div class="route-node-content">
            <div class="route-node-name">${item.name}</div>
            ${item.nights ? `<div class="route-node-nights">${item.nights} nights</div>` : ''}
            ${item.location ? `<div class="route-node-location">${item.location}</div>` : ''}
            ${item.image ? `<img src="${this.getOptimizedImageUrl(item.image, 80, 45)}" class="route-thumb" alt="${item.name}">` : ''}
          </div>
        </div>
        ${!isLast ? this.renderRouteSegment(item, confirmed[i + 1]) : ''}
      `;
    }).join('');

    const summary = this.calculateRouteSummary(confirmed);

    return `
      <div class="route-visualization">
        <h3 class="route-title">Your Route</h3>
        <div class="route-nodes">${nodes}</div>
        <div class="route-summary">
          ${summary}
        </div>
        <button class="btn-generate-itinerary" type="button">Generate Full Itinerary</button>
      </div>
    `;
  }

  // Render a route segment between two locations
  renderRouteSegment(from, to) {
    const method = this.estimateTransferMethod(from, to);
    return `
      <div class="route-segment">
        <span class="segment-icon">${method.icon}</span>
        <span class="segment-text">${method.description}</span>
      </div>
    `;
  }

  // Iteration 6: Grayscale location markers (no emoji)
  getLocationIcon(type) {
    // All locations use a neutral dot marker for Apple-grade grayscale aesthetic
    return '●';
  }

  // Iteration 6: Estimate transfer method between two locations (grayscale, no emoji)
  estimateTransferMethod(from, to) {
    const fromLoc = (from.location || from.name || '').toLowerCase();
    const toLoc = (to.location || to.name || '').toLowerCase();

    // Check for common patterns
    const fromRegion = this.extractRegion(fromLoc);
    const toRegion = this.extractRegion(toLoc);

    // If same general region, suggest road transfer
    if (fromRegion && fromRegion === toRegion) {
      return {
        icon: '—',
        description: 'Private road transfer'
      };
    }

    // Cross-country or distant locations suggest flight
    const distantCities = ['cape town', 'johannesburg', 'durban', 'victoria falls', 'livingstone', 'maun', 'nairobi', 'dar es salaam'];
    const fromIsCity = distantCities.some(c => fromLoc.includes(c));
    const toIsCity = distantCities.some(c => toLoc.includes(c));

    if (fromIsCity || toIsCity) {
      // Charter for remote lodges
      if (!fromIsCity || !toIsCity) {
        return {
          icon: '—',
          description: 'Charter flight'
        };
      }
      // Scheduled for city to city
      return {
        icon: '—',
        description: 'Scheduled flight'
      };
    }

    // Safari areas typically use charter
    const safariAreas = ['kruger', 'sabi sands', 'okavango', 'serengeti', 'masai mara', 'hwange', 'chobe'];
    const fromSafari = safariAreas.some(a => fromLoc.includes(a));
    const toSafari = safariAreas.some(a => toLoc.includes(a));

    if (fromSafari && toSafari && fromLoc !== toLoc) {
      return {
        icon: '—',
        description: 'Charter flight'
      };
    }

    // Default to road transfer
    return {
      icon: '—',
      description: 'Road transfer'
    };
  }

  // Extract region from location string
  extractRegion(loc) {
    const regions = {
      'kruger': 'kruger',
      'sabi sands': 'kruger',
      'timbavati': 'kruger',
      'thornybush': 'kruger',
      'cape town': 'cape',
      'franschhoek': 'cape',
      'stellenbosch': 'cape',
      'winelands': 'cape',
      'hermanus': 'cape',
      'okavango': 'botswana',
      'chobe': 'botswana',
      'maun': 'botswana'
    };

    for (const [key, region] of Object.entries(regions)) {
      if (loc.includes(key)) {
        return region;
      }
    }
    return null;
  }

  // Calculate route summary
  calculateRouteSummary(confirmed) {
    const totalNights = confirmed.reduce((sum, item) => sum + (item.nights || 0), 0);
    const propertyCount = confirmed.length;

    let summaryParts = [];
    if (totalNights > 0) {
      summaryParts.push(`${totalNights} night${totalNights !== 1 ? 's' : ''}`);
    }
    summaryParts.push(`${propertyCount} propert${propertyCount !== 1 ? 'ies' : 'y'}`);

    return summaryParts.join(' | ');
  }

  // Handle generate itinerary button click (Iteration 9: Connected to API)
  async handleGenerateItinerary() {
    const generateBtn = this.shadowRoot.querySelector('.btn-generate-itinerary');

    // Show loading state
    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating...';
    }

    try {
      // Prepare request data from confirmed items
      const properties = this.state.confirmedItems.map(item => ({
        id: item.id || item.pin_id,
        name: item.name,
        location: item.location || item.region || item.area,
        nights: item.nights || 2,
        image: item.image || item.images?.[0],
        lat: item.lat,
        lng: item.lng
      }));

      const requestBody = {
        session_id: this.state.sessionId || 'anonymous',
        properties: properties,
        signals: this.state.extractedSignals || {},
        route: this.state.routeSegments || [],
        title: null  // Let API generate from signals
      };

      // Call the API
      const chatApiBase = this.config.apiBase + '/chat';
      const response = await fetch(`${chatApiBase}/itinerary/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `API error: ${response.status}`);
      }

      const itinerary = await response.json();

      // Store itinerary in state
      this.state.generatedItinerary = itinerary;

      // Show success message
      this.addItinerarySuccessMessage(itinerary);

      // Show the four views toggle with real data
      this.showItineraryViews(itinerary.itinerary_id, itinerary);

    } catch (error) {
      console.error('Itinerary generation failed:', error);
      this.addItineraryErrorMessage(error.message);
    } finally {
      if (generateBtn) {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate Full Itinerary';
      }
    }
  }

  // Add success message for itinerary generation
  addItinerarySuccessMessage(itinerary) {
    const container = document.createElement('div');
    container.className = 'chat-message chat-message--system itinerary-success';
    container.innerHTML = `
      <div class="chat-message__content">
        <div class="itinerary-generated">
          <h3>✓ Itinerary Created</h3>
          <p class="itinerary-name">${itinerary.name}</p>
          <p class="itinerary-summary">${itinerary.summary}</p>
          <p class="itinerary-reference">Reference: ${itinerary.reference}</p>
        </div>
      </div>
    `;
    this.refs.messages.appendChild(container);
    this.scrollToBottom();
  }

  // Add error message for itinerary generation
  addItineraryErrorMessage(message) {
    const container = document.createElement('div');
    container.className = 'chat-message chat-message--system itinerary-error';
    container.innerHTML = `
      <div class="chat-message__content">
        <div class="error-message">
          <p>Could not generate itinerary. Please try again.</p>
          <p class="error-detail">${message}</p>
        </div>
      </div>
    `;
    this.refs.messages.appendChild(container);
    this.scrollToBottom();
  }

  // Generate a slugified itinerary ID
  generateItineraryId() {
    // Use first confirmed item's location and trip type to create ID
    const confirmed = this.state.confirmedItems;
    if (confirmed.length === 0) return 'new-itinerary';

    const signals = this.state.extractedSignals || {};
    const goals = signals.GOAL || [];
    const destinations = signals.DEST || [];

    // Build a descriptive slug
    const parts = [];

    // Add goal if available
    if (goals.length > 0) {
      parts.push(goals[0].toLowerCase().replace(/\s+/g, '-'));
    }

    // Add destination if available
    if (destinations.length > 0) {
      parts.push('in');
      parts.push(destinations[0].toLowerCase().replace(/\s+/g, '-'));
    }

    // Add fallback
    if (parts.length === 0) {
      parts.push('custom-safari-journey');
    }

    return parts.join('-');
  }

  // --------------------------------------------------------------------------
  // Four Views Toggle (Iteration 4)
  // --------------------------------------------------------------------------

  // Show itinerary views after generation (Iteration 9: Updated for real data)
  showItineraryViews(itineraryId, itinerary = null) {
    // Store itinerary data in state
    this.state.itineraryId = itineraryId;
    this.state.itineraryViews = itinerary?.views || {};

    // Create views container
    const container = document.createElement('div');
    container.className = 'chat-message chat-message--assistant';

    container.innerHTML = `
      <div class="chat-message__content">
        <div class="itinerary-views" data-itinerary-views>
          <div class="view-tabs">
            <button class="view-tab view-tab--active" data-view="customer" data-url="${itinerary?.views?.customer || ''}" type="button">
              Customer View
            </button>
            <button class="view-tab" data-view="operator" data-url="${itinerary?.views?.operator || ''}" type="button">
              Operator Dossier
            </button>
            <button class="view-tab" data-view="ops" data-url="${itinerary?.views?.ops || ''}" type="button">
              Ops Brief
            </button>
            <button class="view-tab" data-view="pre_departure" data-url="${itinerary?.views?.pre_departure || ''}" type="button">
              Pre-Departure
            </button>
          </div>
          <div class="view-content" data-view-content>
            <div class="view-loading">Loading customer view...</div>
          </div>
        </div>
      </div>
    `;

    this.refs.messages.appendChild(container);

    // Attach tab click handlers
    const viewsContainer = container.querySelector('[data-itinerary-views]');
    viewsContainer.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchView(tab.dataset.view, viewsContainer));
    });

    // Load default view
    this.loadView('customer', viewsContainer);

    this.scrollToBottom();
  }

  // Switch between views
  switchView(viewName, container) {
    // Update active tab
    container.querySelectorAll('.view-tab').forEach(tab => {
      tab.classList.toggle('view-tab--active', tab.dataset.view === viewName);
    });

    // Load the view
    this.loadView(viewName, container);
  }

  // Load a specific view (Iteration 9: Uses real API URLs)
  async loadView(viewName, container) {
    const viewContent = container.querySelector('[data-view-content]');
    viewContent.innerHTML = '<div class="view-loading">Loading view...</div>';

    // Display view names properly
    const viewDisplayNames = {
      customer: 'Customer',
      operator: 'Operator Dossier',
      ops: 'Ops Brief',
      pre_departure: 'Pre-Departure Pack'
    };

    // Get URL from stored itinerary views, or fall back to demo
    let url;
    const storedViews = this.state.itineraryViews || {};

    if (storedViews[viewName]) {
      // Use real URL from API (will be relative path like /itinerary/abc123)
      url = window.location.origin + storedViews[viewName];
    } else {
      // Fallback to demo itinerary
      const viewParams = {
        customer: '',
        operator: '?view=operator-dossier',
        ops: '?view=wetu-itinerary-operations',
        pre_departure: '?view=wetu-pre-departure-pack'
      };
      const viewParam = viewParams[viewName] || '';
      const demoItineraryId = 'wildlife-and-architecture-in-south-africa-the-hoffmann-family-journey';
      url = `https://plekify.com/products/${demoItineraryId}${viewParam}`;
    }

    try {
      // Show link to view in new tab
      viewContent.innerHTML = `
        <div class="view-preview">
          <p>View ready: <strong>${viewDisplayNames[viewName] || viewName}</strong></p>
          <a href="${url}" target="_blank" class="view-link">
            Open ${viewDisplayNames[viewName] || viewName} view in new tab →
          </a>
        </div>
      `;
    } catch (error) {
      console.error('[Plekify Chat] Error loading view:', error);
      viewContent.innerHTML = '<div class="view-error">Failed to load view. Please try again.</div>';
    }
  }

  openSidebar() {
    this.state.sidebarOpen = true;
    this.refs.sidebar.classList.add('chat-sidebar--open');
  }

  closeSidebar() {
    this.state.sidebarOpen = false;
    this.refs.sidebar.classList.remove('chat-sidebar--open');
  }

  handleContinue() {
    // Navigate to itinerary builder or checkout
    const itemIds = this.state.confirmedItems.map(i => i.id).join(',');
    window.location.href = `/pages/itinerary-builder?items=${itemIds}`;
  }

  // --------------------------------------------------------------------------
  // Landing → Conversation Transition (Iteration 5)
  // --------------------------------------------------------------------------

  transitionToConversation() {
    if (this.state.hasStartedConversation) return;
    this.state.hasStartedConversation = true;

    // Move the input area from the landing into the conversation slot
    if (this.refs.inputArea && this.refs.inputSlot) {
      this.refs.inputSlot.appendChild(this.refs.inputArea);
    }

    // Toggle visibility states
    if (this.refs.landing) {
      this.refs.landing.dataset.state = 'hidden';
    }
    if (this.refs.conversation) {
      this.refs.conversation.dataset.state = 'active';
    }

    // Refocus input after move
    if (this.refs.input) {
      this.refs.input.focus();
    }
  }

  // --------------------------------------------------------------------------
  // Mobile Handling
  // --------------------------------------------------------------------------

  get isMobile() {
    return window.innerWidth < 768;
  }

  checkMobileView() {
    if (this.isMobile) {
      this.refs.interface.classList.add('chat-interface--mobile');
      // Show trip indicator if we have items
      this.refs.tripIndicator.style.display = this.state.confirmedItems.length > 0 ? 'flex' : 'none';
    } else {
      this.refs.interface.classList.remove('chat-interface--mobile');
      this.refs.tripIndicator.style.display = 'none';
      this.closeSidebar();
    }
  }

  // --------------------------------------------------------------------------
  // API
  // --------------------------------------------------------------------------

  async ensureSession() {
    if (this.state.sessionId) {
      return this.state.sessionId;
    }

    // Use the /api/chat/ endpoints instead of /api/briefing/
    const chatApiBase = this.config.apiBase + '/chat';

    const response = await fetch(`${chatApiBase}/session/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`);
    }

    const data = await response.json();
    this.state.sessionId = data.session_id;
    return this.state.sessionId;
  }

  async callBriefingAPI(message) {
    // Ensure we have a session
    const sessionId = await this.ensureSession();

    // Use the /api/chat/message endpoint
    const chatApiBase = this.config.apiBase + '/chat';

    const response = await fetch(`${chatApiBase}/message?session_id=${sessionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: message
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    // Transform the chat response into our expected format
    return this.transformChatResponse(data);
  }

  transformChatResponse(data) {
    // Build extractions from destinations if available
    const extractions = [];
    if (data.destinations && Array.isArray(data.destinations)) {
      data.destinations.forEach(dest => {
        extractions.push({
          type: 'DEST',
          label: dest.name || dest.display_name || dest,
          source: 'your message'
        });
      });
    }

    // Extract full signal taxonomy if available from API
    const signals = data.signals || {};

    // Also try to extract signals from structured response
    if (data.extracted_signals) {
      Object.assign(signals, data.extracted_signals);
    }

    // Build the response message
    let message = data.text || data.message || data.response || '';

    // Check for questions that need answering — filter out date-related probes
    if (data.questions && data.questions.length > 0) {
      const dateQuestionPattern = /when\s+are\s+you\s+(planning|traveling|going)|travel\s+date|departure\s+date|return\s+date|\bdate\s+of\s+travel\b/i;
      const filteredQuestions = data.questions.filter(q => !dateQuestionPattern.test(q));
      if (filteredQuestions.length > 0) {
        message += '\n\n' + filteredQuestions.join('\n');
      }
    }

    // Return in the expected format
    return {
      message,
      extractions,
      signals,
      properties: data.properties || [],
      destinations: data.destinations || [],
      routeSkeleton: data.route_skeleton || null,
      mvbProgress: data.mvb_progress || null,
      ready: data.ready || false
    };
  }

  async fetchAndDisplayProperties(destination) {
    const sessionId = this.state.sessionId;
    if (!sessionId) return;

    const chatApiBase = this.config.apiBase + '/chat';

    try {
      // Get the destination name and normalize it
      let destName = typeof destination === 'string'
        ? destination
        : (destination.name || destination.display_name);

      // Store original for display
      const displayName = destName;

      // Normalize destination name - remove common suffixes that cause matching issues
      destName = destName
        .replace(/\s*\([^)]*\)\s*/g, ' ')  // Remove parenthetical text like "(private concession)"
        .replace(/\s+(area|region|private game reserve|game reserve|private reserve|nature reserve|national park|conservancy|safari area)$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      const destId = destName.toLowerCase().replace(/\s+/g, '-');

      // Debug logging
      if (this.hasAttribute('data-debug')) {
        console.log('[Plekify Chat] Fetching properties:', { original: displayName, normalized: destName, destId });
      }

      const response = await fetch(`${chatApiBase}/properties?session_id=${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          destination_id: destId,
          destination_name: destName,
          days: 2
        })
      });

      if (!response.ok) {
        console.warn('[Plekify Chat] Failed to fetch properties:', response.status);
        return;
      }

      const data = await response.json();

      // Debug logging
      if (this.hasAttribute('data-debug')) {
        console.log('[Plekify Chat] Properties response:', data);
      }

      const destinationCard = data.destination_details || destination;
      this.renderDestinationCard(destinationCard, displayName);

      if (data.properties && data.properties.length > 0) {
        this.renderPropertyCards(data.properties, {
          destinationName: displayName,
          searchMethod: data.search_method
        });
      } else {
        // If no properties, still inform the user
        if (this.hasAttribute('data-debug')) {
          console.log('[Plekify Chat] No properties found for:', destName);
        }
      }
    } catch (error) {
      console.warn('[Plekify Chat] Error fetching properties:', error);
    }
  }
}

// Register custom element
customElements.define('plekify-chat-interface', PlekifyChatInterface);

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlekifyChatInterface;
}

