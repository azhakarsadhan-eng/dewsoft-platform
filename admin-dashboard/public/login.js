const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');
let csrfToken = '';

const getCsrfToken = async () => {
  if (csrfToken) return csrfToken;
  const res = await fetch('/csrf');
  const data = await res.json();
  csrfToken = data.token;
  return csrfToken;
};

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.textContent = '';
  const data = Object.fromEntries(new FormData(form).entries());

  try {
    const token = await getCsrfToken();
    const res = await fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': token,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      errorBox.textContent = payload.error || 'Login failed.';
      return;
    }

    window.location.href = '/dashboard';
  } catch (err) {
    errorBox.textContent = 'Network error. Please try again.';
  }
});
