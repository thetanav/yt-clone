import DodoPayments from "dodopayments";

export const PREMIUM_PRODUCT_ID =
  process.env.DODO_PREMIUM_PRODUCT_ID ?? "pdt_0NiktpLIrpLxOZ49bgP7d";

export function getDodoClient() {
  const token = process.env.DODO_PAYMENTS_API_KEY;
  if (!token) {
    throw new Error("DODO_PAYMENTS_API_KEY is not configured");
  }

  return new DodoPayments({
    bearerToken: token,
    webhookKey: process.env.WEBHOOK_SECRET_KEY,
    environment: "test_mode",
  });
}