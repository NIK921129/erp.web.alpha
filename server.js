require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const app = express();
app.set('trust proxy', 1); // Trust reverse proxy (like Render) to correctly identify https
app.use(cors());

/* Set Basic Security Headers */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json());

const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

/* ══════════════════════════════════════════
   FILE UPLOAD CONFIG (Multer)
══════════════════════════════════════════ */
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // Sanitize the original name using basename to prevent directory traversal attacks
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9.\-]/g, '_');
    cb(null, Date.now() + '-' + safeName);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } 
});

/* ══════════════════════════════════════════
   HELPER: FILE DELETION
══════════════════════════════════════════ */
const deleteLocalFile = (fileUrl) => {
  if (!fileUrl) return;
  try {
    if (fileUrl.includes('/uploads/')) {
      const filename = fileUrl.split('/uploads/')[1];
      if (filename) {
        // Use basename to prevent path traversal during file deletion
        const filepath = path.join(uploadDir, path.basename(filename));
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      }
    }
  } catch (e) { console.error('⚠️ Error deleting local file:', e.message); }
};

/* ══════════════════════════════════════════
   DATABASE SETUP (Mongoose Models)
══════════════════════════════════════════ */
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'teacher', 'admin'], default: 'student' },
  active: { type: Boolean, default: true }
}));

const Course = mongoose.model('Course', new mongoose.Schema({
  name: String, description: String, fee: Number, duration: String,
  thumbnail: String, category: String, level: String,
  status: { type: String, enum: ['published', 'draft'], default: 'published' },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  studentCount: { type: Number, default: 0 }
}));

const EnrolmentSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', index: true },
  status: { type: String, default: 'active' }
});
EnrolmentSchema.index({ student: 1, course: 1 }, { unique: true });
const Enrolment = mongoose.model('Enrolment', EnrolmentSchema);

const Payment = mongoose.model('Payment', new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', index: true },
  amount: Number,
  screenshotUrl: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true }
}, { timestamps: true }));

const AttendanceSchema = new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', index: true },
  date: { type: String, index: true },
  records: [{
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['present', 'absent'] }
  }]
});
AttendanceSchema.index({ course: 1, date: 1 }, { unique: true });
const Attendance = mongoose.model('Attendance', AttendanceSchema);

const Assignment = mongoose.model('Assignment', new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  title: String, description: String, dueDate: Date, url: String
}));

const Submission = mongoose.model('Submission', new mongoose.Schema({
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment' },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: String, fileUrl: String, url: String, grade: String, feedback: String
}, { timestamps: true }));

const Content = mongoose.model('Content', new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  type: { type: String, enum: ['chapter', 'video', 'file'] },
  title: String, url: String, description: String, parentId: String, thumbnail: String, order: Number
}));

const Setting = mongoose.model('Setting', new mongoose.Schema({
  upiId: { type: String, default: '9211293576@ptaxis' },
  upiName: { type: String, default: 'ABCInstitute' },
  waNumber: { type: String, default: '919211293576' },
  announcementText: { type: String, default: '' },
  announcementActive: { type: Boolean, default: false },
  bannedIPs: [{ type: String }],
  aiCredits: { type: Number, default: 5 }
}));

const Coupon = mongoose.model('Coupon', new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  discountPct: { type: Number, required: true, min: 1, max: 100 },
  active: { type: Boolean, default: true }
}));

const ChatMessage = mongoose.model('ChatMessage', new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: String
}, { timestamps: true }));

const LogSchema = new mongoose.Schema({
  ip: { type: String, required: true, index: true },
  action: { type: String, required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  details: { type: String }
}, { timestamps: true });
LogSchema.index({ createdAt: -1 }); // Index necessary for fast descending sort
const Log = mongoose.model('Log', LogSchema);

const QuizSchema = new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', index: true },
  title: String,
  topic: String,
  toughness: { type: String, enum: ['Easy', 'Medium', 'Hard'] },
  timer: Number, // in minutes
  availableFrom: Date,
  availableUntil: Date,
  questions: [{ text: String, options: [String], correctOption: String }],
}, { timestamps: true });
const Quiz = mongoose.model('Quiz', QuizSchema);

const QuizAttemptSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  score: Number,
  maxScore: Number,
  answers: [{ questionId: String, selectedOption: String, isCorrect: Boolean }],
  status: { type: String, enum: ['in-progress', 'completed'], default: 'in-progress' },
  startTime: { type: Date, default: Date.now },
  endTime: Date
}, { timestamps: true });
const QuizAttempt = mongoose.model('QuizAttempt', QuizAttemptSchema);

/* ══════════════════════════════════════════
   HELPER: INVOICE GENERATOR
══════════════════════════════════════════ */
function generateInvoicePDF(payment, student, course, teacher) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const brandColor = '#0B101F';
    const accentColor = '#22D3EE';
    const textColor = '#334155';
    const lightGray = '#E2E8F0';

    // Generate Date and ID
    const invoiceDate = new Date(payment.createdAt || Date.now()).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
    const invoiceNo = payment._id ? payment._id.toString().slice(-8).toUpperCase() : 'N/A';

    // 1. Header Section
    doc.fillColor(brandColor).fontSize(28).font('Helvetica-Bold').text('ABC Institute', 50, 50);
    doc.fillColor(accentColor).fontSize(10).font('Helvetica').text('Learn. Track. Grow.', 50, 80);

    doc.fillColor(brandColor).fontSize(20).font('Helvetica-Bold').text('INVOICE', 50, 50, { align: 'right', width: 495 });
    doc.fillColor(textColor).fontSize(10).font('Helvetica')
       .text(`Invoice No: INV-${invoiceNo}`, 50, 75, { align: 'right', width: 495 })
       .text(`Date: ${invoiceDate}`, 50, 90, { align: 'right', width: 495 });

    // Divider
    doc.moveTo(50, 115).lineTo(545, 115).lineWidth(1).strokeColor(lightGray).stroke();

    // 2. Billing Information
    doc.moveDown(2);
    const billingY = 140;
    
    doc.fillColor(brandColor).fontSize(12).font('Helvetica-Bold').text('Billed To:', 50, billingY);
    doc.fillColor(textColor).fontSize(10).font('Helvetica')
       .text(student.name, 50, billingY + 15)
       .text(`@${student.username}`, 50, billingY + 30)
       .text(student.email, 50, billingY + 45);

    doc.fillColor(brandColor).fontSize(12).font('Helvetica-Bold').text('Instructor Details:', 300, billingY);
    doc.fillColor(textColor).fontSize(10).font('Helvetica')
       .text(teacher ? teacher.name : 'TBA', 300, billingY + 15)
       .text(teacher && teacher.email ? teacher.email : 'Support available via portal', 300, billingY + 30);

    // 3. Invoice Table
    const tableTop = 230;
    
    doc.rect(50, tableTop, 495, 25).fillColor(brandColor).fill();
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10)
       .text('Description', 60, tableTop + 8)
       .text('Duration', 350, tableTop + 8)
       .text('Amount (INR)', 450, tableTop + 8);

    const rowTop = tableTop + 35;
    doc.fillColor(textColor).font('Helvetica').fontSize(10)
       .text(`Enrolment: ${course.name}`, 60, rowTop)
       .text(course.duration || 'Self-paced', 350, rowTop)
       .text(`₹ ${payment.amount}`, 450, rowTop);

    doc.moveTo(50, rowTop + 20).lineTo(545, rowTop + 20).lineWidth(1).strokeColor(lightGray).stroke();

    // 4. Totals Calculation
    const totalTop = rowTop + 40;
    doc.fillColor(brandColor).font('Helvetica-Bold').fontSize(10).text('Subtotal:', 350, totalTop);
    doc.font('Helvetica').text(`₹ ${payment.amount}`, 450, totalTop);
       
    doc.font('Helvetica-Bold').text('Total Paid:', 350, totalTop + 20);
    doc.fillColor(brandColor).fontSize(12).text(`₹ ${payment.amount}`, 450, totalTop + 19); // Accentuated Total

    // 5. Account Details Info Box
    const accountBoxY = totalTop + 60;
    doc.rect(50, accountBoxY, 495, 75).fillColor('#F8FAFC').fill();
    doc.lineWidth(1).strokeColor(lightGray).rect(50, accountBoxY, 495, 75).stroke();

    doc.fillColor(brandColor).fontSize(11).font('Helvetica-Bold').text('Important Information', 65, accountBoxY + 15);
    doc.fillColor(textColor).fontSize(9).font('Helvetica')
       .text('Your payment has been successfully verified. You now have full access to this course.', 65, accountBoxY + 35)
       .text('Login at any time using your registered credentials. For security, passwords are encrypted and hidden.', 65, accountBoxY + 50);

    // 6. Footer
    const pageHeight = doc.page.height;
    doc.fillColor('#94A3B8').fontSize(9).font('Helvetica')
       .text('Thank you for choosing ABC Institute!', 50, pageHeight - 70, { align: 'center', width: 495 })
       .text('This is an electronically generated invoice and does not require a signature.', 50, pageHeight - 55, { align: 'center', width: 495 });

    doc.end();
  });
}

/* ══════════════════════════════════════════
   MIDDLEWARE
══════════════════════════════════════════ */
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized: No token provided' });
    if (token === (process.env.ADMIN_TOKEN || 'secret_admin_token')) {
      req.user = { _id: 'secret_admin_123', name: 'System Admin', role: 'admin', active: true };
      return next();
    }
    if (!mongoose.Types.ObjectId.isValid(token)) throw new Error('Invalid token format');
    req.user = await User.findById(token).select('-password');
    if (!req.user || !req.user.active) throw new Error('Inactive User');
    next();
  } catch (err) { res.status(401).json({ message: 'Unauthorized: Invalid token' }); }
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      if (token === (process.env.ADMIN_TOKEN || 'secret_admin_token')) {
        req.user = { _id: 'secret_admin_123', name: 'System Admin', role: 'admin', active: true };
      } else if (mongoose.Types.ObjectId.isValid(token)) {
        req.user = await User.findById(token).select('-password');
      }
    }
  } catch (err) {}
  next();
};

let settingsCache = { data: undefined, lastFetch: 0 };
const ipFilter = async (req, res, next) => {
  try {
    const clientIp = req.ip || req.socket?.remoteAddress;
    // Cache settings in production to avoid DB hits on every request
    const now = Date.now();
    if (settingsCache.data === undefined || now - settingsCache.lastFetch > 60000) {
      settingsCache.data = await Setting.findOne() || null;
      settingsCache.lastFetch = now;
    }
    const settings = settingsCache.data;
    if (settings && settings.bannedIPs && settings.bannedIPs.includes(clientIp)) {
      return res.status(403).json({ message: 'Access Denied: Your IP has been banned.' });
    }
    next();
  } catch (e) {
    next();
  }
};

/* ══════════════════════════════════════════
   API ROUTES
══════════════════════════════════════════ */
const api = express.Router();

/* AUTH RATE LIMITER (Brute Force Protection) */
const authRateLimit = {};
// Prevent memory leaks by periodically deleting old IP records
setInterval(() => {
  const now = Date.now();
  for (const ip in authRateLimit) {
    authRateLimit[ip] = authRateLimit[ip].filter(time => now - time < 60000);
    if (authRateLimit[ip].length === 0) delete authRateLimit[ip];
  }
}, 60000);

api.use('/auth', (req, res, next) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  if (!authRateLimit[ip]) authRateLimit[ip] = [];
  authRateLimit[ip] = authRateLimit[ip].filter(time => now - time < 60000); // 1 min window
  if (authRateLimit[ip].length >= 10) {
    return res.status(429).json({ message: 'Too many attempts. Please try again in a minute.' });
  }
  authRateLimit[ip].push(now);
  next();
});

// --- AUTH ---
api.post('/auth/signup', async (req, res) => {
  // Apply IP filter manually to unauthenticated routes if desired, 
  // or apply globally: app.use('/api', ipFilter);
  
  try {
    const { name, username, email, password, role } = req.body;
    if (!name || !username || !email || !password) return res.status(400).json({ message: 'All fields are required' });
    if (role === 'admin') return res.status(403).json({ message: 'Forbidden: Cannot sign up as admin' });
    
    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) return res.status(400).json({ message: 'Username or Email already exists' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, username, email, password: hashedPassword, role });
    io.to('admin_room').emit('admin_alert', { message: `New user signup: ${name}` });
    const token = user._id.toString();
    res.json({ user: { _id: user._id, name, username, email, role }, token });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    if (!user.active) return res.status(403).json({ message: 'Account is suspended' });
    
    const token = user._id.toString();
    res.json({ user: { _id: user._id, name: user.name, username: user.username, email: user.email, role: user.role }, token });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/auth/admin-access', (req, res) => {
  const { passcode } = req.body;
  // Compare with environment variable (fallback to 79827 if not set for local dev)
  const validPasscode = process.env.ADMIN_PASSCODE || '79827';
  
  if (passcode === validPasscode) {
    const user = {
      _id: 'secret_admin_123',
      name: 'System Admin',
      username: 'admin',
      email: 'projects.nikunj.singh@gmail.com',
      role: 'admin'
    };
    const token = process.env.ADMIN_TOKEN || 'secret_admin_token';
    res.json({ user, token });
  } else {
    res.status(401).json({ message: 'Incorrect passcode' });
  }
});

api.get('/auth/me', auth, (req, res) => res.json({ user: req.user }));

// --- COURSES ---
api.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find().populate('teacher', 'name');
    res.json({ courses });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

api.get('/courses/:id', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate('teacher', 'name');
    res.json({ course });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

api.post('/courses', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const course = await Course.create(req.body);
    res.json({ course });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

api.put('/courses/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ course });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

api.delete('/courses/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const cid = req.params.id;

    // Cleanup local files associated with this course before deleting
    const payments = await Payment.find({ course: cid });
    payments.forEach(p => deleteLocalFile(p.screenshotUrl));
    const contents = await Content.find({ course: cid });
    contents.forEach(c => deleteLocalFile(c.url));
    const assigns = await Assignment.find({ course: cid });
    const subs = await Submission.find({ assignment: { $in: assigns.map(a => a._id) } });
    subs.forEach(s => deleteLocalFile(s.fileUrl));

    await Course.findByIdAndDelete(cid);
    await Enrolment.deleteMany({ course: cid });
    await Payment.deleteMany({ course: cid });
    await Attendance.deleteMany({ course: cid });
    await Submission.deleteMany({ assignment: { $in: assigns.map(a => a._id) } });
    await Assignment.deleteMany({ course: cid });
    await Content.deleteMany({ course: cid });
    await ChatMessage.deleteMany({ course: cid });
    await Quiz.deleteMany({ course: cid });
    // Attempts not strictly deleted to keep student records, but can be
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// --- ENROLMENTS ---
api.get('/enrolments/me', auth, async (req, res) => {
  try {
    const enrolments = await Enrolment.find({ student: req.user._id }).populate('course');
    res.json({ enrolments });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/enrolments/course/:id', auth, async (req, res) => {
  try {
    const enrolments = await Enrolment.find({ course: req.params.id, status: 'active' }).populate('student', 'name username email');
    res.json({ students: enrolments.map(e => e.student) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- PAYMENTS ---
api.post('/payments', auth, upload.single('screenshot'), async (req, res) => {
  try {
    const fileUrl = req.file ? `${BASE_URL}/uploads/${req.file.filename}` : null;

    await Payment.create({
      student: req.user._id, course: req.body.course, amount: req.body.amount, screenshotUrl: fileUrl
    });
    io.to('admin_room').emit('admin_alert', { message: `New payment submitted for verification.` });
    res.json({ message: 'Payment submitted successfully' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/payments/me', auth, async (req, res) => {
  const payments = await Payment.find({ student: req.user._id }).populate('course', 'name').sort('-createdAt');
  res.json({ payments });
});

api.get('/payments/:id/invoice', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).send('Unauthorized');
    
    let user;
    if (token === (process.env.ADMIN_TOKEN || 'secret_admin_token')) {
      user = { role: 'admin' };
    } else if (mongoose.Types.ObjectId.isValid(token)) {
      user = await User.findById(token);
    }
    if (!user) return res.status(401).send('Unauthorized');

    const p = await Payment.findById(req.params.id)
      .populate('student')
      .populate({ path: 'course', populate: { path: 'teacher' } });
      
    if (!p) return res.status(404).send('Payment not found');
    if (user.role !== 'admin' && user._id.toString() !== p.student._id.toString()) return res.status(403).send('Forbidden');

    const pdfBuffer = await generateInvoicePDF(p, p.student, p.course, p.course.teacher);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice_${(p.course?.name || 'Course').replace(/\s+/g, '_')}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) { res.status(500).send('Error generating invoice'); }
});

api.get('/payments', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const payments = await Payment.find().populate('student', 'name').populate('course', 'name').sort('-createdAt');
    res.json({ payments });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/payments/:id/approve', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    
    const p = await Payment.findById(req.params.id)
      .populate('student')
      .populate({ path: 'course', populate: { path: 'teacher' } });
      
    if (!p) return res.status(404).json({ message: 'Payment not found' });
    if (!p.student) return res.status(400).json({ message: 'Student account no longer exists. Cannot approve.' });
    if (!p.course) return res.status(400).json({ message: 'Course no longer exists. Cannot approve.' });
    
    p.status = 'approved';
    await p.save();

    await Enrolment.findOneAndUpdate({ student: p.student._id, course: p.course._id }, { status: 'active' }, { upsert: true });
    const count = await Enrolment.countDocuments({ course: p.course._id, status: 'active' });
    await Course.findByIdAndUpdate(p.course._id, { studentCount: count });

    io.to(p.student._id.toString()).emit('notification', { message: 'Your payment was approved! You are now enrolled.', type: 'success' });
    io.to(p.student._id.toString()).emit('refresh_data');
    
    const hostUrl = `${req.protocol}://${req.get('host')}`;
    const token = req.headers.authorization?.split(' ')[1] || '';
    const invoiceLink = `${hostUrl}/api/payments/${p._id}/invoice?token=${token}`;
    
    const subject = `Your Invoice & Enrolment: ${p.course.name}`;
    const body = `Hello ${p.student.name},\n\nThank you for your purchase! Your payment of INR ${p.amount} has been successfully verified and you are now enrolled in ${p.course.name}.\n\nYour Account Login details:\nUsername: ${p.student.username}\nEmail: ${p.student.email}\nNote: Your password is encrypted and hidden for security.\n\nYou can download your PDF invoice securely using the link below:\n${invoiceLink}\n\nWelcome to ${p.course.name}!`;
    
    return res.json({ message: 'Payment approved', manualEmail: { to: p.student.email, subject, body } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/payments/:id/reject', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const p = await Payment.findByIdAndUpdate(req.params.id, { status: 'rejected' });
    if (!p) return res.status(404).json({ message: 'Payment not found' });
    
    io.to(p.student.toString()).emit('notification', { message: 'Your payment was rejected. Please re-upload.', type: 'error' });
    io.to(p.student.toString()).emit('refresh_data');
    
    res.json({ message: 'Rejected' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- ATTENDANCE ---
api.get('/attendance/me', auth, async (req, res) => {
  try {
    const atts = await Attendance.find({ 'records.student': req.user._id }).populate('course', 'name');
    const flat = [];
    atts.forEach(a => {
      const rec = a.records.find(r => r.student.toString() === req.user._id.toString());
      if (rec) flat.push({ course: a.course, date: a.date, status: rec.status });
    });
    res.json({ records: flat });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/attendance/course/:id', auth, async (req, res) => {
  try {
    const atts = await Attendance.find({ course: req.params.id });
    const flat = [];
    atts.forEach(a => a.records.forEach(r => flat.push({ date: a.date, student: r.student, status: r.status })));
    res.json({ records: flat });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/attendance/mark', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    const { course, date, records } = req.body;

    let courseName = 'Course';
    if (req.user.role === 'teacher') {
      const c = await Course.findById(course);
      if (!c || c.teacher?.toString() !== req.user._id.toString()) 
        return res.status(403).json({ message: 'Forbidden: You do not own this course' });
      courseName = c.name;
    } else {
      const c = await Course.findById(course);
      if (c) courseName = c.name;
    }
    await Attendance.findOneAndUpdate({ course, date }, { records }, { upsert: true });
    records.forEach(r => {
      io.to(r.student.toString()).emit('notification', { 
        message: `Attendance marked ${r.status} for ${courseName} on ${date}.`, 
        type: r.status === 'present' ? 'success' : 'amber' 
      });
      io.to(r.student.toString()).emit('refresh_data');
    });
    res.json({ message: 'Attendance marked' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- ASSIGNMENTS & SUBMISSIONS ---
api.get('/assignments/course/:id', auth, async (req, res) => {
  try {
    const assignments = await Assignment.find({ course: req.params.id });
    res.json({ assignments });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/assignments/me', auth, async (req, res) => {
  try {
    const enrols = await Enrolment.find({ student: req.user._id, status: 'active' });
    const courseIds = enrols.map(e => e.course);
    const assignments = await Assignment.find({ course: { $in: courseIds } }).populate('course', 'name').lean();
    const subs = await Submission.find({ student: req.user._id });
    
    const mapped = assignments.map(a => {
      const sub = subs.find(s => s.assignment.toString() === a._id.toString());
      return { ...a, submitted: !!sub, grade: sub?.grade, feedback: sub?.feedback, subText: sub?.text, subFile: sub?.fileUrl, subUrl: sub?.url };
    });
    res.json({ assignments: mapped });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/assignments', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    if (req.user.role === 'teacher') {
      const course = await Course.findById(req.body.course);
      if (!course || course.teacher?.toString() !== req.user._id.toString()) 
        return res.status(403).json({ message: 'Forbidden: You do not own this course' });
    }
    const assignment = await Assignment.create(req.body);
    
    const enrols = await Enrolment.find({ course: req.body.course, status: 'active' });
    enrols.forEach(e => {
      io.to(e.student.toString()).emit('notification', { message: `New assignment posted: ${assignment.title}`, type: 'success' });
      io.to(e.student.toString()).emit('refresh_data');
    });
    io.to(`course_${req.body.course}`).emit('course_updated', req.body.course.toString());
    
    res.json({ assignment });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/assignments/:id/submit', auth, upload.single('file'), async (req, res) => {
  try {
    const fileUrl = req.file ? `${BASE_URL}/uploads/${req.file.filename}` : undefined;

    const updateData = { text: req.body.text };
    if (fileUrl !== undefined) {
      updateData.fileUrl = fileUrl;
      const oldSub = await Submission.findOne({ assignment: req.params.id, student: req.user._id });
      if (oldSub && oldSub.fileUrl) deleteLocalFile(oldSub.fileUrl);
    }
    if (req.body.url !== undefined) updateData.url = req.body.url;
  
    await Submission.findOneAndUpdate(
      { assignment: req.params.id, student: req.user._id },
      { $set: updateData },
      { upsert: true }
    );
    
    const assignment = await Assignment.findById(req.params.id).populate('course');
    if (assignment && assignment.course && assignment.course.teacher) {
      io.to(assignment.course.teacher.toString()).emit('notification', { message: `New submission received for: ${assignment.title}`, type: 'info' });
      io.to(assignment.course.teacher.toString()).emit('refresh_data');
    }

    res.json({ message: 'Submitted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/assignments/:id/submissions', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    const submissions = await Submission.find({ assignment: req.params.id }).populate('student', 'name username');
    res.json({ submissions });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.put('/submissions/:id/grade', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    const { grade, feedback } = req.body;
    const sub = await Submission.findById(req.params.id).populate('assignment');
    if (!sub) return res.status(404).json({ message: 'Submission not found' });
    
    if (req.user.role === 'teacher') {
      const c = await Course.findById(sub.assignment.course);
      if (!c || c.teacher?.toString() !== req.user._id.toString()) 
        return res.status(403).json({ message: 'Forbidden: You do not own this course' });
    }
    sub.grade = grade; sub.feedback = feedback; await sub.save();

    io.to(sub.student.toString()).emit('notification', { message: `Your assignment has been graded: ${grade}`, type: 'success' });
    io.to(sub.student.toString()).emit('refresh_data');
    
    res.json({ message: 'Graded successfully' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- CONTENT ---
api.get('/content/course/:id', auth, async (req, res) => {
  try {
    const content = await Content.find({ course: req.params.id });
    res.json({ content });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/content', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    if (req.user.role === 'teacher') {
      const course = await Course.findById(req.body.course);
      if (!course || course.teacher?.toString() !== req.user._id.toString()) 
        return res.status(403).json({ message: 'Forbidden: You do not own this course' });
    }
    const content = await Content.create(req.body);
    io.to(`course_${req.body.course}`).emit('course_updated', req.body.course.toString());
    res.json({ content });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.delete('/content/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    
    const item = await Content.findById(req.params.id);
    if (item && req.user.role === 'teacher') {
      const course = await Course.findById(item.course);
      if (!course || course.teacher?.toString() !== req.user._id.toString()) 
        return res.status(403).json({ message: 'Forbidden: You do not own this course' });
    }
    if (item && item.type === 'chapter') {
      // Delete children files first
      const children = await Content.find({ parentId: item._id.toString() });
      children.forEach(c => deleteLocalFile(c.url));
      // Schema stores parentId as a String, must explicitly cast ObjectId to string
      await Content.deleteMany({ parentId: item._id.toString() });
    } else if (item) {
      deleteLocalFile(item.url);
    }
    await Content.findByIdAndDelete(req.params.id);
    if (item) io.to(`course_${item.course}`).emit('course_updated', item.course.toString());
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.put('/content/reorder', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.json({ message: 'Nothing to reorder' });

    if (req.user.role === 'teacher') {
      const firstItem = await Content.findById(items[0]._id);
      if (firstItem) {
        const course = await Course.findById(firstItem.course);
        if (!course || course.teacher?.toString() !== req.user._id.toString()) 
          return res.status(403).json({ message: 'Forbidden: You do not own this course' });
      }
    }

    const bulkOps = items.map(item => ({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: { order: item.order, parentId: item.parentId || null } }
      }
    }));

    await Content.bulkWrite(bulkOps);
    
    const firstItem = await Content.findById(items[0]._id);
    if (firstItem) io.to(`course_${firstItem.course}`).emit('course_updated', firstItem.course.toString());
    
    res.json({ message: 'Order saved' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- USERS / ADMIN ---
api.get('/users', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const query = req.query.role ? { role: req.query.role } : {};
    const users = await User.find(query).select('-password');
    res.json({ users });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/users', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { name, username, email, password, role } = req.body;
    
    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) return res.status(400).json({ message: 'Username or Email already exists' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, username, email, password: hashedPassword, role });
    
    res.json({ 
      user: { 
        _id: user._id, 
        name: user.name, 
        username: user.username, 
        email: user.email, 
        role: user.role, 
        active: user.active 
      } 
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/users/bulk', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const users = req.body.users;
    if (!Array.isArray(users)) return res.status(400).json({ message: 'Invalid data format' });

    let added = 0, skipped = 0;
    for (const u of users) {
      const existing = await User.findOne({ $or: [{ username: u.username }, { email: u.email }] });
      if (existing) { skipped++; continue; }
      
      const hashedPassword = await bcrypt.hash(u.password || 'password123', 10);
      await User.create({
        name: u.name,
        username: u.username,
        email: u.email,
        password: hashedPassword,
        role: u.role || 'student'
      });
      added++;
    }
    res.json({ message: `Bulk import complete. Added: ${added}, Skipped (duplicates): ${skipped}` });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.put('/users/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.id) return res.status(403).json({ message: 'Forbidden' });
    const { name, email, password, active, username, role } = req.body;
    const updateData = { name, email };
    if (active !== undefined && req.user.role === 'admin') {
      updateData.active = active;
      if (active === false) io.to(req.params.id).emit('force_logout', { message: 'Your account has been suspended by an administrator.' });
    }
    if (username && req.user.role === 'admin') updateData.username = username;
    if (role && req.user.role === 'admin') updateData.role = role;
    if (password) updateData.password = await bcrypt.hash(password, 10);
    await User.findByIdAndUpdate(req.params.id, updateData);
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.delete('/users/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const uid = req.params.id;
    if (req.user._id.toString() === uid) return res.status(400).json({ message: 'Cannot delete yourself' });
    
    io.to(uid).emit('force_logout', { message: 'Your account has been permanently deleted.' });

    // Cleanup user's local files
    const payments = await Payment.find({ student: uid });
    payments.forEach(p => deleteLocalFile(p.screenshotUrl));
    const subs = await Submission.find({ student: uid });
    subs.forEach(s => deleteLocalFile(s.fileUrl));

    await User.findByIdAndDelete(uid);
    await Enrolment.deleteMany({ student: uid });
    await Payment.deleteMany({ student: uid });
    await Submission.deleteMany({ student: uid });
    await Attendance.updateMany({}, { $pull: { records: { student: uid } } });
    await Course.updateMany({ teacher: uid }, { $unset: { teacher: 1 } });
    await ChatMessage.deleteMany({ sender: uid });
    
    res.json({ message: 'User deleted successfully' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/admin/stats', auth, async (req, res) => {
  try {
    const students = await User.countDocuments({ role: 'student' });
    const teachers = await User.countDocuments({ role: 'teacher' });
    const courses = await Course.countDocuments();
    
    const approvedPayments = await Payment.find({ status: 'approved' });
    const totalRevenue = approvedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    res.json({ stats: { students, teachers, courses, totalRevenue } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/admin/users/:id/report', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const uid = req.params.id;
    const user = await User.findById(uid).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const enrolments = await Enrolment.find({ student: uid }).populate('course', 'name');
    const payments = await Payment.find({ student: uid }).populate('course', 'name').sort('-createdAt');
    const submissions = await Submission.find({ student: uid }).populate('assignment', 'title');
    
    const atts = await Attendance.find({ 'records.student': uid });
    let present = 0, totalAtt = 0;
    atts.forEach(a => { const rec = a.records.find(r => r.student.toString() === uid); if (rec) { totalAtt++; if (rec.status === 'present') present++; } });
    
    res.json({ report: { user, enrolments, payments, submissions, attendance: { present, total: totalAtt } } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/admin/enrol', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { studentId, courseId } = req.body;
    
    await Enrolment.findOneAndUpdate(
      { student: studentId, course: courseId },
      { status: 'active' },
      { upsert: true }
    );
    const count = await Enrolment.countDocuments({ course: courseId, status: 'active' });
    await Course.findByIdAndUpdate(courseId, { studentCount: count });
    
    res.json({ message: 'Enrolled successfully' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/admin/broadcast', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { message, type } = req.body;
    if (!message) return res.status(400).json({ message: 'Message is required' });
    
    // Emit the notification to all connected clients globally
    io.emit('notification', { message, type: type || 'info' });
    res.json({ message: 'Broadcast sent successfully' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/settings', async (req, res) => {
  try {
    let settings = await Setting.findOne();
    if (!settings) settings = await Setting.create({});
    res.json({ settings });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.put('/settings', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const settings = await Setting.findOneAndUpdate({}, req.body, { new: true, upsert: true });
    settingsCache.lastFetch = 0; // Force cache refresh so banned IPs take effect immediately
    res.json({ settings });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- COUPONS ---
api.get('/coupons', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const coupons = await Coupon.find().sort('-createdAt');
    res.json({ coupons });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/coupons', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { code, discountPct } = req.body;
    const coupon = await Coupon.create({ code: code.toUpperCase(), discountPct });
    res.json({ coupon });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/coupons/verify', auth, async (req, res) => {
  try {
    const { code } = req.body;
    const coupon = await Coupon.findOne({ code: code.toUpperCase(), active: true });
    if (!coupon) return res.status(404).json({ message: 'Invalid or expired coupon code' });
    res.json({ discountPct: coupon.discountPct });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- CHAT / DISCUSSIONS ---
api.get('/chat/course/:id', auth, async (req, res) => {
  try {
    if (req.user.role === 'student') {
      const enrol = await Enrolment.findOne({ student: req.user._id, course: req.params.id, status: 'active' });
      if (!enrol) return res.status(403).json({ message: 'Forbidden: You must be enrolled to view discussions' });
    }
    const messages = await ChatMessage.find({ course: req.params.id }).populate('sender', 'name role').sort('createdAt');
    res.json({ messages });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/chat/course/:id', auth, async (req, res) => {
  try {
    if (req.user.role === 'student') {
      const enrol = await Enrolment.findOne({ student: req.user._id, course: req.params.id, status: 'active' });
      if (!enrol) return res.status(403).json({ message: 'Forbidden: You must be enrolled to post' });
    }
    const msg = await ChatMessage.create({ course: req.params.id, sender: req.user._id, text: req.body.text });
    const populated = await msg.populate('sender', 'name role');
    io.to(`course_${req.params.id}`).emit('chat_message', populated);
    res.json({ message: populated });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- AI DOUBT SOLVER ---
api.post('/ai/chat', auth, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ message: 'Forbidden: Only students can use the AI solver.' });
    const { courseId, text } = req.body;

    const enrol = await Enrolment.findOne({ student: req.user._id, course: courseId, status: 'active' });
    if (!enrol) return res.status(403).json({ message: 'Forbidden: You must be enrolled to use the AI.' });

    const course = await Course.findById(courseId);
    const prompt = `Context: The student is asking a doubt related to the course "${course?.name || 'General'}". Answer clearly and concisely. Question: ${text}`;

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error('AI Service is not configured (Missing API Key).');
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    
    const aiRes = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    const aiData = await aiRes.json();
    if (!aiRes.ok) throw new Error(aiData.error?.message || 'AI generation failed');

    res.json({ reply: aiData.candidates[0].content.parts[0].text });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- AI QUIZ MAKER ---
api.get('/quizzes/course/:id', auth, async (req, res) => {
  try {
    const quizzes = await Quiz.find({ course: req.params.id }).sort('-createdAt');
    if (req.user.role === 'student') {
      const attempts = await QuizAttempt.find({ student: req.user._id, quiz: { $in: quizzes.map(q => q._id) } });
      // Hide correct options from students UNLESS they have already submitted the quiz
      const safeQuizzes = quizzes.map(q => {
        const safeQ = q.toObject();
        const hasAttempt = attempts.some(a => a.quiz.toString() === safeQ._id.toString());
        if (!hasAttempt) {
          safeQ.questions.forEach(question => delete question.correctOption);
        }
        return safeQ;
      });
      return res.json({ quizzes: safeQuizzes, attempts });
    }
    res.json({ quizzes });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/quizzes/generate', auth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { courseId, title, topic, toughness, numQuestions, timer, availableFrom, availableUntil } = req.body;
    
    if (numQuestions > 50) return res.status(400).json({ message: 'Maximum 50 questions allowed.' });

    const prompt = `Generate a multiple choice quiz about "${topic}". Difficulty: ${toughness}. Number of questions: ${numQuestions}. 
    Return STRICTLY a raw JSON array of objects (NO markdown blocks, NO backticks, NO extra text). 
    Format: [{"text": "Question text?", "options": ["A", "B", "C", "D"], "correctOption": "Exact string of correct option"}]. 
    Ensure the correctOption EXACTLY matches one of the provided options.`;

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error('AI Service is not configured.');
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    
    const aiRes = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    const aiData = await aiRes.json();
    if (!aiRes.ok) throw new Error(aiData.error?.message || 'AI generation failed');

    let rawText = aiData.candidates[0].content.parts[0].text;
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const questions = JSON.parse(rawText);

    const quiz = await Quiz.create({
      course: courseId, title, topic, toughness, timer, availableFrom, availableUntil, questions
    });
    
    res.json({ quiz });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/quizzes/:id/submit', auth, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ message: 'Forbidden' });
    const { answers } = req.body; // format: [{ questionId, selectedOption }]
    
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    
    const existingAttempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id });
    if (existingAttempt) return res.status(400).json({ message: 'You have already attempted this quiz.' });

    // Server-side Grade Calculation (Prevent cheating)
    let score = 0;
    const processedAnswers = answers.map(ans => {
      const q = quiz.questions.find(quest => quest._id.toString() === ans.questionId);
      const isCorrect = q && q.correctOption === ans.selectedOption;
      if (isCorrect) score++;
      return { questionId: ans.questionId, selectedOption: ans.selectedOption, isCorrect };
    });

    const attempt = await QuizAttempt.create({
      quiz: quiz._id, student: req.user._id, score, maxScore: quiz.questions.length,
      answers: processedAnswers, status: 'completed', endTime: Date.now()
    });

    res.json({ score, maxScore: attempt.maxScore });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/quizzes/:id/attempts', auth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const attempts = await QuizAttempt.find({ quiz: req.params.id }).populate('student', 'name email username');
    res.json({ attempts });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.delete('/quizzes/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    await Quiz.findByIdAndDelete(req.params.id);
    await QuizAttempt.deleteMany({ quiz: req.params.id });
    res.json({ message: 'Quiz deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- LOGS ---
api.post('/logs', optionalAuth, async (req, res) => {
  try {
    const { action, details } = req.body;
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const userId = (req.user && mongoose.Types.ObjectId.isValid(req.user._id)) ? req.user._id : null;
    const newLog = await Log.create({ ip: clientIp, action, user: userId, details });
    
    const populatedLog = await Log.findById(newLog._id).populate('user', 'name username role');
    io.to('admin_room').emit('new_log', populatedLog);

    res.json({ message: 'Logged' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/admin/logs', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const logs = await Log.find().populate('user', 'name username role').sort('-createdAt').limit(1000);
    res.json({ logs });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.delete('/admin/logs/clear', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    await Log.deleteMany({});
    res.json({ message: 'All logs cleared successfully' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Apply IP Filter globally to the API
app.use('/api', ipFilter);
// Mount the API router
app.use('/api', api);

// Global Error Handler (Catches Multer limits & unexpected Express errors)
app.use((err, req, res, next) => {
  console.error('⚠️ Server Error:', err.message);
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'File is too large. Maximum size is 10MB.' });
  res.status(500).json({ message: err.message || 'Internal Server Error' });
});

/* ══════════════════════════════════════════
   SOCKET.IO SETUP
══════════════════════════════════════════ */
io.on('connection', (socket) => {
  console.log('⚡ A user connected:', socket.id);
  socket.on('register', (userId, role) => {
    socket.join(userId);
    if (role === 'admin') socket.join('admin_room');
    console.log(`👤 User ${userId} registered to socket ${socket.id}`);
  });
  socket.on('join_course', (courseId) => {
    socket.join(`course_${courseId}`);
    console.log(`👥 User joined course chat: ${courseId}`);
  });
  socket.on('disconnect', () => console.log('🔌 User disconnected:', socket.id));
  
  socket.on('typing', ({ courseId, name }) => {
    socket.to(`course_${courseId}`).emit('user_typing', { courseId, name });
  });
  
  socket.on('stop_typing', ({ courseId, name }) => {
    socket.to(`course_${courseId}`).emit('user_stop_typing', { courseId, name });
  });

  // Handle unexpected socket errors to prevent server crashes
  socket.on('error', (err) => {
    console.error(`⚠️ Socket error on ${socket.id}:`, err.message);
  });
});

// START SERVER
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

/* ══════════════════════════════════════════
   GRACEFUL SHUTDOWN
══════════════════════════════════════════ */
const gracefulShutdown = () => {
  console.log('\n🛑 Shutting down gracefully...');
  server.close(() => {
    console.log('HTTP Server closed.');
    mongoose.connection.close().then(() => {
      console.log('MongoDB connection closed.');
      process.exit(0);
    });
  });
};
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);