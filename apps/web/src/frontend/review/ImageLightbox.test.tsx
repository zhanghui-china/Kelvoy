import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageLightbox, stepIndex } from "./ImageLightbox";

const items = [
  { src: "/f/1.png", alt: "第 1 镜候选 1", label: "候选 1" },
  { src: "/f/2.png", alt: "第 1 镜候选 2", label: "候选 2", selected: true },
  { src: "/f/3.png", alt: "第 1 镜候选 3", label: "候选 3" },
];

test("stepIndex clamps at both ends", () => {
  expect(stepIndex(0, -1, 3)).toBe(0);
  expect(stepIndex(2, 1, 3)).toBe(2);
  expect(stepIndex(1, 1, 3)).toBe(2);
});

test("lightbox shows position, selected state and pick button", () => {
  const html = renderToStaticMarkup(<ImageLightbox title="第 1 镜" items={items} index={1}
    onIndexChange={() => {}} onClose={() => {}} onSelect={() => {}} />);
  expect(html).toContain("第 1 镜 · 候选 2 / 3 · 已选定");
  expect(html).toContain('src="/f/2.png"');
  expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*disabled=""[^>]*>已选定<\/button>/);
  expect(html).toContain(">上一张</button>");
  expect(html).toContain(">下一张</button>");
});

test("ends disable their step button; a non-selected item offers 选这张", () => {
  const first = renderToStaticMarkup(<ImageLightbox title="t" items={items} index={0}
    onIndexChange={() => {}} onClose={() => {}} onSelect={() => {}} />);
  expect(first).toMatch(/<button[^>]*disabled=""[^>]*>上一张<\/button>/);
  expect(first).toMatch(/<button[^>]*aria-pressed="false"[^>]*>选这张<\/button>/);
  expect(first).not.toMatch(/<button[^>]*disabled=""[^>]*>下一张<\/button>/);
});

test("reference images get no pick or step buttons, and a locked pick is disabled", () => {
  const ref = renderToStaticMarkup(<ImageLightbox title="地标" items={[items[0]!]} index={0}
    onIndexChange={() => {}} onClose={() => {}} />);
  expect(ref).not.toContain("选这张");
  expect(ref).not.toContain("上一张");
  expect(ref).toContain("地标 · 候选 1");
  const locked = renderToStaticMarkup(<ImageLightbox title="t" items={items} index={0}
    onIndexChange={() => {}} onClose={() => {}} onSelect={() => {}} selectDisabled />);
  expect(locked).toMatch(/<button[^>]*disabled=""[^>]*>选这张<\/button>/);
});
