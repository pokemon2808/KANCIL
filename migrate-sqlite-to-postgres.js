const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: Silakan set environment variable DATABASE_URL terlebih dahulu.');
  process.exit(1);
}

const sqliteDbPath = path.join(__dirname, 'data', 'presensi.db');
const sqliteDb = new sqlite3.Database(sqliteDbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Gagal membuka database SQLite:', err.message);
    process.exit(1);
  }
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function runSqliteAll(query, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(query, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function createPostgresSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS classes (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS students (
      nomor_urut SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      class_id INTEGER NOT NULL REFERENCES classes(id),
      phone TEXT,
      parent_phone TEXT,
      points INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      last_scan TIMESTAMP,
      status TEXT,
      last_status_time TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      student_nomor INTEGER,
      class_id INTEGER,
      message TEXT,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      provider TEXT,
      provider_link TEXT,
      error_message TEXT
    );
  `);
}

async function migrateTable(sqliteQuery, insertQuery, mapRow) {
  const rows = await runSqliteAll(sqliteQuery);
  for (const row of rows) {
    const params = mapRow(row);
    await pool.query(insertQuery, params);
  }
}

async function migrate() {
  console.log('Memulai migrasi SQLite → PostgreSQL...');
  await createPostgresSchema();

  console.log('Migrasi tabel classes...');
  await migrateTable(
    'SELECT * FROM classes',
    `INSERT INTO classes (id, name, created_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    (row) => [row.id, row.name, row.created_at]
  );

  console.log('Migrasi tabel students...');
  await migrateTable(
    'SELECT * FROM students',
    `INSERT INTO students (nomor_urut, name, class_id, phone, parent_phone, points, active, last_scan, status, last_status_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (nomor_urut) DO NOTHING`,
    (row) => [
      row.nomor_urut,
      row.name,
      row.class_id,
      row.phone,
      row.parent_phone,
      row.points,
      row.active,
      row.last_scan,
      row.status,
      row.last_status_time
    ]
  );

  console.log('Migrasi tabel notifications...');
  await migrateTable(
    'SELECT * FROM notifications',
    `INSERT INTO notifications (id, student_nomor, class_id, message, sent_at, provider, provider_link, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    (row) => [
      row.id,
      row.student_nomor,
      row.class_id,
      row.message,
      row.sent_at,
      row.provider,
      row.provider_link,
      row.error_message
    ]
  );

  console.log('Migrasi selesai. Tutup koneksi...');
  sqliteDb.close();
  await pool.end();
  console.log('Semua selesai. Data sudah dipindahkan ke PostgreSQL.');
}

migrate().catch((err) => {
  console.error('Migrasi gagal:', err);
  sqliteDb.close();
  pool.end().catch(() => {});
  process.exit(1);
});
