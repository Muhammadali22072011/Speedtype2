// Машинная сверка списка настроек: monkeytype ConfigSchema против нашего config-spec.ts
import fs from "node:fs";

const MT = "C:/Users/Muhammadali/AppData/Local/Temp/mtref/mt/packages/schemas/src/configs.ts";
const MTD = "C:/Users/Muhammadali/AppData/Local/Temp/mtref/mt/frontend/src/ts/constants/default-config.ts";
const OUR = "C:/Users/Muhammadali/Desktop/Speedtype2/frontend/src/state/config-spec.ts";
const OURD = "C:/Users/Muhammadali/Desktop/Speedtype2/frontend/src/state/settings.ts";

const mtSrc = fs.readFileSync(MT, "utf8");
const body = mtSrc.slice(mtSrc.indexOf("export const ConfigSchema"), mtSrc.indexOf("satisfies Record<string, ZodSchema>"));
const mtKeys = [...body.matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);

// enum-значения из схемы: имя схемы -> массив значений
const enums = {};
for (const m of mtSrc.matchAll(/export const (\w+Schema) = z\.enum\(\[([^\]]*)\]\)/g)) {
  enums[m[1]] = m[2].split(",").map((s) => s.trim().replace(/^["']|["'],?$/g, "").replace(/\/\/.*/, "").trim()).filter(Boolean);
}
// key -> schema name
const keySchema = {};
for (const m of body.matchAll(/^\s{4}([A-Za-z0-9_]+):\s*([A-Za-z0-9_.]+)/gm)) keySchema[m[1]] = m[2];

// дефолты monkeytype
const mtdSrc = fs.readFileSync(MTD, "utf8");
const mtDefaults = {};
for (const m of mtdSrc.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*(.+?),?$/gm)) mtDefaults[m[1]] = m[2].replace(/,$/, "");

// наши
const ourSrc = fs.readFileSync(OUR, "utf8");
const ours = [];
for (const line of ourSrc.split("\n")) {
  const m = line.match(/key:\s*"([A-Za-z0-9_]+)"/);
  if (!m) continue;
  const values = line.match(/values:\s*\[([^\]]*)\]/);
  ours.push({
    key: m[1],
    group: (line.match(/group:\s*"(\w+)"/) || [])[1],
    kind: (line.match(/kind:\s*"(\w+)"/) || [])[1],
    done: /done:\s*true/.test(line),
    values: values ? values[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean) : null,
  });
}
const ourKeys = ours.map((o) => o.key);

// дефолты наши
const ourdSrc = fs.readFileSync(OURD, "utf8");
const dblock = ourdSrc.slice(ourdSrc.indexOf("const DEFAULTS"), ourdSrc.indexOf("export const TIME_OPTIONS"));
const ourDefaults = {};
for (const m of dblock.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*(.+?),$/gm)) ourDefaults[m[1]] = m[2];

// переименования, которые мы допустили осознанно
const RENAME = { soundOnClick: "playSoundOnClick", soundOnError: "playSoundOnError" };
const ourNorm = new Map(ourKeys.map((k) => [RENAME[k] ?? k, k]));

const onlyMt = mtKeys.filter((k) => !ourNorm.has(k));
const onlyOur = ourKeys.filter((k) => !mtKeys.includes(RENAME[k] ?? k));
const both = mtKeys.filter((k) => ourNorm.has(k));

const out = [];
out.push(`# машинная сверка настроек`);
out.push(``);
out.push(`всего у monkeytype: ${mtKeys.length}`);
out.push(`всего у нас: ${ourKeys.length} (из них done:true — ${ours.filter((o) => o.done).length}, done:false — ${ours.filter((o) => !o.done).length})`);
out.push(`только у них: ${onlyMt.length} — ${onlyMt.join(", ")}`);
out.push(`только у нас: ${onlyOur.length} — ${onlyOur.join(", ")}`);
out.push(`у обоих: ${both.length}`);
out.push(``);
out.push(`## общие ключи: значения и дефолты`);
out.push(``);
out.push(`| ключ | значения monkeytype | значения наши | дефолт mt | дефолт наш | done |`);
out.push(`|---|---|---|---|---|---|`);
for (const k of both) {
  const our = ours.find((o) => o.key === ourNorm.get(k));
  const schema = keySchema[k];
  const mtVals = enums[schema] ?? (schema ? `(${schema})` : "");
  const mtv = Array.isArray(mtVals) ? mtVals.join(" ") : String(mtVals);
  const ov = our.values ? our.values.join(" ") : `(${our.kind})`;
  const same = Array.isArray(mtVals) && our.values && mtVals.join("|") === our.values.join("|");
  const dmt = mtDefaults[k] ?? "";
  const dour = ourDefaults[ourNorm.get(k)] ?? "";
  const sameD = String(dmt).replace(/["']/g, "") === String(dour).replace(/["']/g, "");
  out.push(`| ${k}${ourNorm.get(k) !== k ? ` (у нас \`${ourNorm.get(k)}\`)` : ""} | ${mtv} | ${ov}${same ? " ✅" : " ⚠️"} | ${dmt} | ${dour}${sameD ? " ✅" : " ⚠️"} | ${our.done ? "да" : "**нет**"} |`);
}
fs.writeFileSync("C:/Users/Muhammadali/AppData/Local/Temp/mtref/settings-diff.md", out.join("\n"), "utf8");
console.log(out.slice(0, 8).join("\n"));
