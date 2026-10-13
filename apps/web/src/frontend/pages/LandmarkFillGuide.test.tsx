import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import LandmarkFillGuide from "./LandmarkFillGuide";

test("fill guide explains both fields honestly without promising control over the picture", () => {
  const html = renderToStaticMarkup(<LandmarkFillGuide />);
  expect(html).toContain("<details");
  expect(html).toContain("最佳机位／时段");
  expect(html).toContain("必须保真的特征");
  expect(html).toContain("右手施无畏印");
  expect(html).toContain("不会改变生成的画面");
});
