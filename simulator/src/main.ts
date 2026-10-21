import "./style.css";
import { cardsFor, type MemoryView, type Macros } from "./cards.js";
import { el, icon } from "./dom.js";
import { McpSession, type TraceEntry } from "./mcpClient.js";
import { GeminiOrchestrator, type Msg, type Orchestrator } from "./orchestrator.js";
import { RecorderError, canRecord, startRecording, type Recording } from "./recorder.js";
import { canReplyFast, replyFromResults } from "./reply.js";
import { ReplayOrchestrator, SCENES } from "./replay.js";
import { SideCards } from "./sidecards.js";
import { isGoodbye } from "./talk.js";
import { isSpeaking, speak, stopSpeaking, transcribe } from "./voice.js";

const MAX_HOPS = 5;
const BUDGET_MS = 500;
const WRITE_TOOLS = new Set(["log_meal", "remember_about_user", "resolve_memory", "log_weight"]);
/** Chips shown up front; the rest sit behind "More ideas". Order follows the demo story. */
const PRIMARY_CHIPS = ["teach", "padthai", "know", "better"];

type Mode = "live" | "replay";
type ActionMode = "mic" | "send" | "stop" | "wait";

// ── tiny fetch helpers ─────────────────────────────────────────────────────
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}
async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ── state ──────────────────────────────────────────────────────────────────
let userId = "maya";
let mode: Mode = "replay";
let brainModel: string | null = null;
let brainConfigured = false;
let history: Msg[] = [];
let session: McpSession | null = null;
let busy = false;
let recording: Recording | null = null;
let speakReplies = true;
/** Conversation mode: after a spoken reply to a spoken turn, listen again for the answer (like a follow-up on a smart speaker). */
let conversationMode = true;
/** The reply being read aloud, so conversation mode can wait for it to finish. */
let lastSpeech: Promise<void> | null = null;
/** Whether the last turn ended with a reply from the assistant (not an error). */
let lastTurnReplied = false;
/** Fast: when one tool ran, say the tool's own sentence instead of a second model call. */
let fastReplies = true;
let users: Array<{ id: string; name: string }> = [];

// ── elements ───────────────────────────────────────────────────────────────
const side = new SideCards();
const transcript = el("div", { class: "transcript", attrs: { "aria-live": "polite", "aria-label": "Conversation" } });
const hero = el("div", { class: "hero" }, [
  el("h1", {}, [document.createTextNode("Say it once. "), el("em", { text: "Daizee remembers." })]),
  el("p", {
    text: "A simulated voice assistant calling a real memory service. Try a phrase below.",
  }),
]);
const modePill = el("span", { class: "pill", text: "" });
const historyPill = el("span", { class: "pill", text: "" });
const dayLabel = el("span", { class: "lbl", text: "Demo day +0" });
const chipRow = el("div", { class: "chips" });
const input = el("input", { attrs: { type: "text", maxlength: "500", placeholder: "Ask or tell the assistant something…", "aria-label": "Message", autocomplete: "off", enterkeyhint: "send" } });
const level = el("div", { class: "level", attrs: { "aria-hidden": "true" } });
const actionBtn = el("button", { class: "action", attrs: { type: "button", "data-mode": "mic", "aria-label": "Speak" } }, [
  icon("mic", "i-mic"),
  icon("send", "i-send"),
  icon("stop", "i-stop"),
  icon("wait", "i-wait"),
]);
const listenLabel = el("span", { class: "listen-label", attrs: { "aria-live": "polite" }, text: "Listening…" });
const composer = el("form", { class: "composer", attrs: { autocomplete: "off" } }, [input, listenLabel, level, actionBtn]);
const fine = el("p", { class: "fineprint", text: "Demo data is fictional. What you say or type is processed by Gemini and shared with other visitors of this demo, so please don't enter real health details." });

const traceList = el("div", { class: "trace-list", attrs: { "aria-live": "polite", "aria-relevant": "additions" } });
const traceEmpty = el("div", { class: "trace-empty", text: "No messages yet. Say something and every MCP message the assistant sends shows up here." });
const budgetPill = el("span", { class: "pill", text: "no tool calls yet" });
const statCalls = el("b", { text: "0" });
const statAvg = el("b", { text: "–" });
const onlyAssistant = el("input", { class: "switch", attrs: { type: "checkbox", "aria-label": "Show only the assistant's calls" } });
const trace = el("section", { class: "glass trace", attrs: { id: "trace", "aria-label": "Behind the scenes" } });
const traceBtn = el("button", { class: "ghost", attrs: { type: "button", "aria-expanded": "true", "aria-controls": "trace", "aria-label": "Behind the scenes: show or hide the real MCP messages" } }, [icon("code"), el("span", { class: "t", text: "Behind the scenes" })]);
const toolServerMs: number[] = [];
const newConvoBtn = el("button", { class: "ghost", attrs: { type: "button", "aria-label": "New conversation: the assistant forgets, the service remembers" } }, [icon("compose"), el("span", { class: "t", text: "New conversation" })]);
const gearBtn = el("button", { class: "ghost", attrs: { type: "button", "aria-expanded": "false", "aria-haspopup": "true", "aria-label": "Demo settings" } }, [icon("gear"), el("span", { class: "t", text: "Settings" })]);
const popover = el("div", { class: "glass popover", attrs: { hidden: "", role: "dialog", "aria-label": "Demo settings" } });
const advanceBtns = [1, 3, 6].map((d) => {
  const b = el("button", { class: "ghost", text: `+${d}`, attrs: { type: "button", "aria-label": `Advance the demo clock ${d} day${d > 1 ? "s" : ""}` } });
  b.addEventListener("click", () => void advance(d));
  return b;
});

// ── layout ─────────────────────────────────────────────────────────────────
function buildPage(): void {
  trace.append(
    el("div", { class: "trace-head" }, [
      el("div", {}, [
        el("h2", {}, [icon("code"), document.createTextNode("Behind the scenes")]),
        el("p", { text: "Real MCP over Streamable HTTP. Open a row to see the JSON." }),
      ]),
      (() => {
        const hide = el("button", { class: "ghost icon-only", attrs: { type: "button", "aria-label": "Hide behind the scenes" } }, [icon("close")]);
        hide.addEventListener("click", () => toggleTrace(false));
        return hide;
      })(),
    ]),
    el("div", { class: "trace-stats" }, [
      el("div", { class: "stat" }, [statCalls, el("small", { text: "tool calls" })]),
      el("div", { class: "stat" }, [statAvg, el("small", { text: "avg server time" })]),
      el("div", { class: "stat budget", attrs: { title: "Server time of the last tool call vs the 500 ms target in Amazon's published add-on guidance" } }, [budgetPill, el("small", { text: "500 ms target" })]),
    ]),
    el("label", { class: "trace-filter" }, [el("span", { text: "Assistant calls only" }), onlyAssistant]),
    traceEmpty,
    traceList,
  );
  onlyAssistant.addEventListener("change", () => traceList.classList.toggle("only-assistant", onlyAssistant.checked));

  const app = document.getElementById("app");
  if (!app) return;
  app.replaceChildren(
    el("div", { class: "app" }, [
      el("header", { class: "topbar" }, [
        el("div", { class: "brand" }, [
          el("strong", {}, [el("i"), document.createTextNode("Daizee")]),
          el("small", { text: "Simulated voice assistant · not Alexa, not affiliated with Amazon, not certified" }),
        ]),
        el("div", { class: "glass bar-group", attrs: { role: "group", "aria-label": "Move the demo clock forward" } }, [dayLabel, ...advanceBtns]),
        newConvoBtn,
        traceBtn,
        el("div", { class: "popwrap" }, [gearBtn, popover]),
      ]),
      el("main", { class: "stage" }, [
        side.root,
        el("section", { class: "glass chat", attrs: { "aria-label": "Assistant" } }, [
          el("div", { class: "chat-head" }, [modePill, historyPill]),
          transcript,
          chipRow,
          composer,
          fine,
        ]),
        trace,
      ]),
    ]),
  );
  transcript.appendChild(hero);
}

// ── conversation helpers ───────────────────────────────────────────────────
function scroll(): void {
  requestAnimationFrame(() => {
    transcript.scrollTop = transcript.scrollHeight;
  });
}
function hideHero(): void {
  hero.remove();
}
function addMsg(role: "user" | "assistant" | "error", text: string): void {
  transcript.appendChild(el("div", { class: `msg ${role}`, text }));
  scroll();
}
function addNote(text: string, divider = false): void {
  transcript.appendChild(el("div", { class: divider ? "note divider" : "note" }, [divider ? el("span", { text }) : document.createTextNode(text)]));
  scroll();
}
function showTyping(): HTMLElement {
  const t = el("div", { class: "typing", attrs: { role: "status" } }, [el("i"), el("i"), el("i"), el("span", { class: "sr-only", text: "The assistant is working" })]);
  transcript.appendChild(t);
  scroll();
  return t;
}
function addToolPill(name: string, args: Record<string, unknown>): { done(): void } {
  const text = Object.keys(args).length ? `${name} ${JSON.stringify(args)}` : name;
  const pill = el("div", { class: "toolpill", attrs: { title: text, "aria-hidden": "true" } }, [el("span", { class: "dot" }), el("span", { text: text.length > 70 ? `${text.slice(0, 67)}…` : text })]);
  transcript.appendChild(pill);
  scroll();
  return { done: () => pill.classList.add("done") };
}
function addCards(cards: HTMLElement[]): void {
  if (!cards.length) return;
  transcript.appendChild(el("div", { class: "inline-cards" }, cards));
  scroll();
}
function updatePills(): void {
  historyPill.replaceChildren(document.createTextNode("Assistant history · "), el("b", { text: `${history.length} message${history.length === 1 ? "" : "s"}` }));
  modePill.className = `pill ${mode}`;
  modePill.textContent =
    mode === "live" ? `Live · ${brainModel ?? "Gemini"} · ${fastReplies ? "fast replies" : "natural replies"}` : "Replay · scripted decisions, real MCP calls";
}

// ── action button (mic / send / stop / wait) ───────────────────────────────
function setAction(next: ActionMode): void {
  actionBtn.dataset.mode = next;
  actionBtn.setAttribute(
    "aria-label",
    next === "send" ? "Send" : next === "stop" ? "Stop recording" : next === "wait" ? "Working" : "Speak",
  );
}
function syncAction(): void {
  if (recording) return setAction("stop");
  if (busy) return setAction("wait");
  setAction(input.value.trim() ? "send" : "mic");
  const micOk = canRecord() && brainConfigured;
  actionBtn.disabled = !input.value.trim() && !micOk;
  actionBtn.title = actionBtn.disabled
    ? !brainConfigured
      ? "Voice needs the live brain (a Gemini key on the server). Please type."
      : "Microphone recording needs a secure page (https or localhost) and a supported browser. Please type."
    : "";
}
function setBusy(value: boolean): void {
  busy = value;
  composer.classList.toggle("busy", value);
  input.disabled = value;
  newConvoBtn.disabled = value;
  advanceBtns.forEach((b) => (b.disabled = value));
  chipRow.querySelectorAll("button").forEach((b) => (b.disabled = value));
  popover.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input").forEach((c) => (c.disabled = value));
  syncAction();
}

// ── trace drawer ───────────────────────────────────────────────────────────
function addTrace(entry: TraceEntry): void {
  const stream = entry.httpMethod === "GET";
  const ok = entry.status >= 200 && entry.status < 300;
  const kind = stream ? "stream" : entry.method === "tools/call" ? "call" : entry.method === "tools/list" ? "list" : "init";
  const background = stream || Boolean(entry.tag);
  const item = el("details", { class: `trace-item k-${kind}${background ? " background" : ""}` }, [
    el("summary", {}, [
      el("span", { class: "t-method", text: stream ? "GET /mcp" : entry.method }),
      el("span", { class: "t-name", text: stream ? "no stream (stateless)" : entry.tool ?? "" }),
      // The 405 on GET is expected (a stateless server offers no stream), so it is not shown as an error.
      el("span", { class: `t-status ${ok ? "ok" : stream ? "muted" : "bad-text"}`, attrs: { title: stream ? `HTTP ${entry.status}: expected, no stream to open` : `HTTP ${entry.status}` } }, [el("i"), document.createTextNode(String(entry.status))]),
      el("span", { class: "t-ms", text: `${entry.roundTripMs.toFixed(0)} ms` }),
      el("span", { class: "t-meta" }, [
        el("span", { text: `#${entry.id}` }),
        entry.serverMs !== null ? el("span", { text: `server ${entry.serverMs.toFixed(1)} ms` }) : null,
        entry.tag ? el("span", { class: "tag", text: entry.tag === "panel" ? "page refresh" : entry.tag }) : null,
      ]),
    ]),
    el("pre", {}, [el("b", { text: "Request" }), document.createTextNode(JSON.stringify(entry.request, null, 2) ?? "(none)")]),
    el("pre", {}, [el("b", { text: "Response" }), document.createTextNode(JSON.stringify(entry.response, null, 2) ?? "(none)")]),
  ]);
  traceList.prepend(item);
  traceEmpty.hidden = true;

  if (entry.method === "tools/call" && entry.serverMs !== null) {
    toolServerMs.push(entry.serverMs);
    statCalls.textContent = String(toolServerMs.length);
    statAvg.textContent = `${(toolServerMs.reduce((a, b) => a + b, 0) / toolServerMs.length).toFixed(1)} ms`;
    const good = entry.serverMs < BUDGET_MS;
    budgetPill.textContent = `${entry.serverMs.toFixed(1)} ms ${good ? "✓" : "· over"}`;
    budgetPill.title = `Last tool call: ${entry.serverMs.toFixed(1)} ms of server time, ${good ? "within" : "over"} the 500 ms target`;
    budgetPill.className = `pill ${good ? "good" : "bad"}`;
  }
}
const TRACE_PREF = "daizee.trace.hidden";
function toggleTrace(show: boolean, focus = true): void {
  document.body.classList.toggle("trace-hidden", !show);
  traceBtn.setAttribute("aria-expanded", String(show));
  try {
    localStorage.setItem(TRACE_PREF, show ? "0" : "1");
  } catch {
    /* storage blocked: the choice just isn't remembered */
  }
  if (!focus) return;
  if (show) {
    trace.scrollIntoView({ behavior: "smooth", block: "nearest" });
    (trace.querySelector("button") as HTMLElement | null)?.focus({ preventScroll: true });
  } else traceBtn.focus();
}

// ── settings popover ───────────────────────────────────────────────────────
function seg<T extends string>(options: Array<{ value: T; label: string; disabled?: boolean }>, current: T, onPick: (v: T) => void): HTMLElement {
  const wrap = el("div", { class: "seg", attrs: { role: "group" } });
  for (const o of options) {
    const b = el("button", { text: o.label, attrs: { type: "button", "aria-pressed": String(o.value === current), ...(o.disabled ? { disabled: "" } : {}) } });
    b.addEventListener("click", () => {
      onPick(o.value);
      wrap.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
    });
    wrap.appendChild(b);
  }
  return wrap;
}
function buildPopover(): void {
  const speakSwitch = el("input", { class: "switch", attrs: { type: "checkbox", role: "switch", "aria-label": "Speak replies aloud" } });
  speakSwitch.checked = speakReplies;
  speakSwitch.addEventListener("change", () => {
    speakReplies = speakSwitch.checked;
    if (!speakReplies) stopSpeaking();
  });
  const convoSwitch = el("input", { class: "switch", attrs: { type: "checkbox", role: "switch", "aria-label": "Conversation mode: after a spoken reply, listen for your answer" } });
  convoSwitch.checked = conversationMode;
  convoSwitch.addEventListener("change", () => {
    conversationMode = convoSwitch.checked;
    addNote(conversationMode ? "Conversation mode on: after Daizee answers out loud, the mic opens for your reply." : "Conversation mode off: tap the mic for each turn.");
  });
  const resetBtn = el("button", { class: "ghost", attrs: { type: "button" } }, [icon("reset"), el("span", { text: "Reset demo data" })]);
  resetBtn.addEventListener("click", () => {
    closePopover();
    void resetDemo();
  });
  popover.replaceChildren(
    el("div", { class: "row" }, [el("span", { text: "Demo user" }), seg(users.map((u) => ({ value: u.id, label: u.name })), userId, (v) => void switchUser(v))]),
    el("div", { class: "row" }, [
      el("span", { text: "Assistant" }),
      seg<Mode>(
        [
          { value: "live", label: "Live", disabled: !brainConfigured },
          { value: "replay", label: "Replay" },
        ],
        mode,
        (v) => {
          mode = v;
          addNote(v === "live" ? "Switched to the live Gemini brain." : "Switched to replay: scripted decisions, real MCP calls.");
          updatePills();
        },
      ),
    ]),
    el("div", { class: "row" }, [
      el("span", { text: "Live replies" }),
      seg<"fast" | "natural">(
        [
          { value: "fast", label: "Fast" },
          { value: "natural", label: "Natural" },
        ],
        fastReplies ? "fast" : "natural",
        (v) => {
          fastReplies = v === "fast";
          addNote(fastReplies ? "Fast replies: one model call per turn when one tool runs, so answers arrive about twice as fast." : "Natural replies: a second model call rewrites each answer, which reads nicer but takes longer.");
          updatePills();
        },
      ),
    ]),
    el("label", { class: "row" }, [el("span", { text: "Speak replies" }), speakSwitch]),
    el("label", { class: "row" }, [el("span", { text: "Conversation mode" }), convoSwitch]),
    el("div", { class: "pop-actions" }, [resetBtn]),
  );
  if (busy) popover.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input").forEach((c) => (c.disabled = true));
}
function closePopover(returnFocus = false): void {
  popover.hidden = true;
  gearBtn.setAttribute("aria-expanded", "false");
  if (returnFocus) gearBtn.focus();
}

// ── side cards (real MCP calls, tagged "panel" in the trace) ───────────────
async function refreshPanels(): Promise<void> {
  if (!session) return;
  session.tag = "panel";
  try {
    const mem = await session.call("recall_what_you_know", {});
    const day = await session.call("get_day_progress", {});
    if (mem.structured) side.setMemories(mem.structured.memories as MemoryView[]);
    if (day.structured) applyDay(day.structured);
  } catch {
    /* the cards simply keep what they had */
  } finally {
    session.tag = undefined;
  }
}
function applyDay(out: Record<string, unknown>): void {
  side.setDay({
    eaten: out.eaten as Macros,
    targets: out.targets as Macros,
    mealsLogged: out.mealsLogged as number,
    checkIns: (out.checkIns as Array<{ question: string }>) ?? [],
  });
}

// ── connection ─────────────────────────────────────────────────────────────
async function connect(): Promise<void> {
  await session?.close();
  session = null;
  const next = new McpSession(userId, addTrace);
  await next.connect(); // if this throws, there is no half-connected session left behind
  session = next;
}
function failNote(what: string, err: unknown): void {
  addNote(`Couldn't ${what}: ${err instanceof Error ? err.message : String(err)}`);
}
async function refreshClock(): Promise<void> {
  const c = await getJson<{ advancedDays: number }>("/demo/clock");
  dayLabel.textContent = `Demo day +${c.advancedDays}`;
}
function orchestrator(): Orchestrator {
  return mode === "live" ? new GeminiOrchestrator(`Gemini ${brainModel ?? ""}`) : new ReplayOrchestrator();
}

// ── the assistant loop ─────────────────────────────────────────────────────
/** Keep the assistant's history under the server's 40-message limit by dropping the oldest WHOLE turns. */
const HISTORY_KEEP = 24;
function trimHistory(): void {
  while (history.length > HISTORY_KEEP) {
    const next = history.findIndex((m, i) => i > 0 && m.role === "user");
    if (next === -1) break; // one long turn: nothing safe to drop
    history = history.slice(next);
  }
}

/** Shows nothing new: reads the reply aloud (when on) and marks the turn as answered. */
function sayAloud(reply: string): void {
  lastTurnReplied = true;
  if (speakReplies) lastSpeech = speak(reply);
}
async function runTurn(text: string): Promise<void> {
  if (busy) return;
  if (!session) {
    addNote("Not connected to the Daizee service yet. Press New conversation to reconnect.");
    return;
  }
  hideHero();
  stopSpeaking();
  lastSpeech = null;
  lastTurnReplied = false;
  addMsg("user", text);
  trimHistory();
  const turnStart = history.length; // a failed turn is rolled back to here
  history.push({ role: "user", text });
  updatePills();
  setBusy(true);

  let typing: HTMLElement | null = showTyping();
  let wrote = false;
  try {
    const brain = orchestrator();
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const step = await brain.step({ messages: history, tools: session.tools });

      if (step.type === "calls") {
        typing?.remove();
        typing = null;
        history.push({ role: "assistant", calls: step.calls, raw: step.raw });
        const results: Array<{ id?: string; name: string; output: unknown }> = [];
        for (const call of step.calls) {
          const pill = addToolPill(call.name, call.args);
          const out = await session.call(call.name, call.args);
          pill.done();
          const output = out.isError ? { isError: true, message: out.text } : (out.structured ?? { text: out.text });
          results.push({ id: call.id, name: call.name, output });
          if (out.isError) addMsg("error", out.text);
          else {
            addCards(cardsFor(call.name, out.structured));
            if (WRITE_TOOLS.has(call.name)) wrote = true;
            // Read tools already hold fresh data: update the side cards from them directly.
            if (call.name === "recall_what_you_know" && out.structured) side.setMemories(out.structured.memories as MemoryView[]);
            if (call.name === "get_day_progress" && out.structured) applyDay(out.structured);
          }
        }
        history.push({ role: "tool", results });
        updatePills();
        if (mode === "live" && fastReplies && canReplyFast(results, text)) {
          // The tool already wrote a short sentence: skip the second model call.
          const reply = replyFromResults(results);
          history.push({ role: "assistant", text: reply });
          addMsg("assistant", reply);
          sayAloud(reply);
          updatePills();
          return;
        }
        typing = showTyping();
        continue;
      }

      typing?.remove();
      typing = null;
      const reply = step.text || "Done.";
      history.push({ role: "assistant", text: reply, raw: step.raw });
      addMsg("assistant", reply);
      sayAloud(reply);
      return;
    }
    typing?.remove();
    typing = null;
    addMsg("error", "The assistant used too many steps and stopped. Please try again.");
  } catch (err) {
    typing?.remove();
    typing = null;
    history.length = turnStart; // drop the half-finished turn so the next one starts from a valid history
    const message = err instanceof Error ? err.message : String(err);
    addMsg("error", mode === "live" ? `${message} You can switch the assistant to Replay in Settings.` : message);
  } finally {
    typing?.remove();
    if (wrote) await refreshPanels(); // still inside the busy lock, so calls never overlap
    setBusy(false);
    updatePills();
    input.focus();
  }
}

// ── controls ───────────────────────────────────────────────────────────────
async function advance(days: number): Promise<void> {
  if (busy) return;
  setBusy(true);
  try {
    await postJson("/demo/advance-clock", { days });
    addNote(`Demo clock moved forward ${days} day${days > 1 ? "s" : ""}. Notes age accordingly.`);
    await refreshClock();
    await refreshPanels();
  } catch (err) {
    failNote("move the demo clock", err);
  } finally {
    setBusy(false);
  }
}
async function newConversation(): Promise<void> {
  if (busy) return;
  setBusy(true);
  try {
    history = [];
    await connect(); // a brand-new MCP connection: watch a fresh initialize in the trace
    addNote("New conversation. The assistant now remembers nothing, but the Daizee service still does.", true);
    updatePills();
    await refreshPanels();
  } catch (err) {
    failNote("start a new conversation", err);
  } finally {
    setBusy(false);
  }
}
async function resetDemo(): Promise<void> {
  setBusy(true);
  try {
    await postJson("/demo/reset");
    history = [];
    transcript.replaceChildren(hero);
    traceList.replaceChildren();
    budgetPill.textContent = "no calls yet";
    budgetPill.className = "pill";
    await connect();
    await refreshClock();
    await refreshPanels();
    updatePills();
  } catch (err) {
    failNote("reset the demo", err);
  } finally {
    setBusy(false);
  }
}
async function switchUser(next: string): Promise<void> {
  if (busy || next === userId) return;
  setBusy(true);
  try {
    userId = next;
    history = [];
    await connect();
    addNote(`Switched to ${users.find((u) => u.id === next)?.name ?? next}. New connection, empty assistant history.`, true);
    updatePills();
    await refreshPanels();
  } catch (err) {
    failNote("switch user", err);
  } finally {
    setBusy(false);
  }
}

// ── voice ──────────────────────────────────────────────────────────────────
const BARS = 28;
const levels: number[] = new Array(BARS).fill(0);
function paintLevels(): void {
  const bars = level.children;
  for (let i = 0; i < BARS; i++) (bars[i] as HTMLElement).style.height = `${4 + Math.min(1, levels[i] ?? 0) * 24}px`;
}
function onLevel(value: number): void {
  levels.push(Math.sqrt(value) * 2.2);
  levels.shift();
  paintLevels();
}
function micMessage(err: unknown): string {
  if (err instanceof RecorderError) {
    switch (err.code) {
      case "permission-denied":
        return "Microphone access was blocked. Allow it in the address bar, or type instead.";
      case "no-microphone":
        return "No microphone was found. Please type instead.";
      case "too-short":
        return "That was too short. Tap the mic and try again.";
      case "unsupported":
        return "This browser can't record audio here. Please type instead.";
      default:
        return err.message || "Recording failed. Please try again or type.";
    }
  }
  return err instanceof Error ? err.message : "Voice input failed.";
}
/** Hands-free timings: end a turn after this much quiet, give up if nobody talks. */
const END_OF_SPEECH_MS = 1_000;
const NO_SPEECH_MS = 8_000;
const FOLLOW_UP_NO_SPEECH_MS = 6_000;

/**
 * One spoken turn: listen (it stops by itself when you stop talking), transcribe,
 * answer. With conversation mode on, a spoken reply is followed by listening
 * again, so you can just answer ("yes, forget it"). Saying "that's all" or
 * "stop", staying quiet, pressing Escape or typing ends it.
 */
async function toggleMic(followUp = false): Promise<void> {
  if (recording) {
    recording.stop();
    return;
  }
  if (isSpeaking()) stopSpeaking(); // talking over the reply interrupts it
  if (busy || !session) return;
  setBusy(true); // nothing else may run while the mic is open or the audio is being transcribed
  setAction("wait");
  let rec: Recording;
  try {
    rec = await startRecording({ maxMs: 12_000, onLevel, endOnSilenceMs: END_OF_SPEECH_MS, noSpeechMs: followUp ? FOLLOW_UP_NO_SPEECH_MS : NO_SPEECH_MS });
  } catch (err) {
    addNote(micMessage(err));
    setBusy(false);
    return;
  }
  recording = rec;
  listenLabel.textContent = followUp ? "Listening for your reply…" : "Listening… just talk";
  composer.classList.add("recording");
  syncAction();
  let text = "";
  let failed = false;
  try {
    const wav = await rec.done;
    recording = null;
    composer.classList.remove("recording");
    levels.fill(0);
    paintLevels();
    syncAction();
    addNote("Transcribing…");
    text = await transcribe(wav);
  } catch (err) {
    failed = true;
    recording = null;
    composer.classList.remove("recording");
    levels.fill(0);
    paintLevels();
    const quietEnd = err instanceof RecorderError && (err.code === "no-speech" || err.code === "too-short" || err.message === "Recording cancelled.");
    if (followUp && quietEnd) addNote("Stopped listening. Tap the mic to talk again.");
    else if (err instanceof RecorderError && err.code === "no-speech") addNote("I didn't hear anything. Tap the mic and talk, or type.");
    else if (!(err instanceof RecorderError && err.message === "Recording cancelled.")) addNote(micMessage(err));
  }
  setBusy(false);
  if (!text) {
    if (!failed) addNote("I didn't catch that. Try again, or type.");
    return;
  }
  if (isGoodbye(text)) {
    addMsg("user", text);
    addNote("Okay. Tap the mic whenever you want to talk again.");
    return;
  }
  await runTurn(text);
  if (!(conversationMode && speakReplies && lastTurnReplied)) return;
  await lastSpeech;
  await new Promise((r) => setTimeout(r, 250)); // let the speaker fall silent before the mic opens
  if (conversationMode && !busy && !recording && !isSpeaking() && !input.value.trim()) void toggleMic(true);
}

// ── chips ──────────────────────────────────────────────────────────────────
function buildChips(): void {
  chipRow.replaceChildren();
  const primary = PRIMARY_CHIPS.map((id) => SCENES.find((s) => s.id === id)).filter((s): s is (typeof SCENES)[number] => Boolean(s));
  const rest = SCENES.filter((s) => !PRIMARY_CHIPS.includes(s.id));
  const make = (say: string, extra = ""): HTMLButtonElement => {
    const b = el("button", { class: `chip-btn${extra}`, text: say, attrs: { type: "button" } });
    b.addEventListener("click", () => void runTurn(say));
    return b;
  };
  for (const s of primary) chipRow.appendChild(make(s.say));
  const more = el("button", { class: "chip-btn more", text: "More ideas", attrs: { type: "button", "aria-expanded": "false" } });
  more.addEventListener("click", () => {
    more.remove();
    for (const s of rest) chipRow.appendChild(make(s.say));
  });
  chipRow.appendChild(more);
}

// ── start ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  buildPage();
  buildChips();
  updatePills();
  setBusy(true); // nothing is usable until the MCP session exists
  input.placeholder = "Connecting…";

  // events that do not depend on the server
  input.addEventListener("input", syncAction);
  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text && !busy) {
      input.value = "";
      syncAction();
      void runTurn(text);
    }
  });
  actionBtn.addEventListener("click", () => {
    const m = actionBtn.dataset.mode;
    if (m === "send") composer.requestSubmit();
    else if (m === "mic" || m === "stop") void toggleMic(false);
  });
  newConvoBtn.addEventListener("click", () => void newConversation());
  traceBtn.addEventListener("click", () => toggleTrace(document.body.classList.contains("trace-hidden")));
  let traceHidden = false;
  try {
    traceHidden = localStorage.getItem(TRACE_PREF) === "1";
  } catch {
    /* storage blocked: shown by default */
  }
  toggleTrace(!traceHidden, false);
  gearBtn.addEventListener("click", () => {
    const open = popover.hidden;
    popover.hidden = !open;
    gearBtn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    if (!popover.hidden && !(e.target as HTMLElement).closest(".popwrap")) closePopover();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!popover.hidden) closePopover(true);
    else if (recording) recording.cancel(); // ends hands-free listening without sending anything
    else if (isSpeaking()) stopSpeaking();
  });

  try {
    const [u, brain] = await Promise.all([
      getJson<{ users: Array<{ id: string; name: string }> }>("/demo/users"),
      getJson<{ configured: boolean; model: string | null }>("/brain/status").catch(() => ({ configured: false, model: null })),
    ]);
    users = u.users;
    // Connected to the real app the users are the allowlisted ones (for example "demo"), not maya.
    if (users.length && !users.some((x) => x.id === userId)) userId = users[0]?.id ?? userId;
    brainModel = brain.model;
    brainConfigured = brain.configured;
    mode = brain.configured ? "live" : "replay";
    buildPopover();
    await connect();
    await refreshClock();
    await refreshPanels();
    if (canRecord() && brainConfigured) {
      const p = hero.querySelector("p");
      if (p) p.textContent = "A simulated voice assistant calling a real memory service. Try a phrase below, or speak.";
    }
    addNote(
      mode === "live"
        ? "Live mode: Gemini decides which tools to call. Tap a suggestion or say anything."
        : "Replay mode: the assistant's decisions are scripted, but every call to the Daizee service is real.",
    );
  } catch (err) {
    addMsg("error", `Could not reach the Daizee MCP server. Start it with "npm run demo". (${err instanceof Error ? err.message : err})`);
  }
  input.placeholder = "Ask or tell the assistant something…";
  setBusy(false);
  updatePills();
  // build the level meter bars once
  for (let i = 0; i < BARS; i++) level.appendChild(el("i"));
}

void main();
