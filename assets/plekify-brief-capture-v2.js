/**
 * Plekify Brief Capture v2 - Location-First Chat Interface
 *
 * Architecture:
 * 1. DESTINATIONS FIRST → PROPERTIES SECOND
 * 2. AI identifies "Rarest Constraint" and builds spatial skeleton
 * 3. Properties shown only after destination is locked
 *
 * States: landing → conversation → generating
 */

// Session persistence constants
const SESSION_STORAGE_KEY = 'plekify_chat_session_id';
const SESSION_MAX_AGE_MINUTES = 30;

class PlekifyChat {
  constructor() {
    this.config = window.PLEKIFY_CHAT_CONFIG || {};
    this.apiBase = this.config.apiBase || 'https://app.plekify.com';
    this.briefingApiBase = this.config.briefingApiBase || 'https://brief.plekify.com';
    this.minChars = this.config.minChars || 20;
    this.debug = this.config.debug || false;

    // Core state
    this.state = {
      sessionId: null,
      currentState: 'landing', // landing | conversation | generating
      messages: [],
      routeSkeleton: {
        destinations: [],      // Array of {id, name, days, locked, properties}
        anchors: [],           // Rarest constraint anchors
        driveLimitMinutes: null,
        totalDays: 0
      },
      mvbProgress: {
        route: false,
        dates: false,
        group: false,
        style: false
      },
      isReady: false,
      isProcessing: false,
      activeStream: null
    };

    // Recording state
    this.recording = {
      isActive: false,
      mediaRecorder: null,
      audioChunks: [],
      startTime: null,
      interval: null
    };

    // DOM References (will be populated in init)
    this.dom = {};

    // Templates
    this.templates = {};

    this.init();
  }

  // ============ INITIALIZATION ============

  init() {
    this.cacheDOMReferences();
    this.cacheTemplates();
    this.bindEvents();
    this.initSession();
    this.initGallery();

    this.log('PlekifyChat initialized');
  }

  async initSession() {
    // Try to restore existing session first
    const restored = await this.tryRestoreSession();
    if (!restored) {
      // No valid session to restore, create new one
      this.createSession();
    }
  }

  cacheDOMReferences() {
    // Section root
    this.dom.section = document.querySelector('.plekify-chat');

    // Landing state
    this.dom.landing = document.getElementById('chat-landing');
    this.dom.initialInput = document.getElementById('initial-input');
    this.dom.landingVoiceBtn = document.getElementById('landing-voice-btn');
    this.dom.landingSubmitBtn = document.getElementById('landing-submit-btn');

    // Quick tags
    this.dom.quickTags = document.querySelectorAll('.quick-tag');

    // Conversation state
    this.dom.conversation = document.getElementById('chat-conversation');
    this.dom.messagesContainer = document.getElementById('messages-container');
    this.dom.chatInput = document.getElementById('chat-input');
    this.dom.chatVoiceBtn = document.getElementById('chat-voice-btn');
    this.dom.chatSendBtn = document.getElementById('chat-send-btn');
    this.dom.newTripBtn = document.getElementById('new-trip-btn');
    this.dom.generateArea = document.getElementById('generate-area');
    this.dom.generateBtn = document.getElementById('generate-btn');

    // MVB chips
    this.dom.mvbChips = document.getElementById('mvb-chips');

    // Generating state
    this.dom.generating = document.getElementById('chat-generating');
    this.dom.generatingStatus = document.getElementById('generating-status');
    this.dom.progressBar = document.getElementById('progress-bar');
    this.dom.generatingSteps = document.getElementById('generating-steps');
  }

  cacheTemplates() {
    this.templates.userMessage = document.getElementById('tpl-user-message');
    this.templates.aiMessage = document.getElementById('tpl-ai-message');
    this.templates.destinationCard = document.getElementById('tpl-destination-card');
    this.templates.propertyCard = document.getElementById('tpl-property-card');
    this.templates.routeSkeleton = document.getElementById('tpl-route-skeleton');
    this.templates.questions = document.getElementById('tpl-questions');
    this.templates.destinationGallery = document.getElementById('tpl-destination-gallery');
  }

  bindEvents() {
    // Landing events
    this.dom.initialInput?.addEventListener('input', () => this.onLandingInput());
    this.dom.landingSubmitBtn?.addEventListener('click', () => this.submitInitialMessage());
    this.dom.landingVoiceBtn?.addEventListener('click', () => this.toggleRecording('landing'));

    // Quick tags
    this.dom.quickTags?.forEach(tag => {
      tag.addEventListener('click', (e) => this.onQuickTagClick(e));
    });

    // Conversation events
    this.dom.chatInput?.addEventListener('input', () => this.onChatInput());
    this.dom.chatInput?.addEventListener('keydown', (e) => this.onChatKeydown(e));
    this.dom.chatSendBtn?.addEventListener('click', () => this.sendMessage());
    this.dom.chatVoiceBtn?.addEventListener('click', () => this.toggleRecording('chat'));
    this.dom.newTripBtn?.addEventListener('click', () => this.resetToLanding());
    this.dom.generateBtn?.addEventListener('click', () => this.generateItinerary());

    // Handle Enter key on landing input
    this.dom.initialInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!this.dom.landingSubmitBtn.disabled) {
          this.submitInitialMessage();
        }
      }
    });

    // Delegate click events for dynamic elements
    this.dom.messagesContainer?.addEventListener('click', (e) => this.onMessageContainerClick(e));
  }

  // ============ SESSION PERSISTENCE ============

  saveSessionId(sessionId) {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      this.log('Session saved to localStorage:', sessionId);
    } catch (e) {
      this.log('Failed to save session to localStorage:', e);
    }
  }

  getStoredSessionId() {
    try {
      return localStorage.getItem(SESSION_STORAGE_KEY);
    } catch (e) {
      this.log('Failed to read session from localStorage:', e);
      return null;
    }
  }

  clearStoredSessionId() {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      this.log('Session cleared from localStorage');
    } catch (e) {
      this.log('Failed to clear session from localStorage:', e);
    }
  }

  async fetchSessionState(sessionId) {
    try {
      const response = await fetch(
        `${this.briefingApiBase}/api/chat/session/${sessionId}?max_age_minutes=${SESSION_MAX_AGE_MINUTES}`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (e) {
      this.log('Failed to fetch session state:', e);
      return null;
    }
  }

  async tryRestoreSession() {
    const storedSessionId = this.getStoredSessionId();

    if (!storedSessionId) {
      this.log('No stored session found');
      return false;
    }

    this.log('Found stored session:', storedSessionId);

    const state = await this.fetchSessionState(storedSessionId);

    if (!state || !state.found) {
      this.log('Session not found in database, clearing stored ID');
      this.clearStoredSessionId();
      return false;
    }

    if (state.expired) {
      this.log('Session expired, clearing stored ID');
      this.clearStoredSessionId();
      return false;
    }

    // Session is valid - restore state
    this.log('Restoring session with', state.messages?.length || 0, 'messages');

    this.state.sessionId = storedSessionId;

    // Restore messages
    if (state.messages?.length) {
      this.state.messages = state.messages;
    }

    // Restore route skeleton
    if (state.route_skeleton) {
      this.updateRouteSkeleton(state.route_skeleton);
    }

    // Restore MVB progress
    if (state.mvb_progress) {
      this.state.mvbProgress = state.mvb_progress;
      this.updateMVBChips();
    }

    // Restore ready state
    if (state.ready !== undefined) {
      this.state.isReady = state.ready;
    }

    // If we have messages, show the conversation view
    if (state.messages?.length) {
      this.transitionTo('conversation');
      this.renderRestoredMessages();
      this.checkReadiness();
    }

    return true;
  }

  renderRestoredMessages() {
    // Clear existing messages in the container
    this.dom.messagesContainer.innerHTML = '';

    // Render each message
    this.state.messages.forEach(msg => {
      if (msg.role === 'user' || msg.type === 'user') {
        this.renderMessage({
          id: msg.id || this.generateId(),
          type: 'user',
          text: msg.content || msg.text || '',
          timestamp: msg.timestamp || Date.now()
        });
      } else {
        // Parse AI message content for destinations, questions, etc.
        const aiContent = {
          id: msg.id || this.generateId(),
          type: 'ai',
          text: msg.content || msg.text || '',
          destinations: msg.destinations || [],
          questions: msg.questions || [],
          routeSkeleton: msg.route_skeleton || null,
          timestamp: msg.timestamp || Date.now()
        };
        this.renderMessage(aiContent);
      }
    });

    this.scrollToBottom();
    this.log('Restored messages rendered');
  }

  // ============ SESSION MANAGEMENT ============

  async createSession() {
    try {
      const response = await fetch(`${this.briefingApiBase}/api/chat/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop: this.config.shopDomain,
          mode: 'location-first'
        })
      });

      if (response.ok) {
        const data = await response.json();
        this.state.sessionId = data.session_id;
        // Save to localStorage for persistence across page reloads
        this.saveSessionId(this.state.sessionId);
        this.log('Session created:', this.state.sessionId);
      } else {
        throw new Error('Session creation failed');
      }
    } catch (error) {
      console.error('Failed to create session:', error);
      this.showToast('Connection issue. Please refresh and try again.', 'error');
    }
  }

  // ============ STATE TRANSITIONS ============

  transitionTo(newState) {
    const validTransitions = {
      'landing': ['conversation'],
      'conversation': ['landing', 'generating'],
      'generating': ['conversation']
    };

    if (!validTransitions[this.state.currentState]?.includes(newState)) {
      this.log(`Invalid transition: ${this.state.currentState} → ${newState}`);
      return;
    }

    this.log(`State transition: ${this.state.currentState} → ${newState}`);
    this.state.currentState = newState;
    this.dom.section.setAttribute('data-state', newState);

    // Hide all states
    this.dom.landing.style.display = 'none';
    this.dom.conversation.style.display = 'none';
    this.dom.generating.style.display = 'none';

    // Show target state
    switch (newState) {
      case 'landing':
        this.dom.landing.style.display = 'block';
        this.dom.initialInput?.focus();
        break;
      case 'conversation':
        this.dom.conversation.style.display = 'flex';
        this.dom.chatInput?.focus();
        this.scrollToBottom();
        break;
      case 'generating':
        this.dom.generating.style.display = 'flex';
        break;
    }
  }

  resetToLanding() {
    // Clear stored session to start fresh
    this.clearStoredSessionId();

    // Clear state
    this.state.messages = [];
    this.state.routeSkeleton = {
      destinations: [],
      anchors: [],
      driveLimitMinutes: null,
      totalDays: 0
    };
    this.state.mvbProgress = {
      route: false,
      dates: false,
      group: false,
      style: false
    };
    this.state.isReady = false;

    // Clear UI
    this.dom.messagesContainer.innerHTML = '';
    this.dom.initialInput.value = '';
    this.dom.chatInput.value = '';
    this.updateMVBChips();
    this.dom.generateArea.style.display = 'none';

    // Create new session
    this.createSession();

    // Transition
    this.transitionTo('landing');
  }

  // ============ LANDING STATE HANDLERS ============

  onLandingInput() {
    const text = this.dom.initialInput.value.trim();
    this.dom.landingSubmitBtn.disabled = text.length < this.minChars;
  }

  onQuickTagClick(e) {
    const tag = e.target.closest('.quick-tag');
    if (!tag) return;

    const tagValue = tag.dataset.tag;
    const tagText = tag.textContent.trim();

    // Build a starter prompt based on the tag
    const prompts = {
      'safari': "I'd love to do a safari in South Africa",
      'coast': "I want to explore the South African coastline",
      'wine': "We're interested in wine tasting in the Cape",
      'adventure': "Looking for an adventure trip with hiking and activities"
    };

    const prompt = prompts[tagValue] || `I'm interested in ${tagText}`;
    this.dom.initialInput.value = prompt;
    this.onLandingInput();
    this.dom.initialInput.focus();
  }

  submitInitialMessage() {
    const text = this.dom.initialInput.value.trim();
    if (text.length < this.minChars) return;

    // Transition to conversation
    this.transitionTo('conversation');

    // Add user message and process
    this.addUserMessage(text);
    this.processMessage(text);
  }

  // ============ CONVERSATION STATE HANDLERS ============

  onChatInput() {
    const text = this.dom.chatInput.value.trim();
    this.dom.chatSendBtn.disabled = text.length === 0;

    // Auto-resize textarea
    this.dom.chatInput.style.height = 'auto';
    this.dom.chatInput.style.height = Math.min(this.dom.chatInput.scrollHeight, 120) + 'px';
  }

  onChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!this.dom.chatSendBtn.disabled && !this.state.isProcessing) {
        this.sendMessage();
      }
    }
  }

  sendMessage() {
    const text = this.dom.chatInput.value.trim();
    if (!text || this.state.isProcessing) return;

    this.dom.chatInput.value = '';
    this.dom.chatInput.style.height = 'auto';
    this.dom.chatSendBtn.disabled = true;

    this.addUserMessage(text);
    this.processMessage(text);
  }

  onMessageContainerClick(e) {
    const target = e.target.closest('button[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const card = target.closest('[data-destination-id], [data-property-id]');

    switch (action) {
      case 'lock-destination':
        this.lockDestination(card.dataset.destinationId);
        break;
      case 'show-properties':
        this.showPropertiesForDestination(card.dataset.destinationId);
        break;
      case 'select-property':
        this.selectProperty(card.dataset.destinationId, card.dataset.propertyId);
        break;
      case 'view-map':
        this.viewRouteOnMap();
        break;
      case 'adjust-stops':
        this.adjustStops();
        break;
    }
  }

  // ============ MESSAGE PROCESSING ============

  addUserMessage(text) {
    const message = {
      id: this.generateId(),
      type: 'user',
      text: text,
      timestamp: Date.now()
    };

    this.state.messages.push(message);
    this.renderMessage(message);
    this.scrollToBottom();
  }

  addAIMessage(content) {
    const message = {
      id: this.generateId(),
      type: 'ai',
      text: content.text || '',
      destinations: content.destinations || [],
      properties: content.properties || [],
      questions: content.questions || [],
      routeSkeleton: content.routeSkeleton || null,
      destinationId: content.destinationId || null,
      timestamp: Date.now()
    };

    this.state.messages.push(message);
    this.renderMessage(message);
    this.scrollToBottom();

    return message;
  }

  async processMessage(text) {
    if (this.state.isProcessing) return;

    this.state.isProcessing = true;
    this.showTypingIndicator();

    try {
      // Create placeholder AI message
      const placeholderMessage = this.addAIMessage({ text: '' });
      const messageEl = document.getElementById(`msg-${placeholderMessage.id}`);
      const textEl = messageEl?.querySelector('.message__text');

      // Stream response from API - session_id as query param, message in body
      const url = `${this.briefingApiBase}/api/chat/message?session_id=${encodeURIComponent(this.state.sessionId)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text
        })
      });

      if (!response.ok) {
        throw new Error('Message processing failed');
      }

      // Check if response is SSE stream or JSON
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('text/event-stream')) {
        await this.handleSSEResponse(response, placeholderMessage);
      } else {
        const data = await response.json();
        this.handleJSONResponse(data, placeholderMessage);
      }

    } catch (error) {
      console.error('Message processing failed:', error);
      this.hideTypingIndicator();
      this.showToast('Sorry, something went wrong. Please try again.', 'error');
    } finally {
      this.state.isProcessing = false;
      this.hideTypingIndicator();
    }
  }

  async handleSSEResponse(response, message) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const messageEl = document.getElementById(`msg-${message.id}`);
    const textEl = messageEl?.querySelector('.message__text');
    const cardsEl = messageEl?.querySelector('.message__cards');
    const questionsEl = messageEl?.querySelector('.message__questions');

    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            this.processSSEEvent(parsed, message, textEl, cardsEl, questionsEl);
          } catch (e) {
            // Might be partial text
            if (data && textEl) {
              fullText += data;
              textEl.textContent = fullText;
              message.text = fullText;
            }
          }
        }
      }

      this.scrollToBottom();
    }
  }

  processSSEEvent(event, message, textEl, cardsEl, questionsEl) {
    switch (event.type) {
      case 'text':
        if (textEl) {
          message.text = (message.text || '') + event.content;
          textEl.textContent = message.text;
        }
        break;

      case 'destination':
        this.addDestinationToSkeleton(event.destination);
        if (cardsEl) {
          this.renderDestinationCard(event.destination, cardsEl);
          // Render photo gallery if images present
          if (event.destination.images?.length) {
            this.renderDestinationGallery(event.destination, cardsEl);
          }
        }
        break;

      case 'route_skeleton':
        this.updateRouteSkeleton(event.skeleton);
        if (cardsEl) {
          this.renderRouteSkeleton(event.skeleton, cardsEl);
        }
        break;

      case 'mvb_update':
        this.updateMVBProgress(event.progress);
        break;

      case 'questions':
        if (questionsEl) {
          this.renderQuestions(event.questions, questionsEl);
        }
        break;

      case 'ready':
        this.state.isReady = event.ready;
        this.checkReadiness();
        break;
    }
  }

  handleJSONResponse(data, message) {
    const messageEl = document.getElementById(`msg-${message.id}`);
    const textEl = messageEl?.querySelector('.message__text');
    const cardsEl = messageEl?.querySelector('.message__cards');
    const questionsEl = messageEl?.querySelector('.message__questions');

    // Update text
    if (data.text && textEl) {
      message.text = data.text;
      textEl.textContent = data.text;
    }

    // Update route skeleton
    if (data.route_skeleton) {
      this.updateRouteSkeleton(data.route_skeleton);
      if (cardsEl) {
        this.renderRouteSkeleton(data.route_skeleton, cardsEl);
      }
    }

    // Render destination cards
    if (data.destinations?.length && cardsEl) {
      data.destinations.forEach(dest => {
        this.addDestinationToSkeleton(dest);
        this.renderDestinationCard(dest, cardsEl);
      });
    }

    // Render questions
    if (data.questions?.length && questionsEl) {
      this.renderQuestions(data.questions, questionsEl);
    }

    // Update MVB progress
    if (data.mvb_progress) {
      this.updateMVBProgress(data.mvb_progress);
    }

    // Check readiness
    if (data.ready !== undefined) {
      this.state.isReady = data.ready;
    }
    this.checkReadiness();
  }

  // ============ ROUTE SKELETON MANAGEMENT ============

  addDestinationToSkeleton(destination) {
    const existing = this.state.routeSkeleton.destinations.find(
      d => d.id === destination.id || d.name === destination.name
    );

    if (existing) {
      Object.assign(existing, destination);
    } else {
      this.state.routeSkeleton.destinations.push({
        id: destination.id || this.generateId(),
        name: destination.name,
        days: destination.days || 2,
        locked: false,
        properties: [],
        matches: destination.matches || [],
        driveFromPrevious: destination.driveFromPrevious || null
      });
    }

    this.updateRouteSkeleton(this.state.routeSkeleton);
  }

  updateRouteSkeleton(skeleton) {
    if (skeleton.destinations) {
      this.state.routeSkeleton.destinations = skeleton.destinations.map(d => ({
        ...d,
        locked: d.locked || false,
        properties: d.properties || []
      }));
    }

    if (skeleton.anchors) {
      this.state.routeSkeleton.anchors = skeleton.anchors;
    }

    if (skeleton.driveLimitMinutes !== undefined) {
      this.state.routeSkeleton.driveLimitMinutes = skeleton.driveLimitMinutes;
    }

    // Calculate total days
    this.state.routeSkeleton.totalDays = this.state.routeSkeleton.destinations.reduce(
      (sum, d) => sum + (d.days || 0), 0
    );

    // Update MVB route progress
    if (this.state.routeSkeleton.destinations.length > 0) {
      this.state.mvbProgress.route = true;
      this.updateMVBChips();
    }

    this.log('Route skeleton updated:', this.state.routeSkeleton);
  }

  lockDestination(destinationId) {
    const destination = this.state.routeSkeleton.destinations.find(d => d.id === destinationId);
    if (!destination) return;

    destination.locked = true;

    // Update destination card UI (use specific selector)
    const card = document.querySelector(`.destination-card[data-destination-id="${destinationId}"]`);
    if (card) {
      card.classList.add('locked');
      const badge = card.querySelector('.destination-card__locked-badge');
      if (badge) badge.style.display = 'inline';
      const lockBtn = card.querySelector('[data-action="lock-destination"]');
      if (lockBtn) lockBtn.style.display = 'none';
    }

    // Also update timeline stop UI if present
    const timelineStop = document.querySelector(`.timeline-stop[data-destination-id="${destinationId}"]`);
    if (timelineStop) {
      timelineStop.classList.add('locked');
      const marker = timelineStop.querySelector('.timeline-stop__marker');
      if (marker) marker.textContent = '✓';
    }

    this.log('Destination locked:', destination.name);

    // Notify API
    this.notifyDestinationLocked(destination);

    // Check if we should show properties
    this.checkReadiness();
  }

  async showPropertiesForDestination(destinationId) {
    const destination = this.state.routeSkeleton.destinations.find(d => d.id === destinationId);
    if (!destination) return;

    // Show loading state on button (use specific selector)
    const card = document.querySelector(`.destination-card[data-destination-id="${destinationId}"]`);
    const btn = card?.querySelector('[data-action="show-properties"]');
    if (btn) {
      btn.textContent = 'Loading...';
      btn.disabled = true;
    }

    // Show thinking indicator for properties search
    this.showPropertySearchIndicator(destination.name);

    try {
      const url = `${this.briefingApiBase}/api/chat/properties?session_id=${encodeURIComponent(this.state.sessionId)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination_id: destinationId,
          destination_name: destination.name,
          days: destination.days || 2,
          style_preferences: this.extractStylePreferences()
        })
      });

      if (response.ok) {
        const data = await response.json();

        // Check for error response from backend
        if (data.error) {
          this.addAIMessage({
            text: data.error,
            destinationId: destinationId
          });
          return;
        }

        destination.properties = data.properties || [];

        // Check if properties were found
        if (destination.properties.length === 0) {
          this.addAIMessage({
            text: `I couldn't find any properties for ${destination.name} at the moment. Try locking the destination first or adjusting your search.`,
            destinationId: destinationId
          });
          return;
        }

        // Add AI message with properties
        this.addAIMessage({
          text: `Here are my top picks for ${destination.name}:`,
          properties: destination.properties,
          destinationId: destinationId
        });
      }
    } catch (error) {
      console.error('Failed to load properties:', error);
      this.showToast('Could not load properties. Please try again.', 'error');
    } finally {
      this.hidePropertySearchIndicator();
      if (btn) {
        btn.textContent = 'See Stays';
        btn.disabled = false;
      }
    }
  }

  showPropertySearchIndicator(destinationName) {
    this.hidePropertySearchIndicator();

    const messages = [
      `Finding stays in ${destinationName}...`,
      `Searching lodges and hotels...`,
      `Checking ratings and availability...`,
      `Curating the best options...`
    ];

    const indicator = document.createElement('div');
    indicator.className = 'plekify-thinking';
    indicator.id = 'property-search-indicator';
    indicator.innerHTML = `
      <div class="plekify-thinking__avatar">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
      </div>
      <div class="plekify-thinking__content">
        <div class="plekify-thinking__dots">
          <span class="plekify-thinking__dot"></span>
          <span class="plekify-thinking__dot"></span>
          <span class="plekify-thinking__dot"></span>
        </div>
        <span class="plekify-thinking__text">${messages[0]}</span>
      </div>
    `;
    this.dom.messagesContainer.appendChild(indicator);
    this.scrollToBottom();

    let messageIndex = 0;
    this._propertySearchInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % messages.length;
      const textEl = indicator.querySelector('.plekify-thinking__text');
      if (textEl) {
        textEl.style.opacity = '0';
        setTimeout(() => {
          textEl.textContent = messages[messageIndex];
          textEl.style.opacity = '1';
        }, 200);
      }
    }, 2000);
  }

  hidePropertySearchIndicator() {
    if (this._propertySearchInterval) {
      clearInterval(this._propertySearchInterval);
      this._propertySearchInterval = null;
    }
    const indicator = document.getElementById('property-search-indicator');
    indicator?.remove();
  }

  selectProperty(destinationId, propertyId) {
    const destination = this.state.routeSkeleton.destinations.find(d => d.id === destinationId);
    if (!destination) return;

    // Mark property as selected
    destination.selectedProperty = propertyId;

    // Update UI
    const allCards = document.querySelectorAll(`[data-destination-id="${destinationId}"][data-property-id]`);
    allCards.forEach(card => {
      card.classList.remove('selected');
      const btn = card.querySelector('[data-action="select-property"]');
      if (btn) btn.textContent = 'Select';
    });

    const selectedCard = document.querySelector(`[data-property-id="${propertyId}"]`);
    if (selectedCard) {
      selectedCard.classList.add('selected');
      const btn = selectedCard.querySelector('[data-action="select-property"]');
      if (btn) btn.textContent = '✓ Selected';
    }

    this.log('Property selected:', propertyId, 'for', destination.name);
    this.checkReadiness();
  }

  async notifyDestinationLocked(destination) {
    try {
      const url = `${this.briefingApiBase}/api/chat/destination/lock?session_id=${encodeURIComponent(this.state.sessionId)}`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination_id: destination.id
        })
      });
    } catch (error) {
      this.log('Failed to notify destination lock:', error);
    }
  }

  // ============ MVB PROGRESS ============

  updateMVBProgress(progress) {
    Object.assign(this.state.mvbProgress, progress);
    this.updateMVBChips();
    this.checkReadiness();
  }

  updateMVBChips() {
    Object.entries(this.state.mvbProgress).forEach(([field, complete]) => {
      const chip = this.dom.mvbChips?.querySelector(`[data-field="${field}"]`);
      if (chip) {
        chip.setAttribute('data-complete', complete ? 'true' : 'false');
        chip.querySelector('.mvb-icon').textContent = complete ? '✓' : '○';
      }
    });
  }

  checkReadiness() {
    const { route, dates, group } = this.state.mvbProgress;
    const hasLockedDestinations = this.state.routeSkeleton.destinations.some(d => d.locked);

    // Ready if we have route, dates, group, and at least one locked destination
    const ready = route && dates && group && hasLockedDestinations;

    this.state.isReady = ready;
    this.dom.generateArea.style.display = ready ? 'block' : 'none';

    return ready;
  }

  extractStylePreferences() {
    // Extract style preferences from messages
    const allText = this.state.messages
      .filter(m => m.type === 'user')
      .map(m => m.text)
      .join(' ')
      .toLowerCase();

    const preferences = {
      luxury: /\b(luxury|high-end|premium|5\s*star|five\s*star|exclusive|boutique)\b/.test(allText),
      budget: /\b(budget|cheap|affordable|value|backpack|hostel)\b/.test(allText),
      family: /\b(family|kids|children|child-friendly)\b/.test(allText),
      romantic: /\b(romantic|honeymoon|couples|anniversary)\b/.test(allText),
      adventure: /\b(adventure|active|hiking|safari|wildlife)\b/.test(allText),
      relaxation: /\b(relax|spa|peaceful|quiet|retreat)\b/.test(allText)
    };

    return preferences;
  }

  // ============ RENDERING ============

  renderMessage(message) {
    const template = message.type === 'user'
      ? this.templates.userMessage
      : this.templates.aiMessage;

    if (!template) return;

    const clone = template.content.cloneNode(true);
    const messageEl = clone.querySelector('.chat-message');
    messageEl.id = `msg-${message.id}`;

    // Set text (with truncation for long user messages)
    const textEl = messageEl.querySelector('.message__text');
    if (textEl) {
      if (message.type === 'user') {
        this.renderUserMessageText(textEl, message.text);
      } else {
        textEl.textContent = message.text;
      }
    }

    // For AI messages, render cards and questions
    if (message.type === 'ai') {
      const cardsEl = messageEl.querySelector('.message__cards');
      const questionsEl = messageEl.querySelector('.message__questions');

      // Render destinations
      if (message.destinations?.length && cardsEl) {
        message.destinations.forEach(dest => {
          this.renderDestinationCard(dest, cardsEl);
          // Also render destination photo gallery if images present
          if (dest.images?.length) {
            this.renderDestinationGallery(dest, cardsEl);
          }
        });
      }

      // Render properties
      if (message.properties?.length && cardsEl) {
        message.properties.forEach(prop => {
          this.renderPropertyCard(prop, cardsEl, message.destinationId);
        });
      }

      // Render route skeleton
      if (message.routeSkeleton && cardsEl) {
        this.renderRouteSkeleton(message.routeSkeleton, cardsEl);
      }

      // Render questions
      if (message.questions?.length && questionsEl) {
        this.renderQuestions(message.questions, questionsEl);
      }
    }

    this.dom.messagesContainer.appendChild(clone);
  }

  renderDestinationCard(destination, container) {
    const template = this.templates.destinationCard;
    if (!template) return;

    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.destination-card');

    card.dataset.destinationId = destination.id;
    card.querySelector('.destination-card__name').textContent = destination.name;
    card.querySelector('.destination-card__days').textContent = `${destination.days} ${destination.days === 1 ? 'night' : 'nights'}`;

    // Matches (why this destination)
    const matchesEl = card.querySelector('.destination-card__matches');
    if (destination.matches?.length && matchesEl) {
      matchesEl.innerHTML = destination.matches
        .map(m => `<span class="match-tag">${m}</span>`)
        .join('');
    }

    // Drive time from previous
    const driveEl = card.querySelector('.destination-card__drive');
    if (destination.driveFromPrevious && driveEl) {
      driveEl.textContent = `${Math.round(destination.driveFromPrevious / 60)}h drive from previous stop`;
    } else if (driveEl) {
      driveEl.style.display = 'none';
    }

    // Lock state
    if (destination.locked) {
      card.classList.add('locked');
      const badge = card.querySelector('.destination-card__locked-badge');
      if (badge) badge.style.display = 'inline';
      const lockBtn = card.querySelector('[data-action="lock-destination"]');
      if (lockBtn) lockBtn.style.display = 'none';
    }

    container.appendChild(clone);
  }

  renderPropertyCard(property, container, destinationId) {
    const template = this.templates.propertyCard;
    if (!template) return;

    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.property-card');

    card.dataset.destinationId = destinationId;
    card.dataset.propertyId = property.id;
    card.dataset.placeId = property.place_id || property.id;

    card.querySelector('.property-card__name').textContent = property.name;

    // Handle images array for gallery (16:9 thumbnails)
    const images = property.images || (property.image ? [property.image] : []);
    const galleryMain = card.querySelector('.gallery__main');
    const heroImg = card.querySelector('.gallery__hero');
    const countEl = card.querySelector('.gallery__count-num');
    const thumbsContainer = card.querySelector('.gallery__thumbs');

    if (images.length > 0) {
      // Set hero image (first image)
      heroImg.src = images[0];
      heroImg.alt = property.name;

      // Update count
      countEl.textContent = images.length;

      // Add thumbnails (show first 5)
      const thumbsToShow = images.slice(0, 5);
      thumbsToShow.forEach((imgUrl, index) => {
        const thumb = document.createElement('div');
        thumb.className = `gallery__thumb ${index === 0 ? 'is-active' : ''}`;
        thumb.dataset.index = index;
        thumb.innerHTML = `<img src="${imgUrl}" alt="${property.name} - Image ${index + 1}" loading="lazy">`;

        // Thumbnail hover changes hero
        thumb.addEventListener('mouseenter', () => {
          heroImg.src = imgUrl;
          thumbsContainer.querySelectorAll('.gallery__thumb').forEach(t => t.classList.remove('is-active'));
          thumb.classList.add('is-active');
        });

        thumbsContainer.appendChild(thumb);
      });

      // Click on gallery opens fullscreen
      galleryMain.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openGallery(property.name, images, 0);
      });
    } else {
      // Show placeholder for properties without Shopify images yet
      heroImg.src = 'https://cdn.shopify.com/s/files/1/0883/0892/0858/files/placeholder-lodge.png?v=1712000000';
      heroImg.alt = `${property.name} - Images coming soon`;
      galleryMain.classList.add('gallery--placeholder');
      countEl.textContent = '0';
    }

    const rating = card.querySelector('.rating__value');
    if (property.rating && rating) {
      rating.textContent = property.rating.toFixed(1);
    }

    const stars = card.querySelector('.rating__stars');
    if (property.rating && stars) {
      stars.textContent = '★'.repeat(Math.round(property.rating));
    }

    const style = card.querySelector('.property-card__style');
    if (property.style && style) {
      style.textContent = property.style;
    }

    // Short description
    const description = card.querySelector('.property-card__description');
    if (property.description && description) {
      description.textContent = property.description;
    }

    // Constraint match tags (why this property was recommended)
    if (property.constraint_matches?.length) {
      const tagsContainer = document.createElement('div');
      tagsContainer.className = 'property-card__constraint-tags';
      tagsContainer.innerHTML = property.constraint_matches
        .slice(0, 3) // Show max 3 tags
        .map(match => `<span class="constraint-tag">${this.escapeHtml(match)}</span>`)
        .join('');

      // Insert after the style element or at the top of info section
      const infoSection = card.querySelector('.property-card__info');
      if (infoSection) {
        const styleEl = card.querySelector('.property-card__style');
        if (styleEl && styleEl.nextSibling) {
          infoSection.insertBefore(tagsContainer, styleEl.nextSibling);
        } else {
          infoSection.appendChild(tagsContainer);
        }
      }
    }

    container.appendChild(clone);
  }

  // ============ FULLSCREEN GALLERY ============

  initGallery() {
    this.gallery = {
      overlay: document.getElementById('gallery-overlay'),
      title: null,
      counter: null,
      mainImage: null,
      caption: null,
      thumbsTrack: null,
      prevBtn: null,
      nextBtn: null,
      closeBtn: null,
      images: [],
      currentIndex: 0,
      isOpen: false
    };

    if (!this.gallery.overlay) return;

    this.gallery.title = this.gallery.overlay.querySelector('.gallery-header__title');
    this.gallery.counter = this.gallery.overlay.querySelector('.gallery-header__counter');
    this.gallery.mainImage = this.gallery.overlay.querySelector('.gallery-main__image');
    this.gallery.caption = this.gallery.overlay.querySelector('.gallery-main__caption');
    this.gallery.thumbsTrack = this.gallery.overlay.querySelector('.gallery-thumbs__track');
    this.gallery.prevBtn = this.gallery.overlay.querySelector('.gallery-nav--prev');
    this.gallery.nextBtn = this.gallery.overlay.querySelector('.gallery-nav--next');
    this.gallery.closeBtn = this.gallery.overlay.querySelector('.gallery-header__close');

    // Bind gallery events
    this.gallery.closeBtn?.addEventListener('click', () => this.closeGallery());
    this.gallery.prevBtn?.addEventListener('click', () => this.galleryPrev());
    this.gallery.nextBtn?.addEventListener('click', () => this.galleryNext());
    this.gallery.overlay.querySelector('.gallery-overlay__backdrop')?.addEventListener('click', () => this.closeGallery());

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!this.gallery.isOpen) return;

      switch (e.key) {
        case 'Escape':
          this.closeGallery();
          break;
        case 'ArrowLeft':
          this.galleryPrev();
          break;
        case 'ArrowRight':
          this.galleryNext();
          break;
      }
    });
  }

  openGallery(title, images, startIndex = 0) {
    if (!this.gallery.overlay || !images.length) return;

    this.gallery.images = images;
    this.gallery.currentIndex = startIndex;
    this.gallery.isOpen = true;

    // Set title
    this.gallery.title.textContent = title;

    // Render thumbnails
    this.gallery.thumbsTrack.innerHTML = images.map((img, index) => `
      <div class="gallery-thumb-item ${index === startIndex ? 'is-active' : ''}" data-index="${index}">
        <img src="${img}" alt="${title} - Image ${index + 1}" loading="lazy">
      </div>
    `).join('');

    // Add click handlers to thumbnails
    this.gallery.thumbsTrack.querySelectorAll('.gallery-thumb-item').forEach(thumb => {
      thumb.addEventListener('click', () => {
        this.galleryGoTo(parseInt(thumb.dataset.index, 10));
      });
    });

    // Show current image
    this.updateGalleryImage();

    // Open overlay
    this.gallery.overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('gallery-open');

    // Focus close button for accessibility
    this.gallery.closeBtn?.focus();

    this.log('Gallery opened:', title, 'with', images.length, 'images');
  }

  closeGallery() {
    if (!this.gallery.overlay) return;

    this.gallery.isOpen = false;
    this.gallery.overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('gallery-open');

    this.log('Gallery closed');
  }

  galleryPrev() {
    if (this.gallery.currentIndex > 0) {
      this.galleryGoTo(this.gallery.currentIndex - 1);
    } else {
      // Loop to end
      this.galleryGoTo(this.gallery.images.length - 1);
    }
  }

  galleryNext() {
    if (this.gallery.currentIndex < this.gallery.images.length - 1) {
      this.galleryGoTo(this.gallery.currentIndex + 1);
    } else {
      // Loop to start
      this.galleryGoTo(0);
    }
  }

  galleryGoTo(index) {
    this.gallery.currentIndex = index;
    this.updateGalleryImage();

    // Update active thumbnail
    this.gallery.thumbsTrack.querySelectorAll('.gallery-thumb-item').forEach((thumb, i) => {
      thumb.classList.toggle('is-active', i === index);
    });

    // Scroll thumbnail into view
    const activeThumb = this.gallery.thumbsTrack.querySelector('.gallery-thumb-item.is-active');
    activeThumb?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  updateGalleryImage() {
    const images = this.gallery.images;
    const index = this.gallery.currentIndex;

    if (!images.length) return;

    // Update main image
    this.gallery.mainImage.src = images[index];

    // Update counter
    this.gallery.counter.textContent = `${index + 1} / ${images.length}`;

    // Caption (could be set from image metadata if available)
    this.gallery.caption.textContent = '';
  }

  // Render destination photos inline in chat
  renderDestinationGallery(destination, container) {
    const template = this.templates.destinationGallery;
    if (!template || !destination.images?.length) return;

    const clone = template.content.cloneNode(true);
    const gallery = clone.querySelector('.destination-gallery');

    gallery.dataset.destinationId = destination.id;
    gallery.querySelector('.destination-gallery__title').textContent = destination.name;
    gallery.querySelector('.destination-gallery__subtitle').textContent =
      `${destination.images.length} photos`;

    const grid = gallery.querySelector('.destination-gallery__grid');

    // Show first 6 images in grid (16:9 thumbnails)
    const imagesToShow = destination.images.slice(0, 6);
    imagesToShow.forEach((imgUrl, index) => {
      const item = document.createElement('div');
      item.className = 'destination-gallery__item';
      item.innerHTML = `<img src="${imgUrl}" alt="${destination.name} - Photo ${index + 1}" loading="lazy">`;

      // Click opens fullscreen gallery
      item.addEventListener('click', () => {
        this.openGallery(destination.name, destination.images, index);
      });

      grid.appendChild(item);
    });

    // If more than 6 images, show "+X more" indicator
    if (destination.images.length > 6) {
      const moreItem = document.createElement('div');
      moreItem.className = 'destination-gallery__item destination-gallery__more';
      moreItem.innerHTML = `
        <div class="destination-gallery__more-overlay">
          +${destination.images.length - 6} more
        </div>
      `;
      moreItem.addEventListener('click', () => {
        this.openGallery(destination.name, destination.images, 6);
      });
      grid.appendChild(moreItem);
    }

    container.appendChild(clone);
  }

  renderRouteSkeleton(skeleton, container) {
    const template = this.templates.routeSkeleton;
    if (!template) return;

    // Check if skeleton already exists
    const existing = container.querySelector('.route-skeleton');
    if (existing) {
      existing.remove();
    }

    const clone = template.content.cloneNode(true);
    const skeletonEl = clone.querySelector('.route-skeleton');

    // Update count
    const count = skeletonEl.querySelector('.route-skeleton__count');
    if (count) {
      count.textContent = `${skeleton.destinations?.length || 0} stops`;
    }

    // Build timeline
    const timeline = skeletonEl.querySelector('.route-skeleton__timeline');
    if (timeline && skeleton.destinations?.length) {
      timeline.innerHTML = skeleton.destinations.map((dest, i) => `
        <div class="timeline-stop ${dest.locked ? 'locked' : ''}" data-destination-id="${dest.id}">
          <div class="timeline-stop__marker">
            ${dest.locked ? '✓' : (i + 1)}
          </div>
          <div class="timeline-stop__content">
            <span class="timeline-stop__name">${dest.name}</span>
            <span class="timeline-stop__days">${dest.days} ${dest.days === 1 ? 'night' : 'nights'}</span>
          </div>
          ${dest.driveFromPrevious ? `
            <div class="timeline-stop__drive">
              ${Math.round(dest.driveFromPrevious / 60)}h drive
            </div>
          ` : ''}
        </div>
      `).join('');
    }

    container.appendChild(clone);
  }

  renderQuestions(questions, container) {
    // Render as suggestion chips directly in the chat flow
    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'suggestion-chips';

    chipsContainer.innerHTML = questions.map(q => `
      <button type="button" class="suggestion-chip"
        data-question="${encodeURIComponent(q)}"
        onclick="plekifyChat.answerQuestion('${encodeURIComponent(q)}')">
        ${q}
      </button>
    `).join('');

    container.appendChild(chipsContainer);
  }

  answerQuestion(encodedQuestion) {
    const question = decodeURIComponent(encodedQuestion);

    // Auto-send the question instead of just populating the input
    if (!this.state.isProcessing) {
      this.addUserMessage(question);
      this.processMessage(question);
    }
  }

  renderUserMessageText(textEl, text) {
    const words = text.split(/\s+/);
    const TRUNCATE_THRESHOLD = 100;
    const TRUNCATE_TO = 80;

    if (words.length <= TRUNCATE_THRESHOLD) {
      textEl.textContent = text;
      return;
    }

    // Message is long - show truncated version with expand button
    const truncatedText = words.slice(0, TRUNCATE_TO).join(' ');

    textEl.innerHTML = `
      <span class="message__text-truncated">${this.escapeHtml(truncatedText)}...</span>
      <span class="message__text-full" style="display: none;">${this.escapeHtml(text)}</span>
      <button type="button" class="message__expand-btn" onclick="plekifyChat.toggleMessageExpand(this)">
        Show more
      </button>
    `;
  }

  toggleMessageExpand(btn) {
    const textEl = btn.parentElement;
    const truncated = textEl.querySelector('.message__text-truncated');
    const full = textEl.querySelector('.message__text-full');

    if (truncated.style.display === 'none') {
      // Currently expanded, collapse it
      truncated.style.display = '';
      full.style.display = 'none';
      btn.textContent = 'Show more';
    } else {
      // Currently collapsed, expand it
      truncated.style.display = 'none';
      full.style.display = '';
      btn.textContent = 'Show less';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showTypingIndicator() {
    // Remove existing indicator if any
    this.hideTypingIndicator();

    const thinkingMessages = [
      'Understanding your trip...',
      'Designing your journey...',
      'Finding the perfect spots...',
      'Crafting your route...',
      'Exploring possibilities...',
      'Matching your preferences...',
      'Checking availability...',
      'Building your itinerary...'
    ];

    const indicator = document.createElement('div');
    indicator.className = 'plekify-thinking';
    indicator.id = 'typing-indicator';
    indicator.innerHTML = `
      <div class="plekify-thinking__avatar">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
      </div>
      <div class="plekify-thinking__content">
        <div class="plekify-thinking__dots">
          <span class="plekify-thinking__dot"></span>
          <span class="plekify-thinking__dot"></span>
          <span class="plekify-thinking__dot"></span>
        </div>
        <span class="plekify-thinking__text">${thinkingMessages[0]}</span>
      </div>
    `;
    this.dom.messagesContainer.appendChild(indicator);
    this.scrollToBottom();

    // Rotate through thinking messages
    let messageIndex = 0;
    this._thinkingInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % thinkingMessages.length;
      const textEl = indicator.querySelector('.plekify-thinking__text');
      if (textEl) {
        textEl.style.opacity = '0';
        setTimeout(() => {
          textEl.textContent = thinkingMessages[messageIndex];
          textEl.style.opacity = '1';
        }, 200);
      }
    }, 3000);
  }

  hideTypingIndicator() {
    if (this._thinkingInterval) {
      clearInterval(this._thinkingInterval);
      this._thinkingInterval = null;
    }
    const indicator = document.getElementById('typing-indicator');
    indicator?.remove();
  }

  scrollToBottom() {
    requestAnimationFrame(() => {
      this.dom.messagesContainer.scrollTop = this.dom.messagesContainer.scrollHeight;
    });
  }

  // ============ VOICE RECORDING ============

  async toggleRecording(context = 'chat') {
    if (this.recording.isActive) {
      this.stopRecording();
    } else {
      await this.startRecording(context);
    }
  }

  async startRecording(context) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recording.mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });

      this.recording.audioChunks = [];
      this.recording.context = context;

      this.recording.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.recording.audioChunks.push(e.data);
        }
      };

      this.recording.mediaRecorder.onstop = () => this.processRecording();

      this.recording.mediaRecorder.start(100);
      this.recording.isActive = true;
      this.recording.startTime = Date.now();

      // Update UI
      const btn = context === 'landing' ? this.dom.landingVoiceBtn : this.dom.chatVoiceBtn;
      btn?.classList.add('recording');

      this.log('Recording started');
    } catch (error) {
      console.error('Microphone access denied:', error);
      this.showToast('Please allow microphone access to use voice input.', 'error');
    }
  }

  stopRecording() {
    if (this.recording.mediaRecorder && this.recording.isActive) {
      this.recording.mediaRecorder.stop();
      this.recording.mediaRecorder.stream.getTracks().forEach(t => t.stop());
      this.recording.isActive = false;

      const btn = this.recording.context === 'landing'
        ? this.dom.landingVoiceBtn
        : this.dom.chatVoiceBtn;
      btn?.classList.remove('recording');

      this.log('Recording stopped');
    }
  }

  async processRecording() {
    const audioBlob = new Blob(this.recording.audioChunks, {
      type: this.recording.mediaRecorder.mimeType
    });

    const btn = this.recording.context === 'landing'
      ? this.dom.landingVoiceBtn
      : this.dom.chatVoiceBtn;
    btn?.classList.add('processing');

    try {
      const base64Audio = await this.blobToBase64(audioBlob);

      const response = await fetch(`${this.briefingApiBase}/api/chat/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: this.state.sessionId,
          audio_data: base64Audio,
          duration_seconds: Math.floor((Date.now() - this.recording.startTime) / 1000),
          mime_type: this.recording.mediaRecorder.mimeType
        })
      });

      if (response.ok) {
        const data = await response.json();
        const transcript = data.transcript || '';

        // Add to appropriate input
        if (this.recording.context === 'landing') {
          const current = this.dom.initialInput.value;
          const sep = current && !current.endsWith(' ') ? ' ' : '';
          this.dom.initialInput.value = current + sep + transcript;
          this.onLandingInput();
        } else {
          const current = this.dom.chatInput.value;
          const sep = current && !current.endsWith(' ') ? ' ' : '';
          this.dom.chatInput.value = current + sep + transcript;
          this.onChatInput();
        }

        this.showToast('Voice transcribed', 'success');
      } else {
        throw new Error('Transcription failed');
      }
    } catch (error) {
      console.error('Recording processing failed:', error);
      this.showToast('Voice transcription failed. Please type instead.', 'error');
    } finally {
      btn?.classList.remove('processing');
    }
  }

  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ============ GENERATE ITINERARY ============

  async generateItinerary() {
    if (!this.checkReadiness()) {
      this.showToast('Please complete your trip details before generating.', 'error');
      return;
    }

    this.transitionTo('generating');

    // Phase mapping for progress display
    const phases = {
      'validating': { step: 0, label: 'Validating route...' },
      'properties': { step: 1, label: 'Selecting accommodations...' },
      'brief': { step: 2, label: 'Compiling travel brief...' },
      'skeleton': { step: 3, label: 'Building itinerary...' },
      'saving': { step: 4, label: 'Saving itinerary...' },
      'publishing': { step: 5, label: 'Creating your itinerary page...' }
    };
    const totalPhases = 6;

    const updateGeneratingStatus = (message) => {
      if (this.dom.generatingStatus) {
        this.dom.generatingStatus.textContent = message;
      }
    };

    const setProgress = (percent) => {
      if (this.dom.progressBar) {
        this.dom.progressBar.style.width = `${percent}%`;
      }
    };

    const showItineraryLink = (itineraryId) => {
      const container = this.dom.generatingContainer || document.querySelector('.plekify-chat__generating');
      if (container) {
        container.innerHTML = `
          <div class="plekify-chat__generating-complete">
            <h3>Your itinerary is ready!</h3>
            <a href="/pages/itinerary/${itineraryId}" class="plekify-chat__btn plekify-chat__btn--primary">
              View Itinerary
            </a>
          </div>
        `;
      }
    };

    try {
      // Use EventSource for proper SSE handling
      const url = `${this.briefingApiBase}/api/chat/generate?session_id=${encodeURIComponent(this.state.sessionId)}`;
      const eventSource = new EventSource(url);

      eventSource.addEventListener('phase', (event) => {
        const data = JSON.parse(event.data);
        const phaseInfo = phases[data.phase];

        if (phaseInfo) {
          // Update status message
          const message = data.message || phaseInfo.label;
          updateGeneratingStatus(message);

          // Update progress
          if (data.status === 'started') {
            setProgress((phaseInfo.step / totalPhases) * 100);
          } else if (data.status === 'complete') {
            setProgress(((phaseInfo.step + 1) / totalPhases) * 100);
          }
        }

        this.log('Phase:', data);
      });

      eventSource.addEventListener('property', (event) => {
        const data = JSON.parse(event.data);
        updateGeneratingStatus(`Selected: ${data.property} for ${data.destination}`);
        this.log('Property selected:', data);
      });

      eventSource.addEventListener('complete', (event) => {
        const data = JSON.parse(event.data);

        // Update UI to show completion
        updateGeneratingStatus('Complete! Redirecting to your itinerary...');
        setProgress(100);

        // Close the SSE connection
        eventSource.close();

        // Redirect to the itinerary page after a brief delay
        setTimeout(() => {
          if (data.url) {
            window.location.href = data.url;
          } else {
            // Fallback: show link
            showItineraryLink(data.itinerary_id);
          }
        }, 1000);
      });

      eventSource.addEventListener('error', (event) => {
        let errorMessage = 'Generation failed';

        // Try to parse error data if it's from our server
        if (event.data) {
          try {
            const data = JSON.parse(event.data);
            errorMessage = data.message || errorMessage;
          } catch (e) {
            // Not JSON, use default message
          }
        }

        eventSource.close();
        console.error('Generation error:', errorMessage);
        this.showToast(errorMessage, 'error');
        this.transitionTo('conversation');
      });

      // Handle connection errors
      eventSource.onerror = (error) => {
        if (eventSource.readyState === EventSource.CLOSED) {
          return; // Normal close, ignore
        }
        eventSource.close();
        console.error('SSE connection error:', error);
        this.showToast('Connection lost. Please try again.', 'error');
        this.transitionTo('conversation');
      };

    } catch (error) {
      console.error('Generation failed:', error);
      this.showToast('Itinerary generation failed. Please try again.', 'error');
      this.transitionTo('conversation');
    }
  }

  // ============ UTILITY METHODS ============

  viewRouteOnMap() {
    // TODO: Implement map view modal
    this.showToast('Map view coming soon!', 'info');
  }

  adjustStops() {
    this.dom.chatInput.value = "I'd like to adjust the stops. ";
    this.dom.chatInput.focus();
  }

  generateId() {
    return 'id-' + Math.random().toString(36).substr(2, 9);
  }

  log(...args) {
    if (this.debug) {
      console.log('[PlekifyChat]', ...args);
    }
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `plekify-toast plekify-toast--${type}`;
    toast.innerHTML = `
      <span class="toast-message">${message}</span>
      <button class="toast-dismiss" onclick="this.parentElement.remove()">&times;</button>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}

// Global instance
let plekifyChat;

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    plekifyChat = new PlekifyChat();
  });
} else {
  plekifyChat = new PlekifyChat();
}

// Export for global access
window.plekifyChat = plekifyChat;
