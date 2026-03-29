const statMap = {
  total: document.querySelector('[data-stat="total"]'),
  joined: document.querySelector('[data-stat="joined"]'),
  daily_follow: document.querySelector('[data-stat="daily_follow"]'),
  weekly_follow: document.querySelector('[data-stat="weekly_follow"]'),
};

const leadTable = document.querySelector('#lead-table');
const refreshButton = document.querySelector('#refresh-data');
const settingsForm = document.querySelector('#settings-form');
const uploadZone = document.querySelector('#upload-zone');
const posterFiles = document.querySelector('#poster-files');

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

const loadSettings = async () => {
  if (!settingsForm) return;
  const response = await fetch('/api/settings');
  if (!response.ok) return;
  const data = await response.json();
  settingsForm.official_url.value = data.official_url || '';
  settingsForm.phone.value = data.phone || '';
  settingsForm.email.value = data.email || '';
  settingsForm.whatsapp.value = data.whatsapp || '';
  settingsForm.posters.value = Array.isArray(data.posters) ? data.posters.join(', ') : '';
};

const saveSettings = async () => {
  if (!settingsForm) return;
  const payload = {
    official_url: settingsForm.official_url.value.trim(),
    phone: settingsForm.phone.value.trim(),
    email: settingsForm.email.value.trim(),
    whatsapp: settingsForm.whatsapp.value.trim(),
    posters: settingsForm.posters.value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
  };

  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    alert('Unable to save settings.');
    return;
  }

  alert('Settings updated successfully.');
};

const appendPosterUrls = urls => {
  if (!settingsForm || !Array.isArray(urls) || urls.length === 0) return;
  const current = settingsForm.posters.value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const updated = [...current, ...urls];
  settingsForm.posters.value = updated.join(', ');
};

const uploadPosters = async files => {
  const formData = new FormData();
  Array.from(files).forEach(file => formData.append('files', file));
  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    alert('Upload failed. Please try again.');
    return;
  }

  const data = await response.json();
  appendPosterUrls(data.urls || []);
  await saveSettings();
};

if (uploadZone && posterFiles) {
  uploadZone.addEventListener('click', () => posterFiles.click());

  posterFiles.addEventListener('change', event => {
    if (event.target.files?.length) {
      uploadPosters(event.target.files);
      event.target.value = '';
    }
  });

  uploadZone.addEventListener('dragover', event => {
    event.preventDefault();
    uploadZone.classList.add('is-dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('is-dragover');
  });

  uploadZone.addEventListener('drop', event => {
    event.preventDefault();
    uploadZone.classList.remove('is-dragover');
    if (event.dataTransfer.files?.length) {
      uploadPosters(event.dataTransfer.files);
    }
  });
}

const refreshAll = async () => {
  try {
    await Promise.all([loadStats(), loadLeads(), loadSettings()]);
  } catch (error) {
    if (leadTable) {
      leadTable.innerHTML = '<tr><td colspan="4">Unable to load data.</td></tr>';
    }
  }
};

if (refreshButton) {
  refreshButton.addEventListener('click', refreshAll);
}

if (settingsForm) {
  settingsForm.addEventListener('submit', event => {
    event.preventDefault();
    saveSettings();
  });
}

refreshAll();
