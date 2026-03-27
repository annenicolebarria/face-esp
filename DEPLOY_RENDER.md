## Render Deploy

This project is prepared for a 3-service Render deploy:

1. `ptc-admin-web`
2. `ptc-face-api`
3. `ptc-face-recognition`

The blueprint file is [render.yaml](/workspace/render.yaml).

### Before Deploy

1. Put this project in a Git repository.
2. Push it to GitHub or GitLab.
3. Keep the `face-recognition-service/dataset` folder in the repo only if you are intentionally deploying those face images.

### Create the Blueprint

1. In Render, choose `New +`.
2. Choose `Blueprint`.
3. Connect the repo that contains this project.
4. Render will detect `render.yaml`.

### Required Environment Variables

Set these in Render before the first deploy:

- `ptc-face-api`
  - `DATABASE_URL`
  - `CAMERA_SHARED_TOKEN`
  - `DEVICE_SHARED_TOKEN`
  - `CORS_ORIGINS`

- `ptc-face-recognition`
  - `FACE_API_URL`
    - Example: `https://ptc-face-api.onrender.com`
  - `CAMERA_SHARED_TOKEN`
  - `CORS_ORIGINS`

### After Deploy

Update the ESP device URLs:

- `hardware/face.ino`
  - replace `http://192.168.0.9:4000` with your public API URL

- `hardware/face-cam.ino`
  - replace `http://192.168.0.9:8001` with your public recognition URL

Then reflash the boards.

### Important

If users will access the app or site from different Wi-Fi networks, the ESP devices must point to the deployed public URLs, not your local LAN IP.
