import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "../api/client";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await login(username, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error === "invalid_credentials" ? "用户名或密码不对" : (result.error ?? "登录失败"));
      return;
    }
    navigate("/episodes");
  }

  return (
    <div>
      <h1>登录</h1>
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
          {submitting ? "登录中…" : "登录"}
        </button>
      </form>
      <p>
        没有账号？<Link to="/register">注册</Link>
      </p>
    </div>
  );
}
