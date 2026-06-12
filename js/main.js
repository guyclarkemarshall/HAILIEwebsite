/* ============================================================
   HAILIE — main.js
   Interactive components: nav, FAQ accordion, scroll behaviour
   ============================================================ */

(function () {
  'use strict';

  /* --- Sentry Error Tracking ------------------------------- */
  // Provide your Sentry DSN below to enable error tracking and analytics.
  const SENTRY_DSN = 'https://9bc322d0f32b506ef01ec4c825a2a90e@o4511305200762880.ingest.de.sentry.io/4511553757577296';

  if (SENTRY_DSN) {
    const sentryScript = document.createElement('script');
    sentryScript.src = 'https://browser.sentry-cdn.com/8.34.0/bundle.tracing.replay.min.js';
    sentryScript.crossOrigin = 'anonymous';
    sentryScript.onload = () => {
      if (window.Sentry) {
        window.Sentry.init({
          dsn: SENTRY_DSN,
          integrations: [
            window.Sentry.browserTracingIntegration(),
            window.Sentry.replayIntegration(),
          ],
          tracesSampleRate: 0.2, // Performance monitoring sampling rate
          replaysSessionSampleRate: 0.1, // Replay sampling rate
          replaysOnErrorSampleRate: 1.0, // Replay errors rate
        });
      }
    };
    document.head.appendChild(sentryScript);
  }

  /* --- Sticky nav scroll class ----------------------------- */
  const nav = document.querySelector('.site-nav');
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* --- Mobile nav toggle ----------------------------------- */
  const toggle = document.querySelector('.nav-toggle');
  const drawer = document.querySelector('.nav-drawer');
  const iconOpen  = toggle && toggle.querySelector('.icon-menu');
  const iconClose = toggle && toggle.querySelector('.icon-close');

  if (toggle && drawer) {
    toggle.addEventListener('click', () => {
      const isOpen = drawer.classList.toggle('open');
      toggle.setAttribute('aria-expanded', isOpen);
      if (iconOpen)  iconOpen.style.display  = isOpen ? 'none'  : 'block';
      if (iconClose) iconClose.style.display = isOpen ? 'block' : 'none';
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    /* Close on Escape */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) {
        drawer.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        if (iconOpen)  iconOpen.style.display  = 'block';
        if (iconClose) iconClose.style.display = 'none';
        document.body.style.overflow = '';
        toggle.focus();
      }
    });

    /* Close when a drawer link is clicked */
    drawer.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        drawer.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        if (iconOpen)  iconOpen.style.display  = 'block';
        if (iconClose) iconClose.style.display = 'none';
        document.body.style.overflow = '';
      });
    });
  }

  /* --- FAQ accordion --------------------------------------- */
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');

      /* Close all others */
      document.querySelectorAll('.faq-item.open').forEach(open => {
        if (open !== item) {
          open.classList.remove('open');
          open.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
        }
      });

      item.classList.toggle('open', !isOpen);
      btn.setAttribute('aria-expanded', !isOpen);
    });

    /* Keyboard: Space/Enter already trigger click on <button>
       but ensure correct initial ARIA state */
    btn.setAttribute('aria-expanded', 'false');
  });

  /* Open FAQ item if URL hash matches */
  const hash = window.location.hash;
  if (hash) {
    const target = document.querySelector(hash);
    if (target && target.classList.contains('faq-item')) {
      target.classList.add('open');
      const q = target.querySelector('.faq-question');
      if (q) q.setAttribute('aria-expanded', 'true');
    }
  }

  /* --- Active nav link ------------------------------------- */
  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    const page = link.getAttribute('data-page');
    if (
      (page === 'home' && (currentPath === '' || currentPath.endsWith('index.html') || currentPath === '/')) ||
      (page !== 'home' && currentPath.includes(page))
    ) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });

  /* --- Smooth scroll for anchor links ---------------------- */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      const id = anchor.getAttribute('href').slice(1);
      const el = document.getElementById(id);
      if (el) {
        e.preventDefault();
        const offset = parseInt(getComputedStyle(document.documentElement)
          .getPropertyValue('--nav-height')) || 64;
        const top = el.getBoundingClientRect().top + window.scrollY - offset - 16;
        window.scrollTo({ top, behavior: 'smooth' });
        el.focus({ preventScroll: true });
      }
    });
  });

  /* --- Resource anchor tab navigation ---------------------- */
  document.querySelectorAll('.resource-tab-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const targetId = link.getAttribute('href').slice(1);
      const target = document.getElementById(targetId);
      if (target) {
        const navH = parseInt(getComputedStyle(document.documentElement)
          .getPropertyValue('--nav-height')) || 64;
        const top = target.getBoundingClientRect().top + window.scrollY - navH - 24;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  /* --- Unified Resources Search & Filter ------------------- */
  const searchInput = document.getElementById('resource-search');
  const filterBtns = document.querySelectorAll('.filter-btn');
  const resourceCards = document.querySelectorAll('.resource-card');
  const sections = document.querySelectorAll('.resource-section');

  if (searchInput || filterBtns.length > 0) {
    let activeFilter = 'all';
    let searchQuery = '';

    const filterResources = () => {
      resourceCards.forEach(card => {
        const title = card.querySelector('h3') ? card.querySelector('h3').innerText.toLowerCase() : '';
        const desc = card.querySelector('p') ? card.querySelector('p').innerText.toLowerCase() : '';
        const tags = Array.from(card.querySelectorAll('.tag')).map(tag => tag.innerText.toLowerCase());
        
        const cardText = `${title} ${desc} ${tags.join(' ')}`;
        
        // Search match
        const matchesSearch = cardText.includes(searchQuery);
        
        // Filter match
        let matchesFilter = activeFilter === 'all';
        if (!matchesFilter) {
          matchesFilter = tags.some(tag => {
            if (activeFilter === 'governance') return tag.includes('governance') || tag.includes('leadership');
            if (activeFilter === 'it') return tag.includes('it') || tag.includes('digital') || tag.includes('data');
            if (activeFilter === 'procurement') return tag.includes('procurement');
            if (activeFilter === 'tenant') return tag.includes('tenant') || tag.includes('ethics') || tag.includes('transparency');
            if (activeFilter === 'recording') return tag.includes('recording') || tag.includes('video');
            return tag.includes(activeFilter);
          });
        }

        if (matchesSearch && matchesFilter) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });

      // Collapse sections with no matching cards
      sections.forEach(section => {
        const cards = section.querySelectorAll('.resource-card');
        if (cards.length === 0) return; // Skip if it doesn't contain resource cards

        let hasVisibleCards = false;
        cards.forEach(c => {
          if (c.style.display !== 'none') {
            hasVisibleCards = true;
          }
        });

        if (hasVisibleCards) {
          section.style.display = '';
        } else {
          section.style.display = 'none';
        }
      });
    };

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        filterResources();
      });
    }

    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.getAttribute('data-filter');
        filterResources();
      });
    });
  }

  /* --- MailerLite Inline Form Submit handler (Iframe fallback) - */
  const mlForm = document.querySelector('.ml-block-form');
  const mlIframe = document.getElementById('ml-submit-iframe');
  
  if (mlForm && mlIframe) {
    mlForm.addEventListener('submit', function (e) {
      // Validate opt-in checkbox
      const optIn = document.getElementById('newsletter-opt-in-1');
      let errorLabel = mlForm.querySelector('.ml-error-message');
      
      if (!errorLabel) {
        errorLabel = document.createElement('div');
        errorLabel.classList.add('ml-error-message');
        errorLabel.style.color = 'var(--color-risk)';
        errorLabel.style.fontSize = 'var(--text-sm)';
        errorLabel.style.marginTop = 'var(--space-2)';
        mlForm.appendChild(errorLabel);
      }
      errorLabel.textContent = '';

      if (optIn && !optIn.checked) {
        e.preventDefault();
        errorLabel.textContent = 'Please opt in to receive updates.';
        return;
      }

      // Disable submit button during submission
      const submitBtn = mlForm.querySelector('button[type="submit"]');
      let originalHtml = '';
      if (submitBtn) {
        submitBtn.disabled = true;
        originalHtml = submitBtn.innerHTML;
        submitBtn.textContent = 'Subscribing...';
      }

      // Show success row after iframe loads response
      const handleIframeLoad = () => {
        const successRow = document.querySelector('.row-success');
        const formRow = document.querySelector('.row-form');
        
        if (formRow) formRow.style.display = 'none';
        if (successRow) successRow.style.display = 'block';
        
        // Re-enable button just in case
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalHtml;
        }
        
        mlIframe.removeEventListener('load', handleIframeLoad);
      };
      
      mlIframe.addEventListener('load', handleIframeLoad);
    });
  }

  /* --- Clickable Resource Card Tags ------------------------- */
  document.querySelectorAll('.resource-card .tag').forEach(tag => {
    tag.style.cursor = 'pointer';
    tag.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const tagText = tag.innerText.toLowerCase().trim();
      let matchedFilterBtn = null;

      if (filterBtns.length > 0) {
        filterBtns.forEach(btn => {
          const btnFilter = btn.getAttribute('data-filter').toLowerCase();
          if (tagText.includes(btnFilter) || btnFilter.includes(tagText)) {
            matchedFilterBtn = btn;
          }
        });
      }

      if (matchedFilterBtn) {
        matchedFilterBtn.click();
      } else {
        if (searchInput) {
          searchInput.value = tag.innerText;
          searchInput.dispatchEvent(new Event('input'));
        }
      }
    });
  });

  /* --- Interactive Checklists ------------------------------- */
  document.querySelectorAll('.checklist-item').forEach(item => {
    // Set accessibility attributes
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'checkbox');
    item.setAttribute('aria-checked', 'false');
    item.style.cursor = 'pointer';

    const toggleCheck = () => {
      const isChecked = item.classList.toggle('checked');
      item.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    };

    item.addEventListener('click', toggleCheck);

    // Keyboard support: Space/Enter toggles
    item.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault(); // Prevent scrolling on Space
        toggleCheck();
      }
    });
  });

})();
