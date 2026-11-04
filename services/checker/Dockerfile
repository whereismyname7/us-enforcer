FROM node:20-alpine
WORKDIR /app
COPY package.json ./
# Training rooms often intercept HTTPS and break npm's certificate check.
RUN npm config set strict-ssl false \
 && npm install --omit=dev
COPY . ./
USER node
CMD ["node", "consumer.js"]
