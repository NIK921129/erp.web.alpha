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
  BASE_URL:   isLocal ? 'http://localhost:5000/api' : '/api',
  UPI_ID:     '9211293576@ptaxis',
  UPI_NAME:   'ABCInstitute',
  WA_NUMBER:  '919211293576',
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
  studentAssignments: [],
  enrolCtx:      null,   // { course, step }
};

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

  /* Admin */
  allUsers:        ()       => api('GET', '/users'),
  updateUser:      (id, d)  => api('PUT', `/users/${id}`, d),
  allStudents:     ()       => api('GET', '/users?role=student'),
  allTeachers:     ()       => api('GET', '/users?role=teacher'),
  adminStats:      ()       => api('GET', '/admin/stats'),
};

/* ══════════════════════════════════════════
   SECRET ADMIN ACCESS
══════════════════════════════════════════ */
function promptAdminAccess() {
  const code = prompt("Enter Admin Passcode:");
  if (code === "79827") {
    STATE.user = {
      _id: 'secret_admin_123',
      name: 'System Admin',
      username: 'admin',
      email: 'projects.nikunj.singh@gmail.com',
      role: 'admin'
    };
    STATE.token = 'secret_admin_token';
    localStorage.setItem('abc_token', STATE.token);
    localStorage.setItem('abc_user', JSON.stringify(STATE.user));
    showNav();
    navigate('admin-dashboard');
    toast('Secret admin access granted! 🕵️‍♂️', 'success');
  } else if (code !== null) {
    toast('Incorrect passcode', 'error');
  }
}

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  const savedToken = localStorage.getItem('abc_token');
  const savedUser  = localStorage.getItem('abc_user');

  if (savedToken && savedUser) {
    STATE.token = savedToken;
    STATE.user  = JSON.parse(savedUser);
    showNav();
    redirectByRole();
  } else {
    navigate('landing');
  }

  /* Pre-load courses for landing */
  loadPublicCourses();
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
    'admin-dashboard','admin-payments','admin-students','admin-courses','admin-users',
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
}

function buildNavLinks() {
  const nav = document.getElementById('nav-links');
  if (!STATE.user) { nav.innerHTML = ''; return; }

  const links = {
    student: [
      { label: '🏠 Dashboard',   page: 'student-dashboard' },
      { label: '📚 Courses',     page: 'courses-public' },
      { label: '📅 Attendance',  page: 'student-attendance' },
      { label: '📝 Assignments', page: 'student-assignments' },
      { label: '💰 Fees',        page: 'student-fees' },
    ],
    teacher: [
      { label: '🏠 Dashboard',   page: 'teacher-dashboard' },
    ],
    admin: [
      { label: '🏠 Dashboard',   page: 'admin-dashboard' },
      { label: '💳 Payments',    page: 'admin-payments' },
      { label: '👥 Students',    page: 'admin-students' },
      { label: '📚 Courses',     page: 'admin-courses' },
      { label: '👤 Users',       page: 'admin-users' },
    ],
  };

  const role = STATE.user.role;
  nav.innerHTML = (links[role] || []).map(l =>
    `<button onclick="navigate('${l.page}')">${l.label}</button>`
  ).join('');
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
    showNav();
    redirectByRole();
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
    showNav();
    redirectByRole();
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

function handleLogout() {
  STATE.user = null; STATE.token = null;
  localStorage.removeItem('abc_token');
  localStorage.removeItem('abc_user');
  document.getElementById('global-nav').classList.remove('active');
  document.getElementById('global-nav').classList.add('hidden');
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
  try {
    const { courses } = await API.courses();
    STATE.courses = courses || [];
    renderCourseGrid('landing-course-grid', courses, 6);
  } catch (e) { /* silently fail on landing */ }
}

async function loadPublicCourseGrid() {
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
  document.getElementById('student-welcome').textContent = 'Hey, ' + STATE.user.name + ' 👋';

  try {
    const [enrData, payData, attData, assData] = await Promise.all([
      API.myEnrolments(),
      API.myPayments(),
      API.myAttendance(),
      API.myAssignments(),
    ]);

    const enrolments  = enrData.enrolments || [];
    const payments    = payData.payments   || [];
    const attendance  = attData.records    || [];
    const assignments = assData.assignments|| [];

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

    document.getElementById('student-course-header').innerHTML = `
      <h1 style="font-family:var(--font-head);font-weight:700;font-size:26px;margin-bottom:.25rem">${esc(course.name)}</h1>
      <p class="text-muted mb-2">${esc(course.description || '')}</p>
    `;

    /* Content tab */
    document.getElementById('tab-content').innerHTML = renderContentTree(content, false);

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
            <div class="batchmate-meta">${esc(s.username)}</div>
            <div class="batchmate-meta">${esc(s.email)}</div>
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
      <table class="att-table" style="margin-top:1rem">
        <thead><tr><th>Date</th><th>Status</th></tr></thead>
        <tbody>${myAtt.map(r=>`
          <tr>
            <td>${fmtDate(r.date)}</td>
            <td class="${r.status==='present'?'att-present':'att-absent'}">${r.status}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

  } catch (e) {
    toast('Error loading course', 'error');
  }
}

function renderContentTree(items, isTeacher = false) {
  const chapters = items.filter(i => i.type === 'chapter').sort((a,b) => (a.order||0) - (b.order||0));
  const nonChapters = items.filter(i => i.type !== 'chapter');

  if (!items.length) return '<div class="empty-state"><div class="es-icon">📂</div>No content uploaded yet</div>';

  let html = '<div class="content-tree">';

  chapters.forEach(ch => {
    const children = items.filter(i => i.parentId === ch._id).sort((a,b) => (a.order||0) - (b.order||0));
    html += `
      <div class="chapter-folder" id="ch-${ch._id}">
        <div class="chapter-header" onclick="toggleChapter('ch-${ch._id}')">
          <span class="chapter-icon">📁</span>
          <span class="chapter-name">${esc(ch.title)}</span>
          ${isTeacher ? `<button class="btn-ghost" style="padding:6px 12px;font-size:14px" onclick="event.stopPropagation();deleteContent('${ch._id}')">✕</button>` : ''}
          <span class="chapter-toggle">▼</span>
        </div>
        <div class="chapter-children">
          ${children.length ? children.map(c => renderContentItem(c, isTeacher)).join('') : '<div style="color:var(--text-3);font-size:15px">Empty folder</div>'}
        </div>
      </div>`;
  });

  nonChapters.filter(i => !i.parentId).sort((a,b) => (a.order||0) - (b.order||0)).forEach(item => {
    html += renderContentItem(item, isTeacher);
  });

  html += '</div>';
  return html;
}

function renderContentItem(item, isTeacher) {
  const icon = item.type === 'video' ? '🎬' : '📄';
  const lecBadge = item.order ? `<span class="badge badge-enrolled" style="margin-right:6px">Lec ${item.order}</span>` : '';
  let html = `
    <div class="content-item">
      <span class="content-item-icon">${icon}</span>
      <span class="content-item-name">${lecBadge}${esc(item.title)}</span>
      ${isTeacher ? `<button onclick="deleteContent('${item._id}')" style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:15px">✕</button>` : ''}
    </div>`;

  if (item.type === 'video' && item.url) {
    if (item.thumbnail) {
      html += `<div class="video-embed" id="vid-${item._id}" onclick="playVideo('vid-${item._id}', '${item.url}', '${item._id}')" style="cursor:pointer;position:relative;background-image:url('${item.thumbnail}');background-size:cover;background-position:center;">
        <div class="video-thumbnail-overlay">
          <div class="video-play-btn">▶</div>
        </div>
      </div>`;
    } else {
      const embedUrl = driveEmbed(item.url);
      html += `<div class="video-embed"><iframe src="${embedUrl}" allowfullscreen></iframe></div>`;
    }
  }

  return html;
}

function driveEmbed(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return `https://drive.google.com/file/d/${match[1]}/preview`;
  return url;
}

function playVideo(containerId, url, itemId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  
  /* Fallback to iframe for Google Drive. (Cannot track progress via iframe) */
  if (url.includes('drive.google.com')) {
    const embedUrl = driveEmbed(url);
    el.innerHTML = `<iframe src="${embedUrl}" allowfullscreen allow="autoplay"></iframe>`;
  } else {
    /* Native HTML5 Video supports resume playback! */
    el.innerHTML = `<video id="player-${itemId}" src="${url}" controls autoplay style="width:100%; height:100%; background:#000; outline:none; border:none;"></video>`;
    const video = document.getElementById(`player-${itemId}`);
    
    const savedTime = localStorage.getItem(`vid_progress_${itemId}`);
    if (savedTime) video.currentTime = parseFloat(savedTime);
    
    video.addEventListener('timeupdate', () => {
      localStorage.setItem(`vid_progress_${itemId}`, video.currentTime);
    });
  }
  
  el.onclick = null;
  el.style.backgroundImage = 'none';
  el.style.cursor = 'default';
}

function toggleChapter(id) {
  document.getElementById(id)?.classList.toggle('open');
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

    html += `<table class="att-table">
      <thead><tr><th>Course</th><th>Date</th><th>Status</th></tr></thead>
      <tbody>${records.map(r=>`
        <tr>
          <td>${esc(r.course?.name||'')}</td>
          <td>${fmtDate(r.date)}</td>
          <td class="${r.status==='present'?'att-present':'att-absent'}">${r.status}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

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
  return `
    <div class="assignment-card">
      <div class="assignment-card-header">
        <div>
          <div class="assignment-title">${esc(a.title)}</div>
          <div class="assignment-due">Due: ${fmtDate(a.dueDate)}</div>
        </div>
        <span class="badge badge-${a.submitted ? 'approved' : 'pending'}">${a.submitted ? 'Submitted' : 'Pending'}</span>
      </div>
      <div class="assignment-desc">${esc(a.description || '')}</div>
      ${canSubmit && !a.submitted ? `<button class="btn-primary" style="font-size:15px;padding:9px 20px" onclick="openSubmitModal('${a._id}')">Submit Work</button>` : ''}
      ${a.submitted && canSubmit ? `
        <div style="background:var(--bg3); padding:1rem; border-radius:var(--r-md); margin-top:.75rem; font-size:15px; color:var(--text-2);">
          <strong style="color:var(--text);">My Submission:</strong><br/>
          ${esc(a.subText || 'No text provided')}
          ${a.subFile ? `<br/><br/><a href="${a.subFile}" target="_blank" class="btn-ghost" style="padding:6px 12px; font-size:14px; display:inline-block;">📄 View Attachment</a>` : ''}
        </div>
      ` : ''}
      ${a.grade ? `<div style="margin-top:.5rem;font-size:15px;color:var(--teal)">Grade: <strong>${esc(a.grade)}</strong> ${a.feedback ? '· ' + esc(a.feedback) : ''}</div>` : ''}
      ${isTeacher ? `<button class="btn-ghost" style="font-size:14px;padding:7px 14px;margin-top:.75rem" onclick="openSubmissionsModal('${a._id}')">View Submissions</button>` : ''}
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
      <button class="btn-primary btn-lg" onclick="goToStep2('${course._id}', ${course.fee})">
        Proceed to Pay →
      </button>
    </div>`;
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
  document.getElementById('teacher-welcome').textContent = 'Hello, ' + STATE.user.name + ' 👋';
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

    document.getElementById('teacher-course-header').innerHTML = `
      <h1 style="font-family:var(--font-head);font-weight:700;font-size:26px;margin-bottom:.25rem">${esc(course.name)}</h1>
      <p class="text-muted mb-2">${students.length} students enrolled</p>
    `;

    /* Content tab */
    document.getElementById('teacher-tab-content').innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:1.5rem;flex-wrap:wrap">
        <button class="btn-primary" onclick="openContentModal('${courseId}')">+ Add Content</button>
      </div>
      ${renderContentTree(content, true)}`;

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

  } catch (e) {
    toast('Error loading course', 'error');
  }
}

function renderMarkAttendance(students, courseId) {
  if (!students.length) return '<div class="empty-state">No students enrolled yet</div>';
  const today = new Date().toISOString().split('T')[0];
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
  try {
    const [statsData, paymentsData] = await Promise.all([
      API.adminStats().catch(() => ({})),
      API.allPayments(),
    ]);

    const stats    = statsData.stats || {};
    const payments = paymentsData.payments || [];
    const pending  = payments.filter(p => p.status === 'pending');

    document.getElementById('admin-stats').innerHTML = `
      ${statCard('Total Students', stats.students || 0, 'teal')}
      ${statCard('Total Teachers', stats.teachers || 0, 'blue')}
      ${statCard('Total Courses',  stats.courses  || 0, 'amber')}
      ${statCard('Pending Payments', pending.length, 'amber')}
    `;
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
  await renderAdminPayments();
}

async function renderAdminPayments() {
  const el = document.getElementById('admin-payments-list');
  el.innerHTML = '<div class="empty-state">Loading…</div>';
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
    <div class="payment-review-card">
      <img class="pay-thumb" src="${p.screenshotUrl||''}" alt="Screenshot"
        onclick="previewScreenshot('${p.screenshotUrl}','${p._id}','${p.status}')"
        onerror="this.style.background='var(--bg3)'" />
      <div class="pay-info">
        <div class="pay-name">${esc(p.student?.name||'Student')}</div>
        <div class="pay-meta">Course: ${esc(p.course?.name||'—')} · ₹${Number(p.amount).toLocaleString('en-IN')}</div>
        <div class="pay-meta">${fmtDate(p.createdAt)}</div>
      </div>
      <div class="pay-actions">
        <span class="badge badge-${p.status}">${p.status}</span>
        ${isPending ? `
          <button class="btn-approve" onclick="approvePayment('${p._id}')">✓ Approve</button>
          <button class="btn-danger"  onclick="rejectPayment('${p._id}')">✕ Reject</button>` : ''}
        <button class="btn-ghost" style="padding:8px 14px;font-size:14px" onclick="previewScreenshot('${p.screenshotUrl}','${p._id}','${p.status}')">View</button>
      </div>
    </div>`;
}

async function approvePayment(payId) {
  try {
    await API.approvePayment(payId);
    toast('Payment approved — student enrolled!', 'success');
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
  el.innerHTML = '<div class="empty-state">Loading students...</div>';
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
      u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
    );
    if (!list.length) { el.innerHTML = '<div class="empty-state">No students found</div>'; return; }
    el.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${list.map(u => `
          <tr>
            <td><div style="display:flex;align-items:center;gap:8px"><div class="avatar" style="width:36px;height:36px;font-size:15px">${initials(u.name)}</div>${esc(u.name)}</div></td>
            <td style="font-family:monospace;font-size:15px">@${esc(u.username)}</td>
            <td style="font-size:15px">${esc(u.email)}</td>
            <td><span class="badge badge-${u.active?'approved':'rejected'}">${u.active?'Active':'Suspended'}</span></td>
            <td>
              <button class="btn-ghost" style="font-size:14px;padding:7px 14px" onclick="toggleUserActive('${u._id}',${!u.active})">${u.active?'Suspend':'Activate'}</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
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
  const filtered = list.filter(u => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
  
  const headers = ['Name', 'Username', 'Email', 'Status'];
  const rows = filtered.map(u => [
    `"${u.name||''}"`, `"${u.username||''}"`, `"${u.email||''}"`, u.active ? 'Active' : 'Suspended'
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadCSV(csv, 'students_export.csv');
}

/* ══════════════════════════════════════════
   ADMIN COURSES
══════════════════════════════════════════ */
async function initAdminCourses() {
  const el = document.getElementById('admin-courses-table');
  el.innerHTML = '<div class="empty-state">Loading courses...</div>';
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

    el.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Course</th><th>Teacher</th><th>Fee</th><th>Students</th><th>Actions</th></tr></thead>
        <tbody>${list.map(c => `
          <tr>
            <td><strong>${esc(c.name)}</strong><br/><span style="font-size:14px;color:var(--text-2)">${esc(c.duration||'')}</span></td>
            <td style="font-size:15px">${esc(c.teacher?.name||'Unassigned')}</td>
            <td style="font-weight:600;color:var(--teal)">₹${Number(c.fee).toLocaleString('en-IN')}</td>
            <td>${c.studentCount||0}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn-ghost" style="font-size:14px;padding:7px 14px" onclick="openCourseModal('${c._id}')">Edit</button>
              <button class="btn-danger"  style="font-size:14px;padding:7px 14px" onclick="deleteCourseAdmin('${c._id}')">Delete</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
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

  try {
    if (id) await API.updateCourse(id, data);
    else    await API.createCourse(data);
    toast(id ? 'Course updated!' : 'Course created!', 'success');
    closeAllModals();
    initAdminCourses();
  } catch (e) { 
    console.error(e);
    toast(e.message || 'Error saving course', 'error'); 
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
  el.innerHTML = '<div class="empty-state">Loading users...</div>';
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

    el.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${list.map(u => `
          <tr>
            <td>${esc(u.name)}</td>
            <td style="font-family:monospace;font-size:15px">@${esc(u.username)}</td>
            <td><span class="badge badge-enrolled">${esc(u.role)}</span></td>
            <td><span class="badge badge-${u.active?'approved':'rejected'}">${u.active?'Active':'Suspended'}</span></td>
            <td style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn-ghost" style="font-size:14px;padding:7px 14px" onclick="toggleUserActive('${u._id}', ${!u.active})">${u.active ? 'Suspend' : 'Activate'}</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
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
  document.getElementById('content-url-group').classList.toggle('hidden', type !== 'video');
  document.getElementById('content-thumbnail-group').classList.toggle('hidden', type !== 'video');
  document.getElementById('content-parent-group').classList.toggle('hidden', type === 'chapter');
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

  try {
    await API.addContent({ course: courseId, type, title, url, thumbnail, order, description: desc, parentId: type === 'chapter' ? null : parentId });
    toast('Content added!', 'success');
    closeAllModals();
    initTeacherCourse();
  } catch (e) { toast('Error adding content', 'error'); }
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
  document.getElementById('assign-due-input').value   = '';
  openModal('modal-post-assign');
}

async function postAssignment() {
  const courseId = document.getElementById('assign-course-id').value;
  const title    = document.getElementById('assign-title-input').value.trim();
  const desc     = document.getElementById('assign-desc-input').value.trim();
  const due      = document.getElementById('assign-due-input').value;

  if (!title || !due) { toast('Title and due date are required', 'error'); return; }

  try {
    await API.postAssignment({ course: courseId, title, description: desc, dueDate: due });
    toast('Assignment posted!', 'success');
    closeAllModals();
    initTeacherCourse();
  } catch (e) { toast('Error posting assignment', 'error'); }
}

function openSubmitModal(assignId) {
  document.getElementById('submit-assign-id').value = assignId;
  document.getElementById('submit-text').value = '';
  document.getElementById('submit-file').value = '';
  openModal('modal-submit');
}

async function submitAssignment() {
  const assignId = document.getElementById('submit-assign-id').value;
  const text     = document.getElementById('submit-text').value.trim();
  const fileInput= document.getElementById('submit-file');

  if (!text && !fileInput.files[0]) { toast('Please provide an answer or attach a file', 'error'); return; }

  try {
    if (fileInput.files[0]) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('file', fileInput.files[0]);
      await api('POST', `/assignments/${assignId}/submit`, fd, true);
    } else {
      await API.submitWork(assignId, { text });
    }
    toast('Assignment submitted!', 'success');
    closeAllModals();
    initStudentAssignments();
  } catch (e) { toast('Error submitting assignment', 'error'); }
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
          ${s.fileUrl ? `<br/><br/><a href="${s.fileUrl}" target="_blank" class="btn-ghost" style="padding:6px 12px;font-size:14px;display:inline-block">📄 View Attachment</a>` : ''}
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
   TABS
══════════════════════════════════════════ */
function switchTab(name, btn) {
  ['content','assignments','batchmates','attendance'].forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.classList.toggle('hidden', t !== name);
  });
  document.querySelectorAll('#page-student-course .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function switchTeacherTab(name, btn) {
  ['content','assignments','attendance','students'].forEach(t => {
    const el = document.getElementById('teacher-tab-' + t);
    if (el) el.classList.toggle('hidden', t !== name);
  });
  document.querySelectorAll('#page-teacher-course .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

/* ══════════════════════════════════════════
   MODALS
══════════════════════════════════════════ */
function openModal(id) {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('hidden');
  overlay.classList.add('active');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeAllModals();
}

function closeAllModals() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
  overlay.classList.remove('active');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
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