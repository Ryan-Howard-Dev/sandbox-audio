const fs=require("fs");
const p="C:/Users/RH/Downloads/sovereign-music-console/src/e2eDevAction.ts";
let e=fs.readFileSync(p,"utf8");
e=e.replace(
  "const backNowPlaying = handlers.shellBack?.() ?? false;\n      await sleep(500);",
  "const backNowPlaying = handlers.shellBack?.() ?? false;\n      await sleep(1200);",
);
fs.writeFileSync(p,e);
console.log("sleep patched");
