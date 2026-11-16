/**
 * Serves the built web app (`web/dist`) from the API so the hosted app is one origin.
 *
 * Hashed files under `assets/` are cached for a year; everything else, including the
 * `index.html` fallback for client-side paths, is `no-cache` so a deploy is visible on
 * the next page load. Unknown `/api` paths stay JSON 404s.
 *
 * `webAppCsp` lists every origin the page loads from: OpenFreeMap tiles and glyphs,
 * Google Fonts, and Firebase sign-in (the Google popup loads `apis.google.com` and
 * frames the project's `firebaseapp.com` auth domain).
 */
import { sep } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

const FIREBASE_AUTH_FRAMES = ["https://*.firebaseapp.com", "https://accounts.google.com"];

export const webAppCsp = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "https://apis.google.com"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:", "blob:", "https://tiles.openfreemap.org"],
  connectSrc: ["'self'", "https://tiles.openfreemap.org", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com"],
  workerSrc: ["'self'", "blob:"],
  frameSrc: FIREBASE_AUTH_FRAMES,
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  frameAncestors: ["'none'"],
};

const isApiPath = (url: string) => url === "/api" || url.startsWith("/api/") || url.startsWith("/api?");

export async function serveWebApp(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    cacheControl: false,
    setHeaders: (reply, path) => reply.header("cache-control", path.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache"),
  });
  app.setNotFoundHandler((req, reply) =>
    req.method === "GET" && !isApiPath(req.url)
      ? reply.sendFile("index.html")
      : reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found" } }),
  );
}
