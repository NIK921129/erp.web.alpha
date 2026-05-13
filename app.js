/* ═══════════════════════════════════════════════════════════
   ABC INSTITUTE ERP — app.js
   All logic: API calls, routing, rendering, auth, payments
   Backend: Render (REST API) | DB: MongoDB | Frontend: Vercel
═══════════════════════════════════════════════════════════ */

'use strict';

/* ──────────────────────────────────────────
   CONFIG — swap BASE_URL when deploying
────────────────────────────────────────── */
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const CONFIG = {
  BASE_URL:   isLocal ? 'http://localhost:5000/api' : 'https://erp-web-87s3.onrender.com/api',
  UPI_ID:     '9211293576@ptaxis',
  UPI_NAME:   'ABCInstitute',
  WA_NUMBER:  '919211293576',
  ANNOUNCEMENT_TEXT: '',
  ANNOUNCEMENT_ACTIVE: false,
  MANUAL_EMAIL: false,
  ICONS: ['📘','📗','📙','📕','🎯','💡','⚡','🔬','🎨','🖥️','🧮','📐'],
};

/* ──────────────────────────────────────────
   STATE
────────────────────────────────────────── */
let STATE = {
  user:          null,
  token:         null,
  currentPage:   'landing',
  activeCourseId: null,
  activeTeacherCourseId: null,
  paymentFilter: 'pending',
  courses:       [],
  adminStudents: [], // Store for local search filtering
  adminCourses:  [],
  adminUsers:    [],
  adminLogs:     [],
  studentAssignments: [],
  enrolCtx:      null,   // { course, step }
  currentChatCourse: null,
};
let socket = null;

/* ══════════════════════════════════════════
   API HELPER
══════════════════════════════════════════ */
async function api(method, path, body = null, isFormData = false) {
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (STATE.token) headers['Authorization'] = 'Bearer ' + STATE.token;

  const opts = { method, headers };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  try {
    const res = await fetch(CONFIG.BASE_URL + path, opts);
    const data = await res.json().catch(() => ({}));
    
    if (res.status === 401 && STATE.user) {
      handleLogout();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    console.error(`API ${method} ${path}:`, err);
    throw err;
  }
}

const API = {
  /* Auth */
  signup:   (d)     => api('POST', '/auth/signup', d),
  login:    (d)     => api('POST', '/auth/login', d),
  me:       ()      => api('GET',  '/auth/me'),
  adminAccess: (d)  => api('POST', '/auth/admin-access', d),

  /* Courses */
  courses:         ()       => api('GET', '/courses'),
  courseById:      (id)     => api('GET', `/courses/${id}`),
  createCourse:    (d)      => api('POST', '/courses', d),
  updateCourse:    (id, d)  => api('PUT', `/courses/${id}`, d),
  deleteCourse:    (id)     => api('DELETE', `/courses/${id}`),

  /* Enrolment */
  myEnrolments:    ()       => api('GET', '/enrolments/me'),
  courseStudents:  (id)     => api('GET', `/enrolments/course/${id}`),

  /* Payments */
  submitPayment:   (fd)     => api('POST', '/payments', fd, true),
  myPayments:      ()       => api('GET', '/payments/me'),
  allPayments:     ()       => api('GET', '/payments'),
  approvePayment:  (id)     => api('POST', `/payments/${id}/approve`),
  rejectPayment:   (id)     => api('POST', `/payments/${id}/reject`),

  /* Attendance */
  myAttendance:    ()       => api('GET', '/attendance/me'),
  courseAttendance:(id)     => api('GET', `/attendance/course/${id}`),
  markAttendance:  (d)      => api('POST', '/attendance/mark', d),

  /* Assignments */
  courseAssignments:(id)    => api('GET', `/assignments/course/${id}`),
  myAssignments:   ()       => api('GET', '/assignments/me'),
  postAssignment:  (d)      => api('POST', '/assignments', d),
  submitWork:      (id, d)  => api('POST', `/assignments/${id}/submit`, d),
  submissions:     (id)     => api('GET', `/assignments/${id}/submissions`),
  gradeSubmission: (id, d)  => api('PUT', `/submissions/${id}/grade`, d),

  /* Content */
  courseContent:   (id)     => api('GET', `/content/course/${id}`),
  addContent:      (d)      => api('POST', '/content', d),
  deleteContent:   (id)     => api('DELETE', `/content/${id}`),
  reorderContent:  (d)      => api('PUT', '/content/reorder', d),

  /* Admin */
  getCoupons:      ()       => api('GET', '/coupons'),
  createCoupon:    (d)      => api('POST', '/coupons', d),
  verifyCoupon:    (d)      => api('POST', '/coupons/verify', d),

  /* Admin Users */
  allUsers:        ()       => api('GET', '/users'),
  createUser:      (d)      => api('POST', '/users', d),
  bulkCreateUsers: (d)      => api('POST', '/users/bulk', d),
  updateUser:      (id, d)  => api('PUT', `/users/${id}`, d),
  deleteUser:      (id)     => api('DELETE', `/users/${id}`),
  allStudents:     ()       => api('GET', '/users?role=student'),
  allTeachers:     ()       => api('GET', '/users?role=teacher'),
  adminStats:      ()       => api('GET', '/admin/stats'),
  manualEnrol:     (d)      => api('POST', '/admin/enrol', d),
  broadcast:       (d)      => api('POST', '/admin/broadcast', d),
  studentReport:   (id)     => api('GET', `/admin/users/${id}/report`),
  sendCustomEmail: (d)      => api('POST', '/admin/send-email', d),

  /* Settings */
  getSettings:     ()       => api('GET', '/settings'),
  updateSettings:  (d)      => api('PUT', '/settings', d),

  /* Chat */
  courseChat:      (id)     => api('GET', '/chat/course/' + id),
  sendChatMessage: (id, d)  => api('POST', '/chat/course/' + id, d),
  aiChat:          (d)      => api('POST', '/ai/chat', d),

  /* Logs */
  logEvent:        (d)      => api('POST', '/logs', d),
  adminLogs:       ()       => api('GET', '/admin/logs'),
};

/* ══════════════════════════════════════════
   SECRET ADMIN ACCESS
══════════════════════════════════════════ */
async function promptAdminAccess() {
  const code = prompt("Enter Admin Passcode:");
  if (!code) return;
  
  try {
    const data = await API.adminAccess({ passcode: code });
    STATE.user = data.user;
    STATE.token = data.token;
    localStorage.setItem('abc_token', STATE.token);
    localStorage.setItem('abc_user', JSON.stringify(STATE.user));
    initSocket();
    showNav();
    navigate('admin-dashboard');
    toast('Secret admin access granted! 🕵️‍♂️', 'success');
  } catch (e) {
    toast(e.message || 'Incorrect passcode', 'error');
  }
}

/* ══════════════════════════════════════════
   SOCKET SETUP
══════════════════════════════════════════ */
function initSocket() {
  if (typeof io === 'undefined' || socket) return;
  const socketUrl = CONFIG.BASE_URL.replace('/api', '');
  socket = io(socketUrl);
  
  socket.on('connect', () => {
    console.log('🟢 Connected to live socket');
    if (STATE.user) socket.emit('register', STATE.user._id, STATE.user.role);
  });

  socket.on('notification', (data) => {
    toast(data.message, data.type || 'success');
  });

  socket.on('refresh_data', () => {
    if (STATE.currentPage === 'student-dashboard') initStudentDashboard();
    if (STATE.currentPage === 'student-fees') initStudentFees();
    if (STATE.currentPage === 'student-assignments') initStudentAssignments();
    if (STATE.currentPage === 'student-course') initStudentCourse();
  });

  socket.on('course_updated', (courseId) => {
    if (STATE.currentPage === 'student-course' && STATE.activeCourseId === courseId) {
      initStudentCourse();
      toast('Course content updated live!', 'success');
    }
  });

  socket.on('admin_alert', (data) => {
    if (STATE.user && STATE.user.role === 'admin') {
      toast(data.message, 'success');
      if (STATE.currentPage === 'admin-dashboard') initAdminDashboard();
      if (STATE.currentPage === 'admin-payments') renderAdminPayments();
    }
  });

  socket.on('user_typing', ({ courseId, name }) => {
    if (courseId === STATE.currentChatCourse) {
      let ind = document.getElementById('typing-indicator');
      const container = document.getElementById(`chat-msgs-${courseId}`);
      if (!ind && container) {
        container.insertAdjacentHTML('beforeend', `<div id="typing-indicator" class="chat-msg" style="align-self:flex-start; margin-top: -5px;"><div class="chat-msg-sender" style="margin-bottom:0; font-style:italic;">${esc(name)} is typing...</div></div>`);
        container.scrollTop = container.scrollHeight;
      }
    }
  });

  socket.on('user_stop_typing', ({ courseId }) => {
    if (courseId === STATE.currentChatCourse) {
      document.getElementById('typing-indicator')?.remove();
    }
  });

  socket.on('chat_message', (msg) => {
    if (msg.course === STATE.currentChatCourse) {
      const container = document.getElementById(`chat-msgs-${msg.course}`);
      if (container) {
        if (container.querySelector('.text-muted')) container.innerHTML = '';
        container.insertAdjacentHTML('beforeend', createChatBubble(msg));
        container.scrollTop = container.scrollHeight;
      }
    }
  });

  socket.on('force_logout', (data) => {
    toast(data.message || 'Session terminated.', 'error');
    setTimeout(() => handleLogout(), 2000);
  });
}

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  const savedToken = localStorage.getItem('abc_token');
  const savedUser  = localStorage.getItem('abc_user');

  if (savedToken && savedUser) {
    try {
      STATE.token = savedToken;
      STATE.user  = JSON.parse(savedUser);
      initSocket();
      showNav();
      redirectByRole();
    } catch (e) {
      handleLogout(); // Safely clear corrupt data
    }
  } else {
    navigate('landing');
  }

  /* Pre-load courses for landing */
  loadPublicCourses();

  /* Log visit */
  API.logEvent({ action: 'visit', details: 'User visited the site' }).catch(()=>{});

  /* Load settings in the background without blocking the UI rendering */
  try {
    const { settings } = await API.getSettings();
    if (settings) {
      CONFIG.UPI_ID = settings.upiId || CONFIG.UPI_ID;
      CONFIG.UPI_NAME = settings.upiName || CONFIG.UPI_NAME;
      CONFIG.WA_NUMBER = settings.waNumber || CONFIG.WA_NUMBER;
      CONFIG.MANUAL_EMAIL = settings.manualEmail || false;
      
      if (settings.announcementActive && settings.announcementText) {
        const banner = document.getElementById('announcement-banner');
        if (banner) { banner.innerHTML = esc(settings.announcementText); banner.classList.remove('hidden'); }
      }
    }
  } catch (e) { /* silently ignore if first setup */ }
});

/* ══════════════════════════════════════════
   PWA / SERVICE WORKER
══════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('SW registration failed:', err));
  });
}

/* PWA Installation Prompt Logic */
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  // Update UI to notify the user they can add to home screen
  const installBtn = document.getElementById('install-app-btn');
  if (installBtn) {
    installBtn.classList.remove('hidden');
    installBtn.onclick = async () => {
      installBtn.classList.add('hidden');
      // Show the native browser install prompt
      deferredPrompt.prompt();
      // Wait for the user to respond to the prompt
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    };
  }
});

window.addEventListener('appinstalled', () => {
  const installBtn = document.getElementById('install-app-btn');
  if (installBtn) installBtn.classList.add('hidden');
  deferredPrompt = null;
});

/* Log exit before unload */
window.addEventListener('beforeunload', () => {
  const url = CONFIG.BASE_URL + '/logs';
  const data = JSON.stringify({ action: 'exit', details: 'User left the site' });
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(STATE.token ? { 'Authorization': 'Bearer ' + STATE.token } : {})
    },
    body: data,
    keepalive: true
  }).catch(()=>{});
});

/* ══════════════════════════════════════════
   ROUTER
══════════════════════════════════════════ */
function navigate(page, params = {}) {
  /* Auth guard */
  const protectedPages = [
    'student-dashboard','student-course','student-fees',
    'student-attendance','student-assignments',
    'teacher-dashboard','teacher-course',
    'admin-dashboard','admin-payments','admin-students','admin-courses','admin-users','admin-settings',
    'enrol'
  ];
  if (protectedPages.includes(page) && !STATE.user) {
    navigate('login');
    return;
  }

  /* Store any params */
  Object.assign(STATE, params);

  /* Hide all pages */
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  /* Show target page */
  const el = document.getElementById('page-' + page);
  if (!el) { console.warn('Page not found:', page); return; }
  el.classList.add('active');
  STATE.currentPage = page;
  window.scrollTo(0, 0);

  /* Page-specific init */
  const init = pageInits[page];
  if (init) init(params);

  /* Nav highlight */
  updateNavLinks(page);
}

const pageInits = {
  'landing':             loadPublicCourses,
  'courses-public':      loadPublicCourseGrid,
  'student-dashboard':   initStudentDashboard,
  'student-course':      initStudentCourse,
  'student-fees':        initStudentFees,
  'student-attendance':  initStudentAttendance,
  'student-assignments': initStudentAssignments,
  'teacher-dashboard':   initTeacherDashboard,
  'teacher-course':      initTeacherCourse,
  'admin-dashboard':     initAdminDashboard,
  'admin-payments':      () => initAdminPayments('pending'),
  'admin-students':      initAdminStudents,
  'admin-courses':       initAdminCourses,
  'admin-users':         initAdminUsers,
  'admin-logs':          initAdminLogs,
  'admin-settings':      initAdminSettings,
  'enrol':               initEnrolPage,
};

/* ══════════════════════════════════════════
   NAV
══════════════════════════════════════════ */
function showNav() {
  const nav = document.getElementById('global-nav');
  nav.classList.remove('hidden');
  nav.classList.add('active');
  buildNavLinks();
  document.getElementById('nav-user-info').textContent = STATE.user.name + ' · ' + STATE.user.role;
  
  const returnBtn = document.getElementById('return-admin-btn');
  if (returnBtn) returnBtn.classList.toggle('hidden', !localStorage.getItem('abc_admin_backup_token'));
}

function buildNavLinks() {
  const nav = document.getElementById('nav-links');
  if (!STATE.user) { nav.innerHTML = ''; document.body.classList.remove('has-bottom-nav'); return; }

  const links = {
    student: [
      { icon: '🏠', label: 'Home',        page: 'student-dashboard' },
      { icon: '📚', label: 'Courses',     page: 'courses-public' },
      { icon: '📝', label: 'Assign.',     page: 'student-assignments' },
      { icon: '💰', label: 'Fees',        page: 'student-fees' },
      { icon: '👤', label: 'Profile',     action: 'openProfileModal()', mobileOnly: true }
    ],
    teacher: [
      { icon: '🏠', label: 'Home',        page: 'teacher-dashboard' },
      { icon: '📚', label: 'Courses',     page: 'courses-public' },
      { icon: '👤', label: 'Profile',     action: 'openProfileModal()', mobileOnly: true }
    ],
    admin: [
      { icon: '🏠', label: 'Home',        page: 'admin-dashboard' },
      { icon: '💳', label: 'Pay',         page: 'admin-payments' },
      { icon: '👥', label: 'Users',       page: 'admin-users' },
      { icon: '📚', label: 'Courses',     page: 'admin-courses' },
      { icon: '📊', label: 'Logs',        page: 'admin-logs' },
      { icon: '⚙️', label: 'Settings',    page: 'admin-settings' },
      { icon: '👤', label: 'Profile',     action: 'openProfileModal()', mobileOnly: true }
    ],
  };

  const role = STATE.user.role;
  nav.innerHTML = (links[role] || []).map(l =>
        `<button class="${l.mobileOnly ? 'mobile-only-link' : ''}" onclick="${l.action ? l.action : `navigate('${l.page}')`}"><span class="nav-icn">${l.icon}</span><span class="nav-lbl">${l.label}</span></button>`
  ).join('');
  document.body.classList.add('has-bottom-nav');
}

function updateNavLinks(page) {
  document.querySelectorAll('#nav-links button').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick').includes(`'${page}'`));
  });
}

/* ══════════════════════════════════════════
   AUTH
══════════════════════════════════════════ */
function selectRole(btn) {
  document.querySelectorAll('.role-btn[data-role]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function handleLogin() {
  const username = val('login-username');
  const password = val('login-password');
  const errEl    = document.getElementById('login-error');
  errEl.classList.add('hidden');

  if (!username || !password) { showErr(errEl, 'Please fill all fields'); return; }

  const btn = document.getElementById('login-btn');
  btn.textContent = 'Signing in…'; btn.disabled = true;

  try {
    const data = await API.login({ username, password });
    STATE.token = data.token;
    STATE.user  = data.user;
    localStorage.setItem('abc_token', data.token);
    localStorage.setItem('abc_user', JSON.stringify(data.user));
    initSocket();
    showNav();
    redirectByRole();
    API.logEvent({ action: 'login', details: 'User logged in' }).catch(()=>{});
    toast('Welcome back, ' + data.user.name + '!', 'success');
  } catch (e) {
    showErr(errEl, e.message || 'Invalid credentials');
  } finally {
    btn.textContent = 'Sign In'; btn.disabled = false;
  }
}

async function handleSignup() {
  const name     = val('signup-name');
  const username = val('signup-username');
  const email    = val('signup-email');
  const password = val('signup-password');
  const roleBtn  = document.querySelector('.role-btn[data-role].active');
  const role     = roleBtn ? roleBtn.dataset.role : 'student';
  const errEl    = document.getElementById('signup-error');
  errEl.classList.add('hidden');

  if (!name || !username || !email || !password) { showErr(errEl, 'Please fill all fields'); return; }
  if (password.length < 6) { showErr(errEl, 'Password must be at least 6 characters'); return; }

  try {
    const data = await API.signup({ name, username, email, password, role });
    STATE.token = data.token;
    STATE.user  = data.user;
    localStorage.setItem('abc_token', data.token);
    localStorage.setItem('abc_user', JSON.stringify(data.user));
    initSocket();
    showNav();
    redirectByRole();
    API.logEvent({ action: 'signup', details: 'User signed up' }).catch(()=>{});
    toast('Account created! Welcome to ABC Institute 🎉', 'success');
  } catch (e) {
    showErr(errEl, e.message || 'Signup failed');
  }
}

function redirectByRole() {
  if (!STATE.user) return navigate('login');
  const role = STATE.user.role;
  if (role === 'admin')   navigate('admin-dashboard');
  else if (role === 'teacher') navigate('teacher-dashboard');
  else                    navigate('student-dashboard');
}

async function handleLogout() {
  const wasLoggedIn = STATE.user;
  STATE.user = null; // Clear immediately to prevent infinite 401 loop
  if (wasLoggedIn) {
    await API.logEvent({ action: 'logout', details: 'User logged out' }).catch(()=>{});
  }
  STATE.token = null;
  localStorage.removeItem('abc_token');
  localStorage.removeItem('abc_user');
  localStorage.removeItem('abc_admin_backup_token');
  localStorage.removeItem('abc_admin_backup_user');
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  document.getElementById('global-nav').classList.remove('active');
  document.getElementById('global-nav').classList.add('hidden');
  document.body.classList.remove('has-bottom-nav');
  navigate('landing');
  toast('Logged out successfully');
}

/* ══════════════════════════════════════════
   USER PROFILE
══════════════════════════════════════════ */
function openProfileModal() {
  if (!STATE.user) return;
  document.getElementById('profile-name-input').value = STATE.user.name || '';
  document.getElementById('profile-email-input').value = STATE.user.email || '';
  document.getElementById('profile-username-input').value = STATE.user.username || '';
  document.getElementById('profile-password-input').value = '';
  document.getElementById('profile-password-confirm').value = '';
  openModal('modal-profile');
}

async function saveProfile() {
  const name = document.getElementById('profile-name-input').value.trim();
  const email = document.getElementById('profile-email-input').value.trim();
  const password = document.getElementById('profile-password-input').value;
  const confirmPassword = document.getElementById('profile-password-confirm').value;

  if (!name || !email) { toast('Name and email are required', 'error'); return; }

  const payload = { name, email };
  if (password) {
    if (password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    if (password !== confirmPassword) { toast('Passwords do not match', 'error'); return; }
    payload.password = password;
  }

  try {
    await API.updateUser(STATE.user._id, payload);
    STATE.user.name = name;
    STATE.user.email = email;
    localStorage.setItem('abc_user', JSON.stringify(STATE.user));
    document.getElementById('nav-user-info').textContent = STATE.user.name + ' · ' + STATE.user.role;
    toast('Profile updated successfully!', 'success');
    closeAllModals();
  } catch (e) { toast('Error updating profile', 'error'); }
}

/* ══════════════════════════════════════════
   LANDING / PUBLIC COURSES
══════════════════════════════════════════ */
async function loadPublicCourses() {
  const el = document.getElementById('landing-course-grid');
  if (el) el.innerHTML = skeletonCards(6);
  try {
    const { courses } = await API.courses();
    STATE.courses = courses || [];
    renderCourseGrid('landing-course-grid', courses, 6);
  } catch (e) { /* silently fail on landing */ }
}

async function loadPublicCourseGrid() {
  const el = document.getElementById('public-course-grid');
  if (el) el.innerHTML = skeletonCards(8);
  try {
    const { courses } = await API.courses();
    STATE.courses = courses || [];
    renderCourseGrid('public-course-grid', courses);
  } catch (e) {
    document.getElementById('public-course-grid').innerHTML = '<p class="empty-state">Could not load courses. Please try again.</p>';
  }
}

function filterPublicCourses() {
  const q = document.getElementById('public-course-search')?.value.toLowerCase() || '';
  const filtered = STATE.courses.filter(c => 
    (c.name || '').toLowerCase().includes(q) || 
    (c.description || '').toLowerCase().includes(q)
  );
  renderCourseGrid('public-course-grid', filtered);
}

function renderCourseGrid(containerId, courses = [], limit = 0) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const list = limit ? courses.slice(0, limit) : courses;
  if (!list.length) { el.innerHTML = '<p class="empty-state">No courses available yet.</p>'; return; }

  el.innerHTML = list.map((c, i) => {
    const enrolled = isEnrolled(c._id);
    return `
    <div class="course-card" onclick="handleCourseClick('${c._id}')">
      ${c.thumbnail ? `<div style="height:160px; border-radius:12px; margin-bottom:1rem; background:url('${esc(c.thumbnail)}') center/cover no-repeat; border:1px solid var(--border);"></div>` : `<div class="course-card-icon">${CONFIG.ICONS[i % CONFIG.ICONS.length]}</div>`}
      <div class="course-card-name">${esc(c.name)}</div>
      <div class="course-card-desc">${esc(c.description || '')}</div>
      <div class="course-card-meta">
        <span class="meta-tag">⏱ ${esc(c.duration || 'Self-paced')}</span>
        ${c.category ? `<span class="meta-tag">🏷 ${esc(c.category)}</span>` : ''}
        ${c.teacher ? `<span class="meta-tag">👤 ${esc(c.teacher.name || 'TBA')}</span>` : ''}
        <span class="meta-tag">👥 ${c.studentCount || 0} Enrolled</span>
      </div>
      <div class="course-card-footer">
        <span class="course-fee">₹${Number(c.fee).toLocaleString('en-IN')}</span>
        ${enrolled ? '<span class="enrol-badge">✓ Enrolled</span>' : '<span class="badge badge-pending">Enrol</span>'}
      </div>
    </div>`;
  }).join('');
}

function handleCourseClick(courseId) {
  if (!STATE.user) { navigate('login'); return; }
  if (STATE.user.role === 'student') {
    if (isEnrolled(courseId)) {
      navigate('student-course', { activeCourseId: courseId });
    } else {
      navigate('enrol', { activeCourseId: courseId });
    }
  }
}

function isEnrolled(courseId) {
  return !!(STATE.user?.enrolments || []).find(e => e.course === courseId || e.course?._id === courseId);
}

/* ══════════════════════════════════════════
   STUDENT DASHBOARD
══════════════════════════════════════════ */
async function initStudentDashboard() {
  document.getElementById('student-welcome').textContent = `${getGreeting()}, ${STATE.user.name} 👋`;

  document.getElementById('student-stats').innerHTML = skeletonStats(4);
  document.getElementById('student-my-courses').innerHTML = skeletonList(2);
  document.getElementById('student-pending-payments').innerHTML = skeletonList(2);
  document.getElementById('student-due-assignments').innerHTML = skeletonList(2);

  try {
    const [enrRes, payRes, attRes, assRes] = await Promise.allSettled([
      API.myEnrolments(),
      API.myPayments(),
      API.myAttendance(),
      API.myAssignments(),
    ]);

    const enrolments  = enrRes.status === 'fulfilled' ? enrRes.value.enrolments || [] : [];
    const payments    = payRes.status === 'fulfilled' ? payRes.value.payments || [] : [];
    const attendance  = attRes.status === 'fulfilled' ? attRes.value.records || [] : [];
    const assignments = assRes.status === 'fulfilled' ? assRes.value.assignments || [] : [];

    /* Update user enrolments in STATE for isEnrolled() */
    STATE.user.enrolments = enrolments;

    /* Stats */
    const pending   = payments.filter(p => p.status === 'pending');
    const approved  = payments.filter(p => p.status === 'approved');
    const totalAtt  = attendance.length;
    const presentAtt = attendance.filter(a => a.status === 'present').length;
    const pct       = totalAtt ? Math.round((presentAtt/totalAtt)*100) : 0;

    document.getElementById('student-stats').innerHTML = `
      ${statCard('Enrolled Courses', enrolments.filter(e=>e.status==='active').length, 'teal')}
      ${statCard('Attendance', pct + '%', pct >= 75 ? 'teal' : 'red')}
      ${statCard('Pending Payments', pending.length, 'amber')}
      ${statCard('Assignments', assignments.filter(a=>!a.submitted).length + ' due', 'blue')}
    `;

    /* My courses */
    const activeEnrol = enrolments.filter(e => e.status === 'active');
    const myCoursesEl = document.getElementById('student-my-courses');
    if (!activeEnrol.length) {
      myCoursesEl.innerHTML = `<div class="empty-state"><div class="es-icon">📚</div>No courses yet. <a onclick="navigate('courses-public')">Browse courses</a></div>`;
    } else {
      myCoursesEl.innerHTML = activeEnrol.map((e,i) => `
        <div class="list-card" onclick="navigate('student-course',{activeCourseId:'${e.course._id || e.course}'})" style="cursor:pointer">
          <div class="lc-icon">${CONFIG.ICONS[i % CONFIG.ICONS.length]}</div>
          <div class="lc-body">
            <div class="lc-name">${esc(e.course.name || 'Course')}</div>
            <div class="lc-sub">Active · Click to open</div>
          </div>
          <span>→</span>
        </div>`).join('');
    }

    /* Pending payments */
    const pendingEl = document.getElementById('student-pending-payments');
    pendingEl.innerHTML = pending.length
      ? pending.map(p => `
        <div class="list-card" onclick="navigate('student-fees')" style="cursor:pointer">
          <div class="lc-icon">⏳</div>
          <div class="lc-body">
            <div class="lc-name">${esc(p.course?.name || 'Course')}</div>
            <div class="lc-sub">Payment under review · ₹${Number(p.amount).toLocaleString('en-IN')}</div>
          </div>
          <span class="badge badge-pending">Pending</span>
        </div>`).join('')
      : `<div class="empty-state">No pending payments</div>`;

    /* Due assignments */
    const dueEl = document.getElementById('student-due-assignments');
    const due = assignments.filter(a => !a.submitted);
    dueEl.innerHTML = due.length
      ? due.slice(0,5).map(a => `
        <div class="list-card" onclick="navigate('student-assignments')" style="cursor:pointer">
          <div class="lc-icon">📝</div>
          <div class="lc-body">
            <div class="lc-name">${esc(a.title)}</div>
            <div class="lc-sub">Due: ${fmtDate(a.dueDate)} · ${esc(a.course?.name || '')}</div>
          </div>
          <span class="badge badge-pending">Due</span>
        </div>`).join('')
      : `<div class="empty-state">No pending assignments 🎉</div>`;

  } catch (e) {
    toast('Error loading dashboard', 'error');
  }
}

/* ══════════════════════════════════════════
   STUDENT COURSE VIEW
══════════════════════════════════════════ */
async function initStudentCourse() {
  const courseId = STATE.activeCourseId;
  if (!courseId) { navigate('student-dashboard'); return; }

  try {
    const [courseData, contentData, assignData, attData, batchData] = await Promise.all([
      API.courseById(courseId),
      API.courseContent(courseId),
      API.courseAssignments(courseId),
      API.courseAttendance(courseId),
      API.courseStudents(courseId),
    ]);

    const course   = courseData.course;
    const content  = contentData.content  || [];
    const assigns  = assignData.assignments || [];
    const attRecs  = attData.records       || [];
    const students = batchData.students    || [];

    document.getElementById('premium-course-title').textContent = course.name || 'Course';
    document.getElementById('student-course-desc').textContent = course.description || 'No description provided.';

    /* Syllabus / Content Tree */
    document.getElementById('premium-content-tree').innerHTML = renderTreeItems(content, false);

    /* Assignments tab */
    document.getElementById('tab-assignments').innerHTML = assigns.length
      ? assigns.map(a => renderAssignmentCard(a, true)).join('')
      : '<div class="empty-state"><div class="es-icon">📝</div>No assignments posted yet</div>';

    /* Batchmates tab */
    document.getElementById('tab-batchmates').innerHTML = `
      <div class="batchmates-grid">
        ${students.map(s => `
          <div class="batchmate-card">
            <div class="avatar">${initials(s.name)}</div>
            <div class="batchmate-name">${esc(s.name)}</div>
          </div>`).join('')}
      </div>`;

    /* Attendance tab */
    const myAtt   = attRecs.filter(r => r.student === STATE.user._id || r.student?._id === STATE.user._id);
    const present = myAtt.filter(r => r.status === 'present').length;
    const total   = myAtt.length;
    const pct     = total ? Math.round((present/total)*100) : 0;
    document.getElementById('tab-attendance').innerHTML = `
      <div class="attendance-course-card" style="max-width:400px">
        <h4>${esc(course.name)}</h4>
        <div class="att-bar-bg"><div class="att-bar-fill" style="width:${pct}%;background:${pct>=75?'var(--teal)':'var(--red)'}"></div></div>
        <div class="att-pct">${present}/${total} classes · ${pct}%</div>
      </div>
    <div class="data-table-wrapper">
      <table class="att-table" style="margin-top:1rem">
        <thead><tr><th>Date</th><th>Status</th></tr></thead>
        <tbody>${myAtt.map(r=>`
          <tr>
            <td>${fmtDate(r.date)}</td>
            <td class="${r.status==='present'?'att-present':'att-absent'}">${r.status}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

    /* Discussions tab */
    initCourseChatView('tab-chat', courseId);

    /* AI Solver tab */
    initAiChatView('tab-ai', courseId);

  } catch (e) {
    toast('Error loading course', 'error');
  }
}

function renderTreeItems(items, isTeacher = false) {
  const chapters = items.filter(i => i.type === 'chapter').sort((a,b) => (a.order||0) - (b.order||0));
  const nonChapters = items.filter(i => i.type !== 'chapter');

  if (!items.length) return '<div class="empty-state"><div class="es-icon">📂</div>No content uploaded yet</div>';

  let html = '';
  chapters.forEach(ch => {
    const children = items.filter(i => i.parentId === ch._id).sort((a,b) => (a.order||0) - (b.order||0));
    html += `
      <div class="chapter-folder" id="ch-${ch._id}">
        <div class="chapter-header" onclick="toggleChapter('ch-${ch._id}')">
              ${isTeacher ? `<div class="drag-handle" onclick="event.stopPropagation()" title="Drag to reorder">⋮⋮</div>` : ''}
              <div style="display:flex;align-items:center;gap:10px;flex:1">
                <span class="chapter-icon">📁</span>
                <span class="chapter-name">${esc(ch.title)}</span>
              </div>
              ${isTeacher ? `<button class="btn-danger" style="padding:5px 10px;font-size:13px" onclick="event.stopPropagation();deleteContent('${ch._id}')">Delete</button>` : ''}
              <span class="chapter-toggle" style="margin-left:10px">▼</span>
        </div>
        <div class="chapter-children" data-parent="${ch._id}" style="min-height: 20px;">
          ${children.length ? children.map(c => renderContentItem(c, isTeacher)).join('') : (isTeacher ? '<div class="empty-dropzone" style="padding:10px;text-align:center;color:var(--text-3);font-size:13px;border:1px dashed var(--border);margin:10px;border-radius:var(--r-sm);">Drop items here</div>' : '<div style="color:var(--text-3);font-size:15px">Empty folder</div>')}
        </div>
      </div>`;
  });

  nonChapters.filter(i => !i.parentId).sort((a,b) => (a.order||0) - (b.order||0)).forEach(item => {
    html += renderContentItem(item, isTeacher);
  });
  return html;
}


function renderContentItem(item, isTeacher) {
  const isVideo = item.type === 'video';
  const isNote = item.type === 'file';
  
  let thumb = '';
  if (isVideo) {
    if (item.thumbnail) {
      thumb = `<div class="pl-thumb" style="background-image:url('${esc(item.thumbnail)}')"><div class="pl-play"><svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div></div>`;
    } else {
      thumb = `<div class="pl-thumb fallback"><div class="pl-play"><svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div></div>`;
    }
  } else {
    thumb = `<div class="pl-thumb file-fallback"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div>`;
  }

  const safeTitle = esc(item.title).replace(/'/g, "\\'").replace(/\n/g, ' ');
  const safeDesc = esc(item.description || '').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const onClickAttr = (isVideo || isNote) 
    ? `onclick="viewCourseItem('${item._id}', '${item.type}', '${item.url || ''}', '${safeTitle}', '${safeDesc}')"` 
    : '';
  
  const lecBadge = item.order ? `<span class="badge badge-enrolled" style="margin-right:8px">Lec ${item.order}</span>` : '';
 
  return `
    <div class="playlist-item" id="pl-item-${item._id}" ${onClickAttr}>
      ${isTeacher ? `<div class="drag-handle" onclick="event.stopPropagation()" title="Drag to reorder">⋮⋮</div>` : ''}
      ${thumb}
      <div class="pl-info">
        <div class="pl-title">${lecBadge}${esc(item.title)}</div>
        ${item.description ? `<div class="pl-desc">${esc(item.description)}</div>` : ''}
      </div>
      <div class="pl-actions" onclick="event.stopPropagation()">
        ${isNote && item.url ? `<a href="${item.url}" target="_blank" class="btn-ghost" style="padding:6px 14px;font-size:13px;display:flex;align-items:center;gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> View External</a>` : ''}
        ${isTeacher ? `<button class="btn-danger" onclick="deleteContent('${item._id}')" style="padding:6px 12px;font-size:13px;" title="Delete">🗑️</button>` : ''}
      </div>
    </div>`;
}

function driveEmbed(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return `https://drive.google.com/file/d/${match[1]}/preview`;
  return url;
}

window.viewCourseItem = function(id, type, url, title, desc) {
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  
  const wrapper = activePage.querySelector('.youtube-style-player');
  const placeholder = activePage.querySelector('.player-placeholder');
  const container = activePage.querySelector('.video-embed');
  const titleEl = activePage.querySelector('.player-title');
  const descEl = activePage.querySelector('.player-desc');
  
  if (!wrapper || !container) return;
  
  wrapper.classList.remove('hidden');
  if (placeholder) placeholder.classList.add('hidden');
  if (titleEl) titleEl.textContent = title;
  
  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active-playing'));
  const activeItem = document.getElementById('pl-item-' + id);
  if (activeItem) activeItem.classList.add('active-playing');

  if (type === 'video') {
    if (descEl) descEl.textContent = desc;
    if (url.includes('drive.google.com')) {
      const embedUrl = driveEmbed(url);
      container.innerHTML = `<iframe src="${embedUrl}" allowfullscreen allow="autoplay"></iframe>`;
    } else {
      container.innerHTML = `<video id="player-${id}" src="${url}" controls autoplay playsinline webkit-playsinline></video>`;
      const video = document.getElementById(`player-${id}`);
      video.addEventListener('loadedmetadata', () => {
        const savedTime = localStorage.getItem(`vid_progress_${id}`);
        if (savedTime) video.currentTime = parseFloat(savedTime);
      });
      video.addEventListener('timeupdate', () => {
        localStorage.setItem(`vid_progress_${id}`, video.currentTime);
      });
    }
  } else if (type === 'file') {
    if (url && url.includes('drive.google.com')) {
      if (descEl) descEl.textContent = desc;
      const embedUrl = driveEmbed(url);
      container.innerHTML = `<iframe src="${embedUrl}" allowfullscreen></iframe>`;
    } else if (url) {
      if (descEl) descEl.textContent = desc;
      container.innerHTML = `<div class="notes-viewer-content" style="display:flex;align-items:center;justify-content:center;"><a href="${url}" target="_blank" class="btn-primary">Open External Document</a></div>`;
    } else {
      if (descEl) descEl.textContent = ''; // Hide sub-desc because the note content becomes the main view
      container.innerHTML = `<div class="notes-viewer-content">${desc ? desc.replace(/\\n/g, '<br>') : 'No notes available.'}</div>`;
    }
  }
  
  wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleChapter(id) {
  document.getElementById(id)?.classList.toggle('open');
}

function initSortableContentTree(courseId) {
  if (typeof Sortable === 'undefined') return;

  const updateOrder = async () => {
    const items = [];
    const rootTree = document.getElementById('teacher-premium-content-tree');
    let order = 0;

    // Get root items & chapters
    rootTree.querySelectorAll(':scope > .chapter-folder, :scope > .playlist-item').forEach(el => {
      const id = el.id.replace('ch-', '').replace('pl-item-', '');
      items.push({ _id: id, order: order++, parentId: null });
    });

    // Get items inside chapters
    rootTree.querySelectorAll('.chapter-folder').forEach(ch => {
      const parentId = ch.id.replace('ch-', '');
      let childOrder = 0;
      ch.querySelectorAll('.chapter-children > .playlist-item').forEach(el => {
        const id = el.id.replace('pl-item-', '');
        items.push({ _id: id, order: childOrder++, parentId });
      });
      
      // Handle empty dropzone UI state
      const childrenContainer = ch.querySelector('.chapter-children');
      const hasItems = childrenContainer.querySelectorAll('.playlist-item').length > 0;
      const emptyState = childrenContainer.querySelector('.empty-dropzone');
      if (hasItems && emptyState) emptyState.remove();
      if (!hasItems && !emptyState) {
         childrenContainer.insertAdjacentHTML('beforeend', '<div class="empty-dropzone" style="padding:10px;text-align:center;color:var(--text-3);font-size:13px;border:1px dashed var(--border);margin:10px;border-radius:var(--r-sm);">Drop items here</div>');
      }
    });

    try {
      await API.reorderContent({ items });
    } catch(e) { toast('Error saving new order', 'error'); }
  };

  const sortableConfig = {
    group: 'shared',
    animation: 150,
    handle: '.drag-handle',
    fallbackOnBody: true,
    swapThreshold: 0.65,
    onEnd: updateOrder,
    onMove: function (evt) {
      // Prevent dropping a chapter inside another chapter folder
      if (evt.dragged.classList.contains('chapter-folder') && evt.to.classList.contains('chapter-children')) return false;
    }
  };

  const rootEl = document.getElementById('teacher-premium-content-tree');
  new Sortable(rootEl, sortableConfig);
  rootEl.querySelectorAll('.chapter-children').forEach(childEl => new Sortable(childEl, sortableConfig));
}

/* ══════════════════════════════════════════
   STUDENT FEES
══════════════════════════════════════════ */
async function initStudentFees() {
  const el = document.getElementById('student-fees-list');
  try {
    const { payments } = await API.myPayments();
    if (!payments || !payments.length) {
      el.innerHTML = '<div class="empty-state"><div class="es-icon">💰</div>No payment records found</div>';
      return;
    }
    el.innerHTML = payments.map(p => `
      <div class="payment-review-card">
        <img class="pay-thumb" src="${p.screenshotUrl || ''}" alt="Screenshot"
          onclick="previewScreenshot('${p.screenshotUrl}', null, null)"
          onerror="this.style.display='none'" />
        <div class="pay-info">
          <div class="pay-name">${esc(p.course?.name || 'Course')}</div>
          <div class="pay-meta">₹${Number(p.amount).toLocaleString('en-IN')} · ${fmtDate(p.createdAt)}</div>
        </div>
        <div>
          <span class="badge badge-${p.status}">${p.status}</span>
          ${p.status === 'rejected' ? `<div style="margin-top:.5rem"><button class="btn-primary" style="font-size:14px;padding:8px 16px" onclick="navigate('enrol',{activeCourseId:'${p.course?._id}'})">Re-upload</button></div>` : ''}
        </div>
      </div>`).join('');
  } catch (e) {
    el.innerHTML = '<div class="empty-state">Error loading fees</div>';
  }
}

/* ══════════════════════════════════════════
   STUDENT ATTENDANCE
══════════════════════════════════════════ */
async function initStudentAttendance() {
  const el = document.getElementById('student-attendance-content');
  try {
    const { records, courses } = await API.myAttendance();
    if (!records || !records.length) {
      el.innerHTML = '<div class="empty-state"><div class="es-icon">📅</div>No attendance records yet</div>';
      return;
    }

    /* Group by course */
    const byCourse = {};
    records.forEach(r => {
      const cid = r.course?._id || r.course;
      if (!byCourse[cid]) byCourse[cid] = { name: r.course?.name || 'Course', records: [] };
      byCourse[cid].records.push(r);
    });

    let html = '<div class="attendance-grid">';
    Object.values(byCourse).forEach(({ name, records: recs }) => {
      const present = recs.filter(r => r.status === 'present').length;
      const total   = recs.length;
      const pct     = total ? Math.round((present/total)*100) : 0;
      const color   = pct >= 75 ? 'var(--teal)' : 'var(--red)';
      html += `
        <div class="attendance-course-card">
          <h4>${esc(name)}</h4>
          <div class="att-bar-bg"><div class="att-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <div class="att-pct">${present}/${total} classes · <strong style="color:${color}">${pct}%</strong></div>
        </div>`;
    });
    html += '</div>';

    html += `<div class="data-table-wrapper">
      <table class="att-table">
        <thead><tr><th>Course</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>${records.map(r=>`
          <tr>
            <td>${esc(r.course?.name||'')}</td>
            <td>${fmtDate(r.date)}</td>
            <td class="${r.status==='present'?'att-present':'att-absent'}">${r.status}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="empty-state">Error loading attendance</div>';
  }
}

/* ══════════════════════════════════════════
   STUDENT ASSIGNMENTS
══════════════════════════════════════════ */
async function initStudentAssignments() {
  const el = document.getElementById('student-assignments-list');
  try {
    const { assignments } = await API.myAssignments();
    STATE.studentAssignments = assignments || [];
    renderStudentAssignments('all');
  } catch (e) {
    el.innerHTML = '<div class="empty-state">Error loading assignments</div>';
  }
}

function filterStudentAssignments(filter, btn) {
  if (btn) {
    document.querySelectorAll('#page-student-assignments .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  renderStudentAssignments(filter);
}

function renderStudentAssignments(filter = 'all') {
  const el = document.getElementById('student-assignments-list');
  const list = STATE.studentAssignments.filter(a => filter === 'all' ? true : filter === 'submitted' ? a.submitted : !a.submitted);
  if (!list.length) { el.innerHTML = '<div class="empty-state"><div class="es-icon">📝</div>No assignments found</div>'; return; }
  el.innerHTML = list.map(a => renderAssignmentCard(a, true)).join('');
}

function renderAssignmentCard(a, canSubmit = false) {
  const isTeacher = STATE.user?.role === 'teacher';
  const statusClass = a.submitted ? 'approved' : 'pending';
  const statusText = a.submitted ? '✓ Submitted' : 'Pending';
  
  return `
    <div class="assignment-card status-${statusClass}">
      <div class="assignment-card-header">
        <div style="flex:1">
          <div class="assignment-title">${esc(a.title)}</div>
          <div class="assignment-due">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Due: ${fmtDate(a.dueDate)}
          </div>
        </div>
        <span class="badge badge-${statusClass}" style="padding:6px 12px;font-size:13px">${statusText}</span>
      </div>
      <div class="assignment-desc">${esc(a.description || '')}</div>
      ${a.url ? `<a href="${a.url}" target="_blank" class="resource-link"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg> View Reference Material</a>` : ''}
      
      <div class="assignment-footer">
        ${canSubmit && !a.submitted ? `<button class="btn-primary" style="font-size:15px;padding:10px 24px" onclick="openSubmitModal('${a._id}')">Submit Assignment</button>` : ''}
        
        ${a.submitted && canSubmit ? `
          <div class="submission-receipt">
            <div class="receipt-title">Your Submission</div>
            <div class="receipt-text">${esc(a.subText || 'No text provided')}</div>
            ${(a.subUrl || a.subFile) ? `
            <div class="receipt-links">
              ${a.subUrl ? `<a href="${a.subUrl}" target="_blank" class="btn-ghost">🔗 Link</a>` : ''}
              ${a.subFile ? `<a href="${a.subFile}" target="_blank" class="btn-ghost">📄 File</a>` : ''}
            </div>` : ''}
          </div>
        ` : ''}
        
        ${a.grade ? `<div class="assignment-grade"><div class="grade-score">Grade: ${esc(a.grade)}</div>${a.feedback ? '<div class="grade-feedback">"'+esc(a.feedback)+'"</div>' : ''}</div>` : ''}
        
        ${isTeacher ? `<button class="btn-ghost" style="width:100%; justify-content:center; margin-top:1rem;" onclick="openSubmissionsModal('${a._id}')">View Student Submissions</button>` : ''}
      </div>
    </div>`;
}

/* ══════════════════════════════════════════
   ENROLMENT / PAYMENT FLOW
══════════════════════════════════════════ */
async function initEnrolPage() {
  const el = document.getElementById('enrol-content');
  const courseId = STATE.activeCourseId;
  if (!courseId) { navigate('courses-public'); return; }

  try {
    const { course } = await API.courseById(courseId);

    /* Check if already pending */
    const { payments } = await API.myPayments();
    const existing = (payments||[]).find(p => (p.course?._id||p.course) === courseId);

    if (existing) {
      if (existing.status === 'pending') {
        el.innerHTML = `
          <div class="payment-status-card">
            <div class="status-icon">⏳</div>
            <h3>Payment Under Review</h3>
            <p>Your payment screenshot for <strong>${esc(course.name)}</strong> has been submitted and is being reviewed by our admin.</p>
            <p style="color:var(--text-3);font-size:15px;margin-top:1rem">You'll get access once approved.</p>
            <div style="margin-top:1.5rem">
              <button class="wa-btn" onclick="openWhatsApp()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Need help? WhatsApp us
              </button>
            </div>
          </div>`;
        return;
      }
      if (existing.status === 'rejected') {
        el.innerHTML = renderEnrolStep1(course, true);
        return;
      }
    }

    STATE.enrolCtx = { course, step: 1 };
    el.innerHTML = renderEnrolStep1(course, false);

  } catch (e) {
    el.innerHTML = '<div class="empty-state">Error loading course details</div>';
  }
}

function renderEnrolStep1(course, resubmit = false) {
  return `
    ${stepsBar(1)}
    <div class="payment-card">
      <h3>${esc(course.name)}</h3>
      <p>${esc(course.description || '')}</p>
      ${resubmit ? '<div style="background:rgba(229,69,69,.12);border:1px solid rgba(229,69,69,.3);color:#ff7070;padding:12px 16px;border-radius:8px;font-size:15px;margin-bottom:1rem">Your previous payment was rejected. Please submit a valid screenshot.</div>' : ''}
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r-lg);padding:1.5rem;margin:1rem 0;">
        <div style="font-size:15px;color:var(--text-2);margin-bottom:.25rem">Course Fee</div>
        <div class="upi-amount">₹${Number(course.fee).toLocaleString('en-IN')}</div>
        <div style="font-size:15px;color:var(--text-2)">Duration: ${esc(course.duration || 'Self-paced')}</div>
      </div>
      <div style="margin-bottom:1.5rem;text-align:left;">
        <label style="font-size:14px;color:var(--text-2);margin-bottom:4px;display:block;">Have a coupon code?</label>
        <div style="display:flex;gap:8px;">
          <input type="text" id="enrol-coupon-input" placeholder="Enter code" style="flex:1;background:var(--bg3);border:1px solid var(--border2);color:var(--text);padding:10px 14px;border-radius:var(--r-md);text-transform:uppercase;" />
          <button class="btn-ghost" onclick="applyCoupon('${course.fee}')">Apply</button>
        </div>
        <div id="coupon-message" style="font-size:14px;margin-top:6px;font-weight:500;"></div>
      </div>
      <button id="enrol-proceed-btn" class="btn-primary btn-lg" onclick="goToStep2('${course._id}', ${course.fee})">
        Proceed to Pay →
      </button>
    </div>`;
}

async function applyCoupon(originalFee) {
  const code = document.getElementById('enrol-coupon-input').value.trim();
  const msgEl = document.getElementById('coupon-message');
  if (!code) return;
  try {
    const { discountPct } = await API.verifyCoupon({ code });
    const newFee = Math.max(0, originalFee - (originalFee * (discountPct / 100)));
    msgEl.innerHTML = `<span style="color:var(--green)">✓ ${discountPct}% discount applied! New fee: ₹${newFee}</span>`;
    document.getElementById('enrol-proceed-btn').setAttribute('onclick', `goToStep2('${STATE.activeCourseId}', ${newFee})`);
  } catch (e) { msgEl.innerHTML = `<span style="color:var(--red)">✕ ${e.message || 'Invalid code'}</span>`; }
}

function goToStep2(courseId, fee) {
  const upiLink = `upi://pay?pa=${CONFIG.UPI_ID}&pn=${encodeURIComponent(CONFIG.UPI_NAME)}&am=${fee}&cu=INR&tn=${encodeURIComponent('Course Enrolment - ABC Institute')}`;

  document.getElementById('enrol-content').innerHTML = `
    ${stepsBar(2)}
    <div class="payment-card">
      <h3>Scan & Pay</h3>
      <p>Scan the QR code below with any UPI app to pay your course fee</p>
      <div class="upi-amount">₹${Number(fee).toLocaleString('en-IN')}</div>
      <div class="qr-container" id="qr-container"></div>
      <div class="upi-id">UPI ID: ${CONFIG.UPI_ID}</div>
      <a href="${upiLink}" style="display:block;margin-bottom:1rem">
        <button class="btn-primary">Open UPI App Directly</button>
      </a>
      <p style="font-size:15px;color:var(--text-2);margin-bottom:1.5rem">After payment, take a screenshot and upload below</p>
      <button class="btn-ghost" onclick="navigate('courses-public')">Cancel</button>
      <div style="margin-top:1.5rem">
        <button class="btn-primary" onclick="goToStep3('${courseId}', ${fee})">I've Paid → Upload Screenshot</button>
      </div>
    </div>`;

  /* Generate QR */
  generateQR('qr-container', upiLink);
}

function goToStep3(courseId, fee) {
  document.getElementById('enrol-content').innerHTML = `
    ${stepsBar(3)}
    <div class="payment-card">
      <h3>Upload Payment Screenshot</h3>
      <p>Take a screenshot of your payment confirmation and upload it below for admin verification</p>
      <div class="screenshot-upload" onclick="document.getElementById('ss-file').click()">
        <div id="ss-upload-icon">📸</div>
        <p id="ss-upload-text">Click to upload payment screenshot</p>
        <p style="font-size:14px;color:var(--text-3)">JPG, PNG, WEBP accepted</p>
        <input type="file" id="ss-file" accept="image/*" onchange="previewSS(this)" />
      </div>
      <img id="ss-preview" class="screenshot-preview" style="display:none" />
      <div id="upload-error" class="form-error hidden"></div>
      <div style="margin-top:1.5rem;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn-ghost" onclick="goToStep2('${courseId}', ${fee})">← Back</button>
        <button class="btn-primary" id="submit-ss-btn" onclick="submitPaymentScreenshot('${courseId}', ${fee})">Submit for Verification</button>
      </div>
      <div style="margin-top:1rem">
        <button class="wa-btn center" onclick="openWhatsApp()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          Need help? WhatsApp us
        </button>
      </div>
    </div>`;
}

function previewSS(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('ss-preview');
    img.src = e.target.result;
    img.style.display = 'block';
    document.getElementById('ss-upload-text').textContent = file.name;
  };
  reader.readAsDataURL(file);
}

async function submitPaymentScreenshot(courseId, fee) {
  const fileInput = document.getElementById('ss-file');
  const errEl     = document.getElementById('upload-error');
  errEl.classList.add('hidden');

  if (!fileInput.files[0]) { showErr(errEl, 'Please upload a payment screenshot'); return; }

  const btn = document.getElementById('submit-ss-btn');
  btn.textContent = 'Submitting…'; btn.disabled = true;

  try {
    const fd = new FormData();
    fd.append('course', courseId);
    fd.append('amount', fee);
    fd.append('screenshot', fileInput.files[0]);

    await API.submitPayment(fd);

    document.getElementById('enrol-content').innerHTML = `
      ${stepsBar(4)}
      <div class="payment-status-card">
        <div class="status-icon">✅</div>
        <h3>Screenshot Submitted!</h3>
        <p>Your payment screenshot has been sent to the admin for verification. You'll get course access once approved.</p>
        <div style="margin-top:1.5rem;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn-primary" onclick="navigate('student-dashboard')">Go to Dashboard</button>
          <button class="wa-btn" onclick="openWhatsApp()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            Need help?
          </button>
        </div>
      </div>`;
    toast('Payment screenshot submitted!', 'success');
  } catch (e) {
    showErr(errEl, e.message || 'Upload failed. Please try again.');
    btn.textContent = 'Submit for Verification'; btn.disabled = false;
  }
}

function stepsBar(active) {
  const steps = ['Course Info', 'Pay via UPI', 'Upload Screenshot', 'Verification'];
  return `<div class="enrol-steps">${steps.map((s,i) => {
    const n = i+1;
    const cls = n < active ? 'done' : n === active ? 'active' : '';
    return `
      ${i > 0 ? '<div class="step-sep"></div>' : ''}
      <div class="enrol-step ${cls}">
        <div class="step-dot">${n < active ? '✓' : n}</div>
        <span>${s}</span>
      </div>`;
  }).join('')}</div>`;
}

/* ══════════════════════════════════════════
   TEACHER DASHBOARD
══════════════════════════════════════════ */
async function initTeacherDashboard() {
  document.getElementById('teacher-welcome').textContent = `${getGreeting()}, ${STATE.user.name} 👋`;
  
  document.getElementById('teacher-stats').innerHTML = skeletonStats(2);
  document.getElementById('teacher-courses-list').innerHTML = skeletonList(3);

  try {
    const [coursesData] = await Promise.all([API.courses()]);
    const myCourses = (coursesData.courses||[]).filter(c =>
      c.teacher?._id === STATE.user._id || c.teacher === STATE.user._id
    );

    document.getElementById('teacher-stats').innerHTML = `
      ${statCard('My Courses', myCourses.length, 'teal')}
      ${statCard('Students', myCourses.reduce((s,c) => s + (c.studentCount||0), 0), 'blue')}
    `;

    const coursesEl = document.getElementById('teacher-courses-list');
    coursesEl.innerHTML = myCourses.length
      ? myCourses.map((c,i) => `
          <div class="list-card" style="cursor:pointer" onclick="navigate('teacher-course',{activeTeacherCourseId:'${c._id}'})">
            <div class="lc-icon">${CONFIG.ICONS[i%CONFIG.ICONS.length]}</div>
            <div class="lc-body">
              <div class="lc-name">${esc(c.name)}</div>
              <div class="lc-sub">${c.studentCount||0} students enrolled</div>
            </div>
            <span>→</span>
          </div>`).join('')
      : '<div class="empty-state">No courses assigned yet</div>';

    document.getElementById('teacher-submissions').innerHTML = '<div class="empty-state">Recent submissions will appear here</div>';
  } catch (e) {
    toast('Error loading dashboard', 'error');
  }
}

/* ══════════════════════════════════════════
   TEACHER COURSE MANAGER
══════════════════════════════════════════ */
async function initTeacherCourse() {
  const courseId = STATE.activeTeacherCourseId;
  if (!courseId) { navigate('teacher-dashboard'); return; }

  try {
    const [courseData, contentData, assignData, studentsData] = await Promise.all([
      API.courseById(courseId),
      API.courseContent(courseId),
      API.courseAssignments(courseId),
      API.courseStudents(courseId),
    ]);

    const course   = courseData.course;
    const content  = contentData.content   || [];
    const assigns  = assignData.assignments || [];
    const students = studentsData.students || [];

    document.getElementById('teacher-premium-course-title').textContent = course.name || 'Course';
    document.getElementById('teacher-premium-course-meta').textContent = `${students.length} students enrolled`;

    /* Sidebar Content Tree */
    document.getElementById('teacher-premium-content-tree').innerHTML = renderTreeItems(content, true);
    
    initSortableContentTree(courseId);

    /* Content Tab (Now serves as an overview screen) */
    document.getElementById('teacher-tab-content').innerHTML = `
      <div class="empty-state" style="padding:3rem 1rem;">
        <div class="es-icon">📁</div>
        <p style="margin-bottom:1rem;color:var(--text-2)">Manage your course syllabus from the right sidebar.</p>
        <button class="btn-primary mt-2" onclick="openContentModal('${courseId}')">+ Add New Content</button>
      </div>
    `;

    /* Assignments tab */
    document.getElementById('teacher-tab-assignments').innerHTML = `
      <div style="margin-bottom:1.5rem">
        <button class="btn-primary" onclick="openPostAssignModal('${courseId}')">+ Post Assignment</button>
      </div>
      ${assigns.length ? assigns.map(a => renderAssignmentCard(a, false)).join('') : '<div class="empty-state"><div class="es-icon">📝</div>No assignments posted yet</div>'}`;

    /* Attendance tab */
    document.getElementById('teacher-tab-attendance').innerHTML = renderMarkAttendance(students, courseId);

    /* Students tab */
    document.getElementById('teacher-tab-students').innerHTML = `
      <div class="batchmates-grid">
        ${students.map(s => `
          <div class="batchmate-card">
            <div class="avatar">${initials(s.name)}</div>
            <div class="batchmate-name">${esc(s.name)}</div>
            <div class="batchmate-meta">${esc(s.email)}</div>
          </div>`).join('')}
      </div>`;

    /* Discussions tab */
    initCourseChatView('teacher-tab-chat', courseId);

  } catch (e) {
    toast('Error loading course', 'error');
  }
}

function renderMarkAttendance(students, courseId) {
  if (!students.length) return '<div class="empty-state">No students enrolled yet</div>';
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap">
      <input type="date" id="att-date" value="${today}" style="background:var(--card);border:1px solid var(--border2);color:var(--text);padding:10px 16px;border-radius:var(--r-md);font-size:16px" />
      <button class="btn-ghost" onclick="markAllPresent()">Mark All Present</button>
      <button class="btn-primary" onclick="submitAttendance('${courseId}')">Save Attendance</button>
    </div>
    <div id="att-student-list">
      ${students.map(s => `
        <div class="mark-att-row" data-sid="${s._id}">
          <div class="mark-att-name">${esc(s.name)}</div>
          <div class="att-toggle">
            <button class="p active" onclick="setAtt(this,'p')">Present</button>
            <button onclick="setAtt(this,'a')">Absent</button>
          </div>
        </div>`).join('')}
    </div>`;
}

function setAtt(btn, status) {
  const row = btn.closest('.mark-att-row');
  row.querySelectorAll('.att-toggle button').forEach(b => b.classList.remove('p','a','active'));
  btn.classList.add(status, 'active');
}

function markAllPresent() {
  document.querySelectorAll('.mark-att-row').forEach(row => {
    row.querySelectorAll('.att-toggle button').forEach(b => b.classList.remove('p','a','active'));
    const pBtn = row.querySelector('.att-toggle button:first-child');
    if (pBtn) { pBtn.classList.add('p','active'); }
  });
}

async function submitAttendance(courseId) {
  const date = document.getElementById('att-date')?.value;
  if (!date) { toast('Please select a date', 'error'); return; }

  const records = [];
  document.querySelectorAll('.mark-att-row').forEach(row => {
    const sid = row.dataset.sid;
    const btn = row.querySelector('.att-toggle button.active');
    if (sid && btn) records.push({ student: sid, status: btn.classList.contains('p') ? 'present' : 'absent' });
  });

  try {
    await API.markAttendance({ course: courseId, date, records });
    toast('Attendance saved!', 'success');
  } catch (e) {
    toast('Error saving attendance', 'error');
  }
}

/* ══════════════════════════════════════════
   ADMIN DASHBOARD
══════════════════════════════════════════ */
async function initAdminDashboard() {
  document.getElementById('admin-finance-stats').innerHTML = skeletonStats(4);
  document.getElementById('admin-entity-stats').innerHTML = skeletonStats(3);

  try {
    const [statsRes, paymentsRes] = await Promise.allSettled([
      API.adminStats().catch(() => ({})),
      API.allPayments(),
    ]);

    const stats    = statsRes.status === 'fulfilled' ? statsRes.value.stats || {} : {};
    const payments = paymentsRes.status === 'fulfilled' ? paymentsRes.value.payments || [] : [];
    const pending  = payments.filter(p => p.status === 'pending');
    const approved = payments.filter(p => p.status === 'approved');

    /* Financial Calculations */
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    
    let todayRev = 0;
    let monthRev = 0;
    
    // Generate last 30 days array for the chart
    const last30Days = [...Array(30)].map((_, i) => {
      const d = new Date(now.getTime() - (29 - i) * 24 * 60 * 60 * 1000);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    });
    const revMap = {};
    last30Days.forEach(d => revMap[d] = 0);

    approved.forEach(p => {
      const pTime = new Date(p.createdAt).getTime();
      const pDate = new Date(p.createdAt);
      const dateStr = `${pDate.getFullYear()}-${String(pDate.getMonth()+1).padStart(2,'0')}-${String(pDate.getDate()).padStart(2,'0')}`;
      
      if (pTime >= startOfDay) todayRev += (p.amount || 0);
      if (pTime >= startOfMonth) monthRev += (p.amount || 0);
      if (revMap[dateStr] !== undefined) revMap[dateStr] += (p.amount || 0);
    });

    document.getElementById('admin-finance-stats').innerHTML = `
      ${statCard('Total Revenue', '₹' + Number(stats.totalRevenue || 0).toLocaleString('en-IN'), 'green')}
      ${statCard('This Month', '₹' + Number(monthRev).toLocaleString('en-IN'), 'teal')}
      ${statCard('Today', '₹' + Number(todayRev).toLocaleString('en-IN'), 'blue')}
      ${statCard('Pending Payments', pending.length, 'amber')}
    `;
    
    document.getElementById('admin-entity-stats').innerHTML = `
      ${statCard('Total Students', stats.students || 0, 'teal')}
      ${statCard('Total Teachers', stats.teachers || 0, 'blue')}
      ${statCard('Total Courses',  stats.courses  || 0, 'amber')}
    `;

    /* Render Revenue Chart */
    const canvas = document.getElementById('admin-revenue-chart');
    if (canvas && typeof Chart !== 'undefined') {
      const existingChart = Chart.getChart('admin-revenue-chart');
      if (existingChart) existingChart.destroy();
      
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, 300);
      gradient.addColorStop(0, 'rgba(34, 211, 238, 0.3)');
      gradient.addColorStop(1, 'rgba(34, 211, 238, 0.0)');

      new Chart(ctx, {
        type: 'line',
        data: {
          labels: last30Days.map(d => d.slice(5)), // Show MM-DD
          datasets: [{
            label: 'Revenue (₹)',
            data: last30Days.map(d => revMap[d]),
            borderColor: '#22d3ee',
            backgroundColor: gradient,
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 1,
            pointHoverRadius: 6,
            pointBackgroundColor: '#22d3ee'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#a1a1aa' } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#a1a1aa' }, beginAtZero: true }
          }
        }
      });
    }

    const pendingEl = document.getElementById('admin-pending-list');
    pendingEl.innerHTML = pending.length
      ? pending.slice(0,5).map(p => renderPaymentCard(p)).join('')
      : '<div class="empty-state">No pending payments 🎉</div>';

    document.getElementById('admin-activity').innerHTML = payments.slice(0,8).map(p => `
      <div class="list-card">
        <div class="lc-icon">💳</div>
        <div class="lc-body">
          <div class="lc-name">${esc(p.student?.name||'Student')} → ${esc(p.course?.name||'Course')}</div>
          <div class="lc-sub">₹${Number(p.amount).toLocaleString('en-IN')} · ${fmtDate(p.createdAt)}</div>
        </div>
        <span class="badge badge-${p.status}">${p.status}</span>
      </div>`).join('');

  } catch (e) {
    toast('Error loading admin dashboard', 'error');
  }
}

/* ══════════════════════════════════════════
   ADMIN PAYMENTS
══════════════════════════════════════════ */
async function initAdminPayments(filter = 'pending') {
  STATE.paymentFilter = filter;
  const toggle = document.getElementById('payments-manual-email-toggle');
  if (toggle) toggle.checked = CONFIG.MANUAL_EMAIL;
  await renderAdminPayments();
}

async function toggleManualEmailFromPayments() {
  const isChecked = document.getElementById('payments-manual-email-toggle').checked;
  CONFIG.MANUAL_EMAIL = isChecked;
  const setEl = document.getElementById('admin-set-manual-email');
  if (setEl) setEl.checked = isChecked; // Keep Settings page synced
  const customEl = document.getElementById('custom-email-manual-toggle');
  if (customEl) customEl.checked = isChecked; // Keep Custom Email modal synced
  
  try {
    await API.updateSettings({ manualEmail: isChecked });
    toast(isChecked ? 'Manual Email Mode ENABLED' : 'Automatic Email Mode ENABLED', 'success');
  } catch (e) {
    toast('Error saving setting', 'error');
  }
}

async function renderAdminPayments() {
  const el = document.getElementById('admin-payments-list');
  el.innerHTML = skeletonList(4);
  try {
    const { payments } = await API.allPayments();
    const filter = STATE.paymentFilter;
    const list = filter === 'all' ? payments : payments.filter(p => p.status === filter);

    if (!list.length) { el.innerHTML = '<div class="empty-state">No payments found</div>'; return; }
    el.innerHTML = list.map(p => renderPaymentCard(p)).join('');
  } catch (e) {
    el.innerHTML = '<div class="empty-state">Error loading payments</div>';
  }
}

function filterPayments(filter, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  STATE.paymentFilter = filter;
  renderAdminPayments();
}

function renderPaymentCard(p) {
  const isPending = p.status === 'pending';
  return `
    <div class="payment-review-card" onclick="previewScreenshot('${p.screenshotUrl}','${p._id}','${p.status}')" style="cursor:pointer;">
      <img class="pay-thumb" src="${p.screenshotUrl||''}" alt="Screenshot" onerror="this.style.background='var(--bg3)'" />
      <div class="pay-info">
        <div class="pay-name">${esc(p.student?.name||'Student')}</div>
        <div class="pay-meta">Course: ${esc(p.course?.name||'—')} · ₹${Number(p.amount).toLocaleString('en-IN')}</div>
        <div class="pay-meta">${fmtDate(p.createdAt)}</div>
      </div>
      <div class="pay-actions">
        <span class="badge badge-${p.status}">${p.status}</span>
        ${isPending ? `
          <button class="btn-danger"  onclick="event.stopPropagation(); rejectPayment('${p._id}')">✕ Reject</button>
          <button class="btn-approve" onclick="event.stopPropagation(); approvePayment('${p._id}')">✓ Approve</button>` : ''}
      </div>
    </div>`;
}

async function approvePayment(payId) {
  try {
    const res = await API.approvePayment(payId);
    toast('Payment approved — student enrolled!', 'success');
    
    if (res.manualEmail) {
      const { to, subject, body } = res.manualEmail;
      const mailtoLink = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      
      const a = document.createElement('a');
      a.href = mailtoLink;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    
    renderAdminPayments();
  } catch (e) { toast('Error approving payment', 'error'); }
}

async function rejectPayment(payId) {
  if (!confirm('Reject this payment? The student will be asked to re-submit.')) return;
  try {
    await API.rejectPayment(payId);
    toast('Payment rejected', 'error');
    renderAdminPayments();
  } catch (e) { toast('Error rejecting payment', 'error'); }
}

function previewScreenshot(url, payId, status) {
  const img = document.getElementById('screenshot-img');
  const actions = document.getElementById('screenshot-actions');
  img.src = url || '';
  actions.innerHTML = payId && status === 'pending' ? `
    <button class="btn-approve" onclick="approvePayment('${payId}');closeAllModals()">✓ Approve</button>
    <button class="btn-danger"  onclick="rejectPayment('${payId}');closeAllModals()">✕ Reject</button>
    ` : '';
  openModal('modal-screenshot');
}

/* ══════════════════════════════════════════
   ADMIN STUDENTS
══════════════════════════════════════════ */
async function initAdminStudents() {
  const el = document.getElementById('admin-students-table');
  el.innerHTML = skeletonTable(5);
  try {
    const { users } = await API.allStudents();
    STATE.adminStudents = users || [];
    renderAdminStudents();
  } catch (e) {
    el.innerHTML = '<div class="empty-state">Error loading students</div>';
  }
}

function renderAdminStudents() {
  const el  = document.getElementById('admin-students-table');
  const q   = document.getElementById('student-search')?.value?.toLowerCase() || '';
  const list = STATE.adminStudents.filter(u =>
      (u.name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q)
    );
    if (!list.length) { el.innerHTML = '<div class="empty-state">No students found</div>'; return; }
    el.innerHTML = '<div class="modern-list">' + list.map(u => `
      <div class="modern-list-card">
        <div class="mlc-info">
          <div class="avatar" style="width:40px;height:40px;font-size:15px;margin:0;">${initials(u.name)}</div>
          <div class="mlc-details">
            <div class="mlc-title">${esc(u.name)}</div>
            <div class="mlc-subtitle">@${esc(u.username)} · ${esc(u.email)}</div>
          </div>
        </div>
        <div class="mlc-status">
          <span class="badge badge-${u.active?'approved':'rejected'}">${u.active?'Active':'Suspended'}</span>
        </div>
        <div class="mlc-actions actions-menu">
              <button class="actions-btn" onclick="toggleActionsMenu(event)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"></path></svg>
              </button>
              <div class="actions-dropdown">
                <a onclick="openStudentReport('${u._id}')">View Report</a>
                <a onclick="openManualEnrolModal('${u._id}', '${esc(u.name)}')">Enrol in Course</a>
                <a onclick="openCustomEmailModal('${u._id}')">Send Email</a>
                <a onclick="toggleUserActive('${u._id}',${!u.active})">${u.active?'Suspend':'Activate'}</a>
              </div>
        </div>
      </div>`).join('') + '</div>';
}

async function openManualEnrolModal(studentId, studentName) {
  document.getElementById('manual-enrol-student-id').value = studentId;
  document.getElementById('manual-enrol-student-name').textContent = studentName;
  const sel = document.getElementById('manual-enrol-course-select');
  sel.innerHTML = '<option value="">Loading courses...</option>';
  openModal('modal-manual-enrol');
  try {
    const { courses } = await API.courses();
    sel.innerHTML = '<option value="">-- Select Course --</option>' + 
      (courses||[]).map(c => `<option value="${c._id}">${esc(c.name)}</option>`).join('');
  } catch(e) { sel.innerHTML = '<option value="">Error loading courses</option>'; }
}

async function submitManualEnrol() {
  const studentId = document.getElementById('manual-enrol-student-id').value;
  const courseId = document.getElementById('manual-enrol-course-select').value;
  if (!courseId) { toast('Please select a course', 'error'); return; }
  const btn = document.querySelector('#modal-manual-enrol .btn-primary');
  btn.textContent = 'Enrolling...'; btn.disabled = true;
  try {
    await API.manualEnrol({ studentId, courseId });
    toast('Student enrolled manually!', 'success');
    closeAllModals();
  } catch(e) { toast(e.message || 'Error enrolling student', 'error'); }
  finally { btn.textContent = 'Enrol Student'; btn.disabled = false; }
}

async function toggleUserActive(id, active) {
  try {
    await API.updateUser(id, { active });
    toast(active ? 'User activated' : 'User suspended');
    if (STATE.currentPage === 'admin-students') initAdminStudents();
    if (STATE.currentPage === 'admin-users') initAdminUsers();
  } catch (e) { toast('Error updating user', 'error'); }
}

function exportAdminStudents() {
  const list = STATE.adminStudents;
  if (!list.length) { toast('No students to export', 'error'); return; }
  const q = document.getElementById('student-search')?.value?.toLowerCase() || '';
  const filtered = list.filter(u => (u.name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q));
  
  const headers = ['Name', 'Username', 'Email', 'Status'];
  const rows = filtered.map(u => [
    `"${u.name||''}"`, `"${u.username||''}"`, `"${u.email||''}"`, u.active ? 'Active' : 'Suspended'
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadCSV(csv, 'students_export.csv');
}

async function openStudentReport(id) {
  openModal('modal-student-report');
  const el = document.getElementById('student-report-content');
  el.innerHTML = '<div class="empty-state">Loading report...</div>';
  try {
    const { report } = await API.studentReport(id);
    const { user, enrolments, payments, submissions, attendance } = report;
    const attPct = attendance.total ? Math.round((attendance.present / attendance.total) * 100) : 0;
    
    el.innerHTML = `
      <div style="display:flex;gap:15px;align-items:center;margin-bottom:1.5rem">
        <div class="avatar" style="width:64px;height:64px;font-size:24px;margin:0">${initials(user.name)}</div>
        <div>
          <h2 style="font-family:var(--font-head);font-size:20px;margin-bottom:4px">${esc(user.name)}</h2>
          <div style="color:var(--text-2);font-size:14px">@${esc(user.username)} · ${esc(user.email)}</div>
        </div>
      </div>
      <div class="stats-row" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:1.5rem">
        ${statCard('Enrolled', enrolments.length, 'teal')}
        ${statCard('Attendance', attPct + '%', attPct >= 75 ? 'teal' : 'red')}
        ${statCard('Submissions', submissions.length, 'blue')}
      </div>
      <h4 style="margin-bottom:10px;font-family:var(--font-head);color:var(--text-2)">Enrolled Courses</h4>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:1rem">
        ${enrolments.length ? enrolments.map(e => `<div style="font-size:14px;padding:6px 4px;border-bottom:1px solid var(--border)">• ${esc(e.course?.name || 'Unknown')} <span class="badge badge-${e.status==='active'?'approved':'pending'}" style="font-size:11px;padding:2px 6px;margin-left:6px">${e.status}</span></div>`).join('') : '<div class="text-muted" style="font-size:14px;padding:6px;">No active enrolments.</div>'}
      </div>
      <h4 style="margin-bottom:10px;font-family:var(--font-head);color:var(--text-2)">Recent Payments</h4>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r-md);padding:10px;">
        ${payments.length ? payments.slice(0, 5).map(p => `<div style="font-size:14px;display:flex;justify-content:space-between;padding:6px 4px;border-bottom:1px solid var(--border)"><span>${esc(p.course?.name || 'Course')}</span><span class="badge badge-${p.status}" style="font-size:11px;padding:2px 6px">₹${p.amount} · ${p.status}</span></div>`).join('') : '<div class="text-muted" style="font-size:14px;padding:6px;">No payments found.</div>'}
      </div>
    `;
  } catch (e) { el.innerHTML = '<div class="empty-state">Error loading report</div>'; }
}

/* ══════════════════════════════════════════
   CUSTOM EMAIL FEATURE
══════════════════════════════════════════ */
async function openCustomEmailModal(userId = null, preSelectCourseId = null) {
  document.getElementById('custom-email-subject').value = '';
  document.getElementById('custom-email-body').value = '';
  
  document.getElementById('custom-email-manual-toggle').checked = CONFIG.MANUAL_EMAIL;

  const toggle = document.getElementById('custom-email-batch-toggle');
  toggle.checked = !!preSelectCourseId || !userId;
  
  if (userId) {
    const user = STATE.adminUsers.find(u => u._id === userId) || STATE.adminStudents.find(u => u._id === userId);
    if (user) {
      document.getElementById('custom-email-user-id').value = user._id;
      document.getElementById('custom-email-target').textContent = `${user.name} (${user.email})`;
    }
  } else {
    document.getElementById('custom-email-target').textContent = 'No single user selected';
    document.getElementById('custom-email-user-id').value = '';
  }
  
  const sel = document.getElementById('custom-email-course-select');
  sel.innerHTML = '<option value="">Loading courses...</option>';
  openModal('modal-custom-email');
  toggleEmailMode();

  try {
    const { courses } = await API.courses();
    sel.innerHTML = '<option value="">-- Select Course --</option>' + 
      (courses||[]).map(c => `<option value="${c._id}">${esc(c.name)}</option>`).join('');
    if (preSelectCourseId) sel.value = preSelectCourseId;
  } catch(e) { sel.innerHTML = '<option value="">Error loading courses</option>'; }
}

function toggleEmailMode() {
  const isBatch = document.getElementById('custom-email-batch-toggle').checked;
  document.getElementById('custom-email-single-view').classList.toggle('hidden', isBatch);
  document.getElementById('custom-email-batch-view').classList.toggle('hidden', !isBatch);
}

async function toggleManualEmailFromCustom() {
  const isChecked = document.getElementById('custom-email-manual-toggle').checked;
  CONFIG.MANUAL_EMAIL = isChecked;
  
  const setEl = document.getElementById('admin-set-manual-email');
  if (setEl) setEl.checked = isChecked;
  const payEl = document.getElementById('payments-manual-email-toggle');
  if (payEl) payEl.checked = isChecked;
  
  try {
    await API.updateSettings({ manualEmail: isChecked });
    toast(isChecked ? 'Manual Mode ENABLED' : 'Automatic Mode ENABLED', 'success');
  } catch (e) {
    toast('Error saving setting', 'error');
  }
}

async function submitCustomEmail() {
  const isBatch = document.getElementById('custom-email-batch-toggle').checked;
  const subject = document.getElementById('custom-email-subject').value.trim();
  const message = document.getElementById('custom-email-body').value.trim();
  if (!subject || !message) { toast('Subject and message are required', 'error'); return; }
  
  let payload = { subject, message };
  let emails = [];

  if (isBatch) {
    const courseId = document.getElementById('custom-email-course-select').value;
    if (!courseId) { toast('Please select a course', 'error'); return; }
    payload.courseId = courseId;
    
    if (CONFIG.MANUAL_EMAIL) {
      try {
        const data = await API.courseStudents(courseId);
        emails = (data.students || []).map(s => s.email).filter(e => e);
      } catch(e) { toast('Error fetching students', 'error'); return; }
    }
  } else {
    const userId = document.getElementById('custom-email-user-id').value;
    if (!userId) { toast('No single user selected', 'error'); return; }
    payload.userId = userId;
    
    if (CONFIG.MANUAL_EMAIL) {
      const user = STATE.adminUsers.find(u => u._id === userId) || STATE.adminStudents.find(u => u._id === userId);
      if (user && user.email) emails.push(user.email);
    }
  }

  if (CONFIG.MANUAL_EMAIL) {
    if (!emails.length) { toast('No recipients found', 'error'); return; }
    
    // For single users, put them in 'To'. For batches, put them in 'BCC' to protect privacy.
    const mailtoLink = isBatch 
      ? `mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
      : `mailto:${encodeURIComponent(emails[0])}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
      
    const a = document.createElement('a');
    a.href = mailtoLink;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    toast('Opened in your email client!', 'success');
    closeAllModals();
    return;
  }

  const btn = document.querySelector('#modal-custom-email .btn-primary');
  const origText = btn.textContent; btn.textContent = 'Sending...'; btn.disabled = true;
  try {
    const res = await API.sendCustomEmail(payload);
    toast(res.message || 'Email sent successfully!', 'success');
    closeAllModals();
  } catch (e) { toast(e.message || 'Error sending email', 'error'); }
  finally { btn.textContent = origText; btn.disabled = false; }
}

/* ══════════════════════════════════════════
   ADMIN COURSES
══════════════════════════════════════════ */
async function initAdminCourses() {
  const el = document.getElementById('admin-courses-table');
  el.innerHTML = skeletonTable(5);
  try {
    const { courses } = await API.courses();
    STATE.adminCourses = courses || [];
    renderAdminCourses();
  } catch (e) {
    el.innerHTML = '<div class="empty-state">Error loading courses</div>';
  }
}

function renderAdminCourses() {
  const el = document.getElementById('admin-courses-table');
  const q = document.getElementById('admin-course-search')?.value?.toLowerCase() || '';
  const list = STATE.adminCourses.filter(c => (c.name||'').toLowerCase().includes(q) || (c.teacher?.name||'').toLowerCase().includes(q));
  if (!list.length) { el.innerHTML = '<div class="empty-state">No courses found.</div>'; return; }

    el.innerHTML = '<div class="modern-list">' + list.map(c => `
      <div class="modern-list-card">
        <div class="mlc-info">
          <div class="avatar" style="width:44px;height:44px;font-size:18px;margin:0;background:var(--bg3);border-color:var(--border2);color:var(--text);">${esc(c.name[0].toUpperCase())}</div>
          <div class="mlc-details">
            <div class="mlc-title">${esc(c.name)}</div>
            <div class="mlc-subtitle">${esc(c.duration||'Self-paced')} · Teacher: ${esc(c.teacher?.name||'Unassigned')}</div>
          </div>
        </div>
        <div class="mlc-status">
          <span style="font-weight:600;color:var(--teal);font-size:16px;">₹${Number(c.fee).toLocaleString('en-IN')}</span>
          <span class="badge badge-enrolled" style="margin-left:8px;">👥 ${c.studentCount||0}</span>
        </div>
        <div class="mlc-actions actions-menu">
              <button class="actions-btn" onclick="toggleActionsMenu(event)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"></path></svg>
              </button>
              <div class="actions-dropdown">
                <a onclick="openCourseModal('${c._id}')">Edit Course</a>
                <a onclick="openCustomEmailModal(null, '${c._id}')">Email Class</a>
                <a class="danger" onclick="deleteCourseAdmin('${c._id}')">Delete Course</a>
              </div>
        </div>
      </div>`).join('') + '</div>';
}

async function openCourseModal(courseId = null) {
  if (typeof courseId !== 'string') courseId = null; // Guard against MouseEvent objects
  
  document.getElementById('course-edit-id').value = courseId || '';
  document.getElementById('course-modal-title').textContent = courseId ? 'Edit Course' : 'Add Course';

  const sel = document.getElementById('course-teacher-input');
  sel.innerHTML = '<option value="">-- Select Teacher --</option>';
  try {
    const { users } = await API.allTeachers();
    sel.innerHTML += (users||[]).map(t => `<option value="${t._id}">${esc(t.name)}</option>`).join('');
  } catch (e) { console.error('Could not load teachers:', e); }

  /* Load or clear course data */
  if (courseId) {
    try {
      const { course } = await API.courseById(courseId);
      document.getElementById('course-name-input').value     = course.name || '';
      document.getElementById('course-desc-input').value     = course.description || '';
      document.getElementById('course-fee-input').value      = course.fee !== undefined ? course.fee : '';
      document.getElementById('course-duration-input').value = course.duration || '';
      document.getElementById('course-category-input').value = course.category || '';
      document.getElementById('course-thumbnail-input').value= course.thumbnail || '';
      sel.value = course.teacher?._id || course.teacher || '';
    } catch (e) {
      toast('Error loading course data', 'error');
      return;
    }
  } else {
    ['course-name-input','course-desc-input','course-fee-input','course-duration-input','course-category-input','course-thumbnail-input'].forEach(id => {
      document.getElementById(id).value = '';
    });
    sel.value = '';
  }

  openModal('modal-course');
}

async function saveCourse() {
  const id   = document.getElementById('course-edit-id').value;
  const feeInput = document.getElementById('course-fee-input').value.trim();
  const data = {
    name:        document.getElementById('course-name-input').value.trim(),
    description: document.getElementById('course-desc-input').value.trim(),
    fee:         feeInput === '' ? 0 : Number(feeInput),
    duration:    document.getElementById('course-duration-input').value.trim(),
    category:    document.getElementById('course-category-input').value.trim(),
    thumbnail:   document.getElementById('course-thumbnail-input').value.trim(),
    teacher:     document.getElementById('course-teacher-input').value || null,
  };

  if (!data.teacher) {
    delete data.teacher;
    if (id) data.$unset = { teacher: 1 };
  }

  if (!data.name) { toast('Course name is required', 'error'); return; }
  if (isNaN(data.fee) || data.fee < 0) { toast('Please enter a valid fee', 'error'); return; }

  const btn = document.querySelector('#modal-course .btn-primary');
  const origText = btn.textContent;
  btn.textContent = 'Saving...'; btn.disabled = true;

  try {
    if (id) await API.updateCourse(id, data);
    else    await API.createCourse(data);
    toast(id ? 'Course updated!' : 'Course created!', 'success');
    closeAllModals();
    initAdminCourses();
  } catch (e) { 
    console.error(e);
    toast(e.message || 'Error saving course', 'error'); 
  } finally {
    btn.textContent = origText; btn.disabled = false;
  }
}

async function deleteCourseAdmin(id) {
  if (!confirm('Delete this course? This cannot be undone.')) return;
  try {
    await API.deleteCourse(id);
    toast('Course deleted');
    initAdminCourses();
  } catch (e) { toast('Error deleting course', 'error'); }
}

function exportAdminCourses() {
  const list = STATE.adminCourses;
  if (!list.length) { toast('No courses to export', 'error'); return; }
  const q = document.getElementById('admin-course-search')?.value?.toLowerCase() || '';
  const filtered = list.filter(c => (c.name||'').toLowerCase().includes(q) || (c.teacher?.name||'').toLowerCase().includes(q));
  
  const headers = ['Course Name', 'Duration', 'Teacher Name', 'Fee (INR)', 'Enrolled Students'];
  const rows = filtered.map(c => [
    `"${c.name||''}"`, `"${c.duration||''}"`, `"${c.teacher?.name||'Unassigned'}"`, c.fee||0, c.studentCount||0
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadCSV(csv, 'courses_export.csv');
}

/* ══════════════════════════════════════════
   ADMIN USERS
══════════════════════════════════════════ */
async function initAdminUsers() {
  const el = document.getElementById('admin-users-table');
  el.innerHTML = skeletonTable(5);
  try {
    const { users } = await API.allUsers();
    STATE.adminUsers = users || [];
    renderAdminUsers();
  } catch (e) {
    el.innerHTML = '<div class="empty-state">Error loading users</div>';
  }
}

function renderAdminUsers() {
  const el = document.getElementById('admin-users-table');
  const q = document.getElementById('admin-user-search')?.value?.toLowerCase() || '';
  const list = STATE.adminUsers.filter(u => 
    (u.name||'').toLowerCase().includes(q) || 
    (u.username||'').toLowerCase().includes(q) || 
    (u.role||'').toLowerCase().includes(q)
  );
  if (!list.length) { el.innerHTML = '<div class="empty-state">No users found.</div>'; return; }

    el.innerHTML = '<div class="modern-list">' + list.map(u => `
      <div class="modern-list-card">
        <div class="mlc-info">
          <div class="avatar" style="width:40px;height:40px;font-size:15px;margin:0;">${initials(u.name)}</div>
          <div class="mlc-details">
            <div class="mlc-title">${esc(u.name)}</div>
            <div class="mlc-subtitle">@${esc(u.username)}</div>
          </div>
        </div>
        <div class="mlc-status">
          <span class="badge badge-pending" style="border-color:currentColor; text-transform:capitalize;">${esc(u.role)}</span>
          <span class="badge badge-${u.active?'approved':'rejected'}" style="margin-left:6px;">${u.active?'Active':'Suspended'}</span>
        </div>
        <div class="mlc-actions actions-menu">
              <button class="actions-btn" onclick="toggleActionsMenu(event)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"></path></svg>
              </button>
              <div class="actions-dropdown">
                <a onclick="openEditUserModal('${u._id}')">Edit User</a>
            ${u.role !== 'admin' ? `<a onclick="impersonateUser('${u._id}')">🕵️ Impersonate</a>` : ''}
                <a onclick="openCustomEmailModal('${u._id}')">Send Email</a>
                <a onclick="toggleUserActive('${u._id}', ${!u.active})">${u.active ? 'Suspend' : 'Activate'}</a>
                <a class="danger" onclick="deleteUserAdmin('${u._id}')">Delete User</a>
              </div>
        </div>
      </div>`).join('') + '</div>';
}

function openAddUserModal() {
  document.getElementById('add-user-name').value = '';
  document.getElementById('add-user-username').value = '';
  document.getElementById('add-user-email').value = '';
  document.getElementById('add-user-password').value = '';
  document.getElementById('add-user-role').value = 'student';
  openModal('modal-add-user');
}

async function submitAddUser() {
  const name = document.getElementById('add-user-name').value.trim();
  const username = document.getElementById('add-user-username').value.trim();
  const email = document.getElementById('add-user-email').value.trim();
  const password = document.getElementById('add-user-password').value;
  const role = document.getElementById('add-user-role').value;
  
  if(!name || !username || !email || !password) { toast('All fields are required', 'error'); return; }
  if(password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
  
  const btn = document.querySelector('#modal-add-user .btn-primary');
  btn.textContent = 'Creating...'; btn.disabled = true;
  
  try {
    await API.createUser({ name, username, email, password, role });
    toast('User created successfully!', 'success');
    closeAllModals();
    initAdminUsers();
  } catch(e) { toast(e.message || 'Error creating user', 'error'); }
  finally { btn.textContent = 'Create User'; btn.disabled = false; }
}

function triggerBulkUserUpload() {
  document.getElementById('bulk-user-upload').click();
}

async function handleBulkUserUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    const rows = e.target.result.split('\n').map(r => r.trim()).filter(r => r);
    if (rows.length < 2) { toast('CSV is empty or missing headers', 'error'); return; }
    
    const headers = rows[0].toLowerCase().split(',');
    const users = [];
    
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i].split(',');
      const user = {};
      headers.forEach((h, idx) => {
        const val = (cols[idx] || '').replace(/^"|"$/g, '').trim();
        if (h.includes('name') && !h.includes('user')) user.name = val;
        else if (h.includes('user')) user.username = val;
        else if (h.includes('email')) user.email = val;
        else if (h.includes('role')) user.role = val.toLowerCase();
        else if (h.includes('pass')) user.password = val;
      });
      if (user.name && user.username && user.email) users.push(user);
    }
    
    if (!users.length) { toast('No valid users found in CSV', 'error'); return; }
    try {
      const res = await API.bulkCreateUsers({ users });
      toast(res.message, 'success');
      initAdminUsers();
    } catch (err) { toast(err.message || 'Error uploading users', 'error'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function openEditUserModal(id) {
  const user = STATE.adminUsers.find(u => u._id === id);
  if (!user) return;
  document.getElementById('edit-user-id').value = user._id;
  document.getElementById('edit-user-name').value = user.name || '';
  document.getElementById('edit-user-username').value = user.username || '';
  document.getElementById('edit-user-email').value = user.email || '';
  document.getElementById('edit-user-role').value = user.role || 'student';
  document.getElementById('edit-user-password').value = '';
  openModal('modal-edit-user');
}

async function submitEditUser() {
  const id = document.getElementById('edit-user-id').value;
  const payload = {
    name: document.getElementById('edit-user-name').value.trim(),
    username: document.getElementById('edit-user-username').value.trim(),
    email: document.getElementById('edit-user-email').value.trim(),
    role: document.getElementById('edit-user-role').value
  };
  const pwd = document.getElementById('edit-user-password').value;
  if (pwd) payload.password = pwd;
  
  try {
    await API.updateUser(id, payload);
    toast('User updated successfully!', 'success');
    closeAllModals();
    initAdminUsers();
  } catch (e) { toast(e.message || 'Error updating user', 'error'); }
}

async function deleteUserAdmin(id) {
  if (!confirm('Are you sure you want to permanently delete this user? This will remove all their data and cannot be undone.')) return;
  try {
    await API.deleteUser(id);
    toast('User deleted successfully', 'success');
    if (STATE.currentPage === 'admin-users') initAdminUsers();
    if (STATE.currentPage === 'admin-students') initAdminStudents();
  } catch (e) { toast(e.message || 'Error deleting user', 'error'); }
}

function exportAdminUsers() {
  const list = STATE.adminUsers;
  if (!list.length) { toast('No users to export', 'error'); return; }
  const q = document.getElementById('admin-user-search')?.value?.toLowerCase() || '';
  const filtered = list.filter(u => (u.name||'').toLowerCase().includes(q) || (u.username||'').toLowerCase().includes(q) || (u.role||'').toLowerCase().includes(q));
  
  const headers = ['Name', 'Username', 'Email', 'Role', 'Status'];
  const rows = filtered.map(u => [
    `"${u.name||''}"`, `"${u.username||''}"`, `"${u.email||''}"`, `"${u.role||''}"`, u.active ? 'Active' : 'Suspended'
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadCSV(csv, 'all_users_export.csv');
}

async function exportAdminPayments() {
  try {
    const { payments } = await API.allPayments();
    const filter = STATE.paymentFilter;
    const list = filter === 'all' ? payments : payments.filter(p => p.status === filter);
    if (!list || !list.length) { toast('No payments to export', 'error'); return; }
    
    const headers = ['Student Name', 'Course', 'Amount (INR)', 'Status', 'Date Submitted'];
    const rows = list.map(p => [
      `"${p.student?.name||'Unknown'}"`, `"${p.course?.name||'Unknown'}"`, p.amount||0, p.status||'', fmtDate(p.createdAt)
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadCSV(csv, `payments_${filter}_export.csv`);
  } catch (e) { toast('Error exporting payments', 'error'); }
}

/* ══════════════════════════════════════════
   ADMIN EXTENDED FEATURES (Impersonate & Broadcast)
══════════════════════════════════════════ */
async function impersonateUser(id) {
  if (!confirm('You are about to log in as this user. Continue?')) return;
  try {
    const target = STATE.adminUsers.find(u => u._id === id);
    if (!target) throw new Error('User not found');

    localStorage.setItem('abc_admin_backup_token', STATE.token);
    localStorage.setItem('abc_admin_backup_user', JSON.stringify(STATE.user));

    STATE.token = id;
    STATE.user = target;
    localStorage.setItem('abc_token', id);
    localStorage.setItem('abc_user', JSON.stringify(target));

    if (socket) { socket.disconnect(); socket = null; }
    initSocket();
    showNav();
    redirectByRole();
    toast(`Impersonating ${target.name}`, 'success');
  } catch (e) { toast('Error impersonating user', 'error'); }
}

function returnToAdmin() {
  const backupToken = localStorage.getItem('abc_admin_backup_token');
  const backupUser = localStorage.getItem('abc_admin_backup_user');
  if (!backupToken || !backupUser) return;

  STATE.token = backupToken;
  STATE.user = JSON.parse(backupUser);
  localStorage.setItem('abc_token', backupToken);
  localStorage.setItem('abc_user', backupUser);

  localStorage.removeItem('abc_admin_backup_token');
  localStorage.removeItem('abc_admin_backup_user');

  if (socket) { socket.disconnect(); socket = null; }
  initSocket();
  showNav();
  redirectByRole();
  toast('Returned to Admin mode', 'success');
}

function openBroadcastModal() {
  document.getElementById('broadcast-msg').value = '';
  document.getElementById('broadcast-type').value = 'success';
  openModal('modal-broadcast');
}

async function sendBroadcast() {
  const message = document.getElementById('broadcast-msg').value.trim();
  const type = document.getElementById('broadcast-type').value;
  if (!message) { toast('Message is required', 'error'); return; }
  
  const btn = document.querySelector('#modal-broadcast .btn-primary');
  btn.textContent = 'Sending...'; btn.disabled = true;
  try {
    await API.broadcast({ message, type });
    toast('Broadcast sent to all users!', 'success');
    closeAllModals();
  } catch (e) { toast(e.message || 'Error sending broadcast', 'error'); }
  finally { btn.textContent = 'Send Broadcast'; btn.disabled = false; }
}

/* ══════════════════════════════════════════
   ADMIN LOGS
══════════════════════════════════════════ */
async function initAdminLogs() {
  const el = document.getElementById('admin-logs-table');
  el.innerHTML = skeletonTable(5);
  try {
    const { logs } = await API.adminLogs();
    STATE.adminLogs = logs || [];
    renderAdminLogs();
  } catch (e) {
    el.innerHTML = '<div class="empty-state">Error loading logs</div>';
  }
}

function renderAdminLogs() {
  const el = document.getElementById('admin-logs-table');
  const q = document.getElementById('admin-log-search')?.value?.toLowerCase() || '';
  const list = STATE.adminLogs.filter(l => 
    (l.ip||'').toLowerCase().includes(q) || 
    (l.action||'').toLowerCase().includes(q) || 
    (l.user?.name||'').toLowerCase().includes(q) ||
    (l.user?.username||'').toLowerCase().includes(q)
  );

  if (!list.length) { el.innerHTML = '<div class="empty-state">No logs found.</div>'; return; }

  const ipCounts = {};
  STATE.adminLogs.forEach(l => { if (l.action === 'visit') ipCounts[l.ip] = (ipCounts[l.ip] || 0) + 1; });

  el.innerHTML = '<div class="modern-list">' + list.map(l => {
        let bColor = 'blue';
        if (l.action === 'login' || l.action === 'signup') bColor = 'green';
        else if (l.action === 'logout' || l.action === 'exit') bColor = 'red';
        else if (l.action === 'visit') bColor = 'teal';
        
        return `
        <div class="modern-list-card">
          <div class="mlc-info">
            <div class="mlc-details">
              <div class="mlc-title">${l.user ? esc(l.user.name) + ' <span style="color:var(--text-3);font-size:14px;font-weight:400;">(@' + esc(l.user.username) + ')</span>' : '<span class="text-muted">Guest User</span>'}</div>
              <div class="mlc-subtitle" style="font-family:monospace; margin:2px 0 6px;">${esc(l.ip)} <span style="color:var(--text-3)">(${ipCounts[l.ip] || 0} visits)</span></div>
              <div class="mlc-subtitle" style="color:var(--text); white-space:normal; line-height:1.4;">${esc(l.details || '')}</div>
              <div class="mlc-subtitle" style="font-size:12px; margin-top:4px;">${new Date(l.createdAt).toLocaleString('en-IN')}</div>
            </div>
          </div>
          <div class="mlc-status">
            <span class="badge" style="border:1px solid currentColor;color:var(--${bColor})">${esc(l.action)}</span>
          </div>
        </div>`;
      }).join('') + '</div>';
}

function exportAdminLogs() {
  const list = STATE.adminLogs;
  if (!list || !list.length) { toast('No logs to export', 'error'); return; }
  const q = document.getElementById('admin-log-search')?.value?.toLowerCase() || '';
  const filtered = list.filter(l => 
    (l.ip||'').toLowerCase().includes(q) || 
    (l.action||'').toLowerCase().includes(q) || 
    (l.user?.name||'').toLowerCase().includes(q) ||
    (l.user?.username||'').toLowerCase().includes(q)
  );
  
  const headers = ['Date & Time', 'IP Address', 'Action', 'User Name', 'Username', 'Details'];
  const rows = filtered.map(l => [
    `"${new Date(l.createdAt).toLocaleString('en-IN')}"`, 
    `"${l.ip || ''}"`, `"${l.action || ''}"`, 
    `"${l.user?.name || 'Guest'}"`, `"${l.user?.username || ''}"`, 
    `"${(l.details || '').replace(/"/g, '""')}"`
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadCSV(csv, 'system_logs_export.csv');
}

/* ══════════════════════════════════════════
   CONTENT MANAGEMENT (Teacher)
══════════════════════════════════════════ */
async function openContentModal(courseId) {
  document.getElementById('content-course-id').value = courseId;
  document.getElementById('content-title-input').value = '';
  document.getElementById('content-order-input').value = '';
  document.getElementById('content-url-input').value   = '';
  document.getElementById('content-thumbnail-input').value = '';
  document.getElementById('content-desc-input').value  = '';
  document.getElementById('content-url-group').classList.add('hidden');
  document.getElementById('content-thumbnail-group').classList.add('hidden');
  document.getElementById('content-parent-group').classList.add('hidden');
  document.querySelectorAll('.role-btn[data-ctype]').forEach(b => b.classList.remove('active'));
  document.querySelector('.role-btn[data-ctype="chapter"]').classList.add('active');

  try {
    const { content } = await API.courseContent(courseId);
    const chapters = (content || []).filter(c => c.type === 'chapter');
    const sel = document.getElementById('content-parent-input');
    sel.innerHTML = '<option value="">-- Root (No Chapter) --</option>' +
      chapters.map(c => `<option value="${c._id}">${esc(c.title)}</option>`).join('');
  } catch (e) {}

  openModal('modal-content');
}

function selectCtype(btn) {
  document.querySelectorAll('.role-btn[data-ctype]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const type = btn.dataset.ctype;
  
  const urlGroup = document.getElementById('content-url-group');
  const descGroup = document.getElementById('content-desc-group');
  
  urlGroup.classList.toggle('hidden', type === 'chapter');
  document.getElementById('content-thumbnail-group').classList.toggle('hidden', type !== 'video');
  document.getElementById('content-parent-group').classList.toggle('hidden', type === 'chapter');
  
  if (type === 'file') {
    urlGroup.querySelector('label').textContent = 'Google Drive Link (Optional Document)';
    descGroup.querySelector('label').textContent = 'Notes Content (Optional Text)';
    document.getElementById('content-desc-input').rows = 6;
  } else {
    urlGroup.querySelector('label').textContent = 'Google Drive Link';
    descGroup.querySelector('label').textContent = 'Description (optional)';
    document.getElementById('content-desc-input').rows = 2;
  }
}

async function saveContent() {
  const courseId = document.getElementById('content-course-id').value;
  const type     = document.querySelector('.role-btn[data-ctype].active')?.dataset.ctype || 'chapter';
  const title    = document.getElementById('content-title-input').value.trim();
  const order    = Number(document.getElementById('content-order-input').value) || 0;
  const url      = document.getElementById('content-url-input').value.trim();
  const thumbnail= document.getElementById('content-thumbnail-input').value.trim();
  const desc     = document.getElementById('content-desc-input').value.trim();
  const parentId = document.getElementById('content-parent-input').value || null;

  if (!title) { toast('Title is required', 'error'); return; }
  if (type === 'video' && !url) { toast('Please paste the Google Drive link', 'error'); return; }

  const btn = document.querySelector('#modal-content .btn-primary');
  const origText = btn.textContent;
  btn.textContent = 'Adding...'; btn.disabled = true;

  try {
    await API.addContent({ course: courseId, type, title, url, thumbnail, order, description: desc, parentId: type === 'chapter' ? null : parentId });
    toast('Content added!', 'success');
    closeAllModals();
    initTeacherCourse();
  } catch (e) { toast('Error adding content', 'error'); }
  finally { btn.textContent = origText; btn.disabled = false; }
}

async function deleteContent(id) {
  if (!confirm('Remove this content?')) return;
  try {
    await API.deleteContent(id);
    toast('Content removed');
    initTeacherCourse();
  } catch (e) { toast('Error removing content', 'error'); }
}

/* ══════════════════════════════════════════
   ASSIGNMENTS
══════════════════════════════════════════ */
function openPostAssignModal(courseId) {
  document.getElementById('assign-course-id').value = courseId;
  document.getElementById('assign-title-input').value = '';
  document.getElementById('assign-desc-input').value  = '';
  document.getElementById('assign-url-input').value   = '';
  document.getElementById('assign-due-input').value   = '';
  openModal('modal-post-assign');
}

async function postAssignment() {
  const courseId = document.getElementById('assign-course-id').value;
  const title    = document.getElementById('assign-title-input').value.trim();
  const desc     = document.getElementById('assign-desc-input').value.trim();
  const url      = document.getElementById('assign-url-input').value.trim();
  const due      = document.getElementById('assign-due-input').value;

  if (!title || !due) { toast('Title and due date are required', 'error'); return; }

  const btn = document.querySelector('#modal-post-assign .btn-primary');
  const origText = btn.textContent;
  btn.textContent = 'Posting...'; btn.disabled = true;

  try {
    await API.postAssignment({ course: courseId, title, description: desc, url, dueDate: due });
    toast('Assignment posted!', 'success');
    closeAllModals();
    initTeacherCourse();
  } catch (e) { toast('Error posting assignment', 'error'); }
  finally { btn.textContent = origText; btn.disabled = false; }
}

function openSubmitModal(assignId) {
  document.getElementById('submit-assign-id').value = assignId;
  document.getElementById('submit-text').value = '';
  document.getElementById('submit-url').value = '';
  document.getElementById('submit-file').value = '';
  openModal('modal-submit');
}

async function submitAssignment() {
  const assignId = document.getElementById('submit-assign-id').value;
  const text     = document.getElementById('submit-text').value.trim();
  const url      = document.getElementById('submit-url').value.trim();
  const fileInput= document.getElementById('submit-file');

  if (!text && !url && !fileInput.files[0]) { toast('Please provide an answer, a link, or attach a file', 'error'); return; }

  const btn = document.querySelector('#modal-submit .btn-primary');
  const originalText = btn.textContent;
  btn.textContent = 'Uploading...';
  btn.disabled = true;

  try {
    if (fileInput.files[0]) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('url', url);
      fd.append('file', fileInput.files[0]);
      await api('POST', `/assignments/${assignId}/submit`, fd, true);
    } else {
      await API.submitWork(assignId, { text, url });
    }
    toast('Assignment submitted!', 'success');
    closeAllModals();
    if (STATE.currentPage === 'student-course') initStudentCourse();
    else initStudentAssignments();
  } catch (e) { toast('Error submitting assignment', 'error'); }
  finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function openSubmissionsModal(assignId) {
  openModal('modal-submissions');
  const el = document.getElementById('submissions-list');
  el.innerHTML = '<div class="empty-state">Loading submissions...</div>';
  try {
    const { submissions } = await API.submissions(assignId);
    if (!submissions || !submissions.length) {
      el.innerHTML = '<div class="empty-state">No submissions received yet</div>';
      return;
    }
    el.innerHTML = submissions.map(s => `
      <div class="list-card" style="align-items:flex-start;flex-direction:column;gap:.5rem;margin-bottom:1rem;background:var(--card);">
        <div style="font-weight:600;font-size:16px;">${esc(s.student?.name)} <span style="font-weight:400;color:var(--text-2);font-size:14px">(@${esc(s.student?.username)})</span></div>
        <div style="background:var(--bg3);padding:1rem;border-radius:var(--r-md);width:100%;font-size:15px;">
          ${esc(s.text || 'No text provided')}
          ${(s.url || s.fileUrl) ? `<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap">
            ${s.url ? `<a href="${s.url}" target="_blank" class="btn-ghost" style="padding:6px 12px; font-size:14px; text-decoration:none">🔗 View Link</a>` : ''}
            ${s.fileUrl ? `<a href="${s.fileUrl}" target="_blank" class="btn-ghost" style="padding:6px 12px; font-size:14px; text-decoration:none">📄 View File</a>` : ''}
          </div>` : ''}
        </div>
        <div style="display:flex;gap:8px;width:100%;margin-top:.5rem;flex-wrap:wrap">
          <input type="text" id="grade-${s._id}" placeholder="Grade (e.g. A, 9/10)" value="${esc(s.grade||'')}" style="flex:1;min-width:120px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);padding:10px 14px;border-radius:var(--r-md);" />
          <input type="text" id="feedback-${s._id}" placeholder="Feedback (optional)" value="${esc(s.feedback||'')}" style="flex:2;min-width:200px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);padding:10px 14px;border-radius:var(--r-md);" />
          <button class="btn-primary" onclick="saveGrade('${s._id}')">Save</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = '<div class="empty-state">Error loading submissions</div>';
  }
}

async function saveGrade(subId) {
  const grade = document.getElementById(`grade-${subId}`).value.trim();
  const feedback = document.getElementById(`feedback-${subId}`).value.trim();
  if (!grade) { toast('Grade is required', 'error'); return; }
  try {
    await API.gradeSubmission(subId, { grade, feedback });
    toast('Grade saved successfully!', 'success');
  } catch (e) { toast('Error saving grade', 'error'); }
}

/* ══════════════════════════════════════════
   UI HELPERS
══════════════════════════════════════════ */
function toggleActionsMenu(event) {
  event.stopPropagation();
  const dropdown = event.target.closest('.actions-menu').querySelector('.actions-dropdown');
  
  // Close all other open menus
  document.querySelectorAll('.actions-dropdown.active').forEach(openMenu => {
    if (openMenu !== dropdown) {
      openMenu.classList.remove('active');
    }
  });

  dropdown.classList.toggle('active');
}

// Close menus when clicking elsewhere
window.addEventListener('click', (e) => {
  if (!e.target.closest('.actions-menu')) {
    document.querySelectorAll('.actions-dropdown.active').forEach(openMenu => {
      openMenu.classList.remove('active');
    });
  }
});


/* ══════════════════════════════════════════
   TABS
══════════════════════════════════════════ */
function switchTab(name, btn) {
  ['overview','assignments','batchmates','attendance','chat','ai'].forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.classList.toggle('hidden', t !== name);
  });
  document.querySelectorAll('#page-student-course .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function switchTeacherTab(name, btn) {
  ['content','assignments','attendance','students','chat'].forEach(t => {
    const el = document.getElementById('teacher-tab-' + t);
    if (el) el.classList.toggle('hidden', t !== name);
  });
  document.querySelectorAll('#page-teacher-course .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

/* ══════════════════════════════════════════
   CHAT HELPER
══════════════════════════════════════════ */
async function initCourseChatView(containerId, courseId) {
  STATE.currentChatCourse = courseId;
  const el = document.getElementById(containerId);
  el.innerHTML = `
    <div class="chat-container">
      <div class="chat-messages" id="chat-msgs-${courseId}">
        <div class="text-muted" style="text-align:center;font-size:14px;margin-top:auto">Loading discussions...</div>
      </div>
      <form class="chat-input-area" onsubmit="sendCourseChatMessage(event, '${courseId}')">
        <input type="text" id="chat-input-${courseId}" placeholder="Type a message..." autocomplete="off" required oninput="handleChatTyping('${courseId}')" />
        <button type="submit">➤</button>
      </form>
    </div>
  `;
  
  try {
    const { messages } = await API.courseChat(courseId);
    renderChatMessages(courseId, messages);
    if (socket) socket.emit('join_course', courseId);
  } catch(e) {
    document.getElementById(`chat-msgs-${courseId}`).innerHTML = '<div class="empty-state">Error loading chat</div>';
  }
}

function renderChatMessages(courseId, msgs) {
  const container = document.getElementById(`chat-msgs-${courseId}`);
  if (!container) return;
  if (!msgs.length) {
    container.innerHTML = '<div class="text-muted" style="text-align:center;font-size:14px;margin-top:auto">No messages yet. Start the discussion!</div>';
    return;
  }
  container.innerHTML = msgs.map(m => createChatBubble(m)).join('');
  container.scrollTop = container.scrollHeight;
}

function createChatBubble(m) {
  const isSelf = m.sender?._id === STATE.user._id || m.sender === STATE.user._id;
  const senderName = isSelf ? 'You' : (m.sender?.name || 'User');
  const roleBadge = (m.sender?.role === 'teacher' || m.sender?.role === 'admin') ? `<span class="badge" style="padding:2px 6px;font-size:10px;background:var(--teal-glow);color:var(--teal);border:none;text-transform:capitalize;">${m.sender.role}</span>` : '';
  return `
    <div class="chat-msg ${isSelf ? 'self' : ''}">
      <div class="chat-msg-sender">${esc(senderName)} ${roleBadge}</div>
      <div class="chat-msg-bubble">${esc(m.text)}</div>
    </div>
  `;
}

let isTyping = false;
let typingTimer = null;
window.handleChatTyping = function(courseId) {
  if (!socket) return;
  if (!isTyping) {
    socket.emit('typing', { courseId, name: STATE.user.name });
    isTyping = true;
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    socket.emit('stop_typing', { courseId, name: STATE.user.name });
  }, 2000);
};

async function sendCourseChatMessage(e, courseId) {
  e.preventDefault();
  const input = document.getElementById(`chat-input-${courseId}`);
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  
  clearTimeout(typingTimer);
  if (socket && isTyping) {
    isTyping = false;
    socket.emit('stop_typing', { courseId, name: STATE.user.name });
  }

  try { await API.sendChatMessage(courseId, { text }); } 
  catch(err) { toast('Failed to send message', 'error'); }
}

/* ══════════════════════════════════════════
   AI CHAT HELPER
══════════════════════════════════════════ */
function initAiChatView(containerId, courseId) {
  const el = document.getElementById(containerId);
  el.innerHTML = `
    <div class="chat-container">
      <div class="dash-header" style="padding:1rem 1.5rem; border-bottom:1px solid var(--border); margin:0; display:flex; justify-content:space-between; align-items:center;">
        <h3 style="font-family:var(--font-head); font-weight:700; font-size:16px; margin:0;">✨ AI Doubt Solver</h3>
      </div>
      <div class="chat-messages" id="ai-chat-msgs-${courseId}">
        <div class="chat-msg">
          <div class="chat-msg-sender">✨ AI Assistant</div>
        <div class="chat-msg-bubble" style="background:var(--teal-glow); border-color:var(--teal);">Hello! I am your AI doubt solver for this course. I can help explain concepts, resolve doubts, and guide your learning. Ask me anything!</div>
        </div>
      </div>
      <form class="chat-input-area" onsubmit="sendAiMessage(event, '${courseId}')">
        <input type="text" id="ai-chat-input-${courseId}" placeholder="Ask a question..." autocomplete="off" required />
        <button type="submit" style="background:linear-gradient(135deg,var(--teal),#00b3ff); color:#000;">✨</button>
      </form>
    </div>
  `;
}

async function sendAiMessage(e, courseId) {
  e.preventDefault();
  const input = document.getElementById(`ai-chat-input-${courseId}`);
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const container = document.getElementById(`ai-chat-msgs-${courseId}`);
  container.insertAdjacentHTML('beforeend', `<div class="chat-msg self"><div class="chat-msg-sender">You</div><div class="chat-msg-bubble">${esc(text)}</div></div>`);
  
  const loaderId = 'ai-loader-' + Date.now();
  container.insertAdjacentHTML('beforeend', `<div class="chat-msg" id="${loaderId}"><div class="chat-msg-sender">✨ AI Assistant</div><div class="chat-msg-bubble" style="background:var(--teal-glow);border-color:var(--teal);font-style:italic">Thinking...</div></div>`);
  container.scrollTop = container.scrollHeight;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true; submitBtn.style.opacity = '0.5';

  try {
    const res = await API.aiChat({ courseId, text });
    document.getElementById(loaderId).remove();
    container.insertAdjacentHTML('beforeend', `<div class="chat-msg"><div class="chat-msg-sender">✨ AI Assistant</div><div class="chat-msg-bubble" style="background:var(--teal-glow);border-color:var(--teal);white-space:pre-wrap;">${esc(res.reply)}</div></div>`);
  } catch (err) {
    document.getElementById(loaderId).remove();
    container.insertAdjacentHTML('beforeend', `<div class="chat-msg"><div class="chat-msg-sender">✨ AI Assistant</div><div class="chat-msg-bubble" style="background:rgba(251,113,133,0.1);border-color:var(--red);color:var(--red)">${esc(err.message)}</div></div>`);
  } finally {
    submitBtn.disabled = false; submitBtn.style.opacity = '1';
    container.scrollTop = container.scrollHeight;
  }
}

/* ══════════════════════════════════════════
   MODALS
══════════════════════════════════════════ */
function openModal(id) {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('hidden');
  overlay.classList.add('active');
  document.querySelectorAll('.modal').forEach(m => {
    m.classList.remove('active');
    m.classList.add('hidden');
  });
  
  const target = document.getElementById(id);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeAllModals();
}

function closeAllModals() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
  overlay.classList.remove('active');
  document.querySelectorAll('.modal').forEach(m => {
    m.classList.remove('active');
    m.classList.add('hidden');
  });
}

/* ══════════════════════════════════════════
   QR CODE GENERATOR
══════════════════════════════════════════ */
function generateQR(containerId, text) {
  const container = document.getElementById(containerId);
  if (!container) return;

  /* Use qrcode.js from CDN */
  if (typeof QRCode !== 'undefined') {
    container.innerHTML = '';
    new QRCode(container, { text, width: 200, height: 200, colorDark: '#000', colorLight: '#fff' });
  } else {
    /* Load dynamically */
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.onload = () => {
      container.innerHTML = '';
      new QRCode(container, { text, width: 200, height: 200, colorDark: '#000', colorLight: '#fff' });
    };
    script.onerror = () => {
      container.innerHTML = `<div style="width:200px;height:200px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#666;text-align:center;background:#f5f5f5;border-radius:8px">QR unavailable.<br/>Use UPI button above.</div>`;
    };
    document.head.appendChild(script);
  }
}

function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ══════════════════════════════════════════
   HELPERS
══════════════════════════════════════════ */
function val(id) { return (document.getElementById(id)?.value || '').trim(); }
function esc(s)  { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function initials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase(); }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); }
function showErr(el, msg) { if (el) { el.textContent = msg; el.classList.remove('hidden'); } else { toast(msg, 'error'); } }

function getGreeting() {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
}

function statCard(label, value, color = 'teal') {
  return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-val ${color}">${value}</div></div>`;
}

function openWhatsApp() {
  window.open(`https://wa.me/${CONFIG.WA_NUMBER}?text=${encodeURIComponent('Hi ABC Institute, I need help!')}`, '_blank');
}

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 3000);
}

/* ══════════════════════════════════════════
   SKELETON LOADERS
══════════════════════════════════════════ */
function skeletonCards(count = 4) {
  return Array(count).fill(`<div class="course-card" style="pointer-events:none">
    <div class="skeleton-box" style="height:160px; border-radius:12px; margin-bottom:1rem;"></div>
    <div class="skeleton-box" style="height:24px; width:70%;"></div>
    <div class="skeleton-box" style="height:16px; width:90%; margin-top:8px;"></div>
    <div class="skeleton-box" style="height:16px; width:50%; margin-top:4px;"></div>
  </div>`).join('');
}

function skeletonList(count = 3) {
  return Array(count).fill(`<div class="list-card" style="pointer-events:none">
    <div class="skeleton-box" style="width:38px; height:38px; border-radius:8px;"></div>
    <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
      <div class="skeleton-box" style="height:16px; width:60%;"></div>
      <div class="skeleton-box" style="height:12px; width:40%;"></div>
    </div>
  </div>`).join('');
}

function skeletonStats(count = 4) {
  return Array(count).fill(`<div class="stat-card" style="pointer-events:none">
    <div class="skeleton-box" style="height:14px; width:50%; margin-bottom:12px;"></div>
    <div class="skeleton-box" style="height:32px; width:30%;"></div>
  </div>`).join('');
}

function skeletonTable(rows = 5) {
  return '<div class="modern-list">' + Array(rows).fill(`
    <div class="modern-list-card">
      <div class="mlc-info">
        <div class="skeleton-box" style="width:40px;height:40px;border-radius:50%;"></div>
        <div class="mlc-details" style="flex:1;"><div class="skeleton-box" style="height:16px; width:60%; margin-bottom:8px;"></div><div class="skeleton-box" style="height:12px; width:40%;"></div></div>
      </div>
      <div class="skeleton-box" style="height:28px; width:80px; border-radius:50px;"></div>
    </div>`).join('') + '</div>';
}

/* ══════════════════════════════════════════
   ADMIN SETTINGS
══════════════════════════════════════════ */
async function initAdminSettings() {
  document.getElementById('admin-set-upi-id').value = CONFIG.UPI_ID;
  document.getElementById('admin-set-upi-name').value = CONFIG.UPI_NAME;
  document.getElementById('admin-set-wa').value = CONFIG.WA_NUMBER;
  document.getElementById('admin-set-announcement').value = CONFIG.ANNOUNCEMENT_TEXT;
  document.getElementById('admin-set-announcement-active').checked = CONFIG.ANNOUNCEMENT_ACTIVE;
  document.getElementById('admin-set-manual-email').checked = CONFIG.MANUAL_EMAIL;
  
  loadAdminSettingsData();
}

async function saveAdminSettings() {
  const upiId = document.getElementById('admin-set-upi-id').value.trim();
  const upiName = document.getElementById('admin-set-upi-name').value.trim();
  const waNumber = document.getElementById('admin-set-wa').value.trim();
  const announcementText = document.getElementById('admin-set-announcement').value.trim();
  const announcementActive = document.getElementById('admin-set-announcement-active').checked;
  const manualEmail = document.getElementById('admin-set-manual-email').checked;
  
  const bannedIpsText = document.getElementById('admin-set-banned-ips').value;
  const bannedIPs = bannedIpsText.split(',').map(ip => ip.trim()).filter(ip => ip);
  
  try {
    await API.updateSettings({ upiId, upiName, waNumber, announcementText, announcementActive, manualEmail, bannedIPs });
    CONFIG.UPI_ID = upiId; CONFIG.UPI_NAME = upiName; CONFIG.WA_NUMBER = waNumber;
    CONFIG.ANNOUNCEMENT_TEXT = announcementText; CONFIG.ANNOUNCEMENT_ACTIVE = announcementActive;
    CONFIG.MANUAL_EMAIL = manualEmail;
    
    const banner = document.getElementById('announcement-banner');
    if (announcementActive && announcementText) {
      if (banner) { banner.innerHTML = esc(announcementText); banner.classList.remove('hidden'); }
    } else if (banner) banner.classList.add('hidden');
    
    toast('System settings updated!', 'success');
  } catch(e) { toast('Failed to update settings', 'error'); }
}

async function loadAdminSettingsData() {
  try {
    const { settings } = await API.getSettings();
    if (settings && settings.bannedIPs) {
      document.getElementById('admin-set-banned-ips').value = settings.bannedIPs.join(', ');
    }
    if (settings && settings.manualEmail !== undefined) {
      CONFIG.MANUAL_EMAIL = settings.manualEmail;
      const el = document.getElementById('admin-set-manual-email');
      if (el) el.checked = CONFIG.MANUAL_EMAIL;
    }
    
    const { coupons } = await API.getCoupons();
    const listEl = document.getElementById('admin-coupons-list');
    listEl.innerHTML = coupons.length ? coupons.map(c => `
      <div style="display:flex;justify-content:space-between;background:var(--bg3);padding:10px 14px;border-radius:var(--r-md);margin-bottom:8px;align-items:center;">
        <div>
          <strong style="font-family:monospace;font-size:16px;">${esc(c.code)}</strong>
          <span style="color:var(--text-2);font-size:14px;margin-left:10px;">${c.discountPct}% OFF</span>
        </div>
        <span class="badge badge-${c.active?'approved':'rejected'}">${c.active?'Active':'Inactive'}</span>
      </div>
    `).join('') : '<div style="color:var(--text-3);font-size:14px;">No coupons generated yet.</div>';
  } catch (e) { console.error('Error loading extra settings data', e); }
}

async function generateCoupon() {
  const code = document.getElementById('new-coupon-code').value.trim();
  const discountPct = Number(document.getElementById('new-coupon-pct').value);
  if (!code || !discountPct) { toast('Provide code and percentage', 'error'); return; }
  try {
    await API.createCoupon({ code, discountPct });
    toast('Coupon created!', 'success');
    document.getElementById('new-coupon-code').value = '';
    document.getElementById('new-coupon-pct').value = '';
    loadAdminSettingsData();
  } catch (e) { toast(e.message || 'Error creating coupon', 'error'); }
}