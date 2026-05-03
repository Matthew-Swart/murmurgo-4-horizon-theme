/**
 * ============================================================================
 * WETU ITINERARY TEMPLATE JAVASCRIPT
 * ============================================================================
 * 
 * Core JavaScript functionality for the WETU Itinerary Template.
 * Handles scroll synchronization, lazy loading, collapsibles, navigation,
 * and accessibility features.
 * 
 * Table of Contents:
 * 1. Configuration
 * 2. Utility Functions
 * 3. Lazy Loading
 * 4. Collapsible Sections
 * 5. Day Navigation
 * 6. Scroll Sync
 * 7. Gallery & Lightbox
 * 8. Accessibility
 * 9. Initialization
 * 
 * ============================================================================
 */

(function() {
  'use strict';

  /* ============================================
     1. CONFIGURATION
     ============================================ */
  
  const CONFIG = {
    // Scroll behavior
    scrollOffset: 100,
    scrollBehavior: 'smooth',
    
    // Intersection Observer thresholds
    lazyLoadRootMargin: '100px',
    dayNavThreshold: 0.3,
    
    // Animation
    animationDuration: 300,
    
    // Selectors
    selectors: {
      lazyImage: '.wetu-lazy-image, [data-lazy-src]',
      collapsible: '.wetu-collapsible',
      collapsibleTrigger: '.wetu-collapsible__trigger',
      collapsibleContent: '.wetu-collapsible__content',
      day: '.wetu-day, [id^="day-"]',
      dayNav: '[data-scroll-to-day]',
      journeyCard: '.journey-overview__day-card',
      mobileNav: '.wetu-mobile-nav',
      mobileNavItem: '.wetu-mobile-nav__item',
      progressDot: '.progress-dot',
      mediaItem: '.wetu-days__media-item',
      skipLink: '.wetu-skip-link',
    }
  };

  /* ============================================
     2. UTILITY FUNCTIONS
     ============================================ */
  
  /**
   * Debounce function to limit execution rate
   */
  function debounce(func, wait = 100) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Throttle function for scroll events
   */
  function throttle(func, limit = 100) {
    let inThrottle;
    return function executedFunction(...args) {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  /**
   * Check if user prefers reduced motion
   */
  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Get header height for scroll offset
   */
  function getHeaderHeight() {
    const header = document.querySelector('header, .header, [data-header]');
    if (header) {
      return header.offsetHeight;
    }
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 0;
  }

  /**
   * Smooth scroll to element
   */
  function scrollToElement(element, offset = 0) {
    if (!element) return;
    
    const targetPosition = element.getBoundingClientRect().top + window.pageYOffset - offset;
    
    if (prefersReducedMotion()) {
      window.scrollTo(0, targetPosition);
    } else {
      window.scrollTo({
        top: targetPosition,
        behavior: CONFIG.scrollBehavior
      });
    }
  }

  /**
   * Dispatch custom event
   */
  function dispatchEvent(element, eventName, detail = {}) {
    element.dispatchEvent(new CustomEvent(eventName, {
      bubbles: true,
      detail
    }));
  }

  /* ============================================
     3. LAZY LOADING
     ============================================ */
  
  class LazyImageLoader {
    constructor() {
      this.images = document.querySelectorAll(CONFIG.selectors.lazyImage);
      if (this.images.length === 0) return;
      
      this.init();
    }

    init() {
      if ('IntersectionObserver' in window) {
        this.setupObserver();
      } else {
        this.loadAllImages();
      }
    }

    setupObserver() {
      const options = {
        rootMargin: CONFIG.lazyLoadRootMargin,
        threshold: 0
      };

      this.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.loadImage(entry.target);
            this.observer.unobserve(entry.target);
          }
        });
      }, options);

      this.images.forEach(img => this.observer.observe(img));
    }

    loadImage(img) {
      const src = img.dataset.src || img.dataset.lazySrc;
      if (!src) return;

      // Create temp image to preload
      const tempImg = new Image();
      
      tempImg.onload = () => {
        img.src = src;
        img.classList.add('is-loaded');
        img.classList.remove('wetu-lazy-image');
        
        // Handle srcset if present
        if (img.dataset.srcset) {
          img.srcset = img.dataset.srcset;
        }
        
        dispatchEvent(img, 'wetu:image-loaded', { src });
      };

      tempImg.onerror = () => {
        img.classList.add('is-error');
        console.warn('Failed to load image:', src);
      };

      tempImg.src = src;
    }

    loadAllImages() {
      this.images.forEach(img => this.loadImage(img));
    }
  }

  /* ============================================
     4. COLLAPSIBLE SECTIONS
     ============================================ */
  
  class Collapsible {
    constructor(element) {
      this.element = element;
      this.trigger = element.querySelector(CONFIG.selectors.collapsibleTrigger);
      this.content = element.querySelector(CONFIG.selectors.collapsibleContent);
      
      if (!this.trigger || !this.content) return;
      
      this.isOpen = element.classList.contains('is-open');
      this.init();
    }

    init() {
      // Set initial ARIA attributes
      const contentId = this.content.id || `collapsible-${Math.random().toString(36).substr(2, 9)}`;
      this.content.id = contentId;
      
      this.trigger.setAttribute('aria-expanded', this.isOpen);
      this.trigger.setAttribute('aria-controls', contentId);
      
      // Add click handler
      this.trigger.addEventListener('click', this.toggle.bind(this));
      
      // Keyboard support
      this.trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggle();
        }
      });
    }

    toggle() {
      this.isOpen = !this.isOpen;
      this.element.classList.toggle('is-open', this.isOpen);
      this.trigger.setAttribute('aria-expanded', this.isOpen);
      
      dispatchEvent(this.element, 'wetu:collapsible-toggle', { isOpen: this.isOpen });
    }

    open() {
      if (!this.isOpen) this.toggle();
    }

    close() {
      if (this.isOpen) this.toggle();
    }
  }

  function initCollapsibles() {
    document.querySelectorAll(CONFIG.selectors.collapsible).forEach(element => {
      new Collapsible(element);
    });
  }

  /* ============================================
     5. DAY NAVIGATION
     ============================================ */
  
  class DayNavigation {
    constructor() {
      this.dayLinks = document.querySelectorAll(CONFIG.selectors.dayNav);
      this.days = document.querySelectorAll(CONFIG.selectors.day);
      this.journeyCards = document.querySelectorAll(CONFIG.selectors.journeyCard);
      this.progressDots = document.querySelectorAll(CONFIG.selectors.progressDot);
      this.mediaItems = document.querySelectorAll(CONFIG.selectors.mediaItem);
      
      if (this.days.length === 0) return;
      
      this.currentDay = 1;
      this.init();
    }

    init() {
      this.setupClickHandlers();
      this.setupScrollObserver();
      
      // Listen for day changes from other components
      document.addEventListener('wetu:day-change', (e) => {
        if (e.detail && e.detail.day) {
          this.updateActiveStates(e.detail.day);
        }
      });
    }

    setupClickHandlers() {
      this.dayLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const dayNumber = link.dataset.scrollToDay || link.dataset.day;
          this.scrollToDay(dayNumber);
        });
      });

      this.progressDots.forEach(dot => {
        dot.addEventListener('click', (e) => {
          const dayNumber = dot.dataset.day;
          this.scrollToDay(dayNumber);
        });
      });
    }

    setupScrollObserver() {
      const options = {
        root: null,
        rootMargin: `-${getHeaderHeight() + 50}px 0px -50% 0px`,
        threshold: CONFIG.dayNavThreshold
      };

      this.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const dayNumber = entry.target.dataset.day || 
                              entry.target.id.replace('day-', '');
            this.setCurrentDay(dayNumber);
          }
        });
      }, options);

      this.days.forEach(day => this.observer.observe(day));
    }

    scrollToDay(dayNumber) {
      const target = document.getElementById(`day-${dayNumber}`) ||
                     document.querySelector(`[data-day="${dayNumber}"]`);
      
      if (!target) return;

      const offset = getHeaderHeight() + 80; // Extra offset for mobile nav
      scrollToElement(target, offset);
      this.setCurrentDay(dayNumber);
    }

    setCurrentDay(dayNumber) {
      const newDay = parseInt(dayNumber);
      if (this.currentDay === newDay) return;
      
      this.currentDay = newDay;
      this.updateActiveStates(dayNumber);
      
      // Dispatch event for other components
      dispatchEvent(document, 'wetu:day-change', { day: newDay });
    }

    updateActiveStates(dayNumber) {
      const dayStr = String(dayNumber);

      // Update journey cards
      this.journeyCards.forEach(card => {
        card.classList.toggle('is-active', 
          card.dataset.dayNumber === dayStr || card.dataset.day === dayStr);
      });

      // Update progress dots
      this.progressDots.forEach(dot => {
        dot.classList.toggle('is-active', dot.dataset.day === dayStr);
      });

      // Update media items
      this.mediaItems.forEach(item => {
        const isActive = item.dataset.day === dayStr;
        item.classList.toggle('is-active', isActive);
        item.hidden = !isActive;
      });

      // Update day links
      this.dayLinks.forEach(link => {
        const linkDay = link.dataset.scrollToDay || link.dataset.day;
        link.classList.toggle('is-active', linkDay === dayStr);
        link.setAttribute('aria-selected', linkDay === dayStr);
      });
    }
  }

  /* ============================================
     6. SCROLL SYNC
     ============================================ */
  
  class ScrollSync {
    constructor() {
      this.sections = document.querySelectorAll('[data-scroll-section]');
      this.nav = document.querySelector('[data-scroll-nav]');
      
      if (!this.nav || this.sections.length === 0) return;
      
      this.init();
    }

    init() {
      this.setupObserver();
      window.addEventListener('scroll', throttle(this.updateProgress.bind(this), 50));
    }

    setupObserver() {
      const options = {
        root: null,
        rootMargin: '-30% 0px -70% 0px',
        threshold: 0
      };

      this.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.setActiveSection(entry.target.id);
          }
        });
      }, options);

      this.sections.forEach(section => {
        if (section.id) {
          this.observer.observe(section);
        }
      });
    }

    setActiveSection(sectionId) {
      const navLinks = this.nav.querySelectorAll('a[href^="#"]');
      navLinks.forEach(link => {
        const isActive = link.getAttribute('href') === `#${sectionId}`;
        link.classList.toggle('is-active', isActive);
        link.setAttribute('aria-current', isActive ? 'true' : 'false');
      });
    }

    updateProgress() {
      const scrollTop = window.pageYOffset;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = (scrollTop / docHeight) * 100;
      
      const progressBar = document.querySelector('[data-scroll-progress]');
      if (progressBar) {
        progressBar.style.width = `${progress}%`;
      }
    }
  }

  /* ============================================
     7. GALLERY & LIGHTBOX
     ============================================ */
  
  class GalleryLightbox {
    constructor() {
      this.lightbox = document.getElementById('wetu-lightbox');
      this.triggers = document.querySelectorAll('[data-lightbox-trigger]');
      
      if (!this.lightbox || this.triggers.length === 0) return;
      
      this.currentIndex = 0;
      this.images = [];
      this.init();
    }

    init() {
      this.collectImages();
      this.cacheElements();
      this.setupEventListeners();
    }

    collectImages() {
      this.images = Array.from(this.triggers).map(trigger => ({
        src: trigger.dataset.fullSrc,
        caption: trigger.dataset.caption,
        property: trigger.dataset.property
      }));
    }

    cacheElements() {
      this.imageEl = this.lightbox.querySelector('.lightbox__image');
      this.captionEl = this.lightbox.querySelector('.lightbox__caption');
      this.counterEl = this.lightbox.querySelector('.lightbox__counter');
      this.closeBtn = this.lightbox.querySelector('.lightbox__close');
      this.prevBtn = this.lightbox.querySelector('.lightbox__nav--prev');
      this.nextBtn = this.lightbox.querySelector('.lightbox__nav--next');
      this.backdrop = this.lightbox.querySelector('.lightbox__backdrop');
    }

    setupEventListeners() {
      // Trigger clicks
      this.triggers.forEach((trigger, index) => {
        trigger.addEventListener('click', () => this.open(index));
      });

      // Navigation
      this.closeBtn?.addEventListener('click', () => this.close());
      this.backdrop?.addEventListener('click', () => this.close());
      this.prevBtn?.addEventListener('click', () => this.navigate(-1));
      this.nextBtn?.addEventListener('click', () => this.navigate(1));

      // Keyboard navigation
      document.addEventListener('keydown', (e) => {
        if (this.lightbox.hidden) return;
        
        switch (e.key) {
          case 'Escape':
            this.close();
            break;
          case 'ArrowLeft':
            this.navigate(-1);
            break;
          case 'ArrowRight':
            this.navigate(1);
            break;
        }
      });

      // Touch swipe support
      this.setupTouchSwipe();
    }

    setupTouchSwipe() {
      let touchStartX = 0;
      let touchEndX = 0;

      this.lightbox.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });

      this.lightbox.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchStartX - touchEndX;
        
        if (Math.abs(diff) > 50) {
          if (diff > 0) {
            this.navigate(1);
          } else {
            this.navigate(-1);
          }
        }
      }, { passive: true });
    }

    open(index) {
      this.currentIndex = index;
      this.update();
      this.lightbox.hidden = false;
      this.lightbox.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      
      // Focus trap
      this.closeBtn?.focus();
      
      dispatchEvent(this.lightbox, 'wetu:lightbox-open', { index });
    }

    close() {
      this.lightbox.hidden = true;
      this.lightbox.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      
      // Return focus to trigger
      this.triggers[this.currentIndex]?.focus();
      
      dispatchEvent(this.lightbox, 'wetu:lightbox-close');
    }

    navigate(direction) {
      this.currentIndex = (this.currentIndex + direction + this.images.length) % this.images.length;
      this.update();
    }

    update() {
      const image = this.images[this.currentIndex];
      if (!image) return;

      this.imageEl.src = image.src;
      this.imageEl.alt = image.caption || '';
      
      if (this.captionEl) {
        this.captionEl.textContent = image.caption || image.property || '';
      }
      
      if (this.counterEl) {
        this.counterEl.textContent = `${this.currentIndex + 1} / ${this.images.length}`;
      }
    }
  }

  /* ============================================
     8. ACCESSIBILITY
     ============================================ */
  
  class AccessibilityManager {
    constructor() {
      this.init();
    }

    init() {
      this.setupSkipLink();
      this.setupFocusManagement();
      this.setupReducedMotion();
    }

    setupSkipLink() {
      const skipLink = document.querySelector(CONFIG.selectors.skipLink);
      if (!skipLink) return;

      skipLink.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(skipLink.getAttribute('href'));
        if (target) {
          target.tabIndex = -1;
          target.focus();
        }
      });
    }

    setupFocusManagement() {
      // Add visible focus styles
      document.body.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          document.body.classList.add('user-is-tabbing');
        }
      });

      document.body.addEventListener('mousedown', () => {
        document.body.classList.remove('user-is-tabbing');
      });
    }

    setupReducedMotion() {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      
      const handleChange = () => {
        document.documentElement.classList.toggle('reduce-motion', mediaQuery.matches);
      };

      handleChange();
      mediaQuery.addEventListener('change', handleChange);
    }
  }

  /* ============================================
     9. INITIALIZATION
     ============================================ */
  
  class WetuItinerary {
    constructor() {
      this.modules = {};
    }

    init() {
      // Initialize all modules
      this.modules.lazyLoader = new LazyImageLoader();
      this.modules.dayNav = new DayNavigation();
      this.modules.scrollSync = new ScrollSync();
      this.modules.lightbox = new GalleryLightbox();
      this.modules.accessibility = new AccessibilityManager();
      
      // Initialize collapsibles
      initCollapsibles();

      // Expose API
      window.WetuItinerary = {
        scrollToDay: (day) => this.modules.dayNav?.scrollToDay(day),
        openLightbox: (index) => this.modules.lightbox?.open(index),
        closeLightbox: () => this.modules.lightbox?.close(),
      };

      // Dispatch ready event
      dispatchEvent(document, 'wetu:ready', { modules: Object.keys(this.modules) });
      
      console.log('WETU Itinerary initialized');
    }
  }

  /* ============================================
     DOM READY
     ============================================ */
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const app = new WetuItinerary();
      app.init();
    });
  } else {
    const app = new WetuItinerary();
    app.init();
  }

})();

