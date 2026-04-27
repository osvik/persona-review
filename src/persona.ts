import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const PersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  age: z.number().int().optional(),
  role: z.string().min(1),
  cause_engagement: z.enum(["casual", "regular", "committed"]),
  scrutiny: z.enum(["low-medium", "medium", "high"]),
  goals: z.array(z.string()).min(1),
  frustrations: z.array(z.string()).min(1),
  tech_confidence: z.enum(["low-medium", "medium", "medium-high"]),
  device: z.enum(["mobile", "desktop", "either"]),
  accessibility: z.array(z.string()),
  reading_level: z.enum(["general", "detailed"]),
  voice: z.string().min(1),
});

export type Persona = z.infer<typeof PersonaSchema>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONA_DIR = path.resolve(__dirname, "..", "personas");

export const DEFAULT_PERSONA_ID = "curious-newcomer";

export function loadPersonaFromFile(filePath: string): Persona {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw);
  return PersonaSchema.parse(parsed);
}

export async function listPersonas(dir: string = PERSONA_DIR): Promise<Persona[]> {
  const entries = await readdir(dir);
  const yamlFiles = entries
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  const personas = yamlFiles.map((f) =>
    loadPersonaFromFile(path.join(dir, f))
  );
  return personas;
}

export async function loadPersonaById(
  id: string,
  dir: string = PERSONA_DIR
): Promise<Persona> {
  const all = await listPersonas(dir);
  const found = all.find((p) => p.id === id);
  if (!found) {
    const ids = all.map((p) => p.id).join(", ");
    throw new Error(
      `Persona "${id}" not found. Available: ${ids}. Run with --list-personas for details.`
    );
  }
  return found;
}
