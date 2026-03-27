from __future__ import annotations

import json
import sys
from pathlib import Path

import face_recognition
import numpy as np
from PIL import Image, ImageOps


def load_normalized_image(image_path: Path, max_dimension: int) -> np.ndarray:
  with Image.open(image_path) as raw_image:
    normalized = ImageOps.exif_transpose(raw_image).convert("RGB")
    normalized.thumbnail((max_dimension, max_dimension))
    return np.array(normalized)


def main() -> int:
  if len(sys.argv) < 3:
    return 2

  image_path = Path(sys.argv[1])
  max_dimension = int(sys.argv[2])

  try:
    image = load_normalized_image(image_path, max_dimension)
    face_locations = face_recognition.face_locations(
      image,
      number_of_times_to_upsample=0,
      model="hog",
    )
    if len(face_locations) != 1:
      return 0

    encodings = face_recognition.face_encodings(image, face_locations)
    if not encodings:
      return 0

    sys.stdout.write(json.dumps(encodings[0].tolist()))
    return 0
  except Exception as exc:
    sys.stderr.write(str(exc))
    return 1


if __name__ == "__main__":
  raise SystemExit(main())
