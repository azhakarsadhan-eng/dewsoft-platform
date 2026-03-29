const path = require('path');
const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

const DB_PATH = path.join(__dirname, '..', 'instance', 'platform.db');
const usePostgres = !!process.env.DATABASE_URL;
const db = usePostgres ? null : new sqlite3.Database(DB_PATH);
const pgPool = usePostgres
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.RENDER ? { rejectUnauthorized: false } : false,
    })
  : null;

const ADMIN_USER = process.env.ADMIN_USER || 'santhos';
const ADMIN_PASS = process.env.ADMIN_PASS || 'santhos@123';
const ADMIN_PASS_HASH = bcrypt.hashSync(ADMIN_PASS, 10);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 30,
      secure: false,
    },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

const requireAuth = (req, res, next) => {
  if (req.session && req.session.user === ADMIN_USER) return next();
  return res.status(401).json({ error: 'Unauthorized' });
};

const sqliteRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const sqliteGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const sqliteAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

const ensureAdminTables = async () => {
  if (usePostgres) {
    await pgPool.query(
      `CREATE TABLE IF NOT EXISTS admin_audit (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        meta TEXT,
        ip TEXT,
        created_at TIMESTAMP NOT NULL
      )`
    );
    return;
  }
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS admin_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        meta TEXT,
        ip TEXT,
        created_at TEXT NOT NULL
      )`
    );
  });
};

const audit = async (action, meta, ip) => {
  const createdAt = new Date().toISOString();
  if (usePostgres) {
    await pgPool.query(
      'INSERT INTO admin_audit (action, meta, ip, created_at) VALUES ($1, $2, $3, $4)',
      [action, meta ? JSON.stringify(meta) : null, ip || null, createdAt]
    );
    return;
  }
  db.run(
    'INSERT INTO admin_audit (action, meta, ip, created_at) VALUES (?, ?, ?, ?)',
    [action, meta ? JSON.stringify(meta) : null, ip || null, createdAt]
  );
};

const parseTransactionId = notes => {
  if (!notes) return '';
  const match = notes.match(/Transaction ID:\s*([^\.]+)/i);
  return match ? match[1].trim() : '';
};

const getClientIp = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();

const ensureCsrfToken = req => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
};

const csrfProtect = (req, res, next) => {
  const token = req.get('x-csrf-token') || req.body._csrf;
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }
  return next();
};

const createRateLimiter = (maxRequests, windowMs) => {
  const bucket = new Map();
  return (req, res, next) => {
    const key = getClientIp(req);
    const now = Date.now();
    const entry = bucket.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    bucket.set(key, entry);
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    return next();
  };
};

const loginLimiter = createRateLimiter(5, 5 * 60 * 1000);
const apiLimiter = createRateLimiter(60, 60 * 1000);

ensureAdminTables();

app.get('/csrf', (req, res) => {
  const token = ensureCsrfToken(req);
  res.json({ token });
});

app.post('/login', loginLimiter, csrfProtect, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (username.length < 3 || username.length > 50 || password.length < 6 || password.length > 72) {
    return res.status(400).json({ error: 'Invalid username or password length.' });
  }

  const isUserMatch = username === ADMIN_USER;
  const isPassMatch = bcrypt.compareSync(password, ADMIN_PASS_HASH);

  if (!isUserMatch || !isPassMatch) {
    await audit('login_failed', { username }, getClientIp(req));
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  req.session.user = ADMIN_USER;
  ensureCsrfToken(req);
  await audit('login_success', { username }, getClientIp(req));
  return res.json({ ok: true });
});

app.post('/logout', csrfProtect, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/summary', requireAuth, apiLimiter, (req, res) => {
  const summary = {
    totalUsers: 0,
    totalLeads: 0,
    totalPayments: 0,
  };

  (async () => {
    try {
      if (usePostgres) {
        const leadCount = await pgPool.query('SELECT COUNT(*) as count FROM lead');
        summary.totalLeads = Number(leadCount.rows[0].count || 0);
        summary.totalUsers = summary.totalLeads;
        const payCount = await pgPool.query("SELECT COUNT(*) as count FROM lead WHERE status ILIKE '%Payment%'");
        summary.totalPayments = Number(payCount.rows[0].count || 0);
        return res.json(summary);
      }
      const row = await sqliteGet('SELECT COUNT(*) as count FROM lead');
      summary.totalLeads = row ? row.count : 0;
      summary.totalUsers = summary.totalLeads;
      const row2 = await sqliteGet("SELECT COUNT(*) as count FROM lead WHERE status LIKE '%Payment%'");
      summary.totalPayments = row2 ? row2.count : 0;
      return res.json(summary);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch summary.' });
    }
  })();
});

app.get('/leads', requireAuth, apiLimiter, (req, res) => {
  (async () => {
    try {
      const rows = usePostgres
        ? (await pgPool.query('SELECT * FROM lead ORDER BY id DESC')).rows
        : await sqliteAll('SELECT * FROM lead ORDER BY id DESC');
      const normalized = rows.map(row => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        transaction_id: parseTransactionId(row.notes) || null,
        created_at: row.created_at,
      }));
      return res.json(normalized);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch leads.' });
    }
  })();
});

app.get('/contacts', requireAuth, apiLimiter, (req, res) => {
  (async () => {
    try {
      const rows = usePostgres
        ? (await pgPool.query('SELECT * FROM contact_request ORDER BY id DESC')).rows
        : await sqliteAll('SELECT * FROM contact_request ORDER BY id DESC');
      const normalized = rows.map(row => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        message: row.message,
        created_at: row.created_at,
      }));
      return res.json(normalized);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch contacts.' });
    }
  })();
});

app.delete('/contact/:id', requireAuth, apiLimiter, csrfProtect, (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id.' });
  (async () => {
    try {
      if (usePostgres) {
        const result = await pgPool.query('DELETE FROM contact_request WHERE id = $1', [id]);
        if (!result.rowCount) return res.status(404).json({ error: 'Contact not found.' });
        await audit('contact_deleted', { id }, getClientIp(req));
        return res.json({ ok: true });
      }
      const result = await sqliteRun('DELETE FROM contact_request WHERE id = ?', [id]);
      if (!result.changes) return res.status(404).json({ error: 'Contact not found.' });
      await audit('contact_deleted', { id }, getClientIp(req));
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete contact.' });
    }
  })();
});

app.post('/add-lead', requireAuth, apiLimiter, csrfProtect, (req, res) => {
  const { name, phone, transactionId } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required.' });
  }

  if (name.trim().length < 2 || name.trim().length > 120) {
    return res.status(400).json({ error: 'Name must be 2-120 characters.' });
  }

  if (phone.trim().length < 5 || phone.trim().length > 20) {
    return res.status(400).json({ error: 'Phone must be 5-20 characters.' });
  }

  if (transactionId && transactionId.trim().length > 60) {
    return res.status(400).json({ error: 'Transaction ID is too long.' });
  }

  const createdAt = new Date().toISOString();
  const status = transactionId ? 'Payment Pending' : 'New';
  const notes = transactionId
    ? `Payment form submitted. Transaction ID: ${transactionId}.`
    : 'Lead added from admin.';
  (async () => {
    try {
      if (usePostgres) {
        const result = await pgPool.query(
          'INSERT INTO lead (name, phone, email, status, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [name.trim(), phone.trim(), null, status, notes, createdAt]
        );
        const id = result.rows[0].id;
        await audit('lead_added', { id, name: name.trim() }, getClientIp(req));
        return res.json({ ok: true, id });
      }
      const result = await sqliteRun(
        'INSERT INTO lead (name, phone, email, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [name.trim(), phone.trim(), null, status, notes, createdAt]
      );
      await audit('lead_added', { id: result.lastID, name: name.trim() }, getClientIp(req));
      return res.json({ ok: true, id: result.lastID });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to save lead.' });
    }
  })();
});

app.delete('/lead/:id', requireAuth, apiLimiter, csrfProtect, (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id.' });
  (async () => {
    try {
      if (usePostgres) {
        const result = await pgPool.query('DELETE FROM lead WHERE id = $1', [id]);
        if (!result.rowCount) return res.status(404).json({ error: 'Lead not found.' });
        await audit('lead_deleted', { id }, getClientIp(req));
        return res.json({ ok: true });
      }
      const result = await sqliteRun('DELETE FROM lead WHERE id = ?', [id]);
      if (!result.changes) return res.status(404).json({ error: 'Lead not found.' });
      await audit('lead_deleted', { id }, getClientIp(req));
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete lead.' });
    }
  })();
});

app.get('/dashboard', (req, res) => {
  if (!req.session || req.session.user !== ADMIN_USER) {
    return res.redirect('/');
  }
  return res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Admin dashboard running on http://localhost:${PORT}`);
});
