document.body.classList.add('js');

const revealItems = document.querySelectorAll('[data-reveal]');

const observer = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.2, rootMargin: '0px 0px -10% 0px' }
);

revealItems.forEach(item => {
  const delay = item.getAttribute('data-delay');
  if (delay) {
    item.style.setProperty('--reveal-delay', `${delay}s`);
  }
  observer.observe(item);
});

const modal = document.querySelector('[data-modal]');
const posterModal = document.querySelector('[data-poster-modal]');
const openButtons = document.querySelectorAll('[data-open-modal]');
const closeButtons = document.querySelectorAll('[data-close-modal]');
const closePosterButtons = document.querySelectorAll('[data-close-poster-modal]');
const razorpayButton = document.querySelector('#razorpay-button');

const openModal = () => {
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
};

const closeModal = () => {
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
};

const openPosterModal = () => {
  if (!posterModal) return;
  posterModal.classList.add('open');
  posterModal.setAttribute('aria-hidden', 'false');
};

const closePosterModal = () => {
  if (!posterModal) return;
  posterModal.classList.remove('open');
  posterModal.setAttribute('aria-hidden', 'true');
};

openButtons.forEach(btn => btn.addEventListener('click', openModal));
closeButtons.forEach(btn => btn.addEventListener('click', closeModal));
closePosterButtons.forEach(btn => btn.addEventListener('click', closePosterModal));

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeModal();
    closePosterModal();
  }
});

const startRazorpayPayment = async () => {
  try {
    const response = await fetch('/api/razorpay/order', { method: 'POST' });
    if (!response.ok) {
      throw new Error('Unable to create order');
    }
    const data = await response.json();
    if (!data.key_id || !data.order_id) {
      throw new Error('Invalid Razorpay response');
    }

    const options = {
      key: data.key_id,
      amount: data.amount,
      currency: data.currency || 'INR',
      name: data.name || 'Success Journey Network',
      description: data.description || 'Joining fee',
      order_id: data.order_id,
      handler: () => {
        alert('Payment successful! Our team will contact you soon.');
        closeModal();
      },
      theme: { color: '#f97316' },
    };

    const razorpay = new Razorpay(options);
    razorpay.open();
  } catch (error) {
    alert('Unable to start Razorpay payment. Please try again.');
  }
};

if (razorpayButton) {
  razorpayButton.addEventListener('click', startRazorpayPayment);
}

const postLead = async (payload, successMessage) => {
  try {
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Failed to submit');
    }

    alert(successMessage);
    return true;
  } catch (error) {
    alert('Something went wrong. Please try again.');
    return false;
  }
};

const leadForm = document.querySelector('#lead-form');
if (leadForm) {
  leadForm.addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(leadForm).entries());
    const ok = await postLead(
      {
        name: data.name,
        phone: data.phone,
        status: 'New',
        notes: 'Lead captured from recruitment form.',
      },
      'Thanks! Our team will contact you shortly.'
    );
    if (ok) leadForm.reset();
  });
}

const contactForm = document.querySelector('#contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(contactForm).entries());
    const ok = await (async () => {
      try {
        const response = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            phone: data.phone,
            message: data.notes || 'Requested a callback.',
          }),
        });
        if (!response.ok) throw new Error('Failed to submit');
        alert('Request sent! We will call you soon.');
        return true;
      } catch (error) {
        alert('Something went wrong. Please try again.');
        return false;
      }
    })();
    if (ok) contactForm.reset();
  });
}

const officialLink = document.querySelector('#official-link');
const contactPhone = document.querySelector('#contact-phone');
const contactEmail = document.querySelector('#contact-email');
const contactWhatsapp = document.querySelector('#contact-whatsapp');
const footerPhone = document.querySelector('#footer-phone');
const footerEmail = document.querySelector('#footer-email');
const posterGrid = document.querySelector('#poster-grid');
const galleryTrack = document.querySelector('#gallery-track');
const galleryFallback = galleryTrack
  ? [...galleryTrack.querySelectorAll('.poster-card')].map((card, index) => {
      const image = card.querySelector('img');
      if (image && image.getAttribute('src')) {
        return {
          type: 'img',
          src: image.getAttribute('src'),
          alt: image.getAttribute('alt') || `Poster ${index + 1}`,
        };
      }
      return {
        type: 'text',
        text: card.textContent.trim() || `Poster ${index + 1}`,
      };
    })
  : [];

const renderPosterGrid = items => {
  if (!posterGrid) return;
  if (!items.length) return;
  posterGrid.innerHTML = items
    .map(item => {
      if (item.type === 'img') {
        return `<div class="poster-tile"><img src="${item.src}" alt="${item.alt || 'Poster'}" loading="lazy" /></div>`;
      }
      return `<div class="poster-tile"><span class="poster-label">${item.text || 'Poster'}</span></div>`;
    })
    .join('');
};

const normalizePosterUrl = value => {
  const raw = String(value || '').trim().replaceAll('\\', '/');
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('/static/')) return raw;
  if (raw.startsWith('static/')) return `/${raw}`;
  if (raw.startsWith('/posters/')) return `/static${raw}`;
  if (raw.startsWith('posters/')) return `/static/${raw}`;
  if (/\.(png|jpe?g|webp)$/i.test(raw)) return `/static/posters/${raw}`;
  return '';
};

const renderGalleryTrack = posters => {
  if (!galleryTrack) return;
  const items = Array.isArray(posters) && posters.length ? posters : [];
  let cards = [];
  if (items.length) {
    cards = items
      .map(normalizePosterUrl)
      .filter(Boolean)
      .map((url, index) => ({
        type: 'img',
        src: url,
        alt: `Poster ${index + 1}`,
      }));
  } else if (galleryFallback.length) {
    cards = galleryFallback;
  }

  if (!cards.length) return;
  const doubled = [...cards, ...cards];
  galleryTrack.innerHTML = doubled
    .map(card => {
      if (card.type === 'img') {
        return `<div class="poster-card"><img src="${card.src}" alt="${card.alt || 'Poster'}" loading="lazy" /></div>`;
      }
      return `<div class="poster-card">${card.text || 'Poster'}</div>`;
    })
    .join('');
};

const syncPosterModal = () => {
  if (!posterGrid) return;
  const items = [...posterGrid.querySelectorAll('.poster-tile')].map((tile, index) => ({
    type: 'text',
    text: tile.textContent.trim() || `Poster ${index + 1}`,
  }));
  renderPosterGrid(items);
};

const applySettings = settings => {
  if (!settings || typeof settings !== 'object') return;

  if (settings.official_url && officialLink) {
    officialLink.href = settings.official_url;
  }
  if (settings.phone && contactPhone) {
    contactPhone.textContent = settings.phone;
  }
  if (settings.phone && footerPhone) {
    footerPhone.textContent = settings.phone;
  }
  if (settings.email && contactEmail) {
    contactEmail.textContent = settings.email;
  }
  if (settings.email && footerEmail) {
    footerEmail.textContent = settings.email;
  }
  if (settings.whatsapp && contactWhatsapp) {
    contactWhatsapp.href = settings.whatsapp;
  }
  if (Array.isArray(settings.posters) && posterGrid) {
    const posters = settings.posters.map(normalizePosterUrl).filter(Boolean);
    if (posters.length) {
      posterGrid.innerHTML = posters
        .map((url, index) => `<div class="poster-tile"><img src="${url}" alt="Poster ${index + 1}" loading="lazy" /></div>`)
        .join('');
    }
  }

  if (Array.isArray(settings.posters)) {
    renderGalleryTrack(settings.posters);
  } else {
    renderGalleryTrack([]);
  }
};

const loadSettings = async () => {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return;
    const data = await response.json();
    applySettings(data);
  } catch (error) {
    // Silent fail for now
  }
};

renderGalleryTrack([]);
loadSettings();
