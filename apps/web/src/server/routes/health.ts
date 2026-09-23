import { Hono } from "hono";

const health = new Hono().get("/", (c) => c.json({ status: "ok" }));

export default health;
