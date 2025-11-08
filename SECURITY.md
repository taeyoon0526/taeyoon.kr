# 🔒 보안 가이드

## ✅ Git 히스토리 정리 완료

**2025년 11월 8일**: Git 히스토리에서 모든 민감한 API 키가 제거되었습니다.
- `deploy-worker.sh` 파일이 전체 히스토리에서 완전히 삭제됨
- 노출되었던 Resend API Key와 Turnstile Secret Key 제거 완료
- 레포지토리가 비공개였으므로 API 키 재발급은 불필요

---

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
- **공개 가능**: ✅ 이 키는 공개되어도 안전합니다 (Site Key: `0x4AAAAAAB_yMvcBndUqiPFv`)

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

민감한 파일이 Git에 커밋되었다면:

```bash
# 1. 백업 생성
cd /home/taeyoon_0526/Desktop
cp -r taeyoon.kr taeyoon.kr-backup-$(date +%Y%m%d-%H%M%S)

# 2. 해당 파일을 히스토리에서 제거
cd taeyoon.kr
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch <파일명>' \
  --prune-empty --tag-name-filter cat -- --all

# 3. 참조 정리
rm -rf .git/refs/original/
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 4. 강제 푸시
git push origin --force --all
git push origin --force --tags
```

⚠️ **주의**: 
- 이 작업은 모든 커밋 히스토리를 변경합니다
- 협업 중이라면 팀원들과 조율이 필요합니다
- 공개 레포지토리라면 API 키를 즉시 재발급해야 합니다

---

## 💡 현재 프로젝트 구조

### GitHub Pages (정적 호스팅)
- **파일**: `index.html`, `styles.css`, `script.js`, `theme-upgrade.css`
- **민감 정보**: ❌ 없음 (Site Key만 포함, 공개 가능)
- **배포**: GitHub Actions 자동 배포

### Cloudflare Workers (서버리스 백엔드)
- **파일**: `worker.js`
- **민감 정보**: ✅ 환경 변수로 안전하게 관리
- **환경 변수**:
  - `TURNSTILE_SECRET`: Cloudflare Dashboard에서 암호화하여 저장
  - `RESEND_API_KEY`: Cloudflare Dashboard에서 암호화하여 저장

---

## ✅ 보안 체크리스트

배포 전 반드시 확인하세요:

- [x] `.env` 파일이 `.gitignore`에 포함되어 있나?
- [x] API 키가 소스코드에 하드코딩되지 않았나?
- [x] 모든 민감한 키가 환경 변수로 관리되나?
- [x] Git 히스토리에서 민감한 정보 제거됨?
- [x] `.gitignore`가 커밋되었나?
- [ ] Cloudflare Workers 환경 변수 설정 완료?
- [ ] Contact Form 테스트 완료?

---

## 📚 참고 자료

- [Cloudflare Workers Environment Variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
- [Cloudflare Turnstile Documentation](https://developers.cloudflare.com/turnstile/)
- [Resend API Documentation](https://resend.com/docs)
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)
- [Git Filter-Branch Documentation](https://git-scm.com/docs/git-filter-branch)

---

## 📞 보안 문제 신고

보안 취약점을 발견하셨다면:
- Email: me@taeyoon.kr
- 제목: [SECURITY] 보안 이슈 신고
