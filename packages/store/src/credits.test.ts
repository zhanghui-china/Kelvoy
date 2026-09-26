import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, open } from "./db";
import { finalizeCredits, getCreditBalance, getCreditPrice, grantCredits, listCreditLedger, reserveCredits, setCreditPrice } from "./credits";
import { createUser } from "./users";

let userId = "";
beforeEach(async () => {
  open(":memory:");
  const created = await createUser({ username: "tester", password_hash: "hash" });
  if (!created.ok) throw new Error("fixture user failed");
  userId = created.user.user_id;
});
afterEach(() => close());

test("new accounts have zero available credits and default action prices", () => {
  expect(getCreditBalance(userId)).toEqual({ available: 0, reserved: 0 });
  expect([getCreditPrice("script"), getCreditPrice("image"), getCreditPrice("video"), getCreditPrice("compose")])
    .toEqual([1, 1, 10, 1]);
});

test("team grants are immutable, idempotent, and available for reservations", () => {
  expect(grantCredits(userId, 30, "grant-1")).toMatchObject({ ok: true, repeated: false });
  expect(grantCredits(userId, 30, "grant-1")).toMatchObject({ ok: true, repeated: true });
  expect(grantCredits(userId, 40, "grant-1")).toEqual({ ok: false, error: "idempotency_conflict" });
  const reservation = reserveCredits({ action_id: "action-1", user_id: userId, kind: "video", units: 2 });
  expect(reservation).toMatchObject({ ok: true, action: { price: 20, status: "reserved" } });
  expect(getCreditBalance(userId)).toEqual({ available: 10, reserved: 20 });
  expect(reserveCredits({ action_id: "action-1", user_id: userId, kind: "video", units: 2 }))
    .toMatchObject({ ok: true, repeated: true });
  expect(finalizeCredits("action-1", "settled")).toEqual({ ok: true, repeated: false });
  expect(finalizeCredits("action-1", "settled")).toEqual({ ok: true, repeated: true });
  expect(finalizeCredits("action-1", "released")).toEqual({ ok: false, error: "already_finalized" });
  expect(getCreditBalance(userId)).toEqual({ available: 10, reserved: 0 });
  expect(listCreditLedger(userId).map((entry) => entry.kind)).toEqual(["settled", "reserve", "grant"]);
});

test("insufficient balance never creates an action; failure releases exactly once", () => {
  expect(reserveCredits({ action_id: "too-expensive", user_id: userId, kind: "image", units: 1 }))
    .toEqual({ ok: false, error: "insufficient_credits" });
  expect(listCreditLedger(userId)).toHaveLength(0);
  grantCredits(userId, 5, "grant-2");
  reserveCredits({ action_id: "image-1", user_id: userId, kind: "image", units: 3 });
  expect(finalizeCredits("image-1", "released")).toEqual({ ok: true, repeated: false });
  expect(finalizeCredits("image-1", "released")).toEqual({ ok: true, repeated: true });
  expect(getCreditBalance(userId)).toEqual({ available: 5, reserved: 0 });
});

test("a changed team price only applies to new reservations", () => {
  grantCredits(userId, 30, "grant-3");
  reserveCredits({ action_id: "first", user_id: userId, kind: "video", units: 1 });
  setCreditPrice("video", 12);
  const second = reserveCredits({ action_id: "second", user_id: userId, kind: "video", units: 1 });
  expect(second).toMatchObject({ ok: true, action: { price: 12 } });
  expect(getCreditBalance(userId)).toEqual({ available: 8, reserved: 22 });
});
