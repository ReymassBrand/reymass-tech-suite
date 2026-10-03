const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database Setup
const db = new sqlite3.Database('./reymass.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database: reymass.db');
  }
});

// Initialize Relational Schema
db.serialize(() => {
  // 1. Projects & Escrow Table
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT NOT NULL,
      category TEXT NOT NULL,
      budget REAL NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'Pending Escrow',
      assigned_specialist TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Subsidiaries Table
  db.run(`
    CREATE TABLE IF NOT EXISTS subsidiaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      tax_pin TEXT DEFAULT 'P000000000X',
      contact_email TEXT NOT NULL
    )
  `);

  // Seed default subsidiaries if empty
  db.get('SELECT COUNT(*) as count FROM subsidiaries', (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO subsidiaries (code, name, contact_email) VALUES 
        ('TECH', 'Reymass IT & Tech Solutions', 'tech@reymass.com'),
        ('AGRI', 'Reymass Agribusiness Ventures', 'agri@reymass.com'),
        ('CONSULT', 'Reymass Agency & Consulting', 'consulting@reymass.com')
      `);
    }
  });

  // 3. Multi-Subsidiary Inventory
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subsidiary_code TEXT NOT NULL,
      item_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      unit_of_measure TEXT NOT NULL,
      quantity_in_stock REAL DEFAULT 0,
      unit_price REAL NOT NULL,
      reorder_level REAL DEFAULT 5,
      FOREIGN KEY(subsidiary_code) REFERENCES subsidiaries(code)
    )
  `);

  // 4. Invoices & Billing
  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      subsidiary_code TEXT NOT NULL,
      client_name TEXT NOT NULL,
      client_email TEXT,
      client_phone TEXT NOT NULL,
      subtotal REAL NOT NULL,
      tax_amount REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      status TEXT DEFAULT 'Unpaid',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 5. Invoice Line Items
  db.run(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      item_description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY(invoice_id) REFERENCES invoices(id)
    )
  `);

  // 6. Delivery Notes
  db.run(`
    CREATE TABLE IF NOT EXISTS delivery_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_number TEXT UNIQUE NOT NULL,
      invoice_id INTEGER NOT NULL,
      subsidiary_code TEXT NOT NULL,
      dispatch_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      recipient_name TEXT NOT NULL,
      destination TEXT NOT NULL,
      delivered_by TEXT NOT NULL,
      status TEXT DEFAULT 'Dispatched',
      FOREIGN KEY(invoice_id) REFERENCES invoices(id)
    )
  `);

  // 7. Petty Cash Register
  db.run(`
    CREATE TABLE IF NOT EXISTS petty_cash (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_number TEXT UNIQUE NOT NULL,
      subsidiary_code TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      disbursement_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 8. Unified Receipts
  db.run(`
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_number TEXT UNIQUE NOT NULL,
      invoice_id INTEGER NOT NULL,
      mpesa_code TEXT NOT NULL,
      amount_paid REAL NOT NULL,
      payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(invoice_id) REFERENCES invoices(id)
    )
  `);
});

// --- API ROUTES ---

// Projects API
app.get('/api/projects', (req, res) => {
  db.all('SELECT * FROM projects ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/projects', (req, res) => {
  const { client_name, category, budget, location, description } = req.body;
  if (!client_name || !category || !budget || !location) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const query = `INSERT INTO projects (client_name, category, budget, location, description) VALUES (?, ?, ?, ?, ?)`;
  db.run(query, [client_name, category, budget, location, description || ''], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, status: 'Pending Escrow' });
  });
});

// Cleaned M-Pesa Token Helper
async function getMpesaToken() {
  const consumerKey = (process.env.MPESA_CONSUMER_KEY || 'obwk59KLi8Yj6amsXHPey8nhIia7DCq8GoOdqgkUsRbIdShM').trim();
  const consumerSecret = (process.env.MPESA_CONSUMER_SECRET || 'sGAMoExEenhibAEVvxaJYShmQGAJ3PHaVul63tqOlHUiYPLtUe4LAPpi51SXbgAv').trim();
  
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  try {
    const response = await axios.get(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate',
      {
        params: { grant_type: 'client_credentials' },
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const token = response.data.access_token;
    console.log('Successfully acquired M-Pesa OAuth Token');
    return token;
  } catch (error) {
    console.error('M-Pesa Token Error Details:', error.response ? error.response.data : error.message);
    throw new Error('Failed to obtain valid access token from Safaricom');
  }
}

// Unified M-Pesa STK Push Endpoint
app.post('/api/mpesa/stkpush-unified', async (req, res) => {
  try {
    const { phoneNumber, amount, invoiceId, subsidiaryCode } = req.body;
    
    // Format phone number to 254XXXXXXXXX
    let formattedPhone = phoneNumber.toString().trim().replace(/^(0|\+?254)/, '254');
    if (!formattedPhone.startsWith('254')) {
      formattedPhone = `254${formattedPhone}`;
    }

    const shortCode = process.env.MPESA_SHORTCODE || '174379';
    const passkey = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
    
    // Timestamp format: YYYYMMDDHHmmss
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

    const accountReference = `${(subsidiaryCode || 'TECH').toUpperCase()}-INV-${invoiceId || '001'}`;

    const payload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(Number(amount)), // Must be an integer for Sandbox
      PartyA: formattedPhone,
      PartyB: shortCode,
      PhoneNumber: formattedPhone,
      CallBackURL: process.env.MPESA_CALLBACK_URL || 'https://reymass-tech-suite.onrender.com/api/mpesa/callback',
      AccountReference: accountReference,
      TransactionDesc: `Reymass ${subsidiaryCode || 'TECH'} Payment`
    };

    const token = await getMpesaToken();

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('STK Push Success Response:', response.data);
    res.json({ success: true, data: response.data, accountReference });

  } catch (error) {
    const errData = error.response ? error.response.data : error.message;
    console.error('STK Push Detailed Error:', errData);
    res.status(500).json({ success: false, error: errData });
  }
});

// Fallback Route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Reymass ERP Server running on port ${PORT}`);
});