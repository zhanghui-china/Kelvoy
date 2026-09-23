import postgres from "postgres";

// ADR-0003: postgres.js, no ORM. Lazy singleton so `validate-destination`
// tests that never touch the DB don't need DATABASE_URL set.
let client: postgres.Sql | null = null;

export function getDb(): postgres.Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    client = postgres(url);
  }
  return client;
}

// postgres.js keeps its TCP connection open (keepalive), so a CLI process
// that opened one and never closes it will hang after finishing its work
// instead of exiting. Callers that are done for good — like the CLI's
// main() — must call this; long-lived processes (a future apps/web) should
// not.
export async function closeDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
  }
}
