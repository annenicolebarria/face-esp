from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import face_recognition
import numpy as np
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
FACE_API_URL = os.getenv("FACE_API_URL", "http://localhost:4000").rstrip("/")
CAMERA_SHARED_TOKEN = os.getenv("CAMERA_SHARED_TOKEN", "").strip()
MAX_IMAGE_DIMENSION = int(os.getenv("MAX_IMAGE_DIMENSION", "640"))
MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.50"))
MAX_IMAGES_PER_PERSON = int(os.getenv("MAX_IMAGES_PER_PERSON", "4"))
RECOGNITION_UPSAMPLE_TIMES = int(os.getenv("RECOGNITION_UPSAMPLE_TIMES", "1"))
CORS_ORIGINS = [
  origin.strip()
  for origin in os.getenv(
    "CORS_ORIGINS",
    "http://localhost:8081,http://localhost:8082,http://localhost:19006,http://localhost:5173",
  ).split(",")
  if origin.strip()
]


def resolve_app_path(raw_path: str) -> Path:
  configured = Path(raw_path)
  if configured.is_absolute():
    return configured.resolve()
  return (BASE_DIR / configured).resolve()


DATASET_DIR = resolve_app_path(os.getenv("DATASET_DIR", "./dataset"))
UNKNOWN_SAVE_DIR = resolve_app_path(os.getenv("UNKNOWN_SAVE_DIR", "./captures/unrecognized"))


@dataclass
class KnownFace:
  user_id: Optional[int]
  label: str
  image_path: str
  encoding: np.ndarray


app = FastAPI(title="PTC Face Recognition Service")
app.add_middleware(
  CORSMiddleware,
  allow_origins=CORS_ORIGINS or ["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)
KNOWN_FACES: list[KnownFace] = []
KNOWN_FACES_LOCK = threading.Lock()
DATASET_STATE_LOCK = threading.Lock()
DATASET_STATE = {
  "loading": False,
  "loaded": False,
  "persons": 0,
  "images": 0,
  "lastLoadedAt": None,
  "lastError": None,
}


def downscale_image(image: np.ndarray, max_dimension: int = MAX_IMAGE_DIMENSION) -> np.ndarray:
  height, width = image.shape[:2]
  largest_dimension = max(height, width)
  if largest_dimension <= max_dimension:
    return image

  step = max(2, int(np.ceil(largest_dimension / max_dimension)))
  return image[::step, ::step]


def parse_user_folder(folder_name: str) -> tuple[Optional[int], str]:
  user_id = None
  label = folder_name
  if "_" in folder_name:
    head, tail = folder_name.split("_", 1)
    if head.isdigit():
      user_id = int(head)
      label = tail.replace("_", " ").strip()
  elif folder_name.isdigit():
    user_id = int(folder_name)

  return user_id, label


def fetch_remote_dataset_manifest() -> dict:
  if not CAMERA_SHARED_TOKEN:
    print("[DATASET] Skipping remote manifest: CAMERA_SHARED_TOKEN is not configured.")
    return {"activeUserIds": set(), "remoteUsers": {}}

  try:
    response = requests.get(
      f"{FACE_API_URL}/api/internal/face-enrollment-dataset",
      headers={"x-camera-token": CAMERA_SHARED_TOKEN},
      timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
  except requests.RequestException as exc:
    print(f"[DATASET] Remote manifest unavailable: {exc}")
    return {"activeUserIds": set(), "remoteUsers": {}}

  remote_users: dict[int, dict] = {}
  for row in payload.get("images", []):
    try:
      user_id = int(row.get("userId"))
    except (TypeError, ValueError):
      continue

    public_url = str(row.get("publicUrl") or "").strip()
    if not public_url:
      continue

    label = str(row.get("label") or "").strip() or f"User {user_id}"
    remote_users.setdefault(user_id, {"label": label, "images": []})["images"].append(
      {
        "publicUrl": public_url,
        "captureOrder": int(row.get("captureOrder") or 0),
      }
    )

  for user_info in remote_users.values():
    user_info["images"].sort(key=lambda image: image["captureOrder"])

  active_user_ids = {
    int(user_id)
    for user_id in payload.get("activeUserIds", [])
    if str(user_id).isdigit()
  }

  return {
    "activeUserIds": active_user_ids,
    "remoteUsers": remote_users,
  }


def load_known_faces() -> dict[str, int]:
  loaded_faces: list[KnownFace] = []
  image_count = 0
  remote_manifest = fetch_remote_dataset_manifest()
  active_user_ids: set[int] = remote_manifest["activeUserIds"]
  remote_users: dict[int, dict] = remote_manifest["remoteUsers"]
  remote_user_ids = set(remote_users.keys())

  if not DATASET_DIR.exists():
    DATASET_DIR.mkdir(parents=True, exist_ok=True)

  for person_dir in sorted(DATASET_DIR.iterdir()):
    if not person_dir.is_dir():
      continue

    user_id, label = parse_user_folder(person_dir.name)
    if user_id is not None:
      if active_user_ids and user_id not in active_user_ids:
        continue
      if user_id in remote_user_ids:
        continue

    loaded_for_person = 0

    for image_path in sorted(person_dir.iterdir()):
      if image_path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
        continue

      if loaded_for_person >= MAX_IMAGES_PER_PERSON:
        break

      encoding = extract_face_encoding(image_path)
      if encoding is None:
        continue

      try:
        loaded_faces.append(
          KnownFace(
            user_id=user_id,
            label=label,
            image_path=str(image_path),
            encoding=encoding,
          )
        )
        image_count += 1
        loaded_for_person += 1
      except Exception:
        continue

  for user_id, remote_user in sorted(remote_users.items()):
    loaded_for_person = 0

    for image_info in remote_user["images"]:
      if loaded_for_person >= MAX_IMAGES_PER_PERSON:
        break

      encoding = extract_remote_face_encoding(image_info["publicUrl"])
      if encoding is None:
        continue

      try:
        loaded_faces.append(
          KnownFace(
            user_id=user_id,
            label=remote_user["label"],
            image_path=image_info["publicUrl"],
            encoding=encoding,
          )
        )
        image_count += 1
        loaded_for_person += 1
      except Exception:
        continue

  with KNOWN_FACES_LOCK:
    KNOWN_FACES.clear()
    KNOWN_FACES.extend(loaded_faces)

  persons = len({(face.user_id, face.label) for face in loaded_faces})
  return {"persons": persons, "images": image_count}


def extract_face_encoding(image_path: Path) -> Optional[np.ndarray]:
  worker_path = BASE_DIR / "dataset_worker.py"

  try:
    result = subprocess.run(
      [
        sys.executable,
        str(worker_path),
        str(image_path),
        str(MAX_IMAGE_DIMENSION),
      ],
      capture_output=True,
      text=True,
      timeout=30,
      check=False,
    )
  except Exception:
    return None

  if result.returncode != 0:
    stderr = result.stderr.strip()
    if stderr:
      print(f"[DATASET] Skipped {image_path.name}: {stderr}")
    return None

  payload = result.stdout.strip()
  if not payload:
    return None

  try:
    return np.array(json.loads(payload), dtype=np.float64)
  except Exception:
    return None


def extract_remote_face_encoding(public_url: str) -> Optional[np.ndarray]:
  try:
    response = requests.get(public_url, timeout=30)
    response.raise_for_status()
  except requests.RequestException as exc:
    print(f"[DATASET] Failed to download remote face image: {exc}")
    return None

  temp_path: Optional[Path] = None
  try:
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as handle:
      handle.write(response.content)
      temp_path = Path(handle.name)

    return extract_face_encoding(temp_path)
  finally:
    if temp_path is not None:
      try:
        temp_path.unlink(missing_ok=True)
      except Exception:
        pass


def update_dataset_state(**updates: object) -> None:
  with DATASET_STATE_LOCK:
    DATASET_STATE.update(updates)


def schedule_dataset_reload(wait: bool = False) -> None:
  def worker() -> None:
    update_dataset_state(loading=True, lastError=None)
    print(f"[DATASET] Loading faces from {DATASET_DIR}")
    try:
      stats = load_known_faces()
      print(
        f"[DATASET] Loaded {stats['images']} images across {stats['persons']} people "
        f"(max {MAX_IMAGES_PER_PERSON}/person, max dimension {MAX_IMAGE_DIMENSION}px)"
      )
      update_dataset_state(
        loading=False,
        loaded=True,
        persons=stats["persons"],
        images=stats["images"],
        lastLoadedAt=datetime.now(timezone.utc).isoformat(),
        lastError=None,
      )
    except Exception as exc:  # pragma: no cover - diagnostic path
      print(f"[DATASET] Load failed: {exc}")
      update_dataset_state(
        loading=False,
        loaded=False,
        lastError=str(exc),
      )

  thread = threading.Thread(target=worker, daemon=True)
  thread.start()
  if wait:
    thread.join()


def save_unknown_image(image_bytes: bytes, camera_id: str) -> str:
  UNKNOWN_SAVE_DIR.mkdir(parents=True, exist_ok=True)
  timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
  filename = f"{camera_id}_{timestamp}.jpg"
  output = UNKNOWN_SAVE_DIR / filename
  output.write_bytes(image_bytes)
  return str(output)


def post_camera_log(payload: dict) -> dict:
  if not CAMERA_SHARED_TOKEN:
    raise RuntimeError("Missing CAMERA_SHARED_TOKEN in recognition service.")

  try:
    response = requests.post(
      f"{FACE_API_URL}/api/camera/logs",
      json=payload,
      headers={"x-camera-token": CAMERA_SHARED_TOKEN},
      timeout=15,
    )
  except requests.RequestException as exc:
    return {
      "ok": False,
      "queued": False,
      "error": f"face-api unavailable: {exc}",
    }

  if response.status_code >= 400:
    return {
      "ok": False,
      "queued": False,
      "error": f"face-api rejected camera log: {response.status_code} {response.text}",
    }

  return response.json()


def confidence_from_distance(distance: float) -> float:
  score = max(0.0, min(1.0, 1.0 - distance))
  return round(score * 100, 2)


@app.on_event("startup")
def startup_event() -> None:
  DATASET_DIR.mkdir(parents=True, exist_ok=True)
  UNKNOWN_SAVE_DIR.mkdir(parents=True, exist_ok=True)
  schedule_dataset_reload(wait=False)


@app.get("/health")
def health() -> dict:
  with KNOWN_FACES_LOCK:
    known_faces_count = len(KNOWN_FACES)
  with DATASET_STATE_LOCK:
    state = dict(DATASET_STATE)

  return {
    "ok": True,
    "knownFaces": known_faces_count,
    "datasetDir": str(DATASET_DIR),
    "datasetLoading": state["loading"],
    "datasetLoaded": state["loaded"],
    "persons": state["persons"],
    "images": state["images"],
    "lastLoadedAt": state["lastLoadedAt"],
    "lastError": state["lastError"],
  }


@app.post("/reload-dataset")
def reload_dataset() -> dict:
  schedule_dataset_reload(wait=False)
  with DATASET_STATE_LOCK:
    state = dict(DATASET_STATE)
  return {"ok": True, "queued": True, **state}


@app.post("/recognize")
async def recognize(
  request: Request,
  camera_id: str = Query(..., min_length=1),
) -> dict:
  image_bytes = await request.body()
  if not image_bytes:
    raise HTTPException(status_code=400, detail="Missing JPEG body.")

  with KNOWN_FACES_LOCK:
    known_faces = list(KNOWN_FACES)
  with DATASET_STATE_LOCK:
    dataset_loading = bool(DATASET_STATE["loading"])

  if dataset_loading and not known_faces:
    raise HTTPException(status_code=503, detail="Dataset is still loading. Try again in a few seconds.")

  if not known_faces:
    raise HTTPException(status_code=500, detail="Dataset is empty. Load enrolled face images first.")

  try:
    image = face_recognition.load_image_file(io.BytesIO(image_bytes))
  except Exception as exc:
    raise HTTPException(status_code=400, detail=f"Invalid image payload: {exc}") from exc

  face_locations = face_recognition.face_locations(
    image,
    number_of_times_to_upsample=RECOGNITION_UPSAMPLE_TIMES,
    model="hog",
  )
  if len(face_locations) == 0:
    return {
      "matched": False,
      "ignored": True,
      "reason": "no face detected",
      "facesDetected": 0,
    }
  encodings = face_recognition.face_encodings(image, face_locations)
  if not encodings:
    return {
      "matched": False,
      "ignored": True,
      "reason": "face detected but encoding failed",
      "facesDetected": 1,
    }

  known_encodings = np.array([face.encoding for face in known_faces])
  results: list[dict] = []
  unknown_save_path: Optional[str] = None

  for probe in encodings:
    distances = face_recognition.face_distance(known_encodings, probe)
    best_index = int(np.argmin(distances))
    best_distance = float(distances[best_index])
    best_face = known_faces[best_index]
    matched = best_distance <= MATCH_THRESHOLD
    confidence = confidence_from_distance(best_distance)
    detected_at = datetime.now(timezone.utc).isoformat()

    if matched:
      payload = {
        "userId": best_face.user_id,
        "userNameSnapshot": best_face.label,
        "cameraId": camera_id,
        "event": "entry",
        "confidence": confidence,
        "detectedAt": detected_at,
      }
      log_row = post_camera_log(payload)
      results.append({
        "matched": True,
        "userId": best_face.user_id,
        "label": best_face.label,
        "distance": round(best_distance, 4),
        "confidence": confidence,
        "log": log_row,
      })
      continue

    if unknown_save_path is None:
      unknown_save_path = save_unknown_image(image_bytes, camera_id)

    payload = {
      "userId": None,
      "userNameSnapshot": "Unknown Face",
      "cameraId": camera_id,
      "event": "unrecognized",
      "confidence": confidence,
      "detectedAt": detected_at,
    }
    log_row = post_camera_log(payload)
    results.append({
      "matched": False,
      "label": best_face.label,
      "distance": round(best_distance, 4),
      "confidence": confidence,
      "savedImage": unknown_save_path,
      "log": log_row,
    })

  recognized_count = sum(1 for result in results if result["matched"])
  unrecognized_count = len(results) - recognized_count
  response = {
    "matched": recognized_count > 0,
    "facesDetected": len(face_locations),
    "facesEncoded": len(encodings),
    "recognizedCount": recognized_count,
    "unrecognizedCount": unrecognized_count,
    "results": results,
  }

  if len(results) == 1:
    response.update(results[0])

  return response
