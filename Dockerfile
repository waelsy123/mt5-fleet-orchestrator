FROM node:20-slim AS base

# Install Python 3 + pip for setup_vps.py provisioning
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-dev libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY python/requirements.txt /app/python/requirements.txt
RUN pip3 install --break-system-packages -r /app/python/requirements.txt

# Install Node dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Generate Prisma client and build Next.js
RUN npx prisma generate && npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy || echo 'Migration skipped (DB may not be ready)'; npm start"]
