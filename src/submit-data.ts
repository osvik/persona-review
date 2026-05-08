import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Persona } from "./persona.js";

const optionalString = z.string().min(1).nullable().optional();

// passthrough() lets users add country-specific or site-specific fields
// (e.g. dni_o_nie for Spain, ssn for the US, vat_number, etc.) without
// having to extend the schema. They surface in describeSubmitData() too.
export const SubmitDataSchema = z.object({
  identity: z
    .object({
      first_name: optionalString,
      last_name: optionalString,
      email: optionalString,
      phone: optionalString,
      date_of_birth: optionalString,
    })
    .partial()
    .passthrough()
    .default({}),
  address: z
    .object({
      line1: optionalString,
      line2: optionalString,
      city: optionalString,
      postcode: optionalString,
      region: optionalString,
      country_code: optionalString,
      country_name: optionalString,
    })
    .partial()
    .passthrough()
    .default({}),
  payment: z
    .object({
      test_credit_card: z
        .object({
          number: optionalString,
          name_on_card: optionalString,
          exp_month: optionalString,
          exp_year: optionalString,
          cvv: optionalString,
        })
        .partial()
        .passthrough()
        .default({}),
      test_iban: optionalString,
      test_bic: optionalString,
      test_account_holder: optionalString,
    })
    .partial()
    .passthrough()
    .default({}),
  donation: z
    .object({
      amount: optionalString,
      currency: optionalString,
      frequency: optionalString,
    })
    .partial()
    .passthrough()
    .default({}),
  custom: z
    .record(z.string(), optionalString)
    .default({}),
});

export type SubmitData = z.infer<typeof SubmitDataSchema>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SUBMIT_DATA_PATH = path.resolve(
  __dirname,
  "..",
  "submit-data.yaml"
);

export function isSubmitDataYamlPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".yaml" || ext === ".yml";
}

export function loadSubmitData(filePath?: string): SubmitData {
  const target = filePath ?? DEFAULT_SUBMIT_DATA_PATH;
  if (!isSubmitDataYamlPath(target)) {
    throw new Error("--submit-data must point to a .yaml or .yml file.");
  }
  const raw = readFileSync(target, "utf-8");
  const parsed = parseYaml(raw);
  return SubmitDataSchema.parse(parsed ?? {});
}

/**
 * Resolve the effective identity to use when filling forms. The persona's
 * first name is the default for `identity.first_name` when the YAML leaves
 * it null/empty (so submitted records still link back to which persona ran).
 */
export function resolveIdentity(
  data: SubmitData,
  persona: Persona
): { first_name: string; last_name: string; email: string } {
  const personaFirstName = persona.name.split(/\s+/)[0] ?? persona.name;
  return {
    first_name: data.identity.first_name?.trim() || personaFirstName,
    last_name: data.identity.last_name?.trim() || "PersonaReview",
    email:
      data.identity.email?.trim() || "persona-review+test@example.com",
  };
}

/**
 * Render the test identity as plain text the operator can read in the
 * consent prompt and the LLM can read in the user message. Skips
 * null/empty fields so the prompt stays compact.
 */
export function describeSubmitData(
  data: SubmitData,
  persona: Persona
): string {
  const id = resolveIdentity(data, persona);
  const lines: string[] = [];
  lines.push(`Name:    ${id.first_name} ${id.last_name}`);
  lines.push(`Email:   ${id.email}`);
  if (data.identity.phone) lines.push(`Phone:   ${data.identity.phone}`);
  if (data.identity.date_of_birth)
    lines.push(`DOB:     ${data.identity.date_of_birth}`);
  // Country-specific identity fields (DNI/NIE for Spain, SSN, etc.) added
  // via passthrough — surface them so the LLM can use them.
  for (const [k, v] of extraEntries(data.identity, [
    "first_name",
    "last_name",
    "email",
    "phone",
    "date_of_birth",
  ])) {
    lines.push(`${k}: ${v}`);
  }

  const addr = data.address;
  const addrParts = [
    addr.line1,
    addr.line2,
    [addr.postcode, addr.city].filter(Boolean).join(" "),
    addr.country_name ?? addr.country_code,
  ].filter((s): s is string => Boolean(s && s.trim()));
  if (addrParts.length) lines.push(`Address: ${addrParts.join(", ")}`);
  for (const [k, v] of extraEntries(data.address, [
    "line1",
    "line2",
    "city",
    "postcode",
    "region",
    "country_code",
    "country_name",
  ])) {
    lines.push(`${k}: ${v}`);
  }

  const cc = data.payment.test_credit_card;
  if (cc?.number) {
    const exp =
      cc.exp_month && cc.exp_year ? ` (exp ${cc.exp_month}/${cc.exp_year})` : "";
    lines.push(`Card:    ${cc.number}${exp}`);
  }
  if (data.payment.test_iban) lines.push(`IBAN:    ${data.payment.test_iban}`);
  for (const [k, v] of extraEntries(data.payment, [
    "test_credit_card",
    "test_iban",
    "test_bic",
    "test_account_holder",
  ])) {
    lines.push(`${k}: ${v}`);
  }

  if (data.donation.amount) {
    const cur = data.donation.currency ?? "";
    const freq = data.donation.frequency ? ` (${data.donation.frequency})` : "";
    lines.push(`Donation: ${data.donation.amount} ${cur}${freq}`.trim());
  }
  for (const [k, v] of extraEntries(data.donation, [
    "amount",
    "currency",
    "frequency",
  ])) {
    lines.push(`${k}: ${v}`);
  }

  const customEntries = Object.entries(data.custom).filter(
    ([, v]) => v && v.trim()
  );
  for (const [k, v] of customEntries) {
    lines.push(`${k}: ${v}`);
  }

  return lines.join("\n");
}

function extraEntries(
  obj: Record<string, unknown>,
  knownKeys: string[]
): [string, string][] {
  const known = new Set(knownKeys);
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (known.has(k)) continue;
    if (v == null) continue;
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    out.push([k, trimmed]);
  }
  return out;
}
