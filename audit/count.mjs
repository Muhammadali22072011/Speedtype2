import fs from "node:fs";
const t = fs.readFileSync("C:/Users/Muhammadali/Desktop/Speedtype2/audit/report.md", "utf8");
const rows = t.split("\n").filter((l) => /^\|\s*\d+\s*\|/.test(l));
const c = {};
for (const r of rows) {
  const cells = r.split("|").map((s) => s.trim());
  const v = cells.find((x) => ["ЕСТЬ", "ЧАСТИЧНО", "ЗАГЛУШКА", "НЕТ", "ЛИШНЕЕ"].includes(x));
  c[v || "БЕЗ ВЕРДИКТА"] = (c[v || "БЕЗ ВЕРДИКТА"] || 0) + 1;
}
console.log("строк с номером:", rows.length);
console.log(c);
const nums = rows.map((r) => +r.split("|")[1].trim());
const max = Math.max(...nums);
const missing = [];
for (let i = 1; i <= max; i++) if (!nums.includes(i)) missing.push(i);
const dup = nums.filter((n, i) => nums.indexOf(n) !== i);
console.log("max:", max, "пропущены:", missing.join(",") || "нет", "дубли:", dup.join(",") || "нет");
