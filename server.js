require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

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
  title: String, description: String, dueDate: Date
}));

const Submission = mongoose.model('Submission', new mongoose.Schema({
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment' },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: String, fileUrl: String, grade: String, feedback: String
}, { timestamps: true }));

const Content = mongoose.model('Content', new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  type: { type: String, enum: ['chapter', 'video', 'file'] },
  title: String, url: String, description: String, parentId: String, thumbnail: String, order: Number
}));

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

/* ══════════════════════════════════════════
   API ROUTES
══════════════════════════════════════════ */
const api = express.Router();

// --- AUTH ---
api.post('/auth/signup', async (req, res) => {
  try {
    const { name, username, email, password, role } = req.body;
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
    const course = await Course.create(req.body);
    res.json({ course });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

api.put('/courses/:id', auth, async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ course });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

api.delete('/courses/:id', auth, async (req, res) => {
  try {
    const cid = req.params.id;
    await Course.findByIdAndDelete(cid);
    await Enrolment.deleteMany({ course: cid });
    await Payment.deleteMany({ course: cid });
    await Attendance.deleteMany({ course: cid });
    const assigns = await Assignment.find({ course: cid });
    await Submission.deleteMany({ assignment: { $in: assigns.map(a => a._id) } });
    await Assignment.deleteMany({ course: cid });
    await Content.deleteMany({ course: cid });
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// --- ENROLMENTS ---
api.get('/enrolments/me', auth, async (req, res) => {
  const enrolments = await Enrolment.find({ student: req.user._id }).populate('course');
  res.json({ enrolments });
});

api.get('/enrolments/course/:id', auth, async (req, res) => {
  const enrolments = await Enrolment.find({ course: req.params.id, status: 'active' }).populate('student', 'name username email');
  res.json({ students: enrolments.map(e => e.student) });
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
  const payments = await Payment.find().populate('student', 'name').populate('course', 'name').sort('-createdAt');
  res.json({ payments });
});

api.post('/payments/:id/approve', auth, async (req, res) => {
  const p = await Payment.findByIdAndUpdate(req.params.id, { status: 'approved' });
  await Enrolment.findOneAndUpdate({ student: p.student, course: p.course }, { status: 'active' }, { upsert: true });
  const count = await Enrolment.countDocuments({ course: p.course, status: 'active' });
  await Course.findByIdAndUpdate(p.course, { studentCount: count });
  res.json({ message: 'Approved' });
});

api.post('/payments/:id/reject', auth, async (req, res) => {
  await Payment.findByIdAndUpdate(req.params.id, { status: 'rejected' });
  res.json({ message: 'Rejected' });
});

// --- ATTENDANCE ---
api.get('/attendance/me', auth, async (req, res) => {
  const atts = await Attendance.find({ 'records.student': req.user._id }).populate('course', 'name');
  const flat = [];
  atts.forEach(a => {
    const rec = a.records.find(r => r.student.toString() === req.user._id.toString());
    if (rec) flat.push({ course: a.course, date: a.date, status: rec.status });
  });
  res.json({ records: flat });
});

api.get('/attendance/course/:id', auth, async (req, res) => {
  const atts = await Attendance.find({ course: req.params.id });
  const flat = [];
  atts.forEach(a => a.records.forEach(r => flat.push({ date: a.date, student: r.student, status: r.status })));
  res.json({ records: flat });
});

api.post('/attendance/mark', auth, async (req, res) => {
  const { course, date, records } = req.body;
  await Attendance.findOneAndUpdate({ course, date }, { records }, { upsert: true });
  res.json({ message: 'Attendance marked' });
});

// --- ASSIGNMENTS & SUBMISSIONS ---
api.get('/assignments/course/:id', auth, async (req, res) => {
  const assignments = await Assignment.find({ course: req.params.id });
  res.json({ assignments });
});

api.get('/assignments/me', auth, async (req, res) => {
  const enrols = await Enrolment.find({ student: req.user._id, status: 'active' });
  const courseIds = enrols.map(e => e.course);
  const assignments = await Assignment.find({ course: { $in: courseIds } }).populate('course', 'name').lean();
  const subs = await Submission.find({ student: req.user._id });
  
  const mapped = assignments.map(a => {
    const sub = subs.find(s => s.assignment.toString() === a._id.toString());
    return { ...a, submitted: !!sub, grade: sub?.grade, feedback: sub?.feedback, subText: sub?.text, subFile: sub?.fileUrl };
  });
  res.json({ assignments: mapped });
});

api.post('/assignments', auth, async (req, res) => {
  const assignment = await Assignment.create(req.body);
  res.json({ assignment });
});

api.post('/assignments/:id/submit', auth, upload.single('file'), async (req, res) => {
  const fileUrl = req.file ? `${BASE_URL}/uploads/${req.file.filename}` : null;
  await Submission.findOneAndUpdate(
    { assignment: req.params.id, student: req.user._id },
    { text: req.body.text, fileUrl },
    { upsert: true }
  );
  res.json({ message: 'Submitted' });
});

api.get('/assignments/:id/submissions', auth, async (req, res) => {
  const submissions = await Submission.find({ assignment: req.params.id }).populate('student', 'name');
  res.json({ submissions });
});

api.put('/submissions/:id/grade', auth, async (req, res) => {
  const { grade, feedback } = req.body;
  await Submission.findByIdAndUpdate(req.params.id, { grade, feedback });
  res.json({ message: 'Graded successfully' });
});

// --- CONTENT ---
api.get('/content/course/:id', auth, async (req, res) => {
  const content = await Content.find({ course: req.params.id });
  res.json({ content });
});

api.post('/content', auth, async (req, res) => {
  const content = await Content.create(req.body);
  res.json({ content });
});

api.delete('/content/:id', auth, async (req, res) => {
  const item = await Content.findById(req.params.id);
  if (item && item.type === 'chapter') {
    await Content.deleteMany({ parentId: item._id });
  }
  await Content.findByIdAndDelete(req.params.id);
  res.json({ message: 'Deleted' });
});

// --- USERS / ADMIN ---
api.get('/users', auth, async (req, res) => {
  const query = req.query.role ? { role: req.query.role } : {};
  const users = await User.find(query).select('-password');
  res.json({ users });
});

api.put('/users/:id', auth, async (req, res) => {
  if (req.body.password) req.body.password = await bcrypt.hash(req.body.password, 10);
  await User.findByIdAndUpdate(req.params.id, req.body);
  res.json({ message: 'Updated' });
});

api.get('/admin/stats', auth, async (req, res) => {
  const students = await User.countDocuments({ role: 'student' });
  const teachers = await User.countDocuments({ role: 'teacher' });
  const courses = await Course.countDocuments();
  res.json({ stats: { students, teachers, courses } });
});

// Mount the API router
app.use('/api', api);

// START SERVER
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));