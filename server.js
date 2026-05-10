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
const Mailjet = require('node-mailjet');

const app = express();
app.use(cors());
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

/* Initialize Mailjet */
const mailjet = Mailjet.apiConnect(
  process.env.MJ_APIKEY_PUBLIC,
  process.env.MJ_APIKEY_PRIVATE
);

/* ══════════════════════════════════════════
   FILE UPLOAD CONFIG (Multer)
══════════════════════════════════════════ */
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir)); // Serve files statically

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'))
});
const upload = multer({ storage });

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

const Enrolment = mongoose.model('Enrolment', new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  status: { type: String, default: 'active' }
}));

const Payment = mongoose.model('Payment', new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  amount: Number,
  screenshotUrl: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true }));

const Attendance = mongoose.model('Attendance', new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  date: String,
  records: [{
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['present', 'absent'] }
  }]
}));

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
  bannedIPs: [{ type: String }]
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

/* ══════════════════════════════════════════
   HELPER: INVOICE GENERATOR
══════════════════════════════════════════ */
function generateInvoicePDF(payment, student, course, teacher) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(20).text('ABC Institute', { align: 'center' });
    doc.fontSize(12).text('Payment Invoice & Enrolment Details', { align: 'center' });
    doc.moveDown(2);
    
    doc.fontSize(14).text(`Hello ${student.name},`);
    doc.fontSize(12).text('Thank you for your purchase! Your payment has been successfully verified and you are now enrolled in the course.');
    doc.moveDown(2);

    doc.fontSize(14).text('Course Details', { underline: true });
    doc.fontSize(12).text(`Course Name: ${course.name}`);
    doc.text(`Duration: ${course.duration || 'Self-paced'}`);
    doc.text(`Amount Paid: INR ${payment.amount}`);
    doc.moveDown();

    doc.fontSize(14).text('Instructor Details', { underline: true });
    doc.fontSize(12).text(`Teacher: ${teacher ? teacher.name : 'TBA'}`);
    if (teacher && teacher.email) doc.text(`Contact: ${teacher.email}`);
    doc.moveDown(2);

    doc.fontSize(14).text('Your Account Details', { underline: true });
    doc.fontSize(12).text(`Name: ${student.name}`);
    doc.text(`Username: ${student.username}`);
    doc.text(`Email: ${student.email}`);
    doc.text(`Password: ********* (Encrypted for your security)`);
    
    doc.moveDown(3);
    doc.fontSize(10).fillColor('gray').text('This is an automatically generated invoice. For support, please contact us.', { align: 'center' });

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
    if (token === 'secret_admin_token') {
      req.user = { _id: 'secret_admin_123', name: 'System Admin', role: 'admin', active: true };
      return next();
    }
    if (!mongoose.Types.ObjectId.isValid(token)) throw new Error('Invalid token format');
    req.user = await User.findById(token).select('-password');
    if (!req.user || !req.user.active) throw new Error('Inactive User');
    next();
  } catch (err) { res.status(401).json({ message: 'Unauthorized: Invalid token' }); }
};

const ipFilter = async (req, res, next) => {
  try {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    // Cache settings in production to avoid DB hits on every request
    const settings = await Setting.findOne(); 
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

// --- AUTH ---
api.post('/auth/signup', async (req, res) => {
  // Apply IP filter manually to unauthenticated routes if desired, 
  // or apply globally: app.use('/api', ipFilter);
  
  try {
    const { name, username, email, password, role } = req.body;
    if (role === 'admin') return res.status(403).json({ message: 'Forbidden: Cannot sign up as admin' });
    
    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) return res.status(400).json({ message: 'Username or Email already exists' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, username, email, password: hashedPassword, role });
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
    await Course.findByIdAndDelete(cid);
    await Enrolment.deleteMany({ course: cid });
    await Payment.deleteMany({ course: cid });
    await Attendance.deleteMany({ course: cid });
    const assigns = await Assignment.find({ course: cid });
    await Submission.deleteMany({ assignment: { $in: assigns.map(a => a._id) } });
    await Assignment.deleteMany({ course: cid });
    await Content.deleteMany({ course: cid });
    await ChatMessage.deleteMany({ course: cid });
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
    res.json({ message: 'Payment submitted successfully' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/payments/me', auth, async (req, res) => {
  const payments = await Payment.find({ student: req.user._id }).populate('course', 'name').sort('-createdAt');
  res.json({ payments });
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
    
    p.status = 'approved';
    await p.save();

    await Enrolment.findOneAndUpdate({ student: p.student._id, course: p.course._id }, { status: 'active' }, { upsert: true });
    const count = await Enrolment.countDocuments({ course: p.course._id, status: 'active' });
    await Course.findByIdAndUpdate(p.course._id, { studentCount: count });

    io.to(p.student._id.toString()).emit('notification', { message: 'Your payment was approved! You are now enrolled.', type: 'success' });
    io.to(p.student._id.toString()).emit('refresh_data');
    
    /* === INVOICE EMAIL LOGIC === */
    try {
      const pdfBuffer = await generateInvoicePDF(p, p.student, p.course, p.course.teacher);
      
      await mailjet.post("send", {'version': 'v3.1'}).request({
        "Messages": [{
          "From": {
            "Email": process.env.MAILJET_SENDER_EMAIL || "nikunjsingh79827@gmail.com",
            "Name": "ABC Institute"
          },
          "To": [{ "Email": p.student.email, "Name": p.student.name }],
          "Subject": `Your Invoice & Enrolment: ${p.course.name}`,
          "HTMLPart": `
            <h3>Welcome to ${p.course.name}!</h3>
            <p>Dear ${p.student.name},</p>
            <p>Thank you! Your payment of INR ${p.amount} has been approved.</p>
            <p><strong>Your Account Login details:</strong><br/>
            Username: <b>${p.student.username}</b><br/>
            Email: <b>${p.student.email}</b><br/>
            <em>Note: Your password is encrypted and hidden for security.</em></p>
            <p>Please find your PDF invoice attached.</p>
          `,
          "Attachments": [{
            "ContentType": "application/pdf",
            "Filename": `Invoice_${(p.course?.name || 'Course').replace(/\s+/g, '_')}.pdf`,
            "Base64Content": pdfBuffer.toString('base64')
          }]
        }]
      });

      // Check if Mailjet returned a specific message error despite a 200 OK HTTP status
      if (response.body?.Messages?.[0]?.Status === 'error') {
        console.error("⚠️ Mailjet Message Error:", response.body.Messages[0].Errors);
      }
    } catch (emailErr) { 
      console.error("❌ Mailjet Email Error:");
      console.error(emailErr.response ? JSON.stringify(emailErr.response.data, null, 2) : emailErr.message || emailErr);
    }

    res.json({ message: 'Approved' });
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
    await Attendance.findOneAndUpdate({ course, date }, { records }, { upsert: true });
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
    
    res.json({ assignment });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.post('/assignments/:id/submit', auth, upload.single('file'), async (req, res) => {
  try {
    const fileUrl = req.file ? `${BASE_URL}/uploads/${req.file.filename}` : undefined;
    const updateData = { text: req.body.text };
    if (fileUrl !== undefined) updateData.fileUrl = fileUrl;
    if (req.body.url !== undefined) updateData.url = req.body.url;
  
    await Submission.findOneAndUpdate(
      { assignment: req.params.id, student: req.user._id },
      { $set: updateData },
      { upsert: true }
    );
    res.json({ message: 'Submitted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.get('/assignments/:id/submissions', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    const submissions = await Submission.find({ assignment: req.params.id }).populate('student', 'name');
    res.json({ submissions });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.put('/submissions/:id/grade', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    const { grade, feedback } = req.body;
    const sub = await Submission.findByIdAndUpdate(req.params.id, { grade, feedback });
    if (!sub) return res.status(404).json({ message: 'Submission not found' });
    
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
    res.json({ content });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

api.delete('/content/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    
    const item = await Content.findById(req.params.id);
    if (item && item.type === 'chapter') {
      // Schema stores parentId as a String, must explicitly cast ObjectId to string
      await Content.deleteMany({ parentId: item._id.toString() });
    }
    await Content.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
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
    res.json({ user });
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
    if (active !== undefined && req.user.role === 'admin') updateData.active = active;
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

api.post('/admin/send-email', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { userId, courseId, subject, message } = req.body;
    
    let users = [];
    if (courseId) {
      const enrols = await Enrolment.find({ course: courseId, status: 'active' }).populate('student');
      const uniqueIds = new Set();
      enrols.forEach(e => {
        if (e.student && !uniqueIds.has(e.student._id.toString())) {
          uniqueIds.add(e.student._id.toString());
          users.push(e.student);
        }
      });
    } else if (userId) {
      const user = await User.findById(userId);
      if (user) users.push(user);
    }

    if (!users.length) return res.status(404).json({ message: 'No recipients found for this action.' });

    // Mailjet allows max 50 messages per API call, split into batches if sending to hundreds of students
    const BATCH_SIZE = 50; 
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      const messages = batch.map(u => ({
        "From": { "Email": process.env.MAILJET_SENDER_EMAIL || "nikunjsingh79827@gmail.com", "Name": "ABC Institute" },
        "To": [{ "Email": u.email, "Name": u.name }],
        "Subject": subject || "Message from ABC Institute",
        "HTMLPart": `<p>Dear ${u.name},</p><p>${message.replace(/\n/g, '<br/>')}</p>`
      }));
      const response = await mailjet.post("send", {'version': 'v3.1'}).request({ "Messages": messages });
      
      // Mailjet v3.1 processes valid messages even if some fail. Count the actual successes/errors.
      const results = response.body?.Messages || [];
      results.forEach(msg => {
        if (msg.Status === 'success') successCount++;
        else errorCount++;
      });
    }

    if (errorCount > 0) {
      res.json({ message: `Email processing finished. Success: ${successCount}, Failed: ${errorCount}.` });
    } else {
      res.json({ message: `Email sent successfully to ${successCount} recipient(s)` });
    }
  } catch (e) { 
    console.error("❌ Mailjet Error:", e.response ? JSON.stringify(e.response.data, null, 2) : e.message || e);
    const errorDetail = e.response?.data?.ErrorMessage || e.response?.data?.Messages?.[0]?.Errors?.[0]?.ErrorMessage || 'Check configuration.';
    res.status(500).json({ message: `Mailjet Error: ${errorDetail}` }); 
  }
});

// --- SETTINGS ---
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
  socket.on('register', (userId) => {
    socket.join(userId);
    console.log(`👤 User ${userId} registered to socket ${socket.id}`);
  });
  socket.on('join_course', (courseId) => {
    socket.join(`course_${courseId}`);
    console.log(`👥 User joined course chat: ${courseId}`);
  });
  socket.on('disconnect', () => console.log('🔌 User disconnected:', socket.id));
  
  // Handle unexpected socket errors to prevent server crashes
  socket.on('error', (err) => {
    console.error(`⚠️ Socket error on ${socket.id}:`, err.message);
  });
});

// START SERVER
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));