# 🔍 방문자 추적 시스템 배포 가이드

## 📌 개요

taeyoon.kr 방문자 추적 시스템은 Cloudflare Workers + KV Storage를 사용하여 실시간 방문자 분석 대시보드를 제공합니다.

### 주요 기능
- ✅ 실시간 방문자 이벤트 수집 (enter, ping, leave)
- ✅ IP, 국가, 기기 유형, 리퍼러, User Agent 기록
- ✅ 체류 시간 추적 (세션 기반)
- ✅ 비밀번호 보호 관리자 대시보드
- ✅ CSV 내보내기, 필터링, 통계 요약
- ✅ 90일 데이터 자동 만료

---

## 🏗️ 아키텍처

```
┌─────────────────┐
│   taeyoon.kr    │  ← beacon.js (클라이언트 추적)
│   (정적 사이트)  │
└────────┬────────┘
         │
         │ POST /collect
         ▼
┌─────────────────────────────────────────┐
│  Cloudflare Worker (contact.taeyoon.kr) │
│  ├─ /collect        (이벤트 수집)        │
│  ├─ /api/visitors   (데이터 조회)        │
│  └─ /visitor        (로그인/대시보드)    │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  KV: VISITOR_LOG│  ← 방문 이벤트 저장 (90일 TTL)
└─────────────────┘
```

---

## 🚀 배포 단계

### 1. Cloudflare KV Namespace 생성

```bash
# Wrangler CLI로 KV namespace 생성
wrangler kv namespace create "VISITOR_LOG"

# Wrangler가 자동으로 wrangler.toml에 추가할지 물어봅니다
# "yes"를 선택하면 자동으로 설정됩니다
```

출력 예시:
```
🌀 Creating namespace with title "VISITOR_LOG"
✨ Success!
To access your new KV Namespace in your Worker, add the following snippet:
{
  "kv_namespaces": [
    {
      "binding": "VISITOR_LOG",
      "id": "121c27d4ffbd44e393abbbf2fb9eb586"
    }
  ]
}
✔ Would you like Wrangler to add it on your behalf? … yes
```

### 2. wrangler.toml 설정

1단계에서 자동 추가를 선택하지 않았다면, `wrangler.toml` 파일에 다음 내용 추가:

```toml
name = "contact-worker"
main = "worker.js"
compatibility_date = "2024-01-01"

# KV Namespace 바인딩 (자동 추가되었으면 이미 있음)
[[kv_namespaces]]
binding = "VISITOR_LOG"
id = "121c27d4ffbd44e393abbbf2fb9eb586"  # 생성된 실제 ID

# Environment Variables
[vars]
ALLOWED_ORIGINS = "https://taeyoon.kr"

# Secrets (wrangler secret put 명령으로 설정)
# TURNSTILE_SECRET
# RESEND_API_KEY
# VISITOR_PASSWORD
```

### 3. 환경 변수 설정

```bash
# Turnstile Secret (기존 contact form용)
wrangler secret put TURNSTILE_SECRET

# Resend API Key (기존 contact form용)
wrangler secret put RESEND_API_KEY

# 방문자 대시보드 비밀번호 (새로 추가)
wrangler secret put VISITOR_PASSWORD
# 예: "secure-admin-password-2024"
```

### 4. 정적 파일 배포

Cloudflare Pages에 다음 파일들이 배포되어야 합니다:

```
taeyoon.kr/
├── index.html          ← beacon.js 스크립트 포함
├── beacon.js           ← 클라이언트 추적 스크립트
├── visitor.html        ← 관리자 대시보드 UI
├── visitor.css         ← 대시보드 스타일
└── visitor.js          ← 대시보드 로직
```

**중요**: Cloudflare Pages 프로젝트 설정에서 다음을 확인:
- Build command: (없음 또는 기존 설정 유지)
- Build output directory: `/` (루트)
- Custom domains: `taeyoon.kr`

### 5. Worker 배포

```bash
# Worker 배포
wrangler deploy

# 배포 확인
curl https://contact.taeyoon.kr/collect -X POST \
  -H "Content-Type: application/json" \
  -d '{"event":"test","sessionId":"test","url":"https://taeyoon.kr","time":"2024-01-01T00:00:00Z"}'
```

### 6. Pages와 Worker 연결

Cloudflare Pages 프로젝트에서:
1. **Settings** → **Functions** 탭으로 이동
2. **Service Bindings** 섹션에서:
   - Variable name: `ASSETS`
   - Service: `contact-worker`
   - Environment: `production`

또는 `wrangler.toml`에 추가:

```toml
[[services]]
binding = "ASSETS"
service = "taeyoon-kr-pages"
environment = "production"
```

---

## 🔐 보안 설정

### CSP (Content Security Policy) 업데이트

`index.html`의 CSP에 beacon.js용 nonce가 이미 포함되어 있습니다:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; 
           script-src 'self' 'nonce-tknGa4Z7KR2AU7lL4xQ9Tw==' ...;
           connect-src 'self' https://contact.taeyoon.kr ...">
```

### CORS 설정

Worker는 `https://taeyoon.kr`에서 오는 요청만 허용합니다. 추가 도메인이 필요한 경우:

```bash
wrangler secret put ALLOWED_ORIGINS
# 입력 예: "https://taeyoon.kr,https://www.taeyoon.kr"
```

---

## 📊 사용 방법

### 방문자 대시보드 접속

1. 브라우저에서 `https://contact.taeyoon.kr/visitor` 접속
2. 설정한 `VISITOR_PASSWORD` 입력
3. 대시보드에서 실시간 방문 데이터 확인

### 대시보드 기능

- **요약 카드**: 총 방문 수, 고유 세션, 평균 체류시간, 상위 국가
- **필터**: 국가, 페이지, 날짜로 필터링
- **테이블**: 이벤트, 세션, IP, 국가, 기기, 페이지, 체류시간, 리퍼러, UA, 시간
- **내보내기**: CSV 파일로 다운로드
- **자동 새로고침**: 60초마다 자동 갱신

### 클라이언트 추적 작동 원리

`beacon.js`가 자동으로:
1. 페이지 진입 시 `enter` 이벤트 전송
2. 15초마다 `ping` 이벤트 전송 (최대 1시간)
3. 페이지 이탈 시 `leave` 이벤트 + 체류 시간 전송

---

## 🛠️ 문제 해결

### 데이터가 수집되지 않는 경우

1. **Worker 로그 확인**:
   ```bash
   wrangler tail
   ```

2. **KV 바인딩 확인**:
   ```bash
   wrangler kv:namespace list
   ```

3. **브라우저 콘솔 확인**:
   - F12 → Console 탭에서 `beacon.js` 오류 확인
   - Network 탭에서 `/collect` 요청 상태 확인

4. **CORS 오류 발생 시**:
   - `ALLOWED_ORIGINS` 환경 변수에 도메인 추가
   - CSP의 `connect-src`에 `https://contact.taeyoon.kr` 포함 확인

### 대시보드 로그인 실패

1. **비밀번호 확인**:
   ```bash
   # 비밀번호 재설정
   wrangler secret put VISITOR_PASSWORD
   ```

2. **쿠키 확인**:
   - 브라우저 DevTools → Application → Cookies
   - `visitor_auth` 쿠키가 `HttpOnly`, `Secure`, `SameSite=Strict`로 설정되었는지 확인

3. **Worker 로그 확인**:
   ```bash
   wrangler tail --format pretty
   ```

### KV 데이터 확인

```bash
# 저장된 키 목록 확인
wrangler kv key list --namespace-id=121c27d4ffbd44e393abbbf2fb9eb586

# 특정 키 값 조회
wrangler kv key get "KEY_NAME" --namespace-id=121c27d4ffbd44e393abbbf2fb9eb586
```

---

## 📈 모니터링 및 유지보수

### Worker Analytics 확인

Cloudflare Dashboard에서:
1. **Workers & Pages** → 해당 Worker 선택
2. **Metrics** 탭에서 요청 수, 오류율, CPU 시간 확인

### KV 사용량 확인

1. **Storage & Databases** → **KV** → `VISITOR_LOG`
2. 저장된 키 수, 사용 용량 확인

### 데이터 정리

KV는 90일 TTL로 자동 만료되지만, 수동 정리가 필요한 경우:

```bash
# 모든 키 삭제 (주의!)
wrangler kv key list --namespace-id=121c27d4ffbd44e393abbbf2fb9eb586 | \
  jq -r '.[].name' | \
  xargs -I {} wrangler kv key delete {} --namespace-id=121c27d4ffbd44e393abbbf2fb9eb586
```

---

## 🔄 업데이트 및 롤백

### Worker 업데이트

```bash
# 변경 사항 배포
wrangler deploy

# 특정 버전으로 롤백
wrangler rollback [VERSION_ID]
```

### 정적 파일 업데이트

Cloudflare Pages는 Git push 시 자동 배포됩니다:

```bash
git add visitor.html visitor.css visitor.js beacon.js
git commit -m "Update visitor tracking system"
git push origin main
```

---

## 💡 성능 최적화

### KV Read/Write 최적화

- **Read**: KV는 전 세계 Edge에 캐시되므로 빠름 (1-10ms)
- **Write**: 최종 일관성 보장 (최대 60초)

### Worker CPU 시간 절약

현재 구현은 단일 요청당 평균 ~10ms CPU 시간을 사용합니다.

최적화 팁:
- 필터링을 KV 레벨이 아닌 클라이언트 측에서 수행
- 대용량 데이터는 Cloudflare R2로 오프로드 고려

---

## 📞 지원

문제가 지속되면:
- GitHub Issues: `https://github.com/taeyoon0526/taeyoon.kr/issues`
- Email: `me@taeyoon.kr`

---

**마지막 업데이트**: 2024-11-10  
**작성자**: Taeyoon Kim
