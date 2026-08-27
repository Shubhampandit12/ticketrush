FROM node:22-slim

WORKDIR /app
COPY index.html app.js server.js ./

ENV PORTAL_PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
