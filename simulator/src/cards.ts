import { el, growBars, svg } from "./dom.js";

/**
 * Cards drawn from a tool's structuredContent. Mirrors how Alexa+ is documented
 * to render: from data, with no screen-specific wording needed. The same
 * building blocks (dayCard, memoryRow) are reused by the persistent side cards.
 */

export type Macros = { calories: number; protein: number; carbs: number; fat: number };
export type MemoryView = { id: string; text: string; category: string; ageDays: number; expiresInDays: number };
type Flag = { memoryText: string; reason: string };
type CheckIn = { question: string };

const RING_R = 34;
const RING_C = 2 * Math.PI * RING_R;

function ring(eaten: number, target: number): SVGElement {
  const frac = target > 0 ? Math.min(1, Math.max(0, eaten / target)) : 0;
  const root = svg("svg", { viewBox: "0 0 80 80", class: "ring", role: "img", "aria-label": `${Math.round(eaten)} of ${Math.round(target)} calories` });
  root.appendChild(svg("circle", { cx: "40", cy: "40", r: String(RING_R), class: "ring-bg" }));
  const fg = svg("circle", {
    cx: "40",
    cy: "40",
    r: String(RING_R),
    class: eaten > target ? "ring-fg over" : "ring-fg",
    "stroke-dasharray": `0 ${RING_C.toFixed(1)}`,
  });
  root.appendChild(fg);
  // Start empty, then fill: the transition makes the ring draw itself.
  requestAnimationFrame(() => requestAnimationFrame(() => fg.setAttribute("stroke-dasharray", `${(RING_C * frac).toFixed(1)} ${RING_C.toFixed(1)}`)));
  return root;
}

function macroRow(label: string, eaten: number, target: number): HTMLElement {
  const pct = target > 0 ? Math.min(100, Math.round((eaten / target) * 100)) : 0;
  const fill = el("span", { class: "bar-fill", attrs: { "data-w": String(pct) } });
  return el("div", { class: "macro" }, [
    el("span", { text: label }),
    el("span", { class: "bar" }, [fill]),
    el("b", { text: `${Math.round(eaten)}/${Math.round(target)} g` }),
  ]);
}

export function dayCard(eaten: Macros, target: Macros): HTMLElement {
  const left = Math.round(target.calories - eaten.calories);
  const card = el("div", { class: "day" }, [
    el("div", { class: "ring-wrap" }, [
      ring(eaten.calories, target.calories),
      el("div", { class: "ring-center" }, [
        el("strong", { text: String(Math.abs(left)) }),
        el("small", { text: left >= 0 ? "kcal left" : "kcal over" }),
      ]),
    ]),
    el("div", { class: "macros" }, [
      macroRow("Protein", eaten.protein, target.protein),
      macroRow("Carbs", eaten.carbs, target.carbs),
      macroRow("Fat", eaten.fat, target.fat),
    ]),
  ]);
  growBars(card);
  return card;
}

export function lifeLeft(m: MemoryView): string {
  if (m.expiresInDays >= 300) return "about a year left";
  if (m.expiresInDays <= 0) return "ends today";
  return `${m.expiresInDays} day${m.expiresInDays === 1 ? "" : "s"} left`;
}

export function memoryRow(m: MemoryView): HTMLElement {
  const total = m.ageDays + m.expiresInDays;
  const remaining = total > 0 ? Math.max(0, Math.min(1, m.expiresInDays / total)) : 1;
  const allergy = m.category === "allergy";
  const fill = el("span", { class: `bar-fill${allergy ? " allergy" : ""}`, attrs: { "data-w": String(Math.round(remaining * 100)) } });
  return el("div", { class: `mem${allergy ? " allergy" : ""}` }, [
    el("div", { class: "mem-top" }, [
      el("span", { class: "mem-text", text: m.text }),
      el("span", { class: "mem-cat", text: m.category.replace(/_/g, " ") }),
    ]),
    el("span", { class: "bar" }, [fill]),
    el("small", { text: lifeLeft(m) }),
  ]);
}

function banner(kind: "warn" | "info", title: string, body?: string): HTMLElement {
  return el("div", { class: `banner ${kind}`, attrs: { role: "status" } }, [el("strong", { text: title }), body ? el("span", { text: body }) : null]);
}

/** Inline cards for one tool result (shown in the conversation). */
export function cardsFor(tool: string, out: Record<string, unknown> | undefined): HTMLElement[] {
  if (!out) return [];
  const cards: HTMLElement[] = [];

  if (tool === "get_day_progress") {
    for (const c of (out.checkIns as CheckIn[]) ?? []) cards.push(banner("info", "Check-in", c.question));
  }

  if (tool === "get_today_plan" && out.hasPlan) {
    const focus = out.focus as { title: string } | null;
    const plan = out.plan as { eat: string; move: string; recover: string } | null;
    const steps = plan ? [`Eat: ${plan.eat}`, `Move: ${plan.move}`, `Recover: ${plan.recover}`].join("  ·  ") : String(out.summary ?? "");
    cards.push(banner("info", focus ? `Today's focus: ${focus.title}` : "Today's plan", steps));
  }

  if (tool === "log_meal") {
    for (const f of (out.safetyFlags as Flag[]) ?? []) {
      cards.push(banner("warn", `Heads up: ${f.reason}`, `Your note says "${f.memoryText}". This is only a reminder, not medical advice.`));
    }
    const est = (out.estimatedItems as string[]) ?? [];
    if (est.length) cards.push(banner("info", "Estimated numbers", `Rough guess for: ${est.join(", ")}`));
  }

  if (tool === "remember_about_user" && out.mealCheck === "not_covered") {
    cards.push(banner("warn", "Saved, but not checked automatically", "I can't match meals against this note, so please watch for it yourself."));
  }

  if (tool === "resolve_memory" && out.outcome === "resolved") {
    cards.push(banner("info", "Note released", "It will disappear after a day."));
  }

  if (tool === "log_weight") {
    const kg = out.kg as number;
    const prev = out.previousKg as number | null;
    const delta = out.deltaKg as number | null;
    // The number is shown on the screen and never spoken aloud.
    cards.push(
      el("div", { class: "weight" }, [
        el("strong", { text: `${kg} kg` }),
        el("small", { text: prev === null ? "first weigh-in" : `previous ${prev} kg (${delta !== null && delta > 0 ? "+" : ""}${delta} kg)` }),
      ]),
    );
  }
  return cards;
}
