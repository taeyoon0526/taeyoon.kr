# 🔒 보안 가이드

## ⚠️ 중요: API 키 관리

이 프로젝트는 다음 API 키들을 사용합니다:

### 1. Cloudflare Turnstile Secret Key
- **용도**: CAPTCHA 검증
- **저장 위치**: Cloudflare Workers 환경 변수 (`TURNSTILE_SECRET`)
- **절대 커밋하지 마세요**: ❌ 소스코드에 포함 금지

### 2. Resend API Key
- **용도**: 이메일 전송
- **저장 위치**: Cloudflare Workers 환경 변수 (`RESEND_API_KEY`)
- **절대 커밋하지 마세요**: ❌ 소스코드에 포함 금지

### 3. Cloudflare Turnstile Site Key (공개 가능)
- **용도**: 프론트엔드 CAPTCHA 위젯
- **저장 위치**: `index.html`의 `data-sitekey` 속성
- **공개 가능**: ✅ 이 키는 공개되어도 안전합니다

---

## 🛡️ API 키 설정 방법

### Cloudflare Workers에서 환경 변수 설정

1. **Cloudflare Dashboard 접속**
   - https://dash.cloudflare.com
   - Workers & Pages → 해당 Worker 선택

2. **환경 변수 추가**
   - Settings → Variables → Environment Variables
   - **Add variable** 클릭

3. **변수 설정**
   
   **변수 1: TURNSTILE_SECRET**
   ```
   Name: TURNSTILE_SECRET
   Value: [Cloudflare Turnstile Dashboard에서 확인]
   Type: Encrypted ✅
   ```

   **변수 2: RESEND_API_KEY**
   ```
   Name: RESEND_API_KEY
   Value: [Resend Dashboard에서 생성한 키]
   Type: Encrypted ✅
   ```

4. **Deploy** 버튼 클릭하여 적용

---

## 🚨 API 키가 노출되었을 때 대처 방법

### 1. 즉시 키 무효화

**Cloudflare Turnstile:**
1. https://dash.cloudflare.com → Turnstile
2. 해당 사이트 선택 → Settings
3. **Rotate Secret** 버튼 클릭
4. 새 Secret Key를 Cloudflare Workers 환경 변수에 업데이트

**Resend API:**
1. https://resend.com/api-keys
2. 노출된 키 옆의 **Delete** 버튼 클릭
3. **Create API Key** 버튼으로 새 키 생성
4. 새 키를 Cloudflare Workers 환경 변수에 업데이트

### 2. Git 히스토리에서 제거

```bash
# 민감한 파일을 Git 히스토리에서 완전히 제거
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch deploy-worker.sh" \
  --prune-empty --tag-name-filter cat -- --all

# 강제 푸시 (주의: 협업 시 팀원과 조율 필요)
git push origin --force --all
```

⚠️ **주의**: `git filter-branch`는 모든 커밋 히스토리를 변경합니다. 
협업 중인 저장소라면 팀원들에게 미리 알려야 합니다.

### 3. GitHub에 보안 사고 신고

노출된 키가 악용될 가능성이 있다면:
1. GitHub Security Advisories 사용
2. https://github.com/[username]/[repo]/security/advisories/new

---

## ✅ 보안 체크리스트

배포 전 반드시 확인하세요:

- [ ] `.env` 파일이 `.gitignore`에 포함되어 있나?
- [ ] API 키가 소스코드에 하드코딩되지 않았나?
- [ ] 모든 민감한 키가 환경 변수로 관리되나?
- [ ] `deploy-worker.sh` 같은 스크립트에 실제 키가 없나?
- [ ] README나 문서에 예시 키만 있나?
- [ ] `.gitignore`가 커밋되었나?

---

## 📚 참고 자료

- [Cloudflare Workers Environment Variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
- [Cloudflare Turnstile Documentation](https://developers.cloudflare.com/turnstile/)
- [Resend API Documentation](https://resend.com/docs)
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)

---

## 📞 보안 문제 신고

보안 취약점을 발견하셨다면:
- Email: me@taeyoon.kr
- 제목: [SECURITY] 보안 이슈 신고
