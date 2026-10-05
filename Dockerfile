# Build with this directory as the context:
#   docker build -t voxlix-frontend .
#   docker run --rm -p 8080:80 voxlix-frontend
#
# Two stages: Node compiles the Angular app, nginx serves the result. The Node
# toolchain is ~400 MB and is not needed to serve static files, so it stays in
# the builder and never reaches the shipped image.

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Dependencies are installed before the sources are copied so that editing a
# component doesn't invalidate the (slow) install layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The API's address is baked into the bundle from src/app/core/endpoints.ts, so
# the build takes no arguments — and changing environment means editing that
# constant and rebuilding.
RUN npm run build


# ── Serve ────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Angular's application builder emits the browser bundle under browser/; the
# licence file sits outside it and is not served.
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html

EXPOSE 80
