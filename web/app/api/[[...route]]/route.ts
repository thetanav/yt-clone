import { Hono } from "hono";
import { handle } from "hono/vercel";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import authRoutes from "@/app/routes/auth";
import videosRoutes from "@/app/routes/videos";
import videoActionsRoutes from "@/app/routes/video-actions";
import uploadRoutes from "@/app/routes/upload";
import uploadPresignRoutes from "@/app/routes/upload-presign";
import statusRoutes from "@/app/routes/status";
import quotaRoutes from "@/app/routes/quota";
import billingRoutes from "@/app/routes/billing";
import deleteRoutes from "@/app/routes/delete";

const app = new Hono().basePath("/api");

app.use("*", logger());

app.use(
  "/api/auth/*",
  cors({
    origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

app.route("/auth", authRoutes);
app.route("/videos", videosRoutes);
app.route("/videos", videoActionsRoutes);
app.route("/upload", uploadRoutes);
app.route("/upload/p", uploadPresignRoutes);
app.route("/status", statusRoutes);
app.route("/quota", quotaRoutes);
app.route("/billing", billingRoutes);
app.route("/delete", deleteRoutes);

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
