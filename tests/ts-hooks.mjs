// node --test 용 해석 훅: "@/x" → src/x, 확장자 없는 상대 경로 → .ts (Next 번들러 해석과 맞춘다).
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

registerHooks({
  resolve(specifier, context, next) {
    // next 는 exports 맵이 없어 Node ESM 이 "next/server" 를 못 찾는다 (라우트 테스트용).
    if (specifier === "next/server") return next("next/server.js", context);
    let target = null;
    if (specifier.startsWith("@/")) target = path.join(src, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts")) {
      target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (target && !path.extname(target)) {
      for (const cand of [`${target}.ts`, path.join(target, "index.ts")]) {
        if (existsSync(cand)) return next(pathToFileURL(cand).href, context);
      }
    }
    return next(specifier, context);
  },
});
