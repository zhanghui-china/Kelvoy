import { getMe } from "../api/client";
import { usePolledApiResource } from "../hooks/useApiResource";

interface AccountCardProps {
  username?: string;
  available?: number;
  loading?: boolean;
  error?: string | null;
}

export function AccountCard({ username, available, loading = false, error = null }: AccountCardProps) {
  return (
    <div className="k-sidebar-account">
      <span className="k-sidebar-account-label">当前账号</span>
      <span className="k-sidebar-account-name">{username ?? (error ? "账号暂不可用" : "加载中…")}</span>
      <div className="k-sidebar-account-balance" aria-live="polite">
        <span className="k-sidebar-account-label">可用额度</span>
        {error ? <span className="k-sidebar-account-unavailable" role="status">余额暂不可用</span>
          : loading || available === undefined ? <span className="k-sidebar-account-label">加载中…</span>
            : <strong className="k-sidebar-account-credit-value k-mono">
                {available.toLocaleString("zh-CN")} <small>credits</small>
              </strong>}
      </div>
    </div>
  );
}

export default function AccountSummary() {
  const { loading, data, error } = usePolledApiResource(getMe, []);
  return <AccountCard username={data?.user.username} available={data?.balance.available}
    loading={loading} error={error} />;
}
