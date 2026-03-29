const tableBody = document.getElementById('lead-table');
const form = document.getElementById('lead-form');
const errorBox = document.getElementById('lead-error');
const totalUsers = document.getElementById('total-users');
const totalLeads = document.getElementById('total-leads');
const totalPayments = document.getElementById('total-payments');
const logoutBtn = document.getElementById('logout');
const contactTable = document.getElementById('contact-table');

let csrfToken = '';

const getCsrfToken = async () => {
  if (csrfToken) return csrfToken;
  const res = await fetch('/csrf');
  const data = await res.json();
  csrfToken = data.token;
  return csrfToken;
};

const fetchJSON = async (url, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const headers = options.headers ? { ...options.headers } : {};
  if (method !== 'GET') {
    const token = await getCsrfToken();
    headers['x-csrf-token'] = token;
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    window.location.href = '/';
    return null;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

const loadSummary = async () => {
  try {
    const data = await fetchJSON('/summary');
    if (!data) return;
    totalUsers.textContent = data.totalUsers;
    totalLeads.textContent = data.totalLeads;
    totalPayments.textContent = data.totalPayments;
  } catch (err) {
    // Silent
  }
};

const loadLeads = async () => {
  try {
    const leads = await fetchJSON('/leads');
    if (!leads) return;
    tableBody.innerHTML = leads
      .map(
        lead => `
          <tr>
            <td>${lead.name}</td>
            <td>${lead.phone}</td>
            <td>${lead.transaction_id || '-'}</td>
            <td>${new Date(lead.created_at).toLocaleString()}</td>
            <td><button class="btn ghost" data-id="${lead.id}">Delete</button></td>
          </tr>
        `
      )
      .join('');
  } catch (err) {
    tableBody.innerHTML = '';
  }
};

const loadContacts = async () => {
  if (!contactTable) return;
  try {
    const contacts = await fetchJSON('/contacts');
    if (!contacts) return;
    contactTable.innerHTML = contacts
      .map(
        contact => `
          <tr>
            <td>${contact.name}</td>
            <td>${contact.phone || '-'}</td>
            <td>${contact.message || '-'}</td>
            <td>${new Date(contact.created_at).toLocaleString()}</td>
            <td><button class="btn ghost" data-contact-id="${contact.id}">Delete</button></td>
          </tr>
        `
      )
      .join('');
  } catch (err) {
    contactTable.innerHTML = '';
  }
};

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.textContent = '';
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await fetchJSON('/add-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    form.reset();
    await loadLeads();
    await loadSummary();
  } catch (err) {
    errorBox.textContent = err.message || 'Failed to save lead.';
  }
});

tableBody.addEventListener('click', async event => {
  const btn = event.target.closest('button[data-id]');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  if (!confirm('Delete this lead?')) return;
  try {
    await fetchJSON(`/lead/${id}`, { method: 'DELETE' });
    await loadLeads();
    await loadSummary();
  } catch (err) {
    // ignore
  }
});

contactTable.addEventListener('click', async event => {
  const btn = event.target.closest('button[data-contact-id]');
  if (!btn) return;
  const id = btn.getAttribute('data-contact-id');
  if (!confirm('Delete this contact?')) return;
  try {
    await fetchJSON(`/contact/${id}`, { method: 'DELETE' });
    await loadContacts();
  } catch (err) {
    // ignore
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetchJSON('/logout', { method: 'POST' });
  window.location.href = '/';
});

loadSummary();
loadLeads();
loadContacts();
