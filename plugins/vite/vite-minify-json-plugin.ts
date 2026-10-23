/*
 * SPDX-FileCopyrightText: 2025 Despair Games
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: flx-sta <https://github.com/flx-sta>
 * SPDX-FileContributor: NightKev <https://github.com/DayKev>
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { clearLine, moveCursor } from "node:readline";
import chalk from "chalk";
import type { Logger, Plugin as VitePlugin } from "vite";
import { applyCatchcryptBrand } from "../../catchcrypt/brand.mjs";

const NAME = "minify-public-json-files";
const VERSION = "3.1.1";

/** Patterns that should be excluded, meant to be excluded at any level */
const EXCLUDE_PATTERNS = [
  "REUSE.toml",
  ".git",
  "LICENSE",
  "README.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "biome.jsonc",
];

/**
 * @returns Whether the given file should be skipped based on `EXCLUDE_PATTERNS`.
 */
function skipExcludes(file: string): boolean {
  return EXCLUDE_PATTERNS.some(pattern => file.includes(pattern));
}

/**
 * Copy a public directory into the Vite build output, minifying JSON on the way.
 * Returns how many JSON files were minified.
 *
 * CatchCrypt town art lives in `catchcrypt/public`, not the assets submodule.
 * Vercel git deploys run `vite build` and do not run `catchcrypt/postbuild.mjs`,
 * so this has to happen here or `/town/*` 404s and the town scene stays black.
 */
export function stagePublicFiles(
  srcDir: string,
  outputDir: string,
  onDir: (fullPath: string) => void = () => undefined,
  onFail: (fullPath: string, err: unknown) => void = () => undefined,
): number {
  if (!existsSync(srcDir)) {
    return 0;
  }
  let jsonCount = 0;
  mkdirSync(outputDir, { recursive: true });
  for (const file of readdirSync(srcDir)) {
    if (skipExcludes(file)) {
      continue;
    }
    const fullPath = join(srcDir, file);
    const outputFilePath = join(outputDir, file);
    if (statSync(fullPath).isDirectory()) {
      onDir(fullPath);
      jsonCount += stagePublicFiles(fullPath, outputFilePath, onDir, onFail);
      continue;
    }
    if (file.endsWith(".json")) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        writeFileSync(outputFilePath, JSON.stringify(JSON.parse(content)), "utf-8");
        jsonCount++;
      } catch (err) {
        copyFileSync(fullPath, outputFilePath);
        onFail(fullPath, err);
      }
      continue;
    }
    copyFileSync(fullPath, outputFilePath);
  }
  return jsonCount;
}

/** Vite plugin to minify JSON files. Non-JSON files are copied as-is. */
export function minifyPublicJsonFiles(): VitePlugin {
  let logger: Logger;
  let count = 0;
  const errors: Error[] = [];
  const { cyan, gray, red, yellow, green } = chalk;
  const clearTerminalLine = (): void => {
    if (!process.env.CI) {
      moveCursor(process.stdout, 0, -1);
      clearLine(process.stdout, 0);
    }
  };

  const minifyJsonFiles = (dir: string, outDir: string): void => {
    count += stagePublicFiles(
      dir,
      outDir,
      fullPath => {
        clearTerminalLine();
        logger.info(green(`Processing directory "${fullPath}".`));
      },
      (fullPath, err) => {
        const error = new Error(`Failed to minify JSON file: ${fullPath}\n\t→ ${(err as Error).message}`);
        error.stack = (err as Error).stack;
        errors.push(error);
      },
    );
  };

  return {
    name: NAME,
    version: VERSION,
    apply: "build",
    enforce: "post",
    configResolved(resolvedConfig): void {
      logger = resolvedConfig.logger;
    },
    buildStart(): void {
      logger.info(cyan(`\t→ Plugin: ${NAME} v${VERSION}`));
    },
    async generateBundle(options): Promise<void> {
      logger.info(cyan("\nBeginning JSON minification."));
      if (!process.env.CI) {
        logger.info("");
      }

      const assetsDir = resolve("./assets");
      const localesDir = resolve("./locales");
      const outputDir = resolve(options.dir || "dist");

      minifyJsonFiles(assetsDir, outputDir);
      minifyJsonFiles(localesDir, join(outputDir, "locales"));
      // Town map, tileset and player atlas. postbuild.mjs also copies this, but git deploys never run it.
      const overlayDir = resolve("./catchcrypt/public");
      if (existsSync(overlayDir)) {
        logger.info(green(`Processing CatchCrypt overlay "${overlayDir}".`));
        minifyJsonFiles(overlayDir, outputDir);
      }
      // Git deploys run `vite build` and never reach catchcrypt/postbuild.mjs.
      // Without this, dist keeps the upstream logo and "PokéRogue" locale strings.
      const brand = applyCatchcryptBrand(outputDir);
      logger.info(
        green(`CatchCrypt brand: ${brand.hits} strings in ${brand.files} files, ${brand.edits} Discord edits`),
      );

      logger.info(cyan("JSON minification complete."));
    },
    closeBundle(): void {
      const logSuffix = gray(` [${NAME}]`);

      if (count > 0) {
        const failedMsg = errors.length > 0 ? yellow(` (${errors.length} failed)`) : "";

        logger.info(`${green(`✓ Minified ${count} JSON files successfully`)}${failedMsg}${logSuffix}`);
      }

      errors.forEach(error => {
        logger.error(`${red(error.message)}${logSuffix}`, { error });
      });
    },
  };
}
