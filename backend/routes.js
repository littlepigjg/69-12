const express = require('express');
const router = express.Router();
const storage = require('./storage');
const status = require('./status');
const scheduler = require('./scheduler');
const notifier = require('./notifier');
const cronUtils = require('./cronUtils');
const moment = require('moment');

router.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

router.get('/services', async (req, res) => {
  try {
    const services = await storage.services.getAll();
    const enriched = [];
    for (const svc of services) {
      enriched.push({
        ...svc,
        summary: await status.getServiceSummary(svc.id)
      });
    }
    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/:id', async (req, res) => {
  try {
    const svc = await storage.services.getById(req.params.id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    res.json({
      ...svc,
      summary: await status.getServiceSummary(svc.id)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/services', async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.name || !data.type || !data.target) {
      return res.status(400).json({ error: 'name, type, target are required' });
    }
    if (!['http', 'https', 'tcp'].includes(data.type)) {
      return res.status(400).json({ error: 'type must be http, https, or tcp' });
    }
    if (data.type === 'tcp' && !data.port && !data.target.includes(':')) {
      return res.status(400).json({ error: 'tcp type requires port' });
    }
    const created = await storage.services.create(data);
    if (created.enabled) {
      scheduler.startServiceCheck(created);
    }
    notifier.notifyServiceUpdate(created.id, created);
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.put('/services/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await storage.services.getById(id);
    if (!existing) return res.status(404).json({ error: 'Service not found' });

    const data = req.body || {};
    const allowed = ['name', 'type', 'target', 'port', 'method', 'expectedStatus', 'interval_seconds', 'timeout_ms', 'enabled'];
    const toUpdate = {};
    for (const key of allowed) {
      if (key in data) toUpdate[key] = data[key];
    }

    const updated = await storage.services.update(id, toUpdate);
    scheduler.restartServiceCheck(updated);
    notifier.notifyServiceUpdate(updated.id, updated);
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/services/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await storage.services.getById(id);
    if (!existing) return res.status(404).json({ error: 'Service not found' });
    scheduler.stopServiceCheck(id);
    await storage.services.remove(id);
    notifier.broadcast({ type: 'service_deleted', serviceId: id, timestamp: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/services/:id/check', async (req, res) => {
  try {
    const id = req.params.id;
    const svc = await storage.services.getById(id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    scheduler.runCheck(svc);
    res.json({ ok: true, message: 'Check triggered' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/:id/trend', async (req, res) => {
  try {
    const id = req.params.id;
    const hours = parseInt(req.query.hours, 10) || 24;
    const svc = await storage.services.getById(id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    const data = await status.getTrendData(id, hours);
    res.json({ serviceId: id, hours, data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/:id/results', async (req, res) => {
  try {
    const id = req.params.id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const svc = await storage.services.getById(id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    const results = await storage.checkResults.getLatest(id, limit);
    res.json({ serviceId: id, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/maintenance', async (req, res) => {
  try {
    res.json(await storage.maintenance.getAll());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/:id/maintenance', async (req, res) => {
  try {
    const id = req.params.id;
    res.json(await storage.maintenance.getAll(id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/maintenance', async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.name || !data.start_time || !data.end_time) {
      return res.status(400).json({ error: 'name, start_time, end_time are required' });
    }
    const created = await storage.maintenance.create(data);
    notifier.notifyMaintenanceChange(data.service_id || null, created);
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.put('/maintenance/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body || {};
    const allowed = ['name', 'start_time', 'end_time', 'description', 'active', 'service_id'];
    const toUpdate = {};
    for (const key of allowed) {
      if (key in data) toUpdate[key] = data[key];
    }
    const updated = await storage.maintenance.update(id, toUpdate);
    notifier.notifyMaintenanceChange(updated.service_id, updated);
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/maintenance/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await storage.maintenance.remove(id);
    notifier.notifyMaintenanceChange(null, { id, deleted: true });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/maintenance/quick', async (req, res) => {
  try {
    const { service_id, minutes = 60, name, description } = req.body || {};
    if (!service_id) return res.status(400).json({ error: 'service_id is required' });
    const svc = await storage.services.getById(service_id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });

    const now = new Date();
    const end = new Date(now.getTime() + minutes * 60 * 1000);
    const data = {
      service_id,
      name: name || `临时维护 - ${svc.name}`,
      description: description || `手动设置的维护窗口，时长${minutes}分钟`,
      start_time: now.toISOString(),
      end_time: end.toISOString(),
      active: 1
    };
    const created = await storage.maintenance.create(data);
    notifier.notifyMaintenanceChange(service_id, created);
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/maintenance/schedules', async (req, res) => {
  try {
    const schedules = await storage.maintenanceSchedules.getAll();
    res.json(schedules);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/:id/maintenance/schedules', async (req, res) => {
  try {
    const id = req.params.id;
    const svc = await storage.services.getById(id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    const schedules = await storage.maintenanceSchedules.getAll(id);
    res.json(schedules);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/maintenance/schedules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const schedule = await storage.maintenanceSchedules.getById(id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    res.json(schedule);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/maintenance/schedules', async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.name || !data.cron_expression || !data.duration_minutes) {
      return res.status(400).json({ error: 'name, cron_expression, duration_minutes are required' });
    }
    const created = await storage.maintenanceSchedules.create(data);
    notifier.notifyMaintenanceChange(data.service_id || null, { ...created, type: 'schedule', changeType: 'created' });
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

router.put('/maintenance/schedules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await storage.maintenanceSchedules.getById(id);
    if (!existing) return res.status(404).json({ error: 'Schedule not found' });

    const data = req.body || {};
    const allowed = ['name', 'cron_expression', 'duration_minutes', 'description', 'active', 'service_id'];
    const toUpdate = {};
    for (const key of allowed) {
      if (key in data) toUpdate[key] = data[key];
    }

    const updated = await storage.maintenanceSchedules.update(id, toUpdate);
    notifier.notifyMaintenanceChange(updated.service_id, { ...updated, type: 'schedule', changeType: 'updated' });
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

router.delete('/maintenance/schedules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await storage.maintenanceSchedules.getById(id);
    if (!existing) return res.status(404).json({ error: 'Schedule not found' });

    await storage.maintenanceSchedules.remove(id);
    notifier.notifyMaintenanceChange(existing.service_id, { id, type: 'schedule', deleted: true });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/maintenance/schedules/:id/preview', async (req, res) => {
  try {
    const id = req.params.id;
    const count = Math.min(parseInt(req.query.count, 10) || 5, 20);
    const schedule = await storage.maintenanceSchedules.getById(id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

    const parsed = cronUtils.parseCronExpression(schedule.cron_expression);
    const upcoming = cronUtils.getUpcomingMaintenanceWindows(parsed, schedule.duration_minutes, count);
    res.json({
      scheduleId: id,
      count: upcoming.length,
      windows: upcoming.map(w => ({
        start: w.start.toISOString(),
        end: w.end.toISOString()
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/maintenance/cron/validate', async (req, res) => {
  try {
    const expression = req.query.expression || '';
    const result = cronUtils.validateCronExpression(expression);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/maintenance/cron/preview', async (req, res) => {
  try {
    const { expression, duration_minutes = 60, count = 5 } = req.body || {};
    const expressionQuery = req.query.expression;
    const cronExpr = expression || expressionQuery;

    if (!cronExpr) {
      return res.status(400).json({ error: 'expression is required' });
    }

    const validation = cronUtils.validateCronExpression(cronExpr);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const parsed = cronUtils.parseCronExpression(cronExpr);
    const countNum = Math.min(count || 5, 20);
    const upcoming = cronUtils.getUpcomingMaintenanceWindows(parsed, duration_minutes, countNum);
    const nextTimes = cronUtils.getNextNCronTimes(parsed, countNum);

    res.json({
      valid: true,
      expression: cronExpr,
      duration_minutes: duration_minutes,
      next_executions: nextTimes.map(t => t.toISOString()),
      windows: upcoming.map(w => ({
        start: w.start.toISOString(),
        end: w.end.toISOString()
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

router.get('/maintenance/upcoming', async (req, res) => {
  try {
    const serviceId = req.query.service_id || null;
    const count = Math.min(parseInt(req.query.count, 10) || 10, 30);

    const oneTimeWindows = await storage.maintenance.getAll(serviceId);
    const now = moment();

    const upcomingOneTime = oneTimeWindows
      .filter(w => w.active && moment(w.end_time) > now)
      .map(w => ({
        id: w.id,
        name: w.name,
        description: w.description,
        service_id: w.service_id,
        type: 'one_time',
        start: w.start_time,
        end: w.end_time
      }));

    const upcomingRecurring = await storage.maintenanceSchedules.getUpcomingWindows(serviceId, count);

    const all = [...upcomingOneTime, ...upcomingRecurring]
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .slice(0, count);

    res.json({ count: all.length, windows: all });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/status/summary', async (req, res) => {
  try {
    const services = await storage.services.getAll();
    let up = 0, down = 0, maintenance = 0, unknown = 0;
    const summaries = [];
    for (const svc of services) {
      const s = await status.getServiceSummary(svc.id);
      if (s.status === 'up') up++;
      else if (s.status === 'down') down++;
      else if (s.status === 'maintenance') maintenance++;
      else unknown++;
      summaries.push({ serviceId: svc.id, name: svc.name, type: svc.type, ...s });
    }

    res.json({
      total: services.length,
      counts: { up, down, maintenance, unknown },
      services: summaries
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
