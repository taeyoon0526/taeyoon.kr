# ⚡ 방문자 추적 시스템 빠른 시작 가이드

최소 5분 안에 방문자 추적 시스템을 배포하는 가이드입니다.

---

## 📋 사전 준비

- ✅ Cloudflare 계정
- ✅ Wrangler CLI 설치 (`npm install -g wrangler`)
- ✅ 기존 Worker가 `contact.taeyoon.kr`에 배포되어 있어야 함

---

## 🚀 5분 배포

### 1️⃣ KV Namespace 생성 (1분)

```bash
# KV namespace 생성
wrangler kv namespace create "VISITOR_LOG"

# Wrangler가 자동으로 wrangler.toml에 추가할지 물어봅니다
# "yes"를 선택하면 2단계를 건너뛸 수 있습니다
```

### 2️⃣ wrangler.toml 확인 (선택사항)

1단계에서 자동 추가를 선택했다면 이 단계를 건너뛰세요.

수동으로 추가하려면 `wrangler.toml`에 다음 추가:

```toml
[[kv_namespaces]]
binding = "VISITOR_LOG"
id = "121c27d4ffbd44e393abbbf2fb9eb586"  # 1단계에서 생성된 ID
```

### 3️⃣ 비밀번호 설정 (1분)

```bash
# 대시보드 비밀번호 설정
wrangler secret put VISITOR_PASSWORD
# 프롬프트에 원하는 비밀번호 입력 (예: MySecurePassword2024)
```

### 4️⃣ Worker 배포 (1분)

```bash
# Worker 배포
wrangler deploy

# 성공 메시지 확인
# ✨ Success! Uploaded worker-name (X.XX sec)
```

### 5️⃣ 정적 파일 배포 (1분)

```bash
# Git에 새 파일 추가
git add beacon.js visitor.html visitor.css visitor.js VISITOR_DEPLOYMENT.md
git commit -m "Add visitor tracking system"
git push origin main

# Cloudflare Pages가 자동으로 배포합니다 (1-2분 소요)
```

---

## ✅ 배포 확인

### Worker 테스트

```bash
# /collect 엔드포인트 테스트
curl -X POST https://contact.taeyoon.kr/collect \
  -H "Content-Type: application/json" \
  -d '{
    "event": "enter",
    "sessionId": "test-session",
    "url": "https://taeyoon.kr",
    "time": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
  }'

# 응답: {"success":true}
```

### 대시보드 접속

1. 브라우저에서 `https://contact.taeyoon.kr/visitor` 열기
2. 3단계에서 설정한 비밀번호 입력
3. 대시보드 확인 ✨

### 클라이언트 추적 확인

1. `https://taeyoon.kr` 접속
2. F12 → Network 탭 열기
3. `/collect` 요청 확인 (Status: 200)

---

## 🔧 문제 해결

### "VISITOR_LOG is not defined" 오류

```bash
# KV 바인딩 확인
wrangler kv namespace list

# wrangler.toml의 kv_namespaces 확인
cat wrangler.toml | grep -A 3 "kv_namespaces"
```

### 대시보드 로그인 실패

```bash
# 비밀번호 재설정
wrangler secret put VISITOR_PASSWORD

# Worker 재배포
wrangler deploy
```

### 데이터가 수집되지 않음

```bash
# Worker 로그 실시간 확인
wrangler tail --format pretty

# 그 다음 taeyoon.kr 접속해서 로그 확인
```

---

## 📊 다음 단계

✅ **배포 완료!**

이제 다음을 확인하세요:

1. **[VISITOR_DEPLOYMENT.md](VISITOR_DEPLOYMENT.md)**: 전체 기능 및 고급 설정
2. **Worker Analytics**: Cloudflare Dashboard → Workers → Metrics
3. **KV 사용량**: Cloudflare Dashboard → KV → VISITOR_LOG

---

## 💡 유용한 명령어

```bash
# Worker 로그 보기
wrangler tail

```bash
# KV 데이터 확인
wrangler kv key list --namespace-id=121c27d4ffbd44e393abbbf2fb9eb586

# Worker 버전 롤백
wrangler rollback

# 환경 변수 확인
wrangler secret list
```
```

---

**문제가 있나요?** [VISITOR_DEPLOYMENT.md](VISITOR_DEPLOYMENT.md)의 "문제 해결" 섹션을 참조하세요.
