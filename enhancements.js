// ================================
// ENHANCEMENTS.JS - 추가 기능 스크립트
// ================================

(function() {
  'use strict';

  // 1. 스크롤 진행률 표시
  function updateScrollProgress() {
    const scrollProgress = document.querySelector('.scroll-progress');
    if (!scrollProgress) return;
    
    const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrolled = (window.pageYOffset / windowHeight) * 100;
    scrollProgress.style.width = scrolled + '%';
  }

  window.addEventListener('scroll', updateScrollProgress, { passive: true });
  updateScrollProgress();

  // 2. 활성 네비게이션 링크 표시
  function updateActiveNavLink() {
    const sections = document.querySelectorAll('.section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    
    let currentSection = '';
    const scrollY = window.pageYOffset;
    
    sections.forEach(section => {
      const sectionTop = section.offsetTop - 100;
      const sectionHeight = section.offsetHeight;
      
      if (scrollY >= sectionTop && scrollY < sectionTop + sectionHeight) {
        currentSection = section.getAttribute('id');
      }
    });
    
    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${currentSection}`) {
        link.classList.add('active');
      }
    });
  }

  window.addEventListener('scroll', updateActiveNavLink, { passive: true });
  updateActiveNavLink();

  // 3. Intersection Observer로 섹션 애니메이션
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px'
  };

  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        
        // 섹션 내부 요소들 순차 애니메이션
        const elements = entry.target.querySelectorAll('.fade-in-up, .fade-in-left, .fade-in-right');
        elements.forEach((el, index) => {
          setTimeout(() => {
            el.classList.add('visible');
          }, index * 100);
        });
      }
    });
  }, observerOptions);

  // 섹션 관찰 시작
  document.querySelectorAll('.section').forEach(section => {
    sectionObserver.observe(section);
  });

  // 4. 이미지 Lazy Loading with Blur Effect
  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        
        if (img.dataset.src) {
          // 저해상도 이미지에서 고해상도 이미지로 전환
          img.src = img.dataset.src;
          img.classList.add('loaded');
          imageObserver.unobserve(img);
        } else {
          img.classList.add('loaded');
          imageObserver.unobserve(img);
        }
      }
    });
  });

  document.querySelectorAll('img').forEach(img => {
    imageObserver.observe(img);
  });

  // 5. 툴팁 기능 강화
  function initTooltips() {
    const tooltipElements = document.querySelectorAll('[data-tooltip]');
    
    tooltipElements.forEach(el => {
      el.addEventListener('mouseenter', function() {
        const tooltip = this.getAttribute('data-tooltip');
        if (!tooltip) return;
        
        // 접근성을 위한 aria-label 추가
        this.setAttribute('aria-label', tooltip);
      });
    });
  }

  initTooltips();

  // 6. 키보드 단축키 확장
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + K: 검색 (향후 확장)
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      console.log('Search functionality - coming soon!');
    }
    
    // Ctrl/Cmd + /: 키보드 단축키 도움말
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      showKeyboardShortcuts();
    }
    
    // Esc: 메뉴 닫기
    if (e.key === 'Escape') {
      const navMenu = document.querySelector('.nav-menu');
      const hamburger = document.querySelector('.hamburger');
      
      if (navMenu && navMenu.classList.contains('active')) {
        navMenu.classList.remove('active');
        hamburger?.classList.remove('active');
      }
    }
  });

  // 7. 키보드 단축키 도움말 표시
  function showKeyboardShortcuts() {
    const shortcuts = `
      🎯 키보드 단축키:
      
      Alt + H  →  Home 섹션으로 이동
      Alt + A  →  About 섹션으로 이동
      Alt + S  →  Skills 섹션으로 이동
      Alt + C  →  Contact 섹션으로 이동
      
      Ctrl + /  →  이 도움말 표시
      Esc       →  메뉴 닫기
    `;
    
    alert(shortcuts);
  }

  // 8. 성능 모니터링 (개발 모드)
  function initPerformanceMonitor() {
    // URL에 ?debug=true가 있을 때만 표시
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.get('debug')) return;
    
    const monitor = document.createElement('div');
    monitor.className = 'perf-monitor show';
    document.body.appendChild(monitor);
    
    function updatePerfMonitor() {
      const fps = calculateFPS();
      const memory = performance.memory ? 
        (performance.memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB' : 
        'N/A';
      
      monitor.innerHTML = `
        FPS: ${fps} | 
        Memory: ${memory} | 
        Scroll: ${Math.round(window.pageYOffset)}px
      `;
    }
    
    let lastTime = performance.now();
    let frames = 0;
    let fps = 60;
    
    function calculateFPS() {
      frames++;
      const currentTime = performance.now();
      
      if (currentTime >= lastTime + 1000) {
        fps = Math.round((frames * 1000) / (currentTime - lastTime));
        frames = 0;
        lastTime = currentTime;
      }
      
      requestAnimationFrame(calculateFPS);
      return fps;
    }
    
    calculateFPS();
    setInterval(updatePerfMonitor, 100);
  }

  // 9. 스크롤 방향 감지 (네비게이션 숨김/표시)
  let lastScrollY = window.pageYOffset;
  let ticking = false;

  function updateNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    
    const currentScrollY = window.pageYOffset;
    
    if (currentScrollY > 100) {
      if (currentScrollY > lastScrollY) {
        // 아래로 스크롤 - 네비바 숨김
        navbar.style.transform = 'translateY(-100%)';
      } else {
        // 위로 스크롤 - 네비바 표시
        navbar.style.transform = 'translateY(0)';
      }
    } else {
      navbar.style.transform = 'translateY(0)';
    }
    
    lastScrollY = currentScrollY;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(updateNavbar);
      ticking = true;
    }
  }, { passive: true });

  // 10. 다크 모드 자동 전환 (시간 기반)
  function autoThemeSwitcher() {
    // 사용자가 수동으로 설정하지 않은 경우에만 실행
    const userPreference = localStorage.getItem('theme-user-set');
    if (userPreference) return;
    
    const hour = new Date().getHours();
    const body = document.body;
    
    // 오후 6시 ~ 오전 6시: 다크 모드
    // 오전 6시 ~ 오후 6시: 라이트 모드
    const suggestedTheme = (hour >= 18 || hour < 6) ? 'dark' : 'light';
    const currentTheme = body.getAttribute('data-theme');
    
    if (currentTheme !== suggestedTheme) {
      console.log(`💡 시간 기반 테마 제안: ${suggestedTheme} 모드`);
      // 자동 전환은 하지 않고, 콘솔에만 로그 (사용자 선택 존중)
    }
  }

  // 11. 연결 속도 감지 및 최적화
  function optimizeForConnection() {
    if (!('connection' in navigator)) return;
    
    const connection = navigator.connection;
    const effectiveType = connection.effectiveType;
    
    // 느린 연결일 경우 파티클 수 줄이기
    if (effectiveType === 'slow-2g' || effectiveType === '2g') {
      console.log('🐌 느린 연결 감지 - 성능 최적화 모드');
      
      // 파티클 캔버스 비활성화
      const canvas = document.getElementById('particle-canvas');
      if (canvas) {
        canvas.style.display = 'none';
      }
      
      // 애니메이션 감소
      document.body.classList.add('reduced-animations');
    }
  }

  // 12. 이스터 에그 - 콘솔 아트
  function showEasterEgg() {
    const art = `
    ╔═══════════════════════════════════════╗
    ║                                       ║
    ║   🎨 Taeyoon's Portfolio Website     ║
    ║                                       ║
    ║   Thanks for checking the console!   ║
    ║   Made with ❤️ by Taeyoon Kim        ║
    ║                                       ║
    ║   GitHub: taeyoon0526                 ║
    ║   Website: https://taeyoon.kr        ║
    ║                                       ║
    ╚═══════════════════════════════════════╝
    `;
    
    console.log('%c' + art, 'color: #4a90e2; font-family: monospace;');
    console.log('%c🚀 Tip: Add ?debug=true to URL for performance monitor', 'color: #2ecc71; font-weight: bold;');
    console.log('%c⌨️  Press Ctrl+/ for keyboard shortcuts', 'color: #f39c12; font-weight: bold;');
  }

  // 13. 폼 검증 개선
  function enhanceFormValidation() {
    const form = document.getElementById('contact-form');
    if (!form) return;
    
    const inputs = form.querySelectorAll('input, textarea');
    
    inputs.forEach(input => {
      // 실시간 검증 피드백
      input.addEventListener('blur', function() {
        validateField(this);
      });
      
      // 입력 중 에러 제거
      input.addEventListener('input', function() {
        if (this.classList.contains('error')) {
          this.classList.remove('error');
        }
      });
    });
  }

  function validateField(field) {
    const value = field.value.trim();
    const type = field.type;
    let isValid = true;
    
    if (field.hasAttribute('required') && !value) {
      isValid = false;
    }
    
    if (type === 'email' && value) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      isValid = emailRegex.test(value);
    }
    
    if (!isValid) {
      field.classList.add('error');
    } else {
      field.classList.remove('error');
    }
    
    return isValid;
  }

  // 14. 읽기 시간 예측
  function estimateReadingTime() {
    const textElements = document.querySelectorAll('.about-card p, .section-description');
    let totalWords = 0;
    
    textElements.forEach(el => {
      const text = el.textContent;
      const words = text.trim().split(/\s+/).length;
      totalWords += words;
    });
    
    // 평균 읽기 속도: 200단어/분
    const readingTime = Math.ceil(totalWords / 200);
    console.log(`📖 예상 읽기 시간: 약 ${readingTime}분`);
  }

  // 15. 클립보드 복사 기능 (이메일 등)
  function enableCopyFeatures() {
    const copyableElements = document.querySelectorAll('[data-copy]');
    
    copyableElements.forEach(el => {
      el.style.cursor = 'pointer';
      el.setAttribute('title', 'Click to copy');
      
      el.addEventListener('click', async function() {
        const textToCopy = this.getAttribute('data-copy') || this.textContent;
        
        try {
          await navigator.clipboard.writeText(textToCopy);
          showCopyNotification(this);
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      });
    });
  }

  function showCopyNotification(element) {
    const notification = document.createElement('div');
    notification.textContent = '✓ Copied!';
    notification.style.cssText = `
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: #2ecc71;
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-weight: 600;
      z-index: 10000;
      animation: slideInUp 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOutDown 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  }

  // 16. 스크롤 스냅 (섹션별 자동 정렬) - 선택적 기능
  function enableScrollSnap() {
    // URL 파라미터로 활성화: ?snap=true
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.get('snap')) return;
    
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => {
      section.style.scrollSnapAlign = 'start';
    });
    
    document.documentElement.style.scrollSnapType = 'y proximity';
    console.log('📍 Scroll snap enabled');
  }

  // 초기화 함수들 실행
  window.addEventListener('load', () => {
    autoThemeSwitcher();
    optimizeForConnection();
    showEasterEgg();
    enhanceFormValidation();
    estimateReadingTime();
    enableCopyFeatures();
    enableScrollSnap();
    initPerformanceMonitor();
  });

  // 디버그 정보 출력
  if (window.location.search.includes('debug')) {
    console.log('🔧 Debug mode enabled');
    console.log('📊 Page load time:', performance.now() + 'ms');
  }

})();

// 애니메이션 CSS 추가 (복사 알림용)
const animationStyles = document.createElement('style');
animationStyles.textContent = `
  @keyframes slideInUp {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOutDown {
    from {
      transform: translateY(0);
      opacity: 1;
    }
    to {
      transform: translateY(100%);
      opacity: 0;
    }
  }
  
  .reduced-animations * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
  
  .form-group input.error,
  .form-group textarea.error {
    border-color: #e74c3c !important;
    box-shadow: 0 0 0 3px rgba(231, 76, 60, 0.2) !important;
  }
  
  .navbar {
    transition: transform 0.3s ease;
  }
`;
document.head.appendChild(animationStyles);
