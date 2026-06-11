const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(path.join(dataDir, 'presensi.db'));

function initDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS students (
      nomor_urut INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      class_id INTEGER NOT NULL,
      phone TEXT,
      parent_phone TEXT,
      points INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      last_scan TEXT,
      status TEXT,
      last_status_time TEXT,
      FOREIGN KEY(class_id) REFERENCES classes(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_nomor INTEGER,
      class_id INTEGER,
      message TEXT,
      provider TEXT,
      provider_link TEXT,
      error_message TEXT,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.all(`PRAGMA table_info(notifications)`, (err, columns) => {
      if (err || !columns) return;
      const names = columns.map((col) => col.name);
      if (!names.includes('provider')) {
        db.run(`ALTER TABLE notifications ADD COLUMN provider TEXT`);
      }
      if (!names.includes('provider_link')) {
        db.run(`ALTER TABLE notifications ADD COLUMN provider_link TEXT`);
      }
      if (!names.includes('error_message')) {
        db.run(`ALTER TABLE notifications ADD COLUMN error_message TEXT`);
      }
    });

    db.run(`INSERT OR IGNORE INTO classes (id, name) VALUES (1, 'KELAS X.8')`);
    db.run(`INSERT OR IGNORE INTO classes (id, name) VALUES (2, 'KELAS X.7')`);
    db.run(`INSERT OR IGNORE INTO classes (id, name) VALUES (3, 'KELAS X.4')`);

    db.run(`UPDATE classes SET name = 'KELAS X.8' WHERE id = 1 AND name = 'Kelas A'`);
    db.run(`UPDATE classes SET name = 'KELAS X.7' WHERE id = 2 AND name = 'Kelas B'`);
    db.run(`UPDATE classes SET name = 'KELAS X.4' WHERE id = 3 AND name = 'Kelas C'`);
  });
}

module.exports = {
  db,  
  initDatabase
};
