// ================================
// VISITOR COUNTER - 방문자 통계
// ================================

(function() {
  'use strict';

  // LocalStorage 키
  const STORAGE_KEYS = {
    TOTAL_VISITS: 'taeyoon_total_visits',
    TODAY_VISITS: 'taeyoon_today_visits',
    LAST_VISIT_DATE: 'taeyoon_last_visit_date',
    UNIQUE_VISITOR: 'taeyoon_unique_visitor',
    SESSION_START: 'taeyoon_session_start'
  };

  // DOM 요소
  const totalVisitsEl = document.getElementById('totalVisits');
  const todayVisitsEl = document.getElementById('todayVisits');
  const onlineNowEl = document.getElementById('onlineNow');

  // 오늘 날짜 (YYYY-MM-DD)
  function getTodayDate() {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  // 방문자 통계 초기화
  function initVisitorStats() {
    const today = getTodayDate();
    const lastVisitDate = localStorage.getItem(STORAGE_KEYS.LAST_VISIT_DATE);
    const isUniqueVisitor = !localStorage.getItem(STORAGE_KEYS.UNIQUE_VISITOR);
    const sessionStart = sessionStorage.getItem(STORAGE_KEYS.SESSION_START);
    const isNewSession = !sessionStart;

    // 총 방문 수
    let totalVisits = parseInt(localStorage.getItem(STORAGE_KEYS.TOTAL_VISITS) || '0', 10);
    
    // 오늘 방문 수
    let todayVisits = 0;
    
    // 날짜가 바뀌었으면 오늘 방문 수 초기화
    if (lastVisitDate !== today) {
      todayVisits = 0;
      localStorage.setItem(STORAGE_KEYS.LAST_VISIT_DATE, today);
    } else {
      todayVisits = parseInt(localStorage.getItem(STORAGE_KEYS.TODAY_VISITS) || '0', 10);
    }

    // 새 세션일 경우에만 카운트 증가 (페이지 새로고침 시 중복 방지)
    if (isNewSession) {
      totalVisits++;
      todayVisits++;
      
      // 세션 시작 시간 기록
      sessionStorage.setItem(STORAGE_KEYS.SESSION_START, Date.now().toString());
      
      // 고유 방문자 표시 (첫 방문)
      if (isUniqueVisitor) {
        localStorage.setItem(STORAGE_KEYS.UNIQUE_VISITOR, 'true');
        console.log('🎉 Welcome! First visit detected.');
      }
      
      // 저장
      localStorage.setItem(STORAGE_KEYS.TOTAL_VISITS, totalVisits.toString());
      localStorage.setItem(STORAGE_KEYS.TODAY_VISITS, todayVisits.toString());
    }

    // 화면에 표시
    updateVisitorDisplay(totalVisits, todayVisits);
    
    // Google Analytics로 전송 (설정되어 있다면)
    if (typeof gtag !== 'undefined' && isNewSession) {
      gtag('event', 'page_view', {
        'page_title': document.title,
        'page_location': window.location.href,
        'page_path': window.location.pathname
      });
    }
  }

  // 방문자 수 표시
  function updateVisitorDisplay(total, today) {
    if (totalVisitsEl) {
      animateNumber(totalVisitsEl, 0, total, 1000);
    }
    
    if (todayVisitsEl) {
      animateNumber(todayVisitsEl, 0, today, 800);
    }
    
    if (onlineNowEl) {
      // 현재 접속자 수는 간단한 추정치 (실제로는 서버 필요)
      // 오늘 방문자의 5-10% 정도가 동시 접속 중이라고 가정
      const estimatedOnline = Math.max(1, Math.floor(today * (Math.random() * 0.05 + 0.05)));
      animateNumber(onlineNowEl, 0, estimatedOnline, 600);
    }
  }

  // 숫자 애니메이션 효과
  function animateNumber(element, start, end, duration) {
    const range = end - start;
    const increment = range / (duration / 16); // 60fps
    let current = start;
    
    const timer = setInterval(() => {
      current += increment;
      
      if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
        current = end;
        clearInterval(timer);
      }
      
      element.textContent = formatNumber(Math.floor(current));
    }, 16);
  }

  // 숫자 포맷팅 (1,234 형식)
  function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // 실시간 방문자 수 업데이트 (시뮬레이션)
  function updateOnlineCount() {
    if (!onlineNowEl) return;
    
    setInterval(() => {
      const currentOnline = parseInt(onlineNowEl.textContent.replace(/,/g, ''), 10);
      // ±1 범위에서 랜덤하게 변동
      const change = Math.random() > 0.5 ? 1 : -1;
      const newOnline = Math.max(1, currentOnline + (Math.random() > 0.7 ? change : 0));
      
      onlineNowEl.textContent = formatNumber(newOnline);
    }, 10000); // 10초마다 업데이트
  }

  // 페이지 이탈 시 세션 종료 시간 기록
  window.addEventListener('beforeunload', () => {
    const sessionStart = parseInt(sessionStorage.getItem(STORAGE_KEYS.SESSION_START) || '0', 10);
    if (sessionStart > 0) {
      const duration = Date.now() - sessionStart;
      
      // Google Analytics로 세션 시간 전송
      if (typeof gtag !== 'undefined') {
        gtag('event', 'session_duration', {
          'value': Math.floor(duration / 1000), // 초 단위
          'event_category': 'engagement'
        });
      }
      
      console.log(`📊 Session duration: ${Math.floor(duration / 1000)} seconds`);
    }
  });

  // 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initVisitorStats();
      updateOnlineCount();
    });
  } else {
    initVisitorStats();
    updateOnlineCount();
  }

  // 디버그 정보 출력
  console.log('📈 Visitor Counter initialized');
  console.log(`   Total Visits: ${localStorage.getItem(STORAGE_KEYS.TOTAL_VISITS) || '0'}`);
  console.log(`   Today Visits: ${localStorage.getItem(STORAGE_KEYS.TODAY_VISITS) || '0'}`);
  console.log(`   Last Visit: ${localStorage.getItem(STORAGE_KEYS.LAST_VISIT_DATE) || 'Never'}`);

})();
