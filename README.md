# نظام محادثة مباشر (Live Chat System)

نظام دردشة مباشر يشبه ChatGPT من حيث التصميم، لكن الردود يقدمها مدير بشري من لوحة تحكم خاصة، عبر Socket.io في الوقت الحقيقي.

## الهيكل

```
chat ai2020/
├── server/                # الباكند (Node + Express + Socket.io)
│   ├── src/
│   │   ├── index.js       # الخادم + REST API + Socket.io + تقديم الواجهة
│   │   └── db.js          # طبقة التخزين (JSON file) مع نسخ احتياطي وتنظيف
│   ├── public/            # (يُنشأ عند البناء) ملفات الواجهة المبنية
│   ├── .env.example       # مثال للمتغيرات البيئية
│   ├── railway.json       # تكوين Railway للخادم منفرداً
│   └── package.json
├── client/                # الواجهة (React + Vite + Tailwind)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── index.css
│   │   ├── config.js      # تكوين API URL (VITE_API_URL + fallback)
│   │   ├── context/SocketContext.jsx
│   │   ├── components/
│   │   │   ├── MessageBubble.jsx
│   │   │   └── TypingIndicator.jsx
│   │   └── pages/
│   │       ├── Chat.jsx           # واجهة المستخدم
│   │       └── admin/
│   │           ├── Login.jsx      # دخول المدير
│   │           └── Panel.jsx      # لوحة التحكم
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── .env.example
│   └── package.json
├── railway.json           # تكوين Railway للنظام كامل (خدمة واحدة)
├── nixpacks.toml          # تكوين بناء Nixpacks
├── Dockerfile             # Docker بديل (multi-stage)
├── .dockerignore
├── .nvmrc                 # إصدار Node (20)
└── .gitignore
```

## التشغيل المحلي

### 1) الباكند
```bash
cd server
cp .env.example .env      # عدّل القيم حسب الحاجة
npm install
npm start                 # http://localhost:5000
```

### 2) الواجهة (في طرفية أخرى، وضع التطوير)
```bash
cd client
npm install
npm run dev               # http://localhost:5173 (proxy إلى :5000)
```

## الاستخدام

- **واجهة المستخدم:** http://localhost:5173 (تطوير) أو جذر الدومين (إنتاج)
- **لوحة المدير:** /admin (تُحوّل تلقائياً لصفحة الدخول)
- **بيانات الدخول الافتراضية:** `admin` / `admin123` (غيّرها في `.env`)

## النشر على Railway.app

### الخيار الموصى به: خدمة واحدة (الواجهة + الباكند معاً)

1. **ارفع الكود إلى GitHub** (تأكد أن `.env` غير مضمّن).

2. **أنشئ خدمة جديدة على Railway:**
   - اذهب إلى [railway.app](https://railway.app) → New → GitHub Repo
   - اختر مستودع المشروع
   - Railway سيكتشف `railway.json` و `nixpacks.toml` تلقائياً
   - البناء: يثبّت اعتماديات client و server، يبني الواجهة، ينسخها إلى `server/public/`
   - التشغيل: `cd server && npm start`

3. **اضبط متغيرات البيئة** في تبويب Variables:
   ```
   NODE_ENV=production
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=your_strong_password
   JWT_SECRET=your_long_random_secret (64+ chars)
   CLIENT_URL=              # اتركه فارغاً (same-origin)
   DB_PATH=./data/chat.json
   ```
   مولّد JWT_SECRET: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

4. **(اختياري) لإبقاء البيانات دائمة:** أضف Volume وأشر `DB_PATH` إليه:
   - Settings → Volumes → Add Volume
   - Mount path: `/data`
   - ثم اضبط: `DB_PATH=/data/chat.json`

5. Railway سيمنحك URL عام (مثل `https://your-app.up.railway.app`).
   - الواجهة: `https://your-app.up.railway.app/`
   - لوحة المدير: `https://your-app.up.railway.app/admin`
   - فحص الصحة: `https://your-app.up.railway.app/health`

### الخيار البديل: Dockerfile
إذا فضّلت Docker، Railway سيكتشف `Dockerfile` تلقائياً (multi-stage: يبني الواجهة ثم يخدمها الباكند).

### الخيار البديل: خدمتان منفصلتان (frontend + backend)
- خدمة الباكند: استخدم `server/railway.json`، اضبط `CLIENT_URL` لـ URL الواجهة.
- خدمة الواجهة: اضبط `VITE_API_URL` لـ URL الباكند، استخدم `npm run build` + static hosting.

## الميزات

### واجهة المستخدم
- تصميم ChatGPT-like مع وضع داكن/فاتح
- فقاعات رسائل (المستخدم أزرق يميناً، المدير رمادي يساراً)
- مؤشر "يكتب..." متحرك
- وقت الإرسال لكل رسالة
- شاشة ترحيب وتمرير تلقائي
- **إعادة اتصال تلقائية** مع شريط "جارٍ إعادة الاتصال..."
- إنهاء المحادثة وحفظ السجل
- تصميم متجاوب (Mobile-First) و RTL

### لوحة المدير
- دخول محمي بـ JWT
- قائمة المحادثات النشطة مع آخر رسالة ووقت النشاط
- مؤشر أحمر للرسائل غير المقروءة + عدّاد
- تبويبات للرد على عدة محادثات
- **تحديث تلقائي للقائمة كل 30 ثانية**
- إشعار صوتي (Web Audio API) قابل للكتم
- مسح السجل وإنهاء المحادثة
- **إعادة اتصال تلقائية** مع إعادة الانضمام للغرف

### الباكند (إنتاج)
- **helmet** لرؤوس الأمان (X-Frame-Options, HSTS, XSS Protection, إلخ)
- **compression** لضغط الردود (gzip)
- **/health** للفحص الصحي (Health Check)
- **Global Error Handler** شامل
- **Graceful Shutdown** (SIGTERM/SIGINT/uncaughtException)
- CORS مرن (same-origin في الإنتاج)
- التحقق من المدخلات وتقييد حجم الرسائل (5000 حرف)
- trust proxy للعمل خلف Railway proxy

### التخزين
- كتابة ذرية (atomic write) لمنع تلف الملف
- **نسخ احتياطي تلقائي كل ساعة** (يُحتفظ بها 24 ساعة)
- **تنظيف تلقائي** للمحادثات الأقدم من 7 أيام
- استرجاع تلقائي من النسخة الاحتياطية عند تلف الملف الرئيسي
- debounced saves مع تأخير لمنع التزامن المدمر
- الواجهة معزولة في `db.js` — قابلة للاستبدال بـ MongoDB

### الوقت الحقيقي
- Socket.io لوصول الرسائل فوراً للطرفين
- مؤشرات الكتابة (typing indicators)
- إشعارات اتصال/انقطاع المستخدم
- إعادة انضمام تلقائية للغرف بعد إعادة الاتصال
- ping/pong محسّن (25s/20s)

## التقنيات
- **Frontend:** React 18, Vite, Tailwind CSS, Framer Motion, React Router, Socket.io-client, Axios, React Hot Toast, Lucide React
- **Backend:** Node.js 20+, Express, Socket.io, JWT, bcryptjs, helmet, compression, CORS, dotenv
- **Deploy:** Railway (Nixpacks أو Dockerfile), Node 20
