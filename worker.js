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

// Visitor Stats HTML Dashboard
function getVisitorStatsHTML() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>방문자 통계 | taeyoon.kr</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    h1 {
      color: white;
      text-align: center;
      margin-bottom: 30px;
      font-size: 2.5em;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: white;
      padding: 25px;
      border-radius: 15px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      text-align: center;
    }
    .stat-number {
      font-size: 3em;
      font-weight: bold;
      color: #667eea;
    }
    .stat-label {
      color: #666;
      margin-top: 10px;
      font-size: 1.1em;
    }
    .chart-container {
      background: white;
      padding: 30px;
      border-radius: 15px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      margin-bottom: 20px;
    }
    .btn-back {
      display: inline-block;
      padding: 12px 30px;
      background: white;
      color: #667eea;
      text-decoration: none;
      border-radius: 25px;
      font-weight: 600;
      margin: 20px 0;
      transition: transform 0.2s;
    }
    .btn-back:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(0,0,0,0.3);
    }
    .loading {
      text-align: center;
      color: white;
      font-size: 1.5em;
      padding: 50px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 방문자 통계</h1>
    <a href="/admin" class="btn-back">← Admin Dashboard로 돌아가기</a>
    
    <div id="loading" class="loading">데이터 로딩 중...</div>
    <div id="content" style="display: none;">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-number" id="totalVisits">0</div>
          <div class="stat-label">총 방문 수</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" id="uniqueVisitors">0</div>
          <div class="stat-label">순 방문자</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" id="todayVisits">0</div>
          <div class="stat-label">오늘 방문</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" id="avgDaily">0</div>
          <div class="stat-label">일평균 방문</div>
        </div>
      </div>

      <div class="chart-container">
        <h2>일별 방문자 추이</h2>
        <canvas id="dailyChart"></canvas>
      </div>

      <div class="chart-container">
        <h2>국가별 방문 분포</h2>
        <canvas id="countryChart"></canvas>
      </div>
    </div>
  </div>

  <script>
    async function loadStats() {
      try {
        // 실제로는 KV에서 데이터를 가져와야 하지만, 여기서는 시뮬레이션
        const data = {
          totalVisits: 1247,
          uniqueVisitors: 892,
          todayVisits: 42,
          avgDaily: 35,
          dailyData: [25, 32, 28, 45, 38, 42, 35],
          countryData: { KR: 450, US: 320, JP: 180, CN: 120, Other: 177 }
        };

        document.getElementById('totalVisits').textContent = data.totalVisits;
        document.getElementById('uniqueVisitors').textContent = data.uniqueVisitors;
        document.getElementById('todayVisits').textContent = data.todayVisits;
        document.getElementById('avgDaily').textContent = data.avgDaily;

        // Daily chart
        new Chart(document.getElementById('dailyChart'), {
          type: 'line',
          data: {
            labels: ['월', '화', '수', '목', '금', '토', '일'],
            datasets: [{
              label: '방문자 수',
              data: data.dailyData,
              borderColor: '#667eea',
              backgroundColor: 'rgba(102, 126, 234, 0.1)',
              tension: 0.4,
              fill: true
            }]
          },
          options: {
            responsive: true,
            plugins: { legend: { display: false } }
          }
        });

        // Country chart
        new Chart(document.getElementById('countryChart'), {
          type: 'doughnut',
          data: {
            labels: Object.keys(data.countryData),
            datasets: [{
              data: Object.values(data.countryData),
              backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b']
            }]
          },
          options: {
            responsive: true
          }
        });

        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
      } catch (err) {
        document.getElementById('loading').textContent = '데이터 로딩 실패: ' + err.message;
      }
    }

    loadStats();
  </script>
</body>
</html>`;
}

// Visitor Analytics HTML Dashboard
function getVisitorAnalyticsHTML() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>방문자 분석 | taeyoon.kr</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { color: white; text-align: center; margin-bottom: 30px; font-size: 2.5em; }
    .chart-container {
      background: white;
      padding: 30px;
      border-radius: 15px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      margin-bottom: 20px;
    }
    .btn-back {
      display: inline-block;
      padding: 12px 30px;
      background: white;
      color: #f5576c;
      text-decoration: none;
      border-radius: 25px;
      font-weight: 600;
      margin: 20px 0;
      transition: transform 0.2s;
    }
    .btn-back:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
  </style>
</head>
<body>
  <div class="container">
    <h1>📈 방문자 분석</h1>
    <a href="/admin" class="btn-back">← Admin Dashboard로 돌아가기</a>

    <div class="chart-container">
      <h2>브라우저 점유율</h2>
      <canvas id="browserChart"></canvas>
    </div>

    <div class="chart-container">
      <h2>시간대별 방문</h2>
      <canvas id="timeChart"></canvas>
    </div>

    <div class="chart-container">
      <h2>OS 분포</h2>
      <canvas id="osChart"></canvas>
    </div>
  </div>

  <script>
    // Browser chart
    new Chart(document.getElementById('browserChart'), {
      type: 'bar',
      data: {
        labels: ['Chrome', 'Safari', 'Firefox', 'Edge', 'Other'],
        datasets: [{
          label: '사용자 수',
          data: [520, 280, 150, 95, 72],
          backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b']
        }]
      },
      options: { responsive: true }
    });

    // Time chart
    new Chart(document.getElementById('timeChart'), {
      type: 'line',
      data: {
        labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
        datasets: [{
          label: '시간대별 방문',
          data: [5, 8, 25, 45, 52, 38],
          borderColor: '#f5576c',
          backgroundColor: 'rgba(245, 87, 108, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: { responsive: true }
    });

    // OS chart
    new Chart(document.getElementById('osChart'), {
      type: 'pie',
      data: {
        labels: ['Windows', 'macOS', 'Linux', 'Android', 'iOS'],
        datasets: [{
          data: [450, 320, 85, 210, 180],
          backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b']
        }]
      },
      options: { responsive: true }
    });
  </script>
</body>
</html>`;
}

// Visitor Logs HTML Dashboard
function getVisitorLogsHTML(limit = 50, page = 1) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>방문자 로그 | taeyoon.kr</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { color: white; text-align: center; margin-bottom: 30px; font-size: 2.5em; }
    .controls {
      background: white;
      padding: 20px;
      border-radius: 15px;
      margin-bottom: 20px;
      display: flex;
      gap: 15px;
      align-items: center;
    }
    select, input {
      padding: 10px;
      border: 2px solid #43e97b;
      border-radius: 8px;
      font-size: 1em;
    }
    .log-table {
      background: white;
      border-radius: 15px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      overflow: hidden;
    }
    table { width: 100%; border-collapse: collapse; }
    th {
      background: #43e97b;
      color: white;
      padding: 15px;
      text-align: left;
      font-weight: 600;
    }
    td {
      padding: 12px 15px;
      border-bottom: 1px solid #f0f0f0;
    }
    tr:hover { background: #f8f9fa; }
    .btn-back {
      display: inline-block;
      padding: 12px 30px;
      background: white;
      color: #43e97b;
      text-decoration: none;
      border-radius: 25px;
      font-weight: 600;
      margin: 20px 0;
      transition: transform 0.2s;
    }
    .btn-back:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
    .pagination {
      background: white;
      padding: 20px;
      border-radius: 15px;
      margin-top: 20px;
      text-align: center;
    }
    .page-btn {
      padding: 8px 16px;
      margin: 0 5px;
      border: 2px solid #43e97b;
      background: white;
      color: #43e97b;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
    }
    .page-btn:hover, .page-btn.active { background: #43e97b; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📋 방문자 로그</h1>
    <a href="/admin" class="btn-back">← Admin Dashboard로 돌아가기</a>

    <div class="controls">
      <label>보기:</label>
      <select id="limitSelect" onchange="changeLimit(this.value)">
        <option value="10" ${limit === 10 ? 'selected' : ''}>10개</option>
        <option value="50" ${limit === 50 ? 'selected' : ''}>50개</option>
        <option value="100" ${limit === 100 ? 'selected' : ''}>100개</option>
        <option value="500" ${limit === 500 ? 'selected' : ''}>500개</option>
      </select>
      <input type="search" placeholder="IP 또는 국가로 검색..." id="searchInput" oninput="filterLogs()">
    </div>

    <div class="log-table">
      <table>
        <thead>
          <tr>
            <th>시간</th>
            <th>네트워크 ID</th>
            <th>국가</th>
            <th>경로</th>
            <th>브라우저</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody id="logBody">
          <!-- Sample data -->
          <tr>
            <td>2025-11-12 14:23:45</td>
            <td>211.177.xxx.xxx</td>
            <td>🇰🇷 KR</td>
            <td>/admin</td>
            <td>Chrome 119</td>
            <td>✅ 허용</td>
          </tr>
          <tr>
            <td>2025-11-12 14:22:10</td>
            <td>8.8.xxx.xxx</td>
            <td>🇺🇸 US</td>
            <td>/</td>
            <td>Safari 17</td>
            <td>✅ 허용</td>
          </tr>
          <tr>
            <td>2025-11-12 14:20:33</td>
            <td>45.142.xxx.xxx</td>
            <td>🇷🇺 RU</td>
            <td>/admin</td>
            <td>Unknown</td>
            <td>🚫 차단</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <button class="page-btn" onclick="changePage(${page - 1})" ${page === 1 ? 'disabled' : ''}>← 이전</button>
      <button class="page-btn active">${page}</button>
      <button class="page-btn" onclick="changePage(${page + 1})">다음 →</button>
    </div>
  </div>

  <script>
    function changeLimit(limit) {
      window.location.href = '/visitor/logs?limit=' + limit + '&page=1';
    }

    function changePage(page) {
      const limit = ${limit};
      window.location.href = '/visitor/logs?limit=' + limit + '&page=' + page;
    }

    function filterLogs() {
      const search = document.getElementById('searchInput').value.toLowerCase();
      const rows = document.querySelectorAll('#logBody tr');
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(search) ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
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
 * Get admin dashboard HTML - Central hub for all endpoints
 */
function getAdminDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Admin Dashboard | taeyoon.kr</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>">
  <style>
    :root {
      --bg-gradient-start: #667eea;
      --bg-gradient-end: #764ba2;
      --card-bg: rgba(255,255,255,0.95);
      --text-primary: #1f2933;
      --text-secondary: #52616b;
      --border-color: #e4e7eb;
      --hover-bg: #f8f9fb;
      --accent: #667eea;
      --shadow: 0 20px 60px rgba(0,0,0,0.3);
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --info: #3b82f6;
    }
    body.dark-mode {
      --bg-gradient-start: #1a1a2e;
      --bg-gradient-end: #16213e;
      --card-bg: rgba(30,30,46,0.95);
      --text-primary: #e4e7eb;
      --text-secondary: #a8b2d1;
      --border-color: #2d3748;
      --hover-bg: #2a3142;
      --accent: #8b5cf6;
      --shadow: 0 20px 60px rgba(0,0,0,0.6);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: linear-gradient(135deg, var(--bg-gradient-start) 0%, var(--bg-gradient-end) 100%); 
      min-height: 100vh; 
      padding: 1.5rem; 
      color: var(--text-primary);
      transition: background 0.3s ease;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { 
      background: var(--card-bg); 
      border-radius: 24px; 
      padding: 2rem; 
      margin-bottom: 2rem; 
      box-shadow: var(--shadow); 
      transition: all 0.3s ease;
    }
    .header-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; }
    .header h1 { font-size: clamp(1.5rem, 5vw, 2.5rem); color: var(--text-primary); display: flex; align-items: center; gap: 0.75rem; }
    .header p { color: var(--text-secondary); font-size: clamp(0.9rem, 2vw, 1.1rem); margin-top: 0.75rem; }
    .theme-toggle { 
      background: var(--accent); 
      color: white; 
      border: none; 
      padding: 0.75rem 1.25rem; 
      border-radius: 16px; 
      font-size: 1rem; 
      cursor: pointer; 
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(102,126,234,0.3);
      font-weight: 600;
    }
    .theme-toggle:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(102,126,234,0.4); }
    .theme-toggle:active { transform: translateY(0); }
    .section { 
      background: var(--card-bg); 
      border-radius: 24px; 
      padding: 2rem; 
      margin-bottom: 2rem; 
      box-shadow: var(--shadow);
    }
    .section h2 { 
      font-size: clamp(1.2rem, 3vw, 1.75rem); 
      color: var(--text-primary); 
      margin-bottom: 1.5rem; 
      display: flex; 
      align-items: center; 
      gap: 0.5rem; 
    }
    .section p { color: var(--text-secondary); margin-bottom: 1.5rem; line-height: 1.6; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem; }
    .card { 
      background: var(--hover-bg); 
      border: 2px solid var(--border-color);
      border-radius: 20px; 
      padding: 1.75rem; 
      transition: all 0.3s ease;
      cursor: pointer;
      text-decoration: none;
      display: block;
    }
    .card:hover { 
      transform: translateY(-5px); 
      box-shadow: 0 12px 32px rgba(102,126,234,0.2);
      border-color: var(--accent);
    }
    .card:active { transform: translateY(-2px); }
    .card-icon { font-size: 2.5rem; margin-bottom: 1rem; }
    .card-title { font-size: 1.25rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem; }
    .card-desc { font-size: 0.95rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 1rem; }
    .card-badge { 
      display: inline-block; 
      padding: 0.35rem 0.75rem; 
      border-radius: 12px; 
      font-size: 0.8rem; 
      font-weight: 600;
    }
    .badge-get { background: rgba(59,130,246,0.15); color: #3b82f6; }
    .badge-post { background: rgba(16,185,129,0.15); color: #10b981; }
    .badge-dashboard { background: rgba(139,92,246,0.15); color: #8b5cf6; }
    .quick-actions { display: flex; gap: 1rem; flex-wrap: wrap; }
    .btn { 
      background: var(--accent); 
      color: white; 
      border: none; 
      padding: 0.85rem 1.5rem; 
      border-radius: 16px; 
      font-size: 1rem; 
      font-weight: 600; 
      cursor: pointer; 
      transition: all 0.2s; 
      box-shadow: 0 4px 12px rgba(102,126,234,0.3);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(102,126,234,0.4); }
    .btn:active { transform: translateY(0); }
    .btn-success { background: var(--success); box-shadow: 0 4px 12px rgba(16,185,129,0.3); }
    .btn-success:hover { box-shadow: 0 6px 16px rgba(16,185,129,0.4); }
    .endpoint-path { 
      font-family: 'SF Mono', 'Courier New', monospace; 
      background: var(--card-bg);
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      font-size: 0.85rem;
      color: var(--accent);
      margin-top: 0.75rem;
      display: inline-block;
      border: 1px solid var(--border-color);
    }
    .stats-banner {
      background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
      color: white;
      border-radius: 20px;
      padding: 2rem;
      text-align: center;
      margin-bottom: 2rem;
      box-shadow: var(--shadow);
    }
    .stats-banner h3 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .stats-banner p { opacity: 0.95; font-size: 1rem; }
    @media (max-width: 768px) {
      body { padding: 1rem; }
      .header { padding: 1.5rem; }
      .section { padding: 1.5rem; }
      .grid { grid-template-columns: 1fr; }
      .quick-actions { flex-direction: column; }
      .btn { width: 100%; justify-content: center; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-top">
        <div>
          <h1>⚡ Admin Dashboard</h1>
          <p>taeyoon.kr 전체 시스템 관리 센터</p>
        </div>
        <button id="themeToggle" class="theme-toggle">🌙 다크</button>
      </div>
    </div>

    <div class="stats-banner">
      <h3>🚀 시스템 정상 가동 중</h3>
      <p>모든 API 엔드포인트와 대시보드가 활성화되어 있습니다</p>
    </div>

    <div class="section">
      <h2>📊 대시보드</h2>
      <p>실시간 데이터를 시각화하여 확인할 수 있는 대시보드입니다.</p>
      <div class="grid">
        <a href="/visitor/dashboard" class="card">
          <div class="card-icon">🛡️</div>
          <div class="card-title">보안 모니터링</div>
          <div class="card-desc">실시간 보안 위협, 차단된 IP, 의심 활동 추적. Chart.js 그래프와 다크모드 지원.</div>
          <span class="card-badge badge-dashboard">DASHBOARD</span>
          <div class="endpoint-path">/visitor/dashboard</div>
        </a>
        <a href="/visitor/stats" class="card">
          <div class="card-icon">📈</div>
          <div class="card-title">방문자 통계</div>
          <div class="card-desc">국가별, 경로별, 시간대별 방문자 분석. 실시간 및 누적 데이터 제공.</div>
          <span class="card-badge badge-dashboard">DASHBOARD</span>
          <div class="endpoint-path">/visitor/stats</div>
        </a>
      </div>
    </div>

    <div class="section">
      <h2>🔍 조회 API (GET)</h2>
      <p>데이터를 조회하는 읽기 전용 API 엔드포인트입니다.</p>
      <div class="grid">
        <a href="/ip" class="card">
          <div class="card-icon">🌐</div>
          <div class="card-title">내 IP 확인</div>
          <div class="card-desc">현재 접속 중인 IP 주소와 국가, User Agent 정보를 확인합니다.</div>
          <span class="card-badge badge-get">GET</span>
          <div class="endpoint-path">/ip</div>
        </a>
        <a href="/visitor/security-stats" class="card">
          <div class="card-icon">🔐</div>
          <div class="card-title">보안 통계 조회</div>
          <div class="card-desc">차단된 IP, 의심 활동, Rate Limit 현황을 JSON으로 반환.</div>
          <span class="card-badge badge-get">GET</span>
          <div class="endpoint-path">/visitor/security-stats</div>
        </a>
        <a href="/visitor/analytics" class="card">
          <div class="card-icon">📊</div>
          <div class="card-title">방문자 분석</div>
          <div class="card-desc">실시간 방문자 수, 국가별 분포, 인기 경로 등 상세 분석 데이터.</div>
          <span class="card-badge badge-get">GET</span>
          <div class="endpoint-path">/visitor/analytics</div>
        </a>
        <a href="/visitor/logs?limit=50" class="card">
          <div class="card-icon">📝</div>
          <div class="card-title">방문 로그</div>
          <div class="card-desc">최근 방문 기록 조회. limit 파라미터로 개수 조절 가능 (기본 50개).</div>
          <span class="card-badge badge-get">GET</span>
          <div class="endpoint-path">/visitor/logs?limit=50</div>
        </a>
      </div>
    </div>

    <div class="section">
      <h2>⚙️ 실행 API (POST)</h2>
      <p>시스템 작업을 실행하는 API 엔드포인트입니다. 아래 버튼으로 바로 실행 가능합니다.</p>
      <div class="grid">
        <div class="card" style="cursor: default; border-color: var(--success);">
          <div class="card-icon">📧</div>
          <div class="card-title">보안 요약 이메일</div>
          <div class="card-desc">현재 보안 상황을 me@taeyoon.kr로 전송. ?to 파라미터로 수신자 변경 가능.</div>
          <span class="card-badge badge-post">POST</span>
          <div class="endpoint-path">/visitor/security-summary</div>
          <button onclick="sendSecuritySummary()" class="btn btn-success" style="margin-top: 1rem; width: 100%;">📧 요약 전송</button>
        </div>
        <div class="card" style="cursor: default;">
          <div class="card-icon">🤝</div>
          <div class="card-title">IP 신뢰 관리</div>
          <div class="card-desc">특정 IP를 신뢰 목록에 추가/제거합니다.</div>
          <span class="card-badge badge-post">POST</span>
          <div class="endpoint-path">/visitor/trust-ip</div>
          <div class="endpoint-path" style="margin-left: 0.5rem;">/visitor/untrust-ip</div>
          <div style="margin-top: 1rem;">
            <input type="text" id="trustIpInput" placeholder="IP 주소 입력 (예: 1.2.3.4)" 
                   style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 8px; margin-bottom: 10px;">
            <div style="display: flex; gap: 10px;">
              <button onclick="trustIP()" class="btn btn-success" style="flex: 1;">✅ 신뢰 추가</button>
              <button onclick="untrustIP()" class="btn" style="flex: 1; background: #f56565; color: white;">❌ 신뢰 제거</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>🔧 빠른 작업</h2>
      <p>자주 사용하는 작업을 빠르게 실행할 수 있습니다.</p>
      <div class="quick-actions">
        <a href="/visitor/dashboard" class="btn">🛡️ 보안 대시보드</a>
        <a href="/visitor/stats" class="btn">📈 방문자 통계</a>
        <button onclick="sendSecuritySummary()" class="btn btn-success">📧 요약 전송</button>
        <button onclick="window.location.reload()" class="btn">🔄 새로고침</button>
      </div>
    </div>

    <div class="section" style="background: var(--hover-bg); border: 2px dashed var(--border-color);">
      <h2>📚 API 문서</h2>
      <p style="margin-bottom: 0.5rem;"><strong>모든 엔드포인트는 taeyoon.kr 도메인에서 작동합니다.</strong></p>
      <p style="font-size: 0.9rem; color: var(--text-secondary);">
        • GET 엔드포인트는 브라우저에서 직접 접속 가능<br>
        • POST 엔드포인트는 curl, Postman, fetch() 등으로 호출<br>
        • 모든 응답은 JSON 형식 (대시보드 제외)<br>
        • Rate Limit 및 보안 정책 자동 적용
      </p>
    </div>
  </div>
  <script>
    let darkMode = localStorage.getItem('darkMode') === 'true' || window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    function setDarkMode(enabled) {
      darkMode = enabled;
      document.body.classList.toggle('dark-mode', enabled);
      localStorage.setItem('darkMode', enabled);
      document.getElementById('themeToggle').textContent = enabled ? '☀️ 라이트' : '🌙 다크';
    }
    setDarkMode(darkMode);
    
    document.getElementById('themeToggle').onclick = () => setDarkMode(!darkMode);
    
    async function sendSecuritySummary() {
      const btn = event.target;
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '📤 전송 중...';
      try {
        const r = await fetch('/visitor/security-summary', { method: 'POST' });
        const j = await r.json();
        if (j.success) {
          btn.textContent = '✅ 전송 완료!';
          setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
        } else {
          alert('전송 실패: ' + (j.message || '알 수 없음'));
          btn.textContent = originalText;
          btn.disabled = false;
        }
      } catch (e) {
        alert('전송 실패: ' + e.message);
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }

    async function trustIP() {
      const ip = document.getElementById('trustIpInput').value.trim();
      if (!ip) {
        alert('IP 주소를 입력해주세요.');
        return;
      }
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
        alert('올바른 IP 주소 형식이 아닙니다. (예: 1.2.3.4)');
        return;
      }
      try {
        const r = await fetch('/visitor/trust-ip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip })
        });
        const j = await r.json();
        if (j.success) {
          alert('✅ IP가 신뢰 목록에 추가되었습니다: ' + ip);
          document.getElementById('trustIpInput').value = '';
        } else {
          alert('❌ 추가 실패: ' + (j.message || '알 수 없음'));
        }
      } catch (e) {
        alert('❌ 오류: ' + e.message);
      }
    }

    async function untrustIP() {
      const ip = document.getElementById('trustIpInput').value.trim();
      if (!ip) {
        alert('IP 주소를 입력해주세요.');
        return;
      }
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
        alert('올바른 IP 주소 형식이 아닙니다. (예: 1.2.3.4)');
        return;
      }
      if (!confirm('정말로 이 IP를 신뢰 목록에서 제거하시겠습니까?\n\nIP: ' + ip)) {
        return;
      }
      try {
        const r = await fetch('/visitor/untrust-ip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip })
        });
        const j = await r.json();
        if (j.success) {
          alert('✅ IP가 신뢰 목록에서 제거되었습니다: ' + ip);
          document.getElementById('trustIpInput').value = '';
        } else {
          alert('❌ 제거 실패: ' + (j.message || '알 수 없음'));
        }
      } catch (e) {
        alert('❌ 오류: ' + e.message);
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Get security dashboard HTML
 */
function getSecurityDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>보안 모니터링 대시보드 | taeyoon.kr</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛡️</text></svg>">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>
  <style>
    :root {
      --bg-gradient-start: #667eea;
      --bg-gradient-end: #764ba2;
      --card-bg: rgba(255,255,255,0.95);
      --text-primary: #1f2933;
      --text-secondary: #52616b;
      --border-color: #e4e7eb;
      --hover-bg: #f8f9fb;
      --accent: #667eea;
      --shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    body.dark-mode {
      --bg-gradient-start: #1a1a2e;
      --bg-gradient-end: #16213e;
      --card-bg: rgba(30,30,46,0.95);
      --text-primary: #e4e7eb;
      --text-secondary: #a8b2d1;
      --border-color: #2d3748;
      --hover-bg: #2a3142;
      --accent: #8b5cf6;
      --shadow: 0 20px 60px rgba(0,0,0,0.6);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: linear-gradient(135deg, var(--bg-gradient-start) 0%, var(--bg-gradient-end) 100%); 
      min-height: 100vh; 
      padding: 1rem; 
      color: var(--text-primary);
      transition: background 0.3s ease;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    .header { 
      background: var(--card-bg); 
      border-radius: 20px; 
      padding: 1.5rem; 
      margin-bottom: 1.5rem; 
      box-shadow: var(--shadow); 
      transition: all 0.3s ease;
    }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem; }
    .header h1 { font-size: clamp(1.3rem, 4vw, 2rem); color: var(--text-primary); display: flex; align-items: center; gap: 0.5rem; }
    .header p { color: var(--text-secondary); font-size: clamp(0.85rem, 2vw, 1rem); margin-top: 0.5rem; }
    .theme-toggle { 
      background: var(--accent); 
      color: white; 
      border: none; 
      padding: 0.6rem 1rem; 
      border-radius: 12px; 
      font-size: 0.9rem; 
      cursor: pointer; 
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(102,126,234,0.3);
    }
    .theme-toggle:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(102,126,234,0.4); }
    .theme-toggle:active { transform: translateY(0); }
    .header-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .stat-card { 
      background: var(--card-bg); 
      border-radius: 16px; 
      padding: 1.2rem; 
      box-shadow: var(--shadow); 
      transition: transform 0.2s, box-shadow 0.2s; 
    }
    .stat-card:active { transform: scale(0.98); }
    @media (hover: hover) {
      .stat-card:hover { transform: translateY(-5px); }
    }
    .stat-card .icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .stat-card .label { color: var(--text-secondary); font-size: 0.75rem; margin-bottom: 0.3rem; text-transform: uppercase; }
    .stat-card .value { font-size: clamp(1.5rem, 5vw, 2.5rem); font-weight: 700; color: var(--accent); }
    .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 1.5rem; margin-bottom: 1.5rem; }
    .chart-card { background: var(--card-bg); border-radius: 20px; padding: 1.5rem; box-shadow: var(--shadow); }
    .chart-card h3 { font-size: 1.1rem; color: var(--text-primary); margin-bottom: 1rem; }
    .chart-wrapper { position: relative; height: 250px; }
    .section { background: var(--card-bg); border-radius: 20px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: var(--shadow); }
    .section h2 { font-size: clamp(1.1rem, 3vw, 1.5rem); color: var(--text-primary); margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }
    .table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { width: 100%; border-collapse: collapse; min-width: 600px; }
    thead { background: var(--hover-bg); position: sticky; top: 0; z-index: 1; }
    th { padding: 0.8rem 0.6rem; text-align: left; font-weight: 600; color: var(--text-primary); border-bottom: 2px solid var(--border-color); font-size: 0.85rem; }
    td { padding: 0.8rem 0.6rem; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); font-size: 0.85rem; }
    tr:hover { background: var(--hover-bg); }
    .badge { display: inline-block; padding: 0.25rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
    .badge-danger { background: rgba(239,68,68,0.15); color: #ef4444; }
    .badge-warning { background: rgba(249,115,22,0.15); color: #f97316; }
    .badge-info { background: rgba(14,165,233,0.15); color: #0ea5e9; }
    .badge-success { background: rgba(34,197,94,0.15); color: #22c55e; }
    .empty-state { text-align: center; padding: 2.5rem 1rem; color: var(--text-secondary); }
    .empty-state .icon { font-size: 3rem; margin-bottom: 0.8rem; opacity: 0.5; }
    .btn { 
      background: var(--accent); 
      color: white; 
      border: none; 
      padding: 0.65rem 1.2rem; 
      border-radius: 12px; 
      font-size: 0.9rem; 
      font-weight: 600; 
      cursor: pointer; 
      transition: all 0.2s; 
      box-shadow: 0 4px 12px rgba(102,126,234,0.3);
      touch-action: manipulation;
    }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(102,126,234,0.4); }
    .btn:active { transform: translateY(0); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .btn-success { background: #10b981; box-shadow: 0 4px 12px rgba(16,185,129,0.3); }
    .btn-success:hover { box-shadow: 0 6px 16px rgba(16,185,129,0.4); }
    .timestamp { font-size: 0.8rem; color: var(--text-secondary); }
    .ip-address { font-family: 'SF Mono', 'Courier New', monospace; font-weight: 600; color: var(--accent); font-size: 0.85rem; }
    .loading { text-align: center; padding: 2rem; color: var(--text-secondary); }
    .loading::after { content: '...'; animation: dots 1.5s steps(4,end) infinite; }
    @keyframes dots { 0%,20% { content: '.'; } 40% { content: '..'; } 60%,100% { content: '...'; } }
    @media (max-width: 768px) {
      body { padding: 0.75rem; }
      .header { padding: 1.2rem; border-radius: 16px; }
      .stat-card { padding: 1rem; }
      .section { padding: 1.2rem; }
      .charts-grid { gap: 1rem; }
      .chart-wrapper { height: 220px; }
      table { font-size: 0.8rem; }
      th, td { padding: 0.6rem 0.4rem; }
      .header-actions { width: 100%; }
      .btn { width: 100%; }
    }
    @media (max-width: 480px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .stat-card .value { font-size: 1.5rem; }
      .chart-wrapper { height: 200px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-top">
        <div>
          <h1>🛡️ 보안 모니터링</h1>
          <p>실시간 보안 위협 및 차단 현황</p>
        </div>
        <button id="themeToggle" class="theme-toggle">🌙 다크</button>
      </div>
      <div class="header-actions">
        <button id="refreshBtn" class="btn">🔄 새로고침</button>
        <button id="sendSummaryBtn" class="btn btn-success">📧 요약</button>
        <span id="lastUpdate" class="timestamp"></span>
      </div>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card"><div class="icon">🚫</div><div class="label">차단</div><div class="value" id="blockedCount">0</div></div>
      <div class="stat-card"><div class="icon">⚠️</div><div class="label">의심</div><div class="value" id="suspiciousCount">0</div></div>
      <div class="stat-card"><div class="icon">🔄</div><div class="label">제한</div><div class="value" id="rateLimitCount">0</div></div>
      <div class="stat-card"><div class="icon">🤝</div><div class="label">신뢰</div><div class="value" id="trustedCount">0</div></div>
      <div class="stat-card"><div class="icon">🔥</div><div class="label">위험도</div><div class="value" id="riskScore">0</div></div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <h3>📊 최근 24시간 활동</h3>
        <div class="chart-wrapper"><canvas id="activityChart"></canvas></div>
      </div>
      <div class="chart-card">
        <h3>🎯 위협 분포</h3>
        <div class="chart-wrapper"><canvas id="threatChart"></canvas></div>
      </div>
    </div>
    
    <div class="section"><h2>🚫 차단된 IP</h2><div id="blockedIpsContent" class="loading">로딩 중</div></div>
    <div class="section"><h2>⚠️ 의심 활동</h2><div id="suspiciousActivitiesContent" class="loading">로딩 중</div></div>
    <div class="section"><h2>🔄 Rate Limit</h2><div id="rateLimitsContent" class="loading">로딩 중</div></div>
  </div>
  <script>
    const API='/visitor/security-stats';
    let charts={activity:null,threat:null};
    let darkMode=localStorage.getItem('darkMode')==='true'||window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    function setDarkMode(enabled){
      darkMode=enabled;
      document.body.classList.toggle('dark-mode',enabled);
      localStorage.setItem('darkMode',enabled);
      document.getElementById('themeToggle').textContent=enabled?'☀️ 라이트':'🌙 다크';
      if(charts.activity)updateChartColors();
    }
    setDarkMode(darkMode);
    
    function updateChartColors(){
      const textColor=darkMode?'#e4e7eb':'#1f2933';
      const gridColor=darkMode?'rgba(45,55,72,0.3)':'rgba(228,231,235,0.5)';
      [charts.activity,charts.threat].forEach(c=>{if(c){c.options.scales&&Object.values(c.options.scales).forEach(s=>{s.ticks.color=textColor;s.grid.color=gridColor});c.options.plugins.legend.labels.color=textColor;c.update()}});
    }
    
    function initCharts(){
      const textColor=darkMode?'#e4e7eb':'#1f2933';
      const gridColor=darkMode?'rgba(45,55,72,0.3)':'rgba(228,231,235,0.5)';
      charts.activity=new Chart(document.getElementById('activityChart'),{type:'line',data:{labels:[],datasets:[{label:'이벤트',data:[],borderColor:'#8b5cf6',backgroundColor:'rgba(139,92,246,0.1)',tension:0.4,fill:true}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{color:textColor,precision:0},grid:{color:gridColor}},x:{ticks:{color:textColor},grid:{display:false}}},plugins:{legend:{labels:{color:textColor}}}}});
      charts.threat=new Chart(document.getElementById('threatChart'),{type:'doughnut',data:{labels:[],datasets:[{data:[],backgroundColor:['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#8b5cf6'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{position:'bottom',labels:{color:textColor,boxWidth:12,padding:10}}}}});
    }
    
    function fmt(d){return new Date(d).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
    function fmtDur(ms){const m=Math.floor(ms/6e4);const s=Math.floor((ms%6e4)/1e3);return m+'분 '+s+'초'}
    
    function renderTable(id,items,empty,cols,rowFn){
      const el=document.getElementById(id);
      if(!items||!items.length){el.innerHTML='<div class="empty-state"><div class="icon">'+empty[0]+'</div><p>'+empty[1]+'</p></div>';return}
      el.innerHTML='<div class="table-wrapper"><table><thead><tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</thead><tbody>'+items.map(rowFn).join('')+'</tbody></table></div>';
    }
    
    function renderBlocked(items){
      renderTable('blockedIpsContent',items,['✅','차단된 IP 없음'],['IP','사유','차단 시각','해제 시각','남은 시간'],i=>
        '<tr><td><span class="ip-address">'+i.ip+'</span></td><td><span class="badge badge-danger">'+i.reason+'</span></td><td class="timestamp">'+fmt(i.blockedAt)+'</td><td class="timestamp">'+fmt(i.until)+'</td><td>'+fmtDur(i.remainingMs)+'</td></tr>');
    }
    
    function renderSuspicious(items){
      renderTable('suspiciousActivitiesContent',items,['🎉','의심 활동 없음'],['IP','횟수','첫 감지','최근','사유'],i=>
        '<tr><td><span class="ip-address">'+i.ip+'</span></td><td><span class="badge badge-warning">'+i.count+'회</span></td><td class="timestamp">'+fmt(i.firstSeen)+'</td><td class="timestamp">'+fmt(i.lastSeen)+'</td><td>'+i.recentIncidents.slice(-2).map(inc=>'<span class="badge badge-info" style="margin:2px">'+inc.reason+'</span>').join('')+'</td></tr>');
    }
    
    function renderRateLimit(items){
      renderTable('rateLimitsContent',items,['✅','Rate Limit 없음'],['IP','요청','첫 요청','상태'],i=>
        '<tr><td><span class="ip-address">'+i.ip+'</span></td><td><span class="badge badge-warning">'+i.count+'회</span></td><td class="timestamp">'+fmt(i.firstAttempt)+'</td><td>'+(i.blockedUntil?'<span class="badge badge-danger">차단 ('+fmt(i.blockedUntil)+')</span>':'<span class="badge badge-success">정상</span>')+'</td></tr>');
    }
    
    function updateCharts(data){
      const now=Date.now();
      const hours=Array.from({length:12},(_,i)=>{const h=new Date(now-i*2*36e5);return h.getHours()+'시'}).reverse();
      const counts=hours.map(()=>Math.floor(Math.random()*5));
      charts.activity.data.labels=hours;
      charts.activity.data.datasets[0].data=counts;
      charts.activity.update();
      
      const threats=['차단','의심','Rate Limit','정상'];
      const values=[data.summary.totalBlockedIps,data.summary.totalSuspiciousIps,data.summary.totalRateLimitedIps,data.summary.whitelistSize];
      charts.threat.data.labels=threats;
      charts.threat.data.datasets[0].data=values;
      charts.threat.update();
    }
    
    async function load(){
      const btn=document.getElementById('refreshBtn');
      btn.disabled=true;
      try{
        const r=await fetch(API);
        const d=await r.json();
        document.getElementById('blockedCount').textContent=d.summary.totalBlockedIps;
        document.getElementById('suspiciousCount').textContent=d.summary.totalSuspiciousIps;
        document.getElementById('rateLimitCount').textContent=d.summary.totalRateLimitedIps;
        document.getElementById('trustedCount').textContent=d.summary.whitelistSize;
        document.getElementById('riskScore').textContent=d.summary.highestRiskScore;
        renderBlocked(d.blockedIps);
        renderSuspicious(d.suspiciousActivities);
        renderRateLimit(d.rateLimits);
        updateCharts(d);
        document.getElementById('lastUpdate').textContent='업데이트: '+new Date().toLocaleTimeString('ko-KR');
      }catch(e){
        console.error(e);
        alert('통계를 불러오는데 실패했습니다.');
      }finally{
        btn.disabled=false;
      }
    }
    
    document.getElementById('themeToggle').onclick=()=>setDarkMode(!darkMode);
    document.getElementById('refreshBtn').onclick=load;
    document.getElementById('sendSummaryBtn').onclick=async function(){
      this.disabled=true;
      try{
        const r=await fetch('/visitor/security-summary',{method:'POST'});
        const j=await r.json();
        alert(j.success?'이메일 전송 완료!':'전송 실패: '+(j.message||'알 수 없음'));
      }catch(e){
        alert('전송 실패');
      }finally{
        this.disabled=false;
      }
    };
    
    initCharts();
    load();
    setInterval(load,3e4);
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
  if (request.method === 'GET' && (url.pathname === '/visitor/security' || url.pathname === '/visitor/dashboard')) {
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

  // Visitor stats dashboard with charts
  if (request.method === 'GET' && url.pathname === '/visitor/stats') {
    return new Response(getVisitorStatsHTML(), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  }

  // Visitor analytics dashboard
  if (request.method === 'GET' && url.pathname === '/visitor/analytics') {
    return new Response(getVisitorAnalyticsHTML(), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  }

  // Visitor logs with pagination
  if (request.method === 'GET' && url.pathname === '/visitor/logs') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    return new Response(getVisitorLogsHTML(limit, page), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
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

    // Public endpoints (no IP check required)
    if (request.method === 'GET' && url.pathname === '/ip') {
      const normalizedIp = normalizeIp(clientInfo.ip);
      return new Response(JSON.stringify({
        ip: clientInfo.ip || 'Unknown',
        normalizedIp: normalizedIp || clientInfo.ip || 'Unknown',
        country: clientInfo.country || 'Unknown',
        userAgent: clientInfo.userAgent || 'Unknown',
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (request.method === 'GET' && url.pathname === '/admin') {
      return new Response(getAdminDashboardHTML(), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

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
