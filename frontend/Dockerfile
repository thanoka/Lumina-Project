FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Expose Metro Bundler (8081) and Web (8081 usually, or you can specify)
EXPOSE 8081

# Run expo start --web
CMD ["npm", "run", "web"]
