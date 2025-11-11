# Dashboard와 Wrangler Config Sync 가이드

## 🎯 문제 해결됨!

**원인**: wrangler.toml 파일의 TOML 파싱 버그  
**해결**: wrangler.json (JSON 형식) 사용

## ✅ 최종 설정

### wrangler.json
```json
{
  "name": "contact-form",
  "main": "worker.js",
  "compatibility_date": "2024-01-01",
  "kv_namespaces": [
    {
      "binding": "VISITOR_LOG",
      "id": "121c27d4ffbd44e393abbbf2fb9eb586"
    },
    {
      "binding": "VISITOR_ANALYTICS_KV",
      "id": "9cd1faa2076f43749f314d08e009b111"
    },
    {
      "binding": "SECURITY_DATA",
      "id": "9b7318d35c28442198fb6bc6b96c8879"
    }
  ],
  "vars": {
    "ALLOWED_ORIGIN": "https://taeyoon.kr",
    "ALLOWED_ORIGINS": "https://taeyoon.kr"
  }
}
```

## � 간단한 배포 방법

```bash
# 방법 1: 자동 스크립트 (권장)
./deploy.sh

# 방법 2: 수동 배포
npx wrangler deploy --config wrangler.json
```

## 📋 배포 확인

```bash
# 바인딩 확인
curl -s https://contact.taeyoon.kr/visitor/check-bindings | jq

# 예상 출력 (모두 true여야 함):
{
  "VISITOR_LOG": true,
  "VISITOR_ANALYTICS_KV": true,
  "SECURITY_DATA": true
}
```

## � 이전 문제들

### ❌ wrangler.toml 사용 시:
```toml
[[kv_namespaces]]
binding = "VISITOR_LOG"
id = "121c27d4ffbd44e393abbbf2fb9eb586"

[[kv_namespaces]]
binding = "VISITOR_ANALYTICS_KV"
id = "9cd1faa2076f43749f314d08e009b111"

[[kv_namespaces]]
binding = "SECURITY_DATA"
id = "9b7318d35c28442198fb6bc6b96c8879"
```
→ **Wrangler가 첫 번째 바인딩만 인식하는 버그** 😢

### ✅ wrangler.json 사용 시:
```json
"kv_namespaces": [
  { "binding": "VISITOR_LOG", "id": "..." },
  { "binding": "VISITOR_ANALYTICS_KV", "id": "..." },
  { "binding": "SECURITY_DATA", "id": "..." }
]
```
→ **모든 바인딩 완벽하게 작동!** 🎉

## 📚 추가 정보

- 보안 대시보드: https://contact.taeyoon.kr/visitor/security
- 바인딩 확인: https://contact.taeyoon.kr/visitor/check-bindings
- Cloudflare Dashboard: https://dash.cloudflare.com

## 🎯 최종 워크플로우

```bash
# 1. 코드 수정
git add -A
git commit -m "Update worker"

# 2. 배포 (자동으로 바인딩 확인)
./deploy.sh

# 3. Git 푸시
git push
```

**이제 Dashboard와 완벽하게 sync됩니다!** 🎉
