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

/**
 * CORS headers for the allowed origin
 */
function getCorsHeaders(origin, env) {
  const allowedOrigin = env.ALLOWED_ORIGIN || 'https://taeyoon.kr';
  const baseHeaders = {
    Vary: 'Origin',
  };
  
  if (origin === allowedOrigin) {
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

// ===== Main Handler =====

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const clientInfo = getClientInfo(request);

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
    // Parse request body
    const body = await request.json();
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
