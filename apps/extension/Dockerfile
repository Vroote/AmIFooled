FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
# WXT's postinstall needs the workspace config and entrypoints.
COPY apps/extension ./apps/extension
RUN npm ci
ARG WXT_API_BASE_URL=http://127.0.0.1:8000
ENV WXT_API_BASE_URL=$WXT_API_BASE_URL
RUN npm run zip --workspace @amifooled/extension \
    && mkdir /artifacts \
    && cp -r apps/extension/.output/chrome-mv3 /artifacts/chrome-mv3 \
    && cp apps/extension/.output/*-chrome.zip /artifacts/amifooled-chrome.zip

# Export only browser files, without Node, source code or dependencies.
FROM scratch AS export
COPY --from=build /artifacts/ /
