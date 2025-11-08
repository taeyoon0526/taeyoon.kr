// Favicon - Crop to square (with error handling)
function createSquareFavicon() {
  const img = new Image();
  // Remove crossOrigin for same-origin images
  img.onload = function() {
    try {
      const canvas = document.createElement('canvas');
      const size = 256; // Favicon size
      canvas.width = size;
      canvas.height = size;
      
      const ctx = canvas.getContext('2d');
      
      // Calculate crop area (center of image)
      const aspectRatio = img.width / img.height;
      let sx, sy, sWidth, sHeight;
      
      if (aspectRatio > 1) {
        // Landscape - crop width
        sHeight = img.height;
        sWidth = img.height;
        sx = (img.width - sWidth) / 2;
        sy = 0;
      } else {
        // Portrait - crop height  
        sWidth = img.width;
        sHeight = img.width;
        sx = 0;
        sy = (img.height - sHeight) / 2;
      }
      
      // Draw cropped image
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, size, size);
      
      // Create favicon
      const favicon = canvas.toDataURL('image/png');
      
      // Update favicon links
      let link = document.querySelector("link[rel*='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = favicon;
      
      // Update apple touch icon
      let appleLink = document.querySelector("link[rel='apple-touch-icon']");
      if (!appleLink) {
        appleLink = document.createElement('link');
        appleLink.rel = 'apple-touch-icon';
        document.head.appendChild(appleLink);
      }
      appleLink.href = favicon;
    } catch (error) {
      console.warn('Favicon creation failed, using default:', error);
    }
  };
  
  img.onerror = function() {
    console.warn('Failed to load logo.jpg for favicon');
  };
  
  img.src = 'logo.jpg';
}

// Call favicon function
createSquareFavicon();

// Loading Screen
window.addEventListener('load', () => {
  const loaderWrapper = document.querySelector('.loader-wrapper');
  
  // Minimum loading time for better UX (0.8 seconds)
  setTimeout(() => {
    loaderWrapper.classList.add('fade-out');
    document.body.classList.remove('loading');
    
    // Remove loader from DOM after animation
    setTimeout(() => {
      loaderWrapper.style.display = 'none';
    }, 500);
  }, 800);
});

// Add loading class to body initially
document.body.classList.add('loading');

// ===== Utility Functions =====
// Throttle function for performance
function throttle(func, delay) {
  let lastCall = 0;
  return function(...args) {
    const now = new Date().getTime();
    if (now - lastCall < delay) {
      return;
    }
    lastCall = now;
    return func(...args);
  };
}

// Debounce function for performance
function debounce(func, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

// ===== Unified Scroll Handler =====
let lastScroll = 0;
const navbar = document.querySelector('.navbar');
const scrollProgress = document.querySelector('.scroll-progress');
const backToTopBtn = document.getElementById('back-to-top');

const handleScroll = throttle(() => {
  const currentScroll = window.pageYOffset;
  const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
  const scrolled = (currentScroll / windowHeight) * 100;
  
  // Update scroll progress bar
  if (scrollProgress) {
    scrollProgress.style.width = scrolled + '%';
  }
  
  // Update navbar shadow
  if (navbar) {
    if (currentScroll <= 0) {
      navbar.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.3)';
    } else {
      navbar.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.5)';
    }
  }
  
  // Show/hide back to top button (only after scrolling 300px)
  if (backToTopBtn) {
    if (currentScroll > 300) {
      backToTopBtn.classList.add('show');
    } else {
      backToTopBtn.classList.remove('show');
    }
  }
  
  // Parallax effect for hero section
  const hero = document.querySelector('.hero-content');
  if (hero && currentScroll < window.innerHeight) {
    hero.style.transform = `translateY(${currentScroll * 0.3}px)`;
    hero.style.opacity = 1 - (currentScroll / window.innerHeight) * 0.5;
  }
  
  lastScroll = currentScroll;
}, 16); // ~60fps

window.addEventListener('scroll', handleScroll, { passive: true });

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

// Mobile hamburger menu with keyboard support
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

if (hamburger && navMenu) {
  // Toggle menu
  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = navMenu.classList.toggle('active');
    hamburger.classList.toggle('active');
    hamburger.setAttribute('aria-expanded', isActive);
    document.body.style.overflow = isActive ? 'hidden' : 'auto';
  });

  // Close menu when clicking on a link
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      closeMenu();
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (navMenu.classList.contains('active') && 
        !hamburger.contains(e.target) && 
        !navMenu.contains(e.target)) {
      closeMenu();
    }
  });
  
  // Close menu with ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navMenu.classList.contains('active')) {
      closeMenu();
    }
  });
  
  // Helper function to close menu
  function closeMenu() {
    navMenu.classList.remove('active');
    hamburger.classList.remove('active');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = 'auto';
  }

  // Close menu on window resize if opened
  window.addEventListener('resize', debounce(() => {
    if (window.innerWidth > 768 && navMenu.classList.contains('active')) {
      closeMenu();
    }
  }, 250));
}

// ===== 5. Enhanced Multiple Typing Effect =====
const typingWords = ['Developer', 'Student', 'Learner', 'Creator'];
let wordIndex = 0;
let charIndex = 0;
let isDeleting = false;
let typingSpeed = 150;

const typingElement = document.querySelector('.typing-words');

function type() {
  if (!typingElement) return;
  
  const currentWord = typingWords[wordIndex];
  
  if (isDeleting) {
    typingElement.textContent = currentWord.substring(0, charIndex - 1);
    charIndex--;
    typingSpeed = 75; // Faster deletion
  } else {
    typingElement.textContent = currentWord.substring(0, charIndex + 1);
    charIndex++;
    typingSpeed = 120; // Slightly faster typing
  }
  
  // Add smooth transition effect
  typingElement.style.opacity = '1';
  
  if (!isDeleting && charIndex === currentWord.length) {
    typingSpeed = 2500; // Longer pause at end to read
    isDeleting = true;
  } else if (isDeleting && charIndex === 0) {
    isDeleting = false;
    wordIndex = (wordIndex + 1) % typingWords.length;
    typingSpeed = 500; // Pause before next word
  }
  
  setTimeout(type, typingSpeed);
}

// Start typing effect after page load
setTimeout(type, 1000);

// ===== 6. Back to Top Button (now handled in unified scroll) =====
if (backToTopBtn) {
  backToTopBtn.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
  
  // Keyboard accessibility
  backToTopBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  });
}

// ===== 7. Particle Background =====
const canvas = document.getElementById('particle-canvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let particlesArray = [];
const numberOfParticles = window.innerWidth < 768 ? 30 : 80;

class Particle {
  constructor() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.size = Math.random() * 2 + 1;
    this.speedX = Math.random() * 0.5 - 0.25;
    this.speedY = Math.random() * 0.5 - 0.25;
  }
  
  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    
    if (this.x > canvas.width || this.x < 0) {
      this.speedX = -this.speedX;
    }
    if (this.y > canvas.height || this.y < 0) {
      this.speedY = -this.speedY;
    }
  }
  
  draw() {
    ctx.fillStyle = 'rgba(74, 144, 226, 0.8)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function initParticles() {
  particlesArray = [];
  for (let i = 0; i < numberOfParticles; i++) {
    particlesArray.push(new Particle());
  }
}

function connectParticles() {
  for (let i = 0; i < particlesArray.length; i++) {
    for (let j = i; j < particlesArray.length; j++) {
      const dx = particlesArray[i].x - particlesArray[j].x;
      const dy = particlesArray[i].y - particlesArray[j].y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < 120) {
        ctx.strokeStyle = `rgba(74, 144, 226, ${0.2 - distance / 600})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(particlesArray[i].x, particlesArray[i].y);
        ctx.lineTo(particlesArray[j].x, particlesArray[j].y);
        ctx.stroke();
      }
    }
  }
}

function animateParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  particlesArray.forEach(particle => {
    particle.update();
    particle.draw();
  });
  
  connectParticles();
  requestAnimationFrame(animateParticles);
}

initParticles();
animateParticles();

// Resize canvas on window resize with debounce
window.addEventListener('resize', debounce(() => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  initParticles();
}, 250));

// Pause particles when page is not visible (performance optimization)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause animation
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  } else {
    // Resume animation
    animateParticles();
  }
});

// ===== 8. Enhanced Section Animations =====
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, {
  threshold: 0.15,
  rootMargin: '0px 0px -100px 0px'
});

// Observe all sections
document.querySelectorAll('.section').forEach(section => {
  sectionObserver.observe(section);
});

// ===== 9. Enhanced Hover Effects =====
// Add ripple effect on buttons
document.querySelectorAll('.btn, .contact-item').forEach(element => {
  element.addEventListener('click', function(e) {
    const ripple = document.createElement('span');
    const rect = this.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    
    ripple.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.5);
      top: ${y}px;
      left: ${x}px;
      pointer-events: none;
      transform: scale(0);
      animation: ripple-animation 0.6s ease-out;
    `;
    
    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
});

// Add CSS for ripple animation dynamically
const style = document.createElement('style');
style.textContent = `
  @keyframes ripple-animation {
    to {
      transform: scale(4);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// ===== 10. Lazy Load Images =====
if ('loading' in HTMLImageElement.prototype) {
  const images = document.querySelectorAll('img[loading="lazy"]');
  images.forEach(img => {
    if (img.dataset.src) {
      img.src = img.dataset.src;
    }
  });
}

// ===== 11. Enhanced Skill Cards Animation =====
const skillCards = document.querySelectorAll('.skill-card');
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

skillCards.forEach((card, index) => {
  card.style.setProperty('--index', index);
  
  // Add 3D tilt effect on mouse move (only for non-touch devices)
  if (!isTouchDevice) {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      const rotateX = (y - centerY) / 10;
      const rotateY = (centerX - x) / 10;
      
      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-10px)`;
    });
    
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateY(0)';
    });
  }
});

// ===== 12. Additional Features =====

// Copy email to clipboard on click
const emailLinks = document.querySelectorAll('a[href^="mailto:"]');
emailLinks.forEach(link => {
  link.addEventListener('click', async (e) => {
    const email = link.href.replace('mailto:', '');
    
    // Try to copy to clipboard
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(email);
        console.log('Email copied to clipboard:', email);
      }
    } catch (err) {
      console.log('Clipboard copy not available');
    }
  });
});

// Smooth scroll to section with offset for navbar
function smoothScrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (section) {
    const navbarHeight = navbar?.offsetHeight || 0;
    const targetPosition = section.offsetTop - navbarHeight;
    
    window.scrollTo({
      top: targetPosition,
      behavior: 'smooth'
    });
  }
}

// Track time spent on page (Analytics placeholder)
let pageLoadTime = Date.now();
let isActive = true;

document.addEventListener('visibilitychange', () => {
  isActive = !document.hidden;
});

window.addEventListener('beforeunload', () => {
  const timeSpent = Math.round((Date.now() - pageLoadTime) / 1000);
  console.log(`Time spent on page: ${timeSpent} seconds`);
  // Here you could send analytics data to your server
});

// Detect and warn about slow connections
if ('connection' in navigator) {
  const connection = navigator.connection;
  if (connection.saveData || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') {
    console.log('Slow connection detected - optimizing experience');
    // Could disable particles or reduce animations
  }
}

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Alt/Option + H = Home
  if ((e.altKey || e.metaKey) && e.key === 'h') {
    e.preventDefault();
    smoothScrollToSection('home');
  }
  
  // Alt/Option + A = About
  if ((e.altKey || e.metaKey) && e.key === 'a') {
    e.preventDefault();
    smoothScrollToSection('about');
  }
  
  // Alt/Option + S = Skills
  if ((e.altKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    smoothScrollToSection('skills');
  }
  
  // Alt/Option + C = Contact
  if ((e.altKey || e.metaKey) && e.key === 'c') {
    e.preventDefault();
    smoothScrollToSection('contact');
  }
});

// Performance monitoring
if ('performance' in window) {
  window.addEventListener('load', () => {
    setTimeout(() => {
      const perfData = performance.getEntriesByType('navigation')[0];
      if (perfData) {
        console.log('⚡ Performance Metrics:');
        console.log(`  Load Time: ${Math.round(perfData.loadEventEnd - perfData.fetchStart)}ms`);
        console.log(`  DOM Content Loaded: ${Math.round(perfData.domContentLoadedEventEnd - perfData.fetchStart)}ms`);
      }
    }, 0);
  });
}

// ===== Contact Form with Cloudflare Turnstile =====
let turnstileToken = null;
let turnstileWidgetId = null;
let formLoadTime = Date.now(); // Track when form was loaded

// Turnstile Callbacks
window.onTurnstileSuccess = function(token) {
  turnstileToken = token;
  console.log('Turnstile verification successful');
};

window.onTurnstileError = function() {
  showFormStatus('CAPTCHA 인증에 실패했습니다. 페이지를 새로고침해주세요.', 'error');
  console.error('Turnstile verification failed');
};

window.onTurnstileExpired = function() {
  turnstileToken = null;
  console.warn('Turnstile token expired');
};

// Form Elements
const contactForm = document.getElementById('contactForm');
const submitBtn = document.getElementById('submitBtn');
const submitText = document.getElementById('submitText');
const submitIcon = document.getElementById('submitIcon');
const submitSpinner = document.getElementById('submitSpinner');
const formStatus = document.getElementById('formStatus');
const messageField = document.getElementById('message');
const charCounter = document.getElementById('charCounter');

// Character counter for message field
if (messageField && charCounter) {
  messageField.addEventListener('input', () => {
    const length = messageField.value.length;
    const maxLength = 1000;
    charCounter.textContent = `${length} / ${maxLength}`;
    
    // Color coding
    charCounter.classList.remove('warning', 'error');
    if (length > maxLength * 0.9) {
      charCounter.classList.add('error');
    } else if (length > maxLength * 0.7) {
      charCounter.classList.add('warning');
    }
  });
}

// Show form status message
function showFormStatus(message, type = 'info') {
  formStatus.textContent = message;
  formStatus.className = 'form-status show ' + type;
  formStatus.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Hide form status message
function hideFormStatus() {
  formStatus.className = 'form-status';
}

// Reset Turnstile widget
function resetTurnstile() {
  try {
    if (window.turnstile && turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
    }
    turnstileToken = null;
  } catch (error) {
    console.error('Error resetting Turnstile:', error);
  }
}

// Form submission handler
if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Hide previous status
    hideFormStatus();
    
    // Get form data
    const formData = {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      message: document.getElementById('message').value.trim(),
      website: document.getElementById('website').value // Honeypot
    };
    
    // Validation
    if (!formData.name || !formData.email || !formData.message) {
      showFormStatus('모든 필수 항목을 입력해주세요.', 'error');
      return;
    }
    
    if (formData.name.length < 2 || formData.name.length > 50) {
      showFormStatus('이름은 2-50자 사이여야 합니다.', 'error');
      return;
    }
    
    if (formData.message.length < 10 || formData.message.length > 1000) {
      showFormStatus('메시지는 10-1000자 사이여야 합니다.', 'error');
      return;
    }
    
    // Check honeypot
    if (formData.website) {
      console.warn('Honeypot field filled - potential spam');
      showFormStatus('전송에 실패했습니다. 다시 시도해주세요.', 'error');
      return;
    }
    
    // Check Turnstile token
    if (!turnstileToken) {
      showFormStatus('CAPTCHA 인증을 완료해주세요.', 'error');
      return;
    }
    
    // Disable submit button
    submitBtn.disabled = true;
    submitText.textContent = '전송 중...';
    submitIcon.style.display = 'none';
    submitSpinner.style.display = 'inline-block';
    submitSpinner.classList.add('show');
    
    try {
      // Send POST request
      const response = await fetch('https://contact.taeyoon.kr/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          message: formData.message,
          website: formData.website,
          'cf-turnstile-response': turnstileToken,
          t: formLoadTime // Timestamp for anti-spam
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        // Success
        showFormStatus('✅ 메시지가 성공적으로 전송되었습니다!', 'success');
        contactForm.reset();
        charCounter.textContent = '0 / 1000';
        resetTurnstile();
        formLoadTime = Date.now(); // Reset timestamp for next submission
        
        // Log success
        console.log('Contact form submitted successfully');
      } else {
        // Server error
        const errorMessage = data.message || '전송에 실패했습니다. 잠시 후 다시 시도해주세요.';
        showFormStatus('❌ ' + errorMessage, 'error');
        console.error('Form submission failed:', data);
      }
      
    } catch (error) {
      // Network error
      console.error('Network error:', error);
      showFormStatus('❌ 네트워크 오류가 발생했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.', 'error');
    } finally {
      // Re-enable submit button
      submitBtn.disabled = false;
      submitText.textContent = '전송하기';
      submitIcon.style.display = 'inline';
      submitSpinner.style.display = 'none';
      submitSpinner.classList.remove('show');
    }
  });
  
  // Store Turnstile widget ID when ready
  window.addEventListener('load', () => {
    setTimeout(() => {
      const turnstileElement = document.querySelector('.cf-turnstile');
      if (turnstileElement && window.turnstile) {
        turnstileWidgetId = turnstileElement.getAttribute('data-widget-id');
      }
    }, 1000);
  });
}

console.log('Welcome to Taeyoon\'s website! 🚀');
console.log('Made with ❤️ using HTML, CSS, and JavaScript');
console.log('💡 Tip: Try keyboard shortcuts! Alt+H (Home), Alt+A (About), Alt+S (Skills), Alt+C (Contact)');


