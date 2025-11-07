// Favicon - Crop to square
function createSquareFavicon() {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function() {
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

// Scroll Progress Bar
const scrollProgress = document.querySelector('.scroll-progress');

window.addEventListener('scroll', () => {
  const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
  const scrolled = (window.scrollY / windowHeight) * 100;
  
  if (scrollProgress) {
    scrollProgress.style.width = scrolled + '%';
  }
});

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

// Navbar scroll effect
let lastScroll = 0;
const navbar = document.querySelector('.navbar');

window.addEventListener('scroll', () => {
  const currentScroll = window.pageYOffset;
  
  if (currentScroll <= 0) {
    navbar.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.3)';
  } else {
    navbar.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.5)';
  }
  
  lastScroll = currentScroll;
});

// Mobile hamburger menu
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

if (hamburger && navMenu) {
  // Toggle menu
  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    navMenu.classList.toggle('active');
    hamburger.classList.toggle('active');
    document.body.style.overflow = navMenu.classList.contains('active') ? 'hidden' : 'auto';
  });

  // Close menu when clicking on a link
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      navMenu.classList.remove('active');
      hamburger.classList.remove('active');
      document.body.style.overflow = 'auto';
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (navMenu.classList.contains('active') && 
        !hamburger.contains(e.target) && 
        !navMenu.contains(e.target)) {
      navMenu.classList.remove('active');
      hamburger.classList.remove('active');
      document.body.style.overflow = 'auto';
    }
  });

  // Close menu on window resize if opened
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && navMenu.classList.contains('active')) {
      navMenu.classList.remove('active');
      hamburger.classList.remove('active');
      document.body.style.overflow = 'auto';
    }
  });
}

// Contact form submission (prevent default for demo)
const contactForm = document.querySelector('.contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('기능 준비 중입니다.');
    contactForm.reset();
  });
}

// ===== 5. Multiple Typing Effect =====
const typingWords = ['Developer', 'Student'];
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
    typingSpeed = 100;
  } else {
    typingElement.textContent = currentWord.substring(0, charIndex + 1);
    charIndex++;
    typingSpeed = 150;
  }
  
  if (!isDeleting && charIndex === currentWord.length) {
    typingSpeed = 2000; // Pause at end
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

// ===== 6. Back to Top Button =====
const backToTopButton = document.getElementById('back-to-top');

window.addEventListener('scroll', () => {
  if (window.pageYOffset > 300) {
    backToTopButton.classList.add('show');
  } else {
    backToTopButton.classList.remove('show');
  }
});

backToTopButton.addEventListener('click', () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
});

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

// Resize canvas on window resize
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  initParticles();
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

// ===== 10. Parallax Effect for Hero Section =====
window.addEventListener('scroll', () => {
  const scrolled = window.pageYOffset;
  const hero = document.querySelector('.hero-content');
  if (hero && scrolled < window.innerHeight) {
    hero.style.transform = `translateY(${scrolled * 0.3}px)`;
    hero.style.opacity = 1 - (scrolled / window.innerHeight) * 0.5;
  }
});

// ===== 11. Performance Optimization - Debounce Scroll =====
let scrollTimeout;
window.addEventListener('scroll', () => {
  if (scrollTimeout) {
    window.cancelAnimationFrame(scrollTimeout);
  }
  scrollTimeout = window.requestAnimationFrame(() => {
    // Add or update scroll-based animations here
    const scrolled = window.pageYOffset;
    document.body.style.setProperty('--scroll', scrolled);
  });
}, { passive: true });

// ===== 12. Lazy Load Images =====
if ('loading' in HTMLImageElement.prototype) {
  const images = document.querySelectorAll('img[loading="lazy"]');
  images.forEach(img => {
    img.src = img.dataset.src;
  });
} else {
  // Fallback for browsers that don't support lazy loading
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/lazysizes/5.3.2/lazysizes.min.js';
  document.body.appendChild(script);
}

// ===== 13. Enhanced Skill Cards Animation =====
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

console.log('Welcome to Taeyoon\'s website! 🚀');
console.log('Made with ❤️ using HTML, CSS, and JavaScript');

