// Every supported harness. Each adapter knows only how its own configuration is read and written.
import { claude } from "./claude.mjs";
import { codex } from "./codex.mjs";
import { cursor } from "./cursor.mjs";
import { grok } from "./grok.mjs";

export const harnesses = { claude, codex, cursor, grok };
