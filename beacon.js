(function () {
  const COLLECT_ENDPOINT = 'https://contact.taeyoon.kr/collect';
  const SESSION_STORAGE_KEY = 'ty_visitor_session_id';
  const SESSION_STARTED_AT = Date.now();
  const PING_INTERVAL_MS = 15_000;
  const MAX_PINGS = 240; // roughly one hour

  let pingCount = 0;
  let leaveSent = false;
  const sessionId = ensureSessionId();
  const deviceType = detectDeviceType();

  if (!shouldTrack()) {
    return;
  }

  sendEvent('enter');

  const pingTimer = window.setInterval(() => {
    pingCount += 1;
    if (pingCount > MAX_PINGS) {
      window.clearInterval(pingTimer);
      return;
    }
    sendEvent('ping');
  }, PING_INTERVAL_MS);

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      sendLeaveEvent();
    }
  });

  window.addEventListener('beforeunload', sendLeaveEvent);
  window.addEventListener('pagehide', sendLeaveEvent);

  function shouldTrack() {
    if (!navigator.sendBeacon && !window.fetch) {
      return false;
    }
    const origin = window.location.origin;
    return /^https:\/\/.*taeyoon\.kr$/i.test(origin);
  }

  function ensureSessionId() {
    try {
      const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (existing) return existing;
      const fresh = crypto.randomUUID();
      window.localStorage.setItem(SESSION_STORAGE_KEY, fresh);
      return fresh;
    } catch (_) {
      return crypto.randomUUID();
    }
  }

  function detectDeviceType() {
    const ua = navigator.userAgent || '';
    if (/tablet|ipad|playbook|silk/i.test(ua)) return 'Tablet';
    if (/mobile|iphone|ipod|android/i.test(ua)) return 'Mobile';
    return 'Desktop';
  }

  function buildPayload(event, extra) {
    const now = new Date();
    const payload = {
      event,
      sessionId,
      device: extra.device || deviceType,
      url: window.location.href,
      referrer: document.referrer || null,
      time: now.toISOString(),
    };
    if (typeof extra.duration === 'number') {
      payload.duration = extra.duration;
    }
    return payload;
  }

  function sendEvent(event, extra = {}) {
    const payload = buildPayload(event, extra);
    const body = JSON.stringify(payload);

    // Use fetch with keepalive instead of sendBeacon to control credentials
    if (typeof fetch === 'function') {
      fetch(COLLECT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
      }).catch(() => {
        // network errors are ignored for analytics
      });
    }
  }

  function sendLeaveEvent() {
    if (leaveSent) return;
    leaveSent = true;
    window.clearInterval(pingTimer);
    const durationSeconds = Math.max(1, Math.round((Date.now() - SESSION_STARTED_AT) / 1000));
    sendEvent('leave', { duration: durationSeconds });
  }
})();
