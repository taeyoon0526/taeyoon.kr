# 보안 모니터링 시스템 설정 가이드

## 개요

보안 모니터링 시스템은 다음을 제공합니다:
- 🛡️ 실시간 보안 위협 감지 및 차단
- 📊 예쁜 대시보드 UI로 시각화
- 💾 KV를 통한 영구 데이터 저장

## 1. KV 네임스페이스 생성

먼저 보안 데이터를 저장할 KV 네임스페이스를 생성해야 합니다:

```bash
# KV 네임스페이스 생성
npx wrangler kv:namespace create "SECURITY_DATA"
```

이 명령어를 실행하면 다음과 같은 출력이 나옵니다:

```
🌀 Creating namespace with title "contact-form-SECURITY_DATA"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "SECURITY_DATA", id = "abc123xyz456..." }
```

## 2. wrangler.toml 업데이트

생성된 ID를 복사하여 `wrangler.toml` 파일의 SECURITY_DATA 바인딩을 업데이트하세요:

```toml
[[kv_namespaces]]
binding = "SECURITY_DATA"
id = "여기에_생성된_ID를_붙여넣으세요"
```

현재 `wrangler.toml`에는 `id = "PLACEHOLDER_REPLACE_ME"`로 되어 있습니다. 이것을 실제 ID로 교체하세요.

## 3. 배포

```bash
# JSON 설정 파일로 배포 (권장)
npx wrangler deploy --config wrangler.json

# 또는 자동 스크립트 사용
./deploy.sh
```

> **중요**: `wrangler.toml` 대신 `wrangler.json`을 사용하세요. TOML 파싱 버그로 인해 일부 바인딩이 누락될 수 있습니다.

## 4. 보안 대시보드 접속

배포 후 다음 URL로 접속하세요:

**보안 대시보드**: `https://contact.taeyoon.kr/visitor/security`

### 주요 기능

#### 📊 실시간 통계
- 차단된 IP 수
- 의심스러운 활동 수
- Rate Limit 현황

#### 🚫 차단된 IP 목록
- IP 주소
- 차단 사유
- 차단 시각
- 해제 시각
- 남은 시간

#### ⚠️ 의심스러운 활동
- IP별 활동 횟수
- 첫 감지 시각
- 최근 활동 내역
- 의심스러운 패턴 유형

#### 🔄 Rate Limit 현황
- 요청 횟수 초과 IP
- 첫 요청 시각
- 차단 상태

## 5. 데이터 저장 방식

### 자동 저장
다음 이벤트 발생 시 자동으로 KV에 저장됩니다:
- IP 차단 시
- 의심스러운 활동 감지 시
- Rate Limit 발생 시

### KV 키 구조
```
blocked_ips           - 차단된 IP 목록
suspicious_activities - 의심스러운 활동 기록
rate_limits          - Rate Limit 상태
```

### 데이터 보존 기간
- 기본: 7일
- 차단 해제된 IP는 자동 정리
- 오래된 의심 활동은 1시간 후 필터링

## 6. API 엔드포인트

### GET /visitor/security
보안 대시보드 HTML 페이지

### GET /visitor/security-stats
보안 통계 JSON 데이터 (CORS 허용)

**응답 예시:**
```json
{
  "blockedIps": [
    {
      "ip": "1.2.3.4",
      "reason": "honeypot_triggered",
      "blockedAt": "2025-11-11T10:00:00Z",
      "until": "2025-11-11T10:30:00Z",
      "remainingMs": 1800000
    }
  ],
  "suspiciousActivities": [...],
  "rateLimits": [...],
  "summary": {
    "totalBlockedIps": 1,
    "totalSuspiciousIps": 5,
    "totalRateLimitedIps": 2
  }
}
```

## 7. 보안 패턴 감지

다음 패턴이 감지되면 자동으로 차단됩니다:

- **XSS**: `<script>`, `javascript:`, `onerror`, `onload`, `onclick`
- **Path Traversal**: `..`, `//`, `\\`
- **SQL Injection**: `union select`, `select from`, `insert into`, `drop table`
- **Code Injection**: `<?php`, `<%`, `eval(`, `exec(`
- **Template Injection**: `${`, `<%=`, `{% raw %}{{{% endraw %}`

## 8. 모니터링

대시보드는 30초마다 자동으로 새로고침됩니다.
수동 새로고침도 버튼으로 가능합니다.

## 9. 문제 해결

### KV에 데이터가 저장되지 않는 경우
1. wrangler.toml의 SECURITY_DATA ID가 올바른지 확인
2. Worker 로그 확인: `npx wrangler tail`
3. KV 내용 확인:
   ```bash
   npx wrangler kv:key get --binding=SECURITY_DATA "blocked_ips"
   npx wrangler kv:key get --binding=SECURITY_DATA "suspicious_activities"
   npx wrangler kv:key get --binding=SECURITY_DATA "rate_limits"
   ```

### 대시보드가 비어 있는 경우
- 아직 보안 이벤트가 발생하지 않았을 수 있습니다
- 의도적으로 악의적인 요청을 보내서 테스트 가능:
  - SQL Injection 시도: `' OR 1=1--`
  - XSS 시도: `<script>alert('xss')</script>`
  - Honeypot 트리거: website 필드에 값 입력

## 10. 보안 권장사항

✅ 정기적으로 대시보드 확인
✅ 의심스러운 패턴 발견 시 즉시 조사
✅ 차단된 IP가 정당한 사용자인지 확인
✅ Rate Limit 설정 조정 (필요시)

## 완료! 🎉

이제 보안 모니터링 시스템이 완전히 설정되었습니다.
실시간으로 보안 위협을 감지하고 차단하며, 모든 데이터는 KV에 안전하게 저장됩니다.
