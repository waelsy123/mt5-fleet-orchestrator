FROM node:20-slim AS base

# Install Python 3 + pip for setup_vps.py provisioning
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv python3-dev libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies in a venv
COPY python/requirements.txt /app/python/requirements.txt
RUN python3 -m venv /app/venv && \
    /app/venv/bin/pip install -r /app/python/requirements.txt
ENV PATH="/app/venv/bin:$PATH"

# Install Node dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Generate Prisma client and build Next.js
RUN npx prisma generate && npm run build

# Create non-root user and set ownership
RUN adduser --disabled-password --gecos "" --uid 1001 appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy || echo 'Migration skipped'; PORT=${PORT:-3000} npm start"]
