import { dayCard, memoryRow, type MemoryView, type Macros } from "./cards.js";
import { el, growBars } from "./dom.js";

/**
 * The two always-visible glass cards: "Today" and "What Daizee remembers".
 * They are drawn only from real tool results (recall_what_you_know and
 * get_day_progress); nothing here is invented.
 */
export class SideCards {
  readonly root: HTMLElement;
  private readonly memBody = el("div", { class: "mem-list" });
  private readonly memNote = el("small", { text: "" });
  private readonly dayBody = el("div", {});

  constructor() {
    this.root = el("aside", { class: "side", attrs: { "aria-label": "Daizee's memory and today" } }, [
      el("section", { class: "glass card" }, [el("h2", {}, [el("span", { text: "Today" })]), this.dayBody]),
      el("section", { class: "glass card" }, [el("h2", {}, [el("span", { text: "What Daizee remembers" }), this.memNote]), this.memBody]),
    ]);
    this.setMemories(null);
    this.setDay(null);
  }

  setMemories(memories: MemoryView[] | null): void {
    this.memBody.replaceChildren();
    if (memories === null) {
      this.memBody.appendChild(el("div", { class: "empty", text: "Connecting…" }));
      this.memNote.textContent = "";
      return;
    }
    if (memories.length === 0) {
      this.memBody.appendChild(el("div", { class: "empty", text: "Nothing yet. Tell the assistant something about yourself." }));
      this.memNote.textContent = "";
      return;
    }
    for (const m of memories) this.memBody.appendChild(memoryRow(m));
    this.memNote.textContent = memories.length >= 10 ? "top 10" : "";
    growBars(this.memBody);
  }

  setDay(day: { eaten: Macros; targets: Macros; mealsLogged: number; checkIns?: Array<{ question: string }> } | null): void {
    this.dayBody.replaceChildren();
    if (!day) {
      this.dayBody.appendChild(el("div", { class: "empty", text: "Connecting…" }));
      return;
    }
    this.dayBody.appendChild(dayCard(day.eaten, day.targets));
    this.dayBody.appendChild(
      el("small", {
        class: "empty",
        text: day.mealsLogged === 0 ? "No meals logged yet today." : `${day.mealsLogged} meal${day.mealsLogged === 1 ? "" : "s"} logged today.`,
      }),
    );
    for (const c of day.checkIns ?? []) {
      this.dayBody.appendChild(el("div", { class: "banner", attrs: { role: "status" } }, [el("strong", { text: "Check-in" }), el("span", { text: c.question })]));
    }
  }
}
