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
 * 
 * Features:
 * - Cloudflare Turnstile CAPTCHA verification
 * - Honeypot spam detection (website field)
 * - Minimum submission time protection
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
};

// ===== Helper Functions =====

/**
 * CORS headers for the allowed origin
 */
function getCorsHeaders(origin, env) {
  const allowedOrigin = env.ALLOWED_ORIGIN || 'https://taeyoon.kr';
  
  if (origin === allowedOrigin) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
  }
  
  return {};
}

/**
 * Create JSON response with CORS headers
 */
function jsonResponse(data, status = 200, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(origin, env),
    },
  });
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
async function verifyTurnstile(token, ip, env) {
  try {
    const response = await fetch(CONFIG.TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: ip,
      }),
    });

    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return false;
  }
}

/**
 * Get client information for security tracking
 */
function getClientInfo(request) {
  const headers = request.headers;
  return {
    ip: headers.get('CF-Connecting-IP') || headers.get('X-Forwarded-For') || headers.get('X-Real-IP') || 'Unknown',
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
    const escapedIP = escapeHtml(clientInfo.ip);
    const escapedCountry = escapeHtml(clientInfo.country);
    const escapedUserAgent = escapeHtml(clientInfo.userAgent);
    const escapedReferer = escapeHtml(clientInfo.referer);
    
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
                <strong>전송 시각:</strong> ${clientInfo.timestamp}
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
IP 주소: ${clientInfo.ip}
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

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: getCorsHeaders(origin, env),
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

    try {
      // Parse request body
      const body = await request.json();
      const { name, email, message, website, 'cf-turnstile-response': turnstileToken, t } = body;

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
        return jsonResponse(
          { success: false, message: 'CAPTCHA 인증이 필요합니다.' },
          400,
          origin,
          env
        );
      }

      const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
      const isTurnstileValid = await verifyTurnstile(turnstileToken, clientIP, env);

      if (!isTurnstileValid) {
        return jsonResponse(
          { success: false, message: 'CAPTCHA 인증에 실패했습니다.' },
          400,
          origin,
          env
        );
      }

      // Get client information for security tracking
      const clientInfo = getClientInfo(request);

      // Send email with client information
      const emailSent = await sendEmail(name, email, message, clientInfo, env);

      if (!emailSent) {
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
      return jsonResponse(
        { success: false, message: '서버 오류가 발생했습니다.' },
        500,
        origin,
        env
      );
    }
  },
};
