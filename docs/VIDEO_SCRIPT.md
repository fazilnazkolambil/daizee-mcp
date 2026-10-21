# Demo video script (target 2:45, hard limit 3:00)

Judges may stop at 3:00, so the strongest moment comes first. Speak in your own voice; no music unless you have rights to it; no Amazon / Echo / Alexa logos on screen (say "Alexa+" out loud, that's fine).

## Setup before recording

- **Screen layout:** demo page on the left (~65%), the DayZer0 Android app mirrored on the right (`scrcpy` for Android, free).
- **Account:** the fictional demo account in DayZer0, the same uid that daizee-mcp is allowed to use. Clear its meals for today and remove its memories, so the dashboard starts empty.
- **Demo page:** live mode with fast replies, "Speak replies" and "Conversation mode" on (both are the default), in Chrome. Wear headphones so the mic doesn't pick up the spoken reply. Tap the mic once, then just talk: it stops when you stop, Daizee answers out loud, and the mic reopens for your next line. **Behind the scenes** is the right-hand column and stays on screen the whole time; turn on "Assistant calls only" so the page's own refreshes are hidden. Zoom the browser to about 125% so text is readable at 1080p (the window must stay at least 1280 px wide at that zoom, or the panel moves below the chat).
- **Two recording runs:** scenes 0:15–1:35 and 2:00–2:15 use the real app (`STORE=firestore`, `DAIZEE_ALLOWED_UIDS=demo=<uid>`, `DAIZEE_ALLOW_LIVE_FIRESTORE=1`, `DEMO_MODE=1` so the page's demo header is accepted, user `demo`; local only, never on a server others can reach). Scene 1:35–2:00 uses the default in-memory store as `maya`, because Advance time is turned off with real data. Say one line in the voice-over so the switch is honest: "To show expiry without waiting a week, I'll fast-forward on demo data."
- **Before recording:** do one full dry run, then reset. Record in 1080p. Do several takes per scene and cut the best ones together.

## Scenes

| Time | On screen | You say (roughly) |
|---|---|---|
| **0:00–0:15** | Title card: "Daizee for Alexa+: a health memory that lives in the service, not the assistant" | "I'm Fazil. DayZer0 is my live Android health coach. This is Daizee, its coach, made voice-controllable for Alexa+ through a self-hosted MCP server." |
| **0:15–0:45** | Click the mic: *"I'm allergic to peanuts, and my left knee is sore this week."* The memory chips appear. **Cut to the phone: the Memories page shows both.** | "I tell the assistant once. It calls the Daizee MCP server, which saves an allergy for a year and the knee for seven days, straight into the same Firestore my app uses." |
| **0:45–1:15** | Press **New conversation**. The note says the assistant forgot. Mic: *"Log pad thai for dinner."* The safety banner names the peanut memory. **Phone: the meal appears and today's calories update live.** | "Brand-new conversation, so the assistant knows nothing. The service still does: pad thai gets flagged for peanuts, and the meal lands in the app. It's a reminder, not medical advice." |
| **1:15–1:35** | Mic: *"What should I focus on today?"* (`get_today_plan`). The spoken reply plays. | "Daizee's own daily plan, the same one the app shows, now spoken. Alexa does the talking; Daizee provides the facts. There's no chatbot relay, which is what Alexa+ policy asks for." |
| **1:35–2:00** | *(Filmed separately in in-memory mode as `maya`, since Advance time is off with real data. Show the "fictional demo data" note for a second.)* Press **Reset demo data**, then **Advance time** by 1 day. (`maya`'s knee note is already 3 days into its 5-day life; more than 1 day expires it before the check-in shows.) *"How am I doing today?"* gives the knee check-in. *"My knee is better now."* The assistant asks first. *"Yes, forget it."* It's resolved. | "Memories expire on purpose. Before a note lapses, Daizee checks in. Forgetting always takes two steps, and the service enforces it, not the prompt." |
| **2:00–2:15** | *"I weigh 61.5 kilos today."* The reply doesn't say the number; the card shows it. | "Replies are built for voice: one short sentence, and private numbers like weight are never said out loud." |
| **2:15–2:35** | Zoom into the Behind the scenes column (it has been visible all along), open the `log_meal` row: `initialize`, `tools/list`, `tools/call` with JSON and round-trip times under 500 ms. Briefly show the repo and the test count. | "Under the hood: the official MCP SDK, Streamable HTTP, spec 2025-11-25, seven tools, no language model inside the server, all covered by tests that use a real MCP client." |
| **2:35–2:50** | Closing card: repo URL, hosted demo URL, "Real MCP server · Alexa+ client simulated" | "DayZer0 users can already log by chat. With this, they can just say it to Alexa+. Next: account linking, so every user connects their own Daizee." |

## Notes

- If the Firestore connection isn't ready in time, film the same story without the phone and replace the "lands in the app" lines with the memory and today cards on the demo page.
- Say "simulated Alexa+ client" once, plainly (in the closing card). Honesty about what is simulated reads better to judges than a vague claim.
- Upload to YouTube as **Public** or **Unlisted** (the rules say public), with English captions. Auto-captions are fine if you correct "Daizee", "idli" and "MCP".
