import { getDb } from "./db";

export type CreditKind = "script" | "image" | "video" | "compose";
export type CreditBalance = { available: number; reserved: number };
export type CreditAction = {
  action_id: string;
  user_id: string;
  episode_id: string | null;
  task_id: string | null;
  kind: CreditKind;
  units: number;
  price: number;
  status: "reserved" | "settled" | "released";
};

function ensureAccount(userId: string): void {
  getDb().query("insert or ignore into credit_accounts (user_id) values (?)").run(userId);
}

export function getCreditBalance(userId: string): CreditBalance {
  ensureAccount(userId);
  return getDb().query<CreditBalance, [string]>(
    "select available, reserved from credit_accounts where user_id = ?",
  ).get(userId)!;
}

export function listCreditLedger(userId: string, limit = 100): {
  entry_id: string; action_id: string; kind: string;
  available_delta: number; reserved_delta: number; created_at: string;
}[] {
  return getDb().query<{
    entry_id: string; action_id: string; kind: string;
    available_delta: number; reserved_delta: number; created_at: string;
  }, [string, number]>(
    `select entry_id, action_id, kind, available_delta, reserved_delta, created_at
     from credit_ledger where user_id = ? order by rowid desc limit ?`,
  ).all(userId, Math.max(1, Math.min(500, limit)));
}

export function getCreditPrice(kind: CreditKind): number {
  const row = getDb().query<{ price: number }, [string]>(
    "select price from credit_prices where kind = ?",
  ).get(kind);
  if (!row) throw new Error(`missing credit price: ${kind}`);
  return row.price;
}

export function estimateCreditQuote(candidates: number, shotCount = 30): number {
  if (!Number.isInteger(candidates) || candidates < 1 || candidates > 3 ||
      !Number.isInteger(shotCount) || shotCount < 0) throw new Error("invalid quote parameters");
  return getCreditPrice("script") + shotCount * candidates * getCreditPrice("image") +
    shotCount * getCreditPrice("video") + getCreditPrice("compose");
}

export function setCreditPrice(kind: CreditKind, price: number): void {
  if (!Number.isSafeInteger(price) || price < 0) throw new Error("price must be a nonnegative integer");
  getDb().query("update credit_prices set price = ? where kind = ?").run(price, kind);
}

/** Team-issued grant with an external idempotency key. No public route calls this. */
export function grantCredits(userId: string, amount: number, grantId: string):
  { ok: true; balance: CreditBalance; repeated: boolean } | { ok: false; error: "not_found" | "invalid_amount" | "idempotency_conflict" } {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  return getDb().transaction(() => {
    const user = getDb().query<{ user_id: string }, [string]>("select user_id from users where user_id = ?").get(userId);
    if (!user) return { ok: false, error: "not_found" } as const;
    const existing = getDb().query<{ user_id: string; available_delta: number }, [string, string]>(
      "select user_id, available_delta from credit_ledger where action_id = ? and kind = ?",
    ).get(grantId, "grant");
    if (existing) {
      if (existing.user_id !== userId || existing.available_delta !== amount) {
        return { ok: false, error: "idempotency_conflict" } as const;
      }
      return { ok: true, balance: getCreditBalance(userId), repeated: true } as const;
    }
    ensureAccount(userId);
    getDb().query("update credit_accounts set available = available + ? where user_id = ?")
      .run(amount, userId);
    appendLedger(userId, grantId, "grant", amount, 0);
    return { ok: true, balance: getCreditBalance(userId), repeated: false } as const;
  }).immediate();
}

export function reserveCredits(input: {
  action_id: string; user_id: string; episode_id?: string; task_id?: string;
  kind: CreditKind; units: number;
}): { ok: true; action: CreditAction; repeated: boolean } |
  { ok: false; error: "not_found" | "invalid_units" | "insufficient_credits" | "idempotency_conflict" } {
  if (!Number.isSafeInteger(input.units) || input.units <= 0) return { ok: false, error: "invalid_units" };
  return getDb().transaction(() => {
    const user = getDb().query<{ user_id: string }, [string]>("select user_id from users where user_id = ?")
      .get(input.user_id);
    if (!user) return { ok: false, error: "not_found" } as const;
    const existing = readAction(input.action_id);
    if (existing) {
      if (existing.user_id !== input.user_id || existing.episode_id !== (input.episode_id ?? null) ||
          existing.task_id !== (input.task_id ?? null) || existing.kind !== input.kind ||
          existing.units !== input.units) return { ok: false, error: "idempotency_conflict" } as const;
      return { ok: true, action: existing, repeated: true } as const;
    }
    const price = getCreditPrice(input.kind) * input.units;
    if (!Number.isSafeInteger(price)) return { ok: false, error: "invalid_units" } as const;
    ensureAccount(input.user_id);
    const debit = getDb().query(
      "update credit_accounts set available = available - ?, reserved = reserved + ? where user_id = ? and available >= ?",
    ).run(price, price, input.user_id, price);
    if (debit.changes !== 1) return { ok: false, error: "insufficient_credits" } as const;
    getDb().query(`insert into credit_actions
      (action_id, user_id, episode_id, task_id, kind, units, price, status)
      values (?, ?, ?, ?, ?, ?, ?, 'reserved')`)
      .run(input.action_id, input.user_id, input.episode_id ?? null, input.task_id ?? null,
        input.kind, input.units, price);
    appendLedger(input.user_id, input.action_id, "reserve", -price, price);
    return { ok: true, action: readAction(input.action_id)!, repeated: false } as const;
  }).immediate();
}

/** Finalization is idempotent; a failed task releases its full reservation. */
export function finalizeCredits(actionId: string, outcome: "settled" | "released"):
  { ok: true; repeated: boolean } | { ok: false; error: "not_found" | "already_finalized" } {
  return getDb().transaction(() => {
    const action = readAction(actionId);
    if (!action) return { ok: false, error: "not_found" } as const;
    if (action.status !== "reserved") {
      return action.status === outcome ? { ok: true, repeated: true } as const
        : { ok: false, error: "already_finalized" } as const;
    }
    const refund = outcome === "released" ? action.price : 0;
    getDb().query("update credit_accounts set available = available + ?, reserved = reserved - ? where user_id = ?")
      .run(refund, action.price, action.user_id);
    getDb().query("update credit_actions set status = ?, updated_at = datetime('now') where action_id = ?")
      .run(outcome, actionId);
    appendLedger(action.user_id, actionId, outcome, refund, -action.price);
    return { ok: true, repeated: false } as const;
  }).immediate();
}

function readAction(actionId: string): CreditAction | null {
  return getDb().query<CreditAction, [string]>(
    "select action_id, user_id, episode_id, task_id, kind, units, price, status from credit_actions where action_id = ?",
  ).get(actionId);
}

export function getCreditAction(actionId: string): CreditAction | null {
  return readAction(actionId);
}

function appendLedger(userId: string, actionId: string, kind: string, availableDelta: number, reservedDelta: number): void {
  getDb().query(`insert into credit_ledger
    (entry_id, user_id, action_id, kind, available_delta, reserved_delta) values (?, ?, ?, ?, ?, ?)`)
    .run(`cl_${crypto.randomUUID()}`, userId, actionId, kind, availableDelta, reservedDelta);
}
