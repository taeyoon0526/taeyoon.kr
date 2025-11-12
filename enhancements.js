// ================================
// ENHANCEMENTS.JS - 추가 기능 스크립트 (모바일 최적화)
// ================================

(function() {
  'use strict';

  // 모바일 감지
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 768;
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  if (isTouch) {
    document.documentElement.classList.add('is-touch');
    if (document.body) {
      document.body.classList.add('is-touch');
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.classList.add('is-touch');
      }, { once: true });
    }
  }

  // 1. 스크롤 진행률 표시
  function updateScrollProgress() {
    const scrollProgress = document.querySelector('.scroll-progress');
    if (!scrollProgress) return;
    
    const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrolled = (window.pageYOffset / windowHeight) * 100;
    scrollProgress.style.width = scrolled + '%';
  }

  // 스크롤 이벤트 - 모바일 최적화
  let scrollTimeout;
  const handleScroll = function() {
    if (scrollTimeout) {
      window.cancelAnimationFrame(scrollTimeout);
    }
    scrollTimeout = window.requestAnimationFrame(function() {
      updateScrollProgress();
      updateActiveNavLink();
    });
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  // 터치 스크롤도 감지
  if (isTouch) {
    window.addEventListener('touchmove', handleScroll, { passive: true });
  }
  updateScrollProgress();

  // 2. 활성 네비게이션 링크 표시
  function updateActiveNavLink() {
    const sections = document.querySelectorAll('.section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    
    if (sections.length === 0 || navLinks.length === 0) return;
    
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

  updateActiveNavLink();

  // 3. Intersection Observer로 섹션 애니메이션 (모바일 최적화)
  if ('IntersectionObserver' in window) {
    const observerOptions = {
      threshold: isMobile ? 0.05 : 0.1, // 모바일에서 더 빨리 트리거
      rootMargin: isMobile ? '0px 0px -50px 0px' : '0px 0px -100px 0px'
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
            }, index * (isMobile ? 50 : 100)); // 모바일에서 더 빠르게
          });
        }
      });
    }, observerOptions);

    // 섹션 관찰 시작
    document.querySelectorAll('.section').forEach(section => {
      sectionObserver.observe(section);
    });
  } else {
    // Intersection Observer 미지원 시 모든 섹션 표시
    document.querySelectorAll('.section').forEach(section => {
      section.classList.add('visible');
    });
  }

  // 4. 이미지 Lazy Loading (모바일 최적화)
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.classList.add('loaded');
            imageObserver.unobserve(img);
          } else {
            img.classList.add('loaded');
            imageObserver.unobserve(img);
          }
        }
      });
    }, {
      rootMargin: isMobile ? '50px' : '100px' // 모바일에서 더 빨리 로드
    });

    document.querySelectorAll('img').forEach(img => {
      imageObserver.observe(img);
    });
  } else {
    // Fallback: 모든 이미지 즉시 로드
    document.querySelectorAll('img').forEach(img => {
      img.classList.add('loaded');
    });
  }

  // 5. 툴팁 기능 (모바일에서는 터치 이벤트)
  function initTooltips() {
    const tooltipElements = document.querySelectorAll('[data-tooltip]');
    
    tooltipElements.forEach(el => {
      if (isTouch) {
        // 모바일: 터치 이벤트
        el.addEventListener('touchstart', function(e) {
          const tooltip = this.getAttribute('data-tooltip');
          if (!tooltip) return;

          this.classList.add('touch-active');
          this.setAttribute('aria-label', tooltip);
        }, { passive: true });

        const clearTouchState = () => {
          el.classList.remove('touch-active');
        };

        el.addEventListener('touchend', clearTouchState);
        el.addEventListener('touchcancel', clearTouchState);
      } else {
        // 데스크톱: 마우스 이벤트
        el.addEventListener('mouseenter', function() {
          const tooltip = this.getAttribute('data-tooltip');
          if (tooltip) {
            this.setAttribute('aria-label', tooltip);
          }
        });
      }
    });
  }

  initTooltips();

  function enableTouchHoverFallback() {
    if (!isTouch) return;

    const selectors = [
      '.btn',
      '.btn-submit',
      '.nav-link',
      '.skill-card',
      '.project-card',
      '.project-link',
      '.contact-item',
      '.theme-toggle',
      '.skill-tab',
      '.social-links a',
      '.stat-item',
      '.tooltip',
      '.image-placeholder',
      '.project-tags .tag',
      '#back-to-top'
    ];

    const touchTargets = document.querySelectorAll(selectors.join(', '));
    const removeActiveFromAll = () => {
      touchTargets.forEach(target => target.classList.remove('touch-active'));
    };

    touchTargets.forEach(target => {
      target.addEventListener('touchstart', (event) => {
        removeActiveFromAll();
        target.classList.add('touch-active');
      }, { passive: true });

      const clear = () => {
        target.classList.remove('touch-active');
      };

      target.addEventListener('touchend', clear);
      target.addEventListener('touchcancel', clear);
    });

    window.addEventListener('scroll', removeActiveFromAll, { passive: true });
  }

  // 6. 키보드 단축키 (데스크톱만)
  if (!isMobile) {
    document.addEventListener('keydown', (e) => {
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
          if (hamburger) hamburger.classList.remove('active');
        }
      }
    });
  }

  // 7. 키보드 단축키 도움말 (데스크톱만)
  function showKeyboardShortcuts() {
    if (isMobile) return;
    
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

  // 8. 성능 모니터링 (개발 모드만)
  function initPerformanceMonitor() {
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.get('debug')) return;
    
    const monitor = document.createElement('div');
    monitor.className = 'perf-monitor show';
    monitor.style.cssText = `
      position: fixed;
      bottom: 1rem;
      left: 1rem;
      background: rgba(0, 0, 0, 0.9);
      color: #0f0;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-family: monospace;
      font-size: 0.75rem;
      z-index: 9998;
    `;
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

  // 9. 스크롤 방향 감지 (모바일 최적화)
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

  // 12. 콘솔 메시지
  function showEasterEgg() {
    if (isMobile) {
      console.log('🎨 Taeyoon Portfolio - Mobile Version');
      console.log('📱 https://taeyoon.kr');
    } else {
      const art = `
    ╔═══════════════════════════════════════╗
    ║                                       ║
    ║   🎨 Taeyoon's Portfolio Website     ║
    ║                                       ║
    ║   Thanks for checking the console!   ║
    ║   Made with ❤️ by Taeyoon Kim        ║
    ║                                       ║
    ║   Website: https://taeyoon.kr        ║
    ║   Email: me@taeyoon.kr               ║
    ║                                       ║
    ╚═══════════════════════════════════════╝
    `;
      
      console.log('%c' + art, 'color: #4a90e2; font-family: monospace;');
    }
    
    if (!isMobile) {
      console.log('%c🚀 Tip: Add ?debug=true to URL for performance monitor', 'color: #2ecc71; font-weight: bold;');
      console.log('%c⌨️  Press Ctrl+/ for keyboard shortcuts', 'color: #f39c12; font-weight: bold;');
    }
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

  // 15. 클립보드 복사 (데스크톱 & 모바일)
  function enableCopyFeatures() {
    const copyableElements = document.querySelectorAll('[data-copy]');
    
    copyableElements.forEach(el => {
      el.style.cursor = 'pointer';
      el.setAttribute('title', 'Click to copy');
      
      const handleCopy = async function(e) {
        e.preventDefault();
        const textToCopy = this.getAttribute('data-copy') || this.textContent;
        
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(textToCopy);
            showCopyNotification();
          } else {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
              document.execCommand('copy');
              showCopyNotification();
            } catch (err) {
              console.error('Fallback copy failed:', err);
            }
            
            document.body.removeChild(textArea);
          }
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      };
      
      if (isTouch) {
        el.addEventListener('touchend', handleCopy, { passive: false });
      } else {
        el.addEventListener('click', handleCopy);
      }
    });
  }

  function showCopyNotification() {
    const notification = document.createElement('div');
    notification.textContent = '✓ Copied!';
    notification.style.cssText = `
      position: fixed;
      bottom: ${isMobile ? '5rem' : '2rem'};
      right: 50%;
      transform: translateX(50%);
      background: #2ecc71;
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-weight: 600;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(46, 204, 113, 0.4);
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(50%) translateY(20px)';
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

  // 초기화 - DOM 로드 후 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeEnhancements);
  } else {
    initializeEnhancements();
  }

  function initializeEnhancements() {
    console.log('🎨 Enhancements initializing... (Mobile: ' + isMobile + ')');
    
    autoThemeSwitcher();
    optimizeForConnection();
    showEasterEgg();
    enhanceFormValidation();
    enableCopyFeatures();
    initPerformanceMonitor();
    enableTouchHoverFallback();
    
    if (!isMobile) {
      estimateReadingTime();
      enableScrollSnap();
    }
    
    console.log('✅ Enhancements loaded successfully!');
  }

})();

// 애니메이션 CSS (자동 추가)
if (!document.getElementById('enhancement-animations')) {
  const animationStyles = document.createElement('style');
  animationStyles.id = 'enhancement-animations';
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
    
    /* 모바일 터치 최적화 */
    @media (max-width: 768px) {
      * {
        -webkit-tap-highlight-color: rgba(74, 144, 226, 0.2);
      }
      
      a, button, .btn, .nav-link {
        -webkit-touch-callout: none;
      }
    }
  `;
  document.head.appendChild(animationStyles);
}
