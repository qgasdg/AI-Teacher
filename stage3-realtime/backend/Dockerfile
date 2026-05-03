FROM python:3.11-slim

# 직독직해 STT 전처리(webm → 16kHz mono wav 변환 + 분할)에 ffmpeg 사용
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8001

CMD ["python", "main.py"]
