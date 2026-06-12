/* ============================================================
   HAILIE — main.js
   Interactive components: nav, FAQ accordion, scroll behaviour
   ============================================================ */

(function () {
  'use strict';

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

})();
