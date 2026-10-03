const express = require('express');
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite Database
const db = new sqlite3.Database('./reymass.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Create Tables
db.serialize(() => {
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

  db.run(`
    CREATE TABLE IF NOT EXISTS specialists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT NOT NULL,
      merits TEXT NOT NULL,
      portfolio_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

// API Routes

// 1. Submit project
app.post('/api/projects', (req, res) => {
  const { client_name, category, budget, location, description } = req.body;
  const sql = `INSERT INTO projects (client_name, category, budget, location, description) VALUES (?, ?, ?, ?, ?)`;
  db.run(sql, [client_name, category, budget, location, description], function (err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, id: this.lastID });
  });
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