const path = require('path');
const express = require('express');
const session = require('express-session');
const QRCode = require('qrcode');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const https = require('https');
const { db, initDatabase } = require('./db');

const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

const whatsappApiUrl = process.env.WHATSAPP_API_URL || '';
const whatsappApiToken = process.env.WHATSAPP_API_TOKEN || '';

initDatabase();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'qr-presensi-disiplin',
  resave: false,
  saveUninitialized: true,
}));

function requireAuth(req, res, next) {
  if (req.session.user === 'admin') {
    return next();
  }
  res.redirect('/login');
}

function emitStatsUpdate() {
  io.emit('statsUpdate');
}

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin123') {
    req.session.user = 'admin';
    return res.redirect('/dashboard');
  }
  res.render('login', { error: 'Username atau password salah' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/dashboard', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.serialize(() => {
    db.get(`SELECT COUNT(*) AS total_students FROM students`, (err, totals) => {
      if (err) return res.sendStatus(500);
      db.get(`SELECT COUNT(*) AS hadir FROM students WHERE status = 'Hadir' AND date(last_scan) = ?`, [today], (err2, hadirRow) => {
        if (err2) return res.sendStatus(500);
        db.get(`SELECT COUNT(*) AS terlambat FROM students WHERE status = 'Terlambat' AND date(last_scan) = ?`, [today], (err3, terlambatRow) => {
          if (err3) return res.sendStatus(500);
          db.get(`SELECT COUNT(*) AS scanned_today FROM students WHERE date(last_scan) = ?`, [today], (err4, scannedRow) => {
            if (err4) return res.sendStatus(500);
            db.get(`SELECT COUNT(*) AS whatsapp_sent FROM notifications WHERE date(sent_at) = ?`, [today], (err5, whatsappRow) => {
              if (err5) return res.sendStatus(500);
              res.render('dashboard', {
                totals: {
                  total_students: totals.total_students || 0,
                  hadir: hadirRow.hadir || 0,
                  terlambat: terlambatRow.terlambat || 0,
                  belum_presensi: (totals.total_students || 0) - (scannedRow.scanned_today || 0),
                  whatsapp_sent: whatsappRow.whatsapp_sent || 0,
                }
              });
            });
          });
        });
      });
    });
  });
});

app.get('/monitoring', requireAuth, (req, res) => {
  db.serialize(() => {
    db.all(`SELECT c.*, (
          SELECT COUNT(*) FROM students s WHERE s.class_id = c.id
        ) AS total_students,
        (
          SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'Terlambat'
        ) AS late_students
      FROM classes c ORDER BY c.id`, (err, classes) => {
      if (err) return res.sendStatus(500);

      db.all(`SELECT s.*, c.name AS class_name FROM students s JOIN classes c ON c.id = s.class_id ORDER BY s.last_scan DESC LIMIT 10`, (err2, recent) => {
        if (err2) return res.sendStatus(500);
        res.render('monitoring', { classes, recent });
      });
    });
  });
});

app.get('/notifications', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.serialize(() => {
    db.all(`SELECT n.*, s.name AS student_name, c.name AS class_name
      FROM notifications n
      LEFT JOIN students s ON s.nomor_urut = n.student_nomor
      LEFT JOIN classes c ON c.id = n.class_id
      ORDER BY n.sent_at DESC
      LIMIT 50`, (err, notifications) => {
      if (err) return res.sendStatus(500);
      db.all(`SELECT provider, COUNT(*) AS count FROM notifications WHERE date(sent_at) = ? GROUP BY provider`, [today], (err2, summary) => {
        if (err2) return res.sendStatus(500);
        res.render('notifications', { notifications, summary, today });
      });
    });
  });
});

app.get('/students', requireAuth, (req, res) => {
  const searchName = (req.query.name || '').trim();
  const searchClassId = req.query.class_id || 'all';
  let query = `SELECT s.*, c.name AS class_name FROM students s JOIN classes c ON c.id = s.class_id WHERE 1=1`;
  const queryParams = [];

  if (searchName) {
    query += ` AND s.name LIKE ?`;
    queryParams.push(`%${searchName}%`);
  }
  if (searchClassId && searchClassId !== 'all') {
    query += ` AND s.class_id = ?`;
    queryParams.push(searchClassId);
  }
  query += ` ORDER BY s.nomor_urut`;

  db.serialize(() => {
    db.all(query, queryParams, (err, students) => {
      if (err) return res.sendStatus(500);
      db.all(`SELECT * FROM classes ORDER BY name`, (err2, classes) => {
        if (err2) return res.sendStatus(500);
        res.render('students', { students, classes, searchName, searchClassId });
      });
    });
  });
});

app.get('/students/new', requireAuth, (req, res) => {
  db.all(`SELECT * FROM classes ORDER BY name`, (err, classes) => {
    if (err) return res.sendStatus(500);
    res.render('student_form', { student: null, classes, action: '/students/create' });
  });
});

app.post('/students/create', requireAuth, (req, res) => {
  const { name, class_id, phone, parent_phone, active } = req.body;
  db.run(`INSERT INTO students (name, class_id, phone, parent_phone, points, active) VALUES (?, ?, ?, ?, 0, ?)`,
    [name.trim(), class_id, phone.trim(), parent_phone.trim(), active ? 1 : 0], function (err) {
      if (err) return res.sendStatus(500);
      emitStatsUpdate();
      res.redirect('/students');
    });
});

app.get('/students/edit/:nomor', requireAuth, (req, res) => {
  const nomor = req.params.nomor;
  db.get(`SELECT * FROM students WHERE nomor_urut = ?`, [nomor], (err, student) => {
    if (err || !student) return res.redirect('/students');
    db.all(`SELECT * FROM classes ORDER BY name`, (err2, classes) => {
      if (err2) return res.sendStatus(500);
      res.render('student_form', { student, classes, action: `/students/update/${nomor}` });
    });
  });
});

app.post('/students/update/:nomor', requireAuth, (req, res) => {
  const nomor = req.params.nomor;
  const { name, class_id, phone, parent_phone, points, active } = req.body;
  db.run(`UPDATE students SET name=?, class_id=?, phone=?, parent_phone=?, points=?, active=? WHERE nomor_urut=?`,
    [name.trim(), class_id, phone.trim(), parent_phone.trim(), Number(points) || 0, active ? 1 : 0, nomor], function (err) {
      if (err) return res.sendStatus(500);
      emitStatsUpdate();
      res.redirect('/students');
    });
});

app.post('/students/delete/:nomor', requireAuth, (req, res) => {
  db.run(`DELETE FROM students WHERE nomor_urut = ?`, [req.params.nomor], function (err) {
    if (err) return res.sendStatus(500);
    emitStatsUpdate();
    res.redirect('/students');
  });
});

app.get('/classes', requireAuth, (req, res) => {
  db.all(`SELECT * FROM classes ORDER BY id`, (err, classes) => {
    if (err) return res.sendStatus(500);
    res.render('classes', { classes, error: null });
  });
});

app.post('/classes/create', requireAuth, (req, res) => {
  const { name } = req.body;
  db.run(`INSERT INTO classes (name) VALUES (?)`, [name.trim()], function (err) {
    if (err) {
      db.all(`SELECT * FROM classes ORDER BY id`, (err2, classes) => {
        if (err2) return res.sendStatus(500);
        return res.render('classes', { classes, error: 'Nama kelas sudah ada atau tidak valid' });
      });
      return;
    }
    emitStatsUpdate();
    res.redirect('/classes');
  });
});

app.post('/classes/delete/:id', requireAuth, (req, res) => {
  const classId = req.params.id;
  db.serialize(() => {
    db.run(`DELETE FROM notifications WHERE class_id = ?`, [classId]);
    db.run(`DELETE FROM students WHERE class_id = ?`, [classId]);
    db.run(`DELETE FROM classes WHERE id = ?`, [classId], function (err) {
      if (err) return res.sendStatus(500);
      emitStatsUpdate();
      res.redirect('/classes');
    });
  });
});

app.get('/classes/:id/qr', requireAuth, async (req, res) => {
  const classId = req.params.id;
  db.get(`SELECT * FROM classes WHERE id = ?`, [classId], async (err, kelas) => {
    if (err || !kelas) return res.redirect('/classes');
    const qrUrl = `${req.protocol}://${req.get('host')}/scan/${classId}`;
    const qrData = await QRCode.toDataURL(qrUrl);
    res.render('class_qr', { kelas, qrData, qrUrl });
  });
});

app.get('/classes/:id/qr/download', requireAuth, async (req, res) => {
  const classId = req.params.id;
  db.get(`SELECT * FROM classes WHERE id = ?`, [classId], async (err, kelas) => {
    if (err || !kelas) return res.redirect('/classes');
    const qrUrl = `${req.protocol}://${req.get('host')}/scan/${classId}`;
    try {
      const buffer = await QRCode.toBuffer(qrUrl, { type: 'png', width: 520 });
      const safeName = kelas.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="QR-${safeName}.png"`);
      res.send(buffer);
    } catch (downloadErr) {
      console.error('QR download error:', downloadErr);
      res.redirect(`/classes/${classId}/qr`);
    }
  });
});

app.get('/scan/:classId', (req, res) => {
  const classId = req.params.classId;
  db.get(`SELECT * FROM classes WHERE id = ?`, [classId], (err, kelas) => {
    if (err || !kelas) return res.status(404).send('Kelas tidak ditemukan');
    res.render('scan', { kelas, message: null, error: null });
  });
});

const schoolLocation = {
  lat: -3.543247742936886,
  lon: 118.98159579854247,
  allowedRadiusMeters: 100,
};

function formatAsTime(t) {
  return t.toTimeString().split(' ')[0].slice(0,5);
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getIndonesianDay(date) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return days[date.getDay()];
}

function formatIndonesianDate(date) {
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function normalizePhoneNumber(phone) {
  return phone.replace(/[^0-9]/g, '').replace(/^0+/, '62');
}

function buildWaMeLink(phone, message) {
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${phone}?text=${encoded}`;
}

function logNotification({ student_nomor, class_id, message, provider, provider_link, error_message }) {
  db.run(`INSERT INTO notifications (student_nomor, class_id, message, provider, provider_link, error_message) VALUES (?, ?, ?, ?, ?, ?)`,
    [student_nomor || null, class_id || null, message, provider || null, provider_link || null, error_message || null], (err) => {
      if (err) console.error('Gagal menyimpan log notifikasi:', err.message || err);
    });
}

function postJson(url, token, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const payload = JSON.stringify(body);

    const requestOptions = {
      method: 'POST',
      hostname: parsedUrl.hostname,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data || '{}'));
          } catch (error) {
            resolve({ raw: data });
          }
        } else {
          reject(new Error(`WhatsApp API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sendWhatsAppMessage(phone, message) {
  if (!phone || !phone.trim()) return Promise.resolve(null);
  const normalizedPhone = normalizePhoneNumber(phone.trim());
  if (!normalizedPhone) return Promise.resolve(null);

  if (whatsappApiUrl && whatsappApiToken) {
    return postJson(whatsappApiUrl, whatsappApiToken, {
      phone: normalizedPhone,
      message
    }).then((result) => {
      console.log(`WhatsApp API dikirim ke ${normalizedPhone}:`, result);
      return { provider: 'api', result };
    }).catch((err) => {
      console.error('Gagal kirim WhatsApp API:', err.message || err);
      return { provider: 'api', error: err.message || err };
    });
  }

  const waLink = buildWaMeLink(normalizedPhone, message);
  console.log(`WhatsApp wa.me link untuk ${normalizedPhone}: ${waLink}`);
  return Promise.resolve({ provider: 'wame', link: waLink });
}

function sendLateNotifications(studentNomor, studentName, className, classId, scanTime, remainingPoints, phone, parentPhone, date) {
  const hari = getIndonesianDay(date);
  const tanggal = formatIndonesianDate(date);
  const parentMessage = `**[SIPDIS QR NOTIFIKASI]**\nYth. Orang Tua/Wali dari **${studentName}** (Kelas: **${className}**),\nMenginfokan bahwa putra/putri Anda tercatat **TERLAMBAT** melakukan presensi pada hari ini:\n🗓️ Hari/Tanggal: ${hari}, ${tanggal}\n⏰ Waktu Scan: ${scanTime} WIB (Batas: 07:30 WIB)\n📉 Poin Disiplin: -5 Poin (Sisa Poin: ${remainingPoints})\nPemberitahuan ini juga telah dikirimkan ke nomor WhatsApp siswa yang bersangkutan sebagai bahan evaluasi kedisiplinan. Mohon kerja samanya agar Ananda bisa tiba di sekolah tepat waktu. Terima kasih.\n*-- Hormat kami, Tim Kesiswaan Sekolah --*`;
  const studentMessage = `Hari ini (${tanggal}) kamu tercatat melakukan scan presensi SIPDIS QR pada pukul **${scanTime}**, melewati batas waktu kedisiplinan sekolah (07:30).\nStatus kamu hari ini: **TERLAMBAT** (-5 Poin).\nSisa Poin Disiplin kamu saat ini: **${remainingPoints} Poin**.\n*Notifikasi ini juga otomatis dikirimkan ke nomor WhatsApp Orang Tua kamu. Yuk, besok bangun lebih pagi dan berangkat lebih awal demi masa depanmu yang lebih disiplin!* 💪`;
  const tasks = [];

  const addTask = (recipientPhone, message) => {
    return sendWhatsAppMessage(recipientPhone, message).then((result) => {
      logNotification({
        student_nomor: studentNomor || null,
        class_id: classId || null,
        message,
        provider: result?.provider || null,
        provider_link: result?.link || null,
        error_message: result?.error || null
      });
      if (result && result.provider === 'wame') {
        console.log(`WA link untuk ${recipientPhone}:`, result.link);
      }
      return result;
    }).catch((err) => {
      logNotification({
        student_nomor: studentNomor || null,
        class_id: classId || null,
        message,
        provider: 'error',
        provider_link: null,
        error_message: err.message || String(err)
      });
      console.error('Error notifikasi WhatsApp:', err);
      return { provider: 'error', error: err.message || String(err) };
    });
  };

  if (parentPhone && parentPhone.trim()) {
    tasks.push(addTask(parentPhone.trim(), parentMessage));
  }
  if (phone && phone.trim()) {
    tasks.push(addTask(phone.trim(), studentMessage));
  }

  if (tasks.length > 0) {
    Promise.all(tasks).catch((err) => {
      console.error('Error notifikasi WhatsApp:', err);
    });
  }
}

app.post('/scan/:classId', (req, res) => {
  const classId = req.params.classId;
  const { name, latitude, longitude } = req.body;
  const phone = (req.body.phone || '').trim();
  const parent_phone = (req.body.parent_phone || '').trim();
  const lat = parseFloat(latitude);
  const lon = parseFloat(longitude);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const scanTime = formatAsTime(now);
  const lateLimit = '07:30';
  const status = scanTime > lateLimit ? 'Terlambat' : 'Hadir';
  const pointDelta = status === 'Hadir' ? 5 : -5;

  db.get(`SELECT * FROM classes WHERE id = ?`, [classId], (err, kelas) => {
    if (err || !kelas) return res.status(404).send('Kelas tidak ditemukan');

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.render('scan', {
        kelas,
        message: null,
        error: 'Aktifkan GPS pada HP Anda dan pastikan lokasi tersedia untuk melakukan presensi.'
      });
    }

    const distance = getDistanceMeters(lat, lon, schoolLocation.lat, schoolLocation.lon);
    if (distance > schoolLocation.allowedRadiusMeters) {
      return res.render('scan', {
        kelas,
        message: null,
        error: `Presensi hanya bisa dilakukan di area sekolah dalam radius ${schoolLocation.allowedRadiusMeters} meter. Jarak Anda sekitar ${Math.round(distance)} meter.`
      });
    }

    db.get(`SELECT * FROM students WHERE name = ? AND class_id = ?`, [name.trim(), classId], (err2, student) => {
      if (err2) return res.sendStatus(500);

      function recordAndRespond(studentRecord) {
        const sameDay = studentRecord.last_scan ? studentRecord.last_scan.slice(0,10) === today : false;
        if (sameDay && studentRecord.class_id === Number(classId)) {
          return res.render('scan', {
            kelas,
            message: null,
            error: 'Anda sudah melakukan scan hari ini. Double scan tidak diizinkan.'
          });
        }

        const updatedPoints = Math.max(0, (studentRecord.points || 0) + pointDelta);
        const updatedPhone = phone || studentRecord.phone || '';
        const updatedParentPhone = parent_phone || studentRecord.parent_phone || '';

        db.run(`UPDATE students SET phone=?, parent_phone=?, last_scan=?, status=?, last_status_time=?, points=?, active=1 WHERE nomor_urut=?`,
          [updatedPhone, updatedParentPhone, now.toISOString(), status, scanTime, updatedPoints, studentRecord.nomor_urut], function (err3) {
            if (err3) return res.sendStatus(500);
            if (status === 'Terlambat') {
              sendLateNotifications(studentRecord.nomor_urut, studentRecord.name, kelas.name, classId, scanTime, updatedPoints, updatedPhone, updatedParentPhone, now);
            }
            emitStatsUpdate();
            res.render('scan', {
              kelas,
              message: `Scan diterima. Nama: ${studentRecord.name}. Status: ${status}. Waktu: ${scanTime}`,
              error: null
            });
          });
      }

      if (!student) {
        const initialPoints = status === 'Hadir' ? 5 : 0;
        const newPhone = phone || '';
        const newParentPhone = parent_phone || '';
        db.run(`INSERT INTO students (name, class_id, phone, parent_phone, points, active, last_scan, status, last_status_time) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          [name.trim(), classId, newPhone, newParentPhone, initialPoints, now.toISOString(), status, scanTime], function (err3) {
            if (err3) return res.sendStatus(500);
            if (status === 'Terlambat') {
              sendLateNotifications(this.lastID, name.trim(), kelas.name, classId, scanTime, initialPoints, newPhone, newParentPhone, now);
            }
            emitStatsUpdate();
            res.render('scan', { kelas, message: `Scan diterima. Status ${status}.`, error: null });
          });
      } else {
        recordAndRespond(student);
      }
    });
  });
});

app.get('/api/stats', requireAuth, (req, res) => {
  db.serialize(() => {
    db.all(`SELECT c.name AS class_name,
      SUM(CASE WHEN s.status = 'Terlambat' THEN 1 ELSE 0 END) AS late_count,
      SUM(CASE WHEN s.status = 'Hadir' THEN 1 ELSE 0 END) AS present_count,
      COUNT(s.nomor_urut) AS total_students
      FROM classes c
      LEFT JOIN students s ON s.class_id = c.id
      GROUP BY c.id`, (err, rows) => {
      if (err) return res.sendStatus(500);
      db.all(`SELECT status, COUNT(*) AS count FROM students GROUP BY status`, (err2, summary) => {
        if (err2) return res.sendStatus(500);
        res.json({ rows, summary });
      });
    });
  });
});

function buildStudentExportQuery(classId, name) {
  let query = `SELECT s.*, c.name AS class_name FROM students s JOIN classes c ON c.id = s.class_id WHERE 1=1`;
  const params = [];

  if (classId && classId !== 'all') {
    query += ' AND s.class_id = ?';
    params.push(classId);
  }

  if (name) {
    query += ' AND s.name LIKE ?';
    params.push(`%${name}%`);
  }

  query += ' ORDER BY s.nomor_urut';
  return { query, params };
}

async function resolveClassName(classId) {
  if (!classId || classId === 'all') return null;
  return new Promise((resolve) => {
    db.get(`SELECT name FROM classes WHERE id = ?`, [classId], (err, row) => {
      if (err || !row) return resolve(null);
      resolve(row.name);
    });
  });
}

app.get('/export/excel', requireAuth, async (req, res) => {
  const { class_id: classId, name } = req.query;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Laporan Presensi');
  sheet.columns = [
    { header: 'No Urut', key: 'nomor_urut', width: 10 },
    { header: 'Nama', key: 'name', width: 25 },
    { header: 'Kelas', key: 'class_name', width: 15 },
    { header: 'No Hp', key: 'phone', width: 18 },
    { header: 'No Hp Orang Tua', key: 'parent_phone', width: 20 },
    { header: 'Poin', key: 'points', width: 10 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Waktu', key: 'last_scan', width: 22 }
  ];

  const { query, params } = buildStudentExportQuery(classId, name);
  db.all(query, params, async (err, students) => {
    if (err) return res.sendStatus(500);
    students.forEach((student) => sheet.addRow(student));
    const className = await resolveClassName(classId);
    const safeName = className ? className.replace(/[^a-zA-Z0-9_-]/g, '_') : 'semua_kelas';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=laporan-presensi-${safeName}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  });
});

app.get('/export/pdf', requireAuth, async (req, res) => {
  const { class_id: classId, name } = req.query;
  const { query, params } = buildStudentExportQuery(classId, name);
  db.all(query, params, async (err, students) => {
    if (err) return res.sendStatus(500);
    const className = await resolveClassName(classId);
    const safeName = className ? className.replace(/[^a-zA-Z0-9_-]/g, '_') : 'semua_kelas';
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=laporan-presensi-${safeName}.pdf`);
    doc.pipe(res);
    doc.fontSize(20).text('Laporan Presensi', { underline: true });
    if (className) {
      doc.moveDown(0.5).fontSize(14).text(`Kelas: ${className}`);
    }
    doc.moveDown();
    students.forEach((student) => {
      doc.fontSize(10).text(`No Urut: ${student.nomor_urut} | Nama: ${student.name} | Kelas: ${student.class_name} | HP: ${student.phone} | HP Orang Tua: ${student.parent_phone} | Poin: ${student.points} | Status: ${student.status} | Waktu: ${student.last_scan}`);
      doc.moveDown(0.2);
    });
    doc.end();
  });
});

io.on('connection', (socket) => {
  socket.on('requestUpdate', () => {
    emitStatsUpdate();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
