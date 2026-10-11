import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ShotFailureNotice } from "./ShotFailure";

test("selected shot displays only its stable identity diagnostic", () => {
  const html = renderToStaticMarkup(<ShotFailureNotice shot={{shot_id:"b",status:"failed"}}
    failures={[{shot_id:"a",code:"generation_timeout",message:"另一镜超时"},{shot_id:"b",code:"model_execution_failed",message:"模型执行失败"}]} />);
  expect(html).toContain("模型执行失败");
  expect(html).not.toContain("另一镜超时");
  expect(html).not.toContain("积分已退回");
});

test("historic failure has an explicit unknown reason and successful shots hide failures", () => {
  expect(renderToStaticMarkup(<ShotFailureNotice shot={{shot_id:"b",status:"failed"}} />)).toContain("历史任务未记录具体原因");
  expect(renderToStaticMarkup(<ShotFailureNotice shot={{shot_id:"b",status:"approved"}} />)).toBe("");
});

test("failed shot offers a per-shot retry; other statuses and read-only notices do not", () => {
  const failed = { shot_id: "b", status: "failed" };
  expect(renderToStaticMarkup(<ShotFailureNotice shot={failed} onRetry={() => {}} />)).toContain(">重试这一镜</button>");
  expect(renderToStaticMarkup(<ShotFailureNotice shot={failed} />)).not.toContain("<button");
  expect(renderToStaticMarkup(<ShotFailureNotice shot={{ shot_id: "b", status: "approved" }} onRetry={() => {}} />)).toBe("");
});

test("queued or pending retry disables the button and explains the wait", () => {
  const failed = { shot_id: "b", status: "failed" };
  const queued = renderToStaticMarkup(<ShotFailureNotice shot={failed} onRetry={() => {}} queued />);
  expect(queued).toContain('disabled="">已排队，等待后台处理</button>');
  const pending = renderToStaticMarkup(<ShotFailureNotice shot={failed} onRetry={() => {}} pending />);
  expect(pending).toContain('disabled="">正在提交重试…</button>');
});
