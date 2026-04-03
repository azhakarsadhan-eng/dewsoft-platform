const statMap = {
  total: document.querySelector('[data-stat="total"]'),
  joined: document.querySelector('[data-stat="joined"]'),
  daily_follow: document.querySelector('[data-stat="daily_follow"]'),
  weekly_follow: document.querySelector('[data-stat="weekly_follow"]'),
};

const leadTable = document.querySelector('#lead-table');
const contactTable = document.querySelector('#contact-table');
const refreshButton = document.querySelector('#refresh-data');

const formatDate = value => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
};

const setStat = (key, value) => {
  if (statMap[key]) {
    statMap[key].textContent = value ?? 0;
  }
};

const loadStats = async () => {
  const response = await fetch('/api/stats');
  if (!response.ok) throw new Error('Failed to load stats');
  const data = await response.json();
  setStat('total', data.recruitment?.total_contacts ?? 0);
  setStat('joined', data.recruitment?.joined ?? 0);
  setStat('daily_follow', data.daily?.follow_ups ?? 0);
  setStat('weekly_follow', data.weekly?.follow_ups ?? 0);
};

const loadLeads = async () => {
  const response = await fetch('/api/leads');
  if (!response.ok) throw new Error('Failed to load leads');
  const leads = await response.json();
  if (!leadTable) return;

  if (!Array.isArray(leads) || leads.length === 0) {
    leadTable.innerHTML = '<tr><td colspan="4">No leads yet.</td></tr>';
    return;
  }

  leadTable.innerHTML = leads
    .slice(0, 50)
    .map(
      lead => `
        <tr>
          <td>${lead.name || '-'}</td>
          <td>${lead.phone || '-'}</td>
          <td>${lead.status || '-'}</td>
          <td>${formatDate(lead.created_at)}</td>
        </tr>
      `
    )
    .join('');
};

const loadContacts = async () => {
  const response = await fetch('/api/contacts');
  if (!response.ok) throw new Error('Failed to load contacts');
  const contacts = await response.json();
  if (!contactTable) return;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    contactTable.innerHTML = '<tr><td colspan="4">No contacts yet.</td></tr>';
    return;
  }

  contactTable.innerHTML = contacts
    .slice(0, 50)
    .map(
      contact => `
        <tr>
          <td>${contact.name || '-'}</td>
          <td>${contact.phone || '-'}</td>
          <td>${contact.message || '-'}</td>
          <td>${formatDate(contact.created_at)}</td>
        </tr>
      `
    )
    .join('');
};

const refreshAll = async () => {
  try {
    await Promise.all([loadStats(), loadLeads(), loadContacts()]);
  } catch (error) {
    if (leadTable) {
      leadTable.innerHTML = '<tr><td colspan="4">Unable to load data.</td></tr>';
    }
    if (contactTable) {
      contactTable.innerHTML = '<tr><td colspan="4">Unable to load data.</td></tr>';
    }
  }
};

if (refreshButton) {
  refreshButton.addEventListener('click', refreshAll);
}

refreshAll();
