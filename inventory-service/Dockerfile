FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

ENV INVENTORY_PORT=4001
EXPOSE 4001

CMD ["node", "src/server.js"]
