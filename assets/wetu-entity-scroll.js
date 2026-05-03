/**
 * WETU Entity Scroll Controller
 * 
 * Handles scroll-based interactions for the Day-by-Day Entities section:
 * - Updates sticky media panel image based on which entity is in view
 * - Syncs progress dots with current entity
 * - Provides smooth scroll navigation via progress dots
 * - Handles scroll-triggered animations
 */

(function() {
  'use strict';

  class WetuEntityScroll {
    constructor(container) {
      this.container = container;
      this.mediaPanel = container.querySelector('.wetu-entities__media');
      this.contentPanel = container.querySelector('.wetu-entities__content');
      this.mediaItems = container.querySelectorAll('.wetu-entities__media-item');
      this.entityCards = container.querySelectorAll('.wetu-entity');
      this.progressDots = container.querySelectorAll('.progress-dot');
      
      this.currentEntityIndex = 0;
      this.isDesktop = window.matchMedia('(min-width: 1024px)').matches;
      
      this.init();
    }
    
    init() {
      // Only initialize scroll tracking on desktop
      if (this.isDesktop) {
        this.initScrollObserver();
        this.initProgressDots();
      }
      
      // Handle resize
      this.handleResize = this.handleResize.bind(this);
      window.addEventListener('resize', this.debounce(this.handleResize, 150));
      
      // Initialize video buttons
      this.initVideoButtons();
    }
    
    /**
     * Initialize Intersection Observer for scroll-based media updates
     */
    initScrollObserver() {
      const options = {
        root: null,
        rootMargin: '-30% 0px -30% 0px', // Trigger when entity is in middle 40% of viewport
        threshold: [0, 0.25, 0.5, 0.75, 1]
      };
      
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.25) {
            const entityIndex = parseInt(entry.target.dataset.entityIndex, 10);
            
            if (entityIndex !== this.currentEntityIndex) {
              this.updateActiveEntity(entityIndex);
            }
          }
        });
      }, options);
      
      // Observe all entity cards
      this.entityCards.forEach(card => {
        this.observer.observe(card);
      });
    }
    
    /**
     * Update the active entity (media and progress)
     */
    updateActiveEntity(newIndex) {
      const prevIndex = this.currentEntityIndex;
      this.currentEntityIndex = newIndex;
      
      // Update media items
      this.mediaItems.forEach((item, index) => {
        if (index === newIndex) {
          item.classList.add('is-active');
          item.removeAttribute('hidden');
        } else {
          item.classList.remove('is-active');
          // Don't hide immediately for transition
          setTimeout(() => {
            if (index !== this.currentEntityIndex) {
              item.setAttribute('hidden', '');
            }
          }, 500);
        }
      });
      
      // Update progress dots
      this.progressDots.forEach((dot, index) => {
        dot.classList.toggle('is-active', index === newIndex);
      });
      
      // Announce change for accessibility
      this.announceEntityChange(newIndex);
    }
    
    /**
     * Initialize progress dot click handlers
     */
    initProgressDots() {
      this.progressDots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
          this.scrollToEntity(index);
        });
      });
    }
    
    /**
     * Smooth scroll to a specific entity
     */
    scrollToEntity(index) {
      const targetCard = this.entityCards[index];
      if (!targetCard) return;
      
      const offset = window.innerHeight * 0.25; // 25% from top
      const targetPosition = targetCard.getBoundingClientRect().top + window.pageYOffset - offset;
      
      window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
      });
    }
    
    /**
     * Initialize video button handlers
     */
    initVideoButtons() {
      const videoButtons = this.container.querySelectorAll('[data-video-trigger]');
      
      videoButtons.forEach(button => {
        button.addEventListener('click', () => {
          const handle = button.dataset.videoTrigger;
          this.openVideoModal(handle);
        });
      });
    }
    
    /**
     * Open video modal (placeholder - integrate with your video modal system)
     */
    openVideoModal(productHandle) {
      // Dispatch custom event for video modal
      const event = new CustomEvent('wetu:open-video', {
        detail: { productHandle },
        bubbles: true
      });
      this.container.dispatchEvent(event);
      
      // Fallback: Open product page with video parameter
      if (!event.defaultPrevented) {
        const url = `/products/${productHandle}?video=1`;
        window.open(url, '_blank');
      }
    }
    
    /**
     * Announce entity change for screen readers
     */
    announceEntityChange(index) {
      const card = this.entityCards[index];
      if (!card) return;
      
      const entityType = card.dataset.entityType;
      const title = card.querySelector('.wetu-entity__title')?.textContent || '';
      
      // Use global announce function if available
      if (typeof window.wetuAnnounce === 'function') {
        window.wetuAnnounce(`Now viewing ${entityType}: ${title}`);
      }
    }
    
    /**
     * Handle window resize
     */
    handleResize() {
      const wasDesktop = this.isDesktop;
      this.isDesktop = window.matchMedia('(min-width: 1024px)').matches;
      
      if (wasDesktop !== this.isDesktop) {
        if (this.isDesktop) {
          // Switched to desktop - start observing
          this.initScrollObserver();
          this.initProgressDots();
        } else {
          // Switched to mobile - disconnect observer
          if (this.observer) {
            this.observer.disconnect();
          }
        }
      }
    }
    
    /**
     * Debounce utility
     */
    debounce(func, wait) {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }
    
    /**
     * Cleanup
     */
    destroy() {
      if (this.observer) {
        this.observer.disconnect();
      }
      window.removeEventListener('resize', this.handleResize);
    }
  }

  // Initialize when DOM is ready
  function init() {
    const containers = document.querySelectorAll('[data-section-type="day-by-day-entities"]');
    
    containers.forEach(container => {
      // Skip if already initialized
      if (container.wetuEntityScroll) return;
      
      container.wetuEntityScroll = new WetuEntityScroll(container);
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for dynamic loading
  window.WetuEntityScroll = WetuEntityScroll;
})();

