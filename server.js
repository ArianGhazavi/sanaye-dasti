
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const crypto = require("crypto");

const app = express();
const db = new sqlite3.Database(
  process.env.DB_FILE || "qazavi.sqlite"
);

app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));

app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite" }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'user'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT,
      category TEXT,
      price REAL,
      stock INTEGER,
      description TEXT,
      active INTEGER,
      image TEXT
    )
  `);
});

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) =>
      err ? reject(err) : resolve(row)
    );
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) =>
      err ? reject(err) : resolve(rows)
    );
  });

function auth(req, res, next) {
  if (!req.session.user)
    return res.status(401).json({ error: "ابتدا وارد شوید" });
  next();
}

function admin(req, res, next) {
  if (req.session.user?.role !== "admin")
    return res.status(403).json({ error: "فقط مدیر اجازه دارد" });
  next();
}

const safeUser = u => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role
});

// ثبت نام کاربران
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password || password.length < 8)
      return res.status(400).json({
        error: "نام، ایمیل و رمز حداقل ۸ کاراکتری لازم است"
      });

    const hash = await bcrypt.hash(password, 12);

    await run(
      "INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)",
      [name.trim(), email.toLowerCase().trim(), hash, "user"]
    );

    res.status(201).json({ ok: true });
  } catch {
    res.status(400).json({
      error: "ثبت نام ناموفق بود یا ایمیل تکراری است"
    });
  }
});

// ورود کاربران و مدیر
app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .toLowerCase().trim();

    const u = await get(
      "SELECT * FROM users WHERE email=?",
      [email]
    );

    if (!u || !(await bcrypt.compare(
      req.body.password || "",
      u.password_hash
    ))) {
      return res.status(401).json({
        error: "ایمیل یا رمز اشتباه است"
      });
    }

    req.session.regenerate(err => {
      if (err)
        return res.status(500).json({ error: "خطای نشست" });

      req.session.user = safeUser(u);
      res.json({ user: req.session.user });
    });
  } catch {
    res.status(500).json({ error: "خطای سرور" });
  }
});

// خروج
app.post("/api/logout", auth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// اطلاعات حساب
app.get("/api/me", auth, (req, res) => {
  res.json({ user: req.session.user });
});

// محصولات
app.get("/api/products", async (req, res) => {
  try {
    res.json(await all("SELECT * FROM products"));
  } catch {
    res.status(500).json({ error: "خطا" });
  }
});

// افزودن محصول فقط مدیر
app.post("/api/products", auth, admin, async (req, res) => {
  try {
    const p = req.body;
    const id = crypto.randomUUID();

    await run(
      "INSERT INTO products VALUES(?,?,?,?,?,?,?,?)",
      [id, p.name, p.category, p.price, p.stock,
       p.description, p.active ? 1 : 0, p.image || ""]
    );

    res.status(201).json({ id });
  } catch {
    res.status(400).json({ error: "ذخیره ناموفق" });
  }
});

// ویرایش محصول فقط مدیر
app.put("/api/products/:id", auth, admin, async (req, res) => {
  const p = req.body;

  await run(
    `UPDATE products SET name=?,category=?,price=?,
     stock=?,description=?,active=?,image=? WHERE id=?`,
    [p.name, p.category, p.price, p.stock,
     p.description, p.active ? 1 : 0,
     p.image || "", req.params.id]
  );

  res.json({ ok: true });
});

// حذف محصول فقط مدیر
app.delete("/api/products/:id", auth, admin, async (req, res) => {
  await run("DELETE FROM products WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// نمایش سایت
app.use(express.static(path.join(__dirname)));

// ایجاد حساب مدیر
(async () => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password || !process.env.SESSION_SECRET) {
    console.error("اطلاعات مدیر و SESSION_SECRET تنظیم نشده");
    process.exit(1);
  }

  const existing = await get(
    "SELECT id FROM users WHERE email=?",
    [email.toLowerCase()]
  );

  if (!existing) {
    await run(
      "INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)",
      ["مدیر", email.toLowerCase(),
       await bcrypt.hash(password, 12), "admin"]
    );
  } else {
    await run(
      "UPDATE users SET role='admin' WHERE email=?",
      [email.toLowerCase()]
    );
  }

  app.listen(process.env.PORT || 3000, () => {
    console.log("Website: http://localhost:3000");
  });
})();
