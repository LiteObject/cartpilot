import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
const isWatchMode = process.argv.includes("--watch");

const buildOptions = {
    entryPoints: [
        path.join(srcDir, "background/background.ts"),
        path.join(srcDir, "content/content.ts"),
        path.join(srcDir, "sidepanel/sidepanel.ts")
    ],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome120"],
    outdir: distDir,
    outbase: srcDir,
    sourcemap: true,
    logLevel: "info"
};

async function copyStaticFiles() {
    await mkdir(path.join(distDir, "sidepanel"), { recursive: true });
    await cp(path.join(rootDir, "manifest.json"), path.join(distDir, "manifest.json"), { force: true });
    await cp(path.join(srcDir, "sidepanel/sidepanel.html"), path.join(distDir, "sidepanel/sidepanel.html"), { force: true });
}

async function cleanDist() {
    await rm(distDir, { recursive: true, force: true });
}

async function runBuild() {
    await cleanDist();

    if (isWatchMode) {
        const context = await esbuild.context({
            ...buildOptions,
            plugins: [
                {
                    name: "copy-static-files",
                    setup(build) {
                        build.onEnd(async (result) => {
                            if (result.errors.length === 0) {
                                await copyStaticFiles();
                            }
                        });
                    }
                }
            ]
        });

        await context.watch();
        await copyStaticFiles();
        console.log("Watching CartPilot extension files...");
        return;
    }

    const result = await esbuild.build(buildOptions);

    if (result.errors.length === 0) {
        await copyStaticFiles();
    }
}

runBuild().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});