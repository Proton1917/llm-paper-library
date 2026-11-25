import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const document = JSON.parse(execFileSync("pandoc", ["--from=gfm", "--to=json", "README.md"], {
  cwd: root,
  encoding: "utf8",
}));

function paragraphText(inlines) {
  return inlines.map(inline => {
    switch (inline.t) {
      case "Str":
        return inline.c;
      case "Space":
      case "SoftBreak":
      case "LineBreak":
        return " ";
      case "Code":
        return inline.c[1];
      case "Link":
        return paragraphText(inline.c[1]);
      default:
        return Array.isArray(inline.c) ? paragraphText(inline.c) : "";
    }
  }).join("");
}

function section(name) {
  const start = document.blocks.findIndex(block =>
    block.t === "Header" && block.c[0] === 2 && paragraphText(block.c[2]) === name);
  if (start === -1) {
    throw new Error(`README.md 缺少「${name}」一节。`);
  }
  const end = document.blocks.findIndex((block, index) =>
    index > start && block.t === "Header" && block.c[0] <= 2);
  return document.blocks.slice(start + 1, end === -1 ? undefined : end);
}

function links(inlines, directory, suffix) {
  return inlines.filter(inline => inline.t === "Link").map(({ c: [, label, [href]] }) => {
    const path = decodeURIComponent(href);
    if (!path.startsWith(`${directory}/`) || !path.toLowerCase().endsWith(suffix) ||
        path.split("/").includes("..") || /[\\?#]/.test(path)) {
      throw new Error(`请使用 ${directory}/ 内的 ${suffix} 相对链接：${href}`);
    }
    return { label: paragraphText(label), href };
  });
}

const table = section("论文").find(block => block.t === "Table");
if (!table) {
  throw new Error("README.md 的「论文」一节需要包含论文索引表。");
}

// Pandoc 的 TableBody 第四项为行，Cell 最后一项为块内容。
const papers = table.c[4].flatMap(([, , , rows]) => rows.map(([, cells]) => {
  const [topic, title, editions] = cells.map(cell => cell[4].flatMap(block => block.c));
  const versions = links(editions, "论文", ".pdf");
  if (!versions.length) {
    throw new Error(`请为「${paragraphText(title)}」添加 PDF 链接。`);
  }
  return { topic: paragraphText(topic), title: paragraphText(title), versions };
}));

const seminars = section("组会资料").filter(block => block.t === "BulletList")
  .flatMap(list => list.c.flatMap(item => {
    const inlines = item.flatMap(block => block.c);
    const description = paragraphText(inlines.filter(inline => inline.t !== "Link")).trim();
    return links(inlines, "组会资料", ".html").map(link => ({ ...link, description }));
  }));

writeFileSync(new URL("../catalog.js", import.meta.url),
  `// 论文和组会条目来自 README.md，由 tools/update-catalog.mjs 生成。\n` +
  `const libraryCatalog = ${JSON.stringify({ papers, seminars }, null, 2)};\n`);
