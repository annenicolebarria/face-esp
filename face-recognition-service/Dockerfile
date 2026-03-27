FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
      "numpy==2.3.3" \
      "fastapi==0.116.1" \
      "python-dotenv==1.1.1" \
      "requests==2.32.5" \
      "uvicorn==0.35.0" \
      "Pillow>=11.0.0,<12.0.0" \
      "click" \
      "face-recognition-models==0.3.0" \
      "dlib-bin==19.24.6" && \
    pip install --no-cache-dir "face_recognition==1.3.0" --no-deps

COPY . .

EXPOSE 10000

CMD ["sh", "-c", "python -m uvicorn app:app --host 0.0.0.0 --port ${PORT:-10000}"]
