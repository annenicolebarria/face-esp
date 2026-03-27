# face-recognition-service

Simple FastAPI service for ESP32-CAM uploads.

## Dataset layout

Store enrolled images in folders under `dataset/`.

Examples:

```txt
dataset/
  2_Juan_Dela_Cruz/
    1.jpg
    2.jpg
  3_Maria_Santos/
    1.jpg
    2.jpg
```

- The leading number is used as `user_id`.
- The rest of the folder name becomes the user label.
- If the numeric id is missing or outdated, the backend will still try to match the label against the user's full name.
- Add 3 to 5 clear images per person.

## Environment

Copy `.env.example` to `.env` and fill values.

## Install

```bash
pip install -r requirements.txt
```

### Windows shortcut

If `dlib` fails to build on Windows, use the bundled installer instead:

```powershell
.\install-windows.ps1
```

## Run

```bash
uvicorn app:app --host 0.0.0.0 --port 8001
```

If you used the Windows installer, run:

```powershell
.\.venv311\Scripts\python -m uvicorn app:app --host 0.0.0.0 --port 8001
```

## Endpoints

- `GET /health`
- `POST /recognize?camera_id=ESP32-CAM-01`
- `POST /reload-dataset`

`/recognize` expects raw JPEG bytes in the request body.

## Dataset-only flow

1. Create a folder per person inside `dataset/`.
2. Put 3 to 5 clear face images in each folder.
3. Call `POST /reload-dataset` or restart the service.
4. Let the ESP32-CAM keep sending frames to `/recognize`.

There is no app-side registration or face-enrollment flow in this setup.

For best results, keep each folder name aligned with the real account:

```txt
dataset/
  2_Juan_Dela_Cruz/
  3_Maria_Santos/
  Anne_Nicole/
```

The backend will first trust the numeric `user_id`, then fall back to the full-name label.
