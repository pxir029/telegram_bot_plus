# PX Bot v1.1

پنل مدیریت حرفه‌ای ربات تلگرام روی **Cloudflare Workers**

## قابلیت‌ها

- رابط گلس‌مورفیسم خفیف + Tailwind (فقط SVG، بدون emoji)
- مدیریت کاربران: ۱۵ نفر در صفحه + آیدی عددی + جستجو + مسدودسازی
- **متغیرهای قالب در پیام‌ها:**
  - `(username)` نام کاربری
  - `(first_name)` / `(last_name)` / `(full_name)`
  - `(id)` آیدی عددی
  - `(time)` ساعت لحظه ارسال
  - `(date)` تاریخ
  - `(datetime)` تاریخ و ساعت
- **ارسال همگانی** با جایگزینی خودکار متغیرها برای هر کاربر
- **پیام زمان‌دار:**
  - یک‌بار در تاریخ/ساعت مشخص
  - روزانه هر روز در `HH:MM`
  - ساعتی در دقیقه مشخص
  - اجرا با Cron هر دقیقه روی Cloudflare
- متن قابل تنظیم `/start`
- امنیت: PBKDF2، کوکی HttpOnly، CSP، Secret Token وب‌هوک

## نصب

```bash
cd px-bot
npm install
npx wrangler kv namespace create PX_KV
# شناسه را در wrangler.toml بگذارید
npm run build
npx wrangler login
npm run deploy
```

رمز پیش‌فرض: **pxbot123** (بعد از ورود اجباری تغییر می‌کند)

## مثال متن

```
سلام (username)!
الان ساعت (time) به تاریخ (date) است.
آیدی شما: (id)
```

