# Start from the official Node.js 20 image, the small "alpine" edition.
FROM node:20-alpine

# Work inside a folder called /app inside the image.
WORKDIR /app

# Copy only the dependency list first, so Docker can cache the install step.
COPY package.json ./

# Install the libraries listed in package.json.
# Training rooms often intercept HTTPS and break npm's certificate check (same as Lab2).
# strict-ssl false lets the install finish here. Do not copy this into production builds.
RUN npm config set strict-ssl false \
 && npm install --omit=dev

# Copy the rest of this service's files into the image.
COPY . ./

# Documentation only: the service listens on port 3000.
EXPOSE 3000

# Do not run as the root superuser.
USER node

# Start the service.
CMD ["node", "server.js"]
