#!/usr/bin/env bash
# 从本机把当前 main 发布到 DGX 节点（Web + Worker）。Inference 不动。
# NODE=gx10（默认）或 NODE=spark（黑客松节点，SSH 走公网 6063 端口、密钥 ~/.ssh/kelvoy_dgx，
# 账号与地址见 infra/dgx/README.md，须通过 GX10_HOST=<user>@<ip> 给出）。惯例先 spark、后 gx10。
#
# 用法：
#   [NODE=spark GX10_HOST=<user>@<ip>] infra/dgx/release-gx10.sh <label> [stage] [迁移参数...]
#   stage：check | prepare | switch | verify | all（默认 all）
#   迁移参数（仅当 packages/store/src/schema.ts 有改动时必须给）：
#     --allow-new-table <表名> --allow-migration <迁移id>   （可重复）
#
# 例：
#   release-gx10.sh landmark-hints prepare
#   release-gx10.sh three-views all --allow-new-table persona_asset_jobs --allow-migration persona_asset_jobs_v1
#
# 分阶段是为了安全：prepare 只在节点上建新发布目录并验证，不碰线上服务；
# switch 才会停服务、备份库、切换，执行前要求手动输入 yes。
#
# 这个脚本固化了 2026-10-13 发布踩过的坑：
#  - 非交互 SSH 的 PATH 里没有 bun，必须显式 export；管道必须 pipefail，否则 `bun … | tail` 的失败被吞。
#  - RELEASE.json 必须带 commit 字段，deploy-web-worker.py 在停服务前就会读它。
#  - macOS tar 要 COPYFILE_DISABLE=1，避免 ._* 文件被 bun 当测试加载。
#  - 基线取节点上正在运行的 worker 发布目录的 RELEASE.json，而不是靠记忆，防止漏发中间提交。
#  - 前端必须在节点上重建并 dist_stamp，否则线上还是旧 JS。
set -euo pipefail

LABEL="${1:-}"
STAGE="${2:-all}"
[[ -n "$LABEL" ]] || { sed -n '2,20p' "$0"; exit 2; }
[[ "$LABEL" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "label 只能含小写字母、数字、连字符" >&2; exit 2; }
shift $(( $# >= 2 ? 2 : 1 ))
MIGRATION_ARGS=("$@")

NODE="${NODE:-gx10}"
case "$NODE" in
  gx10)  GX10_HOST="${GX10_HOST:-huntun@100.80.224.95}"   # 默认值取自 README 记录的 gx10-8e22 SSH 账号
         PORT="${GX10_PORT:-22}";   KEY="${GX10_KEY:-$HOME/.ssh/visionary_dgx}" ;;
  spark) GX10_HOST="${GX10_HOST:?NODE=spark 需要 GX10_HOST=<user>@<ip>（见 infra/dgx/README.md 黑客松节点一节）}"
         PORT="${GX10_PORT:-6063}"; KEY="${GX10_KEY:-$HOME/.ssh/kelvoy_dgx}" ;;
  *) echo "未知 NODE: ${NODE}（gx10 | spark）" >&2; exit 2 ;;
esac
DATA_ROOT_REL="kelvoy/apps/web"   # 相对节点 $HOME；其下 data/kelvoy.db 与 projects/
PATH_FIX='export PATH=$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin'

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
HEAD_SHA="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"
NAME="${LABEL}-$(date +%Y%m%d)-${SHORT}"
PKG_DIR="${TMPDIR:-/tmp}/kelvoy-release-$NAME"
TARBALL="$PKG_DIR/$NAME.tgz"

ssh_run() { ssh -i "$KEY" -p "$PORT" -o BatchMode=yes -o ConnectTimeout=15 "$GX10_HOST" "$@"; }
# 在节点上跑一段脚本：统一 pipefail 与 PATH，N=发布名通过环境传入。
remote() { ssh_run "N=$NAME bash -se" <<EOF
set -eo pipefail
$PATH_FIX
$1
EOF
}

# ---------- check：本机门槛 + 基线 ----------
stage_check() {
  [[ -z "$(git status --porcelain)" ]] || { echo "工作区不干净，先提交或 stash" >&2; exit 1; }
  [[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || { echo "只从 main 发布" >&2; exit 1; }
  echo "==> 本机 typecheck + test"
  make typecheck
  make test

  echo "==> 读取节点当前发布"
  CUR_DIR="$(ssh_run 'readlink /proc/$(systemctl --user show kelvoy-worker -p MainPID --value)/cwd')"
  BASE="$(ssh_run "python3 -c \"import json,sys;print(json.load(open(sys.argv[1]+'/RELEASE.json'))['commit'])\" '$CUR_DIR'")"
  git cat-file -e "${BASE}^{commit}" || { echo "本地没有基线提交 $BASE" >&2; exit 1; }
  git merge-base --is-ancestor "$BASE" HEAD || { echo "基线 $BASE 不是 HEAD 的祖先，拒绝发布" >&2; exit 1; }
  BASE_SHORT="$(git rev-parse --short "$BASE")"
  # 变量一律加花括号：全角标点紧跟 $VAR 时，部分 bash/locale 会把它吞进变量名（unbound variable）。
  echo "    节点运行：${CUR_DIR}（${BASE_SHORT}）"
  echo "    将发布：  ${SHORT}（$(git rev-list --count "$BASE..HEAD") 个提交）"
  [[ "$BASE" != "$HEAD_SHA" ]] || { echo "节点已是最新，无需发布"; exit 0; }

  # 不发 spike/ 与 docs/（与历次发布一致）；infra/ 要发，部署脚本本身可能有改动。
  EXCLUDES=(':!spike' ':!docs')
  if git diff --name-only "$BASE" HEAD -- packages/store/src/schema.ts | grep -q . && [[ ${#MIGRATION_ARGS[@]} -eq 0 ]]; then
    echo "packages/store/src/schema.ts 有改动，需要显式给出迁移闸门参数：" >&2
    echo "  --allow-new-table <表名> --allow-migration <迁移id>" >&2
    git diff "$BASE" HEAD -- packages/store/src/schema.ts packages/store/src/db.ts | grep -E '^\+.*(create table|schema_migrations|migration_id|run\(")' >&2 || true
    exit 1
  fi
}

# ---------- prepare：打包、上传、节点上建目录并验证（不碰线上） ----------
stage_prepare() {
  echo "==> 打包 $NAME"
  rm -rf "$PKG_DIR"; mkdir -p "$PKG_DIR/stage"
  git diff --name-only --diff-filter=ACMR "$BASE" HEAD -- . "${EXCLUDES[@]}" > "$PKG_DIR/files.txt"
  git diff --name-only --diff-filter=D "$BASE" HEAD -- . "${EXCLUDES[@]}" > "$PKG_DIR/deleted.txt"
  [[ -s "$PKG_DIR/files.txt" ]] || { echo "没有可发布的文件变更" >&2; exit 1; }
  git archive HEAD $(sed 's/.*/"&"/' "$PKG_DIR/files.txt" | xargs) | tar -x -C "$PKG_DIR/stage"
  python3 -I - "$PKG_DIR" "$HEAD_SHA" "$BASE" "$NAME" <<'PY'
import hashlib, json, pathlib, sys
pkg, commit, base, name = sys.argv[1:]
stage = pathlib.Path(pkg, "stage")
files = {str(p.relative_to(stage)): hashlib.sha256(p.read_bytes()).hexdigest()
         for p in sorted(stage.rglob("*")) if p.is_file()}
deleted = pathlib.Path(pkg, "deleted.txt").read_text().split()
manifest = {"commit": commit, "base_commit": base, "note": name, "deleted": deleted, "files": files}
(stage / "RELEASE.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
print(f"    {len(files)} 个文件，{len(deleted)} 个删除")
PY
  (cd "$PKG_DIR/stage" && COPYFILE_DISABLE=1 tar -czf "$TARBALL" .)
  if tar -tzf "$TARBALL" | grep -q '/\._'; then echo "包里混入 ._* 文件" >&2; exit 1; fi

  echo "==> 上传"
  scp -q -P "$PORT" -i "$KEY" "$TARBALL" "$GX10_HOST:/tmp/$NAME.tgz"

  echo "==> 节点上建发布目录并验证（线上服务不动）"
  remote "
CUR=\$(readlink /proc/\$(systemctl --user show kelvoy-worker -p MainPID --value)/cwd)
NEW=\$HOME/kelvoy-releases/\$N
[ ! -e \"\$NEW\" ] || { echo \"\$NEW 已存在，换个 label 或先清理\"; exit 1; }
echo \"磁盘：\$(df -h \$HOME | tail -1)\"
cp -a \"\$CUR\" \"\$NEW\"
tar --warning=no-unknown-keyword -xzf /tmp/\$N.tgz -C \"\$NEW\"
cd \"\$NEW\"
python3 -I - <<'PY'
import json, os
for p in json.load(open('RELEASE.json')).get('deleted', []):
    if os.path.exists(p): os.remove(p)
PY
bun install --frozen-lockfile 2>&1 | tail -3
bun run --filter './apps/*' build 2>&1 | tail -3
python3 infra/dgx/dist_stamp.py stamp \"\$NEW\"
python3 infra/dgx/dist_stamp.py verify \"\$NEW\"
bun run typecheck 2>&1 | tail -6
bun test 2>&1 | tail -6 | tee /tmp/\$N.test.log
grep -q ' 0 fail' /tmp/\$N.test.log || { echo '节点测试有失败，停止'; exit 1; }
"

  if [[ ${#MIGRATION_ARGS[@]} -gt 0 ]]; then
    echo "==> 迁移预演（生产库副本，两遍幂等）"
    remote "
cd \$HOME/kelvoy-releases/\$N
python3 infra/dgx/rehearse-migration.py --database \$HOME/$DATA_ROOT_REL/data/kelvoy.db --release \$PWD ${MIGRATION_ARGS[*]} --expect-empty-new-table
"
    echo "    ↑ 核对 new_tables / new_migrations 是否正是预期"
  fi
}

# ---------- switch：真正切换（会短暂停服） ----------
stage_switch() {
  echo "==> 切换前查在途任务"
  remote "
python3 -I - <<'PY'
import os, sqlite3
c = sqlite3.connect('file:' + os.path.expanduser('~/$DATA_ROOT_REL/data/kelvoy.db') + '?mode=ro', uri=True)
print('tasks', c.execute(\"select status,count(*) from tasks where status in ('pending','processing') group by status\").fetchall())
PY
"
  read -r -p "确认切换 ${NODE} 到 ${NAME}？Web 会短暂不可用 (yes/N) " ok
  [[ "$ok" == "yes" ]] || { echo "已取消"; exit 1; }
  local flags=""
  if [[ ${#MIGRATION_ARGS[@]} -gt 0 ]]; then flags="${MIGRATION_ARGS[*]} --expect-empty-new-table"; fi
  remote "
cd \$HOME/kelvoy-releases/\$N
python3 infra/dgx/deploy-web-worker.py --release \$PWD --data-root \$HOME/$DATA_ROOT_REL --name \$N $flags
"
}

# ---------- verify：切换后只读验收 ----------
stage_verify() {
  remote "
for s in kelvoy-web kelvoy-worker kelvoy-inference; do
  echo \"\$s \$(systemctl --user is-active \$s) restarts=\$(systemctl --user show \$s -p NRestarts --value) wd=\$(readlink /proc/\$(systemctl --user show \$s -p MainPID --value)/cwd)\"
done
echo \"health: \$(curl -s localhost:8888/api/health)\"
echo \"js: \$(curl -s localhost:8888/ | grep -o 'index-[A-Za-z0-9_-]*\\.js' | head -1)\"
echo \"err lines (3min): \$(journalctl --user -u kelvoy-web -u kelvoy-worker --since '-3min' -p err --no-pager | grep -vc '^-- ')\"
ls ~/.config/systemd/user/kelvoy-web.service.d | tail -1
python3 -I - <<'PY'
import os, sqlite3
c = sqlite3.connect('file:' + os.path.expanduser('~/$DATA_ROOT_REL/data/kelvoy.db') + '?mode=ro', uri=True)
print('migrations', sorted(r[0] for r in c.execute('select migration_id from schema_migrations')))
PY
"
  echo "==> 期望：web/worker active、restarts=0、wd 为 ${NAME}、health ok、err 0、drop-in 最后一项含 $NAME"
  echo "    回退：删 kelvoy-{web,worker}.service.d/ 下含 $NAME 的 conf → daemon-reload → 重启 web、worker（不恢复数据库）"
}

case "$STAGE" in
  check)   stage_check ;;
  prepare) stage_check; stage_prepare ;;
  switch)  stage_check; stage_switch; stage_verify ;;
  verify)  stage_verify ;;
  all)     stage_check; stage_prepare; stage_switch; stage_verify ;;
  *) echo "未知 stage: $STAGE" >&2; exit 2 ;;
esac
