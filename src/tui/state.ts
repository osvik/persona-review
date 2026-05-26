import type { Persona } from "../persona.js";
import type { PersonaConversation, ReviewRun } from "../agent.js";
import type { Provider } from "../llm/types.js";
import type { UserDefaults } from "../defaults.js";
import type { SessionDevice } from "../browser.js";
import type { ApiKeySource } from "../keys.js";
import {
  DEFAULT_COST_CAP_USD,
  DEFAULT_MAX_ACTIONS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_PROVIDER,
} from "../agent.js";
import { DEFAULT_PERSONA_ID } from "../persona.js";

export type Screen = "form" | "personas" | "review" | "repl" | "done";

export interface ChatTurn {
  q: string;
  a: string;
  costUsd: number;
  costRemaining: number;
  actionsTaken: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ApiKeyState {
  ready: boolean;
  envVar: string;
  source: ApiKeySource;
  filePath: string;
}

export interface State {
  screen: Screen;
  url: string;
  personaId: string;
  device: SessionDevice | undefined;
  provider: Provider;
  model: string | undefined;
  maxOutputTokens: number;
  maxActions: number;
  costCapUsd: number;
  fullPage: boolean;
  personas: Persona[];
  conv: PersonaConversation | null;
  statusLog: string[];
  review: ReviewRun | null;
  chat: ChatTurn[];
  apiKey: ApiKeyState;
  error: string | null;
  busy: boolean;
}

export type Action =
  | { type: "SET_URL"; url: string }
  | { type: "SET_PERSONA_ID"; personaId: string }
  | { type: "SET_DEVICE"; device: SessionDevice | undefined }
  | { type: "SET_API_KEY"; apiKey: ApiKeyState }
  | { type: "NAVIGATE"; screen: Screen }
  | { type: "RESET_RUN" }
  | { type: "CONV_READY"; conv: PersonaConversation }
  | { type: "STATUS"; msg: string }
  | { type: "REVIEW_DONE"; review: ReviewRun }
  | { type: "BUSY"; busy: boolean }
  | { type: "ERROR"; error: string | null }
  | { type: "REPL_APPEND"; turn: ChatTurn };

const STATUS_LOG_CAP = 200;

export function initialState(
  userDefaults: Partial<UserDefaults>,
  personas: Persona[],
  apiKey: ApiKeyState
): State {
  return {
    screen: "form",
    url: "",
    personaId: userDefaults.personaId ?? DEFAULT_PERSONA_ID,
    device: userDefaults.device,
    provider: userDefaults.provider ?? DEFAULT_PROVIDER,
    model: userDefaults.model,
    maxOutputTokens: userDefaults.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    maxActions: userDefaults.maxActions ?? DEFAULT_MAX_ACTIONS,
    costCapUsd: userDefaults.costCapUsd ?? DEFAULT_COST_CAP_USD,
    fullPage: userDefaults.fullPage ?? false,
    personas,
    conv: null,
    statusLog: [],
    review: null,
    chat: [],
    apiKey,
    error: null,
    busy: false,
  };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_URL":
      return { ...state, url: action.url };
    case "SET_PERSONA_ID":
      return { ...state, personaId: action.personaId };
    case "SET_DEVICE":
      return { ...state, device: action.device };
    case "SET_API_KEY":
      return { ...state, apiKey: action.apiKey };
    case "NAVIGATE":
      return { ...state, screen: action.screen, error: null };
    case "RESET_RUN":
      return {
        ...state,
        conv: null,
        statusLog: [],
        review: null,
        chat: [],
        busy: false,
        error: null,
      };
    case "CONV_READY":
      return { ...state, conv: action.conv };
    case "STATUS": {
      const next = state.statusLog.concat(action.msg);
      if (next.length > STATUS_LOG_CAP) next.splice(0, next.length - STATUS_LOG_CAP);
      return { ...state, statusLog: next };
    }
    case "REVIEW_DONE":
      return { ...state, review: action.review, busy: false };
    case "BUSY":
      return { ...state, busy: action.busy };
    case "ERROR":
      return { ...state, error: action.error, busy: false };
    case "REPL_APPEND":
      return { ...state, chat: state.chat.concat(action.turn), busy: false };
  }
}
