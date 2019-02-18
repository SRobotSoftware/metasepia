FROM node:11.6-alpine

RUN apk add --no-cache git

WORKDIR /usr/src/app

COPY package.json .
COPY package-lock.json .

RUN npm ci

COPY . .

CMD node index.js
