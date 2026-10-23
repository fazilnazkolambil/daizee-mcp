# YouTube upload: the Daizee demo

Everything to upload is in `reel-studio/out/daizee-demo/`:

| File | What it is |
|---|---|
| `video.mp4` | The film: 1920×1080, 2:56, mastered to −14 LUFS |
| `thumbnail.png` | Custom thumbnail, 1280×720, 632 KB (YouTube's limit is 2 MB) |
| `captions.srt` | English captions, 42 cues, made from the film's own subtitles and Daizee's real replies (`npm run reel:srt -- daizee-demo`) |

The hackathon needs the video **Public**, under 3:00, with embedding allowed so Devpost can play it.

---

## 1. Title

Use this one (66 characters):

> **Daizee: Just talk. It remembers your life. | MCP server for Alexa+**

Alternatives:
- I built a voice health coach that remembers your life (MCP + Alexa+)
- Daizee, a health coach you just talk to | Amazon Developer Hackathon 2026

## 2. Description

Paste as is. The first two lines show above "…more", so they carry the pitch and the demo link.

```
Daizee is the AI coach in DayZer0, my health app on Android. For the Amazon Developer Hackathon 2026 (Alexa+ track), I built a self-hosted MCP server so you can just talk to her: tell her once, and she remembers your life.

▶ Try the live demo: https://daizee-mcp-demo.web.app
▶ Code: https://github.com/fazilnazkolambil/daizee-mcp
▶ DayZer0 on Google Play: https://play.google.com/store/apps/details?id=com.mobil80.dayZer0

WHAT'S REAL AND WHAT'S SIMULATED
• Real: the MCP server (official SDK, spec 2025-11-25, Streamable HTTP), seven voice-shaped tools, the memory and safety rules, per-user DayZer0 sign-in, and the connection to the real DayZer0 app's data.
• Simulated: the Alexa+ side. Alexa+ add-on tooling is limited to select partners, so a demo page acts as the MCP client in its place. Not affiliated with, endorsed or certified by Amazon.
• Maya, Kim and Natasha are AI-generated dramatizations. Every Daizee reply in their stories is the product's real reply to that sentence, in the demo's real voice.

CHAPTERS
0:00 Staying healthy became a second job
0:18 Just talk: Maya, Kim and Natasha
0:49 Two days later, Daizee still remembers
1:24 Why I built Daizee
1:36 Live demo: memory across conversations
2:07 Under the hood: the MCP server
2:17 Notes that fade, forgetting that asks first
2:37 What's simulated, and why it's ready

HOW IT WORKS
• Tell it once. Memories live in the service, not the assistant, so they survive a brand-new conversation.
• Notes have a lifespan: a two-week trip lasts 14 days, a sore knee 5 days, an allergy about a year. Daizee checks in before letting one go.
• Forgetting always asks first, and the server enforces it.
• Meals are checked against what you've told it, like a peanut allergy. It's a reminder, never medical advice.
• Your weight is never read out loud.

Built with TypeScript, the MCP TypeScript SDK, Firebase (Hosting, Cloud Functions, Firestore, Secret Manager), Gemini and Google Cloud Text-to-Speech. Video made with Remotion.
Music: "Inspirational" by Paul Yudin (Pixabay).

#MCP #VoiceAI #Hackathon
```

## 3. Thumbnail

Upload `thumbnail.png`: Daizee's avatar, **"Just talk. It remembers your life."**, and Maya, Kim and Natasha at their happy endings.

Custom thumbnails need a verified channel (YouTube Studio → Settings → Channel → Feature eligibility → verify by phone). If the option is greyed out, verify first; it takes a minute.

## 4. Captions

1. In the upload flow (or later, Studio → Subtitles), choose **Add language → English**.
2. **Upload file → With timing** → `captions.srt`.
3. Set the **video language** to English in Details too, so this track becomes the default over the auto-generated one.

Why upload instead of using YouTube's auto captions:
- Auto captions mishear "Daizee" (as "Daisy"), "DayZer0", "MCP" and "quinoa". This file spells them right.
- It labels who is talking (Maya, Kim, Natasha, Daizee).
- It covers Daizee's spoken replies in the screen demo, which have no on-screen subtitles.

## 5. Settings

| Setting | Choose | Why |
|---|---|---|
| Visibility | **Public** | The hackathon requires a public video |
| Audience | **No, it's not made for kids** | It isn't, and "made for kids" turns off comments and other features |
| **Altered or synthetic content** | **Yes** | YouTube requires this for realistic AI-generated people (Maya, Kim, Natasha). It adds a small label; it doesn't limit reach |
| Paid promotion | No | |
| Category | Science & Technology | |
| Video language / caption language | English | |
| License | Standard YouTube License | |
| **Allow embedding** | **On** (Show more → License) | Devpost plays the video embedded |
| Automatic chapters | **Off** | So YouTube uses the chapters from the description |
| Remixing | Don't allow | |
| Comments | On | |
| End screen / cards | None | The last 2.6 s is the end card with both URLs; an end screen would cover it |

**Tags** (Show more → Tags):

```
daizee, dayzer0, alexa plus, alexa+, mcp, model context protocol, mcp server, voice assistant, ai health coach, nutrition tracking, health memory, amazon developer hackathon, devpost, firebase, gemini
```

## 6. Pinned comment

Post this from your channel and pin it:

```
Try it yourself, no sign-up: https://daizee-mcp-demo.web.app (fictional data, reset any time). Tell it an allergy, press "New conversation", then log a meal. The code, tests and MCP traces are on GitHub: https://github.com/fazilnazkolambil/daizee-mcp
```

## 7. After upload

1. **Wait for HD processing.** YouTube shows 360p first; 1080p follows in a few minutes. Then watch it once at 1080p.
2. **Check what YouTube shows:**
   - captions on by default, in English, with names spelled right;
   - chapters on the progress bar;
   - the custom thumbnail;
   - the "Altered or synthetic content" label.
3. **Copyright check** (Studio → Content → Restrictions). Pixabay music occasionally draws an automated Content ID claim. If one appears, dispute it with the Pixabay Content License; keep the track's Pixabay page link handy.
4. **Test playback signed out** (a private window), including on a phone.
5. **Paste the link into Devpost** ("Video demo link") as the `https://youtu.be/…` short link, and confirm the Devpost preview plays it embedded.
