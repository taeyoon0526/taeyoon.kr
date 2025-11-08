# 🌐 Taeyoon's Personal Website

> 새로운 것을 배우고 도전하는 것을 즐기는 김태윤의 개인 웹사이트

[![Website](https://img.shields.io/website?url=https%3A%2F%2Ftaeyoon.kr)](https://taeyoon.kr)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 🚀 Live Demo

**🔗 https://taeyoon.kr**

---

## ✨ Features

### 🎨 디자인
- **Glassmorphism UI**: 모던하고 세련된 유리 효과 디자인
- **Dark Theme**: 눈에 편한 다크 테마
- **Gradient Backgrounds**: 아름다운 그라데이션 배경
- **Responsive Design**: 모바일, 태블릿, 데스크톱 완벽 지원

### 🎭 애니메이션
- **Typing Effect**: 동적인 타이핑 애니메이션 (Developer | Student | Learner | Creator)
- **Particle Background**: 인터랙티브 파티클 배경
- **Scroll Animations**: 부드러운 스크롤 애니메이션
- **Shimmer Effects**: 빛나는 카드 효과
- **3D Tilt**: 마우스 호버 3D 틸트 효과
- **Ripple Effects**: 버튼 클릭 리플 효과

### 🔧 기능
- **Contact Form**: Cloudflare Turnstile CAPTCHA + Resend API 이메일 전송
- **Keyboard Shortcuts**: 
  - `Alt + H`: Home 섹션으로 이동
  - `Alt + A`: About 섹션으로 이동
  - `Alt + S`: Skills 섹션으로 이동
  - `Alt + C`: Contact 섹션으로 이동
  - `ESC`: 모바일 메뉴 닫기
- **Back to Top**: 스크롤 상단 이동 버튼
- **Scroll Progress**: 페이지 스크롤 진행률 표시
- **Performance Monitoring**: 성능 최적화 (throttle, debounce)

### ♿ 접근성
- **Skip to Content**: 메인 콘텐츠로 바로 가기 링크
- **ARIA Labels**: 스크린 리더 지원
- **Keyboard Navigation**: 키보드 탐색 지원
- **Alt Text**: 모든 이미지에 대체 텍스트
- **Semantic HTML**: 의미론적 HTML 구조

### 🔒 보안
- **Cloudflare Turnstile**: 봇 방지 CAPTCHA
- **Honeypot Field**: 스팸 봇 감지
- **Rate Limiting**: 제출 속도 제한
- **HTML Escaping**: XSS 공격 방지
- **CORS Protection**: 허용된 Origin만 접근
- **Input Validation**: 클라이언트/서버 양측 검증

---

## 🛠️ Tech Stack

### Frontend
- **HTML5**: 시맨틱 마크업
- **CSS3**: Flexbox, Grid, Animations, Custom Properties
- **JavaScript (ES6+)**: Vanilla JS, Async/Await, Fetch API

### Backend
- **Cloudflare Workers**: Serverless 백엔드
- **Resend API**: 이메일 전송 서비스
- **Cloudflare Turnstile**: CAPTCHA 서비스

### Hosting & Deployment
- **GitHub Pages**: 정적 사이트 호스팅
- **Cloudflare DNS**: DNS 관리
- **Custom Domain**: taeyoon.kr

---

## 🚀 Quick Start

### 로컬 개발

1. **Clone Repository**
   ```bash
   git clone https://github.com/taeyoon0526/taeyoon.kr.git
   cd taeyoon.kr
   ```

2. **Open with Live Server**
   - VS Code에서 `index.html` 열기
   - Live Server 확장 설치
   - `index.html`에서 우클릭 → "Open with Live Server"

3. **Open Browser**
   - 자동으로 `http://127.0.0.1:5500`에서 열림
   - F12로 콘솔 열기 → 개발 모드 메시지 확인

> ⚠️ **로컬 환경 제한**: Turnstile은 `localhost`에서 작동하지 않습니다. 개발 모드에서는 더미 토큰을 사용하며, 이메일은 시뮬레이션됩니다.

### 프로덕션 배포

자세한 배포 가이드는 [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)를 참조하세요.

---

## 📧 Contact Form

### 개발 모드 vs 프로덕션

| 기능 | 개발 (localhost) | 프로덕션 (taeyoon.kr) |
|------|----------------|---------------------|
| Turnstile | ❌ 더미 토큰 | ✅ 정상 작동 |
| 이메일 전송 | 🔧 시뮬레이션 | ✅ 실제 전송 |
| 폼 검증 | ✅ 작동 | ✅ 작동 |

---

## 🐛 FAQ

**Q: 로컬에서 "CAPTCHA 인증에 실패했습니다" 오류**  
**A**: 정상입니다! 브라우저 콘솔을 열면 개발 모드 메시지를 확인할 수 있습니다.

**Q: 이메일이 전송되지 않음**  
**A**: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md#-문제-해결) 참조

---

## 📬 Contact

- **Website**: [taeyoon.kr](https://taeyoon.kr)
- **Email**: [me@taeyoon.kr](mailto:me@taeyoon.kr)
- **GitHub**: [@taeyoon0526](https://github.com/taeyoon0526)

---

<div align="center">

**Made with ❤️ by Taeyoon Kim**

⭐️ Star this repo if you like it!

</div>
