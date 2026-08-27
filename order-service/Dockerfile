FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

ENV ORDER_PORT=4002
ENV DATABASE_URL=/app/data/orders.db
RUN mkdir -p /app/data

EXPOSE 4002

# node:sqlite needs --experimental-sqlite on Node 22.x; the flag is a
# harmless no-op once a Node version stabilizes the module.
CMD ["node", "--experimental-sqlite", "src/server.js"]
