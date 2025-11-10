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
};

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
};

const rateLimitStore = new Map();

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

function applyRateLimit(ip, now = Date.now()) {
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
    return {
      limited: true,
      retryAfter: Math.ceil(CONFIG.RATE_LIMIT_BLOCK_MS / 1000),
    };
  }

  return { limited: false };
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
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
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
 * Get client information for security tracking
 */
function getClientInfo(request) {
  const headers = request.headers;
  return {
    ip: headers.get('CF-Connecting-IP') || headers.get('X-Forwarded-For') || headers.get('X-Real-IP') || null,
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
 * Check visitor dashboard password
 */
function checkVisitorPassword(request, env) {
  if (!env.VISITOR_PASSWORD) {
    return false;
  }

  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/visitor_auth=([^;]+)/);
  if (match && match[1] === env.VISITOR_PASSWORD) {
    return true;
  }

  return false;
}

/**
 * Set visitor auth cookie
 */
function setVisitorAuthCookie(env) {
  if (!env.VISITOR_PASSWORD) {
    return '';
  }

  return `visitor_auth=${env.VISITOR_PASSWORD}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;
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
 * Handle /api/visitors endpoint (data retrieval)
 */
async function handleApiVisitors(request, env) {
  const origin = request.headers.get('Origin');
  
  if (!checkVisitorPassword(request, env)) {
    return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Credentials': 'true',
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
 * Handle /visitor endpoint (login page and auth)
 */
async function handleVisitor(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');

  // POST /visitor/logout
  if (url.pathname === '/visitor/logout' && request.method === 'POST') {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'visitor_auth=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }

  // POST /visitor (login)
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const { password } = body;

      if (!env.VISITOR_PASSWORD) {
        return new Response(JSON.stringify({ success: false, message: 'Password not configured' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
          },
        });
      }

      if (password === env.VISITOR_PASSWORD) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': setVisitorAuthCookie(env),
            'Access-Control-Allow-Origin': origin || '*',
            'Access-Control-Allow-Credentials': 'true',
          },
        });
      }

      return new Response(JSON.stringify({ success: false, message: 'Invalid password' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
        },
      });
    } catch {
      return new Response(JSON.stringify({ success: false, message: 'Invalid request' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
        },
      });
    }
  }

  // GET /visitor (return login page or dashboard)
  const isAuthenticated = checkVisitorPassword(request, env);
  
  if (isAuthenticated) {
    // Fetch and serve dashboard from main site
    try {
      const dashboardResponse = await fetch('https://taeyoon.kr/visitor.html');
      if (!dashboardResponse.ok) {
        return new Response('Dashboard not found', { status: 404 });
      }
      
      // Return the HTML with proper headers
      return new Response(dashboardResponse.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
      return new Response('Dashboard not available', { status: 503 });
    }
  }

  // Serve login page
  const loginHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>방문자 대시보드 로그인</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .login-card {
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 2.5rem;
      width: 100%;
      max-width: 400px;
    }
    h1 {
      font-size: 1.8rem;
      margin-bottom: 0.5rem;
      color: #1f2933;
    }
    p {
      color: #52616b;
      margin-bottom: 2rem;
      font-size: 0.95rem;
    }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #323f4b;
      font-size: 0.9rem;
    }
    input[type="password"] {
      width: 100%;
      padding: 0.75rem 1rem;
      border: 2px solid #e4e7eb;
      border-radius: 10px;
      font-size: 1rem;
      transition: border-color 0.2s;
    }
    input[type="password"]:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 0.85rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 1.5rem;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .error {
      background: #fee;
      color: #c33;
      padding: 0.75rem;
      border-radius: 8px;
      margin-top: 1rem;
      font-size: 0.9rem;
      display: none;
    }
    .error.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <h1>🔒 방문자 대시보드</h1>
    <p>비밀번호를 입력하여 접속하세요.</p>
    <form id="loginForm">
      <label for="password">비밀번호</label>
      <input type="password" id="password" name="password" required autofocus>
      <button type="submit" id="submitBtn">로그인</button>
    </form>
    <div id="error" class="error"></div>
  </div>
  <script>
    const form = document.getElementById('loginForm');
    const errorDiv = document.getElementById('error');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      
      errorDiv.textContent = '';
      errorDiv.classList.remove('show');
      submitBtn.disabled = true;
      submitBtn.textContent = '로그인 중...';

      try {
        const response = await fetch('/visitor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });

        const data = await response.json();

        if (data.success) {
          window.location.href = '/visitor';
        } else {
          errorDiv.textContent = '비밀번호가 올바르지 않습니다.';
          errorDiv.classList.add('show');
        }
      } catch (error) {
        errorDiv.textContent = '로그인 요청 중 오류가 발생했습니다.';
        errorDiv.classList.add('show');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '로그인';
      }
    });
  </script>
</body>
</html>
  `;

  return new Response(loginHtml, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
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
    // Only handle /visitor and /visitor/logout, not /visitor.js or /visitor.css
    if (url.pathname === '/visitor' || url.pathname === '/visitor/logout') {
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
      return jsonResponse(
        { success: false, message: 'Not Found' },
        404,
        origin,
        env
      );
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
    const rateLimitStatus = applyRateLimit(clientInfo.ip);
    const logIP = clientInfo.ip || 'Unknown';
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

      // Validation: Name length
      if (name.length < 2 || name.length > 50) {
        return jsonResponse(
          { success: false, message: '이름은 2-50자 사이여야 합니다.' },
          400,
          origin,
          env
        );
      }

      // Validation: Email format
      if (!isValidEmail(email)) {
        return jsonResponse(
          { success: false, message: '올바른 이메일 주소를 입력해주세요.' },
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
