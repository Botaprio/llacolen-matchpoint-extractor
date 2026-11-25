'use strict';

const { DatabaseSync } = require('node:sqlite');

class AppDatabase {
  constructor(filePath) {
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_from TEXT NOT NULL,
        date_to TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT NOT NULL,
        finished_at TEXT,
        processed_days INTEGER NOT NULL DEFAULT 0,
        processed_views INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0,
        attendee_count INTEGER NOT NULL DEFAULT 0,
        participant_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        matchpoint_event_id TEXT NOT NULL,
        event_date TEXT NOT NULL,
        activity_name TEXT NOT NULL,
        resource_id TEXT,
        resource_name TEXT,
        start_time TEXT,
        end_time TEXT,
        attendees INTEGER,
        capacity INTEGER,
        occupancy_pct REAL,
        attendance_status TEXT NOT NULL,
        raw_attendance_label TEXT,
        location TEXT,
        monitor_name TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, event_date, matchpoint_event_id)
      );

      CREATE TABLE IF NOT EXISTS event_views (
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        view_name TEXT NOT NULL,
        PRIMARY KEY(event_id, view_name)
      );

      CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        attendance_status TEXT,
        UNIQUE(event_id, full_name)
      );

      CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        event_date TEXT,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, event_id, code, message)
      );

      CREATE INDEX IF NOT EXISTS idx_events_run_date ON events(run_id, event_date);
      CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id);
      CREATE INDEX IF NOT EXISTS idx_warnings_run ON warnings(run_id);

      CREATE TABLE IF NOT EXISTS run_days (
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        event_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        worker_id INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        processed_views INTEGER NOT NULL DEFAULT 0,
        expected_views INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        PRIMARY KEY(run_id, event_date)
      );
    `);
    const columns = this.db.prepare('PRAGMA table_info(runs)').all().map((column) => column.name);
    if (!columns.includes('extraction_mode')) {
      this.db.exec("ALTER TABLE runs ADD COLUMN extraction_mode TEXT NOT NULL DEFAULT 'complete'");
    }
    if (!columns.includes('attendee_count')) {
      this.db.exec('ALTER TABLE runs ADD COLUMN attendee_count INTEGER NOT NULL DEFAULT 0');
    }
    if (!columns.includes('concurrency')) {
      this.db.exec('ALTER TABLE runs ADD COLUMN concurrency INTEGER NOT NULL DEFAULT 1');
    }
    const eventColumns = this.db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
    if (!eventColumns.includes('detail_status')) {
      // No se inventa una lectura completa para eventos de versiones anteriores.
      this.db.exec("ALTER TABLE events ADD COLUMN detail_status TEXT NOT NULL DEFAULT 'unknown'");
    }
    this.db.exec(`
      UPDATE runs
      SET attendee_count = COALESCE((
        SELECT SUM(COALESCE(events.attendees, 0))
        FROM events
        WHERE events.run_id = runs.id
      ), 0)
      WHERE attendee_count = 0
    `);
  }

  createRun(dateFrom, dateTo, extractionMode = 'complete') {
    const result = this.db.prepare(`
      INSERT INTO runs (date_from, date_to, extraction_mode, status, started_at)
      VALUES (?, ?, ?, 'running', ?)
    `).run(dateFrom, dateTo, extractionMode, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  completeRun(runId, status, counters, errorMessage = null) {
    this.db.prepare(`
      UPDATE runs SET
        status = ?, finished_at = ?, processed_days = ?, processed_views = ?,
        event_count = ?, attendee_count = ?, participant_count = ?, warning_count = ?, error_message = ?
      WHERE id = ?
    `).run(
      status,
      new Date().toISOString(),
      counters.processedDays || 0,
      counters.processedViews || 0,
      counters.eventCount || 0,
      counters.attendeeCount || 0,
      counters.participantCount || 0,
      counters.warningCount || 0,
      errorMessage,
      runId
    );
  }

  upsertEvent(runId, event) {
    this.db.prepare(`
      INSERT INTO events (
        run_id, matchpoint_event_id, event_date, activity_name, resource_id,
        start_time, end_time, attendees, capacity, occupancy_pct,
        attendance_status, raw_attendance_label, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(run_id, event_date, matchpoint_event_id) DO UPDATE SET
        activity_name = excluded.activity_name,
        resource_id = COALESCE(excluded.resource_id, events.resource_id),
        start_time = COALESCE(excluded.start_time, events.start_time),
        end_time = COALESCE(excluded.end_time, events.end_time),
        attendees = COALESCE(excluded.attendees, events.attendees),
        capacity = COALESCE(excluded.capacity, events.capacity),
        occupancy_pct = COALESCE(excluded.occupancy_pct, events.occupancy_pct),
        attendance_status = excluded.attendance_status,
        raw_attendance_label = excluded.raw_attendance_label
    `).run(
      runId,
      event.matchpointEventId,
      event.eventDate,
      event.activityName,
      event.resourceId,
      event.startTime,
      event.endTime,
      event.attendees,
      event.capacity,
      event.occupancyPct,
      event.attendanceStatus,
      event.rawAttendanceLabel,
      new Date().toISOString()
    );

    return this.db.prepare(`
      SELECT id FROM events
      WHERE run_id = ? AND event_date = ? AND matchpoint_event_id = ?
    `).get(runId, event.eventDate, event.matchpointEventId).id;
  }

  addEventView(eventId, viewName) {
    this.db.prepare(`
      INSERT OR IGNORE INTO event_views (event_id, view_name) VALUES (?, ?)
    `).run(eventId, viewName);
  }

  updateEventDetails(eventId, details) {
    this.db.prepare(`
      UPDATE events SET
        resource_name = COALESCE(?, resource_name),
        location = COALESCE(?, location),
        monitor_name = COALESCE(?, monitor_name)
      WHERE id = ?
    `).run(details.resourceName, details.location, details.monitor, eventId);
  }

  replaceParticipants(eventId, participants) {
    this.db.exec('BEGIN;');
    try {
      this.db.prepare('DELETE FROM participants WHERE event_id = ?').run(eventId);
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO participants (event_id, full_name, attendance_status)
        VALUES (?, ?, ?)
      `);
      for (const person of participants) {
        insert.run(eventId, person.fullName, person.attendanceStatus || null);
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  addWarning(runId, eventId, eventDate, warning) {
    this.db.prepare(`
      INSERT OR IGNORE INTO warnings (run_id, event_id, event_date, code, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runId, eventId || null, eventDate || null, warning.code, warning.message, new Date().toISOString());
  }

  setDetailStatus(eventId, status) {
    this.db.prepare('UPDATE events SET detail_status = ? WHERE id = ?').run(status, eventId);
  }

  initializeDays(runId, dates, concurrency) {
    this.db.prepare('UPDATE runs SET concurrency = ? WHERE id = ?').run(concurrency, runId);
    const insert = this.db.prepare('INSERT OR IGNORE INTO run_days (run_id, event_date) VALUES (?, ?)');
    for (const date of dates) insert.run(runId, date);
  }

  startDay(runId, date, workerId) {
    this.db.exec('BEGIN');
    try {
      // Reintentar reemplaza únicamente el día fallido y conserva los demás.
      this.db.prepare('DELETE FROM warnings WHERE run_id = ? AND event_date = ?').run(runId, date);
      this.db.prepare('DELETE FROM events WHERE run_id = ? AND event_date = ?').run(runId, date);
      this.db.prepare(`UPDATE run_days SET status = 'running', worker_id = ?, attempts = attempts + 1,
        processed_views = 0, expected_views = 0, error_message = NULL WHERE run_id = ? AND event_date = ?`)
        .run(workerId, runId, date);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  updateDay(runId, date, { status = 'running', processedViews = 0, expectedViews = 0, errorMessage = null }) {
    this.db.prepare(`UPDATE run_days SET status = ?, processed_views = ?, expected_views = ?,
      error_message = ? WHERE run_id = ? AND event_date = ?`)
      .run(status, processedViews, expectedViews, errorMessage, runId, date);
  }

  getDays(runId) {
    return this.db.prepare('SELECT * FROM run_days WHERE run_id = ? ORDER BY event_date').all(runId);
  }

  getRunCounters(runId) {
    const counts = this.db.prepare(`SELECT COUNT(*) AS eventCount, COALESCE(SUM(attendees), 0) AS attendeeCount
      FROM events WHERE run_id = ?`).get(runId);
    const days = this.db.prepare(`SELECT COALESCE(SUM(status = 'completed'), 0) AS processedDays,
      COALESCE(SUM(processed_views), 0) AS processedViews FROM run_days WHERE run_id = ?`).get(runId);
    const participants = this.db.prepare(`SELECT COUNT(*) AS n FROM participants p JOIN events e ON e.id = p.event_id
      WHERE e.run_id = ?`).get(runId).n;
    const warnings = this.db.prepare('SELECT COUNT(*) AS n FROM warnings WHERE run_id = ?').get(runId).n;
    return { ...counts, ...days, participantCount: participants, warningCount: warnings };
  }

  saveProgress(runId) {
    const c = this.getRunCounters(runId);
    this.db.prepare(`UPDATE runs SET processed_days = ?, processed_views = ?, event_count = ?,
      attendee_count = ?, participant_count = ?, warning_count = ? WHERE id = ?`)
      .run(c.processedDays, c.processedViews, c.eventCount, c.attendeeCount, c.participantCount, c.warningCount, runId);
    return c;
  }

  recoverInterruptedRuns() {
    for (const run of this.db.prepare("SELECT id FROM runs WHERE status = 'running'").all()) {
      this.db.prepare("UPDATE run_days SET status = 'cancelled' WHERE run_id = ? AND status IN ('pending', 'running')").run(run.id);
      this.completeRun(run.id, 'cancelled', this.saveProgress(run.id), 'La aplicación se cerró antes de completar la extracción.');
    }
  }

  listRuns(limit = 20) {
    return this.db.prepare(`
      SELECT * FROM runs ORDER BY id DESC LIMIT ?
    `).all(limit);
  }

  getRun(runId) {
    return this.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  }

  deleteRun(runId) {
    return this.db.prepare('DELETE FROM runs WHERE id = ?').run(runId).changes > 0;
  }

  deleteAllRuns() {
    return Number(this.db.prepare('DELETE FROM runs').run().changes || 0);
  }

  getRunData(runId) {
    const summary = this.db.prepare(`
      SELECT
        event_date,
        COUNT(*) AS event_count,
        COALESCE(SUM(attendees), 0) AS attendee_count,
        COALESCE(SUM(CASE WHEN capacity > 0 THEN capacity ELSE 0 END), 0) AS capacity,
        CASE
          WHEN SUM(CASE WHEN capacity > 0 THEN capacity ELSE 0 END) > 0
          THEN ROUND(100.0 * SUM(COALESCE(attendees, 0)) /
            SUM(CASE WHEN capacity > 0 THEN capacity ELSE 0 END), 2)
          ELSE NULL
        END AS occupancy_pct
      FROM events
      WHERE run_id = ?
      GROUP BY event_date
      ORDER BY event_date
    `).all(runId);

    // El cuadro proviene exclusivamente de una opción del selector de
    // MatchPoint, registrada en event_views. No se infiere desde la actividad.
    const summaryByView = this.db.prepare(`
      SELECT
        e.event_date,
        ev.view_name,
        COUNT(DISTINCT e.id) AS event_count,
        COALESCE(SUM(e.attendees), 0) AS attendee_count,
        COALESCE(SUM(CASE WHEN e.capacity > 0 THEN e.capacity ELSE 0 END), 0) AS capacity,
        CASE
          WHEN SUM(CASE WHEN e.capacity > 0 THEN e.capacity ELSE 0 END) > 0
          THEN ROUND(100.0 * SUM(COALESCE(e.attendees, 0)) /
            SUM(CASE WHEN e.capacity > 0 THEN e.capacity ELSE 0 END), 2)
          ELSE NULL
        END AS occupancy_pct
      FROM events e
      JOIN event_views ev ON ev.event_id = e.id
      WHERE e.run_id = ?
      GROUP BY e.event_date, ev.view_name
      ORDER BY e.event_date, ev.view_name
    `).all(runId);

    const events = this.db.prepare(`
      SELECT
        e.*,
        COALESCE(GROUP_CONCAT(ev.view_name, ' | '), '') AS view_names
      FROM events e
      LEFT JOIN event_views ev ON ev.event_id = e.id
      WHERE e.run_id = ?
      GROUP BY e.id
      ORDER BY e.event_date, e.start_time, e.activity_name
    `).all(runId);

    const participants = this.db.prepare(`
      SELECT
        e.id AS event_id, e.event_date, e.matchpoint_event_id, e.activity_name, e.start_time,
        e.end_time, p.full_name, p.attendance_status,
        COALESCE((
          SELECT GROUP_CONCAT(view_name, ' | ')
          FROM event_views
          WHERE event_id = e.id
        ), '') AS view_names
      FROM participants p
      JOIN events e ON e.id = p.event_id
      WHERE e.run_id = ?
      ORDER BY e.event_date, e.start_time, e.activity_name, p.full_name
    `).all(runId);

    const warnings = this.db.prepare(`
      SELECT
        w.*, e.matchpoint_event_id, e.activity_name,
        COALESCE((
          SELECT GROUP_CONCAT(view_name, ' | ')
          FROM event_views
          WHERE event_id = e.id
        ), '') AS view_names
      FROM warnings w
      LEFT JOIN events e ON e.id = w.event_id
      WHERE w.run_id = ?
      ORDER BY w.event_date, w.id
    `).all(runId);

    return { run: this.getRun(runId), summary, summaryByView, events, participants, warnings, days: this.getDays(runId) };
  }

  getAnalysis(runId, selectedActivities = []) {
    const run = this.getRun(runId);
    if (!run) throw new Error('No se encontró la extracción.');
    const names = Array.isArray(selectedActivities) ? selectedActivities.filter(Boolean) : [];
    const filter = names.length ? ` AND activity_name IN (${names.map(() => '?').join(', ')})` : '';
    const activities = this.db.prepare(`
      SELECT activity_name, COUNT(*) AS events, COALESCE(SUM(attendees), 0) AS attendees,
        COALESCE(SUM(CASE WHEN capacity > 0 THEN capacity ELSE 0 END), 0) AS capacity,
        CASE WHEN SUM(CASE WHEN capacity > 0 THEN capacity ELSE 0 END) > 0
          THEN ROUND(100.0 * SUM(COALESCE(attendees, 0)) / SUM(CASE WHEN capacity > 0 THEN capacity ELSE 0 END), 2)
          ELSE 0 END AS occupancy_pct
      FROM events WHERE run_id = ?${filter}
      GROUP BY activity_name ORDER BY attendees DESC, activity_name
    `).all(runId, ...names);
    const totals = activities.reduce((result, item) => ({
      events: result.events + item.events,
      attendees: result.attendees + item.attendees,
      capacity: result.capacity + item.capacity
    }), { events: 0, attendees: 0, capacity: 0 });
    totals.occupancyPct = totals.capacity ? 100 * totals.attendees / totals.capacity : 0;
    return { run, label: `${run.date_from} al ${run.date_to}`, totals, activities };
  }

  close() {
    this.db.close();
  }
}

module.exports = { AppDatabase };
