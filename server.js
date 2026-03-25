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
    techNotes        TEXT DEFAULT '',
    apprenticeId     TEXT DEFAULT '',
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
  CREATE TABLE IF NOT EXISTS invoices (
    id              TEXT PRIMARY KEY,
    invoiceNumber   TEXT UNIQUE NOT NULL,
    woId            TEXT NOT NULL,
    clientId        TEXT NOT NULL,
    status          TEXT DEFAULT 'Draft',
    lineItems       TEXT DEFAULT '[]',
    subtotal        REAL DEFAULT 0,
    taxRate         REAL DEFAULT 0,
    taxAmount       REAL DEFAULT 0,
    total           REAL DEFAULT 0,
    notes           TEXT DEFAULT '',
    paymentTerms    TEXT DEFAULT '',
    dueDate         TEXT DEFAULT '',
    sentAt          TEXT DEFAULT '',
    paidAt          TEXT DEFAULT '',
    createdAt       TEXT NOT NULL,
    updatedAt       TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS warranty_credits (
    id          TEXT PRIMARY KEY,
    invoiceId   TEXT NOT NULL,
    clientId    TEXT NOT NULL,
    description TEXT DEFAULT '',
    amount      REAL DEFAULT 0,
    fiscalYear  INTEGER NOT NULL,
    createdAt   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wholesalers (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    accountNumber TEXT DEFAULT '',
    phone         TEXT DEFAULT '',
    email         TEXT DEFAULT '',
    address       TEXT DEFAULT '',
    createdAt     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subcontractors (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    trade     TEXT DEFAULT '',
    phone     TEXT DEFAULT '',
    email     TEXT DEFAULT '',
    rate      TEXT DEFAULT '',
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS purchase_orders (
    id              TEXT PRIMARY KEY,
    poNumber        TEXT UNIQUE NOT NULL,
    woId            TEXT NOT NULL,
    type            TEXT DEFAULT 'Purchase',
    wholesalerId    TEXT DEFAULT '',
    subcontractorId TEXT DEFAULT '',
    items           TEXT DEFAULT '[]',
    total           REAL DEFAULT 0,
    status          TEXT DEFAULT 'Pending',
    createdBy       TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    createdAt       TEXT NOT NULL,
    updatedAt       TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quotes (
    id              TEXT PRIMARY KEY,
    quoteNumber     TEXT UNIQUE NOT NULL,
    clientId        TEXT NOT NULL,
    locationId      TEXT DEFAULT '',
    status          TEXT DEFAULT 'Draft',
    scopeOfWork     TEXT DEFAULT '',
    inclusions      TEXT DEFAULT '',
    exclusions      TEXT DEFAULT '',
    laborEntries    TEXT DEFAULT '[]',
    partsEntries    TEXT DEFAULT '[]',
    laborSubtotal   REAL DEFAULT 0,
    laborTotal      REAL DEFAULT 0,
    partsSubtotal   REAL DEFAULT 0,
    partsTotal      REAL DEFAULT 0,
    grandTotal      REAL DEFAULT 0,
    recipients      TEXT DEFAULT '[]',
    notes           TEXT DEFAULT '',
    validUntil      TEXT DEFAULT '',
    sentAt          TEXT DEFAULT '',
    approvedAt      TEXT DEFAULT '',
    approvedBy      TEXT DEFAULT '',
    followUpSentAt  TEXT DEFAULT '',
    createdBy       TEXT DEFAULT '',
    createdAt       TEXT NOT NULL,
    updatedAt       TEXT NOT NULL,
    hideBreakdown   INTEGER DEFAULT 0
  );
`);

// Migration: add hideBreakdown column if missing
try { db.exec(`ALTER TABLE quotes ADD COLUMN hideBreakdown INTEGER DEFAULT 0`); } catch(e) { /* already exists */ }

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
try { db.exec("ALTER TABLE service_requests ADD COLUMN poNumber TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE work_orders ADD COLUMN techNotes TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE work_orders ADD COLUMN apprenticeId TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE invoices ADD COLUMN paymentAmount REAL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE invoices ADD COLUMN paymentMethod TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE invoices ADD COLUMN paymentDate TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE invoices ADD COLUMN paymentRef TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE invoices ADD COLUMN apprenticeConfirmed INTEGER DEFAULT 1"); } catch(e) {}
try { db.exec("ALTER TABLE invoices ADD COLUMN poConfirmed INTEGER DEFAULT 1"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN ratePlumber TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN rateHvacB TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN rateHvacA TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN rateElectrician TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN rateApprentice TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE equipment ADD COLUMN replacementBudget REAL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE equipment ADD COLUMN ashraeLifeYears INTEGER DEFAULT 0"); } catch(e) {}

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

function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = 'INV-' + year + '-';
  const row = db.prepare("SELECT invoiceNumber FROM invoices WHERE invoiceNumber LIKE ? ORDER BY invoiceNumber DESC LIMIT 1").get(prefix + '%');
  let seq = 1;
  if (row) {
    const parts = row.invoiceNumber.split('-');
    seq = parseInt(parts[2], 10) + 1;
  }
  return prefix + String(seq).padStart(4, '0');
}

function nextPONumber() {
  const year = new Date().getFullYear();
  const prefix = 'PO-' + year + '-';
  const row = db.prepare("SELECT poNumber FROM purchase_orders WHERE poNumber LIKE ? ORDER BY poNumber DESC LIMIT 1").get(prefix + '%');
  let seq = 1;
  if (row) {
    const parts = row.poNumber.split('-');
    seq = parseInt(parts[2], 10) + 1;
  }
  return prefix + String(seq).padStart(4, '0');
}

function nextQuoteNumber() {
  const year = new Date().getFullYear();
  const prefix = 'QTE-' + year + '-';
  const row = db.prepare("SELECT quoteNumber FROM quotes WHERE quoteNumber LIKE ? ORDER BY quoteNumber DESC LIMIT 1").get(prefix + '%');
  let seq = 1;
  if (row) {
    const parts = row.quoteNumber.split('-');
    seq = parseInt(parts[2], 10) + 1;
  }
  return prefix + String(seq).padStart(4, '0');
}

function calcQuoteTotals(laborEntries, partsEntries) {
  let laborSubtotal = 0, laborTotal = 0;
  laborEntries.forEach(e => {
    const base = (parseFloat(e.hours) || 0) * (parseFloat(e.rate) || 0);
    const marked = base * (1 + (parseFloat(e.markup) || 0) / 100);
    laborSubtotal += Math.round(base * 100) / 100;
    laborTotal += Math.round(marked * 100) / 100;
    e.total = Math.round(marked * 100) / 100;
  });
  let partsSubtotal = 0, partsTotal = 0;
  partsEntries.forEach(e => {
    const base = (parseFloat(e.qty) || 0) * (parseFloat(e.unitCost) || 0);
    const marked = base * (1 + (parseFloat(e.markup) || 0) / 100);
    partsSubtotal += Math.round(base * 100) / 100;
    partsTotal += Math.round(marked * 100) / 100;
    e.total = Math.round(marked * 100) / 100;
  });
  return {
    laborSubtotal: Math.round(laborSubtotal * 100) / 100,
    laborTotal: Math.round(laborTotal * 100) / 100,
    partsSubtotal: Math.round(partsSubtotal * 100) / 100,
    partsTotal: Math.round(partsTotal * 100) / 100,
    grandTotal: Math.round((laborTotal + partsTotal) * 100) / 100
  };
}

function generateQuoteToken(quoteId) {
  const secret = process.env.SESSION_SECRET || 'fieldmark-secret';
  return crypto.createHmac('sha256', secret).update(quoteId).digest('hex').slice(0, 16);
}

function createInvoiceForWO(woId) {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(woId);
  if (!wo) return null;
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(wo.clientId);
  if (!client) return null;

  // Build line items from labor entries
  let labor = [];
  try { labor = JSON.parse(wo.laborEntries); } catch(e) { labor = []; }
  const rate = parseFloat(client.defaultRate) || 0;
  const lineItems = labor.map(l => ({
    desc: 'Labor: ' + (l.tech || 'Technician') + (l.desc ? ' — ' + l.desc : ''),
    qty: parseFloat(l.hours) || 0,
    rate: rate,
    amount: (parseFloat(l.hours) || 0) * rate
  }));

  // Add parts from linked reports
  const reports = db.prepare("SELECT parts FROM reports WHERE workOrderNumber=?").all(wo.woNumber);
  reports.forEach(r => {
    if (r.parts && r.parts.trim()) {
      lineItems.push({ desc: 'Parts / Materials: ' + r.parts.trim(), qty: 1, rate: 0, amount: 0 });
    }
  });

  // Add purchase order line items
  const pos = db.prepare('SELECT * FROM purchase_orders WHERE woId=?').all(woId);
  let hasUnconfirmedPO = false;
  pos.forEach(po => {
    let poItems = [];
    try { poItems = JSON.parse(po.items); } catch(e) { poItems = []; }
    if (po.status !== 'Confirmed') hasUnconfirmedPO = true;
    const vendor = po.wholesalerId ? (db.prepare('SELECT name FROM wholesalers WHERE id=?').get(po.wholesalerId) || {}).name || 'Wholesaler'
      : po.subcontractorId ? (db.prepare('SELECT name FROM subcontractors WHERE id=?').get(po.subcontractorId) || {}).name || 'Subcontractor' : '';
    const prefix = po.type === 'Return' ? 'Return — ' : po.type === 'Subcontractor' ? 'Subcontractor — ' : 'Parts — ';
    poItems.forEach(item => {
      const amt = po.type === 'Return' ? -Math.abs(parseFloat(item.total) || 0) : (parseFloat(item.total) || 0);
      lineItems.push({ desc: prefix + vendor + ': ' + (item.desc || ''), qty: parseFloat(item.qty) || 1, rate: parseFloat(item.unitCost) || amt, amount: amt });
    });
  });

  const subtotal = lineItems.reduce((s, li) => s + li.amount, 0);
  const id = genId();
  const invNum = nextInvoiceNumber();
  const now = new Date().toISOString();

  // Calculate due date from payment terms
  let dueDate = '';
  const terms = client.paymentTerms || '';
  const netMatch = terms.match(/(\d+)/);
  if (netMatch) {
    const days = parseInt(netMatch[1], 10);
    const due = new Date();
    due.setDate(due.getDate() + days);
    dueDate = due.toISOString().split('T')[0];
  }

  const needsApprenticeConfirm = wo.apprenticeId ? 0 : 1;
  const needsPOConfirm = hasUnconfirmedPO ? 0 : 1;

  db.prepare(`INSERT INTO invoices (id, invoiceNumber, woId, clientId, status, lineItems, subtotal, taxRate, taxAmount, total, notes, paymentTerms, dueDate, sentAt, paidAt, apprenticeConfirmed, poConfirmed, createdAt, updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, invNum, woId, wo.clientId, 'Draft', JSON.stringify(lineItems), subtotal, 0, 0, subtotal, '', terms, dueDate, '', '', needsApprenticeConfirm, needsPOConfirm, now, now);

  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  try { inv.lineItems = JSON.parse(inv.lineItems); } catch(e) { inv.lineItems = []; }
  return inv;
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
  // Client-visible quotes — strip internal data
  const quotes = db.prepare("SELECT * FROM quotes WHERE clientId=? AND status IN ('Sent','Approved') ORDER BY createdAt DESC").all(clientId);
  quotes.forEach(q => {
    try { q.laborEntries = JSON.parse(q.laborEntries); } catch(e) { q.laborEntries = []; }
    // Strip internal pricing: replace with client-facing rates
    q.laborEntries = q.laborEntries.map(l => ({ trade: l.trade, hours: l.hours, rate: Math.round((parseFloat(l.rate)||0) * (1 + (parseFloat(l.markup)||0)/100) * 100)/100, total: l.total }));
    try { q.partsEntries = JSON.parse(q.partsEntries); } catch(e) { q.partsEntries = []; }
    q.partsEntries = q.partsEntries.map(p => ({ description: p.description, qty: p.qty, unitPrice: Math.round((parseFloat(p.unitCost)||0) * (1 + (parseFloat(p.markup)||0)/100) * 100)/100, total: p.total }));
    try { q.recipients = JSON.parse(q.recipients); } catch(e) { q.recipients = []; }
    delete q.laborSubtotal; delete q.partsSubtotal; delete q.notes;
  });
  res.json({ locations, equipment, reports, formTemplates, quotes });
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
  const invoices = req.session.user.role === 'admin' ? db.prepare('SELECT * FROM invoices ORDER BY createdAt DESC').all() : [];
  invoices.forEach(inv => { try { inv.lineItems = JSON.parse(inv.lineItems); } catch(e) { inv.lineItems = []; } });
  const wholesalers = db.prepare('SELECT * FROM wholesalers ORDER BY name').all();
  const subcontractors = db.prepare('SELECT * FROM subcontractors ORDER BY name').all();
  const quotes = req.session.user.role === 'admin' ? db.prepare('SELECT * FROM quotes ORDER BY createdAt DESC').all() : [];
  quotes.forEach(q => {
    try { q.laborEntries = JSON.parse(q.laborEntries); } catch(e) { q.laborEntries = []; }
    try { q.partsEntries = JSON.parse(q.partsEntries); } catch(e) { q.partsEntries = []; }
    try { q.recipients = JSON.parse(q.recipients); } catch(e) { q.recipients = []; }
  });
  res.json({ clients, locations, equipment, reports, formTemplates, serviceRequests, workOrders, users, timeCards, invoices, wholesalers, subcontractors, quotes });
});

// ─── CLIENTS ──────────────────────────────────────────────────────────────────
app.post('/api/clients', requireAdmin, async (req, res) => {
  const { name, phone, email, address, city, state, notes, portalPassword, logo,
          billingContact, billingEmail, billingPhone, billingAddress, paymentTerms, poRequired,
          taxId, creditLimit, accountNumber, defaultRate, arNotes,
          ratePlumber, rateHvacB, rateHvacA, rateElectrician, rateApprentice } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = genId();
  let hash = '';
  if (portalPassword && portalPassword.length >= 6) hash = await bcrypt.hash(portalPassword, 10);
  db.prepare('INSERT INTO clients (id,name,phone,email,address,city,state,notes,passwordHash,logo,billingContact,billingEmail,billingPhone,billingAddress,paymentTerms,poRequired,taxId,creditLimit,accountNumber,defaultRate,arNotes,ratePlumber,rateHvacB,rateHvacA,rateElectrician,rateApprentice,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, name, phone||'', email||'', address||'', city||'', state||'', notes||'', hash, logo||'',
         billingContact||'', billingEmail||'', billingPhone||'', billingAddress||'', paymentTerms||'', poRequired||'No',
         taxId||'', creditLimit||'', accountNumber||'', defaultRate||'', arNotes||'',
         ratePlumber||'', rateHvacB||'', rateHvacA||'', rateElectrician||'', rateApprentice||'', new Date().toISOString());
  res.json(db.prepare('SELECT * FROM clients WHERE id=?').get(id));
});

app.put('/api/clients/:id', requireAdmin, async (req, res) => {
  const { name, phone, email, address, city, state, notes, portalPassword, logo,
          billingContact, billingEmail, billingPhone, billingAddress, paymentTerms, poRequired,
          taxId, creditLimit, accountNumber, defaultRate, arNotes,
          ratePlumber, rateHvacB, rateHvacA, rateElectrician, rateApprentice } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.prepare('UPDATE clients SET name=?,phone=?,email=?,address=?,city=?,state=?,notes=?,logo=?,billingContact=?,billingEmail=?,billingPhone=?,billingAddress=?,paymentTerms=?,poRequired=?,taxId=?,creditLimit=?,accountNumber=?,defaultRate=?,arNotes=?,ratePlumber=?,rateHvacB=?,rateHvacA=?,rateElectrician=?,rateApprentice=? WHERE id=?')
    .run(name, phone||'', email||'', address||'', city||'', state||'', notes||'', logo||'',
         billingContact||'', billingEmail||'', billingPhone||'', billingAddress||'', paymentTerms||'', poRequired||'No',
         taxId||'', creditLimit||'', accountNumber||'', defaultRate||'', arNotes||'',
         ratePlumber||'', rateHvacB||'', rateHvacA||'', rateElectrician||'', rateApprentice||'', req.params.id);
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
  const { locationId, name, model, serial, yearInstalled, type, notes, formTemplateId, photo, replacementBudget, ashraeLifeYears } = req.body;
  if (!locationId || !name) return res.status(400).json({ error: 'locationId and name required' });
  const id = genId();
  db.prepare('INSERT INTO equipment (id,locationId,name,model,serial,yearInstalled,type,notes,formTemplateId,photo,replacementBudget,ashraeLifeYears,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, locationId, name, model||'', serial||'', yearInstalled||null, type||'', notes||'', formTemplateId||'', photo||'', parseFloat(replacementBudget)||0, parseInt(ashraeLifeYears)||0, new Date().toISOString());
  res.json(db.prepare('SELECT * FROM equipment WHERE id=?').get(id));
});

app.put('/api/equipment/:id', requireAdmin, (req, res) => {
  const { name, model, serial, yearInstalled, type, notes, formTemplateId, photo, replacementBudget, ashraeLifeYears } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  db.prepare('UPDATE equipment SET name=?,model=?,serial=?,yearInstalled=?,type=?,notes=?,formTemplateId=?,photo=?,replacementBudget=?,ashraeLifeYears=? WHERE id=?')
    .run(name, model||'', serial||'', yearInstalled||null, type||'', notes||'', formTemplateId||'', photo||'', parseFloat(replacementBudget)||0, parseInt(ashraeLifeYears)||0, req.params.id);
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

// ─── REPORT HTML RENDERING (reusable for PDF view and invoice embedding) ──────
function renderReportSection(r) {
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

  let h = '';

  // DATE LINE
  h += `<div style="color:#c0392b;font-size:13px;margin-bottom:10px;font-weight:600;">${e(dateStr)}</div>`;

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

  // EQUIPMENT PHOTO
  if (eq && eq.photo && eq.photo.length > 50) {
    h += `<div style="text-align:center;margin:20px 0 10px;">
<img src="${eq.photo}" style="max-width:280px;max-height:220px;border:1px solid #ccc;border-radius:4px;display:block;margin:0 auto;">
<div style="font-size:11px;font-style:italic;color:#555;margin-top:6px;">Equipment Photo</div></div>`;
  }

  // SERVICE CALL PHOTOS
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
  if (r.photoNameplate && r.photoNameplate.length > 50) {
    h += `<div style="font-size:20px;font-weight:700;text-align:center;margin:30px 0 16px;color:#1a1a1a;">Additional Images</div>`;
    h += `<table style="width:100%;"><tr>
<td style="width:50%;text-align:center;padding:8px;vertical-align:top;">
<img src="${r.photoNameplate}" style="max-width:100%;max-height:240px;border:1px solid #ccc;display:block;margin:0 auto;">
<div style="font-size:11px;color:#555;margin-top:4px;">Nameplate</div>
</td><td style="width:50%;"></td></tr></table>`;
  }

  return h;
}

// ─── PDF VIEW (server-rendered HTML with photos) ──────────────────────────────
app.get('/api/reports/:id/pdf-view', requireAuth, (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).send('Report not found');

  const eq = r.equipmentId ? db.prepare('SELECT * FROM equipment WHERE id=?').get(r.equipmentId) : null;
  const loc = eq && eq.locationId ? db.prepare('SELECT * FROM locations WHERE id=?').get(eq.locationId) : null;
  const cl = loc && loc.clientId ? db.prepare('SELECT * FROM clients WHERE id=?').get(loc.clientId) : null;

  // Use shared renderReportSection for the body, wrap in full HTML document
  let h = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FieldMark Report</title>
<style>* { margin:0; padding:0; box-sizing:border-box; } body { font-family: Arial, Helvetica, sans-serif; }
@media print { body { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; } }
@page { margin: 12mm 10mm; size: letter; }</style></head><body>
<div style="max-width:760px;margin:0 auto;padding:20px 28px 40px;font-size:13px;line-height:1.5;color:#1a1a1a;">`;

  // LOGO HEADER
  h += `<table style="width:100%;margin-bottom:14px;"><tr>
<td style="vertical-align:middle;"><div style="display:flex;align-items:center;gap:10px;">
<div style="width:36px;height:36px;background:rgba(59,130,246,.15);border-radius:8px;display:flex;align-items:center;justify-content:center;">
<svg width="20" height="20" fill="none" stroke="#3b82f6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
</div><div><div style="font-size:20px;font-weight:700;color:#3b82f6;letter-spacing:-.5px;">FieldMark</div>
<div style="font-size:10px;color:#888;">Service Management Platform</div></div></div></td>
<td style="text-align:right;vertical-align:middle;">
${cl && cl.logo && cl.logo.length > 50 ? `<img src="${cl.logo}" style="max-height:44px;max-width:160px;object-fit:contain;margin-bottom:4px;display:block;margin-left:auto;">` : ''}
</td></tr></table>`;

  h += renderReportSection(r);

  // FOOTER
  h += `<div style="margin-top:40px;padding-top:16px;border-top:1px solid #ddd;text-align:center;">
<div style="color:#c0392b;font-size:16px;font-weight:700;font-style:italic;">Thank you for choosing us - we truly appreciate your trust.</div>
<div style="color:#999;font-size:10px;margin-top:6px;">Generated by FieldMark &bull; www.field-mark.app</div>
</div></div>
<script>window.onload=function(){var imgs=document.querySelectorAll("img");var total=imgs.length;if(total===0){setTimeout(function(){window.print();},300);return;}var loaded=0,done=false;function check(){loaded++;if(!done&&loaded>=total){done=true;setTimeout(function(){window.print();},500);}}for(var i=0;i<imgs.length;i++){if(imgs[i].complete&&imgs[i].naturalWidth>0){check();}else{imgs[i].onload=check;imgs[i].onerror=check;}}setTimeout(function(){if(!done){done=true;window.print();}},8000);};<\/script></body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(h);
});

// Old report rendering code removed — now uses renderReportSection()
// (kept as comment for reference — the full report body is in renderReportSection above)

// ─── INVOICES ─────────────────────────────────────────────────────────────────
app.get('/api/invoices', requireAdmin, (req, res) => {
  const invoices = db.prepare('SELECT * FROM invoices ORDER BY createdAt DESC').all();
  invoices.forEach(inv => { try { inv.lineItems = JSON.parse(inv.lineItems); } catch(e) { inv.lineItems = []; } });
  res.json(invoices);
});

app.post('/api/invoices', requireAdmin, (req, res) => {
  const { woId } = req.body;
  if (!woId) return res.status(400).json({ error: 'Work order ID required' });
  const existing = db.prepare('SELECT id FROM invoices WHERE woId=?').get(woId);
  if (existing) return res.status(400).json({ error: 'Invoice already exists for this work order' });
  const inv = createInvoiceForWO(woId);
  if (!inv) return res.status(400).json({ error: 'Could not create invoice — work order or client not found' });
  res.json(inv);
});

app.put('/api/invoices/:id', requireAdmin, (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const { lineItems, subtotal, taxRate, taxAmount, total, notes, paymentTerms, dueDate, status, paymentAmount, paymentMethod, paymentDate, paymentRef, apprenticeConfirmed, poConfirmed } = req.body;
  const now = new Date().toISOString();
  let newStatus = status !== undefined ? status : inv.status;
  let sentAt = inv.sentAt;
  let paidAt = inv.paidAt;
  if (newStatus === 'Sent' && !inv.sentAt) sentAt = now;
  if (newStatus === 'Paid' && !inv.paidAt) paidAt = now;
  db.prepare(`UPDATE invoices SET lineItems=?, subtotal=?, taxRate=?, taxAmount=?, total=?, notes=?, paymentTerms=?, dueDate=?, status=?, sentAt=?, paidAt=?, paymentAmount=?, paymentMethod=?, paymentDate=?, paymentRef=?, apprenticeConfirmed=?, poConfirmed=?, updatedAt=? WHERE id=?`)
    .run(
      lineItems !== undefined ? JSON.stringify(lineItems) : inv.lineItems,
      subtotal !== undefined ? subtotal : inv.subtotal,
      taxRate !== undefined ? taxRate : inv.taxRate,
      taxAmount !== undefined ? taxAmount : inv.taxAmount,
      total !== undefined ? total : inv.total,
      notes !== undefined ? notes : inv.notes,
      paymentTerms !== undefined ? paymentTerms : inv.paymentTerms,
      dueDate !== undefined ? dueDate : inv.dueDate,
      newStatus, sentAt, paidAt,
      paymentAmount !== undefined ? paymentAmount : inv.paymentAmount || 0,
      paymentMethod !== undefined ? paymentMethod : inv.paymentMethod || '',
      paymentDate !== undefined ? paymentDate : inv.paymentDate || '',
      paymentRef !== undefined ? paymentRef : inv.paymentRef || '',
      apprenticeConfirmed !== undefined ? (apprenticeConfirmed ? 1 : 0) : (inv.apprenticeConfirmed != null ? inv.apprenticeConfirmed : 1),
      poConfirmed !== undefined ? (poConfirmed ? 1 : 0) : (inv.poConfirmed != null ? inv.poConfirmed : 1),
      now, req.params.id
    );
  const updated = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  try { updated.lineItems = JSON.parse(updated.lineItems); } catch(e) { updated.lineItems = []; }
  res.json(updated);
});

// ─── WHOLESALERS ──────────────────────────────────────────────────────────────
app.get('/api/wholesalers', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM wholesalers ORDER BY name').all());
});
app.post('/api/wholesalers', requireAdmin, (req, res) => {
  const { name, accountNumber, phone, email, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = genId();
  db.prepare('INSERT INTO wholesalers (id,name,accountNumber,phone,email,address,createdAt) VALUES (?,?,?,?,?,?,?)')
    .run(id, name, accountNumber||'', phone||'', email||'', address||'', new Date().toISOString());
  res.json(db.prepare('SELECT * FROM wholesalers WHERE id=?').get(id));
});
app.put('/api/wholesalers/:id', requireAdmin, (req, res) => {
  const { name, accountNumber, phone, email, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.prepare('UPDATE wholesalers SET name=?,accountNumber=?,phone=?,email=?,address=? WHERE id=?')
    .run(name, accountNumber||'', phone||'', email||'', address||'', req.params.id);
  res.json(db.prepare('SELECT * FROM wholesalers WHERE id=?').get(req.params.id));
});
app.delete('/api/wholesalers/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM wholesalers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── SUBCONTRACTORS ───────────────────────────────────────────────────────────
app.get('/api/subcontractors', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM subcontractors ORDER BY name').all());
});
app.post('/api/subcontractors', requireAdmin, (req, res) => {
  const { name, trade, phone, email, rate } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = genId();
  db.prepare('INSERT INTO subcontractors (id,name,trade,phone,email,rate,createdAt) VALUES (?,?,?,?,?,?,?)')
    .run(id, name, trade||'', phone||'', email||'', rate||'', new Date().toISOString());
  res.json(db.prepare('SELECT * FROM subcontractors WHERE id=?').get(id));
});
app.put('/api/subcontractors/:id', requireAdmin, (req, res) => {
  const { name, trade, phone, email, rate } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.prepare('UPDATE subcontractors SET name=?,trade=?,phone=?,email=?,rate=? WHERE id=?')
    .run(name, trade||'', phone||'', email||'', rate||'', req.params.id);
  res.json(db.prepare('SELECT * FROM subcontractors WHERE id=?').get(req.params.id));
});
app.delete('/api/subcontractors/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM subcontractors WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── PURCHASE ORDERS ──────────────────────────────────────────────────────────
app.get('/api/work-orders/:id/purchase-orders', requireAuth, (req, res) => {
  const pos = db.prepare('SELECT * FROM purchase_orders WHERE woId=? ORDER BY createdAt DESC').all(req.params.id);
  pos.forEach(po => { try { po.items = JSON.parse(po.items); } catch(e) { po.items = []; } });
  res.json(pos);
});

app.post('/api/work-orders/:id/purchase-orders', requireAuth, (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  const { type, wholesalerId, subcontractorId, items, notes } = req.body;
  if (!type) return res.status(400).json({ error: 'PO type required' });
  const id = genId();
  const poNum = nextPONumber();
  const now = new Date().toISOString();
  const itemsArr = Array.isArray(items) ? items : [];
  const total = itemsArr.reduce((s, li) => s + (parseFloat(li.total) || 0), 0);
  const finalTotal = type === 'Return' ? -Math.abs(total) : total;
  db.prepare('INSERT INTO purchase_orders (id,poNumber,woId,type,wholesalerId,subcontractorId,items,total,status,createdBy,notes,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, poNum, req.params.id, type, wholesalerId||'', subcontractorId||'', JSON.stringify(itemsArr), finalTotal, 'Pending', req.session.user.id, notes||'', now, now);
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);
  try { po.items = JSON.parse(po.items); } catch(e) { po.items = []; }
  res.json(po);
});

app.put('/api/purchase-orders/:id', requireAdmin, (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'PO not found' });
  const { items, notes, wholesalerId, subcontractorId } = req.body;
  const now = new Date().toISOString();
  const itemsArr = items !== undefined ? (Array.isArray(items) ? items : []) : null;
  let total = po.total;
  if (itemsArr) {
    total = itemsArr.reduce((s, li) => s + (parseFloat(li.total) || 0), 0);
    if (po.type === 'Return') total = -Math.abs(total);
  }
  db.prepare('UPDATE purchase_orders SET items=?,total=?,notes=?,wholesalerId=?,subcontractorId=?,updatedAt=? WHERE id=?')
    .run(itemsArr ? JSON.stringify(itemsArr) : po.items, total,
         notes !== undefined ? notes : po.notes,
         wholesalerId !== undefined ? wholesalerId : po.wholesalerId,
         subcontractorId !== undefined ? subcontractorId : po.subcontractorId,
         now, req.params.id);
  const updated = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(req.params.id);
  try { updated.items = JSON.parse(updated.items); } catch(e) { updated.items = []; }
  res.json(updated);
});

app.put('/api/purchase-orders/:id/confirm', requireAdmin, (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'PO not found' });
  db.prepare('UPDATE purchase_orders SET status=?,updatedAt=? WHERE id=?')
    .run('Confirmed', new Date().toISOString(), req.params.id);
  const updated = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(req.params.id);
  try { updated.items = JSON.parse(updated.items); } catch(e) { updated.items = []; }
  res.json(updated);
});

app.delete('/api/purchase-orders/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM purchase_orders WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── QUOTES ──────────────────────────────────────────────────────────────────

app.post('/api/quotes', requireAdmin, (req, res) => {
  const { clientId, locationId, scopeOfWork, laborEntries, partsEntries, inclusions, exclusions, recipients, notes, validUntil, hideBreakdown } = req.body;
  if (!clientId) return res.status(400).json({ error: 'Client required' });
  let labor = Array.isArray(laborEntries) ? laborEntries : [];
  let parts = Array.isArray(partsEntries) ? partsEntries : [];
  const totals = calcQuoteTotals(labor, parts);
  const now = new Date().toISOString();
  const id = genId();
  db.prepare(`INSERT INTO quotes (id, quoteNumber, clientId, locationId, status, scopeOfWork, inclusions, exclusions, laborEntries, partsEntries, laborSubtotal, laborTotal, partsSubtotal, partsTotal, grandTotal, recipients, notes, validUntil, hideBreakdown, createdBy, createdAt, updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, nextQuoteNumber(), clientId, locationId || '', 'Draft', scopeOfWork || '', inclusions || '', exclusions || '',
      JSON.stringify(labor), JSON.stringify(parts), totals.laborSubtotal, totals.laborTotal, totals.partsSubtotal, totals.partsTotal, totals.grandTotal,
      JSON.stringify(Array.isArray(recipients) ? recipients : []), notes || '', validUntil || '', hideBreakdown ? 1 : 0, req.session.user.name || '', now, now);
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  try { q.laborEntries = JSON.parse(q.laborEntries); } catch(e) { q.laborEntries = []; }
  try { q.partsEntries = JSON.parse(q.partsEntries); } catch(e) { q.partsEntries = []; }
  try { q.recipients = JSON.parse(q.recipients); } catch(e) { q.recipients = []; }
  res.json(q);
});

app.get('/api/quotes/:id', requireAuth, (req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Quote not found' });
  try { q.laborEntries = JSON.parse(q.laborEntries); } catch(e) { q.laborEntries = []; }
  try { q.partsEntries = JSON.parse(q.partsEntries); } catch(e) { q.partsEntries = []; }
  try { q.recipients = JSON.parse(q.recipients); } catch(e) { q.recipients = []; }
  res.json(q);
});

app.put('/api/quotes/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Quote not found' });
  const { clientId, locationId, scopeOfWork, laborEntries, partsEntries, inclusions, exclusions, recipients, notes, validUntil, hideBreakdown } = req.body;
  let labor = Array.isArray(laborEntries) ? laborEntries : [];
  let parts = Array.isArray(partsEntries) ? partsEntries : [];
  const totals = calcQuoteTotals(labor, parts);
  const now = new Date().toISOString();
  db.prepare(`UPDATE quotes SET clientId=?, locationId=?, scopeOfWork=?, inclusions=?, exclusions=?, laborEntries=?, partsEntries=?, laborSubtotal=?, laborTotal=?, partsSubtotal=?, partsTotal=?, grandTotal=?, recipients=?, notes=?, validUntil=?, hideBreakdown=?, updatedAt=? WHERE id=?`)
    .run(clientId || existing.clientId, locationId || '', scopeOfWork || '', inclusions || '', exclusions || '',
      JSON.stringify(labor), JSON.stringify(parts), totals.laborSubtotal, totals.laborTotal, totals.partsSubtotal, totals.partsTotal, totals.grandTotal,
      JSON.stringify(Array.isArray(recipients) ? recipients : []), notes || '', validUntil || '', hideBreakdown ? 1 : 0, now, req.params.id);
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  try { q.laborEntries = JSON.parse(q.laborEntries); } catch(e) { q.laborEntries = []; }
  try { q.partsEntries = JSON.parse(q.partsEntries); } catch(e) { q.partsEntries = []; }
  try { q.recipients = JSON.parse(q.recipients); } catch(e) { q.recipients = []; }
  res.json(q);
});

app.delete('/api/quotes/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM quotes WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── WARRANTY ─────────────────────────────────────────────────────────────────
app.post('/api/invoices/:id/warranty', requireAdmin, (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const { type, items } = req.body; // type: 'full' or 'partial', items: [{desc, amount}]
  const fiscalYear = new Date().getFullYear();
  const now = new Date().toISOString();
  let lineItems = [];
  try { lineItems = typeof inv.lineItems === 'string' ? JSON.parse(inv.lineItems) : inv.lineItems || []; } catch(e) { lineItems = []; }

  if (type === 'full') {
    // Full invoice to warranty
    db.prepare('INSERT INTO warranty_credits (id, invoiceId, clientId, description, amount, fiscalYear, createdAt) VALUES (?,?,?,?,?,?,?)')
      .run(genId(), inv.id, inv.clientId, 'Full invoice ' + inv.invoiceNumber, inv.total || 0, fiscalYear, now);
    db.prepare('UPDATE invoices SET status=?, updatedAt=? WHERE id=?').run('Warranty', now, inv.id);
  } else if (type === 'partial' && Array.isArray(items) && items.length > 0) {
    // Partial — add warranty credit line items with negative amounts
    let totalCredit = 0;
    items.forEach(item => {
      const amt = Math.abs(parseFloat(item.amount) || 0);
      if (amt <= 0) return;
      totalCredit += amt;
      db.prepare('INSERT INTO warranty_credits (id, invoiceId, clientId, description, amount, fiscalYear, createdAt) VALUES (?,?,?,?,?,?,?)')
        .run(genId(), inv.id, inv.clientId, item.desc || 'Warranty credit', amt, fiscalYear, now);
      lineItems.push({ desc: 'Warranty Credit: ' + (item.desc || ''), qty: 1, rate: -amt, amount: -amt });
    });
    const newSubtotal = lineItems.reduce((s, li) => s + (li.amount || 0), 0);
    const newTaxAmt = newSubtotal * (inv.taxRate || 0);
    const newTotal = newSubtotal + newTaxAmt;
    db.prepare('UPDATE invoices SET lineItems=?, subtotal=?, taxAmount=?, total=?, updatedAt=? WHERE id=?')
      .run(JSON.stringify(lineItems), newSubtotal, newTaxAmt, newTotal, now, inv.id);
  } else {
    return res.status(400).json({ error: 'Invalid warranty request — specify type (full/partial) and items' });
  }

  const updated = db.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id);
  try { updated.lineItems = JSON.parse(updated.lineItems); } catch(e) { updated.lineItems = []; }
  res.json(updated);
});

app.get('/api/warranty', requireAdmin, (req, res) => {
  const year = req.query.year ? parseInt(req.query.year) : null;
  const clientId = req.query.clientId || null;
  let sql = 'SELECT * FROM warranty_credits WHERE 1=1';
  const params = [];
  if (year) { sql += ' AND fiscalYear=?'; params.push(year); }
  if (clientId) { sql += ' AND clientId=?'; params.push(clientId); }
  sql += ' ORDER BY createdAt DESC';
  const credits = db.prepare(sql).all(...params);
  res.json(credits);
});

app.get('/api/clients/:id/billing-summary', requireAdmin, (req, res) => {
  const clientId = req.params.id;
  const invoices = db.prepare('SELECT * FROM invoices WHERE clientId=? ORDER BY createdAt DESC').all(clientId);
  const warrantyCreds = db.prepare('SELECT * FROM warranty_credits WHERE clientId=? ORDER BY createdAt DESC').all(clientId);

  // Yearly breakdown
  const years = {};
  invoices.forEach(inv => {
    const yr = inv.createdAt ? parseInt(inv.createdAt.slice(0, 4)) : new Date().getFullYear();
    if (!years[yr]) years[yr] = { year: yr, billed: 0, billedCount: 0, warranty: 0 };
    if (inv.status === 'Paid') { years[yr].billed += inv.paymentAmount || inv.total || 0; years[yr].billedCount++; }
  });
  warrantyCreds.forEach(wc => {
    if (!years[wc.fiscalYear]) years[wc.fiscalYear] = { year: wc.fiscalYear, billed: 0, billedCount: 0, warranty: 0 };
    years[wc.fiscalYear].warranty += wc.amount || 0;
  });

  const yearlyBreakdown = Object.values(years).sort((a, b) => b.year - a.year);
  const totalBilled = yearlyBreakdown.reduce((s, y) => s + y.billed, 0);
  const totalWarranty = yearlyBreakdown.reduce((s, y) => s + y.warranty, 0);

  res.json({ yearlyBreakdown, totalBilled, totalWarranty, warrantyCreds });
});

// ─── INVOICE PDF VIEW ─────────────────────────────────────────────────────────
function renderInvoiceHtml(inv) {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(inv.woId);
  const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(inv.clientId);
  const loc = wo ? db.prepare('SELECT * FROM locations WHERE id=?').get(wo.locationId) : null;
  const eq = wo && wo.equipmentId ? db.prepare('SELECT * FROM equipment WHERE id=?').get(wo.equipmentId) : null;
  let items = [];
  try { items = typeof inv.lineItems === 'string' ? JSON.parse(inv.lineItems) : inv.lineItems || []; } catch(e) { items = []; }

  function e(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function money(n) { return '$' + (parseFloat(n)||0).toFixed(2); }

  let h = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice ${e(inv.invoiceNumber)}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, Helvetica, sans-serif; }
@media print { body { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; } }
@page { margin: 12mm 10mm; size: letter; }
</style></head><body>
<div style="max-width:760px;margin:0 auto;padding:20px 28px 40px;font-size:13px;line-height:1.5;color:#1a1a1a;">`;

  // LOGO HEADER
  const hasLogo = cl && cl.logo && cl.logo.length > 50;
  h += `<table style="width:100%;margin-bottom:20px;"><tr>`;
  h += `<td style="vertical-align:middle;"><div style="font-size:22px;font-weight:700;color:#c0392b;">FieldMark</div><div style="font-size:11px;color:#666;">Service Management</div></td>`;
  if (hasLogo) h += `<td style="text-align:right;vertical-align:middle;"><img src="${cl.logo}" style="max-height:50px;max-width:140px;"></td>`;
  h += `</tr></table>`;

  // INVOICE HEADER
  h += `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
<tr><th colspan="2" style="background:#c0392b;color:#fff;font-size:16px;font-weight:700;text-align:center;padding:10px;">INVOICE</th></tr>
<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:700;width:50%;">Invoice Number</td><td style="padding:6px 12px;border:1px solid #ddd;">${e(inv.invoiceNumber)}</td></tr>
<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:700;">Date</td><td style="padding:6px 12px;border:1px solid #ddd;">${e(inv.createdAt ? inv.createdAt.split('T')[0] : '')}</td></tr>
<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:700;">Due Date</td><td style="padding:6px 12px;border:1px solid #ddd;">${e(inv.dueDate||'Upon Receipt')}</td></tr>
<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:700;">Work Order</td><td style="padding:6px 12px;border:1px solid #ddd;">${e(wo?wo.woNumber:'')}</td></tr>
<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:700;">Payment Terms</td><td style="padding:6px 12px;border:1px solid #ddd;">${e(inv.paymentTerms||'Due on Receipt')}</td></tr>
</table>`;

  // BILL TO
  h += `<div style="font-size:15px;font-weight:700;margin:16px 0 8px;color:#1a1a1a;">Bill To</div>`;
  h += `<table style="width:100%;margin-bottom:20px;">
<tr><td style="padding:4px 0;font-size:13px;font-weight:700;">${e(cl?cl.name:'')}</td></tr>`;
  if (cl && cl.billingContact) h += `<tr><td style="padding:2px 0;font-size:12px;">Attn: ${e(cl.billingContact)}</td></tr>`;
  if (cl && cl.billingAddress) h += `<tr><td style="padding:2px 0;font-size:12px;">${e(cl.billingAddress)}</td></tr>`;
  if (cl && cl.billingEmail) h += `<tr><td style="padding:2px 0;font-size:12px;">${e(cl.billingEmail)}</td></tr>`;
  if (cl && cl.billingPhone) h += `<tr><td style="padding:2px 0;font-size:12px;">${e(cl.billingPhone)}</td></tr>`;
  if (cl && cl.accountNumber) h += `<tr><td style="padding:2px 0;font-size:12px;">Account: ${e(cl.accountNumber)}</td></tr>`;
  h += `</table>`;

  // SERVICE DETAILS
  if (wo) {
    h += `<div style="font-size:15px;font-weight:700;margin:16px 0 8px;color:#1a1a1a;">Service Details</div>`;
    h += `<table style="width:100%;margin-bottom:20px;font-size:12px;">
<tr><td style="padding:3px 0;font-weight:600;width:120px;">Location:</td><td>${e(loc?loc.buildingName:'')}</td></tr>
<tr><td style="padding:3px 0;font-weight:600;">Equipment:</td><td>${e(eq?eq.name:'')}</td></tr>
<tr><td style="padding:3px 0;font-weight:600;">Description:</td><td>${e(wo.description||'')}</td></tr>
</table>`;
  }

  // LINE ITEMS TABLE
  h += `<table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
<tr style="background:#333;color:#fff;">
<th style="padding:8px 10px;text-align:left;font-size:12px;">Description</th>
<th style="padding:8px 10px;text-align:center;font-size:12px;width:60px;">Qty</th>
<th style="padding:8px 10px;text-align:right;font-size:12px;width:80px;">Rate</th>
<th style="padding:8px 10px;text-align:right;font-size:12px;width:90px;">Amount</th>
</tr>`;
  items.forEach((li, i) => {
    const bg = i % 2 === 0 ? '#fff' : '#f8f8f8';
    h += `<tr style="background:${bg};">
<td style="padding:6px 10px;font-size:12px;border-bottom:1px solid #eee;">${e(li.desc)}</td>
<td style="padding:6px 10px;font-size:12px;text-align:center;border-bottom:1px solid #eee;">${li.qty}</td>
<td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #eee;">${money(li.rate)}</td>
<td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #eee;">${money(li.amount)}</td>
</tr>`;
  });
  h += `</table>`;

  // TOTALS
  h += `<table style="width:300px;margin-left:auto;margin-bottom:20px;">
<tr><td style="padding:4px 10px;font-size:13px;font-weight:600;">Subtotal</td><td style="padding:4px 10px;font-size:13px;text-align:right;">${money(inv.subtotal)}</td></tr>`;
  if (inv.taxRate > 0) {
    h += `<tr><td style="padding:4px 10px;font-size:13px;font-weight:600;">Tax (${(inv.taxRate*100).toFixed(1)}%)</td><td style="padding:4px 10px;font-size:13px;text-align:right;">${money(inv.taxAmount)}</td></tr>`;
  }
  h += `<tr style="border-top:2px solid #333;"><td style="padding:8px 10px;font-size:15px;font-weight:700;">Total</td><td style="padding:8px 10px;font-size:15px;font-weight:700;text-align:right;">${money(inv.total)}</td></tr>
</table>`;

  // NOTES
  if (inv.notes) {
    h += `<div style="margin:16px 0;padding:10px;background:#f5f5f5;border-radius:6px;font-size:12px;"><strong>Notes:</strong> ${e(inv.notes)}</div>`;
  }

  // LINKED SERVICE REPORTS
  if (wo) {
    const linkedReports = db.prepare("SELECT * FROM reports WHERE workOrderNumber=?").all(wo.woNumber);
    if (linkedReports.length > 0) {
      linkedReports.forEach((report, idx) => {
        h += `<div style="page-break-before:always;"></div>`;
        h += `<div style="background:#c0392b;color:#fff;font-size:16px;font-weight:700;text-align:center;padding:10px;margin-bottom:16px;">SERVICE REPORT ${idx + 1} of ${linkedReports.length}</div>`;
        h += renderReportSection(report);
        h += `<div style="margin-top:30px;padding-top:12px;border-top:1px solid #ddd;text-align:center;color:#999;font-size:10px;">End of Service Report ${idx + 1}</div>`;
      });
    }
  }

  // FOOTER
  h += `<div style="margin-top:40px;padding-top:16px;border-top:1px solid #ddd;text-align:center;">
<div style="color:#c0392b;font-size:14px;font-weight:700;font-style:italic;">Thank you for your business!</div>
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
  return h;
}

app.get('/api/invoices/:id/pdf-view', requireAuth, (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).send('Invoice not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderInvoiceHtml(inv));
});

// ─── QUOTE PDF ───────────────────────────────────────────────────────────────

function renderQuoteHtml(qt) {
  const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(qt.clientId);
  const loc = qt.locationId ? db.prepare('SELECT * FROM locations WHERE id=?').get(qt.locationId) : null;
  let labor = [];
  try { labor = typeof qt.laborEntries === 'string' ? JSON.parse(qt.laborEntries) : qt.laborEntries || []; } catch(e) { labor = []; }
  let parts = [];
  try { parts = typeof qt.partsEntries === 'string' ? JSON.parse(qt.partsEntries) : qt.partsEntries || []; } catch(e) { parts = []; }

  function e(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function money(n) { return '$' + (parseFloat(n)||0).toFixed(2); }
  function nl2br(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

  let h = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quote ${e(qt.quoteNumber)}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, Helvetica, sans-serif; }
@media print { body { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; } }
@page { margin: 12mm 10mm; size: letter; }
</style></head><body>
<div style="max-width:760px;margin:0 auto;padding:20px 28px 40px;font-size:13px;line-height:1.5;color:#1a1a1a;">`;

  // LOGO HEADER
  const hasLogo = cl && cl.logo && cl.logo.length > 50;
  h += `<table style="width:100%;margin-bottom:20px;"><tr>`;
  h += `<td style="vertical-align:middle;"><div style="font-size:22px;font-weight:700;color:#3b82f6;">FieldMark</div><div style="font-size:11px;color:#666;">Service Management</div></td>`;
  if (hasLogo) h += `<td style="text-align:right;vertical-align:middle;"><img src="${cl.logo}" style="max-height:50px;max-width:140px;"></td>`;
  h += `</tr></table>`;

  // QUOTE HEADER
  h += `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
<tr><th colspan="2" style="background:#3b82f6;color:#fff;font-size:16px;font-weight:700;text-align:center;padding:10px;">QUOTE</th></tr>
<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:700;width:50%;">Quote Number</td><td style="padding:6px 12px;border:1px solid #ddd;">${e(qt.quoteNumber)}</td></tr>
<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:700;">Date</td><td style="padding:6px 12px;border:1px solid #ddd;">${e(qt.createdAt ? qt.createdAt.split('T')[0] : '')}</td></tr>
<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:700;">Valid Until</td><td style="padding:6px 12px;border:1px solid #ddd;">${e(qt.validUntil || 'N/A')}</td></tr>
<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:700;">Client</td><td style="padding:6px 12px;border:1px solid #ddd;">${e(cl?cl.name:'')}</td></tr>`;
  if (loc) h += `<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:700;">Location</td><td style="padding:6px 12px;border:1px solid #ddd;">${e(loc.buildingName||'')}</td></tr>`;
  h += `</table>`;

  // PREPARED FOR
  h += `<div style="font-size:15px;font-weight:700;margin:16px 0 8px;color:#1a1a1a;">Prepared For</div>`;
  h += `<table style="width:100%;margin-bottom:20px;">
<tr><td style="padding:4px 0;font-size:13px;font-weight:700;">${e(cl?cl.name:'')}</td></tr>`;
  if (cl && cl.billingContact) h += `<tr><td style="padding:2px 0;font-size:12px;">Attn: ${e(cl.billingContact)}</td></tr>`;
  if (cl && cl.address) h += `<tr><td style="padding:2px 0;font-size:12px;">${e(cl.address)}</td></tr>`;
  if (cl && cl.email) h += `<tr><td style="padding:2px 0;font-size:12px;">${e(cl.email)}</td></tr>`;
  if (cl && cl.phone) h += `<tr><td style="padding:2px 0;font-size:12px;">${e(cl.phone)}</td></tr>`;
  h += `</table>`;

  // SCOPE OF WORK
  if (qt.scopeOfWork) {
    h += `<div style="font-size:15px;font-weight:700;margin:16px 0 8px;color:#1a1a1a;">Scope of Work</div>`;
    h += `<div style="margin-bottom:20px;padding:10px 14px;background:#f8f9fa;border-radius:6px;font-size:12px;line-height:1.6;">${nl2br(qt.scopeOfWork)}</div>`;
  }

  // COST BREAKDOWN TABLE
  if (qt.hideBreakdown) {
    // Grand total only — no line-item breakdown
    h += `<div style="margin:24px 0;padding:20px;background:#f8f9fa;border-radius:8px;text-align:center;">
<div style="font-size:13px;color:#666;margin-bottom:6px;">Quote Total</div>
<div style="font-size:28px;font-weight:700;color:#1a1a1a;">${money(qt.grandTotal)}</div>
</div>`;
  } else {
    h += `<div style="font-size:15px;font-weight:700;margin:16px 0 8px;color:#1a1a1a;">Cost Breakdown</div>`;
    h += `<table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
<tr style="background:#333;color:#fff;">
<th style="padding:8px 10px;text-align:left;font-size:12px;">Description</th>
<th style="padding:8px 10px;text-align:center;font-size:12px;width:60px;">Qty/Hrs</th>
<th style="padding:8px 10px;text-align:right;font-size:12px;width:80px;">Rate</th>
<th style="padding:8px 10px;text-align:right;font-size:12px;width:90px;">Amount</th>
</tr>`;

    // LABOR rows
    let rowIdx = 0;
    if (labor.length > 0) {
      h += `<tr style="background:#e8f0fe;"><td colspan="4" style="padding:6px 10px;font-size:12px;font-weight:700;color:#3b82f6;">Labor</td></tr>`;
      labor.forEach(l => {
        const hrs = parseFloat(l.hours) || 0;
        const baseRate = parseFloat(l.rate) || 0;
        const mkup = parseFloat(l.markup) || 0;
        const clientRate = Math.round(baseRate * (1 + mkup / 100) * 100) / 100;
        const lineTotal = Math.round(hrs * clientRate * 100) / 100;
        const bg = rowIdx % 2 === 0 ? '#fff' : '#f8f8f8';
        h += `<tr style="background:${bg};">
<td style="padding:6px 10px;font-size:12px;border-bottom:1px solid #eee;">${e(l.trade || 'Labor')}</td>
<td style="padding:6px 10px;font-size:12px;text-align:center;border-bottom:1px solid #eee;">${hrs}</td>
<td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #eee;">${money(clientRate)}/hr</td>
<td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #eee;">${money(lineTotal)}</td>
</tr>`;
        rowIdx++;
      });
      h += `<tr style="background:#f0f0f0;"><td colspan="3" style="padding:6px 10px;font-size:12px;font-weight:600;text-align:right;">Labor Subtotal</td><td style="padding:6px 10px;font-size:12px;font-weight:600;text-align:right;">${money(qt.laborTotal)}</td></tr>`;
    }

    // PARTS rows
    if (parts.length > 0) {
      h += `<tr style="background:#e8f0fe;"><td colspan="4" style="padding:6px 10px;font-size:12px;font-weight:700;color:#3b82f6;">Parts & Materials</td></tr>`;
      rowIdx = 0;
      parts.forEach(p => {
        const qty = parseFloat(p.qty) || 0;
        const baseCost = parseFloat(p.unitCost) || 0;
        const mkup = parseFloat(p.markup) || 0;
        const clientPrice = Math.round(baseCost * (1 + mkup / 100) * 100) / 100;
        const lineTotal = Math.round(qty * clientPrice * 100) / 100;
        const bg = rowIdx % 2 === 0 ? '#fff' : '#f8f8f8';
        h += `<tr style="background:${bg};">
<td style="padding:6px 10px;font-size:12px;border-bottom:1px solid #eee;">${e(p.description || 'Parts')}</td>
<td style="padding:6px 10px;font-size:12px;text-align:center;border-bottom:1px solid #eee;">${qty}</td>
<td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #eee;">${money(clientPrice)}</td>
<td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #eee;">${money(lineTotal)}</td>
</tr>`;
        rowIdx++;
      });
      h += `<tr style="background:#f0f0f0;"><td colspan="3" style="padding:6px 10px;font-size:12px;font-weight:600;text-align:right;">Parts & Materials Subtotal</td><td style="padding:6px 10px;font-size:12px;font-weight:600;text-align:right;">${money(qt.partsTotal)}</td></tr>`;
    }

    // GRAND TOTAL
    h += `<tr style="border-top:2px solid #333;"><td colspan="3" style="padding:10px;font-size:16px;font-weight:700;text-align:right;">Total</td><td style="padding:10px;font-size:16px;font-weight:700;text-align:right;">${money(qt.grandTotal)}</td></tr>
</table>`;
  }

  // INCLUSIONS
  if (qt.inclusions) {
    h += `<div style="font-size:15px;font-weight:700;margin:20px 0 8px;color:#1a1a1a;">Inclusions</div>`;
    h += `<div style="margin-bottom:16px;padding:10px 14px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:4px;font-size:12px;line-height:1.6;">${nl2br(qt.inclusions)}</div>`;
  }

  // EXCLUSIONS
  if (qt.exclusions) {
    h += `<div style="font-size:15px;font-weight:700;margin:20px 0 8px;color:#1a1a1a;">Exclusions</div>`;
    h += `<div style="margin-bottom:16px;padding:10px 14px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:4px;font-size:12px;line-height:1.6;">${nl2br(qt.exclusions)}</div>`;
  }

  // FOOTER
  h += `<div style="margin-top:40px;padding-top:16px;border-top:1px solid #ddd;text-align:center;">
<div style="color:#3b82f6;font-size:14px;font-weight:700;">Thank you for considering FieldMark!</div>
<div style="color:#666;font-size:11px;margin-top:6px;">This quote is valid until ${e(qt.validUntil || 'further notice')}.</div>
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
  return h;
}

app.get('/api/quotes/:id/pdf-view', requireAuth, (req, res) => {
  const qt = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!qt) return res.status(404).send('Quote not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderQuoteHtml(qt));
});

// Token-based quote view for clients (no auth required)
app.get('/api/quotes/:id/client-view', (req, res) => {
  const qt = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!qt) return res.status(404).send('Quote not found');
  const expectedToken = generateQuoteToken(qt.id);
  if (req.query.token !== expectedToken) return res.status(403).send('Invalid or expired link');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderQuoteHtml(qt));
});

// Token-based quote approval from email link (no auth required)
app.get('/api/quotes/:id/approve-link', (req, res) => {
  const qt = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!qt) return res.status(404).send('Quote not found');
  const expectedToken = generateQuoteToken(qt.id);
  if (req.query.token !== expectedToken) return res.status(403).send('Invalid or expired link');
  if (qt.status === 'Approved') {
    return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quote Already Approved</title></head><body style="font-family:Arial,sans-serif;text-align:center;padding:60px 20px;">
<div style="max-width:500px;margin:0 auto;"><div style="font-size:48px;margin-bottom:16px;">&#10003;</div>
<h1 style="color:#22c55e;">Quote Already Approved</h1>
<p style="color:#666;margin-top:12px;">Quote ${qt.quoteNumber} was already approved on ${qt.approvedAt ? qt.approvedAt.split('T')[0] : 'a previous date'}.</p>
<p style="color:#999;margin-top:20px;font-size:12px;">FieldMark &bull; www.field-mark.app</p></div></body></html>`);
  }
  if (qt.status !== 'Sent') {
    return res.status(400).send('This quote cannot be approved at this time.');
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE quotes SET status='Approved', approvedAt=?, approvedBy='client', updatedAt=? WHERE id=?").run(now, now, qt.id);

  // Send admin notification email
  try {
    const cfg = getEmailSettings();
    if (cfg.enabled && cfg.smtpUser && cfg.smtpPass) {
      const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(qt.clientId);
      const fromName = cfg.fromName || 'FieldMark';
      const transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: cfg.smtpUser, pass: cfg.smtpPass } });
      transporter.sendMail({
        from: `"${fromName}" <${cfg.smtpUser}>`,
        to: cfg.smtpUser,
        subject: `Quote ${qt.quoteNumber} Approved — ${cl ? cl.name : 'Client'}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
<div style="background:#22c55e;color:#fff;padding:20px;text-align:center;font-size:18px;font-weight:700;">Quote Approved!</div>
<div style="padding:20px;background:#f9f9f9;">
<p><strong>Quote:</strong> ${qt.quoteNumber}</p>
<p><strong>Client:</strong> ${cl ? cl.name : 'Unknown'}</p>
<p><strong>Total:</strong> $${(qt.grandTotal||0).toFixed(2)}</p>
<p><strong>Approved:</strong> ${now.split('T')[0]} via email link</p>
</div>
<div style="padding:12px;text-align:center;color:#999;font-size:11px;">FieldMark &bull; www.field-mark.app</div>
</div>`
      });
    }
  } catch(err) { console.error('Quote approval notification error:', err.message); }

  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quote Approved</title></head><body style="font-family:Arial,sans-serif;text-align:center;padding:60px 20px;">
<div style="max-width:500px;margin:0 auto;"><div style="font-size:48px;margin-bottom:16px;">&#10003;</div>
<h1 style="color:#22c55e;">Quote Approved!</h1>
<p style="color:#666;margin-top:12px;">Thank you! Quote ${qt.quoteNumber} has been approved. Our team has been notified and will be in touch shortly.</p>
<p style="color:#999;margin-top:20px;font-size:12px;">FieldMark &bull; www.field-mark.app</p></div></body></html>`);
});

// Client portal quote approval
app.post('/api/quotes/:id/approve', requireClientAuth, (req, res) => {
  const qt = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!qt) return res.status(404).json({ error: 'Quote not found' });
  if (qt.status !== 'Sent') return res.status(400).json({ error: 'Quote cannot be approved' });
  if (qt.clientId !== req.session.client.clientId) return res.status(403).json({ error: 'Access denied' });
  const now = new Date().toISOString();
  db.prepare("UPDATE quotes SET status='Approved', approvedAt=?, approvedBy='client', updatedAt=? WHERE id=?").run(now, now, qt.id);

  // Send admin notification
  try {
    const cfg = getEmailSettings();
    if (cfg.enabled && cfg.smtpUser && cfg.smtpPass) {
      const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(qt.clientId);
      const fromName = cfg.fromName || 'FieldMark';
      const transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: cfg.smtpUser, pass: cfg.smtpPass } });
      transporter.sendMail({
        from: `"${fromName}" <${cfg.smtpUser}>`,
        to: cfg.smtpUser,
        subject: `Quote ${qt.quoteNumber} Approved — ${cl ? cl.name : 'Client'}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
<div style="background:#22c55e;color:#fff;padding:20px;text-align:center;font-size:18px;font-weight:700;">Quote Approved!</div>
<div style="padding:20px;background:#f9f9f9;">
<p><strong>Quote:</strong> ${qt.quoteNumber}</p>
<p><strong>Client:</strong> ${cl ? cl.name : 'Unknown'}</p>
<p><strong>Total:</strong> $${(qt.grandTotal||0).toFixed(2)}</p>
<p><strong>Approved:</strong> ${now.split('T')[0]} via client portal</p>
</div></div>`
      });
    }
  } catch(err) { console.error('Quote approval notification error:', err.message); }

  res.json({ ok: true });
});

// Admin manual approval
app.post('/api/quotes/:id/admin-approve', requireAdmin, (req, res) => {
  const qt = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!qt) return res.status(404).json({ error: 'Quote not found' });
  const now = new Date().toISOString();
  db.prepare("UPDATE quotes SET status='Approved', approvedAt=?, approvedBy='admin', updatedAt=? WHERE id=?").run(now, now, qt.id);
  const updated = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  try { updated.laborEntries = JSON.parse(updated.laborEntries); } catch(e) { updated.laborEntries = []; }
  try { updated.partsEntries = JSON.parse(updated.partsEntries); } catch(e) { updated.partsEntries = []; }
  try { updated.recipients = JSON.parse(updated.recipients); } catch(e) { updated.recipients = []; }
  res.json(updated);
});

// Send quote email
app.post('/api/quotes/:id/send', requireAdmin, async (req, res) => {
  const qt = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!qt) return res.status(404).json({ error: 'Quote not found' });
  let recipients = [];
  try { recipients = JSON.parse(qt.recipients); } catch(e) {}
  // Allow overriding recipients from request body
  if (req.body.recipients && Array.isArray(req.body.recipients) && req.body.recipients.length > 0) {
    recipients = req.body.recipients;
    db.prepare("UPDATE quotes SET recipients=? WHERE id=?").run(JSON.stringify(recipients), qt.id);
  }
  if (recipients.length === 0) return res.status(400).json({ error: 'No recipients specified' });
  const cfg = getEmailSettings();
  if (!cfg.enabled || !cfg.smtpUser || !cfg.smtpPass) return res.status(400).json({ error: 'Email not configured. Go to Settings → Email to configure SMTP.' });
  const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(qt.clientId);
  const fromName = cfg.fromName || 'FieldMark';
  const token = generateQuoteToken(qt.id);
  const baseUrl = req.protocol + '://' + req.get('host');
  const viewUrl = baseUrl + '/api/quotes/' + qt.id + '/client-view?token=' + token;
  const approveUrl = baseUrl + '/api/quotes/' + qt.id + '/approve-link?token=' + token;

  try {
    const transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: cfg.smtpUser, pass: cfg.smtpPass } });
    await transporter.sendMail({
      from: `"${fromName}" <${cfg.smtpUser}>`,
      to: recipients.join(', '),
      subject: `Quote ${qt.quoteNumber} from ${fromName}${cl ? ' — ' + cl.name : ''}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
<div style="background:#3b82f6;color:#fff;padding:20px;text-align:center;">
<div style="font-size:22px;font-weight:700;">${fromName}</div>
<div style="font-size:11px;opacity:.8;margin-top:4px;">Service Management</div>
</div>
<div style="padding:24px;background:#fff;">
<h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Quote ${qt.quoteNumber}</h2>
<table style="width:100%;margin-bottom:20px;font-size:13px;">
<tr><td style="padding:4px 0;font-weight:600;">Client:</td><td>${cl ? cl.name : ''}</td></tr>
<tr><td style="padding:4px 0;font-weight:600;">Date:</td><td>${qt.createdAt ? qt.createdAt.split('T')[0] : ''}</td></tr>
<tr><td style="padding:4px 0;font-weight:600;">Valid Until:</td><td>${qt.validUntil || 'N/A'}</td></tr>
<tr><td style="padding:4px 0;font-weight:600;">Total:</td><td style="font-size:18px;font-weight:700;color:#3b82f6;">$${(qt.grandTotal||0).toFixed(2)}</td></tr>
</table>
<div style="text-align:center;margin:24px 0;">
<a href="${viewUrl}" style="display:inline-block;padding:12px 28px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;margin-right:8px;">View Quote</a>
<a href="${approveUrl}" style="display:inline-block;padding:12px 28px;background:#22c55e;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Approve Quote</a>
</div>
</div>
<div style="padding:16px;text-align:center;background:#f5f5f5;color:#999;font-size:11px;">
${fromName} &bull; www.field-mark.app
</div>
</div>`
    });

    const now = new Date().toISOString();
    if (qt.status === 'Draft') {
      db.prepare("UPDATE quotes SET status='Sent', sentAt=?, updatedAt=? WHERE id=?").run(now, now, qt.id);
    } else {
      db.prepare("UPDATE quotes SET updatedAt=? WHERE id=?").run(now, qt.id);
    }
    const updated = db.prepare('SELECT * FROM quotes WHERE id=?').get(qt.id);
    try { updated.laborEntries = JSON.parse(updated.laborEntries); } catch(e) { updated.laborEntries = []; }
    try { updated.partsEntries = JSON.parse(updated.partsEntries); } catch(e) { updated.partsEntries = []; }
    try { updated.recipients = JSON.parse(updated.recipients); } catch(e) { updated.recipients = []; }
    res.json(updated);
  } catch(err) {
    console.error('Quote send error:', err);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

app.post('/api/invoices/:id/send', requireAdmin, async (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!inv.apprenticeConfirmed) return res.status(400).json({ error: 'Cannot send — apprentice time has not been confirmed. Please review and confirm apprentice hours before sending.' });
  if (!inv.poConfirmed) return res.status(400).json({ error: 'Cannot send — purchase orders have not been confirmed. Please review and confirm all POs before sending.' });
  const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(inv.clientId);
  if (!cl || !cl.billingEmail) return res.status(400).json({ error: 'Client has no billing email address configured' });
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(inv.woId);
  const cfg = getEmailSettings();
  if (!cfg.enabled || !cfg.smtpUser || !cfg.smtpPass) return res.status(400).json({ error: 'Email not configured — check Settings' });

  try {
    const fromName = cfg.fromName || 'FieldMark';
    const attachments = [];

    // Try to generate PDF attachments (requires html-pdf-node + Puppeteer on server)
    try {
      const htmlPdfNode = require('html-pdf-node');
      const invoiceHtml = renderInvoiceHtml(inv);
      const invoicePdf = await htmlPdfNode.generatePdf({ content: invoiceHtml }, { format: 'Letter', printBackground: true });
      attachments.push({ filename: inv.invoiceNumber + '.pdf', content: invoicePdf });
    } catch(pdfErr) {
      console.log('PDF generation not available, sending email without attachment:', pdfErr.message);
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    });

    await transporter.sendMail({
      from: `"${fromName}" <${cfg.smtpUser}>`,
      to: cl.billingEmail,
      subject: `Invoice ${inv.invoiceNumber} — ${fromName}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#c0392b;">Invoice ${inv.invoiceNumber}</h2>
<p>Dear ${cl.billingContact || cl.name},</p>
<p>Please find ${attachments.length ? 'attached ' : ''}your invoice for work order ${wo?wo.woNumber:''}.</p>
<table style="width:100%;margin:20px 0;border-collapse:collapse;">
<tr><td style="padding:6px;font-weight:700;border-bottom:1px solid #ddd;">Invoice Total</td><td style="padding:6px;border-bottom:1px solid #ddd;text-align:right;">$${(inv.total||0).toFixed(2)}</td></tr>
<tr><td style="padding:6px;font-weight:700;border-bottom:1px solid #ddd;">Due Date</td><td style="padding:6px;border-bottom:1px solid #ddd;text-align:right;">${inv.dueDate||'Upon Receipt'}</td></tr>
<tr><td style="padding:6px;font-weight:700;border-bottom:1px solid #ddd;">Payment Terms</td><td style="padding:6px;border-bottom:1px solid #ddd;text-align:right;">${inv.paymentTerms||'Due on Receipt'}</td></tr>
</table>
<p>Thank you for your business!</p>
<div style="margin-top:30px;color:#999;font-size:11px;">Generated by FieldMark &bull; www.field-mark.app</div>
</div>`,
      attachments: attachments.length ? attachments : undefined,
    });

    // Update status to Sent
    const now = new Date().toISOString();
    db.prepare('UPDATE invoices SET status=?, sentAt=?, updatedAt=? WHERE id=?').run('Sent', now, now, inv.id);
    const updated = db.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id);
    try { updated.lineItems = JSON.parse(updated.lineItems); } catch(e) { updated.lineItems = []; }
    res.json(updated);
  } catch(err) {
    console.error('Invoice send error:', err);
    res.status(500).json({ error: 'Failed to send invoice: ' + err.message });
  }
});

// ─── SERVICE REQUESTS ─────────────────────────────────────────────────────────
app.post('/api/service-requests', requireClientAuth, async (req, res) => {
  const cfg = getEmailSettings();
  const { locationId, equipmentId, urgency, description, photos, poNumber } = req.body;
  if (!locationId || !urgency || !description) return res.status(400).json({ error: 'Location, urgency, and description are required' });

  // Check if client requires PO
  const clientData = db.prepare('SELECT poRequired FROM clients WHERE id=?').get(req.session.client.id);
  if (clientData && clientData.poRequired === 'Yes' && (!poNumber || !poNumber.trim())) {
    return res.status(400).json({ error: 'A Purchase Order number is required to submit a service request' });
  }

  // Store in database
  const srId = genId();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO service_requests (id,clientId,locationId,equipmentId,urgency,description,photos,status,poNumber,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(srId, req.session.client.id, locationId, equipmentId||'', urgency, description, JSON.stringify(photos||[]), 'New', poNumber||'', now);

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
          ${poNumber ? `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px 0;color:#64748b">Purchase Order #</td>
            <td style="padding:10px 0;font-weight:600">${poNumber}</td>
          </tr>` : ''}
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
  const assignedArr = Array.isArray(assignedTo) ? JSON.stringify(assignedTo) : (assignedTo ? JSON.stringify([assignedTo]) : '[]');
  db.prepare(`INSERT INTO work_orders (id,woNumber,clientId,locationId,equipmentId,description,status,priority,assignedTo,serviceRequestId,laborEntries,notes,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, woNumber, clientId, locationId, equipmentId||'', description||'', 'Open', priority||'Normal', assignedArr, serviceRequestId||'', '[]', '', now, now);
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(id);
  try { wo.laborEntries = JSON.parse(wo.laborEntries); } catch { wo.laborEntries = []; }
  res.json(wo);
});

app.put('/api/work-orders/:id', requireAdmin, (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  const { status, priority, assignedTo, description, notes, laborEntries } = req.body;
  const now = new Date().toISOString();
  let assignedVal = wo.assignedTo;
  if (assignedTo !== undefined) {
    assignedVal = Array.isArray(assignedTo) ? JSON.stringify(assignedTo) : JSON.stringify([assignedTo].filter(Boolean));
  }
  db.prepare(`UPDATE work_orders SET status=?, priority=?, assignedTo=?, description=?, notes=?, laborEntries=?, updatedAt=? WHERE id=?`)
    .run(
      status !== undefined ? status : wo.status,
      priority !== undefined ? priority : wo.priority,
      assignedVal,
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
  let assignedList = [];
  try { assignedList = JSON.parse(wo.assignedTo); } catch(e) { assignedList = wo.assignedTo ? [wo.assignedTo] : []; }
  if (user.role !== 'admin' && !assignedList.includes(user.id)) {
    return res.status(403).json({ error: 'Only an assigned technician or an admin can update this work order' });
  }
  const allowed = ['Completed', 'On Hold', 'Open'];
  const status = allowed.includes(req.body.status) ? req.body.status : 'Completed';
  if (status === 'Completed') {
    const linked = db.prepare("SELECT COUNT(*) as c FROM reports WHERE workOrderNumber=?").get(wo.woNumber);
    if (!linked || linked.c === 0) return res.status(400).json({ error: 'Cannot mark as Complete — no reports linked to this work order' });
  }
  const techNotes = req.body.techNotes !== undefined ? req.body.techNotes : wo.techNotes || '';
  const apprenticeId = req.body.apprenticeId !== undefined ? req.body.apprenticeId : wo.apprenticeId || '';
  db.prepare('UPDATE work_orders SET status=?, techNotes=?, apprenticeId=?, updatedAt=? WHERE id=?')
    .run(status, techNotes, apprenticeId, new Date().toISOString(), req.params.id);
  // Auto-create draft invoice when completed
  if (status === 'Completed') {
    const existingInv = db.prepare('SELECT id FROM invoices WHERE woId=?').get(req.params.id);
    if (!existingInv) { try { createInvoiceForWO(req.params.id); } catch(e) {} }
  }
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

// ─── LABOR BURDEN ─────────────────────────────────────────────────────────────
app.get('/api/labor-burden', requireAdmin, (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key='laborBurden'").get();
  res.json(row ? JSON.parse(row.value) : {});
});

app.post('/api/labor-burden', requireAdmin, (req, res) => {
  const burden = {
    plumber: parseFloat(req.body.plumber) || 0,
    hvacb: parseFloat(req.body.hvacb) || 0,
    hvaca: parseFloat(req.body.hvaca) || 0,
    electrician: parseFloat(req.body.electrician) || 0,
    apprentice: parseFloat(req.body.apprentice) || 0,
  };
  const existing = db.prepare("SELECT key FROM settings WHERE key='laborBurden'").get();
  if (existing) db.prepare("UPDATE settings SET value=? WHERE key='laborBurden'").run(JSON.stringify(burden));
  else db.prepare("INSERT INTO settings (key,value) VALUES ('laborBurden',?)").run(JSON.stringify(burden));
  res.json(burden);
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

// ─── QUOTE FOLLOW-UP TIMER ───────────────────────────────────────────────────
setInterval(() => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const pending = db.prepare("SELECT * FROM quotes WHERE status='Sent' AND sentAt < ? AND sentAt != '' AND followUpSentAt=''").all(oneWeekAgo);
    if (pending.length === 0) return;
    const cfg = getEmailSettings();
    if (!cfg.enabled || !cfg.smtpUser || !cfg.smtpPass) return;
    const fromName = cfg.fromName || 'FieldMark';
    const transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: cfg.smtpUser, pass: cfg.smtpPass } });

    pending.forEach(async (qt) => {
      try {
        let recipients = [];
        try { recipients = JSON.parse(qt.recipients); } catch(e) {}
        if (recipients.length === 0) return;
        const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(qt.clientId);
        const token = generateQuoteToken(qt.id);
        const approveUrl = (process.env.BASE_URL || 'https://www.field-mark.app') + '/api/quotes/' + qt.id + '/approve-link?token=' + token;

        await transporter.sendMail({
          from: `"${fromName}" <${cfg.smtpUser}>`,
          to: recipients.join(', '),
          subject: `Reminder: Quote ${qt.quoteNumber} from ${fromName}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
<div style="background:#f59e0b;color:#fff;padding:20px;text-align:center;">
<div style="font-size:22px;font-weight:700;">${fromName}</div>
<div style="font-size:13px;margin-top:4px;">Quote Reminder</div>
</div>
<div style="padding:24px;background:#fff;">
<p style="font-size:14px;color:#333;">This is a friendly reminder that quote <strong>${qt.quoteNumber}</strong> is still awaiting your approval.</p>
<table style="width:100%;margin:16px 0;font-size:13px;">
<tr><td style="padding:4px 0;font-weight:600;">Client:</td><td>${cl ? cl.name : ''}</td></tr>
<tr><td style="padding:4px 0;font-weight:600;">Total:</td><td style="font-size:16px;font-weight:700;color:#3b82f6;">$${(qt.grandTotal||0).toFixed(2)}</td></tr>
<tr><td style="padding:4px 0;font-weight:600;">Valid Until:</td><td>${qt.validUntil || 'N/A'}</td></tr>
</table>
<div style="text-align:center;margin:24px 0;">
<a href="${approveUrl}" style="display:inline-block;padding:12px 28px;background:#22c55e;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Approve Quote</a>
</div>
</div>
<div style="padding:12px;text-align:center;background:#f5f5f5;color:#999;font-size:11px;">${fromName} &bull; www.field-mark.app</div>
</div>`
        });
        db.prepare("UPDATE quotes SET followUpSentAt=?, updatedAt=? WHERE id=?").run(new Date().toISOString(), new Date().toISOString(), qt.id);
        console.log('Follow-up sent for quote ' + qt.quoteNumber);
      } catch(err) { console.error('Follow-up error for ' + qt.quoteNumber + ':', err.message); }
    });
  } catch(err) { console.error('Quote follow-up check error:', err.message); }
}, 60 * 60 * 1000); // Every hour

// ─── EQUIPMENT EOL NOTIFICATION ──────────────────────────────────────────────
// Check once daily for equipment approaching end of life (within 3 years)
// Notify clients via email — only sends once per equipment per year
setInterval(() => {
  try {
    const cfg = getEmailSettings();
    if (!cfg.enabled || !cfg.smtpUser || !cfg.smtpPass) return;
    const currentYear = new Date().getFullYear();
    const allEquipment = db.prepare('SELECT * FROM equipment WHERE yearInstalled IS NOT NULL AND ashraeLifeYears > 0').all();
    if (allEquipment.length === 0) return;

    // Group by client
    const clientEquipment = {};
    allEquipment.forEach(eq => {
      const eolYear = eq.yearInstalled + eq.ashraeLifeYears;
      const remaining = eolYear - currentYear;
      if (remaining > 3) return; // Not yet approaching EOL
      const loc = db.prepare('SELECT * FROM locations WHERE id=?').get(eq.locationId);
      if (!loc) return;
      const clientId = loc.clientId;
      if (!clientEquipment[clientId]) clientEquipment[clientId] = [];
      clientEquipment[clientId].push({ eq, loc, eolYear, remaining });
    });

    const fromName = cfg.fromName || 'FieldMark';
    const transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: cfg.smtpUser, pass: cfg.smtpPass } });

    // Check last notification date per client to avoid spamming
    try { db.exec("CREATE TABLE IF NOT EXISTS eol_notifications (clientId TEXT PRIMARY KEY, lastSentYear INTEGER DEFAULT 0)"); } catch(e) {}

    Object.keys(clientEquipment).forEach(async (clientId) => {
      try {
        const lastSent = db.prepare('SELECT lastSentYear FROM eol_notifications WHERE clientId=?').get(clientId);
        if (lastSent && lastSent.lastSentYear >= currentYear) return; // Already notified this year

        const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
        if (!cl || !cl.email) return;

        const items = clientEquipment[clientId];
        const approaching = items.filter(i => i.remaining > 0);
        const past = items.filter(i => i.remaining <= 0);
        if (approaching.length === 0 && past.length === 0) return;

        let eqRows = '';
        const allItems = [...past, ...approaching];
        let totalBudget = 0;
        allItems.forEach(i => {
          const status = i.remaining <= 0 ? '<span style="color:#ef4444;font-weight:600;">Past EOL</span>' : '<span style="color:#f59e0b;font-weight:600;">' + i.remaining + ' yr(s) remaining</span>';
          totalBudget += (i.eq.replacementBudget || 0);
          eqRows += '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">' + (i.eq.name||'') + '</td>' +
            '<td style="padding:6px 10px;border-bottom:1px solid #eee;">' + (i.loc.buildingName||'') + '</td>' +
            '<td style="padding:6px 10px;border-bottom:1px solid #eee;">' + (i.eq.type||'') + '</td>' +
            '<td style="padding:6px 10px;border-bottom:1px solid #eee;">' + i.eolYear + '</td>' +
            '<td style="padding:6px 10px;border-bottom:1px solid #eee;">' + status + '</td>' +
            '<td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;">' + (i.eq.replacementBudget > 0 ? '$' + i.eq.replacementBudget.toFixed(2) : '—') + '</td></tr>';
        });

        await transporter.sendMail({
          from: `"${fromName}" <${cfg.smtpUser}>`,
          to: cl.email,
          subject: `Equipment Lifecycle Notice — ${cl.name}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
<div style="background:#3b82f6;color:#fff;padding:20px;text-align:center;">
<div style="font-size:22px;font-weight:700;">${fromName}</div>
<div style="font-size:13px;margin-top:4px;">Equipment Lifecycle Notice</div>
</div>
<div style="padding:24px;background:#fff;">
<p style="font-size:14px;color:#333;">The following equipment at your facilities is approaching or has reached its expected end of life based on ASHRAE standards:</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:12px;">
<tr style="background:#333;color:#fff;"><th style="padding:8px 10px;text-align:left;">Equipment</th><th style="padding:8px 10px;text-align:left;">Location</th><th style="padding:8px 10px;text-align:left;">Type</th><th style="padding:8px 10px;">EOL Year</th><th style="padding:8px 10px;">Status</th><th style="padding:8px 10px;">Repl. Budget</th></tr>
${eqRows}
</table>
<div style="text-align:right;font-size:14px;font-weight:700;margin-top:8px;">Estimated Total Replacement Budget: $${totalBudget.toFixed(2)}</div>
<p style="font-size:13px;color:#666;margin-top:16px;">We recommend planning for equipment replacement to avoid unexpected failures. Log in to your FieldMark client portal to view detailed lifecycle information.</p>
</div>
<div style="padding:12px;text-align:center;background:#f5f5f5;color:#999;font-size:11px;">${fromName} &bull; www.field-mark.app</div>
</div>`
        });

        // Record notification
        const existing = db.prepare('SELECT clientId FROM eol_notifications WHERE clientId=?').get(clientId);
        if (existing) db.prepare('UPDATE eol_notifications SET lastSentYear=? WHERE clientId=?').run(currentYear, clientId);
        else db.prepare('INSERT INTO eol_notifications (clientId, lastSentYear) VALUES (?,?)').run(clientId, currentYear);

        console.log('EOL notification sent to ' + cl.name + ' (' + cl.email + ')');
      } catch(err) { console.error('EOL notification error for client ' + clientId + ':', err.message); }
    });
  } catch(err) { console.error('EOL check error:', err.message); }
}, 24 * 60 * 60 * 1000); // Every 24 hours

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FieldMark running on http://localhost:${PORT}`);
});
