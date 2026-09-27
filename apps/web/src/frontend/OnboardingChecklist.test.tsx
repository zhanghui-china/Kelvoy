import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { OnboardingChecklist } from "./OnboardingChecklist";

test("shows five milestones and a failed episode retry link", () => {
  const html = renderToStaticMarkup(<StaticRouter location="/episodes"><OnboardingChecklist
    completed={[true, true, false, false, false]} href="/episodes/e_2" failed={true} targetDone={false}
    collapsed={false} onToggle={() => {}} onDismiss={() => {}} pending={false}
  /></StaticRouter>);
  expect(html.match(/<li/g)).toHaveLength(5);
  expect(html).toContain('href="/episodes/e_2"');
  expect(html).toContain("查看失败并重试");
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain("隐藏引导");
});

test("completed checklist collapses to an expandable summary", () => {
  const html = renderToStaticMarkup(<StaticRouter location="/episodes"><OnboardingChecklist
    completed={[true, true, true, true, true]} href="/episodes/e_2" failed={false} targetDone={true}
    collapsed={true} onToggle={() => {}} onDismiss={() => {}} pending={false}
  /></StaticRouter>);
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-controls="onboarding-content"');
  expect(html).toContain('id="onboarding-content" hidden=""');
  expect(html).toContain("5/5");
});

test("account completion does not label an active episode as a finished film", () => {
  const html = renderToStaticMarkup(<StaticRouter location="/episodes"><OnboardingChecklist
    completed={[true, true, true, true, true]} href="/episodes/e_2" failed={false} targetDone={false}
    collapsed={false} onToggle={() => {}} onDismiss={() => {}} pending={false}
  /></StaticRouter>);
  expect(html).toContain("继续当前作品");
  expect(html).not.toContain("查看成片");
});
