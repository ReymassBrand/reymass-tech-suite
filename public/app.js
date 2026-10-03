// Expose Navigation Handler Globally
window.switchView = function(viewId) {
  const views = document.querySelectorAll('.view-section');
  views.forEach(view => view.style.display = 'none');

  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.style.display = 'block';
  }
};

// HTML Escaper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Load Projects into Dashboard
async function loadProjects() {
  try {
    const response = await fetch('/api/projects');
    const projects = await response.json();
    const tableBody = document.getElementById('projectsTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '';

    if (!projects || projects.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 15px;">No projects submitted yet.</td></tr>';
      return;
    }

    projects.forEach(proj => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>#${proj.id}</td>
        <td><strong>${escapeHtml(proj.client_name)}</strong><br><small>${escapeHtml(proj.location)}</small></td>
        <td>${escapeHtml(proj.category)}</td>
        <td>KES ${Number(proj.budget).toLocaleString()}</td>
        <td><span class="status-badge">${escapeHtml(proj.status)}</span></td>
        <td>
          ${
            proj.status === 'Pending Escrow'
              ? `<button class="btn-mpesa" onclick="triggerMpesaDeposit(${proj.id}, ${proj.budget}, '${proj.category}')">Deposit Escrow</button>`
              : `<button disabled style="opacity:0.6;">Funded</button>`
          }
        </td>
      `;
      tableBody.appendChild(row);
    });
  } catch (error) {
    console.error('Failed to load projects:', error);
  }
}

// Handle New Project Submission
async function handleProjectSubmit(event) {
  event.preventDefault();
  
  const payload = {
    client_name: document.getElementById('clientName').value,
    category: document.getElementById('categorySelect').value,
    budget: parseFloat(document.getElementById('budgetInput').value),
    location: document.getElementById('locationInput').value,
    description: document.getElementById('descriptionInput').value
  };

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      alert('Project submitted successfully!');
      document.getElementById('projectForm').reset();
      loadProjects();
    } else {
      alert('Failed to submit project.');
    }
  } catch (err) {
    console.error('Error submitting project:', err);
  }
}

// Trigger M-Pesa STK Push
async function triggerMpesaDeposit(invoiceId, amount, category) {
  const phone = prompt('Enter M-Pesa Phone Number (e.g., 0712345678):');
  if (!phone) return;

  let subCode = 'TECH';
  if (category.includes('Agri')) subCode = 'AGRI';
  if (category.includes('Consult')) subCode = 'CONSULT';

  try {
    const res = await fetch('/api/mpesa/stkpush-unified', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: phone,
        amount: amount,
        invoiceId: invoiceId,
        subsidiaryCode: subCode
      })
    });

    const data = await res.json();
    if (data.success) {
      alert(`STK Push sent to ${phone}. Account Ref: ${data.accountReference}`);
    } else {
      alert('STK Push failed. Check server configuration.');
    }
  } catch (error) {
    console.error('M-Pesa payment error:', error);
    alert('Payment request failed.');
  }
}

// Printable Document Renderers
window.loadSampleInvoice = function() {
  const container = document.getElementById('documentViewer');
  container.innerHTML = `
    <div class="printable-document">
      <div class="no-print" style="text-align: right; margin-bottom: 15px;">
        <button onclick="window.print()" class="btn-mpesa">Print / Save as PDF</button>
      </div>

      <div class="doc-header">
        <div>
          <h2 style="margin: 0; color: #0056b3;">REYMASS BRAND</h2>
          <small>Subsidiary: Reymass IT & Tech Solutions</small><br>
          <small>Paybill: 174379 | Account: TECH-INV-101</small>
        </div>
        <div style="text-align: right;">
          <h3 style="margin: 0;">TAX INVOICE</h3>
          <strong>Invoice #:</strong> INV-TECH-2026-101<br>
          <strong>Date:</strong> ${new Date().toLocaleDateString()}<br>
          <strong>Status:</strong> Unpaid
        </div>
      </div>

      <div style="margin-bottom: 20px;">
        <strong>Billed To:</strong><br>
        Harrison Client<br>
        Phone: 0712345678<br>
        Email: client@example.com
      </div>

      <table class="doc-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Custom Node.js/Express Web Portal & M-Pesa Setup</td>
            <td>1</td>
            <td>KES 45,000</td>
            <td>KES 45,000</td>
          </tr>
        </tbody>
      </table>

      <div style="text-align: right; margin-top: 20px;">
        <p><strong>Subtotal:</strong> KES 45,000</p>
        <p><strong>VAT (16%):</strong> KES 7,200</p>
        <h3 style="color: #0056b3;">Total Due: KES 52,200</h3>
      </div>
    </div>
  `;
};

window.loadSampleDeliveryNote = function() {
  const container = document.getElementById('documentViewer');
  container.innerHTML = `
    <div class="printable-document">
      <div class="no-print" style="text-align: right; margin-bottom: 15px;">
        <button onclick="window.print()" class="btn-primary">Print Delivery Note</button>
      </div>

      <div class="doc-header">
        <div>
          <h2 style="margin: 0; color: #0056b3;">REYMASS BRAND</h2>
          <small>Logistics & Dispatch Division</small>
        </div>
        <div style="text-align: right;">
          <h3 style="margin: 0;">DELIVERY NOTE</h3>
          <strong>DN #:</strong> DN-AGRI-2026-044<br>
          <strong>Date:</strong> ${new Date().toLocaleDateString()}
        </div>
      </div>

      <table class="doc-table">
        <thead>
          <tr>
            <th>Item Description</th>
            <th>Qty Dispatched</th>
            <th>Condition</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Smart Water Meter Unit (Sub-1 Inch)</td>
            <td>2 Units</td>
            <td>Good Order & Condition</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
};

window.loadSampleVoucher = function() {
  const container = document.getElementById('documentViewer');
  container.innerHTML = `
    <div class="printable-document">
      <div class="no-print" style="text-align: right; margin-bottom: 15px;">
        <button onclick="window.print()" class="btn-primary">Print Voucher</button>
      </div>

      <div class="doc-header">
        <div>
          <h2 style="margin: 0;">REYMASS BRAND</h2>
          <small>Petty Cash Control</small>
        </div>
        <div style="text-align: right;">
          <h3 style="margin: 0;">PETTY CASH VOUCHER</h3>
          <strong>Voucher #:</strong> PC-2026-012<br>
          <strong>Date:</strong> ${new Date().toLocaleDateString()}
        </div>
      </div>

      <p><strong>Requested By:</strong> Harrison | <strong>Approved By:</strong> Finance Manager</p>
      <p><strong>Category:</strong> Office Supplies | <strong>Amount:</strong> KES 3,500</p>
    </div>
  `;
};

// Initial setup on page load
document.addEventListener('DOMContentLoaded', () => {
  loadProjects();
});