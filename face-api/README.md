# face-api

Express + PostgreSQL backend for your admin dashboard and future mobile app.

## 1) Create Online Database (Supabase)
1. Create a Supabase project.
2. Open SQL Editor.
3. Run [`database/schema.sql`](./database/schema.sql).
4. Run [`database/seed.sql`](./database/seed.sql).

Default seeded admin:
- username: `admin`
- password: `admin`

## 2) Configure Environment
1. Copy `.env.example` to `.env`.
2. Fill values:

```env
PORT=4000
DATABASE_URL=postgresql://postgres:your_password@db.your-project-ref.supabase.co:5432/postgres
DB_SSL=true
JWT_SECRET=replace_with_long_random_secret
CORS_ORIGINS=http://localhost:5173
CAMERA_SHARED_TOKEN=replace_with_camera_shared_token
DEVICE_SHARED_TOKEN=replace_with_device_shared_token
```

## 3) Run API
```bash
npm install
npm run dev
```

Health check:
- `GET http://localhost:4000/health`

## 4) API Endpoints

### Auth
- `POST /api/auth/login`
  - body: `{ "username": "admin", "password": "admin" }`
  - response: `{ token, admin }`

### Admin
- `GET /api/admin/me` (Bearer token)
- `PUT /api/admin/credentials` (Bearer token)
  - body: `{ "currentPassword": "...", "newUsername": "...", "newPassword": "..." }`

### Users
- `GET /api/users` (Bearer token)
- `POST /api/users` (Bearer token)
  - body: `{ "firstName", "lastName", "username", "email", "role", "status", "password" }`
- `PATCH /api/users/:id` (Bearer token)
  - body: `{ "role": "admin|user", "status": "active|inactive" }`

### Logs
- `GET /api/logs?event=all&limit=50` (Bearer token)
- `POST /api/logs` (Bearer token)
  - body: `{ "userId", "userNameSnapshot", "cameraId", "event", "confidence", "detectedAt" }`
- `POST /api/camera/logs` (`x-camera-token` header)
  - body: `{ "userId", "userNameSnapshot", "cameraId", "event", "confidence", "detectedAt" }`
- `POST /api/device/sensor-logs` (`x-device-token` header)
  - body: `{ "deviceKey", "pirState", "fanIsOn", "temperatureC", "humidity" }`
- `GET /api/device/fan-state?deviceKey=acebott-main-01` (`x-device-token` header)

### Dashboard
- `GET /api/dashboard/summary` (Bearer token)

## 5) Password Hash Utility
Generate a bcrypt hash:

```bash
npm run hash:password -- MyNewPassword123
```
