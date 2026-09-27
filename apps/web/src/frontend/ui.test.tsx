import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ErrorState, Field, LoadingState, Status } from "./ui";

test("shared controls keep native labels, button types and feedback semantics", () => {
  expect(renderToStaticMarkup(<Button>继续</Button>)).toContain('type="button"');
  expect(renderToStaticMarkup(<Button type="submit" disabled>保存</Button>)).toContain('disabled=""');
  expect(renderToStaticMarkup(<Field label="名称"><input name="name" /></Field>)).toContain('<label');
  expect(renderToStaticMarkup(<LoadingState />)).toContain('role="status"');
  expect(renderToStaticMarkup(<Status tone="warning">待审核</Status>)).toContain('待审核');
});

test("error feedback exposes a retry action only when it can actually run", () => {
  expect(renderToStaticMarkup(<ErrorState message="加载失败" />)).not.toContain('<button');
  const html = renderToStaticMarkup(<ErrorState message="加载失败" onRetry={() => {}} retrying />);
  expect(html).toContain('role="alert"');
  expect(html).toContain('disabled=""');
});
