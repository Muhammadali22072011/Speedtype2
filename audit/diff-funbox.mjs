import fs from "node:fs";

const MT = "C:/Users/Muhammadali/AppData/Local/Temp/mtref/mt/packages/funbox/src/list.ts";
const OUR = "C:/Users/Muhammadali/Desktop/Speedtype2/frontend/src/core/funbox.ts";
const CSSDIR = "C:/Users/Muhammadali/Desktop/Speedtype2/backend/app/static/funbox";
const TESTPAGE = "C:/Users/Muhammadali/Desktop/Speedtype2/frontend/src/pages/test.ts";

const mtNames = [...fs.readFileSync(MT, "utf8").matchAll(/name:\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);

const src = fs.readFileSync(OUR, "utf8");
const listStart = src.indexOf("export const FUNBOXES");
const listEnd = src.indexOf("] as const;", listStart);
const list = src.slice(listStart, listEnd);

// разбиваем на записи по "name:"
const entries = [];
const re = /name:\s*"([A-Za-z0-9_]+)"/g;
let m;
const idx = [];
while ((m = re.exec(list)) !== null) idx.push([m.index, m[1]]);
for (let i = 0; i < idx.length; i++) {
  const chunk = list.slice(idx[i][0], i + 1 < idx.length ? idx[i + 1][0] : list.length);
  entries.push({
    name: idx[i][1],
    kind: (chunk.match(/kind:\s*"(\w+)"/) || [])[1],
    hasTransform: /transform:/.test(chunk),
    generator: /generator:\s*true/.test(chunk),
    hasCss: /hasCss:\s*true/.test(chunk),
  });
}

const cssFiles = new Set(fs.readdirSync(CSSDIR).map((f) => f.replace(/\.css$/, "")));
const testSrc = fs.readFileSync(TESTPAGE, "utf8");
const funboxSrc = src;

const out = [];
out.push(`# машинная сверка funbox`);
out.push(``);
out.push(`monkeytype: ${mtNames.length}, у нас: ${entries.length}`);
out.push(`только у них: ${mtNames.filter((n) => !entries.some((e) => e.name === n)).join(", ")}`);
out.push(`только у нас: ${entries.filter((e) => !mtNames.includes(e.name)).map((e) => e.name).join(", ")}`);
out.push(``);
out.push(`| funbox | вид | transform | css-файл | обрабатывается в коде | вердикт |`);
out.push(`|---|---|---|---|---|---|`);
for (const e of entries) {
  const cssOk = e.hasCss ? (cssFiles.has(e.name) ? "есть" : "**нет файла**") : "—";
  const inTest = new RegExp(`"${e.name}"`).test(testSrc) || new RegExp(`"${e.name}"`).test(funboxSrc.slice(listEnd));
  let verdict;
  if (e.kind === "text") verdict = e.hasTransform ? "работает" : "**пустышка**";
  else if (e.kind === "css") verdict = e.hasCss ? (cssFiles.has(e.name) ? "работает (css)" : "**пустышка**") : "**пустышка**";
  else verdict = inTest ? "работает" : "**пустышка**";
  out.push(`| ${e.name} | ${e.kind} | ${e.hasTransform ? "да" : "нет"} | ${cssOk} | ${inTest ? "да" : "нет"} | ${verdict} |`);
}
const dead = entries.filter((e) => {
  if (e.kind === "text") return !e.hasTransform;
  if (e.kind === "css") return !(e.hasCss && cssFiles.has(e.name));
  return !(new RegExp(`"${e.name}"`).test(testSrc) || new RegExp(`"${e.name}"`).test(funboxSrc.slice(listEnd)));
});
out.push(``);
out.push(`пустышек: ${dead.length} — ${dead.map((d) => d.name).join(", ")}`);
fs.writeFileSync("C:/Users/Muhammadali/AppData/Local/Temp/mtref/funbox-diff.md", out.join("\n"), "utf8");
console.log(out.join("\n"));
