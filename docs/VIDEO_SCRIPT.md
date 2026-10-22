# Demo video script: Daizee, built for Alexa+

**Target 2:54, hard limit 3:00** (judges may stop at 3:00). Public on YouTube, in English.

**Two parts:** **A**, the three AI stories (0:00–1:05), as the hook and the vision; then **B**, Fazil on camera and on screen (1:05–2:54), showing how it works today and how it will work with Alexa+.

**What we submit:** the `daizee-mcp` repo and its hosted demo (`daizee-mcp-demo`, fictional data). The DayZer0 app (`dayzer0-prod`) is the live product it connects to, shown as proof.

**The story in one line:** staying healthy has become a second job. With Daizee you just talk, and it remembers your life.

**Style reference:** OpenAI's "Introducing GPT-6 Astra" (2:42). Real people talk casually to an AI in dim, warm, cinematic rooms, with their words as clean subtitles. The camera stays close with shallow depth of field and slow push-ins, and the film ends on the logo over a dark, minimal object.

---

## 1. Look and feel

- **Mood:** calm, intimate, near-future. Warm practical lights (a lamp, a window, screen glow) in dim rooms, a teal-and-amber grade, shallow depth of field, slow push-ins, long holds. Faster cuts only in the walkthrough.
- **Daizee on screen:** never a robot or a face. It's a soft, breathing light on the phone, a pulsing dot or ring in Daizee blue `#0a84ff`, that turns amber when it warns. It speaks with the product's real voice, Google `en-IN-Chirp3-HD-Aoede`.
- **Subtitles:** spoken words in white sans-serif, bottom centre, one line at a time. Daizee's words are in soft blue.
- **On-screen type:** one short line, centred, with plenty of empty space around it.
- **Music:** a sparse ambient piano or pad you have the rights to (for example the YouTube Audio Library; note the track name). It swells once, at the ending.
- **Honesty rules:**
  - Every character scene carries a small label in the **bottom-left**: "Dramatization · AI-generated". Keep the video tool's own ✦ watermark in the bottom-right. Don't remove it: it may be required by the tool's terms, and it backs up the label.
  - Product screens are always **real recordings**.
  - Every Daizee line in a character scene is the **product's actual reply** to that sentence, recorded from the demo. You may trim a long reply down to the sentences that matter in the audio; the full reply stays visible on the real insert.
- **Never use:**
  - real people's likenesses, or stereotypes;
  - other brands' apps or logos;
  - Amazon, Echo or Alexa logos, or an Echo-shaped device.

## 2. Cast (fictional, AI-generated)

Paste each description word for word into every prompt for that person, so they look the same in every shot.

| | Maya Collins | Kim Jae-won | Natasha Brooks |
|---|---|---|---|
| **Who** | 34, white, project manager in **London**, mum of two (ages 4 and 7) | 30, Korean, disciplined amateur athlete in **Seoul** | 27, Black American, wellness-focused UX designer in **Atlanta** |
| **Description** | auburn hair in a messy bun, soft blue blouse; a yoga mat by the door she rarely gets to | short black hair, lean build, charcoal performance t-shirt, smartwatch | natural curls in a puff, gold hoop earrings, olive athleisure set |
| **Look** | **morning gold**: a busy family kitchen | **cool steel blue** (Seoul flat), then **desert gold** (Dubai) | **warm evening amber**: a plant-filled loft |
| **Pain** | no time to think about food | travel breaks his routine | she tracks everything: searching lists, photographing plates |
| **Daizee moment** | "What should I eat today?" every day, with a fresh answer each time | "Going to Dubai for two weeks" means the plan adapts for 14 days, then it lets go | "I ate pad thai" triggers a warning from the peanut allergy she mentioned once |
| **Accent** | British English | Korean-accented English | American English |

**How the stories stay clear:**
1. **One story at a time:** each person's story runs whole (Maya, then Kim, then Natasha).
2. **Their own world:** each person has their own country, colour palette and light, so they're recognizable in one frame.
3. **Corner tag:** every scene has the same top-left tag, with name, city and local time (for example "Maya · London · Mon 7:05"). It also covers the text the AI burned into H3, M2 and K2.
4. **Lower-third:** on their first appearance only, showing name, age and one fact.

## 3. Voices

- **No narrator in Part A:** on-screen text carries it. **Part B is you**, in your own voice.
- **Daizee:** one voice for all three people, the same assistant everywhere: the product's real voice speaking its real replies.
- **Characters:** one consistent voice per person, from the video tool's own audio or a separate AI voice.

---

## 4. Timeline

### Part A · The stories (0:00–1:40): AI clips, no presenter — DONE

Rendered in reel-studio (`content/daizee-demo/reel.ts` → `out/daizee-demo/video.mp4`): the hook, Maya, Kim and Natasha with Daizee's **real** replies (captured from the demo on fictional data, in its real voice) answering over the frozen frame of each scene, then the three of them together and a closing card. Music: "Inspirational" by Paul Yudin (Pixabay), kept low and ducked under every line.

### Part B · Fazil explains (1:40–2:57, about 77 s)

**Built from the recordings.** The product was recorded first: four takes from the real demo (fictional data, the live Gemini brain, the real cloud voice; lines typed because headless Chrome has no microphone), in reel-studio `content/daizee-demo/screen/` with an `.events.json` for every moment and Daizee's reply audio. Every line below is placed on what is visible at that second, and Daizee's real replies play between your lines. Waiting time for the model is cut out.

**What you record:** your voice for B2–B4 (a voice-over: any quiet room, phone or USB mic) and three short lines to camera (B1, B5, B6). Say it your own way: if a sentence comes out differently but means the same, keep it. The subtitles follow your recording.

#### B1 · to camera (1:40–1:50)
> "Hi, I'm Fazil. I built DayZer0, a health coach app. For this hackathon, I made its coach, Daizee, someone you can just talk to."

#### B2 · voice-over on `take-memory` (1:50–2:09)

| Clip (take seconds) | On screen | Sound |
|---|---|---|
| 1.5 → 4.9 | The empty assistant; "I'm allergic to peanuts." is typed and sent | **You:** "This assistant is a stand-in for Alexa+. I'll tell it I'm allergic to peanuts." |
| 11.6 → 14.4 | Daizee's reply appears; the allergy lands in "What Daizee remembers" | **Daizee:** "Got it, I'll remember that for about a year." (reply-1, 2.7 s) |
| 16.3 → 19.6 | **New conversation** is pressed; the line "The assistant now remembers nothing" appears; "Log pad thai for dinner." is typed | **You:** "Now I start a fresh conversation, so the assistant forgets everything." |
| 23.3 → 28.3 | The red banner: "Heads up: pad thai may contain peanuts" | **Daizee:** "Logged your dinner, about 600 calories. Heads up: pad thai may contain peanuts." (reply-2, first 4.9 s) |
| 28.3 → 29.8 | Hold on the banner | **You:** "But Daizee didn't." |

#### B3 · voice-over on `take-memory` (2:09–2:20)

| Clip | On screen | Sound |
|---|---|---|
| 35.9 → end, then hold; slow zoom into Behind the scenes | The `log_meal` row: the request (`tools/call`, "pad thai"), the response with the warning, `200`, "server 9.8 ms", "500 ms target". Label: "MCP 2025-11-25 · Streamable HTTP · 7 tools" | **You:** "On the right is what really happened. The assistant called my MCP server, and the server sent back that warning, in about ten milliseconds." |

#### B4 · voice-over on `take-lifespan` (2:20–2:40)

| Clip | On screen | Sound |
|---|---|---|
| 3.0 → 5.2 | "How am I doing today?" is typed and sent; the knee note shows "2 days left" | **You:** "Notes don't stay forever. When one is about to run out, Daizee checks in." |
| 13.4 → 17.5 | Daizee's answer appears | **Daizee:** "Is your left knee still sore, or can I mark that as finished?" (reply-1, from 6.4 s) |
| 25.8 → 27.5 | "My knee is better now." is typed and sent | none (music) |
| 33.4 → 35.7 | Daizee's question appears | **Daizee:** "Should I forget 'left knee is sore'?" (reply-2) |
| 36.8 → 37.9 | "Yes." is typed and sent | **You:** "It never forgets anything unless you say yes." |
| 49.1 → 53.0 | "Done." appears and the knee note leaves "What Daizee remembers" | **Daizee:** "Done. I've let go of 'left knee is sore'." (reply-3) |

#### B5 · to camera (2:40–2:51)
> "To be honest, the Alexa+ part is simulated, because access is still limited to partners. But the server is real, and it's ready for Alexa+."

#### B6 · to camera, then the end card (2:51–2:57)
> "Staying healthy shouldn't feel like a second job. You should just be able to talk."

End card: "Daizee · Just talk. It remembers your life.", the GitHub URL and https://daizee-mcp-demo.web.app.

**Also recorded, not in this cut (time):** `take-travel` (Kim's story already shows it), the weigh-in that never says the number (`take-lifespan` 55.8 s), and "585 x for breakfast" understood as eggs (`take-misheard`).

**How Part B covers what judges score:**
- **Tech Implementation:** B2 and B3: a self-hosted MCP server working live, its real request and response, and its speed.
- **Design:** B2 and B4: voice-first, memory across conversations, check-ins, and forgetting only on a yes.
- **Potential Impact:** B1 (a live app) and B5 (ready for Alexa+). Account linking (each user signs in with their DayZer0 account) goes in the Devpost text.
- **Quality of the Idea:** Part A, and B2–B3: the assistant forgets, the server remembers, and the server raised the warning.
- **Honesty about what's simulated:** B2 ("a stand-in for Alexa+") and B5.
- **Pre-existing work:** B1, with the details in the Devpost text.

## 5. AI shot prompts (5 to 8 s each; make 2 to 3 takes per shot and keep the most natural)

**Add to the end of every prompt:** *photorealistic, cinematic, 35mm, shallow depth of field, warm practical lighting, teal-and-amber grade, slow push-in, natural candid acting, no text, no logos, phone screen shows only a soft glowing blue dot.*

**Use these descriptions exactly:**
- **MAYA** = "Maya Collins, a 34-year-old white British project manager with auburn hair in a messy bun, wearing a soft blue blouse"
- **KIM** = "Kim Jae-won, a 30-year-old lean Korean man with short black hair, wearing a charcoal performance t-shirt and a smartwatch"
- **NATASHA** = "Natasha Brooks, a 27-year-old Black American woman with natural curls in a puff and gold hoop earrings, wearing an olive athleisure set"

| Shot | Prompt |
|---|---|
| H1 | MAYA standing frozen in front of an open fridge at 7 am in a busy London family kitchen; two young kids eating breakfast behind her, lunch boxes on the counter; golden morning window light mixed with cool fridge light; she sighs, overwhelmed. |
| H2 | KIM folding clothes precisely into a suitcase on a bed in a minimalist Seoul apartment at night; cool steel-blue city light through the window; his phone on the bed lights up with a notification; he glances at it, worried. |
| H3 | NATASHA in a plant-filled Atlanta loft at evening, photographing her dinner plate with her phone, then scrolling on it with a tired expression; warm amber lamp light. |
| H4 | Three separate takes in the same framing (medium close-up, face lit by a phone screen in a dim room, tired), one each of MAYA, KIM and NATASHA, for a triptych. |
| M1 | MAYA holding her 4-year-old on her hip in the London kitchen at 7 am, packing a lunch box with one hand, speaking casually toward a phone propped on the counter that shows a soft pulsing blue light; golden window light. |
| K1 | KIM zipping a packed suitcase on his bed in the Seoul apartment at night, then sitting and speaking calmly to his phone lying on the bed, which glows with a soft blue light; cool steel-blue light. |
| N1 | NATASHA at her desk in the Atlanta loft at midday, eating a quinoa bowl, glancing at her phone on the desk and speaking to it casually with a small smile; warm daylight, plants. |
| M2 | MAYA rolling up a yoga mat on her living-room floor at dawn, calm and refreshed, then speaking to her phone on a side table that pulses soft blue; soft golden light. |
| K2 | KIM on a Dubai hotel balcony at sunrise in running gear, the skyline behind him in a golden heat haze, speaking to his phone held loosely in his hand, which glows soft blue. |
| N2 | NATASHA opening a takeout box of noodles on her kitchen counter at night, saying something casual to her phone; the phone's soft light turns warm amber; she pauses and looks at it, attentive. |
| M3 | MAYA doing yoga on the living-room floor in the evening, her two kids copying her poses and laughing; warm lamp light, joyful. |
| K3 | KIM at a Dubai airport gate at night with a bag over his shoulder, glancing at and speaking to his phone, which glows soft blue; ambient terminal light. |
| N3 | NATASHA cooking dinner with a friend in her loft kitchen, laughing, relaxed; warm amber light, steam rising from a pan. |
| E1 | MAYA laughing mid-yoga pose with her kids on the living-room floor, golden light, slow motion. |
| E2 | KIM running along the Dubai seafront at dawn, easy and smooth stride, golden light, slow motion, tracking shot. |
| E3 | NATASHA clinking glasses with a friend over dinner at candlelight in her loft, slow motion. |

Check that your video tool's terms allow commercial use. Composite the real UI onto the phone screens in the edit; never let the AI invent app screens.

---

## 6. What to record for real

**For Part A:** Daizee's real replies to the three story lines, recorded through the demo, plus the manual food-search recording in DayZer0 for H3.

**For Part B (you):**
1. **Setup:**
   - **OBS** with two scenes: "Camera" (you, full frame) and "Screen" (the demo page and the phone, with your camera small in the corner).
   - A USB or lapel mic, or your earphones' mic, not the laptop mic. Headphones on, so the mic doesn't pick up Daizee.
   - Light in front of you, not behind.
   - Chrome at about 125% zoom, in a window at least 1280 px wide.
   - Live mode, Voice input: Browser, Speak replies on, Conversation mode on.
   - "Assistant calls only" switched on in Behind the scenes.
2. **The local server, connected to the real app** for the phone shot. Run `npm run demo` with these lines in `.env`, next to the existing `DAIZEE_SECRETS_PROJECT` and `DAIZEE_TTS` lines:

```
STORE=firestore
FIREBASE_PROJECT_ID=dayzer0-prod
DAIZEE_ALLOWED_UIDS=demo=<uid of a fictional demo account>
DAIZEE_ALLOW_LIVE_FIRESTORE=1
DEMO_MODE=1
```

   Record from `http://localhost:8787`. The startup line must say `project dayzer0-prod (LIVE DATA)`. Remove these lines after filming.

3. **Order:**
   - **B2 and B3** first, in one take on the real demo account.
   - **B4** on the default in-memory demo data:
     - Kim: "I'm going to Dubai for two weeks", which shows 14 days.
     - **+6**, then **+6** again, then "How am I doing today?", for the check-in.
     - "My knee is better now" → "Yes."
     - "I weigh 61.5 kilos today."
     - `npm test` passing in the terminal.
   - Then the **camera lines** (B1, B5, B6): 2 to 3 takes each, looking into the lens.
4. **Tips:**
   - You don't need to memorize the lines. Put them right under the lens as a teleprompter, and read one sentence at a time.
   - Smile at B1 and B6, slow down at B5, and pause after "Now watch".
   - If something mishears you on screen and Daizee recovers by asking, keep the take. It shows the safety guard working.

## 7. Edit decisions for the AI clips (reviewed Oct 21)

All 18 clips are in: 6.0 s each, 1280×720, 24 fps, with generated audio. The characters stay consistent across clips, and each person's palette holds. Export the film at 1080p; the 720p clips upscale fine.

**Use as is:** H1, H2, H4_maya, H4_kim, H4_natasha, K1, N1, N2, M3, E1, E2.

| Clip | What's wrong | What to do |
|---|---|---|
| **M1** | At **about 4.0 s** it turns into an AI-invented app screen, with a gibberish "today's meal plan" ("Healthy food with Freace, hill freeks", "Boeani plan"). It also has baked-in text "7:05 AM MONDAY" at top-left. | Use **0 to 3.9 s** only, then cut straight to the **real** demo insert. Cover the baked text with our corner tag (a solid or frosted box). |
| **E3** | At **about 4.0 s** it turns into a white-framed collage of three photos. | Use **0 to 3.9 s** only. |
| **K3** | From **about 4.6 s** Kim's eyes close and his mouth falls open. | Use **0 to 4.4 s**. |
| **H3** | Baked-in, **misspelled** caption "Atlansha Brooks · 7:15 PM" at top-left. From about 3 s the phone shows an AI-invented food app. | Cover the caption with our corner tag. Replace the phone screen with the **real** DayZer0 food search, either composited onto the phone or as a cut to it full screen. Or regenerate (see below). |
| **M2** | Baked-in "MAYA COLLINS · Wednesday, 6:50 AM" at top-left. | Cover it with our corner tag, in a box big enough to hide it. |
| **K2** | Baked-in "KIM JAE-WON · 6:10 AM", which changes to "KIM JAEWON" partway through. | Same as M2. |
| **N3** *(optional)* | Natasha's friend wears the same olive athleisure, so they look like twins. | Regenerate with the friend in a different colour, or accept it. |

**Regenerate if you have time** (H3, N3, and M1 if you'd rather not trim it). Add this to the end of the prompt:

> *no on-screen text, no captions, no titles, no app interface or readable screen content; phone and watch screens show only a soft glowing blue dot.*

**Audio rules for the AI clips:**
- **Speech:** keep a clip's own generated speech only if it says the **exact** script line, with matching lip movement. Otherwise mute it and dub the line, with one consistent voice per person.
- **Music:** **mute any generated music.** M3, N3, E1 and E3 have steady sound, which is likely a music bed. Use only your one licensed track.
- **Room sound:** keep it low under the dialogue (kitchen, city hum, the airport).

**Clip lengths:** 6 s fits each slot together with its 2 to 3 s real insert. For N2's 12 s slot, hold the real insert while Daizee's reply plays; don't slow the AI clip down.

## 8. Schedule (deadline Friday 12:00 PT)

- **Today:**
  - Send me the demo account's uid, and we do a dry run of the local server against the real app.
  - Record Daizee's replies for Part A, then record Part B.
- **Then I edit in reel-studio:**
  - Part A from the 18 clips (trims, corner tags, subtitles, Daizee's real replies).
  - Part B from your recordings (zooms on Behind the scenes, subtitles).
  - Your licensed music, ducked under your voice; loudness mastered; the end card.
  - Render at 1080p and check every frame and the length.
- **Last:**
  - Watch it through once.
  - Upload to YouTube as **Public**, with English captions corrected for "Daizee", "DayZer0", "MCP" and "quinoa".
  - Paste the link into Devpost.
