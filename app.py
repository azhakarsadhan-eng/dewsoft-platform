from datetime import datetime, date, timedelta
import base64
import json
import urllib.request
import os
from uuid import uuid4
from functools import wraps
from flask import Flask, jsonify, redirect, render_template, request, url_for, Response
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename

app = Flask(__name__)
db_path = os.getenv("DATABASE_URL")
if db_path and db_path.startswith("postgres://"):
    db_path = db_path.replace("postgres://", "postgresql://", 1)
if db_path and db_path.startswith("postgresql://"):
    db_path = db_path.replace("postgresql://", "postgresql+psycopg://", 1)
if not db_path:
    # Vercel serverless filesystem is read-only except /tmp.
    if os.getenv("VERCEL"):
        db_file = "/tmp/platform.db"
    else:
        os.makedirs(app.instance_path, exist_ok=True)
        db_file = os.path.join(app.instance_path, "platform.db")
    db_path = f"sqlite:///{db_file}"
app.config["SQLALCHEMY_DATABASE_URI"] = db_path
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["UPLOAD_FOLDER"] = os.path.join(app.root_path, "static", "posters")
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")
RAZORPAY_AMOUNT = int(os.getenv("RAZORPAY_AMOUNT", "20000"))
RAZORPAY_CURRENCY = os.getenv("RAZORPAY_CURRENCY", "INR")
RAZORPAY_NAME = os.getenv("RAZORPAY_NAME", "Success Journey Network")
RAZORPAY_DESCRIPTION = os.getenv("RAZORPAY_DESCRIPTION", "Joining fee")
ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASS = os.getenv("ADMIN_PASS", "admin123")

_db = SQLAlchemy(app)


class Lead(_db.Model):
    id = _db.Column(_db.Integer, primary_key=True)
    name = _db.Column(_db.String(120), nullable=False)
    phone = _db.Column(_db.String(40))
    email = _db.Column(_db.String(120))
    status = _db.Column(_db.String(40), default="New")
    notes = _db.Column(_db.Text)
    created_at = _db.Column(_db.DateTime, default=datetime.utcnow)


class ActivityLog(_db.Model):
    id = _db.Column(_db.Integer, primary_key=True)
    log_date = _db.Column(_db.Date, default=date.today, nullable=False)
    new_contacts = _db.Column(_db.Integer, default=0)
    show_plan = _db.Column(_db.Integer, default=0)
    follow_ups = _db.Column(_db.Integer, default=0)
    seminars = _db.Column(_db.Integer, default=0)
    training = _db.Column(_db.Integer, default=0)
    id_sent = _db.Column(_db.Integer, default=0)
    revenue = _db.Column(_db.Float, default=0.0)
    counselling = _db.Column(_db.Integer, default=0)
    experience = _db.Column(_db.Text)
    created_at = _db.Column(_db.DateTime, default=datetime.utcnow)


class ContactRequest(_db.Model):
    id = _db.Column(_db.Integer, primary_key=True)
    name = _db.Column(_db.String(120), nullable=False)
    phone = _db.Column(_db.String(40))
    message = _db.Column(_db.Text)
    created_at = _db.Column(_db.DateTime, default=datetime.utcnow)


class SiteSetting(_db.Model):
    id = _db.Column(_db.Integer, primary_key=True)
    official_url = _db.Column(_db.String(240))
    phone = _db.Column(_db.String(80))
    email = _db.Column(_db.String(120))
    whatsapp = _db.Column(_db.String(240))
    upi_id = _db.Column(_db.String(120))
    qr_url = _db.Column(_db.String(240))
    posters = _db.Column(_db.Text)
    updated_at = _db.Column(_db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def init_db():
    with app.app_context():
        _db.create_all()


init_db()


def _check_auth(username, password):
    return username == ADMIN_USER and password == ADMIN_PASS


def _authenticate():
    return Response(
        "Authentication required",
        401,
        {"WWW-Authenticate": 'Basic realm="DewSoft Admin"'},
    )


def _requires_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.authorization
        if not auth or not _check_auth(auth.username, auth.password):
            return _authenticate()
        return fn(*args, **kwargs)

    return wrapper


@app.route("/")
def home():
    return render_template("index_utf8.html")


@app.route("/admin")
@_requires_auth
def admin():
    return render_template("admin.html")


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/leads", methods=["GET", "POST"])
def leads():
    if request.method == "POST":
        data = request.get_json(force=True)
        lead = Lead(
            name=data.get("name", "").strip(),
            phone=data.get("phone"),
            email=data.get("email"),
            status=data.get("status", "New"),
            notes=data.get("notes"),
        )
        if not lead.name:
            return jsonify({"error": "name is required"}), 400
        _db.session.add(lead)
        _db.session.commit()
        return jsonify(_lead_to_dict(lead)), 201

    leads = Lead.query.order_by(Lead.created_at.desc()).all()
    return jsonify([_lead_to_dict(lead) for lead in leads])


@app.route("/api/leads/<int:lead_id>", methods=["PUT", "DELETE"])
def lead_detail(lead_id: int):
    lead = Lead.query.get_or_404(lead_id)
    if request.method == "DELETE":
        _db.session.delete(lead)
        _db.session.commit()
        return "", 204

    data = request.get_json(force=True)
    for field in ["name", "phone", "email", "status", "notes"]:
        if field in data:
            setattr(lead, field, data[field])
    _db.session.commit()
    return jsonify(_lead_to_dict(lead))


@app.route("/api/activity", methods=["GET", "POST"])
def activity():
    if request.method == "POST":
        data = request.get_json(force=True)
        log_date = _parse_date(data.get("log_date")) or date.today()
        entry = ActivityLog(
            log_date=log_date,
            new_contacts=_int(data.get("new_contacts")),
            show_plan=_int(data.get("show_plan")),
            follow_ups=_int(data.get("follow_ups")),
            seminars=_int(data.get("seminars")),
            training=_int(data.get("training")),
            id_sent=_int(data.get("id_sent")),
            revenue=_float(data.get("revenue")),
            counselling=_int(data.get("counselling")),
            experience=data.get("experience"),
        )
        _db.session.add(entry)
        _db.session.commit()
        return jsonify(_activity_to_dict(entry)), 201

    logs = ActivityLog.query.order_by(ActivityLog.log_date.desc()).all()
    return jsonify([_activity_to_dict(log) for log in logs])


@app.route("/api/contacts", methods=["GET", "POST"])
def contacts():
    if request.method == "POST":
        data = request.get_json(force=True)
        contact = ContactRequest(
            name=data.get("name", "").strip(),
            phone=data.get("phone"),
            message=data.get("message"),
        )
        if not contact.name:
            return jsonify({"error": "name is required"}), 400
        _db.session.add(contact)
        _db.session.commit()
        return jsonify(_contact_to_dict(contact)), 201

    contacts = ContactRequest.query.order_by(ContactRequest.created_at.desc()).all()
    return jsonify([_contact_to_dict(entry) for entry in contacts])


@app.route("/api/stats")
def stats():
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)

    daily = _sum_logs(ActivityLog.query.filter(ActivityLog.log_date == today).all())
    weekly = _sum_logs(ActivityLog.query.filter(ActivityLog.log_date >= week_start).all())
    monthly = _sum_logs(ActivityLog.query.filter(ActivityLog.log_date >= month_start).all())

    total_contacts = Lead.query.count()
    joined = Lead.query.filter(Lead.status == "Joined").count()

    return jsonify(
        {
            "daily": daily,
            "weekly": weekly,
            "monthly": monthly,
            "recruitment": {
                "total_contacts": total_contacts,
                "joined": joined,
            },
        }
    )


@app.route("/api/settings", methods=["GET", "PUT"])
def settings():
    if request.method == "PUT":
        data = request.get_json(force=True)
        setting = SiteSetting.query.first()
        if not setting:
            setting = SiteSetting()
            _db.session.add(setting)

        setting.official_url = data.get("official_url") or None
        setting.phone = data.get("phone") or None
        setting.email = data.get("email") or None
        setting.whatsapp = data.get("whatsapp") or None
        setting.upi_id = data.get("upi_id") or None
        setting.qr_url = data.get("qr_url") or None
        posters = data.get("posters")
        if isinstance(posters, list):
            setting.posters = ",".join([p.strip() for p in posters if p.strip()])
        else:
            setting.posters = data.get("posters") or None

        _db.session.commit()
        return jsonify(_settings_to_dict(setting))

    setting = SiteSetting.query.first()
    if not setting:
        return jsonify({})
    return jsonify(_settings_to_dict(setting))


@app.route("/api/razorpay/order", methods=["POST"])
def razorpay_order():
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        return jsonify({"error": "Razorpay is not configured"}), 500

    order = _create_razorpay_order(
        amount=RAZORPAY_AMOUNT,
        currency=RAZORPAY_CURRENCY,
        receipt=f"join-{uuid4().hex[:10]}",
    )
    if not order:
        return jsonify({"error": "Failed to create order"}), 502

    return jsonify(
        {
            "key_id": RAZORPAY_KEY_ID,
            "order_id": order.get("id"),
            "amount": order.get("amount"),
            "currency": order.get("currency"),
            "name": RAZORPAY_NAME,
            "description": RAZORPAY_DESCRIPTION,
        }
    )


@app.route("/api/upload", methods=["POST"])
def upload():
    if os.getenv("VERCEL"):
        return jsonify({"error": "File upload is not supported on Vercel storage. Use poster image URLs instead."}), 400
    if "files" not in request.files:
        return jsonify({"error": "No files provided"}), 400
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files provided"}), 400

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    uploaded = []
    for file in files:
        if not file or not file.filename:
            continue
        filename = secure_filename(file.filename)
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext not in ALLOWED_EXTENSIONS:
            continue
        unique_name = f"{uuid4().hex}.{ext}"
        save_path = os.path.join(app.config["UPLOAD_FOLDER"], unique_name)
        file.save(save_path)
        uploaded.append(url_for("static", filename=f"posters/{unique_name}"))

    if not uploaded:
        return jsonify({"error": "No valid images uploaded"}), 400
    return jsonify({"urls": uploaded}), 201


def _lead_to_dict(lead: Lead) -> dict:
    return {
        "id": lead.id,
        "name": lead.name,
        "phone": lead.phone,
        "email": lead.email,
        "status": lead.status,
        "notes": lead.notes,
        "created_at": lead.created_at.isoformat(),
    }


def _activity_to_dict(log: ActivityLog) -> dict:
    return {
        "id": log.id,
        "log_date": log.log_date.isoformat(),
        "new_contacts": log.new_contacts,
        "show_plan": log.show_plan,
        "follow_ups": log.follow_ups,
        "seminars": log.seminars,
        "training": log.training,
        "id_sent": log.id_sent,
        "revenue": log.revenue,
        "counselling": log.counselling,
        "experience": log.experience,
    }


def _contact_to_dict(contact: ContactRequest) -> dict:
    return {
        "id": contact.id,
        "name": contact.name,
        "phone": contact.phone,
        "message": contact.message,
        "created_at": contact.created_at.isoformat(),
    }


def _settings_to_dict(setting: SiteSetting) -> dict:
    posters = [p for p in (setting.posters or "").split(",") if p]
    return {
        "official_url": setting.official_url,
        "phone": setting.phone,
        "email": setting.email,
        "whatsapp": setting.whatsapp,
        "upi_id": setting.upi_id,
        "qr_url": setting.qr_url,
        "posters": posters,
    }


def _sum_logs(logs):
    return {
        "new_contacts": sum(log.new_contacts for log in logs),
        "show_plan": sum(log.show_plan for log in logs),
        "follow_ups": sum(log.follow_ups for log in logs),
        "seminars": sum(log.seminars for log in logs),
        "training": sum(log.training for log in logs),
        "id_sent": sum(log.id_sent for log in logs),
        "revenue": round(sum(log.revenue for log in logs), 2),
        "counselling": sum(log.counselling for log in logs),
    }


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _create_razorpay_order(amount: int, currency: str, receipt: str):
    url = "https://api.razorpay.com/v1/orders"
    payload = {
        "amount": amount,
        "currency": currency,
        "receipt": receipt,
        "payment_capture": 1,
    }
    token = base64.b64encode(f"{RAZORPAY_KEY_ID}:{RAZORPAY_KEY_SECRET}".encode("utf-8")).decode("utf-8")
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception:
        return None


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
