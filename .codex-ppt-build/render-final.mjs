import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const { TMP_DIR, FINAL_PPTX } = process.env;
const presentation = await PresentationFile.importPptx(await FileBlob.load(FINAL_PPTX));
const inspect = await presentation.inspect({ kind: "slide", maxChars: 50000 });
const slideIds = [...inspect.ndjson.split("\n").filter(Boolean).map((l) => JSON.parse(l))]
  .filter((o) => o.kind === "slide")
  .sort((a, b) => a.slideIndex - b.slideIndex)
  .map((o) => o.id);
const out = path.join(TMP_DIR, "final");
await fs.mkdir(out, { recursive: true });
let i = 0;
for (const id of slideIds) {
  const slide = presentation.resolve(id);
  const png = await presentation.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(path.join(out, `final-${String(i + 1).padStart(2, "0")}.png`), new Uint8Array(await png.arrayBuffer()));
  i++;
}
console.log(`rendered ${i} final slides`);
