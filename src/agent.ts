import type { Persona } from "./persona.js";
import {
  BrowserSession,
  type DeviceProfile,
  type PageObservation,
  type SessionDevice,
  profileFor,
} from "./browser.js";
import {
  FeedbackSchema,
  FollowUpAnswerSchema,
  type Feedback,
  FEEDBACK_TOOL_NAME,
  FEEDBACK_TOOL_SCHEMA,
  FOLLOW_UP_TOOL_NAME,
  FOLLOW_UP_TOOL_SCHEMA,
  buildSystemPrompt,
} from "./review.js";
import { CostTracker, formatUsd } from "./cost.js";
import {
  describeSubmitData,
  resolveIdentity,
  type SubmitData,
} from "./submit-data.js";
import { AnthropicClient } from "./llm/anthropic.js";
import { GoogleGeminiClient } from "./llm/google.js";
import { OpenAIResponsesClient } from "./llm/openai.js";
import type {
  ContentBlock,
  Message,
  ModelClient,
  Provider,
  ToolDefinition,
  ToolResultBlock,
  ToolUseBlock,
} from "./llm/types.js";

export const DEFAULT_PROVIDER: Provider = "anthropic";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const DEFAULT_GOOGLE_MODEL = "gemini-3.1-pro-preview-customtools";
export const DEFAULT_OPENAI_MODEL = "gpt-5.4";
export const DEFAULT_MODEL = DEFAULT_ANTHROPIC_MODEL;
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
export const DEFAULT_MAX_ACTIONS = 15;
export const DEFAULT_COST_CAP_USD = 1.0;
export const MAX_SUBMITS_PER_SESSION = 1;

export type StatusCallback = (msg: string) => void;

export interface OpenConversationOptions {
  provider?: Provider;
  model?: string;
  maxOutputTokens?: number;
  maxActions?: number;
  costCapUsd?: number;
  fullPage?: boolean;
  device?: SessionDevice;
  onStatus?: StatusCallback;
  allowSubmit?: boolean;
  allowDownloads?: boolean;
  submitData?: SubmitData;
}

export type RunReviewOptions = OpenConversationOptions;

export interface PersonaConversation {
  persona: Persona;
  url: string;
  session: BrowserSession;
  costTracker: CostTracker;
  client: ModelClient;
  provider: Provider;
  model: string;
  maxOutputTokens: number;
  maxActions: number;
  costCapUsd: number;
  systemPrompt: string;
  profile: DeviceProfile;
  messages: Message[];
  totalInputTokens: number;
  totalOutputTokens: number;
  status: StatusCallback;
  initialObservation: PageObservation;
  reviewCompleted: boolean;
  closed: boolean;
  allowSubmit: boolean;
  submitData?: SubmitData;
  submitsTaken: number;
  maxSubmits: number;
}

export function resolveDevice(
  personaDevice: Persona["device"],
  override?: SessionDevice
): SessionDevice {
  if (override) return override;
  if (personaDevice === "mobile") return "mobile";
  return "desktop";
}

export interface ReviewRun {
  feedback: Feedback;
  provider: Provider;
  model: string;
  actionsTaken: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costCapUsd: number;
}

export interface FollowUpRun {
  answer: string;
  provider: Provider;
  model: string;
  actionsTaken: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costCapUsd: number;
  costRemaining: number;
}

const SCROLL_TOOL = {
  name: "scroll",
  description:
    "Scroll the page. 'viewport' moves ~80% of one screen; 'page' moves ~95%.",
  inputSchema: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["up", "down"] },
      amount: {
        type: "string",
        enum: ["viewport", "page", "to_top", "to_bottom"],
      },
      label: {
        type: "string",
        description:
          "Short English label for the operator's status line (e.g. 'check below the fold').",
      },
    },
    required: ["direction", "label"],
  },
} as const;

const CLICK_TOOL = {
  name: "click",
  description:
    "Click an element by its [ref=eN] from the latest ARIA snapshot. Will not submit forms.",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string" },
      label: { type: "string", description: "Short English label." },
    },
    required: ["ref", "label"],
  },
} as const;

const TYPE_TOOL = {
  name: "type",
  description:
    "Fill an input/textarea by [ref=eN]. Does NOT submit the form.",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string" },
      text: { type: "string" },
      label: { type: "string", description: "Short English label." },
    },
    required: ["ref", "text", "label"],
  },
} as const;

const FEEDBACK_TOOL = {
  name: FEEDBACK_TOOL_NAME,
  description:
    "Submit your final structured review feedback when you're done exploring (initial review only).",
  inputSchema: FEEDBACK_TOOL_SCHEMA,
} as const;

const FOLLOW_UP_TOOL = {
  name: FOLLOW_UP_TOOL_NAME,
  description:
    "Submit your answer to a single follow-up question (follow-up Q&A only).",
  inputSchema: FOLLOW_UP_TOOL_SCHEMA,
} as const;

const REVIEW_TOOLS = [
  SCROLL_TOOL,
  CLICK_TOOL,
  TYPE_TOOL,
  FEEDBACK_TOOL,
] as unknown as ToolDefinition[];

const FOLLOW_UP_TOOLS = [
  SCROLL_TOOL,
  CLICK_TOOL,
  TYPE_TOOL,
  FOLLOW_UP_TOOL,
] as unknown as ToolDefinition[];

export async function openConversation(
  persona: Persona,
  url: string,
  opts: OpenConversationOptions = {}
): Promise<PersonaConversation> {
  const provider = opts.provider ?? DEFAULT_PROVIDER;
  const model =
    opts.model ??
    (provider === "openai"
      ? DEFAULT_OPENAI_MODEL
      : provider === "google"
        ? DEFAULT_GOOGLE_MODEL
        : DEFAULT_ANTHROPIC_MODEL);
  const maxOutputTokens = opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const maxActions = opts.maxActions ?? DEFAULT_MAX_ACTIONS;
  const costCapUsd = opts.costCapUsd ?? DEFAULT_COST_CAP_USD;
  const status = opts.onStatus ?? (() => {});

  const device = resolveDevice(persona.device, opts.device);
  const costTracker = new CostTracker(costCapUsd, provider, model);
  const allowSubmit = opts.allowSubmit ?? false;
  if (allowSubmit && !opts.submitData) {
    throw new Error(
      "openConversation: allowSubmit=true requires submitData. Load it with loadSubmitData() and pass it in."
    );
  }
  const session = new BrowserSession({
    device,
    fullPage: opts.fullPage ?? false,
    allowSubmit,
    allowDownloads: opts.allowDownloads ?? false,
  });
  const profile = profileFor(device);
  const client = createModelClient(provider);

  status(
    `[${persona.name} (${persona.id}, ${device} ${profile.viewport.width}x${profile.viewport.height}, ${provider}/${model}) is loading ${url}...]`
  );
  const { loadMs } = await session.open(url);
  const initialObservation = await session.observe();
  status(
    `[page loaded in ${loadMs} ms — lang=${initialObservation.htmlLang ?? "(none)"} — ${formatBytes(initialObservation.screenshotBytes)} screenshot]`
  );
  if (initialObservation.failedRequests.length) {
    status(
      `[${initialObservation.failedRequests.length} failed requests during load]`
    );
  }

  const systemPrompt = buildSystemPrompt(persona, { allowSubmit });

  return {
    persona,
    url,
    session,
    costTracker,
    client,
    provider,
    model,
    maxOutputTokens,
    maxActions,
    costCapUsd,
    systemPrompt,
    profile,
    messages: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    status,
    initialObservation,
    reviewCompleted: false,
    closed: false,
    allowSubmit,
    submitData: opts.submitData,
    submitsTaken: 0,
    maxSubmits: MAX_SUBMITS_PER_SESSION,
  };
}

export async function closeConversation(
  conv: PersonaConversation
): Promise<void> {
  if (conv.closed) return;
  conv.closed = true;
  await conv.session.close();
}

function createModelClient(provider: Provider): ModelClient {
  if (provider === "openai") return new OpenAIResponsesClient();
  if (provider === "google") return new GoogleGeminiClient();
  return new AnthropicClient();
}

export async function runReviewLoop(
  conv: PersonaConversation
): Promise<ReviewRun> {
  if (conv.reviewCompleted) {
    throw new Error("Review has already been completed for this conversation.");
  }
  if (conv.messages.length === 0) {
    conv.messages.push({
      role: "user",
      content: buildInitialReviewContent(
        conv.persona,
        conv.initialObservation,
        conv.profile,
        conv.allowSubmit,
        conv.submitData
      ),
    });
  }
  conv.status(`[${conv.persona.name} is exploring the page...]`);

  const { result: feedback, actionsTaken } = await runToolLoop(conv, {
    tools: REVIEW_TOOLS,
    finalToolName: FEEDBACK_TOOL_NAME,
    finalLabel: "feedback",
    parseFinal: (input) => FeedbackSchema.parse(input),
  });

  conv.reviewCompleted = true;
  return {
    feedback,
    provider: conv.provider,
    model: conv.model,
    actionsTaken,
    inputTokens: conv.totalInputTokens,
    outputTokens: conv.totalOutputTokens,
    costUsd: conv.costTracker.total(),
    costCapUsd: conv.costCapUsd,
  };
}

export async function runFollowUpTurn(
  conv: PersonaConversation,
  question: string
): Promise<FollowUpRun> {
  if (conv.closed) {
    throw new Error("Conversation is closed.");
  }
  if (conv.costTracker.remaining() <= 0) {
    throw new Error(
      `Cost cap already exhausted (${formatUsd(conv.costTracker.total())} of ${formatUsd(conv.costCapUsd)}).`
    );
  }

  if (conv.messages.length === 0) {
    // First turn ever — orient the persona, attach observation, and ask.
    conv.messages.push({
      role: "user",
      content: buildInitialFollowUpContent(
        conv.persona,
        conv.initialObservation,
        conv.profile,
        question,
        conv.allowSubmit,
        conv.submitData
      ),
    });
  } else {
    // Continuing after a review or another follow-up: close out any
    // unanswered final-tool calls (submit_feedback / submit_answer) from
    // the prior assistant turn, then attach a fresh observation + question.
    const observation = await conv.session.observe();
    const blocks: ContentBlock[] = [];
    for (const t of unansweredToolUses(conv.messages)) {
      blocks.push({
        type: "tool_result",
        toolUseId: t.id,
        content:
          t.name === FEEDBACK_TOOL_NAME
            ? "Review feedback received. The user now has a follow-up question."
            : "Answer received. The user has another follow-up question.",
      });
    }
    blocks.push(...buildFollowUpContent(observation, question));
    conv.messages.push({ role: "user", content: blocks });
  }

  conv.status(`[${conv.persona.name} is considering: "${question}"]`);

  const { result: parsed, actionsTaken } = await runToolLoop(conv, {
    tools: FOLLOW_UP_TOOLS,
    finalToolName: FOLLOW_UP_TOOL_NAME,
    finalLabel: "answer",
    parseFinal: (input) => FollowUpAnswerSchema.parse(input),
  });

  return {
    answer: parsed.answer,
    provider: conv.provider,
    model: conv.model,
    actionsTaken,
    inputTokens: conv.totalInputTokens,
    outputTokens: conv.totalOutputTokens,
    costUsd: conv.costTracker.total(),
    costCapUsd: conv.costCapUsd,
    costRemaining: conv.costTracker.remaining(),
  };
}

export async function runReview(
  persona: Persona,
  url: string,
  opts: RunReviewOptions = {}
): Promise<ReviewRun> {
  const conv = await openConversation(persona, url, opts);
  try {
    return await runReviewLoop(conv);
  } finally {
    await closeConversation(conv);
  }
}

interface ToolLoopConfig<T> {
  tools: ToolDefinition[];
  finalToolName: string;
  finalLabel: string;
  parseFinal: (input: unknown) => T;
}

async function runToolLoop<T>(
  conv: PersonaConversation,
  config: ToolLoopConfig<T>
): Promise<{ result: T; actionsTaken: number }> {
  let actionsTaken = 0;
  while (true) {
    const forceFinal = actionsTaken >= conv.maxActions;
    const toolChoice = forceFinal
      ? { type: "tool" as const, name: config.finalToolName }
      : { type: "any" as const };

    const response = await conv.client.createResponse({
      model: conv.model,
      maxOutputTokens: conv.maxOutputTokens,
      systemPrompt: conv.systemPrompt,
      tools: config.tools,
      toolChoice,
      messages: conv.messages,
    });

    conv.totalInputTokens += response.usage.inputTokens;
    conv.totalOutputTokens += response.usage.outputTokens;
    const { total } = conv.costTracker.add(
      response.usage.inputTokens,
      response.usage.outputTokens,
      response.usage.cacheReadTokens,
      response.usage.cacheWriteTokens
    );

    if (conv.costTracker.exceeded()) {
      throw new Error(
        `Cost cap exceeded: ${formatUsd(total)} > ${formatUsd(conv.costCapUsd)} after ${actionsTaken} action(s) in this ${config.finalLabel} turn. Stop early or raise --cost-cap-usd.`
      );
    }

    const toolUses = response.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUses.length) {
      throw new Error(
        `Model did not call a tool. Stop reason: ${response.stopReason}.`
      );
    }

    conv.messages.push({
      role: "assistant",
      content: response.content,
    });

    const finalCall = toolUses.find((t) => t.name === config.finalToolName);
    if (finalCall) {
      const result = config.parseFinal(finalCall.input);
      return { result, actionsTaken };
    }

    const toolResults: ToolResultBlock[] = [];
    for (const tu of toolUses) {
      if (actionsTaken >= conv.maxActions) {
        toolResults.push({
          type: "tool_result",
          toolUseId: tu.id,
          content: `Action limit reached (${conv.maxActions}). Submit your ${config.finalLabel} now via ${config.finalToolName}.`,
          isError: true,
        });
        continue;
      }
      actionsTaken++;
      const result = await executeAction(conv, tu);
      toolResults.push(result);
    }

    const observation = await conv.session.observe();

    conv.messages.push({
      role: "user",
      content: [
        ...toolResults,
        ...buildObservationContent(
          observation,
          conv.costTracker.remaining(),
          conv.maxActions - actionsTaken
        ),
      ],
    });
  }
}

function unansweredToolUses(
  messages: Message[]
): { id: string; name: string }[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return [];
  return last.content
    .filter((b): b is ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name }));
}

async function executeAction(
  conv: PersonaConversation,
  tu: ToolUseBlock
): Promise<ToolResultBlock> {
  const session = conv.session;
  const status = conv.status;
  const persona = conv.persona;
  const input = tu.input as Record<string, string>;
  const label = input.label ?? "(no label)";

  if (tu.name === "scroll") {
    const direction = input.direction as "up" | "down";
    const amount = (input.amount ?? "viewport") as
      | "viewport"
      | "page"
      | "to_top"
      | "to_bottom";
    status(`[${persona.name} scrolls ${direction} (${amount}) — ${label}]`);
    const r = await session.scroll(direction, amount);
    return {
      type: "tool_result",
      toolUseId: tu.id,
      content: r.ok ? "scrolled" : `error: ${r.reason}`,
      isError: !r.ok,
    };
  }

  if (tu.name === "click") {
    const r = await session.click(input.ref);
    if (r.ok && r.submitted) {
      conv.submitsTaken++;
      // Lock the session so a runaway loop can't create more records.
      if (conv.submitsTaken >= conv.maxSubmits) {
        session.allowSubmit = false;
      }
      status(
        `[${persona.name} SUBMITS the form — ${label} (submission ${conv.submitsTaken}/${conv.maxSubmits})]`
      );
      return {
        type: "tool_result",
        toolUseId: tu.id,
        content:
          "submitted — the form was sent. The next observation shows the result page (thank-you, error, validation message, or redirect). Do NOT submit again. Read the result, then call submit_feedback (review) or submit_answer (follow-up) with the persona's reaction to that specific thank-you / error message.",
      };
    }
    status(`[${persona.name} clicks ref=${input.ref} — ${label}]`);
    return {
      type: "tool_result",
      toolUseId: tu.id,
      content: r.ok ? "clicked" : `error: ${r.reason}`,
      isError: !r.ok,
    };
  }

  if (tu.name === "type") {
    status(
      `[${persona.name} types into ref=${input.ref} — ${label}]`
    );
    const r = await session.type(input.ref, input.text);
    return {
      type: "tool_result",
      toolUseId: tu.id,
      content: r.ok ? "typed" : `error: ${r.reason}`,
      isError: !r.ok,
    };
  }

  return {
    type: "tool_result",
    toolUseId: tu.id,
    content: `Unknown tool: ${tu.name}`,
    isError: true,
  };
}

function buildInitialReviewContent(
  persona: Persona,
  obs: PageObservation,
  profile: { device: string; viewport: { width: number; height: number } },
  allowSubmit: boolean,
  submitData: SubmitData | undefined
): ContentBlock[] {
  const personaCard = JSON.stringify(persona, null, 2);
  const visiblePct = computeVisiblePct(profile.viewport.height, obs.documentHeight);
  const submissionBlock = buildSubmissionBlock(persona, allowSubmit, submitData);
  return [
    {
      type: "text",
      text:
        `You are ${persona.name}. Your full persona card:\n\n${personaCard}\n\n` +
        `You just loaded this page on a ${profile.device} device with a ${profile.viewport.width}x${profile.viewport.height} viewport:\n` +
        `- URL: ${obs.url}\n` +
        `- Page title: ${obs.title}\n` +
        `- PAGE LANGUAGE: ${describeLanguage(obs.htmlLang)}\n` +
        `- Page is ${obs.documentHeight}px tall; the screenshot below shows only the top viewport (~${visiblePct}% of the document). Scroll to see what's below the fold.\n\n` +
        `PHASE: INITIAL REVIEW. End this phase with a single ${FEEDBACK_TOOL_NAME} call (do NOT call ${FOLLOW_UP_TOOL_NAME} here).\n\n` +
        `EVERY human-readable field in your final ${FEEDBACK_TOOL_NAME} call must be written in the PAGE LANGUAGE above, not in any language implied by the persona's name. ${persona.name} is a native speaker of the page's language. If the page language could not be detected, use the language the page content itself appears to be in.\n\n` +
        `Explore the page as ${persona.name} would. Each turn, call exactly one tool: scroll, click, type, or ${FEEDBACK_TOOL_NAME} when you're done. Take real actions rather than narrating hypothetical ones — if you would dismiss a banner that's blocking content, click it; if you would scroll to read more, scroll. Most personas reach a verdict in 2–6 actions.\n\n` +
        submissionBlock +
        `Initial viewport screenshot (top of page):`,
    },
    {
      type: "image",
      mediaType: obs.screenshotMediaType,
      data: obs.screenshotBase64,
    },
    {
      type: "text",
      text:
        `Initial accessibility tree (covers the WHOLE page; use [ref=eN] markers for click/type — the screenshot above only shows the top viewport):\n\n` +
        "```yaml\n" +
        obs.ariaSnapshot +
        "\n```\n\n" +
        `Page state: scrollY=${obs.scrollY}/${obs.documentHeight}, console errors=${obs.consoleErrors.length}, failed requests=${obs.failedRequests.length}.\n\n` +
        `FINAL LANGUAGE REMINDER before you act: when you eventually call ${FEEDBACK_TOOL_NAME}, EVERY human-readable string must be in ${describeLanguage(obs.htmlLang)} — including every item in the "liked" array, every item in the "confused_by" array, every "where" and "quote" inside "friction", every item in "trust_signals.positive" and "trust_signals.negative", every "step" and "reaction" in "trace", and the "summary". Do not let the persona's name "${persona.name}" pull you toward another language. Re-read each item before submitting.`,
    },
  ];
}

function buildInitialFollowUpContent(
  persona: Persona,
  obs: PageObservation,
  profile: { device: string; viewport: { width: number; height: number } },
  question: string,
  allowSubmit: boolean,
  submitData: SubmitData | undefined
): ContentBlock[] {
  const personaCard = JSON.stringify(persona, null, 2);
  const visiblePct = computeVisiblePct(profile.viewport.height, obs.documentHeight);
  const submissionBlock = buildSubmissionBlock(persona, allowSubmit, submitData);
  return [
    {
      type: "text",
      text:
        `You are ${persona.name}. Your full persona card:\n\n${personaCard}\n\n` +
        `You just loaded this page on a ${profile.device} device with a ${profile.viewport.width}x${profile.viewport.height} viewport:\n` +
        `- URL: ${obs.url}\n` +
        `- Page title: ${obs.title}\n` +
        `- PAGE LANGUAGE: ${describeLanguage(obs.htmlLang)}\n` +
        `- Page is ${obs.documentHeight}px tall; the screenshot below shows only the top viewport (~${visiblePct}% of the document).\n\n` +
        `PHASE: FOLLOW-UP Q&A. The user is skipping the full review and asking specific questions. End this turn with a single ${FOLLOW_UP_TOOL_NAME} call (do NOT call ${FEEDBACK_TOOL_NAME}). You may scroll/click/type first if you need to look at something specific to answer well; if the page is already enough to answer, just answer.\n\n` +
        `The "answer" field in ${FOLLOW_UP_TOOL_NAME} must be in the PAGE LANGUAGE above, in the persona's voice, a few sentences or a short paragraph. No markdown, no headers.\n\n` +
        submissionBlock +
        `Initial viewport screenshot (top of page):`,
    },
    {
      type: "image",
      mediaType: obs.screenshotMediaType,
      data: obs.screenshotBase64,
    },
    {
      type: "text",
      text:
        `Initial accessibility tree (covers the WHOLE page):\n\n` +
        "```yaml\n" +
        obs.ariaSnapshot +
        "\n```\n\n" +
        `Page state: scrollY=${obs.scrollY}/${obs.documentHeight}, console errors=${obs.consoleErrors.length}, failed requests=${obs.failedRequests.length}.\n\n` +
        `User's question: "${question}"\n\n` +
        `Answer in ${describeLanguage(obs.htmlLang)}, in ${persona.name}'s voice. Call ${FOLLOW_UP_TOOL_NAME} when ready.`,
    },
  ];
}

function buildFollowUpContent(
  obs: PageObservation,
  question: string
): ContentBlock[] {
  return [
    {
      type: "text",
      text:
        `New follow-up question from the user. Current page state: scrollY=${obs.scrollY}/${obs.documentHeight}, console errors=${obs.consoleErrors.length}, failed requests=${obs.failedRequests.length}.\n\nCurrent screenshot:`,
    },
    {
      type: "image",
      mediaType: obs.screenshotMediaType,
      data: obs.screenshotBase64,
    },
    {
      type: "text",
      text:
        `Current accessibility tree (refs are stable for this state only — don't reuse refs from earlier turns):\n\n` +
        "```yaml\n" +
        obs.ariaSnapshot +
        "\n```\n\n" +
        `User's question: "${question}"\n\n` +
        `Call ${FOLLOW_UP_TOOL_NAME} with your answer in the page's language. You may scroll/click/type first only if it materially helps you answer.`,
    },
  ];
}

function buildObservationContent(
  obs: PageObservation,
  remainingUsd: number,
  remainingActions: number
): ContentBlock[] {
  return [
    {
      type: "text",
      text:
        `Updated page state: scrollY=${obs.scrollY}/${obs.documentHeight}, console errors=${obs.consoleErrors.length}, failed requests=${obs.failedRequests.length}. ` +
        `Budget remaining: ${formatUsd(remainingUsd)}. Actions remaining: ${remainingActions}.\n\n` +
        `Updated screenshot:`,
    },
    {
      type: "image",
      mediaType: obs.screenshotMediaType,
      data: obs.screenshotBase64,
    },
    {
      type: "text",
      text:
        `Updated accessibility tree (refs are stable for this state only — don't reuse refs from earlier turns):\n\n` +
        "```yaml\n" +
        obs.ariaSnapshot +
        "\n```",
    },
  ];
}

function buildSubmissionBlock(
  persona: Persona,
  allowSubmit: boolean,
  submitData: SubmitData | undefined
): string {
  if (!allowSubmit) return "";
  if (!submitData) return "";
  const id = resolveIdentity(submitData, persona);
  const description = describeSubmitData(submitData, persona);
  return (
    `FORM SUBMISSION ENABLED for this run. The operator wants ${persona.name} to fill the form on this page and click its submit button so the persona can react to the actual outcome (thank-you page, error message, validation feedback, redirect — whatever the page returns).\n\n` +
    `Use ONLY the test identity below for every form field. These are dummy values that the operator will delete from their CRM after the run. Match each field type to the right value (do not put a phone number into the email field, etc.):\n\n` +
    description +
    `\n\nSubmission rules:\n` +
    `- Submit at most ONCE per session. After you click a submit button successfully, the next observation will show the result page; from that point any further submit-button click will be refused.\n` +
    `- After submitting, your final ${FEEDBACK_TOOL_NAME} or ${FOLLOW_UP_TOOL_NAME} MUST quote and react to the resulting thank-you message or error in the persona's voice.\n` +
    `- For the persona's first or last name, use "${id.first_name} ${id.last_name}" — do NOT use the persona's full identity beyond what is listed above.\n` +
    `- If the page has no obvious form to submit, do not try to submit; mention that in your final feedback / answer.\n\n`
  );
}

function describeLanguage(htmlLang: string | null): string {
  if (!htmlLang) return "not declared (infer from page content)";
  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" });
    const name = display.of(htmlLang);
    return name && name !== htmlLang ? `${name} (${htmlLang})` : htmlLang;
  } catch {
    return htmlLang;
  }
}

function computeVisiblePct(viewportHeight: number, documentHeight: number): number {
  if (documentHeight <= 0) return 100;
  return Math.min(100, Math.round((viewportHeight / documentHeight) * 100));
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
