# ⚡ Quick Deploy Guide - Contact Form

## 🎯 목표
5분 안에 taeyoon.kr에서 Contact Form을 실제로 작동시키기!

---

## 📋 준비물 체크리스트

- [ ] Cloudflare 계정 (taeyoon.kr DNS 관리 중)
- [ ] Resend 계정 (무료 플랜 가능)
- [ ] contact@taeyoon.kr 이메일 수신 가능

---

## 🚀 Step 1: Resend API Key 생성 (2분)

### 1.1 Resend 가입
1. https://resend.com 방문
2. GitHub로 가입 (빠름) 또는 이메일 가입
3. 이메일 인증 완료

### 1.2 API Key 생성
1. Dashboard → **API Keys** 메뉴
2. **Create API Key** 클릭
3. 이름: `taeyoon-contact-form`
4. Permission: `Full Access` (또는 `Sending access`)
5. **Add** 클릭
6. ✅ **API Key 복사** (한 번만 보임!)
   ```
   re_123abc...xyz
   ```

### 1.3 도메인 추가 (나중에 해도 됨)
1. **Domains** 메뉴 → **Add Domain**
2. 도메인: `taeyoon.kr` 입력
3. DNS 레코드 나중에 추가 가능 (일단 작동부터 시킬 거예요!)

---

## ⚙️ Step 2: Cloudflare Worker 배포 (3분)

### 2.1 Worker 생성
1. https://dash.cloudflare.com 로그인
2. 왼쪽 메뉴 **Workers & Pages** 클릭
3. **Create** 버튼 → **Create Worker** 선택
4. Worker 이름: `contact-form` (자동 생성된 이름 그대로 써도 됨)
5. **Deploy** 클릭

### 2.2 Worker 코드 배포
1. 방금 만든 Worker 클릭
2. **Edit Code** 버튼 클릭
3. 왼쪽 코드 창의 **모든 내용 삭제**
4. `worker.js` 파일 열기 (이 프로젝트에 있음)
5. **전체 내용 복사** (Ctrl+A, Ctrl+C)
6. Cloudflare 코드 창에 **붙여넣기** (Ctrl+V)
7. **Save and Deploy** 클릭

### 2.3 Custom Domain 연결
1. Worker 페이지 상단의 **Settings** 탭 클릭
2. **Triggers** 섹션 찾기
3. **Custom Domains**에서 **Add Custom Domain** 클릭
4. 도메인 입력: `contact.taeyoon.kr`
5. **Add Custom Domain** 클릭
6. ✅ DNS 레코드 자동 생성됨 (1-2분 소요)

### 2.4 환경 변수 설정
1. **Settings** 탭에서 **Variables** 섹션 찾기
2. **Add variable** 클릭

**첫 번째 변수 (필수):**
- Variable name: `RESEND_API_KEY`
- Value: `re_123abc...` (Step 1.2에서 복사한 키)
- ✅ **Encrypt** 체크박스 선택
- **Save** 클릭

**두 번째 변수 (필수):**
- Variable name: `TURNSTILE_SECRET`
- Value: `0x4AAAAAAAzGC8hc_lGK6t2u` (Turnstile Secret - 아래서 확인)
- ✅ **Encrypt** 체크박스 선택  
- **Save** 클릭

> **TURNSTILE_SECRET 찾기:**
> 1. https://dash.cloudflare.com/?to=/:account/turnstile
> 2. 사이트 클릭 (taeyoon.kr)
> 3. **Secret Key** 복사

---

## ✅ Step 3: 테스트 (1분)

### 3.1 변경사항 푸시
```bash
cd /home/taeyoon_0526/Desktop/typing
git add -A
git commit -m "Enable production contact form"
git push
```

### 3.2 GitHub Pages 배포 대기
- GitHub Actions 자동 배포: **1-2분 소요**
- 진행 상황: https://github.com/taeyoon0526/taeyoon.kr/actions

### 3.3 실제 테스트
1. https://taeyoon.kr 방문
2. **Ctrl+Shift+R** (강력 새로고침)
3. Contact 섹션으로 스크롤
4. **Turnstile CAPTCHA 확인** ✅ (체크박스 표시됨)
5. 폼 작성:
   - 이름: 홍길동
   - 이메일: test@example.com
   - 메시지: 테스트 메시지입니다.
6. Turnstile 체크박스 클릭 ✅
7. **전송하기** 클릭
8. 성공 메시지: "✅ 메시지가 성공적으로 전송되었습니다!"
9. 이메일 확인: contact@taeyoon.kr (또는 설정한 이메일)

---

## 🐛 문제 해결

### Turnstile이 체크되지 않음
- F12 → Console 확인
- 에러 400020: Secret Key 확인
- 에러 300xxx: Domain 설정 확인

### 이메일이 안 옴
1. Worker Logs 확인:
   - Workers & Pages → contact-form → **Logs** 탭
2. Resend API Key 확인
3. Resend Dashboard에서 **Logs** 확인

### CORS 오류
- Worker 환경 변수에 `ALLOWED_ORIGIN` 추가
- Value: `https://taeyoon.kr`

---

## 📧 이메일 주소 변경하기

`worker.js` 파일 수정:

```javascript
EMAIL_TO: 'your-email@example.com',  // 받을 이메일
EMAIL_FROM: 'Contact Form <noreply@taeyoon.kr>',  // 발신자
```

수정 후:
```bash
git add worker.js
git commit -m "Update email address"
git push
```

그리고 Worker 코드 다시 복사/붙여넣기!

---

## 🎉 완료!

이제 taeyoon.kr에서 실제로 이메일을 받을 수 있습니다!

**테스트 완료 후:**
- [ ] Resend 도메인 DNS 레코드 추가 (선택사항, 발신자 신뢰도 향상)
- [ ] Worker 로그 모니터링
- [ ] 스팸 테스트

---

**도움이 필요하면:** [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) 참조
