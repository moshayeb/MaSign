FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # Embedding model weights are cached here; docker-compose mounts a volume
    # on it so the download happens once, not on every container recreate.
    HF_HOME=/app/.cache/huggingface

WORKDIR /app

# Install dependencies first so code changes don't invalidate this layer.
# torch comes from the CPU-only index (~200 MB) instead of the CUDA build.
COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r requirements.txt

COPY app ./app
COPY data/sample_contracts ./data/sample_contracts

# Uploads, indexes and the model cache are written at runtime; keep them owned
# by the app user.
RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p data/uploads data/indexes .cache/huggingface \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
