/**
 * place-lightbox.js
 * Plekify-style lightbox dialog for place galleries.
 * Uses native <dialog> with vertical scroll-snap and thumbnail strip.
 */

class PlaceLightbox {
  constructor(dialogId, gridSelector) {
    this.dialog = document.getElementById(dialogId);
    this.grid = document.querySelector(gridSelector);
    if (!this.dialog || !this.grid) return;

    this.scrollContainer = this.dialog.querySelector('.mg-place-lightbox__scroll');
    this.medias = this.dialog.querySelectorAll('.mg-place-lightbox__media');
    this.thumbs = this.dialog.querySelectorAll('.mg-place-lightbox__thumb');
    this.closeBtn = this.dialog.querySelector('.mg-place-lightbox__close');
    this.backdrop = this.dialog.querySelector('.mg-place-lightbox__backdrop');

    // Grid click triggers
    this.grid.querySelectorAll('.mg-place-gallery__zoom-trigger').forEach((btn, idx) => {
      btn.addEventListener('click', () => this.open(idx));
    });

    // Close handlers
    this.closeBtn.addEventListener('click', () => this.close());
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog || e.target === this.backdrop) {
        this.close();
      }
    });

    // Keyboard
    this.dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    // Scroll syncs thumbnail highlight
    if (this.scrollContainer) {
      this.scrollContainer.addEventListener('scroll', this.debounce(() => {
        const visible = this.getMostVisible();
        this.selectThumb(visible);
      }, 50));
    }

    // Thumbnail click scrolls to image
    this.thumbs.forEach((thumb, idx) => {
      thumb.addEventListener('click', () => {
        this.medias[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Cleanup on dialog close
    this.dialog.addEventListener('close', () => {
      document.body.style.overflow = '';
    });
  }

  open(index) {
    if (!this.dialog) return;
    this.dialog.showModal();
    this.medias[index]?.scrollIntoView({ behavior: 'instant', block: 'start' });
    this.selectThumb(index);
    document.body.style.overflow = 'hidden';
  }

  close() {
    if (!this.dialog) return;
    this.dialog.close();
  }

  selectThumb(index) {
    this.thumbs.forEach((t, i) => {
      t.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
  }

  getMostVisible() {
    let maxVisible = 0;
    let bestIndex = 0;
    this.medias.forEach((media, i) => {
      const rect = media.getBoundingClientRect();
      const visible = Math.max(
        0,
        Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
      );
      if (visible > maxVisible) {
        maxVisible = visible;
        bestIndex = i;
      }
    });
    return bestIndex;
  }

  debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }
}

window.PlaceLightbox = PlaceLightbox;
