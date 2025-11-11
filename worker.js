/**
 * ✨ Cloudflare Worker - Contact Form Handler ✨
 * 
 * Purpose: Secure contact form endpoint with Turnstile verification and Resend email
 * Endpoint: https://contact.taeyoon.kr/contact
 * 
 * Environment Variables Required:
 * - TURNSTILE_SECRET: Cloudflare Turnstile secret key
 * - RESEND_API_KEY: Resend API key for sending emails
 * - ALLOWED_ORIGIN: CORS allowed origin (default: https://taeyoon.kr)
 * - SECURITY_WEBHOOK_URL (optional): Endpoint to receive JSON-formatted security alerts
 * - DISCORD_WEBHOOK_URL (optional): Discord webhook for visitor notifications
 * - DISCORD_NOTIFY_EVENTS (optional): Comma-separated events to notify (default: enter,leave)
 * 
 * Features:
 * - Cloudflare Turnstile CAPTCHA verification
 * - Honeypot spam detection (website field)
 * - Minimum submission time protection
  * - HTTPS enforcement and hardened security headers
  * - IP-based rate limiting with webhook-ready logging
 * - HTML escaping for security
 * - CORS with specific origin
 * - JSON API responses
 */

// ===== Configuration =====
const CONFIG = {
  TURNSTILE_VERIFY_URL: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  RESEND_API_URL: 'https://api.resend.com/emails',
  MIN_SUBMISSION_TIME: 3000, // 3 seconds minimum
  EMAIL_FROM: 'Contact Form <noreply@taeyoon.kr>',
  EMAIL_TO: 'contact@taeyoon.kr',
  EMAIL_SUBJECT: '새로운 연락 메시지',
  RATE_LIMIT_MAX_REQUESTS: 3,
  RATE_LIMIT_WINDOW_MS: 60 * 1000,
  RATE_LIMIT_BLOCK_MS: 5 * 60 * 1000,
  MAX_PAYLOAD_SIZE_BYTES: 6 * 1024,
  // Enhanced security settings
  MAX_REQUEST_SIZE: 10 * 1024, // 10KB max request size
  SUSPICIOUS_PATTERN_LIMIT: 5, // Max suspicious requests before blocking
  BLOCK_DURATION_MS: 30 * 60 * 1000, // 30 minutes block
};

// IP allowlist for visitor dashboard access
// Allowed visitor IPs for dashboard access
const ALLOWED_VISITOR_IPS = [
  '211.177.232.118', // WiFi (IPv4)
  '118.235.5.139',   // Mobile data (IPv4)
  '2001:e60:914e:29d1:65a3:21d4:9aaa:ac64', // WiFi (IPv6)
  '127.0.0.1',       // Localhost (개발용 - 배포 전 제거)
];

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self';",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'X-XSS-Protection': '1; mode=block',
  'X-Permitted-Cross-Domain-Policies': 'none',
};

const rateLimitStore = new Map();
const suspiciousActivityStore = new Map();
const blockedIpsStore = new Map();
// Reputation and trusted IP stores
const ipReputationStore = new Map(); // { ip -> { score, trust, blockedCount, lastSeen, permanent } }
const trustedIpsStore = new Map(); // { ip -> { reason, addedAt, auto } }

// Suspicious patterns for detection
const SUSPICIOUS_PATTERNS = [
  /<script|javascript:|onerror|onload|onclick/i,
  /(\.\.|\/\/|\\\\)/,
  /union.*select|select.*from|insert.*into|drop.*table/i,
  /<\?php|<%|eval\(|exec\(/i,
  /\$\{|<%=|{{/,
];

// Reputation defaults
const REPUTATION = {
  DEFAULT_SCORE: 50,
  MAX_SCORE: 100,
  MIN_SCORE: 0,
  AUTO_TRUST_THRESHOLD: 85,
  AUTO_BLOCK_THRESHOLD: 20,
  TRUST_INCREMENT: 5,
  SUSPICION_PENALTY: 15,
};

/**
 * Adjust reputation score for an IP.
 */
function adjustReputation(ip, delta, env = null) {
  const now = Date.now();
  let cur = ipReputationStore.get(ip) || { score: REPUTATION.DEFAULT_SCORE, trust: 0, blockedCount: 0, lastSeen: now, permanent: false };
  cur.score = Math.max(REPUTATION.MIN_SCORE, Math.min(REPUTATION.MAX_SCORE, cur.score + delta));
  cur.lastSeen = now;
  ipReputationStore.set(ip, cur);
  // Auto-trust or auto-block actions
  if (cur.score >= REPUTATION.AUTO_TRUST_THRESHOLD) {
    // promote to trusted
    trustedIpsStore.set(ip, { reason: 'auto-trust', addedAt: now, auto: true });
  }
  if (cur.score <= REPUTATION.AUTO_BLOCK_THRESHOLD) {
    blockIp(ip, 'auto-reputation', CONFIG.BLOCK_DURATION_MS, env);
    cur.blockedCount = (cur.blockedCount || 0) + 1;
  }
}

function markTrustedIp(ip, reason = 'manual', auto = false) {
  trustedIpsStore.set(ip, { reason, addedAt: Date.now(), auto });
}

function unmarkTrustedIp(ip) {
  trustedIpsStore.delete(ip);
}

function getReputationSnapshot() {
  return Array.from(ipReputationStore.entries()).map(([ip, data]) => ({ ip, ...data }));
}

/**
 * Serve 404 page
 */
async function serve404Page(additionalHeaders = {}) {
  try {
    const notFoundResponse = await fetch('https://taeyoon.kr/404.html');
    if (notFoundResponse.ok) {
      return new Response(notFoundResponse.body, {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          ...additionalHeaders,
        },
      });
    }
  } catch (error) {
    console.error('Failed to fetch 404 page:', error);
  }
  
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...additionalHeaders,
    },
  });
}

// ===== Helper Functions =====

function getAllowedOrigins(env) {
  const rawOrigins = env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || 'https://taeyoon.kr';
  return rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * CORS headers for the allowed origin
 */
function getCorsHeaders(origin, env) {
  const allowedOrigins = getAllowedOrigins(env);
  const baseHeaders = {
    Vary: 'Origin',
  };
  
  if (origin && allowedOrigins.includes(origin)) {
    return {
      ...baseHeaders,
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
  }
  
  return baseHeaders;
}

function isRequestFromAllowedContext(origin, referer, allowedOrigins, workerOrigin) {
  const normalizedAllowed = new Set([...allowedOrigins, workerOrigin]);
  if (origin && normalizedAllowed.has(origin)) {
    return true;
  }

  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (normalizedAllowed.has(refererOrigin)) {
        return true;
      }
    } catch (error) {
      console.warn('Invalid referer URL received:', referer, error);
    }
  }

  return false;
}

/**
 * Create JSON response with CORS headers
 */
function getSecurityHeaders() {
  return { ...SECURITY_HEADERS };
}

function jsonResponse(data, status = 200, origin, env, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getSecurityHeaders(),
      ...getCorsHeaders(origin, env),
      ...extraHeaders,
    },
  });
}

function cleanupRateLimitStore(now) {
  for (const [ip, entry] of rateLimitStore.entries()) {
    const expiry = Math.max(entry.blockedUntil ?? 0, entry.firstAttempt + CONFIG.RATE_LIMIT_WINDOW_MS + CONFIG.RATE_LIMIT_BLOCK_MS);
    if (now > expiry) {
      rateLimitStore.delete(ip);
    }
  }
}

function applyRateLimit(ip, now = Date.now(), env = null) {
  if (!ip || ip === 'Unknown') {
    return { limited: false };
  }

  cleanupRateLimitStore(now);

  let entry = rateLimitStore.get(ip);

  if (!entry) {
    entry = {
      count: 1,
      firstAttempt: now,
      blockedUntil: null,
      lastSeen: now,
    };
    rateLimitStore.set(ip, entry);
    
    // Save to KV asynchronously
    if (env) {
      saveSecurityDataToKV(env).catch(err => 
        console.error('[KV SAVE] Failed after rate limit update:', err)
      );
    }
    
    return { limited: false };
  }

  entry.lastSeen = now;

  if (entry.blockedUntil && now < entry.blockedUntil) {
    return {
      limited: true,
      retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
    };
  }

  if (now - entry.firstAttempt > CONFIG.RATE_LIMIT_WINDOW_MS) {
    entry.count = 1;
    entry.firstAttempt = now;
    entry.blockedUntil = null;
    return { limited: false };
  }

  entry.count += 1;

  if (entry.count > CONFIG.RATE_LIMIT_MAX_REQUESTS) {
    entry.blockedUntil = now + CONFIG.RATE_LIMIT_BLOCK_MS;
    entry.count = 0;
    entry.firstAttempt = now;
    
    // Save to KV asynchronously when rate limited
    if (env) {
      saveSecurityDataToKV(env).catch(err => 
        console.error('[KV SAVE] Failed after rate limit block:', err)
      );
    }
    
    return {
      limited: true,
      retryAfter: Math.ceil(CONFIG.RATE_LIMIT_BLOCK_MS / 1000),
    };
  }
  // Penalize reputation slightly for hitting rate limits
  try { adjustReputation(ip, -Math.floor(REPUTATION.SUSPICION_PENALTY / 2), env); } catch (e) { /* ignore */ }

  return { limited: false };
}

/**
 * Check if IP is permanently blocked
 */
function isIpBlocked(ip, now = Date.now()) {
  const blocked = blockedIpsStore.get(ip);
  if (!blocked) return false;
  
  if (now > blocked.until) {
    blockedIpsStore.delete(ip);
    return false;
  }
  
  return true;
}

/**
 * Block an IP address
 */
function blockIp(ip, reason, duration = CONFIG.BLOCK_DURATION_MS, env = null) {
  const now = Date.now();
  blockedIpsStore.set(ip, {
    reason,
    blockedAt: now,
    until: now + duration,
  });

  // Save to KV asynchronously
  if (env) {
    saveSecurityDataToKV(env).catch(err => 
      console.error('[KV SAVE] Failed after blocking IP:', err)
    );
  }
}

/**
 * Track suspicious activity
 */
function trackSuspiciousActivity(ip, reason, env = null) {
  console.log('[TRACK_SUSPICIOUS] IP:', ip, 'Reason:', reason, 'Has env:', !!env);
  
  const now = Date.now();
  let record = suspiciousActivityStore.get(ip);
  
  if (!record) {
    record = { count: 0, incidents: [], firstSeen: now };
    suspiciousActivityStore.set(ip, record);
    console.log('[TRACK_SUSPICIOUS] Created new record for IP:', ip);
  }
  
  record.count += 1;
  record.incidents.push({ reason, timestamp: now });
  record.lastSeen = now;
  
  console.log('[TRACK_SUSPICIOUS] Updated record. Count:', record.count, 'Total stored IPs:', suspiciousActivityStore.size);
  
  // Keep only recent incidents (last hour)
  record.incidents = record.incidents.filter(
    inc => now - inc.timestamp < 60 * 60 * 1000
  );
  
  // Save to KV asynchronously
  if (env) {
    console.log('[TRACK_SUSPICIOUS] Saving to KV...');
    saveSecurityDataToKV(env).catch(err => 
      console.error('[KV SAVE] Failed after tracking suspicious activity:', err)
    );
  } else {
    console.warn('[TRACK_SUSPICIOUS] No env, cannot save to KV');
  }
  
  // Block if too many suspicious activities
  if (record.count >= CONFIG.SUSPICIOUS_PATTERN_LIMIT) {
    blockIp(ip, 'multiple_suspicious_activities', CONFIG.BLOCK_DURATION_MS, env);
    console.warn('[SECURITY] IP auto-blocked:', {
      ip,
      reason: 'multiple_suspicious_activities',
      totalIncidents: record.count,
      recentIncidents: record.incidents.length,
    });
    try { adjustReputation(ip, -REPUTATION.SUSPICION_PENALTY, env); } catch(e){ console.error(e); }
    return true;
  }
  
  return false;
}

/**
 * Detect suspicious patterns in request data
 */
function detectSuspiciousPatterns(data) {
  const dataStr = JSON.stringify(data).toLowerCase();
  
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(dataStr)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Validate email format strictly
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  // Strict email validation
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!emailRegex.test(email)) return false;
  if (email.length > 254) return false;
  
  const [localPart, domain] = email.split('@');
  if (localPart.length > 64) return false;
  
  return true;
}

async function logSecurityEvent(eventType, details, env) {
  const payload = {
    eventType,
    timestamp: new Date().toISOString(),
    ...details,
  };

  console.warn(`[Security] ${eventType}`, payload);

  if (env && env.SECURITY_WEBHOOK_URL) {
    try {
      await fetch(env.SECURITY_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error('Security webhook error:', error);
    }
  }
}

function scheduleSecurityLog(ctx, promise) {
  if (!promise) return;
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(promise);
  } else {
    promise.catch((error) => console.error('Security log error (no ctx):', error));
  }
}

/**
 * Send Discord notification for visitor events
 */
async function sendDiscordNotification(event, data, env) {
  if (!env.DISCORD_WEBHOOK_URL) return;
  
  const notifyEvents = (env.DISCORD_NOTIFY_EVENTS || 'enter,leave').split(',').map(e => e.trim());
  if (!notifyEvents.includes(event)) return;
  
  try {
    const emoji = {
      enter: '🚪',
      leave: '👋',
      ping: '💓',
    }[event] || '📊';
    
    const color = {
      enter: 0x22c55e,  // green
      leave: 0xef4444,  // red
      ping: 0xfbbf24,   // yellow
    }[event] || 0x3b82f6; // blue
    
    const title = {
      enter: '새 방문자',
      leave: '방문 종료',
      ping: '활동 중',
    }[event] || '이벤트';
    
    const fields = [
      { name: '🌍 국가', value: data.country || 'Unknown', inline: true },
      { name: '📱 기기', value: data.device || 'Unknown', inline: true },
      { name: '🔗 페이지', value: data.url ? `[링크](${data.url})` : 'Unknown', inline: false },
    ];
    
    if (data.duration) {
      const mins = Math.floor(data.duration / 60);
      const secs = data.duration % 60;
      fields.push({ name: '⏱️ 체류시간', value: `${mins}:${String(secs).padStart(2, '0')}`, inline: true });
    }
    
    if (data.performance?.pageLoadTime) {
      fields.push({ 
        name: '⚡ 로드 시간', 
        value: `${Math.round(data.performance.pageLoadTime)}ms`, 
        inline: true 
      });
    }
    
    const embed = {
      title: `${emoji} ${title}`,
      color: color,
      fields: fields,
      footer: {
        text: `Session: ${data.sessionId?.substring(0, 8) || 'Unknown'}`,
      },
      timestamp: new Date().toISOString(),
    };
    
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (error) {
    console.error('Discord webhook error:', error);
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Verify Cloudflare Turnstile token
 */
async function verifyTurnstile(token, ip, env, siteKey = null) {
  try {
    const payload = {
      secret: env.TURNSTILE_SECRET,
      response: token,
    };

    if (ip) {
      payload.remoteip = ip;
    }

    if (siteKey) {
      payload.sitekey = siteKey;
    }

    const response = await fetch(CONFIG.TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    return {
      success: data.success === true,
      errorCodes: data['error-codes'] || [],
      challengeTs: data.challenge_ts,
      hostname: data.hostname,
      action: data.action,
      cdata: data.cdata,
    };
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return {
      success: false,
      errorCodes: ['network-error'],
    };
  }
}

/**
 * Normalize IP address to handle IPv6-mapped IPv4 values
 */
function normalizeIp(ip) {
  if (!ip) return null;
  if (ip.includes(':')) {
    const ipv4Match = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (ipv4Match) {
      return ipv4Match[1];
    }
  }
  return ip;
}

function isAllowedVisitorIp(ip) {
  const normalized = normalizeIp(ip);
  return normalized ? ALLOWED_VISITOR_IPS.includes(normalized) : false;
}

/**
 * Get client information for security tracking
 */
function getClientInfo(request) {
  const headers = request.headers;
  const rawIp = headers.get('CF-Connecting-IP') || headers.get('X-Forwarded-For') || headers.get('X-Real-IP') || null;
  return {
    ip: normalizeIp(rawIp),
    country: headers.get('CF-IPCountry') || 'Unknown',
    userAgent: headers.get('User-Agent') || 'Unknown',
    referer: headers.get('Referer') || 'Direct',
    timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
  };
}

/**
 * Send email using Resend API with client information
 */
async function sendEmail(name, email, message, clientInfo, env) {
  try {
    const escapedName = escapeHtml(name);
    const escapedEmail = escapeHtml(email);
    const escapedMessage = escapeHtml(message);
    const escapedIP = escapeHtml(clientInfo.ip || 'Unknown');
    const escapedCountry = escapeHtml(clientInfo.country);
    const escapedUserAgent = escapeHtml(clientInfo.userAgent);
    const escapedReferer = escapeHtml(clientInfo.referer);
    const escapedTimestamp = escapeHtml(clientInfo.timestamp);
    
    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .field { margin-bottom: 20px; }
          .field-label { font-weight: bold; color: #555; margin-bottom: 5px; }
          .field-value { background: white; padding: 15px; border-radius: 5px; border-left: 4px solid #667eea; }
          .message-box { background: white; padding: 20px; border-radius: 5px; border: 1px solid #ddd; white-space: pre-wrap; word-wrap: break-word; }
          .footer { text-align: center; margin-top: 20px; color: #888; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📬 새로운 연락 메시지</h1>
          </div>
          <div class="content">
            <div class="field">
              <div class="field-label">👤 이름</div>
              <div class="field-value">${escapedName}</div>
            </div>
            <div class="field">
              <div class="field-label">📧 이메일</div>
              <div class="field-value"><a href="mailto:${escapedEmail}">${escapedEmail}</a></div>
            </div>
            <div class="field">
              <div class="field-label">💬 메시지</div>
              <div class="message-box">${escapedMessage}</div>
            </div>
            <div class="field">
              <div class="field-label">🔒 보안 정보</div>
              <div class="field-value">
                <strong>IP 주소:</strong> ${escapedIP}<br>
                <strong>국가:</strong> ${escapedCountry}<br>
                <strong>전송 시각:</strong> ${escapedTimestamp}
              </div>
            </div>
            <div class="field">
              <div class="field-label">🖥️ 기기 정보</div>
              <div class="field-value" style="word-break: break-all;">
                <strong>User Agent:</strong> ${escapedUserAgent}<br>
                <strong>Referer:</strong> ${escapedReferer}
              </div>
            </div>
            <div class="footer">
              <p>이 메시지는 taeyoon.kr 연락 폼에서 전송되었습니다.</p>
              <p style="color: #999; font-size: 11px;">스팸 방지: Cloudflare Turnstile 인증 완료</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const textBody = `
새로운 연락 메시지

이름: ${name}
이메일: ${email}

메시지:
${message}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 보안 정보
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IP 주소: ${clientInfo.ip || 'Unknown'}
국가: ${clientInfo.country}
전송 시각: ${clientInfo.timestamp}

🖥️ 기기 정보
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
User Agent: ${clientInfo.userAgent}
Referer: ${clientInfo.referer}

---
이 메시지는 taeyoon.kr 연락 폼에서 전송되었습니다.
스팸 방지: Cloudflare Turnstile 인증 완료
    `.trim();

    const response = await fetch(CONFIG.RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: CONFIG.EMAIL_FROM,
        to: CONFIG.EMAIL_TO,
        subject: CONFIG.EMAIL_SUBJECT,
        html: htmlBody,
        text: textBody,
        reply_to: email,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Resend API error:', errorData);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Email sending error:', error);
    return false;
  }
}

// ===== Visitor Tracking Functions =====

/**
 * Store visitor event in KV
 */
async function storeVisitorEvent(event, env) {
  if (!env.VISITOR_LOG) {
    console.warn('VISITOR_LOG KV namespace not bound');
    return false;
  }

  try {
    const key = `${Date.now()}-${crypto.randomUUID()}`;
    await env.VISITOR_LOG.put(key, JSON.stringify(event), {
      expirationTtl: 60 * 60 * 24 * 90, // 90 days
    });
    return true;
  } catch (error) {
    console.error('Failed to store visitor event:', error);
    return false;
  }
}

/**
 * Retrieve all visitor logs from KV
 */
async function getVisitorLogs(env, filters = {}) {
  if (!env.VISITOR_LOG) {
    return [];
  }

  try {
    const list = await env.VISITOR_LOG.list({ limit: 1000 });
    const keys = list.keys.map(k => k.name);
    
    const records = await Promise.all(
      keys.map(async (key) => {
        const value = await env.VISITOR_LOG.get(key);
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      })
    );

    let visitors = records.filter(r => r !== null);

    // Apply filters
    if (filters.country) {
      visitors = visitors.filter(v => v.country === filters.country);
    }
    if (filters.page) {
      visitors = visitors.filter(v => v.url === filters.page);
    }
    if (filters.date) {
      const targetDate = new Date(filters.date).toISOString().split('T')[0];
      visitors = visitors.filter(v => {
        const eventDate = new Date(v.time).toISOString().split('T')[0];
        return eventDate === targetDate;
      });
    }

    // Sort by time descending
    visitors.sort((a, b) => new Date(b.time) - new Date(a.time));

    return visitors;
  } catch (error) {
    console.error('Failed to retrieve visitor logs:', error);
    return [];
  }
}

/**
 * Calculate summary statistics
 */
function calculateSummary(visitors) {
  const enterEvents = visitors.filter(v => v.event === 'enter');
  const leaveEvents = visitors.filter(v => v.event === 'leave' && typeof v.duration === 'number');
  const uniqueSessions = new Set(visitors.map(v => v.sessionId)).size;
  
  const avgDuration = leaveEvents.length > 0
    ? leaveEvents.reduce((sum, v) => sum + v.duration, 0) / leaveEvents.length
    : 0;

  // Calculate average page load time from enter events with performance data
  const enterWithPerf = enterEvents.filter(v => v.performance && typeof v.performance.pageLoadTime === 'number');
  const avgLoadTime = enterWithPerf.length > 0
    ? enterWithPerf.reduce((sum, v) => sum + v.performance.pageLoadTime, 0) / enterWithPerf.length
    : 0;

  const countryMap = {};
  visitors.forEach(v => {
    if (v.country) {
      countryMap[v.country] = (countryMap[v.country] || 0) + 1;
    }
  });

  const topCountries = Object.entries(countryMap)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalVisitors: enterEvents.length,
    uniqueSessions,
    averageDuration: Math.round(avgDuration),
    averageLoadTime: Math.round(avgLoadTime),
    topCountries,
  };
}

/**
 * Evaluate visitor authentication and provide debugging details
 */
async function getVisitorAuthResult(request, env) {
  const clientInfo = getClientInfo(request);
  const normalizedIp = normalizeIp(clientInfo.ip);
  const isAllowed = isAllowedVisitorIp(normalizedIp);

  console.log('[AUTH DEBUG] Request IP:', clientInfo.ip || 'unknown');
  console.log('[AUTH DEBUG] Normalized IP:', normalizedIp || 'unknown');
  console.log('[AUTH DEBUG] VISITOR_ALLOWLIST_MATCH:', isAllowed);

  if (isAllowed) {
    return {
      authenticated: true,
      reason: 'ip_allowlisted',
      requestIp: normalizedIp || clientInfo.ip || null,
    };
  }

  return {
    authenticated: false,
    reason: 'ip_not_allowed',
    requestIp: normalizedIp || clientInfo.ip || null,
  };
}

/**
 * Handle /collect endpoint (beacon data ingestion)
 */
async function handleCollect(request, env, ctx) {
  const origin = request.headers.get('Origin');
  
  // CORS headers for /collect endpoint (no credentials)
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://taeyoon.kr',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, message: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }

  try {
    const body = await request.json();
    const { event, sessionId, device, url, referrer, time, duration, performance } = body;

    if (!event || !sessionId || !url || !time) {
      return new Response(JSON.stringify({ success: false, message: 'Missing required fields' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    const clientInfo = getClientInfo(request);
    
    const record = {
      event,
      sessionId,
      ip: clientInfo.ip || 'Unknown',
      country: clientInfo.country || 'Unknown',
      device: device || 'Unknown',
      url,
      referrer: referrer || null,
      ua: clientInfo.userAgent || 'Unknown',
      time,
      duration: typeof duration === 'number' ? duration : null,
    };

    // Add performance metrics if provided (only for 'enter' events)
    if (performance && typeof performance === 'object') {
      record.performance = {
        pageLoadTime: performance.pageLoadTime || null,
        domReadyTime: performance.domReadyTime || null,
        dnsTime: performance.dnsTime || null,
        tcpTime: performance.tcpTime || null,
        requestTime: performance.requestTime || null,
        renderTime: performance.renderTime || null,
      };
    }

    const stored = await storeVisitorEvent(record, env);

    if (!stored) {
      return new Response(JSON.stringify({ success: false, message: 'Storage failed' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    // Send Discord notification (non-blocking)
    ctx.waitUntil(sendDiscordNotification(event, record, env));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error('Collect endpoint error:', error);
    return new Response(JSON.stringify({ success: false, message: 'Server error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }
}

/**
 * Get security dashboard HTML
 */
function getSecurityDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>보안 모니터링 대시보드 | taeyoon.kr</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛡️</text></svg>">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 2rem; }
    .container { max-width: 1400px; margin: 0 auto; }
    .header { background: rgba(255,255,255,0.95); border-radius: 20px; padding: 2rem; margin-bottom: 2rem; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
    .header h1 { font-size: 2rem; color: #1f2933; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
    .header p { color: #52616b; font-size: 1rem; }
    .header-actions { margin-top: 1rem; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .stat-card { background: rgba(255,255,255,0.95); border-radius: 16px; padding: 1.5rem; box-shadow: 0 10px 30px rgba(0,0,0,0.2); transition: transform 0.2s; }
    .stat-card:hover { transform: translateY(-5px); }
    .stat-card .icon { font-size: 2.5rem; margin-bottom: 0.5rem; }
    .stat-card .label { color: #52616b; font-size: 0.9rem; margin-bottom: 0.5rem; }
    .stat-card .value { font-size: 2.5rem; font-weight: 700; color: #1f2933; }
    .section { background: rgba(255,255,255,0.95); border-radius: 20px; padding: 2rem; margin-bottom: 2rem; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
    .section h2 { font-size: 1.5rem; color: #1f2933; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem; }
    .table-wrapper { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    thead { background: #f8f9fb; }
    th { padding: 1rem; text-align: left; font-weight: 600; color: #1f2933; border-bottom: 2px solid #e4e7eb; }
    td { padding: 1rem; border-bottom: 1px solid #e4e7eb; color: #52616b; }
    tr:hover { background: #f8f9fb; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600; }
    .badge-danger { background: #fee; color: #c33; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-info { background: #d1ecf1; color: #0c5460; }
    .empty-state { text-align: center; padding: 3rem; color: #7c8a96; }
    .empty-state .icon { font-size: 4rem; margin-bottom: 1rem; opacity: 0.5; }
    .refresh-btn { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 12px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: transform 0.2s; box-shadow: 0 4px 15px rgba(102,126,234,0.4); }
    .refresh-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(102,126,234,0.6); }
    .refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .timestamp { font-size: 0.85rem; color: #7c8a96; }
    .timestamp-update { margin-left: 1rem; }
    .ip-address { font-family: 'Courier New', monospace; font-weight: 600; color: #667eea; }
    .loading { text-align: center; padding: 3rem; }
    .loading::after { content: '...'; animation: dots 1.5s steps(4,end) infinite; }
    @keyframes dots { 0%,20% { content: '.'; } 40% { content: '..'; } 60%,100% { content: '...'; } }
    @media (max-width: 768px) {
      body { padding: 1rem; }
      .header h1 { font-size: 1.5rem; }
      .stat-card .value { font-size: 2rem; }
      table { font-size: 0.9rem; }
      th, td { padding: 0.75rem 0.5rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ 보안 모니터링 대시보드</h1>
      <p>실시간 보안 위협 및 차단 현황을 확인하세요.</p>
      <div class="header-actions">
        <button id="refreshBtn" class="refresh-btn">🔄 새로고침</button>
        <button id="sendSummaryBtn" class="refresh-btn" style="margin-left:0.5rem;background:#10b981">📧 요약 전송</button>
        <span id="lastUpdate" class="timestamp timestamp-update"></span>
      </div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="icon">🚫</div><div class="label">차단된 IP</div><div class="value" id="blockedCount">0</div></div>
      <div class="stat-card"><div class="icon">⚠️</div><div class="label">의심스러운 활동</div><div class="value" id="suspiciousCount">0</div></div>
      <div class="stat-card"><div class="icon">🔄</div><div class="label">Rate Limit</div><div class="value" id="rateLimitCount">0</div></div>
    </div>
    <div class="section"><h2>🚫 차단된 IP 목록</h2><div id="blockedIpsContent" class="loading">데이터를 불러오는 중</div></div>
    <div class="section"><h2>⚠️ 의심스러운 활동</h2><div id="suspiciousActivitiesContent" class="loading">데이터를 불러오는 중</div></div>
    <div class="section"><h2>🔄 Rate Limit 현황</h2><div id="rateLimitsContent" class="loading">데이터를 불러오는 중</div></div>
  </div>
  <script>
    const API_URL='/visitor/security-stats';
    function formatDate(d){const t=new Date(d);return t.toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
    function formatDuration(ms){const m=Math.floor(ms/60000);const s=Math.floor((ms%60000)/1000);return m+'분 '+s+'초'}
    function renderBlockedIps(items){const c=document.getElementById('blockedIpsContent');if(!items||items.length===0){c.innerHTML='<div class="empty-state"><div class="icon">✅</div><p>현재 차단된 IP가 없습니다.</p></div>';return}c.innerHTML='<div class="table-wrapper"><table><thead><tr><th>IP 주소</th><th>차단 사유</th><th>차단 시각</th><th>해제 시각</th><th>남은 시간</th></tr></thead><tbody>'+items.map(i=>'<tr><td><span class="ip-address">'+i.ip+'</span></td><td><span class="badge badge-danger">'+i.reason+'</span></td><td class="timestamp">'+formatDate(i.blockedAt)+'</td><td class="timestamp">'+formatDate(i.until)+'</td><td>'+formatDuration(i.remainingMs)+'</td></tr>').join('')+'</tbody></table></div>'}
    function renderSuspiciousActivities(items){const c=document.getElementById('suspiciousActivitiesContent');if(!items||items.length===0){c.innerHTML='<div class="empty-state"><div class="icon">✅</div><p>의심스러운 활동이 감지되지 않았습니다.</p></div>';return}c.innerHTML='<div class="table-wrapper"><table><thead><tr><th>IP 주소</th><th>활동 횟수</th><th>첫 감지</th><th>최근 활동</th><th>최근 사유</th></tr></thead><tbody>'+items.map(i=>'<tr><td><span class="ip-address">'+i.ip+'</span></td><td><span class="badge badge-warning">'+i.count+'회</span></td><td class="timestamp">'+formatDate(i.firstSeen)+'</td><td class="timestamp">'+formatDate(i.lastSeen)+'</td><td>'+i.recentIncidents.slice(-3).map(inc=>'<span class="badge badge-info" style="margin:2px">'+inc.reason+'</span>').join('')+'</td></tr>').join('')+'</tbody></table></div>'}
    function renderRateLimits(items){const c=document.getElementById('rateLimitsContent');if(!items||items.length===0){c.innerHTML='<div class="empty-state"><div class="icon">✅</div><p>Rate Limit에 걸린 IP가 없습니다.</p></div>';return}c.innerHTML='<div class="table-wrapper"><table><thead><tr><th>IP 주소</th><th>요청 횟수</th><th>첫 요청</th><th>차단 상태</th></tr></thead><tbody>'+items.map(i=>'<tr><td><span class="ip-address">'+i.ip+'</span></td><td><span class="badge badge-warning">'+i.count+'회</span></td><td class="timestamp">'+formatDate(i.firstAttempt)+'</td><td>'+(i.blockedUntil?'<span class="badge badge-danger">차단됨 ('+formatDate(i.blockedUntil)+'까지)</span>':'<span class="badge badge-info">정상</span>')+'</td></tr>').join('')+'</tbody></table></div>'}
    async function loadSecurityStats(){const btn=document.getElementById('refreshBtn');btn.disabled=true;try{const r=await fetch(API_URL);const d=await r.json();document.getElementById('blockedCount').textContent=d.summary.totalBlockedIps;document.getElementById('suspiciousCount').textContent=d.summary.totalSuspiciousIps;document.getElementById('rateLimitCount').textContent=d.summary.totalRateLimitedIps;renderBlockedIps(d.blockedIps);renderSuspiciousActivities(d.suspiciousActivities);renderRateLimits(d.rateLimits);document.getElementById('lastUpdate').textContent='최근 업데이트: '+new Date().toLocaleTimeString('ko-KR')}catch(e){console.error('Failed to load:',e);alert('보안 통계를 불러오는데 실패했습니다.')}finally{btn.disabled=false}}
    loadSecurityStats();setInterval(loadSecurityStats,30000);document.getElementById('refreshBtn').addEventListener('click',loadSecurityStats);
    document.getElementById('sendSummaryBtn').addEventListener('click', async function(){
      const btn = this; btn.disabled = true; try{ const r = await fetch('/visitor/security-summary',{ method: 'POST', headers: { 'Content-Type':'application/json' } }); const j = await r.json(); alert(j.success ? '요약 이메일을 전송했습니다.' : '전송 실패: '+(j.message || 'unknown')); }catch(e){ alert('요약 전송 실패'); } finally { btn.disabled = false; }});
  </script>
</body>
</html>`;
}

/**
 * Load security data from KV storage
 */
async function loadSecurityDataFromKV(env) {
  try {
    const [blockedData, suspiciousData, rateLimitData, reputationData, trustedData] = await Promise.all([
      env.SECURITY_DATA.get('blocked_ips', { type: 'json' }),
      env.SECURITY_DATA.get('suspicious_activities', { type: 'json' }),
      env.SECURITY_DATA.get('rate_limits', { type: 'json' }),
      env.SECURITY_DATA.get('ip_reputation', { type: 'json' }),
      env.SECURITY_DATA.get('trusted_ips', { type: 'json' }),
    ]);

    // Restore blocked IPs
    if (blockedData && Array.isArray(blockedData)) {
      const now = Date.now();
      blockedData.forEach(({ ip, reason, blockedAt, until }) => {
        // Only restore if block hasn't expired
        if (until > now) {
          blockedIpsStore.set(ip, { reason, blockedAt, until });
        }
      });
    }

    // Restore suspicious activities
    if (suspiciousData && Array.isArray(suspiciousData)) {
      suspiciousData.forEach(({ ip, count, firstSeen, lastSeen, incidents }) => {
        suspiciousActivityStore.set(ip, { count, firstSeen, lastSeen, incidents });
      });
    }

    // Restore rate limits
    if (rateLimitData && Array.isArray(rateLimitData)) {
      const now = Date.now();
      rateLimitData.forEach(({ ip, count, firstAttempt, blockedUntil }) => {
        // Only restore if not expired
        const expiry = Math.max(
          blockedUntil || 0, 
          firstAttempt + CONFIG.RATE_LIMIT_WINDOW_MS + CONFIG.RATE_LIMIT_BLOCK_MS
        );
        if (now < expiry) {
          rateLimitStore.set(ip, { count, firstAttempt, blockedUntil });
        }
      });
    }

    console.log('[KV LOAD] Security data loaded successfully');
    // Restore reputation
    if (reputationData && Array.isArray(reputationData)) {
      reputationData.forEach(({ ip, score, trust, blockedCount, lastSeen, permanent }) => {
        ipReputationStore.set(ip, { score, trust, blockedCount, lastSeen, permanent });
      });
    }
    // Restore trusted IPs
    if (trustedData && Array.isArray(trustedData)) {
      trustedData.forEach(({ ip, reason, addedAt, auto }) => {
        trustedIpsStore.set(ip, { reason, addedAt, auto });
      });
    }
  } catch (error) {
    console.error('[KV LOAD] Failed to load security data:', error);
  }
}

/**
 * Save security data to KV storage
 */
async function saveSecurityDataToKV(env) {
  if (!env.SECURITY_DATA) {
    console.warn('[KV SAVE] SECURITY_DATA binding not available');
    return;
  }

  console.log('[KV SAVE] Starting save process...');

  try {
    const now = Date.now();

    // Prepare blocked IPs data
    const blockedData = Array.from(blockedIpsStore.entries())
      .filter(([_, data]) => data.until > now) // Only save non-expired blocks
      .map(([ip, data]) => ({ ip, ...data }));

    // Prepare suspicious activities data
    const suspiciousData = Array.from(suspiciousActivityStore.entries())
      .map(([ip, data]) => ({ ip, ...data }));

    // Prepare rate limits data
    const rateLimitData = Array.from(rateLimitStore.entries())
      .map(([ip, data]) => ({ ip, ...data }));

    // Save to KV with 7 days expiration
    const expirationTtl = 7 * 24 * 60 * 60; // 7 days in seconds

    await Promise.all([
      env.SECURITY_DATA.put('blocked_ips', JSON.stringify(blockedData), { expirationTtl }),
      env.SECURITY_DATA.put('suspicious_activities', JSON.stringify(suspiciousData), { expirationTtl }),
      env.SECURITY_DATA.put('rate_limits', JSON.stringify(rateLimitData), { expirationTtl }),
      env.SECURITY_DATA.put('ip_reputation', JSON.stringify(Array.from(ipReputationStore.entries()).map(([ip, d]) => ({ ip, ...d }))), { expirationTtl }),
      env.SECURITY_DATA.put('trusted_ips', JSON.stringify(Array.from(trustedIpsStore.entries()).map(([ip, d]) => ({ ip, ...d }))), { expirationTtl }),
    ]);

    console.log('[KV SAVE] Security data saved successfully', {
      blockedIps: blockedData.length,
      suspiciousActivities: suspiciousData.length,
      rateLimits: rateLimitData.length,
    });
  } catch (error) {
    console.error('[KV SAVE] Failed to save security data:', error);
  }
}

/**
 * Send security summary email via Resend (requires RESEND_API_KEY env)
 */
async function sendSecuritySummaryEmail(env, recipient = 'me@taeyoon.kr') {
  if (!env.RESEND_API_KEY) {
    console.warn('[EMAIL] RESEND_API_KEY not configured');
    return false;
  }
  const summary = buildSecuritySummary();
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  
  const body = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px; }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 10px 0 0; opacity: 0.9; font-size: 14px; }
    .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 30px; }
    .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; }
    .stat-card .label { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 5px; }
    .stat-card .value { font-size: 28px; font-weight: bold; color: #667eea; }
    .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .alert.danger { background: #f8d7da; border-color: #dc3545; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🛡️ 보안 모니터링 요약</h1>
    <p>${now}</p>
  </div>
  
  ${summary.totalBlockedIps > 0 ? `<div class="alert danger">⚠️ <strong>${summary.totalBlockedIps}개의 IP가 차단되었습니다!</strong></div>` : ''}
  
  <div class="stats">
    <div class="stat-card">
      <div class="label">차단된 IP</div>
      <div class="value">${summary.totalBlockedIps}</div>
    </div>
    <div class="stat-card">
      <div class="label">의심 활동</div>
      <div class="value">${summary.totalSuspiciousIps}</div>
    </div>
    <div class="stat-card">
      <div class="label">Rate Limit</div>
      <div class="value">${summary.totalRateLimitedIps}</div>
    </div>
    <div class="stat-card">
      <div class="label">화이트리스트</div>
      <div class="value">${summary.whitelistSize}</div>
    </div>
  </div>
  
  <div class="alert">
    <strong>최고 위험 점수:</strong> ${summary.highestRiskScore} / 100
  </div>
  
  <div class="footer">
    <p>이 이메일은 taeyoon.kr 보안 시스템에서 자동으로 발송되었습니다.</p>
    <p><a href="https://contact-form.still-firefly-1daa.workers.dev/visitor/security" style="color: #667eea;">보안 대시보드 보기</a></p>
  </div>
</body>
</html>`;

  try {
    const res = await fetch(CONFIG.RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: CONFIG.EMAIL_FROM,
        to: [recipient],
        subject: `🛡️ 보안 요약 리포트 - ${now}`,
        html: body,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error('[EMAIL] Failed to send security summary:', e);
    return false;
  }
}

function buildSecuritySummary() {
  const now = Date.now();
  const totalBlocked = Array.from(blockedIpsStore.values()).filter(d => d.until > now).length;
  const totalSuspicious = Array.from(suspiciousActivityStore.values()).reduce((s, v) => s + (v.count || 0), 0);
  const totalRateLimited = Array.from(rateLimitStore.values()).filter(r => r.blockedUntil && r.blockedUntil > now).length;
  const whitelistSize = trustedIpsStore.size;
  const highestRiskScore = Array.from(ipReputationStore.values()).reduce((mx, v) => Math.max(mx, v.score || 0), 0);
  return {
    totalBlockedIps: totalBlocked,
    totalSuspiciousIps: totalSuspicious,
    totalRateLimitedIps: totalRateLimited,
    whitelistSize,
    highestRiskScore,
    lastSummarySentAt: null,
  };
}

/**
 * Handle /api/visitors endpoint (data retrieval)
 */
async function handleApiVisitors(request, env) {
  const origin = request.headers.get('Origin');
  
  const authResult = await getVisitorAuthResult(request, env);

  if (!authResult.authenticated) {
    console.warn('[VISITOR API BLOCKED]', {
      origin: origin || 'none',
      requestIp: authResult.requestIp || 'unknown',
      reason: authResult.reason,
    });

    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const url = new URL(request.url);
  const filters = {
    country: url.searchParams.get('country') || '',
    page: url.searchParams.get('page') || '',
    date: url.searchParams.get('date') || '',
  };

  const visitors = await getVisitorLogs(env, filters);
  const summary = calculateSummary(visitors);

  return new Response(JSON.stringify({ visitors, summary }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

/**
 * Handle /visitor endpoint (IP-allowlisted dashboard)
 */
async function handleVisitor(request, env) {
  const url = new URL(request.url);
  const clientInfo = getClientInfo(request);
  const normalizedIp = normalizeIp(clientInfo.ip);

  // Debug endpoint to check current IP (accessible without authentication)
  if (request.method === 'GET' && url.pathname === '/visitor/check-ip') {
    return new Response(JSON.stringify({
      originalIp: clientInfo.ip || 'unknown',
      normalizedIp: normalizedIp || 'unknown',
      allowedIps: ALLOWED_VISITOR_IPS,
      isAllowed: isAllowedVisitorIp(normalizedIp),
      cfConnectingIp: request.headers.get('CF-Connecting-IP'),
      xForwardedFor: request.headers.get('X-Forwarded-For'),
      xRealIp: request.headers.get('X-Real-IP'),
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Debug endpoint to check KV bindings
  if (request.method === 'GET' && url.pathname === '/visitor/check-bindings') {
    return new Response(JSON.stringify({
      VISITOR_LOG: !!env.VISITOR_LOG,
      VISITOR_ANALYTICS_KV: !!env.VISITOR_ANALYTICS_KV,
      SECURITY_DATA: !!env.SECURITY_DATA,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Security dashboard HTML page (accessible without authentication)
  if (request.method === 'GET' && url.pathname === '/visitor/security') {
    return new Response(getSecurityDashboardHTML(), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  }

  // Manual trigger: send security summary email (protected by origin or allowlist)
  if (request.method === 'POST' && url.pathname === '/visitor/security-summary') {
    // Allow only same-origin or allowed visitor IPs
    const origin = request.headers.get('Origin');
    const clientIp = normalizeIp(clientInfo.ip);
    if (!(isAllowedVisitorIp(clientIp) || (origin && getAllowedOrigins(env).includes(origin)))) {
      return new Response(JSON.stringify({ success: false, message: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    // Load KV first
    if (env.SECURITY_DATA) await loadSecurityDataFromKV(env);
    const snapshot = {
      blockedIps: Array.from(blockedIpsStore.entries()).map(([ip, data]) => ({ ip, ...data })),
      suspiciousActivities: Array.from(suspiciousActivityStore.entries()).map(([ip, data]) => ({ ip, ...data })),
      rateLimits: Array.from(rateLimitStore.entries()).map(([ip, data]) => ({ ip, ...data })),
      reputation: getReputationSnapshot(),
      trustedIps: Array.from(trustedIpsStore.entries()).map(([ip, data]) => ({ ip, ...data })),
      summary: buildSecuritySummary(),
    };
    // Allow custom recipient via query parameter for testing
    const recipient = url.searchParams.get('to') || 'me@taeyoon.kr';
    const sent = await sendSecuritySummaryEmail(env, recipient);
    return new Response(JSON.stringify({ success: sent, snapshot, recipient }), { status: sent ? 200 : 500, headers: { 'Content-Type': 'application/json' } });
  }

  // Mark an IP as trusted (manual)
  if (request.method === 'POST' && url.pathname === '/visitor/trust-ip') {
    const body = await request.json().catch(() => ({}));
    if (!body || !body.ip) return new Response(JSON.stringify({ success: false, message: 'ip required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    markTrustedIp(body.ip, body.reason || 'manual', false);
    await saveSecurityDataToKV(env);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Remove trusted IP
  if (request.method === 'POST' && url.pathname === '/visitor/untrust-ip') {
    const body = await request.json().catch(() => ({}));
    if (!body || !body.ip) return new Response(JSON.stringify({ success: false, message: 'ip required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    unmarkTrustedIp(body.ip);
    await saveSecurityDataToKV(env);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Security stats endpoint (accessible without authentication for monitoring)
  if (request.method === 'GET' && url.pathname === '/visitor/security-stats') {
    // Load persisted data from KV first
    console.log('[SECURITY_STATS] SECURITY_DATA binding exists:', !!env.SECURITY_DATA);
    if (env.SECURITY_DATA) {
      console.log('[SECURITY_STATS] Loading data from KV...');
      await loadSecurityDataFromKV(env);
    } else {
      console.warn('[SECURITY_STATS] SECURITY_DATA binding not available');
    }

    const stats = {
      blockedIps: Array.from(blockedIpsStore.entries()).map(([ip, data]) => ({
        ip,
        reason: data.reason,
        blockedAt: new Date(data.blockedAt).toISOString(),
        until: new Date(data.until).toISOString(),
        remainingMs: Math.max(0, data.until - Date.now()),
      })),
      suspiciousActivities: Array.from(suspiciousActivityStore.entries()).map(([ip, data]) => ({
        ip,
        count: data.count,
        firstSeen: new Date(data.firstSeen).toISOString(),
        lastSeen: new Date(data.lastSeen).toISOString(),
        recentIncidents: data.incidents.slice(-10).map(inc => ({
          reason: inc.reason,
          timestamp: new Date(inc.timestamp).toISOString(),
        })),
      })),
      rateLimits: Array.from(rateLimitStore.entries()).map(([ip, data]) => ({
        ip,
        count: data.count,
        firstAttempt: new Date(data.firstAttempt).toISOString(),
        blockedUntil: data.blockedUntil ? new Date(data.blockedUntil).toISOString() : null,
      })),
      summary: buildSecuritySummary(),
      reputation: getReputationSnapshot(),
      trustedIps: Array.from(trustedIpsStore.entries()).map(([ip, data]) => ({ ip, ...data })),
    };

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  console.log('[VISITOR ACCESS ATTEMPT]', {
    originalIp: clientInfo.ip || 'unknown',
    normalizedIp: normalizedIp || 'unknown',
    allowedIps: ALLOWED_VISITOR_IPS,
    isAllowed: isAllowedVisitorIp(normalizedIp),
    path: url.pathname,
  });

  if (!isAllowedVisitorIp(normalizedIp)) {
    console.warn('[VISITOR BLOCKED]', {
      requestIp: clientInfo.ip || 'unknown',
      normalizedIp: normalizedIp || 'unknown',
      userAgent: clientInfo.userAgent || 'unknown',
      path: url.pathname,
      method: request.method,
    });
    
    // Serve custom 404 page with debug info in header
    return await serve404Page({
      'X-Debug-Your-IP': clientInfo.ip || 'unknown',
      'X-Debug-Normalized-IP': normalizedIp || 'unknown',
    });
  }

  // Handle IP management API
  if (request.method === 'POST' && url.pathname === '/visitor/manage-ips') {
    return handleIpManagement(request, env);
  }

  if (request.method === 'GET' && url.pathname === '/visitor/allowed-ips') {
    return new Response(JSON.stringify({ 
      success: true, 
      ips: ALLOWED_VISITOR_IPS 
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  }

  if (request.method === 'GET' && url.pathname === '/visitor') {
    try {
      const dashboardResponse = await fetch('https://taeyoon.kr/visitor.html');
      if (!dashboardResponse.ok) {
        return await serve404Page();
      }

      return new Response(dashboardResponse.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Allowed-Ip': normalizedIp || clientInfo.ip || 'unknown',
        },
      });
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
      return await serve404Page();
    }
  }

  // Return 404 page for any other unmatched routes
  return await serve404Page();
}

/**
 * Handle IP allowlist management
 */
async function handleIpManagement(request, env) {
  try {
    const body = await request.json();
    const { action, ip } = body;

    if (!action || !ip) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Missing action or ip' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate IP format (IPv4 or IPv6)
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){7}[0-9a-fA-F]{0,4}$/;
    
    if (!ipv4Regex.test(ip) && !ipv6Regex.test(ip)) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Invalid IP address format' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const normalizedIp = normalizeIp(ip);
    
    // Prevent removing your own IP
    const clientInfo = getClientInfo(request);
    const currentNormalizedIp = normalizeIp(clientInfo.ip);
    
    if (action === 'remove' && normalizedIp === currentNormalizedIp) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Cannot remove your own IP address' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    if (action === 'add') {
      if (ALLOWED_VISITOR_IPS.includes(normalizedIp)) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'IP already exists' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Limit total IPs
      if (ALLOWED_VISITOR_IPS.length >= 20) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Maximum number of allowed IPs reached (20)' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      ALLOWED_VISITOR_IPS.push(normalizedIp);
      
      console.log('[IP MANAGEMENT] IP added:', normalizedIp);
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'IP added successfully',
        ips: ALLOWED_VISITOR_IPS 
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    if (action === 'remove') {
      const index = ALLOWED_VISITOR_IPS.indexOf(normalizedIp);
      if (index === -1) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'IP not found' 
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      ALLOWED_VISITOR_IPS.splice(index, 1);
      
      console.log('[IP MANAGEMENT] IP removed:', normalizedIp);
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'IP removed successfully',
        ips: ALLOWED_VISITOR_IPS 
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ 
      success: false, 
      message: 'Invalid action' 
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('IP management error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      message: 'Server error' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ===== Main Handler =====

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const refererHeader = request.headers.get('Referer');
    const clientInfo = getClientInfo(request);
    const allowedOrigins = getAllowedOrigins(env);
    const workerOrigin = `${url.protocol}//${url.host}`;

    // Route visitor tracking endpoints
    if (url.pathname === '/collect') {
      return handleCollect(request, env, ctx);
    }
    if (url.pathname === '/api/visitors') {
      return handleApiVisitors(request, env);
    }
    // Handle /visitor routes (dashboard, IP management)
    if (url.pathname.startsWith('/visitor')) {
      return handleVisitor(request, env);
    }

    // Enforce HTTPS
    try {
      const visitorScheme = request.headers.get('CF-Visitor');
      if (visitorScheme) {
        const parsed = JSON.parse(visitorScheme);
        if (parsed && parsed.scheme === 'http') {
          const secureUrl = `https://${url.host}${url.pathname}${url.search}`;
          return new Response(null, {
            status: 301,
            headers: {
              Location: secureUrl,
              ...getSecurityHeaders(),
            },
          });
        }
      } else if (url.protocol === 'http:') {
        const secureUrl = `https://${url.host}${url.pathname}${url.search}`;
        return new Response(null, {
          status: 301,
          headers: {
            Location: secureUrl,
            ...getSecurityHeaders(),
          },
        });
      }
    } catch (error) {
      console.error('HTTPS enforcement error:', error);
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...getSecurityHeaders(),
          ...getCorsHeaders(origin, env),
        },
      });
    }

    // Only allow POST requests to /contact or root path
    const isValidPath = url.pathname === '/contact' || url.pathname === '/';
    
    if (request.method !== 'POST' || !isValidPath) {
      // Serve custom 404 page for invalid paths
      return await serve404Page(getSecurityHeaders());
    }

    const hasTrustedContext = isRequestFromAllowedContext(origin, refererHeader, allowedOrigins, workerOrigin);
    if (!hasTrustedContext) {
      scheduleSecurityLog(
        ctx,
        logSecurityEvent('origin_validation_failed', {
          ip: clientInfo.ip || 'Unknown',
          origin: origin || 'none',
          referer: refererHeader || 'none',
          path: url.pathname,
        }, env)
      );

      return jsonResponse(
        { success: false, message: '허용되지 않은 요청입니다.' },
        403,
        origin,
        env
      );
    }

    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      scheduleSecurityLog(
        ctx,
        logSecurityEvent('invalid_content_type', {
          ip: clientInfo.ip || 'Unknown',
          origin: origin || 'none',
          contentType,
        }, env)
      );

      return jsonResponse(
        { success: false, message: '지원하지 않는 콘텐츠 형식입니다.' },
        415,
        origin,
        env
      );
    }

    const contentLengthHeader = request.headers.get('Content-Length');
    if (contentLengthHeader && Number(contentLengthHeader) > CONFIG.MAX_PAYLOAD_SIZE_BYTES) {
      scheduleSecurityLog(
        ctx,
        logSecurityEvent('payload_too_large', {
          ip: clientInfo.ip || 'Unknown',
          origin: origin || 'none',
          contentLength: Number(contentLengthHeader),
        }, env)
      );

      return jsonResponse(
        { success: false, message: '전송 데이터가 너무 큽니다.' },
        413,
        origin,
        env
      );
    }

    // Rate limiting per IP
    const rateLimitStatus = applyRateLimit(clientInfo.ip, Date.now(), env);
    const logIP = clientInfo.ip || 'Unknown';
    
    // Check if IP is blocked
    if (isIpBlocked(logIP)) {
      scheduleSecurityLog(
        ctx,
        logSecurityEvent('ip_blocked', {
          ip: logIP,
          userAgent: clientInfo.userAgent,
          path: url.pathname,
        }, env)
      );

      return jsonResponse(
        { success: false, message: '접근이 차단되었습니다.' },
        403,
        origin,
        env
      );
    }
    
    if (rateLimitStatus.limited) {
      scheduleSecurityLog(
        ctx,
        logSecurityEvent('rate_limit', {
          ip: logIP,
          userAgent: clientInfo.userAgent,
          referer: clientInfo.referer,
          retryAfterSeconds: rateLimitStatus.retryAfter,
        }, env)
      );

      return jsonResponse(
        { success: false, message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        429,
        origin,
        env,
        rateLimitStatus.retryAfter
          ? { 'Retry-After': rateLimitStatus.retryAfter.toString() }
          : {}
      );
    }

    try {
      const rawBody = await request.clone().text();

      if (!rawBody || rawBody.length === 0) {
        scheduleSecurityLog(
          ctx,
          logSecurityEvent('empty_payload', {
            ip: logIP,
            origin: origin || 'none',
          }, env)
        );
        return jsonResponse(
          { success: false, message: '전송된 데이터가 없습니다.' },
          400,
          origin,
          env
        );
      }

      if (rawBody.length > CONFIG.MAX_PAYLOAD_SIZE_BYTES) {
        scheduleSecurityLog(
          ctx,
          logSecurityEvent('payload_too_large', {
            ip: logIP,
            origin: origin || 'none',
            payloadSize: rawBody.length,
          }, env)
        );
        return jsonResponse(
          { success: false, message: '전송 데이터가 너무 큽니다.' },
          413,
          origin,
          env
        );
      }

      let body;
      try {
        body = JSON.parse(rawBody);
      } catch (error) {
        trackSuspiciousActivity(logIP, 'malformed_json', env);
        scheduleSecurityLog(
          ctx,
          logSecurityEvent('malformed_json', {
            ip: logIP,
            origin: origin || 'none',
            error: error instanceof Error ? error.message : 'Unknown JSON parse error',
          }, env)
        );
        return jsonResponse(
          { success: false, message: '잘못된 데이터 형식입니다.' },
          400,
          origin,
          env
        );
      }

      // Detect suspicious patterns in request body
      if (detectSuspiciousPatterns(body)) {
        const blocked = trackSuspiciousActivity(logIP, 'suspicious_pattern_detected', env);
        scheduleSecurityLog(
          ctx,
          logSecurityEvent('suspicious_pattern', {
            ip: logIP,
            origin: origin || 'none',
            blocked,
          }, env)
        );
        
        return jsonResponse(
          { success: false, message: '잘못된 요청입니다.' },
          400,
          origin,
          env
        );
      }

      const { name, email, message, website, 'cf-turnstile-response': turnstileToken, t, siteKey } = body;

      // Validation: Required fields
      if (!name || !email || !message) {
        return jsonResponse(
          { success: false, message: '모든 필수 항목을 입력해주세요.' },
          400,
          origin,
          env
        );
      }

      // Strict email validation
      if (!isValidEmail(email)) {
        trackSuspiciousActivity(logIP, 'invalid_email_format', env);
        return jsonResponse(
          { success: false, message: '올바른 이메일 주소를 입력해주세요.' },
          400,
          origin,
          env
        );
      }

      // Validation: Name length
      if (name.length < 2 || name.length > 50) {
        return jsonResponse(
          { success: false, message: '이름은 2-50자 사이여야 합니다.' },
          400,
          origin,
          env
        );
      }

      // Additional name validation (no special characters except spaces, hyphens, apostrophes)
      if (!/^[a-zA-Z가-힣\s'\-]+$/.test(name)) {
        trackSuspiciousActivity(logIP, 'invalid_name_characters', env);
        return jsonResponse(
          { success: false, message: '이름에 허용되지 않은 문자가 포함되어 있습니다.' },
          400,
          origin,
          env
        );
      }

      // Validation: Message length
      if (message.length < 10 || message.length > 1000) {
        return jsonResponse(
          { success: false, message: '메시지는 10-1000자 사이여야 합니다.' },
          400,
          origin,
          env
        );
      }

      // Anti-spam: Honeypot check
      if (website) {
        console.warn('Honeypot triggered:', { name, email });
        trackSuspiciousActivity(logIP, 'honeypot_triggered', env);
        blockIp(logIP, 'honeypot_triggered', CONFIG.BLOCK_DURATION_MS, env);
        scheduleSecurityLog(
          ctx,
          logSecurityEvent('honeypot_triggered', {
            ip: logIP,
            email,
            name,
          }, env)
        );
        return jsonResponse(
          { success: false, message: '전송에 실패했습니다.' },
          400,
          origin,
          env
        );
      }

      // Anti-spam: Minimum submission time
      if (t) {
        const submissionTime = Date.now() - parseInt(t, 10);
        if (submissionTime < CONFIG.MIN_SUBMISSION_TIME) {
          console.warn('Too fast submission:', { name, email, submissionTime });
          trackSuspiciousActivity(logIP, 'suspicious_speed', env);
          scheduleSecurityLog(
            ctx,
            logSecurityEvent('suspicious_speed', {
              ip: logIP,
              email,
              name,
              submissionTime,
            }, env)
          );
          return jsonResponse(
            { success: false, message: '너무 빠른 제출입니다. 잠시 후 다시 시도해주세요.' },
            400,
            origin,
            env
          );
        }
      }

      // Verify Turnstile token
      if (!turnstileToken) {
        trackSuspiciousActivity(logIP, 'missing_turnstile_token', env);
        scheduleSecurityLog(
          ctx,
          logSecurityEvent('missing_turnstile_token', {
            ip: logIP,
            email,
            name,
          }, env)
        );
        return jsonResponse(
          { success: false, message: 'CAPTCHA 인증이 필요합니다.' },
          400,
          origin,
          env
        );
      }

      if (!env.TURNSTILE_SECRET) {
        console.error('TURNSTILE_SECRET is not configured in the Worker environment');
        scheduleSecurityLog(
          ctx,
          logSecurityEvent('missing_turnstile_secret', {
            ip: logIP,
            email,
            name,
          }, env)
        );

        return jsonResponse(
          {
            success: false,
            message: '서버 보안 설정 오류로 CAPTCHA를 검증할 수 없습니다. 관리자에게 문의해주세요.',
            errorCodes: ['missing-turnstile-secret'],
          },
          500,
          origin,
          env
        );
      }

      const turnstileResult = await verifyTurnstile(
        turnstileToken,
        clientInfo.ip,
        env,
        siteKey || (env.TURNSTILE_SITE_KEY || null)
      );

      if (!turnstileResult.success) {
        trackSuspiciousActivity(logIP, 'turnstile_failed', env);
        scheduleSecurityLog(
          ctx,
      logSecurityEvent('turnstile_failed', {
        ip: logIP,
            email,
            name,
            errorCodes: turnstileResult.errorCodes,
            hostname: turnstileResult.hostname,
          }, env)
        );
        return jsonResponse(
          {
            success: false,
            message: 'CAPTCHA 인증에 실패했습니다.',
            errorCodes: turnstileResult.errorCodes,
            hostname: turnstileResult.hostname,
          },
          400,
          origin,
          env
        );
      }

      // Send email with client information
      const emailSent = await sendEmail(name, email, message, clientInfo, env);

      if (!emailSent) {
        scheduleSecurityLog(
          ctx,
          logSecurityEvent('email_dispatch_failed', {
            ip: logIP,
            email,
            name,
          }, env)
        );
        return jsonResponse(
          { success: false, message: '이메일 전송에 실패했습니다. 잠시 후 다시 시도해주세요.' },
          500,
          origin,
          env
        );
      }

      // Success response
      return jsonResponse(
        { success: true, message: '메시지가 성공적으로 전송되었습니다!' },
        200,
        origin,
        env
      );

    } catch (error) {
      console.error('Request handling error:', error);
      scheduleSecurityLog(
        ctx,
        logSecurityEvent('server_error', {
          ip: logIP,
          error: error instanceof Error ? error.message : 'Unknown error',
        }, env)
      );
      return jsonResponse(
        { success: false, message: '서버 오류가 발생했습니다.' },
        500,
        origin,
        env
      );
    }
  },
};
