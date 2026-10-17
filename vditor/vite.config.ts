import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { defineConfig, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import pkg from "./package.json";

const resourceMarkdownDir = resolve(__dirname, "../resource/markdown");
const localLuteDir = resolve(__dirname, "../test/output/lute");
const resourceLuteDir = resolve(resourceMarkdownDir, "dist/js/lute");

function copyLocalLuteOverride() {
  if (!existsSync(localLuteDir)) {
    return;
  }
  mkdirSync(resourceLuteDir, { recursive: true });
  cpSync(localLuteDir, resourceLuteDir, { recursive: true });
}

// Vditor loads its strings from dist/js/i18n/<lang>.js; they are written from the `markdown`
// section of the extension's i18n/<language>.json, with English filling in missing keys.
const i18nDir = resolve(__dirname, "../i18n");
const vditorI18nDir = resolve(__dirname, "src/js/i18n");
const VDITOR_LANGUAGES: Record<string, string> = {
  en_US: "en",
  zh_CN: "zh-cn",
  ja_JP: "ja",
  ru_RU: "ru",
};

function readMarkdownStrings(language: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(i18nDir, `${language}.json`), "utf8")).markdown ?? {};
}

function writeVditorI18n() {
  mkdirSync(vditorI18nDir, { recursive: true });
  const english = readMarkdownStrings("en");
  for (const [code, language] of Object.entries(VDITOR_LANGUAGES)) {
    const strings = { ...english, ...readMarkdownStrings(language) };
    writeFileSync(
      resolve(vditorI18nDir, `${code}.js`),
      `// Generated from i18n/${language}.json by vite.config.ts: do not edit.\nwindow.VditorI18n = ${JSON.stringify(strings, null, 2)};\n`,
    );
  }
}

function generateVditorI18n(): Plugin {
  return {
    name: "generate-vditor-i18n",
    buildStart() {
      writeVditorI18n();
      for (const language of Object.values(VDITOR_LANGUAGES)) {
        this.addWatchFile(resolve(i18nDir, `${language}.json`));
      }
    },
  };
}

function copyBuildToResource(): Plugin {
  return {
    name: "copy-build-to-resource",
    closeBundle() {
      cpSync(
        resolve(__dirname, "dist"),
        resolve(resourceMarkdownDir, "dist"),
        { recursive: true },
      );
      copyLocalLuteOverride();
    },
  };
}

export default defineConfig(({ mode }) => {
  return {
    define: {
      VDITOR_VERSION: JSON.stringify(pkg.version),
    },
    server: {
      port: 3135,
      host: "127.0.0.1",
      fs: {
        allow: [resolve(__dirname, "..")],
      },
    },
    build: {
      outDir: "dist",
      cssMinify: 'esbuild',
      minify: mode === "production",
      target: "es2015",
      lib: {
        entry: resolve(__dirname, "src/index.ts"),
        formats: ["umd"],
        name: "Vditor",
        fileName: () => "index.min.js",
      },
      rolldownOptions: {
        output: {
          exports: "default",
          assetFileNames: "index.css",
        },
      },
    },
    plugins: [
      generateVditorI18n(),
      viteStaticCopy({
        targets: [
          { src: "src/css", dest: ".", rename: { stripBase: 1 } },
          { src: "src/js", dest: ".", rename: { stripBase: 1 } },
        ],
      }),
      copyBuildToResource(),
    ],
  };
});
