/**
 * ============================================================================
 * WETU DAY SCROLL MODULE
 * ============================================================================
 * 
 * Handles the scroll-based interactivity for the day-by-day split layout:
 * - Updates media panel based on scroll position
 * - Syncs progress indicators
 * - Manages sticky media behavior
 * - Coordinates with journey overview navigation
 * 
 * ============================================================================
 */

class WetuDayScroll {
  constructor() {
    // Main containers
    this.section = document.querySelector('[data-section-type="day-by-day-split"]');
    if (!this.section) return;
    
    this.mediaContainer = this.section.querySelector('.wetu-days__media');
    this.contentContainer = this.section.querySelector('.wetu-days__content');
    this.mediaItems = this.section.querySelectorAll('.wetu-days__media-item');
    this.days = this.section.querySelectorAll('.wetu-day');
    this.progressDots = this.section.querySelectorAll('.progress-dot');
    
    // State
    this.currentDayIndex = 0;
    this.isDesktop = window.innerWidth >= 1024;
    this.observer = null;
    this.resizeTimeout = null;
    
    this.init();
  }
  
  init() {
    this.setupIntersectionObserver();
    this.setupProgressNavigation();
    this.setupResponsiveBehavior();
    this.setupJourneyOverviewSync();
    
    // Initial update
    this.updateMedia(0);
  }
  
  /**
   * Intersection Observer for scroll-based media updates
   */
  setupIntersectionObserver() {
    // Disconnect any existing observer
    if (this.observer) {
      this.observer.disconnect();
    }
    
    const options = {
      root: null,
      // Adjust margins for better timing - more aggressive on top
      rootMargin: this.isDesktop ? '-30% 0px -50% 0px' : '-20% 0px -60% 0px',
      threshold: [0, 0.25, 0.5, 0.75, 1]
    };
    
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.25) {
          const dayElement = entry.target;
          const dayIndex = Array.from(this.days).indexOf(dayElement);
          
          if (dayIndex !== -1 && dayIndex !== this.currentDayIndex) {
            this.updateMedia(dayIndex);
          }
        }
      });
    }, options);
    
    // Observe all day elements
    this.days.forEach(day => {
      this.observer.observe(day);
    });
  }
  
  /**
   * Update the visible media item
   */
  updateMedia(newIndex) {
    if (newIndex < 0 || newIndex >= this.mediaItems.length) return;
    
    const previousIndex = this.currentDayIndex;
    this.currentDayIndex = newIndex;
    
    // Update media items
    this.mediaItems.forEach((item, index) => {
      const isActive = index === newIndex;
      item.classList.toggle('is-active', isActive);
      item.hidden = !isActive;
    });
    
    // Update progress dots
    this.progressDots.forEach((dot, index) => {
      dot.classList.toggle('is-active', index === newIndex);
    });
    
    // Update journey overview if it exists
    this.updateJourneyOverview(newIndex);
    
    // Dispatch custom event for other components
    this.section.dispatchEvent(new CustomEvent('wetu:day-change', {
      detail: {
        previousIndex,
        currentIndex: newIndex,
        dayNumber: this.days[newIndex]?.dataset.day
      },
      bubbles: true
    }));
  }
  
  /**
   * Progress dot click navigation
   */
  setupProgressNavigation() {
    this.progressDots.forEach((dot, index) => {
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        this.scrollToDay(index);
      });
    });
  }
  
  /**
   * Scroll to a specific day
   */
  scrollToDay(index) {
    const targetDay = this.days[index];
    if (!targetDay) return;
    
    // Calculate offset to account for sticky header
    const headerOffset = this.isDesktop ? 100 : 60;
    const elementPosition = targetDay.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
    
    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    });
  }
  
  /**
   * Sync with journey overview navigation
   */
  setupJourneyOverviewSync() {
    // Listen for clicks on journey overview day cards
    document.addEventListener('click', (e) => {
      const dayCard = e.target.closest('.journey-overview__day-card');
      if (dayCard) {
        const dayNumber = parseInt(dayCard.dataset.dayNumber);
        // Find corresponding day index
        const dayIndex = Array.from(this.days).findIndex(
          day => parseInt(day.dataset.day) === dayNumber
        );
        if (dayIndex !== -1) {
          this.scrollToDay(dayIndex);
        }
      }
    });
    
    // Listen for external day change requests
    document.addEventListener('wetu:request-day-change', (e) => {
      const { dayNumber } = e.detail;
      const dayIndex = Array.from(this.days).findIndex(
        day => parseInt(day.dataset.day) === dayNumber
      );
      if (dayIndex !== -1) {
        this.scrollToDay(dayIndex);
      }
    });
  }
  
  /**
   * Update the journey overview active state
   */
  updateJourneyOverview(dayIndex) {
    const dayNumber = this.days[dayIndex]?.dataset.day;
    if (!dayNumber) return;
    
    // Update journey overview cards
    const overviewCards = document.querySelectorAll('.journey-overview__day-card');
    overviewCards.forEach(card => {
      const isActive = card.dataset.dayNumber === dayNumber;
      card.classList.toggle('is-active', isActive);
      card.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    
    // Scroll the active card into view in the timeline
    const activeCard = document.querySelector(`.journey-overview__day-card[data-day-number="${dayNumber}"]`);
    if (activeCard) {
      const timeline = activeCard.closest('.journey-overview__timeline');
      if (timeline) {
        const cardRect = activeCard.getBoundingClientRect();
        const timelineRect = timeline.getBoundingClientRect();
        
        // Only scroll if card is not fully visible
        if (cardRect.left < timelineRect.left || cardRect.right > timelineRect.right) {
          timeline.scrollTo({
            left: activeCard.offsetLeft - (timeline.offsetWidth / 2) + (activeCard.offsetWidth / 2),
            behavior: 'smooth'
          });
        }
      }
    }
    
    // Update progress bar if it exists
    const progressFill = document.querySelector('.journey-overview__progress-fill');
    if (progressFill) {
      const progress = ((dayIndex + 1) / this.days.length) * 100;
      progressFill.style.width = `${progress}%`;
    }
  }
  
  /**
   * Handle responsive behavior
   */
  setupResponsiveBehavior() {
    const handleResize = () => {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = setTimeout(() => {
        const wasDesktop = this.isDesktop;
        this.isDesktop = window.innerWidth >= 1024;
        
        // Re-setup observer if breakpoint changed
        if (wasDesktop !== this.isDesktop) {
          this.setupIntersectionObserver();
        }
      }, 150);
    };
    
    window.addEventListener('resize', handleResize, { passive: true });
  }
  
  /**
   * Cleanup
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    clearTimeout(this.resizeTimeout);
  }
}

/**
 * Mobile Media Carousel Controller
 * Syncs carousel with scroll position on mobile
 */
class WeTuMobileMediaSync {
  constructor() {
    this.section = document.querySelector('[data-section-type="day-by-day-split"]');
    if (!this.section || window.innerWidth >= 1024) return;
    
    this.mediaContainer = this.section.querySelector('.wetu-days__media');
    this.carousels = this.mediaContainer.querySelectorAll('.wetu-carousel');
    
    // On mobile, make the media container swipeable
    if (this.carousels.length > 1) {
      this.init();
    }
  }
  
  init() {
    // Listen for day change events
    this.section.addEventListener('wetu:day-change', (e) => {
      // Could animate carousel change here
    });
  }
}

/**
 * Preloader for images
 * Preloads images for adjacent days to improve perceived performance
 */
class WetuImagePreloader {
  constructor() {
    this.section = document.querySelector('[data-section-type="day-by-day-split"]');
    if (!this.section) return;
    
    this.mediaItems = this.section.querySelectorAll('.wetu-days__media-item');
    this.preloadedIndices = new Set([0]);
    
    this.init();
  }
  
  init() {
    // Preload first two days
    this.preloadDay(0);
    this.preloadDay(1);
    
    // Listen for day changes to preload adjacent
    this.section.addEventListener('wetu:day-change', (e) => {
      const { currentIndex } = e.detail;
      this.preloadDay(currentIndex - 1);
      this.preloadDay(currentIndex);
      this.preloadDay(currentIndex + 1);
    });
  }
  
  preloadDay(index) {
    if (index < 0 || index >= this.mediaItems.length) return;
    if (this.preloadedIndices.has(index)) return;
    
    const mediaItem = this.mediaItems[index];
    const images = mediaItem.querySelectorAll('img[data-src]');
    
    images.forEach(img => {
      if (img.dataset.src && !img.classList.contains('is-loaded')) {
        const preloadImg = new Image();
        preloadImg.onload = () => {
          img.src = img.dataset.src;
          img.classList.add('is-loaded');
        };
        preloadImg.src = img.dataset.src;
      }
    });
    
    this.preloadedIndices.add(index);
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Main scroll controller
  const dayScroll = new WetuDayScroll();
  
  // Mobile sync
  new WeTuMobileMediaSync();
  
  // Image preloader
  new WetuImagePreloader();
  
  // Store reference for potential cleanup
  window.wetuDayScroll = dayScroll;
});

// Cleanup on page unload (for SPAs)
window.addEventListener('beforeunload', () => {
  if (window.wetuDayScroll) {
    window.wetuDayScroll.destroy();
  }
});

