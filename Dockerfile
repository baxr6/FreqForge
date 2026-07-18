FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY static ./static

# SQLite file lives here — mount this as a volume to persist across container recreation
VOLUME ["/app/data"]

EXPOSE 5055

CMD ["python", "app.py"]
