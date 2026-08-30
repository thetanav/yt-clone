import { Hono } from "hono";

import db from "@/lib/db";
import { getDodoClient, PREMIUM_PRODUCT_ID } from "@/lib/dodo";
import { authMiddleware, requireAuth } from "@/lib/hono-auth";
import type { AuthVariables } from "@/lib/hono-auth";

const billing = new Hono<{ Variables: AuthVariables }>();

billing.get(
  "/checkout",
  authMiddleware,
  requireAuth,
  async (c) => {
    const user = c.get("user")!;

    if (!user.email || !user.name) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const dodoClient = getDodoClient();

    const session = await dodoClient.checkoutSessions.create({
      product_cart: [{ product_id: PREMIUM_PRODUCT_ID, quantity: 1 }],
      customer: { email: user.email, name: user.name },
      metadata: { userId: user.id },
      return_url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000/",
    });

    if (!session.checkout_url) {
      return c.json(
        { error: "Dodo checkout URL is not configured" },
        500,
      );
    }

    return c.redirect(session.checkout_url);
  },
);

billing.post("/dodo/webhook", async (c) => {
  const secret = process.env.WEBHOOK_SECRET_KEY;
  if (!secret) {
    return c.json(
      { error: "Dodo webhook secret is not configured" },
      500,
    );
  }

  const body = await c.req.text();
  let payload: any;
  try {
    const dodoClient = getDodoClient();
    payload = dodoClient.webhooks.unwrap(body, {
      headers: Object.fromEntries(c.req.raw.headers.entries()),
      key: secret,
    });
  } catch {
    return c.json(
      { error: "Invalid or unsigned webhook payload" },
      400,
    );
  }

  console.log("Received Dodo webhook:", payload);

  const cart = payload.data.product_cart;

  if (cart[0].product_id == PREMIUM_PRODUCT_ID) {
    await db.user.update({
      where: { email: payload.data.customer.email },
      data: { plan: "plus" },
    });

    return c.json({ ok: true, planChanged: "plus" });
  }

  return c.json({ ok: true });
});

export default billing;
