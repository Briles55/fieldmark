'use strict';

const express    = require('express');
const session    = require('express-session');
const bcrypt     = require('bcrypt');
const Database   = require('better-sqlite3');
const nodemailer = require('nodemailer');
const path       = require('path');
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'fieldmark-dev-secret-change-me';

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'fieldmark.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'technician',
    passwordHash TEXT NOT NULL,
    createdAt   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS clients (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    phone     TEXT,
    email     TEXT,
    address   TEXT,
    city      TEXT,
    state     TEXT,
    notes     TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS locations (
    id           TEXT PRIMARY KEY,
    clientId     TEXT NOT NULL,
    buildingName TEXT NOT NULL,
    address      TEXT,
    city         TEXT,
    state        TEXT,
    zip          TEXT,
    contactName  TEXT,
    contactPhone TEXT,
    notes        TEXT,
    createdAt    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS equipment (
    id            TEXT PRIMARY KEY,
    locationId    TEXT NOT NULL,
    name          TEXT NOT NULL,
    model         TEXT,
    serial        TEXT,
    yearInstalled INTEGER,
    type          TEXT,
    notes         TEXT,
    createdAt     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reports (
    id                TEXT PRIMARY KEY,
    equipmentId       TEXT NOT NULL,
    type              TEXT NOT NULL,
    techName          TEXT,
    date              TEXT,
    status            TEXT,
    workPerformed     TEXT,
    cause             TEXT,
    parts             TEXT,
    recommendations   TEXT,
    nextDate          TEXT,
    checklist         TEXT,
    refrigerantType   TEXT,
    suctionPressure   TEXT,
    dischargePressure TEXT,
    supplyTemp        TEXT,
    returnTemp        TEXT,
    createdAt         TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS form_templates (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    fields    TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS service_requests (
    id          TEXT PRIMARY KEY,
    clientId    TEXT NOT NULL,
    locationId  TEXT NOT NULL,
    equipmentId TEXT DEFAULT '',
    urgency     TEXT NOT NULL,
    description TEXT NOT NULL,
    photos      TEXT DEFAULT '[]',
    status      TEXT DEFAULT 'New',
    notes       TEXT DEFAULT '',
    createdAt   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS work_orders (
    id               TEXT PRIMARY KEY,
    woNumber         TEXT UNIQUE NOT NULL,
    clientId         TEXT NOT NULL,
    locationId       TEXT NOT NULL,
    equipmentId      TEXT DEFAULT '',
    description      TEXT DEFAULT '',
    status           TEXT DEFAULT 'Open',
    priority         TEXT DEFAULT 'Normal',
    assignedTo       TEXT DEFAULT '',
    serviceRequestId TEXT DEFAULT '',
    laborEntries     TEXT DEFAULT '[]',
    notes            TEXT DEFAULT '',
    createdAt        TEXT NOT NULL,
    updatedAt        TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS time_cards (
    id         TEXT PRIMARY KEY,
    userId     TEXT NOT NULL,
    weekStart  TEXT NOT NULL,
    status     TEXT DEFAULT 'Draft',
    submittedAt TEXT DEFAULT '',
    approvedAt  TEXT DEFAULT '',
    approvedBy  TEXT DEFAULT '',
    createdAt   TEXT NOT NULL,
    UNIQUE(userId, weekStart)
  );
`);

// ─── MIGRATIONS ──────────────────────────────────────────────────────────────
try { db.exec("ALTER TABLE clients ADD COLUMN passwordHash TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE equipment ADD COLUMN formTemplateId TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE reports ADD COLUMN photoBefore TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE reports ADD COLUMN photoAfter TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE reports ADD COLUMN photoNameplate TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE reports ADD COLUMN workOrderNumber TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN logo TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE equipment ADD COLUMN photo TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN billingContact TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN billingEmail TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN billingPhone TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN billingAddress TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN paymentTerms TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN poRequired TEXT DEFAULT 'No'"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN taxId TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN creditLimit TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN accountNumber TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN defaultRate TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN arNotes TEXT DEFAULT ''"); } catch(e) {}

// Seed default admin if no users exist
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('fieldmark', 10);
  const id   = genId();
  db.prepare('INSERT INTO users (id,username,name,role,passwordHash,createdAt) VALUES (?,?,?,?,?,?)')
    .run(id, 'admin', 'Administrator', 'admin', hash, new Date().toISOString());
  console.log('Seeded default admin — username: admin  password: fieldmark');
}

// Seed default form templates if none exist
const templateCount = db.prepare('SELECT COUNT(*) as c FROM form_templates').get().c;
if (templateCount === 0) {
  const now = new Date().toISOString();
  const defaultTemplates = [
    {
      id: 'tpl_hvac_maintenance',
      name: 'HVAC Maintenance Checklist',
      fields: [
        { id: 'f_filter', type: 'checkbox', label: 'Filter Replacement', required: false },
        { id: 'f_belt', type: 'checkbox', label: 'Belt Inspection/Adjustment', required: false },
        { id: 'f_lube', type: 'checkbox', label: 'Lubricate Moving Parts', required: false },
        { id: 'f_condcoil', type: 'checkbox', label: 'Clean Condenser Coil', required: false },
        { id: 'f_evapcoil', type: 'checkbox', label: 'Clean Evaporator Coil', required: false },
        { id: 'f_refcharge', type: 'checkbox', label: 'Check Refrigerant Charge', required: false },
        { id: 'f_elec', type: 'checkbox', label: 'Inspect Electrical Connections', required: false },
        { id: 'f_safety', type: 'checkbox', label: 'Check/Test Safety Controls', required: false },
        { id: 'f_drain', type: 'checkbox', label: 'Drain Pan & Condensate Drain', required: false },
        { id: 'f_pressures', type: 'checkbox', label: 'Check/Record Operating Pressures', required: false },
        { id: 'f_temps', type: 'checkbox', label: 'Check/Record Temperatures', required: false },
        { id: 'f_duct', type: 'checkbox', label: 'Inspect Ductwork', required: false },
        { id: 'f_thermo', type: 'checkbox', label: 'Test Thermostat/Controls', required: false },
        { id: 'f_amps', type: 'checkbox', label: 'Record Amp Draw', required: false },
        { id: 'f_visual', type: 'checkbox', label: 'Visual Inspection', required: false },
        { id: 'f_notes', type: 'text', label: 'Additional Notes', required: false },
        { id: 'f_photo1', type: 'photo', label: 'Inspection Photo', required: false }
      ]
    },
    {
      id: 'tpl_hvac_service',
      name: 'HVAC Service Report',
      fields: [
        { id: 'f_reftype', type: 'text', label: 'Refrigerant Type', required: false },
        { id: 'f_suction', type: 'text', label: 'Suction Pressure (PSI)', required: false },
        { id: 'f_discharge', type: 'text', label: 'Discharge Pressure (PSI)', required: false },
        { id: 'f_supply', type: 'text', label: 'Supply Air Temp (°F)', required: false },
        { id: 'f_return', type: 'text', label: 'Return Air Temp (°F)', required: false },
        { id: 'f_condition', type: 'select', label: 'Filter Condition', required: false, options: ['Good', 'Dirty', 'Replaced'] },
        { id: 'f_leak', type: 'select', label: 'Refrigerant Leak Detected', required: false, options: ['No', 'Yes — Minor', 'Yes — Major'] },
        { id: 'f_compressor', type: 'select', label: 'Compressor Operation', required: true, options: ['Normal', 'Abnormal Noise', 'Not Running', 'Short Cycling'] },
        { id: 'f_electrical', type: 'checkbox', label: 'Electrical Connections Inspected', required: false },
        { id: 'f_condensate', type: 'checkbox', label: 'Condensate Drain Clear', required: false },
        { id: 'f_diagphoto', type: 'photo', label: 'Diagnostic Photo', required: false },
        { id: 'f_repairphoto', type: 'photo', label: 'Repair Photo', required: false }
      ]
    },
    {
      id: 'tpl_rooftop_unit',
      name: 'Rooftop Unit (RTU) Inspection',
      fields: [
        { id: 'f_filter', type: 'select', label: 'Filter Status', required: true, options: ['Clean', 'Dirty', 'Replaced'] },
        { id: 'f_belts', type: 'select', label: 'Belt Condition', required: true, options: ['Good', 'Worn', 'Replaced', 'N/A — Direct Drive'] },
        { id: 'f_coils', type: 'select', label: 'Coil Condition', required: true, options: ['Clean', 'Dirty — Cleaned', 'Dirty — Needs Cleaning'] },
        { id: 'f_reftype', type: 'text', label: 'Refrigerant Type', required: false },
        { id: 'f_suction', type: 'text', label: 'Suction Pressure (PSI)', required: false },
        { id: 'f_discharge', type: 'text', label: 'Discharge Pressure (PSI)', required: false },
        { id: 'f_superheat', type: 'text', label: 'Superheat (°F)', required: false },
        { id: 'f_subcool', type: 'text', label: 'Subcooling (°F)', required: false },
        { id: 'f_supply', type: 'text', label: 'Supply Air Temp (°F)', required: false },
        { id: 'f_return', type: 'text', label: 'Return Air Temp (°F)', required: false },
        { id: 'f_compamps', type: 'text', label: 'Compressor Amp Draw', required: false },
        { id: 'f_fanamps', type: 'text', label: 'Fan Motor Amp Draw', required: false },
        { id: 'f_elec', type: 'checkbox', label: 'Electrical Connections Tight', required: false },
        { id: 'f_cap', type: 'checkbox', label: 'Capacitor(s) Tested', required: false },
        { id: 'f_contactor', type: 'checkbox', label: 'Contactor Inspected', required: false },
        { id: 'f_drain', type: 'checkbox', label: 'Condensate Drain Clear', required: false },
        { id: 'f_thermo', type: 'checkbox', label: 'Thermostat Calibrated', required: false },
        { id: 'f_economizer', type: 'select', label: 'Economizer Operation', required: false, options: ['Functioning', 'Not Functioning', 'N/A'] },
        { id: 'f_photo', type: 'photo', label: 'Unit Overview Photo', required: false },
        { id: 'f_dataplate', type: 'photo', label: 'Data Plate Photo', required: false }
      ]
    },
    {
      id: 'tpl_boiler',
      name: 'Boiler Inspection',
      fields: [
        { id: 'f_type', type: 'select', label: 'Boiler Type', required: true, options: ['Gas', 'Oil', 'Electric', 'Steam', 'Hot Water'] },
        { id: 'f_flame', type: 'select', label: 'Flame Appearance', required: true, options: ['Clean Blue', 'Yellow/Lazy', 'Lifting', 'N/A'] },
        { id: 'f_psi', type: 'text', label: 'Operating Pressure (PSI)', required: false },
        { id: 'f_temp', type: 'text', label: 'Operating Temperature (°F)', required: false },
        { id: 'f_gaspress', type: 'text', label: 'Gas Pressure (in. WC)', required: false },
        { id: 'f_co', type: 'text', label: 'CO Reading (PPM)', required: false },
        { id: 'f_combustion', type: 'text', label: 'Combustion Efficiency (%)', required: false },
        { id: 'f_safety', type: 'checkbox', label: 'Safety/Relief Valve Tested', required: true },
        { id: 'f_lwco', type: 'checkbox', label: 'Low Water Cutoff Tested', required: false },
        { id: 'f_venting', type: 'checkbox', label: 'Venting Inspected', required: false },
        { id: 'f_refractory', type: 'checkbox', label: 'Refractory/Heat Exchanger Inspected', required: false },
        { id: 'f_leak', type: 'select', label: 'Leak Detected', required: false, options: ['No', 'Water Leak', 'Gas Leak'] },
        { id: 'f_pump', type: 'select', label: 'Circulating Pump', required: false, options: ['Operating Normal', 'Noisy', 'Not Running', 'N/A'] },
        { id: 'f_photo', type: 'photo', label: 'Boiler Photo', required: false },
        { id: 'f_flamephoto', type: 'photo', label: 'Flame Photo', required: false }
      ]
    },
    {
      id: 'tpl_chiller',
      name: 'Chiller Inspection',
      fields: [
        { id: 'f_type', type: 'select', label: 'Chiller Type', required: true, options: ['Air-Cooled', 'Water-Cooled', 'Absorption'] },
        { id: 'f_reftype', type: 'text', label: 'Refrigerant Type', required: false },
        { id: 'f_ewt', type: 'text', label: 'Entering Water Temp (°F)', required: false },
        { id: 'f_lwt', type: 'text', label: 'Leaving Water Temp (°F)', required: false },
        { id: 'f_suction', type: 'text', label: 'Suction Pressure (PSI)', required: false },
        { id: 'f_discharge', type: 'text', label: 'Discharge Pressure (PSI)', required: false },
        { id: 'f_oilpress', type: 'text', label: 'Oil Pressure (PSI)', required: false },
        { id: 'f_oiltemp', type: 'text', label: 'Oil Temperature (°F)', required: false },
        { id: 'f_amps', type: 'text', label: 'Compressor Amp Draw', required: false },
        { id: 'f_approach', type: 'text', label: 'Approach Temperature (°F)', required: false },
        { id: 'f_oillevel', type: 'select', label: 'Oil Level', required: false, options: ['Normal', 'Low', 'Added Oil'] },
        { id: 'f_leak', type: 'select', label: 'Refrigerant Leak Detected', required: false, options: ['No', 'Yes — Minor', 'Yes — Major'] },
        { id: 'f_tubes', type: 'checkbox', label: 'Tubes/Heat Exchanger Inspected', required: false },
        { id: 'f_elec', type: 'checkbox', label: 'Electrical Connections Inspected', required: false },
        { id: 'f_safeties', type: 'checkbox', label: 'Safety Controls Tested', required: false },
        { id: 'f_strainer', type: 'checkbox', label: 'Water Strainer Cleaned', required: false },
        { id: 'f_photo', type: 'photo', label: 'Chiller Photo', required: false },
        { id: 'f_log', type: 'photo', label: 'Operating Log Photo', required: false }
      ]
    },
    {
      id: 'tpl_general_equipment',
      name: 'General Equipment Inspection',
      fields: [
        { id: 'f_condition', type: 'select', label: 'Overall Condition', required: true, options: ['Good', 'Fair', 'Poor', 'Needs Replacement'] },
        { id: 'f_operational', type: 'select', label: 'Operational Status', required: true, options: ['Running Normal', 'Running with Issues', 'Not Running'] },
        { id: 'f_clean', type: 'checkbox', label: 'Equipment Clean', required: false },
        { id: 'f_access', type: 'checkbox', label: 'Accessible / Clear Surroundings', required: false },
        { id: 'f_labels', type: 'checkbox', label: 'Labels/Tags Legible', required: false },
        { id: 'f_noise', type: 'select', label: 'Unusual Noise/Vibration', required: false, options: ['None', 'Minor', 'Significant'] },
        { id: 'f_leaks', type: 'select', label: 'Leaks Detected', required: false, options: ['None', 'Water', 'Oil', 'Refrigerant', 'Other'] },
        { id: 'f_findings', type: 'text', label: 'Findings / Observations', required: false },
        { id: 'f_action', type: 'text', label: 'Action Taken', required: false },
        { id: 'f_photo1', type: 'photo', label: 'Equipment Photo', required: false },
        { id: 'f_photo2', type: 'photo', label: 'Issue Photo', required: false }
      ]
    }
  ];

  for (const t of defaultTemplates) {
    db.prepare('INSERT INTO form_templates (id,name,fields,createdAt,updatedAt) VALUES (?,?,?,?,?)')
      .run(t.id, t.name, JSON.stringify(t.fields), now, now);
  }
  console.log(`Seeded ${defaultTemplates.length} default form templates`);
}

function genId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function nextWONumber() {
  const year = new Date().getFullYear();
  const prefix = 'WO-' + year + '-';
  const row = db.prepare("SELECT woNumber FROM work_orders WHERE woNumber LIKE ? ORDER BY woNumber DESC LIMIT 1").get(prefix + '%');
  let seq = 1;
  if (row) {
    const parts = row.woNumber.split('-');
    seq = parseInt(parts[2], 10) + 1;
  }
  return prefix + String(seq).padStart(4, '0');
}

function getWeekStartServer(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  return mon.toISOString().split('T')[0];
}

// ─── EMAIL ────────────────────────────────────────────────────────────────────
function getEmailSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key='email'").get();
  try { return row ? JSON.parse(row.value) : {}; } catch { return {}; }
}

async function sendClientNotification(report) {
  try {
    const cfg = getEmailSettings();
    if (!cfg.enabled || !cfg.smtpUser || !cfg.smtpPass) return;

    // Resolve equipment → location → client
    const equip = db.prepare('SELECT * FROM equipment WHERE id=?').get(report.equipmentId);
    if (!equip) return;
    const loc   = db.prepare('SELECT * FROM locations WHERE id=?').get(equip.locationId);
    if (!loc) return;
    const client = db.prepare('SELECT * FROM clients WHERE id=?').get(loc.clientId);
    if (!client || !client.email) return;

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    });

    const reportDate = report.date ? new Date(report.date).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : 'N/A';
    const reportLink = cfg.appUrl ? `${cfg.appUrl.replace(/\/$/, '')}/#report-${report.id}` : '';
    const fromName   = cfg.fromName || 'FieldMark Service';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222">
        <div style="background:#1a1d27;padding:24px 32px;border-radius:8px 8px 0 0">
          <h1 style="color:#3b82f6;margin:0;font-size:22px">FieldMark</h1>
          <p style="color:#94a3b8;margin:4px 0 0">Service Report Notification</p>
        </div>
        <div style="background:#f8fafc;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
          <p>Dear ${client.name},</p>
          <p>A <strong>${report.type === 'maintenance' ? 'Maintenance' : 'Service'} Report</strong> has been completed for your equipment.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0">
            <tr style="border-bottom:1px solid #e2e8f0">
              <td style="padding:10px 0;color:#64748b;width:40%">Equipment</td>
              <td style="padding:10px 0;font-weight:600">${equip.name}${equip.model ? ' — ' + equip.model : ''}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0">
              <td style="padding:10px 0;color:#64748b">Location</td>
              <td style="padding:10px 0">${loc.buildingName}${loc.address ? ', ' + loc.address : ''}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0">
              <td style="padding:10px 0;color:#64748b">Technician</td>
              <td style="padding:10px 0">${report.techName || 'N/A'}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0">
              <td style="padding:10px 0;color:#64748b">Date</td>
              <td style="padding:10px 0">${reportDate}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0">
              <td style="padding:10px 0;color:#64748b">Status</td>
              <td style="padding:10px 0">${report.status || 'N/A'}</td>
            </tr>
            ${report.workPerformed ? `<tr><td style="padding:10px 0;color:#64748b;vertical-align:top">Work Performed</td><td style="padding:10px 0">${report.workPerformed}</td></tr>` : ''}
          </table>
          ${reportLink ? `<p style="margin-top:24px"><a href="${reportLink}" style="background:#3b82f6;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600">View Full Report</a></p>` : ''}
          <p style="color:#64748b;font-size:13px;margin-top:32px">This notification was sent automatically by ${fromName}.</p>
        </div>
      </div>`;

    await transporter.sendMail({
      from: `"${fromName}" <${cfg.smtpUser}>`,
      to:   client.email,
      subject: `Service Report — ${equip.name} at ${loc.buildingName}`,
      html,
    });
    console.log(`Email sent to ${client.email} for report ${report.id}`);
  } catch (err) {
    console.error('Email send error:', err.message);
  }
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
function requireClientAuth(req, res, next) {
  if (!req.session?.client) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = db.prepare('SELECT * FROM users WHERE LOWER(username)=LOWER(?)').get(username);
  if (!user) return res.status(401).json({ error: 'Incorrect username or password' });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Incorrect username or password' });
  req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  res.json(req.session.user);
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

// ─── CLIENT AUTH ─────────────────────────────────────────────────────────────
app.post('/api/auth/client-login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const client = db.prepare('SELECT * FROM clients WHERE LOWER(email)=LOWER(?)').get(email);
  if (!client || !client.passwordHash) return res.status(401).json({ error: 'Incorrect email or password' });
  const match = await bcrypt.compare(password, client.passwordHash);
  if (!match) return res.status(401).json({ error: 'Incorrect email or password' });
  req.session.client = { id: client.id, name: client.name, email: client.email };
  req.session.user = null; // clear any staff session
  res.json({ id: client.id, name: client.name, email: client.email, role: 'client' });
});

app.post('/api/auth/client-logout', requireClientAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/client-me', requireClientAuth, (req, res) => {
  res.json({ ...req.session.client, role: 'client' });
});

// ─── CLIENT DATA (filtered to their own data) ───────────────────────────────
app.get('/api/client-data', requireClientAuth, (req, res) => {
  const clientId = req.session.client.id;
  const locations = db.prepare('SELECT * FROM locations WHERE clientId=? ORDER BY buildingName').all(clientId);
  const locationIds = locations.map(l => l.id);
  let equipment = [];
  let reports = [];
  if (locationIds.length) {
    const placeholders = locationIds.map(() => '?').join(',');
    equipment = db.prepare(`SELECT * FROM equipment WHERE locationId IN (${placeholders}) ORDER BY name`).all(...locationIds);
    const equipmentIds = equipment.map(e => e.id);
    if (equipmentIds.length) {
      const ePlaceholders = equipmentIds.map(() => '?').join(',');
      reports = db.prepare(`SELECT id,equipmentId,type,techName,date,status,workPerformed,cause,parts,recommendations,nextDate,checklist,refrigerantType,suctionPressure,dischargePressure,supplyTemp,returnTemp,createdAt FROM reports WHERE equipmentId IN (${ePlaceholders}) ORDER BY createdAt DESC`).all(...equipmentIds);
      reports.forEach(r => { try { r.checklist = r.checklist ? JSON.parse(r.checklist) : []; } catch { r.checklist = []; } });
    }
  }
  const formTemplates = db.prepare('SELECT * FROM form_templates ORDER BY name').all();
  formTemplates.forEach(t => { try { t.fields = JSON.parse(t.fields); } catch { t.fields = []; } });
  res.json({ locations, equipment, reports, formTemplates });
});

// ─── DATA (full load) ─────────────────────────────────────────────────────────
app.get('/api/data', requireAuth, (req, res) => {
  const clients   = db.prepare('SELECT * FROM clients ORDER BY name').all();
  const locations = db.prepare('SELECT * FROM locations ORDER BY buildingName').all();
  const equipment = db.prepare('SELECT * FROM equipment ORDER BY name').all();
  const reports   = db.prepare('SELECT id,equipmentId,type,techName,date,status,workPerformed,cause,parts,recommendations,nextDate,checklist,refrigerantType,suctionPressure,dischargePressure,supplyTemp,returnTemp,workOrderNumber,createdAt FROM reports ORDER BY createdAt DESC').all();
  const formTemplates = db.prepare('SELECT * FROM form_templates ORDER BY name').all();
  // Parse checklist JSON for each report
  reports.forEach(r => { try { r.checklist = r.checklist ? JSON.parse(r.checklist) : []; } catch { r.checklist = []; } });
  formTemplates.forEach(t => { try { t.fields = JSON.parse(t.fields); } catch { t.fields = []; } });
  const serviceRequests = db.prepare('SELECT * FROM service_requests ORDER BY createdAt DESC').all();
  serviceRequests.forEach(sr => { try { sr.photos = JSON.parse(sr.photos); } catch { sr.photos = []; } });
  const workOrders = db.prepare('SELECT * FROM work_orders ORDER BY createdAt DESC').all();
  workOrders.forEach(wo => { try { wo.laborEntries = JSON.parse(wo.laborEntries); } catch { wo.laborEntries = []; } });
  const users = db.prepare('SELECT id,username,name,role,createdAt FROM users ORDER BY name').all();
  const timeCards = db.prepare('SELECT * FROM time_cards ORDER BY weekStart DESC').all();
  res.json({ clients, locations, equipment, reports, formTemplates, serviceRequests, workOrders, users, timeCards });
});

// ─── CLIENTS ──────────────────────────────────────────────────────────────────
app.post('/api/clients', requireAdmin, async (req, res) => {
  const { name, phone, email, address, city, state, notes, portalPassword, logo,
          billingContact, billingEmail, billingPhone, billingAddress, paymentTerms, poRequired,
          taxId, creditLimit, accountNumber, defaultRate, arNotes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = genId();
  let hash = '';
  if (portalPassword && portalPassword.length >= 6) hash = await bcrypt.hash(portalPassword, 10);
  db.prepare('INSERT INTO clients (id,name,phone,email,address,city,state,notes,passwordHash,logo,billingContact,billingEmail,billingPhone,billingAddress,paymentTerms,poRequired,taxId,creditLimit,accountNumber,defaultRate,arNotes,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, name, phone||'', email||'', address||'', city||'', state||'', notes||'', hash, logo||'',
         billingContact||'', billingEmail||'', billingPhone||'', billingAddress||'', paymentTerms||'', poRequired||'No',
         taxId||'', creditLimit||'', accountNumber||'', defaultRate||'', arNotes||'', new Date().toISOString());
  res.json(db.prepare('SELECT * FROM clients WHERE id=?').get(id));
});

app.put('/api/clients/:id', requireAdmin, async (req, res) => {
  const { name, phone, email, address, city, state, notes, portalPassword, logo,
          billingContact, billingEmail, billingPhone, billingAddress, paymentTerms, poRequired,
          taxId, creditLimit, accountNumber, defaultRate, arNotes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.prepare('UPDATE clients SET name=?,phone=?,email=?,address=?,city=?,state=?,notes=?,logo=?,billingContact=?,billingEmail=?,billingPhone=?,billingAddress=?,paymentTerms=?,poRequired=?,taxId=?,creditLimit=?,accountNumber=?,defaultRate=?,arNotes=? WHERE id=?')
    .run(name, phone||'', email||'', address||'', city||'', state||'', notes||'', logo||'',
         billingContact||'', billingEmail||'', billingPhone||'', billingAddress||'', paymentTerms||'', poRequired||'No',
         taxId||'', creditLimit||'', accountNumber||'', defaultRate||'', arNotes||'', req.params.id);
  if (portalPassword && portalPassword.length >= 6) {
    const hash = await bcrypt.hash(portalPassword, 10);
    db.prepare('UPDATE clients SET passwordHash=? WHERE id=?').run(hash, req.params.id);
  }
  res.json(db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id));
});

app.delete('/api/clients/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const deleteClientCascade = db.transaction((clientId) => {
    const locs = db.prepare('SELECT id FROM locations WHERE clientId=?').all(clientId);
    locs.forEach(l => {
      const equips = db.prepare('SELECT id FROM equipment WHERE locationId=?').all(l.id);
      equips.forEach(e => db.prepare('DELETE FROM reports WHERE equipmentId=?').run(e.id));
      db.prepare('DELETE FROM equipment WHERE locationId=?').run(l.id);
    });
    db.prepare('DELETE FROM locations WHERE clientId=?').run(clientId);
    db.prepare('DELETE FROM clients WHERE id=?').run(clientId);
  });
  deleteClientCascade(id);
  res.json({ ok: true });
});

// ─── LOCATIONS ────────────────────────────────────────────────────────────────
app.post('/api/locations', requireAdmin, (req, res) => {
  const { clientId, buildingName, address, city, state, zip, contactName, contactPhone, notes } = req.body;
  if (!clientId || !buildingName) return res.status(400).json({ error: 'clientId and buildingName required' });
  const id = genId();
  db.prepare('INSERT INTO locations (id,clientId,buildingName,address,city,state,zip,contactName,contactPhone,notes,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, clientId, buildingName, address||'', city||'', state||'', zip||'', contactName||'', contactPhone||'', notes||'', new Date().toISOString());
  res.json(db.prepare('SELECT * FROM locations WHERE id=?').get(id));
});

app.put('/api/locations/:id', requireAdmin, (req, res) => {
  const { buildingName, address, city, state, zip, contactName, contactPhone, notes } = req.body;
  if (!buildingName) return res.status(400).json({ error: 'buildingName required' });
  db.prepare('UPDATE locations SET buildingName=?,address=?,city=?,state=?,zip=?,contactName=?,contactPhone=?,notes=? WHERE id=?')
    .run(buildingName, address||'', city||'', state||'', zip||'', contactName||'', contactPhone||'', notes||'', req.params.id);
  res.json(db.prepare('SELECT * FROM locations WHERE id=?').get(req.params.id));
});

app.delete('/api/locations/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const deleteLocCascade = db.transaction((locId) => {
    const equips = db.prepare('SELECT id FROM equipment WHERE locationId=?').all(locId);
    equips.forEach(e => db.prepare('DELETE FROM reports WHERE equipmentId=?').run(e.id));
    db.prepare('DELETE FROM equipment WHERE locationId=?').run(locId);
    db.prepare('DELETE FROM locations WHERE id=?').run(locId);
  });
  deleteLocCascade(id);
  res.json({ ok: true });
});

// ─── EQUIPMENT ────────────────────────────────────────────────────────────────
app.post('/api/equipment', requireAdmin, (req, res) => {
  const { locationId, name, model, serial, yearInstalled, type, notes, formTemplateId, photo } = req.body;
  if (!locationId || !name) return res.status(400).json({ error: 'locationId and name required' });
  const id = genId();
  db.prepare('INSERT INTO equipment (id,locationId,name,model,serial,yearInstalled,type,notes,formTemplateId,photo,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, locationId, name, model||'', serial||'', yearInstalled||null, type||'', notes||'', formTemplateId||'', photo||'', new Date().toISOString());
  res.json(db.prepare('SELECT * FROM equipment WHERE id=?').get(id));
});

app.put('/api/equipment/:id', requireAdmin, (req, res) => {
  const { name, model, serial, yearInstalled, type, notes, formTemplateId, photo } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  db.prepare('UPDATE equipment SET name=?,model=?,serial=?,yearInstalled=?,type=?,notes=?,formTemplateId=?,photo=? WHERE id=?')
    .run(name, model||'', serial||'', yearInstalled||null, type||'', notes||'', formTemplateId||'', photo||'', req.params.id);
  res.json(db.prepare('SELECT * FROM equipment WHERE id=?').get(req.params.id));
});

app.delete('/api/equipment/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM reports WHERE equipmentId=?').run(id);
  db.prepare('DELETE FROM equipment WHERE id=?').run(id);
  res.json({ ok: true });
});

// ─── FORM TEMPLATES ──────────────────────────────────────────────────────────
app.get('/api/form-templates', requireAuth, (req, res) => {
  const templates = db.prepare('SELECT * FROM form_templates ORDER BY name').all();
  templates.forEach(t => { try { t.fields = JSON.parse(t.fields); } catch { t.fields = []; } });
  res.json(templates);
});

app.post('/api/form-templates', requireAdmin, (req, res) => {
  const { name, fields } = req.body;
  if (!name) return res.status(400).json({ error: 'Template name required' });
  if (!fields || !fields.length) return res.status(400).json({ error: 'At least one field is required' });
  const id = genId();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO form_templates (id,name,fields,createdAt,updatedAt) VALUES (?,?,?,?,?)')
    .run(id, name, JSON.stringify(fields), now, now);
  const t = db.prepare('SELECT * FROM form_templates WHERE id=?').get(id);
  t.fields = JSON.parse(t.fields);
  res.json(t);
});

app.put('/api/form-templates/:id', requireAdmin, (req, res) => {
  const { name, fields } = req.body;
  if (!name) return res.status(400).json({ error: 'Template name required' });
  if (!fields || !fields.length) return res.status(400).json({ error: 'At least one field is required' });
  const now = new Date().toISOString();
  db.prepare('UPDATE form_templates SET name=?,fields=?,updatedAt=? WHERE id=?')
    .run(name, JSON.stringify(fields), now, req.params.id);
  const t = db.prepare('SELECT * FROM form_templates WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  t.fields = JSON.parse(t.fields);
  res.json(t);
});

app.delete('/api/form-templates/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM form_templates WHERE id=?').run(req.params.id);
  // Clear formTemplateId from any equipment using this template
  db.prepare("UPDATE equipment SET formTemplateId='' WHERE formTemplateId=?").run(req.params.id);
  res.json({ ok: true });
});

// ─── REPORTS ──────────────────────────────────────────────────────────────────
app.post('/api/reports', requireAuth, async (req, res) => {
  const { equipmentId, type, techName, date, status, workPerformed, cause, parts,
          recommendations, nextDate, checklist, refrigerantType, suctionPressure,
          dischargePressure, supplyTemp, returnTemp, photoBefore, photoAfter, photoNameplate, workOrderNumber } = req.body;
  if (!equipmentId || !type) return res.status(400).json({ error: 'equipmentId and type required' });
  const id = genId();
  db.prepare(`INSERT INTO reports
    (id,equipmentId,type,techName,date,status,workPerformed,cause,parts,recommendations,nextDate,checklist,refrigerantType,suctionPressure,dischargePressure,supplyTemp,returnTemp,photoBefore,photoAfter,photoNameplate,workOrderNumber,createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, equipmentId, type, techName||'', date||'', status||'', workPerformed||'', cause||'',
         parts||'', recommendations||'', nextDate||'', JSON.stringify(checklist||[]),
         refrigerantType||'', suctionPressure||'', dischargePressure||'', supplyTemp||'', returnTemp||'',
         photoBefore||'', photoAfter||'', photoNameplate||'', workOrderNumber||'',
         new Date().toISOString());
  const report = db.prepare('SELECT id,equipmentId,type,techName,date,status,workPerformed,cause,parts,recommendations,nextDate,checklist,refrigerantType,suctionPressure,dischargePressure,supplyTemp,returnTemp,workOrderNumber,createdAt FROM reports WHERE id=?').get(id);
  report.checklist = checklist || [];
  // Send email in background (don't block response)
  sendClientNotification(report);
  res.json(report);
});

app.put('/api/reports/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM reports WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Report not found' });
  const { techName, date, status, workPerformed, cause, parts, recommendations, nextDate,
          refrigerantType, suctionPressure, dischargePressure, supplyTemp, returnTemp, workOrderNumber } = req.body;
  db.prepare(`UPDATE reports SET techName=?, date=?, status=?, workPerformed=?, cause=?, parts=?,
    recommendations=?, nextDate=?, refrigerantType=?, suctionPressure=?, dischargePressure=?,
    supplyTemp=?, returnTemp=?, workOrderNumber=? WHERE id=?`)
    .run(techName||existing.techName, date||existing.date, status||existing.status,
         workPerformed!==undefined?workPerformed:existing.workPerformed,
         cause!==undefined?cause:existing.cause, parts!==undefined?parts:existing.parts,
         recommendations!==undefined?recommendations:existing.recommendations,
         nextDate!==undefined?nextDate:existing.nextDate,
         refrigerantType!==undefined?refrigerantType:existing.refrigerantType,
         suctionPressure!==undefined?suctionPressure:existing.suctionPressure,
         dischargePressure!==undefined?dischargePressure:existing.dischargePressure,
         supplyTemp!==undefined?supplyTemp:existing.supplyTemp,
         returnTemp!==undefined?returnTemp:existing.returnTemp,
         workOrderNumber!==undefined?workOrderNumber:existing.workOrderNumber,
         req.params.id);
  const updated = db.prepare('SELECT id,equipmentId,type,techName,date,status,workPerformed,cause,parts,recommendations,nextDate,checklist,refrigerantType,suctionPressure,dischargePressure,supplyTemp,returnTemp,workOrderNumber,createdAt FROM reports WHERE id=?').get(req.params.id);
  try { updated.checklist = JSON.parse(updated.checklist); } catch(e) { updated.checklist = []; }
  res.json(updated);
});

app.delete('/api/reports/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM reports WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/reports/:id/photos', requireAuth, (req, res) => {
  const row = db.prepare('SELECT photoBefore,photoAfter,photoNameplate FROM reports WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  res.json(row);
});

// ─── PDF VIEW (server-rendered HTML with photos) ──────────────────────────────
app.get('/api/reports/:id/pdf-view', requireAuth, (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).send('Report not found');

  const eq = r.equipmentId ? db.prepare('SELECT * FROM equipment WHERE id=?').get(r.equipmentId) : null;
  const loc = eq && eq.locationId ? db.prepare('SELECT * FROM locations WHERE id=?').get(eq.locationId) : null;
  const cl = loc && loc.clientId ? db.prepare('SELECT * FROM clients WHERE id=?').get(loc.clientId) : null;

  function e(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  const reportType = r.type === 'service' ? 'Service Record' : 'Maintenance Record';
  const dateStr = r.date || '';
  const statusLabel = r.status || 'N/A';
  const locName = loc ? loc.buildingName || '' : '';
  let locAddr = '';
  if (loc && loc.address) locAddr += loc.address;
  if (loc && loc.city) locAddr += ', ' + loc.city;
  if (loc && loc.state) locAddr += ' ' + loc.state;
  const eqName = eq ? eq.name || 'Equipment' : 'Equipment';

  let h = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FieldMark Report</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, Helvetica, sans-serif; }
@media print { body { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; } }
@page { margin: 12mm 10mm; size: letter; }
</style></head><body>
<div style="max-width:760px;margin:0 auto;padding:20px 28px 40px;font-size:13px;line-height:1.5;color:#1a1a1a;">`;

  // LOGO + DATE HEADER
  h += `<table style="width:100%;margin-bottom:14px;"><tr>
<td style="vertical-align:middle;">
<div style="display:flex;align-items:center;gap:10px;">
<div style="width:36px;height:36px;background:rgba(59,130,246,.15);border-radius:8px;display:flex;align-items:center;justify-content:center;">
<svg width="20" height="20" fill="none" stroke="#3b82f6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
</div>
<div>
<div style="font-size:20px;font-weight:700;color:#3b82f6;letter-spacing:-.5px;">FieldMark</div>
<div style="font-size:10px;color:#888;">Service Management Platform</div>
</div>
</div>
</td>
<td style="text-align:right;vertical-align:middle;">
${cl && cl.logo && cl.logo.length > 50 ? `<img src="${cl.logo}" style="max-height:44px;max-width:160px;object-fit:contain;margin-bottom:4px;display:block;margin-left:auto;">` : ''}
<div style="color:#c0392b;font-size:13px;font-weight:600;">${e(dateStr)}</div>
</td>
</tr></table>`;

  // RED HEADER BAR TABLE
  h += `<table style="width:100%;border-collapse:collapse;margin-bottom:0;">
<tr>
<th style="background:#c0392b;color:#fff;font-size:11px;font-weight:700;text-align:left;padding:6px 12px;border:1px solid #a93226;">Report Name</th>
<th style="background:#c0392b;color:#fff;font-size:11px;font-weight:700;text-align:left;padding:6px 12px;border:1px solid #a93226;">Equipment Location</th>
<th style="background:#c0392b;color:#fff;font-size:11px;font-weight:700;text-align:left;padding:6px 12px;border:1px solid #a93226;">Work Order</th>
<th style="background:#c0392b;color:#fff;font-size:11px;font-weight:700;text-align:left;padding:6px 12px;border:1px solid #a93226;">Technician Name</th>
</tr><tr>
<td style="font-size:12px;padding:5px 12px;border:1px solid #ddd;">${e(reportType)}</td>
<td style="font-size:12px;padding:5px 12px;border:1px solid #ddd;">${e(locName)}</td>
<td style="font-size:12px;padding:5px 12px;border:1px solid #ddd;">${e(r.workOrderNumber || '\u2014')}</td>
<td style="font-size:12px;padding:5px 12px;border:1px solid #ddd;">${e(r.techName || '\u2014')}</td>
</tr></table>`;

  // EQUIPMENT INFO
  h += `<div style="font-size:16px;font-weight:700;margin:22px 0 12px;color:#1a1a1a;">${e(eqName)} Information</div>`;
  h += `<table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
<tr>
<td style="padding:5px 10px;font-size:12px;font-weight:700;color:#333;width:120px;">Manufacturer</td>
<td style="padding:5px 10px;font-size:12px;color:#555;">${e(eq ? eq.type || '\u2014' : '\u2014')}</td>
<td style="padding:5px 10px;font-size:12px;font-weight:700;color:#333;width:120px;">Year Installed</td>
<td style="padding:5px 10px;font-size:12px;color:#555;">${e(eq ? eq.yearInstalled || '\u2014' : '\u2014')}</td>
</tr><tr>
<td style="padding:5px 10px;font-size:12px;font-weight:700;color:#333;">Model number</td>
<td style="padding:5px 10px;font-size:12px;color:#555;">${e(eq ? eq.model || '\u2014' : '\u2014')}</td>
<td style="padding:5px 10px;font-size:12px;font-weight:700;color:#333;">Client</td>
<td style="padding:5px 10px;font-size:12px;color:#555;">${e(cl ? cl.name || '\u2014' : '\u2014')}</td>
</tr><tr>
<td style="padding:5px 10px;font-size:12px;font-weight:700;color:#333;">Serial number</td>
<td style="padding:5px 10px;font-size:12px;color:#555;">${e(eq ? eq.serial || '\u2014' : '\u2014')}</td>
<td style="padding:5px 10px;font-size:12px;font-weight:700;color:#333;">Location</td>
<td style="padding:5px 10px;font-size:12px;color:#555;">${e(locName)}${locAddr ? '<br>' + e(locAddr) : ''}</td>
</tr></table>`;

  // EQUIPMENT PHOTO — from equipment profile
  const hasEqPhoto = eq && eq.photo && eq.photo.length > 50;
  if (hasEqPhoto) {
    h += `<div style="text-align:center;margin:20px 0 10px;">
<img src="${eq.photo}" style="max-width:280px;max-height:220px;border:1px solid #ccc;border-radius:4px;display:block;margin:0 auto;">
<div style="font-size:11px;font-style:italic;color:#555;margin-top:6px;">Equipment Photo</div>
</div>`;
  }

  // PHOTOS — served directly from DB, no client-side manipulation
  const hasBefore = r.photoBefore && r.photoBefore.length > 50;
  const hasAfter = r.photoAfter && r.photoAfter.length > 50;
  if (hasBefore || hasAfter) {
    h += `<div style="font-size:20px;font-weight:700;text-align:center;margin:30px 0 16px;color:#1a1a1a;">Photos from Service Call</div>`;
    h += `<table style="width:100%;border-collapse:collapse;"><tr>`;
    if (hasBefore) {
      h += `<td style="width:50%;text-align:center;padding:8px;vertical-align:top;">
<img src="${r.photoBefore}" style="max-width:100%;max-height:280px;border:1px solid #ccc;display:block;margin:0 auto;">
<div style="font-size:11px;font-style:italic;color:#555;margin-top:6px;">Photo Before Work</div></td>`;
    }
    if (hasAfter) {
      h += `<td style="width:50%;text-align:center;padding:8px;vertical-align:top;">
<img src="${r.photoAfter}" style="max-width:100%;max-height:280px;border:1px solid #ccc;display:block;margin:0 auto;">
<div style="font-size:11px;font-style:italic;color:#555;margin-top:6px;">Photo of Work After Completion</div></td>`;
    }
    h += `</tr></table>`;
  }

  // WORK PERFORMED
  h += `<div style="font-size:20px;font-weight:700;text-align:center;margin:30px 0 16px;color:#1a1a1a;">Description of Work Performed</div>`;
  if (r.workPerformed) h += `<div style="margin:10px 0;"><div style="font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">Work performed</div><div style="font-size:13px;line-height:1.6;color:#333;">${e(r.workPerformed)}</div></div>`;
  if (r.cause) h += `<div style="margin:10px 0;"><div style="font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">Cause / Finding</div><div style="font-size:13px;line-height:1.6;color:#333;">${e(r.cause)}</div></div>`;
  if (r.parts) h += `<div style="margin:10px 0;"><div style="font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">Parts Used / Replaced</div><div style="font-size:13px;line-height:1.6;color:#333;">${e(r.parts)}</div></div>`;
  if (r.recommendations) h += `<div style="margin:10px 0;"><div style="font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">Recommendations</div><div style="font-size:13px;line-height:1.6;color:#333;">${e(r.recommendations)}</div></div>`;

  // STATUS LINE
  h += `<table style="width:100%;margin:20px 0;"><tr>
<td style="width:28px;vertical-align:middle;"><div style="width:22px;height:22px;background:#3498db;border-radius:50%;color:#fff;font-size:13px;font-weight:700;text-align:center;line-height:22px;">i</div></td>
<td style="font-size:13px;font-weight:600;color:#1a1a1a;padding-left:8px;">Does this Unit Require Attention: ${e(statusLabel)}</td>
</tr></table>`;

  // CHECKLIST
  let ck = r.checklist;
  if (typeof ck === 'string') { try { ck = JSON.parse(ck); } catch(err) { ck = null; } }
  if (ck && ck.templateId && ck.fields) {
    h += `<div style="font-size:15px;font-weight:700;margin:24px 0 10px;border-bottom:2px solid #1a1a1a;padding-bottom:4px;">${e(ck.templateName || 'Checklist')}</div>`;
    (ck.fields || []).forEach(f => {
      if (f.type === 'checkbox') {
        const bg = f.value ? 'background:#27ae60;border-color:#27ae60;' : '';
        h += `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #eee;">
<div style="width:16px;height:16px;border:2px solid #999;display:inline-block;text-align:center;line-height:14px;font-size:11px;color:#fff;${bg}">${f.value ? '&#10003;' : ''}</div>
<span style="font-size:13px;">${e(f.label)}</span></div>`;
      } else if (f.type === 'text' || f.type === 'select') {
        h += `<div style="padding:4px 0;font-size:13px;"><span style="font-weight:700;">${e(f.label)}:</span> ${e(f.value || 'N/A')}</div>`;
      } else if (f.type === 'photo' && f.value) {
        h += `<div style="margin:10px 0;"><div style="font-weight:700;font-size:12px;margin-bottom:4px;">${e(f.label)}</div>
<img src="${f.value}" style="max-width:260px;border:1px solid #ccc;"></div>`;
      }
    });
  } else if (Array.isArray(ck) && ck.length > 0) {
    h += `<div style="font-size:15px;font-weight:700;margin:24px 0 10px;border-bottom:2px solid #1a1a1a;padding-bottom:4px;">Maintenance Checklist</div>`;
    ck.forEach(c => {
      const bg2 = c.done ? 'background:#27ae60;border-color:#27ae60;' : '';
      h += `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #eee;">
<div style="width:16px;height:16px;border:2px solid #999;display:inline-block;text-align:center;line-height:14px;font-size:11px;color:#fff;${bg2}">${c.done ? '&#10003;' : ''}</div>
<span style="font-size:13px;${c.done ? '' : 'color:#999;'}">${e(c.item)}</span></div>`;
    });
  }

  // NAMEPLATE
  const hasNameplate = r.photoNameplate && r.photoNameplate.length > 50;
  if (hasNameplate) {
    h += `<div style="font-size:20px;font-weight:700;text-align:center;margin:30px 0 16px;color:#1a1a1a;">Additional Images</div>`;
    h += `<table style="width:100%;"><tr>
<td style="width:50%;text-align:center;padding:8px;vertical-align:top;">
<img src="${r.photoNameplate}" style="max-width:100%;max-height:240px;border:1px solid #ccc;display:block;margin:0 auto;">
<div style="font-size:11px;color:#555;margin-top:4px;">Nameplate</div>
</td><td style="width:50%;"></td></tr></table>`;
  }

  // FOOTER
  h += `<div style="margin-top:40px;padding-top:16px;border-top:1px solid #ddd;text-align:center;">
<div style="color:#c0392b;font-size:16px;font-weight:700;font-style:italic;">Thank you for choosing us - we truly appreciate your trust.</div>
<div style="color:#999;font-size:10px;margin-top:6px;">Generated by FieldMark &bull; www.field-mark.app</div>
</div></div>
<script>
window.onload = function() {
  var imgs = document.querySelectorAll("img");
  var total = imgs.length;
  if (total === 0) { setTimeout(function(){ window.print(); }, 300); return; }
  var loaded = 0, done = false;
  function check() { loaded++; if (!done && loaded >= total) { done = true; setTimeout(function(){ window.print(); }, 500); } }
  for (var i = 0; i < imgs.length; i++) {
    if (imgs[i].complete && imgs[i].naturalWidth > 0) { check(); }
    else { imgs[i].onload = check; imgs[i].onerror = check; }
  }
  setTimeout(function(){ if (!done) { done = true; window.print(); } }, 8000);
};
<\/script></body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(h);
});

// ─── SERVICE REQUESTS ─────────────────────────────────────────────────────────
app.post('/api/service-requests', requireClientAuth, async (req, res) => {
  const cfg = getEmailSettings();
  const { locationId, equipmentId, urgency, description, photos } = req.body;
  if (!locationId || !urgency || !description) return res.status(400).json({ error: 'Location, urgency, and description are required' });

  // Store in database
  const srId = genId();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO service_requests (id,clientId,locationId,equipmentId,urgency,description,photos,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(srId, req.session.client.id, locationId, equipmentId||'', urgency, description, JSON.stringify(photos||[]), 'New', now);

  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(req.session.client.id);
  const loc = db.prepare('SELECT * FROM locations WHERE id=?').get(locationId);
  const equip = equipmentId ? db.prepare('SELECT * FROM equipment WHERE id=?').get(equipmentId) : null;
  const fromName = cfg.fromName || 'FieldMark Service';

  const urgencyColors = { 'Routine': '#22c55e', 'Urgent': '#f59e0b', 'Emergency': '#ef4444' };
  const urgencyColor = urgencyColors[urgency] || '#64748b';

  const photosHtml = (photos && photos.length)
    ? `<tr><td colspan="2" style="padding:16px 0"><p style="color:#64748b;margin:0 0 10px;font-weight:600">Attached Photos (${photos.length})</p>
        <div>${photos.map((p, i) => `<img src="${p}" alt="Photo ${i+1}" style="max-width:280px;border-radius:6px;margin:4px;border:1px solid #e2e8f0">`).join('')}</div></td></tr>`
    : '';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222">
      <div style="background:#1a1d27;padding:24px 32px;border-radius:8px 8px 0 0">
        <h1 style="color:#3b82f6;margin:0;font-size:22px">FieldMark</h1>
        <p style="color:#94a3b8;margin:4px 0 0">Service Request</p>
      </div>
      <div style="background:#f8fafc;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <p style="margin-top:0">A client has submitted a new service request.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0">
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px 0;color:#64748b;width:40%">Client</td>
            <td style="padding:10px 0;font-weight:600">${client?.name || 'Unknown'}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px 0;color:#64748b">Contact Email</td>
            <td style="padding:10px 0">${client?.email || 'N/A'}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px 0;color:#64748b">Phone</td>
            <td style="padding:10px 0">${client?.phone || 'N/A'}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px 0;color:#64748b">Location</td>
            <td style="padding:10px 0">${loc?.buildingName || 'Unknown'}${loc?.address ? ', ' + loc.address : ''}</td>
          </tr>
          ${equip ? `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px 0;color:#64748b">Equipment</td>
            <td style="padding:10px 0">${equip.name}${equip.model ? ' — ' + equip.model : ''}</td>
          </tr>` : ''}
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px 0;color:#64748b">Urgency</td>
            <td style="padding:10px 0"><span style="background:${urgencyColor};color:#fff;padding:3px 10px;border-radius:4px;font-size:13px;font-weight:600">${urgency}</span></td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px 0;color:#64748b;vertical-align:top">Description</td>
            <td style="padding:10px 0">${description.replace(/\n/g, '<br>')}</td>
          </tr>
          ${photosHtml}
        </table>
        <p style="color:#64748b;font-size:13px;margin-top:32px">Submitted on ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' })}.</p>
      </div>
    </div>`;

  // Send email if configured
  if (cfg.enabled && cfg.smtpUser && cfg.smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 587, secure: false,
        auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
      });
      await transporter.sendMail({
        from: `"${fromName}" <${cfg.smtpUser}>`,
        to: cfg.smtpUser,
        replyTo: client?.email || undefined,
        subject: `Service Request — ${client?.name || 'Client'} — ${loc?.buildingName || 'Location'}${equip ? ' — ' + equip.name : ''}`,
        html,
      });
      console.log(`Service request email sent from client ${client?.name}`);
    } catch (err) {
      console.error('Service request email error:', err.message);
    }
  }
  res.json({ ok: true, id: srId });
});

// ─── SERVICE REQUESTS (admin) ─────────────────────────────────────────────────
app.put('/api/service-requests/:id', requireAdmin, (req, res) => {
  const { status, notes } = req.body;
  const sr = db.prepare('SELECT * FROM service_requests WHERE id=?').get(req.params.id);
  if (!sr) return res.status(404).json({ error: 'Service request not found' });
  db.prepare('UPDATE service_requests SET status=?, notes=? WHERE id=?')
    .run(status || sr.status, notes !== undefined ? notes : sr.notes, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/service-requests/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM service_requests WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── WORK ORDERS ──────────────────────────────────────────────────────────────
app.post('/api/work-orders', requireAdmin, (req, res) => {
  const { clientId, locationId, equipmentId, description, priority, assignedTo, serviceRequestId } = req.body;
  if (!clientId || !locationId) return res.status(400).json({ error: 'Client and location required' });
  const id = genId();
  const woNumber = nextWONumber();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO work_orders (id,woNumber,clientId,locationId,equipmentId,description,status,priority,assignedTo,serviceRequestId,laborEntries,notes,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, woNumber, clientId, locationId, equipmentId||'', description||'', 'Open', priority||'Normal', assignedTo||'', serviceRequestId||'', '[]', '', now, now);
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(id);
  try { wo.laborEntries = JSON.parse(wo.laborEntries); } catch { wo.laborEntries = []; }
  res.json(wo);
});

app.put('/api/work-orders/:id', requireAdmin, (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  const { status, priority, assignedTo, description, notes, laborEntries } = req.body;
  const now = new Date().toISOString();
  db.prepare(`UPDATE work_orders SET status=?, priority=?, assignedTo=?, description=?, notes=?, laborEntries=?, updatedAt=? WHERE id=?`)
    .run(
      status !== undefined ? status : wo.status,
      priority !== undefined ? priority : wo.priority,
      assignedTo !== undefined ? assignedTo : wo.assignedTo,
      description !== undefined ? description : wo.description,
      notes !== undefined ? notes : wo.notes,
      laborEntries !== undefined ? JSON.stringify(laborEntries) : wo.laborEntries,
      now, req.params.id
    );
  const updated = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  try { updated.laborEntries = JSON.parse(updated.laborEntries); } catch { updated.laborEntries = []; }
  res.json(updated);
});

app.delete('/api/work-orders/:id', requireAdmin, (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  if (wo) {
    // Clear workOrderNumber on any linked reports
    db.prepare("UPDATE reports SET workOrderNumber='' WHERE workOrderNumber=?").run(wo.woNumber);
  }
  db.prepare('DELETE FROM work_orders WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── UPDATE WORK ORDER STATUS (assigned tech or admin) ───────────────────────
app.put('/api/work-orders/:id/close', requireAuth, (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  const user = req.session.user;
  if (user.role !== 'admin' && wo.assignedTo !== user.id) {
    return res.status(403).json({ error: 'Only the assigned technician or an admin can update this work order' });
  }
  const allowed = ['Completed', 'On Hold', 'Open'];
  const status = allowed.includes(req.body.status) ? req.body.status : 'Completed';
  if (status === 'Completed') {
    const linked = db.prepare("SELECT COUNT(*) as c FROM reports WHERE workOrderNumber=?").get(wo.woNumber);
    if (!linked || linked.c === 0) return res.status(400).json({ error: 'Cannot mark as Complete — no reports linked to this work order' });
  }
  db.prepare('UPDATE work_orders SET status=?, updatedAt=? WHERE id=?')
    .run(status, new Date().toISOString(), req.params.id);
  const updated = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  try { updated.laborEntries = JSON.parse(updated.laborEntries); } catch(e) { updated.laborEntries = []; }
  res.json(updated);
});

// ─── LABOR ENTRIES (any staff) ─────────────────────────────────────────────────
app.post('/api/work-orders/:id/labor', requireAuth, (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  const { date, hours, desc } = req.body;
  if (!date || !hours) return res.status(400).json({ error: 'Date and hours required' });
  // Check time card lock
  const weekStart = getWeekStartServer(date);
  const tc = db.prepare('SELECT * FROM time_cards WHERE userId=? AND weekStart=?').get(req.session.user.id, weekStart);
  if (tc && (tc.status === 'Submitted' || tc.status === 'Approved') && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Time card for this week is ' + tc.status + '. Cannot add entries.' });
  }
  let labor = []; try { labor = JSON.parse(wo.laborEntries); } catch { labor = []; }
  const entry = { id: genId(), userId: req.session.user.id, tech: req.session.user.name, date, hours: parseFloat(hours), desc: desc || '' };
  labor.push(entry);
  const now = new Date().toISOString();
  db.prepare('UPDATE work_orders SET laborEntries=?, updatedAt=? WHERE id=?').run(JSON.stringify(labor), now, req.params.id);
  const updated = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  try { updated.laborEntries = JSON.parse(updated.laborEntries); } catch { updated.laborEntries = []; }
  res.json(updated);
});

app.put('/api/work-orders/:id/labor/:entryId', requireAuth, (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  let labor = []; try { labor = JSON.parse(wo.laborEntries); } catch { labor = []; }
  const idx = labor.findIndex(e => e.id === req.params.entryId);
  if (idx === -1) return res.status(404).json({ error: 'Labor entry not found' });
  // Ownership check
  if (labor[idx].userId !== req.session.user.id && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Can only edit your own entries' });
  }
  // Time card lock check
  const dateToCheck = req.body.date || labor[idx].date;
  const weekStart = getWeekStartServer(dateToCheck);
  const tc = db.prepare('SELECT * FROM time_cards WHERE userId=? AND weekStart=?').get(labor[idx].userId, weekStart);
  if (tc && (tc.status === 'Submitted' || tc.status === 'Approved') && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Time card for this week is ' + tc.status });
  }
  const { date, hours, desc } = req.body;
  if (date !== undefined) labor[idx].date = date;
  if (hours !== undefined) labor[idx].hours = parseFloat(hours);
  if (desc !== undefined) labor[idx].desc = desc;
  const now = new Date().toISOString();
  db.prepare('UPDATE work_orders SET laborEntries=?, updatedAt=? WHERE id=?').run(JSON.stringify(labor), now, req.params.id);
  const updated = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  try { updated.laborEntries = JSON.parse(updated.laborEntries); } catch { updated.laborEntries = []; }
  res.json(updated);
});

app.delete('/api/work-orders/:id/labor/:entryId', requireAuth, (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  let labor = []; try { labor = JSON.parse(wo.laborEntries); } catch { labor = []; }
  const entry = labor.find(e => e.id === req.params.entryId);
  if (!entry) return res.status(404).json({ error: 'Labor entry not found' });
  if (entry.userId !== req.session.user.id && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Can only delete your own entries' });
  }
  const weekStart = getWeekStartServer(entry.date);
  const tc = db.prepare('SELECT * FROM time_cards WHERE userId=? AND weekStart=?').get(entry.userId, weekStart);
  if (tc && (tc.status === 'Submitted' || tc.status === 'Approved') && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Time card for this week is ' + tc.status });
  }
  labor = labor.filter(e => e.id !== req.params.entryId);
  const now = new Date().toISOString();
  db.prepare('UPDATE work_orders SET laborEntries=?, updatedAt=? WHERE id=?').run(JSON.stringify(labor), now, req.params.id);
  const updated = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  try { updated.laborEntries = JSON.parse(updated.laborEntries); } catch { updated.laborEntries = []; }
  res.json(updated);
});

// ─── TIME CARDS ───────────────────────────────────────────────────────────────
app.get('/api/time-cards', requireAuth, (req, res) => {
  const weekStart = req.query.weekStart;
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' });
  let userId = req.query.userId || req.session.user.id;
  if (req.session.user.role !== 'admin') userId = req.session.user.id;
  // Get or create virtual time card
  let tc = db.prepare('SELECT * FROM time_cards WHERE userId=? AND weekStart=?').get(userId, weekStart);
  if (!tc) tc = { id: null, userId, weekStart, status: 'Draft', submittedAt: '', approvedAt: '', approvedBy: '' };
  // Compute week end (Sunday)
  const ws = new Date(weekStart + 'T00:00:00');
  const we = new Date(ws); we.setDate(we.getDate() + 6);
  const weekEnd = we.toISOString().split('T')[0];
  // Aggregate labor entries from all work orders
  const allWOs = db.prepare('SELECT * FROM work_orders').all();
  const entries = [];
  allWOs.forEach(wo => {
    let labor = []; try { labor = JSON.parse(wo.laborEntries); } catch { labor = []; }
    labor.forEach(e => {
      if (e.userId === userId && e.date >= weekStart && e.date <= weekEnd) {
        const loc = db.prepare('SELECT buildingName,address FROM locations WHERE id=?').get(wo.locationId);
        entries.push({ ...e, woId: wo.id, woNumber: wo.woNumber, location: loc ? (loc.buildingName + (loc.address ? ' — ' + loc.address : '')) : '' });
      }
    });
  });
  const user = db.prepare('SELECT id,name,role FROM users WHERE id=?').get(userId);
  res.json({ timeCard: tc, entries, user: user || { id: userId, name: 'Unknown' } });
});

app.get('/api/time-cards/all', requireAdmin, (req, res) => {
  const weekStart = req.query.weekStart;
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' });
  const ws = new Date(weekStart + 'T00:00:00');
  const we = new Date(ws); we.setDate(we.getDate() + 6);
  const weekEnd = we.toISOString().split('T')[0];
  // Get all non-client users
  const users = db.prepare("SELECT id,name,role FROM users WHERE role != 'client' ORDER BY name").all();
  const allWOs = db.prepare('SELECT * FROM work_orders').all();
  const results = [];
  users.forEach(user => {
    let tc = db.prepare('SELECT * FROM time_cards WHERE userId=? AND weekStart=?').get(user.id, weekStart);
    if (!tc) tc = { id: null, userId: user.id, weekStart, status: 'Draft', submittedAt: '', approvedAt: '', approvedBy: '' };
    const entries = [];
    allWOs.forEach(wo => {
      let labor = []; try { labor = JSON.parse(wo.laborEntries); } catch { labor = []; }
      labor.forEach(e => {
        if (e.userId === user.id && e.date >= weekStart && e.date <= weekEnd) {
          const loc = db.prepare('SELECT buildingName,address FROM locations WHERE id=?').get(wo.locationId);
          entries.push({ ...e, woId: wo.id, woNumber: wo.woNumber, location: loc ? (loc.buildingName + (loc.address ? ' — ' + loc.address : '')) : '' });
        }
      });
    });
    results.push({ timeCard: tc, entries, user });
  });
  res.json(results);
});

app.post('/api/time-cards/submit', requireAuth, (req, res) => {
  const { weekStart } = req.body;
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' });
  const userId = req.session.user.id;
  const now = new Date().toISOString();
  let tc = db.prepare('SELECT * FROM time_cards WHERE userId=? AND weekStart=?').get(userId, weekStart);
  if (tc) {
    db.prepare('UPDATE time_cards SET status=?, submittedAt=? WHERE id=?').run('Submitted', now, tc.id);
  } else {
    const id = genId();
    db.prepare('INSERT INTO time_cards (id,userId,weekStart,status,submittedAt,createdAt) VALUES (?,?,?,?,?,?)').run(id, userId, weekStart, 'Submitted', now, now);
  }
  res.json({ ok: true });
});

app.post('/api/time-cards/approve', requireAdmin, (req, res) => {
  const { userId, weekStart } = req.body;
  if (!userId || !weekStart) return res.status(400).json({ error: 'userId and weekStart required' });
  const now = new Date().toISOString();
  let tc = db.prepare('SELECT * FROM time_cards WHERE userId=? AND weekStart=?').get(userId, weekStart);
  if (tc) {
    db.prepare('UPDATE time_cards SET status=?, approvedAt=?, approvedBy=? WHERE id=?').run('Approved', now, req.session.user.id, tc.id);
  } else {
    const id = genId();
    db.prepare('INSERT INTO time_cards (id,userId,weekStart,status,approvedAt,approvedBy,createdAt) VALUES (?,?,?,?,?,?,?)').run(id, userId, weekStart, 'Approved', now, req.session.user.id, now);
  }
  res.json({ ok: true });
});

app.post('/api/time-cards/reopen', requireAdmin, (req, res) => {
  const { userId, weekStart } = req.body;
  if (!userId || !weekStart) return res.status(400).json({ error: 'userId and weekStart required' });
  let tc = db.prepare('SELECT * FROM time_cards WHERE userId=? AND weekStart=?').get(userId, weekStart);
  if (tc) {
    db.prepare("UPDATE time_cards SET status='Draft', submittedAt='', approvedAt='', approvedBy='' WHERE id=?").run(tc.id);
  }
  res.json({ ok: true });
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id,username,name,role,createdAt FROM users ORDER BY name').all();
  res.json(users);
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, name, role, password } = req.body;
  if (!username || !name || !password) return res.status(400).json({ error: 'username, name and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const existing = db.prepare('SELECT id FROM users WHERE LOWER(username)=LOWER(?)').get(username);
  if (existing) return res.status(400).json({ error: 'Username already exists' });
  const hash = await bcrypt.hash(password, 10);
  const id   = genId();
  db.prepare('INSERT INTO users (id,username,name,role,passwordHash,createdAt) VALUES (?,?,?,?,?,?)')
    .run(id, username, name, role||'technician', hash, new Date().toISOString());
  res.json({ id, username, name, role: role||'technician', createdAt: new Date().toISOString() });
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  const { username, name, role, password } = req.body;
  if (!username || !name) return res.status(400).json({ error: 'username and name required' });
  const existing = db.prepare('SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id!=?').get(username, req.params.id);
  if (existing) return res.status(400).json({ error: 'Username already exists' });
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const hash = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET username=?,name=?,role=?,passwordHash=? WHERE id=?')
      .run(username, name, role||'technician', hash, req.params.id);
  } else {
    db.prepare('UPDATE users SET username=?,name=?,role=? WHERE id=?')
      .run(username, name, role||'technician', req.params.id);
  }
  // Update session if editing self
  if (req.session.user.id === req.params.id) {
    req.session.user = { ...req.session.user, username, name, role: role||'technician' };
  }
  res.json({ id: req.params.id, username, name, role: role||'technician' });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const admins = db.prepare("SELECT id FROM users WHERE role='admin'").all();
  const target = db.prepare('SELECT role FROM users WHERE id=?').get(req.params.id);
  if (target?.role === 'admin' && admins.length <= 1) {
    return res.status(400).json({ error: 'Cannot delete the only administrator account' });
  }
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
app.get('/api/settings', requireAdmin, (req, res) => {
  const cfg = getEmailSettings();
  // Never return the password to the client
  const safe = { ...cfg };
  if (safe.smtpPass) safe.smtpPass = '••••••••';
  res.json(safe);
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const existing = getEmailSettings();
  const { enabled, smtpUser, smtpPass, fromName, appUrl } = req.body;
  const cfg = {
    enabled: !!enabled,
    smtpUser: smtpUser || existing.smtpUser || '',
    smtpPass: smtpPass && smtpPass !== '••••••••' ? smtpPass : (existing.smtpPass || ''),
    fromName: fromName || '',
    appUrl:   appUrl || '',
  };
  const row = db.prepare("SELECT key FROM settings WHERE key='email'").get();
  if (row) db.prepare("UPDATE settings SET value=? WHERE key='email'").run(JSON.stringify(cfg));
  else db.prepare("INSERT INTO settings (key,value) VALUES ('email',?)").run(JSON.stringify(cfg));
  res.json({ ok: true });
});

// ─── TEST EMAIL ───────────────────────────────────────────────────────────────
app.post('/api/email/test', requireAdmin, async (req, res) => {
  const cfg = getEmailSettings();
  if (!cfg.smtpUser || !cfg.smtpPass) return res.status(400).json({ error: 'Gmail address and App Password are required' });
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Test recipient email is required' });
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    });
    await transporter.sendMail({
      from: `"${cfg.fromName || 'FieldMark'}" <${cfg.smtpUser}>`,
      to,
      subject: 'FieldMark — Test Email',
      html: '<p>This is a test email from <strong>FieldMark</strong>. Your email notifications are working correctly.</p>',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DATA IMPORT (migration from localStorage) ────────────────────────────────
app.post('/api/import', requireAdmin, (req, res) => {
  const { clients=[], locations=[], equipment=[], reports=[] } = req.body;
  const importAll = db.transaction(() => {
    let counts = { clients:0, locations:0, equipment:0, reports:0 };
    clients.forEach(c => {
      const exists = db.prepare('SELECT id FROM clients WHERE id=?').get(c.id);
      if (!exists) {
        db.prepare('INSERT INTO clients (id,name,phone,email,address,city,state,notes,createdAt) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(c.id, c.name||'', c.phone||'', c.email||'', c.address||'', c.city||'', c.state||'', c.notes||'', c.createdAt||new Date().toISOString());
        counts.clients++;
      }
    });
    locations.forEach(l => {
      const exists = db.prepare('SELECT id FROM locations WHERE id=?').get(l.id);
      if (!exists) {
        db.prepare('INSERT INTO locations (id,clientId,buildingName,address,city,state,zip,contactName,contactPhone,notes,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(l.id, l.clientId||'', l.buildingName||'', l.address||'', l.city||'', l.state||'', l.zip||'', l.contactName||'', l.contactPhone||'', l.notes||'', l.createdAt||new Date().toISOString());
        counts.locations++;
      }
    });
    equipment.forEach(e => {
      const exists = db.prepare('SELECT id FROM equipment WHERE id=?').get(e.id);
      if (!exists) {
        db.prepare('INSERT INTO equipment (id,locationId,name,model,serial,yearInstalled,type,notes,createdAt) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(e.id, e.locationId||'', e.name||'', e.model||'', e.serial||'', e.yearInstalled||null, e.type||'', e.notes||'', e.createdAt||new Date().toISOString());
        counts.equipment++;
      }
    });
    reports.forEach(r => {
      const exists = db.prepare('SELECT id FROM reports WHERE id=?').get(r.id);
      if (!exists) {
        db.prepare(`INSERT INTO reports (id,equipmentId,type,techName,date,status,workPerformed,cause,parts,recommendations,nextDate,checklist,refrigerantType,suctionPressure,dischargePressure,supplyTemp,returnTemp,createdAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(r.id, r.equipmentId||'', r.type||'service', r.techName||'', r.date||'', r.status||'', r.workPerformed||'', r.cause||'', r.parts||'', r.recommendations||'', r.nextDate||'', JSON.stringify(r.checklist||[]), r.refrigerantType||'', r.suctionPressure||'', r.dischargePressure||'', r.supplyTemp||'', r.returnTemp||'', r.createdAt||new Date().toISOString());
        counts.reports++;
      }
    });
    return counts;
  });
  const counts = importAll();
  res.json({ ok: true, imported: counts });
});

// ─── CATCH-ALL → SPA ──────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FieldMark running on http://localhost:${PORT}`);
});
