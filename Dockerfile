# Stateless CLI container (local-only usage by default).
# Includes git because the CLI can generate patches via `git diff --no-index`.
FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY bin ./bin
COPY src ./src
COPY docs ./docs
COPY cli_cmd_list.md ./cli_cmd_list.md
COPY README.md ./README.md

ENTRYPOINT ["node", "bin/statute.mjs"]

