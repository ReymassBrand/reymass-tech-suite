const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON payloads
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite Database File
const db = new Database('reymass.db');

// Create Tables if they don't exist
db.exec(`
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
  );

  CREATE TABLE IF NOT EXISTS specialists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT NOT NULL,
    merits TEXT NOT NULL,
    portfolio_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// --- API ROUTES ---

// 1. Submit a new project request (Client)
app.post('/api/projects', (req, res) => {
    const { client_name, category, budget, location, description } = req.body;
    const stmt = db.prepare(`
        INSERT INTO projects (client_name, category, budget, location, description)
        VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(client_name, category, budget, location, description);
    res.json({ success: true, id: info.lastInsertRowid });
});

// 2. Get all project requests (Admin / Specialist)
app.get('/api/projects', (req, res) => {
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    res.json(projects);
});

// 3. Register a specialist (Specialist Onboarding)
app.post('/api/specialists', (req, res) => {
    const { name, title, location, merits, portfolio_url } = req.body;
    const stmt = db.prepare(`
        INSERT INTO specialists (name, title, location, merits, portfolio_url)
        VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(name, title, location, merits, portfolio_url);
    res.json({ success: true, id: info.lastInsertRowid });
});

// 4. Get all specialists
app.get('/api/specialists', (req, res) => {
    const specialists = db.prepare('SELECT * FROM specialists ORDER BY created_at DESC').all();
    res.json(specialists);
});

// Fallback route for static HTML
app.get('*path', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log('\n==================================================');
    console.log('  Reymass Tech Suite + SQLite running at: http://localhost:' + PORT);
    console.log('==================================================\n');
});async function submitProject(data) {
    const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return await res.json();
}async function loadProjects() {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    // Render projects dynamically on dashboard
}const axios = require('axios');

// M-Pesa Daraja Credentials (Replace with your Sandbox/Production keys)
const MPESA_CONSUMER_KEY = 'obwk59KLi8Yj6amsXHPey8nhIia7DCq8GoOdqgkUsRbIdShM';
const MPESA_CONSUMER_SECRET = 'sGAMoExEenhibAEVvxaJYShmQGAJ3PHaVul63tqOlHUiYPLtUe4LAPpi51SXbgAv';
const MPESA_SHORTCODE = '174379'; // Sandbox Shortcode
const MPESA_PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'; 
const MPESA_CALLBACK_URL = const MPESA_CALLBACK_URL = 'https://reymass-tech-suite.onrender.com/api/mpesa/callback';

// Helper: Generate OAuth Token from Safaricom
async function getMpesaToken() {
    const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
    const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
        headers: { Authorization: `Basic ${auth}` }
    });
    return response.data.access_token;
}

// --- M-PESA STK PUSH API ROUTE ---
app.post('/api/mpesa/stkpush', async (req, res) => {
    try {
        const { phoneNumber, amount, projectId } = req.body;

        // Format phone number to 254XXXXXXXXX
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

// --- M-PESA CALLBACK ROUTE (Safaricom posts payment outcome here) ---
app.post('/api/mpesa/callback', (req, res) => {
    const callbackData = req.body.Body.stkCallback;

    if (callbackData.ResultCode === 0) {
        const metadata = callbackData.CallbackMetadata.Item;
        const mpesaReceipt = metadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
        const amountPaid = metadata.find(item => item.Name === 'Amount')?.Value;
        const phone = metadata.find(item => item.Name === 'PhoneNumber')?.Value;

        console.log(`[PAYMENT SUCCESS] Receipt: ${mpesaReceipt}, Amount: ${amountPaid}, Phone: ${phone}`);

        // Update status in SQLite to 'Escrow Funded'
        // db.prepare("UPDATE projects SET status = 'Escrow Funded' WHERE id = ?").run(projectId);
    } else {
        console.log(`[PAYMENT FAILED/CANCELLED] ${callbackData.ResultDesc}`);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});async function triggerMpesaDeposit(projectId, amount, phoneNumber) {
    const response = await fetch('/api/mpesa/stkpush', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, amount, phoneNumber })
    });

    const result = await response.json();
    if (result.success) {
        alert('M-Pesa prompt sent! Please enter your PIN on your phone to complete the escrow deposit.');
    } else {
        alert('Failed to trigger M-Pesa payment. Check phone number format.');
    }
}// INCORRECT (Duplicate declaration):
const MPESA_CALLBACK_URL = 'https://reymass-tech-suite.onrender.com/api/mpesa/callback';