import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register } from "../api/client";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await register(username, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error === "username_taken" ? "用户名已被占用" : (result.error ?? "注册失败"));
      return;
    }
    navigate("/episodes");
  }

  return (
    <div>
      <h1>注册</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>
            用户名
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
        </div>
        <div>
          <label>
            密码
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
        </div>
        {error && <p style={{ color: "red" }}>{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "注册中…" : "注册"}
        </button>
      </form>
      <p>
        已有账号？<Link to="/login">登录</Link>
      </p>
    </div>
  );
}
