const cronUtils = require('./cronUtils');
let run, query, queryOne, saveDB;

function init(database) {
  run = database.run;
  query = database.query;
  queryOne = database.queryOne;
  saveDB = database.saveDB;
}

const maintenance = {
  create: async (data) => {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const result = run(
      `INSERT INTO maintenance_windows (name, service_id, start_time, end_time, description, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.name, data.service_id, data.start_time, data.end_time, data.description, data.active ? 1 : 0, now]
    );
    saveDB();
    return queryOne('SELECT * FROM maintenance_windows WHERE id = ?', [result.lastID]);
  },

  getById: async (id) => {
    return queryOne('SELECT * FROM maintenance_windows WHERE id = ?', [id]);
  },

  getAll: async (serviceId = null) => {
    if (serviceId !== null && serviceId !== undefined) {
      return query('SELECT * FROM maintenance_windows WHERE service_id = ? ORDER BY start_time DESC', [serviceId]);
    }
    return query('SELECT * FROM maintenance_windows ORDER BY start_time DESC');
  },

  getActive: async (serviceId, time = new Date()) => {
    const timeStr = typeof time === 'string' ? time : time.toISOString();
    const queryStr = serviceId
      ? `SELECT * FROM maintenance_windows WHERE (service_id = ? OR service_id IS NULL)
         AND active = 1 AND start_time <= ? AND end_time >= ?`
      : `SELECT * FROM maintenance_windows WHERE service_id IS NULL
         AND active = 1 AND start_time <= ? AND end_time >= ?`;
    const params = serviceId ? [serviceId, timeStr, timeStr] : [timeStr, timeStr];
    return query(queryStr, params);
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
  create: async (data) => {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const payload = { active: 1, description: '', service_id: null, ...data };

    const validation = cronUtils.validateCronExpression(payload.cron_expression);
    if (!validation.valid) {
      throw new Error(`Invalid cron expression: ${validation.error}`);
    }

    if (!payload.duration_minutes || payload.duration_minutes <= 0) {
      throw new Error('duration_minutes must be a positive integer');
    }

    const result = run(
      `INSERT INTO maintenance_schedules (name, service_id, cron_expression, duration_minutes, description, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.name, payload.service_id, payload.cron_expression, payload.duration_minutes, payload.description, payload.active, now, now]
    );
    saveDB();
    return queryOne('SELECT * FROM maintenance_schedules WHERE id = ?', [result.lastID]);
  },

  getById: async (id) => {
    return queryOne('SELECT * FROM maintenance_schedules WHERE id = ?', [id]);
  },

  getAll: async (serviceId = null) => {
    if (serviceId !== null && serviceId !== undefined) {
      return query('SELECT * FROM maintenance_schedules WHERE service_id = ? ORDER BY created_at DESC', [serviceId]);
    }
    return query('SELECT * FROM maintenance_schedules ORDER BY created_at DESC');
  },

  getActive: async (serviceId = null) => {
    if (serviceId !== null && serviceId !== undefined) {
      return query('SELECT * FROM maintenance_schedules WHERE (service_id = ? OR service_id IS NULL) AND active = 1', [serviceId]);
    }
    return query('SELECT * FROM maintenance_schedules WHERE active = 1');
  },

  update: async (id, data) => {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
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
    run(`UPDATE maintenance_schedules SET ${sets}, updated_at = ? WHERE id = ?`, [...values, now, id]);
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
          const start = cronUtils.findCurrentWindowStart(parsed, schedule.duration_minutes, time);
          activeWindows.push({
            ...schedule,
            schedule_id: schedule.id,
            type: 'recurring',
            window_start: start ? start.toISOString() : null,
            window_end: start
              ? require('moment').utc(start).add(schedule.duration_minutes, 'minutes').toISOString()
              : null
          });
        }
      } catch (e) {
        console.error(`[Maintenance] Error checking schedule #${schedule.id}:`, e.message);
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
        console.error(`[Maintenance] Error getting upcoming windows for schedule #${schedule.id}:`, e.message);
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

module.exports = {
  init,
  maintenance,
  maintenanceSchedules,
  maintenanceCombined
};
