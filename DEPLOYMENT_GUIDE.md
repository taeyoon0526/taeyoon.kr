# 📮 Contact Form Setup Guide

## 🚀 Cloudflare Worker 배포 가이드

### 1. Cloudflare Workers 설정

#### 1.1 Worker 생성
1. [Cloudflare Dashboard](https://dash.cloudflare.com/) 로그인
2. **Workers & Pages** 메뉴 선택
3. **Create application** 클릭
4. **Create Worker** 선택
5. Worker 이름: `contact-form` (또는 원하는 이름)

#### 1.2 Worker 코드 배포
1. 생성된 Worker의 **Quick edit** 클릭
2. `worker.js` 파일의 전체 내용을 복사하여 붙여넣기
3. **Save and Deploy** 클릭

#### 1.3 Custom Domain 연결
1. Worker 설정 페이지에서 **Triggers** 탭 선택
2. **Custom Domains** 섹션에서 **Add Custom Domain** 클릭
3. 도메인 입력: `contact.taeyoon.kr`
4. **Add Custom Domain** 클릭하여 완료

> **참고**: DNS 레코드가 자동으로 생성되며, 몇 분 후 활성화됩니다.

### 2. Environment Variables 설정

Worker에 필요한 환경 변수를 설정합니다.

#### 2.1 TURNSTILE_SECRET
1. Worker 설정 페이지에서 **Settings** 탭 선택
2. **Variables** 섹션 찾기
3. **Add variable** 클릭
4. 변수명: `TURNSTILE_SECRET`
5. 값: Turnstile Secret Key (Cloudflare Turnstile 대시보드에서 확인)
6. **Encrypt** 체크박스 선택 ✅
7. **Save** 클릭

#### 2.2 RESEND_API_KEY
1. [Resend](https://resend.com/) 계정 생성/로그인
2. **API Keys** 메뉴에서 새 API 키 생성
3. Cloudflare Worker **Settings** → **Variables**
4. **Add variable** 클릭
5. 변수명: `RESEND_API_KEY`
6. 값: Resend API Key (예: `re_123abc...`)
7. **Encrypt** 체크박스 선택 ✅
8. **Save** 클릭

#### 2.3 ALLOWED_ORIGIN (선택사항)
1. **Add variable** 클릭
2. 변수명: `ALLOWED_ORIGIN`
3. 값: `https://taeyoon.kr`
4. **Save** 클릭

> **참고**: 이 변수는 선택사항이며, 설정하지 않으면 기본값 `https://taeyoon.kr`이 사용됩니다.

### 3. Resend 도메인 설정

#### 3.1 도메인 추가
1. [Resend Dashboard](https://resend.com/domains) 접속
2. **Add Domain** 클릭
3. 도메인 입력: `taeyoon.kr`
4. DNS 레코드 추가 (Cloudflare DNS에 추가)

#### 3.2 DNS 레코드 설정
Resend에서 제공하는 다음 레코드들을 Cloudflare DNS에 추가:

| Type | Name | Value | Priority |
|------|------|-------|----------|
| TXT | @ | `v=spf1 include:_spf.resend.com ~all` | - |
| TXT | resend._domainkey | `[Resend에서 제공하는 값]` | - |
| CNAME | bounce | `feedback-smtp.resend.com` | - |
| MX | @ | `feedback-smtp.resend.com` | 10 |

#### 3.3 발신 이메일 설정
Worker 코드에서 사용하는 발신 이메일:
- From: `Contact Form <noreply@taeyoon.kr>`
- To: `contact@taeyoon.kr`

> **중요**: `contact@taeyoon.kr` 이메일 주소가 실제로 존재하고 수신 가능해야 합니다.

### 4. Cloudflare Turnstile 설정

#### 4.1 사이트 추가
1. [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) 접속
2. **Add Site** 클릭
3. 사이트 이름: `taeyoon.kr Contact Form`
4. 도메인: `taeyoon.kr`
5. Widget Mode: **Managed** 선택

#### 4.2 키 확인
생성 후 다음 키들을 확인:
- **Site Key**: `0x4AAAAAAAzGC8hdEB3f8J42` (이미 HTML에 설정됨)
- **Secret Key**: Worker 환경 변수에 추가 (위 2.1 참조)

---

## 🧪 테스트 가이드

### ⚠️ 로컬 환경 제한사항
**중요**: Cloudflare Turnstile은 로컬 환경(`localhost`, `127.0.0.1`)에서 작동하지 않습니다.

로컬에서 테스트 시:
- 🔧 **개발 모드**가 자동으로 활성화됩니다
- ⚠️ Turnstile CAPTCHA 위젯이 오류를 표시합니다 (정상)
- 🔑 더미 토큰이 자동으로 생성됩니다
- 📧 실제 이메일은 전송되지 않고 **시뮬레이션**됩니다
- ✅ 폼 검증 및 UI 동작은 정상 작동합니다

**브라우저 콘솔**에서 다음 메시지를 확인할 수 있습니다:
```
🔧 개발 환경 모드
⚠️ Turnstile CAPTCHA는 프로덕션(https://taeyoon.kr)에서만 작동합니다.
💡 로컬에서는 더미 토큰을 사용합니다.
```

### 로컬 테스트 (개발 모드)
1. HTML 파일을 로컬에서 열기 (Live Server 사용 권장)
2. **F12** 또는 **Ctrl+Shift+I**로 브라우저 콘솔 열기
3. Contact 섹션으로 스크롤
4. 폼 작성:
   - 이름: 2-50자
   - 이메일: 유효한 이메일 형식
   - 메시지: 10-1000자
5. Turnstile 위젯 오류 무시 (콘솔에서 더미 토큰 확인)
6. **전송하기** 버튼 클릭
7. 콘솔에서 폼 데이터 확인
8. 2초 후 성공 메시지 확인: "✅ [개발 모드] 메시지가 성공적으로 전송되었습니다! (시뮬레이션)"

> 💡 **팁**: 로컬에서는 입력 검증, UI/UX, 애니메이션만 테스트하세요. 실제 기능은 프로덕션에서 테스트해야 합니다.

### 프로덕션 테스트 (실제 환경)
1. Worker가 배포되고 환경 변수가 설정되었는지 확인
2. `https://taeyoon.kr` 방문
3. Contact Form 작성 후 제출
4. Turnstile CAPTCHA 정상 작동 확인 ✅
5. 성공 메시지: "✅ 메시지가 성공적으로 전송되었습니다!"
6. `contact@taeyoon.kr`에서 이메일 수신 확인 📧

> ⚠️ **중요**: 프로덕션 테스트 전에 반드시 Worker 배포 및 환경 변수 설정을 완료하세요!

### 에러 처리 테스트
- ❌ 빈 필드로 제출 → "모든 필수 항목을 입력해주세요."
- ❌ 짧은 메시지 → "메시지는 10-1000자 사이여야 합니다."
- ❌ CAPTCHA 없이 제출 → "CAPTCHA 인증을 완료해주세요."
- ❌ Honeypot 필드 채움 → "전송에 실패했습니다."

---

## 🔒 보안 기능

### 구현된 보안 조치
1. **Cloudflare Turnstile**: 봇 방지 CAPTCHA
2. **Honeypot 필드**: `website` 필드로 스팸 봇 감지
3. **최소 제출 시간**: 3초 이상 경과 후 제출 가능
4. **HTML Escaping**: XSS 공격 방지
5. **CORS 제한**: `https://taeyoon.kr`만 허용
6. **입력 검증**: 서버 측 유효성 검사
7. **Rate Limiting**: Cloudflare Worker 자동 제공

---

## 📊 모니터링

### Worker 로그 확인
1. Cloudflare Dashboard → **Workers & Pages**
2. Contact Worker 선택
3. **Logs** 탭에서 실시간 로그 확인

### 주요 로그 이벤트
- ✅ 성공적인 제출
- ⚠️ Honeypot 감지
- ⚠️ 빠른 제출 시도
- ❌ Turnstile 인증 실패
- ❌ 이메일 전송 실패

---

## 🛠️ 문제 해결

### 이메일이 전송되지 않음
1. Resend API Key 확인
2. Resend 도메인 DNS 레코드 확인
3. `contact@taeyoon.kr` 이메일 주소 확인
4. Worker 로그에서 에러 메시지 확인

### CAPTCHA 오류
1. Turnstile Site Key 확인 (`index.html` line 35)
2. Turnstile Secret Key 확인 (Worker 환경 변수)
3. 도메인이 Turnstile에 등록되어 있는지 확인

### CORS 오류
1. `ALLOWED_ORIGIN` 환경 변수 확인
2. 정확히 `https://taeyoon.kr` 형식인지 확인 (끝에 `/` 없음)
3. 브라우저 콘솔에서 Origin 헤더 확인

---

## 📝 커스터마이징

### 이메일 수신 주소 변경
`worker.js` 파일의 `CONFIG` 섹션 수정:
```javascript
EMAIL_TO: 'your-email@example.com',
```

### 발신자 이메일 변경
```javascript
EMAIL_FROM: 'Your Name <noreply@yourdomain.com>',
```

### 이메일 제목 변경
```javascript
EMAIL_SUBJECT: '새로운 문의 메시지',
```

### 최소 제출 시간 조정
```javascript
MIN_SUBMISSION_TIME: 5000, // 5초로 변경
```

---

## 🚀 배포 체크리스트

- [ ] Cloudflare Worker 생성 및 코드 배포
- [ ] Custom Domain 연결 (`contact.taeyoon.kr`)
- [ ] `TURNSTILE_SECRET` 환경 변수 설정
- [ ] `RESEND_API_KEY` 환경 변수 설정
- [ ] Resend 도메인 추가 및 DNS 레코드 설정
- [ ] Turnstile 사이트 추가
- [ ] 로컬 테스트 성공
- [ ] 프로덕션 테스트 성공
- [ ] 이메일 수신 확인

---

## 📚 참고 자료

- [Cloudflare Workers 문서](https://developers.cloudflare.com/workers/)
- [Cloudflare Turnstile 문서](https://developers.cloudflare.com/turnstile/)
- [Resend 문서](https://resend.com/docs)
- [CORS 설정 가이드](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

---

**Made with ❤️ for taeyoon.kr**
