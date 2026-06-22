const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const config = require('./config');
const cronUtils = require('./cronUtils');

let db = null;
let SQL = null;
let dirty = false;

function saveDB() {
  if (!db || !dirty) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    const tmpPath = config.dbPath + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, config.dbPath);
    dirty = false;
  } catch (e) {
    console.error('[Storage] Save DB error:', e.message);
  }
}

setInterval(saveDB, 5000);

async function initDB() {
  SQL = await initSqlJs();

  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  if (fs.existsSync(config.dbPath)) {
    try {
      const buf = fs.readFileSync(config.dbPath);
      db = new SQL.Database(buf);
      console.log('[Storage] Loaded existing database');
    } catch (e) {
      console.warn('[Storage] Failed to load DB, creating new one:', e.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('http', 'https', 'tcp')),
      target TEXT NOT NULL,
      port INTEGER,
      method TEXT DEFAULT 'GET',
      expectedStatus INTEGER DEFAULT 200,
      interval_seconds INTEGER DEFAULT 30,
      timeout_ms INTEGER DEFAULT 5000,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  dirty = true;

  db.run(`
    CREATE TABLE IF NOT EXISTS check_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      success INTEGER NOT NULL,
      response_time_ms INTEGER,
      error_message TEXT,
      status_code INTEGER,
      is_maintenance INTEGER DEFAULT 0,
      maintenance_type TEXT,
      maintenance_window_id INTEGER,
      maintenance_schedule_id INTEGER
    )
  `);
  dirty = true;

  try {
    const cols = db.exec("PRAGMA table_info(check_results)");
    const colNames = cols[0] ? cols[0].values.map(c => c[1]) : [];
    if (!colNames.includes('maintenance_type')) {
      db.run("ALTER TABLE check_results ADD COLUMN maintenance_type TEXT");
      dirty = true;
    }
    if (!colNames.includes('maintenance_window_id')) {
      db.run("ALTER TABLE check_results ADD COLUMN maintenance_window_id INTEGER");
      dirty = true;
    }
    if (!colNames.includes('maintenance_schedule_id')) {
      db.run("ALTER TABLE check_results ADD COLUMN maintenance_schedule_id INTEGER");
      dirty = true;
    }
  } catch (e) {
    console.warn('[Storage] Failed to add maintenance columns to check_results:', e.message);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS maintenance_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      description TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  dirty = true;

  db.run(`
    CREATE TABLE IF NOT EXISTS maintenance_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      name TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      description TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  dirty = true;

  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_results_service_time ON check_results(service_id, timestamp)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_maintenance_time ON maintenance_windows(start_time, end_time)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_maint_sched_active ON maintenance_schedules(active)');
    dirty = true;
  } catch (e) {}

  await cleanupOldData();
  saveDB();
}

async function cleanupOldData() {
  const cutoff = moment().subtract(config.dataRetentionDays, 'days').toISOString();
  db.run('DELETE FROM check_results WHERE timestamp < ?', [cutoff]);
  dirty = true;
  saveDB();
}

function appendLog(serviceId, result) {
  try {
    const logFile = path.join(config.logDir, `service-${serviceId}-${moment().format('YYYY-MM-DD')}.log`);
    const line = JSON.stringify({
      ts: result.timestamp,
      success: result.success ? 1 : 0,
      rt: result.response_time_ms,
      msg: result.error_message || '',
      status: result.status_code || '',
      maint: result.is_maintenance ? 1 : 0
    }) + '\n';
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (e) {
    console.error('[Storage] Log append error:', e.message);
  }
}

function run(sql, params = []) {
  db.run(sql, params);
  dirty = true;
  return { lastID: db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0], changes: null };
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows.length ? rows[0] : undefined;
}

const services = {
  getAll: async () => query('SELECT * FROM services ORDER BY name'),
  getById: async (id) => queryOne('SELECT * FROM services WHERE id = ?', [id]),
  create: async (data) => {
    const payload = {
      method: 'GET',
      expectedStatus: 200,
      interval_seconds: config.defaultCheckIntervalSeconds,
      timeout_ms: config.defaultTimeoutMs,
      enabled: 1,
      port: null,
      ...data
    };
    const res = run(
      `INSERT INTO services (name, type, target, port, method, expectedStatus, interval_seconds, timeout_ms, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.name, payload.type, payload.target, payload.port, payload.method, payload.expectedStatus, payload.interval_seconds, payload.timeout_ms, payload.enabled]
    );
    saveDB();
    return queryOne('SELECT * FROM services WHERE id = ?', [res.lastID]);
  },
  update: async (id, data) => {
    const keys = Object.keys(data);
    if (keys.length === 0) return queryOne('SELECT * FROM services WHERE id = ?', [id]);
    const sets = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    run(`UPDATE services SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, id]);
    saveDB();
    return queryOne('SELECT * FROM services WHERE id = ?', [id]);
  },
  remove: async (id) => {
    run('DELETE FROM services WHERE id = ?', [id]);
    run('DELETE FROM check_results WHERE service_id = ?', [id]);
    run('DELETE FROM maintenance_windows WHERE service_id = ?', [id]);
    saveDB();
    return { changes: 1 };
  }
};

const checkResults = {
  insert: async (result) => {
    const res = run(
      `INSERT INTO check_results (service_id, timestamp, success, response_time_ms, error_message, status_code, is_maintenance, maintenance_type, maintenance_window_id, maintenance_schedule_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [result.service_id, result.timestamp, result.success, result.response_time_ms, result.error_message, result.status_code, result.is_maintenance, result.maintenance_type || null, result.maintenance_window_id || null, result.maintenance_schedule_id || null]
    );
    appendLog(result.service_id, result);
    if (process.memoryUsage().heapUsed > 512 * 1024 * 1024) saveDB();
    return res;
  },
  getLatest: async (serviceId, limit = 1) =>
    query('SELECT * FROM check_results WHERE service_id = ? ORDER BY timestamp DESC LIMIT ?', [serviceId, limit]),
  getByTimeRange: async (serviceId, from, to) =>
    query('SELECT * FROM check_results WHERE service_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC', [serviceId, from, to])
};

const maintenance = {
  getAll: async (serviceId = null) => {
    if (serviceId !== null && serviceId !== undefined) {
      return query('SELECT * FROM maintenance_windows WHERE service_id = ? ORDER BY start_time DESC', [serviceId]);
    }
    return query('SELECT * FROM maintenance_windows ORDER BY start_time DESC');
  },
  getActive: async (serviceId, time = new Date().toISOString()) =>
    query(`SELECT * FROM maintenance_windows WHERE (service_id = ? OR service_id IS NULL)
           AND active = 1 AND start_time <= ? AND end_time >= ?`, [serviceId, time, time]),
  create: async (data) => {
    const payload = { active: 1, description: '', service_id: null, ...data };
    const res = run(
      `INSERT INTO maintenance_windows (service_id, name, start_time, end_time, description, active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [payload.service_id, payload.name, payload.start_time, payload.end_time, payload.description, payload.active]
    );
    saveDB();
    return queryOne('SELECT * FROM maintenance_windows WHERE id = ?', [res.lastID]);
  },
  update: async (id, data) => {
    const keys = Object.keys(data);
    if (keys.length === 0) return queryOne('SELECT * FROM maintenance_windows WHERE id = ?', [id]);
    const sets = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    run(`UPDATE maintenance_windows SET ${sets} WHERE id = ?`, [...values, id]);
    saveDB();
    return queryOne('SELECT * FROM maintenance_windows WHERE id = ?', [id]);
  },
  remove: async (id) => {
    run('DELETE FROM maintenance_windows WHERE id = ?', [id]);
    saveDB();
    return { changes: 1 };
  }
};

const maintenanceSchedules = {
  getAll: async (serviceId = null) => {
    if (serviceId !== null && serviceId !== undefined) {
      return query('SELECT * FROM maintenance_schedules WHERE service_id = ? ORDER BY created_at DESC', [serviceId]);
    }
    return query('SELECT * FROM maintenance_schedules ORDER BY created_at DESC');
  },
  getById: async (id) => queryOne('SELECT * FROM maintenance_schedules WHERE id = ?', [id]),
  getActive: async (serviceId = null) => {
    if (serviceId !== null && serviceId !== undefined) {
      return query('SELECT * FROM maintenance_schedules WHERE (service_id = ? OR service_id IS NULL) AND active = 1', [serviceId]);
    }
    return query('SELECT * FROM maintenance_schedules WHERE active = 1');
  },
  create: async (data) => {
    const payload = { active: 1, description: '', service_id: null, ...data };

    const validation = cronUtils.validateCronExpression(payload.cron_expression);
    if (!validation.valid) {
      throw new Error(`Invalid cron expression: ${validation.error}`);
    }

    if (!payload.duration_minutes || payload.duration_minutes <= 0) {
      throw new Error('duration_minutes must be a positive integer');
    }

    const res = run(
      `INSERT INTO maintenance_schedules (service_id, name, cron_expression, duration_minutes, description, active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [payload.service_id, payload.name, payload.cron_expression, payload.duration_minutes, payload.description, payload.active]
    );
    saveDB();
    return queryOne('SELECT * FROM maintenance_schedules WHERE id = ?', [res.lastID]);
  },
  update: async (id, data) => {
    const keys = Object.keys(data);
    if (keys.length === 0) return queryOne('SELECT * FROM maintenance_schedules WHERE id = ?', [id]);

    if (data.cron_expression) {
      const validation = cronUtils.validateCronExpression(data.cron_expression);
      if (!validation.valid) {
        throw new Error(`Invalid cron expression: ${validation.error}`);
      }
    }

    if (data.duration_minutes && data.duration_minutes <= 0) {
      throw new Error('duration_minutes must be a positive integer');
    }

    const sets = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    run(`UPDATE maintenance_schedules SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, id]);
    saveDB();
    return queryOne('SELECT * FROM maintenance_schedules WHERE id = ?', [id]);
  },
  remove: async (id) => {
    run('DELETE FROM maintenance_schedules WHERE id = ?', [id]);
    saveDB();
    return { changes: 1 };
  },
  getActiveAtTime: async (serviceId, time = new Date()) => {
    const activeSchedules = await maintenanceSchedules.getActive(serviceId);
    const activeWindows = [];

    for (const schedule of activeSchedules) {
      try {
        const parsed = cronUtils.parseCronExpression(schedule.cron_expression);
        if (cronUtils.isTimeInMaintenanceWindow(parsed, schedule.duration_minutes, time)) {
          const start = cronUtils.findCurrentWindowStart(parsed, time);
          activeWindows.push({
            ...schedule,
            schedule_id: schedule.id,
            type: 'recurring',
            window_start: start ? start.toISOString() : null,
            window_end: start
              ? require('moment')(start).add(schedule.duration_minutes, 'minutes').toISOString()
              : null
          });
        }
      } catch (e) {
        console.error(`[Storage] Error checking schedule #${schedule.id}:`, e.message);
      }
    }

    return activeWindows;
  },
  getUpcomingWindows: async (serviceId, count = 10, fromDate = new Date()) => {
    const activeSchedules = await maintenanceSchedules.getActive(serviceId);
    const allWindows = [];

    for (const schedule of activeSchedules) {
      try {
        const parsed = cronUtils.parseCronExpression(schedule.cron_expression);
        const windows = cronUtils.getUpcomingMaintenanceWindows(parsed, schedule.duration_minutes, count, fromDate);
        for (const w of windows) {
          allWindows.push({
            schedule_id: schedule.id,
            schedule_name: schedule.name,
            service_id: schedule.service_id,
            description: schedule.description,
            type: 'recurring',
            start: w.start.toISOString(),
            end: w.end.toISOString()
          });
        }
      } catch (e) {
        console.error(`[Storage] Error getting upcoming windows for schedule #${schedule.id}:`, e.message);
      }
    }

    allWindows.sort((a, b) => new Date(a.start) - new Date(b.start));
    return allWindows.slice(0, count);
  }
};

const maintenanceCombined = {
  getActiveAtTime: async (serviceId, time = new Date()) => {
    const timeIso = time.toISOString ? time.toISOString() : time;
    const timeDate = time.toISOString ? time : new Date(time);

    const oneTime = await maintenance.getActive(serviceId, timeIso);
    const recurring = await maintenanceSchedules.getActiveAtTime(serviceId, timeDate);

    const oneTimeWindows = oneTime.map(w => ({
      ...w,
      type: 'one_time',
      schedule_id: null,
      window_start: w.start_time,
      window_end: w.end_time
    }));

    return [...oneTimeWindows, ...recurring];
  },
  isInMaintenance: async (serviceId, time = new Date()) => {
    const active = await maintenanceCombined.getActiveAtTime(serviceId, time);
    return {
      inMaintenance: active.length > 0,
      activeWindows: active,
      primaryWindow: active.find(w => w.type === 'one_time') || active[0] || null
    };
  }
};

process.on('beforeExit', saveDB);
process.on('SIGINT', () => { saveDB(); process.exit(0); });
process.on('SIGTERM', () => { saveDB(); process.exit(0); });

module.exports = {
  initDB,
  cleanupOldData,
  services,
  checkResults,
  maintenance,
  maintenanceSchedules,
  maintenanceCombined
};
