const moment = require('moment');

const CRON_FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 6 }
];

const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

const DAY_NAMES = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
};

function parseCronField(field, fieldDef) {
  if (field === '*') {
    return { type: 'all', values: [] };
  }

  const values = new Set();
  const parts = field.split(',');

  for (const part of parts) {
    if (part.includes('/')) {
      const [rangePart, stepPart] = part.split('/');
      const step = parseInt(stepPart, 10);

      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value: ${stepPart}`);
      }

      let start, end;
      if (rangePart === '*') {
        start = fieldDef.min;
        end = fieldDef.max;
      } else if (rangePart.includes('-')) {
        const [s, e] = rangePart.split('-');
        start = parseValue(s, fieldDef.name);
        end = parseValue(e, fieldDef.name);
      } else {
        start = parseValue(rangePart, fieldDef.name);
        end = fieldDef.max;
      }

      validateValue(start, fieldDef);
      validateValue(end, fieldDef);

      for (let v = start; v <= end; v += step) {
        values.add(v);
      }
    } else if (part.includes('-')) {
      const [start, end] = part.split('-');
      const s = parseValue(start, fieldDef.name);
      const e = parseValue(end, fieldDef.name);
      validateValue(s, fieldDef);
      validateValue(e, fieldDef);

      for (let v = s; v <= e; v++) {
        values.add(v);
      }
    } else {
      const v = parseValue(part, fieldDef.name);
      validateValue(v, fieldDef);
      values.add(v);
    }
  }

  return { type: 'list', values: [...values].sort((a, b) => a - b) };
}

function parseValue(value, fieldName) {
  const lower = String(value).toLowerCase().trim();

  if (fieldName === 'month' && MONTH_NAMES[lower] !== undefined) {
    return MONTH_NAMES[lower];
  }
  if (fieldName === 'dayOfWeek' && DAY_NAMES[lower] !== undefined) {
    return DAY_NAMES[lower];
  }

  const num = parseInt(lower, 10);
  if (isNaN(num)) {
    throw new Error(`Invalid value: ${value}`);
  }
  return num;
}

function validateValue(value, fieldDef) {
  if (value < fieldDef.min || value > fieldDef.max) {
    throw new Error(
      `Value ${value} out of range for ${fieldDef.name} (${fieldDef.min}-${fieldDef.max})`
    );
  }
}

function parseCronExpression(expression) {
  const parts = expression.trim().split(/\s+/);

  if (parts.length !== 5) {
    throw new Error('Cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week)');
  }

  const parsed = {};
  for (let i = 0; i < CRON_FIELDS.length; i++) {
    parsed[CRON_FIELDS[i].name] = parseCronField(parts[i], CRON_FIELDS[i]);
  }

  parsed.expression = expression;
  return parsed;
}

function matchesField(value, field) {
  if (field.type === 'all') return true;
  return field.values.includes(value);
}

function getNextMatch(current, field, direction = 1) {
  if (field.type === 'all') {
    return current + direction;
  }

  const values = field.values;

  if (direction > 0) {
    for (const v of values) {
      if (v > current) return v;
    }
    return values[0];
  } else {
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] < current) return values[i];
    }
    return values[values.length - 1];
  }
}

function getNextCronTime(parsedCron, fromDate = new Date()) {
  const dt = moment.utc(fromDate).startOf('minute').add(1, 'minute');

  const maxIterations = 366 * 24 * 60;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const minute = dt.minute();
    const hour = dt.hour();
    const dayOfMonth = dt.date();
    const month = dt.month() + 1;
    const dayOfWeek = dt.day();

    if (!matchesField(month, parsedCron.month)) {
      if (parsedCron.month.type === 'list') {
        const nextMonth = getNextMatch(month, parsedCron.month, 1);
        if (nextMonth <= month) {
          dt.add(1, 'year');
        }
        dt.month(nextMonth - 1).date(1).hour(0).minute(0).second(0);
        continue;
      }
      dt.add(1, 'month').date(1).hour(0).minute(0).second(0);
      continue;
    }

    if (!matchesField(dayOfMonth, parsedCron.dayOfMonth) ||
        !matchesField(dayOfWeek, parsedCron.dayOfWeek)) {
      dt.add(1, 'day').hour(0).minute(0).second(0);
      continue;
    }

    if (!matchesField(hour, parsedCron.hour)) {
      const nextHour = getNextMatch(hour, parsedCron.hour, 1);
      if (nextHour <= hour) {
        dt.add(1, 'day');
      }
      dt.hour(nextHour).minute(0).second(0);
      continue;
    }

    if (!matchesField(minute, parsedCron.minute)) {
      const nextMinute = getNextMatch(minute, parsedCron.minute, 1);
      if (nextMinute <= minute) {
        dt.add(1, 'hour');
      }
      dt.minute(nextMinute).second(0);
      continue;
    }

    return dt.toDate();
  }

  throw new Error('Could not find next cron time within 366 days');
}

function getNextNCronTimes(parsedCron, n = 5, fromDate = new Date()) {
  const times = [];
  let current = fromDate;

  for (let i = 0; i < n; i++) {
    const next = getNextCronTime(parsedCron, current);
    times.push(next);
    current = next;
  }

  return times;
}

function isTimeInMaintenanceWindow(parsedCron, durationMinutes, time = new Date()) {
  const t = moment.utc(time);
  const start = findCurrentWindowStart(parsedCron, durationMinutes, t.toDate());

  if (!start) return false;

  const end = moment.utc(start).add(durationMinutes, 'minutes');
  return t.isSameOrAfter(start) && t.isBefore(end);
}

function findCurrentWindowStart(parsedCron, durationMinutes, time = new Date()) {
  const t = moment.utc(time);

  let lastCronTime = null;
  let searchTime = moment.utc(t).subtract(7, 'days');

  for (let i = 0; i < 100; i++) {
    try {
      const nextCron = getNextCronTime(parsedCron, searchTime.toDate());
      const nextMoment = moment.utc(nextCron);

      if (nextMoment.isAfter(t)) {
        break;
      }

      lastCronTime = nextMoment;
      searchTime = nextMoment;
    } catch (e) {
      break;
    }
  }

  if (lastCronTime) {
    const windowEnd = lastCronTime.clone().add(durationMinutes, 'minutes');
    if (windowEnd.isAfter(t)) {
      return lastCronTime.toDate();
    }
  }

  return null;
}

function getUpcomingMaintenanceWindows(parsedCron, durationMinutes, count = 10, fromDate = new Date()) {
  const starts = getNextNCronTimes(parsedCron, count, fromDate);
  return starts.map(start => ({
    start: start,
    end: moment.utc(start).add(durationMinutes, 'minutes').toDate()
  }));
}

function validateCronExpression(expression) {
  try {
    parseCronExpression(expression);
    return { valid: true, error: null };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

module.exports = {
  parseCronExpression,
  getNextCronTime,
  getNextNCronTimes,
  isTimeInMaintenanceWindow,
  findCurrentWindowStart,
  getUpcomingMaintenanceWindows,
  validateCronExpression,
  CRON_FIELDS
};
