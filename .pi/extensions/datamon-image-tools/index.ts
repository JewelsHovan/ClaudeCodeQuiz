import { Type, StringEnum } from "@earendil-works/pi-ai";
import {
  withFileMutationQueue,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const OPENAI_LATEST = "gpt-image-2-2026-04-21";
const GEMINI_LATEST_FAST = "gemini-3.1-flash-image-preview";
const GEMINI_LATEST_PRO = "gemini-3-pro-image-preview";
const WALK_VIEWS = ["down", "up", "side"] as const;

type WalkView = (typeof WALK_VIEWS)[number];

function stripAt(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function projectPath(cwd: string, input: string): string {
  const clean = stripAt(input);
  const absolute = isAbsolute(clean) ? resolve(clean) : resolve(cwd, clean);
  const rel = relative(cwd, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path must stay inside the project: ${input}`);
  }
  return absolute;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findImageCompass(cwd: string): Promise<string> {
  const candidates = [
    process.env.IMAGE_COMPASS_DIR,
    join(homedir(), "Desktop/Internals/claude-compass-superpowers/image-compass"),
    resolve(cwd, "../claude-compass-superpowers/image-compass"),
    resolve(cwd, "../image-compass"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const root = resolve(candidate);
    if (
      await exists(join(root, "scripts/generate_openai.py")) &&
      await exists(join(root, "scripts/generate_gemini.py"))
    ) {
      return root;
    }
  }

  throw new Error(
    "image-compass was not found. Set IMAGE_COMPASS_DIR to its checkout before using image_generate.",
  );
}

function parseGeneratedPaths(stdout: string): string[] {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const value = JSON.parse(line) as { paths?: unknown };
      if (Array.isArray(value.paths)) {
        return value.paths.filter((path): path is string => typeof path === "string");
      }
    } catch {
      // Human-readable progress can contain braces; keep searching for the final JSON line.
    }
  }
  return [];
}

function tail(text: string, max = 4000): string {
  return text.length <= max ? text : `…${text.slice(-max)}`;
}

function mimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

async function imageContent(path: string) {
  const data = await readFile(path);
  return {
    type: "image" as const,
    data: data.toString("base64"),
    mimeType: mimeType(path),
  };
}

function validateSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Invalid DATAMON slug: ${slug}`);
  }
}

async function withLocks<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
  const unique = [...new Set(paths.map((path) => resolve(path)))].sort();
  const acquire = (index: number): Promise<T> => {
    if (index >= unique.length) return fn();
    return withFileMutationQueue(unique[index], () => acquire(index + 1));
  };
  return acquire(0);
}

function datamonPaths(cwd: string, slug: string) {
  const datamon = join(cwd, "datamon");
  const cache = join(datamon, ".walk-gen-cache");
  const output = join(datamon, "sprites-walk", slug);
  return {
    datamon,
    cache,
    output,
    review: join(cache, `${slug}-review.png`),
    script: join(datamon, "tools/gen_walk_assets.py"),
  };
}

function walkMutationPaths(cwd: string, slug: string): string[] {
  const paths = datamonPaths(cwd, slug);
  return [
    ...WALK_VIEWS.map((view) => join(paths.cache, `${slug}-${view}.png`)),
    ...["down", "up", "left", "right"].flatMap((direction) =>
      [0, 1, 2, 3].map((frame) => join(paths.output, `${direction}_${frame}.png`)),
    ),
    paths.review,
  ];
}

export default function datamonImageTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "image_generate",
    label: "Generate Image",
    description:
      "Generate one project image through image-compass and return both its saved path and the image. Defaults to the newest quality route: OpenAI gpt-image-2 with automatic fallback. Supports Gemini Nano Banana 2/Pro and reference images. Output is capped at one generated image.",
    promptSnippet:
      "Generate or edit a project image with the newest available OpenAI or Gemini image model",
    promptGuidelines: [
      "Use image_generate when the user asks to generate or edit raster art; use its returned image to visually inspect the result before promoting it into production assets.",
      "For DATAMON walk sheets, use image_generate with a solid magenta background and reference the character sprite plus headshot; do not request transparency because the newest OpenAI model does not support native transparent output.",
      "In every DATAMON 4-frame walk-sheet prompt, explicitly require alternating phases in this order: left-foot contact, left-foot passing with right leg advancing, right-foot contact, right-foot passing with left leg advancing; reject duplicated lead-leg poses.",
      "Use datamon_walk_review before changing a DATAMON walk cycle, and use datamon_walk_bake only after visually checking all three replacement sheets.",
    ],
    parameters: Type.Object({
      prompt: Type.String({ description: "Complete image-generation prompt" }),
      provider: Type.Optional(
        StringEnum(["auto", "openai", "gemini"] as const, {
          description: "Provider route; auto defaults to OpenAI for quality and Gemini otherwise",
        }),
      ),
      intent: Type.Optional(
        StringEnum(["fast", "balanced", "quality"] as const, {
          description: "Defaults to quality",
        }),
      ),
      model: Type.Optional(
        StringEnum(
          [
            "gpt-image-2-2026-04-21",
            "gpt-image-2",
            "gpt-image-1.5",
            "gpt-image-1-mini",
            "gemini-3.1-flash-image-preview",
            "gemini-3-pro-image-preview",
          ] as const,
          { description: "Optional exact model override; also selects its provider" },
        ),
      ),
      references: Type.Optional(
        Type.Array(Type.String({ description: "Project-local reference image path" }), {
          maxItems: 14,
        }),
      ),
      variant: Type.Optional(Type.String({ description: "Short filename label" })),
      background: Type.Optional(
        StringEnum(["auto", "opaque", "transparent"] as const),
      ),
      size: Type.Optional(
        StringEnum(["1024x1024", "1536x1024", "1024x1536"] as const, {
          description: "OpenAI output size",
        }),
      ),
      aspectRatio: Type.Optional(
        StringEnum(
          ["1:1", "3:2", "2:3", "3:4", "4:3", "16:9", "9:16", "21:9", "9:21", "4:5", "5:4", "2:1", "1:2", "1:8", "8:1"] as const,
          { description: "Gemini aspect ratio" },
        ),
      ),
      resolution: Type.Optional(
        StringEnum(["512", "1K", "2K", "4K"] as const, {
          description: "Gemini resolution; values are case-sensitive",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const root = await findImageCompass(ctx.cwd);
      const intent = params.intent ?? "quality";
      const background = params.background ?? "auto";
      const requestedProvider = params.provider ?? "auto";
      const modelProvider = params.model?.startsWith("gemini-")
        ? "gemini"
        : params.model?.startsWith("gpt-image-")
          ? "openai"
          : undefined;
      if (modelProvider && requestedProvider !== "auto" && requestedProvider !== modelProvider) {
        throw new Error(`Model ${params.model} belongs to ${modelProvider}, not ${requestedProvider}.`);
      }
      const provider = modelProvider ?? (requestedProvider === "auto"
        ? background === "transparent" || intent === "quality"
          ? "openai"
          : "gemini"
        : requestedProvider);

      if (provider === "gemini" && background === "transparent") {
        throw new Error("Gemini has no native transparent-background mode; use provider=openai.");
      }

      const references = [] as string[];
      for (const input of params.references ?? []) {
        const path = projectPath(ctx.cwd, input);
        if (!(await exists(path))) throw new Error(`Reference image not found: ${input}`);
        references.push(path);
      }

      const script = join(root, "scripts", provider === "openai" ? "generate_openai.py" : "generate_gemini.py");
      const args = ["run", "--script", script, "--prompt", params.prompt, "--json"];

      if (provider === "openai") {
        if (params.model) args.push("--model", params.model);
        args.push("--size", params.size ?? "1536x1024");
        args.push("--quality", intent === "fast" ? "low" : intent === "balanced" ? "medium" : "high");
        args.push("--background", background);
      } else {
        if (params.model) args.push("--model", params.model);
        args.push("--intent", intent);
        args.push("--aspect-ratio", params.aspectRatio ?? "16:9");
        args.push("--resolution", params.resolution ?? (intent === "fast" ? "1K" : "2K"));
      }

      if (params.variant) args.push("--variant", params.variant);
      for (const reference of references) args.push("--ref", reference);

      const expectedModel = params.model ?? (
        provider === "openai"
          ? background === "transparent" ? "gpt-image-1.5" : OPENAI_LATEST
          : intent === "quality" ? GEMINI_LATEST_PRO : GEMINI_LATEST_FAST
      );
      onUpdate?.({
        content: [{ type: "text", text: `Generating with ${expectedModel}…` }],
        details: { provider, expectedModel },
      });

      const result = await pi.exec("uv", args, {
        cwd: ctx.cwd,
        signal,
        timeout: 10 * 60 * 1000,
      });
      if (result.code !== 0) {
        throw new Error(`Image generation failed (exit ${result.code}).\n${tail(result.stderr || result.stdout)}`);
      }

      const generated = parseGeneratedPaths(result.stdout).map((path) => resolve(path));
      if (generated.length === 0 || !(await exists(generated[0]))) {
        throw new Error(`Image generator returned no readable path.\n${tail(result.stdout)}\n${tail(result.stderr)}`);
      }

      const path = generated[0];
      return {
        content: [
          {
            type: "text",
            text: [
              `Generated image: ${relative(ctx.cwd, path) || path}`,
              `Provider: ${provider}`,
              `Requested model route: ${expectedModel}`,
              provider === "gemini" ? "Provenance: contains an invisible Google SynthID watermark." : "Provenance: OpenAI output may contain C2PA metadata.",
            ].join("\n"),
          },
          await imageContent(path),
        ],
        details: {
          path,
          provider,
          expectedModel,
          generatorOutput: tail(result.stdout, 2000),
        },
      };
    },
  });

  pi.registerTool({
    name: "datamon_walk_review",
    label: "Review DATAMON Walk Cycle",
    description:
      "Load a DATAMON character's current 4-direction, 4-frame walk-cycle review sheet for visual diagnosis. Read-only.",
    promptSnippet: "Inspect a DATAMON character's current walk-cycle contact sheet",
    parameters: Type.Object({
      slug: Type.String({ description: "Character slug, for example julien-hovan" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      validateSlug(params.slug);
      const paths = datamonPaths(ctx.cwd, params.slug);
      if (!(await exists(paths.review))) {
        throw new Error(`No review sheet found for ${params.slug}: ${relative(ctx.cwd, paths.review)}`);
      }
      return {
        content: [
          {
            type: "text",
            text: `DATAMON walk-cycle review for ${params.slug}\nRows: down, left, right, up. Columns: frames 0–3.\nPath: ${relative(ctx.cwd, paths.review)}`,
          },
          await imageContent(paths.review),
        ],
        details: { slug: params.slug, reviewPath: paths.review },
      };
    },
  });

  pi.registerTool({
    name: "datamon_walk_bake",
    label: "Bake DATAMON Walk Sheets",
    description:
      "Install three visually approved raw walk sheets (down/up/side), back up the prior raw sheets, and run DATAMON's deterministic key/slice/bake pipeline. Returns the resulting 4x4 review image. This mutates datamon/.walk-gen-cache and datamon/sprites-walk for one character.",
    parameters: Type.Object({
      slug: Type.String({ description: "Character slug" }),
      downSheet: Type.String({ description: "Project-local approved front/down 4-frame sheet" }),
      upSheet: Type.String({ description: "Project-local approved back/up 4-frame sheet" }),
      sideSheet: Type.String({ description: "Project-local approved right-facing profile 4-frame sheet" }),
      mirrorSide: Type.Optional(
        Type.Boolean({ description: "Set true only if the supplied side sheet walks left" }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      validateSlug(params.slug);
      const paths = datamonPaths(ctx.cwd, params.slug);
      if (!(await exists(paths.script))) {
        throw new Error(`DATAMON walk pipeline not found: ${relative(ctx.cwd, paths.script)}`);
      }

      const sources: Record<WalkView, string> = {
        down: projectPath(ctx.cwd, params.downSheet),
        up: projectPath(ctx.cwd, params.upSheet),
        side: projectPath(ctx.cwd, params.sideSheet),
      };
      for (const view of WALK_VIEWS) {
        if (!(await exists(sources[view]))) {
          throw new Error(`${view} sheet not found: ${sources[view]}`);
        }
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupDir = join(paths.cache, "history", params.slug, stamp);
      const targets = Object.fromEntries(
        WALK_VIEWS.map((view) => [view, join(paths.cache, `${params.slug}-${view}.png`)]),
      ) as Record<WalkView, string>;

      return withLocks(walkMutationPaths(ctx.cwd, params.slug), async () => {
        await mkdir(backupDir, { recursive: true });
        const hadOriginal = {} as Record<WalkView, boolean>;
        for (const view of WALK_VIEWS) {
          hadOriginal[view] = await exists(targets[view]);
          if (hadOriginal[view]) {
            await copyFile(targets[view], join(backupDir, `${view}.png`));
          }
        }

        const runBake = async () => {
          const args = [
            "run",
            "--script",
            paths.script,
            "--pipeline-only",
            "--only",
            params.slug,
            "--force",
          ];
          if (params.mirrorSide) args.push("--mirror-side", params.slug);
          return pi.exec("uv", args, {
            cwd: ctx.cwd,
            signal,
            timeout: 3 * 60 * 1000,
          });
        };

        try {
          for (const view of WALK_VIEWS) await copyFile(sources[view], targets[view]);
          onUpdate?.({
            content: [{ type: "text", text: `Slicing and baking ${params.slug}…` }],
            details: { slug: params.slug, backupDir },
          });
          const result = await runBake();
          if (result.code !== 0 || !(await exists(paths.review))) {
            throw new Error(`Walk bake failed (exit ${result.code}).\n${tail(result.stderr || result.stdout)}`);
          }

          return {
            content: [
              {
                type: "text",
                text: [
                  `Baked 16 walk frames for ${params.slug}.`,
                  `Review: ${relative(ctx.cwd, paths.review)}`,
                  `Previous raw sheets backed up at: ${relative(ctx.cwd, backupDir)}`,
                ].join("\n"),
              },
              await imageContent(paths.review),
            ],
            details: {
              slug: params.slug,
              reviewPath: paths.review,
              outputDir: paths.output,
              backupDir,
              pipelineOutput: tail(result.stdout, 2000),
            },
          };
        } catch (error) {
          // Restore the raw inputs. The Python pipeline validates all sheets before it writes
          // frames, so validation failures leave the previously baked frame set untouched.
          for (const view of WALK_VIEWS) {
            if (hadOriginal[view]) {
              await copyFile(join(backupDir, `${view}.png`), targets[view]);
            } else {
              await rm(targets[view], { force: true });
            }
          }
          throw error;
        }
      });
    },
  });

  pi.registerCommand("datamon-image-status", {
    description: "Show DATAMON image-tool models, keys, and image-compass discovery status",
    handler: async (_args, ctx) => {
      let compass: string;
      try {
        compass = relative(ctx.cwd, await findImageCompass(ctx.cwd)) || ".";
      } catch {
        compass = "not found (set IMAGE_COMPASS_DIR)";
      }
      ctx.ui.notify(
        [
          `image-compass: ${compass}`,
          `OpenAI latest: ${OPENAI_LATEST} (${process.env.OPENAI_API_KEY ? "key ready" : "OPENAI_API_KEY missing"})`,
          `Gemini fast/pro: ${GEMINI_LATEST_FAST} / ${GEMINI_LATEST_PRO} (${process.env.GEMINI_API_KEY ? "key ready" : "GEMINI_API_KEY missing"})`,
        ].join("\n"),
        "info",
      );
    },
  });
}
