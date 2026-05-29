import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { USER_PERSONAS_DIR } from "./user-config.js";

export const PersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  age: z.number().int().optional(),
  role: z.string().min(1),
  cause_engagement: z.enum(["neutral", "casual", "regular", "committed"]),
  scrutiny: z.enum(["low-medium", "medium", "high"]),
  goals: z.array(z.string()).min(1),
  motivations: z.array(z.string()).default(() => []),
  frustrations: z.array(z.string()).min(1),
  behaviours: z.array(z.string()).default(() => []),
  tech_confidence: z.enum(["low-medium", "medium", "medium-high"]),
  device: z.enum(["mobile", "desktop", "either"]),
  accessibility: z.array(z.string()),
  reading_level: z.enum(["general", "detailed"]),
  voice: z.string().min(1),
});

export type Persona = z.infer<typeof PersonaSchema>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BUILTIN_PERSONAS_DIR = path.resolve(__dirname, "..", "personas");
export const DEFAULT_PERSONA_DIRS = [
  BUILTIN_PERSONAS_DIR,
  USER_PERSONAS_DIR,
] as const;

export const DEFAULT_PERSONA_ID = "newcomer-orientation-seeker";

export function loadPersonaFromFile(filePath: string): Persona {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw);
  return PersonaSchema.parse(parsed);
}

export async function listPersonas(
  dirs: string | readonly string[] = DEFAULT_PERSONA_DIRS
): Promise<Persona[]> {
  const personasById = new Map<string, Persona>();
  for (const dir of normalizePersonaDirs(dirs)) {
    for (const persona of await listPersonasInDir(dir)) {
      personasById.set(persona.id, persona);
    }
  }
  return [...personasById.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadPersonaById(
  id: string,
  dirs: string | readonly string[] = DEFAULT_PERSONA_DIRS
): Promise<Persona> {
  const all = await listPersonas(dirs);
  const found = all.find((p) => p.id === id);
  if (!found) {
    const ids = all.map((p) => p.id).join(", ");
    throw new Error(
      `Persona "${id}" not found. Available: ${ids}. Run with --list-personas for details.`
    );
  }
  return found;
}

function normalizePersonaDirs(dirs: string | readonly string[]): readonly string[] {
  return typeof dirs === "string" ? [dirs] : dirs;
}

export interface PersonaSource {
  filePath: string;
  raw: string;
  isBuiltin: boolean;
}

/**
 * Find the raw YAML source for a persona id. Walks the dirs in order;
 * later matches override earlier ones, matching `loadPersonaById`'s
 * user-overrides-builtin precedence. Returns null if no file in any
 * dir declares that id. Reads each candidate file from disk — only
 * intended for on-demand UI inspection, not hot paths.
 */
export async function findPersonaSource(
  id: string,
  dirs: string | readonly string[] = DEFAULT_PERSONA_DIRS
): Promise<PersonaSource | null> {
  let found: PersonaSource | null = null;
  for (const dir of normalizePersonaDirs(dirs)) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (e) {
      if (isNodeError(e) && e.code === "ENOENT") continue;
      throw e;
    }
    for (const f of entries.sort()) {
      if (!f.endsWith(".yaml") && !f.endsWith(".yml")) continue;
      const filePath = path.join(dir, f);
      let raw: string;
      try {
        raw = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = parseYaml(raw);
      } catch {
        continue;
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (parsed as { id?: unknown }).id === id
      ) {
        found = {
          filePath,
          raw,
          isBuiltin: dir === BUILTIN_PERSONAS_DIR,
        };
      }
    }
  }
  return found;
}

async function listPersonasInDir(dir: string): Promise<Persona[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e) {
    if (isNodeError(e) && e.code === "ENOENT") {
      return [];
    }
    throw e;
  }

  const yamlFiles = entries
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  return yamlFiles.map((f) => loadPersonaFromFile(path.join(dir, f)));
}

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}
