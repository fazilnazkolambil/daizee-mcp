import { el, svg } from "./dom.js";

/**
 * Cards drawn from a tool's structuredContent. This mirrors how Alexa+ is
 * documented to render: from data, with no screen-specific wording needed.
 */

type Macros = { calories: number; protein: number; carbs: number; fat: number };
type MemoryView = { id: string; text: string; category: string; ageDays: number; expiresInDays: number };
type Flag = { memoryText: string; reason: string };
type CheckIn = { question: string };

function ring(eaten: number, target: number): SVGElement {
  const r = 34;
  const c = 2 * Math.PI * r;
  const frac = target > 0 ? Math.min(1, Math.max(0, eaten / target)) : 0;
  const root = svg("svg", { viewBox: "0 0 80 80", class: "ring", role: "img", "aria-label": `${eaten} of ${target} calories` });
  root.appendChild(svg("circle", { cx: "40", cy: "40", r: String(r), class: "ring-bg" }));
  root.appendChild(
    svg("circle", {
      cx: "40",
      cy: "40",
      r: String(r),
      class: eaten > target ? "ring-fg over" : "ring-fg",
      "stroke-dasharray": `${(c * frac).toFixed(1)} ${c.toFixed(1)}`,
      transform: "rotate(-90 40 40)",
    }),
  );
  return root;
}

function macroBar(label: string, eaten: number, target: number): HTMLElement {
  const frac = target > 0 ? Math.min(100, Math.round((eaten / target) * 100)) : 0;
  const fill = el("span", { class: "bar-fill" });
  fill.style.width = `${frac}%`;
  return el("div", { class: "macro" }, [
    el("span", { class: "macro-label", text: label }),
    el("span", { class: "bar" }, [fill]),
    el("span", { class: "macro-num", text: `${Math.round(eaten)}/${Math.round(target)} g` }),
  ]);
}

function dayCard(eaten: Macros, target: Macros): HTMLElement {
  const left = Math.round(target.calories - eaten.calories);
  return el("div", { class: "card day" }, [
    el("div", { class: "ring-wrap" }, [
      ring(eaten.calories, target.calories),
      el("div", { class: "ring-center" }, [
        el("strong", { text: String(Math.abs(left)) }),
        el("small", { text: left >= 0 ? "kcal left" : "kcal over" }),
      ]),
    ]),
    el("div", { class: "macros" }, [
      macroBar("Protein", eaten.protein, target.protein),
      macroBar("Carbs", eaten.carbs, target.carbs),
      macroBar("Fat", eaten.fat, target.fat),
    ]),
  ]);
}

function memoryChip(m: MemoryView): HTMLElement {
  const total = m.ageDays + m.expiresInDays;
  const remaining = total > 0 ? Math.max(0, Math.min(1, m.expiresInDays / total)) : 1;
  const fill = el("span", { class: `bar-fill cat-${m.category}` });
  fill.style.width = `${Math.round(remaining * 100)}%`;
  const left = m.expiresInDays >= 300 ? "about a year left" : `${m.expiresInDays} day${m.expiresInDays === 1 ? "" : "s"} left`;
  return el("div", { class: `chip cat-${m.category}` }, [
    el("div", { class: "chip-top" }, [
      el("span", { class: "chip-text", text: m.text }),
      el("span", { class: "chip-cat", text: m.category.replace("_", " ") }),
    ]),
    el("span", { class: "bar" }, [fill]),
    el("small", { text: left }),
  ]);
}

function banner(kind: "warn" | "info", title: string, body?: string): HTMLElement {
  return el("div", { class: `banner ${kind}`, attrs: { role: "status" } }, [
    el("strong", { text: title }),
    body ? el("span", { text: body }) : null,
  ]);
}

/** Cards for one tool result. Returns an empty list when there is nothing to draw. */
export function cardsFor(tool: string, out: Record<string, unknown> | undefined): HTMLElement[] {
  if (!out) return [];
  const cards: HTMLElement[] = [];

  if (tool === "get_day_progress") {
    cards.push(dayCard(out.eaten as Macros, out.targets as Macros));
    for (const c of (out.checkIns as CheckIn[]) ?? []) cards.push(banner("info", "Check-in", c.question));
  }

  if (tool === "log_meal") {
    const flags = (out.safetyFlags as Flag[]) ?? [];
    for (const f of flags) {
      cards.push(banner("warn", `Heads up: ${f.reason}`, `Your note: "${f.memoryText}". This is only a reminder, not medical advice.`));
    }
    const today = out.totalsToday as Macros;
    const rem = out.remaining as Macros;
    if (today && rem) {
      cards.push(
        dayCard(today, {
          calories: today.calories + rem.calories,
          protein: today.protein + rem.protein,
          carbs: today.carbs + rem.carbs,
          fat: today.fat + rem.fat,
        }),
      );
    }
    const est = (out.estimatedItems as string[]) ?? [];
    if (est.length) cards.push(banner("info", "Estimated numbers", `Rough guess for: ${est.join(", ")}`));
  }

  if (tool === "recall_what_you_know") {
    const memories = (out.memories as MemoryView[]) ?? [];
    if (memories.length) cards.push(el("div", { class: "card chips" }, memories.map(memoryChip)));
  }

  if (tool === "remember_about_user" && out.memory) {
    cards.push(el("div", { class: "card chips" }, [memoryChip(out.memory as MemoryView)]));
  }

  if (tool === "resolve_memory") {
    const candidates = (out.candidates as MemoryView[]) ?? [];
    if (candidates.length) cards.push(el("div", { class: "card chips" }, candidates.map(memoryChip)));
    if (out.outcome === "resolved") cards.push(banner("info", "Note released", "It will disappear after a day."));
  }

  if (tool === "log_weight") {
    const kg = out.kg as number;
    const prev = out.previousKg as number | null;
    const delta = out.deltaKg as number | null;
    // The number is shown here, on the screen, and never spoken.
    cards.push(
      el("div", { class: "card weight" }, [
        el("strong", { text: `${kg} kg` }),
        el("small", {
          text:
            prev === null
              ? "first weigh-in"
              : `previous ${prev} kg (${delta !== null && delta > 0 ? "+" : ""}${delta} kg)`,
        }),
      ]),
    );
  }

  return cards;
}
