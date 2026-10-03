const express = require('express');
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Schema Extension for Reymass Brand ERP
db.serialize(() => {
  // 1. Subsidiaries Table
  db.run(`
    CREATE TABLE IF NOT EXISTS subsidiaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL, -- 'TECH', 'AGRI', 'CONSULT'
      name TEXT NOT NULL,
      tax_pin TEXT DEFAULT 'P000000000X',
      contact_email TEXT NOT NULL
    )
  `);

  // 2. Multi-Subsidiary Inventory
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subsidiary_code TEXT NOT NULL,
      item_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      unit_of_measure TEXT NOT NULL, -- e.g., 'Hours', 'Bags', 'Units'
      quantity_in_stock REAL DEFAULT 0,
      unit_price REAL NOT NULL,
      reorder_level REAL DEFAULT 5,
      FOREIGN KEY(subsidiary_code) REFERENCES subsidiaries(code)
    )
  `);

  // 3. Invoices & Billing
  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL, -- e.g., INV-TECH-2026-001
      subsidiary_code TEXT NOT NULL,
      client_name TEXT NOT NULL,
      client_email TEXT,
      client_phone TEXT NOT NULL,
      subtotal REAL NOT NULL,
      tax_amount REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      status TEXT DEFAULT 'Unpaid', -- 'Unpaid', 'Paid', 'Partially Paid'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 4. Invoice Line Items
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

  // 5. Delivery Notes
  db.run(`
    CREATE TABLE IF NOT EXISTS delivery_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_number TEXT UNIQUE NOT NULL, -- e.g., DN-AGRI-2026-001
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

  // 6. Petty Cash Register
  db.run(`
    CREATE TABLE IF NOT EXISTS petty_cash (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_number TEXT UNIQUE NOT NULL, -- e.g., PC-2026-089
      subsidiary_code TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL, -- 'Transport', 'Supplies', 'Utilities'
      description TEXT NOT NULL,
      disbursement_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 7. Unified Payment Receipts (M-Pesa Paybill)
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
// M-Pesa Daraja Configuration
const MPESA_CONSUMER_KEY = 'obwk59KLi8Yj6amsXHPey8nhIia7DCq8GoOdqgkUsRbIdShM';
const MPESA_CONSUMER_SECRET = 'sGAMoExEenhibAEVvxaJYShmQGAJ3PHaVul63tqOlHUiYPLtUe4LAPpi51SXbgAv';
const MPESA_SHORTCODE = '174379';
const MPESA_PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
const MPESA_CALLBACK_URL = 'https://reymass-tech-suite.onrender.com/api/mpesa/callback';

// Helper: OAuth Token
async function getMpesaToken() {
  const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
  const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: `Basic ${auth}` }
  });
  return response.data.access_token;
}

// Dynamic Multi-Subsidiary M-Pesa STK Push
app.post('/api/mpesa/stkpush-unified', async (req, res) => {
  try {
    const { phoneNumber, amount, invoiceId, subsidiaryCode } = req.body;
    let formattedPhone = phoneNumber.replace(/^(0|\+?254)/, '254');

    const token = await getMpesaToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');

    // Generate dynamic account reference based on subsidiary
    const accountReference = `${subsidiaryCode.toUpperCase()}-INV-${invoiceId}`;

    const payload = {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: MPESA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: MPESA_CALLBACK_URL,
      AccountReference: accountReference,
      TransactionDesc: `Reymass ${subsidiaryCode} Payment for Inv #${invoiceId}`
    };

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest/singlestage',
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json({ success: true, data: response.data, accountReference });
  } catch (error) {
    console.error('Unified Payment Error:', error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, message: 'STK Push failed' });
  }
});

// 2. Fetch projects
app.get('/api/projects', (req, res) => {
  db.all('SELECT * FROM projects ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 3. Register specialist
app.post('/api/specialists', (req, res) => {
  const { name, title, location, merits, portfolio_url } = req.body;
  const sql = `INSERT INTO specialists (name, title, location, merits, portfolio_url) VALUES (?, ?, ?, ?, ?)`;
  db.run(sql, [name, title, location, merits, portfolio_url], function (err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

// 4. Fetch specialists
app.get('/api/specialists', (req, res) => {
  db.all('SELECT * FROM specialists ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 5. M-Pesa STK Push
app.post('/api/mpesa/stkpush', async (req, res) => {
  try {
    const { phoneNumber, amount, projectId } = req.body;
    let formattedPhone = phoneNumber.replace(/^(0|\+?254)/, '254');

    const token = await getMpesaToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');

    const payload = {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: MPESA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: MPESA_CALLBACK_URL,
      AccountReference: `REYMASS_PROJ_${projectId}`,
      TransactionDesc: `Reymass Escrow Deposit for Project #${projectId}`
    };

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest/singlestage',
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('M-Pesa Error:', error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, message: 'STK Push failed to initiate' });
  }
});

// 6. M-Pesa Callback
app.post('/api/mpesa/callback', (req, res) => {
  const callbackData = req.body?.Body?.stkCallback;
  if (callbackData && callbackData.ResultCode === 0) {
    const metadata = callbackData.CallbackMetadata.Item;
    const mpesaReceipt = metadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
    const amountPaid = metadata.find(item => item.Name === 'Amount')?.Value;
    const phone = metadata.find(item => item.Name === 'PhoneNumber')?.Value;

    console.log(`[PAYMENT SUCCESS] Receipt: ${mpesaReceipt}, Amount: ${amountPaid}, Phone: ${phone}`);
  } else {
    console.log(`[PAYMENT FAILED/CANCELLED] ${callbackData?.ResultDesc || 'Unknown error'}`);
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// Fallback Route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  Reymass Tech Suite running at http://localhost:${PORT}`);
  console.log(`==================================================`);
});