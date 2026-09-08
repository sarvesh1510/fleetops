FROM python:3.11-slim

WORKDIR /app

# System deps for numpy/scipy/ortools
# Retry apt-get to handle transient DNS/network failures in Docker
RUN for i in 1 2 3; do \
      apt-get update && apt-get install -y --no-install-recommends --fix-missing \
        gcc g++ libffi-dev libssl-dev curl \
      && rm -rf /var/lib/apt/lists/* && break; \
      echo "apt-get attempt $i failed, retrying..."; \
      sleep 5; \
    done

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root user for security
RUN adduser --disabled-password --gecos '' appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
