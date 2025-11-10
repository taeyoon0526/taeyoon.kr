(() => {
  const API_ENDPOINT = 'https://contact.taeyoon.kr/api/visitors';
  const REFRESH_INTERVAL_MS = 60_000;

  const state = {
    visitors: [],
    summary: null,
    filters: {
      country: '',
      page: '',
      date: '',
    },
    options: {
      countries: new Set(),
      pages: new Set(),
    },
  };

  const elements = {
    statusBar: document.getElementById('statusBar'),
    loadingIndicator: document.getElementById('loadingIndicator'),
    totalVisitors: document.getElementById('totalVisitorsValue'),
    uniqueSessions: document.getElementById('uniqueSessionsValue'),
    averageDuration: document.getElementById('averageDurationValue'),
    averageLoadTime: document.getElementById('averageLoadTimeValue'),
    topCountriesList: document.getElementById('topCountriesList'),
    lastUpdated: document.getElementById('lastUpdated'),
    tableBody: document.getElementById('visitorTableBody'),
    emptyState: document.getElementById('emptyState'),
    filterForm: document.getElementById('filterForm'),
    filterToggle: document.getElementById('filterToggleBtn'),
    countrySelect: document.getElementById('filterCountry'),
    pageSelect: document.getElementById('filterPage'),
    dateInput: document.getElementById('filterDate'),
    refreshBtn: document.getElementById('refreshBtn'),
    exportBtn: document.getElementById('exportBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    resultCount: document.getElementById('resultCount'),
  };

  function setStatus(message, tone = 'info') {
    if (!elements.statusBar) return;
    if (!message) {
      elements.statusBar.textContent = '';
      elements.statusBar.classList.remove('show', 'error');
      return;
    }
    elements.statusBar.textContent = message;
    elements.statusBar.classList.add('show');
    if (tone === 'error') {
      elements.statusBar.classList.add('error');
    } else {
      elements.statusBar.classList.remove('error');
    }
  }

  function toggleLoading(isLoading) {
    if (!elements.loadingIndicator) return;
    if (isLoading) {
      elements.loadingIndicator.classList.add('show');
    } else {
      elements.loadingIndicator.classList.remove('show');
    }
    if (elements.refreshBtn) elements.refreshBtn.disabled = isLoading;
  }

  function countryToFlag(code) {
    if (!code || code.length !== 2) return '🌐';
    const base = 127397;
    const upper = code.toUpperCase();
    return String.fromCodePoint(upper.charCodeAt(0) + base, upper.charCodeAt(1) + base);
  }

  function formatDuration(seconds) {
    if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds <= 0) {
      return '—';
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  function formatPerformance(milliseconds) {
    if (typeof milliseconds !== 'number' || Number.isNaN(milliseconds) || milliseconds <= 0) {
      return '—';
    }
    if (milliseconds < 1000) {
      return Math.round(milliseconds) + 'ms';
    }
    return (milliseconds / 1000).toFixed(2) + 's';
  }

  function formatDateTime(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(date);
  }

  function formatReferrer(url) {
    if (!url) return '직접 방문';
    try {
      const parsed = new URL(url);
      return parsed.hostname + parsed.pathname;
    } catch (_) {
      return url;
    }
  }

  function createElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === 'string') el.textContent = text;
    return el;
  }

  function renderSummary() {
    if (!state.summary) return;
    if (elements.totalVisitors) {
      elements.totalVisitors.textContent = state.summary.totalVisitors.toLocaleString();
    }
    if (elements.uniqueSessions) {
      elements.uniqueSessions.textContent = state.summary.uniqueSessions.toLocaleString();
    }
    if (elements.averageDuration) {
      elements.averageDuration.textContent = formatDuration(Math.round(state.summary.averageDuration));
    }
    if (elements.averageLoadTime) {
      elements.averageLoadTime.textContent = formatPerformance(state.summary.averageLoadTime);
    }
    if (elements.topCountriesList) {
      elements.topCountriesList.innerHTML = '';
      if (!state.summary.topCountries.length) {
        const item = createElement('li', null, '데이터 없음');
        elements.topCountriesList.appendChild(item);
      } else {
        state.summary.topCountries.forEach((entry) => {
          const li = document.createElement('li');
          const left = document.createElement('span');
          left.textContent = countryToFlag(entry.country) + ' ' + (entry.country || '기타');
          const right = createElement('span', null, entry.count.toLocaleString() + '회');
          li.append(left, right);
          elements.topCountriesList.appendChild(li);
        });
      }
    }
    if (elements.lastUpdated) {
      elements.lastUpdated.textContent = '최근 업데이트: ' + formatDateTime(new Date().toISOString());
    }
  }

  function renderEmptyState() {
    if (!elements.emptyState) return;
    const hasData = state.visitors.length > 0;
    elements.emptyState.hidden = hasData;
  }

  function setFilterFormVisibility(expanded) {
    if (!elements.filterForm || !elements.filterToggle) return;
    if (expanded) {
      elements.filterForm.classList.remove('collapsed');
      elements.filterToggle.setAttribute('aria-expanded', 'true');
      elements.filterToggle.textContent = '필터 접기';
    } else {
      elements.filterForm.classList.add('collapsed');
      elements.filterToggle.setAttribute('aria-expanded', 'false');
      elements.filterToggle.textContent = '필터 열기';
    }
  }

  function initResponsiveFilters() {
    if (!elements.filterToggle || !elements.filterForm) return;
    const mediaQuery = window.matchMedia('(max-width: 640px)');

    const handleChange = (event) => {
      if (event.matches) {
        setFilterFormVisibility(false);
      } else {
        setFilterFormVisibility(true);
      }
    };

    handleChange(mediaQuery);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    elements.filterToggle.addEventListener('click', () => {
      const isExpanded = !elements.filterForm.classList.contains('collapsed');
      setFilterFormVisibility(!isExpanded);
    });
  }

  function createEventBadge(eventType) {
    const badge = createElement('span', 'event-pill event-' + eventType, eventType);
    return badge;
  }

  function createDeviceChip(device) {
    const normalized = (device || 'unknown').toLowerCase();
    const map = {
      desktop: { label: '데스크톱', icon: '🖥️' },
      mobile: { label: '모바일', icon: '📱' },
      tablet: { label: '태블릿', icon: '📘' },
    };
    const info = map[normalized] || { label: '기타', icon: '🌐' };
    const chip = createElement('span', 'device-chip ' + normalized, info.icon + ' ' + info.label);
    return chip;
  }

  function renderTable() {
    if (!elements.tableBody) return;
    elements.tableBody.innerHTML = '';

    if (!state.visitors.length) {
      if (elements.resultCount) elements.resultCount.textContent = '0개 결과';
      renderEmptyState();
      return;
    }

    state.visitors.forEach((record) => {
      const tr = document.createElement('tr');

      const eventCell = createElement('td');
      eventCell.appendChild(createEventBadge(record.event));
      eventCell.dataset.label = '이벤트';

      const ipCell = createElement('td', 'mono-cell', record.ip || '—');
      ipCell.dataset.label = 'IP';

      const countryCell = createElement('td');
      const flag = createElement('span', 'country-flag', countryToFlag(record.country));
      const code = createElement('span', null, record.country || '—');
      countryCell.append(flag, code);
      countryCell.dataset.label = '국가';

      const deviceCell = createElement('td');
      deviceCell.appendChild(createDeviceChip(record.device));
      deviceCell.dataset.label = '기기';

      const pageCell = createElement('td');
      pageCell.appendChild(createElement('a', null, record.url || '—'));
      pageCell.firstChild.href = record.url || '#';
      pageCell.firstChild.target = '_blank';
      pageCell.firstChild.rel = 'noreferrer';
      pageCell.firstChild.classList.add('link-inline');
      pageCell.dataset.label = '페이지';

      const durationCell = createElement('td', 'mono-cell', formatDuration(record.duration));
      durationCell.dataset.label = '체류시간';

      const pageLoadCell = createElement('td', 'mono-cell', formatPerformance(record.performance?.pageLoadTime));
      const domReadyCell = createElement('td', 'mono-cell', formatPerformance(record.performance?.domReadyTime));
      pageLoadCell.dataset.label = '페이지 로드';
      domReadyCell.dataset.label = 'DOM 준비';

      const referrerCell = createElement('td', null, formatReferrer(record.referrer));
      referrerCell.dataset.label = '리퍼러';

      const uaCell = createElement('td');
      uaCell.textContent = record.ua || '—';
      uaCell.dataset.label = 'User Agent';

      const timeCell = createElement('td', 'mono-cell', formatDateTime(record.time));
      timeCell.dataset.label = '시간';

      tr.append(eventCell, ipCell, countryCell, deviceCell, pageCell, durationCell, pageLoadCell, domReadyCell, referrerCell, uaCell, timeCell);
      elements.tableBody.appendChild(tr);
    });

    if (elements.resultCount) {
      elements.resultCount.textContent = state.visitors.length.toLocaleString() + '개 결과';
    }

    renderEmptyState();
  }

  function populateFilterOptions() {
    if (!state.visitors.length) return;

    state.options.countries = new Set();
    state.options.pages = new Set();

    state.visitors.forEach((record) => {
      if (record.country) state.options.countries.add(record.country);
      if (record.url) state.options.pages.add(record.url);
    });

    if (elements.countrySelect) {
      const current = state.filters.country;
      elements.countrySelect.innerHTML = '<option value="">모든 국가</option>';
      Array.from(state.options.countries)
        .sort()
        .forEach((country) => {
          const option = createElement('option', null, country);
          option.value = country;
          if (country === current) option.selected = true;
          elements.countrySelect.appendChild(option);
        });
    }

    if (elements.pageSelect) {
      const currentPage = state.filters.page;
      elements.pageSelect.innerHTML = '<option value="">모든 페이지</option>';
      Array.from(state.options.pages)
        .sort()
        .forEach((page) => {
          const option = createElement('option', null, page);
          option.value = page;
          if (page === currentPage) option.selected = true;
          elements.pageSelect.appendChild(option);
        });
    }
  }

  function buildQueryParams() {
    const params = new URLSearchParams();
    if (state.filters.country) params.set('country', state.filters.country);
    if (state.filters.page) params.set('page', state.filters.page);
    if (state.filters.date) params.set('date', state.filters.date);
    return params;
  }

  async function loadVisitors(showStatus = false) {
    toggleLoading(true);
    setStatus('방문 데이터를 불러오는 중입니다...');

    try {
      const url = new URL(API_ENDPOINT, window.location.origin);
      const params = buildQueryParams();
      params.forEach((value, key) => url.searchParams.set(key, value));

      const response = await fetch(url.toString(), {
        credentials: 'include',
        cache: 'no-store',
      });

      if (response.status === 401) {
        window.location.href = 'https://contact.taeyoon.kr/visitor?auth=required';
        return;
      }

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      const payload = await response.json();
      state.visitors = payload.visitors || [];
      state.summary = payload.summary || null;

      populateFilterOptions();
      renderSummary();
      renderTable();

      if (showStatus && window.matchMedia('(max-width: 640px)').matches) {
        setFilterFormVisibility(false);
      }

      if (showStatus) {
        setStatus('총 ' + state.visitors.length.toLocaleString() + '개의 레코드를 불러왔습니다.');
      } else {
        setStatus('');
      }
    } catch (error) {
      console.error('Failed to load visitors:', error);
      setStatus('데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 'error');
    } finally {
      toggleLoading(false);
    }
  }

  function exportCsv() {
    if (!state.visitors.length) {
      setStatus('내보낼 데이터가 없습니다.', 'error');
      return;
    }

    const columns = [
      { header: 'event', accessor: 'event' },
      { header: 'sessionId', accessor: 'sessionId' },
      { header: 'ip', accessor: 'ip' },
      { header: 'country', accessor: 'country' },
      { header: 'device', accessor: 'device' },
      { header: 'url', accessor: 'url' },
      { header: 'duration', accessor: 'duration' },
      { header: 'referrer', accessor: 'referrer' },
      { header: 'userAgent', accessor: 'ua' },
      { header: 'time', accessor: 'time' },
      { header: 'pageLoadTime', accessor: 'performance.pageLoadTime' },
      { header: 'domReadyTime', accessor: 'performance.domReadyTime' },
      { header: 'dnsTime', accessor: 'performance.dnsTime' },
      { header: 'tcpTime', accessor: 'performance.tcpTime' },
      { header: 'requestTime', accessor: 'performance.requestTime' },
      { header: 'renderTime', accessor: 'performance.renderTime' },
    ];

    const rows = state.visitors.map((record) => {
      return columns.map(({ accessor }) => {
        const value = accessor.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : ''), record);
        const normalized = typeof value === 'number' ? String(value) : value || '';
        return '"' + String(normalized).replaceAll('"', '""') + '"';
      }).join(',');
    });

    const csvContent = [columns.map((col) => col.header).join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
    link.href = url;
    link.setAttribute('download', 'taeyoon-visitors-' + timestamp + '.csv');
    link.click();
    URL.revokeObjectURL(url);
    setStatus('CSV 파일로 내보냈습니다.');
  }

  async function handleLogout() {
    try {
      const response = await fetch('https://contact.taeyoon.kr/visitor/logout', {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        window.location.href = 'https://contact.taeyoon.kr/visitor';
      } else {
        setStatus('로그아웃에 실패했습니다.', 'error');
      }
    } catch (error) {
      console.error('Logout failed:', error);
      setStatus('로그아웃 요청 중 오류가 발생했습니다.', 'error');
    }
  }

  function initEventListeners() {
    if (elements.filterForm) {
      elements.filterForm.addEventListener('submit', (event) => {
        event.preventDefault();
        state.filters.country = elements.countrySelect ? elements.countrySelect.value : '';
        state.filters.page = elements.pageSelect ? elements.pageSelect.value : '';
        state.filters.date = elements.dateInput ? elements.dateInput.value : '';
        loadVisitors(true);
      });

      elements.filterForm.addEventListener('reset', () => {
        state.filters.country = '';
        state.filters.page = '';
        state.filters.date = '';
        window.setTimeout(() => loadVisitors(true), 0);
      });
    }

    if (elements.refreshBtn) {
      elements.refreshBtn.addEventListener('click', () => loadVisitors(true));
    }

    if (elements.exportBtn) {
      elements.exportBtn.addEventListener('click', exportCsv);
    }

    if (elements.logoutBtn) {
      elements.logoutBtn.addEventListener('click', handleLogout);
    }
  }

  function initAutoRefresh() {
    window.setInterval(() => {
      loadVisitors(false);
    }, REFRESH_INTERVAL_MS);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initResponsiveFilters();
    initEventListeners();
    initAutoRefresh();
    loadVisitors(true);
  });
})();
