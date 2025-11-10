(() => {
  const API_ENDPOINT = 'https://contact.taeyoon.kr/api/visitors';
  const REFRESH_INTERVAL_MS = 60_000;

  const state = {
    visitors: [],
    allVisitors: [],
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
    pagination: {
      currentPage: 1,
      pageSize: 100,
      totalPages: 1,
    },
    charts: {
      daily: null,
      device: null,
      country: null,
      hourly: null,
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
    resultCount: document.getElementById('resultCount'),
    pagination: document.getElementById('pagination'),
    paginationInfo: document.getElementById('paginationInfo'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    pageSizeSelect: document.getElementById('pageSizeSelect'),
    toggleStatsBtn: document.getElementById('toggleStatsBtn'),
    statsContent: document.getElementById('statsContent'),
    dailyVisitsChart: document.getElementById('dailyVisitsChart'),
    deviceChart: document.getElementById('deviceChart'),
    countryChart: document.getElementById('countryChart'),
    hourlyChart: document.getElementById('hourlyChart'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    toggleIpManagementBtn: document.getElementById('toggleIpManagementBtn'),
    ipManagementContent: document.getElementById('ipManagementContent'),
    currentIp: document.getElementById('currentIp'),
    allowedIpList: document.getElementById('allowedIpList'),
    ipManagementForm: document.getElementById('ipManagementForm'),
    ipInput: document.getElementById('ipInput'),
    ipManagementStatus: document.getElementById('ipManagementStatus'),
  };

  // 다크모드 초기화 및 토글
  function initTheme() {
    const savedTheme = getCookie('visitor_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    setCookie('visitor_theme', newTheme, 365);
    updateThemeIcon(newTheme);
    
    // 차트가 표시된 경우 다시 렌더링
    if (elements.statsContent && !elements.statsContent.hidden) {
      renderCharts();
    }
  }

  function updateThemeIcon(theme) {
    const icon = elements.themeToggleBtn?.querySelector('.theme-icon');
    if (icon) {
      icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  }

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Strict; Secure`;
  }

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
      desktop: { label: '데스크톱', icon: '�' },
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

    const startIndex = (state.pagination.currentPage - 1) * state.pagination.pageSize;
    const endIndex = startIndex + state.pagination.pageSize;
    const pageVisitors = state.allVisitors.slice(startIndex, endIndex);

    if (!pageVisitors.length) {
      if (elements.resultCount) elements.resultCount.textContent = '0개 결과';
      renderEmptyState();
      renderPagination();
      return;
    }

    pageVisitors.forEach((record) => {
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
      const start = startIndex + 1;
      const end = Math.min(endIndex, state.allVisitors.length);
      elements.resultCount.textContent = `${start.toLocaleString()}-${end.toLocaleString()} / ${state.allVisitors.length.toLocaleString()}개`;
    }

    renderEmptyState();
    renderPagination();
  }

  function renderPagination() {
    if (!elements.pagination) return;
    
    const hasData = state.allVisitors.length > 0;
    const needsPagination = state.allVisitors.length > state.pagination.pageSize;
    
    elements.pagination.hidden = !hasData || !needsPagination;
    
    if (!hasData || !needsPagination) return;
    
    state.pagination.totalPages = Math.ceil(state.allVisitors.length / state.pagination.pageSize);
    
    if (elements.paginationInfo) {
      elements.paginationInfo.textContent = `${state.pagination.currentPage} / ${state.pagination.totalPages}`;
    }
    
    if (elements.prevPageBtn) {
      elements.prevPageBtn.disabled = state.pagination.currentPage === 1;
    }
    
    if (elements.nextPageBtn) {
      elements.nextPageBtn.disabled = state.pagination.currentPage === state.pagination.totalPages;
    }
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
      state.allVisitors = [...state.visitors];
      state.summary = payload.summary || null;
      state.pagination.currentPage = 1;

      populateFilterOptions();
      renderSummary();
      renderTable();
      renderCharts();

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

  function renderCharts() {
    if (!state.allVisitors.length) return;
    
    // 일별 방문 추이
    renderDailyVisitsChart();
    // 기기별 분포
    renderDeviceChart();
    // 국가별 분포
    renderCountryChart();
    // 시간대별 방문
    renderHourlyChart();
  }

  // 다크모드 대응 차트 색상 가져오기
  function getChartColors() {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    if (theme === 'dark') {
      return {
        textColor: '#e6edf3',
        gridColor: '#30363d',
        backgroundColor: 'rgba(31, 111, 235, 0.2)',
        borderColor: '#1f6feb',
      };
    }
    return {
      textColor: '#1f2933',
      gridColor: '#e4e7eb',
      backgroundColor: 'rgba(37, 99, 235, 0.1)',
      borderColor: '#2563eb',
    };
  }

  function renderDailyVisitsChart() {
    if (!elements.dailyVisitsChart) return;
    
    const dailyData = {};
    state.allVisitors.forEach(visitor => {
      const date = new Date(visitor.time).toLocaleDateString('ko-KR');
      dailyData[date] = (dailyData[date] || 0) + 1;
    });
    
    const sortedDates = Object.keys(dailyData).sort((a, b) => new Date(a) - new Date(b)).slice(-14);
    const counts = sortedDates.map(date => dailyData[date]);
    
    if (state.charts.daily) {
      state.charts.daily.destroy();
    }

    const colors = getChartColors();
    
    state.charts.daily = new Chart(elements.dailyVisitsChart, {
      type: 'line',
      data: {
        labels: sortedDates,
        datasets: [{
          label: '방문 수',
          data: counts,
          borderColor: colors.borderColor,
          backgroundColor: colors.backgroundColor,
          tension: 0.4,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { 
            display: false,
          },
        },
        scales: {
          y: { 
            beginAtZero: true,
            ticks: { color: colors.textColor },
            grid: { color: colors.gridColor },
          },
          x: {
            ticks: { color: colors.textColor },
            grid: { color: colors.gridColor },
          },
        },
      },
    });
  }

  function renderDeviceChart() {
    if (!elements.deviceChart) return;
    
    const deviceData = {};
    state.allVisitors.forEach(visitor => {
      const device = visitor.device || 'unknown';
      deviceData[device] = (deviceData[device] || 0) + 1;
    });
    
    if (state.charts.device) {
      state.charts.device.destroy();
    }

    const colors = getChartColors();
    
    state.charts.device = new Chart(elements.deviceChart, {
      type: 'doughnut',
      data: {
        labels: Object.keys(deviceData),
        datasets: [{
          data: Object.values(deviceData),
          backgroundColor: ['#6366f1', '#10b981', '#f472b6', '#94a3b8'],
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { 
            position: 'bottom',
            labels: { color: colors.textColor },
          },
        },
      },
    });
  }

  function renderCountryChart() {
    if (!elements.countryChart) return;
    
    const countryData = {};
    state.allVisitors.forEach(visitor => {
      const country = visitor.country || 'Unknown';
      countryData[country] = (countryData[country] || 0) + 1;
    });
    
    const sortedCountries = Object.entries(countryData)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    if (state.charts.country) {
      state.charts.country.destroy();
    }

    const colors = getChartColors();
    
    state.charts.country = new Chart(elements.countryChart, {
      type: 'bar',
      data: {
        labels: sortedCountries.map(([country]) => country),
        datasets: [{
          label: '방문 수',
          data: sortedCountries.map(([, count]) => count),
          backgroundColor: colors.borderColor,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { 
            display: false,
          },
        },
        scales: {
          y: { 
            beginAtZero: true,
            ticks: { color: colors.textColor },
            grid: { color: colors.gridColor },
          },
          x: {
            ticks: { color: colors.textColor },
            grid: { color: colors.gridColor },
          },
        },
      },
    });
  }

  function renderHourlyChart() {
    if (!elements.hourlyChart) return;
    
    const hourlyData = Array(24).fill(0);
    state.allVisitors.forEach(visitor => {
      const hour = new Date(visitor.time).getHours();
      hourlyData[hour]++;
    });
    
    if (state.charts.hourly) {
      state.charts.hourly.destroy();
    }

    const colors = getChartColors();
    
    state.charts.hourly = new Chart(elements.hourlyChart, {
      type: 'bar',
      data: {
        labels: Array.from({ length: 24 }, (_, i) => `${i}시`),
        datasets: [{
          label: '방문 수',
          data: hourlyData,
          backgroundColor: '#10b981',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { 
            display: false,
          },
        },
        scales: {
          y: { 
            beginAtZero: true,
            ticks: { color: colors.textColor },
            grid: { color: colors.gridColor },
          },
          x: {
            ticks: { color: colors.textColor },
            grid: { color: colors.gridColor },
          },
        },
      },
    });
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

    if (elements.prevPageBtn) {
      elements.prevPageBtn.addEventListener('click', () => {
        if (state.pagination.currentPage > 1) {
          state.pagination.currentPage--;
          renderTable();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }

    if (elements.nextPageBtn) {
      elements.nextPageBtn.addEventListener('click', () => {
        if (state.pagination.currentPage < state.pagination.totalPages) {
          state.pagination.currentPage++;
          renderTable();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }

    if (elements.pageSizeSelect) {
      elements.pageSizeSelect.addEventListener('change', (e) => {
        state.pagination.pageSize = parseInt(e.target.value);
        state.pagination.currentPage = 1;
        renderTable();
      });
    }

    if (elements.toggleStatsBtn) {
      elements.toggleStatsBtn.addEventListener('click', () => {
        const isHidden = elements.statsContent.hidden;
        elements.statsContent.hidden = !isHidden;
        elements.toggleStatsBtn.textContent = isHidden ? '차트 숨기기' : '차트 보기';
        if (isHidden) {
          renderCharts();
        }
      });
    }

    if (elements.themeToggleBtn) {
      elements.themeToggleBtn.addEventListener('click', toggleTheme);
    }

    if (elements.toggleIpManagementBtn) {
      elements.toggleIpManagementBtn.addEventListener('click', () => {
        const isHidden = elements.ipManagementContent.hidden;
        elements.ipManagementContent.hidden = !isHidden;
        elements.toggleIpManagementBtn.textContent = isHidden ? 'IP 관리 숨기기' : 'IP 관리 펼치기';
        if (isHidden) {
          loadAllowedIps();
          loadCurrentIp();
        }
      });
    }

    if (elements.ipManagementForm) {
      elements.ipManagementForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const action = e.submitter.dataset.action;
        const ip = elements.ipInput.value.trim();
        
        if (!ip) {
          showIpStatus('IP 주소를 입력해주세요.', 'error');
          return;
        }

        await manageIp(action, ip);
      });
    }
  }

  async function loadCurrentIp() {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      if (elements.currentIp) {
        elements.currentIp.textContent = data.ip;
      }
    } catch (error) {
      console.error('Failed to load current IP:', error);
      if (elements.currentIp) {
        elements.currentIp.textContent = '확인 실패';
      }
    }
  }

  async function loadAllowedIps() {
    try {
      const response = await fetch('https://contact.taeyoon.kr/visitor/allowed-ips', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to load allowed IPs');
      }

      const data = await response.json();
      
      if (data.success && data.ips) {
        renderAllowedIps(data.ips);
      }
    } catch (error) {
      console.error('Failed to load allowed IPs:', error);
      showIpStatus('허용된 IP 목록을 불러오지 못했습니다.', 'error');
    }
  }

  function renderAllowedIps(ips) {
    if (!elements.allowedIpList) return;

    elements.allowedIpList.innerHTML = '';

    if (!ips || ips.length === 0) {
      elements.allowedIpList.innerHTML = '<li style="text-align: center; color: var(--text-muted);">허용된 IP가 없습니다.</li>';
      return;
    }

    ips.forEach((ip, index) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <span class="ip-address">${escapeHTML(ip)}</span>
          <span class="ip-label">#${index + 1}</span>
        </div>
      `;
      elements.allowedIpList.appendChild(li);
    });
  }

  async function manageIp(action, ip) {
    try {
      showIpStatus('처리 중...', 'info');

      const response = await fetch('https://contact.taeyoon.kr/visitor/manage-ips', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ action, ip }),
      });

      const data = await response.json();

      if (data.success) {
        showIpStatus(data.message, 'success');
        if (data.ips) {
          renderAllowedIps(data.ips);
        }
        elements.ipInput.value = '';
      } else {
        showIpStatus(data.message || '작업에 실패했습니다.', 'error');
      }
    } catch (error) {
      console.error('IP management error:', error);
      showIpStatus('서버 오류가 발생했습니다.', 'error');
    }
  }

  function showIpStatus(message, type) {
    if (!elements.ipManagementStatus) return;

    elements.ipManagementStatus.textContent = message;
    elements.ipManagementStatus.className = `ip-status show ${type}`;

    setTimeout(() => {
      elements.ipManagementStatus.classList.remove('show');
    }, 5000);
  }

  function initAutoRefresh() {
    window.setInterval(() => {
      loadVisitors(false);
    }, REFRESH_INTERVAL_MS);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initResponsiveFilters();
    initEventListeners();
    initAutoRefresh();
    loadVisitors(true);
  });
})();
