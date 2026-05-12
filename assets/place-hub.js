/**
 * place-hub.js — Shared JS for country, province, city hub pages
 * Handles: sub-region cards, photo gallery, MapLibre map, category rows
 */
(function() {
  'use strict';

  // ---- Sub-Region Cards (rendered client-side) ----
  window.renderSubRegions = function(containerId, scrollId, statId) {
    const section = document.getElementById(containerId);
    const scroll = document.getElementById(scrollId);
    if (!section || !scroll) return;

    const raw = section.dataset.childrenJson;
    if (!raw || raw === 'null' || raw === '[]') return;

    let children;
    try {
      children = JSON.parse(raw);
    } catch (e) {
      console.warn('Sub-regions JSON parse failed:', e);
      return;
    }

    if (!Array.isArray(children) || children.length === 0) return;

    const maxCards = 40;
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < Math.min(children.length, maxCards); i++) {
      const child = children[i];
      if (!child || !child.handle) continue;

      const card = document.createElement('div');
      card.className = 'ph-card';

      const photo = child.photo || '';
      const fallback = child.name ? child.name.charAt(0).toUpperCase() : '';
      const imgHtml = photo
        ? '<img src="' + photo + '" alt="' + (child.name || '') + '" loading="lazy">'
        : '<div class="ph-card__image-fallback">' + fallback + '</div>';

      const level = child.level ? (child.level.charAt(0).toUpperCase() + child.level.slice(1)) : '';
      const countHtml = child.place_count && child.place_count > 0
        ? '<span>' + child.place_count + ' places</span>'
        : '';

      card.innerHTML =
        '<a href="/pages/' + child.handle + '">' +
          '<div class="ph-card__image">' + imgHtml + '</div>' +
          '<div class="ph-card__content">' +
            '<h3>' + (child.name || child.handle) + '</h3>' +
            '<div class="ph-card__meta">' +
              '<span class="ph-card__badge">' + level + '</span>' +
              countHtml +
            '</div>' +
          '</div>' +
        '</a>';

      fragment.appendChild(card);
    }

    scroll.appendChild(fragment);
    section.style.display = 'block';

    const statAreas = statId ? document.getElementById(statId) : null;
    if (statAreas) statAreas.textContent = children.length;
  };

  // ---- Photo Gallery ----
  window.initGallery = function(photoSelector, overlayId, mainId, sidebarId, counterId, closeId) {
    const photoEls = document.querySelectorAll(photoSelector);
    const photos = Array.from(photoEls).map(el => el.dataset.src);
    if (photos.length === 0) return;

    const gallery = document.getElementById(overlayId);
    const galleryStack = document.getElementById(mainId);
    const gallerySidebar = document.getElementById(sidebarId);
    const galleryCounter = document.getElementById(counterId);
    const galleryMain = document.getElementById(mainId);
    let currentIndex = 0;

    function openGallery(startIndex) {
      currentIndex = startIndex;
      galleryStack.innerHTML = '';
      gallerySidebar.innerHTML = '';

      photos.forEach((src, i) => {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.dataset.index = i;
        img.loading = i < 3 ? 'eager' : 'lazy';
        galleryStack.appendChild(img);

        const thumb = document.createElement('div');
        thumb.className = 'ph-gallery-thumb' + (i === startIndex ? ' ph-gallery-thumb--active' : '');
        thumb.dataset.index = i;
        const thumbImg = document.createElement('img');
        thumbImg.src = src;
        thumbImg.alt = '';
        thumb.appendChild(thumbImg);
        gallerySidebar.appendChild(thumb);

        thumb.addEventListener('click', () => scrollToImage(i));
      });

      gallery.classList.add('ph-gallery-overlay--open');
      document.body.style.overflow = 'hidden';
      updateCounter();
      scrollToImage(startIndex);
    }

    function closeGallery() {
      gallery.classList.remove('ph-gallery-overlay--open');
      document.body.style.overflow = '';
    }

    function scrollToImage(index) {
      currentIndex = index;
      const target = galleryStack.children[index];
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      updateThumbs();
      updateCounter();
    }

    function updateThumbs() {
      Array.from(gallerySidebar.children).forEach((thumb, i) => {
        thumb.classList.toggle('ph-gallery-thumb--active', i === currentIndex);
        if (i === currentIndex) thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }

    function updateCounter() {
      galleryCounter.textContent = (currentIndex + 1) + ' / ' + photos.length;
    }

    photoEls.forEach(el => {
      el.addEventListener('click', () => openGallery(parseInt(el.dataset.index, 10)));
    });

    document.getElementById(closeId).addEventListener('click', closeGallery);
    galleryStack.addEventListener('click', e => { if (e.target.tagName === 'IMG') closeGallery(); });

    document.addEventListener('keydown', e => {
      if (!gallery.classList.contains('ph-gallery-overlay--open')) return;
      if (e.key === 'Escape') closeGallery();
    });
  };

  // ---- MapLibre Map ----
  window.initMap = function(containerId) {
    const mapContainer = document.getElementById(containerId);
    if (!mapContainer || typeof maplibregl === 'undefined') return;

    const lat = parseFloat(mapContainer.dataset.lat);
    const lng = parseFloat(mapContainer.dataset.lng);
    const level = mapContainer.dataset.level;
    if (!lat || !lng) return;

    let zoom = 8;
    if (level === 'country') zoom = 5;
    else if (level === 'region') zoom = 7;
    else if (level === 'city') zoom = 10;
    else if (level === 'tourism_area') zoom = 12;

    const map = new maplibregl.Map({
      container: containerId,
      style: {
        version: 8,
        sources: {
          'osm': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap'
          }
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      },
      center: [lng, lat],
      zoom: zoom
    });

    map.addControl(new maplibregl.NavigationControl());

    new maplibregl.Marker({ color: '#2A9D8F' })
      .setLngLat([lng, lat])
      .setPopup(new maplibregl.Popup().setHTML('<h3>' + mapContainer.dataset.name + '</h3>'))
      .addTo(map);
  };

  // ---- Category Rows (Netflix-style) ----
  window.loadCategoryRows = function(sectionId, rowsId, lat, lng, radius, showCategories) {
    if (!showCategories || !lat || !lng) return;

    const catSection = document.getElementById(sectionId);
    const catRows = document.getElementById(rowsId);
    if (!catSection || !catRows) return;

    fetch('https://app.murmurgo.com/api/places/nearby?lat=' + lat + '&lng=' + lng + '&radius=' + (radius || 30) + '&limit=60')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const grouped = data.grouped;
        if (!grouped || Object.keys(grouped).length === 0) return;

        let html = '';
        let totalCards = 0;

        const categoryOrder = [
          'Accommodation', 'Restaurants & Dining', 'Activities & Attractions',
          'Shopping', 'Wellness & Spa', 'Nightlife', 'Sports & Recreation', 'Other'
        ];

        const sortedCategories = Object.keys(grouped).sort((a, b) => {
          const ia = categoryOrder.indexOf(a);
          const ib = categoryOrder.indexOf(b);
          if (ia !== -1 && ib !== -1) return ia - ib;
          if (ia !== -1) return -1;
          if (ib !== -1) return 1;
          return a.localeCompare(b);
        });

        for (const category of sortedCategories) {
          const places = grouped[category];
          if (!places || places.length === 0) continue;

          const cardsHtml = places.slice(0, 10).map(p => {
            const photo = p.photos && p.photos[0] ? (p.photos[0].master || p.photos[0].source || '') : '';
            const rating = p.google_rating ? parseFloat(p.google_rating).toFixed(1) : '';
            const location = [p.city, p.region].filter(Boolean).join(', ');
            const placeUrl = p.shopify_handle
              ? '/pages/' + p.shopify_handle
              : '/apps/murmurgo/place/' + (p.place_id || p.id);
            totalCards++;
            return `
              <div class="ph-cat-card">
                <a href="${placeUrl}">
                  <div class="ph-cat-image">
                    <img src="${photo}" alt="${p.name}" loading="lazy" onerror="this.style.display='none';this.parentElement.style.background='#e5e5e5';">
                    ${rating ? `<span class="ph-cat-rating">★ ${rating}</span>` : ''}
                  </div>
                  <div class="ph-cat-content">
                    <h4>${p.name}</h4>
                    <p>${location}</p>
                    <span class="ph-cat-tag">${category}</span>
                  </div>
                </a>
              </div>
            `;
          }).join('');

          html += `
            <div class="ph-cat-row">
              <div class="ph-cat-header">
                <h3>${category}</h3>
                <span>${places.length} found</span>
              </div>
              <div class="ph-cat-scroll">
                ${cardsHtml}
              </div>
            </div>
          `;
        }

        if (totalCards > 0) {
          catRows.innerHTML = html;
          catSection.style.display = 'block';
        }
      })
      .catch(err => {
        console.log('Places load failed:', err);
      });
  };
})();
