import "./style.css";
import { cardsFor } from "./cards.js";
import { el } from "./dom.js";
import { McpSession, type TraceEntry } from "./mcpClient.js";
import { GeminiOrchestrator, type Msg, type Orchestrator } from "./orchestrator.js";
import { ReplayOrchestrator, SCENES } from "./replay.js";
import { canListen, listen, speak, stopSpeaking } from "./voice.js";

const MAX_HOPS = 5;
const BUDGET_MS = 500;

type Mode = "live" | "replay";

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
let history: Msg[] = [];
let session: McpSession | null = null;
let busy = false;
let stopListening: (() => void) | null = null;

// ── layout ─────────────────────────────────────────────────────────────────
const userSelect = el("select", { attrs: { "aria-label": "Demo user" } });
const modeSelect = el("select", { attrs: { "aria-label": "Assistant mode" } });
const clockLabel = el("span", { text: "Demo clock: today" });
const speakBox = el("input", { attrs: { type: "checkbox", id: "speak" } });
const modePill = el("span", { class: "pill", text: "" });
const historyPill = el("span", { class: "pill", text: "assistant history: 0 messages" });
const transcript = el("div", { class: "transcript", attrs: { "aria-live": "polite" } });
const suggest = el("div", { class: "suggest" });
const input = el("input", { attrs: { type: "text", placeholder: "Type what you would say…", "aria-label": "Message", autocomplete: "off" } });
const sendBtn = el("button", { class: "btn primary", text: "Send" });
const micBtn = el("button", { class: "btn mic", text: "Mic", attrs: { "aria-label": "Speak", title: "Speak (Chrome sends audio to Google)" } });
const traceList = el("div", { class: "trace-list" });
const budgetPill = el("span", { class: "pill", text: "no calls yet" });

const newConvoBtn = el("button", { class: "btn", text: "New conversation" });
const resetBtn = el("button", { class: "btn", text: "Reset demo" });
const advanceBtns = [1, 3, 6].map((d) => {
  const b = el("button", { class: "btn", text: `+${d} day${d > 1 ? "s" : ""}` });
  b.addEventListener("click", () => void advance(d));
  return b;
});

function buildPage(): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.replaceChildren(
    el("div", { class: "page" }, [
      el("header", {}, [
        el("h1", { text: "Daizee voice-assistant simulator" }),
        el("p", {
          class: "disclaimer",
          text:
            "Simulated assistant: not Alexa, not affiliated with Amazon, not certified. " +
            "It acts as a real MCP client against the Daizee MCP server. All data is fictional.",
        }),
      ]),
      el("div", { class: "controls" }, [
        el("label", {}, [document.createTextNode("Demo user"), userSelect]),
        el("label", {}, [document.createTextNode("Assistant"), modeSelect]),
        el("span", { class: "group" }, [el("span", { text: "Advance time" }), ...advanceBtns]),
        clockLabel,
        newConvoBtn,
        resetBtn,
        el("label", {}, [speakBox, document.createTextNode("Speak replies")]),
      ]),
      el("div", { class: "layout" }, [
        el("section", { class: "device", attrs: { "aria-label": "Simulated assistant" } }, [
          el("div", { class: "device-top" }, [el("span", { text: "Generic voice-assistant screen" }), modePill, historyPill]),
          transcript,
          suggest,
          el("div", { class: "composer" }, [input, micBtn, sendBtn]),
        ]),
        el("section", { class: "trace", attrs: { "aria-label": "Wire trace" } }, [
          el("h2", { text: "What goes over the wire" }),
          el("p", {
            text: "Real MCP over Streamable HTTP: initialize, tools/list, tools/call. Click a row to see the JSON.",
          }),
          el("div", { class: "budget" }, [document.createTextNode("Server time vs the 500 ms target:"), budgetPill]),
          traceList,
        ]),
      ]),
    ]),
  );
}

// ── rendering helpers ──────────────────────────────────────────────────────
function scroll(): void {
  transcript.scrollTop = transcript.scrollHeight;
}

function addBubble(role: "user" | "assistant" | "error", text: string): void {
  transcript.appendChild(el("div", { class: `bubble ${role}`, text }));
  scroll();
}

function addNote(text: string, divider = false): void {
  transcript.appendChild(el("div", { class: divider ? "note divider" : "note", text }));
  scroll();
}

function addToolCall(name: string, args: Record<string, unknown>): void {
  transcript.appendChild(el("div", { class: "toolcall", text: `→ ${name} ${JSON.stringify(args)}` }));
  scroll();
}

function addCards(cards: HTMLElement[]): void {
  if (!cards.length) return;
  transcript.appendChild(el("div", { class: "cards" }, cards));
  scroll();
}

function updateBadges(): void {
  historyPill.textContent = `assistant history: ${history.length} message${history.length === 1 ? "" : "s"}`;
  modePill.textContent = mode === "live" ? `live brain: ${brainModel ?? "Gemini"}` : "replay: scripted decisions, real MCP calls";
  modePill.className = `pill ${mode}`;
}

function setBusy(value: boolean): void {
  busy = value;
  sendBtn.disabled = value;
  input.disabled = value;
  newConvoBtn.disabled = value;
  resetBtn.disabled = value;
  advanceBtns.forEach((b) => (b.disabled = value));
  suggest.querySelectorAll("button").forEach((b) => (b.disabled = value));
}

function addTrace(entry: TraceEntry): void {
  const stream = entry.httpMethod === "GET";
  const label = stream ? "GET /mcp (no stream offered: stateless server)" : entry.method + (entry.tool ? ` · ${entry.tool}` : "");
  const statusOk = entry.status >= 200 && entry.status < 300;
  const summary = el("summary", {}, [
    el("span", { text: `#${entry.id}` }),
    el("span", { text: label }),
    el("span", { class: statusOk ? "status-ok" : "status-bad", text: String(entry.status) }),
    el("span", { text: `${entry.roundTripMs.toFixed(0)} ms round trip` }),
    entry.serverMs !== null ? el("span", { text: `server ${entry.serverMs.toFixed(1)} ms` }) : null,
  ]);
  const item = el("details", { class: `trace-item${stream ? " dim" : ""}` }, [
    summary,
    el("pre", {}, [el("b", { text: "Request" }), document.createTextNode(JSON.stringify(entry.request, null, 2) ?? "(none)")]),
    el("pre", {}, [el("b", { text: "Response" }), document.createTextNode(JSON.stringify(entry.response, null, 2) ?? "(none)")]),
  ]);
  traceList.prepend(item);

  if (entry.method === "tools/call" && entry.serverMs !== null) {
    const good = entry.serverMs < BUDGET_MS;
    budgetPill.textContent = `${entry.serverMs.toFixed(1)} ms ${good ? "(within budget)" : "(over budget)"}`;
    budgetPill.className = `pill ${good ? "good" : "bad"}`;
  }
}

// ── connection ─────────────────────────────────────────────────────────────
async function connect(): Promise<void> {
  await session?.close();
  session = new McpSession(userId, addTrace);
  await session.connect();
}

async function refreshClock(): Promise<void> {
  const c = await getJson<{ advancedDays: number }>("/demo/clock");
  clockLabel.textContent = c.advancedDays === 0 ? "Demo clock: today" : `Demo clock: +${c.advancedDays} days`;
}

function orchestrator(): Orchestrator {
  return mode === "live" ? new GeminiOrchestrator(`Gemini ${brainModel ?? ""}`) : new ReplayOrchestrator();
}

// ── the assistant loop ─────────────────────────────────────────────────────
async function runTurn(text: string): Promise<void> {
  if (!session || busy) return;
  setBusy(true);
  stopSpeaking();
  addBubble("user", text);
  history.push({ role: "user", text });
  updateBadges();

  try {
    const brain = orchestrator();
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const step = await brain.step({ messages: history, tools: session.tools });

      if (step.type === "calls") {
        history.push({ role: "assistant", calls: step.calls, raw: step.raw });
        const results: Array<{ id?: string; name: string; output: unknown }> = [];
        for (const call of step.calls) {
          addToolCall(call.name, call.args);
          const out = await session.call(call.name, call.args);
          const output = out.isError ? { isError: true, message: out.text } : (out.structured ?? { text: out.text });
          results.push({ id: call.id, name: call.name, output });
          if (out.isError) addBubble("error", out.text);
          else addCards(cardsFor(call.name, out.structured));
        }
        history.push({ role: "tool", results });
        updateBadges();
        continue;
      }

      const reply = step.text || "Done.";
      history.push({ role: "assistant", text: reply, raw: step.raw });
      addBubble("assistant", reply);
      if (speakBox.checked) speak(reply);
      updateBadges();
      return;
    }
    addBubble("error", "The assistant used too many steps and stopped. Please try again.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addBubble("error", mode === "live" ? `${message} You can switch the assistant to Replay.` : message);
  } finally {
    setBusy(false);
    updateBadges();
    input.focus();
  }
}

async function advance(days: number): Promise<void> {
  await postJson("/demo/advance-clock", { days });
  addNote(`Demo clock moved forward ${days} day${days > 1 ? "s" : ""}. Memories age accordingly.`);
  await refreshClock();
}

async function newConversation(): Promise<void> {
  setBusy(true);
  try {
    history = [];
    await connect(); // a brand-new MCP connection: watch a fresh initialize in the trace
    addNote("New conversation: the assistant now remembers nothing. The Daizee service still does.", true);
    updateBadges();
  } finally {
    setBusy(false);
  }
}

async function resetDemo(): Promise<void> {
  setBusy(true);
  try {
    await postJson("/demo/reset");
    history = [];
    transcript.replaceChildren();
    traceList.replaceChildren();
    budgetPill.textContent = "no calls yet";
    budgetPill.className = "pill";
    await connect();
    await refreshClock();
    addNote("Demo reset to its starting data.");
    updateBadges();
  } finally {
    setBusy(false);
  }
}

async function switchUser(next: string): Promise<void> {
  setBusy(true);
  try {
    userId = next;
    history = [];
    await connect();
    addNote(`Switched to demo user "${next}". New connection, empty assistant history.`, true);
    updateBadges();
  } finally {
    setBusy(false);
  }
}

function submit(): void {
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  void runTurn(text);
}

// ── start ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  buildPage();

  try {
    const [users, brain] = await Promise.all([
      getJson<{ users: Array<{ id: string; name: string }> }>("/demo/users"),
      getJson<{ configured: boolean; model: string | null }>("/brain/status").catch(() => ({ configured: false, model: null })),
    ]);
    brainModel = brain.model;
    mode = brain.configured ? "live" : "replay";

    for (const u of users.users) userSelect.appendChild(el("option", { text: `${u.name} (${u.id})`, attrs: { value: u.id } }));
    userSelect.value = userId;
    modeSelect.appendChild(el("option", { text: brain.configured ? `Live brain (${brain.model})` : "Live brain (no key set)", attrs: { value: "live", ...(brain.configured ? {} : { disabled: "true" }) } }));
    modeSelect.appendChild(el("option", { text: "Replay (scripted decisions)", attrs: { value: "replay" } }));
    modeSelect.value = mode;

    for (const scene of SCENES) {
      const b = el("button", { text: scene.say, attrs: { type: "button" } });
      b.addEventListener("click", () => void runTurn(scene.say));
      suggest.appendChild(b);
    }

    await connect();
    await refreshClock();
    addNote(
      mode === "live"
        ? "Live mode: Gemini decides which tools to call. Try the suggestions below, or say anything."
        : "Replay mode: the assistant's decisions are scripted, but every call to the Daizee service is real. Try the suggestions below.",
    );
  } catch (err) {
    addBubble("error", `Could not reach the Daizee MCP server. Start it with "npm start". (${err instanceof Error ? err.message : err})`);
  }
  updateBadges();

  userSelect.addEventListener("change", () => void switchUser(userSelect.value));
  modeSelect.addEventListener("change", () => {
    mode = modeSelect.value as Mode;
    addNote(mode === "live" ? "Switched to the live Gemini brain." : "Switched to replay: scripted decisions, real calls.");
    updateBadges();
  });
  sendBtn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  newConvoBtn.addEventListener("click", () => void newConversation());
  resetBtn.addEventListener("click", () => void resetDemo());

  if (!canListen()) {
    micBtn.disabled = true;
    micBtn.title = "Voice input needs Chrome or Edge. Please type instead.";
  }
  micBtn.addEventListener("click", () => {
    if (stopListening) {
      stopListening();
      return;
    }
    micBtn.classList.add("on");
    stopListening = listen({
      onText: (text) => {
        input.value = text;
        submit();
      },
      onError: (message) => addNote(message),
      onEnd: () => {
        stopListening = null;
        micBtn.classList.remove("on");
      },
    });
  });
}

void main();
