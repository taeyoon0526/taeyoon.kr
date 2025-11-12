# 🎯 보안 점수 100/100 달성 로드맵

**현재 점수**: 85/100 (B+)  
**목표 점수**: 100/100 (A+)  
**필요 개선**: +15점

---

## 📊 현재 상태 분석

### ✅ 이미 구현됨 (85점)
1. API 인증 (Bearer Token / X-API-Key)
2. Dashboard 접근 제어 (IP 화이트리스트)
3. Turnstile 토큰 일회용 처리
4. 고급 Rate Limiting (Sliding window)
5. 일반화된 에러 메시지
6. HTTPS 강제 리다이렉트
7. IP 주소 마스킹
8. 보안 쿠키 플래그
9. 콘솔 보안 경고
10. 성능 최적화 (병렬 KV 조회)

### ⚠️ 남은 취약점 (15점)

#### 🔴 MEDIUM 취약점 (2개 x 5점 = 10점)
1. **CSP 헤더 불완전** (5점)
   - 현재: GitHub Pages가 제어하여 Worker CSP가 완전 적용 안됨
   - 문제: `unsafe-inline`, `unsafe-eval` 여전히 존재 가능

2. **Subresource Integrity (SRI) 미적용** (5점)
   - 현재: 외부 라이브러리에 SRI 해시 없음
   - 위험: CDN 변조 시 악성 코드 삽입 가능

#### 🟡 LOW 취약점 (3개 x ~2점 = 5점)
3. **API 키 하드코딩** (2점)
   - 현재: `dashboard-access-2025` 코드에 노출
   - 위험: 소스 코드 유출 시 인증 우회

4. **감사 로깅 부족** (2점)
   - 현재: 보안 이벤트 로깅 미흡
   - 문제: 공격 추적 및 분석 어려움

5. **세션 관리 미흡** (1점)
   - 현재: sessionId 클라이언트 생성
   - 위험: 세션 하이재킹 가능

---

## 🚀 100점 달성 액션 플랜

### Priority 1: CSP 완전 적용 (+5점)

#### 옵션 A: GitHub Pages → Cloudflare Pages 마이그레이션 (권장)
**장점**:
- Worker와 완전 통합
- CSP 완전 제어 가능
- 더 빠른 배포

**단계**:
```bash
# 1. Cloudflare Pages 프로젝트 생성
npx wrangler pages project create taeyoon-kr

# 2. 정적 파일 배포
npx wrangler pages deploy . --project-name=taeyoon-kr

# 3. 도메인 설정
# Cloudflare Dashboard에서 taeyoon.kr → Pages 연결

# 4. Worker에서 강력한 CSP 적용
Content-Security-Policy: 
  default-src 'self';
  script-src 'self' 'nonce-{random}';
  style-src 'self' 'nonce-{random}';
  img-src 'self' data: https:;
  font-src 'self';
  connect-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

#### 옵션 B: GitHub Pages 유지 + Worker에서 HTML 프록시
**장점**:
- GitHub Pages 유지
- Worker에서 HTML 수정 가능

**단계**:
```javascript
// worker.js에서 HTML을 가져와 CSP 헤더 추가
if (url.pathname === '/' || url.pathname.endsWith('.html')) {
  const response = await fetch(request);
  const html = await response.text();
  
  return new Response(html, {
    headers: {
      ...response.headers,
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'nonce-...'",
    }
  });
}
```

**구현 코드**:
```javascript
// worker.js - 추가
function generateNonce() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

function getStrictCSP(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests"
  ].join('; ');
}
```

---

### Priority 2: Subresource Integrity (SRI) 적용 (+5점)

#### 현재 외부 리소스 확인
```bash
grep -r "src=\"https://" index.html enhancements.js
```

#### SRI 해시 생성 및 적용
```bash
# 1. 외부 스크립트 다운로드
curl -o turnstile.js https://challenges.cloudflare.com/turnstile/v0/api.js

# 2. SHA-384 해시 생성
cat turnstile.js | openssl dgst -sha384 -binary | openssl base64 -A

# 3. HTML에 적용
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        integrity="sha384-HASH_HERE"
        crossorigin="anonymous"></script>
```

**자동화 스크립트**:
```bash
#!/bin/bash
# generate-sri.sh

echo "🔒 SRI 해시 생성 중..."

# Cloudflare Turnstile
TURNSTILE_HASH=$(curl -s https://challenges.cloudflare.com/turnstile/v0/api.js | 
                 openssl dgst -sha384 -binary | 
                 openssl base64 -A)
echo "Turnstile: sha384-$TURNSTILE_HASH"

# 기타 외부 리소스...
```

**index.html 수정**:
```html
<!-- Before -->
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

<!-- After -->
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        integrity="sha384-..."
        crossorigin="anonymous"
        async defer></script>
```

---

### Priority 3: API 키 관리 개선 (+2점)

#### 현재 문제
```javascript
// worker.js - 하드코딩됨
const API_SECRET_KEY = 'dashboard-access-2025';  // ❌ 위험
```

#### 해결 방법: Cloudflare Secrets 사용
```bash
# 1. Secret 설정
npx wrangler secret put API_SECRET_KEY
# 입력: [안전한 랜덤 키 - 최소 32자]

# 2. worker.js 수정
const API_SECRET_KEY = env.API_SECRET_KEY;  // ✅ 안전

# 3. 키 로테이션 정책
# - 3개월마다 키 변경
# - 구 키는 1주일 grace period
```

**강력한 API 키 생성**:
```bash
# 64자 랜덤 키 생성
openssl rand -base64 48
# 예: xK9mQ2nP8vL4tR7wS5eA3dF6gH1jB0cV9zY8uI2oE7pM4nQ6rT3sW1xA5bC
```

**worker.js 개선**:
```javascript
// 다중 API 키 지원 (키 로테이션용)
const VALID_API_KEYS = [
  env.API_SECRET_KEY,        // 현재 키
  env.API_SECRET_KEY_OLD,    // 이전 키 (grace period)
].filter(Boolean);

function checkApiAuth(request) {
  const authHeader = request.headers.get('Authorization');
  const apiKey = request.headers.get('X-API-Key');
  
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return VALID_API_KEYS.includes(token);
  }
  
  if (apiKey) {
    return VALID_API_KEYS.includes(apiKey);
  }
  
  return false;
}
```

---

### Priority 4: 보안 감사 로깅 (+2점)

#### 구현: Security Event Logger

**worker.js에 추가**:
```javascript
// 보안 이벤트 로깅
async function logSecurityEvent(env, event) {
  const timestamp = new Date().toISOString();
  const logKey = `security-log:${timestamp}:${crypto.randomUUID()}`;
  
  await env.SECURITY_DATA.put(logKey, JSON.stringify({
    timestamp,
    event: event.type,
    ip: event.ip,
    path: event.path,
    userAgent: event.userAgent,
    result: event.result,
    details: event.details
  }), {
    expirationTtl: 90 * 24 * 60 * 60  // 90일 보관
  });
}

// 사용 예시
// 인증 실패
if (!isAuthenticated && !isAllowedIp) {
  await logSecurityEvent(env, {
    type: 'AUTH_FAILURE',
    ip: normalizedIp,
    path: url.pathname,
    userAgent: request.headers.get('User-Agent'),
    result: 'BLOCKED',
    details: { reason: 'No valid authentication' }
  });
  return getGenericErrorResponse(401, origin, env);
}

// Rate limit 초과
if (!rateCheck.allowed) {
  await logSecurityEvent(env, {
    type: 'RATE_LIMIT_EXCEEDED',
    ip: normalizedIp,
    path: url.pathname,
    result: 'BLOCKED',
    details: { retryAfter: rateCheck.retryAfter }
  });
  // ...
}

// Turnstile 실패
if (!isValidTurnstile) {
  await logSecurityEvent(env, {
    type: 'TURNSTILE_FAILURE',
    ip: normalizedIp,
    result: 'BLOCKED',
    details: { errorCodes }
  });
  // ...
}
```

**보안 로그 대시보드**:
```javascript
// /visitor/security-logs 엔드포인트 추가
if (url.pathname === '/visitor/security-logs') {
  const logs = await env.SECURITY_DATA.list({ prefix: 'security-log:' });
  const events = [];
  
  for (const key of logs.keys) {
    const data = await env.SECURITY_DATA.get(key.name, 'json');
    if (data) events.push(data);
  }
  
  // 최근 100개 이벤트
  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  return new Response(JSON.stringify({
    success: true,
    events: events.slice(0, 100),
    summary: {
      authFailures: events.filter(e => e.type === 'AUTH_FAILURE').length,
      rateLimitHits: events.filter(e => e.type === 'RATE_LIMIT_EXCEEDED').length,
      turnstileFailures: events.filter(e => e.type === 'TURNSTILE_FAILURE').length
    }
  }), {
    headers: {
      'Content-Type': 'application/json',
      ...getSecurityHeaders()
    }
  });
}
```

---

### Priority 5: 세션 관리 개선 (+1점)

#### 현재 문제
```javascript
// script.js - 클라이언트에서 생성
const sessionId = localStorage.getItem('sessionId') || crypto.randomUUID();
```

#### 해결: 서버 측 세션 생성

**worker.js**:
```javascript
// 새 엔드포인트: /api/session
if (url.pathname === '/api/session' && request.method === 'POST') {
  const sessionId = crypto.randomUUID();
  const sessionData = {
    id: sessionId,
    createdAt: Date.now(),
    ip: normalizedIp,
    userAgent: request.headers.get('User-Agent'),
    expiresAt: Date.now() + (24 * 60 * 60 * 1000)  // 24시간
  };
  
  await env.VISITOR_SESSIONS.put(
    `session:${sessionId}`,
    JSON.stringify(sessionData),
    { expirationTtl: 24 * 60 * 60 }
  );
  
  return new Response(JSON.stringify({
    success: true,
    sessionId,
    expiresAt: sessionData.expiresAt
  }), {
    headers: {
      'Content-Type': 'application/json',
      ...getSecurityHeaders(),
      'Set-Cookie': setSecureCookie('sessionId', sessionId, 24 * 60 * 60)
    }
  });
}

// 세션 검증
async function validateSession(env, sessionId, ip) {
  const session = await env.VISITOR_SESSIONS.get(`session:${sessionId}`, 'json');
  
  if (!session) return false;
  if (session.expiresAt < Date.now()) return false;
  if (session.ip !== ip) return false;  // IP 바인딩
  
  return true;
}
```

**script.js 수정**:
```javascript
// 서버에서 세션 받기
async function initSession() {
  let sessionId = getCookie('sessionId');
  
  if (!sessionId) {
    const response = await fetch('/api/session', { method: 'POST' });
    const data = await response.json();
    sessionId = data.sessionId;
  }
  
  return sessionId;
}
```

---

## 📋 구현 체크리스트

### Phase 1: 즉시 구현 가능 (3일)
- [ ] **SRI 해시 적용** (+5점)
  - [ ] 외부 리소스 목록 작성
  - [ ] SRI 해시 생성 스크립트
  - [ ] HTML 수정 및 테스트
  
- [ ] **API 키 Secrets 이전** (+2점)
  - [ ] Cloudflare Secret 생성
  - [ ] worker.js 수정
  - [ ] 배포 및 테스트

### Phase 2: 중기 구현 (1주일)
- [ ] **보안 감사 로깅** (+2점)
  - [ ] logSecurityEvent 함수 구현
  - [ ] 주요 보안 이벤트에 로깅 추가
  - [ ] 보안 로그 대시보드 생성

- [ ] **세션 관리 개선** (+1점)
  - [ ] 서버 측 세션 엔드포인트
  - [ ] 세션 검증 로직
  - [ ] 클라이언트 코드 수정

### Phase 3: 장기 구현 (2주일)
- [ ] **CSP 완전 적용** (+5점)
  - [ ] Cloudflare Pages 마이그레이션 또는
  - [ ] Worker HTML 프록시 구현
  - [ ] Nonce 기반 CSP 적용
  - [ ] 인라인 스크립트 제거/수정

---

## 🎯 예상 일정 및 점수

| Phase | 기간 | 구현 항목 | 점수 증가 | 누적 점수 |
|---|---|---|---|---|
| **현재** | - | 10개 항목 완료 | - | 85/100 (B+) |
| **Phase 1** | 3일 | SRI + API Key Secrets | +7점 | 92/100 (A-) |
| **Phase 2** | 1주 | 로깅 + 세션 관리 | +3점 | 95/100 (A) |
| **Phase 3** | 2주 | CSP 완전 적용 | +5점 | **100/100 (A+)** ✨ |

---

## 🔧 빠른 시작 가이드

### 1. SRI 해시 적용 (가장 빠른 개선)

```bash
# 스크립트 실행
cat > /tmp/generate-sri.sh << 'EOF'
#!/bin/bash
echo "🔒 Cloudflare Turnstile SRI 생성"
curl -s https://challenges.cloudflare.com/turnstile/v0/api.js | \
  openssl dgst -sha384 -binary | \
  openssl base64 -A
EOF

chmod +x /tmp/generate-sri.sh
/tmp/generate-sri.sh
```

### 2. API 키 Secrets 이전

```bash
# 강력한 키 생성
openssl rand -base64 48

# Secret 설정
npx wrangler secret put API_SECRET_KEY
# 생성된 키 입력

# worker.js에서 env.API_SECRET_KEY 사용으로 변경
```

### 3. 보안 로깅 추가

```bash
# KV Namespace 생성
npx wrangler kv:namespace create "VISITOR_SESSIONS"

# wrangler.toml에 추가
[[kv_namespaces]]
binding = "VISITOR_SESSIONS"
id = "..."
```

---

## 💡 추가 권장사항

### Beyond 100점: 최고 보안 수준

1. **WAF (Web Application Firewall)**
   - Cloudflare WAF 규칙 설정
   - OWASP Top 10 방어

2. **DDoS 방어**
   - Cloudflare DDoS Protection
   - Rate limiting 고도화

3. **정기 보안 감사**
   - 월간 보안 스캔
   - 침투 테스트 (Penetration Testing)

4. **보안 모니터링**
   - 실시간 알림 (Discord/Slack)
   - 이상 트래픽 탐지

5. **백업 및 복구**
   - KV 데이터 자동 백업
   - 재해 복구 계획 (DR)

---

## 📞 지원

질문이나 도움이 필요하면:
- GitHub Issues: github.com/taeyoon0526/taeyoon.kr
- Email: me@taeyoon.kr

**목표: 2주 내 100/100 달성!** 🎯✨
