/*
 * Google Analytics 4, gated behind opt-in consent.
 *
 * Why a self-hosted file rather than the inline gtag snippet Google gives you:
 * the site runs a strict Content-Security-Policy with no 'unsafe-inline', so an
 * inline <script> would be refused. This file is same-origin ('self'), and it
 * is the only thing that injects gtag.js — and only after the visitor accepts.
 *
 * Consent Mode v2: everything is DENIED by default, before gtag ever loads, so
 * no analytics cookie is written and no hit is sent until the person clicks
 * Accept. Decline is remembered too, so the banner is asked once, not forever.
 *
 * Runs on the production hostnames only. On preview (*.workers.dev) and local
 * dev it does nothing, so test traffic never reaches the real property.
 */
(function () {
  'use strict';

  var GA_ID = 'G-Z25JZX5ZPV';
  var CONSENT_KEY = 'petpomo.consent.v1';
  var HOSTS = ['www.pomodoropet.com', 'pomodoropet.com'];

  if (HOSTS.indexOf(location.hostname) === -1) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  // Deny everything up front. This must run before gtag.js loads.
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500,
  });

  var gaLoaded = false;
  function loadGA() {
    if (gaLoaded) return;
    gaLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GA_ID);
  }

  function readConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (e) {
      return null;
    }
  }
  function saveConsent(v) {
    try {
      localStorage.setItem(CONSENT_KEY, v);
    } catch (e) {
      /* private mode — the choice just won't persist */
    }
  }

  function accept() {
    saveConsent('granted');
    gtag('consent', 'update', { analytics_storage: 'granted' });
    loadGA();
  }
  function decline() {
    saveConsent('denied');
    // Consent stays denied; nothing loads.
  }

  function showBanner() {
    var bar = document.createElement('div');
    bar.className = 'pp-consent';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Analytics consent');
    bar.setAttribute('aria-live', 'polite');

    // Structure only — no inline scripts, so CSP is happy. Buttons get their
    // handlers below via addEventListener, never inline onclick.
    bar.innerHTML =
      '<p class="pp-consent-text">PetPomo would like to count visits with Google Analytics to see which pages help. ' +
      'It sets cookies only if you accept. See our <a href="/privacy">privacy policy</a> and ' +
      '<a href="/cookies">cookie notice</a>.</p>' +
      '<div class="pp-consent-actions">' +
      '<button type="button" class="pp-btn pp-consent-decline">Decline</button>' +
      '<button type="button" class="pp-btn pp-btn-primary pp-consent-accept">Accept</button>' +
      '</div>';

    function close() {
      bar.remove();
    }
    bar.querySelector('.pp-consent-accept').addEventListener('click', function () {
      accept();
      close();
    });
    bar.querySelector('.pp-consent-decline').addEventListener('click', function () {
      decline();
      close();
    });

    document.body.appendChild(bar);
  }

  var choice = readConsent();
  if (choice === 'granted') {
    // Returning visitor who already accepted — restore consent and load.
    gtag('consent', 'update', { analytics_storage: 'granted' });
    loadGA();
  } else if (choice === 'denied') {
    // Respect the earlier decline; do nothing.
  } else if (document.body) {
    showBanner();
  } else {
    document.addEventListener('DOMContentLoaded', showBanner);
  }
})();
